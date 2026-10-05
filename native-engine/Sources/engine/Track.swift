import Foundation
import AVFoundation
import Vision
import CoreGraphics
import CoreImage

private let confidenceThreshold: Float = 0.4
private let maxExtrapolatedFrames = 12
private let backwardChunkSeconds: Double = 1.5
private let backwardMaxDimension: CGFloat = 768

struct Keyframe {
    let frame: Int
    let rectPixels: CGRect
}

/// 追踪参数，由 /track 请求可选携带；默认值与 iOS 版一致
struct TrackOptions {
    var faceReanchor = false
    var fusionIou: Double = 0.5
    var weightNormal: Double = 0.3
    var weightDrift: Double = 0.7
    var weightLowConfidence: Double = 0.2
}

/// Vision 模型追踪（TrackObjectRequest）
private final class ObjectTracker {
    private var request: TrackObjectRequest
    var lastRect: CGRect
    var velocity: CGSize = .zero
    var extrapolated = 0
    private(set) var lost = false

    init(seedUprightPixels: CGRect, upright: CGSize, naturalSize: CGSize, transform: CGAffineTransform) {
        let normalized = CGRect(
            x: seedUprightPixels.minX / upright.width,
            y: seedUprightPixels.minY / upright.height,
            width: seedUprightPixels.width / upright.width,
            height: seedUprightPixels.height / upright.height
        ).clampedToUnit()
        let visionRect = Geometry.uprightNormalizedToVision(
            normalized, naturalSize: naturalSize, transform: transform)
        request = TrackObjectRequest(detectedObject: DetectedObjectObservation(
            boundingBox: NormalizedRect(normalizedRect: visionRect)))
        lastRect = seedUprightPixels
    }

    func advance(on image: TrackedImage, upright: CGSize,
                 naturalSize: CGSize, transform: CGAffineTransform) async -> CGRect {
        do {
            let result: DetectedObjectObservation?
            switch image {
            case .buffer(let pixelBuffer):
                result = try await request.perform(on: pixelBuffer, orientation: .up)
            case .cgImage(let cgImage):
                result = try await request.perform(on: cgImage, orientation: .up)
            }
            return update(result: result, upright: upright, naturalSize: naturalSize, transform: transform)
        } catch {
            lost = true
            return lastRect
        }
    }

    private func update(result: DetectedObjectObservation?, upright: CGSize,
                        naturalSize: CGSize, transform: CGAffineTransform) -> CGRect {
        if let observation = result, observation.confidence >= confidenceThreshold {
            let normalized = Geometry.visionToUprightNormalized(
                observation.boundingBox.cgRect, naturalSize: naturalSize, transform: transform)
            let pixels = CGRect(
                x: normalized.minX * upright.width,
                y: normalized.minY * upright.height,
                width: normalized.width * upright.width,
                height: normalized.height * upright.height
            )
            velocity = CGSize(width: pixels.minX - lastRect.minX, height: pixels.minY - lastRect.minY)
            lastRect = pixels
            extrapolated = 0
        } else if extrapolated < maxExtrapolatedFrames {
            lastRect = lastRect.offsetBy(dx: velocity.width, dy: velocity.height)
            extrapolated += 1
        } else {
            lost = true
        }
        return lastRect
    }
}

enum TrackedImage: @unchecked Sendable {
    case buffer(CVPixelBuffer)
    case cgImage(CGImage)
}

/// 融合追踪器：Vision 模型 + 颜色追踪逐帧加权融合，可选人脸重锚定。
/// 算法与 iOS 版 TrackingEngine 保持一致。
private final class FusedTracker {
    let model: ObjectTracker
    let color: ColorTracker
    private let options: TrackOptions
    private let faceRequest: DetectFaceRectanglesRequest?
    private var frameIndex = 0

    private let upright: CGSize
    private let naturalSize: CGSize
    private let transform: CGAffineTransform

    var lost: Bool { model.lost && color.lost }

    init(seedUprightPixels: CGRect, info: VideoInfo, options: TrackOptions) {
        self.options = options
        self.upright = info.upright
        self.naturalSize = info.naturalSize
        self.transform = info.transform
        model = ObjectTracker(
            seedUprightPixels: seedUprightPixels, upright: info.upright,
            naturalSize: info.naturalSize, transform: info.transform)
        color = ColorTracker(
            seedUprightPixels: seedUprightPixels, upright: info.upright,
            naturalSize: info.naturalSize, transform: info.transform)
        faceRequest = options.faceReanchor ? DetectFaceRectanglesRequest() : nil
    }

    func advance(on image: TrackedImage) async -> CGRect {
        defer { frameIndex += 1 }
        let modelRect = await model.advance(
            on: image, upright: upright, naturalSize: naturalSize, transform: transform)
        let ci: CIImage
        switch image {
        case .buffer(let pixelBuffer): ci = CIImage(cvPixelBuffer: pixelBuffer)
        case .cgImage(let cgImage): ci = CIImage(cgImage: cgImage)
        }
        let colorRect = color.advance(
            on: ci, upright: upright, naturalSize: naturalSize, transform: transform)
        let colorOK = !color.lost && color.lastDetected

        var fused = modelRect
        if model.lost {
            fused = colorRect
        } else if colorOK {
            let overlap = Self.iou(modelRect, colorRect)
            let t: CGFloat
            if !color.reliable {
                t = options.weightLowConfidence
            } else {
                t = overlap >= options.fusionIou ? options.weightNormal : options.weightDrift
            }
            fused = Self.lerp(modelRect, colorRect, t)
            let prevMin = CGPoint(
                x: modelRect.minX - model.velocity.width,
                y: modelRect.minY - model.velocity.height
            )
            model.velocity = CGSize(width: fused.minX - prevMin.x, height: fused.minY - prevMin.y)
            model.lastRect = fused
            model.extrapolated = 0
        }

        if let faceRequest, frameIndex % 10 == 0,
           let reanchored = await reanchorFace(request: faceRequest, image: image, current: fused) {
            fused = Self.lerp(fused, reanchored, 0.8)
            model.lastRect = fused
            model.extrapolated = 0
        }

        color.sync(toUprightPixels: fused, upright: upright,
                   naturalSize: naturalSize, transform: transform)
        return fused
    }

    /// 精确模式：每 10 帧重新检测人脸，纠正模型追踪漂移
    private func reanchorFace(request: DetectFaceRectanglesRequest, image: TrackedImage,
                              current: CGRect) async -> CGRect? {
        let observations: [FaceObservation]?
        switch image {
        case .buffer(let pixelBuffer):
            observations = try? await request.perform(on: pixelBuffer, orientation: .up)
        case .cgImage(let cgImage):
            observations = try? await request.perform(on: cgImage, orientation: .up)
        }
        guard let observations else { return nil }
        return observations
            .map { obs -> CGRect in
                let n = Geometry.visionToUprightNormalized(
                    obs.boundingBox.cgRect, naturalSize: naturalSize, transform: transform)
                return CGRect(x: n.minX * upright.width, y: n.minY * upright.height,
                              width: n.width * upright.width, height: n.height * upright.height)
            }
            .filter { Self.iou($0, current) > 0.3 }
            .max(by: { Self.iou($0, current) < Self.iou($1, current) })
    }

    private static func iou(_ a: CGRect, _ b: CGRect) -> CGFloat {
        let inter = a.intersection(b)
        if inter.isNull || inter.width <= 0 || inter.height <= 0 { return 0 }
        let interArea = inter.width * inter.height
        let union = a.width * a.height + b.width * b.height - interArea
        return union > 0 ? interArea / union : 0
    }

    private static func lerp(_ a: CGRect, _ b: CGRect, _ t: CGFloat) -> CGRect {
        CGRect(
            x: a.minX + (b.minX - a.minX) * t,
            y: a.minY + (b.minY - a.minY) * t,
            width: a.width + (b.width - a.width) * t,
            height: a.height + (b.height - a.height) * t
        )
    }
}

private func makeReader(info: VideoInfo, fromFrame: Int, toFrame: Int) throws -> (AVAssetReader, AVAssetReaderTrackOutput) {
    let reader = try AVAssetReader(asset: info.asset)
    let output = AVAssetReaderTrackOutput(
        track: info.track,
        outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    )
    output.alwaysCopiesSampleData = false
    reader.timeRange = CMTimeRange(
        start: CMTime(seconds: Double(fromFrame) / info.fps, preferredTimescale: 600),
        end: CMTime(seconds: Double(toFrame) / info.fps, preferredTimescale: 600))
    guard reader.canAdd(output) else { throw EngineError.decodeFailed(info.asset.url.path) }
    reader.add(output)
    guard reader.startReading() else { throw EngineError.decodeFailed(info.asset.url.path) }
    return (reader, output)
}

private func trackBackward(info: VideoInfo, seed: Keyframe, toFrame: Int,
                           options: TrackOptions, into dense: inout [Int: [Double]]) async throws {
    let ciContext = CIContext(options: [.cacheIntermediates: false])
    let tracker = FusedTracker(seedUprightPixels: seed.rectPixels, info: info, options: options)
    var cursor = seed.frame

    while cursor > toFrame {
        if Task.isCancelled { throw CancellationError() }
        let chunkStart = max(toFrame, cursor - Int((backwardChunkSeconds * info.fps).rounded()))
        let (reader, output) = try makeReader(info: info, fromFrame: chunkStart, toFrame: cursor)
        var frames: [(Int, CGImage)] = []
        while let sampleBuffer = output.copyNextSampleBuffer() {
            let t = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
            let f = Int((t * info.fps).rounded())
            guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { continue }
            let ci = CIImage(cvPixelBuffer: pixelBuffer)
            let scale = min(1, backwardMaxDimension / max(ci.extent.width, ci.extent.height))
            let scaled = ci.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            guard let cg = ciContext.createCGImage(scaled, from: scaled.extent) else { continue }
            frames.append((f, cg))
        }
        _ = reader
        for (f, image) in frames.reversed() {
            if Task.isCancelled { throw CancellationError() }
            guard f >= toFrame, f < seed.frame else { continue }
            let rect = await tracker.advance(on: .cgImage(image))
            if tracker.lost { break }
            dense[f] = [Double(rect.minX), Double(rect.minY), Double(rect.width), Double(rect.height)]
        }
        if tracker.lost { break }
        cursor = chunkStart
        await Task.yield()
    }
}

func denseBetween(path: String, keyframes: [Keyframe], from fromFrame: Int, to toFrame: Int,
                  options: TrackOptions = TrackOptions()) async throws -> [String: [Double]] {
    let info = try await loadVideoInfo(path: path)
    let kfs = keyframes.sorted { $0.frame < $1.frame }
    guard !kfs.isEmpty, toFrame >= fromFrame else { return [:] }

    var dense: [Int: [Double]] = [:]

    // 从首个关键帧向前（时间倒退方向）追踪到区间起点
    if let seed = kfs.first(where: { $0.frame >= fromFrame }), seed.frame > fromFrame {
        try await trackBackward(info: info, seed: seed, toFrame: fromFrame, options: options, into: &dense)
    }

    // 前向单次扫描：每经过一个手动关键帧就以它为种子重新起追（分段追踪）
    let (reader, output) = try makeReader(info: info, fromFrame: fromFrame, toFrame: toFrame + 1)
    var segmentIndex = -1
    var tracker: FusedTracker?

    while let sampleBuffer = output.copyNextSampleBuffer() {
        if Task.isCancelled { reader.cancelReading(); throw CancellationError() }
        let t = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
        let f = Int((t * info.fps).rounded())
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { continue }
        guard f >= fromFrame, f <= toFrame else { continue }
        guard let nextSegment = kfs.lastIndex(where: { $0.frame <= f }) else { continue }

        if nextSegment != segmentIndex {
            segmentIndex = nextSegment
            tracker = FusedTracker(
                seedUprightPixels: kfs[segmentIndex].rectPixels, info: info, options: options)
        }
        guard let tracker, !tracker.lost else { continue }
        let rect = await tracker.advance(on: .buffer(pixelBuffer))
        if tracker.lost { continue }
        dense[f] = [Double(rect.minX), Double(rect.minY), Double(rect.width), Double(rect.height)]
    }

    // 从每个后续关键帧回追到前一个关键帧：关键帧附近追踪最准，
    // 回追结果覆盖前向结果（与 iOS TrackingCoordinator 的分段语义一致）
    for i in kfs.indices where i > 0 {
        if Task.isCancelled { throw CancellationError() }
        let seed = kfs[i]
        let backTo = max(kfs[i - 1].frame + 1, fromFrame)
        if seed.frame > backTo, seed.frame <= toFrame + 1 {
            try await trackBackward(info: info, seed: seed, toFrame: backTo, options: options, into: &dense)
        }
    }

    FileHandle.standardError.write(Data(
        "[track] path=\(path) kfs=\(kfs.count) range=\(fromFrame)-\(toFrame) dense=\(dense.count) reanchor=\(options.faceReanchor)\n".utf8))
    return dense.reduce(into: [:]) { $0[String($1.key)] = $1.value }
}
