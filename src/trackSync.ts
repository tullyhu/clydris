import { useStore } from "./store";
import { api } from "./api";
import { faceReanchor, getFusionParams } from "./settings";
import { t } from "./i18n";

export async function syncDirtyTracks(): Promise<boolean> {
  const s = useStore.getState();
  const dirty = s.tracks.filter((t) => {
    if (!t.dirty || t.fixed) return false;
    const clip = s.clips.find((c) => c.id === t.clipId);
    return clip?.kind !== "image";
  });
  if (dirty.length === 0) return true;
  const reanchor = faceReanchor();
  const fusion = getFusionParams();
  let i = 0;
  for (const tr of dirty) {
    i++;
    const clip = s.clips.find((c) => c.id === tr.clipId);
    if (!clip) {
      useStore.getState().updateTrack(tr.id, { dirty: false, dirtyFrom: null });
      continue;
    }
    const windowStart = Math.round((tr.tStart ?? clip.in) * clip.fps);
    const hasCoverage = Object.keys(tr.dense).length > 0;
    const fromFrame = hasCoverage
      ? (tr.dirtyFrom ?? windowStart)
      : windowStart;
    const endFrame = Math.round((tr.tEnd ?? clip.out) * clip.fps);
    useStore.getState().setBusy(t("trackingProgress", { i, n: dirty.length }));
    try {
      const { dense } = await api.track(clip.src, tr.keyframes, fromFrame, endFrame, {
        faceReanchor: reanchor,
        fusion,
      });
      useStore.getState().mergeDense(tr.id, dense);
      useStore.getState().updateTrack(tr.id, { dirty: false, dirtyFrom: null });
    } catch (e) {
      useStore.getState().setBusy(null);
      useStore
        .getState()
        .setSyncError(
          t("trackFailed", { err: e instanceof Error ? e.message : `${e}` })
        );
      return false;
    }
  }
  useStore.getState().setBusy(null);
  useStore.getState().setSyncError(null);
  return true;
}
