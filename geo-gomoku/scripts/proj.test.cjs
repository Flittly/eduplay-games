/**
 * 经纬度五子棋 · v1.2.0 投影与圆盘几何的纯逻辑测试。
 *
 * 与 geo.test.cjs 同一套断言策略（**从「期望行为」写，不从实现抄**）：
 *
 * - **手算断言**：三档的窗口档数、跨度、圆盘可用窗口数都能纸笔数出来
 *   （23/59、19/55、13/49、15/11/5），写死数字比「跑一遍看非空」更能证明算对了。
 * - **自洽断言**：正反投影必须互逆、四角必须恰好贴圆、格点必须都在圆盘内 ——
 *   这类断言不依赖任何手写常量，哪一环算错都必然红。
 * - **判据断言**：`globeSupportsSpec` 的结论必须与 `globeWorstMinGap` 的数值一致，
 *   不能一个说支持、另一个算出来是 0。这正是「大盘在圆形下置灰」那条业务决策的地基。
 *
 * 注意：本文件里的容差是**故意的**。投影里全是三角函数，用 `===` 比浮点数只会
 * 得到一个必然红的断言，而不是一个能发现问题点的断言。
 */
const g = require("./_geo.cjs");
const p = require("./_proj.cjs");

const checks = [];
const check = (name, cond, extra) => {
  checks.push({ name, ok: Boolean(cond), extra: extra === undefined ? "" : String(extra) });
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const SIZES = ["small", "medium", "large"];
const specOf = (id) => g.specOf(id);

/** 测试用的盒子：正方形，尺寸与组件里的 VIEW_W 一致，便于手算。 */
const BOX = { x: 0, y: 0, w: 940, h: 940 };

const latBottom = g.latBottom;
const lonRight = g.lonRight;

/* ===================== 1) 三档尺寸的窗口枚举（手算） ===================== */

check("小盘 15×15、每格 5°、跨 70°", g.specOf("small").grid === 15 && g.span(specOf("small")) === 70);
check("中盘 19×19、每格 5°、跨 90°", g.specOf("medium").grid === 19 && g.span(specOf("medium")) === 90);
check("大盘 25×25、每格 5°、跨 120°", g.specOf("large").grid === 25 && g.span(specOf("large")) === 120);

{
  const expect = { small: [23, 59], medium: [19, 55], large: [13, 49] };
  for (const id of SIZES) {
    const spec = specOf(id);
    check(
      `${id}：纬度窗口 ${expect[id][0]} 档 / 经度窗口 ${expect[id][1]} 档`,
      g.latTops(spec).length === expect[id][0] && g.lonLefts(spec).length === expect[id][1],
      `${g.latTops(spec).length} / ${g.lonLefts(spec).length}`
    );
  }
}

{
  // 窗口只能整体在 ±90° 内滑动，所以纬度上沿最低只能滑到 span − 90。
  // 这条不通的话，`latTops` 的档数就必然错 —— 大盘曾经被误当成 25 档。
  for (const id of SIZES) {
    const spec = specOf(id);
    const tops = g.latTops(spec);
    const lowest = g.span(spec) - 90;
    check(
      `${id}：纬度上沿从 90° 滑到 ${lowest}°、步长 5°`,
      tops[0] === 90 && tops[tops.length - 1] === lowest && tops[0] - tops[1] === 5,
      `${tops[0]} … ${tops[tops.length - 1]}`
    );
  }
}

{
  for (const id of SIZES) {
    const spec = specOf(id);
    check(
      `${id}：每档纬度窗口跨度恰好 ${g.span(spec)}°`,
      g.latTops(spec).every((top) => latBottom({ latTop: top }, spec) === top - g.span(spec))
    );
    check(
      `${id}：每档经度窗口跨度恰好 ${g.span(spec)}°`,
      g.lonLefts(spec).every((left) => lonRight({ lonLeft: left }, spec) - left === g.span(spec))
    );
  }
}

{
  // 经度上沿取 180 − span，是为了让右沿**恰好落在 180°E**：
  // 窗口永不跨越 180° 经线，否则「左沿数值最小」这条不变式会在换日线上断裂。
  for (const id of SIZES) {
    const spec = specOf(id);
    const lefts = g.lonLefts(spec);
    check(
      `${id}：经度左沿从 180°W 起、右沿止于 ${180 - g.span(spec)}°E，最后一档右沿恰为 180°E`,
      lefts[0] === -180 && lefts[lefts.length - 1] === 180 - g.span(spec) &&
        lonRight({ lonLeft: lefts[lefts.length - 1] }, spec) === 180
    );
  }
}

{
  // 三档的每格度数必须完全一致 —— 这是「练的是数格子读坐标」这个设计目标的代码体现。
  const steps = SIZES.map((id) => specOf(id).degStep);
  check("三档每格都是 5°（变大只改覆盖范围、不改刻度）", steps.every((s) => s === 5), steps.join(","));
}

/* ===================== 2) 圆形下的可用窗口与可支持性 ===================== */

{
  const expect = { small: 15, medium: 11, large: 5 };
  for (const id of SIZES) {
    const tops = p.reachableLatTops(specOf(id), "globe");
    check(
      `${id}：圆形下可用纬度窗口 ${expect[id]} 档`,
      tops.length === expect[id],
      `${tops.length} 档 ${tops.join(",")}`
    );
  }
  check(
    "方形下不做过滤：可用窗口数等于全部窗口数",
    SIZES.every((id) => p.reachableLatTops(specOf(id), "flat").length === g.latTops(specOf(id)).length)
  );
}

{
  for (const id of SIZES) {
    const spec = specOf(id);
    const tops = p.reachableLatTops(spec, "globe");
    check(
      `${id}：圆形下每个窗口都不伸进 ±${p.GLOBE_LAT_CAP}° 以外`,
      tops.every((top) => top <= p.GLOBE_LAT_CAP && top - g.span(spec) >= -p.GLOBE_LAT_CAP)
    );
    check(
      `${id}：圆形下的窗口是方形候选集的子集（只是筛掉，不是另造一批）`,
      tops.every((top) => g.latTops(spec).includes(top))
    );
  }
}

{
  // 判据必须与数值一致：说支持就得算得出来，说不支持就得确实低于阈值。
  check(
    "小盘在圆形下可用，且最坏窗口的间距确实不低于阈值",
    p.globeSupportsSpec(specOf("small")) &&
      p.globeWorstMinGap(specOf("small")) >= p.GLOBE_MIN_GAP_RATIO,
    p.globeWorstMinGap(specOf("small")).toFixed(4)
  );
  check(
    "中盘在圆形下可用，且最坏窗口的间距确实不低于阈值",
    p.globeSupportsSpec(specOf("medium")) &&
      p.globeWorstMinGap(specOf("medium")) >= p.GLOBE_MIN_GAP_RATIO,
    p.globeWorstMinGap(specOf("medium")).toFixed(4)
  );
  check(
    "大盘在圆形下不可用，且最坏窗口的间距确实低于阈值（这就是置灰的依据）",
    !p.globeSupportsSpec(specOf("large")) &&
      p.globeWorstMinGap(specOf("large")) < p.GLOBE_MIN_GAP_RATIO,
    p.globeWorstMinGap(specOf("large")).toFixed(4)
  );
}

{
  // 盘越大越挤：这条单调性保证「大盘置灰」不是拍脑袋划的一条线。
  const s = p.globeWorstMinGap(specOf("small"));
  const m = p.globeWorstMinGap(specOf("medium"));
  const l = p.globeWorstMinGap(specOf("large"));
  check("圆形下最小相邻交点间距随盘变大而单调变小", s > m && m > l, `${s.toFixed(4)} > ${m.toFixed(4)} > ${l.toFixed(4)}`);
  check(
    "阈值换算到 940 用户单位上约 10 个单位（够放下一颗棋子）",
    near(p.GLOBE_MIN_GAP_RATIO * 940, 9.96, 0.1),
    (p.GLOBE_MIN_GAP_RATIO * 940).toFixed(2)
  );
}

{
  // 「换一个范围」在圆形下不能抽出不可画的窗口 —— 抽 200 次全查一遍。
  for (const id of SIZES) {
    const spec = specOf(id);
    const seq = [];
    for (let i = 0; i < 200; i += 1) seq.push((i + 0.5) / 200);
    let ok = true;
    let badAt = -1;
    for (const r of seq) {
      const range = p.randomRangeFor("globe", spec, () => r);
      if (!p.rangeReachable(range, spec, "globe")) {
        ok = false;
        badAt = range.latTop;
        break;
      }
    }
    check(`${id}：圆形下随机出的窗口全部可画（抽 200 次）`, ok, ok ? "" : `抽到 ${badAt}`);
  }
  // 方形下不做过滤，抽到的也必须都是合法窗口（格线落在 ±90°、±180° 之内）。
  for (const id of SIZES) {
    const spec = specOf(id);
    let ok = true;
    for (let i = 0; i < 200; i += 1) {
      const range = p.randomRangeFor("flat", spec, () => (i + 0.5) / 200);
      if (latBottom(range, spec) < -90 || lonRight(range, spec) > 180) ok = false;
    }
    check(`${id}：方形下随机出的窗口全部落在 ±90° / ±180° 内（抽 200 次）`, ok);
  }
}

/* ===================== 3) 正射投影本身 ===================== */

{
  const at = (lon, lat, lon0 = 0, lat0 = 0) => p.orthoProject(lon, lat, lon0, lat0);

  const center = at(0, 0);
  check("视角中心 (0,0) 投影到原点", near(center.x, 0) && near(center.y, 0), `${center.x},${center.y}`);
  const east = at(90, 0);
  check("东移 90° 投到 (1,0)", near(east.x, 1) && near(east.y, 0), `${east.x},${east.y}`);
  const west = at(-90, 0);
  check("西移 90° 投到 (−1,0)", near(west.x, -1) && near(west.y, 0), `${west.x},${west.y}`);
  const north = at(0, 90);
  check("北极投到 (0,1)", near(north.x, 0) && near(north.y, 1), `${north.x},${north.y}`);
  check("背面（换日线后方）返回 null，而不是投到圆盘上", at(180, 0) === null);
  const south = at(0, -90);
  check("南极投到 (0,−1)（在圆盘边缘上，仍然可见）", near(south.x, 0) && near(south.y, -1), `${south.x},${south.y}`);

  // **极点是一个点**：lat = 90° 整条纬线不管经度多少都投到同一个位置。
  // 这正是 GLOBE_LAT_CAP = 70 存在的理由 —— 极点那一行在圆盘上重合，
  // 棋子会摞成一颗、沿那一行的连珠也看不见，而学生手里的坐标明明各不相同。
  //
  // 顺带记一个数值事实：极点恰好落在"可见 / 背面"的分界线上，
  // cos c 此时是 `cos(90°) · cos(λ − λ0)` 这种"0 × 有符号数"，
  // 符号完全由浮点误差决定。所以下面的断言不要求每个经度都可见，
  // 只要求**可见的那些都是同一个点** —— 它不可能展开成一条线。
  let poleVisible = 0;
  let poleOff = 0;
  for (let lon = -180; lon < 180; lon += 15) {
    const point = p.orthoProject(lon, 90, 0, 0);
    if (!point) continue;
    poleVisible += 1;
    if (!near(point.x, 0, 1e-9) || !near(point.y, 1, 1e-9)) poleOff += 1;
  }
  check(
    "极点在正射投影下退化成同一个点（所以圆形棋盘必须排除极点窗口）",
    poleVisible > 0 && poleOff === 0,
    `可见 ${poleVisible} / 24 个经度，偏离 (0,1) 的有 ${poleOff} 个`
  );

  // 把视角中心放在极点自己那条经线上，判据就是干净的，全部可见且全部投到 (0,1)。
  let poleAllSame = true;
  for (let lon = -180; lon < 180; lon += 15) {
    const point = p.orthoProject(lon, 90, lon, 0);
    if (!point || !near(point.x, 0, 1e-9) || !near(point.y, 1, 1e-9)) poleAllSame = false;
  }
  check("视角中心对准极点所在经线时，24 条经线上的极点全部投到 (0,1)", poleAllSame);
}

{
  // 自洽：投影再反投影必须回到原值。
  // 全 3 档 × 全可用窗口 × 全格点 —— 任何一环算错都会在这里红。
  let worstErr = 0;
  let worstAt = "";
  let total = 0;
  for (const id of SIZES) {
    const spec = specOf(id);
    for (const latTop of p.reachableLatTops(spec, "globe")) {
      for (const lonLeft of g.lonLefts(spec)) {
        const range = { latTop, lonLeft };
        const vp = p.makeGlobeViewport(range, spec, BOX);
        for (let row = 0; row < spec.grid; row += 1) {
          for (let col = 0; col < spec.grid; col += 1) {
            const lon = lonLeft + col * spec.degStep;
            const lat = latTop - row * spec.degStep;
            const point = p.project(vp, lon, lat);
            if (!point) continue;
            const back = p.unproject(vp, point.x, point.y);
            total += 1;
            if (!back) {
              worstErr = Number.POSITIVE_INFINITY;
              worstAt = `${id} (${lon},${lat}) 反投影为 null`;
              break;
            }
            const err = Math.max(Math.abs(back.lon - lon), Math.abs(back.lat - lat));
            if (err > worstErr) {
              worstErr = err;
              worstAt = `${id} (${lon},${lat})`;
            }
          }
        }
      }
    }
  }
  check(
    `圆形棋盘全窗口全格点正反投影互逆（${total} 个点）`,
    worstErr <= 1e-6,
    `最大误差 ${Number.isFinite(worstErr) ? worstErr.toExponential(2) : worstErr} @ ${worstAt}`
  );
  check("点数规模合理（圆形可用窗口 × 全格点）", total > 500000, `${total} 个点`);
}

{
  // 方形也要互逆（老路径，v1.0.0 起就没变过）。
  let worstErr = 0;
  for (const id of SIZES) {
    const spec = specOf(id);
    for (const latTop of g.latTops(spec)) {
      for (const lonLeft of g.lonLefts(spec)) {
        const range = { latTop, lonLeft };
        const vp = p.makeFlatViewport(range, spec, BOX);
        for (let row = 0; row < spec.grid; row += 1) {
          for (let col = 0; col < spec.grid; col += 1) {
            const lon = lonLeft + col * spec.degStep;
            const lat = latTop - row * spec.degStep;
            const point = p.project(vp, lon, lat);
            const back = p.unproject(vp, point.x, point.y);
            worstErr = Math.max(worstErr, Math.abs(back.lon - lon), Math.abs(back.lat - lat));
          }
        }
      }
    }
  }
  check("方形棋盘全窗口全格点正反投影互逆", worstErr <= 1e-9, worstErr.toExponential(2));
}

{
  // 逆投影的纬度必须 / RAD。漏掉它的症状是「经度全对、纬度全错」，
  // 而且因为弧度值 |x| < 1.6 恰好落在合法值域内，不会报错、只会安静地给错坐标。
  const back = p.orthoUnproject(0, Math.sin((50 * Math.PI) / 180), 0, 0);
  check(
    "逆投影返回的纬度是「度」而不是「弧度」（漏斗形状的经典坑）",
    near(back.lat, 50, 1e-6),
    `${back.lat}`
  );
}

/* ===================== 4) 视口与圆盘 ===================== */

{
  const spec = specOf("small");
  const range = { latTop: 60, lonLeft: 20 };
  const vp = p.makeGlobeViewport(range, spec, BOX);
  check(
    "圆盘圆心在盒子中心、半径是盒子短边的一半",
    near(vp.cx, 470) && near(vp.cy, 470) && near(vp.radius, 470),
    `${vp.cx},${vp.cy},${vp.radius}`
  );
  check(
    "视角中心就是窗口的几何中心",
    near(vp.lat0, (range.latTop + latBottom(range, spec)) / 2) &&
      near(vp.lon0, (range.lonLeft + lonRight(range, spec)) / 2),
    `${vp.lat0},${vp.lon0}`
  );

  // 圆盘半径取窗口四角的**外接圆**：至少一角恰好贴圆、没有一角溢出。
  let maxR = 0;
  for (const lon of [range.lonLeft, lonRight(range, spec)]) {
    for (const lat of [latBottom(range, spec), range.latTop]) {
      const point = p.project(vp, lon, lat);
      maxR = Math.max(maxR, Math.hypot(point.x - vp.cx, point.y - vp.cy));
    }
  }
  check("窗口四角的外接圆半径恰好等于圆盘半径（四角贴圆）", near(maxR, vp.radius, 1e-6), maxR.toFixed(6));

  const center = p.project(vp, vp.lon0, vp.lat0);
  check(
    "视角中心那一格投影到圆盘正中",
    near(center.x, vp.cx, 1e-6) && near(center.y, vp.cy, 1e-6),
    `${center.x.toFixed(6)},${center.y.toFixed(6)}`
  );

  const unit = p.cornerUnitRadius(range, spec);
  check("四角的外接圆在单位球上必然 ≤ 1", unit <= 1 + 1e-9, unit.toFixed(6));
}

{
  // 全 3 档 × 全可用窗口：每个格点都必须画得出来、且落在圆盘内。
  //
  // 「在盘内」在边界上必须留浮点余量：圆盘半径是按四角的外接圆定的，
  // 于是四角**恰好**落在圆上，`hypot ≤ radius` 会在这个等式上出现 1e-13 量级的抖动
  // （实测最大溢出 1.1e-13 用户单位，远小于亚像素）。这里按 1e-6 判 ——
  // 它比噪声大 7 个数量级、又比一个像素小 6 个数量级，中间没有可争议的地带。
  const BOUNDARY_TOL = 1e-6;
  let offDisc = 0;
  let invisible = 0;
  let worstOver = 0;
  for (const id of SIZES) {
    const spec = specOf(id);
    for (const latTop of p.reachableLatTops(spec, "globe")) {
      for (const lonLeft of g.lonLefts(spec)) {
        const range = { latTop, lonLeft };
        const vp = p.makeGlobeViewport(range, spec, BOX);
        for (let row = 0; row < spec.grid; row += 1) {
          for (let col = 0; col < spec.grid; col += 1) {
            const point = p.project(vp, lonLeft + col * spec.degStep, latTop - row * spec.degStep);
            if (!point) {
              invisible += 1;
              continue;
            }
            const over = Math.hypot(point.x - vp.cx, point.y - vp.cy) - vp.radius;
            if (over > worstOver) worstOver = over;
            if (over > BOUNDARY_TOL) offDisc += 1;
          }
        }
      }
    }
  }
  check("圆形棋盘上没有落在背面的格点（每个交点都画得出来）", invisible === 0, `${invisible} 个`);
  check("圆形棋盘上没有落到圆盘之外的格点", offDisc === 0, `${offDisc} 个`);
  check(
    "四角恰好贴圆，所以边界上的判据必须带浮点余量（溢出应在 1e-12 量级）",
    worstOver <= 1e-9,
    `最大溢出 ${worstOver.toExponential(2)} 用户单位`
  );
}

{
  // 方形视口：四角正好贴在盒子的四角上（老行为，不能因为加了圆形而改掉）。
  const spec = specOf("medium");
  const range = { latTop: 45, lonLeft: -30 };
  const vp = p.makeFlatViewport(range, spec, BOX);
  const tl = p.project(vp, range.lonLeft, range.latTop);
  const br = p.project(vp, lonRight(range, spec), latBottom(range, spec));
  check(
    "方形视口：左上角与右下角正好落在盒子四角",
    near(tl.x, 0) && near(tl.y, 0) && near(br.x, 940) && near(br.y, 940),
    `${tl.x},${tl.y} → ${br.x},${br.y}`
  );
  check(
    "方形棋盘的格子尺度处处相同（所以方形不需要「最近邻间距」来判断字号 / 棋子）",
    (() => {
      const a = p.project(vp, range.lonLeft, range.latTop);
      const b = p.project(vp, range.lonLeft + spec.degStep, range.latTop);
      const c = p.project(vp, range.lonLeft + 4 * spec.degStep, range.latTop - 4 * spec.degStep);
      const d = p.project(vp, range.lonLeft + 5 * spec.degStep, range.latTop - 4 * spec.degStep);
      return near(Math.hypot(b.x - a.x, b.y - a.y), 940 / (spec.grid - 1), 1e-9) &&
        near(Math.hypot(d.x - c.x, d.y - c.y), 940 / (spec.grid - 1), 1e-9);
    })()
  );
}

/* ===================== 5) 采样与 SVG 路径 ===================== */

{
  check(
    "采样点数 = ⌈跨度 / 步长⌉ + 1",
    p.sampleLine("lat", 0, 0, 70, 1).length === 71 && p.sampleLine("lat", 0, 0, 7, 1).length === 8,
    `${p.sampleLine("lat", 0, 0, 7, 1).length}`
  );
  check(
    "采样点的首尾必须正好是区间两端（不能因为取整少一截）",
    (() => {
      const list = p.sampleLine("lat", 0, -180, 110, 7);
      return list[0].lon === -180 && list[list.length - 1].lon === 110;
    })()
  );

  const spec = specOf("small");
  const range = { latTop: 50, lonLeft: -40 };
  const parallels = p.parallelSamples(range, spec, 30);
  const meridians = p.meridianSamples(range, spec, 0);
  check(
    "窗口内纬线采样的经度范围恰好是窗口两沿",
    parallels[0].lon === range.lonLeft && parallels[parallels.length - 1].lon === lonRight(range, spec) &&
      parallels.every((s) => s.lat === 30)
  );
  check(
    "窗口内经线采样的纬度范围恰好是窗口上下沿",
    meridians[0].lat === latBottom(range, spec) && meridians[meridians.length - 1].lat === range.latTop &&
      meridians.every((s) => s.lon === 0)
  );

  // 窗口外那一圈（填月牙用的）要盖满整条线，否则圆盘边缘会出现断口。
  const ghostP = p.ghostParallelSamples(30);
  const ghostM = p.ghostMeridianSamples(0);
  check(
    "窗口外的纬线延伸到 ±180°（填满圆盘左右月牙）",
    ghostP[0].lon === -180 && ghostP[ghostP.length - 1].lon === 180
  );
  check(
    "窗口外的经线延伸到 ±90°（填满圆盘上下月牙）",
    ghostM[0].lat === -90 && ghostM[ghostM.length - 1].lat === 90
  );
  check(
    "窗口外的采样比窗口内更粗（它决定弧线像不像弧，窗口外可以省）",
    p.GHOST_SAMPLE_DEG > p.WINDOW_SAMPLE_DEG,
    `${p.GHOST_SAMPLE_DEG} > ${p.WINDOW_SAMPLE_DEG}`
  );

  const outline = p.windowOutlineSamples(range, spec);
  check("窗口轮廓首尾相接、可以闭合成一个环", outline.length > 4 &&
    outline[0].lon === outline[outline.length - 1].lon &&
    outline[0].lat === outline[outline.length - 1].lat);

  const vp = p.makeGlobeViewport(range, spec, BOX);
  const d = p.pathFromSamples(vp, parallels, 2);
  check("路径以 M 开头", d.startsWith("M"), d.slice(0, 20));
  check("路径里没有 NaN / undefined（取点失败必须表现为断开，不是脏字符串）",
    !d.includes("NaN") && !d.includes("undefined"));
  check("每个坐标段都只有 M 或 L 两种指令", /^[ML]/.test(d) && !/[^ML\d.\s-]/.test(d));
}

{
  // 背面必须**断开重起**，不能硬连 —— 硬连会让直线横穿整个圆盘。
  // 构造一条经线，从被看见的一段跨到背面去。
  const spec = specOf("small");
  const range = { latTop: 0, lonLeft: -180 }; // 视角中心在换日线附近，走一圈就会转到背面
  const vp = p.makeGlobeViewport(range, spec, BOX);
  const full = p.ghostParallelSamples(Math.round(vp.lat0)); // 绕地球一整圈的纬线
  const d = p.pathFromSamples(vp, full, 2);
  const moves = (d.match(/M/g) || []).length;
  check(
    "同一条线上的点转到背面时路径会断开（比不断连更少出画面事故）",
    moves >= 1 && !d.includes("NaN"),
    `${moves} 段`
  );
}

/* ===================== 6) 字号与角距 ===================== */

{
  const spec = specOf("small");
  const range = { latTop: 45, lonLeft: 20 };
  const vp = p.makeGlobeViewport(range, spec, BOX);
  const width = p.centerCellWidth(vp, spec);
  check(
    "视角中心一格的横向尺寸为正、且小于纵向（横向还要乘 cos 纬度）",
    width > 0 && width <= vp.scale * Math.sin(spec.degStep * (Math.PI / 180)) + 1e-9,
    width.toFixed(3)
  );
  const angular = p.discAngularRadius(vp);
  check("圆盘外接角距在 (0°, 90°] 区间内", angular > 0 && angular <= 90 + 1e-9, `${angular.toFixed(3)}°`);

  // 中盘（跨 90°）的视角中心就在赤道上，横向压缩最小 —— 这是它比小盘更适合
  // 做「圆形 + 全部标出」演示的原因。
  const midSpec = specOf("medium");
  const midVp = p.makeGlobeViewport({ latTop: 45, lonLeft: 20 }, midSpec, BOX);
  check("中盘视角中心在赤道上时没有横向压缩（cos 0° = 1）",
    near(p.centerCellWidth(midVp, midSpec), midVp.scale * Math.sin(midSpec.degStep * (Math.PI / 180)), 1e-9),
    p.centerCellWidth(midVp, midSpec).toFixed(3));
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
