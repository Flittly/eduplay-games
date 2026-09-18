/**
 * 山河塑形 · 中国地形（v1.3.0）
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
 * - **v1.3.0** 补上缺的那一半：**图鉴**。
 *   用户的原话是「游戏内部缺乏完整体，也就是不需要答题的图鉴版本，
 *   这样学习起来更合理」—— 前面几个版本都在做"答题"，学生一进来看到的
 *   永远是一张**残缺的地图 + 一摞待答的卡片**，没有一处能让人先把
 *   38 条地形从头到尾看一遍。图鉴补的就是这一段：整幅地形一开始就全部
 *   塑好，点目录任意一条，地图上把那一块挑出来（其余压暗、它描朱红边），
 *   左下角浮出实景照片与讲解，可以逐条翻——**不答题、不计分、不上报**。
 *   放在"选择模式"里当第三种玩法，与轮流 / 指定并列。
 * - **v1.4.0** 三处课堂反馈：
 *   1. **横断山脉改成一列平行山岭**：「应该是有好几条平行的山脉，但是现在
 *      是指一条」。它现在由 5 条南北向的岭组成（`RangeDef.lines`），
 *      塑形与落点判定都按"到**最近那一条**的距离"算。注意地图上只标
 *      "横断山脉"一个名字、不逐条点名 —— 为了让 5 条岭在 11.9 km 的网格上
 *      真能看出缝隙，它们的间距被摊开到了 0.85°，与课本位置的经度有偏差，
 *      逐条命名反而会变成"某个名字标错地方"的教学错误；
 *   2. **浅色地形底图**：整幅按真实高程画淡彩，塑形＝由淡转浓。
 *      未塑形区取的是**真实高程**而不是塑形后的高度场，所以形状与塑好之后
 *      完全重合，差别只在浓淡；
 *   3. **地名标注 + 开关**：放对之后那一条的名字浮出来（舞台与大厅各一个
 *      开关）。名字画在 `drawImage` 之后，白描边 + 深字，按数组顺序贪心避让。
 * - **v1.5.0** 用户否掉了 v1.4.0 那层白：那层"淡彩"是把颜色一起向白插值，
 *   属于**等比例压缩色差**（陆地 ×0.38），七档色于是全挤进灰白区间 ——
 *   而分层设色靠的正是色相差异，等于把这张底图的核心信息抹了。
 *   现在 `soft` 未塑形区**直接用原色**，塑形的反馈从"由淡转浓"换成
 *   **"浮出档界描边与明暗"**；底图相应改名 `浅色地形` → `原色地形`。
 *   实测数字与取舍见 `terrain.ts` 的「原色地形底图」一段。
 * - **v1.5.1** 只动摆放，不动玩法：三条常驻浮层（底图 / 轮廓 / 名称）从舞台
 *   右上角搬到左下角 —— 用户的原话是「左下角的空地比较多」（那一块是海，
 *   取景里根本没有陆地）。**图鉴模式例外**：左下角要留给知识卡，卡片底下
 *   那行「上一条 / 下一条 / 关闭」正好压在按钮条的位置上，所以按模式分角落，
 *   见 `styles.css` 的 `.cr-corner`。
 *   顺带解开一个一直没人量过的别扭：三条原本各自写死 `top: 14 / 64 / 108`，
 *   而那个行高是**估**的 44px —— 真机实测三条高 48 / 35 / 35（只有「底图」
 *   那条多一行「需密钥」），算下来实际行距是 **2px 与 9px**（`64-(14+48)`、
 *   `108-(64+35)`），一紧一松。位置改归容器的 flex 列管之后，行距才真的均匀。
 *   （这两个数是「同一份产物、只注入旧摆位样式」的受控 A/B 量出来的，
 *   见脚手架 `ab.js` + `ab-report.json`。）
 * - **v1.5.2** 撤掉 v1.5.1 那个"图鉴例外"：图鉴里三条浮层也搬到左下角 ——
 *   用户的原话是「图鉴的选择的按钮栏没有修改，请你可以放到左下角」。
 *   这次不是让按钮条继续躲，而是**让卡片往上让**：真机实测三条浮层总高 130
 *   （48 / 35 / 35 + 2×6 间隙）、底距 38，加 8px 气口 ⇒ 卡片底边从"贴底 18px"
 *   抬到"离底 176px"，正好落在浮层顶边之上（见 `--cr-corner-reserve`）。
 *   卡片本身一字未改：实测高 503，上移后占 y 321~824，上方顶栏底在 72、
 *   下方浮层顶在 832，两头都不碰。
 *   让卡片而不是让按钮条 —— 卡片是**内容**、按钮条是**常驻控件**，
 *   控件换个角落没有信息损失。顺带把两者的左边缘对齐到同一条线（18px）。
 *
 * - **v1.5.3** 地图开始接点击，但**只接"已经在图上的"**。
 *   用户的反馈是「图鉴以及答题的时候点击地图上的地理要素不会出现介绍的弹窗」，
 *   答题侧的前提是「已经将要素放对了位置……地图上已经有对的要素和文字」——
 *   这两句合起来正好是一条现成的判据（`isSettled` = 学生放对的 + 本局预置的），
 *   而图鉴的会话把 38 条全设成了预置，所以图鉴那一侧不需要第二个分支。
 *   v1.5.2 及以前画布**完全不接**点击，怕的是"随手点一下就把答案点出来" ——
 *   这条顾虑只对**还没塑出来**的要素成立（米灰处本来就看不出是什么），
 *   按 `isSettled` 一过滤，两边都保住了。
 *   命中规则在 `pick.ts`，纯逻辑、有 Node 回归：山脉用 `geo.ts` 的
 *   `corridorHalfDeg()`（与塑形**同一个数**）、地形区用区域归属位图 ——
 *   于是"看得见的色块 / 点得中的范围 / 拖上去算对的范围"三处同源。
 *   顺带给画布加了 `.is-pickable` 手型：点了没反应与点在空白处在画面上
 *   一模一样，老师很容易以为这个功能没生效。
 *
 * 状态机在 `session.ts`，底图在 `basemap.ts`，本局计划在 `plan.ts`，
 * 地名候选表在 `labels.ts`，地图命中在 `pick.ts`，五个都是纯逻辑、可 Node 回归。
 * 图鉴的地图状态也是 `session.ts` 里的 `createAtlasSession`
 * （一份退化到极点的会话，见那里的注释）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pickLabels } from "./labels";
import { pickFeature } from "./pick";
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
  RIDGE_LIFT_FADE_DEG,
  RIDGE_LIFT_HALF_DEG,
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
  createAtlasSession,
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
import {
  createTerrainView,
  outlineRGB,
  type LabelDef,
  type SceneView,
  type TerrainView
} from "./terrain";
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
/*
 * 走带走廊的半宽与渐隐（`RIDGE_LIFT_HALF_DEG` / `RIDGE_LIFT_FADE_DEG`）
 * v1.5.3 起定义在 `geo.ts`，这里导入 —— 因为地图点击的**命中判定**要用同一个数
 * （见 `pick.ts` 的文件头：能点中的范围必须等于画出来的范围）。
 * 别在本地再写一份：两份数走偏的样子是静默的。
 */
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

/**
 * 大厅里能选的三件事：两种答题方式 + 图鉴（v1.3.0）。
 *
 * 图鉴不是第三种答题方式，所以它不是 `PlayMode` 的成员（理由见下方 `stage` 的注释）。
 */
type LobbyPick = PlayMode | "atlas";

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
  /**
   * 三个舞台：大厅 / 答题 / 图鉴。
   *
   * 图鉴（v1.3.0）与另外两个**不是并列的"玩法"，而是并列的"阶段"**：
   * `relay` / `pick` 是答题时的两种换人规则，图鉴根本不答题。
   * 要是把图鉴塞进 `PlayMode`，`session.mode` 这个"谁来答"的字段就多出
   * 一个"没人答"的取值，下面每一处 `mode === "relay"` 都得重新想一遍。
   * 所以图鉴在这一层是 stage，它的会话由 `createAtlasSession` 造。
   */
  const [stage, setStage] = useState<"lobby" | "play" | "atlas">("lobby");
  const [mode, setMode] = useState<LobbyPick>("relay");
  const [session, setSession] = useState<Session | null>(null);
  /** 图鉴舞台：整幅地形都在图上、谁也不用答 */
  const atlas = stage === "atlas";
  /**
   * "现在是不是图鉴"的镜像。
   *
   * 给指针事件与键盘那两条 `window` 监听用：它们要判断模式，
   * 但把 `stage` 放进依赖会让每次进/出大厅都把监听重装一遍 —— 没必要，
   * 而重装窗口期内的事件会丢（这类"丢在重装的缝里"的交互极难复现）。
   *
   * ⚠️ 名字不能叫 `stageRef`：下面那个 DOM 引用（舞台 `div`）已经占了这名字，
   * 撞名之后 `stageRef.current.clientWidth` 会读成 `"atlas".clientWidth`。
   */
  const atlasRef = useRef(atlas);
  atlasRef.current = atlas;
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
   * 地名标注开关（v1.4.0）。默认**开** —— 用户要的就是"放对了能看见名字"，
   * 默认关掉等于这个功能没做。
   */
  const [showLabels, setShowLabels] = useState(true);
  /**
   * 标签避让的**优先级第一位**：刚放对的那一条 / 图鉴里刚点开的那一条。
   *
   * 38 个地名在东部密集区会互相压住，而被压住的直接不画（见 terrain.ts 的
   * `drawLabels`）。所以"谁排第一"是有意义的：学生刚把卡片放对，那一块的
   * 名字**必须**出现 —— 否则"放对了"的反馈就被邻居的名字吃掉了。
   */
  const [labelPriority, setLabelPriority] = useState<string | null>(null);
  /**
   * 图鉴里"现在在看哪一条"（条目 tag，0 = 没有聚焦）。
   *
   * 与 `drag` / `toast` 这类纯 UI 状态不同，这个值要传进渲染层（`sceneRef.focus`），
   * 因为它的作用就是把那一块地从整幅图里**挑**出来（其余压暗、它描朱红边）。
   * 答题模式下恒为 0 —— 那边点开卡片是"看看这玩意儿是什么"，
   * 地图突然暗下来会像出了故障。
   */
  const [focusTag, setFocusTag] = useState(0);
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
  /**
   * 指针此刻是不是停在"能点开的要素"上（v1.5.3）。
   *
   * 只用来给画布切光标（`.cr-canvas.is-pickable`）—— 点了没反应和"点在空白处"
   * 在画面上长得一模一样，老师很容易以为这个功能没生效。手型是唯一的提示。
   * 它跟着同一个 `hitTest` 走，所以不会出现"光标是手型却点不开"。
   */
  const [pickable, setPickable] = useState(false);
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
    // 图鉴也要这块画布（v1.3.0），所以只排除"停在大厅"这一种情况
    if (stage === "lobby") {
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

  /**
   * 图鉴聚焦（v1.3.0）：与轮廓开关是同一类问题 ——
   * 静止时 rAF 循环什么都不做，没人通知视图。
   * 这里改的是 `sceneRef.current.focus` 这个可变字段（不是 React 树上的东西），
   * 所以不能指望"重渲染顺带重画"，必须显式刷一次。
   */
  useEffect(() => {
    sceneRef.current.focus = focusTag;
    viewRef.current?.refresh(data.alt, lift, add, false, basemapRef.current, sceneRef.current);
  }, [focusTag, data, lift, add]);

  /**
   * 地名标注的数据（v1.4.0）。
   *
   * 规则（谁被标、什么顺序、怎么去重）全在 `labels.ts` 的 `pickLabels` 里 ——
   * 放那儿是为了能被 node 测试覆盖，那些规则坏掉的样子截图看不出来。
   * 这里只把 `Item` 压成它要的那几个字段。
   *
   * 一句话复述那条最容易搞错的规则：判据是 **`isSettled`（已经在图上）**
   * 而不是 `isPlaced`（学生自己放的）。图鉴与分类专练里大量条目是预置的，
   * 按 isPlaced 过滤会让图鉴一个名字都没有 —— 而图鉴恰恰最需要名字。
   */
  const labelList = useMemo<LabelDef[]>(() => {
    if (!session) {
      return [];
    }
    return pickLabels(
      items.map((it) => ({
        id: it.id,
        name: it.name,
        anchor: it.area ? it.area.anchor : it.range ? it.range.anchor : null,
        // 山脉细长，字小一档 —— 免得一条 50 km 宽的脉被三个大字整个压住
        scale: it.kind === "area" ? 1 : 0.86
      })),
      (id) => isSettled(session, id),
      labelPriority
    );
  }, [items, session, labelPriority]);

  /**
   * 地名标注：与轮廓 / 聚焦同一类问题 —— 静止时 rAF 什么都不做，没人通知视图。
   * 同样写在 `sceneRef.current` 这个可变对象上（和 owner / outline / focus 一致）。
   */
  useEffect(() => {
    sceneRef.current.labels = showLabels ? labelList : [];
    viewRef.current?.refresh(data.alt, lift, add, false, basemapRef.current, sceneRef.current);
  }, [showLabels, labelList, data, lift, add]);

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
   * 由**一条或一列**山脉折线生成两份场：
   *   `add`  —— 米，沿脊线的高斯叠加（挑出脊线）
   *   `lift` —— 0..1，走带走廊的塑形遮罩（把真实 DEM 放出来）
   * 两者都在**同一个包围盒**里算，不然 480×358 的网格上会白跑十几万次距离计算。
   *
   * v1.4.0：横断山脉是**一列平行山岭**，所以这里收的是 `lines`（多条）。
   * 关键在"每格取到**最近那一条**的距离"：
   *   · 取最近 ⇒ 得到一组各自独立的平行走廊，岭与岭之间的河谷留在走廊外（对的）；
   *   · 只按主脊算 ⇒ 另外 4 条岭根本不出现；
   *   · 若改成"把走廊整体拉宽到能盖住 5 条"⇒ 岭之间的低地也一起隆起，
   *     整片变成一块高原面，"一列平行山岭"就白改了。
   *
   * `halfDeg` 是走廊半宽，普通山脉用默认的 `RIDGE_LIFT_HALF_DEG`；
   * 横断山脉由数据带 `lift_half_deg: 0.20` 单独收窄 —— 理由见下面 liftPad 那行。
   */
  const buildRidge = useCallback(
    (lines: [number, number][][], halfDeg: number = RIDGE_LIFT_HALF_DEG) => {
      const addField = new Float32Array(N);
      const liftField = new Float32Array(N);
      const pad = Math.max(RIDGE_SIGMA_DEG * 3, halfDeg + RIDGE_LIFT_FADE_DEG);
      let lo = Infinity;
      let hi = -Infinity;
      let la = Infinity;
      let ha = -Infinity;
      for (const line of lines) {
        for (const [x, y] of line) {
          lo = Math.min(lo, x);
          hi = Math.max(hi, x);
          la = Math.min(la, y);
          ha = Math.max(ha, y);
        }
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
      // ⚠️ `pad` 只是**循环范围**，取 max(sigma×3, ...) = 0.72°，比走廊本身大；
      // 多扫出来的那些格子 mask 恒为 0、值也写成 0，等于没塑。
      // 真正决定"一条走廊有多宽"的是下面这个 liftPad，不是 pad。
      //
      // 走廊覆盖 ±(halfDeg + FADE)。默认 0.42+0.08 = ±0.50°，
      // 而横断山脉 5 条岭只隔 1.10° ⇒ 按默认半宽相邻走廊会重叠、
      // 5 条糊成一整块。数据里的 `lift_half_deg: 0.20` 把它收到 ±0.28°，
      // 相邻走廊之间才留得下约 0.41°（经度口径）的河谷缝隙：
      //   距离先乘 lonScale(cos36°=0.809) 再比，南北向的岭等距线是东西向的
      //   ⇒ 经度方向覆盖 = (0.20+0.08)/0.809 = 0.346°（单边），
      //     1.10 − 2×0.346 = 0.408°。换算成屏幕像素见 README。
      const liftPad = halfDeg + RIDGE_LIFT_FADE_DEG;
      for (let j = j0; j <= j1; j++) {
        const lat = CHINA_DEM.lat1 - (j / (GRID_H - 1)) * (CHINA_DEM.lat1 - CHINA_DEM.lat0);
        for (let i = i0; i <= i1; i++) {
          const k = j * GRID_W + i;
          if (!data.land[k]) {
            continue;
          }
          const lon = CHINA_DEM.lon0 + (i / (GRID_W - 1)) * (CHINA_DEM.lon1 - CHINA_DEM.lon0);
          // 到**最近那一条**岭的距离 —— 见 buildRidge 上方的注释。
          // 一行山岭时这就是原来那个数，多条时才是关键。
          let d = Infinity;
          for (const line of lines) {
            const dd = distToPolyline(lon, lat, line);
            if (dd < d) {
              d = dd;
            }
          }
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
        // 一列平行山岭（横断山脉）走 lines，其余山脉只有一条 line。
        // 走廊半宽同理：只有横断山脉的数据里带了 `lift_half_deg`。
        const { addField, liftField } = buildRidge(
          item.range.lines ?? [item.range.line],
          item.range.lift_half_deg ?? RIDGE_LIFT_HALF_DEG
        );
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

  /**
   * 把整块沙盘清空（高度场 + 动画目标 + 归属图 + 聚焦）。
   *
   * 从图鉴回大厅时**必须**清。图鉴把 38 条全塑上了，`liftTarget` 全是 1，
   * 于是紧接着开一局"空白地图"会出现这样一幕：地图看上去**已经塑好了**，
   * 而进度写着 0/38 —— 学生看到的是"这块地本来就长这样"，
   * 而上色用的那个判据（`lift > 0` ⇒ 已塑形）已经和事实脱钩了。
   * 判据一脱钩，地图就不再是"学生塑出来的记录"，后面的教学就无从谈起。
   *
   * （注意这跟 `#restart` 用 `location.reload()` 是两条路：从图鉴出来不刷新页面，
   *   因为平台下发的名单是**一次性**的，刷掉之后不一定还会再发一遍。）
   */
  const resetTerrain = useCallback(() => {
    lift.fill(0);
    liftTarget.fill(0);
    add.fill(0);
    addTarget.fill(0);
    ownerGrid.fill(0);
    setFocusTag(0);
    sceneRef.current.focus = 0;
    viewRef.current?.refresh(data.alt, lift, add, false, basemapRef.current, sceneRef.current);
  }, [lift, liftTarget, add, addTarget, ownerGrid, data]);

  /**
   * 打开介绍卡：`justPlaced=true` 表示这次是"放对了自动弹"。
   *
   * 图鉴下"点开一条"就等于"把它从图上挑出来"，所以顺带设置聚焦；
   * 答题模式下不设 —— 那边点卡片只是看看这是什么，地图突然暗下来像故障。
   */
  const openIntro = useCallback(
    (item: Item, justPlacedNow: boolean) => {
      setJustPlaced(justPlacedNow);
      setInfoItem(item);
      // 标签避让的优先级第一位：这次点开（或刚放对）的那一条必须先出名字
      setLabelPriority(item.id);
      if (atlasRef.current) {
        setFocusTag(itemIndex.get(item.id) ?? 0);
      }
    },
    [itemIndex]
  );

  /**
   * 关掉介绍卡。
   *
   * ⚠️ 图鉴下**刻意不清掉聚焦**：实际的翻看顺序常常是"点一条看它是什么 →
   * 关掉卡片 → 对着地图看它的形状"。关卡片顺手取消聚焦的话，每看一条
   * 都得重新点一次。要取消聚焦有专门的地方（顶栏里那条"取消聚焦"）。
   */
  const closeIntro = useCallback(() => {
    setInfoItem(null);
  }, []);

  /** 当前知识卡在完整目录里的下标（−1 = 没开卡）。翻页按**完整目录**走，不按筛选结果 */
  const infoIdx = infoItem ? items.findIndex((it) => it.id === infoItem.id) : -1;

  /**
   * 图鉴翻页：上一条 / 下一条，首尾相接。
   *
   * 走 `items`（完整 38 条）而不是侧栏当前筛选出来的那几条：图鉴的用法是
   * "从第一条翻到最后一条通读一遍"，中途在"只练山脉"里翻页翻到边界会莫名其妙地跳回开头。
   * 翻页同时改聚焦 —— 卡片换到哪一条，地图上就跟着亮哪一条。
   */
  const stepIntro = useCallback(
    (delta: number) => {
      if (!infoItem || items.length === 0) {
        return;
      }
      const i = items.findIndex((it) => it.id === infoItem.id);
      if (i < 0) {
        return;
      }
      const next = items[(i + delta + items.length) % items.length];
      setInfoItem(next);
      setFocusTag(itemIndex.get(next.id) ?? 0);
    },
    [infoItem, items, itemIndex]
  );

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

  /* ------------------------- 地图上的点击（v1.5.3） ------------------------- */

  /**
   * 这一下点在哪一条要素上。**候选只有"此刻已经在图上的"**。
   *
   * 答题模式：`isSettled` = 学生放对的 + 本局预置的 —— 也就是老师说的
   * "已经填好、图上已经有对的要素和文字"的那些。
   * 图鉴模式：`createAtlasSession` 把 38 条全设成了预置，同一句 `isSettled`
   * 自然全真 ⇒ **两条需求共用一个判据**，不需要为图鉴写第二个分支。
   *
   * ⚠️ 这条过滤就是产品的安全边界，不是性能优化：图上还是米灰的地方点下去
   * 必须一点反应都没有，否则随手把地图点一遍就能把 38 条的名称全问出来。
   * v1.5.2 及以前正是因为这个顾虑让画布**完全不接**点击（见 canvas 上的注释），
   * 代价是"想再看一眼刚才放对的那块"也只能去右侧卡片栏里找。
   * 判定规则本身在 `pick.ts`（纯逻辑、有 Node 回归），这里只做"排除不能点的"。
   */
  const hitTest = useCallback(
    (clientX: number, clientY: number): Item | null => {
      const s = sessionRef.current;
      const ll = s ? viewRef.current?.pick(clientX, clientY) : null;
      if (!s || !ll) {
        return null;
      }
      const cand = items.filter((it) => isSettled(s, it.id));
      return pickFeature(ll.lon, ll.lat, cand, data.region)?.item ?? null;
    },
    [items, data]
  );

  /**
   * 画布上的点击。
   *
   * 用**原生 click** 而不是自己记 pointerdown/up：click 的语义正是
   * "同一点按下又抬起"（浏览器自己带几像素的容差），所以
   *   · 把卡片拖到地图上松手 —— 按下发生在卡片上，click 根本不会派到画布；
   *   · 学生想拖动地图（不支持）而划了一下 —— 不产生 click。
   * 这两种情况都不用我判"移动了多少像素"，也就没有阈值要调。
   */
  const onMapClick = useCallback(
    (event: React.MouseEvent) => {
      const it = hitTest(event.clientX, event.clientY);
      if (it) {
        // `false` = 学生主动点开的（`true` 是"放对了自动弹"）
        openIntro(it, false);
      }
    },
    [hitTest, openIntro]
  );

  /** 光标反馈：指到能点开的要素上给手型。拖卡片时不算（这时指针在"搬东西"） */
  const onMapHover = useCallback(
    (event: React.PointerEvent) => {
      if (dragRef.current) {
        setPickable(false);
        return;
      }
      setPickable(hitTest(event.clientX, event.clientY) !== null);
    },
    [hitTest]
  );

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

  /**
   * 介绍卡的键盘操作。
   *
   * ESC 关闭：38 张卡片逐张弹出来，不关会很打断节奏。
   * 图鉴下另接左右方向键翻页 —— 那儿的用法本来就是"一条接一条地过"，
   * 手不必在键盘和卡片之间来回跑。**答题模式不接**方向键：
   * 那边讲的是"刚塑好的这一条"，能翻到别的条目上去反而乱了。
   */
  useEffect(() => {
    if (!infoItem) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeIntro();
        return;
      }
      if (!atlasRef.current) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepIntro(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        stepIntro(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [infoItem, closeIntro, stepIntro]);

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
  /**
   * 图鉴当前聚焦的那一条。
   *
   * `focusTag` 就是 `itemIndex` 里的那个 tag（下标 + 1），所以反查是
   * `items[tag - 1]` —— 与 `applyItem` 写归属图用的是同一套编号，
   * 不会出现"顶栏写着青藏高原、地图上亮的是塔里木"这种错位。
   */
  const focusItem = focusTag > 0 ? items[focusTag - 1] ?? null : null;

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
          labels={showLabels}
          onLabels={setShowLabels}
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
            if (mode === "atlas") {
              /*
               * 图鉴：38 条一次性全部落位，而且走 `instant` ——
               * 一进门看到的就该是"整幅中国地形在这里"，而不是看着它自己长出来。
               * 会话由 `createAtlasSession` 造（全预置 / 零待塑 / 无人），
               * 于是"点了就有讲解、但拖不动、也不会算分"这三件事
               * 全部由既有规则自然得到，图鉴这一层没有自己的计分或交互代码。
               */
              for (const it of items) {
                applyItem(it, true);
              }
              setSession(createAtlasSession(items.map((it) => it.id)));
              setStage("atlas");
              return;
            }
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
  const groups = atlas
    ? // 图鉴里没有「本局待塑」这一档：38 条全在图上，那一档永远是空的，
      // 留着它只会让人点进去看到一片空白，还以为游戏坏了
      ["全部", ...AREA_GROUPS, "必考山脉", "了解性山脉"]
    : [TODO_FILTER, "全部", ...AREA_GROUPS, "必考山脉", "了解性山脉"];

  return (
    <div className="cr-root">
      {/*
        `is-atlas` 这个标记 v1.5.1 是"给三条浮层换角落"用的（图鉴里挪回右上）。
        v1.5.2 起图鉴里也搬到左下角了，标记**仍然要留** —— 它现在只用来把浮层的
        左边距对齐到知识卡（卡片 `margin-left: 18px`，浮层跟着 `left: 18px`），
        见 styles.css 的 `.cr-stage.is-atlas .cr-corner`。
      */}
      <div className={`cr-stage${atlas ? " is-atlas" : ""}`} ref={stageRef}>
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

        {/*
          地图的点击（v1.5.3）。

          v1.5.2 及以前这里刻意**不接**任何点击：介绍的入口只有"放对自动弹"和
          "点右侧卡片"两个，理由是"随手点一下就把答案点出来了"。这个顾虑是真的，
          但它只对**还没塑出来的**要素成立 —— 图上是米灰的地方本来就看不出是什么，
          点它当然也不该有反应。所以这一版把入口开在"点到的必须是已经在图上的
          那一条"上（`hitTest` 里按 `isSettled` 过滤）：能点开的只有学生自己
          放对的、和本局预置的，没有一条是新信息。于是"想再看一眼刚才放对的那块"
          不必再去卡片栏里翻，而地图上任何一处空白点下去仍然毫无反应。

          用 click 不用自己记 down/up：语义就是"同一点按下又抬起"，
          拖卡片松手不会走到这儿（见 `onMapClick`）。
        */}
        <canvas
          ref={canvasRef}
          className={`cr-canvas${pickable ? " is-pickable" : ""}`}
          onClick={onMapClick}
          onPointerMove={onMapHover}
          onPointerLeave={() => setPickable(false)}
        />

        {/* 顶部：答题模式是记分板，图鉴模式是"现在看的是哪一条" */}
        {atlas ? (
          <div className="cr-hud is-atlas">
            <div className="cr-hud-item">
              <span className="cr-hud-num">
                {focusItem ? focusTag : items.length}
                <small>/{items.length}</small>
              </span>
              <span className="cr-hud-label">图鉴条目</span>
            </div>
            <div className="cr-hud-item is-hint">
              <span className="cr-hud-atlas-hint">
                {focusItem
                  ? `正在看「${focusItem.name}」—— 地图上亮着的那块就是它`
                  : "整幅中国地形都已经在图上。点右侧目录任意一条，地图上会把它挑出来。"}
              </span>
              {focusItem ? (
                <button type="button" className="cr-link" onClick={() => setFocusTag(0)}>
                  取消聚焦
                </button>
              ) : null}
            </div>
          </div>
        ) : (
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
        )}

        {/* 底图切换 */}
        {/*
          `is-base` 不是给样式用的，是给断言用的：下面那条「轮廓」开关复用了
          `.cr-basemap` 的外观（同一家族的两条常驻浮层），于是
          `document.querySelectorAll(".cr-basemap button")` 会把轮廓的两个按钮
          也算进"底图选项"里（回归里真发生过，读出来是 5 个按钮）。
          加上语义修饰类之后，`.cr-basemap.is-base` 只指这张底图条。
        */}
        {/*
          舞台左下角那三条常驻浮层（底图 / 轮廓 / 名称），v1.5.1 起由这个容器统一摆位。

          两种模式都贴在左下角：那一片是海，原本空着；右上角则挤着三条。
          v1.5.1 图鉴里是例外（左下角归知识卡），v1.5.2 起图鉴里也搬过来了 ——
          让位的是**卡片**：它往上抬 176px，正好落在浮层顶边之上，见 styles.css
          的 `--cr-corner-reserve`。让卡片而不是让按钮条，是因为卡片是内容、
          按钮条是常驻控件，换个角落没有信息损失。

          定位写在容器上、不写在每一条上：三条的高度会变（「遥感影像」有密钥时
          少显示一行「需密钥」），各自写死 `top` 迟早对不齐。flex 列排就不用管。
        */}
        <div className="cr-corner">
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

          {/*
            名称开关（v1.4.0）：已经在图上的地形标不标名字。

            ⚠️ 容器类名**故意不带 `cr-viewopts`**：回归探针分别按
            `.cr-viewopts button` / `.cr-labelopts button` 数这两组开关，
            类名一并就会互相蹭（`outlineButtons()` 当场数出 4 个按钮）。

            这两个类为什么非得分开，有个真实来历：v1.5.0 及以前三条浮层
            各自写死 `top` 摆位，两条开关只要给了同一个 `top` 就**完全重叠**，
            DOM 里靠后的名称开关整个压住轮廓开关、轮廓**点不动** ——
            回归里点「轮廓:隐藏」时 `elementFromPoint` 拿到的是名称开关才暴露，
            光看截图看不出"点了没反应"。v1.5.1 起位置归 `.cr-corner` 的 flex 列管，
            重叠在结构上已不可能，但上面那条断言还在按类名查，所以别合并。

            按钮文案也刻意不叫「显示 / 隐藏」：两组同名按钮并排摆着，
            老师分不清哪个管轮廓、哪个管名字。
          */}
          <div className="cr-basemap cr-labelopts">
            <span className="cr-basemap-label">名称</span>
            <button
              type="button"
              className={showLabels ? "is-active" : ""}
              title="在图上的地形上标出它的名字 —— 放对一块就出现一块的名字"
              onClick={() => setShowLabels(true)}
            >
              标注
            </button>
            <button
              type="button"
              className={showLabels ? "" : "is-active"}
              title="不标名字，地图更干净（比如拿它当提问用）"
              onClick={() => setShowLabels(false)}
            >
              不标
            </button>
          </div>
        </div>

        {/*
          答题人条与进度条只在答题模式出现（v1.3.0）。
          图鉴里没有答题人、也没有进度 —— 留着会让人以为"这一局还没开始"。 */}
        {atlas ? null : (
          <>
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
          </>
        )}

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
          <h1>{atlas ? "中国地形图鉴" : "山河塑形"}</h1>
          <p>
            {atlas
              ? "整幅地形都已经在图上。点任意一条，地图上会把那一块挑出来，左下角给出实景照片与讲解。图鉴不答题、不计分。"
              : session.preset.length > 0
                ? `本局开局就已经有 ${session.preset.length} 张地形在图上，把还缺的 ${total} 张拖到正确位置。`
                : "把卡片拖到地图上正确的位置，那块地会按真实高程隆起来。"}
            {!atlas && session.order.length > 1 ? "放对一张就换下一位。" : ""}
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
            /*
             * ⚠️ 图鉴下 `done` / `preset` 一律按假处理。
             *
             * 图鉴的 `preset` 是全部 38 条 —— 那只是它承载地图状态的方式
             * （见 session.ts 的 createAtlasSession），照着渲染就会每张卡片
             * 都挂着「已在图上」。而"在不在图上"在图鉴里恰恰是句废话：全都在。
             * 同理也不能给图鉴的卡片画 ✓。
             */
            const done = !atlas && isPlaced(session, it.id);
            const preset = !atlas && !done && session.preset.includes(it.id);
            const by = done ? session.names[session.owner[it.id]] : "";
            /** 全局序号（1..38），与顶栏"图鉴 n/38"共用 `itemIndex` 的编号 */
            const seq = itemIndex.get(it.id) ?? 0;
            return (
              <button
                key={it.id}
                type="button"
                className={`cr-card${done ? " is-done" : ""}${preset ? " is-preset" : ""}${
                  atlas ? " is-atlas" : ""
                }${atlas && seq === focusTag ? " is-current" : ""}`}
                style={{ ["--c" as string]: it.color }}
                onPointerDown={(e) => onCardPointerDown(e, it)}
              >
                <span className="cr-card-dot" />
                <span className="cr-card-name">{it.name}</span>
                {atlas ? <em className="cr-card-tag">#{seq}</em> : null}
                {done && by ? <em className="cr-card-tag">{by}</em> : null}
                {preset ? <em className="cr-card-tag">已在图上</em> : null}
                {!atlas && !done && !preset && it.range && !it.range.core ? (
                  <em className="cr-card-tag">了解</em>
                ) : null}
                {!atlas && !done && !preset && it.area ? (
                  <em className="cr-card-tag">{it.area.elevation} m</em>
                ) : null}
                {done ? <span className="cr-card-ok">✓</span> : null}
                {preset ? <span className="cr-card-ok cr-card-ok-quiet">·</span> : null}
              </button>
            );
          })}
        </div>

        <div className="cr-side-foot">
          {atlas ? (
            <button
              type="button"
              className="cr-primary cr-atlas-go"
              onClick={() => {
                /*
                 * 出口：图鉴不是终点，看完得能接着去答题。
                 *
                 * 三件事都得做，缺一件这一屏就不成立：
                 *   ① 清空沙盘（理由见 resetTerrain）—— 不清的话，接着开的那一局
                 *      「空白地图」一进去就是满的；
                 *   ② 把模式切回**轮流答题**。不改的话按钮上仍写着「进入图鉴」，
                 *      点下去又进图鉴，而这一颗按钮明明叫「去答题」；
                 *   ③ 筛选档回到「全部」（图鉴里没有「本局待塑」那一档，
                 *      不自查的话切回去会停在一个不存在的档上，列表整个空掉）。
                 */
                resetTerrain();
                setMode("relay");
                setGroupFilter("全部");
                setStage("lobby");
              }}
            >
              去答题
            </button>
          ) : (
            <button
              type="button"
              className="cr-ghost-btn"
              onClick={() => {
                window.location.reload();
              }}
            >
              重新开始
            </button>
          )}
          <span className="cr-roster">
            {atlas
              ? "图鉴模式：不答题、不计分"
              : standalone
                ? "体验模式（不计积分）"
                : `本次参与 ${session.order.length} 人`}
          </span>
        </div>      </aside>

      {/*
        介绍卡。两种形态（v1.3.0）：
        - 答题模式：居中模态（放对了自动弹 / 点卡片主动看）。遮住地图没关系 ——
          学生这时该看的是讲解，不是地图；
        - 图鉴模式：浮在地图左下角的"知识卡"、无遮罩。图鉴的重点恰恰是
          "一边对着地图看它在哪、一边读它是什么"，居中模态会把刚聚焦出来的
          那一块正好压住（中国地图铺满整个舞台，居中卡片盖的是中原一带）。
      */}
      {infoItem ? (
        <div
          className={`cr-sheet${atlas ? " is-atlas" : ""}`}
          role="dialog"
          aria-modal={atlas ? undefined : true}
          onClick={closeIntro}
        >
          <div className="cr-sheet-card" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="cr-sheet-close" onClick={closeIntro}>
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
                {atlas ? (
                  <em className="cr-sheet-seq">
                    第 {infoIdx + 1} / {items.length} 条
                  </em>
                ) : null}
              </h2>
              <p>{infoItem.blurb}</p>
              {atlas ? (
                /* 图鉴里不报"归位没归位"（全都在图上，说了是句废话），
                   改为报"它属于哪一类、在地图上怎么认出它" */
                <p className="cr-sheet-done">
                  {infoItem.area
                    ? `${infoItem.group} · 典型海拔 ${infoItem.area.elevation} m`
                    : `${infoItem.group} · 地图上那圈红边就是它的走向`}
                </p>
              ) : justPlaced || isSettled(session, infoItem.id) ? (
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
              {atlas ? (
                <>
                  <button type="button" className="cr-ghost-btn" onClick={() => stepIntro(-1)}>
                    ‹ 上一条
                  </button>
                  <button type="button" className="cr-ghost-btn" onClick={() => stepIntro(1)}>
                    下一条 ›
                  </button>
                  <button type="button" className="cr-primary" onClick={closeIntro}>
                    关闭
                  </button>
                </>
              ) : (
                <button type="button" className="cr-primary" onClick={closeIntro}>
                  继续塑形
                </button>
              )}
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
  mode: LobbyPick;
  onMode: (mode: LobbyPick) => void;
  scope: Scope;
  onScope: (scope: Scope) => void;
  start: StartMode;
  onStartMode: (start: StartMode) => void;
  /** 轮廓开关（v1.2.0） */
  outline: boolean;
  onOutline: (outline: boolean) => void;
  /** 地名标注开关（v1.4.0）：在图上的地形标不标名字 */
  labels: boolean;
  onLabels: (labels: boolean) => void;
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
  labels,
  onLabels,
  planned,
  total,
  basemap,
  hasKey,
  onPickBasemap,
  onOpenKey,
  onStart
}: LobbyProps) {
  const canStart = mode === "atlas" || roster.length > 0;
  const presetCount = total - planned;
  /**
   * 选了图鉴：练习范围与起始地图这两组**整个失效**（图鉴必然是全部 + 全预置）。
   * 界面不把它们藏起来（藏起来会让人以为"这个选项没了"），
   * 而是置灰 + 说明白为什么 —— 否则老师会先选「只练山脉」再进图鉴，
   * 进去发现 38 条全在图上，第一反应是"我选的没生效"。
   */
  const atlasPick = mode === "atlas";
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
            <br />
            想先把整幅地形完整看一遍再动手，就选「图鉴」—— 不答题、不计分。
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
            <p className="cr-lobby-warn">
              {atlasPick ? "名单为空 —— 图鉴照常可以进。" : "名单为空，无法开始。"}
            </p>
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
            <button
              type="button"
              className={atlasPick ? "is-active" : ""}
              onClick={() => onMode("atlas")}
            >
              <strong>图鉴（只学不考）</strong>
              <span>整幅地形一开始就全部塑好，逐条点开看讲解与实景照片。不答题、不计分。</span>
            </button>
          </div>
          {atlasPick ? (
            <p className="cr-lobby-tip">
              图鉴是<strong>学习</strong>用的那一半：先把 38 条地形认全，再切回上面两种方式检验。
              它不需要学生名单，直接进入即可；下面的「练习范围」「起始地图」对图鉴不适用。
            </p>
          ) : (
            <p className="cr-lobby-tip">
              两种模式下都可以随时点答题人条换人；答错<strong>不换人</strong>，只是扣分 ——
              否则"答错就把难题丢给下一个人"反而成了最优解。
            </p>
          )}
        </section>

        <section className={`cr-lobby-box${atlasPick ? " is-muted" : ""}`}>
          <h2>练习范围</h2>
          <div className={`cr-modes is-compact is-scope${atlasPick ? " is-muted" : ""}`}>
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
            {atlasPick
              ? "图鉴里 38 条地形全都在图上，所以这一项不生效。"
              : "选了某一类，地图上就只有这一类是空的 —— 其余整类开局就塑好了，相当于把「答案」摆在旁边做对照。"}
          </p>
        </section>

        <section className={`cr-lobby-box${atlasPick ? " is-muted" : ""}`}>
          <h2>起始地图</h2>
          {/* 「练习范围」与「起始地图」在图鉴里都不生效，置灰必须**两处一样**：
              外层 section 带 is-muted 让标题变浅，内层 .cr-modes 带 is-muted
              让按钮组变灰且不可点（`.cr-modes.is-muted { pointer-events: none }`）。
              只加一半会出现"标题浅了、按钮还能点"的半灰状态。
              下面的轮廓开关在图鉴里照样管用，所以不在这两组里。 */}
          <div className={`cr-modes is-compact is-startmap${atlasPick ? " is-muted" : ""}`}>
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
          {/*
            ⚠️ 容器类名**不同于上面那行轮廓的 `cr-lobby-outline`**：
            探针 `lobby.outline` 查的是 `.cr-lobby-outline .cr-seg button`，
            两行共用同一个类名就会被一次抓成 4 个按钮（真实踩过）。
            样式上两者共用同一条规则（见 styles.css）。
          */}
          <div className="cr-lobby-names">
            <span className="cr-lobby-outline-label">地形名称</span>
            <div className="cr-seg">
              <button
                type="button"
                className={labels ? "is-active" : ""}
                onClick={() => onLabels(true)}
              >
                标注
              </button>
              <button
                type="button"
                className={labels ? "" : "is-active"}
                onClick={() => onLabels(false)}
              >
                不标
              </button>
            </div>
          </div>
          <p className="cr-lobby-tip">
            {atlasPick
              ? "图鉴一开始就是完整地形，所以「起始地图」不生效；下面的轮廓与名称开关照常可用（图鉴默认把 38 条的名字全标出来）。"
              : "轮廓是相邻地块之间的一道分界线（用各自地形的色系压深），看得清每块地到哪儿为止；名称开关控制要不要在地形上写出它的名字（放对一块就出现一块）。两个开关游戏里也能随时切换。"}
          </p>

          {/*
            v1.4.0：「选择底图」从独立的一个 box 并进这里（原来它是第 5 个 box）。
            理由是**布局会炸**：大厅网格在 1080 px 宽下只有 4 列，第 5 个 box
            被挤到第二行，高度整块叠加上去（第 1 行约 350 + 第 2 行约 380），
            超出滚动区可视高度 —— **第 4 个「遥感影像」整个看不到**。
            回归里就是按坐标点它点不到（命中的是底部的「开始塑形」）才发现的，
            光看截图只会以为"底图就三种"。
            并进来之后 4 个 box 一行排完，四种底图一屏可见。
            语义上也顺：起始地图 / 轮廓 / 名称 / 底图 都是"这张地图长什么样"。
          */}
          <h2 className="cr-lobby-sub">底图</h2>
          {/*
            `is-compact` 是和「起始地图」「练习范围」同一套压缩样式（两列 + 字号降一档）。
            v1.4.0 底图从 3 种变 4 种，竖排一列会把这个 box 顶到 700 px 以上、
            超出大厅滚动区；收成两列之后四种一屏可见，而且与旁边两组的观感一致。
          */}
          <div className="cr-modes is-base is-compact">
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
          {atlasPick
            ? `进入图鉴（${total} 条全在图上）`
            : `开始塑形${canStart ? `（${roster.length} 人 · 本局要塑 ${planned} 张）` : ""}`}
        </button>
        {atlasPick ? (
          <p className="cr-lobby-plan">
            图鉴<strong>不需要学生名单</strong>，名单为空也能进。
            进去之后整幅地形都在图上，逐条点开看讲解与实景照片；看完点「去答题」再回到这一屏。
          </p>
        ) : canStart && presetCount > 0 ? (
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
