import Foundation
import AppKit
import CoreText

// 只生成独立设计资产，不读取/修改小程序或微信后台。
let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
let font = CTFontCreateWithName("PingFangSC-Semibold" as CFString, 100, nil)
let resolvedFont = CTFontCopyPostScriptName(font) as String
guard resolvedFont == "PingFangSC-Semibold" else { fatalError("字体不匹配: \(resolvedFont)") }
let text = "宝松"
let characters = Array(text.utf16)
var glyphs = [CGGlyph](repeating: 0, count: characters.count)
guard CTFontGetGlyphsForCharacters(font, characters, &glyphs, characters.count), glyphs.allSatisfy({ $0 != 0 }) else {
    fatalError("缺少字形")
}
let word = CGMutablePath()
var advanceX: CGFloat = 0
var paths: [CGPath] = []
for glyph in glyphs {
    guard let path = CTFontCreatePathForGlyph(font, glyph, nil) else { fatalError("无轮廓字形") }
    var transform = CGAffineTransform(translationX: advanceX, y: 0)
    let positioned = path.copy(using: &transform)!
    paths.append(positioned)
    word.addPath(positioned)
    var g = glyph
    var advance = CGSize.zero
    CTFontGetAdvancesForGlyphs(font, .horizontal, &g, &advance, 1)
    advanceX += advance.width
}
let bounds = word.boundingBoxOfPath
let scale = 1024 * 0.58 / bounds.width
let tx = 512 - bounds.midX * scale
let ty = 512 - bounds.midY * scale
let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
let green = CGColor(colorSpace: colorSpace, components: [23/255, 62/255, 56/255, 1])!
let gold = CGColor(colorSpace: colorSpace, components: [216/255, 179/255, 122/255, 1])!

func number(_ value: CGFloat) -> String { String(format: "%.5f", Double(value)) }
func svgPath(_ path: CGPath) -> String {
    var commands: [String] = []
    path.applyWithBlock { pointer in
        let element = pointer.pointee, p = element.points
        switch element.type {
        case .moveToPoint: commands.append("M\(number(p[0].x)) \(number(p[0].y))")
        case .addLineToPoint: commands.append("L\(number(p[0].x)) \(number(p[0].y))")
        case .addQuadCurveToPoint: commands.append("Q\(number(p[0].x)) \(number(p[0].y)) \(number(p[1].x)) \(number(p[1].y))")
        case .addCurveToPoint: commands.append("C\(number(p[0].x)) \(number(p[0].y)) \(number(p[1].x)) \(number(p[1].y)) \(number(p[2].x)) \(number(p[2].y))")
        case .closeSubpath: commands.append("Z")
        @unknown default: fatalError("未知轮廓类型")
        }
    }
    return commands.joined(separator: " ")
}
let outlined = paths.enumerated().map { "  <path id=\"glyph-\($0.offset + 1)\" d=\"\(svgPath($0.element))\"/>" }.joined(separator: "\n")
let svg = """
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-labelledby="title desc">
  <title id="title">宝松启动图标</title>
  <desc id="desc">PingFang SC Semibold字形转轮廓。墨绿173E38、暖金D8B37A，字标宽度58%。</desc>
  <rect id="background" width="1024" height="1024" fill="#173E38"/>
  <g id="wordmark" fill="#D8B37A" transform="matrix(\(number(scale)) 0 0 -\(number(scale)) \(number(tx)) \(number(1024-ty)))">
\(outlined)
  </g>
</svg>
"""
try svg.write(to: output.appendingPathComponent("baosong-avatar.svg"), atomically: true, encoding: .utf8)

func context(_ width: Int, _ height: Int) -> CGContext {
    guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: width * 4, space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { fatalError("无法创建画布") }
    ctx.setAllowsAntialiasing(true)
    ctx.setShouldAntialias(true)
    return ctx
}
func savePNG(_ ctx: CGContext, _ name: String) throws {
    let image = ctx.makeImage()!
    let bitmap = NSBitmapImageRep(cgImage: image)
    guard let png = bitmap.representation(using: .png, properties: [:]) else { fatalError("PNG导出失败") }
    try png.write(to: output.appendingPathComponent(name))
}
func drawLogo(_ ctx: CGContext, _ box: CGRect, circle: Bool = false) {
    ctx.saveGState()
    if circle { ctx.addEllipse(in: box); ctx.clip() }
    ctx.setFillColor(green);ctx.fill(box)
    ctx.translateBy(x: box.minX, y: box.minY)
    ctx.scaleBy(x: box.width/1024, y: box.height/1024)
    ctx.translateBy(x: tx, y: ty);ctx.scaleBy(x: scale, y: scale)
    ctx.setFillColor(gold);ctx.addPath(word);ctx.fillPath()
    ctx.restoreGState()
}
for size in [48, 80, 144, 1024] {
    let ctx = context(size, size)
    drawLogo(ctx, CGRect(x: 0, y: 0, width: size, height: size))
    try savePNG(ctx, "baosong-avatar-\(size).png")
}
func drawLabel(_ ctx: CGContext, _ value: String, _ size: CGFloat, _ x: CGFloat, _ baseline: CGFloat, semibold: Bool = false) {
    let font = CTFontCreateWithName((semibold ? "PingFangSC-Semibold" : "PingFangSC-Regular") as CFString, size, nil)
    let attributes: [NSAttributedString.Key: Any] = [NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0.13, alpha: 1)]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: value, attributes: attributes))
    ctx.textMatrix = .identity;ctx.textPosition = CGPoint(x: x, y: baseline);CTLineDraw(line, ctx)
}
// 白底圆形预览与实际大小验证，不绘制微信控制的进度圈/绿点。
let preview = context(960, 650)
preview.setFillColor(CGColor(gray: 1, alpha: 1));preview.fill(CGRect(x: 0, y: 0, width: 960, height: 650))
drawLabel(preview, "宝松 · 墨绿暖金字标", 28, 52, 586, semibold: true)
drawLabel(preview, "圆形裁切预览", 17, 52, 546)
drawLogo(preview, CGRect(x: 110, y: 186, width: 300, height: 300), circle: true)
drawLabel(preview, "宝松工具箱", 27, 179, 126, semibold: true)
drawLabel(preview, "实际像素大小", 18, 528, 450, semibold: true)
for (size, x, y) in [(48, 540, 342), (80, 650, 326), (144, 790, 294)] {
    drawLogo(preview, CGRect(x: x, y: y, width: size, height: size), circle: true)
    drawLabel(preview, "\(size) px", 15, CGFloat(x), 259)
}
drawLabel(preview, "纯色底 · 无描边 · 无光效", 16, 528, 188)
drawLabel(preview, "字标宽度 58% · 文字已转轮廓", 16, 528, 153)
try savePNG(preview, "baosong-avatar-preview.png")

// 几何验收：轮廓完整包含在圆形裁切内，字标精确几何居中。
var matrix = CGAffineTransform(a: scale, b: 0, c: 0, d: scale, tx: tx, ty: ty)
let finalBounds = word.copy(using: &matrix)!.boundingBoxOfPath
for corner in [CGPoint(x: finalBounds.minX, y: finalBounds.minY), CGPoint(x: finalBounds.maxX, y: finalBounds.maxY),
               CGPoint(x: finalBounds.minX, y: finalBounds.maxY), CGPoint(x: finalBounds.maxX, y: finalBounds.minY)] {
    assert(hypot(corner.x-512, corner.y-512) < 512)
}
assert(abs(finalBounds.midX-512)<0.01 && abs(finalBounds.midY-512)<0.01)
assert(abs(finalBounds.width/1024-0.58)<0.0001)
print("字体: \(resolvedFont); 字标宽度: \(finalBounds.width); 高度: \(finalBounds.height); 圆形裁切/中心校验通过")
