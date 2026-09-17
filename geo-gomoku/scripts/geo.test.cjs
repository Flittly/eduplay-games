/**
 * 经纬度五子棋 · 坐标与棋盘范围的纯逻辑测试。
 *
 * 断言策略（照本项目惯例）：**从"期望行为"写，不从实现抄**。
 * 这里最能说明问题的一类断言是 **自洽断言**——
 * 例如「系统自己给出的示例坐标，必须能被系统自己解析回原值」，
 * 以及「全窗口遍历下经纬度 → 行列 → 经纬度必须回到原点」。
 * 这类断言不依赖任何手写常量，一旦哪一环算错就必然红。
 *
 * 另一类是**手算断言**：窗口枚举的档数、跨度、半球归属都能用纸笔数出来
 * （23 / 59 / 70° / 5 等），写死数字反而比"跑一遍看非空"更能证明算对了。
 */
const g = require("./_geo.cjs");

const checks = [];
const check = (name, cond, extra) => {
  checks.push({ name, ok: Boolean(cond), extra: extra === undefined ? "" : String(extra) });
};

const latBottom = g.latBottom;
const lonRight = g.lonRight;

/* ===================== 1) 窗口枚举与四象限覆盖 ===================== */
{
  check("纬度窗口共 23 档", g.LAT_TOPS.length === 23, g.LAT_TOPS.length);
  check("经度窗口共 59 档", g.LON_LEFTS.length === 59, g.LON_LEFTS.length);
  check(
    "纬度窗口上沿从 90°N 到 20°S、步长 5°",
    g.LAT_TOPS[0] === 90 && g.LAT_TOPS[g.LAT_TOPS.length - 1] === -20,
    `${g.LAT_TOPS[0]} … ${g.LAT_TOPS[g.LAT_TOPS.length - 1]}`
  );
  check(
    "经度窗口左沿从 180°W 到 110°E、步长 5°",
    g.LON_LEFTS[0] === -180 && g.LON_LEFTS[g.LON_LEFTS.length - 1] === 110,
    `${g.LON_LEFTS[0]} … ${g.LON_LEFTS[g.LON_LEFTS.length - 1]}`
  );
  check(
    "每档纬度窗口跨度恰好 70°",
    g.LAT_TOPS.every((top) => top - latBottom({ latTop: top }) === 70)
  );
  check(
    "每档经度窗口跨度恰好 70°",
    g.LON_LEFTS.every((left) => lonRight({ lonLeft: left }) - left === 70)
  );

  // 三种纬度情形都要能出现，否则"加南纬"就是假加。
  const latAllNorth = g.LAT_TOPS.filter((t) => latBottom({ latTop: t }) >= 0);
  const latStraddle = g.LAT_TOPS.filter(
    (t) => t > 0 && latBottom({ latTop: t }) < 0
  );
  const latAllSouth = g.LAT_TOPS.filter((t) => t <= 0);
  check("整块在北纬的窗口有 5 档", latAllNorth.length === 5, latAllNorth.join(","));
  check("跨赤道的窗口有 13 档", latStraddle.length === 13, latStraddle.length);
  check("整块在南纬的窗口有 5 档", latAllSouth.length === 5, latAllSouth.join(","));
  check(
    "三种纬度情形覆盖了全部 23 档、无遗漏无重叠",
    latAllNorth.length + latStraddle.length + latAllSouth.length === 23
  );

  const lonAllEast = g.LON_LEFTS.filter((l) => l >= 0);
  const lonStraddle = g.LON_LEFTS.filter((l) => l < 0 && lonRight({ lonLeft: l }) > 0);
  const lonAllWest = g.LON_LEFTS.filter((l) => lonRight({ lonLeft: l }) <= 0);
  check("整块在东经的窗口有 23 档", lonAllEast.length === 23, lonAllEast.length);
  check("跨本初子午线的窗口有 13 档", lonStraddle.length === 13, lonStraddle.join(","));
  check("整块在西经的窗口有 23 档", lonAllWest.length === 23, lonAllWest.length);
  check(
    "三种经度情形覆盖了全部 59 档、无遗漏无重叠",
    lonAllEast.length + lonStraddle.length + lonAllWest.length === 59
  );

  // 关键边界：窗口绝不能跨越 180° 经线，否则"lonLeft 最小"这条不变式会断。
  check(
    "所有经度窗口的右沿都不超过 180°E（不跨换日线）",
    g.LON_LEFTS.every((l) => lonRight({ lonLeft: l }) <= 180),
    `最大右沿 ${Math.max(...g.LON_LEFTS.map((l) => lonRight({ lonLeft: l })))}`
  );
  check(
    "所有经度窗口的左沿都不小于 180°W",
    g.LON_LEFTS.every((l) => l >= -180),
    `最小左沿 ${Math.min(...g.LON_LEFTS)}`
  );
  check(
    "所有纬度窗口都在 ±90° 内",
    g.LAT_TOPS.every(
      (t) => t <= 90 && latBottom({ latTop: t }) >= -90
    ),
    `${g.LAT_TOPS[0]} / ${latBottom({ latTop: g.LAT_TOPS[g.LAT_TOPS.length - 1] })}`
  );

  // 不能把老版本能开的棋盘弄丢：旧的北纬-only 与东经-only 窗口必须仍然存在。
  const oldLatTops = [70, 75, 80, 85, 90];
  const oldLonLefts = Array.from({ length: 23 }, (_, i) => i * 5);
  check(
    "旧版 5 档北纬窗口全部保留（老棋盘仍能出现）",
    oldLatTops.every((v) => g.LAT_TOPS.includes(v)),
    oldLatTops.filter((v) => !g.LAT_TOPS.includes(v)).join(",") || "全部保留"
  );
  check(
    "旧版 23 档东经窗口全部保留（老棋盘仍能出现）",
    oldLonLefts.every((v) => g.LON_LEFTS.includes(v)),
    oldLonLefts.filter((v) => !g.LON_LEFTS.includes(v)).join(",") || "全部保留"
  );
}

/* ===================== 2) 几何不变式 ===================== */
{
  let worstRoundTrip = 0;
  let worstLatOrder = 0;
  let worstLonOrder = 0;
  let outOfRange = 0;
  let cellCount = 0;

  for (const latTop of g.LAT_TOPS) {
    for (const lonLeft of g.LON_LEFTS) {
      const range = { latTop, lonLeft };
      const { lats, lons } = g.buildAxes(range);
      cellCount += 1;

      // 轴向：纬度自北向南递减、经度自西向东递增，且端点与窗口一致。
      for (let i = 1; i < g.GRID; i += 1) {
        worstLatOrder = Math.max(worstLatOrder, Math.abs(lats[i - 1] - lats[i] - 5));
        worstLonOrder = Math.max(worstLonOrder, Math.abs(lons[i] - lons[i - 1] - 5));
      }
      if (
        lats[0] !== latTop ||
        lats[g.GRID - 1] !== latBottom(range) ||
        lons[0] !== lonLeft ||
        lons[g.GRID - 1] !== lonRight(range)
      ) {
        worstRoundTrip = Number.POSITIVE_INFINITY;
      }

      for (let row = 0; row < g.GRID; row += 1) {
        for (let col = 0; col < g.GRID; col += 1) {
          const lat = lats[row];
          const lon = lons[col];
          if (lat < -90 || lat > 90 || lon < -180 || lon > 180) outOfRange += 1;
          // 经纬度 → 行列 → 经纬度必须回到原点
          const backRow = g.rowOfLat(lat, range);
          const backCol = g.colOfLon(lon, range);
          worstRoundTrip = Math.max(
            worstRoundTrip,
            Math.abs(backRow - row),
            Math.abs(backCol - col)
          );
        }
      }
    }
  }

  check("遍历了全部 1357 档窗口", cellCount === 23 * 59, cellCount);
  check(
    "全部窗口 × 全部格点：经纬度反解行列精确回到原位",
    worstRoundTrip === 0,
    `最大偏差 ${worstRoundTrip}`
  );
  check(
    "全部窗口的纬度相邻格差恒为 5°（自北向南递减）",
    worstLatOrder === 0,
    `最大偏差 ${worstLatOrder}`
  );
  check(
    "全部窗口的经度相邻格差恒为 5°（自西向东递增）",
    worstLonOrder === 0,
    `最大偏差 ${worstLonOrder}`
  );
  check(
    "全部窗口 × 全部格点的经纬度都在合法值域内",
    outOfRange === 0,
    `越界 ${outOfRange} 个`
  );

  // 跨赤道的窗口里必须真的同时出现南北纬，否则"跨"是假的。
  const straddle = { latTop: 65, lonLeft: -65 };
  const axes = g.buildAxes(straddle);
  check(
    "跨赤道窗口里同时存在北纬格线与南纬格线",
    axes.lats.some((v) => v > 0) && axes.lats.some((v) => v < 0)
  );
  check(
    "跨赤道窗口里 0° 纬线恰好是其中一条格线",
    axes.lats.includes(0),
    `0 在第 ${axes.lats.indexOf(0)} 条`
  );
  check(
    "跨本初子午线窗口里 0° 经线恰好是其中一条格线",
    axes.lons.includes(0),
    `0 在第 ${axes.lons.indexOf(0)} 条`
  );
}

/* ===================== 3) 标签隐藏档位 ===================== */
{
  check(
    "三档隐藏模式都定义了文案",
    g.HIDE_MODES.length === 3 &&
      g.HIDE_MODES.every((m) => m.id && m.label && m.hint),
    g.HIDE_MODES.map((m) => m.label).join(" / ")
  );
  check("默认档位是隔一标一", g.DEFAULT_HIDE_MODE === "half", g.DEFAULT_HIDE_MODE);

  check("全部标出档：15 条全标", g.labelCount("full", null) === 15, g.labelCount("full", null));
  check(
    "全部标出档：位图全为 true",
    g.labelIndices("full", null).every(Boolean)
  );

  // 0° 线在图中时，标出数 +1；不在图中时用基准数。
  // 注意"隔一标一"标的是偶数索引，所以要用**奇数**索引（13）才能体现 +1。
  check(
    "隔一标一档：8 条，0° 线正好落在偶数索引时仍是 8 条",
    g.labelCount("half", null) === 8 && g.labelCount("half", 8) === 8,
    `${g.labelCount("half", null)} / ${g.labelCount("half", 8)}`
  );
  check(
    "隔一标一档：0° 线落在奇数索引时补成 9 条",
    g.labelCount("half", 13) === 9,
    g.labelCount("half", 13)
  );
  check(
    "只留锚点档：3 条，0° 线在图中时 4 条",
    g.labelCount("anchor", null) === 3 && g.labelCount("anchor", 4) === 4,
    `${g.labelCount("anchor", null)} / ${g.labelCount("anchor", 4)}`
  );

  check(
    "标出数严格递减：全部 > 隔一 > 锚点",
    g.labelCount("full", null) > g.labelCount("half", null) &&
      g.labelCount("half", null) > g.labelCount("anchor", null),
    `${g.labelCount("full", null)} > ${g.labelCount("half", null)} > ${g.labelCount("anchor", null)}`
  );
  check(
    "除全部标出档外都确实藏掉了一些（不是只藏一两条）",
    g.labelCount("half", null) <= 9 && g.labelCount("anchor", null) <= 4,
    `半标 ${g.labelCount("half", null)} / 锚点 ${g.labelCount("anchor", null)}`
  );

  // 最重要的一条：0° 线永远可读 —— 它是学生唯一能无条件信任的锚点。
  let zeroAlwaysShown = true;
  const zeroSeen = [];
  for (const latTop of g.LAT_TOPS) {
    const zi = g.zeroIndex("lat", { latTop, lonLeft: 0 });
    if (zi === null) continue;
    zeroSeen.push(zi);
    for (const mode of ["full", "half", "anchor"]) {
      if (!g.labelIndices(mode, zi)[zi]) zeroAlwaysShown = false;
    }
  }
  for (const lonLeft of g.LON_LEFTS) {
    const zi = g.zeroIndex("lon", { latTop: 90, lonLeft });
    if (zi === null) continue;
    zeroSeen.push(zi);
    for (const mode of ["full", "half", "anchor"]) {
      if (!g.labelIndices(mode, zi)[zi]) zeroAlwaysShown = false;
    }
  }
  check(
    "无论哪一档、哪一档窗口，0° 线（赤道/本初子午线）永远被标出",
    zeroAlwaysShown,
    `覆盖了 ${zeroSeen.length} 组 0° 线位置`
  );

  check(
    "锚点档恰好标出首/中/末三条（索引 0 / 7 / 14）",
    [0, 7, 14].every((i) => g.labelIndices("anchor", null)[i]) &&
      g.labelIndices("anchor", null).filter(Boolean).length === 3
  );
  check(
    "隔一标一档标的是偶数索引",
    g.labelIndices("half", null).every((v, i) => v === (i % 2 === 0))
  );
  check(
    "0° 线位置在合法范围外时不会误改位图",
    g.labelCount("anchor", 99) === 3 && g.labelCount("anchor", -1) === 3,
    `${g.labelCount("anchor", 99)} / ${g.labelCount("anchor", -1)}`
  );

  // 0° 线的定位
  check(
    "赤道在第 14 条（窗口 0°—70°N，赤道是下边缘）",
    g.zeroIndex("lat", { latTop: 70, lonLeft: 0 }) === 14,
    g.zeroIndex("lat", { latTop: 70, lonLeft: 0 })
  );
  check(
    "赤道在第 0 条（窗口 70°S—0°，赤道是上边缘）",
    g.zeroIndex("lat", { latTop: 0, lonLeft: 0 }) === 0,
    g.zeroIndex("lat", { latTop: 0, lonLeft: 0 })
  );
  check(
    "只含北纬的窗口不含赤道（窗口 20°N—90°N）",
    g.zeroIndex("lat", { latTop: 90, lonLeft: 0 }) === null,
    g.zeroIndex("lat", { latTop: 90, lonLeft: 0 })
  );
  check(
    "只含南纬的窗口不含赤道（窗口 90°S—20°S）",
    g.zeroIndex("lat", { latTop: -20, lonLeft: 0 }) === null,
    g.zeroIndex("lat", { latTop: -20, lonLeft: 0 })
  );
  check(
    "本初子午线在第 14 条（窗口 70°W—0°）",
    g.zeroIndex("lon", { latTop: 70, lonLeft: -70 }) === 14,
    g.zeroIndex("lon", { latTop: 70, lonLeft: -70 })
  );
  check(
    "0° 线名称正确",
    g.zeroName("lat") === "赤道" && g.zeroName("lon") === "本初子午线",
    `${g.zeroName("lat")} / ${g.zeroName("lon")}`
  );
}

/* ===================== 4) 半球判定 ===================== */
{
  const cases = [
    { range: { latTop: 90, lonLeft: 110 }, lat: "N", lon: "E", why: "东北象限" },
    { range: { latTop: 65, lonLeft: -65 }, lat: "NS", lon: "EW", why: "跨赤道+跨子午线" },
    { range: { latTop: -20, lonLeft: -180 }, lat: "S", lon: "W", why: "西南象限" },
    { range: { latTop: 70, lonLeft: 0 }, lat: "N", lon: "E", why: "含赤道但全在北纬" },
    { range: { latTop: 0, lonLeft: -70 }, lat: "S", lon: "W", why: "含赤道但全在南纬" }
  ];
  for (const c of cases) {
    const lat = g.axisHemis("lat", c.range).join("");
    const lon = g.axisHemis("lon", c.range).join("");
    check(
      `半球判定：${c.why} → 纬度 ${c.lat} / 经度 ${c.lon}`,
      lat === c.lat && lon === c.lon,
      `实际 纬度 ${lat} / 经度 ${lon}`
    );
  }

  // 四象限纯色棋盘必须都能造出来
  const pureNE = { latTop: 90, lonLeft: 110 };
  const pureSW = { latTop: -20, lonLeft: -180 };
  check(
    "纯东北棋盘：20°N—90°N × 110°E—180°E",
    g.axisRangeText("lat", pureNE) === "北纬20°—北纬90°" &&
      g.axisRangeText("lon", pureNE) === "东经110°—东经180°",
    `${g.axisRangeText("lat", pureNE)} / ${g.axisRangeText("lon", pureNE)}`
  );
  check(
    "纯西南棋盘：90°S—20°S × 180°W—110°W",
    g.axisRangeText("lat", pureSW) === "南纬90°—南纬20°" &&
      g.axisRangeText("lon", pureSW) === "西经180°—西经110°",
    `${g.axisRangeText("lat", pureSW)} / ${g.axisRangeText("lon", pureSW)}`
  );

  // 不变量：任何窗口的半球列表都不许为空，最多两个。
  let emptyHemi = 0;
  let tooManyHemi = 0;
  let bothCount = 0;
  for (const latTop of g.LAT_TOPS) {
    for (const lonLeft of g.LON_LEFTS) {
      const range = { latTop, lonLeft };
      for (const kind of ["lat", "lon"]) {
        const list = g.axisHemis(kind, range);
        if (list.length === 0) emptyHemi += 1;
        if (list.length > 2) tooManyHemi += 1;
        const info = g.axisHemisInfo(kind, range);
        if (info.both) bothCount += 1;
        // both 与"两个半球"必须同步
        if (info.both !== (list.length === 2)) tooManyHemi += 1;
      }
    }
  }
  check(
    "任何窗口的任何轴都至少有一个半球（不会出现「没有半球」的棋盘）",
    emptyHemi === 0,
    `空 ${emptyHemi}`
  );
  check(
    "半球列表最多两个，且与 both 标志一致",
    tooManyHemi === 0,
    `异常 ${tooManyHemi}`
  );
  check("存在真正跨 0° 线的棋盘", bothCount > 0, `跨线组合 ${bothCount} 个`);

  check(
    "半球文案读数正确",
    g.axisHemiText("lat", { latTop: 90, lonLeft: 0 }) === "只有北纬" &&
      g.axisHemiText("lat", { latTop: 65, lonLeft: 0 }) === "北纬与南纬都有" &&
      g.axisHemiText("lon", { latTop: 70, lonLeft: -180 }) === "只有西经",
    `${g.axisHemiText("lat", { latTop: 90, lonLeft: 0 })} / ${g.axisHemiText("lat", { latTop: 65, lonLeft: 0 })}`
  );
}

/* ===================== 5) 解析 · 合法写法 ===================== */
{
  const north = { latTop: 90, lonLeft: 110 }; // 20°N—90°N × 110°E—180°E
  const straddle = { latTop: 65, lonLeft: -65 }; // 5°S—65°N × 65°W—5°E
  // 专用于南纬/西经取值的窗口：纬度 65°S—5°N、经度 70°W—0°
  // （-30 与 -45 都落在里面；straddle 的南侧只到 5°S，装不下 -30）
  const southWest = { latTop: 5, lonLeft: -70 };

  // 同一种写法必须等价 —— 学生用哪种写法都不该影响结果。
  const northForms = ["北纬30°", "北纬30", "30°N", "30N", "N30", "n 30"];
  for (const form of northForms) {
    const r = g.parseDegreeInput(form, "lat", north);
    check(
      `北纬写法等价：「${form}」→ 30`,
      r.ok && r.value === 30,
      r.ok ? r.value : r.error
    );
  }
  const eastForms = ["东经150°", "150°E", "150E", "E150"];
  for (const form of eastForms) {
    const r = g.parseDegreeInput(form, "lon", north);
    check(
      `东经写法等价：「${form}」→ 150`,
      r.ok && r.value === 150,
      r.ok ? r.value : r.error
    );
  }

  // 南纬 / 西经必须得到负值 —— 这是"加上南纬西经"的核心。
  const southForms = ["南纬30°", "30°S", "S30", "南纬30"];
  for (const form of southForms) {
    const r = g.parseDegreeInput(form, "lat", southWest);
    check(
      `南纬写法等价且为负：「${form}」→ −30`,
      r.ok && r.value === -30,
      r.ok ? r.value : r.error
    );
  }
  const westForms = ["西经45°", "45°W", "W45", "西经45"];
  for (const form of westForms) {
    const r = g.parseDegreeInput(form, "lon", southWest);
    check(
      `西经写法等价且为负：「${form}」→ −45`,
      r.ok && r.value === -45,
      r.ok ? r.value : r.error
    );
  }

  // 裸负号当作半球声明，不能被抹掉
  const neg = g.parseDegreeInput("-30", "lat", southWest);
  check(
    "裸负号「-30」按南纬30° 处理（不是北纬）",
    neg.ok && neg.value === -30,
    neg.ok ? neg.value : neg.error
  );
  const negLon = g.parseDegreeInput("-45", "lon", southWest);
  check(
    "裸负号「-45」按西经45° 处理",
    negLon.ok && negLon.value === -45,
    negLon.ok ? negLon.value : negLon.error
  );

  // 0° 与它的中文名
  for (const form of ["0", "0°", "赤道"]) {
    const r = g.parseDegreeInput(form, "lat", straddle);
    check(`赤道写法：「${form}」→ 0`, r.ok && r.value === 0, r.ok ? r.value : r.error);
  }
  for (const form of ["0", "本初子午线"]) {
    const r = g.parseDegreeInput(form, "lon", southWest);
    check(`本初子午线写法：「${form}」→ 0`, r.ok && r.value === 0, r.ok ? r.value : r.error);
  }
  check(
    "0° 线两侧都能读到 0（南纬0° / 北纬0° 都算 0）",
    g.parseDegreeInput("南纬0", "lat", straddle).value === 0 &&
      g.parseDegreeInput("北纬0", "lat", straddle).value === 0
  );

  // 单半球棋盘允许裸数字（此时没有第二种读法）
  const bareN = g.parseDegreeInput("30", "lat", north);
  check("只含北纬的棋盘允许裸数字：30 → 北纬30°", bareN.ok && bareN.value === 30, bareN.ok ? bareN.value : bareN.error);
  const southOnly = { latTop: -20, lonLeft: -180 };
  const bareS = g.parseDegreeInput("30", "lat", southOnly);
  check("只含南纬的棋盘：裸数字 30 → 南纬30°", bareS.ok && bareS.value === -30, bareS.ok ? bareS.value : bareS.error);
  const westOnly = g.parseDegreeInput("120", "lon", southOnly);
  check("只含西经的棋盘：裸数字 120 → 西经120°", westOnly.ok && westOnly.value === -120, westOnly.ok ? westOnly.value : westOnly.error);

  // 带空格的写法也要认
  check(
    "带空格的写法能解析",
    g.parseDegreeInput(" 北纬 30 ° ", "lat", straddle).value === 30,
    JSON.stringify(g.parseDegreeInput(" 北纬 30 ° ", "lat", straddle))
  );

  // 解析出的值必须落在棋盘上、且是 5 的倍数（保证能落到格点上）
  let resolvableFail = 0;
  for (const latTop of g.LAT_TOPS) {
    for (const lonLeft of g.LON_LEFTS) {
      const range = { latTop, lonLeft };
      const { lats, lons } = g.buildAxes(range);
      for (let i = 0; i < g.GRID; i += 1) {
        const latText = g.formatAxis("lat", lats[i], "cn");
        const lonText = g.formatAxis("lon", lons[i], "cn");
        const rl = g.parseDegreeInput(latText, "lat", range);
        const ro = g.parseDegreeInput(lonText, "lon", range);
        if (!rl.ok || rl.value !== lats[i] || !ro.ok || ro.value !== lons[i]) {
          resolvableFail += 1;
        }
      }
    }
  }
  check(
    "全部窗口 × 全部格线：格式化后的坐标都能解析回原值",
    resolvableFail === 0,
    `失败 ${resolvableFail} 处`
  );
}

/* ===================== 6) 解析 · 必须判错 ===================== */
{
  const straddle = { latTop: 65, lonLeft: -65 }; // 跨赤道、跨本初子午线
  const north = { latTop: 90, lonLeft: 110 };

  const mustFail = (name, raw, kind, range, expectIn = null) => {
    const r = g.parseDegreeInput(raw, kind, range);
    const ok = !r.ok && (!expectIn || r.error.includes(expectIn));
    check(name, ok, r.ok ? `竟然通过（值 ${r.value}）` : r.error);
  };

  // 跨 0° 线时裸数字有歧义 —— 拒绝而不是猜
  mustFail("跨赤道棋盘拒绝裸数字（30 有两种读法）", "30", "lat", straddle, "跨赤道");
  mustFail("跨本初子午线棋盘拒绝裸数字（45 有两种读法）", "45", "lon", straddle, "跨本初子午线");

  // 写了棋盘上不存在的半球：要明确指出"这局只有哪个半球"
  const southOnly = { latTop: -20, lonLeft: -180 };
  mustFail("南纬棋盘里写北纬要被拒", "北纬30", "lat", southOnly, "只有南纬");
  mustFail("北纬棋盘里写南纬要被拒", "南纬30", "lat", north, "只有北纬");
  mustFail("东经棋盘里写西经要被拒", "西经150", "lon", north, "只有东经");
  mustFail("西经棋盘里写东经要被拒", "东经120", "lon", southOnly, "只有西经");
  mustFail("裸负号在只含北纬的棋盘里要被拒（不许悄悄翻成正数）", "-30", "lat", north, "只有北纬");

  // 写错轴
  mustFail("纬度框里写东经要被拒（中文）", "东经30", "lat", straddle, "纬度要用北纬");
  mustFail("纬度框里写西经要被拒（字母）", "30W", "lat", straddle, "纬度要用北纬");
  mustFail("经度框里写北纬要被拒（中文）", "北纬30", "lon", straddle, "经度要用东经");
  mustFail("经度框里写南纬要被拒（字母）", "30S", "lon", straddle, "经度要用东经");

  // 半球与负号矛盾
  mustFail("半球与负号矛盾（南纬-30）", "南纬-30", "lat", straddle, "矛盾");
  mustFail("半球与负号矛盾（西经-45）", "西经-45", "lon", straddle, "矛盾");
  mustFail("写明赤道却带度数（赤道30）", "赤道30", "lat", straddle, "0°");

  // 数值本身不合规
  mustFail("非整数被拒（30.5）", "30.5", "lat", straddle, "整数");
  mustFail("非 5 的倍数被拒（北纬33）", "北纬33", "lat", straddle, "5° 的倍数");
  mustFail("非 5 的倍数被拒（122）", "122", "lon", north, "5° 的倍数");
  mustFail("超出棋盘上限被拒（北纬85，棋盘最高 65）", "北纬85", "lat", straddle, "超出");
  mustFail("超出棋盘下限被拒（南纬30，棋盘最低 5°S）", "南纬30", "lat", straddle, "超出");
  mustFail("超出经度范围被拒（东经170，棋盘最东 5°E）", "东经170", "lon", straddle, "超出");

  // 空 / 无意义输入
  mustFail("空输入被拒", "", "lat", straddle);
  mustFail("只有空格被拒", "   ", "lat", straddle);
  mustFail("只写半球没有度数被拒", "北纬", "lat", straddle);
  mustFail("纯文字被拒", "北京", "lat", straddle);
  mustFail("字母乱码被拒", "abc", "lat", straddle);

  // 边界：棋盘端点必须**可以**落子（别把边界一起拒掉）
  const edgeMin = g.parseDegreeInput("南纬5", "lat", straddle);
  const edgeMax = g.parseDegreeInput("北纬65", "lat", straddle);
  const edgeLonMin = g.parseDegreeInput("西经65", "lon", straddle);
  const edgeLonMax = g.parseDegreeInput("东经5", "lon", straddle);
  check(
    "棋盘四条边都允许落子（下限/上限不算越界）",
    edgeMin.ok && edgeMin.value === -5 && edgeMax.ok && edgeMax.value === 65 &&
      edgeLonMin.ok && edgeLonMin.value === -65 && edgeLonMax.ok && edgeLonMax.value === 5,
    `${edgeMin.value} / ${edgeMax.value} / ${edgeLonMin.value} / ${edgeLonMax.value}`
  );
  check(
    "刚好越界一格就被拒（南纬10 比下限低一格）",
    !g.parseDegreeInput("南纬10", "lat", straddle).ok
  );
}

/* ===================== 7) 报错文案质量 ===================== */
{
  // 报错要"指路"（告诉学生这局在哪个半球、范围是多少），不能只说"错误"。
  const straddle = { latTop: 65, lonLeft: -65 };
  const north = { latTop: 90, lonLeft: 110 };
  const southOnly = { latTop: -20, lonLeft: -180 };

  const samples = [
    ["", "lat", straddle],
    ["30", "lat", straddle],
    ["北纬89", "lat", straddle],
    ["南纬30", "lat", north],
    ["东经30", "lat", straddle],
    ["33", "lat", straddle],
    ["赤道30", "lat", straddle],
    ["东经120", "lon", southOnly],
    ["170", "lon", straddle],
    ["西经-45", "lon", straddle],
    ["abc", "lat", straddle]
  ];

  let leaked = [];
  let tooShort = [];
  for (const [raw, kind, range] of samples) {
    const r = g.parseDegreeInput(raw, kind, range);
    if (r.ok) {
      leaked.push(`「${raw}」竟然通过了`);
      continue;
    }
    if (/undefined|NaN|null|\[object/.test(r.error)) {
      leaked.push(`「${raw}」→ ${r.error}`);
    }
    if (r.error.length < 4) tooShort.push(`「${raw}」→ ${r.error}`);
  }
  check("所有报错文案都不泄漏 undefined / NaN / null", leaked.length === 0, leaked.slice(0, 3).join(" | "));
  check("所有报错文案都够具体（不短于 4 字）", tooShort.length === 0, tooShort.slice(0, 3).join(" | "));

  // 半球不符的报错必须带上该轴的真实范围
  const hemErr = g.parseDegreeInput("南纬30", "lat", north);
  check(
    "半球不符的报错带上了本棋盘纬度范围",
    !hemErr.ok && hemErr.error.includes("北纬"),
    hemErr.ok ? "意外通过" : hemErr.error
  );
  const rangeErr = g.parseDegreeInput("北纬85", "lat", straddle);
  check(
    "超范围的报错写出了本棋盘纬度区间",
    !rangeErr.ok && rangeErr.error.includes("范围") && rangeErr.error.includes("65"),
    rangeErr.ok ? "意外通过" : rangeErr.error
  );
  const multiErr = g.parseDegreeInput("北纬33", "lat", straddle);
  check(
    "非整格的报错说明了每格多少度",
    !multiErr.ok && multiErr.error.includes("5"),
    multiErr.ok ? "意外通过" : multiErr.error
  );
}

/* ===================== 8) 格式化 ===================== */
{
  check("纬度 0° 写作「赤道」", g.formatLatCn(0) === "赤道", g.formatLatCn(0));
  check("经度 0° 写作「本初子午线」", g.formatLonCn(0) === "本初子午线", g.formatLonCn(0));
  check("南纬写作「南纬30°」", g.formatLatCn(-30) === "南纬30°", g.formatLatCn(-30));
  check("西经写作「西经45°」", g.formatLonCn(-45) === "西经45°", g.formatLonCn(-45));
  check("紧凑写法 30°N / 30°S", g.formatLatCompact(30) === "30°N" && g.formatLatCompact(-30) === "30°S",
    `${g.formatLatCompact(30)} / ${g.formatLatCompact(-30)}`);
  check("紧凑写法 120°E / 120°W", g.formatLonCompact(120) === "120°E" && g.formatLonCompact(-120) === "120°W",
    `${g.formatLonCompact(120)} / ${g.formatLonCompact(-120)}`);
  check("0° 的紧凑写法不带半球字母", g.formatLatCompact(0) === "0°" && g.formatLonCompact(0) === "0°",
    `${g.formatLatCompact(0)} / ${g.formatLonCompact(0)}`);

  check(
    "旧版行为不变：北纬棋盘读数仍是「北纬 x°—北纬 y°」",
    g.axisRangeText("lat", { latTop: 70, lonLeft: 0 }) === "赤道—北纬70°",
    g.axisRangeText("lat", { latTop: 70, lonLeft: 0 })
  );
  check(
    "跨赤道读数形如「南纬5°—北纬65°」",
    g.axisRangeText("lat", { latTop: 65, lonLeft: 0 }) === "南纬5°—北纬65°",
    g.axisRangeText("lat", { latTop: 65, lonLeft: 0 })
  );
  check(
    "跨子午线读数形如「西经40°—东经30°」",
    g.axisRangeText("lon", { latTop: 70, lonLeft: -40 }) === "西经40°—东经30°",
    g.axisRangeText("lon", { latTop: 70, lonLeft: -40 })
  );

  check(
    "落子记录格式：南纬30° 西经45°",
    g.formatMove(-30, -45) === "南纬30° 西经45°",
    g.formatMove(-30, -45)
  );
  check(
    "落子记录（赤道 本初子午线）",
    g.formatMove(0, 0) === "赤道 本初子午线",
    g.formatMove(0, 0)
  );

  // 全窗口：格式化后的读数不许出现半个半球词
  let badText = [];
  for (const latTop of g.LAT_TOPS) {
    for (const lonLeft of g.LON_LEFTS) {
      const range = { latTop, lonLeft };
      for (const kind of ["lat", "lon"]) {
        const text = g.axisRangeText(kind, range);
        if (/undefined|NaN|null/.test(text) || text.includes("—undefined")) {
          badText.push(text);
        }
      }
    }
  }
  check("全部窗口的范围读数都正常", badText.length === 0, badText.slice(0, 3).join(" | "));
}

/* ===================== 9) 自洽：示例必须是合法坐标 ===================== */
{
  // 这条断言很强：示例是面板上直接展示给学生的"照这个写"，
  // 它必须本身就能通过解析 —— 否则学生照着示例写会被判错。
  let bad = [];
  for (const latTop of g.LAT_TOPS) {
    for (const lonLeft of g.LON_LEFTS) {
      const range = { latTop, lonLeft };
      const { lats, lons } = g.buildAxes(range);
      const mid = Math.floor((g.GRID - 1) / 2);
      for (const kind of ["lat", "lon"]) {
        for (const style of ["cn", "compact"]) {
          const text = g.sampleInput(kind, range, style);
          const r = g.parseDegreeInput(text, kind, range);
          const expect = kind === "lat" ? lats[mid] : lons[mid];
          if (!r.ok || r.value !== expect) {
            bad.push(`${text}@${latTop}/${lonLeft}`);
          }
        }
      }
    }
  }
  check(
    "全部窗口 × 两种写法：示例坐标都能解析回窗口中间那条线",
    bad.length === 0,
    bad.slice(0, 3).join(" | ")
  );

  check(
    "示例坐标确实取窗口中间那条格线",
    g.sampleInput("lat", { latTop: 65, lonLeft: -65 }, "cn") === "北纬30°",
    g.sampleInput("lat", { latTop: 65, lonLeft: -65 }, "cn")
  );

  check(
    "formatRowCol 与 buildAxes 一致",
    g.formatRowCol(7, 7, { latTop: 65, lonLeft: -65 }) === "北纬30° 西经30°",
    g.formatRowCol(7, 7, { latTop: 65, lonLeft: -65 })
  );
}

/* ===================== 10) 随机采样 ===================== */
{
  // 线性同余伪随机，保证可复现。乘子取小一点是为了让乘积留在
  // Number.MAX_SAFE_INTEGER 内 —— 否则中间结果丢精度，可复现就无从谈起。
  const makeRnd = (start) => {
    let s = start;
    return () => {
      s = (s * 48271) % 2147483647;
      return s / 2147483647;
    };
  };

  const seenLat = new Set();
  const seenLon = new Set();
  let bad = 0;
  let outOfRange = 0;
  const N = 40000;
  const rnd = makeRnd(20260915);
  for (let i = 0; i < N; i += 1) {
    const range = g.randomBoardRange(rnd);
    if (!g.LAT_TOPS.includes(range.latTop) || !g.LON_LEFTS.includes(range.lonLeft)) {
      bad += 1;
      continue;
    }
    seenLat.add(g.axisHemis("lat", range).join(""));
    seenLon.add(g.axisHemis("lon", range).join(""));
    if (lonRight(range) > 180 || latBottom(range) < -90 || range.latTop > 90) {
      outOfRange += 1;
    }
  }
  check(`${N} 次随机采样：范围都取自合法档位`, bad === 0, `异常 ${bad}`);
  check(`${N} 次随机采样：从不越界/跨换日线`, outOfRange === 0, `越界 ${outOfRange}`);
  check(
    "随机采样里南北半球都出现过",
    seenLat.has("N") && seenLat.has("S"),
    [...seenLat].join(" ")
  );
  check(
    "随机采样里东西经都出现过",
    seenLon.has("E") && seenLon.has("W"),
    [...seenLon].join(" ")
  );
  check(
    "随机采样里跨赤道与跨子午线都出现过",
    seenLat.has("NS") && seenLon.has("EW"),
    `纬度 ${[...seenLat].join(" ")} / 经度 ${[...seenLon].join(" ")}`
  );

  // 同一种子必须生成同一串棋盘（回归脚本要靠这个复现）
  const seqA = Array.from({ length: 8 }, () => g.randomBoardRange(makeRnd(20260915)));
  check(
    "同一种子在每个位置都生成同一个棋盘（可复现）",
    seqA.every((r) => r.latTop === seqA[0].latTop && r.lonLeft === seqA[0].lonLeft),
    JSON.stringify(seqA[0])
  );
  const seqC = Array.from({ length: 8 }, () => g.randomBoardRange(makeRnd(20260915)));
  check(
    "两个独立同种子序列产出完全一致",
    JSON.stringify(seqA) === JSON.stringify(seqC)
  );
  check(
    "不同种子产出不同序列（不是常数函数）",
    JSON.stringify(seqA) !==
      JSON.stringify(Array.from({ length: 8 }, () => g.randomBoardRange(makeRnd(999))))
  );
  check(
    "rand 返回 1 时也不会越界（边界守护）",
    g.LAT_TOPS.includes(g.randomBoardRange(() => 1).latTop) &&
      g.LON_LEFTS.includes(g.randomBoardRange(() => 1).lonLeft),
    JSON.stringify(g.randomBoardRange(() => 1))
  );
  check(
    "rand 返回 0 时取到第一个档位且合法",
    g.LAT_TOPS.includes(g.randomBoardRange(() => 0).latTop) &&
      g.LON_LEFTS.includes(g.randomBoardRange(() => 0).lonLeft),
    JSON.stringify(g.randomBoardRange(() => 0))
  );
}

/* ===================== 11) 落子全流程（解析 → 行列 → 占用） ===================== */
{
  // 用一堆能造出四象限的窗口，验证"学生按标签读出来的坐标"确实能落到对应交点。
  const windows = [
    { latTop: 90, lonLeft: 110 },
    { latTop: 65, lonLeft: -65 },
    { latTop: -20, lonLeft: -180 },
    { latTop: 70, lonLeft: 0 },
    { latTop: 0, lonLeft: -70 },
    { latTop: 55, lonLeft: 20 }
  ];
  let mismatch = 0;
  for (const range of windows) {
    const { lats, lons } = g.buildAxes(range);
    for (let row = 0; row < g.GRID; row += 1) {
      for (let col = 0; col < g.GRID; col += 1) {
        const latText = g.formatAxis("lat", lats[row], "compact");
        const lonText = g.formatAxis("lon", lons[col], "compact");
        const rl = g.parseDegreeInput(latText, "lat", range);
        const ro = g.parseDegreeInput(lonText, "lon", range);
        if (!rl.ok || !ro.ok) {
          mismatch += 1;
          continue;
        }
        const backRow = g.rowOfLat(rl.value, range);
        const backCol = g.colOfLon(ro.value, range);
        if (backRow !== row || backCol !== col) mismatch += 1;
      }
    }
  }
  check(
    "棋盘上每个交点按标签读出来都能落到正确行列（6 档窗口 × 225 点）",
    mismatch === 0,
    `错位 ${mismatch} 处`
  );
}

/* ===================== 12) 下拉选择输入（v1.1.0） ===================== */
{
  // 这一节的核心是一条**跨输入方式的自洽断言**：
  // 下拉框能选出来的每一个"度数 + 半球"组合，合成出来的那句话必须能被手动输入的解析器
  // 解析回**原值**。满足它，就等于证明了"下拉框不是绕过校验的后门" ——
  // 学生用哪种方式输入，同一句话得到的是同一个判定。
  const hemisOf = (kind) => (kind === "lat" ? ["N", "S"] : ["E", "W"]);
  const hemiOfValue = (kind, value) => {
    const list = hemisOf(kind);
    return value < 0 ? list[1] : list[0];
  };

  let notArithmetic = [];
  let notMultiples = [];
  let emptyOptions = [];
  let wrongCount = [];
  let textMismatch = [];
  let roundTripFail = [];
  let orphanOption = [];
  let badDefault = [];
  let axisCount = 0;

  for (const latTop of g.LAT_TOPS) {
    for (const lonLeft of g.LON_LEFTS) {
      const range = { latTop, lonLeft };
      for (const kind of ["lat", "lon"]) {
        axisCount += 1;
        const options = g.axisDegreeOptions(kind, range);
        const { lats, lons } = g.buildAxes(range);
        const values = kind === "lat" ? lats : lons;
        const both = g.axisHemisInfo(kind, range).both;
        const tag = `${kind}@${latTop}/${lonLeft}`;

        if (options.length === 0) emptyOptions.push(tag);
        for (const degree of options) {
          if (degree % g.DEG_STEP !== 0) notMultiples.push(`${degree}@${tag}`);
        }
        for (let i = 1; i < options.length; i += 1) {
          if (options[i] - options[i - 1] !== g.DEG_STEP) {
            notArithmetic.push(`${options[i - 1]}→${options[i]}@${tag}`);
          }
        }

        // 去重的效果：单半球棋盘 15 条线 → 15 档；跨 0° 线时有重复绝对值，必然少于 15。
        if (!both && options.length !== g.GRID) {
          wrongCount.push(`单半球应 15 档，实际 ${options.length}@${tag}`);
        }
        if (both && (options.length >= g.GRID || options.length < 8)) {
          wrongCount.push(`跨 0° 线档数异常 ${options.length}@${tag}`);
        }

        // ① 每一档都必须配得出**至少一个**合法半球（否则这个选项点下去必错，等于陷阱）
        for (const degree of options) {
          const usable = hemisOf(kind).some(
            (hemi) => g.parseDegreeInput(g.composeDegreeInput(kind, degree, hemi), kind, range).ok
          );
          if (!usable) orphanOption.push(`${degree}@${tag}`);
        }

        // ② 棋盘上每条格线：合成文本 = 棋盘上印的那种写法，且能解析回原值
        for (const value of values) {
          const text = g.composeDegreeInput(kind, Math.abs(value), hemiOfValue(kind, value));
          const expect = value === 0 ? g.zeroName(kind) : g.formatAxis(kind, value, "cn");
          if (text !== expect) textMismatch.push(`「${text}」≠「${expect}」@${tag}`);
          const r = g.parseDegreeInput(text, kind, range);
          if (!r.ok || r.value !== value) {
            roundTripFail.push(`「${text}」→ ${r.ok ? r.value : r.error}@${tag}`);
          }
        }

        // ③ 默认半球必须真实存在，否则学生第一次点"确认并落子"必定吃一个错
        if (!g.axisHemis(kind, range).includes(g.defaultHemi(kind, range))) {
          badDefault.push(`${g.defaultHemi(kind, range)}@${tag}`);
        }
      }
    }
  }

  const covered = g.LAT_TOPS.length * g.LON_LEFTS.length * 2;
  check("遍历了全部窗口 × 两条轴", axisCount === covered, `${axisCount}/${covered}`);
  check("任何棋盘的任何轴都有可选的度数", emptyOptions.length === 0, emptyOptions.slice(0, 3).join(" | "));
  check(
    "全部度数选项都是 5° 的倍数",
    notMultiples.length === 0,
    notMultiples.slice(0, 3).join(" | ")
  );
  check(
    "全部度数选项都是等间隔的（相邻差恒为 5°）",
    notArithmetic.length === 0,
    notArithmetic.slice(0, 3).join(" | ")
  );
  check(
    "单半球轴恰好 15 档、跨 0° 线的轴因去重而少于 15 档",
    wrongCount.length === 0,
    wrongCount.slice(0, 3).join(" | ")
  );
  check(
    "每个度数选项都至少配得出一组合法半球（下拉里没有必错的陷阱项）",
    orphanOption.length === 0,
    orphanOption.slice(0, 3).join(" | ")
  );
  check(
    "下拉合成的写法与棋盘上印的写法完全一致",
    textMismatch.length === 0,
    textMismatch.slice(0, 3).join(" | ")
  );
  check(
    "全部窗口 × 全部格线：下拉合成的话都能解析回原值（两条输入路径共用校验）",
    roundTripFail.length === 0,
    roundTripFail.slice(0, 3).join(" | ")
  );
  check(
    "下拉的默认半球永远是本轴真实存在的半球",
    badDefault.length === 0,
    badDefault.slice(0, 3).join(" | ")
  );

  // 半球选项：每轴两个，顺序固定为"北纬在前、东经在前"（与并列枚举的中文习惯一致）
  check(
    "半球选项是每轴两个、北纬/东经在前",
    g.hemiOptions("lat").join("") === "NS" && g.hemiOptions("lon").join("") === "EW",
    `${g.hemiOptions("lat").join("")} / ${g.hemiOptions("lon").join("")}`
  );

  // 一个具体棋盘的选项读数：跨赤道窗口 5°S—65°N → 0,5,10,…,65 共 14 档（5 只出现一次）
  const straddle = { latTop: 65, lonLeft: -65 };
  check(
    "跨赤道窗口的纬度选项：0 起、步长 5、到 65 为止共 14 档",
    JSON.stringify(g.axisDegreeOptions("lat", straddle)) ===
      JSON.stringify([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65]),
    g.axisDegreeOptions("lat", straddle).join(",")
  );
  check(
    "只含北纬的窗口：纬度选项从 20 起、共 15 档",
    g.axisDegreeOptions("lat", { latTop: 90, lonLeft: 110 }).length === 15 &&
      g.axisDegreeOptions("lat", { latTop: 90, lonLeft: 110 })[0] === 20,
    g.axisDegreeOptions("lat", { latTop: 90, lonLeft: 110 }).join(",")
  );

  // 合成文本的具体形态
  check(
    "合成文本：北纬30° / 南纬30° / 西经45°",
    g.composeDegreeInput("lat", 30, "N") === "北纬30°" &&
      g.composeDegreeInput("lat", 30, "S") === "南纬30°" &&
      g.composeDegreeInput("lon", 45, "W") === "西经45°",
    `${g.composeDegreeInput("lat", 30, "N")} / ${g.composeDegreeInput("lat", 30, "S")} / ${g.composeDegreeInput("lon", 45, "W")}`
  );
  check(
    "0° 合成成「赤道 / 本初子午线」，不带半球",
    g.composeDegreeInput("lat", 0, "N") === "赤道" &&
      g.composeDegreeInput("lon", 0, "E") === "本初子午线",
    `${g.composeDegreeInput("lat", 0, "N")} / ${g.composeDegreeInput("lon", 0, "E")}`
  );
  check(
    "还没选度数时合成空串，并被解析器判为「请填写」",
    g.composeDegreeInput("lat", null, "N") === "" &&
      g.composeDegreeInput("lon", null, "E") === "" &&
      !g.parseDegreeInput(g.composeDegreeInput("lat", null, "N"), "lat", straddle).ok &&
      g.parseDegreeInput("", "lat", straddle).error.includes("请填写"),
    g.parseDegreeInput("", "lat", straddle).error
  );

  // 下拉不是后门：选了本棋盘不存在的半球，必须走手动输入那套报错
  const north = { latTop: 90, lonLeft: 110 };
  const wrongHemi = g.parseDegreeInput(g.composeDegreeInput("lat", 30, "S"), "lat", north);
  check(
    "下拉选到本棋盘不存在的半球时，报错与手动输入同一套（指出只有北纬）",
    !wrongHemi.ok && wrongHemi.error.includes("只有北纬"),
    wrongHemi.ok ? "竟然通过" : wrongHemi.error
  );
  // 0° 与半球无关：两种半球选出来都是同一个合法值
  check(
    "选 0° 时选哪个半球结果都一样（都是 0）",
    g.parseDegreeInput(g.composeDegreeInput("lat", 0, "N"), "lat", straddle).value === 0 &&
      g.parseDegreeInput(g.composeDegreeInput("lat", 0, "S"), "lat", straddle).value === 0
  );

  check(
    "默认半球：单半球棋盘给出唯一的那一半，跨 0° 线时给出北纬 / 东经",
    g.defaultHemi("lat", north) === "N" &&
      g.defaultHemi("lat", { latTop: -20, lonLeft: -180 }) === "S" &&
      g.defaultHemi("lon", { latTop: -20, lonLeft: -180 }) === "W" &&
      g.defaultHemi("lat", straddle) === "N" &&
      g.defaultHemi("lon", straddle) === "E",
    `N?${g.defaultHemi("lat", north)} S?${g.defaultHemi("lat", { latTop: -20, lonLeft: -180 })}`
  );
}

/* ===================== 汇总 ===================== */
const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "✔" : "✘"} ${c.name}${c.extra ? `  ${c.extra}` : ""}`);
}
console.log(`\n${failed.length === 0 ? "ALL PASSED ✔" : "FAILED ✘"}  断言 ${checks.length} 项，失败 ${failed.length} 项`);
if (failed.length > 0) {
  console.log("\n失败明细：");
  for (const c of failed) {
    console.log(`  ✘ ${c.name}  ${c.extra}`);
  }
  process.exitCode = 1;
}
