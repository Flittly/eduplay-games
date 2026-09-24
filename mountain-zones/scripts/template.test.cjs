/**
 * 模板地形（v2.4.0）纯逻辑回归。
 * 跑法：`npm run test:data`（会先 rolldown 出 `_data.cjs` / `_dem.cjs` / `_landform.cjs` / `_locations.cjs`）
 *
 * ## 这个文件守的是「模板地形」这档功能的四条契约
 *
 * 1. **形状契约**：模板山地必须真的检出**五类地形部位**（这正是它存在的理由）；
 *    模板丘陵与模板盆地各自的最低要求也要成立。判据用的是 `landform.ts` 的
 *    真实判据，不是另写一套 —— 另写一套就等于自己给自己打分。
 * 2. **诚实契约**：模板地形**不许冒充真实地点** —— 不在 `locations.ts` 里、
 *    `isTemplate` 必须为 `true`。一条地理断言在模板身上"顺便通过"，
 *    等于悄悄把它说成真的。
 * 3. **只读契约**：`b64` 的 sha256 **钉死成基线**。解析地形是确定性的，
 *    所以哈希不变就意味着"没人手改过生成物"；反过来，谁改了形状或判据，
 *    这里必红 —— 逼他先量、先判断是否合理，再更新基线。
 * 4. **闸门有效性**：模板的 `suspect` 必须为 0（解析地形没有数据异常），
 *    同时给一条**合成反例**证明"0 不是因为闸门失效"（§79 的牙齿测试纪律）。
 *
 * ⚠️ 基线数字都是**实测出来的**：改了 `gen_templates.cjs` 的参数或 `landform.ts`
 * 的判据，先跑 `npm run gen:all` 看自检报告、判断是否合理，然后才更新这里的基线。
 * 不许为了让测试变绿而直接改数字。
 */
const crypto = require("crypto");
const lf = require("./_landform.cjs");
const dem = require("./_dem.cjs");
const data = require("./_data.cjs");
const loc = require("./_locations.cjs");

const checks = [];
const check = (name, cond, extra) => {
  checks.push({ name, ok: Boolean(cond), extra: extra === undefined ? "" : String(extra) });
};

const SOURCES = data.DEM_SOURCES;
const TPL = SOURCES.filter((s) => s.isTemplate === true);
const REAL = SOURCES.filter((s) => s.isTemplate !== true);

/* ================================================================== */
/* 1) 两档分组：模板 / 真实                                             */
/* ================================================================== */
{
  check("模板地形恰好 3 个（山地 / 丘陵 / 盆地）", TPL.length === 3, TPL.map((s) => s.name).join(" / "));
  check(
    "模板的 tag 与顺序为 tpl_mountain / tpl_hill / tpl_basin",
    TPL.map((s) => s.tag).join(",") === "tpl_mountain,tpl_hill,tpl_basin",
    TPL.map((s) => s.tag).join(",")
  );
  check("真实地形仍然是 8 个（一个都没删）", REAL.length === 8, `${REAL.length} 个`);
  check(
    "模板排在真实地形之前（默认打开的是模板山地）",
    SOURCES[0].tag === "tpl_mountain",
    SOURCES[0].tag
  );
  check(
    "真实地形一律没有 isTemplate 标记",
    REAL.every((s) => s.isTemplate === undefined),
    REAL.filter((s) => s.isTemplate !== undefined).map((s) => s.tag).join(",")
  );
  check(
    "模板地形的类型就是它们的名字（山地/丘陵/盆地各一个）",
    TPL.map((s) => `${s.tag}:${s.landType}`).join(",") ===
      "tpl_mountain:mountain,tpl_hill:hill,tpl_basin:basin",
    TPL.map((s) => `${s.tag}:${s.landType}`).join(",")
  );
}

/* ================================================================== */
/* 2) 诚实契约：模板不许冒充真实地点                                     */
/* ================================================================== */
{
  const leaked = TPL.filter((s) => loc.SAMPLE_LOCATIONS.some((m) => m.tag === s.tag));
  check(
    "模板地形不在 locations.ts 里（没有省份可标 → 界面才敢不画中国地图）",
    leaked.length === 0,
    leaked.map((s) => s.tag).join(",")
  );
  // 反过来说：真实样本一个都不能漏登记，否则那条「地理位置」栏会拿错兜底值
  const missingReal = REAL.filter((s) => !loc.SAMPLE_LOCATIONS.some((m) => m.tag === s.tag));
  check(
    "真实样本全部在 locations.ts 里有登记",
    missingReal.length === 0,
    missingReal.map((s) => s.tag).join(",")
  );
  check(
    "模板地形的 lat/lon 是占位值（30/105），不是某个真实经纬度",
    TPL.every((s) => s.lat === 30 && s.lon === 105),
    TPL.map((s) => `${s.tag}:${s.lat},${s.lon}`).join(" ")
  );
}

/* ================================================================== */
/* 3) 只读契约：生成物指纹基线                                          */
/* ================================================================== */
/**
 * `sha256(b64)` 基线。
 *
 * 这是"生成物没被手改"的唯一干净证据：解析地形无随机数，
 * 同参数必然逐字节一致；哈希一变就说明形状或判据动过。
 */
const B64_SHA = {
  // v2.4.4（2026-09-22）：三个模板地形**有意重建**（撤三处结构异常，详见
  // gen_templates.cjs 的 v2.4.4 注释与 CHANGELOG）：
  //   - 模板山地：山谷从"等深笔直尖底刻槽"改成圆底（rcone）+ 沿程加深加宽 + 蜿蜒
  //     —— 用户点名「很深、类似河道的不自然凹槽」；
  //   - 模板丘陵：三条冲沟从等深直线改成走廊道蜿蜒、圆底、两端收浅
  //     —— 用户点名「多处类似河道的不自然结构」；
  //   - 模板盆地：直线 scarp（抬升侧不封边 ⇒ 西南角整块 500 m 矩形板块）换成
  //     贴盆缘的弧形断阶 —— 用户点名「左下方非常规整的长方体结构」。
  // 前后逐格差分（.workbuddy/tmp/tpl_diff_243_244.cjs）：山地 3.6% / 丘陵 3.5% /
  // 盆地 16.0% 的格数有变化，且全部落在被点名的部位，其余逐格为 0。
  // 上一版（v2.4.3）：8593ddfe… / c02ebc44… / 61456a67…
  tpl_mountain: "871d6ae8b16455c4f0c72877bde4c5dbb7ac179b3ba1ccb278dd3990953f0ac4",
  tpl_hill: "1f1c503d75f796808ea667fe9c613c2489d28f846934ba51bd0e781fcf7ad9fe",
  tpl_basin: "9e05b2d53b551a1b10c79e1dca992043af956c33f5fb82b0248aaba3230a0947"
};
for (const s of TPL) {
  const got = crypto.createHash("sha256").update(s.b64, "utf8").digest("hex");
  check(
    `[${s.name}] 网格数据指纹未变（改了形状就必须重新量并更新基线）`,
    got === B64_SHA[s.tag],
    got === B64_SHA[s.tag] ? "" : `实测 ${got.slice(0, 16)}… 基线 ${String(B64_SHA[s.tag]).slice(0, 16)}…`
  );
}

/* ================================================================== */
/* 4) 形状契约：判型 + 部位检出 + 干净度                                 */
/* ================================================================== */
const marks = {};
for (const s of TPL) {
  const field = dem.createField(s);
  const h = dem.heightFn(field);
  marks[s.tag] = lf.landParts(h, field.grid, field.spanM);
}

{
  // 4.1 模板山地：五类部位必须齐全 —— 这是整个功能的验收标准
  const m = marks.tpl_mountain;
  const c = lf.landPartCounts(m);
  check("模板山地 · 山峰 ≥ 2（「两峰之间一个鞍部」要先有两个峰）", c.peak >= 2, `${c.peak}`);
  check("模板山地 · 山脊 > 0", c.ridge > 0, `${c.ridge}`);
  check("模板山地 · 山谷 > 0", c.valley > 0, `${c.valley}`);
  check("模板山地 · 鞍部 > 0", c.saddle > 0, `${c.saddle}`);
  check("模板山地 · 陡崖 > 0", c.cliff > 0, `${c.cliff}`);
  check(
    "模板山地 · 五类部位齐全（峰/脊/谷/鞍/崖 全部 > 0）",
    ["peak", "ridge", "valley", "saddle", "cliff"].every((p) => c[p] > 0),
    JSON.stringify(c)
  );

  // 4.2 模板丘陵：山峰 / 山脊 / 山谷 / 鞍部，唯独没有陡崖
  //
  // ⚠️ 这一段改过一次口径（v2.4.0 第二轮）。第一版断言的是
  // `hill.ridge === 0 && hill.cliff === 0`，理由写在 gen_templates.cjs 里：
  // 「丘陵相对高度 < 200 m，与山脊判据门槛（坡度 ≥ 31°）互斥」。
  // 但那条理由只在**圆缓的独立丘**上成立 —— 真实丘陵是梁与冲沟相间，
  // 梁坡与沟壁同陡。补上窄脊之后山脊就出来了。
  // 教训：那条断言冻结的其实是**我当时的构图**，不是丘陵的性质。
  const hill = lf.landPartCounts(marks.tpl_hill);
  check("模板丘陵 · 山峰 > 0", hill.peak > 0, `${hill.peak}`);
  check("模板丘陵 · 山脊 > 0（梁，与冲沟相间）", hill.ridge > 0, `${hill.ridge}`);
  check("模板丘陵 · 山谷 > 0（三条短冲沟）", hill.valley > 0, `${hill.valley}`);
  check("模板丘陵 · 鞍部 > 0", hill.saddle > 0, `${hill.saddle}`);
  check(
    "模板丘陵 · 脊谷同量级（不允许只切沟、不堆梁）",
    Math.max(hill.ridge, hill.valley) / Math.min(hill.ridge, hill.valley) < 6,
    `脊${hill.ridge} 谷${hill.valley}`
  );
  check(
    "模板丘陵 · 陡崖 = 0（梁坡够不到 65°；要做出来得把相对高度推到 300 m+，那就不是丘陵了）",
    hill.cliff === 0,
    `崖${hill.cliff}`
  );

  /* ---- 「很多座比较明显的山」：把主观话落成三个可量的数 ---- */
  //
  // 为什么不能直接用 `landParts` 的 `peak` 计数：那是**展示用**的检测结果，
  // `PEAK_MAX_COUNT = 6` + 半径 6 格的极大值抑制 ⇒ 它按设计最多报 6 个
  // （界面上超了显示 `6+`）。拿它量"有多少座丘"会永远得到 6。
  //
  // 所以这里现量一遍：严格 3×3 局部极大 + 最小突出度 + 最近邻去重。
  // 突出度用**环形**最低点（不是方框）—— 同 `reliefStats` 里那段注释的理由。
  {
    const hillSrc = TPL.find((s) => s.tag === "tpl_hill");
    const field = dem.createField(hillSrc);
    const n = field.grid;
    const cellM = field.spanM / (n - 1);
    const q = field.raw;
    const MIN_PROM = 25; // m：低于这个的凸起算噪声，不算"一座丘"
    const R = 12; // 环半径（格）；12×78.4 ≈ 940 m，约半个丘距
    const cand = [];
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const v = q[j * n + i];
        let isMax = true;
        for (let dj = -1; dj <= 1 && isMax; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (di === 0 && dj === 0) continue;
            if (q[(j + dj) * n + (i + di)] >= v) {
              isMax = false;
              break;
            }
          }
        }
        if (!isMax) continue;
        let ringMin = Infinity;
        for (let a = 0; a < 72; a++) {
          const t = (a / 72) * Math.PI * 2;
          const x = Math.round(i + Math.cos(t) * R);
          const y = Math.round(j + Math.sin(t) * R);
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const w = q[y * n + x];
          if (w < ringMin) ringMin = w;
        }
        if (isFinite(ringMin) && v - ringMin >= MIN_PROM) {
          cand.push({ i, j, prom: v - ringMin });
        }
      }
    }
    cand.sort((a, b) => b.prom - a.prom);
    const tops = [];
    for (const t of cand) {
      if (tops.some((k) => Math.hypot(k.i - t.i, k.j - t.j) < R / 2)) continue;
      tops.push(t);
    }
    const proms = tops.map((t) => t.prom).sort((a, b) => a - b);
    const medProm = proms.length ? proms[proms.length >> 1] : 0;
    const nn = tops
      .map((a) => {
        let best = Infinity;
        for (const b of tops) {
          if (b === a) continue;
          const d = Math.hypot(a.i - b.i, a.j - b.j) * cellM;
          if (d < best) best = d;
        }
        return best;
      })
      .filter((d) => isFinite(d))
      .sort((a, b) => a - b);
    const medNn = nn.length ? nn[nn.length >> 1] : 0;

    // 改前基线（从**已上架 v2.4.0 包**里挖出来的另一份 b64 量得）：
    //   丘顶 16 座 · 突出度中位数 253 m · 最近邻间距中位数 566 m · 局部高差中位数 88 m
    // 注意改前的"16 座"里有相当一部分是长波起伏上的浅凸起，不是独立的丘
    // —— 这也是为什么下面同时卡"间距"和"局部高差中位数"，光看个数会误判。
    check(
      `模板丘陵 · 丘顶 ≥ 45 座（实测 ${tops.length}；改前 16）—— 对应「很多座」`,
      tops.length >= 45,
      `${tops.length} 座（候选 ${cand.length}）`
    );
    check(
      `模板丘陵 · 丘顶突出度中位数 ≥ 60 m（实测 ${medProm}）—— 对应「比较明显」`,
      medProm >= 60,
      `${medProm} m`
    );
    check(
      `模板丘陵 · 丘顶最近邻间距中位数 ≥ 800 m（实测 ${Math.round(medNn)}）—— 丘要分得开，不是糊成一坨`,
      medNn >= 800,
      `${Math.round(medNn)} m`
    );
    const st = lf.reliefStats(dem.heightFn(field), n);
    check(
      `模板丘陵 · 局部高差中位数 ≥ 110 m（实测 ${Math.round(st.localRelief)}；改前 88）—— 这是判 hill 的同一个量`,
      st.localRelief >= 110,
      `${Math.round(st.localRelief)} m`
    );
  }

  const basin = lf.landPartCounts(marks.tpl_basin);
  check(
    "模板盆地 · 五类部位齐全（盆缘本身就是一圈山地）",
    ["peak", "ridge", "valley", "saddle", "cliff"].every((p) => basin[p] > 0),
    JSON.stringify(basin)
  );
}

{
  // 4.3 干净度：模板是解析地形，部位检出不该"满图碎点"（满图碎点说明形状不干净）
  for (const s of TPL) {
    const m = marks[s.tag];
    const cells = s.grid * s.grid;
    const ridgePct = (m.ridges.length / 2 / cells) * 100;
    const valleyPct = (m.valleys.length / 2 / cells) * 100;
    check(
      `[${s.name}] 脊/谷点占比 < 5%（形状干净，不是满图碎点）`,
      ridgePct < 5 && valleyPct < 5,
      `脊 ${ridgePct.toFixed(2)}% 谷 ${valleyPct.toFixed(2)}%`
    );
  }
}

/* ================================================================== */
/* 5) 闸门有效性：模板 suspect 必须为 0，但不是因为闸门失效              */
/* ================================================================== */
{
  for (const s of TPL) {
    const cs = marks[s.tag].cliffScan;
    check(
      `[${s.name}] 被陡崖物理闸门剔除的格数 = 0（解析地形没有数据异常）`,
      cs.suspect === 0,
      `剔除 ${cs.suspect} 格`
    );
  }

  /* ---- 牙齿测试：在模板山地上人为戳一条窄缝，闸门必须咬住 ---- */
  const src = TPL[0];
  const field = dem.createField(src);
  const n = field.grid;
  const h = new Float64Array(field.raw);
  // 抄 landform.test.cjs 的合成反例口径：一格宽、掉 2000 m 的窄缝（物理上不可能）
  const mid = (n >> 1) + 0.5;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (Math.abs(i - mid) < 1) h[j * n + i] = Math.max(0, h[j * n + i] - 2000);
    }
  }
  const cellM = field.spanM / (n - 1);
  const cs = lf.findCliffs((i, j) => h[j * n + i], n, cellM);
  check(
    "牙齿测试：人为戳一条 1 格宽 / 2000 m 的窄缝 ⇒ 闸门必须剔除它",
    cs.suspect > 0,
    `剔除 ${cs.suspect} 格，通过 ${cs.cliffs.length} 处`
  );
}

/* ================================================================== */
/* 6) 每个模板都要能被判成它声明的类型（与 landform.test.cjs 同口径，这里只针对模板） */
/* ================================================================== */
{
  for (const s of TPL) {
    const field = dem.createField(s);
    const got = lf.classifyLandType(lf.reliefStats(dem.heightFn(field), field.grid));
    check(
      `[${s.name}] 判据复核：${s.landType}`,
      got.type === s.landType,
      `判成 ${got.type} —— ${got.reason}`
    );
  }
}

/* ================================================================== */
/* 汇总                                                                */
/* ================================================================== */
const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "✔" : "✘"} ${c.name}${c.extra ? `   [${c.extra}]` : ""}`);
}
console.log(
  `\nTEMPLATE CHECK ${failed.length === 0 ? "PASSED ✔" : "FAILED ✘"}  断言 ${checks.length} 项，失败 ${failed.length} 项`
);
process.exit(failed.length === 0 ? 0 : 1);
