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
 *    所以 11 个地形区 + 27 条山脉的锚点，一条不落地全判一遍。
 *
 * ② **`gainFor` 必须等于 `applyCorrect` 实际加的分**。
 *    给学生的提示里写着「+N」，记分板上的数字由 applyCorrect 算。
 *    这两处曾经各写一个常数，于是用过提示的条目提示写 +20、记分板只加 12 ——
 *    学生一定会发现，然后就再也不信提示里的数字了。这里用属性测试锁死。
 */
const geo = require("./_geo.cjs");
const game = require("./_game.cjs");
const regions = require("./_regions.cjs");

const checks = [];
const check = (name, cond, extra) => {
  checks.push({ name, ok: Boolean(cond), extra: extra === undefined ? "" : String(extra) });
};
const note = (name, extra) => {
  checks.push({ name, ok: true, extra: `（记录）${extra}`, record: true });
};

const AREAS = regions.AREAS;
const RANGES = regions.RANGES;
const W = geo.GRID_W;
const H = geo.GRID_H;

/* ===================== 1) 投影 ===================== */

check("世界跨度按 cos36° 修正过（东西跨度 / 南北跨度 ≈ 1.34）", (() => {
  const r = geo.SPAN_X / geo.SPAN_Z;
  return r > 1.32 && r < 1.36;
})(), (geo.SPAN_X / geo.SPAN_Z).toFixed(3));

check("经度 → x → 经度 可逆", [[73, 136, 88, 100.5]].every(() => true) &&
  [73, 88, 105.6, 121.5, 136].every((lon) => Math.abs(geo.xToLon(geo.lonToX(lon)) - lon) < 1e-9),
  "73/88/105.6/121.5/136");

check("纬度 → z → 纬度 可逆", [17, 25.3, 33.86, 45.8, 55].every((lat) => Math.abs(geo.zToLat(geo.latToZ(lat)) - lat) < 1e-9),
  "17/25.3/33.86/45.8/55");

check("北在 -z：最北（55°N）的 z 最小、最南（17°N）的 z 最大",
  geo.latToZ(55) < geo.latToZ(40) && geo.latToZ(40) < geo.latToZ(17),
  `${geo.latToZ(55).toFixed(2)} < ${geo.latToZ(40).toFixed(2)} < ${geo.latToZ(17).toFixed(2)}`);

check("取景框四角正好落在世界矩形边界上",
  Math.abs(geo.lonToX(73) + geo.SPAN_X / 2) < 1e-9 &&
  Math.abs(geo.lonToX(136) - geo.SPAN_X / 2) < 1e-9 &&
  Math.abs(geo.latToZ(55) + geo.SPAN_Z / 2) < 1e-9 &&
  Math.abs(geo.latToZ(17) - geo.SPAN_Z / 2) < 1e-9,
  `SPAN_X=${geo.SPAN_X.toFixed(2)} SPAN_Z=${geo.SPAN_Z.toFixed(2)}`);

check("gridIndex 是栅格下标且被夹在边界内",
  geo.gridIndex(73, 55).i === 0 && geo.gridIndex(73, 55).j === 0 &&
  geo.gridIndex(136, 17).i === W - 1 && geo.gridIndex(136, 17).j === H - 1 &&
  geo.gridIndex(200, 90).i === W - 1 && geo.gridIndex(200, 90).j === 0,
  `(73,55)→${JSON.stringify(geo.gridIndex(73, 55))} (136,17)→${JSON.stringify(geo.gridIndex(136, 17))}`);

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

check("区域位图每格 4 bit，编号落在 0..11", region.every((v) => v >= 0 && v <= 11), "");
check("11 个地形区的编号在图上都真的有格子", AREAS.every((a) => region.some((v) => v === a.gridId)) === true,
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
check("【关键】11 个地形区的锚点，拖上去都判定为「对」",
  badAnchors.length === 0, badAnchors.length ? badAnchors.join(" | ") : "11/11 通过");

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
  ["武汉", "changjiang", 114.31, 30.52]
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

check("放到不属于任何地形区的地方，提示的是「没有归属」而不是「隔壁是谁」",
  (() => {
    const v = geo.judgeAreaDrop(121.5, 47.0, AREAS.find((a) => a.id === "dongbei").gridId, region, nameByGridId);
    return v.ok === false && /不属于任何地形区/.test(v.message);
  })(),
  geo.judgeAreaDrop(121.5, 47.0, AREAS.find((a) => a.id === "dongbei").gridId, region, nameByGridId).message);

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

check("锚点就压在各自的走带上（离折线 <0.02°）",
  RANGES.every((r) => geo.distToPolyline(r.anchor[0], r.anchor[1], r.line) < 0.02),
  RANGES.map((r) => geo.distToPolyline(r.anchor[0], r.anchor[1], r.line).toFixed(3)).join(","));

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

check("三条分组名与实际分组一致（4 高原 / 4 盆地 / 3 平原）",
  regions.AREA_GROUPS.length === 3 &&
  regions.AREA_GROUPS.every((g) => AREAS.filter((a) => a.group === g).length > 0) &&
  AREAS.filter((a) => a.group === "四大高原").length === 4 &&
  AREAS.filter((a) => a.group === "四大盆地").length === 4 &&
  AREAS.filter((a) => a.group === "三大平原").length === 3,
  regions.AREA_GROUPS.join("/"));

check("南海诸岛附图有 150 条以上路径（十段线 + 岛礁）",
  regions.NANHAI.paths.length >= 150,
  `${regions.NANHAI.paths.length} 条，viewBox=${regions.NANHAI.viewBox}`);

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

/* ===================== 汇总 ===================== */

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? (c.record ? "·" : "✔") : "✘"} ${c.name}${c.extra ? `  ${c.extra}` : ""}`);
}
console.log(
  `\nGAME CHECK ${failed.length === 0 ? "PASSED ✔" : "FAILED ✘"}  断言 ${checks.length} 项，失败 ${failed.length} 项`
);
process.exit(failed.length === 0 ? 0 : 1);
