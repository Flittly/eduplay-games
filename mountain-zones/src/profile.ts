/**
 * 地形剖面：沿任意两点连线的纯逻辑抽样与统计。
 *
 * ## 为什么不复用 `view3d` 的巡游路线
 *
 * 巡游路线是"从峰顶沿最陡下降方向追出来的那条路"，只有一条、由程序决定；
 * 而课上要的是**学生自己点的任意两点** —— 可以横切山谷、可以沿山脊、可以并排
 * 取两条走向不同的线来对比。所以这里只做两件事：等距抽样、算统计量。
 * 不碰 DOM、不碰 three.js，因此能直接 Node 单测。
 *
 * ## 距离口径
 *
 * 抽样点按**地面等距网格**（`spanM / (grid-1)` 米/格）折算水平距离。
 * 网格本身在生成时已按 `cos(lat)` 修正过经度方向，所以这里的"米"是真实地面米，
 * 不同纬度的样本之间可以横向比较 —— 这一点很要紧，否则高纬的线会显得"更长"。
 */

import { bilerp } from "./contour";

export type Pt = [number, number];

export interface ProfileSample {
  /** 从起点算起的水平距离（米） */
  distM: number;
  /** 该处海拔（米） */
  alt: number;
}

/**
 * 沿 a→b 线段等距抽 `count` 个点的高程。
 *
 * 用双线性插值（`bilerp`）而不是四舍五入到最近格点：格距 118 m，
 * 取整会让剖面出现锯齿状的台阶，学生会以为是地形的台阶。
 */
export function sampleProfile(
  h: (i: number, j: number) => number,
  n: number,
  spanM: number,
  a: Pt,
  b: Pt,
  count = 200
): ProfileSample[] {
  const cellM = spanM / (n - 1);
  const total = Math.hypot(b[0] - a[0], b[1] - a[1]) * cellM;
  const steps = Math.max(2, Math.min(600, Math.round(count)));
  const out: ProfileSample[] = [];
  for (let k = 0; k < steps; k++) {
    const t = steps === 1 ? 0 : k / (steps - 1);
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    out.push({ distM: total * t, alt: bilerp(h, n, x, y) });
  }
  return out;
}

export interface ProfileStats {
  startAlt: number;
  endAlt: number;
  maxAlt: number;
  minAlt: number;
  /** 最高点出现的水平距离（米） */
  maxAtM: number;
  minAtM: number;
  /** 相对高差 max − min（米） */
  relief: number;
  /** 水平长度（米） */
  lengthM: number;
  /** 累计爬升 / 累计下降（米）—— 比"起终落差"更能反映翻越难度 */
  gainM: number;
  lossM: number;
  /** 最陡一段的坡度（度）与位置 */
  steepestDeg: number;
  steepestAtM: number;
}

/**
 * 剖面统计。
 *
 * ⚠️ 坡度用**相邻抽样点**算而不是起终点：起终点算出来的是"平均比降"，
 * 一条翻过 4000 m 山脊的线平均比降可能只有 2°，看着像平地。
 * 课上要问"哪里最陡"，必须按段落逐段比。
 */
export function profileStats(pts: ProfileSample[]): ProfileStats {
  const empty: ProfileStats = {
    startAlt: 0, endAlt: 0, maxAlt: 0, minAlt: 0, maxAtM: 0, minAtM: 0,
    relief: 0, lengthM: 0, gainM: 0, lossM: 0, steepestDeg: 0, steepestAtM: 0
  };
  if (pts.length < 2) {
    return empty;
  }
  let maxAlt = -Infinity;
  let minAlt = Infinity;
  let maxAtM = 0;
  let minAtM = 0;
  let gain = 0;
  let loss = 0;
  let steepest = 0;
  let steepestAt = 0;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    if (p.alt > maxAlt) { maxAlt = p.alt; maxAtM = p.distM; }
    if (p.alt < minAlt) { minAlt = p.alt; minAtM = p.distM; }
    if (k > 0) {
      const d = p.alt - pts[k - 1].alt;
      if (d > 0) gain += d;
      else loss -= d;
      const run = p.distM - pts[k - 1].distM;
      if (run > 1e-6) {
        const deg = (Math.atan(Math.abs(d) / run) * 180) / Math.PI;
        if (deg > steepest) { steepest = deg; steepestAt = (p.distM + pts[k - 1].distM) / 2; }
      }
    }
  }
  return {
    startAlt: pts[0].alt,
    endAlt: pts[pts.length - 1].alt,
    maxAlt,
    minAlt,
    maxAtM,
    minAtM,
    relief: maxAlt - minAlt,
    lengthM: pts[pts.length - 1].distM,
    gainM: gain,
    lossM: loss,
    steepestDeg: steepest,
    steepestAtM: steepestAt
  };
}

const COMPASS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"] as const;

/**
 * 线段走向（方位角，度）与中文罗盘方位。
 *
 * 网格约定：`i` 向东、`j` 向南（与 `PlaneGeometry` 转 −90° 之后的顶点序一致），
 * 所以正北是 `−j` 方向。方位角从正北顺时针量，正好等于
 * `atan2(向东, 向北)`。
 *
 * 这个量是给"对比"用的：两条走向差 90° 的剖面（比如一条横切山谷、
 * 一条沿山脊）放在一起看，能直接讲出"为什么同样长度高差差这么多"。
 */
export function bearingDeg(a: Pt, b: Pt): number {
  const east = b[0] - a[0];
  const north = -(b[1] - a[1]);
  const deg = (Math.atan2(east, north) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function compassLabel(deg: number): string {
  const k = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return COMPASS[k];
}
