/**
 * DEM 数据源的类型定义。
 *
 * 一个 `DemSource` 就是「一座真实山体」的完整描述：取景参数（中心经纬度、跨度）、
 * 数据规格（网格边长、高程范围）以及高程数据本身（base64 后的 Uint16 小端数组）。
 *
 * 生成方式见 `.workbuddy/tmp/dem-probe/build_dem.py`，数据源是 AWS Terrain Tiles
 * （Terrarium 编码，公有领域），不依赖任何需要申请 key 的服务。
 */
export interface DemSource {
  /** 稳定标识（也是文件名后缀） */
  tag: string;
  /** 山体名，例如 "贡嘎山" */
  name: string;
  /** 主峰名，例如 "贡嘎山主峰" / "卡瓦格博峰" */
  peakName: string;
  /** 主峰真实海拔（米）—— 教学标注用，与 DEM 网格最高点略有差异 */
  peakAltitude: number;
  /** 主峰所在纬度（也是默认「山体纬度」） */
  lat: number;
  /** 主峰所在经度 */
  lon: number;
  /** 地面跨度（km），东西与南北相同（地面等距网格） */
  spanKm: number;
  /** 每边格点数（网格为 grid×grid） */
  grid: number;
  /** 该网格内的最低高程（米） */
  demMin: number;
  /** 该网格内的最高高程（米） */
  demMax: number;
  /** 高程数据：整数米、Uint16 小端、行主序（从北到南、从西到东）、base64 */
  b64: string;
}

/**
 * 运行时的高程场。
 *
 * ## ⚠️ 「海拔」与「视觉高度」必须分开 —— 这是本文件最要紧的一条
 *
 * 有两件常被混为一谈的事：
 *
 *  1. **高程偏移**（`elevationOffset`）：真的在改海拔。整座山抬高 500 m，
 *     山顶就从 7400 m 变成 7900 m，面板读数、等高线注记、带谱边界全都跟着变。
 *     —— 这才是「修改 DEM 上的值」。
 *  2. **垂直夸张**（`verticalExaggeration`）：只是把纵轴拉长，让起伏更好看。
 *     **它不该改变「这座山有多高」这个事实**。
 *
 * 早期把两者都乘进同一个数组，结果是：夸张调到 2 倍，面板会显示「贡嘎山 14828 m」——
 * 一个荒谬的读数。所以这里存两份：
 *
 *  - `raw`：真实 DEM 的只读副本，任何操作都不写它（「还原真实地形」的依据）
 *  - `alt`：当前**海拔** = `max(0, raw + elevationOffset)`，一切读数/等高线/带谱都用它
 *
 * 而视觉高度 = `alt × verticalExaggeration`，只在渲染顶点时临时算，不落盘。
 */
export interface DemField {
  source: DemSource;
  /** 真实高程（米），只读 */
  raw: Float32Array;
  /** 当前海拔（米）= max(0, raw + elevationOffset)：读数、等高线、带谱的唯一依据 */
  alt: Float32Array;
  /** 网格边长 */
  grid: number;
  /** 地面跨度（米） */
  spanM: number;
  /** 当前海拔范围（随 alt 变化） */
  minH: number;
  maxH: number;
  /** 当前最高点在网格中的位置 */
  peakI: number;
  peakJ: number;
  /** 垂直夸张系数（纯视觉，不影响任何读数） */
  verticalExaggeration: number;
  /** 高程偏移（米，真改海拔） */
  elevationOffset: number;
}
