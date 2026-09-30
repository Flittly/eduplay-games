/**
 * 地球真实影像底图（合规图源：天地图）
 * =====================================
 *
 * ## 为什么底图必须用「天地图」而不是随便找个卫星图
 *
 * 这是一份**要发给学校、随包跑的全球地图产品**。卫星影像底图的取用不是
 * "哪家图好看"的问题：地图产品的影像底图有明确的合规要求，境外图源
 * （Google / Bing 海外版 / OSM / Mapbox 之类）一律不能用。
 * 「国家地理信息公共服务平台（天地图）」由自然资源部主管，属于可用的官方图源。
 *
 * ⚠️ 而且全球图比中国图**多一个合规点**：图上必须正确处理国界线与
 * 中国领土（台湾、南海诸岛）的表示，不能出现与国家标准不符的画法。
 * 天地图底图的国界与中国领土表示已符合国家标准，所以直接用它最稳。
 *
 * ## 密钥为什么不能写死在代码里
 *
 * 天地图要 tk 密钥。而**密钥不能进随包发布的代码**——明文密钥会被抓包、
 * 会被盗用、也没法给不同学校分别配。所以：
 *   代码里只有占位符 `{tk}`，密钥由老师在界面上填一次，存在浏览器本地。
 * 没密钥 / 没网时自动回退到内置的矢量海岸线底图，游戏照常能玩。
 *
 * ## 瓦片怎么落到等距圆柱画布上（比 china-relief 简单得多，但也有坑）
 *
 * 天地图 `img_w` 是标准 **Web Mercator** 瓦片（256px，行列号与 OSM 一致）；
 * 我们的画布是**等距圆柱**。两者的纬度映射不同：
 *   · 等距圆柱： y ∝ (90 − lat)，纬度线性；
 *   · Mercator：  y ∝ ln(tan(π/4 + lat/2))，高纬被拉伸。
 *
 * 解法：**一次映射，逐瓦片算它的纬度范围，再把整块瓦片沿纬度切成
 * `ROWS_PER_TILE` 条**，每条子块在画布上就是一个轴对齐矩形——
 * 因为等距圆柱的经线和纬线**都是直线**，所以每个子块的四边形
 * 退化成矩形（这是相比 Albers 的巨大简化：那边纬线是圆弧，
 * 必须上 matrix3d 做单应变换，这里完全不用）。
 *
 * ⚠️ 两个曾经的坑（china-relief 的注释里也有，这里同样适用）：
 *   ① **不能把整块 Mercator 瓦片按均匀高度贴上去**。同一块 z=3 瓦片，
 *      上边在 66°N、下边在 40°N，Mercator 下高度均匀 ⇒ 越往上误差越大，
 *      画面上海岸线与洋流箭头会错开十几公里。所以必须按纬度切条。
 *   ② **纬度方向不是均匀的，切条要按 Mercator y 等分**（不是按纬度等分），
 *      否则切出来的每个子块内部仍有非均匀拉伸。
 *      按 Mercator y 等分后，每条内部的最大误差 = 该条纬度跨度下的
 *      Mercator 曲率 —— ROWS_PER_TILE=8 时已远小于 1px。
 *
 * ## 子块之间的接缝
 *
 * 切条时相邻两条必须"上一条的下边 = 下一条的上边"，用 `floor`/`ceil` 会留缝
 * 或重叠。这里统一由"同一条纬度边界"算出来，所以天然相接。
 * 另外给每条子块在画布上多加 0.5px 高度，吃掉浏览器亚像素渲染时
 * 偶发的一像素白线（`BLEED_PX`）。
 */

import { MAP_H, MAP_W, latToY, lonToX } from "./proj";

/* --------------------------- 天地图接入 --------------------------- */

/** 天地图影像底图（Web Mercator 矩阵集 `w`）。`{s}` 子域、`{tk}` 密钥占位 */
export const TIANDITU_TILE =
  "https://t{s}.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile" +
  "&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles" +
  "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={tk}";

/** 申请密钥的入口（界面上要原样给老师） */
export const TIANDITU_KEY_PAGE = "https://console.tianditu.gov.cn/api/key";

/** 影像底图必须标注来源 —— 合规要求，也免得有人以为是我们自己拍的 */
export const TIANDITU_ATTRIBUTION = "影像底图：天地图（国家地理信息公共服务平台）";

const SUBDOMAINS = [0, 1, 2, 3, 4, 5, 6, 7];

/** 拼一个瓦片 URL。子域按行列号轮转，避免全站压到 t0。 */
export function tiandituTileUrl(z: number, x: number, y: number, tk: string): string {
  const sub = SUBDOMAINS[(x + y) % SUBDOMAINS.length];
  return TIANDITU_TILE.replace("{s}", String(sub))
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y))
    .replace("{tk}", tk);
}

/* ---------------------------- Mercator 工具 ---------------------------- */

/** 归一化 Mercator y（0 = 北极、1 = 南极）→ 纬度 */
export function mercYToLat(ty: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * ty))) * 180) / Math.PI;
}

/** 纬度 → 归一化 Mercator y */
export function latToMercY(lat: number): number {
  const rad = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

export interface TileBox {
  z: number;
  x: number;
  y: number;
  /** 子块在瓦片内第几行（纬度方向）。行内是整条，所以只需一个索引 */
  row: number;
  /** 子块在画布上的位置与尺寸（px） */
  left: number;
  top: number;
  width: number;
  /**
   * 子块高度（px）。已含 `BLEED_PX` 溢出一像素，避免接缝白线。
   * 展示尺寸与真实纬度跨度只差这一两个像素，肉眼不可见。
   */
  height: number;
  /** 这张瓦片的**整图**应该在画面上占多高（含 overflow 修正用） */
  fullHeight: number;
  /** 子块在图上的纵向偏移（相对整张瓦片顶边，px） */
  offsetY: number;
}

/** 接缝补偿：每条子块上下各多铺 0.5px，吃掉亚像素渲染产生的白线 */
const BLEED_PX = 0.5;

/** 每块瓦片沿纬度切成几条。8 条时单条内部误差远小于 1px（见文件头）。 */
export const ROWS_PER_TILE = 8;

/** 画布纬度范围（与 proj.ts 的 LAT_MIN / LAT_MAX 一致，但这里只看画布） */
export interface ViewWindow {
  z: number;
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}

/**
 * 挑一个合适的缩放级别。
 *
 * 判据：**源瓦片的分辨率刚好不比画布粗**。画布宽 `MAP_W` 像素覆盖 360°
 * ⇒ 画布每像素 `360/1000 = 0.36°`。z 级时全世界 `256·2^z` 像素宽
 * ⇒ 源每像素 `360/(256·2^z)` 度。
 *
 * 实测各级别（画布 1000px）：
 *
 *   z  瓦片数  子块数  源每像素  相对画布
 *   1     4      32    0.7031°   粗 1.95 倍  ← 会糊
 *   2    16     128    0.3516°   细 1.02 倍  ← 刚好（选它）
 *   3    64     512    0.1758°   细 2.05 倍  ← 带宽翻 4 倍，肉眼无差
 *   4   256    2048    0.0879°   细 4.10 倍  ← 明显浪费
 *
 * **z=2 是拐点**：源比画布细 1.02 倍，即"几乎一个源像素对应一个画布像素"，
 * 再加细只会下载 4 倍的字节、缩回来丢掉。所以判据写成
 * "源的度数 ≤ 画布需求的一半就再上一级"是**错的**（那会选到 z=3）；
 * 正解是"**源的度数刚好处在接近 1 倍的位置**"，即下面的循环。
 *
 * ⚠️ 别为了"更清楚"盲目调高：等距圆柱下整幅世界图的横向分辨率是固定的
 * （360° / MAP_W），源再细也只被缩回来，徒增请求数。
 */
export function pickZoom(): number {
  const degPerPxNeed = 360 / MAP_W; // 0.36
  let best = 1;
  let bestErr = Infinity;
  for (let z = 1; z <= 6; z++) {
    const degPerPxSrc = 360 / (256 * 2 ** z);
    // 只要"源不比画布粗"（≤ 需求度数），就计算它离 1 倍有多远，取最近的
    if (degPerPxSrc > degPerPxNeed * 1.2) continue; // 明显会更糊，排除
    const err = Math.abs(Math.log2(degPerPxNeed / degPerPxSrc));
    if (err < bestErr) {
      bestErr = err;
      best = z;
    }
  }
  return best;
}

/** 默认缩放级别（构建期算一次，见 `pickZoom`）。 */
export const DEFAULT_ZOOM = pickZoom();

/**
 * 算出铺满画布所需的全部瓦片子块。
 *
 * 等距圆柱下横向是均匀的：一块瓦片在画布上的宽度恒为 `MAP_W / n`。
 * 纵向不均匀（Mercator → 等距圆柱），所以逐瓦片算上下边界、再切成
 * `ROWS_PER_TILE` 条。
 *
 * ## 极地补边（必修，否则上下各留一条 ~15px 的空白带）
 *
 * Mercator 矩阵集只覆盖到 **±85.0511°**（再往上 y 趋于无穷）。
 * 而画布是满 −90~90，于是：
 *   · 顶部 90°~85.05° 共 14.9px；
 *   · 底部 −85.05°~−90° 共 14.9px
 * 没有任何瓦片，**画面上就是两条横贯全图的空白带**。
 *
 * 处理办法：把最靠边的两条子块的边界**外扩到画布边缘**。
 * 这么做的依据是"那里本来就是均匀的"——北端是北冰洋海冰、南端是南极冰盖，
 * 影像本身就接近纯白，外扩几个像素与真实影像几乎无法分辨；
 * 反过来若不补，两条突兀的空白带是**一眼可见的缺陷**。
 */
export function buildTiles(z: number): TileBox[] {
  const out: TileBox[] = [];
  const n = 2 ** z; // 该级别下横向/纵向的瓦片数
  const tileCanvasW = MAP_W / n; // 一块瓦片在画布上的宽度

  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      // 这块瓦片覆盖的纬度范围（Mercator 行列 → 经纬）
      const latTop = mercYToLat(y / n);
      const latBottom = mercYToLat((y + 1) / n);
      // 完全在画布纬度范围之外 ⇒ 跳过
      if (latBottom > 90 || latTop < -90) continue;

      const tileTopY = latToY(Math.min(latTop, 90));
      const tileBottomY = latToY(Math.max(latBottom, -90));
      const fullHeight = tileBottomY - tileTopY;
      if (fullHeight <= 0) continue;

      for (let row = 0; row < ROWS_PER_TILE; row++) {
        // ⚠️ 按 Mercator y 等分（不是按纬度等分），见文件头坑②
        const tyA = (y + row / ROWS_PER_TILE) / n;
        const tyB = (y + (row + 1) / ROWS_PER_TILE) / n;
        const latA = mercYToLat(tyA);
        const latB = mercYToLat(tyB);

        let segTopY = latToY(Math.min(latA, 90));
        let segBottomY = latToY(Math.max(latB, -90));

        // 最北一条：上边拉到画布顶（补 90°~85.05° 的空白带）
        if (y === 0 && row === 0) segTopY = 0;
        // 最南一条：下边拉到画布底（补 −85.05°~−90°）
        if (y === n - 1 && row === ROWS_PER_TILE - 1) segBottomY = MAP_H;

        const rawH = segBottomY - segTopY;
        if (rawH <= 0) continue;

        out.push({
          z,
          x,
          y,
          row,
          left: lonToX(-180) + x * tileCanvasW,
          // 上边往上溢半个像素、高度加整整一个像素 ⇒ 与邻条必然重叠、不留缝
          top: segTopY - BLEED_PX,
          width: tileCanvasW + 0.5,
          height: rawH + BLEED_PX * 2,
          fullHeight,
          offsetY: segTopY - tileTopY
        });
      }
    }
  }

  return out;
}

/** 画布可视窗口（全球）。 */
export const VIEW: ViewWindow = {
  z: 3,
  lonMin: -180,
  lonMax: 180,
  latMin: -90,
  latMax: 90
};
