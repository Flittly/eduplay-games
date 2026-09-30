/**
 * 经纬度 ⇄ 画布 投影层
 * =====================
 *
 * ## 为什么要有这一层（这是本项目最重要的一次修正）
 *
 * 上一版的洋流坐标是**手工摆在手绘底图上的**（`anchor: {x, y}` 直接写 0~1 归一化值）。
 * 当时底图是 7 个"画得像地球"的多边形，没有真正的经纬网，于是那一版坐标
 * 和真实地理位置**没有任何对应关系**——实测偏差：
 *
 *   · 加利福尼亚寒流  → 画到了大西洋东岸（偏差 169°）
 *   · 阿拉斯加暖流    → 画到了欧洲北部  （偏差 181°）
 *   · 南赤道暖流      → 画到了印度洋    （偏差 215°）
 *   · 北赤道暖流      → 画到了印度洋    （偏差  70°）
 *   · 整个太平洋的洋流全部横向错位
 *
 * 学生看图时要建立的是"**这条洋流在真实地球上位于哪里**"的空间认知。
 * 坐标只要不是从真实经纬度来的，这个认知就是错的——而且错得毫无规律，
 * 不是"整体偏一点"，是"这条在大西洋、那条跑到印度洋"。
 *
 * 所以现在改口径：**经纬度是唯一真相源（single source of truth）**。
 * `data.ts` 里每条洋流存的是真实经纬度，画布像素由本文件算出来。
 * 这样：
 *   ① 位置永远可复核（拿一个真实经纬度就能验，不用"看图感觉对不对"）；
 *   ② 加新洋流只需查经纬度，不用手工试坐标；
 *   ③ 底图换成真实影像后，洋流能**真正对齐**在影像的海域上。
 *
 * ## 为什么选等距圆柱（equirectangular）而不是 Mercator
 *
 * 两个候选：
 *   · **Mercator**   海图常用，但高纬面积急剧放大（格陵兰比非洲还大），
 *                    不适合"给学生看全球"；而且它不是等距的，
 *                    洋流长度会被纬度严重拉伸。
 *   · **等距圆柱**   lon/lat 线性映射到 x/y，**公式只有一条乘法**，
 *                    且绝大多数卫星影像图（含 NASA Blue Marble）的原生格式
 *                    就是等距圆柱 ⇒ **贴图零重采样**。
 *
 * 教学底图要的是"无变形地看清楚每条洋流在哪"，等距圆柱的纬度方向
 * 线性拉伸反而**更好**（不像 Mercator 把高纬挤成一团）。
 *
 * ## ⚠️ 一个必守的细节：横向要乘 cos(中纬) 吗？——不要
 *
 * 等距圆柱的固有变形是"高纬东西向被拉长"，修正办法是横向乘 cos(φ)。
 * 但**这里不能乘**，原因有两个：
 *   ① 一旦乘了，投影就不是"lon/lat 线性映射"了 ⇒ **影像贴图无法零重采样**，
 *      得逐像素重投影（就是 china-relief 那一整套 matrix3d 的复杂度）；
 *   ② 底图是真实影像图，**影像本身已经是等距圆柱格式**。
 *      如果洋流单独乘 cos、影像不乘，两者就**对不上**——洋流会偏离海岸线。
 *
 * 所以口径统一为："画布 = 等距圆柱"，影像和洋流**都用同一套**，
 * 谁都不额外修正，于是它们天然对齐。代价是高纬东西向拉长（格陵兰变宽），
 * 这在教学上可以接受——**"洋流对得上大陆"比"格陵兰比例正确"重要得多**。
 */

/** 画布尺寸（viewBox）。全项目共用这一份，别在别处再写死。 */
export const MAP_W = 1000;
export const MAP_H = 560;

/**
 * 画布覆盖的经纬范围。
 *
 * 经度取满全球 −180~180：洋流里有西风漂流（绕南极一圈）、
 * 北赤道暖流（跨 160°E~130°W）这类横跨半个地球的流，
 * 裁掉任何一段都会把它们切断。
 *
 * 纬度取 −90~90 也是满范围，但**实际观感上两极附近是空的**
 * （北冰洋有冰盖、南极是大陆），所以下方视觉重心在中低纬。
 * 之所以不裁：底图是影像图，裁掉会在图边出现"影像断口"。
 */
export const LON_MIN = -180;
export const LON_MAX = 180;
export const LAT_MIN = -90;
export const LAT_MAX = 90;

const LON_SPAN = LON_MAX - LON_MIN;
const LAT_SPAN = LAT_MAX - LAT_MIN;

/** 经度 → 画布 x。 */
export function lonToX(lon: number): number {
  return ((lon - LON_MIN) / LON_SPAN) * MAP_W;
}

/** 纬度 → 画布 y。⚠️ 北在上 ⇒ 纬度越大 y 越小（这个负号是唯一容易写反的地方）。 */
export function latToY(lat: number): number {
  return ((LAT_MAX - lat) / LAT_SPAN) * MAP_H;
}

/** 画布 x → 经度。 */
export function xToLon(x: number): number {
  return LON_MIN + (x / MAP_W) * LON_SPAN;
}

/** 画布 y → 纬度。 */
export function yToLat(y: number): number {
  return LAT_MAX - (y / MAP_H) * LAT_SPAN;
}

/** 经纬度 → 画布点。 */
export function llToXY(lon: number, lat: number): { x: number; y: number } {
  return { x: lonToX(lon), y: latToY(lat) };
}

/**
 * 画布点 → 归一化坐标（0~1）。
 *
 * 只有"画箭头"那条交互路径还需要归一化值：玩家在屏幕上拖出的是像素，
 * 归一化后存起来，渲染时再乘回画布尺寸。**洋流数据本身不再用归一化坐标。**
 */
export function xyToNorm(x: number, y: number): { x: number; y: number } {
  return { x: x / MAP_W, y: y / MAP_H };
}

/** 归一化坐标 → 画布点（画箭头渲染用）。 */
export function normToXY(n: { x: number; y: number }): { x: number; y: number } {
  return { x: n.x * MAP_W, y: n.y * MAP_H };
}

/**
 * 两条经纬度箭头的方位角（度，正东为 0，逆时针为正）。
 *
 * 用**经纬度**算而不是用画布像素算：等距圆柱下高纬的东西向被拉长，
 * 拿像素算会把"沿 60°N 向东流"算成比实际更偏东的角度。
 * 经纬度口径下 `atan2(Δlat, Δlon · cos(中纬))` 才是地球上的真实方位。
 *
 * 判定第二问（画箭头）时用的是"±45° 内算对"（见 game.ts 的 `judgeArrow`），
 * 容差够宽，所以这个修正不修正都不会改变判定结果——但**换算口径要统一**，
 * 否则以后收紧容差就会出错。
 */
export function bearing(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number
): number {
  const midLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const dx = (lon2 - lon1) * Math.cos(midLat);
  const dy = lat2 - lat1;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/**
 * 经度差，按**最短路径**归一到 −180~180。
 *
 * 为什么必须有这个函数：洋流里有一批是**跨 ±180° 日界线**的
 * （北太平洋暖流、南北赤道暖流、赤道逆流）。如果直接 `lon2 - lon1`：
 *   · 判定层：150°E → 130°W 会算成 Δ = −280°，看着像"方向反了"，
 *     于是"向西流"被判成"向东流"——**结论直接错**；
 *   · 渲染层：画布上 x 从 916 拉到 138，"向东流 80°" 会被画成
 *     **横穿整张图往回拉 280°**，一条箭头盖死半张地图。
 * 这两处都是**看着不报错、但结论全错**的类型，所以归一放在公共层做一次。
 */
export function dLonShort(lon1: number, lon2: number): number {
  let d = lon2 - lon1;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/**
 * 把一个可能跨日界线的经纬度线段，拆成若干**不跨日界线**的子段。
 *
 * 等距圆柱投影把 −180° 映射到 x=0、180° 映射到 x=W，于是"跨日界线"
 * 在画布上表现为"顶点跑到图外"或"横穿全图"。拆段的规则是：
 *   从起点出发，按最短路径逐步走，每走到 ±180 就断开，剩余部分
 *   从另一端（∓180）继续。
 *
 * 返回的每一段都是 `[{lon, lat}, {lon, lat}]`，渲染层逐段画即可。
 * 跨界的洋流会有 2 段（起段 + 续段），不跨界的**原样返回 1 段**。
 *
 * 之所以做成通用函数而不是手工把 4 条洋流写成两段：
 * 以后加洋流时，只要它跨日界线就自动正确，**不需要有人记得去手工拆**。
 * （这正是上一版"手工摆坐标"踩过的坑——靠人记得，就一定会漏。）
 */
export function splitAtAntimeridian(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number
): { lon: number; lat: number }[][] {
  // 判据用**最短路径**（dLonShort 恒在 ±180 内），
  // 但"是否跨日界线"要看**直接连线**会不会跑出 ±180 —— 若两者同号或跨度小，
  // 就是普通段。
  const d = dLonShort(lon1, lon2);
  // 不跨：最短路径与直接连线一致（同侧），且长度不足以越过日界线
  const naiveDiff = Math.abs(lon2 - lon1);
  const short = naiveDiff <= 180 + 1e-9;
  if (short) {
    return [
      [
        { lon: lon1, lat: lat1 },
        { lon: lon2, lat: lat2 }
      ]
    ];
  }

  // 需要拆：沿最短方向（d 的符号）走到 ±180，纬度按比例插值
  const dir = d > 0 ? 1 : -1;
  const endLon = dir > 0 ? 180 : -180;
  const startLon = dir > 0 ? -180 : 180;
  const span = Math.abs(d);
  const toEdge = Math.abs(endLon - lon1);
  const t = toEdge / span;

  const latMid = lat1 + (lat2 - lat1) * t;

  return [
    [
      { lon: lon1, lat: lat1 },
      { lon: endLon, lat: latMid }
    ],
    [
      { lon: startLon, lat: latMid },
      { lon: lon2, lat: lat2 }
    ]
  ];
}
