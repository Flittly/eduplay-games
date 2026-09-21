/**
 * 像素山地 → 真实地形山地 的主界面。
 *
 * 布局：
 *   ┌────────┬──────────────────────────────┐
 *   │        │   三维视图（three.js）        │
 *   │ 参数栏 ├──────────────────────────────┤
 *   │        │   等高线栏（三页签，横跨底部）│
 *   └────────┴──────────────────────────────┘
 *
 * 所有派生数据都从 `Engine` 拿，本组件不自己算地理量 ——
 * 这样回归脚本用 `window.__mountainDebug` 驱动引擎时，
 * 测到的是与界面完全相同的一份逻辑。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createEngine, type Engine, type Params, type Snapshot } from "./engine";
import { DEM_SOURCES, sourceByTag } from "./data";
import { CHINA_MAP } from "./data/china-map";
import { locationByTag } from "./data/locations";
import LocationMap from "./LocationMap";
import { drawPlanMap, drawProfile } from "./panels";
import { ridgeValley, RIDGE_TPI, type ContourLevel } from "./contour";
import { heightFn } from "./dem";
import { channelSegments } from "./runoff";
import {
  BELTS, SEASON_LABEL, SEASONS, beltColor, beltDef, type SeasonId
} from "./zonation";

type Tab = "plan" | "list" | "profile";

export interface PlayerInfo {
  studentId: number;
  studentName: string;
  className?: string | null;
  studentNo?: string;
}

const WEATHER_LABEL: Record<Params["weather"], string> = {
  clear: "晴",
  light: "小雨",
  heavy: "大雨"
};
const WEATHER_ORDER: Array<Params["weather"]> = ["clear", "light", "heavy"];
const CONTOUR_STEPS = [100, 200, 500, 1000];
const EXAGGERATION_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

declare global {
  interface Window {
    __mountainDebug?: Record<string, unknown>;
  }
}

export default function MountainZones({ roster = [] }: { roster?: PlayerInfo[] }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState<Tab>("plan");
  const [errors, setErrors] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // ---------- 引擎初始化（只跑一次） ----------
  useEffect(() => {
    const host = hostRef.current;
    if (!host || engineRef.current) {
      return;
    }
    let engine: Engine | null = null;
    try {
      engine = createEngine();
      engine.mount(host);
    } catch (e) {
      setErrors(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      return;
    }
    engineRef.current = engine;
    setSnap(engine.snapshot());
    setReady(true);

    const onResize = () => {
      engineRef.current?.view?.resize();
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      engine?.dispose();
      engineRef.current = null;
    };
  }, []);

  // ---------- 参数应用 ----------
  const apply = useCallback((patch: Partial<Params>) => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    try {
      const next = engine.apply(patch);
      setSnap(next);
    } catch (e) {
      setErrors(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  }, []);

  // ---------- 调试钩子（回归脚本用） ----------
  useEffect(() => {
    if (!ready) {
      return;
    }
    window.__mountainDebug = {
      readState: () => engineRef.current?.snapshot() ?? null,
      getParams: () => engineRef.current?.params ?? null,
      setParams: (p: Partial<Params>) => {
        apply(p);
        return engineRef.current?.snapshot() ?? null;
      },
      setMountain: (tag: string) => apply({ mountainTag: tag }),
      setSeason: (s: SeasonId) => apply({ season: s }),
      setLat: (v: number) => apply({ lat: v }),
      setWeather: (w: Params["weather"]) => apply({ weather: w }),
      setMode: (m: Params["mode"]) => apply({ mode: m }),
      setContourInterval: (v: number) => apply({ contourInterval: v }),
      setShowContours: (v: boolean) => apply({ showContours: v }),
      setShowBands: (v: boolean) => apply({ showBands: v }),
      setHighlight: (v: number | null) => apply({ highlightLevel: v }),
      setVerticalExaggeration: (v: number) => apply({ verticalExaggeration: v }),
      setElevationOffset: (v: number) => apply({ elevationOffset: v }),
      /** 引擎字段直读（验证脚本核对地形数据是否与源一致） */
      terrainInfo: () => {
        const f = engineRef.current?.field;
        if (!f) {
          return null;
        }
        let maxIdx = 0;
        for (let k = 1; k < f.alt.length; k++) {
          if (f.alt[k] > f.alt[maxIdx]) {
            maxIdx = k;
          }
        }
        return {
          tag: f.source.tag,
          grid: f.grid,
          spanM: f.spanM,
          rawMin: f.source.demMin,
          rawMax: f.source.demMax,
          altMin: f.minH,
          altMax: f.maxH,
          peakI: f.peakI,
          peakJ: f.peakJ,
          peakIdxScan: maxIdx,
          len: f.alt.length,
          exaggeration: f.verticalExaggeration,
          offset: f.elevationOffset
        };
      },
      /** 逐点取样：给回归脚本核对「海拔 = raw + offset」 */
      sampleAt: (i: number, j: number) => {
        const f = engineRef.current?.field;
        if (!f) {
          return null;
        }
        const k = j * f.grid + i;
        return { raw: f.raw[k], alt: f.alt[k] };
      },
      contourLevels: () => engineRef.current?.contours.map((c) => c.level) ?? [],
      contourStats: () =>
        engineRef.current?.contours.map((c) => ({
          level: c.level,
          polylines: c.polylines.length,
          segCount: c.segCount,
          totalLen: c.totalLen
        })) ?? [],
      runoffInfo: () => {
        const r = engineRef.current?.runoff;
        return r
          ? {
              rain: r.rain,
              maxAcc: r.maxAcc,
              channels: r.channels.length,
              channelLengthKm: r.channelLengthM / 1000,
              trunkKm: r.trunkLengthM / 1000,
              totalProduced: r.totalProduced
            }
          : null;
      },
      route: () => engineRef.current?.view?.route() ?? [],
      viewInfo: () => engineRef.current?.view?.debug() ?? null,
      /** 山脊/山谷点数（用与平面图完全相同的 RIDGE_TPI 阈值重算一次） */
      ridges: () => {
        const f = engineRef.current?.field;
        if (!f) {
          return null;
        }
        const rv = ridgeValley(heightFn(f), f.grid, RIDGE_TPI);
        // scanned：ridgeValley 只扫内部 (n-2R)² 格（默认 R=3），
        // 占比必须拿它当分母 —— 用 n² 当分母会系统性低估约 5%。
        const scanned = (f.grid - 6) * (f.grid - 6);
        return {
          ridge: rv.ridge.length / 2,
          valley: rv.valley.length / 2,
          scanned,
          grid: f.grid,
          tpi: RIDGE_TPI
        };
      },
      setTab: (t: Tab) => setTab(t),
      dispose: () => {
        engineRef.current?.dispose();
        engineRef.current = null;
      }
    };
    return () => {
      delete window.__mountainDebug;
    };
  }, [ready, apply]);

  // ---------- 鼠标拾取（rAF 节流） ----------
  const pendRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef(0);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    pendRef.current = { x: e.clientX, y: e.clientY };
    if (rafRef.current) {
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const p = pendRef.current;
      const engine = engineRef.current;
      if (!p || !engine) {
        return;
      }
      engine.hoverAt(p.x, p.y);
      setSnap((prev) => (prev ? { ...prev, hover: engine.snapshot().hover } : prev));
    });
  }, []);

  // ---------- 平面图数据（脊线 / 水系） ----------
  const planData = useMemo(() => {
    const engine = engineRef.current;
    if (!engine) {
      return null;
    }
    const f = engine.field;
    const rv = ridgeValley(heightFn(f), f.grid, RIDGE_TPI);
    return {
      ridges: Float32Array.from(rv.ridge),
      channels: channelSegments(engine.runoff, f.grid)
    };
  }, [snap]);

  // ---------- 底部栏绘制 ----------
  const planRef = useRef<HTMLCanvasElement | null>(null);
  const profileRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = planRef.current;
    const engine = engineRef.current;
    if (tab !== "plan" || !c || !engine || !snap) {
      return;
    }
    const contours: ContourLevel[] = engine.contours;
    drawPlanMap(c, {
      field: engine.field,
      contours,
      lat: snap.lat,
      season: snap.season,
      interval: snap.contourInterval,
      majorEvery: 5,
      channels: planData?.channels,
      ridges: planData?.ridges,
      showBands: snap.showBands,
      peakName: snap.peakName
    });
  }, [tab, snap, planData]);

  useEffect(() => {
    const c = profileRef.current;
    const engine = engineRef.current;
    if (tab !== "profile" || !c || !engine || !snap) {
      return;
    }
    drawProfile(c, {
      field: engine.field,
      route: engine.view?.route() ?? [],
      lat: snap.lat,
      season: snap.season,
      interval: snap.contourInterval,
      bands: snap.bands,
      snowlineNow: snap.snowlineNow,
      treeline: snap.treeline,
      cursorT: null
    });
  }, [tab, snap]);

  // 切页签时 canvas 是刚挂上的，尺寸还没量到 —— 用一个微任务补画一次
  useEffect(() => {
    if (tab !== "plan" && tab !== "profile") {
      return;
    }
    const id = requestAnimationFrame(() => setSnap((p) => (p ? { ...p } : p)));
    return () => cancelAnimationFrame(id);
  }, [tab]);

  const contoured = snap?.showContours ?? true;

  return (
    <div className="mz-root">
      {/* ============ 三维视图 ============ */}
      <div
        className="mz-stage"
        onPointerMove={onPointerMove}
        onPointerLeave={() => {
          engineRef.current?.clearHover();
          setSnap((prev) => (prev ? { ...prev, hover: null } : prev));
        }}
      >
        <div className="mz-canvas-host" ref={hostRef} />

        {errors ? (
          <div className="mz-error">
            <b>三维视图初始化失败</b>
            <div>{errors}</div>
          </div>
        ) : null}

        {snap ? (
          <>
            <div className="mz-stage-tag">
              <span className="mz-stage-name">{snap.name}</span>
              <span className="mz-stage-sub">
                {snap.lat.toFixed(1)}°N · 跨度 {snap.spanKm} km · 网格 {snap.grid}×{snap.grid}
              </span>
              <span className="mz-stage-sub">
                真实 DEM {snap.demMin}–{snap.demMax} m
              </span>
            </div>

            <div className="mz-legend">
              <div className="mz-legend-title">自然带（山麓→山顶）</div>
              {[...BELTS.map((b) => b.id), "snow" as const].map((id) => {
                const onMountain = snap.bands.some((b) => b.belt === id);
                return (
                  <div key={id} className={`mz-legend-row${onMountain ? "" : " is-absent"}`}>
                    <span
                      className="mz-legend-swatch"
                      style={{ background: beltColor(id, snap.season) }}
                    />
                    <span className="mz-legend-label">{beltDef(id).short}</span>
                  </div>
                );
              })}
            </div>

            {snap.hover ? (
              <div className="mz-hovercard">
                <div className="mz-hovercard-alt">{Math.round(snap.hover.alt)} m</div>
                <div className="mz-hovercard-belt">{snap.hover.beltName}</div>
                <div className="mz-hovercard-line">
                  年均温 {snap.hover.tempAnnual.toFixed(1)} ℃ · 当季{" "}
                  {snap.hover.tempSeason.toFixed(1)} ℃
                </div>
                <div className="mz-hovercard-line">
                  植被覆盖 {(snap.hover.density * 100).toFixed(0)}%
                </div>
                {snap.hover.seasonalSnow ? (
                  <div className="mz-hovercard-line is-seasonal">
                    冬季季节性积雪（≠ 积雪冰川带：这一条带本身没变）
                  </div>
                ) : null}
                {snap.hover.aboveTreeline && snap.hover.belt !== "snow" ? (
                  <div className="mz-hovercard-line is-treeline">已在林线以上</div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {/* ============ 底部等高线栏 ============ */}
      <section className="mz-bottom">
        <header className="mz-bottom-head">
          <h2>等高线栏</h2>
          <div className="mz-tabs">
            <button
              type="button"
              className={`mz-tab${tab === "plan" ? " is-on" : ""}`}
              onClick={() => setTab("plan")}
            >
              平面等高线图
            </button>
            <button
              type="button"
              className={`mz-tab${tab === "list" ? " is-on" : ""}`}
              onClick={() => setTab("list")}
            >
              等高线清单
            </button>
            <button
              type="button"
              className={`mz-tab${tab === "profile" ? " is-on" : ""}`}
              onClick={() => setTab("profile")}
            >
              垂直剖面图
            </button>
          </div>
          <div className="mz-bottom-meta">
            {snap ? (
              <>
                等高距 <b>{snap.contourInterval} m</b> · 共 <b>{snap.contourCount}</b> 条
                {snap.highlightLevel != null ? (
                  <>
                    {" "}
                    · 高亮 <b className="mz-hot">{Math.round(snap.highlightLevel)} m</b>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </header>

        <div className="mz-bottom-body">
          {tab === "plan" ? (
            <canvas className="mz-canvas-plan" ref={planRef} />
          ) : null}

          {tab === "list" ? (
            <div className="mz-list">
              {snap?.contourLevels.map((lv) => {
                const contour = engineRef.current?.contours.find((c) => c.level === lv);
                const isHot = snap.highlightLevel === lv;
                const isSnow = snap.snowlineAnnual != null && lv >= snap.snowlineAnnual;
                return (
                  <button
                    key={lv}
                    type="button"
                    className={`mz-list-item${isHot ? " is-hot" : ""}`}
                    onClick={() =>
                      apply({ highlightLevel: snap.highlightLevel === lv ? null : lv })
                    }
                  >
                    <span className="mz-list-level">{Math.round(lv)} m</span>
                    <span className="mz-list-meta">
                      {contour ? `${contour.polylines.length} 圈 · ${(contour.totalLen * (snap.spanKm * 1000 / (snap.grid - 1)) / 1000).toFixed(1)} km` : "—"}
                    </span>
                    {isSnow ? <span className="mz-list-tag">雪线以上</span> : null}
                  </button>
                );
              })}
              {snap && snap.contourLevels.length === 0 ? (
                <div className="mz-list-empty">当前等高距下没有可显示的等高线</div>
              ) : null}
            </div>
          ) : null}

          {tab === "profile" ? (
            <canvas className="mz-canvas-profile" ref={profileRef} />
          ) : null}
        </div>
      </section>

      {/* ============ 参数栏 ============ */}
      <aside className="mz-panel">
        <h1 className="mz-title">
          <span>真实地形山地</span>
          <em>垂直自然带</em>
        </h1>

        <div className="mz-group">
          <div className="mz-group-title">山体（真实 DEM）</div>
          <div className="mz-btn-row">
            {DEM_SOURCES.map((s) => (
              <button
                key={s.tag}
                type="button"
                className={`mz-chip${snap?.mountainTag === s.tag ? " is-on" : ""}`}
                onClick={() => apply({ mountainTag: s.tag })}
                title={`${s.peakName} ${s.peakAltitude} m`}
              >
                {s.name}
              </button>
            ))}
          </div>
          {snap ? (
            <div className="mz-hint">
              {snap.peakName} {snap.peakAltitude} m · 取景 {snap.spanKm} km 见方
            </div>
          ) : null}
        </div>

        {snap ? (
          <div className="mz-group">
            <div className="mz-group-title">
              地理位置
              <b className="mz-num">{locationByTag(snap.mountainTag).province}</b>
            </div>
            <LocationMap
              map={CHINA_MAP}
              location={locationByTag(snap.mountainTag)}
              mountainName={snap.name}
              /* ⚠️ 坐标必须取 DemSource 的真实经纬度，**不能用 snap.lat** ——
                 snap.lat 是下面那根「纬度」滑杆的值，用它红点会跟着滑杆南北平移。 */
              realLat={sourceByTag(snap.mountainTag).lat}
              realLon={sourceByTag(snap.mountainTag).lon}
            />
          </div>
        ) : null}

        <div className="mz-group">
          <div className="mz-group-title">
            纬度
            <b className="mz-num">{snap ? `${snap.lat.toFixed(1)}°N` : "—"}</b>
          </div>
          <input
            className="mz-range"
            type="range"
            min={0}
            max={75}
            step={0.5}
            value={snap?.lat ?? 30}
            onChange={(e) => apply({ lat: Number(e.target.value) })}
          />
          <div className="mz-hint">
            切山时自动跳到该山真实纬度，仍可手动滑动来演示「把这座山搬到赤道 / 极圈」
          </div>
        </div>

        <div className="mz-group">
          <div className="mz-group-title">季节</div>
          <div className="mz-btn-row">
            {SEASONS.map((s) => (
              <button
                key={s}
                type="button"
                className={`mz-chip${snap?.season === s ? " is-on" : ""}`}
                onClick={() => apply({ season: s })}
              >
                {SEASON_LABEL[s]}
              </button>
            ))}
          </div>
          <div className="mz-hint">
            季节只改雪线高低与地表覆盖，**不改带谱本身** —— 带谱是多年气候稳定下来的
          </div>
        </div>

        <div className="mz-group">
          <div className="mz-group-title">
            高程塑造
            {snap?.modified ? <span className="mz-badge">已偏离真实 DEM</span> : null}
          </div>
          <label className="mz-slider">
            <span>
              高程偏移 <b className="mz-num">{(snap?.elevationOffset ?? 0) > 0 ? "+" : ""}{Math.round(snap?.elevationOffset ?? 0)} m</b>
            </span>
            <input
              className="mz-range"
              type="range"
              min={-2000}
              max={2000}
              step={50}
              value={snap?.elevationOffset ?? 0}
              onChange={(e) => apply({ elevationOffset: Number(e.target.value) })}
            />
          </label>
          <div className="mz-hint">
            <b>真的在改海拔</b>：整座山抬高/下切，山顶读数、等高线注记、带谱边界全都跟着变。
            演示「地壳抬升 → 雪线上移 → 整条带谱上移」。
          </div>

          <label className="mz-slider">
            <span>
              垂直夸张 <b className="mz-num">×{(snap?.verticalExaggeration ?? 1).toFixed(2)}</b>
            </span>
            <input
              className="mz-range"
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={snap?.verticalExaggeration ?? 1}
              onChange={(e) => apply({ verticalExaggeration: Number(e.target.value) })}
            />
          </label>
          <div className="mz-quick">
            {EXAGGERATION_STEPS.map((v) => (
              <button
                key={v}
                type="button"
                className={`mz-chip is-small${Math.abs((snap?.verticalExaggeration ?? 1) - v) < 1e-6 ? " is-on" : ""}`}
                onClick={() => apply({ verticalExaggeration: v })}
              >
                ×{v}
              </button>
            ))}
          </div>
          <div className="mz-hint">
            <b>只改视觉纵轴</b>，不改变「这座山有多高」—— 所以它不影响任何读数。
          </div>

          <button
            type="button"
            className="mz-reset"
            disabled={!snap?.modified}
            onClick={() => apply({ verticalExaggeration: 1, elevationOffset: 0 })}
          >
            还原真实 DEM
          </button>
        </div>

        <div className="mz-group">
          <div className="mz-group-title">
            等高线
            <b className="mz-num">{snap ? `${snap.contourCount} 条` : "—"}</b>
          </div>
          <div className="mz-btn-row">
            <button
              type="button"
              className={`mz-chip${contoured ? " is-on" : ""}`}
              onClick={() => apply({ showContours: !contoured })}
            >
              地表等高线
            </button>
            <button
              type="button"
              className={`mz-chip${snap?.showBands ? " is-on" : ""}`}
              onClick={() => apply({ showBands: !snap?.showBands })}
            >
              自然带配色
            </button>
          </div>
          <div className="mz-group-subtitle">等高距</div>
          <div className="mz-btn-row">
            {CONTOUR_STEPS.map((s) => (
              <button
                key={s}
                type="button"
                className={`mz-chip is-small${snap?.contourInterval === s ? " is-on" : ""}`}
                onClick={() => apply({ contourInterval: s })}
              >
                {s} m
              </button>
            ))}
          </div>
        </div>

        <div className="mz-group">
          <div className="mz-group-title">
            降雨
            <b className="mz-num">{snap ? `${(snap.runoff.rain * 100).toFixed(0)}%` : "—"}</b>
          </div>
          <div className="mz-btn-row">
            {WEATHER_ORDER.map((w) => (
              <button
                key={w}
                type="button"
                className={`mz-chip${snap?.weather === w ? " is-on" : ""}`}
                onClick={() => apply({ weather: w })}
              >
                {WEATHER_LABEL[w]}
              </button>
            ))}
          </div>
          {snap ? <div className="mz-hint">{snap.runoff.text}</div> : null}
        </div>

        <div className="mz-group">
          <div className="mz-group-title">视角</div>
          <div className="mz-btn-row">
            <button
              type="button"
              className={`mz-chip${snap?.mode === "observe" ? " is-on" : ""}`}
              onClick={() => apply({ mode: "observe" })}
            >
              绕山观察
            </button>
            <button
              type="button"
              className={`mz-chip${snap?.mode === "roam" ? " is-on" : ""}`}
              onClick={() => apply({ mode: "roam" })}
            >
              山麓→峰顶巡游
            </button>
          </div>
          <div className="mz-hint">
            巡游沿「最陡上升路径」从山麓走到峰顶，跟着看海拔与带谱如何变化
          </div>
        </div>

        <div className="mz-group">
          <div className="mz-group-title">自然带图鉴</div>
          <div className="mz-dex">
            {snap?.bands.map((b) => {
              const def = beltDef(b.belt);
              return (
                <div key={b.belt} className="mz-dex-card">
                  <div className="mz-dex-head">
                    <span className="mz-legend-swatch" style={{ background: beltColor(b.belt, snap.season) }} />
                    <span className="mz-dex-name">{def.name}</span>
                  </div>
                  <div className="mz-dex-range">
                    {Math.round(b.from)}–{Math.round(b.to)} m
                  </div>
                  <div className="mz-dex-typical">{def.typical}</div>
                </div>
              );
            })}
            {snap && snap.bands.length === 0 ? (
              <div className="mz-hint">当前山顶低于基带下限，山体没有形成分异</div>
            ) : null}
          </div>
        </div>

        <div className="mz-group mz-readout">
          <div className="mz-group-title">读数</div>
          {snap ? (
            <dl>
              <dt>山麓基带</dt>
              <dd>{snap.baseBeltName}</dd>
              <dt>当前山顶</dt>
              <dd>{Math.round(snap.currentPeak)} m</dd>
              <dt>年均雪线</dt>
              <dd>{Math.round(snap.snowlineAnnual)} m</dd>
              <dt>当季雪线</dt>
              <dd>{Math.round(snap.snowlineNow)} m</dd>
              <dt>林线</dt>
              <dd>{Math.round(snap.treeline)} m</dd>
              <dt>最高点位置</dt>
              <dd>
                {snap.peakName}（网格 {engineRef.current?.field.peakI},{engineRef.current?.field.peakJ}）
              </dd>
            </dl>
          ) : null}
        </div>

        <div className="mz-foot">
          {roster.length > 0 ? <div>本次课堂 {roster.length} 人</div> : null}
          地形数据：AWS Terrain Tiles（Terrarium，公有领域）· 按真实 DEM 网格渲染
        </div>
      </aside>
    </div>
  );
}
