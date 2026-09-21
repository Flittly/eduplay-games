/**
 * 太阳直射点曲线（src/subsolar.ts）纯逻辑回归。
 *
 * 这里刻意**不复用实现里的辅助函数去验自己**：
 *  A 段的期望值来自一份独立写的向量式（与三维引擎里那条 `p·AXIS_WORLD` 同构），
 *  用来抓符号写反、ψ 漏掉、ε 用错这类「自己验自己永远绿」的错。
 *
 * 跑法：`npm run test:data`（会先用 rolldown 把 src/subsolar.ts 打成 scripts/_subsolar.cjs）
 */
const g = require("./_subsolar.cjs");

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) {
    pass += 1;
    console.log(`  ✔ ${name}${detail ? "  · " + detail : ""}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  ✘ ${name}${detail ? "  · " + detail : ""}`);
  }
}

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const DEG = Math.PI / 180;

/* ---------------- A 公式：独立向量式对照 ---------------- */
{
  const EPS = g.EARTH_TILT * DEG;
  const PSI = 14 * DEG;
  /** 与引擎同构：太阳方向（地球→太阳）在公转平面内，地轴方向固定，取夹角余角 */
  function declByVector(nuDeg) {
    const nu = nuDeg * DEG;
    const sun = [-Math.cos(nu), 0, Math.sin(nu)];
    const axis = [
      Math.sin(EPS) * Math.cos(PSI),
      Math.cos(EPS),
      Math.sin(EPS) * Math.sin(PSI)
    ];
    const len = Math.hypot(sun[0], sun[1], sun[2]);
    const dot = (sun[0] * axis[0] + sun[1] * axis[1] + sun[2] * axis[2]) / len;
    return Math.asin(Math.max(-1, Math.min(1, dot))) / DEG;
  }

  let worst = 0;
  let worstNu = 0;
  for (let nu = 0; nu <= 360; nu += 5) {
    const d = Math.abs(g.declinationForNu(nu) - declByVector(nu));
    if (d > worst) {
      worst = d;
      worstNu = nu;
    }
  }
  check(
    "解析式与独立向量式（与引擎同构）在 0~360° 全程一致",
    worst < 1e-9,
    `最大偏差 ${worst.toExponential(2)} @ ν=${worstNu}°`
  );

  for (const [nu, want, label] of [
    [76, 0, "春分 直射赤道"],
    [166, g.EARTH_TILT, "夏至 直射北回归线"],
    [256, 0, "秋分 直射赤道"],
    [346, -g.EARTH_TILT, "冬至 直射南回归线"]
  ]) {
    check(`${label}（ν=${nu}°）`, near(g.declinationForNu(nu), want, 1e-9), `${g.declinationForNu(nu).toFixed(4)}°`);
  }

  // 极值必须恰好等于黄赤交角，且落在这四个锚点上：曲线与南北回归线相切是这张图的画法前提
  let maxD = -99;
  let maxNu = 0;
  let minD = 99;
  let minNu = 0;
  for (let nu = 0; nu < 360; nu += 0.25) {
    const d = g.declinationForNu(nu);
    if (d > maxD) {
      maxD = d;
      maxNu = nu;
    }
    if (d < minD) {
      minD = d;
      minNu = nu;
    }
  }
  check("最大值 = 黄赤交角（北回归线）", near(maxD, g.EARTH_TILT, 0.01), `${maxD.toFixed(4)}° @ ν=${maxNu}°`);
  check("最小值 = −黄赤交角（南回归线）", near(minD, -g.EARTH_TILT, 0.01), `${minD.toFixed(4)}° @ ν=${minNu}°`);
  check("极值出现在二至（夏至 166° / 冬至 346°）", near(maxNu, 166, 0.5) && near(minNu, 346, 0.5), `${maxNu}° / ${minNu}°`);

  // 单调区间：春分→夏至 一路北移、夏至→秋分 一路南移（分段线性日期映射的前提）
  let incOk = true;
  let decOk = true;
  for (let nu = 76; nu < 166; nu += 1) {
    if (g.declinationForNu(nu + 1) <= g.declinationForNu(nu)) incOk = false;
  }
  for (let nu = 166; nu < 256; nu += 1) {
    if (g.declinationForNu(nu + 1) >= g.declinationForNu(nu)) decOk = false;
  }
  check("76°→166° 直射点单调北移", incOk);
  check("166°→256° 直射点单调南移", decOk);
  check("周期 360°", near(g.declinationForNu(37), g.declinationForNu(397), 1e-9));
}

/* ---------------- B 日期锚点 ---------------- */
{
  check("春分 = 3月21日（年内第 79 天）", g.formatDayOfYear(g.nuToDay(76)) === "3月21日", g.formatDayOfYear(g.nuToDay(76)));
  check("夏至 = 6月22日", g.formatDayOfYear(Math.round(g.nuToDay(166))) === "6月22日", g.formatDayOfYear(Math.round(g.nuToDay(166))));
  check("秋分 = 9月23日", g.formatDayOfYear(Math.round(g.nuToDay(256))) === "9月23日", g.formatDayOfYear(Math.round(g.nuToDay(256))));
  check("冬至 = 12月22日", g.formatDayOfYear(Math.round(g.nuToDay(346))) === "12月22日", g.formatDayOfYear(Math.round(g.nuToDay(346))));

  check("formatDayOfYear(0) = 1月1日", g.formatDayOfYear(0) === "1月1日", g.formatDayOfYear(0));
  check("formatDayOfYear(364) = 12月31日", g.formatDayOfYear(364) === "12月31日", g.formatDayOfYear(364));

  let mono = true;
  let worstRound = 0;
  for (let nu = 0; nu <= 360; nu += 1) {
    const d0 = g.nuToDay(nu);
    const d1 = g.nuToDay(Math.min(360, nu + 1));
    if (d1 < d0 - 1e-9) mono = false;
    const back = g.dayToNu(d0);
    // 分段线性 + 端点夹紧 ⇒ 往返残差只会出现在 360°（≡0°）那一处
    const err = nu === 360 ? Math.min(Math.abs(back - nu), Math.abs(back - 0)) : Math.abs(back - nu);
    if (err > worstRound) worstRound = err;
  }
  check("ν → 日期 单调不减", mono);
  check("ν ↔ 日期 往返误差 < 0.01°", worstRound < 0.01, `最大 ${worstRound.toExponential(2)}°`);

  // 这一条是「为什么夏半年比冬半年长」——曲线背后的真实轨道不均匀性
  const spring = g.nuToDay(76);
  const autumn = g.nuToDay(256);
  const summerHalf = autumn - spring;
  const winterHalf = g.YEAR_DAYS - summerHalf;
  check(
    "夏半年（春分→秋分）比冬半年多约一周",
    summerHalf > winterHalf && Math.abs(summerHalf - 186) < 3,
    `${summerHalf.toFixed(0)} 天 vs ${winterHalf.toFixed(0)} 天`
  );
  check("一年总天数 ≈ 365", Math.abs(g.YEAR_DAYS - 365) <= 1, `${g.YEAR_DAYS} 天`);
}

/* ---------------- C 画布映射 ---------------- */
{
  const box = g.SUBSOLAR_PLOT;
  check("ν=0° 贴绘图区左边缘", near(g.nuToX(0, box), box.x, 1e-9));
  check("ν=360° 贴绘图区右边缘", near(g.nuToX(360, box), box.x + box.w, 1e-9));
  check("北回归线贴绘图区上边缘", near(g.declToY(g.EARTH_TILT, box), box.y, 1e-9));
  check("南回归线贴绘图区下边缘", near(g.declToY(-g.EARTH_TILT, box), box.y + box.h, 1e-9));
  check("赤道在绘图区正中", near(g.declToY(0, box), box.y + box.h / 2, 1e-9));

  let worstX = 0;
  for (let nu = 0; nu <= 360; nu += 3) {
    worstX = Math.max(worstX, Math.abs(g.xToNu(g.nuToX(nu, box), box) - nu));
  }
  check("x → ν 往返一致", worstX < 1e-9, `最大 ${worstX.toExponential(2)}°`);
  check("点画布左外侧夹到 0°", g.xToNu(box.x - 50, box) === 0);
  check("点画布右外侧夹到 360°", g.xToNu(box.x + box.w + 50, box) === 360);

  // 拖动分辨率（v1.4.7 起曲线可拖）：横轴上 1 个 SVG 单位对应多少度，
  // 这是"拖着走"的手感下限 —— 步子太大，手一动就跳好几度，看着像卡帧；
  // 而且曲线在二至附近是平的（导数≈0），步子太大会把极值直接跨过去。
  // ⚠ 断言上限用 4° 是因为绘图区只有 128 单位宽：360/128 ≈ 2.81°，
  //   留给"以后有人把图改窄"的余量，但窄到 90 单位（4.0°/单位）就该有人来问一句。
  const perUnit = 360 / box.w;
  let maxStep = 0;
  for (let x = box.x; x < box.x + box.w; x += 1) {
    maxStep = Math.max(maxStep, Math.abs(g.xToNu(x + 1, box) - g.xToNu(x, box)));
  }
  check("1 个 SVG 单位 = 360/绘图区宽（横轴是线性映射）", near(maxStep, perUnit, 1e-9), `${maxStep.toFixed(4)}°/单位`);
  check("单步 1 单位 < 4°（拖得动且不跳格）", maxStep < 4, `${maxStep.toFixed(2)}°/单位`);

  const chart = g.buildSubsolarChart(box, g.SUBSOLAR_TICK_FONT);
  check("曲线采样 361 点（1° 一步）", chart.points.length === 361, `${chart.points.length} 点`);
  const outOfBox = chart.points.filter(
    (p) => p.x < box.x - 1e-9 || p.x > box.x + box.w + 1e-9 || p.y < box.y - 1e-9 || p.y > box.y + box.h + 1e-9
  );
  check("全部采样点落在绘图区内（不会画到刻度行/留白上）", outOfBox.length === 0, `${outOfBox.length} 个越界`);

  const ys = chart.points.map((p) => p.y);
  const refs = chart.refLines;
  check("参考线自上而下：北回归线 < 赤道 < 南回归线", refs[0].y < refs[1].y && refs[1].y < refs[2].y);
  check(
    "曲线**相切**于两条回归线（极值 y 与参考线重合）",
    near(Math.min(...ys), refs[0].y, 0.02) && near(Math.max(...ys), refs[2].y, 0.02),
    `${Math.min(...ys).toFixed(2)} / ${refs[0].y.toFixed(2)} … ${Math.max(...ys).toFixed(2)} / ${refs[2].y.toFixed(2)}`
  );
  check("路径以 M 开头且含 360 段 L", chart.path.startsWith("M") && (chart.path.match(/L/g) || []).length === 360);
  // 128px 宽的图上 0.01px 无意义：留 2 位小数即可，但**不许有 3 位以上**（体积会翻倍）
  check(
    "路径坐标只保留 2 位小数",
    !/\.\d{3,}/.test(chart.path) && /^-?\d+\.\d{2},/.test(chart.path.slice(1)),
    `前 24 字符「${chart.path.slice(0, 24)}」，全长 ${chart.path.length}`
  );
}

/* ---------------- D 刻度与文字排布 ---------------- */
{
  const box = g.SUBSOLAR_PLOT;
  const chart = g.buildSubsolarChart(box, g.SUBSOLAR_TICK_FONT);
  check("刻度为二分二至四条", chart.ticks.length === 4, chart.ticks.map((t) => t.label).join("/"));
  check(
    "刻度 x 从左到右递增",
    chart.ticks.every((t, i) => i === 0 || t.x > chart.ticks[i - 1].x)
  );
  check(
    "刻度点落在曲线上（与采样点同高）",
    chart.ticks.every((t) => {
      const near1 = chart.points.reduce((a, b) => (Math.abs(b.nu - t.nu) < Math.abs(a.nu - t.nu) ? b : a));
      return Math.abs(near1.y - t.y) < 0.05;
    })
  );

  // 「不重叠」必须逐对比**各自的半宽之和**：最短的「0°」本来就可以挨得紧，
  // 拿「最小间距 vs 最宽标签」比会得出假结论
  let minSlack = 999;
  let tight = "";
  for (let i = 1; i < chart.ticks.length; i += 1) {
    const a = chart.ticks[i - 1];
    const b = chart.ticks[i];
    const slack = b.x - b.halfWidth - (a.x + a.halfWidth);
    if (slack < minSlack) {
      minSlack = slack;
      tight = `${a.label}↔${b.label}`;
    }
  }
  check("相邻刻度文字不重叠", minSlack > 0.8, `最紧一对 ${tight} 余量 ${minSlack.toFixed(1)}px`);

  const overflow = chart.ticks.filter(
    (t) => t.x - t.halfWidth < 0 || t.x + t.halfWidth > g.SUBSOLAR_SVG.w
  );
  check(
    "刻度文字都在画布内（第一个/最后一个不会被裁掉）",
    overflow.length === 0,
    overflow.length ? overflow.map((t) => t.label).join("/") : `最宽「${chart.ticks[3].label}」右沿 ${(chart.ticks[3].x + chart.ticks[3].halfWidth).toFixed(1)} / 画布 ${g.SUBSOLAR_SVG.w}`
  );

  const refLabelW = Math.max(...chart.refLines.map((r) => g.labelWidth(r.label, g.SUBSOLAR_REF_FONT)));
  check(
    "参考线文字塞得进左侧留白（不压到绘图区）",
    refLabelW <= box.x - 3,
    `最宽「23.5°N」${refLabelW.toFixed(1)}px / 留白 ${box.x - 3}px`
  );

  check("绘图区 + 右侧余量不超出画布", box.x + box.w <= g.SUBSOLAR_SVG.w - 4, `${box.x + box.w} / ${g.SUBSOLAR_SVG.w}`);
  check("绘图区 + 刻度行不超出画布", box.y + box.h + 16 <= g.SUBSOLAR_SVG.h, `${box.y + box.h + 16} / ${g.SUBSOLAR_SVG.h}`);
}

/* ---------------- E 当前点与最近节气 ---------------- */
{
  const box = g.SUBSOLAR_PLOT;
  const chart = g.buildSubsolarChart(box, g.SUBSOLAR_TICK_FONT);
  for (const tick of chart.ticks) {
    const cur = g.currentPoint(tick.nu, box);
    check(`当前点与「${tick.label}」刻度重合`, near(cur.x, tick.x, 0.01) && near(cur.y, tick.y, 0.01), `(${cur.x.toFixed(2)},${cur.y.toFixed(2)})`);
  }

  check("ν=166° 正处夏至", g.nearestSeason(166).mark.label === "夏至" && g.nearestSeason(166).distance < 1e-9);
  check("ν=0° 最近冬至（环形距离 14°）", g.nearestSeason(0).mark.label === "冬至", `${g.nearestSeason(0).distance.toFixed(1)}°`);
  check("ν=90° 最近春分", g.nearestSeason(90).mark.label === "春分", `${g.nearestSeason(90).distance.toFixed(1)}°`);
  check("ν=360° 与 ν=0° 同解（环形）", g.nearestSeason(360).mark.key === g.nearestSeason(0).mark.key);

  const cur = g.currentPoint(360, box);
  check("ν=360° 的当前点回到绘图区右边缘", near(cur.x, box.x + box.w, 1e-9), `${cur.x.toFixed(2)}`);
}

console.log(`\n===== 太阳直射点曲线：${pass} 项通过 / ${fail} 项失败 =====`);
if (fail > 0) {
  console.log("失败项：\n - " + failures.join("\n - "));
  process.exit(1);
}
