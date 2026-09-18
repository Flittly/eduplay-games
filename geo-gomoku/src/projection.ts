/**
 * 棋盘投影 · 纯逻辑层
 *
 * 两种棋盘形状，共用同一套「窗口 + 规格」几何（见 geo.ts），只换"经纬度 → 平面"这一步：
 *
 *   flat  等距圆柱投影（方形棋盘）
 *         经纬度线性映射，格子一样大。学生数格子最容易 —— 所以它是默认形状。
 *         v1.0.0 以来一直如此，公式就是 x = left + col·step、y = top + row·step。
 *
 *   globe 正射投影（圆形棋盘）
 *         像从很远的地方正面看一个地球仪：以本局窗口中心为视角中心，
 *         把球面上那一块投到平面。纬线变成向两侧下垂的弧、经线朝两极弯过去，
 *         越靠圆边格子被压得越窄 —— 这就是"地球是圆的"在棋盘上的样子。
 *
 * 三条刻意的取舍：
 *
 * ① **只换绘制，不换几何。** 圆形模式下窗口仍然是那个经纬度矩形，
 *    `rowOfLat` / `colOfLon` / `parseDegreeInput` 一个字都没改。
 *    换句话说，同一个坐标在方形和圆形棋盘上落到同一个交点、判对判错也完全一样 ——
 *    形状是**皮肤**，不是规则。这样"换形状"就不可能悄悄改掉游戏逻辑。
 *
 * ② **圆盘半径 = 窗口四角的外接圆。** 于是四个角恰好贴在圆上、棋盘一格不少，
 *    而四条边的中间会留出四个"月牙"。这不是画错：球面上"经度跨 35°、纬度跨 35°"
 *    的四个角，离中心的球面距离本来就比边的中点远。月牙那一圈会拿真实地球贴图填上，
 *    看上去就是"棋盘之外还是地球"。
 *
 * ③ **背面不画。** 正射投影只有朝向观察者的半个球可见（cos c ≥ 0），
 *    越过 90° 的点返回 null，path 会自动断开 —— 否则经线会在圆盘外连成一条直线，
 *    看起来像棋盘漏到了空气里。
 */

import {
  latBottom,
  latTops,
  lonLefts,
  lonRight,
  span,
  type BoardRange,
  type BoardSpec
} from "./geo";

export type BoardShape = "flat" | "globe";

export const BOARD_SHAPES: { id: BoardShape; label: string; hint: string }[] = [
  { id: "flat", label: "方形", hint: "等距方格：格子一样大，最好数格子，适合正式对弈" },
  {
    id: "globe",
    label: "圆形",
    hint: "球面投影：像看地球仪正面，经线朝两极弯过去，越靠边格子越窄"
  }
];

export const DEFAULT_BOARD_SHAPE: BoardShape = "flat";

const RAD = Math.PI / 180;

/* ===================== 正射投影 ===================== */

/**
 * 以 (lon0, lat0) 为视角中心的单位球正射投影。
 * 返回 null 表示该点在球的背面（看不见）—— 这是正射投影与"平面地图"最本质的区别。
 *
 * 公式取的是标准正交投影（观察者在 +z 无穷远）：
 *   x = cos φ · sin(λ − λ0)
 *   y = cos φ0 · sin φ − sin φ0 · cos φ · cos(λ − λ0)
 * 其中 y 轴朝北，绘制时要翻转。
 */
export function orthoProject(
  lon: number,
  lat: number,
  lon0: number,
  lat0: number
): { x: number; y: number } | null {
  const phi = lat * RAD;
  const lambda = (lon - lon0) * RAD;
  const phi0 = lat0 * RAD;
  const cosC =
    Math.sin(phi0) * Math.sin(phi) +
    Math.cos(phi0) * Math.cos(phi) * Math.cos(lambda);
  if (cosC < 0) {
    return null;
  }
  return {
    x: Math.cos(phi) * Math.sin(lambda),
    y: Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lambda)
  };
}

/**
 * 正射投影的逆：平面上一点 → 球面经纬度。贴图重采样要用它。
 * ρ > 1 表示落在圆盘外（球上不存在对应点），返回 null。
 */
export function orthoUnproject(
  x: number,
  y: number,
  lon0: number,
  lat0: number
): { lon: number; lat: number } | null {
  const phi0 = lat0 * RAD;
  return inverseOrtho(x, y, lon0, Math.sin(phi0), Math.cos(phi0));
}

/**
 * 逆投影的实体。sin/cos φ0 由调用方预先算好 —— 贴图重采样要跑几十万次，
 * 每像素重算一遍三角函数是白扔掉的。**公式只有这一份**，
 * 预编译版与按需版都走它，免得两边各写一个、日子久了开始不一样。
 */
function inverseOrtho(
  x: number,
  y: number,
  lon0: number,
  sinPhi0: number,
  cosPhi0: number
): { lon: number; lat: number } | null {
  const rho = Math.hypot(x, y);
  if (rho > 1) {
    return null;
  }
  // ρ = 0（圆盘正中）时下面两式都是 0/0，但极限存在：就是视角中心本身。
  if (rho < 1e-9) {
    return { lon: lon0, lat: Math.asin(sinPhi0) / RAD };
  }
  const c = Math.asin(Math.min(1, rho));
  const sinC = Math.sin(c);
  const cosC = Math.cos(c);
  // ⚠ asin 给的是**弧度**。这里漏过 /RAD，症状是"经度全对、纬度全错"：
  //   纬度 50° 会返回 0.873 —— 看着像个合理的小数字，所以特别容易被当成"边缘压缩"放过。
  const lat = Math.asin(cosC * sinPhi0 + (y * sinC * cosPhi0) / rho) / RAD;
  const lon =
    lon0 + Math.atan2(x * sinC, rho * cosPhi0 * cosC - y * sinPhi0 * sinC) / RAD;
  return { lon, lat };
}

/* ===================== 视口 ===================== */

/** 棋盘在画布上的取景。两种形状的字段不同，但 project / unproject 的口径一致。 */
export interface FlatViewport {
  shape: "flat";
  /** 格子边长（用户单位）。 */
  step: number;
  /** 最北一条纬线在画布上的 y。 */
  top: number;
  /** 最西一条经线在画布上的 x。 */
  left: number;
  /** 本局窗口，用来把经度换算成第几列。 */
  lonLeft: number;
  /** 本局窗口，用来把纬度换算成第几行。 */
  latTop: number;
  degStep: number;
}

export interface GlobeViewport {
  shape: "globe";
  /** 圆盘中心与半径（用户单位）。 */
  cx: number;
  cy: number;
  radius: number;
  /** 单位球 → 用户单位。等于 radius / 窗口四角的单位球投影半径。 */
  scale: number;
  lon0: number;
  lat0: number;
}

export type Viewport = FlatViewport | GlobeViewport;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function makeFlatViewport(
  range: BoardRange,
  spec: BoardSpec,
  box: Box
): FlatViewport {
  const inner = Math.min(box.w, box.h);
  const step = inner / (spec.grid - 1);
  return {
    shape: "flat",
    step,
    top: box.y + (box.h - inner) / 2,
    left: box.x + (box.w - inner) / 2,
    lonLeft: range.lonLeft,
    latTop: range.latTop,
    degStep: spec.degStep
  };
}

/**
 * 窗口四角在"单位球投影"里的最大半径。
 *
 * 圆盘半径就按它来定，于是四角恰好落在圆上、一条格线都不会被裁掉。
 * 它必然 ≤ 1（正射投影的最大半径就是 1）。
 */
export function cornerUnitRadius(range: BoardRange, spec: BoardSpec): number {
  const lon0 = (range.lonLeft + lonRight(range, spec)) / 2;
  const lat0 = (range.latTop + latBottom(range, spec)) / 2;
  let best = 0;
  for (const lon of [range.lonLeft, lonRight(range, spec)]) {
    for (const lat of [latBottom(range, spec), range.latTop]) {
      const point = orthoProject(lon, lat, lon0, lat0);
      if (!point) {
        continue;
      }
      best = Math.max(best, Math.hypot(point.x, point.y));
    }
  }
  // 极端规格（跨度 ≥ 180°）会出现"四角都在背面"的退化情形，退回到 1 免得除零。
  return best > 1e-6 ? Math.min(1, best) : 1;
}

export function makeGlobeViewport(
  range: BoardRange,
  spec: BoardSpec,
  box: Box
): GlobeViewport {
  const lon0 = (range.lonLeft + lonRight(range, spec)) / 2;
  const lat0 = (range.latTop + latBottom(range, spec)) / 2;
  const radius = Math.min(box.w, box.h) / 2;
  return {
    shape: "globe",
    cx: box.x + box.w / 2,
    cy: box.y + box.h / 2,
    radius,
    scale: radius / cornerUnitRadius(range, spec),
    lon0,
    lat0
  };
}

export function makeViewport(
  shape: BoardShape,
  range: BoardRange,
  spec: BoardSpec,
  box: Box
): Viewport {
  return shape === "globe"
    ? makeGlobeViewport(range, spec, box)
    : makeFlatViewport(range, spec, box);
}

/* ===================== 形状带来的窗口约束 ===================== */

/**
 * 圆形模式允许的纬度带上限（|纬度| 不超过 70°）。
 *
 * 为什么需要这条：球面上"5° 经度"的实际宽度是 5°×cos(纬度)。
 * 在 85°N，同样走 5° 经度只有赤道上的 8.7% 远；再叠加正射投影在圆盘边缘的压缩，
 * 那一格的屏幕间距会掉到方形棋盘的 1/10 出头 —— 棋子会摞成一坨。
 * 实测（940 用户单位的画布、取各档最坏窗口的最小相邻交点间距）：
 *
 *   上限 90°（不设限）  小 0.0   中 0.0   大 0.0    ← 极点行退化成一个点，尺度为 0
 *   上限 75°            小 13.2  中 9.7   大 6.2
 *   上限 70°            小 17.0  中 12.5  大 7.9    ← 取这一档
 *   上限 60°            小 23.8  中 17.5  大 11.4
 *
 * 70° 这一档是"够用"与"窗口别太少"的交点：再往下降，可用窗口数会掉得很快
 * （60° 时大棋盘只剩 1 个窗口，等于没有随机性）。
 */
export const GLOBE_LAT_CAP = 70;

/**
 * 圆形模式下"一格还看得清"的下限：最小相邻交点间距不得小于画布的 1.06%。
 * 940 用户单位下就是 10 个单位 —— 换算到 780 px 的显示宽度约 8.3 px，
 * 刚好放得下一颗直径十来像素的棋子。见 globeWorstMinGap。
 */
export const GLOBE_MIN_GAP_RATIO = 0.0106;

/**
 * 该形状下可以用的纬度窗口。
 *
 * **方形**：全部可用。
 *
 * **圆形**：把"伸进极区太深"的窗口去掉，理由见 GLOBE_LAT_CAP。
 * 另外极点本身也必须排除：正射投影下极点是一个**点** —— `lat = 90°` 那一整条纬线
 * 不管经度是多少都投到圆盘顶端同一点，于是"极点那一行 15 个交点"在画布上完全重合，
 * 棋子摞成一颗、沿那一行的连珠也看不见，而学生手里的坐标明明各不相同。
 * 方形棋盘没有这个问题（等距圆柱把它摊成一条横线，本来就是地图上的惯例画法）。
 *
 * 这不是"少给几档"，而是"这种画法下这几档画不出来"：被去掉的窗口在方形里一个不少。
 */
export function reachableLatTops(spec: BoardSpec, shape: BoardShape): number[] {
  const all = latTops(spec);
  if (shape !== "globe") {
    return all;
  }
  return all.filter(
    (top) => top <= GLOBE_LAT_CAP && top - span(spec) >= -GLOBE_LAT_CAP
  );
}

/**
 * 本局窗口里**最近的一对相邻交点**在画布上的距离。
 *
 * 棋子半径必须按它来定，不能用"格子边长" —— 圆形棋盘上格子大小从中心到边缘差好几倍，
 * 用平均值会让边缘的棋子叠在一起、用最小值又会让中心的棋子偏小。
 * 这里取的是上下左右四个邻点里最近的那个（极点附近经度方向的间距永远最短，
 * 所以只看正交邻点就是保守下界）。
 */
export function minNeighborGap(
  vp: Viewport,
  range: BoardRange,
  spec: BoardSpec
): number {
  const points: ({ x: number; y: number } | null)[][] = [];
  for (let row = 0; row < spec.grid; row += 1) {
    const line: ({ x: number; y: number } | null)[] = [];
    for (let col = 0; col < spec.grid; col += 1) {
      line.push(
        project(
          vp,
          range.lonLeft + col * spec.degStep,
          range.latTop - row * spec.degStep
        )
      );
    }
    points.push(line);
  }
  let best = Number.POSITIVE_INFINITY;
  for (let row = 0; row < spec.grid; row += 1) {
    for (let col = 0; col < spec.grid; col += 1) {
      const a = points[row][col];
      if (!a) continue;
      for (const [dr, dc] of [
        [0, 1],
        [1, 0]
      ]) {
        const r2 = row + dr;
        const c2 = col + dc;
        if (r2 >= spec.grid || c2 >= spec.grid) continue;
        const b = points[r2][c2];
        if (!b) continue;
        best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
  }
  return Number.isFinite(best) ? best : 0;
}

/**
 * 圆形模式下这档棋盘**最坏的那个窗口**离"看不清"有多远，按画布尺寸归一化。
 * 窗口越靠极区越糟，所以取所有可用窗口（含经度全谱）里的最小值。
 */
export function globeWorstMinGap(spec: BoardSpec): number {
  const box: Box = { x: 0, y: 0, w: 1, h: 1 };
  const tops = reachableLatTops(spec, "globe");
  const lefts = lonLefts(spec);
  let worst = Number.POSITIVE_INFINITY;
  for (const latTop of tops) {
    for (const lonLeft of lefts) {
      const range = { latTop, lonLeft };
      worst = Math.min(
        worst,
        minNeighborGap(makeGlobeViewport(range, spec, box), range, spec)
      );
    }
  }
  return Number.isFinite(worst) ? worst : 0;
}

/**
 * 这档棋盘在圆形模式下画不画得出来。
 *
 * 判据是"最坏那个窗口里，最近的两个交点还放得下一颗棋子吗"，
 * 阈值见 GLOBE_MIN_GAP_RATIO。大棋盘（25×25、跨 120°）在圆形下过不了这一关 ——
 * 跨 120° 就必须伸到 ±70° 附近，那里两格之间只剩 7.9 个单位。
 * 所以圆形模式下"大"会被置灰，并给出这条理由，而不是画一张没法下棋的棋盘。
 */
export function globeSupportsSpec(spec: BoardSpec): boolean {
  return globeWorstMinGap(spec) >= GLOBE_MIN_GAP_RATIO;
}

/** 按形状随机一个本局窗口。圆形模式只在 reachableLatTops 里抽纬度上沿。 */
export function randomRangeFor(
  shape: BoardShape,
  spec: BoardSpec,
  rand: () => number = Math.random
): BoardRange {
  const pool = reachableLatTops(spec, shape);
  const tops = pool.length > 0 ? pool : latTops(spec);
  const lefts = lonLefts(spec);
  const pick = (list: number[]): number =>
    list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
  return { latTop: pick(tops), lonLeft: pick(lefts) };
}

/** 当前窗口在这个形状下画得出来吗（见 reachableLatTops / lonLefts）。 */
export function rangeReachable(
  range: BoardRange,
  spec: BoardSpec,
  shape: BoardShape
): boolean {
  return (
    reachableLatTops(spec, shape).includes(range.latTop) &&
    lonLefts(spec).includes(range.lonLeft)
  );
}

/**
 * 窗口四条边绕一圈的采样点，用来画"能下棋的范围"那条边界线。
 *
 * 方形棋盘上这四条边是直是曲都无所谓（本来就是矩形），但圆形棋盘上它们是弧 ——
 * 少了这条线，学生分不清"圆盘里哪些交点是能落的”。顺序是上→右→下→左，
 * 首尾相接可以闭合成一个环。
 */
export function windowOutlineSamples(range: BoardRange, spec: BoardSpec): Sample[] {
  const lonL = range.lonLeft;
  const lonR = lonRight(range, spec);
  const latB = latBottom(range, spec);
  const latT = range.latTop;
  const out: Sample[] = [];
  const push = (samples: Sample[]) => {
    for (const sample of samples) out.push(sample);
  };
  push(sampleLine("lat", latT, lonL, lonR, WINDOW_SAMPLE_DEG));
  push(sampleLine("lon", lonR, latT, latB, WINDOW_SAMPLE_DEG));
  push(sampleLine("lat", latB, lonR, lonL, WINDOW_SAMPLE_DEG));
  push(sampleLine("lon", lonL, latB, latT, WINDOW_SAMPLE_DEG));
  return out;
}

/* ===================== 正反投影 ===================== */

/** 经纬度 → 画布坐标；落在背面则返回 null。 */
export function project(
  vp: Viewport,
  lon: number,
  lat: number
): { x: number; y: number } | null {
  if (vp.shape === "flat") {
    return {
      x: vp.left + ((lon - vp.lonLeft) / vp.degStep) * vp.step,
      y: vp.top + ((vp.latTop - lat) / vp.degStep) * vp.step
    };
  }
  const unit = orthoProject(lon, lat, vp.lon0, vp.lat0);
  if (!unit) {
    return null;
  }
  return { x: vp.cx + unit.x * vp.scale, y: vp.cy - unit.y * vp.scale };
}

/** 画布坐标 → 经纬度；落在棋盘之外（圆盘外 / 方形框外）则返回 null。 */
export function unproject(
  vp: Viewport,
  x: number,
  y: number
): { lon: number; lat: number } | null {
  if (vp.shape === "flat") {
    return {
      lon: vp.lonLeft + ((x - vp.left) / vp.step) * vp.degStep,
      lat: vp.latTop - ((y - vp.top) / vp.step) * vp.degStep
    };
  }
  return orthoUnproject((x - vp.cx) / vp.scale, (vp.cy - y) / vp.scale, vp.lon0, vp.lat0);
}

/**
 * 反投影的"预编译"版本：把不随像素变化的量提前算好。
 *
 * 贴图重采样要逐像素跑几十万次，每次都现算 sin/cos φ0 是白扔的。
 * 公式仍然只有 inverseOrtho 那一份，这里只是把参数提出去。
 */
export function makeUnprojector(
  vp: Viewport
): (x: number, y: number) => { lon: number; lat: number } | null {
  if (vp.shape === "flat") {
    return (x, y) => ({
      lon: vp.lonLeft + ((x - vp.left) / vp.step) * vp.degStep,
      lat: vp.latTop - ((y - vp.top) / vp.step) * vp.degStep
    });
  }
  const phi0 = vp.lat0 * RAD;
  const sinPhi0 = Math.sin(phi0);
  const cosPhi0 = Math.cos(phi0);
  const { cx, cy, scale, lon0 } = vp;
  return (x, y) => inverseOrtho((x - cx) / scale, (cy - y) / scale, lon0, sinPhi0, cosPhi0);
}

/**
 * 圆盘外接半径对应的角距（度）—— 也就是"棋盘最远的那个角离视角中心多少度"。
 * 圆盘半径除以单位球半径就是这个角的正弦，student 读不出来也没关系，
 * 它只用来判断"这个窗口是不是已经伸到半球边缘了"。
 */
export function discAngularRadius(vp: GlobeViewport): number {
  return Math.asin(Math.min(1, vp.radius / vp.scale)) / RAD;
}

/**
 * 视角中心处一格的横向尺寸（用户单位）。
 *
 * 圆形棋盘的标签沿中轴线摆放，所以**字号该按中轴线上的格距定，而不是按最窄的那一格**：
 * 最窄的一格在圆盘边缘，那里本来就不放标签。用最小格距定字号会让中间的字小得读不清。
 * 横向而非纵向：横向那一格还要乘 cos(纬度)，是两者里更紧的那个。
 */
export function centerCellWidth(vp: GlobeViewport, spec: BoardSpec): number {
  return vp.scale * Math.cos(vp.lat0 * RAD) * Math.sin(spec.degStep * RAD);
}

/* ===================== 折线 → SVG path ===================== */

export interface Sample {
  lon: number;
  lat: number;
}

/**
 * 一条等间隔采样的纬线或经线。
 *
 * `from`/`to` 是**采样参数**（纬线时是经度、经线时是纬度），
 * `fixed` 是固定住的那一维。
 */
export function sampleLine(
  kind: "lat" | "lon",
  fixed: number,
  from: number,
  to: number,
  step: number
): Sample[] {
  const out: Sample[] = [];
  const count = Math.max(2, Math.ceil(Math.abs(to - from) / Math.abs(step)) + 1);
  for (let i = 0; i < count; i += 1) {
    const value = from + ((to - from) * i) / (count - 1);
    out.push(kind === "lat" ? { lon: value, lat: fixed } : { lon: fixed, lat: value });
  }
  return out;
}

/**
 * 采样点 → SVG path 的 `d`。
 *
 * 遇到背面（project 返回 null）就**断开重起**，而不是连线 ——
 * 正射投影的可见区是一条弧，硬连会把直线横穿整个圆盘。
 */
export function pathFromSamples(vp: Viewport, samples: Sample[], precision = 2): string {
  const parts: string[] = [];
  let pen = false;
  for (const sample of samples) {
    const point = project(vp, sample.lon, sample.lat);
    if (!point) {
      pen = false;
      continue;
    }
    const x = point.x.toFixed(precision);
    const y = point.y.toFixed(precision);
    parts.push(`${pen ? "L" : "M"}${x} ${y}`);
    pen = true;
  }
  return parts.join(" ");
}

/** 采样步长：窗口内的格线要细一些（它决定弧线像不像弧），窗口外那一圈可以粗。 */
export const WINDOW_SAMPLE_DEG = 1;
export const GHOST_SAMPLE_DEG = 3;

/** 窗口内一条纬线的采样点。 */
export function parallelSamples(range: BoardRange, spec: BoardSpec, lat: number): Sample[] {
  return sampleLine("lat", lat, range.lonLeft, lonRight(range, spec), WINDOW_SAMPLE_DEG);
}

export function meridianSamples(range: BoardRange, spec: BoardSpec, lon: number): Sample[] {
  return sampleLine("lon", lon, latBottom(range, spec), range.latTop, WINDOW_SAMPLE_DEG);
}

/**
 * 同一条纬线 / 经线**延伸到窗口之外**的部分，用来把圆盘的四个"月牙"填满。
 *
 * 为什么要有它：圆盘半径是按窗口四角定的，四条边的中点离圆边就还有一段距离，
 * 空着会像画漏了。把格线继续画出去，整张图立刻读成"一个地球仪，
 * 棋盘只是它正中间的那一块"。画得比棋盘线淡，学生一眼能分出哪块能下棋。
 */
export function ghostParallelSamples(lat: number): Sample[] {
  return sampleLine("lat", lat, -180, 180, GHOST_SAMPLE_DEG);
}

export function ghostMeridianSamples(lon: number): Sample[] {
  return sampleLine("lon", lon, -90, 90, GHOST_SAMPLE_DEG);
}
