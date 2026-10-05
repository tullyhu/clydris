/** 识别与追踪设置，持久化到 localStorage，与 iOS 版默认值保持一致 */

export type Precision = 0 | 1 | 2; // 0=快速 1=均衡 2=精确

export interface FusionParams {
  iou: number;
  wNormal: number;
  wDrift: number;
  wLow: number;
}

export const FUSION_DEFAULTS: FusionParams = {
  iou: 0.5,
  wNormal: 0.3,
  wDrift: 0.7,
  wLow: 0.2,
};

function num(key: string, fallback: number): number {
  const v = localStorage.getItem(key);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function getPrecision(): Precision {
  const v = num("vr.precision", 1);
  return (v === 0 || v === 2 ? v : 1) as Precision;
}

export function setPrecision(p: Precision) {
  localStorage.setItem("vr.precision", String(p));
}

/** 人脸扫描采样间隔：快速 0.5s，均衡/精确 0.25s */
export function scanInterval(): number {
  return getPrecision() === 0 ? 0.5 : 0.25;
}

/** 精确模式下追踪时做周期性人脸重锚定 */
export function faceReanchor(): boolean {
  return getPrecision() === 2;
}

export function getFusionParams(): FusionParams {
  return {
    iou: num("vr.fusionIou", FUSION_DEFAULTS.iou),
    wNormal: num("vr.fusionWNormal", FUSION_DEFAULTS.wNormal),
    wDrift: num("vr.fusionWDrift", FUSION_DEFAULTS.wDrift),
    wLow: num("vr.fusionWLow", FUSION_DEFAULTS.wLow),
  };
}

export function setFusionParam(key: keyof FusionParams, value: number) {
  const map: Record<keyof FusionParams, string> = {
    iou: "vr.fusionIou",
    wNormal: "vr.fusionWNormal",
    wDrift: "vr.fusionWDrift",
    wLow: "vr.fusionWLow",
  };
  localStorage.setItem(map[key], String(value));
}
