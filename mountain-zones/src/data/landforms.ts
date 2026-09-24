/**
 * 地形图鉴数据：每个地形样本（模板示意 + 真实 DEM）的「类型 + 五类部位」检出结果。
 *
 * ## 两条数据来源，各有分工
 *
 * - `landType`：**人工声明**。按人教版八上写的教学口径 ——
 *   真实样本在 `.workbuddy/tmp/dem-probe/build_dem.py` 的样本表里定义，
 *   模板样本在 `scripts/gen_templates.cjs` 的 `SPECS` 里定义。
 * - `detected` / `counts` / `parts`：**机器算出来的**。由
 *   `scripts/gen_landforms.cjs` 用 `landform.ts` 的真实判据跑出来。
 *
 * `scripts/landform.test.cjs` 断言每个样本 `detected === landType` ——
 * 人工口径与机器判据必须一致，不一致就是有一边错了
 * （要么样本取景不对，要么判据阈值不对）。
 *
 * ## 图鉴的标签筛选直接用这份数据
 *
 * 「部位」标签（山峰/山脊/山谷/鞍部/陡崖）筛的是 `counts[id] > 0`，
 * 也就是**这个样本里真的检测出了该部位**，而不是人工勾的。
 * 所以标签点下去必有内容，不会出现「点了陡崖却什么都没有」。
 *
 * ⚠️ 本文件由 `scripts/gen_landforms.cjs` 生成，请勿手改。
 */
import type { LandPartCounts, LandPartId, LandTypeId } from "../landform";

export interface LandformEntry {
  tag: string;
  name: string;
  /**
   * 是否为**模板地形**（示意，非真实 DEM）。
   *
   * 图鉴靠它给模板卡片加一个角标 —— 图鉴是学生自己翻的地方，
   * 不标出来的话「模板山地」和「贡嘎山」在卡片上长得一模一样，
   * 学生会以为那也是某座真实的山。
   */
  isTemplate: boolean;
  /** 人工声明的地形类型（教学口径） */
  landType: LandTypeId;
  /** 机器判据算出来的类型 —— 必须与 `landType` 相同 */
  detected: LandTypeId;
  /** 机器判据给的依据（一句话） */
  reason: string;
  /** 五类地形部位的检出数量 */
  counts: LandPartCounts;
  /** 检出数量 > 0 的部位（图鉴标签筛选直接用这个） */
  parts: LandPartId[];
  /** 海拔范围（米，取整） */
  min: number;
  max: number;
  mean: number;
  /** 全图相对高差（米） */
  relief: number;
  /** 局部高差中位数（米）—— 判型的真正依据 */
  localRelief: number;
  /** 外环平均 − 中心盘平均（米） */
  rimMinusCore: number;
  /** 8 个方位里边缘高于中心的个数 */
  sectorsAbove: number;
  /** 被陡崖物理闸门剔除的异常格数（> 0 说明这张 DEM 有空洞填充） */
  suspect: number;
}

export const LANDFORMS: LandformEntry[] = [
  {
    tag: "tpl_mountain",
    name: "模板山地",
    isTemplate: true,
    landType: "mountain",
    detected: "mountain",
    reason: "局部高差中位数达 500 m",
    counts: { peak: 3, ridge: 76, valley: 55, saddle: 2, cliff: 7 },
    parts: ["peak", "ridge", "valley", "saddle", "cliff"],
    min: 753, max: 4200, mean: 1749,
    relief: 3447, localRelief: 500,
    rimMinusCore: -753, sectorsAbove: 0,
    suspect: 0
  },
  {
    tag: "tpl_hill",
    name: "模板丘陵",
    isTemplate: true,
    landType: "hill",
    detected: "hill",
    reason: "局部高差 134 m，属中等",
    counts: { peak: 6, ridge: 19, valley: 57, saddle: 2, cliff: 0 },
    parts: ["peak", "ridge", "valley", "saddle"],
    min: 159, max: 518, mean: 327,
    relief: 359, localRelief: 134,
    rimMinusCore: 2, sectorsAbove: 0,
    suspect: 0
  },
  {
    tag: "tpl_basin",
    name: "模板盆地",
    isTemplate: true,
    landType: "basin",
    detected: "basin",
    reason: "外环比中心高 821 m，8 个方位中有 8 个方位的边缘高于中心 40 m 以上",
    counts: { peak: 6, ridge: 265, valley: 265, saddle: 4, cliff: 16 },
    parts: ["peak", "ridge", "valley", "saddle", "cliff"],
    min: 400, max: 1964, mean: 808,
    relief: 1564, localRelief: 820,
    rimMinusCore: 821, sectorsAbove: 8,
    suspect: 0
  },
  {
    tag: "gongga",
    name: "贡嘎山",
    isTemplate: false,
    landType: "mountain",
    detected: "mountain",
    reason: "局部高差中位数达 1808 m",
    counts: { peak: 6, ridge: 3638, valley: 1718, saddle: 5, cliff: 16 },
    parts: ["peak", "ridge", "valley", "saddle", "cliff"],
    min: 2204, max: 7414, mean: 4477,
    relief: 5210, localRelief: 1808,
    rimMinusCore: -1549, sectorsAbove: 0,
    suspect: 132
  },
  {
    tag: "everest",
    name: "珠穆朗玛峰",
    isTemplate: false,
    landType: "mountain",
    detected: "mountain",
    reason: "局部高差中位数达 1277 m",
    counts: { peak: 6, ridge: 3760, valley: 1420, saddle: 4, cliff: 16 },
    parts: ["peak", "ridge", "valley", "saddle", "cliff"],
    min: 3890, max: 8731, mean: 5836,
    relief: 4841, localRelief: 1277,
    rimMinusCore: -1712, sectorsAbove: 0,
    suspect: 0
  },
  {
    tag: "meili",
    name: "梅里雪山",
    isTemplate: false,
    landType: "mountain",
    detected: "mountain",
    reason: "局部高差中位数达 1853 m",
    counts: { peak: 6, ridge: 3549, valley: 2313, saddle: 4, cliff: 15 },
    parts: ["peak", "ridge", "valley", "saddle", "cliff"],
    min: 1995, max: 6642, mean: 4044,
    relief: 4647, localRelief: 1853,
    rimMinusCore: -1327, sectorsAbove: 0,
    suspect: 0
  },
  {
    tag: "taibai",
    name: "太白山",
    isTemplate: false,
    landType: "mountain",
    detected: "mountain",
    reason: "局部高差中位数达 1179 m",
    counts: { peak: 6, ridge: 3659, valley: 3309, saddle: 2, cliff: 4 },
    parts: ["peak", "ridge", "valley", "saddle", "cliff"],
    min: 828, max: 3743, mean: 2124,
    relief: 2915, localRelief: 1179,
    rimMinusCore: -1093, sectorsAbove: 0,
    suspect: 0
  },
  {
    tag: "huabei_plain",
    name: "华北平原",
    isTemplate: false,
    landType: "plain",
    detected: "plain",
    reason: "局部高差仅 11 m",
    counts: { peak: 0, ridge: 0, valley: 0, saddle: 0, cliff: 0 },
    parts: [],
    min: 11, max: 51, mean: 22,
    relief: 40, localRelief: 11,
    rimMinusCore: 0, sectorsAbove: 0,
    suspect: 0
  },
  {
    tag: "neimenggu_plateau",
    name: "内蒙古高原",
    isTemplate: false,
    landType: "plateau",
    detected: "plateau",
    reason: "平均海拔 1045 m 而局部高差只有 84 m",
    counts: { peak: 6, ridge: 0, valley: 0, saddle: 4, cliff: 0 },
    parts: ["peak", "saddle"],
    min: 937, max: 1318, mean: 1045,
    relief: 381, localRelief: 84,
    rimMinusCore: 59, sectorsAbove: 6,
    suspect: 0
  },
  {
    tag: "sichuan_hill",
    name: "川中丘陵",
    isTemplate: false,
    landType: "hill",
    detected: "hill",
    reason: "局部高差 112 m，属中等",
    counts: { peak: 6, ridge: 1, valley: 2, saddle: 4, cliff: 0 },
    parts: ["peak", "ridge", "valley", "saddle"],
    min: 234, max: 568, mean: 401,
    relief: 334, localRelief: 112,
    rimMinusCore: -8, sectorsAbove: 1,
    suspect: 0
  },
  {
    tag: "linfen_basin",
    name: "临汾盆地",
    isTemplate: false,
    landType: "basin",
    detected: "basin",
    reason: "外环比中心高 287 m，8 个方位中有 7 个方位的边缘高于中心 40 m 以上",
    counts: { peak: 6, ridge: 627, valley: 549, saddle: 4, cliff: 0 },
    parts: ["peak", "ridge", "valley", "saddle"],
    min: 401, max: 1672, mean: 727,
    relief: 1271, localRelief: 353,
    rimMinusCore: 287, sectorsAbove: 7,
    suspect: 0
  }
];

export function landformByTag(tag: string): LandformEntry | undefined {
  return LANDFORMS.find((e) => e.tag === tag);
}

/** 按地形类型分组（顺序照课本：平原·高原·山地·丘陵·盆地） */
export function groupByLandType(): Map<LandTypeId, LandformEntry[]> {
  const out = new Map<LandTypeId, LandformEntry[]>();
  for (const e of LANDFORMS) {
    const list = out.get(e.landType) ?? [];
    list.push(e);
    out.set(e.landType, list);
  }
  return out;
}
