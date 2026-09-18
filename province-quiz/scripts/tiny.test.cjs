#!/usr/bin/env node
/**
 * province_quiz v1.1.0 —— 港澳轮廓「细粒度数据 + 小要素描边」的回归断言。
 *
 * 断言写的是**期望行为**，不是实现：
 *   · 数据层：轮廓的几何量必须够细（尺度无关的量，不是像素）
 *   · 渲染层：描边相对形状不能过粗（挑**匹配物理尺度**的比值，不是像素占比）
 *   · 边界：新逻辑不许动到其余 32 个要素（逐字节比对取景框字符串）
 *
 * 依赖 `scripts/_silhouette.cjs`（由 `npm run test:data` 里的 rolldown 生成）。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "src", "data", "provinces.json");
const SOURCE = path.join(ROOT, "..", "province-puzzle", "src", "data", "province.json");

const { TINY_BBOX, TINY_STROKE_PX, bboxSize, isTiny, silhouetteViewBox, silhouettePathClass } =
  require("./_silhouette.cjs");

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`  ✔ ${name}${detail ? "  " + detail : ""}`);
  } else {
    fail += 1;
    console.log(`  ✘ ${name}${detail ? "  " + detail : ""}`);
  }
}

/** 尺度无关的几何量：环数 / 顶点数 / 最大环的不同坐标数 / 退化环数。 */
function pathGeom(d) {
  const rings = String(d).split("M").filter((s) => s.trim());
  let verts = 0;
  let maxUniq = 0;
  let degenerate = 0;
  for (const r of rings) {
    const pts = r.replace(/[Zz]/g, "").split("L").map((s) => s.trim()).filter(Boolean);
    verts += pts.length;
    const uniq = new Set(pts).size;
    if (uniq > maxUniq) maxUniq = uniq;
    if (uniq <= 1) degenerate += 1;
  }
  return { rings: rings.length, verts, maxUniq, degenerate };
}

const data = JSON.parse(fs.readFileSync(DATA, "utf8"));
const byId = Object.fromEntries(data.features.map((f) => [f.id, f]));

// ───────────────────────── 一、数据层 ─────────────────────────
console.log("\n一、数据层：轮廓几何必须够细（尺度无关的量）");
check("34 个省级行政区齐全", data.features.length === 34, `实际 ${data.features.length}`);

const FINE = {
  "810000": { rings: 30, verts: 600, uniq: 200 },
  "820000": { rings: 3, verts: 60, uniq: 20 },
};
for (const [id, need] of Object.entries(FINE)) {
  const f = byId[id];
  if (!f) {
    check(`${id} 存在`, false);
    continue;
  }
  const g = pathGeom(f.d);
  check(
    `${f.name}：环≥${need.rings} 顶点≥${need.verts} 最大环不同坐标≥${need.uniq}`,
    g.rings >= need.rings && g.verts >= need.verts && g.maxUniq >= need.uniq,
    `环=${g.rings} 顶点=${g.verts} 最大环不同坐标=${g.maxUniq}`
  );
  check(
    `${f.name}：没有塌成单点的环（旧数据里澳门是 M727,740L727,740L727,740L727,740Z）`,
    g.degenerate === 0,
    `退化环=${g.degenerate}`
  );
}

// 同源交叉比对 —— 派生副本最容易停留旧版本，把这条钉死
if (fs.existsSync(SOURCE)) {
  const src = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  const srcById = Object.fromEntries(src.features.map((f) => [f.id, f]));
  const ids = Object.keys(srcById).filter((i) => byId[i]);
  const diff = ids.filter((i) => byId[i].d !== srcById[i].d);
  check(
    `与 province-puzzle 的 d 逐字节相同 ${ids.length - diff.length} / ${ids.length}`,
    diff.length === 0,
    diff.length ? `不同：${diff.map((i) => `${i}:${byId[i].name}`).join(" | ")}` : ""
  );
  check("没有 top 层 inset 字段（本游戏不需要南海小地图）", !("inset" in data));
} else {
  check("能找到同源的 province-puzzle 数据", false, SOURCE);
}

// ───────────────────────── 二、渲染层 ─────────────────────────
console.log("\n二、渲染层：描边相对形状不能过粗（比值要匹配物理尺度）");

// 真机尺寸：.silhouette-wrap width:min(540px,100%) padding:10px border:4px ⇒ 512
//          .silhouette width:100%; max-height:300px      preserveAspectRatio 默认 meet
const CANVAS = { w: 512, h: 300 };

/** 用真实 viewBox 算缩放（与浏览器 `min(框宽/vbW, 框高/vbH)` 同式）。 */
function scaleOf(feature, vbString) {
  const [x, y, w, h] = vbString.split(" ").map(Number);
  return { k: Math.min(CANVAS.w / w, CANVAS.h / h), vbW: w, vbH: h, x, y };
}

/** 旧渲染：固定 +12 常数边距 + 随缩放走的单位描边。 */
function legacyViewBox(feature) {
  const [minX, minY, maxX, maxY] = feature.bbox;
  const w = maxX - minX;
  const h = maxY - minY;
  const pad = Math.max(w, h) * 0.08 + 12;
  return `${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`;
}

/**
 * 描边屏幕像素 ÷ 形状短边像素（匹配物理尺度的比值，见 skill `geo-boundary-fidelity` §4.3.1）。
 *
 * ⚠ `strokeUnits` 的含义取决于是否 `vector-effect: non-scaling-stroke`：
 *   普通描边是 viewBox 单位 ⇒ 屏幕像素 = 单位数 × k
 *   非缩放描边是**屏幕像素** ⇒ 屏幕像素 = 单位数（不乘 k）
 * 一开始我漏了这个区分，把 1.5 px 又乘了一遍 k，算成 37.6 px 的假失败。
 */
function strokeRatio(feature, vbString, strokeUnits, nonScaling) {
  const { k } = scaleOf(feature, vbString);
  const [minX, minY, maxX, maxY] = feature.bbox;
  const shortPx = Math.min(maxX - minX, maxY - minY) * k;
  const strokePx = nonScaling ? strokeUnits : strokeUnits * k;
  return { ratio: strokePx / shortPx, shortPx, strokePx };
}

const TARGETS = ["810000", "820000"];
for (const id of TARGETS) {
  const f = byId[id];
  const old = strokeRatio(f, legacyViewBox(f), 2, false);
  const now = strokeRatio(f, silhouetteViewBox(f), TINY_STROKE_PX, true);
  check(
    `【旧渲染】${f.name} 描边超过形状短边的 5%（"粗"的量化形式）`,
    old.ratio > 0.05,
    `描边 ${old.strokePx.toFixed(1)} px / 形状短边 ${old.shortPx.toFixed(1)} px = ${(old.ratio * 100).toFixed(1)}%`
  );
  check(
    `【新渲染】${f.name} 描边 ≤ 形状短边的 5%`,
    now.ratio <= 0.05,
    `描边 ${now.strokePx.toFixed(2)} px / 形状短边 ${now.shortPx.toFixed(1)} px = ${(now.ratio * 100).toFixed(2)}%`
  );
  // 「用于识别」：轮廓得画得够大，不能是一颗小点。
  // 旧渲染下澳门只有 27 px 长边（+12 常数边距把取景框的 96% 留成空白）。
  const longestPx =
    Math.max(f.bbox[2] - f.bbox[0], f.bbox[3] - f.bbox[1]) * scaleOf(f, silhouetteViewBox(f)).k;
  const longestPxOld =
    Math.max(f.bbox[2] - f.bbox[0], f.bbox[3] - f.bbox[1]) * scaleOf(f, legacyViewBox(f)).k;
  check(
    `【新渲染】${f.name} 轮廓长边 ≥150 px（小到认不出就不算修好）`,
    longestPx >= 150,
    `新 ${longestPx.toFixed(0)} px ← 旧 ${longestPxOld.toFixed(0)} px`
  );
}

// 澳门是"粗"的极端形态：旧数据本身是零长度路径，旧描边把形状整个盖住
const mo = byId["820000"];
const moOld = strokeRatio(mo, legacyViewBox(mo), 2, false);
check(
  "【极端形态】旧渲染下澳门是实心色块（描边 ≥ 形状短边）",
  moOld.ratio >= 1,
  `${(moOld.ratio * 100).toFixed(0)}%`
);

// ───────────────────────── 三、边界 ─────────────────────────
console.log("\n三、边界：不许误伤其余要素");
const tiny = data.features.filter(isTiny).map((f) => f.id).sort();
check(
  "TINY_BBOX 正好只圈中香港、澳门",
  tiny.length === 2 && tiny[0] === "810000" && tiny[1] === "820000",
  `命中 ${tiny.map((i) => byId[i].name).join(" / ")}`
);
const hk = bboxSize(byId["810000"]);
const sh = bboxSize(byId["310000"]);
check(
  `阈值 ${TINY_BBOX} 落在香港(${hk.toFixed(2)}) 与 上海(${sh.toFixed(2)}) 之间的间隙里`,
  hk < TINY_BBOX && TINY_BBOX < sh,
  `间隙宽 ${(sh - hk).toFixed(2)} 单位`
);
// 「最近未命中」= 未被圈中的要素里最小的那个（用 reduce 显式取，别依赖排序方向）
const nonTiny = data.features.filter((f) => !isTiny(f));
const nearestMiss = nonTiny.reduce((min, f) => (bboxSize(f) < bboxSize(min) ? f : min), nonTiny[0]);
check(
  "最近的一个未命中者是上海（阈值上移就会误伤它）",
  nearestMiss.id === "310000",
  `${nearestMiss.name} bboxSize=${bboxSize(nearestMiss).toFixed(2)}`
);

// 34 个要素的取景框都得是合法的 SVG viewBox（不能出现 NaN / 0 宽高）
const badVb = data.features.filter((f) => {
  const parts = silhouetteViewBox(f).split(" ").map(Number);
  return parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || parts[2] <= 0 || parts[3] <= 0;
});
check("34 个要素的 viewBox 都是合法数字且宽高 > 0", badVb.length === 0, badVb.map((f) => f.name).join(" / "));

const drifted = nonTiny.filter((f) => silhouetteViewBox(f) !== legacyViewBox(f));
check(
  `其余 ${nonTiny.length} 个要素的取景框与旧公式逐字节相同`,
  drifted.length === 0,
  drifted.length ? `漂了：${drifted.map((f) => f.name).join(" / ")}` : ""
);
const classDrift = nonTiny.filter((f) => silhouettePathClass(f) !== "silhouette-path");
check("其余要素的 path class 保持原样（不会拿到细描边）", classDrift.length === 0);
check(
  "两个目标要素确实拿到了 is-tiny 这个类",
  TARGETS.every((i) => silhouettePathClass(byId[i]) === "silhouette-path is-tiny")
);

// ───────────────────────── 汇总 ─────────────────────────
console.log(`\n断言 ${pass + fail} 项，失败 ${fail} 项`);
if (fail === 0) console.log("ALL PASSED ✔");
else {
  console.log("FAILED ✘");
  process.exit(1);
}
