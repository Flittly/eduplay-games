/**
 * 位置图（中国地图 + 闪烁红点）的纯逻辑测试。
 *
 * 这一组断言要守三件事，都是「错了也看不太出来」的那种：
 *
 * 1. **两侧投影必须逐字一致。** 省界 path 是 Python 离线投影好的，红点位置是前端按
 *    `locmap.makeProjector` 实时算的。两边只要有一处写错（参数改了、度弧度换错、offset
 *    符号反了），红点就会相对省界整体漂移 —— 小图上只是"差一点点"，肉眼很难当回事。
 *    所以拿生成时写下的 `meta.probe` 对表。
 *
 * 2. **南北/东西颠倒会自我掩盖。** 投影写反时红点跟着一起反，图形看着仍然自洽，
 *    只有拿"纬度越高 y 越小""经度越大 x 越大""越远离中央经线 y 越大"这些**与图形无关的
 *    不变量**去卡，才拦得住。
 *
 * 3. **省界数据缺环曾经真的发生过。** DataV 的部分环末尾把首点写了两遍，只去一次尾点时
 *    RDP 基准段退化为 0 ⇒ 整环被静默丢光 ⇒ 四川省 path 成空串、高亮什么都不显示。
 *    这里立成断言：34 个省级行政区**每一个**都必须有非空 path。
 */
const locmap = require("./_locmap.cjs");
const locations = require("./_locations.cjs");
const mapmod = require("./_chinamap.cjs");
const data = require("./_data.cjs");

const checks = [];
const check = (name, cond, extra) => {
  checks.push({ name, ok: Boolean(cond), extra: extra === undefined ? "" : String(extra) });
};

const CHINA_MAP = mapmod.CHINA_MAP;
const meta = CHINA_MAP.meta;
const [VBX, VBY, VBW, VBH] = meta.viewBox;
const project = locmap.makeProjector(meta);

/** 1 个 viewBox 单位对应的地面距离（km）。投影在单位球上算 rho，乘 SCALE 得单位，
 *  所以 1 单位 = 6371 km / SCALE —— 实测与「贡嘎↔梅里 309 km / 49.2 单位 = 6.29」吻合。 */
const KM_PER_UNIT = 6371 / meta.scale;

/* ===== 1) 几何数据：每个省级行政区都必须画得出来 ===== */
const adcodes = Object.keys(CHINA_MAP.provinces);
check("省级行政区 34 个（含台湾省、香港、澳门）", adcodes.length === 34, adcodes.length);

const emptyProv = adcodes.filter((ad) => !CHINA_MAP.provinces[ad]);
check("每个省级行政区的 path 都非空",
  emptyProv.length === 0,
  emptyProv.length ? emptyProv.map((ad) => CHINA_MAP.provinceNames[ad] || ad).join("、") : "34/34");

for (const ad of ["710000", "810000", "820000", "510000", "540000", "530000", "610000"]) {
  check(`[${CHINA_MAP.provinceNames[ad]}] path 非空`, Boolean(CHINA_MAP.provinces[ad]));
}

check("国界轮廓非空", CHINA_MAP.outline.length > 100, `${CHINA_MAP.outline.length} 字符`);
check("插图轮廓非空", CHINA_MAP.inset.outline.length > 50);
check("断续线非空", CHINA_MAP.inset.nineDash.length > 50);

/* 断续线必须是**十段**。曾经因为窄条环被抽稀吞掉而只剩八段（段数少了肉眼难察），
   这条断言就是那次事故的锁。 */
const dashSegments = (CHINA_MAP.inset.nineDash.match(/M/g) || []).length;
check("断续线为十段（现行官方口径）", dashSegments === 10, `${dashSegments} 段`);

const [IX, IY, IW, IH] = CHINA_MAP.inset.box;
check("插图框完整落在主图内",
  IX >= 0 && IY >= 0 && IX + IW <= VBW + 1e-6 && IY + IH <= VBH + 1e-6,
  `box=[${[IX, IY, IW, IH].join(",")}] viewBox=[0,0,${VBW},${VBH}]`);
check("插图框在主图左下角（不压台湾/福建一侧）", IX + IW < VBW * 0.5, `右边缘 ${(IX + IW).toFixed(1)} / ${VBW}`);

/* ===== 2) 投影一致性：与生成器写下的 probe 对表 ===== */
/**
 * ⚠️ v2.4.0：这个文件里**凡是"上地图"的断言，分母都必须是真实样本**。
 *
 * 模板地形没有真实经纬度（`lat/lon` 是占位的 30/105），也不进 `locations.ts`
 * —— 它们本来就不该出现在中国地图上，界面对它们改画一张说明卡。
 * 当初把它们一并写进 `sources` 遍历，一口气红了 11 条：
 * `meta.probe` 里当然查不到它们（probe 是生成器按真实经纬度算的对表点），
 * 三个模板的"红点"全部重叠在同一个占位坐标上（距离 0.0 单位）。
 * 这依旧是**断言作用域**的问题，不是数据的问题 —— 模板压根不该在这儿。
 * 模板自己的契约在文件末尾「6) 模板地形不参与地理位置图」里守。
 */
const sources = data.REAL_SOURCES;
const templateSources = data.TEMPLATE_SOURCES;
let maxDev = 0;
let worst = "";
for (const s of sources) {
  const probe = meta.probe[s.tag];
  if (!probe) {
    check(`[${s.name}] meta.probe 里有对表坐标`, false, "缺失");
    continue;
  }
  const [x, y] = project(s.lat, s.lon);
  const dev = Math.hypot(x - probe[0], y - probe[1]);
  if (dev > maxDev) {
    maxDev = dev;
    worst = s.name;
  }
}
check("四座山：前端投影与生成器 probe 一致（偏差 < 0.5 单位）",
  maxDev < 0.5, `最大偏差 ${maxDev.toFixed(4)} 单位${worst ? `（${worst}）` : ""}`);

/* ===== 3) 朝向不变量（拦南北/东西颠倒这类"自我掩盖"的错误） ===== */
{
  const [x20] = project(20, meta.params.lam0);
  const [x50] = project(50, meta.params.lam0);
  const [, y20] = project(20, meta.params.lam0);
  const [, y50] = project(50, meta.params.lam0);
  check("中央经线上两点 x 相同（中央经线配置正确）",
    Math.abs(x20 - x50) < 0.01, `|Δx|=${Math.abs(x20 - x50).toExponential(2)}`);
  check("中央经线上高纬 y 更小（没有南北颠倒）",
    y50 < y20, `20°N y=${y20.toFixed(1)} → 50°N y=${y50.toFixed(1)}`);

  const [xw] = project(30, 75);
  const [xm] = project(30, 105);
  const [xe] = project(30, 135);
  const [, yw] = project(30, 75);
  const [, ym] = project(30, 105);
  const [, ye] = project(30, 135);
  check("同纬度：经度越大 x 越大（没有东西镜像）",
    xw < xm && xm < xe, `75°E ${xw.toFixed(0)} < 105°E ${xm.toFixed(0)} < 135°E ${xe.toFixed(0)}`);
  // ⚠️ 方向别写反：等纬线是**以上方圆锥顶点为圆心**的圆弧，圆心在上方 ⇒ 圆弧的最低点
  //    正落在中央经线下方 ⇒ 中央经线上 y **最大**，越往两侧翘得越高（y 越小）。
  //    实测 30°N：75°E→375、105°E→444、135°E→375。顺手一个真实例证：珠峰（27.99°N／86.9°E）
  //    比梅里（28.44°N／98.7°E）更靠南，y 却更小 —— 因为前者的"翘起"压过了那 0.45° 纬度差。
  check("同纬度：越远离中央经线 y 越小（等纬线向上翘，圆锥特征）",
    yw < ym && ye < ym, `75°E ${yw.toFixed(0)} / 105°E ${ym.toFixed(0)} / 135°E ${ye.toFixed(0)}`);
}

/* ===== 4) 红点落位 ===== */
function subpaths(d) {
  const out = [];
  for (const seg of d.match(/M[^M]*/g) || []) {
    const nums = seg.match(/-?\d+(?:\.\d+)?/g) || [];
    const ring = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      ring.push([Number(nums[i]), Number(nums[i + 1])]);
    }
    if (ring.length >= 2) {
      out.push(ring);
    }
  }
  return out;
}

/** 偶奇规则射线法，跨全部子路径（岛屿与外环一起算）。 */
function inSubpaths(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function ringSet(adcodes2) {
  const rings = [];
  for (const ad of adcodes2) {
    rings.push(...subpaths(CHINA_MAP.provinces[ad] || ""));
  }
  return rings;
}

const outlineRings = subpaths(CHINA_MAP.outline);
const dots = [];

for (const s of sources) {
  const loc = locations.locationByTag(s.tag);
  const [x, y] = project(s.lat, s.lon);
  dots.push({ tag: s.tag, name: s.name, loc, x, y });
  const rings = subpaths(CHINA_MAP.provinces[loc.adcode] || "");
  const insideDeclared = inSubpaths(x, y, rings);

  check(`[${s.name}] 红点在主图范围内`,
    x >= VBX && x <= VBX + VBW && y >= VBY && y <= VBY + VBH,
    `(${x.toFixed(1)}, ${y.toFixed(1)})`);

  check(`[${s.name}] 红点不在南海诸岛插图框里`,
    !(x >= IX && x <= IX + IW && y >= IY && y <= IY + IH),
    `插图框 [${[IX, IY, IW, IH].join(",")}]`);

  check(`[${s.name}] 红点落在国界轮廓内`, inSubpaths(x, y, outlineRings));

  if (loc.onBorder) {
    // 省界情形：多边形归属本身就不确定，改成复刻生成器的规则 ——
    // 声明"在省界上"就必须实测到最近**他省**边界 ≤ 2 km，否则这条声明是拿来掩盖写错的。
    let otherMin = Infinity;
    for (const ad of adcodes) {
      if (ad === loc.adcode) {
        continue;
      }
      for (const ring of subpaths(CHINA_MAP.provinces[ad])) {
        for (let i = 0; i + 1 < ring.length; i++) {
          const d = pointSegDist(x, y, ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]);
          if (d < otherMin) {
            otherMin = d;
          }
        }
      }
    }
    const km = otherMin * KM_PER_UNIT;
    check(`[${s.name}] 声明在省界上 ⇒ 实测到最近他省界 ≤ 2 km`, km <= 2.0,
      `最近他省界 ${km.toFixed(2)} km（多边形判为${
        adcodes.filter((ad) => ad !== loc.adcode && inSubpaths(x, y, subpaths(CHINA_MAP.provinces[ad])))
          .map((ad) => CHINA_MAP.provinceNames[ad]).join("、") || "无"}）`);
    check(`[${s.name}] 声明所在省与权威口径一致（${loc.province}）`,
      loc.province === "云南省" && loc.adcode === "530000",
      `${loc.province} / ${loc.adcode}`);
  } else {
    check(`[${s.name}] 红点落在声明的省（${loc.province}）内`, insideDeclared);
  }

  const pct = locmap.projectToPercent(CHINA_MAP, s.lat, s.lon);
  check(`[${s.name}] 百分比定位在 0~100 之间`,
    pct.left >= 0 && pct.left <= 100 && pct.top >= 0 && pct.top <= 100,
    `left ${pct.left.toFixed(2)}% / top ${pct.top.toFixed(2)}%`);
}

for (let a = 0; a < dots.length; a++) {
  for (let b = a + 1; b < dots.length; b++) {
    const d = Math.hypot(dots[a].x - dots[b].x, dots[a].y - dots[b].y);
    check(`[${dots[a].name} ↔ ${dots[b].name}] 两个红点不重合`, d > 10, `${d.toFixed(1)} 单位`);
  }
}

/* ===== 5) 人工声明与地图数据的一致性 ===== */
const LOCS = locations.SAMPLE_LOCATIONS;
check("地理位置条目数与样本数一致", LOCS.length === sources.length,
  `${LOCS.length} vs ${sources.length}`);

const srcTags = sources.map((s) => s.tag).sort().join(",");
const locTags = LOCS.map((l) => l.tag).sort().join(",");
check("地理位置与样本 tag 一一对应（无遗漏、无多余）", srcTags === locTags,
  `样本 ${srcTags} / 声明 ${locTags}`);

for (const loc of LOCS) {
  check(`[${loc.province}] adcode 存在于省界数据`, Boolean(CHINA_MAP.provinces[loc.adcode]),
    loc.adcode);
  check(`[${loc.province}] 省份名与地图数据一致`,
    CHINA_MAP.provinceNames[loc.adcode] === loc.province,
    `地图=${CHINA_MAP.provinceNames[loc.adcode]} 声明=${loc.province}`);
  check(`[${loc.province}] 定位说明与山系非空`,
    loc.note.length > 5 && loc.range.length > 1, loc.range);
}

// 「每座山一个省」这条守的是**红点要在中国地图上散开**，不是全挤在一个省。
// v2.2.0 加了四个非山地样本后，这条原来无条件套到 LOCS 上就红了 ——
// 川中丘陵与贡嘎山同属四川省（本来就应该如此，它们都取景自四川）。
// 所以按 landType 分流：四座山必须四个省；全部样本另外要求覆盖足够多的省。
const typeOfTag = new Map(sources.map((s) => [s.tag, s.landType]));
const mountainLocs = LOCS.filter((l) => typeOfTag.get(l.tag) === "mountain");
const mountainAd = new Set(mountainLocs.map((l) => l.adcode));
check("四座山分属四个不同省级行政区（红点必须散开）",
  mountainLocs.length === 4 && mountainAd.size === 4,
  `${mountainLocs.length} 座 / ${mountainAd.size} 个省`);

const distinctAd = new Set(LOCS.map((l) => l.adcode));
check("全部样本覆盖 ≥ 5 个省级行政区", distinctAd.size >= 5, [...distinctAd].join(","));

const borderCount = LOCS.filter((l) => l.onBorder).length;
check("恰好一座声明为省界情形（多声明就等于拿省界当借口）", borderCount === 1, borderCount);

/* ===== 6) 模板地形不参与地理位置图（v2.4.0） ===== */
/**
 * 模板地形是**示意地形**，不对应任何真实地点，所以：
 *
 * - 它们不在地理位置表里（`locations.ts` 只登记真实样本）；
 * - 界面上不画中国地图，改画一张「这是模板地形，没有真实经纬度」的说明卡。
 *
 * 这一节守的是"**别让它静默地混进去**"。因为下面这条回退看着很方便、
 * 实际上是个陷阱：
 *
 *   `locationByTag(tag) => SAMPLE_LOCATIONS.find(...) ?? SAMPLE_LOCATIONS[0]`
 *
 * 模板的 tag 查不到 ⇒ 回退到**第一个真实样本（贡嘎山 / 四川省）**。
 * 也就是说，只要界面忘了分流，模板山地就会顶着「四川省 · 大雪山（横断山系）」
 * 这张标签、红点画在 30°N/105°E，而那个位置**确实落在中国国界轮廓内** ——
 * 既不报错也不越界，肉眼完全看不出是错的。所以这里把这条回退行为
 * 连同"占位坐标落在哪"一起钉住，当成分流逻辑的哨兵。
 */
{
  const locTags = new Set(locations.SAMPLE_LOCATIONS.map((l) => l.tag));
  for (const s of templateSources) {
    check(`[${s.name}] 不在地理位置表里（模板没有真实地点）`,
      !locTags.has(s.tag), s.tag);

    check(`[${s.name}] 经纬度是占位值 30/105`,
      s.lat === 30 && s.lon === 105, `${s.lat}/${s.lon}`);

    // 哨兵：证明"忘了分流"不会报错，只会安静地借用别人的省
    const fallback = locations.locationByTag(s.tag);
    check(`[${s.name}] 若按 tag 查地理位置会静默回退到第一个真实样本（所以界面必须显式分流）`,
      fallback.tag === locations.SAMPLE_LOCATIONS[0].tag,
      `回退到 ${fallback.tag}（${fallback.province}）`);

    // 占位坐标并非画不出来 —— 它落在国界内，所以错得毫无痕迹
    const [x, y] = project(s.lat, s.lon);
    check(`[${s.name}] 占位坐标落在国界轮廓内（正因如此，误画红点也看不出来）`,
      inSubpaths(x, y, outlineRings), `(${x.toFixed(1)}, ${y.toFixed(1)})`);
  }
}

/* ===== 汇总 ===== */
const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "✔" : "✘"} ${c.name}${c.extra ? `  ${c.extra}` : ""}`);
}
console.log(`\nLOCMAP CHECK ${failed.length === 0 ? "PASSED ✔" : "FAILED ✘"}  断言 ${checks.length} 项，失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
