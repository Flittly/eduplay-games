/**
 * 位置图：投影与经纬度换算（纯逻辑，不依赖 React / three.js）。
 *
 * ## 为什么要有这么一层
 *
 * 中国地图的 path 是**离线生成**的（`scripts/prepare_maps.py`，源为阿里云 DataV /
 * 高德地图底图数据），前端拿到的是已经投影并抽稀好的 SVG 字符串；而那座山的红点位置
 * 得在前端由经纬度实时算出来。两边各算一次，就必须用**同一套投影**，否则红点会相对
 * 省界整体漂移 —— 而且这种漂移在小图上很隐蔽，看着"就是差一点点"。
 *
 * 所以这一层刻意保持纯函数：`npm run test:data` 用它和生成器写进 `meta.probe` 的
 * 投影结果对表，两侧只要有一处写错（参数改了、度弧度换错、offset 符号反了）立刻报红。
 *
 * 投影参数与 `landform-quiz/src/logic.ts` 以及同样那两个 Python 生成脚本一致 ——
 * 换参数要四处一起改，改完跑两个游戏的 test:data。
 */

const RAD = Math.PI / 180;

export interface LccParams {
  phi1: number;
  phi2: number;
  phi0: number;
  lam0: number;
}

export interface ChinaMapMeta {
  projection: "lambert-conic-conformal";
  params: LccParams;
  scale: number;
  offset: [number, number];
  viewBox: [number, number, number, number];
  source: string;
  note: string;
  /** tag -> [x, y]（viewBox 坐标），生成器算的；前端用来交叉校验自己的投影 */
  probe: Record<string, [number, number]>;
}

export interface ChinaMap {
  meta: ChinaMapMeta;
  /** 国界轮廓（主图，含台湾省、港澳） */
  outline: string;
  /** adcode -> 该省 path（主图） */
  provinces: Record<string, string>;
  /** adcode -> 省名 */
  provinceNames: Record<string, string>;
  /**
   * 南海诸岛插图：独立缩放后叠在主图左下角的空白海域上。
   *
   * 为什么不把南海画进主图见生成脚本的说明 —— 一句话：主图会变成竖长条，
   * 而四座山全挤在上部，"在中国哪里"反而看不出来。
   */
  inset: {
    /** [x, y, w, h]，主图坐标系里的方框（用于画边框与标题） */
    box: [number, number, number, number];
    /** 南海诸岛岛屿轮廓 */
    outline: string;
    /** 断续线（现行官方口径的十段线，含台湾岛以东那一段） */
    nineDash: string;
  };
}

/** 投影函数签名：(纬度, 经度) => [x, y]（viewBox 坐标） */
export type Projector = (lat: number, lon: number) => [number, number];

/**
 * 兰伯特等角圆锥投影。
 *
 * ⚠️ 注意最后一步：圆锥投影的 y 向北增大，而屏幕 y 向南增大，
 * 所以是 `rho*cos(theta) - rho0` 而不是反过来。生成脚本里同一处也写了注释 —— 这地方
 * 写反的症状是"中国图南北颠倒"，而红点因为用了同一个函数会跟着一起颠倒，
 * **看起来仍然是自洽的**，只有跟省界轮廓对照才会发现。
 */
export function makeProjector(meta: ChinaMapMeta): Projector {
  const { phi1, phi2, phi0, lam0 } = meta.params;
  const p1 = phi1 * RAD;
  const p2 = phi2 * RAD;
  const n =
    Math.abs(p1 - p2) < 1e-9
      ? Math.sin(p1)
      : Math.log(Math.cos(p1) / Math.cos(p2)) /
        Math.log(Math.tan(Math.PI / 4 + p2 / 2) / Math.tan(Math.PI / 4 + p1 / 2));
  const F = (Math.cos(p1) * Math.pow(Math.tan(Math.PI / 4 + p1 / 2), n)) / n;
  const rho0 = F / Math.pow(Math.tan(Math.PI / 4 + (phi0 * RAD) / 2), n);
  return (lat, lon) => {
    const phi = lat * RAD;
    const rho = F / Math.pow(Math.tan(Math.PI / 4 + phi / 2), n);
    const th = n * (lon * RAD - lam0 * RAD);
    return [
      rho * Math.sin(th) * meta.scale - meta.offset[0],
      (rho * Math.cos(th) - rho0) * meta.scale - meta.offset[1]
    ];
  };
}

/** 经纬度 → viewBox 内的百分比位置（相对 viewBox 左上角），用于按 % 摆红点 */
export function projectToPercent(
  map: ChinaMap,
  lat: number,
  lon: number
): { left: number; top: number } {
  const [x, y] = makeProjector(map.meta)(lat, lon);
  const [vbx, vby, vbw, vbh] = map.meta.viewBox;
  return { left: ((x - vbx) / vbw) * 100, top: ((y - vby) / vbh) * 100 };
}
