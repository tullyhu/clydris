import Foundation
import AVFoundation
import Vision
import CoreGraphics
import CoreImage
import ImageIO

enum EngineError: LocalizedError {
    case noVideoTrack(String)
    case decodeFailed(String)
    case badRequest(String)
    case unsupportedMedia(String)

    var errorDescription: String? {
        switch self {
        case .noVideoTrack(let p): return "找不到视频轨道: \(p)"
        case .decodeFailed(let p): return "视频解码失败: \(p)"
        case .badRequest(let m): return m
        case .unsupportedMedia(let p): return "不支持的媒体格式: \(p)"
        }
    }
}

struct VideoInfo {
    let asset: AVURLAsset
    let track: AVAssetTrack
    let naturalSize: CGSize
    let transform: CGAffineTransform
    let upright: CGSize
    let fps: Double
    let duration: Double
    let hasAudio: Bool
}

func loadVideoInfo(path: String) async throws -> VideoInfo {
    let asset = AVURLAsset(url: URL(fileURLWithPath: path))
    guard let track = try await asset.loadTracks(withMediaType: .video).first else {
        throw EngineError.noVideoTrack(path)
    }
    let naturalSize = try await track.load(.naturalSize)
    let transform = try await track.load(.preferredTransform)
    let nominalFrameRate = try await track.load(.nominalFrameRate)
    let duration = try await asset.load(.duration)
    let audio = try await asset.loadTracks(withMediaType: .audio).first != nil
    return VideoInfo(
        asset: asset, track: track,
        naturalSize: naturalSize, transform: transform,
        upright: Geometry.uprightSize(naturalSize: naturalSize, transform: transform),
        fps: max(Double(nominalFrameRate), 1),
        duration: CMTimeGetSeconds(duration),
        hasAudio: audio
    )
}

func probe(path: String) async throws -> [String: Any] {
    if let info = try? await loadVideoInfo(path: path) {
        return [
            "kind": "video",
            "duration": info.duration,
            "fps": (info.fps * 1000).rounded() / 1000,
            "width": Int(info.upright.width),
            "height": Int(info.upright.height),
            "has_audio": info.hasAudio,
        ]
    }
    // 静态照片：返回套用 EXIF 方向后的尺寸
    let url = URL(fileURLWithPath: path) as CFURL
    if let source = CGImageSourceCreateWithURL(url, nil),
       let cgImage = CGImageSourceCreateImageAtIndex(source, 0, [
           kCGImageSourceShouldCache: false,
       ] as CFDictionary) {
        var w = CGFloat(cgImage.width)
        var h = CGFloat(cgImage.height)
        if let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
           let raw = props[kCGImagePropertyOrientation] as? UInt32,
           let orientation = CGImagePropertyOrientation(rawValue: raw),
           [.left, .leftMirrored, .right, .rightMirrored].contains(orientation) {
            swap(&w, &h)
        }
        return [
            "kind": "image",
            "duration": 5.0,
            "fps": 30,
            "width": Int(w),
            "height": Int(h),
            "has_audio": false,
        ]
    }
    throw EngineError.unsupportedMedia(path)
}

func detectFaces(path: String, frame: Int) async throws -> [String: Any] {
    let cgImage: CGImage
    if let info = try? await loadVideoInfo(path: path) {
        let generator = AVAssetImageGenerator(asset: info.asset)
        generator.appliesPreferredTrackTransform = true
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        let time = CMTime(seconds: Double(frame) / info.fps, preferredTimescale: 600)
        do {
            cgImage = try await generator.image(at: time).image
        } catch {
            throw EngineError.decodeFailed("第 \(frame) 帧")
        }
    } else {
        // 静态照片：套用 EXIF 方向后检测
        guard let ci = CIImage(contentsOf: URL(fileURLWithPath: path),
                               options: [.applyOrientationProperty: true]),
              let cg = CIContext().createCGImage(ci, from: ci.extent) else {
            throw EngineError.unsupportedMedia(path)
        }
        cgImage = cg
    }
    let request = DetectFaceRectanglesRequest()
    let observations = (try? await request.perform(on: cgImage, orientation: .up)) ?? []
    let W = Double(cgImage.width)
    let H = Double(cgImage.height)
    let boxes: [[String: Any]] = observations.map { obs in
        // 外扩 15%，与人脸扫描一致
        let b = obs.boundingBox.cgRect
        let expanded = b.insetBy(dx: -b.width * 0.15, dy: -b.height * 0.15)
        return [
            "x": max(0, min(W, Double(expanded.minX) * W)),
            "y": max(0, min(H, (1 - Double(expanded.maxY)) * H)),
            "w": max(4, min(W, Double(expanded.width) * W)),
            "h": max(4, min(H, Double(expanded.height) * H)),
            "conf": Double(obs.confidence),
            "kind": "face",
        ]
    }
    FileHandle.standardError.write(Data("[detect] frame=\(frame) boxes=\(boxes.count)\n".utf8))
    return ["boxes": boxes]
}
