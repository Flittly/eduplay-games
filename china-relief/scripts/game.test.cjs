/**
 * 纯逻辑回归：投影 / DEM 解码 / 落点判定 / 积分状态机。
 *
 * 这些模块刻意不依赖 React 与 three.js，就是为了能在这里直接跑 ——
 * 不用开浏览器、不用截图，改一行跑一遍两秒钟。
 *
 * ## 这文件里最要紧的两类断言
 *
 * ① **每张卡片的锚点必须真的判定为"对"**。
 *    地形区查区域位图、山脉查最近走带，只要锚点落在隔壁那一格，
 *    学生把卡片拖到图上任何位置都是错的 —— 这一关直接无解，
 *    而且从界面上完全看不出问题（判定逻辑跑得好好的，只是目标错了）。
 *    所以 12 个地形区 + 27 条山脉的锚点，一条不落地全判一遍。
 *
 * ② **`gainFor` 必须等于 `applyCorrect` 实际加的分**。
 *    给学生的提示里写着「+N」，记分板上的数字由 applyCorrect 算。
 *    这两处曾经各写一个常数，于是用过提示的条目提示写 +20、记分板只加 12 ——
 *    学生一定会发现，然后就再也不信提示里的数字了。这里用属性测试锁死。
 */
const geo = require("./_geo.cjs");
const proj = require("./_proj.cjs");
const game = require("./_game.cjs");
const regions = require("./_regions.cjs");
const LB = require("./_labels.cjs");
const fs = require("node:fs");
const path = require("node:path");

const checks = [];
const check = (name, cond, extra) => {
  checks.push({ name, ok: Boolean(cond), extra: extra === undefined ? "" : String(extra) });
};
const note = (name, extra) => {
  checks.push({ name, ok: true, extra: `（记录）${extra}`, record: true });
};

const AREAS = regions.AREAS;
const RANGES = regions.RANGES;
/**
 * **判定网格**：原经纬度栅格（480 × 358）。
 *
 * ⚠ v2.0.0 起渲染用的是另一套 **投影网格**（`geo.GRID_W/GRID_H`），两套下标
 * 不是一回事。`alt / mask / region` 三个解码函数产出的都是**这一套**，所以
 * 下面凡是拿 `j * W + i` 取样的地方都必须用这里的 W/H。
 * 混用的症状是"判定整体偏十几格（一百多公里）"，在界面上只是"有点不准"。
 */
const W = geo.SRC_W;
const H = geo.SRC_H;
/** 渲染网格（投影平面上的规则网格） */
const PW = geo.GRID_W;
const PH = geo.GRID_H;

/* ===================== 1) 投影（Albers 等积圆锥） ===================== */

check("投影网格是扇形：东西跨度 / 南北跨度 ≈ 1.486（圆锥投影下中国不再是一个矩形）", (() => {
  const r = geo.SPAN_X / geo.SPAN_Z;
  return r > 1.45 && r < 1.52;
})(), (geo.SPAN_X / geo.SPAN_Z).toFixed(3));

/**
 * ⚠ **这条是 v2.0.0 修掉的那个符号错的守门员**。
 *
 * `unproject` 曾经把 y 当成"向南为正"，于是 `dy` 多了一个负号 ——
 * 反解出来的纬度整个翻到南半球（北京 36°N 反解成 36°S）。
 * 它不会报错、不会崩，只会让"地图糊成一团、判定到处都不对"。
 * 所以这里按全球扫样把往返误差卡在 1e-6 度以内。
 */
check("【关键】经纬度 → 世界坐标 → 经纬度 严格互逆（全球扫样）", (() => {
  let worst = 0;
  for (let lat = -80; lat <= 80; lat += 2) {
    for (let lon = -180; lon <= 180; lon += 5) {
      const p = proj.project(lon, lat);
      const ll = proj.unproject(p.x, p.y);
      let dLon = Math.abs(ll.lon - lon);
      if (dLon > 180) {
        dLon = 360 - dLon;
      }
      worst = Math.max(worst, Math.hypot(dLon, ll.lat - lat));
    }
  }
  global.__worstRoundTrip = worst;
  return worst < 1e-6;
})(), `最大往返误差 ${(global.__worstRoundTrip ?? NaN).toExponential(2)}°（符号错的那版是 247°）`);

check("中央经线 105°E 投影成一条直线（x ≡ 0），经线在 Albers 下不弯", [17, 25, 36, 47, 55].every(
  (lat) => Math.abs(proj.project(105, lat).x) < 1e-12
), "105°E 上取 5 个纬度");

check("投影包围盒把取景框**四条边**都包住（纬线是圆弧，只投四角会切掉南北两端）", (() => {
  const b = geo.BOUNDS;
  const eps = 1e-6;
  for (let k = 0; k <= 200; k++) {
    const t = k / 200;
    const lon = geo.CHINA_DEM.lon0 + (geo.CHINA_DEM.lon1 - geo.CHINA_DEM.lon0) * t;
    const lat = geo.CHINA_DEM.lat0 + (geo.CHINA_DEM.lat1 - geo.CHINA_DEM.lat0) * t;
    for (const p of [
      proj.project(lon, geo.CHINA_DEM.lat0),
      proj.project(lon, geo.CHINA_DEM.lat1),
      proj.project(geo.CHINA_DEM.lon0, lat),
      proj.project(geo.CHINA_DEM.lon1, lat)
    ]) {
      if (p.x < b.x0 - eps || p.x > b.x1 + eps || p.y < b.y0 - eps || p.y > b.y1 + eps) {
        return false;
      }
    }
  }
  return true;
})(), `包围盒 ${geo.BOUNDS.w.toFixed(2)} × ${geo.BOUNDS.h.toFixed(2)} 世界单位`);

check("北在 -z：最北（55°N）的 z 最小、最南（17°N）的 z 最大", (() => {
  const z = (lat) => geo.lonLatToWorld(105, lat).z;
  return z(55) < z(40) && z(40) < z(17);
})(), `${geo.lonLatToWorld(105, 55).z.toFixed(2)} < ${geo.lonLatToWorld(105, 40).z.toFixed(2)} < ${geo.lonLatToWorld(105, 17).z.toFixed(2)}`);

check("投影网格四角**落在取景框之外**（那四块本来就没有东西，渲染要留透明）",
  [[0, 0], [PW - 1, 0], [0, PH - 1], [PW - 1, PH - 1]].every(([gi, gj]) => {
    const ll = proj.gridToLonLat(geo.PROJ_GRID, gi, gj);
    return (
      ll.lon < geo.CHINA_DEM.lon0 || ll.lon > geo.CHINA_DEM.lon1 ||
      ll.lat < geo.CHINA_DEM.lat0 || ll.lat > geo.CHINA_DEM.lat1
    );
  }), "四角都不在 73~136°E / 17~55°N 内");

check("格距与原 DEM 相等（取更细不会更清楚、取更粗会丢掉窄河谷）",
  Math.abs(geo.CELL_KM - 11.8203) < 0.01, `${geo.CELL_KM.toFixed(4)} km`);

check("gridIndex 认的是**判定网格**且被夹在边界内",
  geo.gridIndex(73, 55).i === 0 && geo.gridIndex(73, 55).j === 0 &&
  geo.gridIndex(136, 17).i === W - 1 && geo.gridIndex(136, 17).j === H - 1 &&
  geo.gridIndex(200, 90).i === W - 1 && geo.gridIndex(200, 90).j === 0,
  `(73,55)→${JSON.stringify(geo.gridIndex(73, 55))} (136,17)→${JSON.stringify(geo.gridIndex(136, 17))}`);

/**
 * 投影网格的边界语义 —— **不能照搬判定网格那一套**（v2.0.0 踩过）。
 *
 * 判定网格是经纬度矩形，所以"73°E/55°N → (0,0)"成立。投影网格是
 * **投影后包围盒**按格距开的规则网格，而经纬度矩形投到 Albers 上是一条
 * 弧边的斜梯形 —— 外接矩形四角本来就空着。实测这个网格覆盖
 * 55.4~153.3°E / 12.0~50.5°N（四角经纬度），所以：
 *
 *   · 只有**最南边**（17°N 纬线的最低点）和**东西两个极端**落在下标边界上；
 *   · 55°N 在中央经线上还被网格往北越过 29 格（实测 j=29），不是 j=0。
 *
 * 这条断言的用处是**钉住这个"网格比地图大"的事实**：哪天有人把它改回
 * "按经纬度矩形开网格"，扇形四角会立刻被压回框内，这里就会红。
 */
check("projGridIndex 认的是**投影网格**：东西两端与最南边贴边、框外被夹住", (() => {
  const sw = geo.projGridIndex(73, 17); // 西南角 = 全网格最西、最南
  const se = geo.projGridIndex(136, 17); // 东南角 = 最东
  const south = geo.projGridIndex(105, 17); // 17°N 纬线最低点在中央经线上
  const out = geo.projGridIndex(200, 90); // 框外必须夹住
  return (
    sw.i === 0 && se.i === PW - 1 && south.j === PH - 1 &&
    out.i === PW - 1 && out.j === 0 &&
    geo.projGridIndex(105, 55).j > 0 // 网格往北越过 55°N（扇形外接矩形的必然结果）
  );
})(), `(73,17)→i${geo.projGridIndex(73, 17).i} (136,17)→i${geo.projGridIndex(136, 17).i} (105,17)→j${geo.projGridIndex(105, 17).j}/${PH - 1} (105,55)→j${geo.projGridIndex(105, 55).j}`);

/* ---------- 投影网格的重采样（渲染层吃的那一份，v2.0.0） ---------- */

const TD = geo.buildTerrainData();
const srcLandN = (() => {
  let n = 0;
  for (let k = 0; k < TD.src.land.length; k++) {
    if (TD.src.land[k]) {
      n++;
    }
  }
  return n;
})();
let outsideN = 0;
let projLandIn = 0;
for (let k = 0; k < TD.outside.length; k++) {
  if (TD.outside[k]) {
    outsideN++;
  } else if (TD.land[k]) {
    projLandIn++;
  }
}
const insideN = TD.outside.length - outsideN;

check("投影网格尺寸 = 宽高各向上取整包住包围盒", TD.outside.length === PW * PH, `${PW} × ${PH} = ${PW * PH} 格`);

check("约四分之一的格子在取景框之外（扇形四角本来就空着）",
  outsideN / TD.outside.length > 0.20 && outsideN / TD.outside.length < 0.30,
  `${((outsideN / TD.outside.length) * 100).toFixed(1)}% 在框外`);

/**
 * 这条是**重采样方向**的守门员：格距相等、投影网格"框内"那部分与判定网格
 * 覆盖的是同一块地面，所以两者的陆地占比必须一致。
 * 把 i/j 或东/西弄反、把 `gridToLonLat` 写成 `gridToXY`，都会让这个数当场跑偏。
 */
check("【关键】重采样没把陆地搬错地方：框内陆地占比与原栅格一致（差 < 1.5%）",
  Math.abs(projLandIn / insideN - srcLandN / TD.src.land.length) < 0.015,
  `投影 ${((projLandIn / insideN) * 100).toFixed(2)}% vs 原栅格 ${((srcLandN / TD.src.land.length) * 100).toFixed(2)}%`);

/**
 * 扇形形状 —— **最宽的一行不是最后一行**（v2.0.0 修正过这个说法）。
 *
 * 一开始写的是"最上一行格数明显少于最下一行"，实测不成立：最后一行只有
 * 38 格（7%），最宽的却是第 338 行（573 格 = 100%）。原因是地图在 Albers 下
 * 是一条**弧边斜梯形**，外接矩形的上下两条边只有一个点真正贴到梯形：
 *   · 最上一行：55°N 纬线的最低点在中央经线上，所以整行只有中央附近 1 格；
 *   · 最下一行：17°N 纬线的最低点也在中央经线上，整行只有 38 格；
 *   · 最宽的那一行（≈339 行）恰好穿过梯形**南边的两个角**
 *     —— 即 (73°E,17°N) 与 (136°E,17°N)，横跨 i=0..574。
 * 所以正确的形状描述是"上尖、下尖、腰最宽"，而不是"上窄下宽"。
 */
check("扇形：最宽的一行在**腰部**（穿过南边两个角），上下两端都是尖的", (() => {
  const rowIn = (gj) => {
    let n = 0;
    for (let i = 0; i < PW; i++) {
      if (!TD.outside[gj * PW + i]) {
        n++;
      }
    }
    return n;
  };
  let widest = 0;
  let widestRow = 0;
  for (let gj = 0; gj < PH; gj++) {
    const n = rowIn(gj);
    if (n > widest) {
      widest = n;
      widestRow = gj;
    }
  }
  global.__fan = { top: rowIn(0), bot: rowIn(PH - 1), widest, widestRow };
  return (
    rowIn(0) <= 2 && // 上尖
    rowIn(PH - 1) < PW * 0.2 && // 下尖
    widest >= PW * 0.95 && // 腰最宽
    widestRow > PH * 0.6 && widestRow < PH * 0.98 && // …而且在腰部偏南，不是末行
    rowIn(10) < rowIn(30) && rowIn(30) < rowIn(60) // 上半段单调变宽
  );
})(), (() => {
  const f = global.__fan ?? {};
  return `第 0 行 ${f.top} 格 / 最宽第 ${f.widestRow} 行 ${f.widest} 格（${((f.widest / PW) * 100).toFixed(0)}%）/ 最后一行 ${f.bot} 格`;
})());

check("投影网格上的高程读数与真实地形对得上（珠峰 / 吐鲁番 / 上海）", (() => {
  const at = (lon, lat) => {
    const g = geo.projGridIndex(lon, lat);
    return TD.alt[g.j * PW + g.i];
  };
  global.__alt = {
    everest: at(86.9, 27.99),
    turpan: at(89.2, 42.9),
    shanghai: at(121.5, 31.2)
  };
  // 珠峰门槛只卡 4500 而不是"接近 7048"：投影网格与判定网格差着不到一格的
  // 任意相位，最近邻重采样在**尖峰**上会把峰顶采到邻格。实测 5090 m ——
  // 这正是"重采样保极值"（见下一条断言）与实际读数分开看的原因。
  return at(86.9, 27.99) > 4500 && at(89.2, 42.9) < 120 && at(121.5, 31.2) < 20;
})(), (() => {
  const a = global.__alt ?? {};
  return `珠峰 ${a.everest} m / 吐鲁番 ${a.turpan} m / 上海 ${a.shanghai} m`;
})());

/**
 * **重采样不丢地形**（v2.0.0 新增，比"珠峰 > 6500"这种硬编码阈值结实得多）。
 *
 * 投影网格是"在投影平面上开规则网格、逐格反投影回经纬度、从原 DEM 采一次"。
 * 只要方向、比例、索引有一处写错，极值和分位就会当场跑偏；而这类错误
 * 在画面上只表现为"地形有点怪"，截图看不出来。
 *
 * 实测（575×387 投影网格 vs 480×358 原栅格）：min 0 / max 7048 两边完全相同，
 * 均值 746.2 vs 728.0，95 分位 4685 vs 4646。
 */
check("【关键】重采样保住了极值与分位（不是把地形抹平了）", (() => {
  const stat = (arr, skipOut) => {
    let mn = Infinity;
    let mx = -Infinity;
    let s = 0;
    let n = 0;
    for (let k = 0; k < arr.length; k++) {
      if (skipOut && TD.outside[k]) {
        continue;
      }
      const v = arr[k];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      s += v;
      n++;
    }
    return { mn, mx, mean: s / n, n };
  };
  const srcS = stat(TD.src.alt, false);
  const projS = stat(TD.alt, true);
  const q = (arr, skipOut, qt) => {
    const a = [];
    for (let k = 0; k < arr.length; k++) {
      if (skipOut && TD.outside[k]) {
        continue;
      }
      a.push(arr[k]);
    }
    a.sort((x, y) => x - y);
    return a[Math.floor(qt * a.length)];
  };
  global.__rs = { srcS, projS, p95s: q(TD.src.alt, false, 0.95), p95p: q(TD.alt, true, 0.95) };
  return (
    srcS.mn === projS.mn &&
    srcS.mx === projS.mx &&
    Math.abs(projS.mean - srcS.mean) / srcS.mean < 0.05 &&
    Math.abs(q(TD.alt, true, 0.95) - q(TD.src.alt, false, 0.95)) / q(TD.src.alt, false, 0.95) < 0.03
  );
})(), (() => {
  const r = global.__rs ?? {};
  if (!r.srcS) {
    return "";
  }
  return `极值 ${r.srcS.mn}~${r.srcS.mx} 两边相同；均值 ${r.projS.mean.toFixed(1)} vs ${r.srcS.mean.toFixed(1)}；95 分位 ${r.p95p} vs ${r.p95s}`;
})());

check("投影网格上的陆地遮罩与判定网格一致（北京在内、太平洋在外）", (() => {
  const inP = (lon, lat) => {
    const g = geo.projGridIndex(lon, lat);
    return TD.land[g.j * PW + g.i] === 1;
  };
  return inP(116.4, 39.9) === true && inP(121.0, 23.7) === true &&
    inP(109.8, 19.2) === true && inP(150, 30) === false;
})(), "北京 / 台湾 / 海南 / 太平洋");

check("投影网格上的区域归属与原栅格一致（12 个地形区都还在）",
  AREAS.every((a) => {
    for (let k = 0; k < TD.region.length; k++) {
      if (TD.region[k] === a.gridId) {
        return true;
      }
    }
    return false;
  }),
  AREAS.map((a) => a.name).join("/"));

/* ---------- 几何工具 ---------- */

check("distToPolyline：落在顶点上距离为 0，垂直偏移读出正确",
  (() => {
    const line = [[100, 30], [110, 30]];
    // 经度方向按 cos(36°) 折算，所以"往西偏 5°"读出来是 5 × 0.809 = 4.045 而不是 5。
    // 这条必须按"高纬处一度经度比一度纬度短"来写：写成 5 的话，
    // 把 lonScale 整个去掉也照样通过 —— 那正是这个折算存在的理由。
    return (
      Math.abs(geo.distToPolyline(105, 30, line)) < 1e-9 &&
      Math.abs(geo.distToPolyline(105, 31, line) - 1) < 1e-6 &&
      geo.distToPolyline(95, 30, line) < 5 &&
      Math.abs(geo.distToPolyline(95, 30, line) - 5 * geo.CHINA_DEM.lonScale) < 1e-6
    );
  })(),
  "中点 0 / 北偏 1° = 1 / 西侧 5° = 5");

check("pointInRing：正方形内为真、外为假",
  geo.pointInRing(5, 5, [[0, 0], [10, 0], [10, 10], [0, 10]]) === true &&
  geo.pointInRing(15, 5, [[0, 0], [10, 0], [10, 10], [0, 10]]) === false,
  "");

/* ===================== 2) DEM 解码 ===================== */

const alt = geo.decodeAltitude();
check("高程数组长度 = 480 × 358", alt.length === W * H, alt.length);
check("高程已声明 minAlt / maxAlt 一致（0 ~ 7048 m）", (() => {
  let mn = Infinity;
  let mx = -Infinity;
  for (let k = 0; k < alt.length; k++) {
    if (alt[k] < mn) mn = alt[k];
    if (alt[k] > mx) mx = alt[k];
  }
  return mn === geo.CHINA_DEM.minAlt && mx === geo.CHINA_DEM.maxAlt;
})(), `${geo.CHINA_DEM.minAlt} ~ ${geo.CHINA_DEM.maxAlt}`);

const at = (lon, lat) => {
  const g = geo.gridIndex(lon, lat);
  return alt[g.j * W + g.i];
};

check("珠峰一带（86.9E 27.99N）读到 6800 m 以上", at(86.9, 27.99) > 6800, `${at(86.9, 27.99)} m`);
check("吐鲁番盆地（89.2E 42.9N）读到接近海平面的 0 m", at(89.2, 42.9) < 100, `${at(89.2, 42.9)} m`);
check("上海（121.5E 31.2N）读到 10 m 以内", at(121.5, 31.2) < 10, `${at(121.5, 31.2)} m`);
check("青藏高原内部（88E 32.5N）读到 4500~6000 m", at(88, 32.5) > 4500 && at(88, 32.5) < 6000, `${at(88, 32.5)} m`);
check("华北平原（116.5E 36.4N）读到 100 m 以内", at(116.5, 36.4) < 100, `${at(116.5, 36.4)} m`);

/* ===================== 3) 陆地遮罩 ===================== */

const mask = geo.decodeLandMask();
let landCount = 0;
for (let k = 0; k < mask.length; k++) {
  landCount += mask[k];
}
check("陆地遮罩是 0/1 位图", mask.every((v) => v === 0 || v === 1), "");
check("陆地占取景框的 20%~45%（中国在 63°×38° 的框里就占这么大）",
  landCount / mask.length > 0.2 && landCount / mask.length < 0.45,
  `${((landCount / mask.length) * 100).toFixed(1)}%`);

const inChina = (lon, lat) => geo.insideChina(lon, lat, mask);
check("北京在境内", inChina(116.4, 39.9) === true, "");
check("台湾岛在境内（取景到 17°N 不能把台湾切掉）", inChina(121.0, 23.7) === true, "");
check("海南岛在境内", inChina(109.8, 19.2) === true, "");
check("太平洋（150E 30N）在境外", inChina(150, 30) === false, "");
check("印度洋方向（80E 10S 已在取景框外，取 85E 12N 的孟加拉湾）在境外", inChina(85, 12) === false, "");

/* ===================== 4) 区域位图与地形区判定 ===================== */

const region = geo.decodeRegionGrid();
const nameByGridId = new Map(AREAS.map((a) => [a.gridId, a.name]));

// 4 bit 能装 0..15；v2.0.1 有 12 个地形区 ⇒ 编号 1..12（11 → 12 那一步别忘改，否则加第 12 个区时这条先红）
check("区域位图每格 4 bit，编号落在 0..12", region.every((v) => v >= 0 && v <= 12), "");
check("12 个地形区的编号在图上都真的有格子", AREAS.every((a) => region.some((v) => v === a.gridId)) === true,
  AREAS.map((a) => `${a.name}:${region.reduce((n, v) => n + (v === a.gridId ? 1 : 0), 0)}`).join(" "));
check("每个地形区在图上的格子数都不少于 12 格（太小就拖不出手感）",
  AREAS.every((a) => region.reduce((n, v) => n + (v === a.gridId ? 1 : 0), 0) >= 12),
  AREAS.map((a) => region.reduce((n, v) => n + (v === a.gridId ? 1 : 0), 0)).join(","));
check("地形区之间互斥（区域位图每格只属于一个区，柴达木嵌在青藏高原里也不会重叠）",
  (() => {
    // 位图一格一个编号，天然互斥；这条防的是"以后有人改成多值/浮点权重"
    const total = AREAS.reduce((n, a) => n + region.reduce((m, v) => m + (v === a.gridId ? 1 : 0), 0), 0);
    const union = region.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
    return total === union;
  })(),
  "各区格数之和 = 非零格数");

/** ① 最关键的一条：锚点必须判定为"对"，否则这一关无解 */
let badAnchors = [];
for (const a of AREAS) {
  const v = geo.judgeAreaDrop(a.anchor[0], a.anchor[1], a.gridId, region, nameByGridId);
  if (!v.ok) {
    badAnchors.push(`${a.name}(${a.anchor.join(",")}) → ${v.message}`);
  }
}
check("【关键】12 个地形区的锚点，拖上去都判定为「对」",
  badAnchors.length === 0,
  badAnchors.length ? badAnchors.join(" | ") : `${AREAS.length}/${AREAS.length} 通过`);

/** 城市哨兵：必须是区内的真实城市，否则说明边界画错了 */
const CITIES = [
  ["拉萨", "qingzang", 91.14, 29.65],
  ["那曲", "qingzang", 92.05, 31.48],
  ["延安", "huangtu", 109.49, 36.6],
  ["兰州", "huangtu", 103.83, 36.06],
  ["昆明", "yungui", 102.71, 25.05],
  ["贵阳", "yungui", 106.63, 26.65],
  ["库尔勒", "talimu", 86.15, 41.77],
  ["阿克苏", "talimu", 80.26, 41.17],
  ["格尔木", "chaidamu", 94.9, 36.4],
  ["成都", "sichuan", 104.07, 30.67],
  ["长春", "dongbei", 125.32, 43.82],
  ["哈尔滨", "dongbei", 126.63, 45.75],
  ["济南", "huabei", 117.0, 36.65],
  ["武汉", "changjiang", 114.31, 30.52],
  /*
   * 南昌（v2.0.1）：南昌压在东南丘陵**北界**上（北界画在 29.2°N，南昌 28.68°N，只差 0.5°），
   * 是这一组里唯一一个"贴着边界"的哨兵 —— 北界哪怕往北挪一点点，南昌就会漏进长江中下游平原。
   * 生成数据时（`build_regions.py` 的 `CITY_PROBE`）判一遍，这里再判一遍。
   */
  ["南昌", "dongan", 115.89, 28.68]
];
const cityFail = [];
for (const [name, id, lon, lat] of CITIES) {
  const a = AREAS.find((x) => x.id === id);
  const v = geo.judgeAreaDrop(lon, lat, a.gridId, region, nameByGridId);
  if (!v.ok) {
    cityFail.push(`${name}(${lon},${lat}) 应在${a.name}，实测 ${v.message}`);
  }
}
check("城市哨兵：区内的真实城市都判在它该在的区里", cityFail.length === 0,
  cityFail.length ? cityFail.join(" | ") : `${CITIES.length} 个城市全中`);

/**
 * 边缘城市：这些城市确实在那个地形区里，但它们压在简化折线的边缘上，
 * 判不判得中取决于折线在这里舍了几个点 —— 所以只记录、不判红。
 * 喀什尤其典型：塔里木盆地环最西只到 76.4°E，喀什在 75.99°E，
 * 差 0.4°（约 42 km）落在环外。11 个锚点都在环内，不影响玩法。
 */
const borderline = [
  ["喀什", "talimu", 75.99, 39.47],
  ["和田", "talimu", 79.92, 37.11],
  ["郑州", "huabei", 113.62, 34.75],
  ["上海", "changjiang", 121.47, 31.23],
  ["乌鲁木齐", "zhungeer", 87.62, 43.79]
];
for (const [name, id, lon, lat] of borderline) {
  const a = AREAS.find((x) => x.id === id);
  const v = geo.judgeAreaDrop(lon, lat, a.gridId, region, nameByGridId);
  note(`边界城市哨兵（不判红，只看趋势）${name}`, v.ok ? `判在${a.name} ✓` : v.message);
}

check("放错会被明确指出「这一格是谁的」",
  (() => {
    const v = geo.judgeAreaDrop(88, 32.5, AREAS.find((a) => a.id === "talimu").gridId, region, nameByGridId);
    return v.ok === false && /青藏高原/.test(v.message);
  })(),
  geo.judgeAreaDrop(88, 32.5, AREAS.find((a) => a.id === "talimu").gridId, region, nameByGridId).message);

/*
 * 空地提示有**两种**（v2.0.0 加容差后分出来的），必须分开测：
 *   · 附近压根没有地形区 → "离任何地形区都还远"，让学生知道是"地方不对"；
 *   · 附近有、但落点本身是空地 → 报出**最近是谁**，让学生知道往哪边挪。
 * 混成一条的话，容差一改（0.42° 那套）这条就会以"文案变了"的形式红掉，
 * 而真正想守的是"别把空地答成 '这里是XX'（等于骗学生说这块地有主）"。
 */
check("空地 + 四周没有地形区 → 说的是「离任何地形区都还远」", (() => {
  const v = geo.judgeAreaDrop(122.6, 52.0, AREAS.find((a) => a.id === "dongbei").gridId, region, nameByGridId);
  return v.ok === false && /离任何地形区都还远/.test(v.message);
})(), geo.judgeAreaDrop(122.6, 52.0, AREAS.find((a) => a.id === "dongbei").gridId, region, nameByGridId).message);

check("空地 + 旁边有地形区 → 报出「最近的是谁」，而不是说这块地有主", (() => {
  const v = geo.judgeAreaDrop(121.5, 47.0, AREAS.find((a) => a.id === "dongbei").gridId, region, nameByGridId);
  return v.ok === false && /落点本身是空地/.test(v.message) && !/这里是/.test(v.message);
})(), geo.judgeAreaDrop(121.5, 47.0, AREAS.find((a) => a.id === "dongbei").gridId, region, nameByGridId).message);

/* ------------- 落点容差（v2.0.0 用户诉求 5：小地形太难对上） ------------- */

/** 每个地形区的等效半径 —— 容差就是由它算出来的，所以先把分布量出来 */
const AREA_RADIUS = AREAS.map((a) => ({ name: a.name, r: geo.ringRadiusDeg(a.ring), tol: geo.areaDropTol(geo.ringRadiusDeg(a.ring)) }));
const R_MIN = Math.min(...AREA_RADIUS.map((x) => x.r));
const R_MAX = Math.max(...AREA_RADIUS.map((x) => x.r));

/**
 * 上界 **14°**：最大的一块是青藏高原 **12.54°**（外接矩形对角线的一半，经度按 cos36° 折算）。
 * 这里原来写的是 12，是拍脑袋定的、没过实测，一跑就红。
 * 上界的作用是"别把整幅图当成一块地形区"（整幅图半对角线 31.8°），不是精确描述青藏高原，
 * 所以留出余量 —— 下界 0.8° 才是真正在下功夫的那条（比一格 0.11° 大得多，
 * 一格大的东西不配叫"一块地形区"）。
 */
check("等效半径的量级合理：比一格大得多，又远小于整幅图",
  R_MIN > 0.8 && R_MAX < 14,
  AREA_RADIUS.map((x) => `${x.name} ${x.r.toFixed(2)}`).join(" / "));

/**
 * 容差 = min(2, 4/r) × 基础值 的分段形状。
 *
 * ⚠️ 这条同时**盯住一个容易变成死代码的风险**：如果 11 个地形区的半径全都
 * ≥4°，那 `areaDropTol` 永远返回基础值，那段"随区域大小缩放"的逻辑等于没写。
 * 所以下面单独断言"确实有大区域和小区域各至少一个"，让缩放这件事有对象。
 */
check("落点容差随区域大小缩放：r≤2 封顶 ×2、r≥4 回到 ×1，2<r<4 线性过渡", (() => {
  const base = geo.AREA_DROP_TOL_DEG;
  const eq = (a, b) => Math.abs(a - b) < 1e-9;
  /*
   * ⚠️ 真正的过渡段只有 **2 < r < 4** 这一段：`k = 4/r` 要严格落在 1~2 之间才不被 clamp 掉。
   * 我原来拿 r=2 当"过渡段的中间"，但 4/2 = 2 正好**压在 clamp 上限上**，
   * 结果 r=2 和 r=1 完全一样（都是 ×2）—— 断言写成 `areaDropTol(2) < areaDropTol(1)` 必红。
   * 这条同时锁住"r=0 不会算出 Infinity"（`Math.max(0.8, r)` 唯一真正的用处就是防除零）。
   */
  const mid = [2.5, 3, 3.5];
  const sweep = [];
  for (let r = 0.2; r <= 8.001; r += 0.2) sweep.push(geo.areaDropTol(r));
  const mono = sweep.every((v, i) => i === 0 || v <= sweep[i - 1] + 1e-9);
  return (
    eq(geo.areaDropTol(0.5), base * 2) &&
    eq(geo.areaDropTol(1), base * 2) &&
    eq(geo.areaDropTol(2), base * 2) &&
    mid.every((r) => geo.areaDropTol(r) > base && geo.areaDropTol(r) < base * 2) &&
    mid.every((r, i) => i === 0 || geo.areaDropTol(r) < geo.areaDropTol(mid[i - 1])) &&
    eq(geo.areaDropTol(4), base) &&
    eq(geo.areaDropTol(9), base) &&
    Number.isFinite(geo.areaDropTol(0)) &&
    eq(geo.areaDropTol(0), base * 2) &&
    mono
  );
})(), `基础 ${geo.AREA_DROP_TOL_DEG}°，实测：r=0→${geo.areaDropTol(0).toFixed(3)} r=2→${geo.areaDropTol(2).toFixed(3)} r=3→${geo.areaDropTol(3).toFixed(3)} r=4→${geo.areaDropTol(4).toFixed(3)} r=9→${geo.areaDropTol(9).toFixed(3)}`);

check("【关键】大区域与小区域**都存在**（否则「随区域大小缩放」是死代码）",
  AREA_RADIUS.some((x) => x.r < 4) && AREA_RADIUS.some((x) => x.r >= 4),
  AREA_RADIUS.map((x) => `${x.name} r=${x.r.toFixed(2)} tol=${x.tol.toFixed(2)}`).join(" / "));

/** 判定网格的格距（度）—— 探测窗口、紧贴距离都用它换算 */
const SRC_D_LON = (geo.CHINA_DEM.lon1 - geo.CHINA_DEM.lon0) / geo.SRC_W;
const SRC_D_LAT = (geo.CHINA_DEM.lat1 - geo.CHINA_DEM.lat0) / geo.SRC_H;
/** 一格折算成"等效度"：经度那一路要乘 cos36°，取两个方向里更紧的 */
const SRC_CELL_DEG = Math.min(SRC_D_LON * geo.CHINA_DEM.lonScale, SRC_D_LAT);

/**
 * 宽容命中真的存在 —— 把本区**外扩容差范围内**的每一个空地格都问一遍判定，
 * 至少要有一个被判 `ok && loose`，并且那个落点要真的**紧贴本区边界**。
 *
 * 这条是**用户诉求 5 的核心**：以前是严格位图判定，差一格就错；现在
 * "落点偏出去一点点"要能捞回来，而且要告诉学生"大致归位（再准一点就更好）"。
 *
 * ⚠️ 探测方式换过一次（v2.0.0）。最早是"从锚点沿 16 条射线往外走"，结果 11 个区
 * 只捞到内蒙古高原和柴达木盆地 —— **不是判定有问题，是射线走不出去**：
 * 探测步长上限 1.4°，而地形区的等效半径是 4~12.5°，锚点还稳稳待在自己家里。
 * 换成本区包围盒（外扩容差 + 3 格）里穷举空地格之后，11 个区全都有，
 * 最少的柴达木也有 547 个。教训：**探测半径要按被测对象的尺度来定**，
 * 拍一个"看起来够了"的常数，红的会是断言而不是被测代码。
 */
const looseProbe = (() => {
  const D = geo.CHINA_DEM;
  const perArea = [];
  for (const a of AREAS) {
    const r = geo.ringRadiusDeg(a.ring);
    const tol = geo.areaDropTol(r);
    let lon0 = Infinity;
    let lon1 = -Infinity;
    let lat0 = Infinity;
    let lat1 = -Infinity;
    for (const [lo, la] of a.ring) {
      lon0 = Math.min(lon0, lo);
      lon1 = Math.max(lon1, lo);
      lat0 = Math.min(lat0, la);
      lat1 = Math.max(lat1, la);
    }
    const pad = tol + SRC_CELL_DEG * 3;
    const i0 = Math.max(0, Math.floor((lon0 - pad - D.lon0) / SRC_D_LON));
    const i1 = Math.min(geo.SRC_W - 1, Math.ceil((lon1 + pad - D.lon0) / SRC_D_LON));
    const j0 = Math.max(0, Math.floor((D.lat1 - (lat1 + pad)) / SRC_D_LAT));
    const j1 = Math.min(geo.SRC_H - 1, Math.ceil((D.lat1 - (lat0 - pad)) / SRC_D_LAT));
    let n = 0;
    let sample = null;
    // 扫满整个窗口（不提前退出）：`n` 要是"这一区一共有多少个宽容落点"这个真实数字，
    // 而不是"扫到第一个之前扫了几行" —— 后者只会让人以为容差是一片孤岛
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (region[j * geo.SRC_W + i] !== 0) {
          continue; // 只看空地：宽容命中只发生在空地上
        }
        const lon = D.lon0 + (i + 0.5) * SRC_D_LON;
        const lat = D.lat1 - (j + 0.5) * SRC_D_LAT;
        const v = geo.judgeAreaDrop(lon, lat, a.gridId, region, nameByGridId, r);
        if (!v.ok || !v.loose) {
          continue;
        }
        n++;
        if (!sample) {
          /*
           * 这个宽容落点离本区最近的格有多远 —— 量的时候要用**和判定同一个窗口半径**，
           * 否则量出来是 Infinity（我第一版写死 3 格，判定的窗口是 ceil(tol/格距)=4 格，
           * 于是量不到，11 个区全报 Infinity）。
           */
          const wr = Math.ceil(tol / SRC_CELL_DEG) + 1;
          let gap = Infinity;
          for (let dj = -wr; dj <= wr; dj++) {
            for (let di = -wr; di <= wr; di++) {
              const jj = j + dj;
              const ii = i + di;
              if (jj < 0 || jj >= geo.SRC_H || ii < 0 || ii >= geo.SRC_W) {
                continue;
              }
              if (region[jj * geo.SRC_W + ii] !== a.gridId) {
                continue;
              }
              gap = Math.min(gap, Math.hypot(di * SRC_D_LON * D.lonScale, dj * SRC_D_LAT));
            }
          }
          sample = { lon, lat, gap, msg: v.message };
        }
      }
    }
    perArea.push({ name: a.name, r, tol, n, sample });
  }
  return perArea;
})();

const looseOk = looseProbe.filter((x) => x.n > 0);
/**
 * 门槛 100 个：实测最少的是柴达木盆地 547 个（窗口里 1183 个空地格里捞回一半），
 * 最多的是内蒙古高原 2370 个。要求"有一大片"而不是"至少有一个" ——
 * 只有一两个落点的话，这点容差在课堂上等于没有。
 */
check("【关键】每个地形区都有一大片「宽容命中」的落点（指针偏出边界一点点仍判对）",
  looseProbe.every((x) => x.n >= 100),
  looseOk.length === AREAS.length
    ? `${AREAS.length}/${AREAS.length} 通过，宽容落点数 ${looseOk.map((x) => x.n).join("/")}（最少的柴达木要 ≥100）`
    : looseProbe.filter((x) => !x.n).map((x) => x.name).join(" / ") + " 没有宽容落点");

/**
 * 被捞回来的落点必须**真的在容差之内**。
 *
 * 这条守的是 `nearestOwnedRegion` 的窗口取整：窗口按 `ceil(tol/格距)` 开，
 * 四角最远伸到 tol·√2（0.42° → 0.6°），只看 `near.id` 的话容差就虚胖了 41%。
 * 现在 `judgeAreaDrop` 的宽松分支里补了一次 `near.deg <= tol`，
 * 所以这里量出来的 `gap`（口径与判定完全一致：到最近归属格**中心**的距离）必须 ≤ tol。
 */
check("宽容命中的落点**紧贴本区边界**：捞回来的距离都在容差之内（容差不能被用成「把远处也捞回来」）",
  looseProbe.every((x) => x.sample && x.sample.gap <= x.tol + 1e-9),
  looseProbe
    .filter((x) => x.sample)
    .map((x) => `${x.name} 离本区 ${x.sample.gap.toFixed(3)}° / 容差 ${x.tol.toFixed(3)}°`)
    .join(" · "));

check("宽容命中的提示与严格命中**不同**（学生该知道自己是「指得不太准」）", (() => {
  const strict = geo.judgeAreaDrop(88, 32.5, AREAS.find((a) => a.id === "qingzang").gridId, region, nameByGridId);
  const loose = looseProbe.find((x) => x.sample);
  return (
    strict.ok === true && !strict.loose && strict.message !== loose.sample.msg &&
    /大致归位/.test(loose.sample.msg) && !/大致归位/.test(strict.message)
  );
})(), (() => {
  const strict = geo.judgeAreaDrop(88, 32.5, AREAS.find((a) => a.id === "qingzang").gridId, region, nameByGridId);
  const loose = looseProbe.find((x) => x.sample);
  return `严格「${strict.message}」 | 宽容「${loose.sample.msg}」`;
})());

/* ------------- 透明缓冲区（v2.1.0 需求 3） ------------- */

/*
 * 用户原话：「现在在答题的时候，还是必须要拖动到完全对应的位置才能够加载，
 * 我希望就是在答题的时候相当于有一个透明缓冲区，在周围一些的位置也可以视作正确。」
 *
 * 量出来的真相是**两层**，缺一层都不成立：
 *
 * ① **容差本身太小**。v2.0.0 定的 0.42° ≈ 47 km，而地图横铺 1100 px 时
 *    1 px ≈ 6.2 km ⇒ 容差只有 **7.6 px 半径**。指针抖一下就不止这个数，
 *    学生感觉不到"有容差"，只觉得"必须完全对准"。
 *
 * ② **容差在「别人家的格上」根本不生效**。旧实现要求 `nearestOwnedRegion`
 *    返回的**最近格**属于目标；而落点一旦落在别人家的格上，最近的格就是脚下
 *    这一格（中心距 ≤ 0.71 格，比任何邻居都近），`bestId` 必然 ≠ 目标 ⇒ 判错。
 *    实测全图 46 996 个"容差内落点"里有 **8 568 个（18.2%）**是这种；
 *    柴达木盆地最惨 —— 57.6% 的容差点被包着它的青藏高原吃掉。
 *    而"空地"（gid=0）只占陆地的 **41.1%**，于是宽容命中实际是
 *    **碎在边界上的几条缝**，学生当然感觉不到。
 *
 * 所以 v2.1.0 把判据从"最近的那格必须是目标"改成
 * **「到目标区域的距离 ≤ 容差」** —— 这才是"围着目标外扩一圈"的本义，
 * 也与山脉判定（`judgeRangeDrop`：离本山脉走带最近且 ≤ tol）同构。
 *
 * ⚠️ 代价与边界：落在别人家的格上、但贴着边界的那一圈**也会判对**
 *    （提示会写明"落在「XX」的边上"）。教学上这是想要的 —— 地图边界本来就是
 *    概化的过渡带。但**绝不允许穿透一整个区域**：下面的采样断言把这条锁死了
 *    （离目标超过容差的一律判错，实测零例外）。
 */

/** 屏幕换算：地图横铺满画布，画布取教室常见宽度（真机 1024~1500 三档量过） */
const CANVAS_W_PX = 1100;
const SPAN_KM = geo.SPAN_X * 100;
const KM_PER_PX = SPAN_KM / (CANVAS_W_PX * geo.MAP_FIT);
const tolToPx = (deg) => (deg * 111.32) / KM_PER_PX;

check("【关键】落点容差在屏幕上够大（指针抖一下也还落在范围内）",
  tolToPx(geo.AREA_DROP_TOL_DEG) >= 12,
  `基础容差 ${geo.AREA_DROP_TOL_DEG}° ≈ ${(geo.AREA_DROP_TOL_DEG * 111.32).toFixed(0)} km `
  + `≈ ${tolToPx(geo.AREA_DROP_TOL_DEG).toFixed(1)} px（地图宽 ${CANVAS_W_PX}px 时 1px≈${KM_PER_PX.toFixed(2)}km）`);

/**
 * 缓冲区**要能伸到别人家的格上**，同时**不许穿透一整个区域**。
 *
 * 逐区扫包围盒（外扩容差 + 2 格，步长 3 格采样）：
 *   · 采样点到本区的最短距离 ≤ 容差 ⇒ 判定必须是 ok（落在谁的格上都一样）；
 *   · 超过容差 ⇒ 判定必须是 false。
 * 前者数出"缓冲区到底有多大一块是落在别人地盘上的"（旧实现恒为 0）；
 * 后者是"不许穿透"的反证。
 *
 * 距离口径与判定内部**完全一致**：扫 `ceil(tol/格距)+1` 圈、量到格中心的
 * 等效度（经度乘 cos36°）。口径不一致的判据会给出假红假绿 —— 这个坑踩过。
 */
const bufferProbe = (() => {
  const D = geo.CHINA_DEM;
  const cellDistToGid = (i, j, gid, win) => {
    let best = Infinity;
    for (let dj = -win; dj <= win; dj++) {
      const jj = j + dj;
      if (jj < 0 || jj >= geo.SRC_H) continue;
      for (let di = -win; di <= win; di++) {
        const ii = i + di;
        if (ii < 0 || ii >= geo.SRC_W) continue;
        if (region[jj * geo.SRC_W + ii] !== gid) continue;
        const d = Math.hypot(di * SRC_D_LON * D.lonScale, dj * SRC_D_LAT);
        if (d < best) best = d;
      }
    }
    return best;
  };
  const per = [];
  for (const a of AREAS) {
    const tol = geo.areaDropTol(geo.ringRadiusDeg(a.ring));
    const win = Math.ceil(tol / SRC_CELL_DEG) + 1;
    let lon0 = Infinity, lon1 = -Infinity, lat0 = Infinity, lat1 = -Infinity;
    for (const [lo, la] of a.ring) {
      lon0 = Math.min(lon0, lo); lon1 = Math.max(lon1, lo);
      lat0 = Math.min(lat0, la); lat1 = Math.max(lat1, la);
    }
    const pad = tol + SRC_CELL_DEG * 2;
    const i0 = Math.max(0, Math.floor((lon0 - pad - D.lon0) / SRC_D_LON));
    const i1 = Math.min(geo.SRC_W - 1, Math.ceil((lon1 + pad - D.lon0) / SRC_D_LON));
    const j0 = Math.max(0, Math.floor((D.lat1 - (lat1 + pad)) / SRC_D_LAT));
    const j1 = Math.min(geo.SRC_H - 1, Math.ceil((D.lat1 - (lat0 - pad)) / SRC_D_LAT));
    let within = 0;        // 容差内的采样点（且都不是本区格）
    let withinForeign = 0; // 其中落在**别人家格上**的（旧实现恒为 0）
    let neighborCells = 0; // 采样范围内出现了多少"别人家的格"（0 ⇒ 这个区四周只有空地）
    let nearestOther = Infinity; // 到最近一个"别人家的格"的距离（判断"够不够得着"用它）
    let missed = 0;        // 容差内却判错的
    let farOk = 0;         // 容差外却判对的（穿透）
    let firstMiss = null;
    let firstFar = null;
    for (let j = j0; j <= j1; j += 3) {
      for (let i = i0; i <= i1; i += 3) {
        const own = region[j * geo.SRC_W + i];
        if (own === a.gridId) {
          continue; // 本区格上一定判 ok，且不是"缓冲区"想守的东西
        }
        const d = cellDistToGid(i, j, a.gridId, win);
        if (own !== 0) {
          neighborCells++;
          if (d < nearestOther) {
            nearestOther = d;
          }
        }
        const lon = D.lon0 + (i + 0.5) * SRC_D_LON;
        const lat = D.lat1 - (j + 0.5) * SRC_D_LAT;
        const v = geo.judgeAreaDrop(lon, lat, a.gridId, region, nameByGridId, geo.ringRadiusDeg(a.ring));
        if (d <= tol) {
          within++;
          if (own !== 0) withinForeign++;
          if (!v.ok) {
            missed++;
            if (!firstMiss) firstMiss = `${lon.toFixed(2)},${lat.toFixed(2)} 离${a.name}${d.toFixed(3)}°(≤${tol.toFixed(3)})却判「${v.message}」`;
          }
        } else if (v.ok) {
          farOk++;
          if (!firstFar) firstFar = `${lon.toFixed(2)},${lat.toFixed(2)} 离${a.name}${d === Infinity ? "∞" : d.toFixed(3)}°(>${tol.toFixed(3)})却判对`;
        }
      }
    }
    per.push({
      name: a.name, tol, within, withinForeign, neighborCells, nearestOther,
      missed, farOk, firstMiss, firstFar
    });
  }
  return per;
})();

/**
 * 缓冲区必须真的外扩出去 —— 门槛要**按接壤情况分流**，一个数套所有区会红。
 *
 * 三种数据形状（都是事实，不是 bug）：
 *   · **有邻区且接壤**（9 个区）：必须能伸过去。点数多寡取决于**接壤边界有多长**，
 *     所以这条门槛只能放到 5 —— 云贵高原只在一小段边界上贴着东南丘陵，
 *     最近的邻区格仅 0.15°，但那一段本身就短，采样（步长 3 格）只拿到 9 个点。
 *     拍 20 会红，而那不是代码错。
 *   · **四周只有空地**（内蒙古高原 / 准噶尔盆地 / 东北平原）：邻居是大兴安岭、
 *     天山、阿尔泰山这些**山脉**，而山脉不进 `region` 位图（位图只登记 12 个地形区）
 *     ⇒ 最近邻区是 ∞，"伸到别人家格上"结构上不可能。
 *   · **够不着**：两区之间那道缝比容差宽。这同时是"不许穿透"的镜像。
 *
 * 所以单区门槛放宽到 5，另加一条**总量**断言兜底（≥200）——
 * 免得"每条都刚好 5 个"这种退化情况骗过所有单区断言。
 */
const bufferReach = bufferProbe.map((x) => ({
  ...x,
  reachable: x.nearestOther > x.tol || x.withinForeign >= 5
}));
check("【关键】缓冲区真的向外扩了一圈：接壤的区必须能伸到邻区格上，够不着的要求两区之间确实隔着一条比容差还宽的缝",
  bufferReach.every((x) => x.reachable),
  bufferProbe
    .map((x) => {
      if (x.withinForeign >= 5) {
        return `${x.name} 伸过去 ${x.withinForeign} 点`;
      }
      return x.nearestOther > x.tol
        ? `${x.name} 无可伸邻区（最近邻区 ${x.nearestOther === Infinity ? "∞" : x.nearestOther.toFixed(2)}° > 容差 ${x.tol.toFixed(2)}°）`
        : `${x.name} ✘ 只伸到 ${x.withinForeign} 点，且最近邻区仅 ${x.nearestOther.toFixed(2)}°`;
    })
    .join(" / "));

check("【关键】缓冲区伸到邻区上的**总量**够大（挡住「每条都刚好 5 个」这种退化解）",
  bufferProbe.reduce((s, x) => s + x.withinForeign, 0) >= 200,
  `合计 ${bufferProbe.reduce((s, x) => s + x.withinForeign, 0)} 个采样点落在别人家的格上`);

check("【关键】容差之内一律判对（旧实现里这些点有 18.2% 被判错 —— 「最近的那格必须是目标」把缓冲区切碎了）",
  bufferProbe.every((x) => x.missed === 0),
  bufferProbe.every((x) => !x.missed)
    ? `12 个区、容差内落点 ${bufferProbe.map((x) => x.within).join("/")} 全中`
    : bufferProbe.filter((x) => x.missed).map((x) => `${x.name} 漏判 ${x.missed} 个（例：${x.firstMiss}）`).join(" | "));

check("【关键】缓冲区**不许穿透一整个区域**（离目标超过容差的一律判错）",
  bufferProbe.every((x) => x.farOk === 0),
  bufferProbe.every((x) => !x.farOk)
    ? "容差外的采样点零例外全部判错"
    : bufferProbe.filter((x) => x.farOk).map((x) => `${x.name} 穿透 ${x.farOk} 个（例：${x.firstFar}）`).join(" | "));

/** 反面：远离任何区域的地方仍然判错（容差不是"随便放都算对"） */
check("容差之外仍然判错（不是「随便放都算对」）",
  [ [86.0, 47.0], [104.0, 22.5], [126.0, 49.0] ].every(([lon, lat]) => {
    const v = geo.judgeAreaDrop(lon, lat, AREAS.find((a) => a.id === "chaidamu").gridId, region, nameByGridId);
    return v.ok === false;
  }),
  "86,47 / 104,22.5 / 126,49 三处都判错");


/* ===================== 4b) 地势三级阶梯（v2.0.1） ===================== */

/*
 * v2.0.0 那版阶梯是**按高程阈值**画的（h > 4000 m、h > 500 m 的等值线），
 * 后果是天山、阿尔泰山顶冒出两块"第一级飞地"，塔里木 / 准噶尔 / 内蒙古被划进第三级，
 * 而且线根本不跟着山脉走 —— 学生拿课本一对就发现对不上。
 *
 * v2.0.1 换成**教材口径的地理区划**：两条山脉连线把中国划成三块
 * （昆仑—阿尔金—祁连—横断；大兴安岭—太行—巫山—雪峰山），
 * 判定就是"点落在线的哪一侧"。
 *
 * 这套判定在 Python（`regions_source.py` 的 `side_of` / `step_index_of`）与 TS
 * （`geo.ts` 的 `sideOfPolyline` / `stepIndexAt`）**各有一份实现**，唯一的绑定手段
 * 就是下面这张 `STEP_CITIES`：生成数据时 Python 跑一遍（`build_regions.py` 的闸门），
 * 这里再跑一遍同一张表。两边判得不一样就红 —— 否则"前端和后端算的不是一回事"
 * 这件事**完全没有征兆**：地图照样上色、城市照样落位，只是落错边。
 */

const STEP_LINES = regions.STEP_LINES;
const STEP_CITIES = regions.STEP_CITIES;

check("阶梯分界线正好两条，级别组合是 (1,2) 与 (2,3)（级别写错会让 `LINE_12`/`LINE_23` 之一找不到 ⇒ 那两级并成一片纯色）",
  STEP_LINES.length === 2 &&
  STEP_LINES.some((l) => l.hiStep === 1 && l.loStep === 2) &&
  STEP_LINES.some((l) => l.hiStep === 2 && l.loStep === 3) &&
  new Set(STEP_LINES.map((l) => l.id)).size === 2,
  STEP_LINES.map((l) => `${l.id}:${l.hiStep}-${l.loStep}（${l.line.length} 点）`).join("  "));

/**
 * **探针自洽**：`probeHi` 必须真的落在 `hiStep` 那一级、`probeLo` 落在 `loStep`。
 *
 * ⚠️ 这条是 v2.0.1 抓出来的一个**真 bug** 的守门员。
 *
 * `step23` 的 `probeHi` 原先填的是华北平原（第三级），而判定代码写成
 * `=== LINE_23.lo` 又把它抵消回去 —— 两个错互相抵消，于是：18 个城市全判对、
 * 图上三级颜色也对、Python 侧五道判据全绿。**没有任何一条旧断言能咬出来。**
 *
 * 旧写法只断言"两个探针的侧别不同"，那查的是"线退化了没有"（探针贴到线上才会红），
 * 对"探针填反了"完全无感。改成比**阶梯号**之后，写反的探针立刻现形。
 */
const badProbe = [];
for (const l of STEP_LINES) {
  const gotHi = geo.stepNumberOf(l.probeHi[0], l.probeHi[1]);
  const gotLo = geo.stepNumberOf(l.probeLo[0], l.probeLo[1]);
  if (gotHi !== l.hiStep || gotLo !== l.loStep) {
    badProbe.push(`${l.id} 的 probeHi(${l.probeHi}) 判出第${gotHi}级、声明 hiStep=${l.hiStep}；` +
      `probeLo(${l.probeLo}) 判出第${gotLo}级、声明 loStep=${l.loStep}`);
  }
}
check("【关键】探针自洽：probeHi 落在 hiStep 那一级、probeLo 落在 loStep 那一级（查「哪边算高」这条数据契约）",
  badProbe.length === 0,
  badProbe.length ? badProbe.join(" | ")
    : STEP_LINES.map((l) => `${l.id} hi=${l.hiStep} lo=${l.loStep} ✔`).join("  "));

/** 【跨语言绑定】18 个真实城市，按人教版教材口径逐个判 */
const badStepCity = [];
for (const c of STEP_CITIES) {
  const got = geo.stepNumberOf(c.lon, c.lat);
  if (got !== c.step) {
    badStepCity.push(`${c.name}（${c.lon},${c.lat}）应在第${c.step}级、实得第${got}级`);
  }
}
check("【跨语言绑定】18 个真实城市全部落在正确的阶梯（TS 与 Python 判的是同一张表）",
  badStepCity.length === 0 && STEP_CITIES.length === 18,
  badStepCity.length ? badStepCity.join(" | ")
    : `${STEP_CITIES.length} 城全中：` + STEP_CITIES.map((c) => `${c.name}${c.step}`).join(" "));

/*
 * **海拔梯度**：被涂成第一级的那一片，海拔必须真的最高。
 *
 * 这是与"城市落位"互补的一条 —— 城市是**点**的证据，这一条是**面**的证据。
 * 它也是 v2.0.0 那版做得到、而 v2.0.1 必须继续做对的事：三级之间要有清楚的落差。
 * 阈值按实测留足余量（实测 4480 / 1525 / 286 m，落差 2955 / 1239 m）。
 *
 * ⚠️ 这里**不能**写成"沿纬线自西向东级别只降不升"。听起来很对，地理上是假的：
 *    38°N 从西往东是 2 → 1 → 2 → 3 —— 阿尔金山脉以北是塔里木盆地（第二级），
 *    山脉以南的柴达木盆地在青藏高原范围里（第一级）。先探一遍再写断言，
 *    否则会得到一条"看着很硬、其实永久为假"的判据。
 */
const stepAlt = (() => {
  const sum = [0, 0, 0];
  const cnt = [0, 0, 0];
  for (let k = 0; k < TD.step.length; k += 7) {
    if (!TD.land[k]) {
      continue;
    }
    const s = TD.step[k];
    sum[s] += TD.alt[k];
    cnt[s]++;
  }
  return sum.map((v, i) => (cnt[i] ? v / cnt[i] : NaN));
})();

check("三级阶梯的平均海拔是有梯度的：一级 > 3000 m、二级落在 800~2600 m、三级 < 700 m",
  stepAlt[2] > 3000 && stepAlt[1] > 800 && stepAlt[1] < 2600 && stepAlt[0] < 700,
  `第一级 ${stepAlt[2].toFixed(0)} m / 第二级 ${stepAlt[1].toFixed(0)} m / 第三级 ${stepAlt[0].toFixed(0)} m`);

check("相邻两级之间的落差足够大（学生一眼看得出「阶梯」）",
  stepAlt[2] - stepAlt[1] > 1500 && stepAlt[1] - stepAlt[0] > 500,
  `一级−二级 = ${(stepAlt[2] - stepAlt[1]).toFixed(0)} m，二级−三级 = ${(stepAlt[1] - stepAlt[0]).toFixed(0)} m`);

/*
 * `data.step` 是给渲染用的**投影网格**版本（0 = 第三级 / 1 = 第二级 / 2 = 第一级）。
 *
 * ⚠️ 0 这个值**同时**表示"第三级"和"非陆地"，只能靠 `data.land` 区分 ——
 *    渲染里那句 `if (stepOn && land[k])` 就是这个意思。这里把"撞码"这件事
 *    明写成断言：哪天有人"顺手"把非陆地改成 3，渲染侧不同步就会变成
 *    "海上也铺了一层阶梯色"，而原因看着像"遮罩失效"。
 */
const stepStats = (() => {
  const n = [0, 0, 0];
  let landN = 0;
  let landZero = 0;
  let seaZero = 0;
  for (let k = 0; k < TD.step.length; k++) {
    if (TD.land[k]) {
      landN++;
      n[TD.step[k]]++;
      if (TD.step[k] === 0) {
        landZero++;
      }
    } else if (TD.step[k] === 0) {
      seaZero++;
    }
  }
  return { n, landN, landZero, seaZero };
})();

check("三级阶梯在投影网格上都占到了大片陆地（最窄的一级也不少于 4000 格）",
  stepStats.n[0] > 4000 && stepStats.n[1] > 4000 && stepStats.n[2] > 4000,
  `第三级 ${stepStats.n[0]} 格 / 第二级 ${stepStats.n[1]} 格 / 第一级 ${stepStats.n[2]} 格（陆地共 ${stepStats.landN} 格）`);

check("三级面积占比落在教材量级（一级 15~30% / 二级 40~58% / 三级 20~40%）",
  (() => {
    const p = stepStats.n.map((v) => v / stepStats.landN);
    return p[2] > 0.15 && p[2] < 0.3 && p[1] > 0.4 && p[1] < 0.58 && p[0] > 0.2 && p[0] < 0.4;
  })(),
  (() => {
    const p = stepStats.n.map((v) => ((v / stepStats.landN) * 100).toFixed(1) + "%");
    return `第一级 ${p[2]} / 第二级 ${p[1]} / 第三级 ${p[0]}（教材约 26 / 41 / 33）`;
  })());

check("第一级阶梯不含任何海洋格（青藏高原不可能长在海里）",
  (() => {
    for (let k = 0; k < TD.step.length; k++) {
      if (TD.step[k] === 2 && TD.land[k] !== 1) {
        return false;
      }
    }
    return true;
  })(),
  "`step === 2` 的格子全部 `land === 1`");

check("「0 既是第三级、也是非陆地」这个撞码确实存在 ⇒ 渲染必须配 `land` 读（遥感底图那处特判就靠它）",
  stepStats.landZero > 4000 && stepStats.seaZero > 10000,
  `陆地 step 0 有 ${stepStats.landZero} 格（第三级）、非陆地 step 0 有 ${stepStats.seaZero} 格`);

/**
 * `data.step` 必须与运行时判定逐格一致 —— 查的是 `buildTerrainData` 里那句
 * "反投影一趟顺手判掉"的下标算术。这类错误的表现是"判定对、颜色整体偏几十公里"，
 * 单看画面非常像"数据本来就这样"。
 *
 * ⚠️ 只比**离分界线 0.4°（约 44 km）以外**的采样点：投影网格是最近邻查表，
 *    采样点与它所落格子的中心最多差半格（约 6 km），贴着线比会大面积假红。
 *    这个 0.4° 是"真错也躲不过、假红也不会来"的余量（真错是几十公里级的整体偏移）。
 */
const stepAgree = (() => {
  let bad = 0;
  let n = 0;
  let first = "";
  for (let lat = 18; lat <= 53; lat += 0.5) {
    for (let lon = 74; lon <= 134; lon += 0.5) {
      const dLine = Math.min(...STEP_LINES.map((l) => geo.distToPolyline(lon, lat, l.line)));
      if (dLine < 0.4) {
        continue;
      }
      const g = geo.projGridIndex(lon, lat);
      const k = g.j * PW + g.i;
      if (TD.land[k] !== 1) {
        continue;
      }
      n++;
      const want = geo.stepIndexAt(lon, lat);
      if (TD.step[k] !== want) {
        bad++;
        if (!first) {
          first = `例：(${lon.toFixed(1)},${lat.toFixed(1)}) 期望 ${want}、表里 ${TD.step[k]}`;
        }
      }
    }
  }
  return { n, bad, first };
})();

check("`data.step` 与 `stepIndexAt()` 在投影网格上一致（离分界线 0.4° 以外的采样点，一格都不许差）",
  stepAgree.n > 500 && stepAgree.bad === 0,
  `比了 ${stepAgree.n} 格，不符 ${stepAgree.bad} 格${stepAgree.first ? "  " + stepAgree.first : ""}`);


/* ===================== 5) 山脉判定 ===================== */

const TOL = 0.55;

/** ① 同样最关键：27 条山脉的锚点必须判定为"对" */
let badRanges = [];
for (const r of RANGES) {
  const v = geo.judgeRangeDrop(r.anchor[0], r.anchor[1], r.id, RANGES, TOL);
  if (!v.ok) {
    badRanges.push(`${r.name}(${r.anchor.join(",")}) → ${v.message}`);
  }
}
check("【关键】27 条山脉的锚点，拖上去都判定为「对」",
  badRanges.length === 0, badRanges.length ? badRanges.join(" | ") : "27/27 通过");

// v1.4.0：横断山脉是一列平行山岭，它的锚点取的是**中间那条岭**的中点，
// 所以这里必须按"到最近那一条岭的距离"算 —— 只量主脊（最西边那条高黎贡山）的话，
// 它会显示成 0.702° 的"偏移"，看着像数据坏了，其实锚点好好地压在自己的岭上。
// 这条断言本来想问的是"锚点不能飘到走带外面"，distToRange 才是那个问题。
check("锚点就压在各自的走带上（到最近一条岭的距离 <0.02°）",
  RANGES.every((r) => geo.distToRange(r.anchor[0], r.anchor[1], r) < 0.02),
  RANGES.map((r) => geo.distToRange(r.anchor[0], r.anchor[1], r).toFixed(3)).join(","));

/** ①-b 一列平行山岭（横断山脉）自己的三条：结构、判定、间距 */
const hd = RANGES.find((r) => r.id === "hengduan");
check("横断山脉在数据里是一列**平行山岭**（≥4 条），不是一条",
  hd && hd.lines && hd.lines.length >= 4,
  hd && hd.lines ? `${hd.lines.length} 条` : "没有 lines 字段");
check("**每一条**平行岭上都判定为「对」—— 只认主脊的话，另外几条岭形同虚设",
  hd && hd.lines && hd.lines.every((l) =>
    l.every(([lon, lat]) => geo.judgeRangeDrop(lon, lat, "hengduan", RANGES, TOL).ok)),
  hd && hd.lines
    ? `${hd.lines.length} 条岭 × 各 ${hd.lines[0].length} 点，全部通过`
    : "—");
/*
 * v1.4.0：把"学生能不能在投影上真的数出 5 条"变成**可复算**的断言。
 *
 * 这里原来只有一条"相邻岭间距 >0.2°"，那个门槛**不够**：间距 0.85° 配走廊 0.25°
 * 时，缝隙只剩 0.19° ⇒ 屏幕上 2.7 px，投影上根本看不出是 5 条
 *（"看着还是一条"的老问题原封不动地留着）。
 *
 * ⚠️ 算的时候有个容易漏的步骤：走廊在**经度方向**的宽度不是 `half + fade`，
 *    而是 `(half + fade) / lonScale`。因为 `distToPolyline` 把经度差先乘了
 *    `lonScale`（= cos 36° ≈ 0.809）再算距离，南北向的岭等距线是东西向的，
 *    于是"经度方向"被放大了 1/0.809 ≈ 1.236 倍。
 *    第一版就是按 `half + fade` 直接算的，于是"缝隙 5.8 px"只存在于纸面上，
 *    真值只有 3.7 px —— 差点又交了个"看着分开了、其实糊着"的版本。
 *
 * 换算账（与 shot.js 里"画布 14.3 px/°"那条实测断言同源）：
 *    地图区约 902 px 宽 / 取景 73~136°E ⇒ 14.3 px/°
 */
const PX_PER_DEG = 14.3;
const LIFT_FADE_DEG = 0.08; // App.tsx 的 RIDGE_LIFT_FADE_DEG
const LON_SCALE = 0.809; // geo.ts 的 CHINA_DEM.lonScale = cos(36°)
/** 一条岭的塑形走廊在**经度方向**上单边覆盖多少度 */
const edgeDeg = ((hd.lift_half_deg ?? 0.42) + LIFT_FADE_DEG) / LON_SCALE;

/** 折线在给定纬度上的经度（按纬度线性插值）；该纬度不在折叠跨度的则返回 null */
const lonAtLat = (line, lat) => {
  for (let k = 0; k + 1 < line.length; k++) {
    const la1 = line[k][1];
    const la2 = line[k + 1][1];
    if (la1 !== la2 && (lat - la1) * (lat - la2) <= 0) {
      return line[k][0] + ((lat - la1) / (la2 - la1)) * (line[k + 1][0] - line[k][0]);
    }
  }
  return null;
};

/** 5 条岭**都**覆盖到的纬度区间（各条跨度的交集）—— 只有在这段里才可能同时看到 5 条 */
const spanLo = Math.max(...hd.lines.map((l) => l[0][1]));
const spanHi = Math.min(...hd.lines.map((l) => l[l.length - 1][1]));

/** 沿纬度扫一遍，找**最窄**的那道河谷缝隙（最坏情况才是"看不看得出"的判据） */
const gapStats = (() => {
  let worst = Infinity;
  let at = spanLo;
  for (let lat = spanLo; lat <= spanHi + 1e-9; lat += 0.05) {
    const xs = hd.lines.map((l) => lonAtLat(l, lat));
    if (xs.some((x) => x === null)) {
      continue;
    }
    for (let i = 0; i + 1 < xs.length; i++) {
      const gap = xs[i + 1] - xs[i] - 2 * edgeDeg;
      if (gap < worst) {
        worst = gap;
        at = lat;
      }
    }
  }
  return { worst, at };
})();

check(
  "一列平行岭之间**留得下看得见的缝隙**：最窄处 ≥0.35°（≈5 px @14.3 px/°）",
  Number.isFinite(gapStats.worst) && gapStats.worst >= 0.35,
  `最窄缝隙 ${gapStats.worst.toFixed(3)}° ≈ ${(gapStats.worst * PX_PER_DEG).toFixed(1)} px` +
    `（在 ${gapStats.at.toFixed(2)}°N）；单边走廊 ${edgeDeg.toFixed(3)}° = (${(
      hd.lift_half_deg ?? 0.42
    )}+${LIFT_FADE_DEG})/${LON_SCALE}`
);

/*
 * "5 条同现"的区间为什么只有 2.0° 而不是数据里写的 3.2°：
 * 第 1 条（最西那条）的南段压在**中缅边界**上（98.4°E / 26.4~27.5°N 在缅甸境内），
 * `clip_to_land` 把它裁到了 27.60°N 才开始。这是对的 —— 山岭不能画到国界外 ——
 * 所以这里量的是裁后结果，不是原始数据。想把它拉长只能整体东移，
 * 那会把第 5 条推进四川盆地，得不偿失。
 */
check(
  "**5 条同时可见**的纬度区间够高（≥1.8°，≈26 px）—— 不然能「数出 5 条」的地方只有一条窄缝",
  spanHi - spanLo >= 1.8,
  `${spanLo.toFixed(2)}~${spanHi.toFixed(2)}°N，${(spanHi - spanLo).toFixed(2)}° ≈ ` +
    `${((spanHi - spanLo) * PX_PER_DEG).toFixed(0)} px 高`
);

check("每条山脉至少 6 个折线点（太少的话脊会立不起来）",
  RANGES.every((r) => r.line.length >= 6),
  RANGES.map((r) => r.line.length).sort((a, b) => a - b).join(","));

check("山脉折线整体落在境内（沿线抽样都要 insideChina）",
  (() => {
    const bad = [];
    for (const r of RANGES) {
      const pts = r.line.filter((_, i) => i % 3 === 0);
      const miss = pts.filter((p) => !inChina(p[0], p[1])).length;
      if (miss > pts.length * 0.2) {
        bad.push(`${r.name}: ${miss}/${pts.length} 在境外`);
      }
    }
    return bad.length === 0 ? true : bad.join(" | ");
  })(),
  "允许 20% 的抽样点贴边越界（折线是简化过的）");

/**
 * 「最近的那条必须是它」这条规则，得在**真的会互相蹭到**的两条走带上测。
 *
 * 之前这里写的是"把太行山脉丢到秦岭走带上"：太行山离秦岭 6° 开外，
 * 落点先被上面那条「离得太远」拦住，根本走不到"比谁更近"这一步 ——
 * 断言红了也说明不了规则有问题，绿了更是假绿（测的是别的分支）。
 *
 * 所以这里让脚本自己去找"最容易被认错的那个点"：沿着每条走带取样，
 * 找出那些**同时贴着另一条走带**、且两条距离差得最开的点。
 * 数据改了它自己会重算，不会悄悄失效。
 */
const confusion = (() => {
  let best = null;
  for (const other of RANGES) {
    for (let t = 0; t <= 1; t += 1 / 80) {
      const idx = t * (other.line.length - 1);
      const k = Math.min(other.line.length - 2, Math.floor(idx));
      const f = idx - k;
      const lon = other.line[k][0] + (other.line[k + 1][0] - other.line[k][0]) * f;
      const lat = other.line[k][1] + (other.line[k + 1][1] - other.line[k][1]) * f;
      for (const target of RANGES) {
        if (target.id === other.id) {
          continue;
        }
        const dTarget = geo.distToPolyline(lon, lat, target.line);
        if (dTarget > TOL) {
          continue;
        }
        const dOther = geo.distToPolyline(lon, lat, other.line);
        const margin = dTarget - dOther;
        if (margin > 0 && (!best || margin > best.margin)) {
          best = { lon, lat, target, other, dTarget, dOther, margin };
        }
      }
    }
  }
  return best;
})();

check("存在能触发「最近的那条必须是它」的走带对（没有的话这条规则形同虚设）",
  confusion !== null,
  confusion
    ? `最容易被认错的是「${confusion.target.name}」与「${confusion.other.name}」，差 ${confusion.margin.toFixed(3)}°`
    : "没有任何一对走带互相蹭到");

check("「最近的那条必须是它」：把一条山脉丢到隔壁那条的走带上，会被指认成隔壁",
  (() => {
    if (!confusion) {
      return false;
    }
    const v = geo.judgeRangeDrop(confusion.lon, confusion.lat, confusion.target.id, RANGES, TOL);
    return v.ok === false && v.message.includes(confusion.other.name);
  })(),
  confusion
    ? `把「${confusion.target.name}」丢到 (${confusion.lon.toFixed(2)},${confusion.lat.toFixed(
        2
      )})（离它 ${confusion.dTarget.toFixed(3)}°、离「${confusion.other.name}」${confusion.dOther.toFixed(
        3
      )}°）→ ${geo.judgeRangeDrop(confusion.lon, confusion.lat, confusion.target.id, RANGES, TOL).message}`
    : "");

check("离得太远会被拦住（把秦岭丢到塔里木盆地中心）",
  geo.judgeRangeDrop(83.5, 39.6, "qinling", RANGES, TOL).ok === false,
  geo.judgeRangeDrop(83.5, 39.6, "qinling", RANGES, TOL).message);

check("了解性山脉与必考山脉各自的数量正确（22 必考 + 5 了解）",
  RANGES.filter((r) => r.core).length === 22 && RANGES.filter((r) => !r.core).length === 5,
  `${RANGES.filter((r) => r.core).length} / ${RANGES.filter((r) => !r.core).length}`);

// v2.0.1 加丘陵 => 四条分组。AREA_GROUPS 由 AREAS 的出现顺序派生（build_regions.py），
// 这里的第三条子断言就是"派生真的发生了"：顺序必须是 高原 → 盆地 → 平原 → 丘陵。
check("四条分组名与实际分组一致（4 高原 / 4 盆地 / 3 平原 / 1 丘陵）",
  regions.AREA_GROUPS.length === 4 &&
  regions.AREA_GROUPS.every((g) => AREAS.filter((a) => a.group === g).length > 0) &&
  AREAS.filter((a) => a.group === "四大高原").length === 4 &&
  AREAS.filter((a) => a.group === "四大盆地").length === 4 &&
  AREAS.filter((a) => a.group === "三大平原").length === 3 &&
  AREAS.filter((a) => a.group === "丘陵").length === 1,
  regions.AREA_GROUPS.join("/"));

check("分组名是从 AREAS 出现顺序派生的，不是另抄一份（抄漏的症状：图鉴里没有任何按钮能选中东南丘陵）",
  JSON.stringify(regions.AREA_GROUPS) === JSON.stringify([...new Set(AREAS.map((a) => a.group))]),
  `${regions.AREA_GROUPS.join("/")} vs 派生 ${[...new Set(AREAS.map((a) => a.group))].join("/")}`);

/* ---------- 南海诸岛附图（v2.0.0 重做，逐条对着 v1.5.3 的四个毛病） ---------- */

check("【合规】南海附图的十段线必须是**完整 10 段**（少一段就不是合规的中国地图）",
  regions.NANHAI.dashes.length === 10,
  `${regions.NANHAI.dashes.length} 段 —— v1.5.3 的取数只从 cn.json 抽陆地，十段线一段都没有`);

check("南海附图：岛礁 + 大陆南岸 150 块以上",
  regions.NANHAI.islands.length >= 150, `${regions.NANHAI.islands.length} 块`);

check("南海附图：面归面、线归线（岛礁闭合走 fill，十段线开放走 stroke）",
  regions.NANHAI.islands.every((d) => d.endsWith("Z")) &&
  regions.NANHAI.dashes.every((d) => !d.endsWith("Z") && d.includes("L")),
  `岛礁 ${regions.NANHAI.islands.length} 条闭合，十段线 ${regions.NANHAI.dashes.length} 条折线`);

/**
 * viewBox 收紧 —— 而且**四周留白必须均匀**（v2.0.0 修过一处真 bug）。
 *
 * v1.5.3 那版 viewBox 是 `0 0 19.563 19.000`，内容只用到 x≤14.70，右边 36%
 * 是空海。v2.0.0 重做时又踩了第二个坑：生成器把坐标平移了 `(-x0,-y0)`（搬到
 * 原点附近），viewBox 却仍然写成 `x0 y0 w h` —— 平移量算了两遍，内容落到
 * `[PAD, w−PAD]` 而 viewBox 是 `[x0, w+x0]`。后果不是"整体偏一点"：
 * 左边留白 0.8、**右边留白正好 0**（内容顶死在边界上，抗锯齿会啃掉半像素）。
 * 实测那版就是 `0.800 / 0.800 / 0.000 / 0.000`，整幅图偏在左上角。
 *
 * 所以这条断言不能只盯"总留白小"，必须四个方向分别卡 ——
 * 只卡总和的话，"左边 0.8、右边 0" 是能过关的。
 */
check("【关键】南海附图：viewBox 收紧到内容包围盒，且**四周留白均匀**", (() => {
  const [vx, vy, vw, vh] = regions.NANHAI.viewBox.split(" ").map(Number);
  if (!(vw > 0 && vh > 0)) {
    return false;
  }
  const pts = [];
  for (const d of [...regions.NANHAI.islands, ...regions.NANHAI.dashes]) {
    for (const m of d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)) {
      pts.push([Number(m[1]), Number(m[2])]);
    }
  }
  if (pts.length === 0) {
    return false;
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const pad = [x0 - vx, y0 - vy, vx + vw - x1, vy + vh - y1];
  global.__nhBox = {
    vw, vh, pad,
    fill: (x1 - x0) / vw,
    fillY: (y1 - y0) / vh
  };
  const inside = pad.every((p) => p >= -1e-9);
  const tight = pad.every((p) => p <= 0.6);
  const even = Math.max(...pad) - Math.min(...pad) <= 0.05; // 就是打这个 bug 的
  return inside && tight && even;
})(), (() => {
  const b = global.__nhBox;
  return b
    ? `viewBox ${b.vw.toFixed(2)}×${b.vh.toFixed(2)}，内容占 ${(b.fill * 100).toFixed(0)}% × ${(b.fillY * 100).toFixed(0)}%，四周留白 ${b.pad.map((p) => p.toFixed(3)).join(" / ")}`
    : "";
})());

check("南海附图的高宽比与南海本身一致（南北长，不是方的一块）", (() => {
  const [, , vw, vh] = regions.NANHAI.viewBox.split(" ").map(Number);
  const r = vw / vh;
  return r > 0.6 && r < 0.9;
})(), regions.NANHAI.viewBox);

/* ===================== 6) 积分状态机 ===================== */

check("基础分：地形区 20、山脉 12", game.BASE_POINTS.area === 20 && game.BASE_POINTS.line === 12, JSON.stringify(game.BASE_POINTS));
check("尝试系数：1 → 1.0、2 → 0.6、3+ → 0.3",
  game.attemptFactor(1) === 1 && game.attemptFactor(2) === 0.6 && game.attemptFactor(3) === 0.3 && game.attemptFactor(9) === 0.3, "");
check("pointsFor：地形区 20 / 12 / 6，山脉 12 / 7 / 4",
  game.pointsFor("area", 1) === 20 && game.pointsFor("area", 2) === 12 && game.pointsFor("area", 3) === 6 &&
  game.pointsFor("line", 1) === 12 && game.pointsFor("line", 2) === 7 && game.pointsFor("line", 3) === 4,
  `${game.pointsFor("area", 1)}/${game.pointsFor("area", 2)}/${game.pointsFor("area", 3)} · ${game.pointsFor("line", 1)}/${game.pointsFor("line", 2)}/${game.pointsFor("line", 3)}`);

check("初始态全零", (() => {
  const s = game.createState();
  return s.score === 0 && s.placed.length === 0 && s.wrongCount === 0 && s.firstTry === 0 && s.streak === 0 && s.bestStreak === 0;
})(), "");

/**
 * ② 提示里的数字必须就是记分板加的数字。
 *
 * 走遍一串有代表性的状态 × 每一个条目，逐一对比：
 * `applyCorrect` 实际加的分 === `gainFor` 事先算出来的分。
 * 这两者一旦脱节，学生看到的提示就和记分板打架。
 */
check("【关键】gainFor 与 applyCorrect 实际加分处处一致（提示里的 +N 不会和记分板打架）", (() => {
  const kinds = ["area", "line"];
  const ids = ["qingzang", "qinling", "talimu"];
  const states = [game.createState()];
  let s = game.createState();
  s = game.applyWrong(s);
  s = game.applyWrong(s);
  states.push(s);
  s = game.applyHint(s, "qingzang");
  states.push(s);
  s = game.applyCorrect(s, "qingzang", "area");
  states.push(s);
  s = game.applyCorrect(s, "talimu", "area");
  states.push(s);
  s = game.applyWrong(s);
  states.push(s);
  for (const st of states) {
    for (const kind of kinds) {
      for (const id of ids) {
        const predicted = game.gainFor(st, id, kind);
        const got = game.applyCorrect(st, id, kind).score - st.score;
        if (predicted !== got) {
          return `状态(score=${st.score},placed=${st.placed.length}) ${id}/${kind}：提示将为 +${predicted}，实际加 ${got}`;
        }
      }
    }
  }
  return true;
})(), "6 个状态 × 2 类 × 3 条目 = 36 组全对");

check("已归位的条目再放对是幂等的（不加分、不重复进 placed）", (() => {
  const s1 = game.applyCorrect(game.createState(), "qingzang", "area");
  const s2 = game.applyCorrect(s1, "qingzang", "area");
  return s2 === s1 || (s2.score === s1.score && s2.placed.length === 1 && s2.history.length === 1);
})(), "");

check("已归位的条目 gainFor 返回 0（提示里不会出现 +0 之外的怪数字）",
  game.gainFor(game.applyCorrect(game.createState(), "qinling", "line"), "qinling", "line") === 0, "");

check("连击：连续 3 次一次答对，第 3 次额外 +15", (() => {
  let s = game.createState();
  s = game.applyCorrect(s, "a", "area");
  s = game.applyCorrect(s, "b", "area");
  const before = s.score;
  s = game.applyCorrect(s, "c", "area");
  return s.score - before === 20 + game.STREAK_BONUS && s.bestStreak === 3 && s.firstTry === 3;
})(), "20 × 3 次 + 15 奖励 = 75");

check("放错：扣 5、放错计数 +1、连击清零、分数下限 0", (() => {
  const s0 = game.createState();
  const s1 = game.applyWrong(s0);
  const s2 = game.applyWrong(game.applyCorrect(s0, "a", "area"));
  return s1.score === 0 && s1.wrongCount === 1 && s2.score === 20 - 5 && s2.streak === 0 && s2.wrongCount === 1;
})(), "");

check("放错**不**写回尝试次数：同一张卡先错三次再放对，仍然拿满分", (() => {
  let s = game.createState();
  s = game.applyWrong(s);
  s = game.applyWrong(s);
  s = game.applyWrong(s);
  const s2 = game.applyCorrect(s, "qingzang", "area");
  return s2.placed.length === 1 && s2.history[0].attempt === 1 && s2.history[0].points === 20 && s2.firstTry === 1;
})(), "错 3 次之后一次答对仍记 attempt=1、+20");

check("提示：扣 8 分，并把该条目记成「多试了一轮」（随后放对只拿 6 成）", (() => {
  let s = game.createState();
  s = game.applyCorrect(s, "talimu", "area");
  const beforeHint = s.score;
  s = game.applyHint(s, "qingzang");
  const afterHint = s.score;
  const s2 = game.applyCorrect(s, "qingzang", "area");
  return beforeHint - afterHint === game.HINT_COST && s2.history[1].attempt === 2 && s2.history[1].points === 12;
})(), "20 → 20−8=12 → +12");

check("提示有 8 分的下限保护（0 分时不会变负）", game.applyHint(game.createState(), "x").score === 0, "");

check("进度与评级：一次答对率决定档位",
  game.gradeOf(game.createState(), 38).key === "keep" &&
  (() => {
    let s = game.createState();
    for (let i = 0; i < 38; i++) {
      s = game.applyCorrect(s, `id${i}`, "area");
    }
    return game.gradeOf(s, 38).key === "perfect";
  })(),
  `0 分 → ${game.gradeOf(game.createState(), 38).label}`);

check("progressOf 的完成数 / 比例正确",
  (() => {
    const s = game.applyCorrect(game.createState(), "a", "area");
    const p = game.progressOf(s, 38, 38);
    return p.done === 1 && p.total === 38 && Math.abs(p.ratio - 1 / 38) < 1e-9;
  })(),
  "");

const ANCHOR = [108.55, 33.86]; // 借秦岭的锚点当靶子（落在关中一带）
check("落偏提示：四个方位都报对，而且方向不能指反",
  (() => {
    // 落到锚点以南 → 要往北找；以此类推。这里的期望全部按"从落点走到锚点"来的，
    // 不是按"落点偏在哪边"—— 写反的话学生越走越远（曾经就是反的）。
    const toNorth = game.distanceHint(108.55, 28, ANCHOR);
    const toSouth = game.distanceHint(108.55, 40, ANCHOR);
    const toEast = game.distanceHint(100, 33.86, ANCHOR);
    const toWest = game.distanceHint(118, 33.86, ANCHOR);
    // 既要报对方向，也不能同时报出反方向 —— 只测"包含"的话，
    // 把南北都塞进同一句里也能蒙过去。
    return (
      /往北/.test(toNorth) && !/南/.test(toNorth) && /公里/.test(toNorth) &&
      /往南/.test(toSouth) && !/北/.test(toSouth) &&
      /往东/.test(toEast) && !/西/.test(toEast) &&
      /往西/.test(toWest) && !/东/.test(toWest)
    );
  })(),
  `南→${game.distanceHint(108.55, 28, ANCHOR)} / 北→${game.distanceHint(108.55, 40, ANCHOR)} / 西→${game.distanceHint(
    100,
    33.86,
    ANCHOR
  )} / 东→${game.distanceHint(118, 33.86, ANCHOR)}`);

check("落偏提示：斜着偏时合成中文方位（东北 / 东南），距离随偏差单调增",
  (() => {
    const toSoutheast = game.distanceHint(100, 40, ANCHOR); // 落点在锚点西北 → 往东南
    const toNortheast = game.distanceHint(105, 32, ANCHOR); // 落点在锚点西南 → 往东北
    const kmOf = (t) => Number((t.match(/(\d+) 公里/) || [0, 0])[1]);
    return (
      /往东南/.test(toSoutheast) && !/偏偏/.test(toSoutheast) && !/西北/.test(toSoutheast) &&
      /往东北/.test(toNortheast) && !/偏偏/.test(toNortheast) && !/西南/.test(toNortheast) &&
      kmOf(game.distanceHint(95, 42, ANCHOR)) > kmOf(toNortheast) &&
      kmOf(toNortheast) > 0
    );
  })(),
  `西北→${game.distanceHint(100, 40, ANCHOR)} / 西南→${game.distanceHint(105, 32, ANCHOR)} / 更远→${game.distanceHint(
    95,
    42,
    ANCHOR
  )}`);

check("落偏提示：已经很近时不报公里，只说「再挪一点点」",
  /很接近/.test(game.distanceHint(108.55, 33.9, ANCHOR)) &&
    /很接近/.test(game.distanceHint(109.0, 33.0, ANCHOR)),
  `${game.distanceHint(108.55, 33.9, ANCHOR)} / ${game.distanceHint(109.0, 33.0, ANCHOR)}`);

/* ===================== 8) 多人接力会话（v1.1.0） ===================== */

const S = require("./_session.cjs");

const THREE = [
  { studentId: 101, studentName: "甲" },
  { studentId: 102, studentName: "乙" },
  { studentId: 103, studentName: "丙" }
];

check("createSession：每人一份独立记分状态（互不影响）", (() => {
  const s = S.createSession(THREE, "relay");
  return (
    s.order.length === 3 &&
    s.rounds[101].score === 0 &&
    s.rounds[102].score === 0 &&
    s.rounds[101] !== s.rounds[102] &&
    s.seconds[103] === 0
  );
})(), "");

check("轮流模式：放对一张 → 加分给当前答题人，并自动换下一位", (() => {
  let s = S.createSession(THREE, "relay");
  const out = S.commitCorrect(s, "x1", "area");
  return (
    out.studentId === 101 &&
    out.gained === 20 &&
    out.session.rounds[101].score === 20 &&
    out.session.rounds[102].score === 0 &&
    S.currentId(out.session) === 102
  );
})(), "");

check("轮流模式：走到名单末尾会绕回第一位（而不是卡住）", (() => {
  let s = S.createSession(THREE, "relay");
  s = S.commitCorrect(s, "a", "area").session;
  s = S.commitCorrect(s, "b", "area").session;
  const third = S.currentId(s);
  s = S.commitCorrect(s, "c", "area").session;
  return third === 103 && S.currentId(s) === 101;
})(), "甲→乙→丙→甲");

check("指定答题人模式：放对**不**换人（老师不点就一直是他）", (() => {
  let s = S.createSession(THREE, "pick");
  s = S.commitCorrect(s, "a", "area").session;
  s = S.commitCorrect(s, "b", "line").session;
  return S.currentId(s) === 101 && s.rounds[101].score === 32;
})(), "");

check("**两种模式放错都不换人**（否则「答错＝把难题丢给下一位」会成为最优解）", (() => {
  const relay = S.commitWrong(S.createSession(THREE, "relay"));
  const pick = S.commitWrong(S.createSession(THREE, "pick"));
  return (
    S.currentId(relay) === 101 &&
    S.currentId(pick) === 101 &&
    relay.rounds[101].score === 0 &&
    relay.rounds[101].wrongCount === 1
  );
})(), "");

check("共用一张地图：别人放过的卡放不了（gained=0 且状态不变）", (() => {
  let s = S.createSession(THREE, "relay");
  s = S.commitCorrect(s, "dup", "area").session;
  const before = s.rounds[102].score;
  const out = S.commitCorrect(s, "dup", "area");
  return out.gained === 0 && out.session === s && S.isPlaced(s, "dup") && out.session.rounds[102].score === before;
})(), "");

check("commitCorrect 幂等：同一条目连发两次只加一次分", (() => {
  let s = S.createSession(THREE, "pick");
  s = S.commitCorrect(s, "same", "area").session;
  s = S.commitCorrect(s, "same", "area").session;
  return s.rounds[101].score === 20 && s.placed.length === 1;
})(), "");

check("focusPlayer：能点名切换，名单外的人被忽略（不改变状态）", (() => {
  const s = S.createSession(THREE, "relay");
  const toC = S.focusPlayer(s, 103);
  const outsider = S.focusPlayer(toC, 999);
  return S.currentId(toC) === 103 && outsider === toC && S.currentId(s) === 101;
})(), "");

check("commitHint：扣当前答题人的分，并让该条目掉一档系数", (() => {
  let s = S.createSession(THREE, "pick");
  s = S.commitHint(s, "h1");
  const afterHint = s.rounds[101].score;
  const out = S.commitCorrect(s, "h1", "area");
  // 提示算作多试了一轮 ⇒ 第 2 次答对按 0.6 系数：12 分
  return afterHint === 0 && out.gained === 12;
})(), "");

check("addSeconds：只记到指定的那个人头上", (() => {
  let s = S.createSession(THREE, "relay");
  s = S.addSeconds(s, 102, 7.4);
  s = S.addSeconds(s, 102, -1);
  return s.seconds[102] === 7.4 && s.seconds[101] === 0;
})(), "");

check("resultsOf：每人得分 = 各自状态里的分数，且按分从高到低排", (() => {
  let s = S.createSession(THREE, "pick");
  s = S.commitCorrect(s, "r1", "area").session; // 甲 +20
  s = S.focusPlayer(s, 102);
  s = S.commitCorrect(s, "r2", "area").session; // 乙 +20
  s = S.commitCorrect(s, "r3", "line").session; // 乙 +12
  const rows = S.resultsOf(s, 38);
  return (
    rows.length === 3 &&
    rows[0].studentId === 102 &&
    rows[0].score === 32 &&
    rows[0].correctCount === 2 &&
    rows[0].totalCount === 38 &&
    rows[2].score === 0
  );
})(), "");

check("**不重不漏**：全图归位后，各人塑成的张数之和 = 总张数，且已归位集合无重复", (() => {
  let s = S.createSession(THREE, "relay");
  const ids = regions.AREAS.map((a) => a.id).concat(regions.RANGES.map((r) => r.id));
  for (const id of ids) {
    s = S.commitCorrect(s, id, "area").session;
  }
  const split = THREE.map((p) => s.rounds[p.studentId].placed.length);
  const sum = split.reduce((a, b) => a + b, 0);
  const unique = new Set(s.placed);
  return (
    s.placed.length === ids.length &&
    unique.size === ids.length &&
    sum === ids.length &&
    Object.keys(s.owner).length === ids.length
  );
})(), "");

check("**分数守恒**：各人分数之和 = 每次放对的加分之和 − 每次扣分", (() => {
  let s = S.createSession(THREE, "relay");
  let gainedTotal = 0;
  for (const [id, kind] of [["p1", "area"], ["p2", "line"], ["p3", "area"]]) {
    const out = S.commitCorrect(s, id, kind);
    gainedTotal += out.gained;
    s = out.session;
  }
  s = S.commitWrong(s); // −5
  s = S.commitHint(s, "p4"); // −8
  const sum = THREE.reduce((acc, p) => acc + s.rounds[p.studentId].score, 0);
  return sum === Math.max(0, gainedTotal - 13) && gainedTotal === 52;
})(), "");

check("classGrade：三条都在场、且都一次答对时给出最高评级", (() => {
  let s = S.createSession(THREE, "relay");
  const ids = regions.AREAS.map((a) => a.id).concat(regions.RANGES.map((r) => r.id));
  for (const id of ids) {
    s = S.commitCorrect(s, id, "area").session;
  }
  const g = S.classGrade(s, ids.length);
  return g.key === "perfect" && s.placed.length === ids.length;
})(), "");

check("classGrade：放错会拉低评级（不是只看总分）", (() => {
  let s = S.createSession(THREE, "relay");
  const ids = regions.AREAS.map((a) => a.id);
  for (const id of ids) {
    s = S.commitCorrect(s, id, "area").session;
  }
  const perfect = S.classGrade(s, ids.length).key;
  for (let i = 0; i < 12; i++) {
    s = S.commitWrong(s);
  }
  return perfect === "perfect" && S.classGrade(s, ids.length).key !== "perfect";
})(), "");

/* ===================== 9) 底图与瓦片布局（v1.1.0） ===================== */

const BM = require("./_basemap.cjs");

// v1.4.0 加了第四种（当时叫「浅色地形」），v1.5.0 去掉那层白之后改名「原色地形」。
// 种类和顺序都是产品对外的样子，所以这里写死 ——
// 加一种就得来改这条，这是故意的（别改成 "length >= 3"，那样新底图漏配也没人发现）。
check("底图四选一，且只有遥感影像依赖联网", (() => {
  const kinds = BM.BASEMAPS.map((b) => b.kind);
  const online = BM.BASEMAPS.filter((b) => b.online).map((b) => b.kind);
  return kinds.join(",") === "relief,soft,hillshade,satellite" && online.join(",") === "satellite";
})(), BM.BASEMAPS.map((b) => `${b.kind}${b.online ? "(联网)" : ""}`).join(" "));

/*
 * 名字也写死。理由是 v1.5.0 真的踩过：底图从"淡彩"改成"原色"之后，
 * `label` 和 `note` 会变成**假话**（按钮上写着「浅色地形」而图一点也不浅），
 * 而这种错**截图和渲染都测不出来** —— 图上完全正常，只有读过字的人会困惑。
 */
check("底图标签：soft 已改名「原色地形」，note 不再承诺「由淡转浓」", (() => {
  const label = BM.BASEMAPS.find((b) => b.kind === "soft").label;
  const note = BM.BASEMAPS.find((b) => b.kind === "soft").note;
  return label === "原色地形" && !/淡彩|由淡转浓|浅色/.test(note);
})(), `soft → ${BM.BASEMAPS.find((b) => b.kind === "soft").label}｜${BM.BASEMAPS.find((b) => b.kind === "soft").note}`);

check("四张底图标签两两不同，且都非空（避免改名时复制粘贴撞车）", (() => {
  const ls = BM.BASEMAPS.map((b) => b.label);
  return ls.every((s) => typeof s === "string" && s.length > 0) && new Set(ls).size === ls.length;
})(), BM.BASEMAPS.map((b) => b.label).join(" / "));

check("Mercator 纵向换算自洽：lat → y → lat 可逆", [0, 17, 25.3, 36, 45.8, 54, 70].every((lat) => {
  return Math.abs(BM.mercYToLat(BM.latToMercY(lat)) - lat) < 1e-9;
}), "");

check("赤道在 Mercator 归一化 y 的正中间（0.5）", Math.abs(BM.latToMercY(0) - 0.5) < 1e-12, `${BM.latToMercY(0)}`);

const LAY = geo.mapLayout(1164, 700);
const Z = BM.pickZoom(LAY);
const RECTS = BM.tileRects(LAY, Z);

/** Albers 下"1 经度有多少 km"随纬度变——取南边界（最宽处）那一份 */
const kmPerLon = (lat) => {
  const p1 = proj.project(geo.CHINA_DEM.lon0, lat);
  const p2 = proj.project(geo.CHINA_DEM.lon0 + 1, lat);
  return Math.hypot(p2.x - p1.x, p2.y - p1.y) * geo.WORLD_UNIT_KM;
};
const KM_LON_S = kmPerLon(geo.CHINA_DEM.lat0);
const KM_LON_N = kmPerLon(geo.CHINA_DEM.lat1);

check("Albers 下经度方向**南宽北窄**：南边界 1 经度的 km 数比北边界大 60% 以上",
  KM_LON_S / KM_LON_N > 1.6,
  `南 ${KM_LON_S.toFixed(1)} km/度 vs 北 ${KM_LON_N.toFixed(1)} km/度（比值 ${(KM_LON_S / KM_LON_N).toFixed(2)}）`);

check("缩放级别由画布分辨率算出：瓦片像素/经度 ≥ 画布像素/经度（按**南边界**取）", (() => {
  const canvasPxPerDeg = (LAY.mapScale * KM_LON_S) / geo.WORLD_UNIT_KM;
  const tilePxPerDeg = (256 * (1 << Z)) / 360;
  return tilePxPerDeg >= canvasPxPerDeg && Z >= 4 && Z <= 6;
})(), `z=${Z}，瓦片 ${((256 * (1 << Z)) / 360).toFixed(1)} px/° vs 画布 ${((LAY.mapScale * KM_LON_S) / geo.WORLD_UNIT_KM).toFixed(1)} px/°`);

/** 真正要下载的瓦片数（v2.0.0：`RECTS` 是**子块**，每块瓦片切 TILE_SUBDIV² 份） */
const TILES = new Set(RECTS.map((t) => `${t.z}/${t.x}/${t.y}`));

check("要下载的瓦片数在合理范围（不是 1 张也不是上千张）",
  TILES.size > 4 && TILES.size <= 120, `${TILES.size} 张`);

check("子块数 = 瓦片数 × TILE_SUBDIV²，且编号覆盖 0..S-1 的每种组合", (() => {
  const S = BM.TILE_SUBDIV;
  if (RECTS.length !== TILES.size * S * S) {
    return false;
  }
  const seen = new Set(RECTS.map((t) => `${t.sx},${t.sy}`));
  return seen.size === S * S;
})(), `${RECTS.length} 个子块 / TILE_SUBDIV=${BM.TILE_SUBDIV}`);

check("每个子块的本地四角被 matrix3d 精确搬到 quad 上（单应解算本身的正确性）", (() => {
  const s = BM.SUB_SIZE;
  const local = [
    [0, 0],
    [s, 0],
    [s, s],
    [0, s]
  ];
  return RECTS.every((t) =>
    local.every(([x, y], k) => {
      const p = BM.applyMatrix3d(t.matrix, x, y);
      return Math.hypot(p.x - t.quad[k].x, p.y - t.quad[k].y) < 1e-6;
    })
  );
})(), (() => {
  const t = RECTS[0];
  const p = BM.applyMatrix3d(t.matrix, 0, 0);
  return `例：本地 (0,0) → (${p.x.toFixed(3)}, ${p.y.toFixed(3)}) vs quad (${t.quad[0].x.toFixed(3)}, ${t.quad[0].y.toFixed(3)})`;
})());

/**
 * **整条卫星底图的精度守门员**（v2.0.0）。两个数必须一起看：
 *
 *   ① 四角偏差 —— 必须**精确为 0**。
 *      轴对齐矩形做不到：实测最大 **26.8 px**、平均 10.3 px，而 DOM 里一格
 *      地形才 1.885 px，也就是影像和地形错开十几格。根因不是弧的矢高，而是
 *      **弧在画布上是斜的**（θ≈23° 处一段 3.75° 的子块，弧要落下 22 px），
 *      矩形的上边却是平的 —— 细分只能线性地把它变小。
 *      仿射也不行：斜梯形的两腰不平行（经线向极点收敛）。
 *      只有四点单应能让四个角精确对上。**所以一旦有人把 `matrix3d` 退回成
 *      `left/top/width/height`，这个数会从 0 跳到几十像素** ——
 *      而画面上只像"影像有点糊/和地形没对齐"，极难归因。
 *
 *   ② 内部偏差 —— 单应只保证四个角，四边形内部那条**纬线弧**仍然用弦代替。
 *      弧越短偏差越小（按 Δθ²），所以子块还是要切（见 TILE_SUBDIV）。
 *      实测最大 **0.88 px**（0.47 格）。门槛卡"不到一格 DEM"：
 *      超过一格就意味着某个地物已经落到隔壁格里了。
 */
const photoReg = (() => {
  const S = BM.TILE_SUBDIV;
  const SS = BM.SUB_SIZE;
  const cellPx = (geo.CELL_KM / geo.WORLD_UNIT_KM) * LAY.mapScale;
  let worstCorner = 0;
  let worstInner = 0;
  let sumCorner = 0;
  let sumInner = 0;
  let nCorner = 0;
  let nInner = 0;
  for (const t of RECTS) {
    const n = 1 << t.z;
    const wLon = ((t.x + t.sx / S) / n) * 360 - 180;
    const eLon = ((t.x + (t.sx + 1) / S) / n) * 360 - 180;
    // 图像内部 v 是按 **Mercator y** 线性的（瓦片就是这么切的）
    const mN = (t.y + t.sy / S) / n;
    const mS = (t.y + (t.sy + 1) / S) / n;
    const at = (u, v) =>
      geo.lonLatToCanvas(wLon + (eLon - wLon) * u, BM.mercYToLat(mN + (mS - mN) * v), LAY);
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ]) {
      const d = BM.applyMatrix3d(t.matrix, u * SS, v * SS);
      const a = at(u, v);
      const e = Math.hypot(d.x - a.x, d.y - a.y);
      sumCorner += e;
      nCorner++;
      if (e > worstCorner) {
        worstCorner = e;
      }
    }
    for (let i = 0; i <= 4; i++) {
      for (let j = 0; j <= 4; j++) {
        if ((i === 0 || i === 4) && (j === 0 || j === 4)) {
          continue;
        }
        const u = i / 4;
        const v = j / 4;
        const d = BM.applyMatrix3d(t.matrix, u * SS, v * SS);
        const a = at(u, v);
        const e = Math.hypot(d.x - a.x, d.y - a.y);
        sumInner += e;
        nInner++;
        if (e > worstInner) {
          worstInner = e;
        }
      }
    }
  }
  return { worstCorner, worstInner, avgCorner: sumCorner / nCorner, avgInner: sumInner / nInner, cellPx };
})();

check("**配准**：子块四角与投影后的真实角点**完全重合**（偏差 0）",
  photoReg.worstCorner < 1e-6,
  `最大 ${photoReg.worstCorner.toExponential(2)} px / 平均 ${photoReg.avgCorner.toExponential(2)} px（退回轴对齐矩形会是 26.8 px —— 一格才 ${photoReg.cellPx.toFixed(2)} px）`);

check("**配准**：子块内部偏差 < 一格 DEM（单应管四角，弧-弦偏差靠切分压住）",
  photoReg.worstInner < photoReg.cellPx,
  `内部最大 ${photoReg.worstInner.toFixed(3)} px = ${(photoReg.worstInner / photoReg.cellPx).toFixed(2)} 格 / 平均 ${photoReg.avgInner.toFixed(3)} px`);

/**
 * 切开到底买到了什么 —— **口径必须是"弧与弦的最大偏差"，不是"弧的高低差"**。
 *
 * 之前这条算的是 `max(y) − min(y)`，看起来像"矢高"，其实是**弧本身的落差**：
 * 一条纬线投到 Albers 上是一段倾斜的圆弧，两端和中间差多少，取决于它离
 * 中央经线多远。那个量反映的是"地图是个扇形"，不是"我们贴得准不准"，
 * 量出来 23.8 px（子块）/ 60.4 px（整块），完全不能当误差看。
 *
 * 真正的误差是**弧和它两端连线之间的最大距离**（弦偏差）：
 * 我们画的是直线，真实的是弧，这段距离就是"贴在哪儿都会错多少"。
 * 实测子块 0.32 px、整块 2.84 px —— 相差接近 9 倍，正好是 Δθ² 的量级。
 */
check("切开确实把**弧-弦偏差**压下去近一个数量级（这才是 TILE_SUBDIV 的理由）", (() => {
  const chordSag = (lo, hi, lat) => {
    const a = proj.project(lo, lat).y;
    const b = proj.project(hi, lat).y;
    let worst = 0;
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      const y = proj.project(lo + (hi - lo) * t, lat).y;
      worst = Math.max(worst, Math.abs(y - (a + (b - a) * t)));
    }
    return worst * LAY.mapScale; // 世界单位 → 画布像素
  };
  const S = BM.TILE_SUBDIV;
  const cellPx = (geo.CELL_KM / geo.WORLD_UNIT_KM) * LAY.mapScale;
  let worstSub = 0;
  let worstFull = 0;
  for (const t of RECTS) {
    const n = 1 << t.z;
    const wLon = ((t.x + t.sx / S) / n) * 360 - 180;
    const eLon = ((t.x + (t.sx + 1) / S) / n) * 360 - 180;
    worstSub = Math.max(worstSub, chordSag(wLon, eLon, BM.mercYToLat((t.y + t.sy / S) / n)));
    worstFull = Math.max(
      worstFull,
      chordSag((t.x / n) * 360 - 180, ((t.x + 1) / n) * 360 - 180, BM.mercYToLat(t.y / n))
    );
  }
  global.__sag2 = { worstSub, worstFull, cellPx };
  return worstSub < cellPx / 2 && worstFull > worstSub * 4;
})(), (() => {
  const s = global.__sag2 ?? { worstSub: 0, worstFull: 0, cellPx: 0 };
  return `子块 ${s.worstSub.toFixed(3)} px（一格 ${s.cellPx.toFixed(3)} px）/ 不切的话 ${s.worstFull.toFixed(3)} px`;
})());

/** 四边形并集是否盖住地图矩形 —— 铺不满会在边缘留下一条没影像的窄带 */
check("**瓦片铺满整张地图**（四边形并集要盖住取景框四边）", (() => {
  const mapL = LAY.mapX;
  const mapT = LAY.mapY;
  const mapR = LAY.mapX + geo.SPAN_X * LAY.mapScale;
  const mapB = LAY.mapY + geo.SPAN_Z * LAY.mapScale;
  let minL = Infinity;
  let minT = Infinity;
  let maxR = -Infinity;
  let maxB = -Infinity;
  for (const t of RECTS) {
    for (const p of t.quad) {
      if (p.x < minL) minL = p.x;
      if (p.x > maxR) maxR = p.x;
      if (p.y < minT) minT = p.y;
      if (p.y > maxB) maxB = p.y;
    }
  }
  global.__cover = { minL, minT, maxR, maxB, mapL, mapT, mapR, mapB };
  return minL <= mapL && minT <= mapT && maxR >= mapR && maxB >= mapB;
})(), (() => {
  const c = global.__cover;
  return c
    ? `四边形并集 x[${c.minL.toFixed(0)},${c.maxR.toFixed(0)}] y[${c.minT.toFixed(0)},${c.maxB.toFixed(0)}] ⊇ 地图 x[${c.mapL.toFixed(0)},${c.mapR.toFixed(0)}] y[${c.mapT.toFixed(0)},${c.mapB.toFixed(0)}]`
    : "";
})());

/**
 * 相邻不留缝（两条）—— 判据从"矩形边相减 ≤ 0"换成了**共边角点逐点重合**。
 *
 * 旧判据只在"轴对齐矩形"时代有意义（靠 1px 出血去盖缝）。换成单应之后，
 * 每个子块是一个四边形，唯一正确的判据是：**邻居共享的那两个角，坐标必须
 * 完全一致**。这比"相减 ≤ 0"强得多 —— 相减 ≤ 0 允许"叠住"，而叠住在单应
 * 下没有意义（会露出重影边缘）；也允许"看起来接上了但角点其实差零点几像素"。
 *
 * ⚠ 找邻居要按**瓦片 + 子块序号**跨着找：`sx` 到头的下一个是**下一块瓦片的
 * sx=0**，不能只在本瓦片里找。v2.0.0 第一次写就漏了这一层，于是"跨瓦片的
 * 那条缝"完全没被检查到。
 */
const tileByKey = new Map(RECTS.map((t) => [`${t.z}/${t.x}/${t.y}/${t.sx}/${t.sy}`, t]));
const seamWorst = { row: 0, col: 0, rowPairs: 0, colPairs: 0 };
for (const t of RECTS) {
  const S = BM.TILE_SUBDIV;
  const rn =
    t.sx + 1 < S
      ? tileByKey.get(`${t.z}/${t.x}/${t.y}/${t.sx + 1}/${t.sy}`)
      : tileByKey.get(`${t.z}/${t.x + 1}/${t.y}/0/${t.sy}`);
  if (rn) {
    seamWorst.rowPairs++;
    for (const [a, b] of [
      [1, 0],
      [2, 3]
    ]) {
      const d = Math.hypot(t.quad[a].x - rn.quad[b].x, t.quad[a].y - rn.quad[b].y);
      if (d > seamWorst.row) {
        seamWorst.row = d;
      }
    }
  }
  const dn =
    t.sy + 1 < S
      ? tileByKey.get(`${t.z}/${t.x}/${t.y}/${t.sx}/${t.sy + 1}`)
      : tileByKey.get(`${t.z}/${t.x}/${t.y + 1}/${t.sx}/0`);
  if (dn) {
    seamWorst.colPairs++;
    for (const [a, b] of [
      [3, 0],
      [2, 1]
    ]) {
      const d = Math.hypot(t.quad[a].x - dn.quad[b].x, t.quad[a].y - dn.quad[b].y);
      if (d > seamWorst.col) {
        seamWorst.col = d;
      }
    }
  }
}

check("同一行相邻子块共边**逐点重合**（含跨瓦片那条缝）",
  seamWorst.rowPairs > 0 && seamWorst.row < 1e-9,
  `${seamWorst.rowPairs} 对，最大不重合 ${seamWorst.row.toExponential(2)} px`);

check("同一列上下相邻子块共边**逐点重合**（含跨瓦片那条缝）",
  seamWorst.colPairs > 0 && seamWorst.col < 1e-9,
  `${seamWorst.colPairs} 对，最大不重合 ${seamWorst.col.toExponential(2)} px`);

/*
 * 旧的「子块净左上角反算回经纬度」配准断言在 v2.0.0 被删掉了 ——
 * 它守的正是那个被证伪的前提（矩形角点 = 投影角点）。现在配准由上面
 * 那一对「四角偏差 = 0 / 内部偏差 < 一格」守着，量的是同一件事但口径正确：
 * 旧口径把"贴得准不准"和"地图是扇形"混在一起，26.8 px 的错位它只报 1.35°，
 * 看不出是真错还是阈值没调好。
 */

check("瓦片 URL 里没有残留占位符，且密钥原样拼进去", (() => {
  const url = BM.tiandituTileUrl(5, 11, 7, "abc123");
  return (
    url.indexOf("{") < 0 &&
    url.indexOf("tk=abc123") > 0 &&
    url.indexOf("TILEMATRIX=5") > 0 &&
    url.indexOf("TILECOL=11") > 0 &&
    url.indexOf("TILEROW=7") > 0 &&
    /^https:\/\/t[0-7]\.tianditu\.gov\.cn\//.test(url)
  );
})(), BM.tiandituTileUrl(5, 11, 7, "abc123"));

check("子域按行列号轮转（不会所有瓦片都去挤 t0）", (() => {
  const subs = new Set();
  for (let x = 0; x < 8; x++) {
    subs.add(BM.tiandituTileUrl(5, x, 0, "k").match(/\/\/t(\d)\./)[1]);
  }
  return subs.size === 8;
})(), "");

/* ===================== 9) 本局计划：范围 / 低难度 / 预置（v1.2.0） ===================== */

const P = require("./_plan.cjs");

/**
 * 把数据翻译成计划层要的形状。
 *
 * 这里**不写分组名**（"四大高原"之类），而是用数据自带的 `kind`。
 * 分组名是给人看的文案，改一次文案就断一次测试；`kind` 是数据身份。
 */
const PLAN_ITEMS = [
  ...AREAS.map((a) => ({ id: a.id, scopeKey: a.kind })),
  ...RANGES.map((r) => ({ id: r.id, scopeKey: "range" }))
];
const ALL_IDS = PLAN_ITEMS.map((i) => i.id);
const SCOPES = ["all", "plateau", "basin", "plain", "hills", "range"];
const STARTS = ["blank", "easy"];

const planFor = (scope, start, seed) => P.planRound(PLAN_ITEMS, scope, start, P.mulberry32(seed));

check("条目清单：39 张 = 4 高原 + 4 盆地 + 3 平原 + 1 丘陵 + 27 山脉（分类专练的分母都从这儿来）", (() => {
  const by = {};
  for (const it of PLAN_ITEMS) {
    by[it.scopeKey] = (by[it.scopeKey] || 0) + 1;
  }
  return (
    PLAN_ITEMS.length === 39 &&
    by.plateau === 4 &&
    by.basin === 4 &&
    by.plain === 3 &&
    by.hills === 1 &&
    by.range === 27
  );
})(), `${PLAN_ITEMS.length} 张：高原 4 / 盆地 4 / 平原 3 / 丘陵 1 / 山脉 27`);

check("**不重不漏**：10 种组合下「待塑 ∪ 预置」恒等于全部 38 条，且两者无交集", (() => {
  for (const scope of SCOPES) {
    for (const start of STARTS) {
      const p = planFor(scope, start, 7);
      const set = new Set([...p.required, ...p.preset]);
      if (set.size !== ALL_IDS.length) {
        return `${scope}/${start}：并集只有 ${set.size} 条`;
      }
      if (p.required.some((id) => p.preset.includes(id))) {
        return `${scope}/${start}：有交集`;
      }
    }
  }
  return true;
})(), "10 种组合（这条是死局防线：漏一条永远打不完，重一条同一块地算两遍分）");

check("「待塑」与「预置」都保持数据原始顺序（卡片列表、归属图落盘顺序都得稳定）", (() => {
  for (const scope of SCOPES) {
    for (const start of STARTS) {
      const p = planFor(scope, start, 11);
      const rs = new Set(p.required);
      const ps = new Set(p.preset);
      if (p.required.join(",") !== ALL_IDS.filter((id) => rs.has(id)).join(",")) {
        return `${scope}/${start}：待塑顺序被打乱`;
      }
      if (p.preset.join(",") !== ALL_IDS.filter((id) => ps.has(id)).join(",")) {
        return `${scope}/${start}：预置顺序被打乱`;
      }
    }
  }
  return true;
})(), "");

check("大厅报的「本局要塑 N 张」与开局后的进度分母出自同一个算法（10 种组合 × 5 个种子）", (() => {
  for (const scope of SCOPES) {
    for (const start of STARTS) {
      const want = P.plannedCount(PLAN_ITEMS, scope, start);
      for (const seed of [1, 2, 3, 99, 12345]) {
        const got = planFor(scope, start, seed).required.length;
        if (got !== want) {
          return `${scope}/${start}/seed=${seed}：大厅说 ${want}，开局是 ${got}`;
        }
      }
    }
  }
  return true;
})(), "两个数字对不上，学生第一眼就会看到「大厅说 15 张、进来变成 14 张」");

check("「空白地图」：范围内的全要塑，范围之外的整类预置", (() => {
  const all = planFor("all", "blank", 3);
  const plateau = planFor("plateau", "blank", 3);
  return (
    all.preset.length === 0 &&
    all.required.length === 39 &&
    plateau.required.length === 4 &&
    plateau.preset.length === 35 &&
    plateau.preset.every((id) => PLAN_ITEMS.find((i) => i.id === id).scopeKey !== "plateau")
  );
})(), `全部/空白：预置 ${planFor("all", "blank", 3).preset.length} 待塑 39；只练高原：预置 35 待塑 4`);

// v2.0.1：地形区从 11 个变 12 个，三个 scopeKey 也变成四个（plateau/basin/plain/hills）
check("**分类专练**：只练山脉时，12 个地形区整类都已就位（地图上真的只缺山脉）", (() => {
  const p = planFor("range", "blank", 5);
  const presetKinds = new Set(p.preset.map((id) => PLAN_ITEMS.find((i) => i.id === id).scopeKey));
  return (
    p.required.length === 27 &&
    p.preset.length === 12 &&
    presetKinds.size === 4 &&
    !presetKinds.has("range") &&
    p.required.every((id) => PLAN_ITEMS.find((i) => i.id === id).scopeKey === "range")
  );
})(), "27 条山脉待塑 / 12 个地形区预置");

check("**低难度**：随机预置约六成，待塑远少于全部（39 张时留下 16 张左右）", (() => {
  const p = planFor("all", "easy", 42);
  const ratio = p.preset.length / PLAN_ITEMS.length;
  return p.required.length === P.plannedCount(PLAN_ITEMS, "all", "easy") && ratio > 0.5 && ratio < 0.7;
})(), `${planFor("all", "easy", 42).required.length} 待塑 / ${planFor("all", "easy", 42).preset.length} 预置`);

check("任何一局都留够练习量：池子只有 3 个（三大平原）时也不会只剩 1 张", (() => {
  const p = planFor("plain", "easy", 8);
  const p2 = planFor("basin", "easy", 8);
  return p.required.length >= 2 && p2.required.length >= 2;
})(), `只练平原：待塑 ${planFor("plain", "easy", 8).required.length}；只练盆地：待塑 ${planFor("basin", "easy", 8).required.length}`);

check("**每次随机**：换一批种子，预置集合真的不一样（不是写死的）", (() => {
  const seen = new Set();
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    seen.add(planFor("all", "easy", seed).preset.join(","));
  }
  return seen.size === 8;
})(), "8 个种子 → 8 种不同的预置组合");

check("同一个种子必然复现同一局（回归脚本能重放，不必往产品里塞测试开关）", (() => {
  const a = planFor("all", "easy", 20260917);
  const b = planFor("all", "easy", 20260917);
  return a.required.join(",") === b.required.join(",") && a.preset.join(",") === b.preset.join(",");
})(), "");

check("预置的选取是均匀随机的，没有系统性偏向（每条被预置的概率都在 0.6 附近）", (() => {
  const hit = {};
  const NSEED = 400;
  for (let seed = 0; seed < NSEED; seed++) {
    for (const id of planFor("all", "easy", seed).preset) {
      hit[id] = (hit[id] || 0) + 1;
    }
  }
  const rates = ALL_IDS.map((id) => (hit[id] || 0) / NSEED);
  const lo = Math.min(...rates);
  const hi = Math.max(...rates);
  // 400 次抽样下二项分布的标准差约 0.024 ⇒ ±0.1 是很宽的界，只为了抓"明显偏向"
  return lo > 0.5 && hi < 0.7;
})(), `最低被预置率 ${(Math.min(
  ...ALL_IDS.map((id) => {
    let c = 0;
    for (let seed = 0; seed < 400; seed++) {
      if (planFor("all", "easy", seed).preset.includes(id)) c++;
    }
    return c / 400;
  })
)).toFixed(3)} ~ 最高 ${(Math.max(
  ...ALL_IDS.map((id) => {
    let c = 0;
    for (let seed = 0; seed < 400; seed++) {
      if (planFor("all", "easy", seed).preset.includes(id)) c++;
    }
    return c / 400;
  })
)).toFixed(3)}`);

/* ---- 会话层：预置 ≠ 成绩 ---- */

const PLAN_RANGE = planFor("range", "blank", 1); // 27 条山脉待塑 + 11 个地形区预置

check("`isSettled` 认预置、`isPlaced` 不认（两个函数刻意分开，别混用）", (() => {
  const s = S.createSession(THREE, "relay", PLAN_RANGE);
  return (
    S.isPlaced(s, "qingzang") === false &&
    S.isSettled(s, "qingzang") === true &&
    S.isPlaced(s, "taihang") === false &&
    S.isSettled(s, "taihang") === false &&
    S.requiredCount(s) === 27
  );
})(), "预置 11 / 待塑 27");

check("预置的条目**不会被再塑一次**：commitCorrect 返回 gained 0 且 session 原地不动", (() => {
  const s = S.createSession(THREE, "relay", PLAN_RANGE);
  const out = S.commitCorrect(s, "qingzang", "area");
  return out.gained === 0 && out.session === s && s.placed.length === 0 && s.rounds[101].score === 0;
})(), "否则同一块地能加两次分");

check("预置的条目用「提示」也不扣分（它已经在图上了，闪位置毫无意义）", (() => {
  const s = S.createSession(THREE, "relay", PLAN_RANGE);
  return S.commitHint(s, "qingzang") === s;
})(), "");

check("成绩只算学生塑的：预置的 11 张不进 placed、不进 correctCount", (() => {
  let s = S.createSession(THREE, "relay", PLAN_RANGE);
  s = S.commitCorrect(s, "taihang", "line").session;
  const r = S.resultsOf(s, S.requiredCount(s))[0];
  return (
    s.placed.length === 1 &&
    r.correctCount === 1 &&
    r.totalCount === 27 &&
    s.owner.qingzang === undefined
  );
})(), "上报的 correctCount 不会因为预置而虚高");

check("全部待塑归位后 `allSettled` 为真（结算判定的依据，与预置无关）", (() => {
  let s = S.createSession(THREE, "relay", PLAN_RANGE);
  for (const id of PLAN_RANGE.required) {
    s = S.commitCorrect(s, id, "line").session;
  }
  return S.allSettled(s) === true && s.placed.length === 27;
})(), "");

/* ===================== 10) 图鉴会话：不需要答题的完整体（v1.3.0） ===================== */

const ATLAS = S.createAtlasSession(ALL_IDS);

check("图鉴：38 条地形**不重不漏**，整幅图都在图上（点了就有讲解可看）", (() => {
  const set = new Set(ATLAS.preset);
  return (
    ATLAS.preset.length === ALL_IDS.length &&
    set.size === ALL_IDS.length &&
    ALL_IDS.every((id) => S.isSettled(ATLAS, id) === true)
  );
})(), `preset ${ATLAS.preset.length} 条`);

check("图鉴：零待塑 ⇒ `requiredCount` 为 0，**判不出「做完了」**（不弹结算、不上报）", (() => {
  /*
   * App 里的结算条件是 `total > 0 && placed.length === total`。
   * 图鉴的 total 恒为 0，所以这一条不是"界面上不显示结算面板"，
   * 而是那个判定根本不会成立 —— 差别在于后者不依赖界面写对。
   */
  return S.requiredCount(ATLAS) === 0 && S.allSettled(ATLAS) === false;
})(), "结算的第一道条件就挡死了");

check("图鉴：无人 ⇒ 加分 / 扣分 / 提示 / 换人一律空转（分数在结构上根本不会产生）", (() => {
  const c = S.commitCorrect(ATLAS, "taihang", "line");
  return (
    S.currentId(ATLAS) === S.NO_CURRENT &&
    ATLAS.order.length === 0 &&
    c.gained === 0 &&
    c.session === ATLAS &&
    ATLAS.placed.length === 0 &&
    S.commitWrong(ATLAS) === ATLAS &&
    S.commitHint(ATLAS, "taihang") === ATLAS &&
    S.advance(ATLAS) === ATLAS
  );
})(), "哨兵 −1 挡住所有提交");

check("图鉴：成绩单为空 ⇒ 平台上不会留下图鉴的任何记录", (() => {
  return S.resultsOf(ATLAS, 0).length === 0 && Object.keys(ATLAS.owner).length === 0;
})(), "");

/* ===================== 地名标注候选表（v1.4.0） ===================== */

console.log("\n===== 地名标注：谁该被标、什么顺序（pickLabels）=====");

/*
 * 这套规则从 App.tsx 的 useMemo 里搬出来，就是为了能这样测。
 * 它们坏掉的样子截图看不出来：少一个名字、图鉴里一个名字都没有、
 * 两个同名标签互相压 —— 画面上都"看着挺正常"。
 */
const SRC = [
  { id: "a", name: "甲高原", anchor: [80, 30], scale: 1 },
  { id: "b", name: "乙盆地", anchor: [100, 30], scale: 1 },
  { id: "c", name: "丙山脉", anchor: [110, 40], scale: 0.86 },
  { id: "d", name: "丁山脉", anchor: null, scale: 0.86 }
];

check(
  "只标**已经在图上**的：没放上来的一个都不标，顺序 = 数据顺序（避让优先级要稳定）",
  (() => {
    const out = LB.pickLabels(SRC, (id) => id === "a" || id === "c", null);
    return out.length === 2 && out.map((l) => l.text).join("/") === "甲高原/丙山脉";
  })(),
  LB.pickLabels(SRC, (id) => id === "a" || id === "c", null).map((l) => l.text).join("/")
);

check(
  "刚放对 / 刚点开的那一条排在**第一位**（否则它的名字会被邻居的名字挤掉）",
  (() => {
    const out = LB.pickLabels(SRC, () => true, "c");
    return out.length === 3 && out[0].text === "丙山脉";
  })(),
  LB.pickLabels(SRC, () => true, "c").map((l) => l.text).join("/")
);

check(
  "优先级那一条**不在场上**时直接忽略（不能凭空冒出一个名字）",
  (() => {
    const out = LB.pickLabels(SRC, (id) => id !== "c", "c");
    return !out.some((l) => l.text === "丙山脉") && out.length === 2;
  })(),
  LB.pickLabels(SRC, (id) => id !== "c", "c").map((l) => l.text).join("/")
);

check(
  "优先级那一条**不会被画两遍**（两个同名标签会互相压，还会白占一次避让名额）",
  (() => {
    const out = LB.pickLabels(SRC, () => true, "b");
    return out.length === 3 && out.filter((l) => l.text === "乙盆地").length === 1;
  })(),
  `共 ${LB.pickLabels(SRC, () => true, "b").length} 条`
);

check(
  "没有锚点的条目跳过（画不出位置，不能让它占掉别人的避让名额）",
  (() => {
    const out = LB.pickLabels(SRC, () => true, null);
    return out.length === 3 && !out.some((l) => l.text === "丁山脉");
  })(),
  LB.pickLabels(SRC, () => true, null).map((l) => l.text).join("/")
);

check(
  "字号系数原样透传：山脉 0.86 / 地形区 1（细长的脉体不能被三个大字整个压住）",
  (() => {
    const out = LB.pickLabels(SRC, () => true, null);
    return out.find((l) => l.text === "甲高原").scale === 1 &&
      out.find((l) => l.text === "丙山脉").scale === 0.86;
  })(),
  LB.pickLabels(SRC, () => true, null).map((l) => `${l.text}:${l.scale}`).join(" ")
);

/*
 * 图鉴场景。这是**判据必须用 isSettled 而不是 isPlaced** 的地方：
 * 图鉴的 `required` 是空的，39 条全是预置的，按 isPlaced 过滤会一个名字都不剩 ——
 * 而图鉴恰恰是最需要名字的地方。用真实数据跑，顺带抓"某条 anchor 是空的"。
 */
const ALL_SRC = [
  ...regions.AREAS.map((a) => ({ id: a.id, name: a.name, anchor: a.anchor, scale: 1 })),
  ...regions.RANGES.map((r) => ({ id: r.id, name: r.name, anchor: r.anchor, scale: 0.86 }))
];
check(
  "图鉴场景：39 条全在图上 ⇒ **39 个名字一个不少**（真实数据，不是造的）",
  (() => {
    const out = LB.pickLabels(ALL_SRC, () => true, null);
    return out.length === 39 && out.every((l) => l.text && Number.isFinite(l.lon) && Number.isFinite(l.lat));
  })(),
  `标出 ${LB.pickLabels(ALL_SRC, () => true, null).length} / 39 个`
);

/* ===================== 11) 地图点击的命中判定（v1.5.3） ===================== */

const pick = require("./_pick.cjs");

/*
 * 目标形状与 `App.tsx` 的 `Item` 同构：`pickFeature` 只认"有没有 area / range"。
 *
 * ⚠️ "在锚点处点一下命中自己"**不能**当主要判据。锚点带那条规则（名字优先）让它
 * 在数学上必然成立（自己到自己的距离是 0，必定是最近的那个锚点），是句同义反复。
 * 真正要锁住的是"按形状走"的那两条路径对**每一条**要素都有覆盖，所以下面用
 * **逐格采样**算覆盖率，不拿锚点说事。
 */
const TARGETS = [
  ...AREAS.map((a) => ({ id: a.id, name: a.name, anchor: a.anchor, area: a })),
  ...RANGES.map((r) => ({ id: r.id, name: r.name, anchor: r.anchor, range: r }))
];
const AREA_ONLY = TARGETS.filter((t) => t.area);
const hitAt = (targets, lon, lat) => pick.pickFeature(lon, lat, targets, region);
const r2 = (v, d = 2) => Number(v.toFixed(d));
const lonAt = (i) => geo.CHINA_DEM.lon0 + (i / (W - 1)) * (geo.CHINA_DEM.lon1 - geo.CHINA_DEM.lon0);
const latAt = (j) => geo.CHINA_DEM.lat1 - (j / (H - 1)) * (geo.CHINA_DEM.lat1 - geo.CHINA_DEM.lat0);

/* ---- ① 覆盖：每条要素在图上有多少"按形状就能点中"的位置 ---- */

const COVER = (() => {
  const stat = new Map(TARGETS.map((t) => [t.id, { name: t.name, shape: 0, anchor: 0 }]));
  let land = 0;
  let none = 0;
  for (let j = 0; j < H; j += 4) {
    for (let i = 0; i < W; i += 4) {
      if (!mask[j * W + i]) {
        continue;
      }
      land++;
      const h = hitAt(TARGETS, lonAt(i), latAt(j));
      if (!h) {
        none++;
        continue;
      }
      const row = stat.get(h.item.id);
      if (h.via === "anchor") {
        row.anchor++;
      } else {
        row.shape++;
      }
    }
  }
  const rows = [...stat.values()].sort((a, b) => a.shape - b.shape);
  return {
    rows,
    land,
    hit: land - none,
    thinnest: rows[0],
    anchorHits: rows.reduce((s, r) => s + r.anchor, 0)
  };
})();

check(
  "【主判据】38 条**每一条**在图上都有一片「按形状就能点中」的地方（最瘦的一条也不少于 5 处采样点）",
  COVER.thinnest.shape >= 5,
  `最瘦的「${COVER.thinnest.name}」${COVER.thinnest.shape} 处（采样步长 4 格）`
);

check(
  "锚点带只占命中里很小一部分 —— 名字优先是为救那一个冲突，不是主路径",
  COVER.anchorHits / COVER.hit < 0.08,
  `锚点带 ${COVER.anchorHits} / 命中 ${COVER.hit} = ${r2((COVER.anchorHits / COVER.hit) * 100, 1)}%`
);

note(
  "可点面积最薄的 5 条（都是窄山脉，本来就细）",
  COVER.rows
    .slice(0, 5)
    .map((r) => `${r.name} ${r.shape}`)
    .join(" / ")
);

/* ---- ② 地块：与落点判定同源（查同一张区域位图） ---- */

const GRID_SAMPLE = (() => {
  const byGrid = new Map(AREAS.map((a) => [a.gridId, a]));
  let sample = 0;
  let bad = 0;
  for (let j = 0; j < H; j += 3) {
    for (let i = 0; i < W; i += 3) {
      const gid = region[j * W + i];
      if (!gid) {
        continue;
      }
      sample++;
      const h = hitAt(AREA_ONLY, lonAt(i), latAt(j));
      if (!h || h.item.id !== byGrid.get(gid).id) {
        bad++;
      }
    }
  }
  return { sample, bad };
})();

check(
  "地形区按归属格命中：抽样每一格都命中**它自己**（与 `judgeAreaDrop` 查同一张位图）",
  GRID_SAMPLE.sample > 3000 && GRID_SAMPLE.bad === 0,
  `${GRID_SAMPLE.sample - GRID_SAMPLE.bad} / ${GRID_SAMPLE.sample}`
);

const CHAIDAMU = (() => {
  const cd = AREAS.find((a) => a.name.includes("柴达木"));
  const h = hitAt(TARGETS, cd.anchor[0], cd.anchor[1]);
  return { cd, id: h.item.id, name: h.item.name, via: h.via };
})();

check(
  "小面积优先：柴达木盆地的锚点命中柴达木盆地，而不是把它包在里面的青藏高原",
  CHAIDAMU.id === CHAIDAMU.cd.id,
  `命中「${CHAIDAMU.name}」via=${CHAIDAMU.via}`
);

/* ---- ③ 山带：容差是"画出来的那条带子"，**不是**落点容差 ---- */

const TOL_WINDOW = (() => {
  /*
   * 这是本轮最容易写错的一处：落点容差 0.55° 比走带半宽（0.50°，横断 0.28°）宽，
   * 是刻意留给学生的宽容度。拿它来做命中，山脉就会把手伸到自己带子外面，
   * 把周围地形区整片吃掉 —— 而且只在边缘一带发生，最难归因。
   *
   * 所以逐条山脉从锚点朝 8 个方向往外走，找"在走带外、但还在落点容差内"的点，
   * 要求这些点上**点不中**这条山脉。
   */
  const dirs = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
    [0.7, 0.7],
    [-0.7, 0.7],
    [0.7, -0.7],
    [-0.7, -0.7]
  ];
  let found = 0;
  const bad = [];
  for (const r of RANGES) {
    let p = null;
    for (let step = 0.02; step <= TOL + 0.2 && !p; step += 0.02) {
      for (const d of dirs) {
        const lon = r.anchor[0] + d[0] * step;
        const lat = r.anchor[1] + d[1] * step;
        const dist = geo.distToRange(lon, lat, r);
        if (dist > geo.corridorHalfDeg(r) + 0.01 && dist <= TOL) {
          p = { lon, lat, dist };
          break;
        }
      }
    }
    if (!p) {
      continue;
    }
    found++;
    const h = hitAt(TARGETS, p.lon, p.lat);
    if (h && h.item.id === r.id) {
      bad.push(`${r.name}→${h.via}`);
    }
  }
  return { found, bad };
})();

check(
  "【关键】山脉走带之外、落点容差之内**不命中**那条山脉（点击容差 ≠ 落点容差 0.55°）",
  TOL_WINDOW.found === RANGES.length && TOL_WINDOW.bad.length === 0,
  `${TOL_WINDOW.found} / ${RANGES.length} 条都找到了探针点，误命中 ${TOL_WINDOW.bad.length} 条` +
    (TOL_WINDOW.bad.length ? "：" + TOL_WINDOW.bad.join(" ") : "")
);

/* ---- ④ 名字优先：那个实测出来的冲突 ---- */

const NAME_WINS = (() => {
  const plain = AREAS.find((a) => a.name.includes("长江中下游"));
  const dabie = RANGES.find((r) => r.name === "大别山");
  const d = geo.distToRange(plain.anchor[0], plain.anchor[1], dabie);
  const band = geo.corridorHalfDeg(dabie);
  const h = hitAt(TARGETS, plain.anchor[0], plain.anchor[1]);
  const R = pick.ANCHOR_RADIUS_DEG;
  // 全图最近的两个锚点（决定锚点带的**上界**：再大就会两个锚点互抢）
  let minPair = Infinity;
  for (let i = 0; i < TARGETS.length; i++) {
    for (let j = i + 1; j < TARGETS.length; j++) {
      const dd = geo.distToPoint(TARGETS[i].anchor[0], TARGETS[i].anchor[1], TARGETS[j].anchor);
      if (dd < minPair) {
        minPair = dd;
      }
    }
  }
  // 被"别人的走带"盖住的锚点里，离脊线**最远**的那一个（0.31°）—— 决定锚点带的**下界**
  let deepestAnchor = 0;
  let deepestWho = "";
  for (const r of RANGES) {
    for (const a of AREAS) {
      const dd = geo.distToRange(a.anchor[0], a.anchor[1], r);
      if (dd <= geo.corridorHalfDeg(r) && dd > deepestAnchor) {
        deepestAnchor = dd;
        deepestWho = `${a.name} 落在「${r.name}」走带里`;
      }
    }
  }
  return { plain, dabie, d, band, hit: h, R, minPair, deepestAnchor, deepestWho };
})();

check(
  "【用户会先试这一下】点「长江中下游平原」那几个字，弹出的是长江中下游平原，不是大别山",
  NAME_WINS.hit.item.id === NAME_WINS.plain.id && NAME_WINS.d <= NAME_WINS.band,
  `锚点离大别山脊线 ${r2(NAME_WINS.d)}° ≤ 走带半宽 ${r2(NAME_WINS.band)}°（几何上确实被盖住）` +
    ` ⇒ 命中「${NAME_WINS.hit.item.name}」via=${NAME_WINS.hit.via}`
);

check(
  "锚点带半径卡在两个实测边界之间：救得回被盖住的锚点，又不让两个锚点互抢",
  NAME_WINS.R > NAME_WINS.deepestAnchor && NAME_WINS.R < NAME_WINS.minPair / 2,
  `半径 ${r2(NAME_WINS.R, 3)}°，下界 ${r2(NAME_WINS.deepestAnchor)}°（${NAME_WINS.deepestWho}）、` +
    `上界 ${r2(NAME_WINS.minPair / 2)}°（最近的两个锚点相距 ${r2(NAME_WINS.minPair)}°）`
);

/* ---- ⑤ 答题场景的安全边界：只点得开"已经在图上的" ---- */

const QUIZ = S.createSession(THREE, "relay", PLAN_RANGE); // 12 个地形区预置、27 条山脉待塑
const quizCand = TARGETS.filter((t) => S.isSettled(QUIZ, t.id));

check(
  "答题模式的候选 = 本局预置 + 学生放对的（正是「已经填好、图上有对的要素和文字」那句）",
  quizCand.length === 12 &&
    quizCand.every((t) => t.area) &&
    S.isSettled(QUIZ, "qingzang") &&
    !S.isSettled(QUIZ, "taihang"),
  `候选 ${quizCand.length} 条：${quizCand.map((t) => t.name).join(" / ")}`
);

const QUIZ_PENDING = (() => {
  const bad = [];
  for (const r of RANGES) {
    const h = hitAt(quizCand, r.anchor[0], r.anchor[1]);
    if (h && h.item.id === r.id) {
      bad.push(r.name);
    }
  }
  const tai = RANGES.find((x) => x.name === "太行山脉");
  const probe = hitAt(quizCand, tai.anchor[0], tai.anchor[1]);
  return { bad, tai, probe };
})();

check(
  "【用户要的那条】答题时点**还没塑**的山脉，命中不到它（那一片归它脚下的地形区，或干脆没有）",
  QUIZ_PENDING.bad.length === 0,
  `27 条待塑山脉里，${
    QUIZ_PENDING.probe ? `例：太行山脉 ⇒ 命中「${QUIZ_PENDING.probe.item.name}」` : "点下去什么都没弹"
  }`
);

const QUIZ_SETTLED = (() => {
  const qz = AREAS.find((a) => a.name.includes("青藏高原"));
  for (let j = 40; j < H; j += 7) {
    for (let i = 60; i < W; i += 7) {
      if (region[j * W + i] !== qz.gridId) {
        continue;
      }
      const lon = lonAt(i);
      const lat = latAt(j);
      if (RANGES.some((r) => geo.distToRange(lon, lat, r) <= geo.corridorHalfDeg(r) + 0.1)) {
        continue;
      }
      const h = hitAt(quizCand, lon, lat);
      if (h && h.item.id === qz.id && h.via === "grid") {
        return { ok: true, lon, lat };
      }
    }
  }
  return { ok: false };
})();

check(
  "答题时点**已经在图上**的地形区 ⇒ 命中它自己（能点开看，不用回卡片栏翻）",
  QUIZ_SETTLED.ok,
  "取的是「离所有名字和走带都远」的一块，走的是地块那条路径"
);

check(
  "图鉴模式：39 条**全部**可点（`createAtlasSession` 把 39 条全设成预置 ⇒ `isSettled` 全真）",
  TARGETS.filter((t) => S.isSettled(ATLAS, t.id)).length === 39,
  "同一句 `isSettled` 同时满足图鉴与答题两条需求"
);

/* ---- ⑥ 空白处：不能凭空弹一条出来 ---- */

const BLANK = (() => {
  const sea = hitAt(TARGETS, 150, 30);
  for (let j = 0; j < H; j += 2) {
    for (let i = 0; i < W; i += 2) {
      if (!mask[j * W + i] || region[j * W + i]) {
        continue;
      }
      const lon = lonAt(i);
      const lat = latAt(j);
      if (RANGES.some((r) => geo.distToRange(lon, lat, r) <= geo.corridorHalfDeg(r) + 0.05)) {
        continue;
      }
      return { sea: sea === null, land: hitAt(TARGETS, lon, lat) === null, lon, lat };
    }
  }
  return { sea: sea === null, land: false };
})();

check(
  "海上、以及不属于任何地形区又离山很远的陆地：点下去什么都没有",
  BLANK.sea && BLANK.land,
  BLANK.lat ? `例：${r2(BLANK.lon, 3)}E ${r2(BLANK.lat, 3)}N ⇒ null（太平洋 150E 30N 也是 null）` : "找不到空白陆地点"
);

/* ---- ⑦ 守门：走带宽度 ---- */

const CORRIDOR_BITE = (() => {
  const tot = new Map();
  const cut = new Map();
  for (let j = 0; j < H; j += 2) {
    for (let i = 0; i < W; i += 2) {
      const gid = region[j * W + i];
      if (!gid) {
        continue;
      }
      tot.set(gid, (tot.get(gid) || 0) + 1);
      const lon = lonAt(i);
      const lat = latAt(j);
      for (const r of RANGES) {
        if (geo.distToRange(lon, lat, r) <= geo.corridorHalfDeg(r)) {
          cut.set(gid, (cut.get(gid) || 0) + 1);
          break;
        }
      }
    }
  }
  return AREAS.map((a) => ({
    name: a.name,
    pct: ((cut.get(a.gridId) || 0) / (tot.get(a.gridId) || 1)) * 100
  })).reduce((a, b) => (b.pct > a.pct ? b : a));
})();

check(
  "山脉走带盖住一个地形区的比例不超过 35%（再宽就会让「点这块地」变得别扭）",
  CORRIDOR_BITE.pct < 35,
  `最多的是「${CORRIDOR_BITE.name}」${r2(CORRIDOR_BITE.pct, 1)}% —— 那些格画的就是山带，点它们讲山脉是对的`
);

/* ===================== 12) 实景照片：齐全 + 失败态（v2.1.0） ===================== */

/*
 * 用户在 v2.1.0 提了两个照片相关的问题，**根因是两个，不是一个**：
 *
 * ① 「东南丘陵实景照片待补充」—— 真的缺文件。v2.0.1 往 `regions.ts` 加了东南丘陵，
 *    但没往 `fetch_photos.py` 的 `ITEMS` 里加条目（那份清单才是照片的**唯一来源**），
 *    于是 `./assets/photos/dongan.jpg` 从来不存在。
 *    这类"数据加了、素材没跟上"是静默的：结构断言、判定断言、渲染断言**全都绿**，
 *    只有点开那张卡片才看得出来。
 *
 * ② 「很多地形明明有实景照片却依旧显示不了」—— 文件全都在，是**渲染态的 bug**：
 *    `onError` 里用命令式 `img.style.display = "none"` + `parent.classList.add("is-missing")`。
 *    React 复用同一个 `<img>` 节点（`src` 只是 prop 之一），**不会回滚**手写上去的
 *    style / class —— 于是只要打开过**一个**缺图条目，之后所有条目（哪怕照片好好的）
 *    都显示「实景照片待补充」。用户遇到的那个"缺图条目"正好是东南丘陵。
 *
 * 所以下面两条断言分别守这两件事：文件齐全（①）、失败态必须声明式（②）。
 * ② 的真机行为（缺图条目 → 有图条目 → 图片可见）在渲染回归里另有一条硬的。
 */

const PHOTO_DIR = path.join(__dirname, "..", "public", "assets", "photos");
const ALL_ITEMS = [...AREAS, ...RANGES];

/** 从 JPEG 字节里读宽高（扫 SOF 标记）。只为"不是小图"这一条，不引第三方依赖。 */
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) {
    return null;
  }
  let p = 2;
  while (p + 9 < buf.length) {
    if (buf[p] !== 0xff) {
      p++;
      continue;
    }
    const marker = buf[p + 1];
    // SOF0/1/2/3、5/6/7、9/10/11、13/14/15 —— 排除 DHT(c4) / JPG(c8) / DAC(cc)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(p + 5), w: buf.readUInt16BE(p + 7) };
    }
    p += 2 + buf.readUInt16BE(p + 2);
  }
  return null;
}

const photoRows = ALL_ITEMS.map((it) => {
  const p = path.join(PHOTO_DIR, `${it.id}.jpg`);
  if (!fs.existsSync(p)) {
    return { it, exists: false };
  }
  return { it, exists: true, size: jpegSize(fs.readFileSync(p)) };
});

check("【关键】39 个条目（12 个地形区 + 27 条山脉）都有实景照片文件",
  photoRows.every((r) => r.exists),
  photoRows.every((r) => r.exists)
    ? `${photoRows.length}/${photoRows.length} 齐`
    : `缺 ${photoRows.filter((r) => !r.exists).map((r) => `${r.it.name}(${r.it.id})`).join(" · ")}`);

/*
 * 尺寸断言分两条，因为**它们守的是两件不同的事**：
 *   · 比例：卡片照片框是 16:10（`aspect-ratio: 16/10`），比例不对就会被 `object-fit: cover`
 *     裁掉两头 —— 这是"构图统一"的那一条，必须严。
 *   · 宽度：`normalize()` 缩到 900 宽但**不放大**，所以原图分辨率不够的老照片
 *     （最小 649 px，`_download_best` 的兜底分支接的）就是小一号。
 *     这条只做"别小到糊"的门槛，实测下限 649 ⇒ 门槛定 640。
 */
const photoSizes = photoRows.filter((r) => r.exists && r.size).map((r) => r.size);
check("每张照片都是 16:10 的构图（卡片框就是 16:10，比例不对会被裁掉两头）",
  photoSizes.length === photoRows.length && photoSizes.every((s) => Math.abs(s.w / s.h - 1.6) < 0.02),
  photoSizes.map((s) => (s.w / s.h).toFixed(3)).filter((v, i, a) => a.indexOf(v) === i).join(" / "));

check("每张照片都够大（缩到 900 宽但不放大，原图不足的老照片最小 649 px）",
  photoSizes.length === photoRows.length && photoSizes.every((s) => s.w >= 640),
  `最窄 ${Math.min(...photoSizes.map((s) => s.w))} px，最宽 ${Math.max(...photoSizes.map((s) => s.w))} px，`
  + `共 ${photoSizes.filter((s) => s.w === 900).length}/${photoSizes.length} 张是 900 宽`);

const orphanPhotos = fs
  .readdirSync(PHOTO_DIR)
  .filter((f) => f.endsWith(".jpg") && !ALL_ITEMS.some((it) => `${it.id}.jpg` === f));
check("照片目录里没有孤儿文件（改名或删条目留下的死图会白占分发体积）",
  orphanPhotos.length === 0,
  orphanPhotos.length ? orphanPhotos.join(" · ") : "无");

/*
 * 照片失败态必须是**声明式**的。
 *
 * 这里守的是 React 的一个静默陷阱：命令式改过的 DOM（`style`、`className`）
 * 在 React 复用节点时**不会被回滚** —— 因为 React 只 diff 自己写上去的 props，
 * 手写的那部分它根本不知道。表现就是"打开过一个缺图条目之后，全部条目都没照片了"，
 * 而代码看着完全正常（onError 只做了一件看起来合理的事）。
 *
 * ⚠️ 判据要先**剥注释**：说明"为什么不能这么写"的注释里必然会写出这些 API 名，
 *    不剥的话注释会把自己判红（上一轮在 typography.test.cjs 上踩过一模一样的坑）。
 */
const APP_CODE = fs
  .readFileSync(path.join(__dirname, "..", "src", "App.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

check("【关键】照片失败态是声明式的：组件里没有命令式改 DOM（命令式写法在 React 复用节点时不会回滚）",
  !/\.style\s*\.\s*display\s*=/.test(APP_CODE) && !/\.classList\s*\.\s*(add|remove)\s*\(/.test(APP_CODE),
  (() => {
    const hits = [];
    if (/\.style\s*\.\s*display\s*=/.test(APP_CODE)) hits.push("style.display =");
    if (/\.classList\s*\.\s*(add|remove)\s*\(/.test(APP_CODE)) hits.push("classList.add/remove");
    return hits.length ? `App.tsx 里还有 ${hits.join(" / ")}` : "0 处";
  })());

check("照片失败态跟着条目走（存的是「哪一条失败过」，所以换条目自动重判、没有复位逻辑可漏）",
  /photoFailedId/.test(APP_CODE)
    && /photoFailedId\s*===\s*infoItem\.id/.test(APP_CODE)
    && /\bkey=\{infoItem\.id\}/.test(APP_CODE),
  "有 photoFailedId 状态 + 与当前条目 id 比对 + img 带 key");

/* ===================== 汇总 ===================== */



const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? (c.record ? "·" : "✔") : "✘"} ${c.name}${c.extra ? `  ${c.extra}` : ""}`);
}
console.log(
  `\nGAME CHECK ${failed.length === 0 ? "PASSED ✔" : "FAILED ✘"}  断言 ${checks.length} 项，失败 ${failed.length} 项`
);
process.exit(failed.length === 0 ? 0 : 1);
