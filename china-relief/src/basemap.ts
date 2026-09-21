/**
 * 底图：四种可选，其中「遥感影像」走天地图。
 *
 * 前三张（分层设色 / 原色地形 / 地势晕渲）全部由本地 DEM 算出来，断网照常可用。
 * 它们的差别只有一处 —— 逐像素上色时那个分支（见 terrain.ts 的 `render`）：
 *
 *   · `relief`    未塑形区米灰斜纹 + 已塑形区卡通色档，色档对比最强；
 *   · `soft`      **未塑形区也按真实高程画七档原色**（只是不给档界描边与明暗），
 *                 已塑形区加上那两样。于是"塑形"＝**地块的边界与起伏浮出来**，
 *                 整幅看起来就是一张配好色的中国地形图；
 *   · `hillshade` 已塑形区改用四邻梯度算的连续晕渲（西北 45° 光源）。
 *
 * `soft` 的来龙去脉：v1.4.0 用户提出「底图可以就是颜色比较浅的中国地形图」，
 * 当时的实现是把陆海**一起向白插值**成淡彩。v1.5.0 用户否掉了那层白：
 * 「不用浅色，现在外面加了一层白色的掩膜反而不是特别的好看」——
 * 那一层把七档色的色差等比例压到 38%，分层设色事实上失效了（实测数字见
 * terrain.ts「原色地形底图」那一段）。所以现在改用**原色**，底图随之改名
 * `浅色地形` → `原色地形`，标签里的"浅"字不再成立。
 *
 * 它的取舍仍然是**地形起伏提前露出来了**（一开局就能看到全貌），
 * 换取一张接近课本观感的底图，以及给地名标注留出干净的衬底。
 * 想要"没放之前什么也看不到"的挑战感，用 `relief`。
 *
 * ## 为什么影像底图必须用天地图
 *
 * 这是一份**要发给学校、随包离线运行**的中国地图产品。卫星影像底图的取用
 * 不是"哪家图好看"的问题：境内地图产品的影像底图有明确的合规要求，
 * 境外图源（Google / Bing 海外版 / OSM / Mapbox 之类）一律不能用。
 * 「国家地理信息公共服务平台（天地图）」是自然资源部主管的官方平台，
 * 属于可以用的那一小撮。
 *
 * 但天地图要密钥（tk），而**密钥不能写死在随包发布的代码里**
 * —— 明文密钥会被抓包、会被盗用、也没法给不同学校分别配。
 * 所以这里的设计是：**代码里只有占位符，密钥由老师在界面上填一次**，
 * 存在浏览器本地；填不填、什么时候填，由老师决定。
 *
 * 顺带一个必须说清楚的取舍：天地图是**在线服务**，校机室没网就取不到。
 * 所以另外两种底图（分层设色 / 地势晕渲）完全由本地 DEM 算出来，
 * 断网时照常可用；影像底图取不到时也会明确说一句并切回去，
 * 而不是留一张空白沙盘让人猜。
 *
 * ## 瓦片怎么落到我们的画布上
 *
 * 天地图的 `img_w` 是标准 Web Mercator 瓦片（256 px、行列号与 OSM 一致），
 * 而我们的地图 v2.0.0 起是 **Albers 等积圆锥**（见 `proj.ts`）。两者不是一回事，
 * 而"把 Mercator 瓦片贴到 Albers 上"这件事没有初等解：
 *
 *   · 经线在 Albers 下是**直线** ⇒ 瓦片左右两条边仍然直；
 *   · 纬线是**圆弧** ⇒ 上下两条边是弯的。
 *
 * 于是经纬度上的一个矩形，在画布上是一条弧边的**扇形块** —— 只能拿一个
 * 轴对齐矩形去逼近它。逼近方式是**把每块瓦片在经、纬方向各切成
 * `TILE_SUBDIV` 份**，每个子块取自己的真实包围盒 ⇒ 弧的矢高按份数平方
 * 下降，误差落到一个像素以下。为什么是 3、为什么纬度按 Mercator y 等分、
 * 子块之间为什么必须相接，都在 `TILE_SUBDIV` 与 `tileRects` 的注释里。
 *
 * 另一处不能忽略的畸变是 **Mercator 在纬度方向不等比**：瓦片内部的行距
 * 是按 `latToMercY` 等分的，而画布是按真实纬度画的。这个误差随瓦片纬度
 * 跨度平方增长 —— z=5 时约 2~3 km，还不到一个网格（11.82 km）的五分之一；
 * z=4 就涨到 15 km 左右，会看得出影像和等高线对不上。
 * **所以缩放级别不能随便降**，`pickZoom` 的下限是算出来的，不是拍的。
 */
import {
  CHINA_DEM,
  WORLD_UNIT_KM,
  lonLatToCanvas,
  type MapLayout
} from "./geo";
import { project } from "./proj";

export type BasemapKind = "relief" | "soft" | "hillshade" | "satellite";

export interface BasemapDef {
  kind: BasemapKind;
  label: string;
  /** 按钮下面那行小字 */
  note: string;
  /** 是否需要联网 */
  online: boolean;
}

export const BASEMAPS: BasemapDef[] = [
  {
    kind: "relief",
    label: "分层设色",
    note: "卡通色档 + 等高线，读数最清楚",
    online: false
  },
  {
    kind: "soft",
    label: "原色地形",
    note: "整幅原色地形，塑好的地方浮出边界与起伏",
    online: false
  },
  {
    kind: "hillshade",
    label: "地势晕渲",
    note: "按坡向打光，山脊山谷更立体",
    online: false
  },
  {
    kind: "satellite",
    label: "遥感影像",
    note: "天地图真实卫星影像，需联网 + 密钥",
    online: true
  }
];

export function basemapLabel(kind: BasemapKind): string {
  return BASEMAPS.find((b) => b.kind === kind)?.label ?? kind;
}

/* --------------------------- 天地图接入 --------------------------- */

/** 天地图影像底图（Web Mercator 矩阵集 `w`）。`{s}` 是子域、`{tk}` 是密钥占位 */
export const TIANDITU_TILE =
  "https://t{s}.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile" +
  "&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles" +
  "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={tk}";

/** 申请密钥的入口（界面上要原样给老师） */
export const TIANDITU_KEY_PAGE = "https://console.tianditu.gov.cn/api/key";

/** 影像底图必须标注来源 —— 这既是合规要求，也免得有人以为是我们自己拍的 */
export const TIANDITU_ATTRIBUTION = "影像底图：天地图（国家地理信息公共服务平台）";

const SUBDOMAINS = [0, 1, 2, 3, 4, 5, 6, 7];

/** 拼一个瓦片 URL。子域按行列号轮转，避免全站都压到 t0 */
export function tiandituTileUrl(z: number, x: number, y: number, tk: string): string {
  const sub = SUBDOMAINS[(x + y) % SUBDOMAINS.length];
  return TIANDITU_TILE.replace("{s}", String(sub))
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y))
    .replace("{tk}", tk);
}

/* ---------------------------- 瓦片布局 ---------------------------- */

/** 归一化 Mercator y（0 = 北极、1 = 南极）→ 纬度 */
export function mercYToLat(ty: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * ty))) * 180) / Math.PI;
}

/** 纬度 → 归一化 Mercator y */
export function latToMercY(lat: number): number {
  const rad = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

export interface TileRect {
  z: number;
  x: number;
  y: number;
  /** 子块在瓦片内的编号（v2.0.0，见 `TILE_SUBDIV`）。范围 0 ~ TILE_SUBDIV-1 */
  sx: number;
  sy: number;
  /**
   * 子块在画布上的四个角，顺序 **TL / TR / BR / BL**（西南→…）。
   *
   * 这是"子块该落在哪儿"的**唯一真值**：由 `lonLatToCanvas` 直接投出来，
   * 不经过任何近似。`matrix` 就是由它解出来的。
   */
  quad: { x: number; y: number }[];
  /**
   * 交给 CSS `matrix3d(...)` 的 16 个数（列主序，与 CSS 一致）。
   *
   * 作用是把子块的**本地矩形** `[0, SUB_SIZE] × [0, SUB_SIZE]` 精确映到
   * `quad` 那个四边形上 —— 这就是 v2.0.0 卫星影像配准的全部机制。
   * 为什么不能用"轴对齐矩形 + 线性拉伸"替代，见 `solveQuadMatrix`。
   */
  matrix: number[];
}

/**
 * 每个瓦片在经度与纬度方向各切成几块（v2.0.0）。
 *
 * ## 为什么必须切
 *
 * 天地图是 Web Mercator 瓦片，我们的地图是 Albers 圆锥投影。一个经纬度上的
 * 矩形（瓦片），投到 Albers 平面上**不再是矩形**：
 *   · 经线在 Albers 下是**直线** ⇒ 左右两条边仍然直；
 *   · 纬线是**圆弧** ⇒ 上下两条边是弯的。
 *
 * ## 切开到底解决了什么、没解决什么（这里踩过一次）
 *
 * 一开始的说法是"按四角取包围盒贴上去，误差就是这条弧的矢高"。**这个说法
 * 不完整**，实测才发现真正的大头不是矢高，而是**弧在画布上的斜率**：
 * 纬线圆弧在画布上是一条斜线，离中央经线越远越斜。θ≈23° 处，一段
 * 3.75° 的子块，弧在画布上要落下 **22 px**，而轴对齐矩形的上边是**平的**。
 * 于是不管切多细，都还剩"半条弧的落差 / 2"这个量级的错位 ——
 * 细分只能让它**线性**变小：S=3 时 ~9 px，S=6 才 4.5 px，要压到 1 px
 * 得切十几份。实测（1200×760 舞台，315 个子块）：
 *
 *   轴对齐矩形 + 线性拉伸：四角偏差 **最大 26.8 px / 平均 10.3 px**
 *                          （一格 DEM 只有 1.885 px，也就是错开 14 格）
 *
 * 所以 v2.0.0 的最终解法不是"切得更细"，而是**每个子块做一次四点单应
 * 变换**（`solveQuadMatrix` → CSS `matrix3d`），把本地矩形精确映到投影后的
 * 四边形上：四角偏差归零，只剩内部弧-弦矢高 **0.32 px**（不到 0.2 格）。
 * 切开这件事仍然要做 —— 单应只能把"矩形→四边形"映射做对，**四边形内部**
 * 那条弧还是用弦代替的，弧越短这个误差越小（按 Δθ² 下降）。
 *
 * ## 为什么是 3
 *
 * 矢高按 Δθ² 下降。切 3 份后经度跨 3.75°、Δθ = 0.0377 弧度，矢高
 * ≈ 1.72 × (0.0377/2)² / 2 = 2.0 km —— 0.32 px，像素级看不见。
 * 元素数按"每块覆盖多少度"算（与瓦片层级无关）：(63/3.75) × (38/3.75)
 * ≈ 17 × 11 ≈ 190 个子块；实测 z=5 时 315 个，完全扛得住。
 *
 * ⚠️ 子块按 **Mercator y** 等分，不按纬度等分 —— Mercator 在纬度方向不是
 * 等比的，按纬度等分会让上下子块的实际跨度差出一大截（60°N 附近尤其明显）。
 */
export const TILE_SUBDIV = 3;

/**
 * 子块本地矩形的边长（px）。**乘上 `TILE_SUBDIV` 正好是瓦片的原生 256 px** ——
 * 于是内层 `<img>` 按"原生分辨率、不放大不缩小"铺开，交给单应变换去缩放，
 * 画质不额外损失。
 */
export const SUB_SIZE = 256 / TILE_SUBDIV;

/**
 * 解一个四点单应变换：把本地矩形 `[0,s] × [0,s]` 的四个角
 * `(0,0) (s,0) (s,s) (0,s)` 映到 `q` 给的那四个点。
 *
 * 返回**列主序**的 16 个数，可以直接写成 CSS `matrix3d(...)`。
 *
 * ## 为什么要动矩阵
 *
 * Albers 下纬线是圆弧、经线是收敛的直线，所以一个经纬度矩形投出来是一条
 * 弧边的**斜梯形**。我们手里能用的位图是一个**矩形**（那张 Mercator 瓦片），
 * 只能靠"把矩形变形到四边形"来对齐它。可选的手段有三档：
 *
 *   · 平移 + 缩放（`left/top/width/height`）：只能映成和它自己同向的矩形，
 *     斜梯形的四个角最多只能对上两个。实测偏差 10~27 px，见 `TILE_SUBDIV`；
 *   · 仿射（`matrix2d`）：能映成任意**平行四边形**。斜梯形的两腰不平行
 *     （经线向极点收敛），所以还是对不上，只是好一点；
 *   · 单应（`matrix3d` 带透视项）：**矩形 ↔ 四边形**是双射，四个角精确对上。
 *
 * 选单应的代价只是每块多解一个 8×8 线性方程组 —— 315 块、只在地图尺寸
 * 变化时算一次，可以忽略。收益是卫星影像和地形晕渲**严丝合缝**。
 *
 * ## 解方程
 *
 * 未知量 8 个（`h33` 固定为 1）。每个点贡献两行：
 *
 *   h11·x + h12·y + h13 − X·(h31·x + h32·y) = X
 *   h21·x + h22·y + h23 − Y·(h31·x + h32·y) = Y
 *
 * 四个点 → 8×8，高斯消元带部分主元。源点固定是单位正方形、目标点是画布
 * 像素量级，条件数很好，不需要额外做归一化。
 */
export function solveQuadMatrix(q: { x: number; y: number }[], s: number): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  const src = [
    [0, 0],
    [s, 0],
    [s, s],
    [0, s]
  ];
  for (let k = 0; k < 4; k++) {
    const [x, y] = src[k];
    const { x: X, y: Y } = q[k];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }
  // 高斯消元 + 部分主元
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) {
      if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) {
        piv = r;
      }
    }
    if (piv !== c) {
      const t = A[piv];
      A[piv] = A[c];
      A[c] = t;
      const tb = b[piv];
      b[piv] = b[c];
      b[c] = tb;
    }
    const d = A[c][c];
    for (let r = c + 1; r < 8; r++) {
      const f = A[r][c] / d;
      if (f === 0) {
        continue;
      }
      for (let k = c; k < 8; k++) {
        A[r][k] -= f * A[c][k];
      }
      b[r] -= f * b[c];
    }
  }
  const h = new Array(8).fill(0);
  for (let r = 7; r >= 0; r--) {
    let s2 = b[r];
    for (let k = r + 1; k < 8; k++) {
      s2 -= A[r][k] * h[k];
    }
    h[r] = s2 / A[r][r];
  }
  const [h11, h12, h13, h21, h22, h23, h31, h32] = h;
  // 列主序，与 CSS matrix3d 一致（m11,m12,…,m44）
  return [
    h11, h21, 0, h31,
    h12, h22, 0, h32,
    0, 0, 1, 0,
    h13, h23, 0, 1
  ];
}

/** 按列主序的 16 个数作用到本地点（只测两个用得到的输出轴，测试要） */
export function applyMatrix3d(m: number[], x: number, y: number): { x: number; y: number } {
  const w = m[3] * x + m[7] * y + m[15];
  return {
    x: (m[0] * x + m[4] * y + m[12]) / w,
    y: (m[1] * x + m[5] * y + m[13]) / w
  };
}

/**
 * 一个子块的四个角在画布上的位置（TL / TR / BR / BL）。
 *
 * 单独抽出来是因为它有两个用处：给 `tileRects` 解矩阵，以及给测试当
 * "真值" —— 测试直接比"矩阵作用到本地四角"和这份四角，配准误差一目了然。
 */
export function subQuad(
  layout: MapLayout,
  z: number,
  x: number,
  y: number,
  sx: number,
  sy: number
): { x: number; y: number }[] {
  const n = 1 << z;
  const S = TILE_SUBDIV;
  const wLon = ((x + sx / S) / n) * 360 - 180;
  const eLon = ((x + (sx + 1) / S) / n) * 360 - 180;
  const nLat = mercYToLat((y + sy / S) / n);
  const sLat = mercYToLat((y + (sy + 1) / S) / n);
  return [
    lonLatToCanvas(wLon, nLat, layout),
    lonLatToCanvas(eLon, nLat, layout),
    lonLatToCanvas(eLon, sLat, layout),
    lonLatToCanvas(wLon, sLat, layout)
  ];
}

/**
 * 选缩放级别：让瓦片的经度分辨率**刚好够**画布用。
 *
 * `mapScale` 是画布上 1 世界单位（100 km）占的像素；乘上"1 经度有多少 km"
 * 就得到画布自己的像素/经度。瓦片是 `256 × 2^z / 360` 像素/经度。
 * 取第一个不小于它的 z，即 1:1 略过采样。上限 6 是因为再往上瓦片数量
 * 会翻四倍（z=6 已经要上百张），而多出来的清晰度肉眼分不出来。
 *
 * ⚠️ "1 经度有多少 km"要取**南边界**那个值：Albers 下经度方向的拉伸
 * 随纬度增大而减小（南边界最宽，17°N 处 109.6 km/度；北边界 55°N 处只有
 * 67 km/度）。取平均值会让南边的影像欠采样 —— 而欠采样的表现是"影像糊"，
 * 最容易被误判成"天地图就这画质"。
 */
export function pickZoom(layout: MapLayout, maxZ = 6): number {
  const p1 = project(CHINA_DEM.lon0, CHINA_DEM.lat0);
  const p2 = project(CHINA_DEM.lon0 + 1, CHINA_DEM.lat0);
  const kmPerLonSouth = Math.hypot(p2.x - p1.x, p2.y - p1.y) * WORLD_UNIT_KM;
  const pxPerDeg = (layout.mapScale * kmPerLonSouth) / WORLD_UNIT_KM;
  for (let z = 0; z <= maxZ; z++) {
    if ((256 * (1 << z)) / 360 >= pxPerDeg) {
      return z;
    }
  }
  return maxZ;
}

/**
 * 覆盖整个取景框所需的瓦片子块，连同它们在画布上的四边形与单应矩阵。
 *
 * `x0..x1` / `y0..y1` 是**按 11.25° 的瓦片格**向外取整出来的，所以最外侧那
 * 一圈瓦片会伸出取景框（`lon1 = 136°E` 会取到 135~146.25°E 那一列）。
 * 这是必需的 —— 伸出去了才保证投影之后仍然盖满地图。伸出部分由舞台的
 * `overflow: hidden` 裁掉，代价只是多下几张瓦片（z=5 时 35 张）。
 */
export function tileRects(layout: MapLayout, z: number): TileRect[] {
  const n = 1 << z;
  const { lon0, lon1, lat0, lat1 } = CHINA_DEM;
  const x0 = Math.floor(((lon0 + 180) / 360) * n);
  const x1 = Math.ceil(((lon1 + 180) / 360) * n) - 1;
  const y0 = Math.floor(latToMercY(lat1) * n);
  const y1 = Math.ceil(latToMercY(lat0) * n) - 1;

  const out: TileRect[] = [];
  const S = TILE_SUBDIV;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const quad = subQuad(layout, z, x, y, sx, sy);
          out.push({
            z,
            x,
            y,
            sx,
            sy,
            quad,
            matrix: solveQuadMatrix(quad, SUB_SIZE)
          });
        }
      }
    }
  }
  return out;
}

/** 一次把布局算齐：选级别 + 出矩形。App 只需要这一个入口 */
export function layoutTiles(layout: MapLayout): TileRect[] {
  return tileRects(layout, pickZoom(layout));
}
