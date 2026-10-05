import Foundation
import CoreImage
import CoreGraphics
import Vision

/// 对基图在 rect（CIImage 坐标，左下原点）处应用脱敏效果。
/// 强度公式与 iOS 版 RedactionCompositor 保持一致。
func applyEffect(effect: String, rect: CGRect, intensity: Double, to base: CIImage, personMask: CIImage? = nil) -> CIImage {
    let clamped = base.clampedToExtent()
    let patch: CIImage
    switch effect {
    case "blur":
        let sigma = max(rect.height, rect.width) * (0.02 + 0.18 * intensity)
        patch = clamped.applyingGaussianBlur(sigma: sigma).cropped(to: rect)
    case "blackbox":
        patch = CIImage(color: .black).cropped(to: rect)
    default:
        let scale = max(max(rect.width, rect.height) / (24 - 18 * intensity), 3)
        patch = CIFilter(name: "CIPixellate", parameters: [
            kCIInputImageKey: clamped.cropped(to: rect),
            kCIInputScaleKey: scale,
            kCIInputCenterKey: CIVector(x: rect.midX, y: rect.midY),
        ])?.outputImage ?? clamped.cropped(to: rect)
    }
    if let personMask {
        let rectWhite = CIImage(color: .white).cropped(to: rect)
        let maskInRect = personMask.applyingFilter("CIMultiplyCompositing", parameters: [
            kCIInputBackgroundImageKey: rectWhite,
        ])
        if let blended = CIFilter(name: "CIBlendWithMask", parameters: [
            kCIInputImageKey: patch,
            kCIInputBackgroundImageKey: base,
            kCIInputMaskImageKey: maskInRect,
        ])?.outputImage {
            return blended
        }
    }
    return patch.composited(over: base)
}

/// 静态照片脱敏导出：加载图片（自动套用 EXIF 方向），
/// 按关键帧矩形应用效果，写出 PNG。
/// project: { path, crop?: {x,y,w,h}, tracks: [{ effect, intensity, keyframes: [{x,y,w,h}] }] }
func renderImage(project: [String: Any], output: String, personSegmentation: Bool) throws -> [String: Any] {
    guard let path = project["path"] as? String else { throw EngineError.badRequest("缺少 path") }
    let url = URL(fileURLWithPath: path)
    guard var image = CIImage(contentsOf: url, options: [.applyOrientationProperty: true]),
          image.extent.width > 1, image.extent.height > 1 else {
        throw EngineError.decodeFailed(path)
    }

    let W = image.extent.width
    let H = image.extent.height

    struct ImageMask {
        let effect: String
        let intensity: Double
        let rect: CGRect // 正立像素（左上原点）
    }
    var masks: [ImageMask] = []
    for t in project["tracks"] as? [[String: Any]] ?? [] {
        let kfs = t["keyframes"] as? [[String: Any]] ?? []
        guard let k = kfs.first else { continue }
        let rect = CGRect(x: jsonNumber(k["x"]) ?? 0, y: jsonNumber(k["y"]) ?? 0,
                          width: jsonNumber(k["w"]) ?? 0, height: jsonNumber(k["h"]) ?? 0)
        guard rect.width > 1, rect.height > 1 else { continue }
        masks.append(ImageMask(
            effect: t["effect"] as? String ?? "pixelate",
            intensity: min(max(jsonNumber(t["intensity"]) ?? 0.5, 0), 1),
            rect: rect))
    }

    var personMask: CIImage?
    if personSegmentation, !masks.isEmpty {
        let request = VNGeneratePersonSegmentationRequest()
        request.qualityLevel = .accurate
        request.outputPixelFormat = kCVPixelFormatType_OneComponent8
        let handler = VNImageRequestHandler(ciImage: image, options: [:])
        if let _ = try? handler.perform([request]),
           let observation = request.results?.first as? VNPixelBufferObservation {
            var mask = CIImage(cvPixelBuffer: observation.pixelBuffer)
            let scaleX = W / mask.extent.width
            let scaleY = H / mask.extent.height
            mask = mask.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
            mask = mask.applyingFilter("CIMorphologyMaximum", parameters: [kCIInputRadiusKey: 3])
            personMask = mask.cropped(to: image.extent)
        }
    }

    for mask in masks {
        let ciRect = CGRect(
            x: mask.rect.minX, y: H - mask.rect.minY - mask.rect.height,
            width: mask.rect.width, height: mask.rect.height
        ).intersection(CGRect(x: 0, y: 0, width: W, height: H)).integral
        guard ciRect.width > 1, ciRect.height > 1 else { continue }
        image = applyEffect(effect: mask.effect, rect: ciRect, intensity: mask.intensity,
                            to: image, personMask: personMask)
    }

    if let crop = project["crop"] as? [String: Any] {
        let rect = CGRect(x: jsonNumber(crop["x"]) ?? 0, y: jsonNumber(crop["y"]) ?? 0,
                          width: jsonNumber(crop["w"]) ?? 0, height: jsonNumber(crop["h"]) ?? 0)
        let ciCrop = CGRect(
            x: rect.minX, y: H - rect.minY - rect.height,
            width: rect.width, height: rect.height
        ).intersection(CGRect(x: 0, y: 0, width: W, height: H)).integral
        if ciCrop.width > 1, ciCrop.height > 1 {
            image = image.cropped(to: ciCrop)
        }
    }

    let outputURL = URL(fileURLWithPath: output)
    try? FileManager.default.removeItem(at: outputURL)
    let context = CIContext(options: [.cacheIntermediates: false])
    try context.writePNGRepresentation(
        of: image, to: outputURL, format: .RGBA8,
        colorSpace: CGColorSpaceCreateDeviceRGB())
    FileHandle.standardError.write(Data(
        "[render-image] path=\(path) masks=\(masks.count) output=\(output)\n".utf8))
    return ["ok": true, "output": output]
}
