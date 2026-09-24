/**
 * 内置地形清单 —— **两档**：模板地形（示意）+ 真实地形（DEM）。
 *
 * ## 为什么要分成两档（v2.4.0）
 *
 * 真实 DEM 的好处是可信，代价是**形状不受控**：
 *
 * - 贡嘎山的山脊被冰川切得七零八落、山谷分叉成树枝状，学生很难在上面
 *   认出"等高线凸向低处"这条规律；而陡崖、鞍部这些部位，在四座真山里
 *   有的有、有的没有，凑不齐一组对照。
 * - 课本上的等高线地形图是**示意图**：两座峰、一道脊、一条谷、一处陡崖、一个鞍部，
 *   五类部位各一处。真实样本给不了这种"干净"。
 *
 * 所以：**模板地形在前（入门），真实地形在后（进阶）**，两档并存、一个都不删。
 * 模板由 `scripts/gen_templates.cjs` 用解析函数生成，形状完全可控，
 * 每个样本只讲一件事；它们带 `isTemplate: true`，不对应任何真实地点。
 *
 * ## 山地选 4 座真样本的理由（v2.2.0，仍然有效）
 *
 * 覆盖垂直带谱的三种典型情形：
 *  - 贡嘎山：低纬（29.6°N）+ 极大高差（2200→7400 m），5 条带谱齐全，最标准的教科书案例
 *  - 珠穆朗玛峰：低纬 + 最高，但北坡山脚已在青藏高原面 3900 m 以上，只有上部 2~3 条带
 *  - 梅里雪山：低纬 + 高差大，与贡嘎同为横断山区，可作对照
 *  - 太白山：中纬（34.0°N）+ 中低山（830→3740 m），看「纬度升高后同海拔带谱整体下移」
 *
 * 另外四类各一个样本，取景都经过 `scripts/landform.test.cjs` 反向校验
 * （声明类型必须与 `landform.ts` 判据算出来的一致）：
 *  - 华北平原·衡水：30 km 内高差只有几十米，最干净的"平原"参照
 *  - 内蒙古高原·锡林浩特：同样是"平"，但海拔 1045 m —— 课本说平原与高原的区别只在海拔，
 *    这两个样本正好配成一对。**没有选黄土高原**：它在 30 km 窗口里塬面与沟壑并存，
 *    局部高差中位数实测 231 m，按课本"相对高度 >200 m 即山地"会被判成山地 ——
 *    不是因为判据错了，而是那个尺度上它本来就不是一块纯粹的"高原面"
 *  - 川中丘陵：四川盆地中部的方山丘陵，局部起伏约 110 m，正是"丘陵"的中间值
 *  - 四川盆地·盆中：见 `dem-linfen_basin.ts` 的注释（图幅必须放大到 60 km 才装得下盆缘）
 *
 * ## 顺序
 *
 * 模板三档排在最前 —— 默认打开的就是**模板山地**：
 * 刚接触等高线地形图的学生一进来就该看到一座最干净的山，而不是贡嘎山。
 * 其后是真实样本，按课本顺序（平原·高原·山地·丘陵·盆地）接上。
 */
import { dem as tplMountain } from "./dem-tpl_mountain";
import { dem as tplHill } from "./dem-tpl_hill";
import { dem as tplBasin } from "./dem-tpl_basin";
import { dem as gongga } from "./dem-gongga";
import { dem as everest } from "./dem-everest";
import { dem as meili } from "./dem-meili";
import { dem as taibai } from "./dem-taibai";
import { dem as huabeiPlain } from "./dem-huabei_plain";
import { dem as neimengguPlateau } from "./dem-neimenggu_plateau";
import { dem as sichuanHill } from "./dem-sichuan_hill";
import { dem as linfenBasin } from "./dem-linfen_basin";
import type { DemSource } from "./types";

export type { DemSource, DemField } from "./types";

export const DEM_SOURCES: DemSource[] = [
  tplMountain,
  tplHill,
  tplBasin,
  gongga,
  everest,
  meili,
  taibai,
  huabeiPlain,
  neimengguPlateau,
  sichuanHill,
  linfenBasin
];

/** 模板地形（示意）—— 界面上单独成组，「地理位置」栏对它们不画中国地图 */
export const TEMPLATE_SOURCES: DemSource[] = DEM_SOURCES.filter((s) => s.isTemplate === true);

/** 真实地形（DEM）—— 有真实经纬度、有省份、有地理位置图 */
export const REAL_SOURCES: DemSource[] = DEM_SOURCES.filter((s) => s.isTemplate !== true);

export function sourceByTag(tag: string): DemSource {
  const hit = DEM_SOURCES.find((s) => s.tag === tag);
  return hit ?? DEM_SOURCES[0];
}
