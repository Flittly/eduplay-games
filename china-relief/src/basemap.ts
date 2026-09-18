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
 * 而我们的地图是**按 cos(36°) 修正的等距圆柱**。两者不是一回事，但
 * 都是"经纬度 → 平面"的映射，所以每个瓦片（它是经纬度上的一个矩形）
 * 在我们的画布里仍然是一个**轴对齐的矩形**，直接按四个角算位置即可。
 *
 * 瓦片内部的畸变是唯一要留意的地方：Mercator 在纬度方向不是等比的，
 * 把它整块拉成"纬度均匀"会在瓦片内部产生误差。这个误差随瓦片纬度跨度
 * 平方增长 —— z=5 时约 2~3 km，还不到一个网格（11.9 km）的五分之一，
 * 肉眼不可见；z=4 就涨到 15 km 左右，会看得出影像和等高线对不上。
 * **所以缩放级别不能随便降**，`pickZoom` 的下限是算出来的，不是拍的。
 */
import {
  CHINA_DEM,
  KM_PER_DEG,
  WORLD_UNIT_KM,
  lonLatToCanvas,
  type MapLayout
} from "./geo";

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
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 选缩放级别：让瓦片的经度分辨率**刚好够**画布用。
 *
 * `mapScale` 是画布上 1 世界单位（100 km）占的像素；乘上"1 经度有多少
 * 世界单位"就得到画布自己的像素/经度。瓦片是 `256 × 2^z / 360` 像素/经度。
 * 取第一个不小于它的 z，即 1:1 略过采样。上限 6 是因为再往上瓦片数量
 * 会翻四倍（z=6 已经要上百张），而多出来的清晰度肉眼分不出来。
 */
export function pickZoom(layout: MapLayout, maxZ = 6): number {
  const pxPerDeg = (layout.mapScale * KM_PER_DEG * CHINA_DEM.lonScale) / WORLD_UNIT_KM;
  for (let z = 0; z <= maxZ; z++) {
    if ((256 * (1 << z)) / 360 >= pxPerDeg) {
      return z;
    }
  }
  return maxZ;
}

/**
 * 覆盖整个取景框所需的瓦片，连同它们在画布上的矩形。
 *
 * 矩形按**瓦片四角**算而不是按"第几行第几列 × 瓦片边长"算 ——
 * 后者只在等比投影下成立，我们的地图横向压了 cos(36°)。
 */
export function tileRects(layout: MapLayout, z: number): TileRect[] {
  const n = 1 << z;
  const { lon0, lon1, lat0, lat1 } = CHINA_DEM;
  const x0 = Math.floor(((lon0 + 180) / 360) * n);
  const x1 = Math.ceil(((lon1 + 180) / 360) * n) - 1;
  const y0 = Math.floor(latToMercY(lat1) * n);
  const y1 = Math.ceil(latToMercY(lat0) * n) - 1;

  const out: TileRect[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const wLon = (x / n) * 360 - 180;
      const eLon = ((x + 1) / n) * 360 - 180;
      const nLat = mercYToLat(y / n);
      const sLat = mercYToLat((y + 1) / n);
      const a = lonLatToCanvas(wLon, nLat, layout);
      const b = lonLatToCanvas(eLon, sLat, layout);
      out.push({
        z,
        x,
        y,
        // 多铺 1 px：瓦片是位图、相邻块之间留缝，缩放取整后会露出白发丝线
        left: a.x - 1,
        top: a.y - 1,
        width: b.x - a.x + 2,
        height: b.y - a.y + 2
      });
    }
  }
  return out;
}

/** 一次把布局算齐：选级别 + 出矩形。App 只需要这一个入口 */
export function layoutTiles(layout: MapLayout): TileRect[] {
  return tileRects(layout, pickZoom(layout));
}
