import { useMemo, useRef, useState } from "react";
import { useStore, clipOutDur, totalDuration } from "../store";
import { useT } from "../i18n";
import NumberField from "./NumberField";
import type { Clip } from "../types";

interface LaneItem {
  id: string;
  s: number;
  e: number;
  fixed: boolean;
  lane: number;
}

export default function Timeline() {
  const t = useT();
  const clips = useStore((s) => s.clips);
  const tracks = useStore((s) => s.tracks);
  const currentTime = useStore((s) => s.currentTime);
  const setCurrentTime = useStore((s) => s.setCurrentTime);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const updateClip = useStore((s) => s.updateClip);
  const removeClip = useStore((s) => s.removeClip);
  const moveClip = useStore((s) => s.moveClip);
  const speedRange = useStore((s) => s.speedRange);
  const trimmingRef = useRef(false);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const selRef = useRef<{ a: number; b: number } | null>(null);
  const selDraggingRef = useRef(false);

  const total = totalDuration(clips);
  const isImage = clips.length > 0 && clips[0].kind === "image";

  // 把每个遮罩的出现/消失时间段换算到合成时间轴，再按重叠关系
  // 分配到不同泳道（区间图着色），保证重叠遮罩各自可见
  const lanes = useMemo(() => {
    const items: LaneItem[] = [];
    let acc = 0;
    for (const c of clips) {
      const d = clipOutDur(c);
      for (const t of tracks) {
        if (t.clipId !== c.id) continue;
        const ws = Math.max(t.tStart ?? c.in, c.in);
        const we = Math.min(t.tEnd ?? c.out, c.out);
        const s = acc + (ws - c.in) / c.speed;
        const e = acc + (we - c.in) / c.speed;
        if (e - s > 0.001) items.push({ id: t.id, s, e, fixed: t.fixed, lane: 0 });
      }
      acc += d;
    }
    items.sort((a, b) => a.s - b.s);
    const laneEnds: number[] = [];
    for (const it of items) {
      let lane = laneEnds.findIndex((end) => end <= it.s + 1e-6);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = it.e;
      it.lane = lane;
    }
    const laneCount = Math.max(laneEnds.length, 1);
    const laneHeight = Math.max(3, Math.min(8, (18 - (laneCount - 1)) / laneCount));
    return { items, laneCount, laneHeight };
  }, [clips, tracks]);

  const railTime = (clientX: number, rail: DOMRect) =>
    Math.max(0, Math.min(total, ((clientX - rail.left) / rail.width) * total));

  const startSel = (e: React.MouseEvent) => {
    if (total <= 0 || useStore.getState().busy) return;
    const rail = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t0 = railTime(e.clientX, rail);
    selRef.current = { a: t0, b: t0 };
    selDraggingRef.current = true;
    setSel({ a: t0, b: t0 });
    const onMove = (ev: MouseEvent) => {
      const t = railTime(ev.clientX, rail);
      const cur = { a: Math.min(t0, t), b: Math.max(t0, t) };
      selRef.current = cur;
      setSel(cur);
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      selDraggingRef.current = false;
      const t = railTime(ev.clientX, rail);
      if (Math.abs(t - t0) < 0.05) {
        selRef.current = null;
        setSel(null);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startTrim = (e: React.MouseEvent, c: Clip, side: "in" | "out") => {
    e.stopPropagation();
    e.preventDefault();
    useStore.getState().pushHistory();
    const stripEl = (e.currentTarget as HTMLElement).closest(
      ".clip-strip"
    ) as HTMLElement;
    if (!stripEl) return;
    const rect = stripEl.getBoundingClientRect();
    if (rect.width <= 0) return;
    const idx = useStore.getState().clips.findIndex((x) => x.id === c.id);
    const start = useStore
      .getState()
      .clips.slice(0, idx)
      .reduce((a, x) => a + clipOutDur(x), 0);
    const dur = clipOutDur(c);
    const startX = e.clientX;
    const startIn = c.in;
    const startOut = c.out;
    trimmingRef.current = true;
    const onMove = (ev: MouseEvent) => {
      const dSec = ((ev.clientX - startX) / rect.width) * dur * c.speed;
      if (side === "in") {
        const v = Math.max(0, Math.min(startIn + dSec, startOut - 0.1));
        updateClip(c.id, { in: v });
        setCurrentTime(start);
      } else {
        const v = Math.max(startIn + 0.1, Math.min(c.duration, startOut + dSec));
        updateClip(c.id, { out: v });
        setCurrentTime(start + (v - startIn) / c.speed);
      }
    };
    const onUp = () => {
      trimmingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startScrub = (e: React.MouseEvent) => {
    if (useStore.getState().busy || total <= 0) return;
    const rail = (e.currentTarget as HTMLElement).getBoundingClientRect();
    useStore.getState().setScrubbing(true);
    setCurrentTime(railTime(e.clientX, rail));
    const onMove = (ev: MouseEvent) => {
      setCurrentTime(railTime(ev.clientX, rail));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      useStore.getState().setScrubbing(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const setAtPlayhead = (c: Clip, side: "in" | "out", start: number) => {
    useStore.getState().pushHistory();
    const local = (currentTime - start) * c.speed;
    const src = c.in + local;
    if (side === "in") {
      updateClip(c.id, { in: Math.max(0, Math.min(src, c.out - 0.1)) });
    } else {
      updateClip(c.id, { out: Math.max(c.in + 0.1, Math.min(c.duration, src)) });
    }
  };

  return (
    <div className="timeline">
      <div className="timeline-strips">
        {clips.map((c) => {
          const start = clips
            .slice(0, clips.indexOf(c))
            .reduce((a, x) => a + clipOutDur(x), 0);
          const w = total > 0 ? (clipOutDur(c) / total) * 100 : 0;
          const nTracks = tracks.filter((t) => t.clipId === c.id).length;
          const playheadInside =
            currentTime >= start && currentTime <= start + clipOutDur(c);
          return (
            <div
              key={c.id}
              className="clip-strip"
              style={{ width: `${w}%` }}
            >
              {c.kind !== "image" && (
                <>
                  <div
                    className="trim-handle left"
                    title={t("trimInHint")}
                    onMouseDown={(e) => startTrim(e, c, "in")}
                  />
                  <div
                    className="trim-handle right"
                    title={t("trimOutHint")}
                    onMouseDown={(e) => startTrim(e, c, "out")}
                  />
                </>
              )}
              <div className="clip-name">
                {c.kind === "image" ? "🖼 " : ""}
                {c.src.split("/").pop()}
                {c.kind !== "image" && ` · ${clipOutDur(c).toFixed(1)}s`}
                {c.speed !== 1 && ` · ${c.speed}x`}
                {nTracks > 0 && ` · ${t("masksCount", { n: nTracks })}`}
              </div>
              <div className="clip-ops">
                {c.kind !== "image" && (
                  <>
                    <button title={t("moveBack")} onClick={(e) => { e.stopPropagation(); useStore.getState().pushHistory(); moveClip(c.id, -1); }}>◀</button>
                    <button title={t("moveForward")} onClick={(e) => { e.stopPropagation(); useStore.getState().pushHistory(); moveClip(c.id, 1); }}>▶</button>
                  </>
                )}
                <button title={t("delete")} onClick={(e) => { e.stopPropagation(); if (window.confirm(t("deleteClipConfirm", { kind: c.kind === "image" ? t("kindPhoto") : t("kindClip"), name: c.src.split("/").pop() ?? c.src }))) { useStore.getState().pushHistory(); removeClip(c.id); } }}>✕</button>
              </div>
              {c.kind !== "image" && (
                <div className="clip-trim" onClick={(e) => e.stopPropagation()}>
                <label>
                  {t("inLabel")}
                  <NumberField
                    step={0.1}
                    min={0}
                    max={c.out - 0.1}
                    value={c.in}
                    onCommit={(v) => {
                      if (v === null) return;
                      useStore.getState().pushHistory();
                      updateClip(c.id, {
                        in: Math.max(0, Math.min(v, c.out - 0.1)),
                      });
                    }}
                  />
                </label>
                <label>
                  {t("outLabel")}
                  <NumberField
                    step={0.1}
                    min={c.in + 0.1}
                    max={c.duration}
                    value={c.out}
                    onCommit={(v) => {
                      if (v === null) return;
                      useStore.getState().pushHistory();
                      updateClip(c.id, {
                        out: Math.max(Math.min(v, c.duration), c.in + 0.1),
                      });
                    }}
                  />
                </label>
                <label>
                  {t("speedLabel")}
                  <select
                    value={c.speed}
                    onChange={(e) => {
                      useStore.getState().pushHistory();
                      updateClip(c.id, { speed: +e.target.value });
                    }}
                  >
                    <option value={0.5}>0.5x</option>
                    <option value={1}>1x</option>
                    <option value={2}>2x</option>
                  </select>
                </label>
                {playheadInside && (
                  <>
                    <button
                      className="trim-set"
                      title={t("setInHint")}
                      onClick={() => setAtPlayhead(c, "in", start)}
                    >
                      {t("setIn")}
                    </button>
                    <button
                      className="trim-set"
                      title={t("setOutHint")}
                      onClick={() => setAtPlayhead(c, "out", start)}
                    >
                      {t("setOut")}
                    </button>
                    <button
                      className="trim-set"
                      title={t("splitHint")}
                      onClick={() => {
                        useStore.getState().pushHistory();
                        useStore
                          .getState()
                          .splitClip(c.id, c.in + (currentTime - start) * c.speed);
                      }}
                    >
                      {t("split")}
                    </button>
                  </>
                )}
                </div>
              )}
            </div>
          );
        })}
        {clips.length === 0 && <div className="timeline-empty">{t("timelineEmpty")}</div>}
      </div>
      {total > 0 && lanes.items.length > 0 && (
        <div
          className="mask-lanes"
          style={{ height: lanes.laneCount * (lanes.laneHeight + 1) }}
          title={t("maskLanesHint")}
        >
          {lanes.items.map((it) => (
            <div
              key={it.id}
              className={`mask-lane ${it.fixed ? "fixed" : ""} ${
                it.id === selectedTrackId ? "selected" : ""
              }`}
              style={{
                left: `${(it.s / total) * 100}%`,
                width: `${Math.max(((it.e - it.s) / total) * 100, 0.5)}%`,
                top: it.lane * (lanes.laneHeight + 1),
                height: lanes.laneHeight,
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                useStore.getState().setSelectedTrack(it.id);
                setCurrentTime(Math.min(it.s, total - 1e-3));
              }}
            />
          ))}
        </div>
      )}
      {total > 0 && (
        <>
          <div
            className="playhead-rail"
            onMouseDown={(e) => {
              if (e.shiftKey && !isImage) {
                startSel(e);
              } else {
                startScrub(e);
              }
            }}
            title={
              isImage
                ? t("playheadHintImage")
                : t("playheadHintVideo")
            }
          >
            {sel && sel.b - sel.a >= 0.05 && (
              <div
                className="range-highlight"
                style={{
                  left: `${(sel.a / total) * 100}%`,
                  width: `${((sel.b - sel.a) / total) * 100}%`,
                }}
              />
            )}
            <div
              className="playhead"
              style={{ left: `${(currentTime / total) * 100}%` }}
            />
          </div>
          {sel && sel.b - sel.a >= 0.05 && (
            <div className="range-bar">
              <span>
                {t("rangeSelected", {
                  a: sel.a.toFixed(2),
                  b: sel.b.toFixed(2),
                  d: (sel.b - sel.a).toFixed(2),
                })}
              </span>
              {[0.5, 2, 4].map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    useStore.getState().pushHistory();
                    speedRange(sel.a, sel.b, r);
                    selRef.current = null;
                    setSel(null);
                  }}
                >
                  {r}x
                </button>
              ))}
              <button
                onClick={() => {
                  selRef.current = null;
                  setSel(null);
                }}
              >
                {t("clear")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
