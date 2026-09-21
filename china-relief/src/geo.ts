/**
 * 纯逻辑：投影、DEM / 遮罩 / 区域位图的解码、几何工具。
 *
 * 这一层刻意不依赖 React 与 canvas —— 于是"落点判定对不对""投影正反变换
 * 是否自洽""投影网格有没有盖住取景范围"能用 Node 直接跑回归
 * （scripts/game.test.cjs），而不必开浏览器截图去看。
 *
 * ## 投影：Albers 等积圆锥（v2.0.0 起，之前是"按 cos(36°) 修正的等距圆柱"）
 *
 * 为什么换、以及为什么换得起，全部写在 `proj.ts` 的头部注释里，这里只留
 * 一句最要紧的：**投影只影响"画在哪儿"，不影响"这一格属于谁"**。
 *
 * 于是这一层的结构是**两套网格并存**，而且它们各有各的用途、不许混用：
 *
 *   · **原经纬度栅格**（480 × 358，`SRC_W/SRC_H`）—— 判定用。
 *     `regionGrid` / `land` 都在这套网格上，`gridIndex()` 也只认它。
 *     它跟着数据走，永远不变。
 *   · **投影网格**（约 575 × 358，`GRID_W/GRID_H`）—— 渲染用。
 *     在投影平面上均匀划分，逐格反投影回经纬度、从上面那套采样。
 *     它跟着投影参数走，是"地图长什么样"的载体。
 *
 * ⚠️ 混用这两套是这一版最容易犯的错，而且**错得很安静**：
 * 拿投影网格的下标去查 `regionGrid`，落点判定会整体偏移十几格
 * （在图上是一百多公里），界面上的表现只是"判定有点不准"。
 * 所以 `judgeAreaDrop` 的入参刻意叫 `regionGrid` 而 `buildTerrainData`
 * 产出的那份叫 `region`（在 `proj` 字段里）——叫法不同，就不会顺手传错。
 *
 * 世界单位取 100 km（`WORLD_UNIT_KM`），好让相机 near/far、布局数字
 * 都落在顺手量级。
 */
import { CHINA_DEM } from "./data/china-dem";
import { REGION_GRID, STEP_LINES } from "./data/regions";
import type { RangeDef } from "./data/regions";
import {
  WORLD_UNIT_KM,
  ALBERS,
  gridToLonLat,
  makeGrid,
  project,
  projectBounds,
  unproject,
  type ProjGrid
} from "./proj";

export { CHINA_DEM, WORLD_UNIT_KM, ALBERS };

export const KM_PER_DEG = 111.32;
/** 垂直夸张：全国高差 7 km 对上 5700 km 跨度，不夸张就完全看不出起伏 */
export const VERTICAL_EXAGGERATION = 26;
/** 米 → 世界单位 */
export const ALT_TO_WORLD = VERTICAL_EXAGGERATION / (WORLD_UNIT_KM * 1000);

/* ------------------------- 两套网格的尺寸 ------------------------- */

/** 原经纬度栅格（判定用） */
export const SRC_W = CHINA_DEM.width;
export const SRC_H = CHINA_DEM.height;

/**
 * 一格的实际边长（km）。
 *
 * 经度方向算出来的 11.82 km 与纬度方向的 11.82 km **相等** ——
 * 这正是原数据乘 `lonScale = cos(36°)` 的目的（见 china-dem.ts 的元数据）。
 * 投影网格必须沿用这个格距：取更细不会更清楚（源数据就这么粗），
 * 取更粗会丢掉现在能看见的窄河谷。
 */
export const CELL_KM = ((CHINA_DEM.lon1 - CHINA_DEM.lon0) * KM_PER_DEG * CHINA_DEM.lonScale) / SRC_W;

/** 取景经纬度矩形**投影之后**的包围盒 */
export const BOUNDS = projectBounds(
  CHINA_DEM.lon0,
  CHINA_DEM.lon1,
  CHINA_DEM.lat0,
  CHINA_DEM.lat1
);

/** 投影网格（渲染用） */
export const PROJ_GRID: ProjGrid = makeGrid(BOUNDS, CELL_KM);

/** 地图在世界坐标里的宽高（世界单位）。含 `makeGrid` 向上取整多出来的那点余量 */
export const SPAN_X = PROJ_GRID.width * PROJ_GRID.d;
export const SPAN_Z = PROJ_GRID.height * PROJ_GRID.d;

export const GRID_W = PROJ_GRID.width;
export const GRID_H = PROJ_GRID.height;

/** 世界坐标原点（0,0）对应的投影平面位置 = 网格中心 */
const CX = PROJ_GRID.x0 + SPAN_X / 2;
const CY = PROJ_GRID.y0 - SPAN_Z / 2;

/* ------------------------------- 投影 ------------------------------- */

/**
 * 经纬度 → 世界坐标。**北在 -z**（相机从南侧上方看过去，屏幕上方就是北）。
 *
 * 原来这里是两个各自独立的线性函数（`lonToX` 只看经度、`latToZ` 只看纬度），
 * 圆锥投影下这条路走不通了：x 同时依赖经度和纬度。所以两个函数合并成一个，
 * 调用方（terrain 的 `pick`/`project`）必须成对地用它和 `worldToLonLat`。
 */
export function lonLatToWorld(lon: number, lat: number): { x: number; z: number } {
  const p = project(lon, lat);
  return { x: p.x - CX, z: -(p.y - CY) };
}

/** 世界坐标 → 经纬度（`pick` 用的反变换，与 `lonLatToWorld` 严格互逆） */
export function worldToLonLat(x: number, z: number): { lon: number; lat: number } {
  return unproject(x + CX, CY - z);
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

/**
 * @param insetLeft 左侧要预留的像素宽（v2.0.0：介绍卡弹出时给它让位）。
 *   预留之后**地图整个往右挪**，而不是把左边裁掉 —— 裁掉会让地图
 *   突然少一块，看起来像坏了。
 *
 *   这里对预留量做**唯一的钳制**（调用方只表达"想留多宽"）：最多让出
 *   舞台宽度的 38%。不钳的话，窗口一窄（比如老师把窗口拖到一半屏），
 *   418px 的预留会把地图压成邮票大小 —— 而"看地图"正是这个游戏的全部。
 */
export function mapLayout(w: number, h: number, insetLeft = 0): MapLayout {
  const inset = Math.max(0, Math.min(insetLeft, w * 0.38));
  const aw = Math.max(1, w - inset);
  const mapScale = Math.min(aw / SPAN_X, h / SPAN_Z) * MAP_FIT;
  return {
    mapScale,
    mapX: inset + (aw - SPAN_X * mapScale) / 2,
    mapY: (h - SPAN_Z * mapScale) / 2
  };
}

/** 经纬度 → 画布内像素坐标（左上为原点） */
export function lonLatToCanvas(
  lon: number,
  lat: number,
  layout: MapLayout
): { x: number; y: number } {
  const p = lonLatToWorld(lon, lat);
  return {
    x: layout.mapX + (p.x + SPAN_X / 2) * layout.mapScale,
    y: layout.mapY + (p.z + SPAN_Z / 2) * layout.mapScale
  };
}

/**
 * 经纬度 → **投影网格**下标（会夹到边界内）。
 *
 * ⚠️ 与下面的 `gridIndex()` 是**两个不同的东西**，名字像、用途完全不同：
 *   · 这个（`projGridIndex`）→ 渲染层、塑形场（lift/add/归属图）用；
 *   · 那个（`gridIndex`）  → 落点判定用，认的是原经纬度栅格。
 * 互相传错的表现是"判定整体偏了十几格"，在界面上只是"有点不准"。
 */
export function projGridIndex(lon: number, lat: number): { i: number; j: number } {
  const p = project(lon, lat);
  const i = Math.round((p.x - PROJ_GRID.x0) / PROJ_GRID.d - 0.5);
  const j = Math.round((PROJ_GRID.y0 - p.y) / PROJ_GRID.d - 0.5);
  return {
    i: Math.min(GRID_W - 1, Math.max(0, i)),
    j: Math.min(GRID_H - 1, Math.max(0, j))
  };
}

/** 经纬度 → 原栅格下标（会夹到边界内）。**判定层专用，不认投影网格** */
export function gridIndex(lon: number, lat: number): { i: number; j: number } {
  const i = Math.round(((lon - CHINA_DEM.lon0) / (CHINA_DEM.lon1 - CHINA_DEM.lon0)) * (SRC_W - 1));
  const j = Math.round(((CHINA_DEM.lat1 - lat) / (CHINA_DEM.lat1 - CHINA_DEM.lat0)) * (SRC_H - 1));
  return {
    i: Math.min(SRC_W - 1, Math.max(0, i)),
    j: Math.min(SRC_H - 1, Math.max(0, j))
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

/** DEM 高程（米），**原经纬度栅格**，行主序：idx = j * SRC_W + i，j=0 最北、i=0 最西 */
export function decodeAltitude(): Float32Array {
  const bytes = b64ToBytes(CHINA_DEM.b64);
  const n = SRC_W * SRC_H;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    out[k] = view.getUint16(k * 2, true);
  }
  return out;
}

/** 陆地遮罩（1 = 中国境内），一位一格。**原经纬度栅格** */
export function decodeLandMask(): Uint8Array {
  const bytes = b64ToBytes(CHINA_DEM.maskB64);
  const n = SRC_W * SRC_H;
  const out = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    out[k] = (bytes[k >> 3] >> (7 - (k & 7))) & 1;
  }
  return out;
}

/** 区域归属图：每格 4 bit，0 = 不属于任何地形区，其余是 AreaDef.gridId。**原经纬度栅格** */
export function decodeRegionGrid(): Uint8Array {
  const bytes = b64ToBytes(REGION_GRID.b64);
  const n = SRC_W * SRC_H;
  const out = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const byte = bytes[k >> 1];
    out[k] = k & 1 ? byte & 0x0f : (byte >> 4) & 0x0f;
  }
  return out;
}

/* -------------------- 地势三级阶梯的判定（v2.0.1） -------------------- */

/**
 * 点落在**开放折线**的哪一侧：+1 / -1。
 *
 * 两步：先找**最近的那一段**定侧，而叉积用的是**未裁剪**的向量。后一步不是
 * 笔误 —— 它天然带"延长线"语义：折线端点之外的点也有确定答案（等价于把两端
 * 沿切线方向延长到无穷）。阶梯分界线正需要这个语义：横断山以南的云南、
 * 雪峰山以南的两广，线本身早就到头了，那两片地还是得判出级别来。
 *
 * 经度方向按 `cos(lat)` 压缩：不压的话纬度 40° 处的"东北方向"会被拉偏，
 * 判定会在北方整体歪掉 —— 而画面上只是"这条线有点斜"，看不出来。
 *
 * ⚠️ 与 `regions_source.py` 的 `side_of` 是**同一套算法**。跨语言的两份实现
 * 靠 `STEP_CITIES`（18 个真实城市）绑在一起：生成数据时 Python 跑一遍
 * （`build_regions.py` 的闸门），`scripts/game.test.cjs` 再跑一遍同一张表，
 * 两边判得不一样就红。改这里务必同步改那边。
 */
export function sideOfPolyline(
  line: readonly (readonly number[])[],
  lon: number,
  lat: number
): number {
  const kx = Math.cos((lat * Math.PI) / 180);
  let bestD = Infinity;
  let bestS = 1;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const px = (lon - ax) * kx;
    const py = lat - ay;
    const dx = (bx - ax) * kx;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const raw = l2 === 0 ? 0 : (px * dx + py * dy) / l2;
    const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    const d = Math.hypot(px - t * dx, py - t * dy);
    if (d < bestD) {
      bestD = d;
      const cross = dx * py - dy * px;
      if (cross !== 0) {
        bestS = cross > 0 ? 1 : -1;
      }
    }
  }
  return bestS;
}

/**
 * 每条线的两个参考点各在哪一侧 —— 启动时**算一次**，运行时只做一次比较。
 *
 * 「哪一侧算高」不写在代码里，就靠 `probeHi` / `probeLo` 这两个点。
 * 硬编码左右的话，哪天把整条线反向重画（数据里点的顺序反过来，几何上完全等价）
 * 就会**两侧对调** —— 而画面上只是"颜色换个位置"，看着还挺正常。
 */
const STEP_ANCHORS = STEP_LINES.map((ln) => ({
  ln,
  hi: sideOfPolyline(ln.line, ln.probeHi[0], ln.probeHi[1]),
  lo: sideOfPolyline(ln.line, ln.probeLo[0], ln.probeLo[1])
}));

/** 第一/二级之间那条线，与第二/三级之间那条 —— 按**语义**找，不认 id 字符串 */
const LINE_12 = STEP_ANCHORS.find((a) => a.ln.hiStep === 1 && a.ln.loStep === 2);
const LINE_23 = STEP_ANCHORS.find((a) => a.ln.hiStep === 2 && a.ln.loStep === 3);

/**
 * 这一步是第几级阶梯：`0` = 第三级（平原丘陵）、`1` = 第二级、`2` = 第一级。
 *
 * 返回**内部索引**而不是教材的 1/2/3，是因为它要直接当数组下标用
 * （`STEP_FILL[level]`）。要给用户看的时候走 `stepNumberOf()`。
 *
 * 两条线**都只用 `hi` 侧**："`probeHi` 在高阶梯那一侧"是数据的契约
 * （见 `regions_source.py` 的 `probe` 那一段）。落在线的高侧 ⇒ 比线那边高一档。
 *
 * ⚠️ 这里曾经写成"step12 用 hi、step23 用 lo"的非对称形式，因为那时 step23 的
 *    `probeHi` / `probeLo` 在数据里填反了。两个错互相抵消 ⇒ 18 个城市全判对、
 *    图上颜色也对，只有"探针自洽"那条断言一测就露馅。别改回非对称。
 */
export function stepIndexAt(lon: number, lat: number): 0 | 1 | 2 {
  if (LINE_12 && sideOfPolyline(LINE_12.ln.line, lon, lat) === LINE_12.hi) {
    return 2;
  }
  if (LINE_23 && sideOfPolyline(LINE_23.ln.line, lon, lat) === LINE_23.hi) {
    return 1;
  }
  return 0;
}

/** 教材口径的阶梯序号 1 / 2 / 3 */
export function stepNumberOf(lon: number, lat: number): 1 | 2 | 3 {
  return (3 - stepIndexAt(lon, lat)) as 1 | 2 | 3;
}

/* ------------------------- 投影网格（渲染用） ------------------------- */

export interface TerrainData {
  /** 投影网格上的高程（米）。范围外为 0 */
  alt: Float32Array;
  /** 投影网格上的陆地遮罩 */
  land: Uint8Array;
  /** 投影网格上的区域归属 */
  region: Uint8Array;
  /**
   * 1 = 这个格点落在 DEM 取景经纬度范围**之外**。
   *
   * 渲染时留透明，于是地图在屏幕上就是**扇形**（圆锥投影的本来形状）
   * 而不是一个矩形 —— 四角那两块本来就不该有东西。
   * 不区分的话会画成"蓝色的大矩形"，投影换了等于白换。
   */
  outside: Uint8Array;
  /**
   * 每格的阶梯级别（v2.0.1）：0 = 第三级、1 = 第二级、2 = 第一级。
   * 陆地以外（海洋 / 图幅之外）一律为 0。
   *
   * ⚠️ 判定查的是**经纬度**（`stepIndexAt(ll.lon, ll.lat)`），不是投影平面坐标。
   * 阶梯分界线是**地理**界线，拿平面坐标去判会在东西两端歪掉 ——
   * 圆锥投影下经线是收敛的，同一个"到线的距离"在黑龙江与新疆对应的经度差
   * 根本不一样。所以这里必须用反投影回来的经纬度。
   */
  step: Uint8Array;
  /** 原经纬度栅格。**判定层要的是这一份**，不是上面那三份 */
  src: { alt: Float32Array; land: Uint8Array; region: Uint8Array };
}

/**
 * 把原经纬度栅格重采样到投影网格上。
 *
 * 用**最近邻**而不是双线性：投影网格的格距与原栅格相等（都是 11.82 km），
 * 插值不会带来新信息，却会把海岸线抹成渐变 —— 而海岸线是我们要描边的。
 *
 * 这一步只在启动时做一次（约 20 万格）。运行时渲染直接查这份表，零成本。
 */
export function buildTerrainData(): TerrainData {
  const src = {
    alt: decodeAltitude(),
    land: decodeLandMask(),
    region: decodeRegionGrid()
  };
  const n = GRID_W * GRID_H;
  const alt = new Float32Array(n);
  const land = new Uint8Array(n);
  const region = new Uint8Array(n);
  const outside = new Uint8Array(n);
  const step = new Uint8Array(n);

  const { lon0, lon1, lat0, lat1 } = CHINA_DEM;
  const dLon = (lon1 - lon0) / SRC_W;
  const dLat = (lat1 - lat0) / SRC_H;

  for (let gj = 0; gj < GRID_H; gj++) {
    const row = gj * GRID_W;
    for (let gi = 0; gi < GRID_W; gi++) {
      const ll = gridToLonLat(PROJ_GRID, gi, gj);
      const k = row + gi;
      if (ll.lon < lon0 || ll.lon > lon1 || ll.lat < lat0 || ll.lat > lat1) {
        outside[k] = 1;
        continue;
      }
      const si = Math.min(SRC_W - 1, Math.max(0, Math.floor((ll.lon - lon0) / dLon)));
      const sj = Math.min(SRC_H - 1, Math.max(0, Math.floor((lat1 - ll.lat) / dLat)));
      const s = sj * SRC_W + si;
      alt[k] = src.alt[s];
      land[k] = src.land[s];
      region[k] = src.land[s] ? src.region[s] : 0;
      // 阶梯级别就地算：这一步反正要把每格反投影成经纬度，顺带判掉不要钱。
      // 单独再开一趟循环去算，等于把 20 万次反投影做两遍。
      step[k] = src.land[s] ? stepIndexAt(ll.lon, ll.lat) : 0;
    }
  }
  return { alt, land, region, outside, step, src };
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

/**
 * 一条山脉离某点多远 —— 支持**一列平行山岭**（v1.4.0，目前只有横断山脉）。
 *
 * 横断山脉在数据里是 5 条平行的南北向山岭（高黎贡山 / 怒山 / 云岭 /
 * 沙鲁里山 / 大雪山），`range.line` 只代表其中一条（主脊）。凡是"这条山脉在哪儿"
 * 的判断都必须按**到最近那一条**的距离算：
 *
 *   · 按主脊算 ⇒ 另外 4 条岭形同虚设，学生把卡片拖到最东边的大雪山上
 *     会被判成"离这条山脉的走向还差得远"；
 *   · 塑形场同理 ⇒ 只有主脊那一溜会隆起，另外 4 条岭在地图上根本不出现。
 *
 * 两条都会让"一列平行山岭"这件事在游戏里彻底消失，且**完全静默** ——
 * 画面上只是"看着比课本上稀疏一点"，看不出是程序把 5 条当成 1 条了。
 */
export function distToRange(
  lon: number,
  lat: number,
  range: RangeDef,
  lonScale = CHINA_DEM.lonScale
): number {
  const lines = range.lines && range.lines.length > 0 ? range.lines : [range.line];
  let best = Infinity;
  for (const l of lines) {
    const d = distToPolyline(lon, lat, l, lonScale);
    if (d < best) {
      best = d;
    }
  }
  return best;
}

/**
 * 两点之间的距离（度）。经度同样按 cos(36°) 折算 —— 与 `distToPolyline` 一个口径，
 * 免得"锚点带"在东西方向被拉长成一个椭圆。
 */
export function distToPoint(
  lon: number,
  lat: number,
  point: [number, number],
  lonScale = CHINA_DEM.lonScale
): number {
  const dx = (lon - point[0]) * lonScale;
  const dy = lat - point[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 一个区域环的"等效半径"（度）：外接矩形对角线的一半，经度按 cos 折算。
 *
 * 用途只有一个 —— 决定落点容差（见 `areaDropTol`）。所以口径不必很准，
 * 但**必须只用几何量**（不能掺"这个区重要不重要"之类的语义）。
 */
export function ringRadiusDeg(ring: [number, number][]): number {
  let lon0 = Infinity;
  let lon1 = -Infinity;
  let lat0 = Infinity;
  let lat1 = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < lon0) lon0 = lon;
    if (lon > lon1) lon1 = lon;
    if (lat < lat0) lat0 = lat;
    if (lat > lat1) lat1 = lat;
  }
  const w = (lon1 - lon0) * CHINA_DEM.lonScale;
  const h = lat1 - lat0;
  return Math.sqrt(w * w + h * h) / 2;
}

/* --------------------------- 走带走廊的宽度 --------------------------- */

/**
 * 走带走廊的默认半宽（度）：这个半宽以内塑形按 1 算，往外 FADE 度渐隐到 0。
 *
 * 这两个数**同时**决定两件事，所以定义在这里、只有这一份：
 *   · `App.tsx` 的 `buildRidge` 按它把山脉塑到地图上（画出来的那条带子多宽）；
 *   · `pick.ts` 的点击命中按它判"点在没点在这条山脉上"。
 * 各写一份的话，两个数迟早会走偏 —— 而走偏的样子是**静默**的：
 * 图上看着是条 0.5° 宽的带子，点它却命不中（或者反过来，点在带子外面也命中）。
 */
export const RIDGE_LIFT_HALF_DEG = 0.42;
export const RIDGE_LIFT_FADE_DEG = 0.08;

/**
 * 一条山脉在地图上**铺开的半径**（度，含外侧渐隐）。
 *
 * 这就是"命中判定必须与视觉同源"的落点：能点中的范围 = 画出来的范围。
 * 横断山脉那种一列平行山岭在数据里带了更窄的 `lift_half_deg`（0.20），
 * 于是它的可点范围自动收窄，不需要命中这一侧再写一条特例。
 */
export function corridorHalfDeg(range: { lift_half_deg?: number }): number {
  return (range.lift_half_deg ?? RIDGE_LIFT_HALF_DEG) + RIDGE_LIFT_FADE_DEG;
}

/* ----------------------------- 落点判定 ----------------------------- */

export interface DropVerdict {
  ok: boolean;
  /** 给学生的提示：放对了也提示一句，放错了说清"偏到哪儿去了" */
  message: string;
  /**
   * 宽容命中（v2.0.0）：放是放对了，但落点并不在本区的栅格上，
   * 而是落在**外扩容差**以内。分数照给，提示换一句 ——
   * 学生该知道自己是"指得不太准"，不是"本就该在那儿"。
   */
  loose?: boolean;
}

/**
 * 基础落点容差（度）。0.85° ≈ 95 km ≈ 屏幕上 **15 px**（地图横铺 1100 px 时）。
 *
 * ## 为什么要有容差（v2.0.0 用户反馈）
 *
 * 之前是**严格位图判定**：落点必须落在本区的栅格里，差一格就是错。
 * 11.82 km 一格的粒度下，柴达木盆地这种小块在屏幕上只有几十像素宽，
 * 学生瞄准的是"那块地的样子"，指针偏出边界一点点就被判错 ——
 * 而这在课堂上是纯粹的挫败，学不到任何东西（他不是不知道在哪儿，
 * 只是没对准）。
 *
 * ## 为什么 v2.1.0 要从 0.42 抬到 0.85（用户原话：「还是必须要拖动到完全对应的
 *    位置才能够加载，希望相当于有一个透明缓冲区，在周围一些的位置也可以视作正确」）
 *
 * 因为 v2.0.0 那个 0.42° 只折合 **7.3 px 半径** —— 指针抖一下就不止这个数，
 * 学生根本感觉不到"有容差"。量出来的两层原因（见 `judgeAreaDrop` 的注释）：
 * 容差太小，而且**落点在别人家的格上时旧判据会让容差完全不生效**。
 *
 * 0.85° 这个数不是拍的，卡在三条约束中间：
 *   · **够大**：15 px 半径 ≈ 一次指针抖动，学生能感觉到"没对准也算对"；
 *   · **不够大**：最小的区（四川盆地，等效半径 2.62°）的容差被放大到 1.38°，
 *     仍然小于它到"隔着另一个区的那些地方"的距离 —— 缓冲区不会穿透一个区域
 *     （回归里 `bufferProbe` 的"不许穿透"那条就是这个的上界守卫）；
 *   · **与山脉同档**：山脉落点容差 0.85°（`App.tsx` 的 `RANGE_TOL_DEG`），
 *     两种题型的宽容度一致，学生不用去猜"这次是哪种松紧"。
 */
export const AREA_DROP_TOL_DEG = 0.85;

/**
 * 某个目标的落点容差：**目标越小，容差越大**。
 *
 * 统一的绝对容差对大区域是"几乎没影响"，对小区域是"雪中送炭"，
 * 但**小块仍然最难对准** —— 一个半径 1° 的盆地配 0.85° 的容差，
 * 有效判定范围只扩大 85%；而半径 8° 的高原配同样的 0.85°，
 * 学生根本感觉不到有容差。所以再按等效半径放大一档：
 * 等效半径 4° 以上按基础容差（大区域本来就好对准，放宽反而会让
 * 相邻两块互相吃掉）；1° 以下放大到 2 倍（小块地，宽容是唯一让它
 * 可玩的办法）。中间线性过渡。
 */
export function areaDropTol(radiusDeg: number): number {
  const k = 4 / Math.max(0.8, radiusDeg);
  return AREA_DROP_TOL_DEG * Math.max(1, Math.min(2, k));
}

/**
 * 落点到**指定**那个地形区的最近距离（度）；容差窗口里一格都没有时返回 null。
 *
 * 口径与 `nearestOwnedRegion` 完全一致（同样的窗口半径取整、同样量到格中心、
 * 经度乘 cos36°）—— 两个口径不一致的判据会给出假红假绿，这个坑踩过。
 *
 * 窗口按 `ceil(tol / 格距)` 开，所以返回的 `d` 可能 **> tol**（窗口四角更远），
 * 也可能因为目标真的不在 tol 内而是 null。调用方必须自己比一次 `d <= tol`：
 * **窗口负责不漏，距离这一判负责不宽。**
 */
function distToRegion(
  lon: number,
  lat: number,
  regionGrid: Uint8Array,
  gridId: number,
  tolDeg: number
): number | null {
  const ls = CHINA_DEM.lonScale;
  const dLon = (CHINA_DEM.lon1 - CHINA_DEM.lon0) / SRC_W;
  const dLat = (CHINA_DEM.lat1 - CHINA_DEM.lat0) / SRC_H;
  const r = Math.ceil(tolDeg / Math.min(dLon * ls, dLat));
  const { i, j } = gridIndex(lon, lat);
  let best = Infinity;
  for (let dj = -r; dj <= r; dj++) {
    const jj = j + dj;
    if (jj < 0 || jj >= SRC_H) {
      continue;
    }
    for (let di = -r; di <= r; di++) {
      const ii = i + di;
      if (ii < 0 || ii >= SRC_W) {
        continue;
      }
      if (regionGrid[jj * SRC_W + ii] !== gridId) {
        continue;
      }
      const glon = CHINA_DEM.lon0 + (ii + 0.5) * dLon;
      const glat = CHINA_DEM.lat1 - (jj + 0.5) * dLat;
      const deg = Math.sqrt(((glon - lon) * ls) ** 2 + (glat - lat) ** 2);
      if (deg < best) {
        best = deg;
      }
    }
  }
  return best === Infinity ? null : best;
}

/**
 * 以落点为心、按 `tolDeg` 开一个方形窗口，返回窗口内**最近的一个有归属的格**。
 *
 * 窗口半径按格距取整而不是按度数 —— 判定是在栅格上做的，
 * 直接扫 `ceil(tol / 格距)` 圈就够（11.82 km 一格时约 4 圈，81 格）。
 *
 * ⚠️ 取整的代价：**窗口四角会伸到 tol 之外**（最远 tol·√2 ≈ 1.41 倍）。
 * 所以这里的返回值的 `deg` 可能大于调用方给的 `tolDeg` —— 需要"落在容差之内"
 * 这个严格语义的调用方必须自己比一次 `deg`（见 `judgeAreaDrop` 的宽松分支）。
 * 反过来这个窗口是**完备**的：任何"真实距离 ≤ tol"的格，其每轴偏移都不超过
 * `tol / 格距`，一定落在窗口里，不会被漏掉。**窗口负责不漏，距离那一判负责不宽。**
 */
function nearestOwnedRegion(
  lon: number,
  lat: number,
  regionGrid: Uint8Array,
  tolDeg: number
): { id: number; deg: number } | null {
  const ls = CHINA_DEM.lonScale;
  const dLon = (CHINA_DEM.lon1 - CHINA_DEM.lon0) / SRC_W;
  const dLat = (CHINA_DEM.lat1 - CHINA_DEM.lat0) / SRC_H;
  // 窗口按**两个方向里更紧的那个**算：经度一格折算后只有 9.6 km 等效，
  // 按它取整才不会在东西方向漏掉本该扫到的格
  const r = Math.ceil(tolDeg / Math.min(dLon * ls, dLat));
  const { i, j } = gridIndex(lon, lat);
  let bestId = 0;
  let bestDeg = Infinity;
  for (let dj = -r; dj <= r; dj++) {
    const jj = j + dj;
    if (jj < 0 || jj >= SRC_H) {
      continue;
    }
    for (let di = -r; di <= r; di++) {
      const ii = i + di;
      if (ii < 0 || ii >= SRC_W) {
        continue;
      }
      const id = regionGrid[jj * SRC_W + ii];
      if (id === 0) {
        continue;
      }
      const glon = CHINA_DEM.lon0 + (ii + 0.5) * dLon;
      const glat = CHINA_DEM.lat1 - (jj + 0.5) * dLat;
      const deg = Math.sqrt(((glon - lon) * ls) ** 2 + (glat - lat) ** 2);
      if (deg < bestDeg) {
        bestDeg = deg;
        bestId = id;
      }
    }
  }
  return bestId ? { id: bestId, deg: bestDeg } : null;
}

/**
 * 地形区判定：**落点到本区的距离 ≤ 容差**就算对；落在本区栅格里是"严格归位"。
 *
 * 为什么查位图而不是"离中心点多近"：
 * 地形区是有面积的，学生把"塔里木盆地"丢到天山北边的准噶尔去，
 * 按中心距离可能也算"近"；查位图则直接问"这一格到底属于谁"，
 * 判定口径和地图本身完全一致。位图是按"小面积优先"生成的，
 * 所以柴达木那种嵌在青藏高原内部的盆地也能各归各位。
 *
 * ## v2.1.0：宽容判据从「最近的那格必须是目标」改成「到目标的距离 ≤ 容差」
 *
 * 旧写法是 `nearestOwnedRegion() → 最近格必须属于目标`，读起来等价，
 * 实际上**把缓冲区切碎了**：落点一旦掉在别人家的格上，最近的格就是脚下这一格
 * （中心距 ≤ 0.71 格，比任何邻居都近），`bestId` 必然 ≠ 目标 ⇒ 判错。
 * 实测全图 46 996 个"容差内落点"里 **8 568 个（18.2%）**因此被判错；
 * 柴达木盆地最惨，**57.6%** 的容差点被包着它的青藏高原吃掉。
 * 而"空地"（gid=0）只占陆地的 41.1% ⇒ 宽容命中实际是碎在边界上的几条缝，
 * 学生当然感觉不到有容差（用户原话：「还是必须要拖动到完全对应的位置」）。
 *
 * 新写法直接量"到目标区域的距离"，这才是"围着目标外扩一圈"的本义，
 * 也与山脉判定（`judgeRangeDrop`：离本山脉走带最近且 ≤ tol）同构。
 *
 * ⚠️ 代价是**贴着别人家边界的那一圈也会判对**，提示里会写明落在谁的边上
 *   （"大致归位（落在「青藏高原」的边上）"）—— 学生知道自己压线了。
 *   教学上这是想要的（地图边界本来就是概化的过渡带），但**绝不许穿透一整个区域**：
 *   离目标超过容差的一律判错，`scripts/game.test.cjs` 的 `bufferProbe` 逐区采样守着。
 *
 * @param radiusDeg 目标区的等效半径（见 `ringRadiusDeg`），决定容差大小。
 *                  省略时用基础容差。
 */
export function judgeAreaDrop(
  lon: number,
  lat: number,
  targetGridId: number,
  regionGrid: Uint8Array,
  names: Map<number, string>,
  radiusDeg = 4
): DropVerdict {
  const { i, j } = gridIndex(lon, lat);
  const id = regionGrid[j * SRC_W + i];
  if (id === targetGridId) {
    return { ok: true, message: "归位！" };
  }
  const tol = areaDropTol(radiusDeg);
  /*
   * 宽容命中：到目标的距离在容差之内。**不管落点那一格属于谁** ——
   * 这正是 v2.1.0 要的"透明缓冲区"（见文件头那段）。
   *
   * 仍旧比一次 `<= tol`：`distToRegion` 的窗口按格取整，四角最远伸到 tol·√2。
   * 只看"窗口里找到了目标的格"的话容差就虚胖了 41%（0.85° 会变成 1.2°）。
   * 窗口负责不漏，这一判负责不宽。
   */
  const dTarget = distToRegion(lon, lat, regionGrid, targetGridId, tol);
  if (dTarget !== null && dTarget <= tol) {
    /*
     * 宽容命中的文案**必须与严格归位不同**（"归位！" + loose 标志是不够的）——
     * 学生该知道自己是指得不太准，而不是"本就该在那儿"；不区分的话，
     * 他把柴达木丢到青藏高原边上也会看到一句干脆的"归位！"，
     * 于是学到一个错的认识：那块地长这样。
     *
     * 压在别人家格上时再点明"落在谁边上"：他既知道对了，也知道自己压线。
     * 这句话只有这一份：`App.tsx` 直接用 `v.message` 拼名字，不在界面层再写一遍
     * （两处各写一份，改文案时必然走偏，而走偏的样子是静默的）。
     */
    const on = id === 0 ? "" : `（落在「${names.get(id) ?? "别的地形区"}」的边上）`;
    return { ok: true, message: `大致归位${on}，再准一点就更好`, loose: true };
  }
  // ---- 以下是判错：给出"这一格（或最近的那一格）是谁的"，让学生知道往哪边挪
  const near = nearestOwnedRegion(lon, lat, regionGrid, tol);
  if (id === 0 && !near) {
    return { ok: false, message: "这里离任何地形区都还远，再找找" };
  }
  if (id === 0) {
    const other = names.get(near!.id) ?? "别的地形区";
    return { ok: false, message: `落点本身是空地，最近的是「${other}」` };
  }
  const other = names.get(id) ?? "别的地形区";
  return { ok: false, message: `这里是「${other}」，不是你要放的那块` };
}

/**
 * 山脉判定：落点要离**本山脉**的走带最近。
 *
 * 光看"离目标折线 < 阈值"不够 —— 太行山和燕山、太行山和秦岭都会互相蹭到，
 * 于是再加一条"最近的那条必须是它"，学生就不可能在燕山上交太行山的卷。
 *
 * 两个距离都走 `distToRange`（v1.4.0）：横断山脉是一列平行山岭，
 * 要是按主脊那一条算，学生拖到最东边的大雪山上会被判成"不是它"。
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
  const dTarget = distToRange(lon, lat, target);
  if (dTarget > tolDeg) {
    return { ok: false, message: "离这条山脉的走向还差得远，再找找" };
  }
  let nearest = target;
  let dNearest = dTarget;
  for (const r of ranges) {
    if (r.id === targetId) {
      continue;
    }
    const d = distToRange(lon, lat, r);
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
  return mask[j * SRC_W + i] === 1;
}
