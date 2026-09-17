/**
 * 山河塑形 · 中国地形（v1.2.0）
 *
 * 玩法：右侧卡片栏里是四大高原、四大盆地、三大平原和 27 条山脉。
 * 把卡片拖到地图上正确的位置，那块地就按**真实高程**分层设色塑出来；
 * 拖错了弹回并说明偏到哪儿去了。全部归位后，中国地势三级阶梯会自己长出来。
 *
 * ## 为什么"塑出来的高度"要用真实 DEM
 *
 * 这不是一张手绘示意图，而是一张数值地图：每个格子的高程都来自
 * AWS Terrain Tiles 的真实测量值。学生把青藏高原拖对位置，看到的是
 * 4 700 米的高原，而不是"一个象征高原的色块"。反过来，如果把地形区
 * 丢到错的地方，它塑出来的高度会立刻和周围对不上 —— 这个"不对劲"
 * 本身就是一次教学。
 *
 * ## 判定的口径
 *
 * 地形区查**区域位图**（这一格到底属于谁），山脉查**最近的那条走带是不是它**。
 * 两种判定都在经纬度里做，和学生看到的画面完全一致，不存在
 * "看着放对了却说错"的情况。
 *
 * ## 版本脉络
 *
 * - **v0.0.1** 三维网面起步。
 * - **v1.0.0** 三维换卡通二维（网面 34 万个三角形在教室机器上是明摆着的
 *   卡顿）；点地图不再弹介绍（等于送答案）；放对后中间弹出介绍。
 * - **v1.1.0** 三处新需求：
 *   1. **接上平台名单与积分**（`manifest.requiresRoster` 改 `true`）——
 *      原先这个游戏是"展示型"，平台跳过选人页、只发空名单，于是分数
 *      没有归属，等于积不了分；
 *   2. **多人接力**：一份地图全班轮流塑，每人各记各的分，可随时点名换人；
 *   3. **多底图**：分层设色 / 地势晕渲 / 遥感影像（天地图）三选一。
 * - **v1.2.0** 又是三处课堂反馈：
 *   1. **低难度**：一上来整幅空白太难，可以让地图先随机塑好一部分，
 *      学生只补缺的那些，每次开局都不一样；
 *   2. **分类专练**：高原 / 盆地 / 平原 / 山脉可以只留一类空着，针对性训练；
 *   3. **轮廓开关**：相邻地块之间画一道各自色系的深色分界，看得清"到哪儿为止"。
 *
 * 状态机在 `session.ts`，底图在 `basemap.ts`，本局计划在 `plan.ts`，
 * 三个都是纯逻辑、可 Node 回归。
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
  mapLayout
} from "./geo";
import { distanceHint, type Grade } from "./game";
import {
  addSeconds,
  classGrade,
  commitCorrect,
  commitHint,
  commitWrong,
  createSession,
  currentId,
  focusPlayer,
  isPlaced,
  isSettled,
  requiredCount,
  resultsOf,
  roundOf,
  type PlayMode,
  type PlayerInfo,
  type Session,
  type SessionResult
} from "./session";
import {
  BASEMAPS,
  TIANDITU_ATTRIBUTION,
  TIANDITU_KEY_PAGE,
  layoutTiles,
  tiandituTileUrl,
  type BasemapKind,
  type TileRect
} from "./basemap";
import {
  DEFAULT_SCOPE,
  DEFAULT_START,
  SCOPES,
  STARTS,
  planRound,
  plannedCount,
  type Scope,
  type ScopeKey,
  type StartMode
} from "./plan";
import { createTerrainView, outlineRGB, type SceneView, type TerrainView } from "./terrain";
import "./styles.css";

export type { PlayerInfo };
export type { SessionResult };

const N = GRID_W * GRID_H;

/** 天地图密钥在本地的存放位置。**只存本地**：随包发布的代码里只有占位符 */
const TK_STORAGE = "eduplay.china_relief.tianditu_tk";

function readStoredKey(): string {
  try {
    return window.localStorage.getItem(TK_STORAGE) ?? "";
  } catch {
    // 无痕模式 / 存储被禁用：当作没填过，本次会话填的仍然管用
    return "";
  }
}

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

/**
 * 卡片栏里那一档「只看本局还要塑的」。
 *
 * 是一个**独立的筛选档**而不是"全部"的子集：老师和学生的实际诉求是
 * "还差哪几张"（按完成度筛），与"这是高原还是山脉"（按类型筛）是两回事，
 * 混在一起会让按钮语义变得不可预期。
 */
const TODO_FILTER = "本局待塑";

interface Item {
  kind: "area" | "line";
  id: string;
  name: string;
  group: string;
  blurb: string;
  color: string;
  /** 条目在"练习范围"这一维度上的身份（高原/盆地/平原/山脉） */
  scopeKey: ScopeKey;
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

interface ChinaReliefProps {
  roster: PlayerInfo[];
  /** 没收到平台名单（老师直接把包丢进浏览器预览）时为真 */
  standalone: boolean;
  /** 全部归位后交成绩单 —— 上报平台的活儿在 main.tsx 里，那边才懂协议 */
  onFinish?: (results: SessionResult[]) => void;
}

export default function ChinaRelief({ roster, standalone, onFinish }: ChinaReliefProps) {
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
      scopeKey: d.kind,
      area: d
    }));
    const b: Item[] = RANGES.map((d) => ({
      kind: "line",
      id: d.id,
      name: d.name,
      group: d.core ? "必考山脉" : "了解性山脉",
      blurb: d.blurb,
      color: d.color,
      scopeKey: "range" as ScopeKey,
      range: d
    }));
    return [...a, ...b];
  }, []);

  /**
   * 归属图 + 描边色表（v1.2.0 的轮廓）。
   *
   * 归属图是"这一格归哪一条目"（0 = 无，n = 第 n 个条目 + 1），
   * 由 `doPlace` 在塑形的同时写进去 —— 与 `lift/add` 同一时刻、同一批格子，
   * 所以轮廓永远不会和实际塑出来的形状对不上（这一点很关键：
   * 如果轮廓改成按 `ring` 折线另外算一遍，就会出现"线画在这儿、
   * 地形塑在那儿"的错位，而且是静默的）。
   */
  const ownerGrid = useMemo(() => new Uint8Array(N), []);
  const ownerColor = useMemo(() => {
    const table = new Uint8Array((items.length + 1) * 3);
    items.forEach((it, idx) => {
      const [r, g, b] = outlineRGB(it.color);
      table[(idx + 1) * 3] = r;
      table[(idx + 1) * 3 + 1] = g;
      table[(idx + 1) * 3 + 2] = b;
    });
    return table;
  }, [items]);
  const itemIndex = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((it, idx) => m.set(it.id, idx + 1));
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

  /* ------------------------------ 会话 ------------------------------ */
  const [stage, setStage] = useState<"lobby" | "play">("lobby");
  const [mode, setMode] = useState<PlayMode>("relay");
  const [session, setSession] = useState<Session | null>(null);
  /** 最新 session 的镜像：指针事件与 rAF 里要读到最新的那位答题人 */
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  /** 当前这一"段"答题时间的起算点（毫秒） */
  const turnStartRef = useRef<number>(0);

  const [basemap, setBasemap] = useState<BasemapKind>("relief");
  const basemapRef = useRef<BasemapKind>("relief");
  basemapRef.current = basemap;

  /* --------------------------- 本局计划（v1.2.0） --------------------------- */
  /** 练习范围：全部 / 只练某一类 */
  const [scope, setScope] = useState<Scope>(DEFAULT_SCOPE);
  /** 起始地图：空白 / 随机预置 */
  const [start, setStart] = useState<StartMode>(DEFAULT_START);
  /** 轮廓开关。默认**开** —— 用户要的就是"周围能区分开" */
  const [outline, setOutline] = useState(true);
  /**
   * 交给渲染层的"场景"对象。
   *
   * 做成 ref 里的**可变对象**而不是 state：`refresh()` 在 rAF 里每帧都调，
   * 每帧新建一个对象纯属浪费；而且轮廓开关变了只需要重画一次，
   * 不需要走 React 的渲染周期。
   */
  const sceneRef = useRef<SceneView>({
    owner: ownerGrid,
    outline: true,
    ownerColor
  });
  sceneRef.current.owner = ownerGrid;
  sceneRef.current.ownerColor = ownerColor;

  const [tk, setTk] = useState<string>(() => readStoredKey());
  const [keyPanel, setKeyPanel] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [tileFail, setTileFail] = useState(0);
  const [satelliteNote, setSatelliteNote] = useState<string | null>(null);

  const [toast, setToast] = useState<Toast | null>(null);
  const [infoItem, setInfoItem] = useState<Item | null>(null);
  const [justPlaced, setJustPlaced] = useState(false);
  const [groupFilter, setGroupFilter] = useState<string>("全部");
  const [drag, setDrag] = useState<{
    item: Item;
    x: number;
    y: number;
    lon: number | null;
    lat: number | null;
    moved: boolean;
  } | null>(null);
  const [flash, setFlash] = useState<{ lon: number; lat: number; id: number } | null>(null);
  const [finished, setFinished] = useState(false);
  const [final, setFinal] = useState<{ results: SessionResult[]; grade: Grade } | null>(null);
  /** 「先看看地图」把结算面板收起来；`final` 本身留着，免得又算一遍、再上报一遍 */
  const [overlayHidden, setOverlayHidden] = useState(false);
  const reportedRef = useRef(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<TerrainView | null>(null);
  const dragRef = useRef<{
    item: Item;
    startX: number;
    startY: number;
    moved: boolean;
    /** 已在图上的条目：只允许"点开看讲解"，不允许拖 */
    locked: boolean;
  } | null>(null);

  /**
   * 进度分母 = **本局要学生塑的张数**，不是"一共有多少条目"。
   *
   * v1.2.0 起地图上可能先摆好一批（低难度 / 分类专练）。
   * 分母要是还写 38，学生做完全部 15 张会看到"15/38"，以为漏了 23 张，
   * 而系统永远不结算 —— 那才是真的走不下去。
   */
  const total = session ? requiredCount(session) : 0;
  const cur = session ? currentId(session) : -1;
  const curRound = session && cur >= 0 ? roundOf(session, cur) : null;

  /* ---------------------------- 视图 ---------------------------- */
  /*
   * ⚠ 依赖里**必须有 `stage`**。
   *
   * v1.1.0 加了「先进大厅选人、点开始才进图」这一步，画布因此比组件挂载晚一步
   * 才出现在 DOM 里。而这个 effect 的另外三个依赖（`data` / `lift` / `add`）
   * 都是稳定引用，只靠它们的话它**只会跑一次** —— 那一次还停在大厅，
   * `canvasRef.current` 是 null，于是直接 return 且永不再执行：
   * 学生点完「开始塑形」看到的是一块 300×150 的空白画布（默认尺寸，
   * 因为 `layout()` 也从来没被调用过），而控制台一声不响。
   *
   * 这是真机渲染回归抓出来的：`canvas.width` 始终是默认的 300。
   */
  useEffect(() => {
    if (stage !== "play") {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let view: TerrainView | null = null;
    try {
      view = createTerrainView(canvas, data.land);
      viewRef.current = view;
      // 首帧：底图 + 已经预置好的地形（低难度/分类专练时开场就不是空的）
      view.refresh(data.alt, lift, add, false, basemapRef.current, sceneRef.current);
    } catch (err) {
      console.error("[china-relief] 视图初始化失败：", err);
    }
    return () => {
      view?.dispose();
      viewRef.current = null;
    };
  }, [data, lift, add, stage]);

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
        viewRef.current?.refresh(data.alt, lift, add, true, basemapRef.current, sceneRef.current);
        wasAnimating = true;
      } else if (wasAnimating) {
        // 动画收尾补一次全分辨率（不再算额外的东西，只是把降采样补回来）
        viewRef.current?.refresh(data.alt, lift, add, false, basemapRef.current, sceneRef.current);
        wasAnimating = false;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [data, lift, liftTarget, add, addTarget]);

  /**
   * 切底图时要立刻重画。
   *
   * 静止时 rAF 循环什么都不做，所以底图变了没人通知它 —— 不补这一笔的话，
   * 学生点「遥感影像」会看到画面纹丝不动（瓦片层出来了，但盖在下面的
   * 米灰"毛毡"还是按旧底图画的不透明版），只有等下一次放卡片才刷新。
   */
  useEffect(() => {
    viewRef.current?.refresh(data.alt, lift, add, false, basemap, sceneRef.current);
  }, [basemap, data, lift, add]);

  /**
   * 轮廓开关：同样要立刻重画。
   *
   * 与切底图是同一类问题 —— 静止时 rAF 什么都不做，没人通知视图。
   * 这里改的是 `sceneRef.current.outline`（可变对象），所以不能靠 props 变化，
   * 得显式在 effect 里改完再刷一次。
   */
  useEffect(() => {
    sceneRef.current.outline = outline;
    viewRef.current?.refresh(data.alt, lift, add, false, basemapRef.current, sceneRef.current);
  }, [outline, data, lift, add]);

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

  useEffect(() => {
    if (!flash) {
      return;
    }
    const timer = window.setTimeout(() => setFlash(null), 4200);
    return () => window.clearTimeout(timer);
  }, [flash]);

  /**
   * 把"从上一段开始到现在"的时间记到**当时那位答题人**头上。
   *
   * 不记总时长：讲台上一轮接力可能十几分钟，平均给每个人是最省事也最没用的
   * 数字。按段累计之后，这个学生的用时就是他真正在答题的时间。
   */
  const flushTime = useCallback((s: Session | null): Session | null => {
    if (!s) {
      return s;
    }
    const now = Date.now();
    const elapsed = (now - turnStartRef.current) / 1000;
    turnStartRef.current = now;
    const id = currentId(s);
    return elapsed > 0 ? addSeconds(s, id, elapsed) : s;
  }, []);

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
      const i0 = Math.max(
        0,
        Math.floor(
          ((lo - pad - CHINA_DEM.lon0) / (CHINA_DEM.lon1 - CHINA_DEM.lon0)) * (GRID_W - 1)
        )
      );
      const i1 = Math.min(
        GRID_W - 1,
        Math.ceil(((hi + pad - CHINA_DEM.lon0) / (CHINA_DEM.lon1 - CHINA_DEM.lon0)) * (GRID_W - 1))
      );
      const j0 = Math.max(
        0,
        Math.floor(
          ((CHINA_DEM.lat1 - (ha + pad)) / (CHINA_DEM.lat1 - CHINA_DEM.lat0)) * (GRID_H - 1)
        )
      );
      const j1 = Math.min(
        GRID_H - 1,
        Math.ceil(
          ((CHINA_DEM.lat1 - (la - pad)) / (CHINA_DEM.lat1 - CHINA_DEM.lat0)) * (GRID_H - 1)
        )
      );
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
          addField[k] =
            RIDGE_PEAK_M * Math.exp(-(d * d) / (2 * RIDGE_SIGMA_DEG * RIDGE_SIGMA_DEG)) * mask;
        }
      }
      return { addField, liftField };
    },
    [data]
  );

  /**
   * 把一条条目"塑"到地图上：写高度场，同时写**归属图**。
   *
   * `instant=true` 用于一进场的预置（v1.2.0）—— 直接把动画目标与实际值一起落到位，
   * 不播隆起动画。理由是语义：预置的地形是"地图本来就是这样"，
   * 而不是"刚刚有人塑好了一块"。让它哗地一起隆起，学生会以为
   * 刚才有 23 个同学同时动手了。
   *
   * ⚠️ 归属图必须在这里、和高度场用**同一批格子**写下去。
   * 换个地方按 `ring` 折线另算一遍轮廓的话，就会"线画在这儿、地形塑在那儿"，
   * 而且完全静默 —— 画面上只是觉得有点歪，看不出是程序错了。
   */
  const applyItem = useCallback(
    (item: Item, instant: boolean) => {
      const tag = itemIndex.get(item.id) ?? 0;
      if (!tag) {
        return;
      }
      if (item.kind === "area" && item.area) {
        const gid = item.area.gridId;
        for (let k = 0; k < N; k++) {
          if (data.region[k] === gid) {
            liftTarget[k] = 1;
            if (instant) {
              lift[k] = 1;
            }
            ownerGrid[k] = tag;
          }
        }
        return;
      }
      if (item.range) {
        const { addField, liftField } = buildRidge(item.range.line);
        for (let k = 0; k < N; k++) {
          if (liftField[k] <= 0) {
            continue;
          }
          if (addField[k] > addTarget[k]) {
            addTarget[k] = addField[k];
          }
          if (liftField[k] > liftTarget[k]) {
            liftTarget[k] = liftField[k];
          }
          ownerGrid[k] = tag;
        }
        if (instant) {
          for (let k = 0; k < N; k++) {
            lift[k] = liftTarget[k];
            add[k] = addTarget[k];
          }
        }
      }
    },
    [data, buildRidge, liftTarget, addTarget, lift, add, ownerGrid, itemIndex]
  );

  const doPlace = useCallback(
    (item: Item) => {
      applyItem(item, false);
    },
    [applyItem]
  );

  /** 打开介绍卡：`justPlaced=true` 表示这次是"放对了自动弹" */
  const openIntro = useCallback((item: Item, justPlacedNow: boolean) => {
    setJustPlaced(justPlacedNow);
    setInfoItem(item);
  }, []);

  const handleDrop = useCallback(
    (item: Item, lon: number, lat: number) => {
      const s0 = sessionRef.current;
      if (!s0 || isSettled(s0, item.id)) {
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
          const s1 = flushTime(s0) ?? s0;
          const out = commitCorrect(s1, item.id, "area");
          turnStartRef.current = Date.now();
          setSession(out.session);
          say("ok", `${item.name} 归位 · ${out.studentName} +${out.gained}${nextHint(out.session)}`);
          // 放对了就讲：把"做对了"和"学到了"缝在一起
          openIntro(item, true);
        } else {
          const s1 = flushTime(s0) ?? s0;
          setSession(commitWrong(s1));
          say("bad", `${v.message}（${nameOf(s1)}−5）`);
        }
        return;
      }
      if (item.range) {
        const v = judgeRangeDrop(lon, lat, item.id, RANGES, RANGE_TOL_DEG);
        if (v.ok) {
          doPlace(item);
          const s1 = flushTime(s0) ?? s0;
          const out = commitCorrect(s1, item.id, "line");
          turnStartRef.current = Date.now();
          setSession(out.session);
          say("ok", `${item.name} 归位 · ${out.studentName} +${out.gained}${nextHint(out.session)}`);
          openIntro(item, true);
        } else {
          const s1 = flushTime(s0) ?? s0;
          setSession(commitWrong(s1));
          const where = distanceHint(lon, lat, item.range.anchor);
          say("bad", `${v.message}，${where}（${nameOf(s1)}−5）`);
        }
      }
    },
    [data, nameByGridId, doPlace, say, openIntro, flushTime]
  );

  // 指针事件里要读到最新的 handleDrop，所以过一层 ref
  const dropRef = useRef(handleDrop);
  dropRef.current = handleDrop;

  /* ----------------------------- 拖拽 ----------------------------- */
  const onCardPointerDown = useCallback(
    (event: React.PointerEvent, item: Item) => {
      const s = sessionRef.current;
      if (!s || event.button !== 0) {
        return;
      }
      event.preventDefault();
      /*
       * 已经在图上的一律**不给拖**（不管是学生塑的还是本局预置的）——
       * 预置的要是还能拖，同一块地就能加两次分。
       *
       * 但**点击**必须留着：v1.2.0 起卡片上写着「已在图上」，
       * 学生看到就想点开看看这块地是什么；点不动只会让人以为界面坏了
       * （介绍卡里本来就有"本局开局时就已经在图上 ✓"那一段，说明意图就是能点开）。
       * 所以照样记一条 drag，只标成 locked：不跟手、不给幽灵卡、松手不判定，
       * 但只要指针没移动过，松手照常弹讲解。
       */
      const locked = isSettled(s, item.id);
      dragRef.current = { item, startX: event.clientX, startY: event.clientY, moved: false, locked };
      if (!locked) {
        setDrag({ item, x: event.clientX, y: event.clientY, lon: null, lat: null, moved: false });
      }
    },
    []
  );

  useEffect(() => {
    function toLonLat(clientX: number, clientY: number) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (
        !rect ||
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
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
      if (d.locked) {
        // 已在图上的条目不跟手：连幽灵卡都不给（给了就等于暗示"这块能挪"）
        return;
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
        // 没拖动 = 想先看看这是什么东西的讲解；`false` = 学生主动点开的
        openIntro(d.item, false);
        return;
      }
      if (d.locked) {
        // 把已在图上的地块往外拖：不判定、不扣分、也不弹讲解（他只是想挪它）
        say("info", `「${d.item.name}」已经在图上了`);
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
  }, [openIntro, say]);

  /* ----------------------------- 提示 ----------------------------- */
  const onHint = useCallback(() => {
    const s = sessionRef.current;
    if (!s || !infoItem || isSettled(s, infoItem.id)) {
      return;
    }
    setSession(commitHint(flushTime(s) ?? s, infoItem.id));
    say("info", `「${infoItem.name}」的位置在图上闪了一下（${nameOf(s)}−8）`);
    const anchor = infoItem.area?.anchor ?? infoItem.range?.anchor;
    if (anchor) {
      setFlash({ lon: anchor[0], lat: anchor[1], id: Date.now() });
    }
  }, [infoItem, say, flushTime]);

  // 介绍卡是居中弹出的，ESC 要能关；不然 38 张卡片逐张弹出来会很打断节奏
  useEffect(() => {
    if (!infoItem) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setInfoItem(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [infoItem]);

  /* --------------------------- 换人 / 点名 --------------------------- */
  const onFocusPlayer = useCallback(
    (studentId: number) => {
      const s = sessionRef.current;
      if (!s || studentId === currentId(s)) {
        return;
      }
      const flushed = flushTime(s) ?? s;
      setSession(focusPlayer(flushed, studentId));
      say("info", `现在由「${flushed.names[studentId] ?? ""}」答题`);
    },
    [flushTime, say]
  );

  /* ----------------------------- 结算 ----------------------------- */
  useEffect(() => {
    if (session && total > 0 && session.placed.length === total) {
      setFinished(true);
    }
  }, [session, total]);

  useEffect(() => {
    if (!finished || final || !session) {
      return;
    }
    const s = flushTime(session) ?? session;
    setSession(s);
    setFinal({ results: resultsOf(s, total), grade: classGrade(s, total) });
  }, [finished, final, session, total, flushTime]);

  useEffect(() => {
    if (!final || reportedRef.current) {
      return;
    }
    reportedRef.current = true;
    onFinish?.(final.results);
  }, [final, onFinish]);

  /* ----------------------------- 底图 ----------------------------- */
  const chooseBasemap = useCallback(
    (kind: BasemapKind) => {
      if (kind === "satellite" && !tk) {
        setKeyDraft("");
        setKeyPanel(true);
        return;
      }
      setSatelliteNote(null);
      setTileFail(0);
      setBasemap(kind);
    },
    [tk]
  );

  function saveKey() {
    const value = keyDraft.trim();
    if (!value) {
      return;
    }
    try {
      window.localStorage.setItem(TK_STORAGE, value);
    } catch {
      // 存不下也让它先用着：本次会话内 tk 状态里有值
    }
    setTk(value);
    setKeyPanel(false);
    setSatelliteNote(null);
    setTileFail(0);
    setBasemap("satellite");
  }

  const [stageBox, setStageBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) {
      return;
    }
    const sync = () => setStageBox({ w: el.clientWidth, h: el.clientHeight });
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stage]);

  const tiles: TileRect[] = useMemo(() => {
    if (basemap !== "satellite" || !tk || stageBox.w === 0 || stageBox.h === 0) {
      return [];
    }
    return layoutTiles(mapLayout(stageBox.w, stageBox.h));
  }, [basemap, tk, stageBox.w, stageBox.h]);

  // 一批瓦片换了就从零计数（tiles 是 memo 的，只有底图/密钥/尺寸变了才换引用）
  useEffect(() => {
    setTileFail(0);
  }, [tiles]);

  useEffect(() => {
    if (basemap !== "satellite" || tiles.length === 0) {
      return;
    }
    if (tileFail > tiles.length / 2) {
      // 多半是没网，或者密钥不对/没权限。说清楚，并切回去 —— 不留一张空白沙盘
      setSatelliteNote(
        `影像底图取不到（需要联网，且密钥要能访问天地图 img_w 服务）。已切回「分层设色」，地形照常可以塑。`
      );
      setBasemap("relief");
    }
  }, [tileFail, tiles.length, basemap]);

  /* ------------------------------ 渲染 ------------------------------ */
  const flashPos = useMemo(() => {
    if (!flash) {
      return null;
    }
    return viewRef.current?.project(flash.lon, flash.lat) ?? null;
  }, [flash]);

  const played = session ? session.placed.length : 0;
  const progressPct = total === 0 ? 0 : Math.round((played / total) * 100);

  if (stage === "lobby" || !session) {
    return (
      <div className="cr-root">
        <Lobby
          roster={roster}
          standalone={standalone}
          mode={mode}
          onMode={setMode}
          scope={scope}
          onScope={setScope}
          start={start}
          onStartMode={setStart}
          outline={outline}
          onOutline={setOutline}
          planned={plannedCount(items, scope, start)}
          total={items.length}
          basemap={basemap}
          hasKey={Boolean(tk)}
          onPickBasemap={chooseBasemap}
          onOpenKey={() => {
            setKeyDraft(tk);
            setKeyPanel(true);
          }}
          onStart={() => {
            const plan = planRound(items, scope, start);
            const s = createSession(roster, mode, plan);
            /*
             * 一进场的预置**不走隆起动画**（`instant=true`）。
             * 语义上它是"地图本来就是这样"，不是"刚刚有 23 个同学同时动手"；
             * 而且 38 张里 23 张同时播动画在教室机器上会卡一下。
             */
            const presetSet = new Set(plan.preset);
            for (const it of items) {
              if (presetSet.has(it.id)) {
                applyItem(it, true);
              }
            }
            turnStartRef.current = Date.now();
            setSession(s);
            setStage("play");
          }}
        />
        {keyPanel ? (
          <KeyPanel
            value={keyDraft}
            onChange={setKeyDraft}
            onCancel={() => setKeyPanel(false)}
            onSave={saveKey}
          />
        ) : null}
      </div>
    );
  }

  /*
   * 卡片列表的筛选。
   *
   * `本局待塑` 这一档是 v1.2.0 加的：低难度与分类专练下一进图就有十几二十张
   * 卡片是"已在图上"的，老师想快速找到还差哪几张，靠原有那几个分组按钮
   * 是找不出来的（分组是按地形类型分的，与"本局要不要塑"无关）。
   *
   * ⚠️ 这段必须放在上面那个 `!session` 的提前 return **之后**：
   * 放在前面的话 `session` 还是 `Session | null`，`isSettled(session, …)`
   * 直接过不了类型检查 —— 而 TS 报错的位置（filter 的回调里）看着
   * 跟"顺序"毫无关系，很容易查错方向。
   */
  const filtered =
    groupFilter === TODO_FILTER
      ? items.filter((it) => !isSettled(session, it.id))
      : groupFilter === "全部"
        ? items
        : items.filter((it) => it.group === groupFilter);
  const groups = [TODO_FILTER, "全部", ...AREA_GROUPS, "必考山脉", "了解性山脉"];

  return (
    <div className="cr-root">
      <div className="cr-stage" ref={stageRef}>
        {/* 影像底图铺在画布**下面**：画布在已塑形处留透明，
            于是"塑形"= 把这层米灰毛毡抠掉、露出真实影像 */}
        {tiles.length > 0 ? (
          <div className="cr-tiles" aria-hidden="true">
            {tiles.map((t) => (
              <img
                key={`${t.z}/${t.x}/${t.y}`}
                src={tiandituTileUrl(t.z, t.x, t.y, tk)}
                alt=""
                draggable={false}
                style={{
                  left: `${t.left}px`,
                  top: `${t.top}px`,
                  width: `${t.width}px`,
                  height: `${t.height}px`
                }}
                onError={() => setTileFail((n) => n + 1)}
              />
            ))}
          </div>
        ) : null}

        {/* 地图本身不接点击：介绍只能靠"放对"或"点卡片"拿到，
            否则随手点一下就把答案点出来了 */}
        <canvas ref={canvasRef} className="cr-canvas" />

        {/* 顶部：记分板（当前答题人的数字）+ 底图切换 */}
        <div className="cr-hud">
          <div className="cr-hud-item">
            <span className="cr-hud-num">{curRound?.score ?? 0}</span>
            <span className="cr-hud-label">{session.names[cur] ?? "得分"} 的得分</span>
          </div>
          <div className="cr-hud-item">
            <span className="cr-hud-num">
              {played}
              <small>/{total}</small>
            </span>
            <span className="cr-hud-label">已归位</span>
          </div>
          <div className="cr-hud-item">
            <span className="cr-hud-num">{curRound?.streak ?? 0}</span>
            <span className="cr-hud-label">连击</span>
          </div>
          <div className="cr-hud-item is-warn">
            <span className="cr-hud-num">{curRound?.wrongCount ?? 0}</span>
            <span className="cr-hud-label">放错</span>
          </div>
        </div>

        {/* 底图切换 */}
        {/*
          `is-base` 不是给样式用的，是给断言用的：下面那条「轮廓」开关复用了
          `.cr-basemap` 的外观（同一家族的两条常驻浮层），于是
          `document.querySelectorAll(".cr-basemap button")` 会把轮廓的两个按钮
          也算进"底图选项"里（回归里真发生过，读出来是 5 个按钮）。
          加上语义修饰类之后，`.cr-basemap.is-base` 只指这张底图条。
        */}
        <div className="cr-basemap is-base">
          <span className="cr-basemap-label">底图</span>
          {BASEMAPS.map((b) => (
            <button
              key={b.kind}
              type="button"
              className={basemap === b.kind ? "is-active" : ""}
              title={b.note}
              onClick={() => chooseBasemap(b.kind)}
            >
              {b.label}
              {b.online && !tk ? <em>需密钥</em> : null}
            </button>
          ))}
        </div>

        {/* 轮廓开关（v1.2.0）：相邻地块之间画不画分界线 */}
        <div className="cr-basemap cr-viewopts">
          <span className="cr-basemap-label">轮廓</span>
          <button
            type="button"
            className={outline ? "is-active" : ""}
            title="相邻地块之间画一道各自色系的分界线，看清每块地到哪儿为止"
            onClick={() => setOutline(true)}
          >
            显示
          </button>
          <button
            type="button"
            className={outline ? "" : "is-active"}
            title="不画分界线，只看地形本身的起伏与色档"
            onClick={() => setOutline(false)}
          >
            隐藏
          </button>
        </div>

        {/* 答题人条：点谁谁答（轮流模式下也能手动接管） */}
        <div className="cr-turn">
          <span className="cr-turn-mode">{mode === "relay" ? "轮流答题" : "指定答题人"}</span>
          <div className="cr-turn-chips">
            {session.order.map((id) => {
              const r = roundOf(session, id);
              return (
                <button
                  key={id}
                  type="button"
                  className={`cr-chip${id === cur ? " is-active" : ""}`}
                  onClick={() => onFocusPlayer(id)}
                  title={`切到 ${session.names[id]} 答题`}
                >
                  <b>{session.names[id]}</b>
                  <small>{r.score}</small>
                </button>
              );
            })}
          </div>
        </div>

        {/* 进度条：全班一起往一个目标走 */}
        <div className="cr-progress" aria-hidden="true">
          <i style={{ width: `${progressPct}%` }} />
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
        {flashPos ? <div className="cr-flash-ring" style={{ left: flashPos.x, top: flashPos.y }} /> : null}

        {/* 消息 */}
        {toast ? <div className={`cr-toast is-${toast.kind}`}>{toast.text}</div> : null}

        {/* 底图来源标注：影像底图必须写明出处 */}
        {basemap === "satellite" && tiles.length > 0 ? (
          <div className="cr-credit">{TIANDITU_ATTRIBUTION}</div>
        ) : null}

        {/* 影像取不到时的交代。**必须看得见** ——
            自动切回分层设色但不说话，老师只会以为"这个按钮坏了" */}
        {satelliteNote ? (
          <div className="cr-note" role="status">
            <span>{satelliteNote}</span>
            <button type="button" className="cr-link" onClick={() => setSatelliteNote(null)}>
              知道了
            </button>
          </div>
        ) : null}

        {/* 南海诸岛附图（国家地图规范要求：主图取景只到 17°N） */}
        <NanhaiInset />
      </div>

      {/* 右侧卡片栏 */}
      <aside className="cr-side">
        <div className="cr-side-head">
          <h1>山河塑形</h1>
          <p>
            {session.preset.length > 0
              ? `本局开局就已经有 ${session.preset.length} 张地形在图上，把还缺的 ${total} 张拖到正确位置。`
              : "把卡片拖到地图上正确的位置，那块地会按真实高程隆起来。"}
            {session.order.length > 1 ? "放对一张就换下一位。" : ""}
          </p>
        </div>

        <div className="cr-filters">
          {groups.map((g) => (
            <button
              key={g}
              type="button"
              className={`${groupFilter === g ? "is-active" : ""}${g === TODO_FILTER ? " is-todo" : ""}`}
              onClick={() => setGroupFilter(g)}
            >
              {g}
            </button>
          ))}
        </div>

        <div className="cr-cards">
          {filtered.map((it) => {
            const done = isPlaced(session, it.id);
            // 预置 = 已经在图上、但不是学生塑的（低难度 / 分类专练）
            const preset = !done && session.preset.includes(it.id);
            const by = done ? session.names[session.owner[it.id]] : "";
            return (
              <button
                key={it.id}
                type="button"
                className={`cr-card${done ? " is-done" : ""}${preset ? " is-preset" : ""}`}
                style={{ ["--c" as string]: it.color }}
                onPointerDown={(e) => onCardPointerDown(e, it)}
              >
                <span className="cr-card-dot" />
                <span className="cr-card-name">{it.name}</span>
                {done && by ? <em className="cr-card-tag">{by}</em> : null}
                {preset ? <em className="cr-card-tag">已在图上</em> : null}
                {!done && !preset && it.range && !it.range.core ? (
                  <em className="cr-card-tag">了解</em>
                ) : null}
                {!done && !preset && it.area ? (
                  <em className="cr-card-tag">{it.area.elevation} m</em>
                ) : null}
                {done ? <span className="cr-card-ok">✓</span> : null}
                {preset ? <span className="cr-card-ok cr-card-ok-quiet">·</span> : null}
              </button>
            );
          })}
        </div>

        <div className="cr-side-foot">
          <button
            type="button"
            className="cr-ghost-btn"
            onClick={() => {
              window.location.reload();
            }}
          >
            重新开始
          </button>
          <span className="cr-roster">
            {standalone ? "体验模式（不计积分）" : `本次参与 ${session.order.length} 人`}
          </span>
        </div>      </aside>

      {/* 介绍卡：放对了自动弹（居中），点卡片也能主动看 */}
      {infoItem ? (
        <div className="cr-sheet" role="dialog" aria-modal="true" onClick={() => setInfoItem(null)}>
          <div className="cr-sheet-card" onClick={(e) => e.stopPropagation()}>
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
                <small>实景照片待补充</small>
              </span>
            </div>
            <div className="cr-sheet-body">
              <h2>
                {infoItem.name}
                {infoItem.area ? <em>{infoItem.area.elevation} m 上下</em> : null}
                {infoItem.range && !infoItem.range.core ? <em>了解性知识</em> : null}
              </h2>
              <p>{infoItem.blurb}</p>
              {justPlaced || isSettled(session, infoItem.id) ? (
                <p className="cr-sheet-done">
                  {/*
                    预置的条目要说"开局时就在图上"，不能说"已经归位 · 下一位是某某"——
                    它既不是谁塑的，也不会推进轮次。文案跟着事实走。
                  */}
                  {isPlaced(session, infoItem.id)
                    ? `已经归位 ✓${mode === "relay" ? ` 下一位是「${session.names[cur] ?? ""}」` : ""}`
                    : "本局开局时就已经在图上 ✓"}
                </p>
              ) : (
                <button type="button" className="cr-hint-btn" onClick={onHint}>
                  在图上闪一下它的位置（{session.names[cur]} −8 分）
                </button>
              )}
            </div>
            <div className="cr-sheet-foot">
              <button type="button" className="cr-primary" onClick={() => setInfoItem(null)}>
                继续塑形
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 密钥面板 */}
      {keyPanel ? (
        <KeyPanel
          value={keyDraft}
          onChange={setKeyDraft}
          onCancel={() => setKeyPanel(false)}
          onSave={saveKey}
        />
      ) : null}

      {/* 结算 */}
      {final && !overlayHidden ? (
        <div className="cr-over">
          <div className="cr-over-card">
            <h2>中国地形已经塑好了</h2>
            <div className={`cr-over-grade is-${final.grade.key}`}>{final.grade.label}</div>
            <p className="cr-over-comment">{final.grade.comment}</p>

            {session.order.length > 1 ? (
              <table className="cr-rank">
                <thead>
                  <tr>
                    <th>名次</th>
                    <th>姓名</th>
                    <th>得分</th>
                    <th>塑成</th>
                    <th>一次答对</th>
                    <th>用时</th>
                  </tr>
                </thead>
                <tbody>
                  {final.results.map((r, i) => (
                    <tr key={r.studentId} className={i === 0 ? "is-top" : ""}>
                      <td>{i + 1}</td>
                      <td>{r.studentName}</td>
                      <td>
                        <b>{r.score}</b>
                      </td>
                      <td>
                        {r.correctCount}/{total}
                      </td>
                      <td>{r.firstTry}</td>
                      <td>{formatClock(r.timeSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <ul className="cr-over-stats">
                <li>
                  <b>{final.results[0]?.score ?? 0}</b>
                  <span>总分</span>
                </li>
                <li>
                  <b>{final.results[0]?.firstTry ?? 0}</b>
                  <span>一次答对</span>
                </li>
                <li>
                  <b>{final.results[0]?.bestStreak ?? 0}</b>
                  <span>最长连击</span>
                </li>
                <li>
                  <b>{final.results[0]?.mistakes ?? 0}</b>
                  <span>放错次数</span>
                </li>
              </ul>
            )}

            {standalone ? (
              <p className="cr-over-note">
                本次没有收到平台的学生名单，成绩只显示在这里，没有计入积分。
              </p>
            ) : null}

            <div className="cr-over-actions">
              <button type="button" className="cr-primary" onClick={() => window.location.reload()}>
                再来一轮
              </button>
              <button type="button" className="cr-ghost-btn" onClick={() => setOverlayHidden(true)}>
                先看看地图
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 轮流模式下，报一句"下一位是谁"，省得学生互相问 */
function nextHint(session: Session): string {
  if (session.mode !== "relay" || session.order.length < 2) {
    return "";
  }
  const id = currentId(session);
  return id < 0 ? "" : `，下一位 ${session.names[id] ?? ""}`;
}

function nameOf(session: Session): string {
  const id = currentId(session);
  return id < 0 ? "" : `${session.names[id] ?? ""}`;
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/* ------------------------------- 大厅 ------------------------------- */

interface LobbyProps {
  roster: PlayerInfo[];
  standalone: boolean;
  mode: PlayMode;
  onMode: (mode: PlayMode) => void;
  scope: Scope;
  onScope: (scope: Scope) => void;
  start: StartMode;
  onStartMode: (start: StartMode) => void;
  /** 轮廓开关（v1.2.0） */
  outline: boolean;
  onOutline: (outline: boolean) => void;
  /** 按当前选择，这一局要塑多少张（不含随机，所以大厅能直接报出来） */
  planned: number;
  /** 全部条目数，用来把"要塑 N 张"说完整 */
  total: number;
  basemap: BasemapKind;
  hasKey: boolean;
  onPickBasemap: (kind: BasemapKind) => void;
  onOpenKey: () => void;
  onStart: () => void;
}

/**
 * 进场先落到这里，而不是直接开塑形。
 *
 * 需求里那句「游戏刚进入时没有选择学生的这个功能」有两层：一层是
 * 平台侧要开选人页（`requiresRoster`），另一层是**游戏里也得让人看见
 * 到底谁在参与、按什么规则玩** —— 老师点完开始就进图，中途才发现
 * 模式选错了，只能整局重来。所以模式与底图的选择都放在这一屏。
 */
function Lobby({
  roster,
  standalone,
  mode,
  onMode,
  scope,
  onScope,
  start,
  onStartMode,
  outline,
  onOutline,
  planned,
  total,
  basemap,
  hasKey,
  onPickBasemap,
  onOpenKey,
  onStart
}: LobbyProps) {
  const canStart = roster.length > 0;
  const presetCount = total - planned;
  return (
    <div className="cr-lobby">
      {/*
        大厅分两层：**内容区自己滚**，底部的「开始塑形」固定不动。
        v1.2.0 加了「练习范围」「起始地图 + 轮廓」两组之后，这一屏比 v1.1.0
        高了一截 —— 在 1500×1000 的窗口里，按钮整好被挤到视口下面
        （回归跑出来的落点是 y=1006，elementFromPoint 直接返回 null）。
        对老师来说，"找不到开始按钮"是纯然的故障，所以不靠调小字号去凑，
        而是把主操作钉在底部：**加多少内容都不会再把它挤出去**。
      */}
      <div className="cr-lobby-inner">
        <header className="cr-lobby-head">
          <h1>山河塑形·中国地形</h1>
          <p>
            把四大高原、四大盆地、三大平原和 27 条山脉的卡片拖到地图上正确的位置，
            放对的地方会按真实高程塑出来。全部归位后，中国地势三级阶梯自己长出来。
            <br />
            觉得整幅空白太难，可以把「起始地图」换成随机预置 —— 图上先摆好一部分，
            只补缺的那些；想针对性训练，就把「练习范围」收成某一类。
          </p>
        </header>

      <div className="cr-lobby-grid">
        <section className="cr-lobby-box">
          <h2>本次参与学生（{roster.length} 人）</h2>
          {standalone ? (
            <p className="cr-lobby-warn">
              没有收到平台下发的学生名单，当前是体验模式 —— 可以照常玩，成绩不会计入积分。
            </p>
          ) : null}
          {roster.length === 0 ? (
            <p className="cr-lobby-warn">名单为空，无法开始。</p>
          ) : (
            <ul className="cr-lobby-roster">
              {roster.map((p) => (
                <li key={p.studentId}>
                  <b>{p.studentName}</b>
                  <small>{p.className ?? ""}</small>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cr-lobby-box">
          <h2>选择模式</h2>
          {/*
            `is-mode` 这个修饰类不是给样式用的，是给**断言**用的：
            大厅里现在有四组 `.cr-modes`（模式/范围/起始/底图），
            只靠 `:not(.is-base)` 已经分不出"模式"那一组了。
          */}
          <div className="cr-modes is-mode">
            <button
              type="button"
              className={mode === "relay" ? "is-active" : ""}
              onClick={() => onMode("relay")}
            >
              <strong>轮流答题</strong>
              <span>全班共用一张地图，放对一张就换下一位，各记各的分。</span>
            </button>
            <button
              type="button"
              className={mode === "pick" ? "is-active" : ""}
              onClick={() => onMode("pick")}
            >
              <strong>指定答题人</strong>
              <span>点谁谁答，答到换人为止，适合老师盯着一个学生过难点。</span>
            </button>
          </div>
          <p className="cr-lobby-tip">
            两种模式下都可以随时点答题人条换人；答错<strong>不换人</strong>，只是扣分 ——
            否则"答错就把难题丢给下一个人"反而成了最优解。
          </p>
        </section>

        <section className="cr-lobby-box">
          <h2>练习范围</h2>
          <div className="cr-modes is-compact is-scope">
            {SCOPES.map((sc) => (
              <button
                key={sc.scope}
                type="button"
                className={scope === sc.scope ? "is-active" : ""}
                onClick={() => onScope(sc.scope)}
              >
                <strong>{sc.label}</strong>
                <span>{sc.note}</span>
              </button>
            ))}
          </div>
          <p className="cr-lobby-tip">
            选了某一类，地图上就只有这一类是空的 —— 其余整类开局就塑好了，
            相当于把"答案"摆在旁边做对照。
          </p>
        </section>

        <section className="cr-lobby-box">
          <h2>起始地图</h2>
          <div className="cr-modes is-compact is-startmap">
            {STARTS.map((st) => (
              <button
                key={st.start}
                type="button"
                className={start === st.start ? "is-active" : ""}
                onClick={() => onStartMode(st.start)}
              >
                <strong>{st.label}</strong>
                <span>{st.note}</span>
              </button>
            ))}
          </div>
          <div className="cr-lobby-outline">
            <span className="cr-lobby-outline-label">地形轮廓</span>
            <div className="cr-seg">
              <button
                type="button"
                className={outline ? "is-active" : ""}
                onClick={() => onOutline(true)}
              >
                显示
              </button>
              <button
                type="button"
                className={outline ? "" : "is-active"}
                onClick={() => onOutline(false)}
              >
                隐藏
              </button>
            </div>
          </div>
          <p className="cr-lobby-tip">
            轮廓是相邻地块之间的一道分界线（用各自地形的色系压深），
            看得清每块地到哪儿为止；游戏里也能随时切换。
          </p>
        </section>

        <section className="cr-lobby-box">
          <h2>选择底图</h2>
          <div className="cr-modes is-base">
            {BASEMAPS.map((b) => (
              <button
                key={b.kind}
                type="button"
                className={basemap === b.kind ? "is-active" : ""}
                onClick={() => onPickBasemap(b.kind)}
              >
                <strong>
                  {b.label}
                  {b.online && !hasKey ? <em className="cr-need-key">需密钥</em> : null}
                </strong>
                <span>{b.note}</span>
              </button>
            ))}
          </div>
          <p className="cr-lobby-tip">
            游戏里也能随时切换。遥感影像来自天地图，需要联网；
            <button type="button" className="cr-link" onClick={onOpenKey}>
              {hasKey ? "修改密钥" : "填写密钥"}
            </button>
            。
          </p>
        </section>
        </div>
      </div>

      <footer className="cr-lobby-foot">
        <button type="button" className="cr-primary cr-start" disabled={!canStart} onClick={onStart}>
          开始塑形{canStart ? `（${roster.length} 人 · 本局要塑 ${planned} 张）` : ""}
        </button>
        {canStart && presetCount > 0 ? (
          <p className="cr-lobby-plan">
            开局地图上已经有 <b>{presetCount}</b> 张地形，本次只要补 <b>{planned}</b> 张
            {start === "easy" ? "（每次开局随机换一批，重开即可）" : "（范围之外的那几类已经塑好了）"}。
          </p>
        ) : null}
      </footer>
    </div>
  );
}

/* ----------------------------- 密钥面板 ----------------------------- */

function KeyPanel({
  value,
  onChange,
  onCancel,
  onSave
}: {
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="cr-sheet" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="cr-sheet-card is-key" onClick={(e) => e.stopPropagation()}>
        <div className="cr-sheet-body">
          <h2>遥感影像需要天地图密钥</h2>
          <p>
            影像底图来自「国家地理信息公共服务平台（天地图）」，这是可以商用于课堂的官方图源。
            使用前需要一份个人密钥，在
            <a href={TIANDITU_KEY_PAGE} target="_blank" rel="noreferrer">
              天地图控制台
            </a>
            免费申请后填在这里。
          </p>
          <p className="cr-lobby-tip">
            密钥只保存在本机浏览器里，<strong>不会</strong>随游戏包分发，也不会上传到任何服务器。
            没网的时候影像取不到，会自动切回分层设色，地形照常能塑。
          </p>
          <label className="cr-key-field">
            天地图密钥（tk）
            <input
              type="text"
              value={value}
              spellCheck={false}
              placeholder="粘贴 32 位密钥"
              onChange={(e) => onChange(e.target.value)}
            />
          </label>
        </div>
        <div className="cr-sheet-foot">
          <button type="button" className="cr-ghost-btn" onClick={onCancel}>
            暂时不用
          </button>
          <button type="button" className="cr-primary" onClick={onSave}>
            保存并加载影像
          </button>
        </div>
      </div>
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
