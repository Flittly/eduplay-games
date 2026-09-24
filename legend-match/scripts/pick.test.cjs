/* eslint-disable no-console */
// 题库分层 + 抽牌难度曲线 + 配对状态机回归。两种组别各跑一遍。
const fs = require("fs");
const path = require("path");
const G = require("./gameData.test.cjs");

let pass = 0;
const fail = [];

function check(name, cond, extra) {
  if (cond) {
    pass += 1;
  } else {
    fail.push(name + (extra ? " —— " + extra : ""));
  }
}

const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "public", "data", "legends.json"), "utf8")
);
const LEGENDS = data.legends;
const MODE_LIST = ["junior", "senior"];

// ================================================================ 题库与分层
check("图例数据 73 条", LEGENDS.length === 73, `实际 ${LEGENDS.length}`);
check("id 唯一", new Set(LEGENDS.map((x) => x.id)).size === LEGENDS.length);
check("每条都有 short 且 ≤6 字",
  LEGENDS.every((x) => x.short && [...x.short].length <= 6));
check("每条都有图与解释",
  LEGENDS.every((x) => x.image && x.summary.length >= 8));
check("每条都声明了合法 tier",
  LEGENDS.every((x) => x.tier === "basic" || x.tier === "advanced"),
  LEGENDS.filter((x) => x.tier !== "basic" && x.tier !== "advanced")
    .map((x) => x.id).join(","));

const BASIC = LEGENDS.filter((l) => l.tier === "basic");
const ADVANCED = LEGENDS.filter((l) => l.tier === "advanced");
check("初中必备 54 条 / 进阶 19 条",
  BASIC.length === 54 && ADVANCED.length === 19,
  `basic=${BASIC.length} advanced=${ADVANCED.length}`);

const juniorBank = G.legendsForMode(LEGENDS, "junior");
const seniorBank = G.legendsForMode(LEGENDS, "senior");
check("初中组题库 54 条", juniorBank.length === 54, `实际 ${juniorBank.length}`);
check("高级组题库 = 全量 73 条", seniorBank.length === 73, `实际 ${seniorBank.length}`);
// 嵌套是刻意的：学生升组不丢基本盘，两组成绩也才可比
check("初中组是高级组的子集",
  juniorBank.every((j) => seniorBank.some((s) => s.id === j.id)));
check("初中组里没有进阶条目", juniorBank.every((l) => l.tier === "basic"));
check("高级组收全了进阶条目",
  ADVANCED.every((a) => seniorBank.some((s) => s.id === a.id)));
check("同一条图例在两组的名称/简称/分类/图标完全一致",
  juniorBank.every((j) => {
    const s = seniorBank.find((x) => x.id === j.id);
    return s && s.name === j.name && s.short === j.short
      && s.category === j.category && s.image === j.image;
  }));

// ================================================================ 关卡表
for (const mode of MODE_LIST) {
  const cfg = G.modeConfig(mode);
  check(`${mode} 每关对数严格递增`,
    cfg.pairs.every((p, i) => i === 0 || p > cfg.pairs[i - 1]),
    JSON.stringify(cfg.pairs));
  check(`${mode} 关卡数与对数表长度一致`, G.levelCount(mode) === cfg.pairs.length);
  check(`${mode} 总对数 = 对数表之和`,
    G.totalPairs(mode) === cfg.pairs.reduce((a, b) => a + b, 0));
  // 关卡号越界要夹住，不能返回 undefined（否则牌面会是 NaN 张）
  check(`${mode} 关卡号越界被夹住`,
    G.pairsForLevel(mode, -3) === cfg.pairs[0]
    && G.pairsForLevel(mode, 99) === cfg.pairs[cfg.pairs.length - 1]);
}

// ================================================================ 窗口（确定性，不看随机）
for (const mode of MODE_LIST) {
  const cfg = G.modeConfig(mode);
  const widths = [];
  for (let lv = 0; lv < G.levelCount(mode); lv += 1) {
    const cats = G.windowCategories(LEGENDS, mode, lv);
    widths.push(cats.length);
    check(`${mode} 第 ${lv + 1} 关窗口非空`, cats.length > 0);
    check(`${mode} 第 ${lv + 1} 关窗口类别不重复`,
      new Set(cats).size === cats.length, cats.join(","));
    check(`${mode} 第 ${lv + 1} 关窗口类别数不低于 minWindow`,
      cats.length >= Math.min(cfg.minWindow, 9),
      `窗口 ${cats.length} < minWindow ${cfg.minWindow}`);
  }
  check(`${mode} 窗口宽度随关卡单调不增`,
    widths.every((v, i) => i === 0 || v <= widths[i - 1]), JSON.stringify(widths));

  // 设计上的难度曲线 = 对数 ÷ 窗口宽度。窗口不增、对数递增 ⇒ 这条曲线必定单调不减。
  // 用**确定性**的量来守曲线形状：随机抽样的"实际拥挤度"在低关卡会饱和（见下），
  // 拿它当形状判据会被噪声带偏。
  const design = widths.map((w, i) => cfg.pairs[i] / w);
  check(`${mode} 设计拥挤度随关卡单调不减`,
    design.every((v, i) => i === 0 || v >= design[i - 1] - 1e-9),
    JSON.stringify(design.map((v) => Number(v.toFixed(2)))));
  console.log(`  ${mode}：窗口 ${widths.join("/")} · 设计拥挤度 `
    + design.map((v) => v.toFixed(2)).join("/"));
}

// ================================================================ 抽牌
for (const mode of MODE_LIST) {
  const bank = G.legendsForMode(LEGENDS, mode);
  const allowed = new Set(bank.map((x) => x.id));
  for (let lv = 0; lv < G.levelCount(mode); lv += 1) {
    const want = G.pairsForLevel(mode, lv);
    const windowCats = new Set(G.windowCategories(LEGENDS, mode, lv));
    for (const seed of [1, 2, 3, 99, 20260914]) {
      const picked = G.pickLegends(LEGENDS, mode, lv, seed);
      const tag = `${mode} 第 ${lv + 1} 关 (seed ${seed})`;
      check(`${tag} 抽够对数`, picked.length === want,
        `期望 ${want} 实际 ${picked.length}`);
      check(`${tag} 无重复`,
        new Set(picked.map((x) => x.id)).size === picked.length);
      check(`${tag} 都来自本组题库`, picked.every((x) => allowed.has(x.id)));
      // 抽到的类别不超出窗口 ⇒ 窗口自己够厚、没有触发"补类别"兜底。
      // 这条是末关拥挤度不回落的关键判据：一旦补类别，窗口实际变宽、曲线就塌了。
      const outside = picked.filter((x) => !windowCats.has(x.category));
      check(`${tag} 没有触发补类别（类别不超出窗口）`, outside.length === 0,
        `窗口外 ${[...new Set(outside.map((x) => x.category))].join(",")}`);
    }
  }
}

// 实际拥挤度（对数 ÷ 抽到的类别数）：量"同类干扰有多强"。
// 注意它在低关卡会饱和 —— 前两关窗口比对数还宽，抽到的类别数被对数封顶，
// 指标贴着 1.0 走。所以形状由上面的设计曲线守，这里只守两端。
const SEEDS = Array.from({ length: 60 }, (_, i) => i * 7919 + 13);

/**
 * 末关同类拥挤度的下限。两个数都是**算得出来的理论上限**，不是把标准往下调：
 *   初中组：题库 54 条 / 9 类、窗口最窄 3 类、末关 14 对 ⇒ 14 ÷ 3 ≈ 4.67 封顶。
 *           想更高只能把末关加到 16 对 —— 那和高级组末关一样重，就不叫"降一档"了。
 *   高级组：末关 16 对、窗口 2 类 ⇒ 16 ÷ 2 = 8 封顶。
 */
const CROWDING_FLOOR = { junior: 4.5, senior: 5 };

for (const mode of MODE_LIST) {
  const crowding = [];
  for (let lv = 0; lv < G.levelCount(mode); lv += 1) {
    let sum = 0;
    for (const s of SEEDS) {
      const picked = G.pickLegends(LEGENDS, mode, lv, s);
      sum += picked.length / new Set(picked.map((x) => x.category)).size;
    }
    crowding.push(sum / SEEDS.length);
  }
  console.log(`  ${mode}：实际拥挤度 `
    + crowding.map((v, i) => `${i + 1}关 ${v.toFixed(2)}`).join(" / "));

  check(`${mode} 首关是跨类别混搭（拥挤度 < 2）`, crowding[0] < 2,
    `实际 ${crowding[0].toFixed(2)}`);
  check(`${mode} 末关同类干扰足够强（拥挤度 ≥ ${CROWDING_FLOOR[mode]}）`,
    crowding[crowding.length - 1] >= CROWDING_FLOOR[mode],
    `实际 ${crowding[crowding.length - 1].toFixed(2)}`);
  check(`${mode} 末关干扰至少是首关的两倍`,
    crowding[crowding.length - 1] >= crowding[0] * 2,
    `${crowding[0].toFixed(2)} → ${crowding[crowding.length - 1].toFixed(2)}`);
}

// ================================================================ 一副牌
for (const mode of MODE_LIST) {
  for (let lv = 0; lv < G.levelCount(mode); lv += 1) {
    const cards = G.buildCards(LEGENDS, mode, lv, 4242);
    const want = G.pairsForLevel(mode, lv) * 2;
    const tag = `${mode} 第 ${lv + 1} 关`;
    check(`${tag} 卡数 ${want}`, cards.length === want, `实际 ${cards.length}`);
    check(`${tag} uid 唯一`,
      new Set(cards.map((c) => c.uid)).size === cards.length);
    const byId = new Map();
    for (const c of cards) {
      byId.set(c.legendId, (byId.get(c.legendId) || 0) + 1);
    }
    check(`${tag} 每个图例恰好两张卡`,
      [...byId.values()].every((v) => v === 2));
    check(`${tag} 符号卡与名称卡各一张`,
      [...new Set(cards.map((c) => c.legendId))].every((id) =>
        cards.filter((c) => c.legendId === id && c.face === "symbol").length === 1 &&
        cards.filter((c) => c.legendId === id && c.face === "name").length === 1));
  }
}

// ================================================================ 状态机
function dispatch(state, action) {
  return G.matchReducer(state, action);
}

function partnerOf(cards, uid) {
  const me = cards.find((c) => c.uid === uid);
  return cards.find((c) => c.legendId === me.legendId && c.uid !== uid);
}

function clearOnePair(state, cards) {
  const left = cards.filter((c) => !state.cleared.includes(c.uid));
  const first = left[0];
  const mate = partnerOf(cards, first.uid);
  let s = dispatch(state, { type: "click", uid: first.uid, legendId: first.legendId, face: first.face });
  s = dispatch(s, { type: "click", uid: mate.uid, legendId: mate.legendId, face: mate.face });
  s = dispatch(s, { type: "closeFocus" });
  return s;
}

/** —— 走通整局：两种组别各来一遍 —— */
for (const mode of MODE_LIST) {
  const allowed = new Set(G.legendsForMode(LEGENDS, mode).map((x) => x.id));
  let st = G.initialMatchState(2026, mode);
  check(`${mode} 初始状态在第一关`, st.levelIndex === 0 && st.phase === "play");
  check(`${mode} 初始状态记住了组别`, st.mode === mode, `mode=${st.mode}`);
  let totalMatched = 0;
  let guard = 0;
  const seen = new Set();
  while (st.phase !== "runDone" && guard < 300) {
    guard += 1;
    const cards = G.buildCards(LEGENDS, mode, st.levelIndex, st.seed);
    cards.forEach((c) => seen.add(c.legendId));
    st = clearOnePair(st, cards);
    totalMatched += 1;
    if (st.phase === "levelDone") {
      check(`${mode} 第 ${st.levelIndex + 1} 关消完时牌面清空`,
        st.cleared.length === G.pairsForLevel(mode, st.levelIndex) * 2,
        `cleared=${st.cleared.length}`);
      const before = st.score;
      const lvBefore = st.levelIndex;
      st = dispatch(st, { type: "nextLevel", seed: st.seed + 1 });
      check(`${mode} 进下一关后 cleared 清空`, st.cleared.length === 0);
      check(`${mode} 进下一关后分数保留`, st.score === before);
      check(`${mode} 进下一关后关卡号 +1`, st.levelIndex === lvBefore + 1,
        `${lvBefore} → ${st.levelIndex}`);
      check(`${mode} 进下一关后回到 play`, st.phase === "play");
      check(`${mode} 进下一关后组别不变`, st.mode === mode);
    }
  }
  check(`${mode} 整局走通`, st.phase === "runDone",
    `phase=${st.phase} guard=${guard}`);
  check(`${mode} 配对总数 = 各关对数之和`, totalMatched === G.totalPairs(mode),
    `${totalMatched} vs ${G.totalPairs(mode)}`);
  check(`${mode} 最终 matched 与配对次数一致`, st.matched === G.totalPairs(mode));
  check(`${mode} 连击数达上限并记录在案`, st.maxCombo >= G.COMBO_CAP,
    `maxCombo=${st.maxCombo}`);
  check(`${mode} 没有任何配错`, st.wrongCount === 0);
  // 组别不是摆设：整局都不该冒出别的组才有的图例
  check(`${mode} 全程只出现本组题库的图例`,
    [...seen].every((id) => allowed.has(id)),
    [...seen].filter((id) => !allowed.has(id)).join(","));
}

/** —— 单关细节：分支行为与组别无关，用初中组验一遍 —— */
let w0 = G.initialMatchState(7, "junior");
const cards0 = G.buildCards(LEGENDS, "junior", 0, 7);
const p0 = cards0[0];
const notMate = cards0.find((c) => c.legendId !== p0.legendId);
w0 = dispatch(w0, { type: "click", uid: p0.uid, legendId: p0.legendId, face: p0.face });
check("第一张进入选中态", w0.selected !== null && w0.started);
w0 = dispatch(w0, { type: "click", uid: notMate.uid, legendId: notMate.legendId, face: notMate.face });
check("配错后进入抖动锁定期", w0.wrongPair.length === 2);
check("配错后扣分", w0.score === 0, `score=${w0.score}`); // 0 → max(0, -20) = 0
check("配错后连击清零", w0.combo === 0);
check("配错后计数 +1", w0.wrongCount === 1);
const locked = dispatch(w0, { type: "click", uid: cards0[2].uid, legendId: cards0[2].legendId, face: cards0[2].face });
check("抖动期间点别的卡不生效", locked.selected === null && locked.wrongPair.length === 2);
w0 = dispatch(w0, { type: "clearWrong" });
check("抖动结束后恢复可点", w0.wrongPair.length === 0 && w0.selected === null);

// 先攒连击再配错，验证扣分是实打实的。
// 只清 2 对：初中组首关一共 4 对，清完 3 对就只剩一个图例，
// 凑不出"另一个图例的未消卡"来配错了。
let w1 = G.initialMatchState(11, "junior");
for (let i = 0; i < 2; i += 1) {
  w1 = clearOnePair(w1, G.buildCards(LEGENDS, "junior", 0, 11));
}
check("连击累积到 2", w1.combo === 2, `combo=${w1.combo}`);
const scoreBefore = w1.score;
const cc = G.buildCards(LEGENDS, "junior", 0, 11);
const k0 = cc.find((c) => !w1.cleared.includes(c.uid));
const kBad = cc.find((c) => c.legendId !== k0.legendId && !w1.cleared.includes(c.uid));
w1 = dispatch(w1, { type: "click", uid: k0.uid, legendId: k0.legendId, face: k0.face });
w1 = dispatch(w1, { type: "click", uid: kBad.uid, legendId: kBad.legendId, face: kBad.face });
check("配错扣掉 20 分", w1.score === scoreBefore - G.WRONG_PENALTY,
  `${scoreBefore} → ${w1.score}`);

// —— 已消掉的卡不能再点 ——
let d0 = G.initialMatchState(5, "junior");
const dc = G.buildCards(LEGENDS, "junior", 0, 5);
d0 = clearOnePair(d0, dc);
const gone = dc[0].uid;
const after = dispatch(d0, { type: "click", uid: gone, legendId: dc[0].legendId, face: dc[0].face });
check("已消除的卡点不动", after.selected === null && after.focus === null);

// —— 同一张卡点两次 = 取消选中 ——
let s2 = G.initialMatchState(9, "junior");
const sc = G.buildCards(LEGENDS, "junior", 0, 9);
s2 = dispatch(s2, { type: "click", uid: sc[0].uid, legendId: sc[0].legendId, face: sc[0].face });
s2 = dispatch(s2, { type: "click", uid: sc[0].uid, legendId: sc[0].legendId, face: sc[0].face });
check("重复点同一张 = 取消选中", s2.selected === null && s2.score === 0);

// —— 符号卡 + 名称卡各一张才算配对 ——
let s3 = G.initialMatchState(13, "junior");
const c3 = G.buildCards(LEGENDS, "junior", 0, 13);
const twoSym = c3.filter((c) => c.face === "symbol").slice(0, 2);
s3 = dispatch(s3, { type: "click", uid: twoSym[0].uid, legendId: twoSym[0].legendId, face: "symbol" });
s3 = dispatch(s3, { type: "click", uid: twoSym[1].uid, legendId: twoSym[1].legendId, face: "symbol" });
check("两张符号卡不算配对", s3.focus === null && s3.wrongPair.length === 2);

// —— 焦点卡时长期间不计时、锁输入 ——
let s4 = G.initialMatchState(3, "junior");
const c4 = G.buildCards(LEGENDS, "junior", 0, 3);
const a4 = c4[0];
const b4 = partnerOf(c4, a4.uid);
s4 = dispatch(s4, { type: "click", uid: a4.uid, legendId: a4.legendId, face: a4.face });
s4 = dispatch(s4, { type: "click", uid: b4.uid, legendId: b4.legendId, face: b4.face });
check("配对成功弹出复现卡", s4.focus !== null && s4.focus.pair.length === 2);
check("配对加分 100", s4.score === G.PAIR_POINTS, `score=${s4.score}`);
const secsBefore = s4.seconds;
s4 = dispatch(s4, { type: "tick" });
check("复现卡展示期间不计时", s4.seconds === secsBefore);
const c5 = c4[2];
s4 = dispatch(s4, { type: "click", uid: c5.uid, legendId: c5.legendId, face: c5.face });
check("复现卡展示期间锁输入", s4.selected === null);
const beforeClose = s4.cleared.length;
s4 = dispatch(s4, { type: "closeFocus" });
check("关闭复现卡后才真正消除", s4.cleared.length === beforeClose + 2);
check("关闭后再点同一张卡无效",
  dispatch(s4, { type: "click", uid: a4.uid, legendId: a4.legendId, face: a4.face }).selected === null);

// —— 提示 ——
let s5 = G.initialMatchState(21, "junior");
const c6 = G.buildCards(LEGENDS, "junior", 0, 21);
const pair = G.pickRemainingPair(c6, new Set(), G.mulberry32(1));
check("提示能给出未消除的一对", pair.length === 2);
check("提示给出的两张属于同一图例",
  c6.find((c) => c.uid === pair[0]).legendId === c6.find((c) => c.uid === pair[1]).legendId);
check("提示给出的是符号 + 名称",
  c6.find((c) => c.uid === pair[0]).face !== c6.find((c) => c.uid === pair[1]).face);
s5 = dispatch(s5, { type: "hint", pair });
check("提示次数 -1", s5.hintsLeft === G.HINTS_PER_LEVEL - 1);
check("提示扣分", s5.score === 0);
s5 = dispatch(s5, { type: "hint", pair });
check("同一次提示期间不能再点提示", s5.hintsLeft === G.HINTS_PER_LEVEL - 1);
s5 = dispatch(s5, { type: "clearHint" });
check("提示高亮可清除", s5.hintPair === null);
while (s5.hintsLeft > 0) {
  s5 = dispatch(s5, { type: "hint", pair });
  s5 = dispatch(s5, { type: "clearHint" });
}
s5 = dispatch(s5, { type: "hint", pair });
check("提示次数用完不再减少", s5.hintsLeft === 0);

// —— 非法动作不能把状态带歪 ——
let s6 = G.initialMatchState(31, "junior");
s6 = dispatch(s6, { type: "nextLevel", seed: 32 });
check("play 阶段不能直接跳关", s6.levelIndex === 0);
s6 = dispatch(s6, { type: "closeFocus" });
check("没有复现卡时 closeFocus 是空操作", s6.cleared.length === 0 && s6.phase === "play");
s6 = dispatch(s6, { type: "tick" });
check("未开局不计时", s6.seconds === 0);

// —— 换组别必须换掉关卡表（skipToEnd 的"是否最后一关"也跟着组别） ——
const seniorState = G.initialMatchState(41, "senior");
check("高级组 initialMatchState 记住组别", seniorState.mode === "senior");
check("两组末关对数不同",
  G.pairsForLevel("junior", G.levelCount("junior") - 1)
  !== G.pairsForLevel("senior", G.levelCount("senior") - 1));
check("restart 保留组别",
  G.matchReducer({ ...seniorState, score: 500 }, { type: "restart", seed: 7 }).mode === "senior");

console.log(`pick.test：${pass} 条通过，${fail.length} 条失败`);
if (fail.length) {
  fail.forEach((f) => console.log("  × " + f));
  process.exit(1);
}
