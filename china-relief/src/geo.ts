/**
 * 纯逻辑：投影、DEM / 遮罩 / 区域位图的解码、几何工具。
 *
 * 这一层刻意不依赖 React 与 three.js —— 于是"落点判定对不对""投影正反变换
 * 是否自洽"能用 Node 直接跑回归（scripts/game.test.cjs），
 * 而不必开浏览器截图去看。
 *
 * ## 投影：为什么是"按 cos(36°) 修正的等距圆柱"
 *
 * 游戏要把经纬度栅格上的 DEM 逐格搬到三维顶点上，并在同一套索引空间里
 * 做隆起、着色和落点判定。等距圆柱下网格 (i,j) 与顶点 (x,z) 一一对应，
 * 全都退化成查表；换成 Albers 就要给每个顶点做反投影，精度省下的那点形变
 * 远抵不过复杂度。x 方向乘 cos(36°) 之后，南北与东西的**地面米数比例**
 * 与真实一致 —— 这是"中国看起来没有横向拉长"的关键。
 *
 * 世界单位取 100 km，好让相机 near/far、光照距离都落在顺手量级。
 */
import { CHINA_DEM } from "./data/china-dem";
import { REGION_GRID } from "./data/regions";
import type { RangeDef } from "./data/regions";

export { CHINA_DEM };

export const KM_PER_DEG = 111.32;
/** 世界单位：1 unit = 100 km */
export const WORLD_UNIT_KM = 100;
/** 垂直夸张：全国高差 7 km 对上 5700 km 跨度，不夸张就完全看不出起伏 */
export const VERTICAL_EXAGGERATION = 26;
/** 米 → 世界单位 */
export const ALT_TO_WORLD = VERTICAL_EXAGGERATION / (WORLD_UNIT_KM * 1000);

export const SPAN_X =
  ((CHINA_DEM.lon1 - CHINA_DEM.lon0) * KM_PER_DEG * CHINA_DEM.lonScale) / WORLD_UNIT_KM;
export const SPAN_Z = ((CHINA_DEM.lat1 - CHINA_DEM.lat0) * KM_PER_DEG) / WORLD_UNIT_KM;
export const GRID_W = CHINA_DEM.width;
export const GRID_H = CHINA_DEM.height;

/* ------------------------------- 投影 ------------------------------- */

export function lonToX(lon: number): number {
  return ((lon - CHINA_DEM.lon0) * KM_PER_DEG * CHINA_DEM.lonScale) / WORLD_UNIT_KM - SPAN_X / 2;
}

export function latToZ(lat: number): number {
  // 北在 -z：相机从南侧上方看过去，屏幕上方就是北
  return ((CHINA_DEM.lat1 - lat) * KM_PER_DEG) / WORLD_UNIT_KM - SPAN_Z / 2;
}

export function xToLon(x: number): number {
  return ((x + SPAN_X / 2) * WORLD_UNIT_KM) / (KM_PER_DEG * CHINA_DEM.lonScale) + CHINA_DEM.lon0;
}

export function zToLat(z: number): number {
  return CHINA_DEM.lat1 - ((z + SPAN_Z / 2) * WORLD_UNIT_KM) / KM_PER_DEG;
}

/**
 * 取景框在画布里的摆放（等比铺满、四周留 4% 呼吸位）。
 *
 * **画布与「影像底图瓦片层」必须共用这一个函数**：瓦片是 DOM 元素、地形是
 * 画布像素，两边各算一套浮点数迟早会错开半个像素，那时影像和等高线就会
 * 各说各话 —— 而这类错位从画面上看只会像"图有点糊"，很难归因。
 */
export const MAP_FIT = 0.96;

export interface MapLayout {
  mapScale: number;
  mapX: number;
  mapY: number;
}

export function mapLayout(w: number, h: number): MapLayout {
  const mapScale = Math.min(w / SPAN_X, h / SPAN_Z) * MAP_FIT;
  return {
    mapScale,
    mapX: (w - SPAN_X * mapScale) / 2,
    mapY: (h - SPAN_Z * mapScale) / 2
  };
}

/** 经纬度 → 画布内像素坐标（左上为原点） */
export function lonLatToCanvas(
  lon: number,
  lat: number,
  layout: MapLayout
): { x: number; y: number } {
  return {
    x: layout.mapX + (lonToX(lon) + SPAN_X / 2) * layout.mapScale,
    y: layout.mapY + (latToZ(lat) + SPAN_Z / 2) * layout.mapScale
  };
}

/** 经纬度 → 最近的栅格下标（会夹到边界内） */
export function gridIndex(lon: number, lat: number): { i: number; j: number } {
  const i = Math.round(((lon - CHINA_DEM.lon0) / (CHINA_DEM.lon1 - CHINA_DEM.lon0)) * (GRID_W - 1));
  const j = Math.round(((CHINA_DEM.lat1 - lat) / (CHINA_DEM.lat1 - CHINA_DEM.lat0)) * (GRID_H - 1));
  return {
    i: Math.min(GRID_W - 1, Math.max(0, i)),
    j: Math.min(GRID_H - 1, Math.max(0, j))
  };
}

/* ----------------------------- 数据解码 ----------------------------- */

function b64ToBytes(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/** DEM 高程（米），行主序：idx = j * W + i，j=0 最北、i=0 最西 */
export function decodeAltitude(): Float32Array {
  const bytes = b64ToBytes(CHINA_DEM.b64);
  const n = GRID_W * GRID_H;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    out[k] = view.getUint16(k * 2, true);
  }
  return out;
}

/** 陆地遮罩（1 = 中国境内），一位一格 */
export function decodeLandMask(): Uint8Array {
  const bytes = b64ToBytes(CHINA_DEM.maskB64);
  const n = GRID_W * GRID_H;
  const out = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    out[k] = (bytes[k >> 3] >> (7 - (k & 7))) & 1;
  }
  return out;
}

/** 区域归属图：每格 4 bit，0 = 不属于任何地形区，其余是 AreaDef.gridId */
export function decodeRegionGrid(): Uint8Array {
  const bytes = b64ToBytes(REGION_GRID.b64);
  const n = GRID_W * GRID_H;
  const out = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const byte = bytes[k >> 1];
    out[k] = k & 1 ? byte & 0x0f : (byte >> 4) & 0x0f;
  }
  return out;
}

/* ----------------------------- 几何工具 ----------------------------- */

export function pointInRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** 点到折线的最近距离（度）。经度按 cos(36°) 折算，避免高纬处"看着近其实远"。 */
export function distToPolyline(
  lon: number,
  lat: number,
  line: [number, number][],
  lonScale = CHINA_DEM.lonScale
): number {
  let best = Infinity;
  for (let k = 0; k < line.length - 1; k++) {
    const [ax, ay] = line[k];
    const [bx, by] = line[k + 1];
    const vx = (bx - ax) * lonScale;
    const vy = by - ay;
    const wx = (lon - ax) * lonScale;
    const wy = lat - ay;
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, (wx * vx + wy * vy) / len2));
    const dx = wx - t * vx;
    const dy = wy - t * vy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < best) {
      best = d;
    }
  }
  return best;
}

/* ----------------------------- 落点判定 ----------------------------- */

export interface DropVerdict {
  ok: boolean;
  /** 给学生的提示：放对了也提示一句，放错了说清"偏到哪儿去了" */
  message: string;
}

/**
 * 地形区判定：落点落在**本区**的栅格里才算对。
 *
 * 为什么查位图而不是"离中心点多近"：
 * 地形区是有面积的，学生把"塔里木盆地"丢到天山北边的准噶尔去，
 * 按中心距离可能也算"近"；查位图则直接问"这一格到底属于谁"，
 * 判定口径和地图本身完全一致。位图是按"小面积优先"生成的，
 * 所以柴达木那种嵌在青藏高原内部的盆地也能各归各位。
 */
export function judgeAreaDrop(
  lon: number,
  lat: number,
  targetGridId: number,
  regionGrid: Uint8Array,
  names: Map<number, string>
): DropVerdict {
  const { i, j } = gridIndex(lon, lat);
  const id = regionGrid[j * GRID_W + i];
  if (id === targetGridId) {
    return { ok: true, message: "归位！" };
  }
  if (id === 0) {
    return { ok: false, message: "这一格不属于任何地形区，再想想它在哪儿" };
  }
  const other = names.get(id) ?? "别的地形区";
  return { ok: false, message: `这里是「${other}」，不是你要放的那块` };
}

/**
 * 山脉判定：落点要离**本山脉**的走带最近。
 *
 * 光看"离目标折线 < 阈值"不够 —— 太行山和燕山、太行山和秦岭都会互相蹭到，
 * 于是再加一条"最近的那条必须是它"，学生就不可能在燕山上交太行山的卷。
 */
export function judgeRangeDrop(
  lon: number,
  lat: number,
  targetId: string,
  ranges: RangeDef[],
  tolDeg: number
): DropVerdict {
  const target = ranges.find((r) => r.id === targetId);
  if (!target) {
    return { ok: false, message: "数据里没有这条山脉" };
  }
  const dTarget = distToPolyline(lon, lat, target.line);
  if (dTarget > tolDeg) {
    return { ok: false, message: "离这条山脉的走向还差得远，再找找" };
  }
  let nearest = target;
  let dNearest = dTarget;
  for (const r of ranges) {
    if (r.id === targetId) {
      continue;
    }
    const d = distToPolyline(lon, lat, r.line);
    if (d < dNearest) {
      dNearest = d;
      nearest = r;
    }
  }
  if (nearest.id !== targetId) {
    return { ok: false, message: `这里离「${nearest.name}」更近一些` };
  }
  return { ok: true, message: "归位！" };
}

/** 落点是否在中国境内（含岛屿）。放对了但落在海里也要拦住。 */
export function insideChina(lon: number, lat: number, mask: Uint8Array): boolean {
  const { i, j } = gridIndex(lon, lat);
  return mask[j * GRID_W + i] === 1;
}
