/**
 * 「手里那一块」的形状掩膜（v2.2.0）。
 *
 * ## 解决的是什么
 *
 * 拖动卡片时，屏幕上原来只有一枚准星 + 一个写着名字的小牌子 ——
 * 学生**看不到自己手里这块地长什么样**。用户的原话是
 * 「请你将地形的本身显示出来，也就是不要只是一个鼠标箭头」。
 *
 * 所以这里把"这一条在地图上占哪些格"单独抽成一张掩膜，
 * 交给 App 在指针处按**真实比例**画一遍（半透明），
 * 于是"手里这块"与"地图上那块"是同一个形状、同一个大小、同一个朝向。
 *
 * ## 掩膜口径：与塑形**同源**，不新发明
 *
 * | 条目 | 掩膜 = | 依据 |
 * |---|---|---|
 * | 地形区 | `data.region[k] === area.gridId` | `applyItem` 里 `liftTarget[k]=1` 的**同一批格子** |
 * | 山脉 | `distToRange(...) <= corridorHalfDeg(range)` | `buildRidge` 里 `liftField[k] > 0` 的**同一个判据** |
 *
 * 两条都不是"照着 ring 折线另画一遍"：
 *   · 地形区用的是**区域归属位图**，`pick.ts` 的命中③、`judgeAreaDrop` 的落点判定
 *     用的也是它 —— 于是"看得见的色块 / 点得中的范围 / 拖上去算对的范围 / 手里拿的形状"
 *     四处同源；
 *   · 山脉用的是 `geo.ts` 的 `distToRange` + `corridorHalfDeg()`，与 `buildRidge`
 *     塑形、与 `pick.ts` 的命中②**共用同一个函数**，横断山脉那种带
 *     `lift_half_deg` 的自动收窄，这里不需要写第二条特例。
 *
 * ⚠️ 反过来说：**别在这里改用 `ring` 折线或多边形填充**。折线是"边界"，
 *    归属位图是"哪些格真的被塑起来了"，两者在海岸线上并不重合
 *    （环是按经度绘制的，位图被投影网格采样过）。一旦改过去，
 *    手里拿的形状会与放下去之后浮出来的色块差一圈 —— 而这一圈
 *    只在海边和岛礁上出现，最难归因。
 *
 * ## 为什么返回"包围盒 + 掩膜"而不是整张网格
 *
 * 整张投影网格是 575 × 387 = 222 525 格（约 0.9 MB/份），39 条各来一份
 * 就是 35 MB —— 而每一条实际只占几千到几万格。裁到包围盒之后
 * 一条通常只有几十 KB，而且**画的时候正好就是要画的矩形**，
 * 不需要再自己算一次裁剪。
 */

import {
  CELL_KM,
  GRID_H,
  GRID_W,
  KM_PER_DEG,
  PROJ_GRID,
  corridorHalfDeg,
  distToRange,
  projGridIndex
} from "./geo";
import type { TerrainData } from "./geo";
import { CHINA_DEM } from "./data/china-dem";
import { gridToLonLat } from "./proj";
import type { RangeDef } from "./data/regions";

/** 能取形状的最小接口。刻意不 import App.tsx 的 `Item`（那会把 React 拽进来） */
export interface ShapeSource {
  id: string;
  /** 地形区才有 */
  area?: { gridId: number };
  /** 山脉才有 */
  range?: RangeDef;
}

export interface ShapeBox {
  /** 掩膜左上角在**投影网格**里的下标 */
  i0: number;
  j0: number;
  /** 掩膜尺寸（格） */
  w: number;
  h: number;
  /** `w * h` 个字节，1 = 这一格属于本条 */
  mask: Uint8Array;
  /** 属于本条的格数（= mask 里 1 的个数），供回归断言用 */
  cells: number;
  /**
   * 抓取点（**掩膜内的局部下标**）。
   *
   * 取"离形状质心**最近的掩膜格**"，而不是质心本身：质心是个平均值，
   * 凹形状（长江中下游平原那种）与一列平行山岭（横断山脉）都可能让它
   * 落在形状**外面** —— 那会导致"松手时判的就是这一点"判在一个
   * 根本不属于这块地的位置上。取最近的真格就永远落在形状里。
   */
  gripI: number;
  gripJ: number;
}

/**
 * 抓取点相对掩膜左上角的像素偏移。
 *
 * ⚠️ 取格**中心**（`+0.5`）：掩膜的一格在地图上就是"一格宽"的一小块，
 * 用左上角当锚点会整体偏半格（约 1 px），而准星画在指针上 ——
 * 半格的偏差在容差只有十几像素时是会被看出来的。
 */
export function gripOffsetPx(box: ShapeBox, cellPxX: number, cellPxY: number): { x: number; y: number } {
  return { x: (box.gripI + 0.5) * cellPxX, y: (box.gripJ + 0.5) * cellPxY };
}

/** 一条山脉的扫描窗口要比走廊宽出多少格（见下面 `rangeBox` 的注释） */
function padCellsFor(halfDeg: number): number {
  // 1° 纬度 = KM_PER_DEG km，一格 = CELL_KM km ⇒ 每度约 9.4 格；
  // 经度方向被 lonScale(≈0.809) 压缩过 ⇒ 同样的"度"要占更多格（约 11.6 格/度）。
  // 取经度那一侧（更宽的）再加 2 格保险。
  return Math.ceil((halfDeg / CHINA_DEM.lonScale) * (KM_PER_DEG / CELL_KM)) + 2;
}

/** `#rrggbb` → `[r,g,b]`。格式不认得时给中灰（宁可颜色不对，也不要整块不画） */
export function hexToRGB(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    return [128, 128, 128];
  }
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * 填色与描边的**不透明度**（0~255）。
 *
 * 用户的原话是「颜色整体可以半透明一点」，所以两层的 α 都给了"看得透"的值：
 *   · 填色 0.30 —— 底下的地形（灰阶 / 影像 / 已塑好的色块）**必须透得出来**，
 *     否则"拖动＝用一块贴纸盖住地图"，学生看不见自己要往哪儿对；
 *   · 描边 0.62 —— 比填色实一点，因为形状的**轮廓**才是对齐时要看的东西
 *     （尤其山脉那种细长条，填色很淡而轮廓决定"贴合没贴合"），
 *     但它仍然半透明，压在深色影像上不会变成一圈死黑。
 *
 * ⚠️ 描边色用 `outlineRGB(item.color)`（在 terrain.ts 里）—— 与"放下去之后
 *    浮出来的那条描边"**同一个函数**。用别处另算一个深色的话，
 *    同一块地在"手里"和"地上"会是两个颜色，而这种不一致看起来像 bug。
 */
export const SHAPE_FILL_ALPHA = 76;
export const SHAPE_EDGE_ALPHA = 158;

function finish(mask: Uint8Array, w: number, h: number, i0: number, j0: number): ShapeBox {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (mask[j * w + i]) {
        sx += i;
        sy += j;
        n++;
      }
    }
  }
  const cx = sx / n;
  const cy = sy / n;
  let gripI = 0;
  let gripJ = 0;
  let best = Infinity;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!mask[j * w + i]) {
        continue;
      }
      const dx = i - cx;
      const dy = j - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        gripI = i;
        gripJ = j;
      }
    }
  }
  return { i0, j0, w, h, mask, cells: n, gripI, gripJ };
}

/** 地形区：区域归属位图上等于这个 gridId 的格子 */
function areaBox(gridId: number, data: TerrainData): ShapeBox | null {
  const region = data.region;
  // 第一遍只找包围盒（不开大数组）—— 全网格一趟 22 万格，几毫秒，且每条只算一次
  let i0 = GRID_W;
  let i1 = -1;
  let j0 = GRID_H;
  let j1 = -1;
  for (let j = 0; j < GRID_H; j++) {
    const row = j * GRID_W;
    for (let i = 0; i < GRID_W; i++) {
      if (region[row + i] !== gridId) {
        continue;
      }
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      if (j > j1) j1 = j;
    }
  }
  if (i1 < 0) {
    return null;
  }
  const w = i1 - i0 + 1;
  const h = j1 - j0 + 1;
  const mask = new Uint8Array(w * h);
  for (let j = j0; j <= j1; j++) {
    const src = j * GRID_W;
    const dst = (j - j0) * w;
    for (let i = i0; i <= i1; i++) {
      if (region[src + i] === gridId) {
        mask[dst + (i - i0)] = 1;
      }
    }
  }
  return finish(mask, w, h, i0, j0);
}

/**
 * 山脉：到**最近那一条岭**的距离在走带半宽以内的格子（与 `buildRidge` 同判据）。
 *
 * 只在这条山脉的包围盒里扫 —— 和 `buildRidge` 一样，代价从"全网格"降到"几千格"。
 * 窗口按折线顶点算出来，再往外扩 `padCellsFor(halfDeg)`：
 * 到线段的距离不超过 `halfDeg` 的点，一定落在某个顶点周围
 * `halfDeg` 的范围内（距离到线段 ≤ 到最近顶点的距离），所以这个扩边是充分的。
 *
 * ⚠️ 窗口只是**扫描范围**，真正的包围盒由掩膜自己收紧（下面第二次求 min/max），
 *    所以扩边的宽窄不影响结果的正确性，只影响白扫多少格。
 */
function rangeBox(range: RangeDef, data: TerrainData): ShapeBox | null {
  const half = corridorHalfDeg(range);
  const pad = padCellsFor(half);
  const lines = range.lines && range.lines.length > 0 ? range.lines : [range.line];
  let i0 = GRID_W;
  let i1 = -1;
  let j0 = GRID_H;
  let j1 = -1;
  for (const line of lines) {
    for (const [lon, lat] of line) {
      const g = projGridIndex(lon, lat);
      if (g.i < i0) i0 = g.i;
      if (g.i > i1) i1 = g.i;
      if (g.j < j0) j0 = g.j;
      if (g.j > j1) j1 = g.j;
    }
  }
  if (i1 < 0) {
    return null;
  }
  i0 = Math.max(0, i0 - pad);
  j0 = Math.max(0, j0 - pad);
  i1 = Math.min(GRID_W - 1, i1 + pad);
  j1 = Math.min(GRID_H - 1, j1 + pad);

  const wi = i1 - i0 + 1;
  const wj = j1 - j0 + 1;
  const wide = new Uint8Array(wi * wj);
  // 收紧后的包围盒（在 wide 的局部坐标里）
  let a0 = wi;
  let a1 = -1;
  let b0 = wj;
  let b1 = -1;
  let n = 0;
  for (let j = 0; j < wj; j++) {
    const gj = j0 + j;
    const row = j * wi;
    for (let i = 0; i < wi; i++) {
      const k = (gj) * GRID_W + (i0 + i);
      // 海洋 / 图幅外不参与 —— 与 `applyItem` 里 `if (!data.land[k]) continue` 一致
      if (!data.land[k]) {
        continue;
      }
      const ll = gridToLonLat(PROJ_GRID, i0 + i, gj);
      if (distToRange(ll.lon, ll.lat, range) > half) {
        continue;
      }
      wide[row + i] = 1;
      n++;
      if (i < a0) a0 = i;
      if (i > a1) a1 = i;
      if (j < b0) b0 = j;
      if (j > b1) b1 = j;
    }
  }
  if (n === 0) {
    return null;
  }
  const w = a1 - a0 + 1;
  const h = b1 - b0 + 1;
  const mask = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    const src = (b0 + j) * wi + a0;
    const dst = j * w;
    for (let i = 0; i < w; i++) {
      mask[dst + i] = wide[src + i];
    }
  }
  return finish(mask, w, h, i0 + a0, j0 + b0);
}

/**
 * 取一条条目的形状。取不到（数据里没有这条 / 完全不落在陆地上）时返回 null。
 *
 * **调用方应当缓存结果**（按 item.id）：地形区那一支要走一趟 22 万格的全网格扫描，
 * 一条只算一次是几毫秒，每帧都算就是明显卡顿了。
 */
export function shapeBoxOf(item: ShapeSource, data: TerrainData): ShapeBox | null {
  if (item.area) {
    return areaBox(item.area.gridId, data);
  }
  if (item.range) {
    return rangeBox(item.range, data);
  }
  return null;
}

/**
 * 把掩膜涂成一张 RGBA 位图（**供 `putImageData` 使用，不碰 DOM**，所以能 Node 回归）。
 *
 * 两层：
 *   · 内部格 —— `fill`（半透明的地块色，让底下的地形透得出来）；
 *   · **边界格** —— `edge`（那条地形自己的深色描边）。
 *
 * 边界判据是**四邻**（上下左右），与渲染层 `isOwnerEdge` 同一套 ——
 * 于是"手里这块"的描边粗细与"放下去之后"浮出来的描边粗细一致，
 * 不会出现"拖的时候框很粗、放下就变细"这种落差。
 *
 * ⚠️ 包围盒之外一律当作"不是本块"。这是对的，因为 `ShapeBox` 的包围盒是**紧的**
 *    （`i0` 那一列一定真有掩膜格）—— 所以"越界即边界"不会误判，
 *    但**也不要**把 `mask` 换成一张更大的画布再调用这里，否则四边会平白多出一圈描边。
 */
export function paintShape(
  rgba: Uint8ClampedArray,
  box: ShapeBox,
  fill: readonly [number, number, number, number],
  edge: readonly [number, number, number, number]
): void {
  const { w, h, mask } = box;
  const at = (i: number, j: number): number =>
    i < 0 || j < 0 || i >= w || j >= h ? 0 : mask[j * w + i];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!mask[j * w + i]) {
        continue;
      }
      const isEdge = !at(i - 1, j) || !at(i + 1, j) || !at(i, j - 1) || !at(i, j + 1);
      const c = isEdge ? edge : fill;
      const p = (j * w + i) * 4;
      rgba[p] = c[0];
      rgba[p + 1] = c[1];
      rgba[p + 2] = c[2];
      rgba[p + 3] = c[3];
    }
  }
}
