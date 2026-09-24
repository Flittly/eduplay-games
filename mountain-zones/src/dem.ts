/**
 * DEM 运行时：把内嵌的真实高程网格变成可变换、可采样的高程场。
 *
 * ## 两份数组，各管一件事
 *
 * `raw` —— 真实 DEM 的只读副本，**任何操作都不写它**，是「一键还原真实地形」的依据。
 * `alt` —— 当前海拔 = `max(0, raw + elevationOffset)`。
 *
 * 拖动高程偏移滑块时改的就是 `alt`（真的在改 DEM 上的值），
 * 而 `raw` 始终留着，所以「还原真实地形」永远是一个 O(n) 加法，不需要重新下载任何数据。
 *
 * 垂直夸张**不进** `alt` —— 它只在渲染时乘到顶点纵坐标上，不影响海拔读数。
 * 详见 `data/types.ts` 里 DemField 的注释。
 *
 * ## 为什么偏移要 clamp 到 0
 *
 * 往下偏移会让山脚变成负海拔。这个游戏不涉及水下地形，
 * 负高度只会让「海拔读数」变得没法解释（「山脚 −300 米」？），
 * 所以 `alt` 统一钳制在 ≥ 0，等价于「海平面以下的部分被淹掉」。
 */

import type { DemField, DemSource } from "./data/types";

/** base64 → 字节数组。`atob` 在浏览器与 Node 18+ 都是全局可用的。 */
function decodeB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export const EXAGGERATION_MIN = 0.5;
/**
 * 上限定 20 —— v2.4.1 从 2.0 抬上来的。
 *
 * 起因是「自动推荐垂直夸张」：`landform.ts` 的坡度取向公式会给
 * 华北平原算到 ×20（30 km 内高差只有 40 m，不抬就是一张纸）。
 * 上限还留在 2.0 的话，推荐值会被 `applyElevation` 静默夹回 2.0 ——
 * 界面上显示的仍是 ×2.00，看起来"自动推荐生效了"，其实平原还是那张纸。
 */
export const EXAGGERATION_MAX = 20;
export const OFFSET_LIMIT = 2000;

/**
 * 夸张滑块用**对数刻度**，不是线性。
 *
 * 0.5~20 这个区间里，能被用到的值集中在低段（1、1.5、2、3），
 * 线性刻度下 0.5→2 只占 7.7% 的行程 —— 在一条 200 px 的滑块上
 * 就是 15 px，"想微调一下"根本点不准。
 *
 * 对数刻度让**相等的比例**占相等的行程：0.5→2（×4）与 5→20（×4）
 * 一样宽。0.5~2 于是占到 38% 的行程，而 ×20 附近本来就只需要粗调。
 */
export const EXAGGERATION_SLIDER_STEPS = 1000;

/** 夸张系数 → 滑块位置（0 ~ `EXAGGERATION_SLIDER_STEPS`） */
export function exagToSlider(v: number): number {
  const clamped = Math.max(EXAGGERATION_MIN, Math.min(EXAGGERATION_MAX, v));
  const t = Math.log(clamped / EXAGGERATION_MIN) / Math.log(EXAGGERATION_MAX / EXAGGERATION_MIN);
  return Math.round(t * EXAGGERATION_SLIDER_STEPS);
}

/** 滑块位置 → 夸张系数（保留两位小数，避免滑块上出现 ×2.4200000001） */
export function sliderToExag(t: number): number {
  const frac = Math.max(0, Math.min(1, t / EXAGGERATION_SLIDER_STEPS));
  const raw = EXAGGERATION_MIN * Math.pow(EXAGGERATION_MAX / EXAGGERATION_MIN, frac);
  return Math.round(raw * 100) / 100;
}

/** 从数据源建一个高程场（初始为「真实地形」：不偏移、不夸张） */
export function createField(source: DemSource): DemField {
  const bytes = decodeB64(source.b64);
  // Uint16Array 用平台字节序（x86 / ARM 均为小端，与生成脚本一致）
  const u16 = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
  const raw = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) {
    raw[i] = u16[i];
  }
  const field: DemField = {
    source,
    raw,
    alt: new Float32Array(raw.length),
    grid: source.grid,
    spanM: source.spanKm * 1000,
    minH: 0,
    maxH: 0,
    peakI: 0,
    peakJ: 0,
    verticalExaggeration: 1,
    elevationOffset: 0
  };
  applyElevation(field, 1, 0);
  return field;
}

/**
 * 重算海拔：`alt = max(0, raw + offset)`，并刷新统计。
 *
 * ⚠️ 这是唯一改写 `alt` 的地方。任何「改海拔」的入口都必须走它，
 * 否则 `minH/maxH/peakI/peakJ` 会与 `alt` 脱节，
 * 等高线、剖面图、面板读数就会互相打架。
 */
export function applyElevation(field: DemField, verticalExaggeration: number, elevationOffset: number): void {
  const { raw, alt, grid } = field;
  let minH = Infinity;
  let maxH = -Infinity;
  let peakIdx = 0;
  for (let k = 0; k < raw.length; k++) {
    const v = raw[k] + elevationOffset;
    const c = v < 0 ? 0 : v;
    alt[k] = c;
    if (c < minH) minH = c;
    if (c > maxH) {
      maxH = c;
      peakIdx = k;
    }
  }
  field.verticalExaggeration = Math.max(EXAGGERATION_MIN, Math.min(EXAGGERATION_MAX, verticalExaggeration));
  field.elevationOffset = elevationOffset;
  field.minH = minH;
  field.maxH = maxH;
  field.peakI = peakIdx % grid;
  field.peakJ = Math.floor(peakIdx / grid);
}

/** 一键回到真实地形（`raw` 从未被动过，所以这一步永远无损） */
export function restoreReal(field: DemField): void {
  applyElevation(field, 1, 0);
}

/** 是否已偏离真实 DEM */
export function isModified(field: DemField): boolean {
  return Math.abs(field.verticalExaggeration - 1) > 1e-6 || Math.abs(field.elevationOffset) > 1e-6;
}

/** 整数网格索引取样（越界钳制）—— 返回**海拔** */
export function heightAtIndex(field: DemField, i: number, j: number): number {
  const { grid, alt } = field;
  const ii = i < 0 ? 0 : i >= grid ? grid - 1 : i;
  const jj = j < 0 ? 0 : j >= grid ? grid - 1 : j;
  return alt[jj * grid + ii];
}

/**
 * 分数网格索引双线性采样 —— 返回**海拔**。
 *
 * 3D 相机跟随、鼠标拾取海拔、剖面图采样都走这里 —— 保证「同一位置读到的海拔」
 * 在视图上、面板上、剖面上完全一致。
 */
export function sampleGrid(field: DemField, x: number, y: number): number {
  const { grid } = field;
  const cx = x < 0 ? 0 : x > grid - 1 ? grid - 1 : x;
  const cy = y < 0 ? 0 : y > grid - 1 ? grid - 1 : y;
  const i0 = Math.floor(cx);
  const j0 = Math.floor(cy);
  const i1 = i0 + 1 > grid - 1 ? grid - 1 : i0 + 1;
  const j1 = j0 + 1 > grid - 1 ? grid - 1 : j0 + 1;
  const fx = cx - i0;
  const fy = cy - j0;
  const v00 = heightAtIndex(field, i0, j0);
  const v10 = heightAtIndex(field, i1, j0);
  const v01 = heightAtIndex(field, i0, j1);
  const v11 = heightAtIndex(field, i1, j1);
  return (
    v00 * (1 - fx) * (1 - fy) +
    v10 * fx * (1 - fy) +
    v01 * (1 - fx) * fy +
    v11 * fx * fy
  );
}

/** ---------- 网格坐标 ↔ 世界坐标 ---------- */

/** 网格索引（可为分数）→ 世界坐标 x/z（米，以山体中心为原点） */
export function gridToWorld(field: DemField, gx: number, gy: number): [number, number] {
  const half = field.spanM / 2;
  const d = field.grid - 1;
  return [(gx / d) * field.spanM - half, (gy / d) * field.spanM - half];
}

/** 世界坐标 x/z → 网格索引（可为分数） */
export function worldToGrid(field: DemField, x: number, z: number): [number, number] {
  const half = field.spanM / 2;
  const d = field.grid - 1;
  return [((x + half) / field.spanM) * d, ((z + half) / field.spanM) * d];
}

/** 世界坐标处的海拔（米） */
export function altitudeAtWorld(field: DemField, x: number, z: number): number {
  const [gx, gy] = worldToGrid(field, x, z);
  return sampleGrid(field, gx, gy);
}

/**
 * 视觉纵坐标（米，已含垂直夸张）。
 *
 * 只有渲染三维顶点时用它；任何面板读数都必须用 `alt` / `sampleGrid`。
 * 把两者混用会出现「相机按夸张后的高度摆位，面板却报真实海拔」的错配。
 */
export function visualY(field: DemField, altitude: number): number {
  return altitude * field.verticalExaggeration;
}

/**
 * 供 contour.ts 使用的取值函数。
 *
 * 读的是 `alt`（当前海拔）：高程偏移会让整条等高线换一个高度值 ——
 * 这正是我们想让学生看见的因果关系（山抬升 → 同一条线换了海拔标签）。
 * 垂直夸张则**不影响**它，因为它不是海拔。
 */
export function heightFn(field: DemField): (i: number, j: number) => number {
  return (i, j) => heightAtIndex(field, i, j);
}
