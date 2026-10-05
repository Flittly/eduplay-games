/**
 * 模板地形（v2.4.0）纯逻辑回归。
 * 跑法：`npm run test:data`（会先 rolldown 出 `_data.cjs` / `_dem.cjs` / `_landform.cjs` / `_locations.cjs`）
 *
 * ## 这个文件守的是「模板地形」这档功能的四条契约
 *
 * 1. **形状契约**：模板山地必须真的检出**峰 / 脊 / 鞍**（v2.4.6 起；
 *    v2.4.0~v2.4.5 曾要求五类齐全，但那与"两座普通的山"互斥，见 4.1 的说明），
 *    模板盆地仍要求**五类齐全**、模板丘陵要求峰/脊/谷/鞍。判据用的是 `landform.ts` 的
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
  // v2.4.5（2026-10-03）：三个模板地形为「一眼看得出是什么地形」整体重做
  // （病根与逐条改动见 gen_templates.cjs 里各自的 v2.4.5 注释）：
  //   - 模板山地：基座从径向圆丘 `MASSIF` 改成**平面斜坡**（西北高→东南低）。
  //     ASCII 立体阴影实测旧版"边中位 1255 m、四角 842 m"，而两个峰只占中央一小块
  //     ⇒ 读成"平地上放了两个包"；新版四处都是山坡，高处占比 10.1% → 41%；
  //   - 模板丘陵：加 `TILT = 160 m` 缓倾斜基面，让**梁有连续顶面**（旧版丘与丘之间
  //     是恒定的 BASE，每个丘都读成"独立的包"，不是"一片被切成梁的丘陵"）；
  //   - 模板盆地：盆缘环心 0.72×半幅 → 0.60×半幅且环宽 0.28 → 0.42×半幅。
  //     旧版环恰好压在图幅边上，图幅内 78% 面积都是平底（实测四边中位 481 m、
  //     四角全 514 m），`edgeMinusCore` 只有 70 m；新版 764 m、8 个方位全过。
  //     另在南侧开一个**河流出口**缺口，`FAULT.r0` 随盆缘内移 13178 → 9180 m。
  // ⚠️ 盆地这一项在 v2.4.5 里**重钉过两次**，两次都是真缺陷不是抖动：
  //   ① 出口方向写成 270°（=北）而注释说南侧；顺带发现 `RIM_PEAKS` 里的
  //      `deg: 80` 与出口 `90` 只差 10°，峰直接骑在缺口上；
  //   ② `outTaper` 的输入用了「角差折算的弧长」`|Δang|·RING_R/180`，
  //      而弧长正比于 r ⇒ 盆心处退化成 0 ⇒ `smoothstep(x < e0)` 返回 **0**
  //      ⇒ **中心线不衰减、缺口反被填满**，两侧 ±34° 外才压得低。
  //      实测正南 90° 环顶 **1319 m 是全圈最高**（本该最低），60° 只有 473 m。
  //      改成直接用「角差（度）」做 taper 后：90° 降到 538 m 全圈最低，
  //      两侧 876 / 991 m，ASCII 上南侧的 V 形缺口一眼可辨。
  // 判型与五类部位全部保持（mountain/hill/basin，各需部位齐全），
  // `suspect` 三个模板都为 0 —— 解析地形一格数据异常都不该有。
  // **v2.4.9（峰顶钝化 + 山体降 25%）**：
  //   202d261c…（v2.4.8 是 edfb72dc…，只动山地，丘陵盆地两个指纹不变）。
  //   峰顶锥 2800/1050=0.38 ⇒ 5200/900=0.17；山体 H ×0.75、R 11200⇒14000；
  //   垄 H 1900⇒2000；DIP 714⇒536。
  //   实测：峰 2（**6731 / 6226 m，高差 505 m**）· 脊 1 条 62 点 · 谷 0 ·
  //        **鞍 0** · 崖 0 · mountain · 高程 1127–6731 m ·
  //        **山体占比 48.7%**（v2.4.8 是 38.2%）·
  //        几何鞍降 68 m（**1.1% 起伏**）·
  //        **峰顶 300 m 等高线面积 0.197 km²**（v2.4.8 只有 0.098 ⇒ 尖顶）。
  // 上一版（v2.4.8）：edfb72dc… / 77f3a3fa… / cd68b714…
  // 上一版（v2.4.7）：548485c8… / 77f3a3fa… / cd68b714…
  // 上一版（v2.4.5）：871d6ae8… / 1f1c503d… / 9e05b2d5…
  // ⚠ **v2.5.0（2026-10-05）**：模板山地**有意重建** —— 从「一道垄上的两个峰顶」
  //   改成「两座真正独立的山」（用户原话：「能否取消中间的这个连接」）。
  //   山体半径 14000 → 6500 m、中心距拉开到 51 格（4.0 km）、连接垄 `RIDGE.H` 2000 → **0**。
  //   实测山体掩膜（`min + 0.3 × 起伏`）从 **1 个连通块变成 2 个**，
  //   峰 2（4879/3937 m）、鞍 0、脊线 0 条。丘陵与盆地**逐字未变**。
  // v2.5.1：噪声 210/3000 → 450/1400（v2.5.0 是 c63292b6…）
  // ⚠ 基线必须用 `node -e "…sha256(s.b64,'utf8')…"` 现算，**不能照着红项里的前 16 位补全** ——
  //   补出来的会"看起来对"（前 16 位一致）而实际不同，红项仍会红，白查一轮。
  //
  // ⚠ **v2.5.2（2026-10-05）**：丘陵「**81 座 → 36 座**」+「体积增大」
  //   （`hillR` 7.0 → **11.0**、`hillH` 110 → **150**）+ 坡面噪声 **45 m/1400 m**；
  //   盆地加坡面噪声 **120 m/2000 m**。模板山地**逐字未变**（指纹与 v2.5.1 相同）。
  //   实测：丘陵 峰6 脊36 谷58 鞍4 崖0 · **hill** · 高程 185–640 · **局部高差 179 m**
  //   （离 `LOCAL_RELIEF_MOUNTAIN = 200` 只剩 **21 m**，本模板最紧的约束）；
  //   盆地 峰4 脊182 谷176 鞍2 **崖16（未断）** · **basin** · 高程 317–1926。
  //   ⚠ 丘陵局部高差余量只剩 21 m —— **改 hillH 之前先量它**（H=170 就到 190）。
  tpl_mountain: "f31040c841b642851db00f7f40b386a39040c3bf19d0d063b17b2a89d1c783a2",
  tpl_hill: "fc24dced53675a1bea06c6eda9b06b6a16437af24fbfd294a0670a83892f24a5",
  tpl_basin: "9d3eceb9055e419ad0dd5089e110644d97d389fa12f3c7efa38dd4f6b8c600fc"
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
  // 4.1 模板山地：**峰 / 脊 两类**（v2.4.6 从五类改三类，v2.4.8 再去掉鞍）
  //
  // ⚠️ v2.4.0~v2.4.5 这一段断言的是"**五类部位齐全**"（峰/脊/谷/鞍/崖）。
  // v2.4.6 用户说「太丑了、有些复杂，就两座普通的连在一起的山就可以了」——
  // 实测这两条要求**互斥**，理由逐条写在 `gen_templates.cjs` 的 `SPECS[0].needParts`：
  //   · 陡崖要 65°~80°，宽缓的圆顶山最大坡度只有 48~64°；
  //   · 山谷要 TPI ≤ −70 m，两座山各自的后坡太平缓，到不了这个量级。
  //
  // **v2.4.8 用户又提两条**（原话）：
  //   「中间的鞍部有些太过于奇怪了，取消中间鞍部」
  //   「两边的山都一样高就看起来很奇怪，还是过于的机械了」
  //
  // 两条都**不是**判据改了，是**几何改了**：
  //   · 两峰高差 27 m → **801 m**（主峰 7554 / 副峰 6753）
  //   · 几何鞍降 326 m（起伏 5.5%）→ **154 m（2.4%）**
  // 而鞍判据门槛 = `max(25 m, 3% × 全图起伏)`（`SADDLE_MIN_DROP_FRAC`）
  // ⇒ 2.4% **低于门槛** ⇒ `saddle = 0`，界面上不再出现鞍部标记。
  //
  // ⚠️ **几何上凹不可能完全消失**（两峰之间的垄中点必然低于两峰，
  // 否则中段鼓成第三个包）。所以"取消鞍部"= 压到门槛以下，
  // 而不是"把山做成没有鞍的样子"。详见 gen_templates.cjs 的 `DIP` 注释。
  //
  // ⚠️ **鞍部这个部位仍然教**，改由模板丘陵（鞍 4）与模板盆地（鞍 3）承担
  // —— 用户 2026-10-05 在知情后选定这个取舍。
  const m = marks.tpl_mountain;
  const c = lf.landPartCounts(m);
  check("模板山地 · 山峰 ≥ 2（用户要「两边的山」）", c.peak >= 2, `${c.peak}`);
  check(
    "模板山地 · 峰类齐全（v2.5.0 起山脊线退出本模板，用户选「不要山脊线，只要两座山」）",
    c.peak > 0,
    JSON.stringify(c)
  );

  /* ------------------------------------------------------------------ */
  /* v2.5.0 新增判据：**山体掩膜必须分成两块**                          */
  /* ------------------------------------------------------------------ */
  /**
   * ⚠ 这是本轮最核心的一条判据，守的就是用户那句
   * 「现在为什么两座山还是连接在一块的？能否取消中间的这个连接」。
   *
   * ## 为什么必须单独量「连通块」，而不能看峰/鞍/脊线
   * v2.4.x 的所有判据（鞍 = 0、脊线 1 条、峰 2 个）**全绿**，
   * 但渲染出来仍然是一个椭圆形的整体（`.workbuddy/tmp/mzdesign/cand249.png`）。
   * 病根：`R = 14000 m = 178 格`，而图幅 20 km 只有 256 格、
   * 两峰中心距最多 120 格 ⇒ **两个圆顶必然融成一个包**，
   * 连扫 8 档间距（3.1~8.6 km）山体连通块恒为 1。
   *
   * ⇒ 「有没有连成一片」这件事**只能直接量山体掩膜的连通块**。
   *
   * 掩膜定义与 `gen_templates.cjs` / 扫参脚本一致：`v ≥ min + 0.3 × 全图起伏`。
   */
  {
    const field = dem.createField(TPL.find((s) => s.tag === "tpl_mountain"));
    const hh = dem.heightFn(field);
    const g = field.grid;
    let mn = Infinity, mx = -Infinity;
    for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) {
      const v = hh(i, j); if (v < mn) mn = v; if (v > mx) mx = v;
    }
    const thr = mn + 0.3 * (mx - mn);
    const seen = new Uint8Array(g * g);
    const sizes = [];
    for (let s0 = 0; s0 < g * g; s0++) {
      if (hh(s0 % g, Math.floor(s0 / g)) < thr || seen[s0]) continue;
      let sz = 0; const st = [s0]; seen[s0] = 1;
      while (st.length) {
        const u = st.pop(); sz++;
        const ui = u % g, uj = (u - ui) / g;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const vi = ui + di, vj = uj + dj;
          if (vi < 0 || vj < 0 || vi >= g || vj >= g) continue;
          const w = vj * g + vi;
          if (hh(vi, vj) >= thr && !seen[w]) { seen[w] = 1; st.push(w); }
        }
      }
      sizes.push(sz);
    }
    sizes.sort((a, b) => b - a);
    const bodyFrac = sizes.reduce((a, b) => a + b, 0) / (g * g);
    check(
      "模板山地 · 山体掩膜分成 ≥ 2 块（「两座山」而不是「一座山」）",
      sizes.length >= 2,
      `连通块 ${sizes.length} 个（${sizes.join("/")} 格）· 山体占比 ${(bodyFrac * 100).toFixed(1)}%` +
        `（v2.4.x 恒为 1 块 ⇒ 两山融成一个椭圆包，probe249f.cjs 实测）`
    );
    check(
      "模板山地 · 山体掩膜 ≤ 3 块（不能碎成一堆）",
      sizes.length <= 3,
      `连通块 ${sizes.length} 个`
    );
  }

  // ⚠️ **鞍部必须是 0，而且这条断言有牙齿**（不是"记个读数"）。
  // 它守的是两件事：
  //   ① 「取消鞍部」这个用户要求没被回退（有人把 `EXTRA_DOMES` 的 H 调回一样高，
  //      或把 `DIP` 加深，鞍就会回来）；
  //   ② 反过来，**也不能为了让鞍消失而把两峰搞成一座**（那违反"两边的山"）。
  // v2.5.0 追加第三件事：**不能靠「山体重新连成一片」来消鞍** ——
  //    那正是上面新增的「山体掩膜 ≥ 2 块」在守。
  //    而判据本身的独立性（防「调阈值蒙混」）由下面直接量剖面的那条守住。
  check(
    "模板山地 · 鞍部已按用户要求退出（v2.5.0：两山独立，中间是低平地带而非鞍）",
    c.saddle === 0,
    `鞍 ${c.saddle}（不为 0 说明 DIP 又被加深、或两峰又被拉平）`
  );

  // 反向钉住"放弃凑"的决定：这三类**不该**再被要求，若哪天又出现也不该因此变红。
  // （不写成"必须为 0"——那是在冻结构图；只记当前读数，供改形状时对照。）
  check(
    "模板山地 · 当前不要求谷、鞍与崖（记录实测读数，改形状后请重新判断这三项是否该恢复）",
    true,
    `谷 ${c.valley} · 鞍 ${c.saddle} · 崖 ${c.cliff}`
  );

  // ⚠️ **独立于判据的几何闸门**（新增于 v2.4.8）
  // 上面那条 `saddle === 0` 验的是"判据认不认"，本条验的是"**形状到底平不平**"。
  // 两者可能背离：假如有人把 `SADDLE_MIN_DROP_FRAC` 调大，判据会放过一个
  // 仍然很深的鞍 —— 那时 `saddle === 0` 照样绿，但用户的原话已经被违背。
  // 所以这里**直接量两峰连线上的最低点**，不经过任何阈值。
  {
    const field = dem.createField(TPL.find((s) => s.tag === "tpl_mountain"));
    const hh = dem.heightFn(field);
    const peaks = m.peaks;
    check(
      "模板山地 · 判据给出的峰 ≥ 2（下面两条几何判据的前提）",
      peaks.length >= 2,
      `${peaks.length} 个：${peaks.map((p) => `(${p.i},${p.j})@${p.h.toFixed(0)}m`).join(" ")}`
    );
    if (peaks.length >= 2) {
      // 取判据给出的两个峰（而不是重新找局部极大）——
      // 保证量的是"界面上真的会标注的那两个"。
      const [A, B] = [peaks[0], peaks[1]];
      let lo = Infinity;
      for (let s = 0; s <= 200; s++) {
        const t = s / 200;
        const v = hh(
          Math.round(A.i + (B.i - A.i) * t),
          Math.round(A.j + (B.j - A.j) * t)
        );
        if (v < lo) lo = v;
      }
      let mn = Infinity, mx = -Infinity;
      for (let j = 0; j < field.grid; j++)
        for (let i = 0; i < field.grid; i++) {
          const v = hh(i, j);
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      const relief = mx - mn;
      const drop = Math.min(A.h, B.h) - lo;
      const pct = drop / Math.max(1, relief);
      // ⚠ **v2.5.0 判据整体反转**：两座山**真正分开**之后，
      // 中间那段的地形落差**本来就该很大** —— 那正是「两座独立山」的形状。
      // v2.4.x 要求它< 4%（因为当时两座山是「一道垄上的两个鼓包」，
      // 中间必须浅得像过肩，否则读成「一个奇怪的鞍」）。
      // 现在两山之间是**低平地带**，落差 2178 m = 55.6% 才是正确的。
      //
      // ⇒ 判据改成守**形状的另一半**：中间必须**低于两峰**，
      //   而且要有**足够的落差**才读得出「这是两座山，不是一片高地」。
      //   门槛写成「≥ 20% 起伏」而不是拍一个绝对米数，
      //   因为起伏随构图变（实测 v2.5.0 是 55.6%）。
      check(
        "模板山地 · 两峰之间确实是低平地带（落差 ≥ 20% 起伏 ⇒ 读得出「两座山」）",
        pct >= 0.20,
        `实测 ${drop.toFixed(0)} m = ${(pct * 100).toFixed(1)}%` +
          `（v2.4.x 要求 < 4%，那是「一道垄上的两个鼓包」时代的判据，` +
          `现在两山独立，中间本就该深）`
      );
      check(
        "模板山地 · 中段低于两峰（是「两座山」而不是「一片高地」）",
        lo < Math.min(A.h, B.h) - 500,
        `中段 ${lo.toFixed(0)} m，两峰 ${Math.min(A.h, B.h).toFixed(0)} / ` +
          `${Math.max(A.h, B.h).toFixed(0)} m`
      );
      // 反过来钉住"两峰必须一高一低" —— 用户第二条原话。
      // 数字写死 ≥ 300 m：v2.4.7 实测只有 27 m，v2.4.8 是 801 m。
      check(
        "模板山地 · 两峰高差 ≥ 300 m（「两边的山都一样高…过于的机械」）",
        Math.abs(A.h - B.h) >= 300,
        `实测 ${Math.abs(A.h - B.h).toFixed(0)} m（v2.4.7 是 27 m，v2.4.8 是 801 m）`
      );
    }

    /* ---------------------------------------------------------------- */
    /* ⚠️ v2.4.9：峰顶「钝」判据 —— 用户原话「看起来山顶太过于尖了」      */
    /* ---------------------------------------------------------------- */
    //
    // ## 为什么不用"坡度"当指标
    // 先量过：v2.4.8 峰顶 ±6 格最大坡度只有 **55.9°**，
    // 而渲染的垂直夸张 `exaggeration = tan25°/tan(p90坡) = ×0.94 ≈ 1`
    // （`landform.ts`）⇒ **视觉坡度 54.2°，渲染根本没有把它放大**。
    // 所以"尖"不是渲染造成的，也不是"坡度太大"，而是**峰顶那一小块太小**。
    //
    // ## 指标：峰顶 300 m 等高线所围面积
    // 用"局部极大且四邻都高于阈值"的格数 × 格面积（**不经过任何阈值判定**）：
    //   · v2.4.8 = **0.098 km²**（20 km 图幅里占 0.024%，出图就是一撮尖）
    //   · v2.4.9 = **0.209 km²**（2.1倍）
    // 门槛取 **0.15 km²**（v2.4.8 与 v2.4.9 正中间，两侧都有余量）。
    //
    // ⚠️ 这条**必须钉住**，否则改形状的人很容易把锥调回 `R/H` 小的尖顶而不自知
    // —— 参数看着只是"改了个数字"，观感却退回 v2.4.8。
    {
      const cell = field.spanM / (field.grid - 1);
      const P = m.peaks[0];
      const target = P.h - 300;
      let cells = 0;
      for (let j = 1; j < field.grid - 1; j++) {
        for (let i = 1; i < field.grid - 1; i++) {
          if (hh(i, j) < target) continue;
          if (hh(i - 1, j) < target || hh(i + 1, j) < target) continue;
          if (hh(i, j - 1) < target || hh(i, j + 1) < target) continue;
          cells++;
        }
      }
      const areaKm2 = (cells * cell * cell) / 1e6;
      check(
        "模板山地 · 峰顶 300 m 等高线面积 ≥ 0.15 km²（「山顶看起来太尖」）",
        areaKm2 >= 0.15,
        `实测 ${areaKm2.toFixed(3)} km²（v2.4.8 是 0.098；` +
          `由峰顶锥的 R/H 决定：v2.4.8 是 2800/1050=0.38，v2.4.9 是 5200/900=0.17）`
      );
      // 附带记下峰顶真实坡度，供改形状时对照（不是门槛，是读数）。
      let topSlope = 0;
      for (let dj = -6; dj <= 6; dj++) {
        for (let di = -6; di <= 6; di++) {
          const i = P.i + di, j = P.j + dj;
          if (i < 1 || j < 1 || i >= field.grid - 1 || j >= field.grid - 1) continue;
          topSlope = Math.max(
            topSlope,
            (Math.atan(Math.abs(hh(i, j) - hh(i, j + 1)) / cell) * 180) / Math.PI
          );
        }
      }
      check(
        "模板山地 · 记录峰顶 ±6 格最大坡度（读数，改形状后请对照）",
        true,
        `${topSlope.toFixed(1)}°（v2.4.8 是 55.9°；渲染 ×0.94 后视觉约 ${(topSlope * 0.94).toFixed(0)}°）`
      );
    }
  }

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
/* 7) 教学可读性（v2.4.5）：「一眼看得出是什么地形」                        */
/* ================================================================== */
/*
 * 前面 6 节守的都是"程序算得对不对"，这一节守的是**"人眼看不看得出"**——
 * 后者才是模板地形存在的理由（真实样本形状不受控，才另做这一档）。
 *
 * ## 为什么第一版选的三个指标里有两个被扔掉
 *
 * `scripts/template.test.cjs` 之前没有这一节，v2.4.5 补上时试过三个指标，
 * 拿**改前的 v2.4.4 数据**（`git show HEAD:src/data/dem-tpl_*.ts`）跑同一套量，
 * 结果有两个是**恒真判据**（改前也过 ⇒ 钉进去等于没钉）：
 *
 * | 指标 | 改前 | 改后 | 判定 |
 * |---|---|---|---|
 * | 闭合等高线层级数（200 m） | 13 / 4 / 7 | 14 / 4 / 5 | ❌ 弃用：改前也过，且**盆地反而变少** |
 * | 图幅高差比 | 17.2% / 1.8% / 3.9% | 19.9% / 2.0% / 2.6% | ❌ 弃用：盆地**降了**（盆缘内移 ⇒ 图幅内总高差变小） |
 * | **四边最低 − 中心** | −980 / −17 / +89 | −447 / −49 / +86 | ✅ 有牙齿，但符号方向按类型不同 |
 *
 * ⇒ 真正能区分改前改后的只有**"边缘相对中心"**这一族指标：
 * 改前模板山地四边只有 1232~1364 m、**四角全在 800~916 m**，比中心低 1400 m ——
 * 这就是"平地上放了两个包"的病根；改后四角 4247 / 3053 / 3053 / 1100，有背坡了。
 *
 * ## 为什么改成"逐边"而不是"四边中位"
 *
 * 单一"四边中位"会被**对称抵消**：模板山地的基座是西北高、东南低的斜坡，
 * 西北象限的高值和东南象限的低值一平均就≈中心（改后中位 +641 m 看着很美，
 * 但最低那条边其实是 −447 m）。所以这里取**四条边各自的中位**，
 * 判"最矮的那条边"——那才是学生视角看到的最弱点。
 *
 * ## 判据都是下限守卫，不追数值
 *
 * 模板是**教科书示意图**，不该硬追真实 DEM 的起伏比（真实四山高差比 30%+、
 * 坡度中位 29.5°，而模板刻意光滑）。所以只守"不得低于某个下限"，
 * 上限不设——留出以后继续优化的空间。
 */

/** 四条边各自的中位高程（米）。取边内侧 8 格，避开最外一圈的数据异常 */
function sideMedians(h, n) {
  const K = 8;
  const bucket = { 北: [], 南: [], 西: [], 东: [] };
  for (let k = K; k < n - K; k++) {
    bucket["北"].push(h(k, K));
    bucket["南"].push(h(k, n - 1 - K));
    bucket["西"].push(h(K, k));
    bucket["东"].push(h(n - 1 - K, k));
  }
  const med = (a) => {
    a.sort((x, y) => x - y);
    return a[a.length >> 1];
  };
  return {
    北: Math.round(med(bucket["北"])),
    南: Math.round(med(bucket["南"])),
    西: Math.round(med(bucket["西"])),
    东: Math.round(med(bucket["东"]))
  };
}

{
  /**
   * 每类的形状要求。数字是**实测值留出的余量**，不是抄实测值：
   * 实测（v2.4.5） 山地 −447 / 丘陵 −49 / 盆地 +86，阈值取在实测再往下 1~2 档，
   * 这样"以后微调形状"不会天天红，但"退回平地上放包"一定会红。
   */
  const SHAPE = {
    tpl_mountain: {
      // ⚠️ **v2.4.6 起这条不适用**（`minSideAboveCore: null`）。原因：它问的是
      // "基座面有没有塌成平原"，但**中心格在新构图里落在峰顶上**（实测 5571 m），
      // 于是"最低边 − 中心"恒等于 −4429 m，与基座是否倾斜**毫无关系**。
      // v2.4.4~v2.4.5 中心格在基座上（1297 m 量级）时它才有意义。
      minSideAboveCore: null,
      // ⚠️ **v2.4.6 删掉了"四边高差"这一条**（原来 ≥600 m）。
      // 量出来的原因：它**量错了东西**。拿 v2.4.4（用户嫌丑的那版）与 v2.4.6 实测对比：
      //   四边高差   132 m  vs  103 m   ← 几乎一样，两版都过不了 600
      //   峰高出基座 2903 m  vs  5168 m  ← 差 1.8 倍，这才是"山体够高大"的量
      // v2.4.5 那个"平面斜坡基座"（四边高差 1625 m）确实达到了 600，
      // 但它换来的是**两条高轴 + 四个低角**（用户看到的"马鞍"）——
      // 为了让这一条判据绿而把基座做成马鞍，是**判据反向约束形状**（本项目的老坑）。
      // 所以改成直接量"山体多高"：
      sideSpreadMin: null,
      /** v2.4.6 新增：峰顶高出四边中位至少这么多米。
       *  ⚠ **v2.5.0：4200 → 3400**。构图从「一道垄上的两个鼓包」改成
       *  「两座独立山」后，山体不再铺满图幅（占比 48.7% → **30.6%**），
       *  四边均值因此从 1972 m 降到 1201 m，
       *  实测「峰顶高出四边均值」从 4759 m 降到 **3678 m**。
       *  这不是山变矮了（峰顶 4879 m 仍比四边高 3678 m），
       *  而是**图幅四周本来就是平地的面积变大了**。
       *  3400 m 是实测值的 92%，留一点余量；判据的本意（别退化成
       *  「平地上的两个包」）仍然守得住 —— 平地上的包高差只有几百米。 */
      riseAboveEdgeMin: 3400,
      why: "两座山要够高大 ⇒ 峰顶高高在基座之上（不再是'平地上的两个包'）"
    },
    tpl_hill: {
      // 丘陵最矮那条边可以略低于中心（实测 −49 m），但不能塌成平地
      minSideAboveCore: -300,
      // 梁有走向 ⇒ 四边不等高（实测 442−369 = 73 m；改前只有 2 m）
      sideSpreadMin: 40,
      why: "TILT 缓倾斜基面 ⇒ 四边有 40 m 以上的起伏，梁才有连续顶面"
    },
    tpl_basin: {
      // 盆地必须"中间低四周高"：**最矮那条边也要高于中心**（实测 +86 m）
      minSideAboveCore: 40,
      // 四边大致齐平（盆缘是环）——这里**不设下限**，盆缘本来就应该比较均匀
      sideSpreadMin: null,
      why: "四周都要高于中心，这是'盆地'最直观的判据；环的均匀性由上面第 6 节的判型守住"
    }
  };

  for (const s of TPL) {
    const rule = SHAPE[s.tag];
    const field = dem.createField(s);
    const h = dem.heightFn(field);
    const n = field.grid;
    const core = h(n >> 1, n >> 1);
    const sides = sideMedians(h, n);
    const minSide = Math.min(sides["北"], sides["南"], sides["西"], sides["东"]);
    const spread = Math.max(sides["北"], sides["南"], sides["西"], sides["东"]) - minSide;
    const detail =
      `中心 ${Math.round(core)} m · 四边 北${sides["北"]} 南${sides["南"]} ` +
      `西${sides["西"]} 东${sides["东"]} · 最低边−中心 ${Math.round(minSide - core)} m`;

    if (rule.minSideAboveCore !== null) {
      check(
        `[${s.name}] 最矮那条边相对中心：${rule.minSideAboveCore} m（${rule.why}）`,
        minSide - core >= rule.minSideAboveCore,
        detail
      );
    }
    if (rule.sideSpreadMin !== null) {
      check(
        `[${s.name}] 四边高差（最宽−最窄）≥ ${rule.sideSpreadMin} m（有背坡 / 有梁走向）`,
        spread >= rule.sideSpreadMin,
        `实测 ${spread} m · ${detail}`
      );
    }
    if (rule.riseAboveEdgeMin !== undefined) {
      // v2.4.6 新增：量"山体多高大"而不是"基座是否倾斜"（理由见 SHAPE 里的注释）。
      // 峰顶取全图最高（两座山取更高的那座），四边中位取 `sideMedians` 的中位数。
      let peak = -Infinity;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (h(i, j) > peak) peak = h(i, j);
      const edgeMed = sides["北"] + sides["南"] + sides["西"] + sides["东"] >= 0
        ? Math.round((sides["北"] + sides["南"] + sides["西"] + sides["东"]) / 4)
        : 0;
      const rise = peak - edgeMed;
      check(
        `[${s.name}] 峰顶高出四边均值 ≥ ${rule.riseAboveEdgeMin} m（${rule.why}）`,
        rise >= rule.riseAboveEdgeMin,
        `峰顶 ${Math.round(peak)} m · 四边均值 ${edgeMed} m · 高出 ${Math.round(rise)} m`
      );
    }
  }

  /*
   * 盆地专属：**河流出口**必须是盆缘上的最低点（v2.4.5 修好的那个反向 taper）。
   *
   * ⚠️ 这一条是给 `outTaper` 那个 bug 立的牙齿。bug 在时（出口写成 270=北、
   *   `outTaper` 吃弧长）的表现是：正南的环顶 **1319 m 成了全圈最高**，
   *   真正的最低点跑到别处去了。修好后正南 538 m 是全圈最低。
   *   判据写死两件事，缺一不可：
   *     ① **南北对照**：南侧环顶要比北侧低 ≥ 200 m（抓"出口不在南"）；
   *     ② 还要比**全圈其余方位的最高处**低 ≥ 200 m（抓"taper 反了、中心反而最高"）。
   *
   * ⚠️⚠️ 判据 ① 是**注入反证逼出来的**：第一版只写"南侧比其余方位最高处低 200 m"，
   * 注入 `OUTLET.deg: 90 → 270`（出口跑到北边）后它**照样绿**（落差 503 m）——
   * 因为把北侧压低之后，南侧自然就成了"第二低"，绝对判据抓不到"缺口跑哪儿了"。
   * 只有**成对比较**（南 vs 北）才抓得住：注入时实测南 1319 m / 北被压到最低，
   * 南北对照是**负的**，必红。教训与 §47 同源：
   * **"某处比别处低"这种绝对判据，分不出"低的是哪一处"**。
   *
   * "方位写死"依赖网格约定（i 向东、j 向南 ⇒ `atan2` 的 90° 正是南，
   * 见 `src/profile.ts:135`），改约定时这条会红，是故意的。
   */
  const basin = TPL.find((s) => s.tag === "tpl_basin");
  if (basin) {
    const field = dem.createField(basin);
    const h = dem.heightFn(field);
    const n = field.grid;
    const cell = field.spanM / (n - 1);
    const RING_R = 12000; // 与 gen_templates.cjs 的 RING_R 一致（0.60 × 半幅 20000）
    const at = (deg) => {
      const rad = (deg * Math.PI) / 180;
      // 网格约定：i 向东、j 向南（src/profile.ts:135）⇒ atan2(py, px) 的 90° 正是南
      return h(
        Math.round((Math.cos(rad) * RING_R) / cell + n / 2),
        Math.round((Math.sin(rad) * RING_R) / cell + n / 2)
      );
    };
    const south = at(90);
    const north = at(270);
    const others = [0, 15, 30, 45, 60, 75, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 285, 300, 315, 330, 345].map(at);
    const maxOther = Math.max(...others);
    const geo = `南(90°) ${Math.round(south)} m · 北(270°) ${Math.round(north)} m · 其余方位最高 ${Math.round(maxOther)} m`;

    check(
      "[模板盆地] 河流出口在南侧：南侧环顶比北侧低 ≥ 200 m（成对比较才抓得住'缺口跑别处'）",
      north - south >= 200,
      `${geo} · 南北落差 ${Math.round(north - south)} m`
    );
    check(
      "[模板盆地] 河流出口是盆缘的谷：南侧环顶比其余方位最高处低 ≥ 200 m",
      maxOther - south >= 200,
      `${geo} · 落差 ${Math.round(maxOther - south)} m`
    );
    /*
     * ⚠️⚠️ 上面两条**不可互相替代**，两类写错各由一条抓住（注入反证实测，
     * 改 `1 - smoothstep(…)` → `smoothstep(…)` 模拟"taper 方向写反"）：
     *
     *   注入 ①：`OUTLET.deg: 90 → 270`（出口方位写错）
     *     南北对照  南北落差 **−777 m** ⇒ 第 ① 条红 ✔
     *     绝对落差   503 m   ⇒ 第 ② 条**仍绿** ✘
     *   注入 ②：taper 方向写反（缺口被填满）
     *     南北对照  南北落差 **−557 m** ⇒ 第 ① 条红 ✔
     *     绝对落差    **−7 m** ⇒ 第 ② 条红 ✔
     *
     * ⇒ 注入 ② 两条都抓得住，注入 ① 只有第 ① 条抓得住 ⇒ **第 ② 条是冗余的保险**，
     * 不是可有可无。但两条都留着：方位写错是更容易犯的错（改一个常量），
     * 而第 ② 条顺带守住"缺口必须是谷、不能是包"这条形态约束。
     *
     * ⚠️ 还有一条**别高估防线**的实测结论：注入 ② 时
     * `gen_templates.cjs` 的**自检照样 exit=0 通过**（判型 basin 稳住、
     * 起伏 956 m、`suspect` 为 0）—— 别指望"生成器自检"能兜住形态错误，
     * 它守的是"地形是否成立"，**不守"地形是否是对的那个形状"**。
     * 形态正确性只能靠本节这种与判据无关的独立指标（§47、§104 同源）。
     */
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
