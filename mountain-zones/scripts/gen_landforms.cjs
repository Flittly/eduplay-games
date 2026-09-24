/**
 * 生成 `src/data/landforms.ts` —— 地形图鉴的数据源。
 *
 * ## 为什么要有这个生成步骤，而不是运行时算
 *
 * 五类地形部位的检测（TPI 扫描 + 最大生成树求鞍部 + 陡崖三闸门）一次约 40~80 ms。
 * 图鉴要一次列出全部 8 个样本的部位数量，运行时现算就是 0.5 s 的卡顿，
 * 而且**图鉴的标签筛选本来就该是稳定数据**：学生点开「陡崖」标签，
 * 列表不该因为某次算得慢就少一条。
 *
 * ## 它是"人工口径 + 机器校验"里的**校验**那一半
 *
 * 每个样本的 `landType` 是人工按人教版教材写定的（在 build_dem.py 里），
 * 这个脚本用 `landform.ts` 的**真实判据**再算一遍，把两者一并写进产物。
 * `scripts/landform.test.cjs` 最后会断言 `detected === landType` ——
 * 声明与实际不符就红。同 `data/locations.ts` 的省份校验一个路子。
 *
 * 用法：npm run gen:landforms
 *      （npm script 会先 rolldown 出 _dem.cjs / _data.cjs / _landform.cjs；
 *        绕过 npm 直接 node 这个文件时，下面的守门会挡下过期的产物）
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

/**
 * 产物新鲜度守门（同 §19 的 `exit(3)` 约定）。
 *
 * 这个脚本**读的是 `_*.cjs` 构建产物，不是 `src/`** —— 而 `_*.cjs` 只有
 * `npm run test:data`（或本脚本的 npm 版本）会刷新。曾经的写法是
 * `"gen:landforms": "node scripts/gen_landforms.cjs"`，于是改完
 * `src/data/index.ts` 加样本、直接 `npm run gen:landforms`，
 * 拿到的还是**上一版的样本清单**，而且输出看起来一切正常：
 * 旧样本照样判 OK、只有新样本"缺失"，没有任何报错。
 * （真实踩过：换成内蒙古高原后仍在报 loess_plateau。）
 *
 * 现在 npm script 已经串上了三份 rolldown，这里再留一道守门，
 * 挡住「绕过 npm、直接 node 这个文件」的用法。
 */
function newestMtime(dir) {
  let newest = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    const t = ent.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs;
    if (t > newest) newest = t;
  }
  return newest;
}

const stale = [];
for (const [bundle, srcPath] of [
  ["_data.cjs", path.join(ROOT, "src/data")],
  ["_dem.cjs", path.join(ROOT, "src/dem.ts")],
  ["_landform.cjs", path.join(ROOT, "src/landform.ts")]
]) {
  const built = path.join(__dirname, bundle);
  const srcM = fs.existsSync(srcPath) && fs.statSync(srcPath).isDirectory()
    ? newestMtime(srcPath)
    : fs.statSync(srcPath).mtimeMs;
  if (!fs.existsSync(built) || fs.statSync(built).mtimeMs < srcM) stale.push(bundle);
}
if (stale.length) {
  console.error(
    `\n✗ 构建产物过期：${stale.join(" ")}\n` +
      `  这个脚本读的是 scripts/_*.cjs，不是 src/。\n` +
      `  请用 npm run gen:landforms（它会先刷新三份 rolldown）。\n`
  );
  process.exit(3);
}

const data = require("./_data.cjs");
const dem = require("./_dem.cjs");
const lf = require("./_landform.cjs");

const sources = data.DEM_SOURCES;
if (!Array.isArray(sources) || sources.length === 0) {
  console.error("_data.cjs 里没拿到 DEM_SOURCES —— 先跑 npm run test:data");
  process.exit(1);
}

const entries = [];
for (const src of sources) {
  const field = dem.createField(src);
  const h = dem.heightFn(field);
  const marks = lf.landParts(h, field.grid, field.spanM);
  const counts = lf.landPartCounts(marks);
  const stats = lf.reliefStats(h, field.grid);
  const cls = lf.classifyLandType(stats);
  entries.push({
    tag: src.tag,
    name: src.name,
    isTemplate: src.isTemplate === true,
    landType: src.landType,
    detected: cls.type,
    reason: cls.reason,
    counts,
    parts: lf.LAND_PARTS.map((p) => p.id).filter((id) => counts[id] > 0),
    min: Math.round(stats.min),
    max: Math.round(stats.max),
    mean: Math.round(stats.mean),
    relief: Math.round(stats.relief),
    localRelief: Math.round(stats.localRelief),
    rimMinusCore: Math.round(stats.edgeMinusCore),
    sectorsAbove: stats.sectorsAbove,
    suspect: marks.cliffScan.suspect
  });
  const flag = cls.type === src.landType ? "OK " : "!! ";
  console.log(
    `${flag}${src.tag.padEnd(14)} 声明 ${src.landType.padEnd(8)} 判定 ${cls.type.padEnd(8)} ` +
      `海拔 ${Math.round(stats.min)}~${Math.round(stats.max)} · 局部起伏 ${Math.round(stats.localRelief)} m · ` +
      `方位 ${stats.sectorsAbove}/8 · 部位 ` +
      ["peak", "ridge", "valley", "saddle", "cliff"].map((k) => `${k}${counts[k]}`).join(" ")
  );
}

const body = entries
  .map((e) => {
    const parts = e.parts.map((p) => JSON.stringify(p)).join(", ");
    return `  {
    tag: ${JSON.stringify(e.tag)},
    name: ${JSON.stringify(e.name)},
    isTemplate: ${e.isTemplate},
    landType: ${JSON.stringify(e.landType)},
    detected: ${JSON.stringify(e.detected)},
    reason: ${JSON.stringify(e.reason)},
    counts: { peak: ${e.counts.peak}, ridge: ${e.counts.ridge}, valley: ${e.counts.valley}, saddle: ${e.counts.saddle}, cliff: ${e.counts.cliff} },
    parts: [${parts}],
    min: ${e.min}, max: ${e.max}, mean: ${e.mean},
    relief: ${e.relief}, localRelief: ${e.localRelief},
    rimMinusCore: ${e.rimMinusCore}, sectorsAbove: ${e.sectorsAbove},
    suspect: ${e.suspect}
  }`;
  })
  .join(",\n");

const ts = `/**
 * 地形图鉴数据：每个地形样本（模板示意 + 真实 DEM）的「类型 + 五类部位」检出结果。
 *
 * ## 两条数据来源，各有分工
 *
 * - \`landType\`：**人工声明**。按人教版八上写的教学口径 ——
 *   真实样本在 \`.workbuddy/tmp/dem-probe/build_dem.py\` 的样本表里定义，
 *   模板样本在 \`scripts/gen_templates.cjs\` 的 \`SPECS\` 里定义。
 * - \`detected\` / \`counts\` / \`parts\`：**机器算出来的**。由
 *   \`scripts/gen_landforms.cjs\` 用 \`landform.ts\` 的真实判据跑出来。
 *
 * \`scripts/landform.test.cjs\` 断言每个样本 \`detected === landType\` ——
 * 人工口径与机器判据必须一致，不一致就是有一边错了
 * （要么样本取景不对，要么判据阈值不对）。
 *
 * ## 图鉴的标签筛选直接用这份数据
 *
 * 「部位」标签（山峰/山脊/山谷/鞍部/陡崖）筛的是 \`counts[id] > 0\`，
 * 也就是**这个样本里真的检测出了该部位**，而不是人工勾的。
 * 所以标签点下去必有内容，不会出现「点了陡崖却什么都没有」。
 *
 * ⚠️ 本文件由 \`scripts/gen_landforms.cjs\` 生成，请勿手改。
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
  /** 机器判据算出来的类型 —— 必须与 \`landType\` 相同 */
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
${body}
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
`;

const outPath = path.join(ROOT, "src/data/landforms.ts");
fs.writeFileSync(outPath, ts, "utf8");
console.log(`\n写出 ${path.relative(ROOT, outPath)}（${entries.length} 个样本，${ts.length} 字符）`);
const mismatch = entries.filter((e) => e.detected !== e.landType);
if (mismatch.length) {
  console.log(`\n⚠ 有 ${mismatch.length} 个样本声明与判定不符：`);
  for (const e of mismatch) {
    console.log(`   ${e.tag}: 声明 ${e.landType}，判定 ${e.detected}（${e.reason}）`);
  }
}
