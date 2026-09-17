/**
 * 山河塑形 · 中国地形（v0.0.1）
 *
 * 玩法：右侧卡片栏里是四大高原、四大盆地、三大平原和 27 条山脉。
 * 把卡片拖到地图上正确的位置，那块地就按**真实高程**从平地隆起来；
 * 拖错了弹回并说明偏到哪儿去了。全部归位后，中国地势三级阶梯会自己长出来。
 *
 * ## 为什么"隆起来的高度"要用真实 DEM
 *
 * 这不是一张手绘示意图，而是一张数值地图：每个格子的高程都来自
 * AWS Terrain Tiles 的真实测量值。学生把青藏高原拖对位置，看到的是
 * 4 700 米的高原，而不是"一个象征高原的色块"。反过来，如果把地形区
 * 丢到错的地方，它隆起的高度会立刻和周围对不上 —— 这个"不对劲"
 * 本身就是一次教学。
 *
 * ## 判定的口径
 *
 * 地形区查**区域位图**（这一格到底属于谁），山脉查**最近的那条走带是不是它**。
 * 两种判定都在世界坐标里做，和学生看到的画面完全一致，不存在
 * "看着放对了却说错"的情况。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AREAS,
  AREA_GROUPS,
  NANHAI,
  RANGES,
  type AreaDef,
  type RangeDef
} from "./data/regions";
import {
  CHINA_DEM,
  GRID_H,
  GRID_W,
  decodeAltitude,
  decodeLandMask,
  decodeRegionGrid,
  distToPolyline,
  insideChina,
  judgeAreaDrop,
  judgeRangeDrop,
  lonToX,
  latToZ,
  xToLon,
  zToLat
} from "./geo";
import {
  applyCorrect,
  applyHint,
  applyWrong,
  createState,
  distanceHint,
  gainFor,
  gradeOf,
  progressOf,
  type GameState
} from "./game";
import { createTerrainView, type TerrainView } from "./terrain";
import "./styles.css";

export interface PlayerInfo {
  studentId: number;
  studentName: string;
  className?: string | null;
  studentNo?: string;
}

const N = GRID_W * GRID_H;

/**
 * 山脉的两层隆起参数（都是"度"）。
 *
 * 全国 DEM 是 11.9 km/格，太行山、南岭这种宽 50~80 km 的山脉在这个尺度上
 * 只剩三四个格子，光靠 DEM 立不起来；但**完全不用 DEM 也不行** ——
 * 那样山脉就只是一条按"叠加米数"上色的扁平色带，既不是起伏的地形，
 * 颜色也和它真实的海拔对不上（秦岭真高 2000 m，画出来却是 0~680 m 的草绿）。
 *
 * 所以山脉用两条叠加：
 *   - `lift` 遮罩把**走带走廊**整条按真实 DEM 塑出来（半宽 0.42° ≈ 47 km，
 *     往外 0.08° 就收干净）—— 于是太行山那道"山西高原 vs 华北平原"的断崖、
 *     台湾中央山脉这些真实地形会自己长出来；
 *   - `add` 再沿折线叠一条高斯脊（σ=0.24°，峰 900 m）把脊线挑出来，
 *     让窄山脉在这个网格精度下也读得出"一条脊"。
 *
 * ⚠️ `add` 必须**裁进走廊**（乘上 lift 遮罩）。不裁的话高斯尾巴会拖到 1.08°，
 *    而那里 lift=0、着色退化成"只按叠加米数上色"—— 肉眼看到的就是山体外面
 *    围了一圈草绿晕（实测过一次）。裁进走廊后，走廊外 add 与 lift 同时为 0，
 *    干净地回到未塑形米灰。
 */
const RIDGE_SIGMA_DEG = 0.24;
const RIDGE_PEAK_M = 900;
/** 走带走廊：这个半宽以内塑形按 1 算，往外 FADE 度渐隐到 0 */
const RIDGE_LIFT_HALF_DEG = 0.42;
const RIDGE_LIFT_FADE_DEG = 0.08;
/** 山脉落点容差（度）：约 55 km，够宽松到不刁难学生，又拦得住"随手一丢" */
const RANGE_TOL_DEG = 0.55;

interface Item {
  kind: "area" | "line";
  id: string;
  name: string;
  group: string;
  blurb: string;
  color: string;
  /** 地形区才有 */
  area?: AreaDef;
  /** 山脉才有 */
  range?: RangeDef;
}

interface Toast {
  kind: "ok" | "bad" | "warn" | "info";
  text: string;
  id: number;
}

export default function ChinaRelief({ roster }: { roster: PlayerInfo[] }) {
  /* ------------------------------ 数据 ------------------------------ */
  const data = useMemo(
    () => ({
      alt: decodeAltitude(),
      land: decodeLandMask(),
      region: decodeRegionGrid()
    }),
    []
  );

  const items: Item[] = useMemo(() => {
    const a: Item[] = AREAS.map((d) => ({
      kind: "area",
      id: d.id,
      name: d.name,
      group: d.group,
      blurb: d.blurb,
      color: d.color,
      area: d
    }));
    const b: Item[] = RANGES.map((d) => ({
      kind: "line",
      id: d.id,
      name: d.name,
      group: d.core ? "必考山脉" : "了解性山脉",
      blurb: d.blurb,
      color: d.color,
      range: d
    }));
    return [...a, ...b];
  }, []);

  const itemById = useMemo(() => {
    const m = new Map<string, Item>();
    items.forEach((it) => m.set(it.id, it));
    return m;
  }, [items]);

  const nameByGridId = useMemo(() => {
    const m = new Map<number, string>();
    AREAS.forEach((a) => m.set(a.gridId, a.name));
    return m;
  }, []);

  /* --------------------------- 高度场状态 --------------------------- */
  const lift = useMemo(() => new Float32Array(N), []);
  const liftTarget = useMemo(() => new Float32Array(N), []);
  const add = useMemo(() => new Float32Array(N), []);
  const addTarget = useMemo(() => new Float32Array(N), []);

  const [state, setState] = useState<GameState>(() => createState());
  /**
   * 最新 state 的镜像。
   *
   * 提示文案要报出「这一次加了多少分」，而 setState 是异步的、拿不到结果。
   * 也不能直接用闭包里的 `state`：`handleDrop` 只在 `state.placed` 变化时重建，
   * 学生用过提示之后 `placed` 没变，闭包里的 `attemptOf` 还是旧的 ——
   * 那样算出来的分数又会和记分板对不上。
   */
  const stateRef = useRef(state);
  stateRef.current = state;
  const [toast, setToast] = useState<Toast | null>(null);
  const [infoItem, setInfoItem] = useState<Item | null>(null);
  const [groupFilter, setGroupFilter] = useState<string>("全部");
  const [drag, setDrag] = useState<{
    item: Item;
    x: number;
    y: number;
    lon: number | null;
    lat: number | null;
    moved: boolean;
  } | null>(null);
  const [finished, setFinished] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<TerrainView | null>(null);
  const dragRef = useRef<{ item: Item; startX: number; startY: number; moved: boolean } | null>(null);

  const total = items.length;

  /* ---------------------------- 3D 视图 ---------------------------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let view: TerrainView | null = null;
    try {
      view = createTerrainView(canvas, data.land);
      viewRef.current = view;
      // 首帧：全平的中国轮廓板，米灰色
      view.refresh(data.alt, lift, add, false);
    } catch (err) {
      console.error("[china-relief] 三维视图初始化失败：", err);
    }
    return () => {
      view?.dispose();
      viewRef.current = null;
    };
  }, [data, lift, add]);

  /* --------------------------- 隆起动画 --------------------------- */
  useEffect(() => {
    let raf = 0;
    let wasAnimating = false;
    const step = () => {
      raf = requestAnimationFrame(step);
      let animating = false;
      for (let k = 0; k < N; k++) {
        const lt = liftTarget[k];
        if (lift[k] !== lt) {
          const d = lt - lift[k];
          lift[k] = Math.abs(d) < 0.004 ? lt : lift[k] + d * 0.075;
          animating = true;
        }
        const at = addTarget[k];
        if (add[k] !== at) {
          const d = at - add[k];
          add[k] = Math.abs(d) < 2 ? at : add[k] + d * 0.075;
          animating = true;
        }
      }
      if (animating) {
        viewRef.current?.refresh(data.alt, lift, add, true);
        wasAnimating = true;
      } else if (wasAnimating) {
        // 动画收尾补算法线，这样静止后光照才是对的
        viewRef.current?.refresh(data.alt, lift, add, false);
        wasAnimating = false;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [data, lift, liftTarget, add, addTarget]);

  /* ---------------------------- 提示消息 ---------------------------- */
  const toastSeq = useRef(0);
  const say = useCallback((kind: Toast["kind"], text: string) => {
    toastSeq.current += 1;
    setToast({ kind, text, id: toastSeq.current });
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => {
      setToast((cur) => (cur && cur.id === toast.id ? null : cur));
    }, 3400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /* ---------------------------- 放置逻辑 ---------------------------- */

  /**
   * 由一条山脉折线生成两份场：
   *   `add`  —— 米，沿脊线的高斯叠加（挑出脊线）
   *   `lift` —— 0..1，走带走廊的塑形遮罩（把真实 DEM 放出来）
   * 两者都在**同一个包围盒**里算，不然 480×358 的网格上会白跑十几万次距离计算。
   */
  const buildRidge = useCallback(
    (line: [number, number][]) => {
      const addField = new Float32Array(N);
      const liftField = new Float32Array(N);
      const pad = Math.max(RIDGE_SIGMA_DEG * 3, RIDGE_LIFT_HALF_DEG + RIDGE_LIFT_FADE_DEG);
      let lo = Infinity;
      let hi = -Infinity;
      let la = Infinity;
      let ha = -Infinity;
      for (const [x, y] of line) {
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
        la = Math.min(la, y);
        ha = Math.max(ha, y);
      }
      const i0 = Math.max(0, Math.floor(((lo - pad - CHINA_DEM.lon0) / (CHINA_DEM.lon1 - CHINA_DEM.lon0)) * (GRID_W - 1)));
      const i1 = Math.min(GRID_W - 1, Math.ceil(((hi + pad - CHINA_DEM.lon0) / (CHINA_DEM.lon1 - CHINA_DEM.lon0)) * (GRID_W - 1)));
      const j0 = Math.max(0, Math.floor(((CHINA_DEM.lat1 - (ha + pad)) / (CHINA_DEM.lat1 - CHINA_DEM.lat0)) * (GRID_H - 1)));
      const j1 = Math.min(GRID_H - 1, Math.ceil(((CHINA_DEM.lat1 - (la - pad)) / (CHINA_DEM.lat1 - CHINA_DEM.lat0)) * (GRID_H - 1)));
      const liftPad = RIDGE_LIFT_HALF_DEG + RIDGE_LIFT_FADE_DEG;
      for (let j = j0; j <= j1; j++) {
        const lat = CHINA_DEM.lat1 - (j / (GRID_H - 1)) * (CHINA_DEM.lat1 - CHINA_DEM.lat0);
        for (let i = i0; i <= i1; i++) {
          const k = j * GRID_W + i;
          if (!data.land[k]) {
            continue;
          }
          const lon = CHINA_DEM.lon0 + (i / (GRID_W - 1)) * (CHINA_DEM.lon1 - CHINA_DEM.lon0);
          const d = distToPolyline(lon, lat, line);
          if (d > pad) {
            continue;
          }
          const mask = Math.min(1, Math.max(0, (liftPad - d) / RIDGE_LIFT_FADE_DEG));
          liftField[k] = mask;
          // 乘上掩膜是硬要求：高斯尾巴单独留在走廊外会变成一圈草绿晕
          addField[k] = RIDGE_PEAK_M * Math.exp(-(d * d) / (2 * RIDGE_SIGMA_DEG * RIDGE_SIGMA_DEG)) * mask;
        }
      }
      return { addField, liftField };
    },
    [data]
  );

  const doPlace = useCallback(
    (item: Item) => {
      if (item.kind === "area" && item.area) {
        const gid = item.area.gridId;
        for (let k = 0; k < N; k++) {
          if (data.region[k] === gid) {
            liftTarget[k] = 1;
          }
        }
      } else if (item.range) {
        const { addField, liftField } = buildRidge(item.range.line);
        for (let k = 0; k < N; k++) {
          if (addField[k] > addTarget[k]) {
            addTarget[k] = addField[k];
          }
          if (liftField[k] > liftTarget[k]) {
            liftTarget[k] = liftField[k];
          }
        }
      }
    },
    [data, buildRidge, liftTarget, addTarget]
  );

  const handleDrop = useCallback(
    (item: Item, lon: number, lat: number) => {
      if (stateRef.current.placed.includes(item.id)) {
        return;
      }
      if (!insideChina(lon, lat, data.land)) {
        say("warn", "这是中国之外的海域，把它放到陆地上");
        return;
      }
      if (item.kind === "area" && item.area) {
        const v = judgeAreaDrop(lon, lat, item.area.gridId, data.region, nameByGridId);
        if (v.ok) {
          doPlace(item);
          const gained = gainFor(stateRef.current, item.id, "area");
          setState((s) => applyCorrect(s, item.id, "area"));
          say("ok", `${item.name} 归位 · +${gained}`);
        } else {
          setState((s) => applyWrong(s));
          say("bad", `${v.message}（−5）`);
        }
        return;
      }
      if (item.range) {
        const v = judgeRangeDrop(lon, lat, item.id, RANGES, RANGE_TOL_DEG);
        if (v.ok) {
          doPlace(item);
          const gained = gainFor(stateRef.current, item.id, "line");
          setState((s) => applyCorrect(s, item.id, "line"));
          say("ok", `${item.name} 归位 · +${gained}`);
        } else {
          setState((s) => applyWrong(s));
          const where = distanceHint(lon, lat, item.range.anchor);
          say("bad", `${v.message}，${where}（−5）`);
        }
      }
    },
    [data, nameByGridId, doPlace, say]
  );

  // 指针事件里要读到最新的 handleDrop，所以过一层 ref
  const dropRef = useRef(handleDrop);
  dropRef.current = handleDrop;

  /* ----------------------------- 拖拽 ----------------------------- */
  const onCardPointerDown = useCallback(
    (event: React.PointerEvent, item: Item) => {
      if (state.placed.includes(item.id)) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      dragRef.current = { item, startX: event.clientX, startY: event.clientY, moved: false };
      setDrag({ item, x: event.clientX, y: event.clientY, lon: null, lat: null, moved: false });
    },
    [state.placed]
  );

  useEffect(() => {
    function toLonLat(clientX: number, clientY: number) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        return null;
      }
      return viewRef.current?.pick(clientX, clientY) ?? null;
    }

    function onMove(event: PointerEvent) {
      const d = dragRef.current;
      if (!d) {
        return;
      }
      if (Math.hypot(event.clientX - d.startX, event.clientY - d.startY) > 6) {
        d.moved = true;
      }
      const hit = toLonLat(event.clientX, event.clientY);
      setDrag({
        item: d.item,
        x: event.clientX,
        y: event.clientY,
        lon: hit?.lon ?? null,
        lat: hit?.lat ?? null,
        moved: d.moved
      });
    }

    function onUp(event: PointerEvent) {
      const d = dragRef.current;
      if (!d) {
        return;
      }
      dragRef.current = null;
      setDrag(null);
      if (!d.moved) {
        // 没拖动 = 想看说明
        setInfoItem(d.item);
        return;
      }
      const hit = toLonLat(event.clientX, event.clientY);
      if (hit) {
        dropRef.current(d.item, hit.lon, hit.lat);
      }
    }

    function onCancel() {
      dragRef.current = null;
      setDrag(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, []);

  /* ------------------------- 点击地图查信息 ------------------------- */
  const onCanvasClick = useCallback(
    (event: React.MouseEvent) => {
      if (drag) {
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const hit = viewRef.current?.pick(event.clientX, event.clientY);
      if (!hit) {
        return;
      }
      const i = Math.min(GRID_W - 1, Math.max(0, Math.round(
        ((hit.lon - CHINA_DEM.lon0) / (CHINA_DEM.lon1 - CHINA_DEM.lon0)) * (GRID_W - 1))));
      const j = Math.min(GRID_H - 1, Math.max(0, Math.round(
        ((CHINA_DEM.lat1 - hit.lat) / (CHINA_DEM.lat1 - CHINA_DEM.lat0)) * (GRID_H - 1))));
      const gid = data.region[j * GRID_W + i];
      if (gid > 0) {
        const found = AREAS.find((a) => a.gridId === gid);
        if (found) {
          const it = itemById.get(found.id);
          if (it) {
            setInfoItem(it);
            return;
          }
        }
      }
      // 不在任何地形区里：看看是不是踩在某条山脉的走带上
      let best: Item | null = null;
      let bestD = 0.42;
      for (const r of RANGES) {
        const d = distToPolyline(hit.lon, hit.lat, r.line);
        if (d < bestD) {
          bestD = d;
          best = itemById.get(r.id) ?? null;
        }
      }
      if (best) {
        setInfoItem(best);
        return;
      }
      void rect;
    },
    [drag, data, itemById]
  );

  /* ----------------------------- 提示 ----------------------------- */
  const onHint = useCallback(() => {
    if (!infoItem || state.placed.includes(infoItem.id)) {
      return;
    }
    setState((s) => applyHint(s, infoItem.id));
    say("info", `「${infoItem.name}」的位置在图上闪了一下（−8）`);
    const anchor = infoItem.area?.anchor ?? infoItem.range?.anchor;
    if (anchor) {
      setFlash({ lon: anchor[0], lat: anchor[1], id: Date.now() });
    }
  }, [infoItem, state.placed, say]);

  const [flash, setFlash] = useState<{ lon: number; lat: number; id: number } | null>(null);
  useEffect(() => {
    if (!flash) {
      return;
    }
    const timer = window.setTimeout(() => setFlash(null), 4200);
    return () => window.clearTimeout(timer);
  }, [flash]);

  /* ----------------------------- 完成 ----------------------------- */
  useEffect(() => {
    if (state.placed.length === total && total > 0) {
      setFinished(true);
    }
  }, [state.placed.length, total]);

  const prog = progressOf(state, total, total);
  const grade = gradeOf(state, total);

  const filtered = groupFilter === "全部" ? items : items.filter((it) => it.group === groupFilter);
  const groups = ["全部", ...AREA_GROUPS, "必考山脉", "了解性山脉"];

  const flashPos = useMemo(() => {
    if (!flash) {
      return null;
    }
    const v = viewRef.current?.project(flash.lon, flash.lat, 0);
    return v ?? null;
  }, [flash]);

  /* ------------------------------ 渲染 ------------------------------ */
  return (
    <div className="cr-root">
      <div className="cr-stage">
        <canvas
          ref={canvasRef}
          className="cr-canvas"
          onClick={onCanvasClick}
        />

        {/* 顶部记分板 */}
        <div className="cr-hud">
          <div className="cr-hud-item">
            <span className="cr-hud-num">{state.score}</span>
            <span className="cr-hud-label">得分</span>
          </div>
          <div className="cr-hud-item">
            <span className="cr-hud-num">
              {prog.done}
              <small>/{total}</small>
            </span>
            <span className="cr-hud-label">已归位</span>
          </div>
          <div className="cr-hud-item">
            <span className="cr-hud-num">{state.streak}</span>
            <span className="cr-hud-label">连击</span>
          </div>
          <div className="cr-hud-item is-warn">
            <span className="cr-hud-num">{state.wrongCount}</span>
            <span className="cr-hud-label">放错</span>
          </div>
          <button type="button" className="cr-hud-btn" onClick={() => viewRef.current?.resetCamera()}>
            复位视角
          </button>
        </div>

        {/* 拖动跟随的幽灵卡 */}
        {drag && drag.moved ? (
          <div
            className="cr-ghost"
            style={{ left: drag.x + 14, top: drag.y - 18, borderColor: drag.item.color }}
          >
            <span>{drag.item.name}</span>
            <small>
              {drag.lon === null || drag.lat === null
                ? "拖到地图上"
                : `${Math.abs(drag.lat).toFixed(1)}°${drag.lat >= 0 ? "N" : "S"} ${Math.abs(
                    drag.lon
                  ).toFixed(1)}°${drag.lon >= 0 ? "E" : "W"}`}
            </small>
          </div>
        ) : null}

        {/* 提示轮廓：闪烁的目标锚点 */}
        {flashPos ? (
          <div className="cr-flash-ring" style={{ left: flashPos.x, top: flashPos.y }} />
        ) : null}

        {/* 消息 */}
        {toast ? <div className={`cr-toast is-${toast.kind}`}>{toast.text}</div> : null}

        {/* 南海诸岛附图（国家地图规范要求：主图取景只到 17°N） */}
        <NanhaiInset />
      </div>

      {/* 右侧卡片栏 */}
      <aside className="cr-side">
        <div className="cr-side-head">
          <h1>山河塑形</h1>
          <p>把卡片拖到地图上正确的位置，那块地会按真实高程隆起来。</p>
        </div>

        <div className="cr-filters">
          {groups.map((g) => (
            <button
              key={g}
              type="button"
              className={groupFilter === g ? "is-active" : ""}
              onClick={() => setGroupFilter(g)}
            >
              {g}
            </button>
          ))}
        </div>

        <div className="cr-cards">
          {filtered.map((it) => {
            const done = state.placed.includes(it.id);
            return (
              <button
                key={it.id}
                type="button"
                className={`cr-card${done ? " is-done" : ""}`}
                style={{ ["--c" as string]: it.color }}
                onPointerDown={(e) => onCardPointerDown(e, it)}
              >
                <span className="cr-card-dot" />
                <span className="cr-card-name">{it.name}</span>
                {it.range && !it.range.core ? <em className="cr-card-tag">了解</em> : null}
                {it.area ? <em className="cr-card-tag">{it.area.elevation} m</em> : null}
                {done ? <span className="cr-card-ok">✓</span> : null}
              </button>
            );
          })}
        </div>

        <div className="cr-side-foot">
          {state.placed.length > 0 ? (
            <button
              type="button"
              className="cr-ghost-btn"
              onClick={() => {
                window.location.reload();
              }}
            >
              重新开始
            </button>
          ) : null}
          {roster.length > 1 ? <span className="cr-roster">本次课堂 {roster.length} 人</span> : null}
        </div>
      </aside>

      {/* 信息面板 */}
      {infoItem ? (
        <div className="cr-sheet" role="dialog">
          <button type="button" className="cr-sheet-close" onClick={() => setInfoItem(null)}>
            ×
          </button>
          <div className="cr-sheet-photo">
            <img
              src={`./assets/photos/${infoItem.id}.jpg`}
              alt={infoItem.name}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
                e.currentTarget.parentElement?.classList.add("is-missing");
              }}
            />
            <span className="cr-sheet-photo-fallback">
              {infoItem.name}
              <small>实景照片待补充 · 可在三维沙盘上查看它的真实起伏</small>
            </span>
          </div>
          <div className="cr-sheet-body">
            <h2>
              {infoItem.name}
              {infoItem.area ? <em>{infoItem.area.elevation} m 上下</em> : null}
              {infoItem.range && !infoItem.range.core ? <em>了解性知识</em> : null}
            </h2>
            <p>{infoItem.blurb}</p>
            {!state.placed.includes(infoItem.id) ? (
              <button type="button" className="cr-hint-btn" onClick={onHint}>
                在图上闪一下它的位置（−8 分）
              </button>
            ) : (
              <p className="cr-sheet-done">已经归位 ✓</p>
            )}
          </div>
        </div>
      ) : null}

      {/* 结算 */}
      {finished ? (
        <div className="cr-over">
          <div className="cr-over-card">
            <h2>中国地形已经塑好了</h2>
            <div className={`cr-over-grade is-${grade.key}`}>{grade.label}</div>
            <p className="cr-over-comment">{grade.comment}</p>
            <ul className="cr-over-stats">
              <li>
                <b>{state.score}</b>
                <span>总分</span>
              </li>
              <li>
                <b>{state.firstTry}</b>
                <span>一次答对</span>
              </li>
              <li>
                <b>{state.bestStreak}</b>
                <span>最长连击</span>
              </li>
              <li>
                <b>{state.wrongCount}</b>
                <span>放错次数</span>
              </li>
            </ul>
            <div className="cr-over-actions">
              <button type="button" className="cr-primary" onClick={() => window.location.reload()}>
                再来一轮
              </button>
              <button type="button" className="cr-ghost-btn" onClick={() => setFinished(false)}>
                先看看地图
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 南海诸岛附图。
 *
 * 主图取景到 17°N 为止（含海南、台湾）。南海诸岛整体在 17°N 以南，
 * 按国家地图规范必须另附小图表示，否则这份中国地图就是不合规的。
 * 十段线与岛礁都取自同一份国界数据，不是随手画的示意线。
 */
function NanhaiInset() {
  const paths = NANHAI.paths;
  if (paths.length === 0) {
    return null;
  }
  const vb = NANHAI.viewBox.split(" ");
  const w = Number(vb[2]);
  const h = Number(vb[3]);
  const boxW = 132;
  const boxH = (boxW * h) / w;
  return (
    <div className="cr-nanhai" style={{ width: boxW, height: boxH }}>
      <svg viewBox={NANHAI.viewBox} preserveAspectRatio="xMidYMid meet">
        <rect x={0} y={0} width={w} height={h} fill="#9dc0da" />
        {paths.map((d, idx) => (
          <path key={idx} d={d} fill="#f2f5f0" stroke="#5b6b5f" strokeWidth={0.06} />
        ))}
      </svg>
      <span>南海诸岛</span>
    </div>
  );
}
