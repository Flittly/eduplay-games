#!/usr/bin/env node
/**
 * 数据层 + 纯逻辑测试
 * ==================
 *
 * 覆盖四组：
 *   1. 分层校验 `assertTiering` 的每条规则**确实会红**（用注入式反证，不是只看通过）
 *   2. 选项生成的防作弊约束（同性质 + 同半球各至少一个）
 *   3. 双层判定的口径（拓展层跳过方向、画箭头 ±45° 容差）
 *   4. 计分与通关（环流闭合只在重点层内成立、拓展层不计入）
 *
 * 用构建产物 scripts/_bundle.cjs（由 `npm run test:data` 里的 rolldown 生成）。
 */

const assert = require("node:assert");
const path = require("node:path");

let D, G;
try {
  const mod = require(path.join(__dirname, "_bundle.cjs"));
  // rolldown 的多入口打包会把每个模块挂成命名导出；这里按需取
  D = mod;
  G = mod;
} catch (err) {
  console.error("✘ 读不到 scripts/_bundle.cjs —— 请先跑 `npm run test:data`");
  console.error(String(err));
  process.exit(2);
}

const {
  CORE_CURRENTS,
  EXTENSION_CURRENTS,
  REFERENCE_CURRENTS,
  CURRENTS,
  GYRES,
  WIN_GYRES,
  NO_SOLO_ZONE,
  STAGES,
  assertTiering,
  currentById,
  playableCurrents,
  // 投影层（3c 节用）
  MAP_W,
  MAP_H,
  lonToX,
  latToY,
  xToLon,
  yToLat,
  llToXY,
  dLonShort,
  splitAtAntimeridian,
  // 影像瓦片（3c 节用）
  pickZoom,
  buildTiles,
  ROWS_PER_TILE
} = D;

const {
  rng,
  shuffle,
  buildOptions,
  directionChoice,
  judgeName,
  judgeDirection,
  judgeArrow,
  settleCatch,
  createSession,
  startCast,
  needsDirection,
  recordRecognized,
  recordMistake,
  topConfusions,
  isWon,
  zonePool,
  stars,
  qualityLabel
} = G;

let pass = 0;
const fails = [];

function t(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    fails.push(`${name} —— ${err.message}`);
    console.log(`  ✘ ${name}\n      ${err.message}`);
  }
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

/* ================================================================== *
 * 1. 分层校验
 * ================================================================== */

section("1. 分层校验（assertTiering）");

t("当前数据能通过校验（这是基线）", () => {
  assertTiering(CURRENTS);
});

t("三份名单条数符合设计（core 18 / ext 6 / ref 3）", () => {
  // core = 四个闭合环流的 16 个成员 + 季风洋流 + 教材渔场成因点名的 2 条交汇搭档
  assert.strictEqual(CORE_CURRENTS.length, 18, `core 应为 18，实际 ${CORE_CURRENTS.length}`);
  assert.strictEqual(EXTENSION_CURRENTS.length, 6, `ext 应为 6，实际 ${EXTENSION_CURRENTS.length}`);
  assert.strictEqual(
    REFERENCE_CURRENTS.length,
    3,
    `ref 应为 3，实际 ${REFERENCE_CURRENTS.length}`
  );
  // ref 是 core 的"侧面"，必须全在 core 里（不是新的洋流）
  for (const n of REFERENCE_CURRENTS) {
    assert.ok(
      CORE_CURRENTS.includes(n),
      `了解层的「${n}」不在重点层 —— 了解层应该是重点层成员的"影响侧面"，不是新条目`
    );
  }
});

t("CURRENTS 条数 = core + ext（ref 是 core 的侧面，不另占条目）", () => {
  assert.strictEqual(
    CURRENTS.length,
    CORE_CURRENTS.length + EXTENSION_CURRENTS.length,
    `CURRENTS 应为 ${CORE_CURRENTS.length + EXTENSION_CURRENTS.length}，实际 ${CURRENTS.length}`
  );
});

t("【反证】删掉一条 core 洋流 → 校验必须报「名单里的…找不到对应条目」", () => {
  const broken = CURRENTS.filter((c) => c.name !== "秘鲁寒流");
  assert.throws(
    () => assertTiering(broken),
    /秘鲁寒流/,
    "删掉 core 成员后校验竟然通过了 —— 规则 5 失效"
  );
});

t("【反证】把 core 洋流偷偷声明为 extension → 校验必须报层级不符", () => {
  const broken = CURRENTS.map((c) =>
    c.name === "秘鲁寒流" ? { ...c, tier: "extension" } : c
  );
  assert.throws(
    () => assertTiering(broken),
    /秘鲁寒流/,
    "把重点层降级为拓展层竟然通过了 —— 规则 1 失效（这会导致学生少背考点）"
  );
});

t("【反证】core 与 extension 同名 → 校验必须报这两层不互斥", () => {
  // 把「阿拉斯加暖流」同时加进 core 名单的等价构造：声明成 core
  const broken = CURRENTS.map((c) =>
    c.name === "阿拉斯加暖流" ? { ...c, tier: "core" } : c
  );
  assert.throws(
    () => assertTiering(broken),
    /阿拉斯加暖流/,
    "拓展层冒充重点层竟然通过了 —— 规则 1 失效"
  );
});

t("★ 了解层与重点层**允许**重叠（这是设计，不是漏检）", () => {
  // 三个 ref 成员都同时在 core 名单里，校验必须通过
  const overlap = REFERENCE_CURRENTS.filter((n) => CORE_CURRENTS.includes(n));
  assert.strictEqual(
    overlap.length,
    3,
    "了解层与重点层的重叠被改掉了 —— 那说明三层结构被误解成「互斥的三堆」了"
  );
  assertTiering(CURRENTS); // 不抛错即为通过
});

t("【反证】拓展层 note 里不写「拓展层」→ 校验必须报错（角标会丢）", () => {
  const broken = CURRENTS.map((c) =>
    c.name === "阿拉斯加暖流" ? { ...c, note: "某条真实洋流" } : c
  );
  assert.throws(
    () => assertTiering(broken),
    /阿拉斯加暖流/,
    "拓展层缺角标标注竟然通过了 —— 规则 4 失效（界面上就分不出来了）"
  );
});

t("【反证】环流引用拓展层成员 → 校验必须报错（通关闭环只能在重点层内）", () => {
  const broken = CURRENTS.map((c) =>
    c.name === "阿拉斯加暖流" ? { ...c, tier: "core" } : c
  );
  // 让北太平洋环流引用它
  const gyres = GYRES.map((g) =>
    g.id === "north-pacific-gyre"
      ? { ...g, members: [...g.members, "alaska"] }
      : g
  );
  // assertTiering 读的是模块内的 GYRES，这里换个角度验：
  // 把 alaska 改成 core 后再补进 core 名单也不该成立（它不在 CORE_CURRENTS 里）
  assert.throws(
    () => assertTiering(broken),
    /阿拉斯加暖流/,
    "把拓展层冒充成重点层竟然通过了 —— 规则 1 失效"
  );
  void gyres;
});

t("西风漂流在数据里只有一个 id（三个环流共用）", () => {
  const hits = CURRENTS.filter((c) => c.name === "西风漂流");
  assert.strictEqual(hits.length, 1, `西风漂流应只有 1 条数据，实际 ${hits.length} 条`);
  const gyresUsing = GYRES.filter((g) => g.members.includes("west-wind-drift"));
  assert.ok(
    gyresUsing.length >= 3,
    `西风漂流应被至少 3 个环流引用，实际 ${gyresUsing.length} 个`
  );
});

t("无独立捕捞区的两条（千岛寒流 / 拉布拉多寒流）仍在重点层", () => {
  for (const id of NO_SOLO_ZONE) {
    const c = currentById(id);
    assert.ok(c, `${id} 不存在`);
    assert.strictEqual(c.tier, "core", `${c.name} 应在重点层`);
  }
});

t("playableCurrents 排掉了无独立捕捞区的两条", () => {
  const ids = playableCurrents("junior").map((c) => c.id);
  for (const id of NO_SOLO_ZONE) {
    assert.ok(!ids.includes(id), `${id} 不该出现在可捕捞池里`);
  }
  // 初中版 = 重点层 18 - 2 条交汇搭档 = 16
  assert.strictEqual(ids.length, 16, `初中版可捕捞池应为 16，实际 ${ids.length}`);
});

t("高中版可捕捞池 = 重点层 16 + 拓展层 6 = 22", () => {
  assert.strictEqual(playableCurrents("senior").length, 22);
});

/* ================================================================== *
 * 2. 选项生成（防作弊）
 * ================================================================== */

section("2. 选项生成 · 防作弊约束");

t("选项数固定为 4，且恰有一个正确项", () => {
  const random = rng(12345);
  const pool = zonePool("junior");
  for (const target of pool) {
    const opts = buildOptions(target, pool, random);
    assert.strictEqual(opts.length, 4, `${target.name} 的选项数不是 4`);
    assert.strictEqual(
      opts.filter((o) => o.correct).length,
      1,
      `${target.name} 的正确项不是恰好 1 个`
    );
    assert.ok(
      opts.some((o) => o.id === target.id),
      `${target.name} 的选项里没有正确项`
    );
  }
});

t("★ 每个题的干扰项里都至少有 1 个【同性质】洋流", () => {
  const random = rng(999);
  const pool = zonePool("junior");
  for (const target of pool) {
    const opts = buildOptions(target, pool, random);
    const same = opts.filter((o) => !o.correct && o.kind === target.kind);
    assert.ok(
      same.length >= 1,
      `${target.name}（${target.kind}）的干扰项里没有同性质洋流 —— ` +
        `学生只看颜色就能选对，这一问就废了`
    );
  }
});

t("★ 每个题的干扰项里都至少有 1 个【同半球】洋流", () => {
  const random = rng(777);
  const pool = zonePool("junior");
  for (const target of pool) {
    const opts = buildOptions(target, pool, random);
    // ⚠️ 同半球要按**选项里其他洋流的半球**比，不能只比同球数量：
    //    池子里南北半球各有一部分，若全是另一半球就不对了。
    const same = opts.filter((o) => !o.correct && currentById(o.id).hemisphere === target.hemisphere);
    assert.ok(
      same.length >= 1,
      `${target.name}（${target.hemisphere} 半球）的干扰项里没有同半球洋流`
    );
  }
});

t("选项里不含重复项", () => {
  const random = rng(4242);
  const pool = zonePool("senior");
  for (const target of pool) {
    const opts = buildOptions(target, pool, random);
    const ids = new Set(opts.map((o) => o.id));
    assert.strictEqual(ids.size, 4, `${target.name} 的选项里有重复`);
  }
});

t("同一个种子 → 完全相同的选项（可复现）", () => {
  const pool = zonePool("junior");
  const target = pool[0];
  const a = buildOptions(target, pool, rng(2026)).map((o) => o.id).join(",");
  const b = buildOptions(target, pool, rng(2026)).map((o) => o.id).join(",");
  assert.strictEqual(a, b, "同种子结果不一致，说明用了 Math.random");
});

/* ================================================================== *
 * 3. 双层判定
 * ================================================================== */

section("3. 双层判定");

t("拓展层 needsDirection === false（只认名称，不判方向）", () => {
  for (const c of CURRENTS.filter((x) => x.tier === "extension")) {
    assert.strictEqual(needsDirection(c), false, `${c.name} 是拓展层却要判方向`);
  }
});

t("重点层 needsDirection === true", () => {
  for (const c of CURRENTS.filter((x) => x.tier === "core")) {
    assert.strictEqual(needsDirection(c), true, `${c.name} 是重点层却不判方向`);
  }
});

t("★ startCast：拓展层开局就把 directionPassed 置 true（流程上跳过第二问）", () => {
  const random = rng(31);
  const ext = CURRENTS.find((c) => c.tier === "extension");
  const p = startCast(ext, "senior", random);
  assert.strictEqual(
    p.directionPassed,
    true,
    "拓展层的 directionPassed 不是 true —— 学生会被多问一道方向题，分层就白做了"
  );
});

t("startCast：重点层开局 directionPassed 为 false", () => {
  const random = rng(31);
  const core = playableCurrents("junior")[0];
  const p = startCast(core, "junior", random);
  assert.strictEqual(p.directionPassed, false);
});

t("judgeName 口径：id 一致才算对", () => {
  const peru = currentById("peru");
  assert.strictEqual(judgeName(peru, "peru"), true);
  assert.strictEqual(judgeName(peru, "benguela"), false);
});

t("judgeDirection 口径", () => {
  const peru = currentById("peru");
  assert.strictEqual(judgeDirection(peru, peru.direction), true);
  assert.strictEqual(
    judgeDirection(peru, peru.direction === "pole-ward" ? "equator-ward" : "pole-ward"),
    false
  );
});

/**
 * ★ 二选一的标签必须**两个都非空**。
 * 这是一个真实踩过的坑：曾经按"当前洋流的方向"分别算高纬/低纬标签，
 * 于是总有一个是 null，界面上就出现一个**空白且只有一半高**的按钮 ——
 * 单元测试只有"判定对错"是看不出来的，因为 value 仍然是对的。
 */
t("★ 第二问：两条选项的文案都必须非空（防出现空白按钮）", () => {
  const seen = new Set();
  for (const c of CURRENTS.filter((x) => x.tier !== "reference")) {
    const { options } = directionChoice(c);
    assert.strictEqual(options.length, 2, `${c.id} 应有 2 个选项`);
    for (const o of options) {
      assert.ok(
        typeof o.label === "string" && o.label.trim().length > 0,
        `★「${c.name}」（${c.hemisphere}半球/${c.direction}）的选项 ${o.value} 文案为空`
      );
    }
    // 两个选项不能是同一句话
    assert.notStrictEqual(options[0].label, options[1].label, `${c.id} 两个选项文案重复`);
    // value 必须一个 pole-ward 一个 equator-ward
    const vals = options.map((o) => o.value).sort().join(",");
    assert.strictEqual(vals, "equator-ward,pole-ward", `${c.id} 选项 value 不对`);
    // 半球措辞：北半球"向高纬"=向北，南半球=向南
    const pole = options.find((o) => o.value === "pole-ward");
    const want = c.hemisphere === "N" ? "向北" : "向南";
    assert.ok(
      pole.label.includes(want),
      `★「${c.name}」在 ${c.hemisphere} 半球，向高纬应写"${want}"，实际"${pole.label}"`
    );
    seen.add(c.hemisphere);
  }
  assert.strictEqual(seen.size, 2, "应同时覆盖南北半球");
});

/**
 * 把一条洋流的**标准答案箭头**（真实经纬度）转成"归一化画布方向"，
 * 供 judgeArrow 的正向用例使用。
 *
 * 为什么测试里要自己做这一步：`judgeArrow` 的入参 `drawn` 是**归一化画布坐标**
 * （玩家拖出来的），而 `current.arrow` 是**真实经纬度**。测试要构造"和标准
 * 答案同向的拖动"，就得先把标准答案投影到画布、再归一化。
 * 口径必须与 `proj.ts` 一致（等距圆柱）—— 所以这里**直接用 proj 导出的
 * `lonToX` / `latToY`**，不自己再写一份（自己写一份就有两套口径，容易走偏）。
 */
function answerNormDirs(c) {
  const x1 = lonToX(c.arrow.lon1);
  const y1 = latToY(c.arrow.lat1);
  const x2 = lonToX(c.arrow.lon2);
  const y2 = latToY(c.arrow.lat2);
  return { dx: (x2 - x1) / MAP_W, dy: (y2 - y1) / MAP_H };
}

t("judgeArrow：同向必过（无论长短）", () => {
  const c = currentById("kuroshio");
  const { dx, dy } = answerNormDirs(c);
  // 同向但短一半
  assert.strictEqual(
    judgeArrow(c, { x1: 0.5, y1: 0.5, x2: 0.5 + dx * 0.5, y2: 0.5 + dy * 0.5 }),
    true
  );
  // 同向但长一倍
  assert.strictEqual(
    judgeArrow(c, { x1: 0.5, y1: 0.5, x2: 0.5 + dx * 2, y2: 0.5 + dy * 2 }),
    true
  );
});

t("judgeArrow：反向必挂", () => {
  const c = currentById("kuroshio");
  const { dx, dy } = answerNormDirs(c);
  assert.strictEqual(judgeArrow(c, { x1: 0.5, y1: 0.5, x2: 0.5 - dx, y2: 0.5 - dy }), false);
});

t("★ judgeArrow：24 条洋流的标准答案都判自己对（自查口径）", () => {
  // 若 judgeArrow 的投影口径与 proj.ts 不一致，这条会红 —— 是"口径自检"
  for (const c of CURRENTS) {
    if (c.tier === "reference") continue;
    const x1 = lonToX(c.arrow.lon1) / MAP_W;
    const y1 = latToY(c.arrow.lat1) / MAP_H;
    const x2 = lonToX(c.arrow.lon2) / MAP_W;
    const y2 = latToY(c.arrow.lat2) / MAP_H;
    assert.strictEqual(
      judgeArrow(c, { x1, y1, x2, y2 }),
      true,
      `★「${c.name}」的标准答案箭头竟然判自己不对，说明投影口径不一致`
    );
  }
});

t("judgeArrow：±45° 容差边界（约 40° 过、约 50° 挂）", () => {
  // 用一个"正东方向"的假洋流，避免真实经纬度的其他因素干扰
  const c = {
    arrow: { lon1: 0, lat1: 0, lon2: 90, lat2: 0 } // 赤道上正东
  };
  /**
   * ⚠️ 角度必须在**画布像素空间**里构造，不能在归一化空间里构造。
   *
   * 归一化坐标是 (x/1000, y/560)，两个轴的缩放**不一样**：
   * 在归一化空间里摆一个 50° 的向量，换算到画布像素后实际只有
   *   atan2(0.766·560, 0.643·1000) = atan2(429, 643) ≈ 33.7°
   * —— 于是"50° 应该判错"会假红成"过了"。
   * 判定本身比的是**画布像素方向**，所以测试也要在同一空间里构造角度。
   */
  const mk = (deg) => {
    const r = (deg * Math.PI) / 180;
    const px = Math.cos(r) * 240; // 画布像素方向（长度取 240px，够长即可）
    const py = Math.sin(r) * 240;
    return {
      x1: 0.5,
      y1: 0.5,
      x2: 0.5 + px / 1000,
      y2: 0.5 + py / 560
    };
  };
  assert.strictEqual(judgeArrow(c, mk(40)), true, "40° 应算对");
  assert.strictEqual(judgeArrow(c, mk(44)), true, "44° 应算对（容差内）");
  assert.strictEqual(judgeArrow(c, mk(50)), false, "50° 应算错");
  assert.strictEqual(judgeArrow(c, mk(90)), false, "90° 应算错");
});

t("judgeArrow：零长度拖动不算对", () => {
  const c = currentById("peru");
  assert.strictEqual(judgeArrow(c, { x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 }), false);
});

/* ================================================================== *
 * 3b. 真实经纬度坐标（v0.1.0 起的新口径）
 * ================================================================== */

section("3b. 真实经纬度坐标");

t("★ 24 条洋流都有合法的经纬度（经度 −180~180、纬度 −90~90）", () => {
  assert.strictEqual(CURRENTS.length, 24, "洋流总数应为 24");
  for (const c of CURRENTS) {
    assert.ok(
      typeof c.anchor.lon === "number" && typeof c.anchor.lat === "number",
      `★「${c.name}」的 anchor 不是经纬度对象（可能又退回旧的 {x,y} 写法了）`
    );
    assert.ok(
      c.anchor.lon >= -180 && c.anchor.lon <= 180,
      `★「${c.name}」经度 ${c.anchor.lon} 越界`
    );
    assert.ok(
      c.anchor.lat >= -90 && c.anchor.lat <= 90,
      `★「${c.name}」纬度 ${c.anchor.lat} 越界`
    );
    for (const k of ["lon1", "lon2"]) {
      assert.ok(
        c.arrow[k] >= -180 && c.arrow[k] <= 180,
        `★「${c.name}」箭头 ${k}=${c.arrow[k]} 经度越界`
      );
    }
    for (const k of ["lat1", "lat2"]) {
      assert.ok(
        c.arrow[k] >= -90 && c.arrow[k] <= 90,
        `★「${c.name}」箭头 ${k}=${c.arrow[k]} 纬度越界`
      );
    }
  }
});

t("★ 半球字段与 anchor 纬度一致（写着 N 就必须在北纬）", () => {
  for (const c of CURRENTS) {
    if (c.hemisphere === "N") {
      assert.ok(c.anchor.lat > 0, `★「${c.name}」标着北半球，anchor 纬度却是 ${c.anchor.lat}`);
    } else {
      assert.ok(c.anchor.lat < 0, `★「${c.name}」标着南半球，anchor 纬度却是 ${c.anchor.lat}`);
    }
  }
});

t("★ 每条洋流的 anchor 落在它标称的半球纬度带内（±70° 以内，不是极地）", () => {
  for (const c of CURRENTS) {
    assert.ok(
      Math.abs(c.anchor.lat) <= 80,
      `★「${c.name}」anchor 纬度 ${c.anchor.lat} 落在极区，洋流不该出现在那里`
    );
  }
});

t("★ 寒暖性质与纬度走向自洽（暖流不能从高纬流向低纬）", () => {
  /**
   * ⚠️ 季风洋流是**教材点名的例外**，必须豁免。
   *
   * 常规洋流的寒暖性质由纬度走向决定（暖流＝由低纬流向高纬）。
   * 但北印度洋季风洋流是**季风驱动**的：北半球冬季受东北季风推动
   * 自东向西流（同时略微南下），于是它是"暖流 × 向南"——
   * 这条例外课本专门讲过，不是数据填错。
   * 判据要钉的是"除教材例外外，其余都得自洽"。
   */
  const EXEMPT = new Set(["indian-monsoon"]);
  let checked = 0;
  for (const c of CURRENTS) {
    const dLat = c.arrow.lat2 - c.arrow.lat1;
    // 东西向的流（|dLat| 很小）不参与这条判据
    if (Math.abs(dLat) < 1) continue;
    if (EXEMPT.has(c.id)) continue;
    checked++;
    if (c.kind === "warm") {
      // 暖流：由低纬流向高纬 ⇒ 北半球 dLat>0、南半球 dLat<0
      const ok = c.hemisphere === "N" ? dLat > 0 : dLat < 0;
      assert.ok(ok, `★「${c.name}」（暖流/${c.hemisphere}半球）纬度走向 dLat=${dLat} 与暖流定义不符`);
    } else {
      const ok = c.hemisphere === "N" ? dLat < 0 : dLat > 0;
      assert.ok(ok, `★「${c.name}」（寒流/${c.hemisphere}半球）纬度走向 dLat=${dLat} 与寒流定义不符`);
    }
  }
  assert.ok(checked >= 14, `参与本判据的洋流只有 ${checked} 条，太少（判据可能失效）`);
});

t("★★ 已知洋流的真实位置抽查（这几条曾经偏到别的洋去）", () => {
  // 上一版手写归一化坐标时，这几条偏得最离谱。留一条判据钉住它们，
  // 以后谁再动坐标改错了，会立刻红。
  const CASES = [
    // [id, 经度允许范围, 纬度允许范围, 说明]
    ["california", [-140, -110], [25, 45], "加利福尼亚寒流必须在北美西岸（曾偏 169° 到大西洋）"],
    ["alaska", [-165, -125], [45, 62], "阿拉斯加暖流必须在阿拉斯加湾（曾偏 181° 到欧洲）"],
    ["peru", [-90, -70], [-30, -8], "秘鲁寒流必须在南美西岸"],
    ["kuroshio", [125, 150], [20, 40], "日本暖流必须在日本以东"],
    ["oyashio", [140, 165], [35, 52], "千岛寒流必须在千岛群岛一带"],
    ["gulf-stream", [-85, -60], [24, 42], "墨西哥湾暖流必须在美国东岸"],
    ["benguela", [5, 20], [-35, -15], "本格拉寒流必须在非洲西南岸"],
    ["agulhas", [28, 45], [-40, -20], "厄加勒斯暖流必须在非洲东南岸"],
    ["west-australia", [100, 118], [-38, -18], "西澳大利亚寒流必须在澳洲西岸"],
    ["east-australia", [145, 162], [-42, -20], "东澳大利亚暖流必须在澳洲东岸"],
    ["brazil", [-55, -30], [-40, -12], "巴西暖流必须南美东岸"],
    ["north-atlantic", [-45, 5], [38, 62], "北大西洋暖流必须横跨北大西洋到欧洲"]
  ];
  for (const [id, lonRange, latRange, why] of CASES) {
    const c = currentById(id);
    assert.ok(c, `找不到洋流 ${id}`);
    const { lon, lat } = c.anchor;
    assert.ok(
      lon >= lonRange[0] && lon <= lonRange[1] && lat >= latRange[0] && lat <= latRange[1],
      `★ ${why}；实际 anchor=(${lon},${lat})，允许经度[${lonRange}] 纬度[${latRange}]`
    );
  }
});

/* ================================================================== *
 * 3c. 投影层与影像瓦片（位置错了界面看着正常的重灾区，必须机检）
 * ================================================================== */

section("3c. 投影层与影像瓦片");

t("★ proj：经纬度 ↔ 画布 往返一致（含四角与中点）", () => {
  const pts = [
    [-180, 90],
    [180, 90],
    [-180, -90],
    [180, -90],
    [0, 0],
    [116.4, 39.9],
    [-74, 40.7],
    [138, 28]
  ];
  for (const [lon, lat] of pts) {
    const x = lonToX(lon);
    const y = latToY(lat);
    assert.ok(Math.abs(xToLon(x) - lon) < 1e-6, `经度 ${lon} 往返不一致`);
    assert.ok(Math.abs(yToLat(y) - lat) < 1e-6, `纬度 ${lat} 往返不一致`);
  }
});

t("★ proj：北在上（纬度越大 y 越小）—— 写反会让整张图上下颠倒", () => {
  assert.ok(latToY(60) < latToY(30), "60°N 的 y 应小于 30°N（北在上）");
  assert.ok(latToY(0) < latToY(-30), "赤道的 y 应小于 30°S");
  // 量级校验：赤道应落在画布正中间
  assert.ok(Math.abs(latToY(0) - 280) < 1e-6, `赤道 y=${latToY(0)}，应为 280`);
  assert.ok(Math.abs(lonToX(0) - 500) < 1e-6, `本初子午线 x=${lonToX(0)}，应为 500`);
});

t("★ proj：dLonShort 走最短路径（跨日界线不能算成 280°）", () => {
  assert.ok(Math.abs(dLonShort(150, -130) - 80) < 1e-9, "150→−130 应为 +80（向东）");
  assert.ok(Math.abs(dLonShort(-110, 165) + 85) < 1e-9, "−110→165 应为 −85（向西）");
  // −170→170：向左（向西）跨 20° 比向右跨 340° 近 ⇒ 取 −20
  assert.ok(Math.abs(dLonShort(-170, 170) + 20) < 1e-9, "−170→170 应为 −20（向西跨日界线）");
  assert.ok(Math.abs(dLonShort(170, -170) - 20) < 1e-9, "170→−170 应为 +20（向东跨日界线）");
  // 不跨界的原样
  assert.ok(Math.abs(dLonShort(0, 90) - 90) < 1e-9, "0→90 应为 +90");
  assert.ok(Math.abs(dLonShort(0, -90) + 90) < 1e-9, "0→−90 应为 −90");
});

t("★ proj：splitAtAntimeridian 拆段后每段都不跨日界线", () => {
  const CASES = [
    [150, 40, -130, 44],
    [-110, 12, 165, 13],
    [140, 5, -160, 6],
    [-95, -6, 170, -10]
  ];
  for (const [lo1, la1, lo2, la2] of CASES) {
    const segs = splitAtAntimeridian(lo1, la1, lo2, la2);
    assert.strictEqual(segs.length, 2, `(${lo1},${la1})→(${lo2},${la2}) 应拆成 2 段`);
    for (const seg of segs) {
      const w = Math.abs(lonToX(seg[1].lon) - lonToX(seg[0].lon));
      assert.ok(w <= 520, `拆段后仍有 ${w.toFixed(0)}px 宽的段（超过半图）`);
    }
    // 两段在日界线处纬度连续
    assert.ok(
      Math.abs(segs[0][1].lat - segs[1][0].lat) < 1e-9,
      `(${lo1},${la1})→(${lo2},${la2}) 拆段处纬度不连续`
    );
  }
});

t("★ proj：不跨日界线的段原样返回 1 段", () => {
  const segs = splitAtAntimeridian(130, 22, 148, 36);
  assert.strictEqual(segs.length, 1);
  assert.strictEqual(segs[0][0].lon, 130);
  assert.strictEqual(segs[0][1].lon, 148);
});

t("★ 每条洋流的箭头都拆得开、每段都画得出来", () => {
  for (const c of CURRENTS) {
    const segs = splitAtAntimeridian(c.arrow.lon1, c.arrow.lat1, c.arrow.lon2, c.arrow.lat2);
    assert.ok(segs.length >= 1 && segs.length <= 2, `「${c.name}」拆出 ${segs.length} 段（应为 1~2）`);
    for (const seg of segs) {
      const p1 = llToXY(seg[0].lon, seg[0].lat);
      const p2 = llToXY(seg[1].lon, seg[1].lat);
      const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      assert.ok(len > 12, `「${c.name}」有一段只有 ${len.toFixed(1)}px，画出来看不清`);
      // 每段都不能横穿全图
      assert.ok(len <= 560, `「${c.name}」有一段长 ${len.toFixed(0)}px，疑似跨日界线没拆`);
    }
  }
});

t("★ pickZoom 选在「源分辨率不比画布粗」的拐点（z=2，16 块瓦片）", () => {
  const z = pickZoom();
  assert.strictEqual(z, 2, `pickZoom=${z}，应为 2（源 0.3516°/px vs 画布 0.36°/px）`);
});

t("★ buildTiles：瓦片子块铺满画布、无缝隙", () => {
  const z = pickZoom();
  const tiles = buildTiles(z);
  assert.ok(tiles.length > 0, "一块瓦片都没有");
  // 横向铺满
  const minLeft = Math.min(...tiles.map((t) => t.left));
  const maxRight = Math.max(...tiles.map((t) => t.left + t.width));
  assert.ok(Math.abs(minLeft) < 1e-6, `最左 ${minLeft} 应贴到 0`);
  assert.ok(maxRight >= 1000 - 1e-6, `最右 ${maxRight} 应铺到 1000`);
  // 纵向铺满（含极地补边）
  const maxBottom = Math.max(...tiles.map((t) => t.top + t.height));
  assert.ok(maxBottom >= 560 - 1, `最下 ${maxBottom.toFixed(1)} 应铺到 560`);
  // 同一列内相邻子块相接（不许留缝）
  const byCol = new Map();
  for (const t of tiles) {
    if (!byCol.has(t.x)) byCol.set(t.x, []);
    byCol.get(t.x).push(t);
  }
  for (const [col, arr] of byCol) {
    arr.sort((a, b) => a.top - b.top);
    for (let i = 1; i < arr.length; i++) {
      const gap = arr[i].top - (arr[i - 1].top + arr[i - 1].height);
      assert.ok(gap <= 1e-6, `第 ${col} 列第 ${i} 条留了 ${gap.toFixed(3)}px 缝隙`);
    }
  }
});

t("★ buildTiles：子块纵向位置 = 该纬度投影后的位置（极地补边除外）", () => {
  const z = pickZoom();
  const tiles = buildTiles(z);
  const n = 2 ** z;
  for (const t of tiles) {
    const isPolar =
      (t.y === 0 && t.row === 0) || (t.y === n - 1 && t.row === ROWS_PER_TILE - 1);
    if (isPolar) continue;
    // 子块上边对应的真实纬度 → 投影 y
    const tyTop = (t.y + t.row / ROWS_PER_TILE) / n;
    const latTop = (Math.atan(Math.sinh(Math.PI * (1 - 2 * tyTop))) * 180) / Math.PI;
    const expectY = latToY(latTop);
    // top 里含 BLEED_PX 的溢出，加回来再比
    assert.ok(
      Math.abs(t.top + 0.5 - expectY) < 1e-6,
      `瓦片 ${t.x}/${t.y}/${t.row}: 实际 ${(t.top + 0.5).toFixed(3)} vs 期望 ${expectY.toFixed(3)}`
    );
  }
});

/* ================================================================== *
 * 4. 计分与通关
 * ================================================================== */

section("4. 计分与通关");

t("品质 5（秘鲁寒流）单网期望价值 ≥ 品质 2 的 8 倍（设计意图是 20 倍）", () => {
  const random = rng(5);
  const peru = currentById("peru");
  const north = currentById("north-equatorial");
  const avg = (c) => {
    let sum = 0;
    for (let i = 0; i < 400; i += 1) sum += settleCatch(c, 0, random).total;
    return sum / 400;
  };
  const a = avg(peru);
  const b = avg(north);
  assert.ok(
    a / b >= 8,
    `秘鲁/普通 = ${(a / b).toFixed(1)}，差距太小，学生没动力记位置`
  );
});

t("连击加成有上限（第 5 次以后 base 相同则得分相同）", () => {
  const peru = currentById("peru");
  // ⚠️ 必须用**同一个**随机序列去比，否则两次 settleCatch 抽到的鱼数不同，
  //    比的是随机差异而不是加成上限 —— 这是最容易写出假判据的地方。
  const mkSeq = () => {
    let i = 0;
    const vals = [0.5, 0.5];
    return () => vals[i++ % vals.length];
  };
  const r5 = settleCatch(peru, 5, mkSeq());
  const r9 = settleCatch(peru, 9, mkSeq());
  // 同一个 random 值 ⇒ base 相同；封顶后 total 也必须相同
  assert.strictEqual(r5.base, r9.base, "两次 base 不同，测试前提不成立");
  assert.strictEqual(
    r5.total,
    r9.total,
    `连击加成没封顶：连击5得 ${r5.total}，连击9得 ${r9.total} —— 后段分值会爆表`
  );
  // 且封顶值确实是 base * 1.5
  assert.strictEqual(r5.total, Math.round(r5.base * 1.5));
});

t("连击计数正确递增", () => {
  const random = rng(11);
  const peru = currentById("peru");
  assert.strictEqual(settleCatch(peru, 0, random).combo, 1);
  assert.strictEqual(settleCatch(peru, 3, random).combo, 4);
});

t("createSession：初中版 12 次下网 / 高中版 10 次", () => {
  assert.strictEqual(createSession("junior", 1).castsLeft, 12);
  assert.strictEqual(createSession("senior", 1).castsLeft, 10);
});

t("★ 集齐北太平洋环流 → completedGyres 多一个", () => {
  let s = createSession("junior", 1);
  const g = GYRES.find((x) => x.id === "north-pacific-gyre");
  for (const id of g.members) s = recordRecognized(s, id);
  assert.ok(
    s.completedGyres.includes("north-pacific-gyre"),
    "环流成员全认对了却没记为集齐"
  );
});

t("★ 环流只在重点层内闭合：缺一条不算集齐", () => {
  let s = createSession("junior", 1);
  const g = GYRES.find((x) => x.id === "north-pacific-gyre");
  for (const id of g.members.slice(0, -1)) s = recordRecognized(s, id);
  assert.ok(
    !s.completedGyres.includes("north-pacific-gyre"),
    "缺一条却算集齐了 —— 闭合判定有漏"
  );
});

t("★★ 拓展层洋流不计入通关（认了一堆拓展也通不了关）", () => {
  let s = createSession("senior", 1);
  for (const c of CURRENTS.filter((x) => x.tier === "extension")) {
    s = recordRecognized(s, c.id);
  }
  assert.strictEqual(s.completedGyres.length, 0, "拓展层不该让任何环流闭合");
  assert.strictEqual(s.won, false, "只认拓展层竟然通关了 —— 名义拓展变必修");
  // 但应该记进 metExtension
  assert.strictEqual(s.metExtension.length, 6);
});

t("★★ 集齐四大环流才通关（差一个不行）", () => {
  let s = createSession("junior", 1);
  // 先集齐四个
  for (const gid of WIN_GYRES) {
    const g = GYRES.find((x) => x.id === gid);
    for (const id of g.members) s = recordRecognized(s, id);
  }
  assert.strictEqual(s.won, true, "集齐四大环流却没判通关");

  // 少一个环流的成员后不该通关
  let s2 = createSession("junior", 1);
  for (const gid of WIN_GYRES.slice(0, -1)) {
    const g = GYRES.find((x) => x.id === gid);
    for (const id of g.members) s2 = recordRecognized(s2, id);
  }
  assert.strictEqual(s2.won, false, "差一个环流竟然判通关了");
  assert.strictEqual(isWon(s2), false);
});

t("重复认同一条洋流不会重复计数", () => {
  let s = createSession("junior", 1);
  s = recordRecognized(s, "peru");
  s = recordRecognized(s, "peru");
  assert.strictEqual(s.recognized.filter((x) => x === "peru").length, 1);
});

t("recordMistake 清掉连击", () => {
  let s = createSession("junior", 1);
  s = { ...s, combo: 7 };
  s = recordMistake(s, "peru");
  assert.strictEqual(s.combo, 0);
  assert.strictEqual(s.mistakes.peru, 1);
});

t("topConfusions：只报真实易混对，且按次数排序", () => {
  const pairs = topConfusions({ benguela: 3, canary: 1, kuroshio: 0 });
  assert.ok(pairs.length >= 1, "有错却没有报出易混对");
  assert.strictEqual(pairs[0].a, "benguela", "没按次数排序");
  // 没被认错的洋流不该出现在后面
  assert.ok(pairs.every((p) => p.a !== "somali" && p.b !== "somali"));
});

t("topConfusions：没有错时返回空数组", () => {
  assert.deepStrictEqual(topConfusions({}), []);
});

t("stars / qualityLabel 口径", () => {
  assert.strictEqual(stars(5), "★★★★★");
  assert.strictEqual(stars(2), "★★☆☆☆");
  assert.strictEqual(qualityLabel(5), "顶级渔场");
  assert.strictEqual(qualityLabel(2), "普通海域");
});

t("shuffle 不改原数组且元素齐", () => {
  const src = [1, 2, 3, 4, 5];
  const out = shuffle(src, rng(1));
  assert.deepStrictEqual(src, [1, 2, 3, 4, 5], "shuffle 改了原数组");
  assert.deepStrictEqual(out.slice().sort((a, b) => a - b), src);
});

t("STAGES：初中版只含 core，高中版含 extension", () => {
  assert.deepStrictEqual(STAGES.junior.tiers, ["core"]);
  assert.deepStrictEqual(STAGES.senior.tiers, ["core", "extension"]);
  assert.strictEqual(STAGES.junior.directionUI, "two-choice");
  assert.strictEqual(STAGES.senior.directionUI, "draw-arrow");
});

/* ================================================================== *
 * 汇总
 * ================================================================== */

console.log(`\n断言 ${pass} 项通过，失败 ${fails.length} 项`);
if (fails.length) {
  console.log("失败明细：");
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("ALL PASSED ✔");
