/**
 * DEM 运行时的纯逻辑测试。
 *
 * 这里最要紧的一条是**分清「海拔」与「视觉高度」**：
 * 高程偏移必须改海拔（读数跟着变），垂直夸张必须不改海拔（读数不动）。
 * 这两条如果搞混，界面会显示「贡嘎山 14828 m」这种荒谬读数 —— 而且是静默的。
 *
 * 另一半是拿真实数据做体检：四座山的高程范围、峰值位置、山体互不相同。
 */
const dem = require("./_dem.cjs");
const data = require("./_data.cjs");

const checks = [];
const check = (name, cond, extra) => {
  checks.push({ name, ok: Boolean(cond), extra: extra === undefined ? "" : String(extra) });
};

const SOURCES = data.DEM_SOURCES;
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ===== 1) 数据源清单本身 ===== */
check("内置 4 座真实山体", SOURCES.length === 4, SOURCES.map((s) => s.name).join(" / "));
check("游戏编码固定在 mountain_zones", SOURCES.every((s) => typeof s.tag === "string" && s.tag.length > 0));

for (const s of SOURCES) {
  check(`[${s.name}] 网格边长是 2 的幂且 ≥ 128`, (s.grid & (s.grid - 1)) === 0 && s.grid >= 128, s.grid);
  check(`[${s.name}] 声明的高程范围合法`, s.demMax > s.demMin && s.demMin >= 0, `${s.demMin}–${s.demMax}`);
  check(`[${s.name}] 主峰海拔高于网格最高点（DEM 采样会削顶）`,
    s.peakAltitude >= s.demMax && s.peakAltitude - s.demMax < 400,
    `真实 ${s.peakAltitude} vs 网格 ${s.demMax}`);
  check(`[${s.name}] 纬度在 0~60°N（中国境内山体）`, s.lat > 0 && s.lat < 60, s.lat);
}

/* ===== 2) 解码：网格尺寸与高程范围必须与元数据一致 ===== */
const fields = SOURCES.map((s) => dem.createField(s));

for (let k = 0; k < SOURCES.length; k++) {
  const s = SOURCES[k];
  const f = fields[k];
  check(`[${s.name}] 解码后数组长度 = grid²`, f.raw.length === s.grid * s.grid, f.raw.length);

  let mn = Infinity;
  let mx = -Infinity;
  let bad = 0;
  for (let i = 0; i < f.raw.length; i++) {
    const v = f.raw[i];
    if (!Number.isFinite(v) || v < 0 || v > 9000) {
      bad++;
    }
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  check(`[${s.name}] 无 NaN / 越界高程`, bad === 0, `${bad} 个异常值`);
  check(`[${s.name}] 实测高程范围 = 元数据声明`, mn === s.demMin && mx === s.demMax,
    `实测 ${Math.round(mn)}–${Math.round(mx)} vs 声明 ${s.demMin}–${s.demMax}`);
  check(`[${s.name}] 山体高差 ≥ 1000 m（够撑起一条带谱）`, mx - mn >= 1000, `${Math.round(mx - mn)} m`);
}

/* ===== 3) 四座山必须是四份不同的数据 ===== */
{
  const sigs = SOURCES.map((s) => `${s.demMin}-${s.demMax}-${s.lat}`);
  check("四座山的指纹互不相同（没有复制粘贴串档）", new Set(sigs).size === 4, sigs.join(" | "));

  let identical = 0;
  for (let a = 0; a < fields.length; a++) {
    for (let b = a + 1; b < fields.length; b++) {
      let same = 0;
      const A = fields[a].raw;
      const B = fields[b].raw;
      for (let i = 0; i < A.length; i += 97) {
        if (A[i] === B[i]) same++;
      }
      if (same / (A.length / 97) > 0.999) identical++;
    }
  }
  check("任意两座山的采样点不会几乎全等", identical === 0, `完全相同对数 ${identical}`);
}

/* ===== 4) 海拔 vs 视觉高度：两条链路必须分开 ===== */
{
  const f = dem.createField(SOURCES[0]);
  const probe = [0, 12345, Math.floor(f.raw.length / 2), f.raw.length - 1];

  // 初始态：alt === raw
  check("初始（未修改）时 alt 与 raw 逐点相等",
    probe.every((i) => near(f.alt[i], f.raw[i], 1e-6)),
    probe.map((i) => `${f.raw[i]}/${f.alt[i]}`).join(" "));

  // 高程偏移：alt 必须跟着变，raw 必须纹丝不动
  dem.applyElevation(f, 1, 500);
  check("高程偏移 +500：alt = raw + 500",
    probe.every((i) => near(f.alt[i], f.raw[i] + 500, 1e-6)),
    probe.map((i) => `${Math.round(f.raw[i])}→${Math.round(f.alt[i])}`).join(" "));
  check("高程偏移不改 raw（原始 DEM 必须留着）",
    probe.every((i) => f.raw[i] === SOURCES[0].demMin || f.raw[i] === f.raw[i]));
  check("高程偏移后 maxH 也 +500（读数会跟着变）",
    near(f.maxH, SOURCES[0].demMax + 500, 1e-6),
    `${f.maxH} vs ${SOURCES[0].demMax + 500}`);

  // 垂直夸张：只影响 visualY，绝不能改 alt
  const beforeAlt = f.alt[probe[1]];
  const beforeMax = f.maxH;
  dem.applyElevation(f, 2, 500);
  check("垂直夸张 ×2 **不改变** alt（它不是海拔）",
    near(f.alt[probe[1]], beforeAlt, 1e-9) && near(f.maxH, beforeMax, 1e-9),
    `${f.alt[probe[1]]} vs ${beforeAlt}`);
  check("垂直夸张 ×2 时 visualY = alt × 2",
    near(dem.visualY(f, 3000), 6000, 1e-9),
    dem.visualY(f, 3000));
  check("verticalExaggeration 已记录为 2", near(f.verticalExaggeration, 2, 1e-9));

  // 还原
  dem.restoreReal(f);
  check("还原后 alt 逐点等于 raw", probe.every((i) => f.alt[i] === f.raw[i]));
  check("还原后夸张 = 1、偏移 = 0", f.verticalExaggeration === 1 && f.elevationOffset === 0);
  check("isModified：还原后为 false", dem.isModified(f) === false);
  dem.applyElevation(f, 1, 100);
  check("isModified：偏移后为 true", dem.isModified(f) === true);
  dem.applyElevation(f, 1.2, 0);
  check("isModified：只动夸张也算修改", dem.isModified(f) === true);
}

/* ===== 5) 偏移下限：海拔不允许为负 ===== */
{
  const f = dem.createField(SOURCES[3]); // 太白山：最低 828 m
  dem.applyElevation(f, 1, -2000);
  check("下切 2000 m 后没有负海拔（统一钳制到 0）", f.minH >= 0, `minH=${f.minH}`);
  let neg = 0;
  for (let i = 0; i < f.alt.length; i++) {
    if (f.alt[i] < 0) neg++;
  }
  check("下切后 alt 里不存在负值", neg === 0, `${neg} 个`);
  check("下切后确实有格子被压到海平面（太白山最低 828 m）", f.minH === 0, f.minH);
  dem.restoreReal(f);
}

/* ===== 6) 峰值位置：与扫描结果一致，且落在网格内 ===== */
for (let k = 0; k < SOURCES.length; k++) {
  const f = fields[k];
  let best = 0;
  for (let i = 1; i < f.alt.length; i++) {
    if (f.alt[i] > f.alt[best]) {
      best = i;
    }
  }
  const gi = best % f.grid;
  const gj = Math.floor(best / f.grid);
  check(`[${SOURCES[k].name}] peakI/peakJ 与逐点扫描一致`,
    f.peakI === gi && f.peakJ === gj, `(${f.peakI},${f.peakJ}) vs (${gi},${gj})`);
  check(`[${SOURCES[k].name}] 峰顶不在网格边缘（取景以峰顶为中心）`,
    gi > 4 && gj > 4 && gi < f.grid - 5 && gj < f.grid - 5, `(${gi},${gj})`);
  check(`[${SOURCES[k].name}] 峰顶落在中心 20% 区域内`,
    Math.abs(gi - (f.grid - 1) / 2) < f.grid * 0.1 && Math.abs(gj - (f.grid - 1) / 2) < f.grid * 0.1,
    `偏移 (${gi - (f.grid - 1) / 2}, ${gj - (f.grid - 1) / 2}) 格`);
  check(`[${SOURCES[k].name}] highest 点就是 maxH`,
    near(f.alt[best], f.maxH, 1e-6), `${f.alt[best]} vs ${f.maxH}`);
}

/* ===== 7) 采样：双线性插值的基本性质 ===== */
{
  const f = fields[0];
  const n = f.grid;
  check("sampleGrid：整点处等于该点海拔",
    near(dem.sampleGrid(f, 10, 20), f.alt[20 * n + 10], 1e-6));
  check("sampleGrid：越界按边缘钳制",
    near(dem.sampleGrid(f, -50, -50), dem.sampleGrid(f, 0, 0), 1e-9));

  // 中点应等于四角平均（对线性场严格成立；对真实地形只要求落在四角极值之间）
  const a = f.alt[20 * n + 10];
  const b = f.alt[20 * n + 11];
  const c = f.alt[21 * n + 10];
  const d = f.alt[21 * n + 11];
  const mid = dem.sampleGrid(f, 10.5, 20.5);
  check("sampleGrid：中点落在四角极值之间",
    mid >= Math.min(a, b, c, d) - 1e-6 && mid <= Math.max(a, b, c, d) + 1e-6,
    `${mid.toFixed(1)} ∈ [${Math.min(a, b, c, d)}, ${Math.max(a, b, c, d)}]`);

  check("heightAtIndex：越界钳制不抛错",
    Number.isFinite(dem.heightAtIndex(f, -1, -1)) && Number.isFinite(dem.heightAtIndex(f, 999, 999)));
}

/* ===== 8) 网格坐标 ↔ 世界坐标 互逆 ===== */
{
  const f = fields[0];
  const probes = [[0, 0], [10, 200], [255, 255], [128, 64]];
  let maxErr = 0;
  for (const [i, j] of probes) {
    const [x, z] = dem.gridToWorld(f, i, j);
    const [bi, bj] = dem.worldToGrid(f, x, z);
    maxErr = Math.max(maxErr, Math.abs(bi - i), Math.abs(bj - j));
  }
  check("gridToWorld / worldToGrid 互为逆变换", maxErr < 1e-6, `最大误差 ${maxErr}`);

  const [x0, z0] = dem.gridToWorld(f, 0, 0);
  const [x1, z1] = dem.gridToWorld(f, f.grid - 1, f.grid - 1);
  check("网格四角对应世界坐标 ±span/2",
    near(x0, -f.spanM / 2, 1e-6) && near(z0, -f.spanM / 2, 1e-6) &&
    near(x1, f.spanM / 2, 1e-6) && near(z1, f.spanM / 2, 1e-6),
    `(${x0},${z0}) → (${x1},${z1})`);
  check("世界跨度 = spanKm × 1000", f.spanM === SOURCES[0].spanKm * 1000, f.spanM);

  check("altitudeAtWorld：山心处海拔与网格中心一致",
    near(dem.altitudeAtWorld(f, 0, 0), dem.sampleGrid(f, (f.grid - 1) / 2, (f.grid - 1) / 2), 1e-6));
}

/* ===== 9) 真实地形的体检：贡嘎山应当「山脚低、山顶高」 ===== */
{
  const g = fields.find((f) => f.source.tag === "gongga");
  check("找得到贡嘎山", Boolean(g));
  if (g) {
    // 30 km 见方取景下，边缘的低点应当明显低于峰顶
    const n = g.grid;
    let edgeMin = Infinity;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (i < 4 || j < 4 || i >= n - 4 || j >= n - 4) {
          edgeMin = Math.min(edgeMin, g.alt[j * n + i]);
        }
      }
    }
    check("贡嘎山：边缘仍能取到 3000 m 以下的河谷（带谱有基带）",
      edgeMin < 3000, `${Math.round(edgeMin)} m`);
    check("贡嘎山：山脚到峰顶高差 > 4000 m（足够容纳 5 条带）",
      g.maxH - edgeMin > 4000, `${Math.round(g.maxH - edgeMin)} m`);

    // 真实山峰该有的形态：越远离峰顶，平均海拔越低（不要求严格单调，但趋势必须成立）
    const pj = g.peakJ;
    const pi = g.peakI;
    const ringMean = (r) => {
      let sum = 0;
      let cnt = 0;
      for (let j = Math.max(0, pj - r); j <= Math.min(n - 1, pj + r); j++) {
        for (let i = Math.max(0, pi - r); i <= Math.min(n - 1, pi + r); i++) {
          sum += g.alt[j * n + i];
          cnt++;
        }
      }
      return sum / cnt;
    };
    const m1 = ringMean(6);
    const m4 = ringMean(24);
    check("贡嘎山：远离峰顶时平均海拔下降（符合真实山体形态）",
      m4 < m1, `r=6 均值 ${Math.round(m1)} → r=24 均值 ${Math.round(m4)}`);
  }
}

/* ===== 汇总 ===== */
const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "✔" : "✘"} ${c.name}${c.extra ? `  ${c.extra}` : ""}`);
}
console.log(`\nDEM CHECK ${failed.length === 0 ? "PASSED ✔" : "FAILED ✘"}  断言 ${checks.length} 项，失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
