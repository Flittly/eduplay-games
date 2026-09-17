/**
 * 垂直地带性纯逻辑回归测试（v1.2.0 二维版）。
 * 跑法：npm run test:data（会先用 rolldown 把 src/zonation.ts 打成 scripts/_zonation.cjs）
 *
 * 本文件只测"模型"：雪线 / 林线 / 带谱 / 密度 / 产流系数。
 * 世界几何与植被铺设在 world2d.test.cjs，物种库在 species.test.cjs，径流在 runoff.test.cjs。
 */
const gd = require("./_zonation.cjs");

const checks = [];
const check = (name, cond, extra) => {
  checks.push({ name, ok: Boolean(cond), extra: extra === undefined ? "" : String(extra) });
};

const LATS = [0, 10, 20, 30, 40, 50, 60, 70];
const beltIndex = (id) => {
  const i = gd.BELTS.findIndex((b) => b.id === id);
  return i >= 0 ? i : gd.BELTS.length; // snow 视为最冷
};

/* ===== 1) 雪线随纬度单调降低，且量级正确 ===== */
{
  const summer = LATS.map((lat) => gd.snowline(lat, "summer"));
  let monotonic = true;
  for (let i = 1; i < summer.length; i += 1) {
    if (!(summer[i] < summer[i - 1])) {
      monotonic = false;
    }
  }
  check("雪线随纬度升高而降低（严格单调）", monotonic, summer.map((v) => Math.round(v)).join(" > "));

  // 量级用"秋季"（季节位移最小）对比，夏季值另有 +380m 抬升
  const autumn = LATS.map((lat) => gd.snowline(lat, "autumn"));
  check("赤道雪线约 5000m", autumn[0] > 4500 && autumn[0] < 5600, Math.round(autumn[0]));
  const lat45 = gd.snowline(45, "autumn");
  check("45°N 雪线约 3200m（阿尔卑斯量级）", lat45 > 2800 && lat45 < 3500, Math.round(lat45));
  const lat60 = gd.snowline(60, "autumn");
  check("60°N 雪线约 2200m（斯堪的纳维亚量级）", lat60 > 1500 && lat60 < 2700, Math.round(lat60));

  // 季节位移：夏最高、冬最低
  const s = gd.SEASONS.map((x) => gd.snowline(35, x));
  check(
    "雪线的季节序列为 夏 > 春 > 秋 > 冬",
    s[1] > s[0] && s[0] > s[2] && s[2] > s[3],
    s.map((v) => Math.round(v)).join(" > ")
  );
}

/* ===== 2) 基带 = 同纬度的水平自然带，且随纬度依次变冷 ===== */
{
  check("赤道山麓是常绿阔叶林", gd.baseBelt(0, "summer") === "evergreen", gd.baseBelt(0, "summer"));
  check("40°N 山麓是落叶阔叶林", gd.baseBelt(40, "summer") === "deciduous", gd.baseBelt(40, "summer"));

  let nonDecreasing = true;
  let prev = -1;
  const seq = [];
  for (const lat of LATS) {
    const idx = beltIndex(gd.baseBelt(lat, "summer"));
    seq.push(`${lat}°:${gd.baseBelt(lat, "summer")}`);
    if (idx < prev) {
      nonDecreasing = false;
    }
    prev = idx;
  }
  check("基带随纬度升高依次变冷（不回头）", nonDecreasing, seq.join(" "));

  // 基带不受季节影响（季节只挪雪线）
  const seasonal = gd.SEASONS.map((s) => gd.baseBelt(35, s));
  check("山麓基带不随季节改换", new Set(seasonal).size === 1, seasonal.join("/"));
}

/* ===== 3) 带谱：连续、覆盖 0~山顶、随海拔单调变冷 ===== */
{
  const peak = 5000;
  const bands = gd.bandsFor(30, "summer", peak);
  check("带谱自山麓起于 0m", bands.length > 0 && Math.abs(bands[0].from) < 1e-6, bands[0] && bands[0].from);
  check(
    "带谱顶端到山顶（或到雪线+雪带）",
    Math.abs(bands[bands.length - 1].to - peak) < 1e-6,
    bands[bands.length - 1] && bands[bands.length - 1].to
  );
  let contiguous = true;
  let monotonic = true;
  let prevIdx = -1;
  for (let i = 0; i < bands.length; i += 1) {
    if (i > 0 && Math.abs(bands[i].from - bands[i - 1].to) > 1e-6) {
      contiguous = false;
    }
    const idx = beltIndex(bands[i].belt);
    if (idx < prevIdx) {
      monotonic = false;
    }
    prevIdx = idx;
  }
  check("相邻带首尾相接（无缝隙、无重叠）", contiguous);
  check("从山麓到山顶带序单调变冷", monotonic, bands.map((b) => b.belt).join(" → "));

  // 山越高，跨过的带越多
  const lowBands = gd.bandsFor(30, "summer", 1500);
  const highBands = gd.bandsFor(30, "summer", 7000);
  check(
    "山越高跨过的自然带越多",
    highBands.length > lowBands.length,
    `${lowBands.length} → ${highBands.length}`
  );

  // 带谱不随季节改换（雪线只截断雪带）
  const flat = gd.SEASONS.map((s) => JSON.stringify(gd.bandsFor(30, s, 3000)));
  check("山顶低于雪线时，带谱与季节无关", new Set(flat).size === 1, `${new Set(flat).size} 种`);

  // ⚠️ 这条是 v1.2.0 真机回归抓出来的：原来 `bandsFor` 用**季节雪线**当积雪带下界，
  //    于是 4200m 的山「夏季没有积雪带、冬季凭空多出一条」—— 切一下季节整条带谱就变形，
  //    和界面上那句"带谱本身不随季节改换"直接矛盾。
  //    现在积雪带下界改用 `snowlineAnnual()`（多年平均雪线），四季必须完全一致。
  for (const peak of [4200, 7000]) {
    const bySeason = gd.SEASONS.map((s) => JSON.stringify(gd.bandsFor(30, s, peak)));
    check(`山顶高于雪线（${peak}m）时，带谱同样与季节无关`, new Set(bySeason).size === 1,
      `${new Set(bySeason).size} 种`);
  }
  const snowBand = gd.bandsFor(30, "summer", 7000).find((b) => b.belt === "snow");
  check("积雪冰川带的下界 = 多年平均雪线（不是季节雪线）",
    snowBand && Math.abs(snowBand.from - gd.snowlineAnnual(30)) < 1e-6,
    snowBand ? `${Math.round(snowBand.from)}m vs 多年平均 ${Math.round(gd.snowlineAnnual(30))}m / 夏季 ${Math.round(gd.snowline(30, "summer"))}m` : "没有积雪带");
  check("但季节雪线确实会动（季节性积雪是另一个概念，别一起改掉）",
    gd.snowline(30, "summer") > gd.snowlineAnnual(30) && gd.snowline(30, "winter") < gd.snowlineAnnual(30),
    `夏 ${Math.round(gd.snowline(30, "summer"))}m / 年均 ${Math.round(gd.snowlineAnnual(30))}m / 冬 ${Math.round(gd.snowline(30, "winter"))}m`);
}

/* ===== 4) 林线：不高于雪线，且随纬度下降 ===== */
{
  const rows = LATS.map((lat) => ({ lat, tree: gd.treeline(lat, "summer"), snow: gd.snowline(lat, "summer") }));
  check("林线不高于雪线（任何纬度）", rows.every((r) => r.tree <= r.snow + 1e-6), JSON.stringify(rows.map((r) => Math.round(r.tree))));
  let down = true;
  for (let i = 1; i < rows.length; i += 1) {
    if (!(rows[i].tree < rows[i - 1].tree)) {
      down = false;
    }
  }
  check("林线随纬度升高而降低", down, rows.map((r) => `${r.lat}°:${Math.round(r.tree)}`).join(" "));
}

/* ===== 5) 植被密度：随海拔整体下降，雪带为 0 ===== */
{
  const peak = 6000;
  const at = (alt, season = "summer") => gd.densityAt(30, alt, season, peak);
  check("山麓植被覆盖度最高（≥0.6）", at(100) >= 0.6, at(100).toFixed(3));
  check("雪带植被覆盖度为 0", at(peak - 10) === 0, at(peak - 10));
  check("植被密度随海拔总体下降", at(100) > at(2500) && at(2500) > at(4500), `${at(100).toFixed(2)} > ${at(2500).toFixed(2)} > ${at(4500).toFixed(2)}`);
  check("密度始终落在 0~1", [0, 500, 1500, 3000, 5000, 6000].every((a) => at(a) >= 0 && at(a) <= 1));
}

/* ===== 6) 产流权重 = 1 − 覆盖度，但雪带几乎不产流 ===== */
{
  const peak = 6000;
  const below = gd.runoffWeight(30, 200, "summer", peak);
  check("植被好的山麓产流权重低（水被拦住）", below < 0.35, below.toFixed(3));

  // 取"雪线以下最高的那条带"的中点，避免把测试钉死在某个硬编码海拔上
  const bands = gd.bandsFor(30, "summer", peak).filter((b) => b.belt !== "snow");
  const top = bands[bands.length - 1];
  const bareAlt = (top.from + top.to) / 2;
  const bare = gd.runoffWeight(30, bareAlt, "summer", peak);
  check("植被稀疏处产流权重高（流石滩 / 高寒荒漠）", bare > 0.7, `${top.belt}@${Math.round(bareAlt)}m → ${bare.toFixed(3)}`);

  const snow = gd.runoffWeight(30, 5800, "summer", peak);
  check("雪带几乎不产流（降水以固态为主）", snow <= 0.06, snow.toFixed(3));
}

/* ===== 7) 等高线条数：单调，且等于理论值 ===== */
{
  const peak = 4200;
  // 等高线画在 interval、2·interval … ⇒ 条数 = (0, peak] 内 interval 的倍数个数
  const theory = (interval) => Math.floor(peak / interval);
  const rows = [100, 200, 500, 1000].map((i) => ({ i, n: gd.contourCount(peak, i), t: theory(i) }));
  check(
    "等高线条数随等高距单调下降",
    rows.every((r, k) => k === 0 || r.n < rows[k - 1].n),
    rows.map((r) => `${r.i}m:${r.n}`).join(" ")
  );
  check("等高线条数 = floor(山顶海拔 / 等高距)", rows.every((r) => r.n === r.t), JSON.stringify(rows));
  check("等高距非法时返回 0（不抛异常）", gd.contourCount(3000, 0) === 0);
}

/* ===== 8) 颜色与明暗：每个带都有可用的色值 ===== */
{
  const all = [...gd.BELTS.map((b) => b.id), "snow"];
  const bad = [];
  for (const id of all) {
    for (const s of gd.SEASONS) {
      const c = gd.beltColor(id, s);
      if (!/^#[0-9a-fA-F]{6}$/.test(c)) {
        bad.push(`${id}/${s}=${c}`);
      }
    }
  }
  check("每个带在四季下都有合法色值", bad.length === 0, bad.join(" "));
}

/* ===== 汇总 ===== */
const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "✔" : "✘"} ${c.name}${c.extra ? `  ${c.extra}` : ""}`);
}
console.log(`\nZONATION CHECK ${failed.length === 0 ? "PASSED ✔" : "FAILED ✘"}  断言 ${checks.length} 项，失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
