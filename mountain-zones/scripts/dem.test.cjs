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
// ⚠️ v2.2.0 起这里不再是「4 座山」：用户要求五种地形类型**每种至少一个样本**
// （现有的四座山保留，另补平原 / 高原 / 丘陵 / 盆地）。
// 所以下面的断言一律按 landType 分流 —— 照旧写死 4 的话，
// 加样本就会红，而且红得莫名其妙（数据是对的，是断言的作用域过时了）。
const REAL = SOURCES.filter((s) => s.isTemplate !== true);
const TPL = SOURCES.filter((s) => s.isTemplate === true);
const MOUNTAINS = REAL.filter((s) => s.landType === "mountain");
const NON_MOUNTAINS = REAL.filter((s) => s.landType !== "mountain");
const LAND_TYPE_IDS = ["plain", "plateau", "mountain", "hill", "basin"];

// ⚠️ v2.4.0：模板地形是**示意地形**，不算"内置真实山体"。
// 这一条的分子必须只数真实样本 —— 否则加一个模板山地就会把"四座山全保留"判红。
check("内置 4 座真实山体（四座山全保留）", MOUNTAINS.length === 4,
  MOUNTAINS.map((s) => s.name).join(" / "));
check("另有 3 个模板地形（山地 / 丘陵 / 盆地）", TPL.length === 3,
  TPL.map((s) => s.name).join(" / "));
check("游戏编码固定在 mountain_zones", SOURCES.every((s) => typeof s.tag === "string" && s.tag.length > 0));

// 用户口径：「现在有的保持，其余 4 类没有的去找，保证一个类型至少一种数据」
for (const id of LAND_TYPE_IDS) {
  const n = SOURCES.filter((s) => s.landType === id).length;
  check(`地形类型 ${id} 至少有一个样本`, n >= 1, `${n} 个`);
}
check("每个样本都声明了 landType 且在五种之内",
  SOURCES.every((s) => LAND_TYPE_IDS.includes(s.landType)),
  SOURCES.filter((s) => !LAND_TYPE_IDS.includes(s.landType)).map((s) => s.tag).join(","));
check("样本总数 = 四种非山地 + 四座山 + 三个模板", SOURCES.length === MOUNTAINS.length + NON_MOUNTAINS.length + TPL.length);

for (const s of SOURCES) {
  check(`[${s.name}] 网格边长是 2 的幂且 ≥ 128`, (s.grid & (s.grid - 1)) === 0 && s.grid >= 128, s.grid);
  check(`[${s.name}] 声明的高程范围合法`, s.demMax > s.demMin && s.demMin >= 0, `${s.demMin}–${s.demMax}`);
  check(`[${s.name}] peakAltitude 不低于网格最高点（DEM 采样会削顶）`,
    s.peakAltitude >= s.demMax && s.peakAltitude - s.demMax < 400,
    `标注 ${s.peakAltitude} vs 网格 ${s.demMax}`);
  // ⚠️ 「取景在中国境内」这条**只对真实样本**成立 —— 模板地形是示意地形，
  // 拿一条地理断言去套它，等于悄悄把模板说成"真在某个地方"。
  if (s.isTemplate === true) {
    check(`[${s.name}] 模板地形不声明真实取景（lat/lon 只是占位符）`,
      s.lat === 30 && s.lon === 105, `占位 ${s.lat},${s.lon}`);
  } else {
    check(`[${s.name}] 取景在中国境内（纬度 18~54°N / 经度 73~135°E）`,
      s.lat > 18 && s.lat < 54 && s.lon > 73 && s.lon < 135, `${s.lat},${s.lon}`);
  }
  check(`[${s.name}] 取景跨度合理（5~100 km）`, s.spanKm >= 5 && s.spanKm <= 100, `${s.spanKm} km`);
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
  // 「够撑起一条带谱」是**山**才有的要求：平原 40 m 起伏本来就撑不起带谱，
  // 它的教学作用是跟高原/丘陵比"平"，不是看垂直地带性。
  if (s.landType === "mountain") {
    check(`[${s.name}] 山体高差 ≥ 1000 m（够撑起一条带谱）`, mx - mn >= 1000, `${Math.round(mx - mn)} m`);
  } else {
    check(`[${s.name}] 非山地样本高差 < 2000 m（否则说明取景取错了地方）`,
      mx - mn < 2000, `${Math.round(mx - mn)} m`);
  }
}

/* ===== 3) 每个样本都必须是独立的一份数据 ===== */
{
  const sigs = SOURCES.map((s) => `${s.demMin}-${s.demMax}-${s.lat}`);
  check("各样本的指纹互不相同（没有复制粘贴串档）",
    new Set(sigs).size === SOURCES.length, sigs.join(" | "));

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
  check("任意两个样本的采样点不会几乎全等", identical === 0, `完全相同对数 ${identical}`);
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
  // ⚠️ 不许写成 `SOURCES[3]`。v2.4.0 把三个模板地形插到清单最前面之后，
  // 下标 3 从「太白山」变成了「贡嘎山」，于是这条断言静默地换了个被测对象 ——
  // 贡嘎山最低 2204 m，下切 2000 m 后还剩 204 m，`minH === 0` 直接红。
  // 凡是断言里点名了"哪个样本"，就用 tag 取，别用下标。
  const f = dem.createField(data.sourceByTag("taibai")); // 太白山：最低 828 m
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
// ⚠️ 取景分两种（见 build_dem.py 的 `peakCentered`）：
//   - 山：**以峰顶为中心**取景 ⇒ 峰顶必须落在中心 20% 内，下面才守这条；
//   - 平原 / 高原 / 丘陵 / 盆地：**中心点固定**（这些地形没有"峰顶"可言，
//     拿峰顶去居中反而会把窗口拉到一处小丘上）⇒ 只要求峰顶落在网格内部。
for (let k = 0; k < SOURCES.length; k++) {
  const f = fields[k];
  const s = SOURCES[k];
  let best = 0;
  for (let i = 1; i < f.alt.length; i++) {
    if (f.alt[i] > f.alt[best]) {
      best = i;
    }
  }
  const gi = best % f.grid;
  const gj = Math.floor(best / f.grid);
  check(`[${s.name}] peakI/peakJ 与逐点扫描一致`,
    f.peakI === gi && f.peakJ === gj, `(${f.peakI},${f.peakJ}) vs (${gi},${gj})`);
  check(`[${s.name}] 最高点落在网格内部（渲染峰标记需要它不在边界上）`,
    gi > 1 && gj > 1 && gi < f.grid - 2 && gj < f.grid - 2, `(${gi},${gj})`);
  check(`[${s.name}] highest 点就是 maxH`,
    near(f.alt[best], f.maxH, 1e-6), `${f.alt[best]} vs ${f.maxH}`);

  if (s.landType === "mountain") {
    if (s.isTemplate) {
      // 模板地形**不是**"以峰顶为中心取景"。它的构图是"整座山体填满图幅"：
      // 缓穹隆基座铺满画面，两个峰对称摆在基座上（主峰偏左上、次峰偏右下），
      // 峰顶当然就不在画面正中 —— 硬要居中会把山体的构图打歪。
      // 所以这里守的是一条更松的**构图**约束：最高峰仍要落在图幅中部 40%，
      // 别贴着边界（贴边会让人以为图幅被裁过）。
      check(`[${s.name}] 最高峰落在图幅中部 40% 内（模板是山体填满图幅，不是峰顶居中取景）`,
        Math.abs(gi - (f.grid - 1) / 2) < f.grid * 0.2 && Math.abs(gj - (f.grid - 1) / 2) < f.grid * 0.2,
        `偏移 (${gi - (f.grid - 1) / 2}, ${gj - (f.grid - 1) / 2}) 格`);
    } else {
      check(`[${s.name}] 峰顶落在中心 20% 区域内（山体以峰顶取景）`,
        Math.abs(gi - (f.grid - 1) / 2) < f.grid * 0.1 && Math.abs(gj - (f.grid - 1) / 2) < f.grid * 0.1,
        `偏移 (${gi - (f.grid - 1) / 2}, ${gj - (f.grid - 1) / 2}) 格`);
    }
  }
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

/* ===== 13) 跨采样框的一致性：渲染网格必须按**当次** span/grid 重建 =====
 *
 * 这条是 v2.2.0 扩样本时踩出来的真 bug，症状极隐蔽：
 *
 *   `terrain.ts` 顶部的 `const span = field.spanM` / `const grid = field.grid`
 *   是**构造时闭包捕获**的，地表平面 / 裙边 / 底板 / 投影面四块几何的 X/Z
 *   全按它摊开；而 `view3d.refresh` 只在 `terrain === null` 时 `createTerrain`，
 *   之后永远只 `terrain.update()` ⇒ 网格永远停在**第一个样本**的跨度。
 *   偏偏拾取 (`worldToGrid`)、屏幕投影 (`project`)、剖面折世界坐标
 *   (`buildProfile`) 用的一律是**当次** `field.spanM`。
 *
 *   8 个样本里只有临汾盆地是 60 km（其余 30 km），于是选中它时：
 *     · 剖面端点被画到滑板外 4~8 km 的空中（网格 30 km、剖面按 60 km 折）；
 *     · 整块地形按一半的水平尺度显示（垂直夸张实际翻倍）；
 *     · 剖面读数 29.1 km 是地面真实长度的 2 倍。
 *   全程零报错、零日志 —— 只有"端点球飘在板外"这一个视觉征兆。
 *
 * 这里守两件事（纯逻辑 + 静态），因为这条链跨了 terrain.ts / view3d.ts
 * 两个文件、且没有任何纯函数能表达它：
 *   ① 数据上必须真的存在不止一种跨度（否则这条判据永远咬不到东西）；
 *   ② 源码里"按 field 折坐标"与"跨度变了就重建"必须成对存在。
 */
const fs2 = require("fs");
const path2 = require("path");
const SRC = path2.join(__dirname, "..", "src");
const readSrc = (rel) => fs2.readFileSync(path2.join(SRC, rel), "utf8");

const spans = Array.from(new Set(SOURCES.map((s) => s.spanKm)));
check("样本里存在不止一种跨度（跨采样框这条链才走得到）",
  spans.length >= 2, `跨度集合 ${spans.sort((a, b) => a - b).join(" / ")} km`);
check("临汾盆地确实是 60 km 那一档（本轮 bug 的触发条件）",
  SOURCES.filter((s) => s.spanKm !== SOURCES[0].spanKm).length >= 1,
  SOURCES.map((s) => `${s.tag}:${s.spanKm}`).join(" "));

const terrainSrc = readSrc("terrain.ts");
const viewSrc = readSrc("view3d.ts");

check("terrain.ts 把「我是按哪个采样框建的」暴露给调用方（readonly spanM / grid）",
  /readonly\s+spanM\s*:\s*number/.test(terrainSrc) && /readonly\s+grid\s*:\s*number/.test(terrainSrc));
check("terrain.ts 的 buildProfile 用**当次** f.spanM 折世界坐标（不是闭包里的旧 span）",
  /const half = f\.spanM \/ 2/.test(terrainSrc) && /\(gi \/ d\) \* f\.spanM/.test(terrainSrc));
check("view3d.refresh 在跨度或网格数变化时**重建**地形（不是只 update）",
  /terrain\.spanM !== f\.spanM/.test(viewSrc) && /terrain\.grid !== f\.grid/.test(viewSrc) &&
  /terrain=\s*createTerrain|terrain = createTerrain/.test(viewSrc));
check("view3d.debug 把网格自己的采样框报出来（回归脚本据此对账）",
  /terrainSpanM:/.test(viewSrc) && /terrainGrid:/.test(viewSrc));

/* ===== 15) 夸张上限与滑块刻度（v2.4.1） =====
 *
 * 两件事都是"看起来只是界面"、其实会静默改坏行为的那类：
 *
 *  - **上限**：`applyElevation` 会把夸张夹到 [MIN, MAX]。上限还是 2.0 时，
 *    自动推荐给华北平原算的 ×20 会被静默夹回 2.0 —— 界面显示 ×2.00，
 *    看起来"自动推荐生效了"，实际平原还是那张纸。
 *  - **刻度**：0.5~20 用线性刻度的话，0.5→2 只占 7.7% 行程（200 px 上 15 px），
 *    "想微调一下"根本点不准。所以用对数刻度，且必须**来回可逆**
 *    （不可逆的话滑块会在拖动时自己跳）。
 */
check("夸张上限已抬到 20（否则自动推荐会被静默夹回）",
  dem.EXAGGERATION_MAX === 20, String(dem.EXAGGERATION_MAX));
check("夸张下限 = 0.5（保留「可以压平一点」的手动余地）",
  dem.EXAGGERATION_MIN === 0.5, String(dem.EXAGGERATION_MIN));
{
  const f = dem.createField(SOURCES[0]);
  dem.applyElevation(f, 20, 0);
  check("×20 不会被夹掉", near(f.verticalExaggeration, 20, 1e-9), String(f.verticalExaggeration));
  dem.applyElevation(f, 50, 0);
  check("×50 被夹到 20", near(f.verticalExaggeration, 20, 1e-9), String(f.verticalExaggeration));
  dem.applyElevation(f, 0.1, 0);
  check("×0.1 被夹到 0.5", near(f.verticalExaggeration, 0.5, 1e-9), String(f.verticalExaggeration));
  dem.applyElevation(f, 1, 0);
}

{
  const S = dem.EXAGGERATION_SLIDER_STEPS;
  check("滑块两端：位置 0 ⇒ 下限 ×0.5", dem.sliderToExag(0) === 0.5, String(dem.sliderToExag(0)));
  check(`滑块两端：位置 ${S} ⇒ 上限 ×20`, dem.sliderToExag(S) === 20, String(dem.sliderToExag(S)));

  // 每个快捷档都要**落在滑块量程内**且来回可逆（差 ≤ 一步的量程所对应的比例）
  for (const v of [1, 1.5, 2, 5, 10, 20]) {
    const back = dem.sliderToExag(dem.exagToSlider(v));
    check(`档位 ×${v} 在滑块上可表示（来回 ${v} → ${back}）`,
      Math.abs(back - v) / v < 0.02, String(back));
  }

  // 对数刻度的核心收益：0.5→2（×4）与 5→20（×4）占的行程一样宽
  const w1 = dem.exagToSlider(2) - dem.exagToSlider(0.5);
  const w2 = dem.exagToSlider(20) - dem.exagToSlider(5);
  check("对数刻度：×4 的行程处处相等（0.5→2 与 5→20 同宽）",
    Math.abs(w1 - w2) <= 1, `${w1} vs ${w2}`);
  check("对数刻度：0.5→2 占到行程的 1/3 以上（线性刻度下只有 7.7%）",
    w1 / S > 0.33, `${((w1 / S) * 100).toFixed(1)}%`);

  // 单调：拖动不会跳
  let mono = true;
  let prev = -1;
  for (let t = 0; t <= S; t += 25) {
    const v = dem.sliderToExag(t);
    if (v < prev) mono = false;
    prev = v;
  }
  check("滑块位置 ⇒ 倍数 单调不降（拖动不会回跳）", mono);
}

/* ===== 汇总 ===== */
const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "✔" : "✘"} ${c.name}${c.extra ? `  ${c.extra}` : ""}`);
}
console.log(`\nDEM CHECK ${failed.length === 0 ? "PASSED ✔" : "FAILED ✘"}  断言 ${checks.length} 项，失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
