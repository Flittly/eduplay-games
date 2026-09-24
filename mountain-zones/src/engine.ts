/**
 * 应用核心：把「参数」变成「一屏能看的东西」。
 *
 * React 组件只管 UI 与状态，所有派生计算都在这里 ——
 * 这样回归脚本可以用 `window.__mountainDebug` 直接驱动核心，
 * 不必去点 DOM，测的也就是真实逻辑而不是「测试脚本自己造的假状态」。
 *
 * ## 重算代价的分配（很关键）
 *
 * 不同参数影响的链路长度差很多，全部重算会让拖动滑块卡顿：
 *
 * | 参数              | 影响的派生数据                        | 代价         |
 * |-------------------|---------------------------------------|--------------|
 * | 山体              | 全部                                  | 重建 field   |
 * | 高程偏移 / 夸张   | 海拔 → 带谱 + 等高线 + 径流 + 顶点色  | 中（~百 ms） |
 * | 纬度 / 季节       | 带谱 + 径流 + 顶点色（**不含等高线**）| 小           |
 * | 等高距 / 开关     | 只重算等高线                          | 小           |
 *
 * 季节**不影响等高线**（海拔没变），所以切季节时跳过等高线提取 ——
 * 这正是「带谱随季节不变、只有雪线与地表覆盖会变」那条结论在工程上的体现。
 */

import { applyElevation, altitudeAtWorld, createField, heightFn, sampleGrid, worldToGrid } from "./dem";
import type { DemField } from "./data/types";
import { DEM_SOURCES, sourceByTag } from "./data";
import { createView3d, type HoverHit, type View3dHandle, type ViewMode } from "./view3d";
import { extractAll, levelsFor, pickContourInterval, type ContourLevel } from "./contour";
import { buildRunoff, runoffSummary, type RunoffNetwork } from "./runoff";
import { drawProjectionMap, hasAnyAnnotation, PROFILE_COLORS, type PartAnnotation, type ProfileSeries } from "./panels";
import {
  classifyLandType, landPartCounts, landParts, recommendExaggeration, reliefStats, slopeP90Deg,
  type LandPartCounts, type LandPartId, type LandPartMarks, type LandTypeId, type ReliefStats
} from "./landform";
import { skeletonize, type SkelPt, type SkeletonResult } from "./skeleton";

/**
 * 「这个样本里没有可细化的东西」时的占位。
 *
 * 单独定义一份常量而不是每次 `skeletonize([])`：华北平原、内蒙古高原、
 * 川中丘陵的脊/谷检出为 0 或极少数（1~2 格），走一遍闭运算 + 细化
 * 纯属白跑；更重要的是界面要能凭 `lines.length === 0` 判断"这一类的按钮该灰掉"。
 */
const EMPTY_SKEL: SkeletonResult = {
  lines: [],
  inputCells: 0,
  maskCells: 0,
  skeletonCells: 0,
  prunedCells: 0
};
import {
  bearingDeg, profileStats, sampleProfile, type Pt, type ProfileSample
} from "./profile";
import {
  bandsFor, baseBelt, beltAt, beltColor, beltDef, densityAt, snowline, snowlineAnnual,
  tempAt, tempAtSeason, treeline, type Band, type BeltId, type SeasonId
} from "./zonation";

export type { ViewMode } from "./view3d";
export type { ProfileSample, Pt } from "./profile";

/**
 * 一条学生手画的剖面段（网格坐标）。
 *
 * 为什么存**网格坐标**而不是世界坐标或屏幕坐标：网格坐标是唯一与
 * "改海拔 / 调夸张 / 换季节"无关的坐标系 —— 存世界坐标的话，学生把垂直夸张
 * 从 1 拖到 2，那条线就会脱离地表飞到空中。
 */
export interface ProfileSegment {
  a: Pt;
  b: Pt;
}

/** 最多 4 段，四色叠加（用户口径） */
export const MAX_PROFILE_SEGMENTS = 4;
/** 太短的线段没有剖面意义（比如只是点抖了一下），按格数设下限 */
export const MIN_PROFILE_SEGMENT_CELLS = 4;

export type WeatherMode = "clear" | "light" | "heavy";
export const WEATHER_RAIN: Record<WeatherMode, number> = { clear: 0, light: 0.45, heavy: 1 };

export interface Params {
  mountainTag: string;
  /** 山体纬度（切山时跳到真实纬度，仍可手滑） */
  lat: number;
  season: SeasonId;
  /** 等高距（米） */
  contourInterval: number;
  showContours: boolean;
  /** 是否按自然带着色（关掉就是裸地形） */
  showBands: boolean;
  /** 清单里点选要高亮的那条等高线（米）；null = 不高亮 */
  highlightLevel: number | null;
  weather: WeatherMode;
  mode: ViewMode;
  /** 垂直夸张（纯视觉，不改海拔） */
  verticalExaggeration: number;
  /** 高程偏移（米，真改海拔） */
  elevationOffset: number;
  /** 是否显示三维沙盘正下方那张二维投影图纸 */
  showProjection: boolean;
  /**
   * 是否显示三维沙盘本体。
   *
   * 与 `showProjection` **互相独立**：
   *  - 两个都开 = 沙盘悬在图纸上方（默认，能读出"投影"这件事）；
   *  - 只开沙盘 = 纯三维观察；
   *  - 只开图纸 = 在平面图上读等高线，此时拾取平面切换为图纸、仍能在图上画剖面。
   *
   * 两个都关会只剩天空、没有任何教学内容，所以 `apply` 里挡掉了这种组合。
   */
  showTerrain: boolean;
  /**
   * 学生手画的剖面段（最多 4 段）
   */
  segments: ProfileSegment[];
  /**
   * 要在图上标注出来的地形部位（v2.4.1）。
   *
   * 用数组而不是 `Record<LandPartId, boolean>`：这个值要能直接对照
   * `LAND_PARTS` 遍历、能一键清空、能原样写进快照给界面读，
   * 数组的语义最直白（"当前显示这几类"）。
   *
   * ⚠️ 改它**不触发任何重算** —— 五类部位与骨架线都在换样本时就算好了，
   * 这里只是"显不显示"。见 `apply()` 里 `partsChanged` 那一支。
   */
  showParts: LandPartId[];
}

export interface HoverReadout {
  gx: number;
  gy: number;
  alt: number;
  belt: BeltId;
  beltName: string;
  /** 年均温（℃）—— 带谱的依据 */
  tempAnnual: number;
  /** 当下季节的气温（℃） */
  tempSeason: number;
  density: number;
  /** 季节性积雪（雪线已降到这个海拔，但带谱本身没变） */
  seasonalSnow: boolean;
  aboveTreeline: boolean;
  aboveSnowline: boolean;
}

export interface Snapshot {
  mountainTag: string;
  name: string;
  peakName: string;
  peakAltitude: number;
  /**
   * 是否为**模板地形**（解析生成的示意地形，非真实 DEM）。
   *
   * 界面靠它分流两件事，都是在 JSX 里现推容易漏的：
   * - 「地理位置」栏：模板不画中国地图，改画说明卡（模板没有真实经纬度）；
   * - 页脚数据来源：模板不该写"AWS Terrain Tiles"。
   *
   * 放快照里而不是在 JSX 里现取 `sourceByTag(snap.mountainTag).isTemplate`，
   * 是为了让"当前样本是不是模板"只有一个来源 —— 现取会多一次查表，
   * 而且一旦哪天 tag 对不上就会静默按"真实"渲染。
   */
  isTemplate: boolean;
  lat: number;
  lon: number;
  spanKm: number;
  grid: number;
  /** 真实 DEM 的范围（不受滑块影响） */
  demMin: number;
  demMax: number;
  /** 当前海拔范围 */
  minH: number;
  maxH: number;
  /** 当前最高点海拔（= 拖偏移后山顶的实际高度） */
  currentPeak: number;
  verticalExaggeration: number;
  /**
   * 当前样本的**推荐**垂直夸张（坡度取向，见 `landform.ts`）。
   *
   * 单独放进快照有三个用处：
   *  - 滑块旁边的「自动」档要显示这个数；
   *  - `modified` 判据要比的是**它**，不是 1 —— 否则切到川中丘陵
   *    （推荐 ×2.42）之后，"还原真实 DEM"按钮会立刻亮起来，
   *    而学生其实什么都没动过；
   *  - 提示文案要能说清"现在这个倍数是不是自动的"。
   */
  recommendedExaggeration: number;
  elevationOffset: number;
  modified: boolean;
  baseBelt: BeltId;
  baseBeltName: string;
  bands: Band[];
  treeline: number;
  snowlineAnnual: number;
  snowlineNow: number;
  contourLevels: number[];
  contourCount: number;
  runoff: {
    rain: number;
    channelLengthKm: number;
    trunkKm: number;
    channels: number;
    totalProduced: number;
    text: string;
  };
  mode: ViewMode;
  season: SeasonId;
  weather: WeatherMode;
  showContours: boolean;
  showBands: boolean;
  contourInterval: number;
  /** 清单里点选要高亮的那条等高线（米） */
  highlightLevel: number | null;
  showProjection: boolean;
  /** 三维沙盘本体是否显示 */
  showTerrain: boolean;
  segments: ProfileSegment[];
  /** 每条剖面的抽样序列与统计量（含走向），供对比图直接用 */
  profileSeries: ProfileSeries[];
  /**
   * 要在图上标注哪几类地形部位（v2.4.1）。
   *
   * 与 `landform` 分开：那个是"这个样本里检出/算出了什么"（换样本才会变），
   * 这个是"现在让学生看哪几类"（点一下就变，不重算）。
   * 混在一起会让界面分不清"图的形状变了"和"图层开关变了"。
   */
  showParts: LandPartId[];
  /**
   * 当前要画的标注数据（已按 `showParts` 过滤）；五类都没开时为 `null`。
   *
   * 放到快照里而不是让界面自己筛：这样**三维与两个二维图层拿到的是同一个对象**，
   * 不可能出现"某一处忘了过滤"的不一致。
   */
  annotation: PartAnnotation | null;
  /** 五类地形部位的计数与点位（图鉴与三维标注共用），由 `landform.ts` 检测 */
  landform: {
    counts: LandPartCounts;
    peaks: Array<{ i: number; j: number; h: number }>;
    saddles: Array<{ i: number; j: number; h: number; drop: number }>;
    cliffs: Array<{ i: number; j: number; slopeDeg: number; drop: number; lines: number }>;
    /** 被物理闸门剔除的异常格数（> 0 说明这张 DEM 有空洞填充） */
    suspect: number;
    /**
     * 山脊**检出格**的原始点云（`[i,j,i,j,…]`）。
     *
     * 只有二维图用：作为"底衬点层"画在图纸上（`drawPlanMap` /
     * `drawProjectionMap` 早先就有的那一层淡点，v2.4.1 之前是界面自己
     * 重跑一遍 TPI 得到的）。三维不用它 —— 那边看点云只会是一片毛毛雨，
     * 直接用下面的骨架折线。
     */
    ridgeCells: Float32Array;
    /**
     * 山脊/山谷**骨架化**后的折线（网格坐标）。
     *
     * 为什么不是原始点云：见 `skeleton.ts` 的文件头 —— 点云丢掉了
     * "哪些点属于同一条脊"这个信息，画出来是一片毛毛雨。
     * 三维沙盘与二维图纸、平面图**共用同一份折线**，所以三处必然对得上。
     */
    ridgeLines: SkelPt[][];
    valleyLines: SkelPt[][];
    /** 骨架化前后的格子数（界面要如实写"由 N 个检出格缩成 M 段线"） */
    ridgeSkeleton: SkeletonResult;
    valleySkeleton: SkeletonResult;
  };
  /** 判据算出来的地形类型（人工声明的地形类型见 `DemSource.landType`，两者应一致） */
  landType: LandTypeId;
  /** 判据给的理由（一句话，给学生看） */
  landTypeReason: string;
  hover: HoverReadout | null;
}

export interface Engine {
  readonly field: DemField;
  readonly params: Params;
  readonly contours: ContourLevel[];
  readonly runoff: RunoffNetwork;
  readonly view: View3dHandle | null;
  mount(container: HTMLElement): void;
  /** 应用参数（可只给部分）并返回新快照 */
  apply(patch?: Partial<Params>): Snapshot;
  snapshot(): Snapshot;
  /** 鼠标拾取（client 坐标），更新 hover 读数 */
  hoverAt(clientX: number, clientY: number): HoverReadout | null;
  /** 只拾取不更新 hover（点选剖面端点时用，避免顺带改 hover 卡片） */
  pickOnly(clientX: number, clientY: number): { gx: number; gy: number; alt: number } | null;
  clearHover(): void;
  /** 加一条剖面段。超长/超短/超数量一律拒绝，并说明原因（界面照实显示） */
  addSegment(a: Pt, b: Pt): { ok: boolean; reason?: string };
  /** 拖动端点后更新。`which` = 0 起点 / 1 终点 */
  moveSegmentEnd(index: number, which: 0 | 1, p: Pt): void;
  removeSegment(index: number): void;
  clearSegments(): void;
  dispose(): void;
}

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** 裸地形色（关掉自然带配色时用）：暖灰岩土，随海拔略微变亮 */
function rockColor(alt: number, minH: number, maxH: number): [number, number, number] {
  const t = (alt - minH) / Math.max(1, maxH - minH);
  const base = 0.40 + 0.30 * t;
  return [base * 1.06, base * 0.97, base * 0.86];
}

export function createEngine(initial: Partial<Params> = {}): Engine {
  let params: Params = {
    mountainTag: DEM_SOURCES[0].tag,
    lat: DEM_SOURCES[0].lat,
    season: "summer",
    contourInterval: 200,
    showContours: true,
    showBands: true,
    highlightLevel: null,
    weather: "clear",
    mode: "observe",
    verticalExaggeration: 1,
    elevationOffset: 0,
    showProjection: true,
    showTerrain: true,
    segments: [],
    // 默认全不标：先给学生一张干净的地形图，再由他点按钮逐类揭示
    showParts: [],
    ...initial
  };

  let field: DemField = createField(sourceByTag(params.mountainTag));
  let contours: ContourLevel[] = [];
  let runoff: RunoffNetwork = buildRunoff(field, params.lat, params.season, WEATHER_RAIN[params.weather]);
  let hover: HoverReadout | null = null;
  let view: View3dHandle | null = null;

  /**
   * 「与样本绑定」的派生量：五类地形部位 + 起伏统计 + 类型判定 + 推荐夸张。
   *
   * ⚠️ **只在换样本时整体刷新一次**，改海拔 / 调夸张 / 换季节都不重算 ——
   * 因为 TPI、坡度、鞍部下凹量全是**差值**，而 `elevationOffset` 与
   * `verticalExaggeration` 对 `alt` 都是仿射变换（加常数 / 乘常数），
   * 差值一个都不变（只有 offset 把某处压到 0 以下时才有例外，可忽略）。
   * 一次检测 ~40~80 ms，挂在滑块上会卡；放在换样本上刚刚好。
   *
   * 打包成一个函数而不是散在初始化与 `mountainChanged` 两处，
   * 是因为这四项**必须同进同退**：只刷一半（比如漏了 `recommended`）
   * 会让「判型用的是旧样本、推荐夸张用的是新样本」这种问题静默存在。
   */
  function sampleStats(f: DemField) {
    const h = heightFn(f);
    const stats = reliefStats(h, f.grid);
    const m = landParts(h, f.grid, f.spanM);
    /*
     * 脊/谷点云**顺手就细化成折线**，和 `marks` 同寿命。
     *
     * 为什么不等学生点按钮时再算：算一次 ~10~40 ms（最慢的太白山），
     * 放到点击里就是"点了没反应"；而放在换样本里，它和 `landParts`（40~80 ms）
     * 同批跑，学生感知到的是同一次切换。
     * 代价是"看了却不点标注"的样本也算了 —— 但这个游戏的全部内容就是观察地形，
     * 省下这几十毫秒并不值得引入一套"懒计算 + 失效"的状态。
     */
    const rawR = landPartCounts(m).ridge;
    const rawV = landPartCounts(m).valley;
    const ridgeSkel = rawR > 0 ? skeletonize(m.ridges, f.grid) : EMPTY_SKEL;
    const valleySkel = rawV > 0 ? skeletonize(m.valleys, f.grid) : EMPTY_SKEL;
    return {
      marks: m,
      stats,
      type: classifyLandType(stats),
      recommended: recommendExaggeration(slopeP90Deg(h, f.grid, f.spanM)),
      ridgeSkel,
      valleySkel
    };
  }

  let sample = sampleStats(field);
  let marks: LandPartMarks = sample.marks;
  /** 当前样本的起伏统计与地形类型判定（`localReliefMedian` 要扫移动窗口，~20 ms） */
  let markStats: ReliefStats = sample.stats;
  let markType: { type: LandTypeId; reason: string } = sample.type;
  /** 当前样本推荐的垂直夸张（坡度取向，见 `landform.ts`） */
  let markRecommended: number = sample.recommended;
  let ridgeSkel = sample.ridgeSkel;
  let valleySkel = sample.valleySkel;

  /*
   * 首个样本也走自动推荐 —— 现在 `DEM_SOURCES[0]` 是模板山地（推荐 ×1），
   * 这行是个 no-op；但只要以后样本顺序变了、或把某个平原放到首位，
   * 这里就不会出现"首屏是一张纸、切一下才正常"的怪现象。
   * 调用方显式给了 `verticalExaggeration` 就尊重调用方（回归脚本要能定死它）。
   */
  if (initial.verticalExaggeration === undefined) {
    params.verticalExaggeration = markRecommended;
    applyElevation(field, params.verticalExaggeration, params.elevationOffset);
  }

  /** 每条剖面段的实际海拔序列 + 统计量 */
  function buildSeries(): ProfileSeries[] {
    const h = heightFn(field);
    return params.segments.map((s, k) => {
      const samples: ProfileSample[] = sampleProfile(h, field.grid, field.spanM, s.a, s.b);
      return {
        index: k + 1,
        color: PROFILE_COLORS[k % PROFILE_COLORS.length],
        samples,
        stats: profileStats(samples),
        bearing: bearingDeg(s.a, s.b)
      };
    });
  }

  /**
   * 组一份「现在要标注什么」给绘图层。
   *
   * 过滤（`showParts`）在**引擎里**做，绘图层只拿到"要画的东西"。
   * 这样三维层与两个二维图层都不需要知道 `LandPartId` 的开关语义，
   * 三处也就不会出现"某一处忘了过滤"这种不一致。
   */
  function annotationOf(): PartAnnotation {
    const on = new Set(params.showParts);
    const wantPeak = on.has("peak");
    const wantSaddle = on.has("saddle");
    const wantCliff = on.has("cliff");
    const wantRidge = on.has("ridge");
    const wantValley = on.has("valley");
    return {
      parts: params.showParts.slice(),
      peaks: wantPeak ? marks.peaks.map((p) => ({ i: p.i, j: p.j, h: p.h })) : [],
      saddles: wantSaddle
        ? marks.saddles.map((s) => ({ i: s.i, j: s.j, h: s.h, drop: s.drop }))
        : [],
      cliffs: wantCliff
        ? marks.cliffs.map((c) => ({
            i: c.i,
            j: c.j,
            slopeDeg: c.slopeDeg,
            drop: c.drop,
            lines: c.lines
          }))
        : [],
      ridgeLines: wantRidge ? ridgeSkel.lines : [],
      valleyLines: wantValley ? valleySkel.lines : []
    };
  }

  function currentAnnotation(): PartAnnotation | null {
    const a = annotationOf();
    return hasAnyAnnotation(a) ? a : null;
  }

  /**
   * 把标注层推给三维视图。
   *
   * 开关变化时**只调这一个**，不重算任何派生数据 —— 五类点位与骨架线
   * 都在换样本时就算好了（见 `sampleStats`）。
   */
  function pushAnnotations(): void {
    view?.setAnnotations(currentAnnotation());
  }

  /**
   * 把二维投影图纸交给三维视图。
   *
   * 图纸上的等高线用的就是 `contours`（三维地表那批）——**同一份数据**，
   * 所以纸上的圈与山上的圈逐条对得上，这是"投影"这个说法成立的前提。
   */
  function pushProjection(): void {
    view?.setProjection({
      visible: params.showProjection,
      draw: (g, size) =>
        drawProjectionMap(g, size, {
          field,
          contours,
          interval: params.contourInterval,
          majorEvery: 5,
          lat: params.lat,
          season: params.season,
          segments: params.segments.map((s, k) => ({
            a: s.a,
            b: s.b,
            color: PROFILE_COLORS[k % PROFILE_COLORS.length]
          })),
          ridges: marks.ridges,
          showBands: params.showBands,
          annotations: annotationOf()
        })
    });
  }

  function pushProfile(): void {
    view?.setProfile(
      params.segments.map((s, k) => ({
        a: s.a,
        b: s.b,
        color: PROFILE_COLORS[k % PROFILE_COLORS.length]
      }))
    );
  }

  /** 顶点色：按自然带（或裸地形） */
  function colorOf(alt: number): [number, number, number] {
    if (!params.showBands) {
      return rockColor(alt, field.minH, field.maxH);
    }
    return hexToRgb(beltColor(beltAt(params.lat, alt, params.season), params.season));
  }

  function recomputeContours(): void {
    const levels = levelsFor(field.minH, field.maxH, params.contourInterval, 0);
    // 上限保护：等高距太小时线会多到没意义（也让提取变慢）
    const capped = levels.length > 80
      ? levels.filter((_, i) => i % Math.ceil(levels.length / 80) === 0)
      : levels;
    contours = extractAll(heightFn(field), field.grid, capped);
  }

  function recomputeRunoff(): void {
    runoff = buildRunoff(field, params.lat, params.season, WEATHER_RAIN[params.weather]);
  }

  function apply(patch: Partial<Params> = {}): Snapshot {
    const prev = params;
    params = { ...params, ...patch };

    /*
     * 归一化：沙盘与图纸**不能同时关掉** —— 那样画面里只剩天空。
     *
     * 这里选择自动打开图纸，而不是报错或静默忽略：学生点"关"的意图显然是
     * "我想单独看另一个"，不是"我想看一片空的"。放在所有 `xxxChanged`
     * 比较之前，这样归一化之后的真实变化都会被后续分支正常处理。
     */
    if (!params.showTerrain && !params.showProjection) {
      params.showProjection = true;
    }

    const mountainChanged = params.mountainTag !== prev.mountainTag;
    if (mountainChanged) {
      field = createField(sourceByTag(params.mountainTag));
      // 切山时纬度跳到该山的真实纬度（除非调用方显式指定了纬度）
      if (patch.lat === undefined) {
        params.lat = field.source.lat;
      }
      // 换样本 ⇒ 地形全变，五类部位 / 起伏统计 / 判型 / 推荐夸张一起重算；
      // 剖面段清空（旧点位对不上新山了）
      sample = sampleStats(field);
      marks = sample.marks;
      markStats = sample.stats;
      markType = sample.type;
      markRecommended = sample.recommended;
      ridgeSkel = sample.ridgeSkel;
      valleySkel = sample.valleySkel;
      // 新样本的部位点位全变了，标注层必须跟着重建
      pushAnnotations();
      /*
       * 垂直夸张跟着样本走。
       *
       * 必须在 `applyElevation` **之前**定下来：平原按 ×1 渲染什么都看不见，
       * 而 `applyElevation` 内部还会把值夹到 [EXAGGERATION_MIN, EXAGGERATION_MAX]，
       * 顺序反了就会先按旧倍数建一遍高程、再被夹一次。
       * 调用方显式传了 `verticalExaggeration`（回归脚本会）就尊重它。
       */
      if (patch.verticalExaggeration === undefined) {
        params.verticalExaggeration = markRecommended;
      }
      applyElevation(field, params.verticalExaggeration, params.elevationOffset);
      // 等高距按新样本自动落档：山峰那档用在平原上会一条线都画不出来
      params.contourInterval = pickContourInterval(field.minH, field.maxH, params.contourInterval);
      params.segments = [];
      recomputeContours();
      recomputeRunoff();
      view?.refresh(field, colorOf);
      view?.setSun(params.season);
      view?.setContours({
        enabled: params.showContours,
        interval: params.contourInterval,
        majorEvery: 5,
        opacity: 0.5,
        highlight: params.highlightLevel
      });
      pushProjection();
      pushProfile();
      return snapshot();
    }

    const elevationChanged =
      params.verticalExaggeration !== prev.verticalExaggeration ||
      params.elevationOffset !== prev.elevationOffset;
    const climateChanged = params.lat !== prev.lat || params.season !== prev.season;
    const contourSpecChanged =
      params.contourInterval !== prev.contourInterval ||
      params.showContours !== prev.showContours;
    const bandChanged = params.showBands !== prev.showBands;
    const weatherChanged = params.weather !== prev.weather;
    const highlightChanged = params.highlightLevel !== prev.highlightLevel;
    const projectionToggled = params.showProjection !== prev.showProjection;
    const terrainToggled = params.showTerrain !== prev.showTerrain;
    const segmentsChanged = params.segments !== prev.segments;
    const partsChanged = params.showParts !== prev.showParts;

    if (elevationChanged) {
      applyElevation(field, params.verticalExaggeration, params.elevationOffset);
      recomputeContours();
      recomputeRunoff();
    } else if (climateChanged || weatherChanged) {
      // 季节/纬度/雨势都不改海拔，所以等高线**不用重算** —— 它们本来就是同一条线
      recomputeRunoff();
    } else if (contourSpecChanged) {
      recomputeContours();
    }

    if (elevationChanged || climateChanged || bandChanged) {
      view?.refresh(field, colorOf);
    }
    if (climateChanged) {
      view?.setSun(params.season);
    }
    if (contourSpecChanged || elevationChanged || highlightChanged) {
      view?.setContours({
        enabled: params.showContours,
        interval: params.contourInterval,
        majorEvery: 5,
        opacity: 0.5,
        highlight: params.highlightLevel
      });
    }
    // 图纸上的内容 = 等高线 + 剖面段 + 自然带底色 + 部位标注 ⇒ 这几样任一变了都要重画
    if (
      projectionToggled ||
      segmentsChanged ||
      elevationChanged ||
      climateChanged ||
      bandChanged ||
      contourSpecChanged ||
      partsChanged
    ) {
      pushProjection();
    }
    /*
     * 标注开关：**只换图层，不重算**。
     *
     * 五类点位与脊/谷骨架线都是换样本时算的（`sampleStats`），
     * 这里既不动 `marks` 也不重算等高线 —— 点一下按钮的代价就是重建几个
     * 三维 Line/Marker 对象。这一条是"开关能秒响应"的全部原因。
     */
    if (partsChanged) {
      pushAnnotations();
    }
    if (segmentsChanged || elevationChanged) {
      pushProfile();
    }
    if (terrainToggled) {
      view?.setTerrainVisible(params.showTerrain);
      /*
       * 巡游是"沿着最陡上升路径从山麓爬到峰顶"——沙盘收起来就没得爬了。
       * 必须退回观察模式，否则相机会继续沿一条不存在的地表飞行。
       */
      if (!params.showTerrain && params.mode === "roam") {
        params.mode = "observe";
        view?.setMode("observe");
      }
    }
    if (params.mode !== prev.mode) {
      view?.setMode(params.mode);
    }
    return snapshot();
  }

  function readHover(hit: HoverHit): HoverReadout {
    const alt = hit.alt;
    const belt = beltAt(params.lat, alt, params.season);
    const snowAnnual = snowlineAnnual(params.lat);
    const snowNow = snowline(params.lat, params.season);
    return {
      gx: hit.gx,
      gy: hit.gy,
      alt,
      belt,
      beltName: beltDef(belt).name,
      tempAnnual: tempAt(params.lat, alt),
      tempSeason: tempAtSeason(params.lat, alt, params.season),
      density: densityAt(params.lat, alt, params.season, field.maxH),
      seasonalSnow: belt !== "snow" && alt >= snowNow && alt < snowAnnual,
      aboveTreeline: alt > treeline(params.lat, params.season),
      aboveSnowline: belt === "snow"
    };
  }

  function snapshot(): Snapshot {
    const base = baseBelt(params.lat, params.season);
    const bands = bandsFor(params.lat, params.season, field.maxH);
    return {
      mountainTag: field.source.tag,
      name: field.source.name,
      peakName: field.source.peakName,
      peakAltitude: field.source.peakAltitude,
      isTemplate: field.source.isTemplate === true,
      lat: params.lat,
      lon: field.source.lon,
      spanKm: field.source.spanKm,
      grid: field.grid,
      demMin: field.source.demMin,
      demMax: field.source.demMax,
      minH: field.minH,
      maxH: field.maxH,
      currentPeak: field.maxH,
      verticalExaggeration: field.verticalExaggeration,
      recommendedExaggeration: markRecommended,
      elevationOffset: field.elevationOffset,
      /*
       * 「动过没有」的判据里，夸张比的是**推荐值**而不是 1。
       *
       * 切到川中丘陵会自动乘 ×2.42，若仍拿 1 当基准，
       * 「还原真实 DEM」按钮会在学生什么都没碰的情况下自己亮起来 ——
       * 那等于告诉学生"你改过了"。比推荐值则只有真的手动偏离才算动过。
       */
      modified:
        Math.abs(field.verticalExaggeration - markRecommended) > 1e-6 ||
        Math.abs(field.elevationOffset) > 1e-6,
      baseBelt: base,
      baseBeltName: beltDef(base).name,
      bands,
      treeline: treeline(params.lat, params.season),
      snowlineAnnual: snowlineAnnual(params.lat),
      snowlineNow: snowline(params.lat, params.season),
      contourLevels: contours.map((c) => c.level),
      contourCount: contours.length,
      runoff: {
        rain: runoff.rain,
        channelLengthKm: runoff.channelLengthM / 1000,
        trunkKm: runoff.trunkLengthM / 1000,
        channels: runoff.channels.length,
        totalProduced: runoff.totalProduced,
        text: runoffSummary(runoff)
      },
      mode: params.mode,
      season: params.season,
      weather: params.weather,
      showContours: params.showContours,
      showBands: params.showBands,
      contourInterval: params.contourInterval,
      highlightLevel: params.highlightLevel,
      showProjection: params.showProjection,
      showTerrain: params.showTerrain,
      showParts: params.showParts.slice(),
      annotation: currentAnnotation(),
      segments: params.segments.map((s) => ({ a: [s.a[0], s.a[1]] as Pt, b: [s.b[0], s.b[1]] as Pt })),
      profileSeries: buildSeries(),
      landform: {
        counts: landPartCounts(marks),
        peaks: marks.peaks.map((p) => ({ i: p.i, j: p.j, h: p.h })),
        saddles: marks.saddles.map((s) => ({ i: s.i, j: s.j, h: s.h, drop: s.drop })),
        cliffs: marks.cliffs.map((c) => ({
          i: c.i,
          j: c.j,
          slopeDeg: c.slopeDeg,
          drop: c.drop,
          lines: c.lines
        })),
        suspect: marks.cliffScan.suspect,
        ridgeCells: marks.ridges,
        ridgeLines: ridgeSkel.lines,
        valleyLines: valleySkel.lines,
        ridgeSkeleton: ridgeSkel,
        valleySkeleton: valleySkel
      },
      landType: markType.type,
      landTypeReason: markType.reason,
      hover
    };
  }

  const engine: Engine = {
    get field() {
      return field;
    },
    get params() {
      return params;
    },
    get contours() {
      return contours;
    },
    get runoff() {
      return runoff;
    },
    get view() {
      return view;
    },
    mount(container: HTMLElement) {
      view = createView3d(container);
      view.refresh(field, colorOf);
      view.setSun(params.season);
      view.setMode(params.mode);
      view.setContours({
        enabled: params.showContours,
        interval: params.contourInterval,
        majorEvery: 5,
        opacity: 0.5,
        highlight: params.highlightLevel
      });
      if (contours.length === 0) {
        recomputeContours();
      }
      pushProjection();
      pushProfile();
      // 标注层也要给一份：视图是新建的，不推它就没有图层（而参数里可能已经开着）
      pushAnnotations();
    },
    apply,
    snapshot,
    hoverAt(clientX: number, clientY: number) {
      if (!view) {
        return null;
      }
      const hit = view.pick(clientX, clientY);
      hover = hit ? readHover(hit) : null;
      return hover;
    },
    pickOnly(clientX: number, clientY: number) {
      return view?.pick(clientX, clientY) ?? null;
    },
    clearHover() {
      hover = null;
    },
    addSegment(a, b) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < MIN_PROFILE_SEGMENT_CELLS) {
        return { ok: false, reason: `两点太近（不足 ${MIN_PROFILE_SEGMENT_CELLS} 格），拖动远一点再点` };
      }
      if (params.segments.length >= MAX_PROFILE_SEGMENTS) {
        return { ok: false, reason: `最多只能画 ${MAX_PROFILE_SEGMENTS} 段，先删掉一段` };
      }
      const next = [...params.segments, { a: [a[0], a[1]] as Pt, b: [b[0], b[1]] as Pt }];
      apply({ segments: next });
      return { ok: true };
    },
    moveSegmentEnd(index, which, p) {
      if (index < 0 || index >= params.segments.length) {
        return;
      }
      const next = params.segments.map((s, k) =>
        k === index
          ? { a: (which === 0 ? [p[0], p[1]] : s.a) as Pt, b: (which === 1 ? [p[0], p[1]] : s.b) as Pt }
          : s
      );
      apply({ segments: next });
    },
    removeSegment(index) {
      if (index < 0 || index >= params.segments.length) {
        return;
      }
      apply({ segments: params.segments.filter((_, k) => k !== index) });
    },
    clearSegments() {
      if (params.segments.length) {
        apply({ segments: [] });
      }
    },
    dispose() {
      view?.dispose();
      view = null;
    }
  };

  // 初始就给一份完整的派生数据，避免首帧空窗
  recomputeContours();
  recomputeRunoff();

  return engine;
}

/** 供 UI 与调试共用的辅助：某海拔属于哪个带 */
export function beltAtAltitude(lat: number, alt: number, season: SeasonId): BeltId {
  return beltAt(lat, alt, season);
}

export { altitudeAtWorld, sampleGrid, worldToGrid };
