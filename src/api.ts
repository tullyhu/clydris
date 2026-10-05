const BASE = "http://localhost:8765";

export interface ProbeResult {
  kind: "video" | "image";
  duration: number;
  fps: number;
  width: number;
  height: number;
  has_audio: boolean;
}

export interface RenderStatus {
  state: "idle" | "running" | "done" | "error";
  progress: number;
  phase: "tracking" | "encoding" | null;
  error: string | null;
  output: string | null;
}

export interface DetectBox {
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
  kind: "face";
}

export interface ScanKeyframe {
  frame: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScanTrack {
  keyframes: ScanKeyframe[];
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      detail = JSON.parse(text).detail ?? text;
    } catch {}
    throw new Error(`${path}: ${detail}`);
  }
  return res.json();
}

export const api = {
  health: async (): Promise<boolean> => {
    try {
      const res = await fetch(`${BASE}/health`);
      return res.ok;
    } catch {
      return false;
    }
  },
  probe: (path: string) => post<ProbeResult>("/probe", { path }),
  detect: (path: string, frame: number) =>
    post<{ boxes: DetectBox[] }>("/detect", { path, frame }),
  scan: (path: string, interval = 0.5) =>
    post<{ tracks: ScanTrack[] }>("/scan", { path, interval }),
  track: (
    path: string,
    keyframes: unknown[],
    fromFrame: number,
    toFrame: number,
    options?: {
      faceReanchor?: boolean;
      fusion?: { iou: number; wNormal: number; wDrift: number; wLow: number };
    }
  ) =>
    post<{ dense: Record<number, [number, number, number, number]> }>("/track", {
      path,
      keyframes,
      from_frame: fromFrame,
      to_frame: toFrame,
      face_reanchor: options?.faceReanchor ?? false,
      fusion: options?.fusion
        ? {
            iou: options.fusion.iou,
            w_normal: options.fusion.wNormal,
            w_drift: options.fusion.wDrift,
            w_low: options.fusion.wLow,
          }
        : undefined,
    }),
  render: (project: unknown, output: string, personSegmentation = false) =>
    post<{ job_id: string }>("/render", {
      project,
      output,
      person_segmentation: personSegmentation,
    }),
  renderImage: (project: unknown, output: string, personSegmentation = false) =>
    post<{ ok: boolean; output: string }>("/render/image", {
      project,
      output,
      person_segmentation: personSegmentation,
    }),
  renderStatus: (): Promise<RenderStatus> =>
    fetch(`${BASE}/render/status`).then((r) => r.json()),
  renderCancel: () => post<{ ok: boolean }>("/render/cancel", {}),
  saveProject: (path: string, data: unknown) =>
    post<{ ok: boolean }>("/project/save", { path, data }),
  loadProject: (path: string) =>
    post<{ version: number; clips: unknown[]; tracks: unknown[] }>(
      "/project/load",
      { path }
    ),
};
