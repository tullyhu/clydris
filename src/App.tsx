import { useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir, openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useStore, uid, locate } from "./store";
import { api } from "./api";
import { syncDirtyTracks } from "./trackSync";
import {
  getPrecision,
  setPrecision,
  getFusionParams,
  setFusionParam,
  FUSION_DEFAULTS,
  type Precision,
  type FusionParams,
} from "./settings";
import { useT, getLang, setLang, type Lang } from "./i18n";
import type { Clip, Track } from "./types";
import licensesText from "../licenses/THIRD-PARTY-LICENSES.txt?raw";
import PreviewPlayer from "./components/PreviewPlayer";
import Timeline from "./components/Timeline";
import NumberField from "./components/NumberField";
import "./App.css";

function App() {
  const t = useT();
  const clips = useStore((s) => s.clips);
  const tracks = useStore((s) => s.tracks);
  const tool = useStore((s) => s.tool);
  const currentTime = useStore((s) => s.currentTime);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const sidecarReady = useStore((s) => s.sidecarReady);
  const busy = useStore((s) => s.busy);
  const syncError = useStore((s) => s.syncError);
  const [renderPct, setRenderPct] = useState<number | null>(null);
  const renderPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [notice, setNotice] = useState<{
    title: string;
    msg: string;
    path?: string;
  } | null>(null);
  const [showLicenses, setShowLicenses] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [personSegmentation, setPersonSegmentation] = useState(
    () => localStorage.getItem("vr.personSegmentation") === "1"
  );
  const [precision, setPrecisionState] = useState<Precision>(getPrecision);
  const [fusion, setFusion] = useState<FusionParams>(getFusionParams);
  const [startupElapsed, setStartupElapsed] = useState(0);

  useEffect(() => {
    if (sidecarReady) return;
    const t0 = Date.now();
    setStartupElapsed(0);
    const t = setInterval(
      () => setStartupElapsed(Math.floor((Date.now() - t0) / 1000)),
      500
    );
    return () => clearInterval(t);
  }, [sidecarReady]);

  useEffect(() => {
    const check = async () => {
      const ok = await api.health();
      useStore.getState().setSidecarReady(ok);
    };
    check();
    const timer = setInterval(check, 3000);
    return () => clearInterval(timer);
  }, []);

  const VIDEO_EXTS = ["mp4", "mov", "mkv", "webm", "m4v"];
  const IMAGE_EXTS = ["jpg", "jpeg", "png", "heic", "heif", "webp", "tiff", "tif", "bmp"];

  const addFiles = async (paths: string[]) => {
    const existing = useStore.getState().clips;
    const hasImage = existing.some((c) => c.kind === "image");
    const images = paths.filter((p) =>
      IMAGE_EXTS.includes(p.split(".").pop()?.toLowerCase() ?? "")
    );
    if (hasImage && paths.length) {
      setNotice({ title: t("cannotImport"), msg: t("photoSingleMode") });
      return;
    }
    if (images.length && existing.length) {
      setNotice({ title: t("cannotImport"), msg: t("photoNoMix") });
      return;
    }
    if (images.length > 1) {
      setNotice({ title: t("cannotImport"), msg: t("onePhotoOnly") });
      return;
    }
    if (paths.length) useStore.getState().pushHistory();
    for (const p of paths) {
      try {
        const meta = await api.probe(p);
        const clip: Clip = {
          id: uid(),
          src: p,
          kind: meta.kind ?? "video",
          duration: meta.duration,
          fps: meta.fps,
          width: meta.width,
          height: meta.height,
          hasAudio: meta.has_audio,
          in: 0,
          out: meta.duration,
          speed: 1,
          crop: null,
        };
        useStore.getState().addClip(clip);
      } catch (e) {
        setNotice({
          title: t("importFailed"),
          msg: t("importFailedMsg", {
            name: p.split("/").pop() ?? p,
            err: e instanceof Error ? e.message : `${e}`,
          }),
        });
      }
    }
  };

  useEffect(() => {
    const unlisten = getCurrentWebviewWindow().onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        const paths = event.payload.paths.filter((p) =>
          [...VIDEO_EXTS, ...IMAGE_EXTS].includes(p.split(".").pop()?.toLowerCase() ?? "")
        );
        if (paths.length) addFiles(paths).catch(() => {});
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const importVideo = async () => {
    const paths = await open({
      multiple: true,
      filters: [
        { name: t("filterMedia"), extensions: [...VIDEO_EXTS, ...IMAGE_EXTS] },
        { name: t("filterVideo"), extensions: VIDEO_EXTS },
        { name: t("filterPhoto"), extensions: IMAGE_EXTS },
      ],
    });
    if (!paths) return;
    await addFiles(Array.isArray(paths) ? paths : [paths]).catch(() => {});
  };

  const exportImage = async () => {
    const s = useStore.getState();
    const clip = s.clips[0];
    if (!clip || clip.kind !== "image" || renderPct !== null) return;
    const output = await save({
      defaultPath: "redacted.png",
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (!output) return;
    const project = {
      path: clip.src,
      crop: clip.crop,
      tracks: s.tracks
        .filter((t) => t.clipId === clip.id)
        .map((t) => ({
          effect: t.effect,
          intensity: t.intensity,
          keyframes: t.keyframes,
        })),
    };
    s.setBusy(t("exporting"));
    try {
      await api.renderImage(project, output, personSegmentation);
      s.setBusy(null);
      setNotice({ title: t("exportDone"), msg: output, path: output });
    } catch (e) {
      s.setBusy(null);
      setNotice({
        title: t("exportFailed"),
        msg: `${e instanceof Error ? e.message : e}`,
      });
    }
  };

  const exportVideo = async () => {
    const s = useStore.getState();
    if (s.clips.length === 0 || renderPct !== null) return;
    if (!(await syncDirtyTracks())) return;
    const output = await save({
      defaultPath: "output.mp4",
      filters: [{ name: "MP4", extensions: ["mp4"] }],
    });
    if (!output) return;
    const project = {
      clips: s.clips.map((c) => ({
        id: c.id,
        src: c.src,
        in: c.in,
        out: c.out,
        speed: c.speed,
        fps: c.fps,
        width: c.width,
        height: c.height,
        has_audio: c.hasAudio,
        crop: c.crop,
      })),
      tracks: s.tracks.map((t) => ({
        clipId: t.clipId,
        effect: t.effect,
        intensity: t.intensity,
        keyframes: t.keyframes,
        dense: t.dense,
        tStart: t.tStart,
        tEnd: t.tEnd,
      })),
    };
    s.setBusy(t("exporting"));
    setRenderPct(0);
    try {
      await api.render(project, output, personSegmentation);
      const stopPoll = () => {
        if (renderPollRef.current !== null) {
          clearInterval(renderPollRef.current);
          renderPollRef.current = null;
        }
      };
      const poll = setInterval(async () => {
        let st;
        try {
          st = await api.renderStatus();
        } catch {
          stopPoll();
          setRenderPct(null);
          s.setBusy(null);
          setNotice({ title: t("exportInterrupted"), msg: t("engineConnLost") });
          return;
        }
        setRenderPct(Math.round(st.progress * 100));
        if (st.state === "running") {
          s.setBusy(t("exporting"));
        } else if (st.state === "idle") {
          stopPoll();
          setRenderPct(null);
          s.setBusy(null);
        } else if (st.state === "done") {
          stopPoll();
          setRenderPct(null);
          s.setBusy(null);
          setNotice({
            title: t("exportDone"),
            msg: st.output ?? output,
            path: st.output ?? output,
          });
        } else if (st.state === "error") {
          stopPoll();
          setRenderPct(null);
          s.setBusy(null);
          setNotice({ title: t("exportFailed"), msg: st.error ?? t("unknownError") });
        }
      }, 500);
      renderPollRef.current = poll;
    } catch (e) {
      const msg =
        e instanceof TypeError
          ? t("engineNoResponse")
          : `${e}`;
      s.setBusy(null);
      setRenderPct(null);
      setNotice({ title: t("exportFailed"), msg });
    }
  };

  const cancelExport = async () => {
    try {
      await api.renderCancel();
    } catch {}
    if (renderPollRef.current !== null) {
      clearInterval(renderPollRef.current);
      renderPollRef.current = null;
    }
    setRenderPct(null);
    useStore.getState().setBusy(null);
    setNotice({ title: t("exportCancelled"), msg: t("exportCancelledMsg") });
  };

  const setTrackWindow = (t: Track, which: "start" | "end", raw: number | null) => {
    const s = useStore.getState();
    const clip = s.clips.find((c) => c.id === t.clipId);
    if (!clip) return;
    const v =
      raw === null ? null : Math.max(clip.in, Math.min(clip.out, raw));
    s.pushHistory();
    s.updateTrack(t.id, which === "start" ? { tStart: v } : { tEnd: v });
    const updated = useStore.getState().tracks.find((x) => x.id === t.id)!;
    if (updated.fixed) return;
    const sSec = updated.tStart ?? clip.in;
    const eSec = updated.tEnd ?? clip.out;
    if (eSec <= sSec) return;
    const f0 = Math.round(sSec * clip.fps);
    const f1 = Math.round(eSec * clip.fps);
    const covered = Object.keys(updated.dense).some(
      (f) => +f >= f0 && +f <= f1
    );
    if (!covered) s.markDirty(t.id, f0);
  };

  const saveProject = async () => {
    const s = useStore.getState();
    if (s.clips.length === 0) return;
    const path = await save({
      defaultPath: "project.vproj.json",
      filters: [{ name: t("filterProject"), extensions: ["json"] }],
    });
    if (!path) return;
    try {
      await api.saveProject(path, {
        version: 2,
        clips: s.clips,
        tracks: s.tracks,
      });
      setNotice({ title: t("projectSaved"), msg: path, path });
    } catch (e) {
      setNotice({
        title: t("saveFailed"),
        msg: `${e instanceof Error ? e.message : e}`,
      });
    }
  };

  const openProject = async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: t("filterProject"), extensions: ["json"] }],
    });
    if (!path || Array.isArray(path)) return;
    try {
      const data = await api.loadProject(path);
      if (
        (data.version !== 1 && data.version !== 2) ||
        !Array.isArray(data.clips) ||
        !Array.isArray(data.tracks)
      ) {
        setNotice({ title: t("openFailed"), msg: t("unsupportedFormat") });
        return;
      }
      const clips: Clip[] = [];
      const skipped: string[] = [];
      for (const raw of data.clips as Clip[]) {
        // v1 项目没有 kind 字段，一律视为视频
        const c: Clip = { ...raw, kind: raw.kind ?? "video" };
        try {
          await api.probe(c.src);
          clips.push(c);
        } catch {
          skipped.push(c.src.split("/").pop() ?? c.src);
        }
      }
      const clipIds = new Set(clips.map((c) => c.id));
      // v1 项目没有 intensity 字段，补默认值 0.5
      const tracks = (data.tracks as Track[])
        .filter((t) => clipIds.has(t.clipId))
        .map((t) => ({ ...t, intensity: t.intensity ?? 0.5 }));
      if (clips.length === 0) {
        setNotice({
          title: t("openFailed"),
          msg: t("allSourcesUnavailable", { names: skipped.join(", ") }),
        });
        return;
      }
      useStore.getState().loadProject(clips, tracks);
      if (skipped.length) {
        setNotice({
          title: t("partialMissing"),
          msg: t("missingSourcesMsg", { names: skipped.join(", ") }),
        });
      }
    } catch (e) {
      setNotice({
        title: t("openFailed"),
        msg: `${e instanceof Error ? e.message : e}`,
      });
    }
  };

  const loc = locate(clips, currentTime);
  const clipTracks = loc ? tracks.filter((t) => t.clipId === loc.clip.id) : [];
  const selected = tracks.find((t) => t.id === selectedTrackId) ?? null;
  const isImageProject = clips.length > 0 && clips[0].kind === "image";

  return (
    <main className="app">
      <header className="toolbar">
        <button onClick={importVideo} disabled={!sidecarReady}>
          {t("importMedia")}
        </button>
        <button onClick={openProject} disabled={!sidecarReady} title={t("openProjectHint")}>
          {t("openProject")}
        </button>
        <button onClick={saveProject} disabled={!sidecarReady || clips.length === 0} title={t("saveProjectHint")}>
          {t("saveProject")}
        </button>
        <span className="sep" />
        <button onClick={() => useStore.getState().undo()} disabled={!canUndo} title={t("undoHint")}>
          {t("undo")}
        </button>
        <button onClick={() => useStore.getState().redo()} disabled={!canRedo} title={t("redoHint")}>
          {t("redo")}
        </button>
        <span className="sep" />
        <button
          className={tool === "crop" ? "active" : ""}
          onClick={() =>
            useStore.getState().setTool(tool === "crop" ? "select" : "crop")
          }
        >
          {t("crop")}
        </button>
        {loc?.clip.crop && (
          <button onClick={() => {
            useStore.getState().pushHistory();
            useStore.getState().updateClip(loc.clip.id, { crop: null });
          }}>
            {t("clearCrop")}
          </button>
        )}
        <span className="sep" />
        <button
          className="export"
          onClick={isImageProject ? exportImage : exportVideo}
          disabled={!sidecarReady || clips.length === 0 || renderPct !== null}
        >
          {isImageProject
            ? t("exportPng")
            : renderPct !== null
              ? t("exportingPct", { pct: renderPct })
              : t("exportMp4")}
        </button>
        {renderPct !== null && (
          <button onClick={cancelExport} title={t("cancelExportHint")}>
            {t("cancelExport")}
          </button>
        )}
        <span className="status">
          {sidecarReady ? (busy ?? "") : t("engineDisconnected")}
        </span>
        <button
          className="about-btn"
          onClick={() => setShowSettings(true)}
          title={t("settings")}
        >
          ⚙
        </button>
        <button
          className="about-btn"
          onClick={() => setShowLicenses(true)}
          title={t("aboutHint")}
        >
          ⓘ
        </button>
      </header>

      <section className="workspace">
        <PreviewPlayer />
        <aside className="track-panel">
          <h3>{t("maskPanelTitle", { n: clipTracks.length })}</h3>
          {clipTracks.map((tr: Track) => (
            <div
              key={tr.id}
              className={`track-item ${tr.id === selectedTrackId ? "active" : ""}`}
              onClick={() => useStore.getState().setSelectedTrack(tr.id)}
            >
              <span className="dot" style={tr.fixed ? { background: "#b88fff" } : undefined} />
              <span>{tr.fixed ? t("fixedMask") : t("mask")}</span>
              <span className="track-range">
                {(tr.tStart ?? loc?.clip.in ?? 0).toFixed(1)}–
                {(tr.tEnd ?? loc?.clip.out ?? 0).toFixed(1)}s
              </span>
              <select
                value={tr.effect}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  useStore.getState().pushHistory();
                  useStore.getState().updateTrack(tr.id, {
                    effect: e.target.value as Track["effect"],
                  });
                }}
              >
                <option value="pixelate">{t("effectPixelate")}</option>
                <option value="blur">{t("effectBlur")}</option>
                <option value="blackbox">{t("effectBlackbox")}</option>
              </select>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  useStore.getState().pushHistory();
                  useStore.getState().removeTrack(tr.id);
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {selected && (
            <div className="track-window">
              <label>
                {t("appearAt")}
                <NumberField
                  step={0.1}
                  placeholder={loc?.clip.in.toFixed(1)}
                  value={selected.tStart}
                  onCommit={(v) => setTrackWindow(selected, "start", v)}
                />
              </label>
              <label>
                {t("disappearAt")}
                <NumberField
                  step={0.1}
                  placeholder={loc?.clip.out.toFixed(1)}
                  value={selected.tEnd}
                  onCommit={(v) => setTrackWindow(selected, "end", v)}
                />
              </label>
            </div>
          )}
          {selected && selected.effect !== "blackbox" && (
            <div className="track-intensity">
              <label>
                {t("intensity")}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selected.intensity}
                  onMouseDown={() => useStore.getState().pushHistory()}
                  onChange={(e) =>
                    useStore
                      .getState()
                      .updateTrack(selected.id, { intensity: +e.target.value })
                  }
                />
                <span className="intensity-value">
                  {Math.round(selected.intensity * 100)}%
                </span>
              </label>
              <button
                className="apply-all"
                title={t("applyToAllHint")}
                onClick={() => {
                  const s = useStore.getState();
                  s.pushHistory();
                  for (const t of s.tracks) {
                    if (t.clipId !== selected.clipId || t.id === selected.id) continue;
                    s.updateTrack(t.id, {
                      effect: selected.effect,
                      intensity: selected.intensity,
                    });
                  }
                }}
              >
                {t("applyToAll")}
              </button>
            </div>
          )}
          <details className="hint-details">
            <summary>{t("helpSummary")}</summary>
            <p className="hint">{t("helpHint1")}</p>
            <p className="hint">{t("helpHint2")}</p>
            <p className="hint">{t("helpHint3")}</p>
          </details>
        </aside>
      </section>

      <Timeline />

      {syncError && (
        <div className="startup-overlay">
          <div className="startup-box" onClick={(e) => e.stopPropagation()}>
            <h2>{t("trackingFailed")}</h2>
            <p className="notice-msg">{syncError}</p>
            <div className="notice-actions">
              <button
                className="crop-confirm"
                onClick={() => {
                  useStore.getState().setSyncError(null);
                  syncDirtyTracks();
                }}
              >
                {t("retry")}
              </button>
              <button onClick={() => useStore.getState().setSyncError(null)}>
                {t("ignore")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="startup-overlay" onClick={() => setShowSettings(false)}>
          <div
            className="startup-box license-box"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{t("settings")}</h2>
            <div className="settings-row">
              <span>
                <b>{t("language")}</b>
              </span>
              <select
                value={getLang()}
                onChange={(e) => setLang(e.target.value as Lang)}
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
            <label className="settings-row">
              <input
                type="checkbox"
                checked={personSegmentation}
                onChange={(e) => {
                  const v = e.target.checked;
                  setPersonSegmentation(v);
                  localStorage.setItem("vr.personSegmentation", v ? "1" : "0");
                }}
              />
              <span>
                <b>{t("personSegTitle")}</b>
                <br />
                <span className="settings-hint">
                  {t("personSegHint")}
                </span>
              </span>
            </label>
            <div className="settings-row">
              <span>
                <b>{t("precisionTitle")}</b>
                <br />
                <span className="settings-hint">
                  {t("precisionHint")}
                </span>
              </span>
              <select
                value={precision}
                onChange={(e) => {
                  const v = Number(e.target.value) as Precision;
                  setPrecisionState(v);
                  setPrecision(v);
                }}
              >
                <option value={0}>{t("precisionFast")}</option>
                <option value={1}>{t("precisionBalanced")}</option>
                <option value={2}>{t("precisionAccurate")}</option>
              </select>
            </div>
            <details className="hint-details">
              <summary>{t("fusionSummary")}</summary>
              <p className="hint">
                {t("fusionHint")}
              </p>
              {(
                [
                  ["iou", t("fusionIou")],
                  ["wNormal", t("fusionWNormal")],
                  ["wDrift", t("fusionWDrift")],
                  ["wLow", t("fusionWLow")],
                ] as [keyof FusionParams, string][]
              ).map(([key, label]) => (
                <label className="settings-row fusion-row" key={key}>
                  <span>{label}</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={fusion[key]}
                    onChange={(e) => {
                      const v = Math.max(0, Math.min(1, Number(e.target.value)));
                      if (!Number.isFinite(v)) return;
                      setFusion({ ...fusion, [key]: v });
                      setFusionParam(key, v);
                    }}
                  />
                </label>
              ))}
              <button
                onClick={() => {
                  setFusion(FUSION_DEFAULTS);
                  for (const k of Object.keys(FUSION_DEFAULTS) as (keyof FusionParams)[]) {
                    setFusionParam(k, FUSION_DEFAULTS[k]);
                  }
                }}
              >
                {t("resetDefaults")}
              </button>
            </details>
            <div className="notice-actions">
              <button className="crop-confirm" onClick={() => setShowSettings(false)}>
                {t("done")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showLicenses && (
        <div className="startup-overlay" onClick={() => setShowLicenses(false)}>
          <div
            className="startup-box license-box"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{t("aboutTitle")}</h2>
            <p className="notice-msg" style={{ maxWidth: "none" }}>
              {t("aboutTagline")}
            </p>
            <div className="notice-actions" style={{ marginTop: 0 }}>
              <button
                onClick={() =>
                  openUrl("https://video-redactor-privacy.tully-hu.workers.dev").catch(() => {})
                }
              >
                {t("viewPrivacy")}
              </button>
            </div>
            <div className="license-text">{licensesText}</div>
            <div className="notice-actions">
              <button className="crop-confirm" onClick={() => setShowLicenses(false)}>
                {t("close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div className="startup-overlay" onClick={() => setNotice(null)}>
          <div className="startup-box" onClick={(e) => e.stopPropagation()}>
            <h2>{notice.title}</h2>
            <p className="notice-msg">{notice.msg}</p>
            <div className="notice-actions">
              {notice.path && (
                <button
                  onClick={() =>
                    revealItemInDir(notice.path!).catch(() => {})
                  }
                >
                  {t("showInFinder")}
                </button>
              )}
              <button className="crop-confirm" onClick={() => setNotice(null)}>
                {t("ok")}
              </button>
            </div>
          </div>
        </div>
      )}

      {!sidecarReady && (
        <div className="startup-overlay">
          <div className="startup-box">
            <div className="spinner" />
            <h2>{t("engineStarting")}</h2>
            <p>
              {t("engineWaited", { s: startupElapsed })}
              {startupElapsed < 60 ? t("engineUsuallyFast") : ""}
            </p>
            <div className="progress-track">
              <div
                className="progress-bar"
                style={{
                  width: `${Math.min(95, (startupElapsed / 30) * 100)}%`,
                }}
              />
            </div>
            {startupElapsed >= 60 && (
              <p className="startup-warn">
                {t("engineSlowWarn")}
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
