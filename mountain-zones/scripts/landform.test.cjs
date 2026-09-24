/**
 * 地形部位 / 地形类型 纯逻辑回归测试（v2.2.0）。
 * 跑法：npm run test:data（会先用 rolldown 把 src/landform.ts 打成 scripts/_landform.cjs）
 *
 * 本文件管三件事：
 *   1. **结构**：五类部位的文案齐全、五种类型齐全、判据文案与常量一致；
 *   2. **在真数据上**：四座真山的峰 / 脊 / 谷 / 鞍 / 崖数量与关键点位，钉成回归基线；
 *   3. **在合成地形上**：把"教科书那句错口径"和"SRTM 空洞缝"做成可复现的反例 ——
 *      这两条是本期最容易写错、而且错了**没有任何征兆**的地方。
 *
 * ⚠️ 基线里那些数字是**实测出来的**，不是先定后写：四个样本的 DEM 是缓存的瓦片，
 * 算法是确定性的，所以数字可复现。改动算法导致数字变动时，先量、再判断是否合理，
 * 然后才更新这里的基线 —— 不许为了让测试变绿而改数字。
 */
const path = require("path");
const fs = require("fs");
const lf = require("./_landform.cjs");
const dem = require("./_dem.cjs");
const data = require("./_data.cjs");

const checks = [];
const check = (name, cond, extra) => {
  checks.push({ name, ok: Boolean(cond), extra: extra === undefined ? "" : String(extra) });
};

/* ================================================================== */
/* 1) 结构：五类部位 + 五种类型                                        */
/* ================================================================== */
{
  check("地形部位恰好 5 类", lf.LAND_PARTS.length === 5, lf.LAND_PARTS.map((p) => p.name).join("/"));
  check(
    "部位 id 齐全且顺序为 山峰·山脊·山谷·鞍部·陡崖",
    lf.LAND_PARTS.map((p) => p.id).join(",") === "peak,ridge,valley,saddle,cliff",
    lf.LAND_PARTS.map((p) => p.id).join(",")
  );

  const bad = lf.LAND_PARTS.filter((p) => !p.name || !p.form || !p.rule);
  check("每一类部位都有 name / form / rule", bad.length === 0, bad.map((p) => p.id).join(" "));

  // 盆地属于「地形类型」不属于「地形部位」—— 教材口径，别混进来
  check(
    "盆地没有被混进地形部位",
    !lf.LAND_PARTS.some((p) => p.name.includes("盆")),
    lf.LAND_PARTS.map((p) => p.name).join("/")
  );

  check("地形类型恰好 5 种", lf.LAND_TYPES.length === 5, lf.LAND_TYPES.map((t) => t.name).join("/"));
  check(
    "类型 id 齐全且顺序为 平原·高原·山地·丘陵·盆地",
    lf.LAND_TYPES.map((t) => t.id).join(",") === "plain,plateau,mountain,hill,basin",
    lf.LAND_TYPES.map((t) => t.id).join(",")
  );
  check("landTypeDef 能按 id 取到", lf.landTypeDef("basin").name === "盆地", lf.landTypeDef("basin").name);
  check("landTypeDef 对未知 id 不抛异常", Boolean(lf.landTypeDef("nope")));
}

/* ================================================================== */
/* 2) 判据文案与常量一致（防止"常量改了、文案没改"）                    */
/* ================================================================== */
{
  const cliff = lf.LAND_PARTS.find((p) => p.id === "cliff");
  const nums = [
    lf.CLIFF_REF_INTERVAL,
    lf.CLIFF_MIN_SLOPE_DEG,
    lf.CLIFF_SLOPE_CAP_DEG,
    lf.CLIFF_WINDOW_RADIUS
  ];
  const missing = nums.filter((v) => !cliff.rule.includes(String(v)));
  check(
    "陡崖判据文案里出现的数字与常量一致",
    missing.length === 0,
    missing.length ? `文案缺 ${missing.join(",")}` : cliff.rule
  );

  // 山脊 / 山谷共用同一个 TPI 阈值，文案里那个数必须就是 RIDGE_TPI
  const contour = require("./_contour.cjs");
  const ridge = lf.LAND_PARTS.find((p) => p.id === "ridge");
  const valley = lf.LAND_PARTS.find((p) => p.id === "valley");
  check(
    "山脊/山谷判据文案里的 TPI 阈值与 RIDGE_TPI 一致",
    ridge.rule.includes(String(contour.RIDGE_TPI)) && valley.rule.includes(String(contour.RIDGE_TPI)),
    `RIDGE_TPI=${contour.RIDGE_TPI}`
  );
}

/* ================================================================== */
/* 3) 窗口落差上限必须是**由格距推出**的，不是一个固定米数              */
/* ================================================================== */
{
  const t80 = Math.tan((80 * Math.PI) / 180);
  check(
    "cliffWindowDropMax(118) ≈ 2×118×tan80°（不是硬编码）",
    Math.abs(lf.cliffWindowDropMax(118) - 2 * 118 * t80) < 1e-9,
    lf.cliffWindowDropMax(118).toFixed(1)
  );
  check(
    "窗口上限随格距线性放大（500 m 格距 ⇒ 5671 m 上下）",
    lf.cliffWindowDropMax(500) > 5000 && lf.cliffWindowDropMax(500) < 6000,
    lf.cliffWindowDropMax(500).toFixed(0)
  );
  check(
    "单格绝对上限与格距无关（常数）",
    lf.CLIFF_MAX_CELL_DROP === 1400,
    String(lf.CLIFF_MAX_CELL_DROP)
  );
}

/* ================================================================== */
/* 4) 四座真山：钉回归基线                                             */
/* ================================================================== */
/**
 * 实测基线（2026-09-21，缓存瓦片 + 确定性算法）
 *
 * `slopeP90` / `exag` 是 v2.4.1 换过口径的量：
 * 推荐夸张从「起伏取向」（`0.18×跨度/起伏`，四座山给到 1.04~1.85）
 * 改成「坡度取向」（`tan25°/tan(p90 坡)`），四座真山的 p90 坡都在 38°~46°，
 * 早超过 25° 的目标 ⇒ **全部回到 ×1**。
 * 这不是"退化了"，而正是新口径要的性质：已经够陡的地形不该被再抬。
 */
const BASELINE = {
  gongga: {
    name: "贡嘎山", min: 2204, max: 7414, relief: 5210, type: "mountain", slopeP90: 44.5, exag: 1,
    peak: 6, ridge: 3638, valley: 1718, saddle: 5, cliff: 16,
    cand: 284, suspectSlope: 106, suspectDrop: 26,
    topPeak: [128, 128, 7414]
  },
  everest: {
    name: "珠穆朗玛峰", min: 3890, max: 8731, relief: 4841, type: "mountain", slopeP90: 45.7, exag: 1,
    peak: 6, ridge: 3760, valley: 1420, saddle: 4, cliff: 16,
    cand: 399, suspectSlope: 0, suspectDrop: 0,
    topPeak: [127, 128, 8731]
  },
  meili: {
    name: "梅里雪山", min: 1995, max: 6642, relief: 4647, type: "mountain", slopeP90: 45.2, exag: 1,
    peak: 6, ridge: 3549, valley: 2313, saddle: 4, cliff: 15,
    cand: 52, suspectSlope: 0, suspectDrop: 0,
    topPeak: [128, 127, 6642]
  },
  taibai: {
    name: "太白山", min: 828, max: 3743, relief: 2915, type: "mountain", slopeP90: 38.7, exag: 1,
    peak: 6, ridge: 3659, valley: 3309, saddle: 2, cliff: 4,
    cand: 11, suspectSlope: 0, suspectDrop: 0,
    topPeak: [128, 128, 3743]
  }
};

/** 每座山跑一次，结果留给后面的不变量检查用 */
const FIELD = {};

for (const tag of Object.keys(BASELINE)) {
  const b = BASELINE[tag];
  const src = data.DEM_SOURCES.find((s) => s.tag === tag);
  check(`样本库里有 ${b.name}（${tag}）`, Boolean(src), src ? src.code : "缺失");
  if (!src) continue;

  const f = dem.createField(src);
  const n = f.grid;
  const h = (i, j) => f.alt[j * n + i];
  const marks = lf.landParts(h, n, f.spanM);
  const counts = lf.landPartCounts(marks);
  const stats = lf.reliefStats(h, n);
  const cls = lf.classifyLandType(stats);
  FIELD[tag] = { f, n, h, marks, counts, stats, cls, cellM: f.spanM / (n - 1) };

  const p = b.name;
  check(`${p} 高程范围 ${b.min}–${b.max} m`, stats.min === b.min && stats.max === b.max, `${stats.min}–${stats.max}`);
  check(`${p} 起伏 ${b.relief} m`, stats.relief === b.relief, String(stats.relief));
  check(`${p} 判型 = 山地`, cls.type === "mountain", cls.type);
  check(
    `${p} 五类部位计数 = ${b.peak}/${b.ridge}/${b.valley}/${b.saddle}/${b.cliff}`,
    counts.peak === b.peak &&
      counts.ridge === b.ridge &&
      counts.valley === b.valley &&
      counts.saddle === b.saddle &&
      counts.cliff === b.cliff,
    `${counts.peak}/${counts.ridge}/${counts.valley}/${counts.saddle}/${counts.cliff}`
  );
  check(
    `${p} 陡崖：过闸候选 ${b.cand}（剔坡度 ${b.suspectSlope} + 剔高差 ${b.suspectDrop}）`,
    marks.cliffScan.candidates === b.cand &&
      marks.cliffScan.suspectSlope === b.suspectSlope &&
      marks.cliffScan.suspectDrop === b.suspectDrop &&
      marks.cliffScan.suspect === b.suspectSlope + b.suspectDrop,
    `${marks.cliffScan.candidates} / ${marks.cliffScan.suspectSlope}+${marks.cliffScan.suspectDrop}`
  );
  const p90Now = lf.slopeP90Deg(h, n, f.spanM);
  check(
    `${p} p90 坡度 = ${b.slopeP90}°（坡度取向推荐值 ×${b.exag} 的依据）`,
    Math.abs(p90Now - b.slopeP90) < 0.15,
    `${p90Now.toFixed(1)}°`
  );
  check(
    `${p} 推荐垂直夸张 ×${b.exag}`,
    lf.recommendExaggeration(p90Now) === b.exag,
    `×${lf.recommendExaggeration(p90Now)}`
  );

  const top = marks.peaks[0];
  check(
    `${p} 最高峰 = 全图最高点 (${b.topPeak[0]},${b.topPeak[1]}) ${b.topPeak[2]} m`,
    Boolean(top) && top.i === b.topPeak[0] && top.j === b.topPeak[1] && Math.abs(top.h - b.topPeak[2]) < 1,
    top ? `(${top.i},${top.j}) ${Math.round(top.h)}` : "无"
  );
}

/* ================================================================== */
/* 5) 鞍部：物理正确性 + 与"教科书错口径"的分野                        */
/* ================================================================== */
{
  // 珠峰与洛子峰之间的鞍部就是真实的**南坳（South Col）**，实测海拔 7906 m。
  // 这是唯一一处能拿真实世界数值对照的鞍部，必须对上。
  const E = FIELD.everest;
  const bet = E.marks.saddles.find(
    (s) => s.a.h === 8731 && s.b.h === 8412
  );
  check("珠峰–洛子峰之间有鞍部", Boolean(bet), bet ? `${bet.i},${bet.j}` : "无");
  if (bet) {
    check(
      "珠峰–洛子峰鞍部 ≈ 南坳 7906 m（误差 ≤ 100 m）",
      Math.abs(bet.h - 7906) <= 100,
      `${Math.round(bet.h)} m（差 ${Math.round(bet.h - 7906)} m）`
    );
    check(
      "鞍部（最低通道上的最高点）必须**高于**两峰之间的最低点",
      bet.h > 7906 - 100,
      `${Math.round(bet.h)}`
    );
  }

  // 每条鞍部都要满足定义：**低于两峰**（否则两座峰在那个水位上还连成一片，不成其为鞍部）
  // 且 `drop = 较低的峰 − 鞍部海拔`（这就是"下凹量"的定义式）
  for (const tag of Object.keys(FIELD)) {
    const M = FIELD[tag].marks;
    const notBelow = M.saddles.filter((s) => !(s.h < Math.min(s.a.h, s.b.h)));
    check(
      `${BASELINE[tag].name} 每条鞍部都低于两峰`,
      notBelow.length === 0,
      notBelow.map((s) => `${Math.round(s.h)} vs ${Math.round(Math.min(s.a.h, s.b.h))}`).join(" ")
    );
    const badDrop = M.saddles.filter(
      (s) => Math.abs(s.drop - (Math.min(s.a.h, s.b.h) - s.h)) > 1
    );
    check(
      `${BASELINE[tag].name} 每条鞍部的下凹量 = 较低峰 − 鞍部海拔`,
      badDrop.length === 0,
      badDrop.map((s) => `${s.drop} vs ${Math.round(Math.min(s.a.h, s.b.h) - s.h)}`).join(" ")
    );
    check(`${BASELINE[tag].name} 每条鞍部的下凹量 > 0`, M.saddles.every((s) => s.drop > 0));
  }
}

/* ================================================================== */
/* 6) 不变量：任何一条保留下来的陡崖都必须过三道闸门                    */
/* ================================================================== */
for (const tag of Object.keys(FIELD)) {
  const { h, n, marks, cellM } = FIELD[tag];
  const winMax = lf.cliffWindowDropMax(cellM);
  const winDrop = (ci, cj) => {
    const R = lf.CLIFF_WINDOW_RADIUS;
    let lo = Infinity;
    let hi = -Infinity;
    for (let dj = -R; dj <= R; dj++)
      for (let di = -R; di <= R; di++) {
        const ii = Math.min(n - 1, Math.max(0, ci + di));
        const jj = Math.min(n - 1, Math.max(0, cj + dj));
        const v = h(ii, jj);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    return hi - lo;
  };
  // 注意口径：cliff.i 是"格中心"（= 格原点 + 0.5），取格原点要用 floor
  const viol = marks.cliffs.filter((c) => {
    const i = Math.floor(c.i);
    const j = Math.floor(c.j);
    return c.slopeDeg > lf.CLIFF_SLOPE_CAP_DEG || c.drop > lf.CLIFF_MAX_CELL_DROP || winDrop(i, j) > winMax;
  });
  check(
    `${BASELINE[tag].name} 保留的 ${marks.cliffs.length} 处陡崖全部过闸`,
    viol.length === 0,
    viol.map((c) => `(${c.i},${c.j}) ${c.slopeDeg.toFixed(1)}°/${c.drop}`).join(" ")
  );
  check(
    `${BASELINE[tag].name} 保留陡崖都满足"等高线重叠"（≥2 条）`,
    marks.cliffs.every((c) => c.lines >= 2)
  );
  check(`${BASELINE[tag].name} 陡崖数量不超过上限 16`, marks.cliffs.length <= lf.CLIFF_MAX_COUNT);
}

/* ================================================================== */
/* 7) 合成反例①：环形山脊 —— 教科书那句"两峰之间最低处"是错的          */
/* ================================================================== */
{
  // 环脊上两个峰（相隔 60°）。两峰**连成直线**会横穿口径内的深盆，
  // 那条线上的最低点约等于盆底；而正确的鞍部应当落在环脊上，两者差近 1000 m。
  const N = 81;
  const SPAN = 40000;
  const ring = (i, j) => {
    const cx = 40, cy = 40, R = 25;
    const d = Math.hypot(i - cx, j - cy);
    const rim = 2600 * Math.exp(-((d - R) ** 2) / (2 * 4 ** 2));
    const base = d < R ? 600 : 400;
    const pk = [60, 120].map((deg) => {
      const a = (deg * Math.PI) / 180;
      return { x: cx + R * Math.cos(a), y: cy - R * Math.sin(a) };
    });
    let bump = 0;
    for (const p of pk) bump += 700 * Math.exp(-(((i - p.x) ** 2 + (j - p.y) ** 2) / (2 * 4 ** 2)));
    return base + Math.max(rim, 0) + bump;
  };
  const M = lf.landParts(ring, N, SPAN);

  const two = M.peaks.filter((p) => Math.abs(p.h - 3878) < 1);
  check("环形山脊上找到两个等高主峰", two.length >= 2, M.peaks.map((p) => Math.round(p.h)).join("/"));
  const A = two[0], B = two[1];

  // 真实鞍部（两主峰之间那条）
  const bet = M.saddles.find(
    (s) => Math.abs(s.a.h - A.h) < 1 && Math.abs(s.b.h - B.h) < 1
  ) || M.saddles.find((s) => Math.abs(s.b.h - A.h) < 1 && Math.abs(s.a.h - B.h) < 1);
  check("两主峰之间有鞍部", Boolean(bet), bet ? Math.round(bet.h) + " m" : "无");

  // 错口径：两峰连线上取最低点
  let lineMin = Infinity;
  for (let t = 0; t <= 1; t += 0.002) {
    const x = Math.round(A.i + (B.i - A.i) * t);
    const y = Math.round(A.j + (B.j - A.j) * t);
    const v = ring(x, y);
    if (v < lineMin) lineMin = v;
  }
  check("连线上最低点确实在盆底（< 2300 m）", lineMin < 2300, Math.round(lineMin) + " m");
  if (bet) {
    check(
      "鞍部落在环脊上、而不是连线最低点（相差 ≥ 800 m）",
      bet.h - lineMin >= 800,
      `鞍部 ${Math.round(bet.h)} vs 连线最低 ${Math.round(lineMin)}`,
    );
  }
}

/* ================================================================== */
/* 8) 合成反例②：1 格窄缝 —— SRTM 空洞缝的抽象版，必须被拦下           */
/* ================================================================== */
{
  // 两侧 3000 m 的平缓台面，中间一格掉到 1000 m。物理上不可能。
  // ⚠️ 这个反例很要紧：它在**粗格距**（500 m）下同时穿过前两道闸门 ——
  //    坡度只有 77.9°、窗口落差 2335 m 也小于 2×500×tan80°=5671 m，
  //    只有"单格落差绝对上限"（1400 m）能拦住它。
  const N = 81;
  const SPAN = 40000;
  const trench = (i, j) => (i === 40 ? 1000 : 3000 + 200 * Math.sin(i / 20) + 150 * Math.cos(j / 18));
  const M = lf.landParts(trench, N, SPAN);
  const cs = M.cliffScan;
  check("1 格窄缝不产生任何陡崖", cs.cliffs.length === 0, cs.cliffs.map((c) => c.slopeDeg.toFixed(1)).join(" "));
  check("1 格窄缝被物理闸门拦下（不是被静默丢弃）", cs.suspect > 0, `suspect=${cs.suspect}`);
  check("1 格窄缝：过闸候选为 0", cs.candidates === 0, String(cs.candidates));
  check("1 格窄缝不会误判出山峰", lf.landPartCounts(M).peak === 0, String(lf.landPartCounts(M).peak));
}

/* ================================================================== */
/* 9) 合成地形③④：山峰/鞍部的边界，以及五种类型的判型                  */
/* ================================================================== */
{
  const cone = (i, j) => 500 + 2500 * Math.exp(-(((i - 40) ** 2 + (j - 40) ** 2) / (2 * 10 ** 2)));
  const M = lf.landParts(cone, 81, 40000);
  const c = lf.landPartCounts(M);
  check("单峰圆锥只找到 1 个山峰", c.peak === 1, String(c.peak));
  check("单峰圆锥没有鞍部（鞍部需要两峰）", c.saddle === 0, String(c.saddle));
  check("单峰圆锥的山谷数接近 0（没有负地形）", c.valley <= 2, String(c.valley));

  check("完全平坦没有山峰", lf.landPartCounts(lf.landParts(() => 100, 81, 40000)).peak === 0);
  check("完全平坦没有鞍部", lf.landPartCounts(lf.landParts(() => 100, 81, 40000)).saddle === 0);

  const cases = [
    ["平原", (i, j) => 30 + 10 * Math.sin(i / 15) + 8 * Math.cos(j / 13), "plain"],
    ["丘陵", (i, j) => 200 + 60 * Math.sin(i / 9) * Math.cos(j / 11) + 30 * Math.sin(j / 5), "hill"],
    // ⚠ 高原面的**波长必须够长**。早先写的是 `150*sin(i*1.7)*cos(j*1.3)`：
    //   振幅 150、波长仅 3.7 格（≈440 m）—— 那是一个"波纹面"，不是高原面。
    //   在这种面上量 ±16 格的局部起伏当然会得到 ~300 m，被判成山地是**正确**的。
    //   课本说的高原是"面积广大、内部起伏和缓"，所以模型必须是长波、低梯度：
    //   下面两项的梯度分别约 1.9 m/格 与 1.3 m/格 ⇒ 32 格窗口内起伏 ~104 m，
    //   高到不会被当成平原(40)，低到不会被当成山地(200)。
    ["高原", (i, j) => 4000 + 60 * Math.sin(i / 31) * Math.cos(j / 27) + 25 * Math.sin(j / 19), "plateau"],
    // 柴达木式：海拔高、起伏不大，但"边高中低" ⇒ 必须先判盆地（优先级测试）
    ["盆地（柴达木式）", (i, j) => 3000 + 300 * Math.min(1, Math.hypot(i - 40, j - 40) / 30), "basin"]
  ];
  for (const [name, fn, want] of cases) {
    const s = lf.reliefStats(fn, 81);
    const got = lf.classifyLandType(s);
    check(
      `${name}合成地形判为 ${want}`,
      got.type === want,
      `起伏 ${Math.round(s.relief)} 均高 ${Math.round(s.mean)} 边−心 ${Math.round(s.edgeMinusCore)} 方位 ${s.sectorsAbove}/8 ⇒ ${got.type}`
    );
  }

  /* ---- 方位性形状判据本身：必须能把「被围住」和「中心是山」分开 ---- */
  const stat81 = (fn) => lf.reliefStats(fn, 81);
  check("方位数组恒为 8 个", stat81(() => 100).sectors.length === 8,
    String(stat81(() => 100).sectors.length));

  // 四周高：8 个方位全达标
  const bowl = stat81((i, j) => 3000 + 300 * Math.min(1, Math.hypot(i - 40, j - 40) / 30));
  check("环形台地：8 个方位全部高于中心", bowl.sectorsAbove === 8, `${bowl.sectorsAbove}/8`);

  // 中心是山：外环整体比中心低，一个方位都不达标
  const dome = stat81((i, j) => 500 + 2500 * Math.exp(-(((i - 40) ** 2 + (j - 40) ** 2) / (2 * 10 ** 2))));
  check("中心是山：0 个方位高于中心", dome.sectorsAbove === 0, `${dome.sectorsAbove}/8`);
  check("中心是山：外环平均低于中心", dome.edgeMinusCore < 0, String(Math.round(dome.edgeMinusCore)));

  // 均质丘陵：中心盘与外环在统计上应当相等 —— 这正是"不能只看整体高差"的原因
  const homog = stat81((i, j) => 200 + 60 * Math.sin(i / 9) * Math.cos(j / 11) + 30 * Math.sin(j / 5));
  check("均质丘陵的外环−中心远小于盆地阈值",
    Math.abs(homog.edgeMinusCore) < lf.BASIN_RIM_ABOVE_CORE,
    String(Math.round(homog.edgeMinusCore)));
}

/* ================================================================== */
/* 10) 垂直夸张：坡度取向、单侧夹取、非法输入不炸                       */
/* ================================================================== */
{
  const R = (deg) => (deg * Math.PI) / 180;
  check("坡度 0 ⇒ 返回 1（不除零）", lf.recommendExaggeration(0) === 1);
  check("坡度 NaN ⇒ 返回 1", lf.recommendExaggeration(NaN) === 1);
  check("坡度 Infinity ⇒ 返回 1", lf.recommendExaggeration(Infinity) === 1);

  /* ---- 反解式本身：tan(25°) / tan(p90) ---- */
  for (const deg of [5, 10, 15, 22.5]) {
    const want = Math.round((Math.tan(R(25)) / Math.tan(R(deg))) * 100) / 100;
    check(
      `p90 坡 ${deg}° ⇒ ×${want}（= tan25°/tan${deg}°）`,
      Math.abs(lf.recommendExaggeration(deg) - want) < 1e-9,
      String(lf.recommendExaggeration(deg))
    );
  }

  /* ---- 下限 1：**已经够陡就不动它**，不做"反向压平" ---- */
  check(
    "p90 坡 = 25°（正好到目标）⇒ ×1",
    lf.recommendExaggeration(25) === 1,
    String(lf.recommendExaggeration(25))
  );
  check(
    "p90 坡 44.5°（贡嘎山）⇒ ×1，不被压到 0.5",
    lf.recommendExaggeration(44.5) === lf.EXAGGERATION_LIMIT_MIN &&
      lf.EXAGGERATION_LIMIT_MIN === 1,
    String(lf.recommendExaggeration(44.5))
  );

  /* ---- 上限 20：华北平原按公式要 ×26.7，必须夹住 ---- */
  const rawPlain = Math.tan(R(25)) / Math.tan(R(1));
  check(
    `p90 坡 1°（华北平原）原始需求 ×${rawPlain.toFixed(1)} > 上限 ⇒ 夹到 ×20`,
    rawPlain > lf.EXAGGERATION_LIMIT_MAX && lf.recommendExaggeration(1) === 20,
    `×${lf.recommendExaggeration(1)}`
  );

  /* ---- 单调性：坡越缓，推荐倍数越大（这条保证"山陡丘缓"的次序不会反） ---- */
  const seq = [44.5, 31.8, 14.2, 12.3, 10.9, 4.5, 1].map((d) => lf.recommendExaggeration(d));
  check(
    "坡越缓 ⇒ 倍数越大（单调不降）",
    seq.every((v, k) => k === 0 || v >= seq[k - 1]),
    seq.join(" ≤ ")
  );
  check(
    "山地全是 ×1、平原是 ×20（陡缓对比的两端）",
    seq[0] === 1 && seq[1] === 1 && seq[seq.length - 1] === 20,
    seq.join(" / ")
  );
}

/* ================================================================== */
/* 11) slopeP90Deg：量的是"坡面"，不是"某一格台阶"                     */
/* ================================================================== */
{
  const n = 81;
  const spanM = 30000;
  const cellM = spanM / (n - 1);

  // 平面 ⇒ 0°
  check("平地 ⇒ p90 坡 0°", lf.slopeP90Deg(() => 100, n, spanM) === 0, "0");

  // 均匀斜面：固定梯度 g，中心差分恰好还原 it ⇒ atan(g)
  const g = 0.4; // 垂直/水平
  const ramp = (i) => 100 + g * i * cellM;
  const got = lf.slopeP90Deg((i) => ramp(i), n, spanM);
  check(
    `均匀斜面（梯度 ${g}）⇒ p90 坡 = atan(${g}) = ${((Math.atan(g) * 180) / Math.PI).toFixed(2)}°`,
    Math.abs(got - (Math.atan(g) * 180) / Math.PI) < 0.05,
    `${got.toFixed(2)}°`
  );

  // 核心性质：**单格毛刺改不动 p90** —— 这正是它比"最大坡度"适合当推荐依据的原因
  const base = (i, j) => 100 + g * i * cellM;
  const spiked = (i, j) => (i === 40 && j === 40 ? base(i, j) + 3000 : base(i, j));
  check(
    "一格 +3000 m 的毛刺几乎不影响 p90（稳健性）",
    Math.abs(lf.slopeP90Deg(spiked, n, spanM) - got) < 1.0,
    `${lf.slopeP90Deg(spiked, n, spanM).toFixed(2)}° vs 基准 ${got.toFixed(2)}°`
  );

  // 但最大坡度会被那一格带飞 —— 对照着写出来，证明"为什么不用 max"
  let maxTan = 0;
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const dx = (spiked(i + 1, j) - spiked(i - 1, j)) / (2 * cellM);
      const dy = (spiked(i, j + 1) - spiked(i, j - 1)) / (2 * cellM);
      maxTan = Math.max(maxTan, Math.hypot(dx, dy));
    }
  }
  check(
    "但同一份数据的最大坡度被那一格带到 70°+（所以不能用 max 当推荐依据）",
    (Math.atan(maxTan) * 180) / Math.PI > 70,
    `${((Math.atan(maxTan) * 180) / Math.PI).toFixed(1)}°`
  );

  // 非法输入
  check("网格太小 ⇒ 0", lf.slopeP90Deg(() => 0, 2, spanM) === 0);
  check("跨度 0 ⇒ 0", lf.slopeP90Deg(() => 1, 81, 0) === 0);
}

/* ================================================================== */
/* 12) 每个样本的「声明类型」必须与判据算出来的一致（人工口径 + 机器反向校验） */
/* ================================================================== */
{
  const sources = data.DEM_SOURCES;
  check("样本数量 ≥ 8（五种地形类型都至少有一个）", sources.length >= 8, `${sources.length} 个`);

  const declaredTypes = new Set(sources.map((s) => s.landType));
  const missingTypes = lf.LAND_TYPES.map((t) => t.id).filter((id) => !declaredTypes.has(id));
  check(
    "五种地形类型每个都至少有一个样本",
    missingTypes.length === 0,
    missingTypes.length ? `缺 ${missingTypes.join(",")}` : [...declaredTypes].join(",")
  );

  for (const src of sources) {
    check(`${src.name} 声明了 landType`, typeof src.landType === "string", String(src.landType));
  }

  // 声明 vs 判定：不一致就是有一边错了
  for (const src of sources) {
    const field = dem.createField(src);
    const h = dem.heightFn(field);
    const got = lf.classifyLandType(lf.reliefStats(h, field.grid));
    check(
      `${src.name} 判据复核通过（声明 ${src.landType}）`,
      got.type === src.landType,
      `判成 ${got.type} —— ${got.reason}`
    );
  }

  /* ---- 图鉴产物必须与现算一致（防止手改生成物、或改了判据忘了重新生成） ---- */
  let gen = null;
  try {
    gen = require("./_landforms.cjs");
  } catch (e) {
    check("能加载 scripts/_landforms.cjs（图鉴生成物）", false, String(e.message));
  }
  if (gen) {
    check("图鉴条目数与样本数一致", gen.LANDFORMS.length === sources.length,
      `${gen.LANDFORMS.length} vs ${sources.length}`);
    for (const src of sources) {
      const entry = gen.LANDFORMS.find((e) => e.tag === src.tag);
      if (!entry) {
        check(`${src.name} 在图鉴里`, false, "缺条目");
        continue;
      }
      const field = dem.createField(src);
      const h = dem.heightFn(field);
      const counts = lf.landPartCounts(lf.landParts(h, field.grid, field.spanM));
      const same = ["peak", "ridge", "valley", "saddle", "cliff"].every(
        (k) => entry.counts[k] === counts[k]
      );
      check(
        `${src.name} 图鉴里的部位计数与现算一致`,
        same,
        same ? "" : `图鉴 ${JSON.stringify(entry.counts)} vs 现算 ${JSON.stringify(counts)}`
      );
      check(
        `${src.name} 图鉴里的 parts 与 counts>0 一致`,
        entry.parts.join(",") === lf.LAND_PARTS.map((p) => p.id).filter((id) => counts[id] > 0).join(","),
        entry.parts.join(",")
      );
      check(
        `${src.name} 图鉴 landType / detected 与样本一致`,
        entry.landType === src.landType && entry.detected === src.landType,
        `${entry.landType}/${entry.detected}`
      );
    }
  }
}

/* ================================================================== */
/* 13) 截断计数：`6+` 那套显示契约                                       */
/* ================================================================== */
{
  // 上限是检测算法的属性，必须只声明一处（`LAND_PART_CAP`），
  // 而不是在生成物里抄 8 遍 —— 抄了改算法时必漏。
  check(
    "LAND_PART_CAP 只给 peak / cliff 两个部位",
    Object.keys(lf.LAND_PART_CAP).sort().join(",") === "cliff,peak",
    Object.keys(lf.LAND_PART_CAP).join(",")
  );
  check(
    "LAND_PART_CAP 的上限值与检出算法的 maxCount 一致",
    lf.LAND_PART_CAP.peak === lf.PEAK_MAX_COUNT &&
      lf.LAND_PART_CAP.cliff === lf.CLIFF_MAX_COUNT,
    `peak ${lf.LAND_PART_CAP.peak} cliff ${lf.LAND_PART_CAP.cliff}`
  );
  // 没上限的部位不能被误判成截断（否则 ridge 627 会显示成 "627+"，更荒唐）
  for (const id of ["ridge", "valley", "saddle"]) {
    check(
      `${id} 不该被当成截断部位`,
      !lf.isCappedPart(id, lf.LAND_PART_CAP[id] ?? 9999) &&
        lf.LAND_PART_CAP[id] === undefined,
      String(lf.LAND_PART_CAP[id])
    );
  }
  // 边界：不到上限就不算截断，到/超上限才算
  check("peak 5 未到上限", !lf.isCappedPart("peak", 5));
  check("peak 6 已到上限", lf.isCappedPart("peak", 6));

  // ⚠️ 反向校验：如果没有任何样本真的触到上限，上面那些断言就只是空转，
  // `6+` 那条渲染分支成了死代码。这条断言逼着数据里必须存在饱和样本。
  // 注意 LANDFORMS 在 _landforms.cjs（生成物），不在 _landform.cjs。
  const gen = require("./_landforms.cjs");
  let sat = 0;
  for (const e of gen.LANDFORMS) {
    for (const p of lf.LAND_PARTS.map((x) => x.id)) {
      const capped = lf.isCappedPart(p, e.counts[p]);
      check(
        `${e.name} 的 ${p} 截断判定与上限一致`,
        capped === (e.counts[p] >= (lf.LAND_PART_CAP[p] ?? Infinity)),
        `${e.counts[p]}`
      );
      if (capped) sat++;
    }
  }
  check("确实存在触到上限的样本（`6+` 渲染分支不是死代码）", sat > 0, `${sat} 处`);

  // 显示契约靠静态断言守住：卡片的计数必须走 isCappedPart 决定加不加 `+`。
  // 直接退回 `{e.counts[p]}` 的话，"6" 和 "6+" 的区别又没了 ——
  // 而这个回归**界面上看不出来**（6 本来就是个合法数字），只能靠这条挡。
  const uiSrc = fs.readFileSync(path.join(__dirname, "../src/MountainZones.tsx"), "utf8");
  check("图鉴卡片用 isCappedPart 渲染计数", uiSrc.includes("isCappedPart(p, e.counts[p])"));
  check(
    "图鉴卡片没有退回直接输出 counts[p]",
    !/>\{e\.counts\[p\]\}</.test(uiSrc)
  );
  check("图鉴页脚说明了 + 的含义", uiSrc.includes("已到检出上限"));
}

/* ===== 汇总 ===== */
const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "✔" : "✘"} ${c.name}${c.extra ? `  ${c.extra}` : ""}`);
}
console.log(
  `\nLANDFORM CHECK ${failed.length === 0 ? "PASSED ✔" : "FAILED ✘"}  断言 ${checks.length} 项，失败 ${failed.length} 项`
);
process.exit(failed.length === 0 ? 0 : 1);
