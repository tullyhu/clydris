import Foundation
import CoreGraphics
import CoreImage

/// 颜色追踪器：色相直方图匹配（低饱和度目标回退到 RGB 距离），
/// 移植自 iOS 版 TrackingEngine，与 Vision 模型追踪做逐帧融合。
/// 内部状态使用 Vision 归一化坐标（与输入图像方向无关，天然免疫缩放），
/// 对外输入/输出均为正立像素坐标。
final class ColorTracker {
    private struct ColorTarget {
        var hue: CGFloat?
        var rgb: (CGFloat, CGFloat, CGFloat)
    }

    private let analysisDimension: CGFloat = 288
    private let maxExtrapolatedFrames = 12
    private let ciContext = CIContext(options: [.cacheIntermediates: false])

    private var target: ColorTarget?
    private var lastRectVN: CGRect
    private let seedVN: CGRect
    private var velocity: CGSize = .zero
    private var extrapolated = 0
    private(set) var lost = false
    private(set) var reliable = false
    private(set) var lastDetected = false

    init(seedUprightPixels: CGRect, upright: CGSize, naturalSize: CGSize, transform: CGAffineTransform) {
        let normalized = CGRect(
            x: seedUprightPixels.minX / upright.width,
            y: seedUprightPixels.minY / upright.height,
            width: seedUprightPixels.width / upright.width,
            height: seedUprightPixels.height / upright.height
        ).clampedToUnit()
        let vn = Geometry.uprightNormalizedToVision(
            normalized, naturalSize: naturalSize, transform: transform)
        lastRectVN = vn
        seedVN = vn
    }

    /// 融合后用最终位置校正内部状态（对应 iOS advanceFused 末尾的同步逻辑）
    func sync(toUprightPixels rect: CGRect, upright: CGSize,
              naturalSize: CGSize, transform: CGAffineTransform) {
        guard !lost else { return }
        let normalized = CGRect(
            x: rect.minX / upright.width,
            y: rect.minY / upright.height,
            width: rect.width / upright.width,
            height: rect.height / upright.height
        ).clampedToUnit()
        lastRectVN = Geometry.uprightNormalizedToVision(
            normalized, naturalSize: naturalSize, transform: transform)
    }

    /// 返回正立像素坐标
    @discardableResult
    func advance(on image: CIImage, upright: CGSize,
                 naturalSize: CGSize, transform: CGAffineTransform) -> CGRect {
        func currentUpright() -> CGRect {
            let n = Geometry.visionToUprightNormalized(
                lastRectVN, naturalSize: naturalSize, transform: transform)
            return CGRect(x: n.minX * upright.width, y: n.minY * upright.height,
                          width: n.width * upright.width, height: n.height * upright.height)
        }
        lastDetected = false
        guard let bitmap = analysisBitmap(image) else { return currentUpright() }
        let w = CGFloat(bitmap.width), h = CGFloat(bitmap.height)
        let rectPx = CGRect(
            x: lastRectVN.minX * w,
            y: (1 - lastRectVN.maxY) * h,
            width: lastRectVN.width * w,
            height: lastRectVN.height * h
        ).integral.intersection(CGRect(x: 0, y: 0, width: w, height: h))
        guard rectPx.width > 1, rectPx.height > 1 else {
            lost = true
            return currentUpright()
        }

        if target == nil {
            target = detectColorTarget(bitmap: bitmap, rect: rectPx)
            reliable = target?.hue != nil
            lastDetected = true
            return currentUpright()
        }
        guard let target else { return currentUpright() }

        let window = rectPx
            .insetBy(dx: -rectPx.width * 0.75, dy: -rectPx.height * 0.75)
            .integral
            .intersection(CGRect(x: 0, y: 0, width: w, height: h))

        var minX = Int.max, minY = Int.max, maxX = Int.min, maxY = Int.min, count = 0
        let pixels = bitmap.pixels
        let strideW = bitmap.width
        for y in Int(window.minY)..<Int(window.maxY) {
            for x in Int(window.minX)..<Int(window.maxX) {
                let o = (y * strideW + x) * 4
                let r = CGFloat(pixels[o]) / 255
                let g = CGFloat(pixels[o + 1]) / 255
                let b = CGFloat(pixels[o + 2]) / 255
                if colorMatches(target, r: r, g: g, b: b) {
                    count += 1
                    if x < minX { minX = x }
                    if x > maxX { maxX = x }
                    if y < minY { minY = y }
                    if y > maxY { maxY = y }
                }
            }
        }

        let minCount = max(6, Int(rectPx.width * rectPx.height) / 20)
        if count >= minCount {
            var detected = CGRect(
                x: CGFloat(minX), y: CGFloat(minY),
                width: CGFloat(maxX - minX + 1), height: CGFloat(maxY - minY + 1))
            let tooWide = detected.width > rectPx.width * 3 || detected.height > rectPx.height * 3
            if !tooWide {
                detected = detected.insetBy(dx: -detected.width * 0.08, dy: -detected.height * 0.08)
                let blended = CGRect(
                    x: detected.minX * 0.6 + rectPx.minX * 0.4,
                    y: detected.minY * 0.6 + rectPx.minY * 0.4,
                    width: detected.width * 0.6 + rectPx.width * 0.4,
                    height: detected.height * 0.6 + rectPx.height * 0.4
                )
                // 目标出画后颜色匹配容易锁定背景杂色，框会逐帧复利膨胀直至充满全屏；
                // 这里以初始框为基准做绝对上限，超出即视为跟丢，转入外推/丢失流程。
                let seed = seedVN
                let seedPx = (seed.width > 0 && seed.height > 0)
                    ? CGRect(x: seed.minX * w, y: (1 - seed.maxY) * h,
                             width: seed.width * w, height: seed.height * h)
                    : rectPx
                let exceedsSeed = blended.width > seedPx.width * 3
                    || blended.height > seedPx.height * 3
                if !exceedsSeed {
                    let newVN = CGRect(
                        x: blended.minX / w,
                        y: 1 - blended.maxY / h,
                        width: blended.width / w,
                        height: blended.height / h
                    )
                    velocity = CGSize(
                        width: newVN.minX - lastRectVN.minX,
                        height: newVN.minY - lastRectVN.minY)
                    lastRectVN = newVN
                    extrapolated = 0
                    lastDetected = true
                    let n = Geometry.visionToUprightNormalized(
                        newVN, naturalSize: naturalSize, transform: transform)
                    return CGRect(x: n.minX * upright.width, y: n.minY * upright.height,
                                  width: n.width * upright.width, height: n.height * upright.height)
                }
            }
        }

        if extrapolated < maxExtrapolatedFrames {
            lastRectVN = lastRectVN
                .offsetBy(dx: velocity.width, dy: velocity.height)
                .clampedToUnit()
            extrapolated += 1
        } else {
            lost = true
        }
        return currentUpright()
    }

    private func analysisBitmap(_ image: CIImage) -> (pixels: [UInt8], width: Int, height: Int)? {
        let extent = image.extent
        guard extent.width > 0, extent.height > 0 else { return nil }
        let scale = min(1, analysisDimension / max(extent.width, extent.height))
        let scaled = scale < 1
            ? image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            : image
        let w = Int(scaled.extent.width.rounded())
        let h = Int(scaled.extent.height.rounded())
        guard w > 0, h > 0 else { return nil }
        var pixels = [UInt8](repeating: 0, count: w * h * 4)
        ciContext.render(
            scaled, toBitmap: &pixels, rowBytes: w * 4, bounds: scaled.extent,
            format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
        return (pixels, w, h)
    }

    private func detectColorTarget(bitmap: (pixels: [UInt8], width: Int, height: Int), rect: CGRect) -> ColorTarget {
        var hist = [Int](repeating: 0, count: 36)
        var sumR: CGFloat = 0, sumG: CGFloat = 0, sumB: CGFloat = 0
        var count = 0, satCount = 0
        for y in Int(rect.minY)..<Int(rect.maxY) {
            for x in Int(rect.minX)..<Int(rect.maxX) {
                let o = (y * bitmap.width + x) * 4
                let r = CGFloat(bitmap.pixels[o]) / 255
                let g = CGFloat(bitmap.pixels[o + 1]) / 255
                let b = CGFloat(bitmap.pixels[o + 2]) / 255
                sumR += r; sumG += g; sumB += b
                count += 1
                let hsv = Self.rgbToHSV(r, g, b)
                if hsv.s > 0.35 && hsv.v > 0.25 {
                    hist[Int(hsv.h * 36) % 36] += 1
                    satCount += 1
                }
            }
        }
        let n = CGFloat(max(count, 1))
        let avg = (sumR / n, sumG / n, sumB / n)
        if satCount >= max(8, count / 10),
           let peak = hist.indices.max(by: { hist[$0] < hist[$1] }) {
            return ColorTarget(hue: (CGFloat(peak) + 0.5) / 36, rgb: avg)
        }
        return ColorTarget(hue: nil, rgb: avg)
    }

    private func colorMatches(_ target: ColorTarget, r: CGFloat, g: CGFloat, b: CGFloat) -> Bool {
        if let hue = target.hue {
            let hsv = Self.rgbToHSV(r, g, b)
            guard hsv.s > 0.3, hsv.v > 0.2 else { return false }
            let d = abs(hsv.h - hue)
            return min(d, 1 - d) < 0.06
        }
        let dr = r - target.rgb.0, dg = g - target.rgb.1, db = b - target.rgb.2
        return (dr * dr + dg * dg + db * db).squareRoot() / 1.732 < 0.18
    }

    private static func rgbToHSV(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat) -> (h: CGFloat, s: CGFloat, v: CGFloat) {
        let maxC = max(r, g, b), minC = min(r, g, b)
        let delta = maxC - minC
        let v = maxC
        let s = maxC > 0 ? delta / maxC : 0
        var h: CGFloat = 0
        if delta > 0 {
            if maxC == r {
                h = ((g - b) / delta).truncatingRemainder(dividingBy: 6)
            } else if maxC == g {
                h = (b - r) / delta + 2
            } else {
                h = (r - g) / delta + 4
            }
            h /= 6
            if h < 0 { h += 1 }
        }
        return (h, s, v)
    }
}
