/**
 * Albers 等积圆锥投影（中国全图的标准投影）+ 投影网格的定义。
 *
 * ## 为什么换掉原来的「按 cos(36°) 修正的等距圆柱」
 *
 * 等距圆柱把中国画成一个**规规矩矩的矩形**：南北向的经线不收敛，
 * 新疆与黑龙江被横向拉平，南北方向还比东西方向"长"。
 * 课本上那张中国地图是**扇形**（上窄下宽、左右两条边向内收），
 * 因为用的是圆锥投影 —— 这个形状差异是学生一眼就能看出来的，
 * 也是使用者会说"这个投影有点奇怪"的直接原因。
 *
 * ## 换投影的代价，以及它落在哪一层
 *
 * DEM 是**经纬度栅格**。等距圆柱下"栅格 (i,j) ⇒ 画布像素"是纯查表，
 * 换圆锥就得给每个点做反投影 —— 这正是 v1.0.0 当初选等距圆柱的理由
 * （见 geo.ts 的历史注释）。但那个代价其实**只落在渲染层**，而且有个
 * 干净的解法：
 *
 *   **不去逐像素反投影（那是 100 万次三角函数、每帧几十毫秒），
 *   而是在投影平面上重新开一张规则网格**，逐格反投影回经纬度、
 *   从原 DEM 采样一次。于是：
 *
 *   · 渲染层几乎不用改 —— 它拿到的仍是一张**规则矩形网格**，
 *     四邻运算（海岸线描边、档界、晕渲梯度、归属边界）全都继续成立；
 *   · 重采样只在**建表时做一次**（约 20 万格），运行时零成本；
 *   · 而且投影网格是**等积**的 —— "上下左右四个邻居"的实际距离相等。
 *     晕渲的梯度在等距圆柱下其实是错的：那边东西向一格只有 90 km、
 *     南北 111 km，同一个坡度在东西与南北方向算出来差 1.24 倍。
 *
 * 代价是运行时要按投影另算一份 alt/land/region（geo.ts 的 `buildProjected`），
 * 但它是从原数据现算的，不进包、不增体积。
 *
 * ## 为什么落点判定一行都不用改
 *
 * 判定查的是**经纬度**栅格（`REGION_GRID`）—— 投影只影响"画在哪儿"，
 * 不影响"这一格属于谁"。所以 `gridIndex` / `judgeAreaDrop` / `judgeRangeDrop`
 * 原样不动，判定口径与地图数据仍然完全一致。这条很关键：投影一换，
 * 屏幕上每一块地的形状都变了，判定要是也跟着变，就再没有"同源"可言了。
 *
 * ## 参数
 *
 * 中央经线 105°E、双标准纬线 25°N 与 47°N —— 中国全图出版物的标准配置，
 * 全国范围内的形变最小（标准纬线之间面积比 1.000，最远处也在 1% 量级）。
 *
 * 球面公式而不是椭球：本游戏最细的一格是 11.9 km，球体近似的误差在
 * 几十米量级 —— 差三个数量级，没必要上椭球级数。
 */

/** 地球平均半径（km）。投影只用来摆位置，这个精度足够 */
const R_KM = 6371;
const RAD = Math.PI / 180;

/** 世界单位：1 unit = 100 km。与 geo.ts 同源，定义在这里以免循环依赖 */
export const WORLD_UNIT_KM = 100;

/* ---------------------------- 投影参数 ---------------------------- */

export const ALBERS = {
  /** 中央经线（东经） */
  lon0: 105,
  /** 双标准纬线 */
  phi1: 25,
  phi2: 47,
  /**
   * 原点纬度。取赤道（0）而不是某个标准纬线，是为了让公式里
   * `rho0` 有一个固定的物理含义（赤道处的锥面半径），
   * 而不是"随便选一个纬度、只影响 y 的零点"。
   */
  phi0: 0
} as const;

const n = (Math.sin(ALBERS.phi1 * RAD) + Math.sin(ALBERS.phi2 * RAD)) / 2;
const C = Math.cos(ALBERS.phi1 * RAD) ** 2 + 2 * n * Math.sin(ALBERS.phi1 * RAD);
/** 锥面在原点纬度处的半径 */
const RHO0 = Math.sqrt(C - 2 * n * Math.sin(ALBERS.phi0 * RAD)) / n;

/** 某个纬度对应的锥面半径（球面 Albers） */
function rhoOf(latDeg: number): number {
  return Math.sqrt(C - 2 * n * Math.sin(latDeg * RAD)) / n;
}

export interface XY {
  /** 世界单位，向东为正 */
  x: number;
  /** 世界单位，向北为正 */
  y: number;
}

/**
 * 经纬度 → 投影平面（世界单位）。
 *
 * 注意与屏幕坐标的**y 方向相反**：这里 y 向北为正（数学惯例），
 * 屏幕上是"北在上"，所以渲染层会取负（见 geo.ts 的 `latToZ`）。
 * 混着用的话地图会上下颠倒 —— 而且看起来只是"这地图怪怪的"。
 */
export function project(lon: number, lat: number): XY {
  const rho = rhoOf(lat);
  const th = n * (lon - ALBERS.lon0) * RAD;
  return {
    x: (rho * Math.sin(th) * R_KM) / WORLD_UNIT_KM,
    y: (-(rho * Math.cos(th) - RHO0) * R_KM) / WORLD_UNIT_KM
  };
}

/**
 * 投影平面（世界单位）→ 经纬度。解析解，没有迭代。
 *
 * ## ⚠️ 这里的符号必须与 `project` 的 y 口径严格一致
 *
 * `project` 给出的 y 是**向北为正**（`y = (RHO0 − ρ·cosθ)·R/WU`），
 * 所以反解时要的量是 `ρ·cosθ = RHO0 − y·WU/R` —— 也就是下面
 * `Y = +y·WU/R`、`dy = RHO0 − Y`。
 *
 * 曾经写成 `Y = −y·WU/R`（把它当成"向南为正"了），结果 `dy` 变成
 * `RHO0 + y·WU/R`：反解出的纬度**整个翻到南半球**。
 * 复算实测：北京 (105°E, 36°N) 反解成 36°S，全国扫样的最大往返误差
 * 有 247° —— 而画面上并不会报错，只是"地图糊成一团、判定到处都不对"。
 * 所以 `scripts/game.test.cjs` 里有一条全球扫样的往返自检盯着它。
 */
export function unproject(x: number, y: number): { lon: number; lat: number } {
  const X = (x * WORLD_UNIT_KM) / R_KM;
  const Y = (y * WORLD_UNIT_KM) / R_KM;
  const dy = RHO0 - Y;
  const rho = Math.sign(n) * Math.hypot(X, dy);
  const th = Math.atan2(X, dy);
  const sinPhi = rho === 0 ? 0 : (C - (rho * n) ** 2) / (2 * n);
  return {
    lat: (Math.asin(Math.max(-1, Math.min(1, sinPhi))) / RAD) as number,
    lon: ALBERS.lon0 + th / n / RAD
  };
}

/* ---------------------------- 包围盒 ---------------------------- */

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  h: number;
}

/**
 * 经纬度矩形**投影之后**的包围盒。
 *
 * 不能只投四个角：圆锥投影下经纬度矩形的边界是**曲线**
 * （纬线是圆弧，经线是直线），四角算出来的盒子会把上下两条弧切掉一块，
 * 于是地图的南北两端被裁掉、而**看起来只是"取景范围选得紧"**。
 *
 * 所以沿四条边采样。240 段对 480 格的栅格来说已经远超需要
 * （相邻采样点间隔 0.26°，弧的矢高不到 0.001 世界单位 ≈ 100 m）。
 */
export function projectBounds(
  lon0: number,
  lon1: number,
  lat0: number,
  lat1: number,
  samples = 240
): Bounds {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const put = (lon: number, lat: number) => {
    const p = project(lon, lat);
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  };
  for (let k = 0; k <= samples; k++) {
    const t = k / samples;
    const lon = lon0 + (lon1 - lon0) * t;
    const lat = lat0 + (lat1 - lat0) * t;
    // 南北两条边（纬线，是弧）+ 东西两条边（经线，是直线，但采样无害）
    put(lon, lat0);
    put(lon, lat1);
    put(lon0, lat);
    put(lon1, lat);
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/* --------------------------- 投影网格 --------------------------- */

export interface ProjGrid {
  /** 网格列数（东西向） */
  width: number;
  /** 网格行数（南北向） */
  height: number;
  /** 第 0 列左边缘的 x（世界单位） */
  x0: number;
  /** 第 0 行上边缘的 y（世界单位，向北为正） */
  y0: number;
  /** 格距（世界单位）。等积网格两个方向**必须相同**，否则"等积"就没了 */
  d: number;
  bounds: Bounds;
}

/**
 * 按原 DEM 的格距（km）造一张覆盖 `bounds` 的等积网格。
 *
 * 格距取"原 DEM 在赤道上的格距"（`111.32 km/度 × 0.1116 度`）——
 * 也就是 **11.9 km**（见 geo.ts 的 `CELL_M`）。取更细不会更清楚
 * （源数据就这么粗），只会让建表变慢；取更粗则会丢掉现在能看见的窄河谷。
 *
 * 宽高各**向上取整**，宁可多出一两格把 bounds 包住，也不要裁掉边缘。
 */
export function makeGrid(bounds: Bounds, cellKm: number): ProjGrid {
  const d = cellKm / WORLD_UNIT_KM;
  const width = Math.max(1, Math.ceil(bounds.w / d));
  const height = Math.max(1, Math.ceil(bounds.h / d));
  // 让网格**居中**在 bounds 上：多出来的那点余量两边平分，
  // 免得地图整体往左上偏半格（半格 = 6 km，在图上就是 1 px，量得出来）
  const padX = (width * d - bounds.w) / 2;
  const padY = (height * d - bounds.h) / 2;
  return {
    width,
    height,
    x0: bounds.x0 - padX,
    y0: bounds.y1 + padY,
    d,
    bounds
  };
}

/** 网格格点（中心）的投影坐标 */
export function gridToXY(g: ProjGrid, gi: number, gj: number): XY {
  return { x: g.x0 + (gi + 0.5) * g.d, y: g.y0 - (gj + 0.5) * g.d };
}

/** 网格格点（中心）的经纬度 */
export function gridToLonLat(g: ProjGrid, gi: number, gj: number) {
  const p = gridToXY(g, gi, gj);
  return unproject(p.x, p.y);
}
