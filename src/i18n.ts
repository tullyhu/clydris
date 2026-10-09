/** 界面文案中英文支持，语言偏好持久化到 localStorage（vr.lang） */
import { useSyncExternalStore } from "react";

export type Lang = "zh" | "en";

const dict = {
  // ── 工具栏 ──
  importMedia: { zh: "导入媒体", en: "Import Media" },
  openProject: { zh: "打开项目", en: "Open Project" },
  openProjectHint: { zh: "打开 .vproj.json 项目文件", en: "Open a .vproj.json project file" },
  saveProject: { zh: "保存项目", en: "Save Project" },
  saveProjectHint: { zh: "保存为 .vproj.json 项目文件", en: "Save as a .vproj.json project file" },
  undo: { zh: "↩ 撤销", en: "↩ Undo" },
  undoHint: { zh: "撤销 (⌘Z)", en: "Undo (⌘Z)" },
  redo: { zh: "↪ 重做", en: "↪ Redo" },
  redoHint: { zh: "重做 (⇧⌘Z)", en: "Redo (⇧⌘Z)" },
  crop: { zh: "裁切画面", en: "Crop" },
  clearCrop: { zh: "清除裁切", en: "Clear Crop" },
  exportPng: { zh: "导出 PNG", en: "Export PNG" },
  exportMp4: { zh: "导出 MP4", en: "Export MP4" },
  exportingPct: { zh: "导出中 {pct}%", en: "Exporting {pct}%" },
  cancelExport: { zh: "取消导出", en: "Cancel Export" },
  cancelExportHint: { zh: "终止当前导出任务", en: "Abort the current export" },
  engineDisconnected: { zh: "引擎未连接（自动重试中）…", en: "Engine disconnected (retrying)…" },
  settings: { zh: "设置", en: "Settings" },
  aboutHint: { zh: "关于与开源许可", en: "About & Open Source Licenses" },

  // ── 遮罩面板 ──
  maskPanelTitle: { zh: "遮挡框 ({n})", en: "Masks ({n})" },
  fixedMask: { zh: "固定遮罩", en: "Static Mask" },
  mask: { zh: "遮罩", en: "Mask" },
  effectPixelate: { zh: "马赛克", en: "Pixelate" },
  effectBlur: { zh: "高斯模糊", en: "Gaussian Blur" },
  effectBlackbox: { zh: "黑框", en: "Black Box" },
  appearAt: { zh: "出现(s)", en: "Start (s)" },
  disappearAt: { zh: "消失(s)", en: "End (s)" },
  intensity: { zh: "强度", en: "Intensity" },
  applyToAll: { zh: "应用到全部遮罩", en: "Apply to All Masks" },
  applyToAllHint: {
    zh: "把选中遮罩的效果和强度应用到当前片段的所有遮罩",
    en: "Apply the selected mask's effect and intensity to all masks in this clip",
  },
  helpSummary: { zh: "操作帮助", en: "Help" },
  helpHint1: {
    zh: "在画面空白处按住拖动 = 创建遮罩；Shift+拖动 = 固定遮罩（不跟踪）；点住框内部 = 拖动；点住边框 = 调整大小；双击框 = 在此时间结束。编辑不影响已跟踪内容，按播放键时才统一跟踪。滚轮/双指捏合 = 缩放画面，放大后开启「平移」可拖动画布。",
    en: "Drag on empty canvas = create mask; Shift+drag = static mask (no tracking); drag inside a box = move; drag edges = resize; double-click a box = end it at this time. Edits don't affect tracked content; tracking runs when you press play. Scroll/pinch = zoom; when zoomed in, enable “Pan” to drag the canvas.",
  },
  helpHint2: {
    zh: "「扫描人脸」= 自动识别视频或照片中的人脸并创建遮罩。圈选遮罩后，首次播放或导出时会自动向前、向后跟踪整个片段。导入照片时为单张编辑模式，导出 PNG。",
    en: "“Scan Faces” auto-detects faces in the video or photo and creates masks. After drawing a mask, it is tracked forward and backward across the clip on first playback or export. Photos use single-image mode and export as PNG.",
  },
  helpHint3: {
    zh: "空格 = 播放/暂停；I = 入点，O = 出点，S = 分割；Delete = 删除选中遮罩；←/→ = 逐帧（Shift = ±1s）；Esc = 退出裁切/取消选中；⌘Z = 撤销，⇧⌘Z = 重做。",
    en: "Space = play/pause; I = set in, O = set out, S = split; Delete = remove selected mask; ←/→ = frame step (Shift = ±1s); Esc = exit crop/deselect; ⌘Z = undo, ⇧⌘Z = redo.",
  },

  // ── 跟踪失败弹窗 ──
  trackingFailed: { zh: "跟踪失败", en: "Tracking Failed" },
  retry: { zh: "重试", en: "Retry" },
  ignore: { zh: "忽略", en: "Ignore" },

  // ── 设置 ──
  language: { zh: "语言", en: "Language" },
  personSegTitle: { zh: "导出时精确人像轮廓", en: "Precise person silhouette on export" },
  personSegHint: {
    zh: "开启后用 Apple 神经引擎生成贴合人形的遮罩边缘，导出时间明显增加",
    en: "Uses the Apple Neural Engine to produce person-fitting mask edges; export takes noticeably longer",
  },
  precisionTitle: { zh: "识别精度", en: "Detection Precision" },
  precisionHint: {
    zh: "快速：每 0.5s 采样；均衡：每 0.25s 采样；精确：采样更密且追踪时周期性重锚人脸，速度最慢",
    en: "Fast: sample every 0.5s; Balanced: every 0.25s; Accurate: denser sampling and periodic face re-anchoring while tracking (slowest)",
  },
  precisionFast: { zh: "快速", en: "Fast" },
  precisionBalanced: { zh: "均衡", en: "Balanced" },
  precisionAccurate: { zh: "精确", en: "Accurate" },
  fusionSummary: { zh: "高级：追踪融合参数", en: "Advanced: Tracking Fusion Parameters" },
  fusionHint: {
    zh: "模型追踪与颜色追踪逐帧融合的权重。颜色框与模型框重合度（IoU）低于阈值时按漂移权重融合；颜色目标不可靠（低饱和度）时按低置信权重融合。",
    en: "Per-frame fusion weights between model tracking and color tracking. When the color box's overlap (IoU) with the model box falls below the threshold, the drift weight is used; when the color target is unreliable (low saturation), the low-confidence weight is used.",
  },
  fusionIou: { zh: "IoU 阈值", en: "IoU Threshold" },
  fusionWNormal: { zh: "正常权重", en: "Normal Weight" },
  fusionWDrift: { zh: "漂移权重", en: "Drift Weight" },
  fusionWLow: { zh: "低置信权重", en: "Low-Confidence Weight" },
  resetDefaults: { zh: "恢复默认", en: "Reset Defaults" },
  done: { zh: "完成", en: "Done" },

  // ── 关于 ──
  aboutTitle: { zh: "关于与开源许可", en: "About & Open Source Licenses" },
  aboutTagline: { zh: "Clydris · 所有处理均在本地完成", en: "Clydris · All processing happens on-device" },
  viewPrivacy: { zh: "查看隐私政策", en: "View Privacy Policy" },
  close: { zh: "关闭", en: "Close" },

  // ── 通知弹窗 ──
  showInFinder: { zh: "在 Finder 中显示", en: "Show in Finder" },
  ok: { zh: "确定", en: "OK" },

  // ── 启动遮罩 ──
  engineStarting: { zh: "正在启动视频引擎…", en: "Starting video engine…" },
  engineWaited: { zh: "已等待 {s} 秒", en: "Elapsed: {s}s" },
  engineUsuallyFast: { zh: "，通常只需几秒，请稍候", en: ", usually takes just a few seconds" },
  engineSlowWarn: {
    zh: "启动时间异常偏长，请尝试退出软件后重新打开",
    en: "Startup is taking unusually long — try quitting and reopening the app",
  },

  // ── 导入/导出/项目通知 ──
  cannotImport: { zh: "无法导入", en: "Cannot Import" },
  photoSingleMode: {
    zh: "照片项目为单张模式，请先删除现有照片",
    en: "Photo projects are single-image; please delete the existing photo first",
  },
  photoNoMix: {
    zh: "照片不能与视频混合编辑，请先清空时间轴",
    en: "Photos can't be mixed with videos; please clear the timeline first",
  },
  onePhotoOnly: { zh: "一次只能导入一张照片", en: "Only one photo can be imported at a time" },
  importFailed: { zh: "导入失败", en: "Import Failed" },
  importFailedMsg: {
    zh: "无法导入 {name}：{err}。请确认引擎已构建（npm run engine）",
    en: "Cannot import {name}: {err}. Make sure the engine is built (npm run engine)",
  },
  exporting: { zh: "正在导出…", en: "Exporting…" },
  exportDone: { zh: "导出完成", en: "Export Complete" },
  exportFailed: { zh: "导出失败", en: "Export Failed" },
  exportInterrupted: { zh: "导出中断", en: "Export Interrupted" },
  engineConnLost: { zh: "引擎连接丢失，请重试", en: "Engine connection lost, please retry" },
  unknownError: { zh: "未知错误", en: "Unknown error" },
  engineNoResponse: {
    zh: "引擎未响应（已断开），看门狗会自动重启，请几秒后重试",
    en: "Engine not responding (disconnected); the watchdog will restart it — retry in a few seconds",
  },
  exportCancelled: { zh: "导出已取消", en: "Export Cancelled" },
  exportCancelledMsg: { zh: "导出任务已终止", en: "The export task was aborted" },
  projectSaved: { zh: "项目已保存", en: "Project Saved" },
  saveFailed: { zh: "保存失败", en: "Save Failed" },
  openFailed: { zh: "打开失败", en: "Open Failed" },
  unsupportedFormat: { zh: "项目文件格式不受支持", en: "Unsupported project file format" },
  allSourcesUnavailable: {
    zh: "所有源文件均不可用：{names}",
    en: "All source files are unavailable: {names}",
  },
  partialMissing: { zh: "部分片段缺失", en: "Some Clips Missing" },
  missingSourcesMsg: {
    zh: "以下源视频不可用，已从项目中移除：{names}",
    en: "The following source videos are unavailable and were removed from the project: {names}",
  },
  filterMedia: { zh: "媒体", en: "Media" },
  filterVideo: { zh: "视频", en: "Videos" },
  filterPhoto: { zh: "照片", en: "Photos" },
  filterProject: { zh: "Clydris 项目", en: "Clydris Project" },

  // ── 预览播放器 ──
  detectingFaces: { zh: "正在识别人脸…", en: "Detecting faces…" },
  facesAlreadyMasked: { zh: "检测到的人脸已有遮罩", en: "Detected faces are already masked" },
  noFaceInPhoto: { zh: "照片中没有检测到人脸", en: "No faces detected in the photo" },
  noFaceInVideo: { zh: "整个视频中没有检测到人脸", en: "No faces detected in the video" },
  createdMasks: { zh: "已创建 {n} 个人脸遮罩", en: "Created {n} face mask(s)" },
  createdMasksTrack: {
    zh: "已创建 {n} 个人脸遮罩，播放时自动跟踪",
    en: "Created {n} face mask(s); tracking runs on playback",
  },
  detectFailed: { zh: "识别失败: {err}", en: "Detection failed: {err}" },
  scanFailed: { zh: "扫描失败: {err}", en: "Scan failed: {err}" },
  scanningFaces: { zh: "正在扫描全片人脸…", en: "Scanning video for faces…" },
  emptyPreview: { zh: "导入视频或照片开始编辑", en: "Import a video or photo to start editing" },
  trackingBusySub: { zh: "跟踪完成前无法播放预览", en: "Preview unavailable until tracking finishes" },
  reverse: { zh: "倒放", en: "Reverse" },
  play: { zh: "播放", en: "Play" },
  stopHint: { zh: "停止并回到开头", en: "Stop and return to start" },
  scanFaces: { zh: "扫描人脸", en: "Scan Faces" },
  detecting: { zh: "识别中…", en: "Detecting…" },
  scanFacesHintImage: {
    zh: "识别照片中的人脸并创建固定遮罩",
    en: "Detect faces in the photo and create static masks",
  },
  scanFacesHintVideo: {
    zh: "扫描整个视频，自动识别人脸并创建跟踪遮罩",
    en: "Scan the whole video, auto-detect faces and create tracked masks",
  },
  zoomOut: { zh: "缩小", en: "Zoom out" },
  zoomInHint: { zh: "放大（也可在画面上滚轮/双指捏合）", en: "Zoom in (or scroll/pinch on the canvas)" },
  panModeHint: { zh: "平移模式：拖动移动画布（Esc 退出）", en: "Pan mode: drag to move the canvas (Esc to exit)" },
  pan: { zh: "✋ 平移", en: "✋ Pan" },
  resetZoom: { zh: "重置缩放", en: "Reset zoom" },
  cropConfirm: { zh: "确定裁切", en: "Apply Crop" },
  cancel: { zh: "取消", en: "Cancel" },

  // ── 时间轴 ──
  trimInHint: { zh: "拖动裁剪入点", en: "Drag to trim the in point" },
  trimOutHint: { zh: "拖动裁剪出点", en: "Drag to trim the out point" },
  moveBack: { zh: "前移", en: "Move Earlier" },
  moveForward: { zh: "后移", en: "Move Later" },
  delete: { zh: "删除", en: "Delete" },
  deleteClipConfirm: {
    zh: "删除{kind} {name}？其上的遮罩也会一并删除",
    en: "Delete {kind} {name}? Its masks will also be deleted",
  },
  kindPhoto: { zh: "照片", en: "photo" },
  kindClip: { zh: "片段", en: "clip" },
  inLabel: { zh: "入", en: "In" },
  outLabel: { zh: "出", en: "Out" },
  speedLabel: { zh: "速度", en: "Speed" },
  setIn: { zh: "入点⌖", en: "In ⌖" },
  setInHint: { zh: "把入点设为当前播放位置 (I)", en: "Set in point to playhead (I)" },
  setOut: { zh: "出点⌖", en: "Out ⌖" },
  setOutHint: { zh: "把出点设为当前播放位置 (O)", en: "Set out point to playhead (O)" },
  split: { zh: "分割✂", en: "Split ✂" },
  splitHint: { zh: "在播放头处分割 (S)", en: "Split at playhead (S)" },
  timelineEmpty: { zh: "时间轴为空 — 点击“导入媒体”", en: "Timeline empty — click “Import Media”" },
  maskLanesHint: { zh: "遮罩时间段：点击定位", en: "Mask time ranges: click to jump" },
  playheadHintImage: { zh: "按住拖动 = 移动播放头", en: "Drag = move playhead" },
  playheadHintVideo: {
    zh: "按住拖动 = 移动播放头；Shift+拖动 = 选择加速区间",
    en: "Drag = move playhead; Shift+drag = select speed range",
  },
  rangeSelected: {
    zh: "已选 {a}s – {b}s（{d}s）",
    en: "Selected {a}s – {b}s ({d}s)",
  },
  clear: { zh: "清除", en: "Clear" },
  masksCount: { zh: "{n}框", en: "{n} masks" },

  // ── 跟踪 ──
  trackingProgress: { zh: "跟踪中… {i}/{n}", en: "Tracking… {i}/{n}" },
  trackFailed: { zh: "遮罩跟踪失败: {err}", en: "Mask tracking failed: {err}" },
} as const;

export type Key = keyof typeof dict;

function loadLang(): Lang {
  const saved = localStorage.getItem("vr.lang");
  if (saved === "zh" || saved === "en") return saved;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

let lang: Lang = loadLang();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return lang;
}

export function setLang(l: Lang) {
  lang = l;
  localStorage.setItem("vr.lang", l);
  listeners.forEach((f) => f());
}

export function t(key: Key, vars?: Record<string, string | number>): string {
  let s: string = dict[key][lang];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

/** React 组件中使用，语言切换时自动重渲染 */
export function useT() {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => lang
  );
  return t;
}
