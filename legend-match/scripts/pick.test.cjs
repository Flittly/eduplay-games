/* eslint-disable no-console */
// 抽牌难度曲线 + 配对状态机回归。
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

// ================================================================ 抽牌
check("图例数据 60 条", LEGENDS.length === 60, `实际 ${LEGENDS.length}`);
check("id 唯一", new Set(LEGENDS.map((x) => x.id)).size === LEGENDS.length);
check("每条都有 short 且 ≤6 字",
  LEGENDS.every((x) => x.short && [...x.short].length <= 6));
check("每条都有图与解释",
  LEGENDS.every((x) => x.image && x.summary.length >= 8));

for (let lv = 0; lv < G.LEVEL_COUNT; lv += 1) {
  const want = G.pairsForLevel(lv);
  for (const seed of [1, 2, 3, 99, 20260914]) {
    const picked = G.pickLegends(LEGENDS, lv, seed);
    check(`第 ${lv + 1} 关抽够对数 (seed ${seed})`, picked.length === want,
      `期望 ${want} 实际 ${picked.length}`);
    check(`第 ${lv + 1} 关无重复 (seed ${seed})`,
      new Set(picked.map((x) => x.id)).size === picked.length);
    const known = new Set(LEGENDS.map((x) => x.id));
    check(`第 ${lv + 1} 关都来自题库 (seed ${seed})`,
      picked.every((x) => known.has(x.id)));
  }
}

// 难度曲线：用「同类拥挤度」= 本关对数 ÷ 抽到的类别数，直接量"同类干扰有多强"。
// （不能用"抽到的类别数"本身当指标 —— 对数变多也会让类别数变多，两个效应互相抵消，
//   第一版就是这么写出了非单调的曲线。）
const SEEDS = Array.from({ length: 60 }, (_, i) => i * 7919 + 13);
const crowding = [];
for (let lv = 0; lv < G.LEVEL_COUNT; lv += 1) {
  let sum = 0;
  for (const s of SEEDS) {
    const picked = G.pickLegends(LEGENDS, lv, s);
    sum += picked.length / new Set(picked.map((x) => x.category)).size;
  }
  crowding.push(sum / SEEDS.length);
}
console.log("  每关同类拥挤度（对数 ÷ 类别数）：" +
  crowding.map((v, i) => `${i + 1}关 ${v.toFixed(2)}`).join(" / "));
check("同类拥挤度随关卡单调上升",
  crowding.every((v, i) => i === 0 || v >= crowding[i - 1] - 1e-9),
  JSON.stringify(crowding));
check("首关是跨类别混搭（拥挤度 < 2）", crowding[0] < 2,
  `实际 ${crowding[0].toFixed(2)}`);
check("末关同类干扰足够强（拥挤度 ≥ 5）",
  crowding[crowding.length - 1] >= 5,
  `实际 ${crowding[crowding.length - 1].toFixed(2)}`);

// ================================================================ 一副牌
for (let lv = 0; lv < G.LEVEL_COUNT; lv += 1) {
  const cards = G.buildCards(LEGENDS, lv, 4242);
  const want = G.pairsForLevel(lv) * 2;
  check(`第 ${lv + 1} 关卡数 ${want}`, cards.length === want,
    `实际 ${cards.length}`);
  check(`第 ${lv + 1} 关 uid 唯一`,
    new Set(cards.map((c) => c.uid)).size === cards.length);
  const byId = new Map();
  for (const c of cards) {
    byId.set(c.legendId, (byId.get(c.legendId) || 0) + 1);
  }
  check(`第 ${lv + 1} 关每个图例恰好两张卡`,
    [...byId.values()].every((v) => v === 2));
  check(`第 ${lv + 1} 关符号卡与名称卡各一张`,
    [...new Set(cards.map((c) => c.legendId))].every((id) =>
      cards.filter((c) => c.legendId === id && c.face === "symbol").length === 1 &&
      cards.filter((c) => c.legendId === id && c.face === "name").length === 1));
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

// —— 完整走通六关 ——
let st = G.initialMatchState(2026);
check("初始状态在第一关", st.levelIndex === 0 && st.phase === "play");
let totalMatched = 0;
let guard = 0;
while (st.phase !== "runDone" && guard < 200) {
  guard += 1;
  const cards = G.buildCards(LEGENDS, st.levelIndex, st.seed);
  const leftCount = cards.filter((c) => !st.cleared.includes(c.uid)).length;
  st = clearOnePair(st, cards);
  totalMatched += 1;
  if (st.phase === "levelDone") {
    check(`第 ${st.levelIndex + 1} 关消完时牌面清空`,
      st.cleared.length === G.pairsForLevel(st.levelIndex) * 2,
      `cleared=${st.cleared.length}`);
    const before = st.score;
    const lvBefore = st.levelIndex;
    st = dispatch(st, { type: "nextLevel", seed: st.seed + 1 });
    check(`进下一关后 cleared 清空`, st.cleared.length === 0);
    check(`进下一关后分数保留`, st.score === before);
    check(`进下一关后关卡号 +1`, st.levelIndex === lvBefore + 1,
      `${lvBefore} → ${st.levelIndex}`);
    check(`进下一关后回到 play`, st.phase === "play");
  }
}
check("六关全部走通", st.phase === "runDone", `phase=${st.phase} guard=${guard}`);
check("配对总数 = 各关对数之和", totalMatched === G.totalPairs(),
  `${totalMatched} vs ${G.totalPairs()}`);
check("最终 matched 与配对次数一致", st.matched === G.totalPairs());
check("连击数达上限并记录在案", st.maxCombo >= G.COMBO_CAP, `maxCombo=${st.maxCombo}`);
check("没有任何配错", st.wrongCount === 0);

// —— 配错分支 ——
let w0 = G.initialMatchState(7);
const cards0 = G.buildCards(LEGENDS, 0, 7);
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

// 先攒连击再配错，验证扣分是实打实的
let w1 = G.initialMatchState(11);
for (let i = 0; i < 3; i += 1) {
  w1 = clearOnePair(w1, G.buildCards(LEGENDS, 0, 11));
}
check("连击累积到 3", w1.combo === 3, `combo=${w1.combo}`);
const scoreBefore = w1.score;
const cc = G.buildCards(LEGENDS, 0, 11);
const k0 = cc.find((c) => !w1.cleared.includes(c.uid));
const kBad = cc.find((c) => c.legendId !== k0.legendId && !w1.cleared.includes(c.uid));
w1 = dispatch(w1, { type: "click", uid: k0.uid, legendId: k0.legendId, face: k0.face });
w1 = dispatch(w1, { type: "click", uid: kBad.uid, legendId: kBad.legendId, face: kBad.face });
check("配错扣掉 20 分", w1.score === scoreBefore - G.WRONG_PENALTY,
  `${scoreBefore} → ${w1.score}`);

// —— 已消掉的卡不能再点 ——
let d0 = G.initialMatchState(5);
const dc = G.buildCards(LEGENDS, 0, 5);
d0 = clearOnePair(d0, dc);
const gone = dc[0].uid;
const after = dispatch(d0, { type: "click", uid: gone, legendId: dc[0].legendId, face: dc[0].face });
check("已消除的卡点不动", after.selected === null && after.focus === null);

// —— 同一张卡点两次 = 取消选中 ——
let s2 = G.initialMatchState(9);
const sc = G.buildCards(LEGENDS, 0, 9);
s2 = dispatch(s2, { type: "click", uid: sc[0].uid, legendId: sc[0].legendId, face: sc[0].face });
s2 = dispatch(s2, { type: "click", uid: sc[0].uid, legendId: sc[0].legendId, face: sc[0].face });
check("重复点同一张 = 取消选中", s2.selected === null && s2.score === 0);

// —— 符号卡 + 名称卡各一张才算配对 ——
let s3 = G.initialMatchState(13);
const c3 = G.buildCards(LEGENDS, 0, 13);
const twoSym = c3.filter((c) => c.face === "symbol").slice(0, 2);
s3 = dispatch(s3, { type: "click", uid: twoSym[0].uid, legendId: twoSym[0].legendId, face: "symbol" });
s3 = dispatch(s3, { type: "click", uid: twoSym[1].uid, legendId: twoSym[1].legendId, face: "symbol" });
check("两张符号卡不算配对", s3.focus === null && s3.wrongPair.length === 2);

// —— 焦点卡时长期间不计时、锁输入 ——
let s4 = G.initialMatchState(3);
const c4 = G.buildCards(LEGENDS, 0, 3);
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
let s5 = G.initialMatchState(21);
const c6 = G.buildCards(LEGENDS, 0, 21);
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
let s6 = G.initialMatchState(31);
s6 = dispatch(s6, { type: "nextLevel", seed: 32 });
check("play 阶段不能直接跳关", s6.levelIndex === 0);
s6 = dispatch(s6, { type: "closeFocus" });
check("没有复现卡时 closeFocus 是空操作", s6.cleared.length === 0 && s6.phase === "play");
s6 = dispatch(s6, { type: "tick" });
check("未开局不计时", s6.seconds === 0);

console.log(`pick.test：${pass} 条通过，${fail.length} 条失败`);
if (fail.length) {
  fail.forEach((f) => console.log("  × " + f));
  process.exit(1);
}
