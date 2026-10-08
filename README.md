# Clydris（macOS）

本地照片 / 视频脱敏工具：圈选区域或自动识别人脸，自动跟踪并应用马赛克 / 高斯模糊 / 黑框，视频导出 MP4、照片导出 PNG。所有处理均在设备本地完成，不上传任何数据。

## 功能

- 视频：多片段时间轴、裁剪入点/出点、分割、0.5x/2x 变速与区间变速、画面裁切
- 照片：单张编辑（固定遮罩 + 人脸识别），导出 PNG
- 遮罩：马赛克 / 高斯模糊 / 黑框，每遮罩强度可调，出现/消失时间窗口
- 人脸识别：全片扫描自动建轨，可选识别精度（快速 / 均衡 / 精确）
- 目标跟踪：Vision 模型追踪 + 颜色追踪逐帧融合，支持多关键帧分段双向追踪、漂移纠正与出画保护
- 编辑器：画布缩放/平移、时间轴多泳道遮罩可视化、撤销/重做、项目文件（.vproj.json）
- 导出可选「精确人像轮廓」（VNGeneratePersonSegmentationRequest）

## 架构

- **前端**：Tauri 2 + React（`src/`）
- **原生引擎**：SwiftPM 可执行程序（`native-engine/`），仅使用 Apple 系统框架：
  - 人脸检测：Vision `DetectFaceRectanglesRequest`
  - 目标跟踪：Vision `TrackObjectRequest` 与颜色直方图追踪融合（含速度外推、反向跟踪、人脸重锚定）
  - 渲染：CoreImage（`CIPixellate` / 模糊 / 黑框）+ `VNGeneratePersonSegmentationRequest` 人像分割
  - 导出：AVFoundation（视频）/ CoreImage（照片 PNG）
- 前端与引擎通过 127.0.0.1 回环 HTTP（端口 8765）通信，引擎随 App 打包（Tauri externalBin）

不包含任何第三方 ML 模型。算法与 Clydris iOS 版保持一致（各自维护）。

## 构建

要求：macOS 15+，Xcode（Swift 6 工具链），Rust，Node.js。

```bash
npm install
npm run engine        # 构建原生引擎并复制到 src-tauri/binaries/
npm run tauri dev     # 开发模式
npm run tauri build   # 打包 Clydris dmg（Apple Silicon）
```

引擎也可单独调试：`npm run engine:dev`（监听 127.0.0.1:8765）。

## 隐私政策

`privacy/` 为隐私政策静态页（Cloudflare Workers 部署）。

## 许可

本项目以 [MIT](LICENSE) 协议开源。第三方组件许可声明见
`licenses/THIRD-PARTY-LICENSES.txt`（应用内「ⓘ 关于与开源许可」中也可查看）。
