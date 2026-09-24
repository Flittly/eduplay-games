/**
 * 径流（D8 流向 + 流量累积）的纯逻辑测试。
 *
 * D8 这类算法最容易出的错是「水流向上坡」和「累积量发散」——
 * 两者都不会让程序崩，只会让河流画到山脊上或让数值爆掉。
 * 所以这里最重的两部分断言是：
 *   ① 每一条流向都必须朝下；
 *   ② 汇流量沿流向单调不减，且总量守恒。
 */
const ro = require("./_runoff.cjs");
const dem = require("./_dem.cjs");
const zd = require("./_zonation.cjs");
const data = require("./_data.cjs");

const checks = [];
const check = (name, cond, extra) => {
  checks.push({ name, ok: Boolean(cond), extra: extra === undefined ? "" : String(extra) });
};

// 点名取贡嘎山，别用 DEM_SOURCES[0]：v2.4.0 把模板地形排到了最前，
// 下标语义会随清单顺序漂移（同一个坑在 contour.test.cjs 也踩过）。
const field = dem.createField(data.sourceByTag("gongga"));
const GRID = field.grid;

/* ===== 1) 无雨：不该有任何产流 ===== */
{
  const dry = ro.buildRunoff(field, field.source.lat, "summer", 0);
  check("无雨时没有河道", dry.channels.length === 0, `${dry.channels.length} 段`);
  check("无雨时降雨强度记录为 0", dry.rain === 0, dry.rain);
  check("无雨时汇流量全为 0", dry.maxAcc === 0, dry.maxAcc);
  check("无雨时的读数文案是「无降雨」", /无降雨/.test(ro.runoffSummary(dry)), ro.runoffSummary(dry));
}

/* ===== 2) 小雨 / 大雨：都要真的产出河道 ===== */
const light = ro.buildRunoff(field, field.source.lat, "summer", 0.45);
const heavy = ro.buildRunoff(field, field.source.lat, "summer", 1);

check("小雨能形成河道", light.channels.length > 0, `${light.channels.length} 段`);
check("大雨能形成河道", heavy.channels.length > 0, `${heavy.channels.length} 段`);
check("大雨的河道数 ≥ 小雨（阈值降低后支流更多）",
  heavy.channels.length >= light.channels.length,
  `小雨 ${light.channels.length} → 大雨 ${heavy.channels.length}`);
check("大雨的河网总长 ≥ 小雨",
  heavy.channelLengthM >= light.channelLengthM,
  `${(light.channelLengthM / 1000).toFixed(1)} → ${(heavy.channelLengthM / 1000).toFixed(1)} km`);
check("大雨的总产流量 > 小雨",
  heavy.totalProduced > light.totalProduced,
  `${light.totalProduced.toFixed(0)} → ${heavy.totalProduced.toFixed(0)}`);
check("降雨强度真的被记录下来了", light.rain > 0 && heavy.rain > light.rain,
  `${light.rain} → ${heavy.rain}`);

/* ===== 3) 关键不变式：每一条流向都必须朝下 ===== */
for (const [label, net] of [["小雨", light], ["大雨", heavy]]) {
  let upslope = 0;
  let selfLoop = 0;
  let outOfRange = 0;
  let considered = 0;
  for (let k = 0; k < net.down.length; k++) {
    const d = net.down[k];
    if (d < 0) {
      continue;
    }
    considered++;
    if (d === k) {
      selfLoop++;
    }
    if (d < 0 || d >= GRID * GRID) {
      outOfRange++;
    }
    if (!(field.alt[d] < field.alt[k])) {
      upslope++;
    }
  }
  check(`[${label}] 不存在「水流向上坡」的格子`, upslope === 0, `${upslope} / ${considered} 个违规`);
  check(`[${label}] 不存在自环流向`, selfLoop === 0, `${selfLoop} 个`);
  check(`[${label}] 下游索引全部在网格范围内`, outOfRange === 0, `${outOfRange} 个`);
}

/* ===== 4) 关键不变式：汇流量沿流向单调不减、且总量守恒 ===== */
{
  let decreases = 0;
  let compared = 0;
  for (let k = 0; k < heavy.down.length; k++) {
    const d = heavy.down[k];
    if (d < 0) {
      continue;
    }
    compared++;
    if (heavy.acc[d] + 1e-6 < heavy.acc[k]) {
      decreases++;
    }
  }
  check("汇流量沿流向单调不减（下游一定 ≥ 上游）", decreases === 0, `${decreases} / ${compared} 个违规`);

  // 总量守恒：所有「无出流」格子的汇流量之和 = 所有格子的产流量之和
  let sinkSum = 0;
  for (let k = 0; k < heavy.down.length; k++) {
    if (heavy.down[k] < 0) {
      sinkSum += heavy.acc[k];
    }
  }
  const rel = Math.abs(sinkSum - heavy.totalProduced) / Math.max(1, heavy.totalProduced);
  check("水量守恒：所有汇（无出流格子）之和 = 总产流量", rel < 1e-4,
    `汇 ${sinkSum.toFixed(1)} vs 产 ${heavy.totalProduced.toFixed(1)}（相对差 ${(rel * 100).toFixed(3)}%）`);

  check("maxAcc 就是 acc 的最大值",
    Math.abs(Math.max(...heavy.acc) - heavy.maxAcc) < 1e-6, heavy.maxAcc);
  check("河道格子全部在阈值之上",
    [...heavy.channels].every((k) => heavy.acc[k] >= heavy.maxAcc * 0.006 - 1e-6),
    `最高汇流量 ${heavy.maxAcc.toFixed(0)}`);
}

/* ===== 5) 雪线以上不产流 ===== */
{
  const lat = field.source.lat;
  const snowNow = zd.snowline(lat, "summer");
  const above = zd.beltAt(lat, snowNow + 200, "summer") === "snow";
  check("雪线以上被判定为冰雪带", above, `雪线 ${Math.round(snowNow)} m`);

  // 把整座山抬到雪线之上，产流应当归零
  const lifted = dem.createField(field.source);
  dem.applyElevation(lifted, 1, 3000); // 贡嘎 2204~7414 → 5204~10414，整座山都在雪线（4608 m）之上
  const net = ro.buildRunoff(lifted, lat, "summer", 1);
  check("（对照）抬升前产流量远大于 0", heavy.totalProduced > 0, heavy.totalProduced.toFixed(0));
  check("整座山抬到雪线之上后产流量归零", net.totalProduced === 0, net.totalProduced);
  // 这一条正是回归守卫：阈值是 maxAcc 的比例，maxAcc = 0 时阈值也是 0，
  // 若不加 maxAcc > 0 守卫，`acc[k] >= 0` 恒真 → 全部 65536 格都会被判成河道。
  check("全山在雪线以上时不该把整张网格都判成河道",
    net.channels.length === 0,
    `河道 ${heavy.channels.length} → ${net.channels.length}（网格 ${GRID * GRID}）`);
  check("此时的读数说明是「降水以固态为主」而不是「无降雨」",
    /固态/.test(ro.runoffSummary(net)) && !/无降雨/.test(ro.runoffSummary(net)),
    ro.runoffSummary(net));
}

/* ===== 6) 植被越稀疏，产流越强 ===== */
{
  // --- 6a) prod 接线：逐格必须等于 runoffWeight × 实际降雨强度 ---
  const net = ro.buildRunoff(field, field.source.lat, "summer", 1);
  let wired = 0;
  for (let k = 0; k < field.alt.length; k++) {
    const want = zd.runoffWeight(field.source.lat, field.alt[k], "summer", field.maxH) * net.rain;
    if (Math.abs(net.prod[k] - want) > 1e-6) wired++;
  }
  check("逐格产流权重 = runoffWeight × 降雨强度（接线无遗漏）", wired === 0, `${wired} 格不符`);

  // --- 6b) 纬度对照 ---
  // 必须选一座「在对照的两个纬度下都完全落在雪线以下」的山，否则雪带效应
  // 会盖过植被效应：早先拿贡嘎山 10°N vs 55°N 做对照，55°N 雪线只有 2946 m，
  // 而贡嘎山顶 7414 m，97.8% 的格子都在雪线之上、产流权重直接归零，
  // 结果测出来的是"雪带面积"而不是"植被稀疏度"。
  //
  // 太白山山顶 3743 m：10°N 雪线 5289 m、40°N 雪线 4011 m，两端都是 0% 越线。
  // ⚠️ 也不要写成 `DEM_SOURCES[3]`：v2.4.0 插入三个模板后下标 3 已不是太白山。
  const tall = dem.createField(data.sourceByTag("taibai")); // 太白山
  const latLow = 10;
  const latHigh = 40;
  const snowLow = zd.snowline(latLow, "summer");
  const snowHigh = zd.snowline(latHigh, "summer");
  let aboveLow = 0;
  let aboveHigh = 0;
  for (let k = 0; k < tall.alt.length; k++) {
    if (tall.alt[k] >= snowLow) aboveLow++;
    if (tall.alt[k] >= snowHigh) aboveHigh++;
  }
  check("对照前提成立：两个纬度下都没有格子高于雪线",
    aboveLow === 0 && aboveHigh === 0,
    `10°N ${aboveLow} 格 / 40°N ${aboveHigh} 格（雪线 ${snowLow.toFixed(0)} / ${snowHigh.toFixed(0)} m，山顶 3743 m）`);

  const nLow = ro.buildRunoff(tall, latLow, "summer", 1);
  const nHigh = ro.buildRunoff(tall, latHigh, "summer", 1);
  const perLow = nLow.totalProduced / Math.max(1e-9, nLow.rain);
  const perHigh = nHigh.totalProduced / Math.max(1e-9, nHigh.rain);
  check("同一地形下，高纬（同海拔落入更冷、更稀疏的带）产流更强",
    perHigh > perLow,
    `10°N ${perLow.toFixed(0)} vs 40°N ${perHigh.toFixed(0)}`);

  // --- 6c) 单调性：纬度越高产流越强（10 < 20 < 30 < 40） ---
  const seq = [10, 20, 30, 40].map((lat) => {
    const n = ro.buildRunoff(tall, lat, "summer", 1);
    return n.totalProduced / Math.max(1e-9, n.rain);
  });
  let mono = true;
  for (let i = 1; i < seq.length; i++) if (seq[i] <= seq[i - 1]) mono = false;
  check("产流强度随纬度单调递增", mono, seq.map((v) => v.toFixed(0)).join(" → "));

  // --- 6d) 垂直对照（同一座山、同一纬度）：高寒带裸地比森林带产流强得多 ---
  const forests = new Set(["evergreen", "deciduous", "mixed", "conifer"]);
  let forestSum = 0;
  let forestN = 0;
  let alpineSum = 0;
  let alpineN = 0;
  for (let k = 0; k < tall.alt.length; k++) {
    const belt = zd.beltAt(latHigh, tall.alt[k], "summer");
    const w = zd.runoffWeight(latHigh, tall.alt[k], "summer", tall.maxH);
    if (forests.has(belt)) {
      forestSum += w;
      forestN++;
    } else if (belt === "meadow" || belt === "desert") {
      alpineSum += w;
      alpineN++;
    }
  }
  const forestMean = forestN ? forestSum / forestN : -1;
  const alpineMean = alpineN ? alpineSum / alpineN : -1;
  check("森林带与高寒带都存在（对照有效）", forestN > 0 && alpineN > 0, `林 ${forestN} / 高寒 ${alpineN}`);
  check("高寒裸地带的产流权重显著高于森林带",
    alpineMean > forestMean + 0.2,
    `林 ${forestMean.toFixed(3)} vs 高寒 ${alpineMean.toFixed(3)}`);
}

/* ===== 7) 季节：降水强度差异要体现在产流上 ===== */
{
  const summer = ro.buildRunoff(field, field.source.lat, "summer", 1);
  const winter = ro.buildRunoff(field, field.source.lat, "winter", 1);
  check("夏季降水强度 > 冬季", ro.SEASON_RAIN.summer > ro.SEASON_RAIN.winter,
    `${ro.SEASON_RAIN.summer} vs ${ro.SEASON_RAIN.winter}`);
  check("夏季产流量 > 冬季", summer.totalProduced > winter.totalProduced,
    `${summer.totalProduced.toFixed(0)} vs ${winter.totalProduced.toFixed(0)}`);
}

/* ===== 8) 河道应当落在山谷里，而不是山脊上 ===== */
{
  const n = GRID;
  let inValley = 0;
  let total = 0;
  for (const k of heavy.channels) {
    const i = k % n;
    const j = Math.floor(k / n);
    if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) {
      continue;
    }
    let sum = 0;
    let cnt = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue;
        sum += field.alt[(j + dj) * n + (i + di)];
        cnt++;
      }
    }
    total++;
    if (field.alt[k] < sum / cnt) {
      inValley++;
    }
  }
  const ratio = total ? inValley / total : 0;
  check("河道格子绝大多数低于其八邻域平均（真的在山谷里）", ratio > 0.85,
    `${(ratio * 100).toFixed(1)}% （${inValley}/${total}）`);
}

/* ===== 9) channelSegments：线段与河道一一对应，且不越界 ===== */
{
  const segs = ro.channelSegments(heavy, GRID);
  check("channelSegments 返回 4 的整数倍长度", segs.length % 4 === 0, segs.length);
  let bad = 0;
  for (let k = 0; k < segs.length; k += 4) {
    for (const v of [segs[k], segs[k + 1], segs[k + 2], segs[k + 3]]) {
      if (!Number.isFinite(v) || v < 0 || v > GRID - 1) {
        bad++;
      }
    }
  }
  check("channelSegments 坐标全部合法", bad === 0, `${bad} 个越界值`);
  check("无雨时 channelSegments 为空",
    ro.channelSegments(ro.buildRunoff(field, 30, "summer", 0), GRID).length === 0);

  // 每一条线段必须连接两个河道格子，且两点相邻（八邻域之内）
  const isCh = new Uint8Array(GRID * GRID);
  for (const k of heavy.channels) {
    isCh[k] = 1;
  }
  let notChannel = 0;
  let tooFar = 0;
  for (let k = 0; k < segs.length; k += 4) {
    const a = segs[k + 1] * GRID + segs[k];
    const b = segs[k + 3] * GRID + segs[k + 2];
    if (!isCh[a] || !isCh[b]) {
      notChannel++;
    }
    if (Math.abs(segs[k + 2] - segs[k]) > 1 || Math.abs(segs[k + 3] - segs[k + 1]) > 1) {
      tooFar++;
    }
  }
  check("每条线段两端都是河道格子", notChannel === 0, `${notChannel} 条异常`);
  check("每条线段的两点都在八邻域内（不会跨越整个网格）", tooFar === 0, `${tooFar} 条异常`);
}

/* ===== 10) 读数文案 ===== */
{
  const text = ro.runoffSummary(heavy);
  check("读数里带「河网总长」「干流」", /河网总长/.test(text) && /干流/.test(text), text);
  check("干流长度 ≤ 河网总长", heavy.trunkLengthM <= heavy.channelLengthM + 1e-6,
    `${(heavy.trunkLengthM / 1000).toFixed(1)} ≤ ${(heavy.channelLengthM / 1000).toFixed(1)}`);
  check("干流长度 > 0", heavy.trunkLengthM > 0, `${(heavy.trunkLengthM / 1000).toFixed(1)} km`);
}

/* ===== 11) 规模合理性（真实 30 km 山体该有的量级） ===== */
{
  check("河网总长在 50~4000 km 之间（真实山地的合理量级）",
    heavy.channelLengthM / 1000 > 50 && heavy.channelLengthM / 1000 < 4000,
    `${(heavy.channelLengthM / 1000).toFixed(1)} km`);
  check("干流长度在 5~80 km 之间", heavy.trunkLengthM / 1000 > 5 && heavy.trunkLengthM / 1000 < 80,
    `${(heavy.trunkLengthM / 1000).toFixed(1)} km`);
  check("河道段数远小于网格总数（河网是稀疏的）",
    heavy.channels.length < GRID * GRID * 0.25,
    `${heavy.channels.length} / ${GRID * GRID}`);
}

/* ===== 汇总 ===== */
const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "✔" : "✘"} ${c.name}${c.extra ? `  ${c.extra}` : ""}`);
}
console.log(`\nRUNOFF CHECK ${failed.length === 0 ? "PASSED ✔" : "FAILED ✘"}  断言 ${checks.length} 项，失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
