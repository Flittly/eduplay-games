Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/gameData.ts
const MODES = {
	junior: {
		id: "junior",
		name: "初中组",
		pairs: [
			4,
			6,
			8,
			10,
			12,
			14
		],
		minWindow: 3,
		blurb: "课本正文必会的常用图例",
		note: "标准图例页里的每一条都在这里"
	},
	senior: {
		id: "senior",
		name: "高级组",
		pairs: [
			6,
			8,
			10,
			12,
			14,
			16
		],
		minWindow: 2,
		blurb: "含全部分辨形细目，同类干扰更强",
		note: "等深线、海沟、复线铁路、管道这类容易看混的都在"
	}
};
/** 大厅里的显示顺序：先易后难 */
const MODE_ORDER = ["junior", "senior"];
const DEFAULT_MODE = "junior";
function modeConfig(mode) {
	return MODES[mode] ?? MODES["junior"];
}
function levelCount(mode) {
	return modeConfig(mode).pairs.length;
}
function pairsForLevel(mode, levelIndex) {
	const list = modeConfig(mode).pairs;
	return list[Math.max(0, Math.min(levelIndex, list.length - 1))];
}
function totalPairs(mode) {
	return modeConfig(mode).pairs.reduce((a, b) => a + b, 0);
}
/** 某个组别能出场的图例：高级组＝全部，初中组＝只取 tier==="basic"。 */
function legendsForMode(all, mode) {
	return mode === "senior" ? all : all.filter((l) => l.tier === "basic");
}
const PAIR_POINTS = 100;
const COMBO_STEP = 20;
const COMBO_CAP = 5;
const WRONG_PENALTY = 20;
const HINT_PENALTY = 30;
const HINTS_PER_LEVEL = 3;
/** 单张卡的最大旋转角（度）。旋转后的包围盒会撑大，布局时必须算进去。 */
const MAX_ROT_DEG = 7;
/** 卡面宽高比（横向小卡片，名称才排得下）。 */
const CARD_ASPECT = 1.3;
const CARD_MAX_W = 168;
const CARD_MIN_W = 56;
const CARD_PAD = 4;
const DEG = Math.PI / 180;
/** 可复现的伪随机数（同一 seed 必然给出同一副牌面）。 */
function mulberry32(seed) {
	let a = seed >>> 0;
	return function next() {
		a = a + 1831565813 >>> 0;
		let t = a;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
function shuffle(items, rnd) {
	const arr = [...items];
	for (let i = arr.length - 1; i > 0; i -= 1) {
		const j = Math.floor(rnd() * (i + 1));
		const t = arr[i];
		arr[i] = arr[j];
		arr[j] = t;
	}
	return arr;
}
/**
* 本关的抽牌窗口（参与抽牌的**目标**类别数）。
*
* v1.0.0 之前是 `类别数 − 关卡`。类别从 7 涨到 9 之后这条式子会出问题：
* 末关窗口留成 4 类，同类拥挤度从 ≥5 掉到 4，整条"越往后越容易看混"的
* 难度曲线就断了。改成**按类别数等比收缩**：
*
*     窗口 = max(minWindow, ⌊类别数 × 0.7^关卡⌋)
*
* 两个细节都是有理由的，别随手改：
* - 用 `floor` 而不是 `round`：`x·0.7^k` 单调减、floor 保单调 ⇒ 窗口一定
*   单调不增。用 round 会在某几关上把窗口弹回去，拥挤度跟着非单调。
* - `minWindow` 分模式给（初中组 3 / 高级组 2）：它决定窗口最窄收到几类。
*   初中组不跟高级组一样收到 2 类，是因为它只有 54 条、9 个类别 ——
*   收成 2 类时能挑的只剩最大的那几个类别，条目少的类别（人文景观 2 条、
*   气候图线 3 条）就彻底没机会出场了。
*   注意：**"窗口够厚"不是靠 minWindow 保证的**，是靠 windowStarts 挑起点
*   （否则薄窗口会触发补类别、把曲线拉塌，实测过）。
*/
function windowFor(mode, cats, levelIndex) {
	const min = modeConfig(mode).minWindow;
	const shrink = Math.floor(cats * Math.pow(.7, Math.max(0, levelIndex)));
	return Math.max(Math.min(min, cats), shrink);
}
/**
* 本关窗口的可选起点。
*
* 为什么不能简单地 `start = 关卡 % 类别数`：类别是按条目数降序排的，
* 轮转越靠后，窗口里的类别越薄。薄到凑不满本关对数时，旧代码会**临时并入
* 更多类别**（见下面 pickLegends 的兜底循环）—— 窗口实际变宽、同类拥挤度
* 反而下降，末关比倒数第二关还松，整条难度曲线就断了。
* （实测：初中组第 6 关窗口只有 11 条却要抽 14 对；高级组第 5、6 关同样不够。）
*
* 所以把起点限制在「窗口自身的条目数 ≥ 本关对数」的那些位置上：
* 窗口一定够厚 ⇒ 永远不会触发补类别 ⇒ 窗口宽度就是设计值 ⇒ 拥挤度曲线干净。
* 轮转本身保留，条目少的类别照样会被轮到 —— 只是不会让它独自在末关扛 16 对的量。
*/
function windowStarts(sizes, windowSize, pairs) {
	const total = sizes.length;
	const enough = [];
	for (let s = 0; s < total; s += 1) {
		let sum = 0;
		for (let i = 0; i < windowSize; i += 1) sum += sizes[(s + i) % total];
		if (sum >= pairs) enough.push(s);
	}
	return enough.length > 0 ? enough : [0];
}
/** 算出本关的窗口类别。类别按条目数从多到少排序，起点只在"够厚"的位置里轮转。 */
function planWindow(all, mode, levelIndex) {
	const bank = legendsForMode(all, mode);
	const pairs = pairsForLevel(mode, levelIndex);
	const byCat = /* @__PURE__ */ new Map();
	for (const it of bank) {
		const list = byCat.get(it.category);
		if (list) list.push(it);
		else byCat.set(it.category, [it]);
	}
	const cats = [...byCat.keys()].sort((a, b) => {
		const d = byCat.get(b).length - byCat.get(a).length;
		return d !== 0 ? d : a.localeCompare(b);
	});
	const total = cats.length;
	if (total === 0) return null;
	const windowSize = Math.min(windowFor(mode, total, levelIndex), total);
	const starts = windowStarts(cats.map((c) => byCat.get(c).length), windowSize, pairs);
	const start = starts[Math.max(0, levelIndex) % starts.length];
	const window = [];
	for (let i = 0; i < windowSize; i += 1) window.push(cats[(start + i) % total]);
	return {
		cats: window,
		pairs
	};
}
/**
* 本关窗口覆盖的类别（外部/测试核对"窗口够不够厚"用）。
* 抽到的图例必然都来自这些类别 —— 一旦出现窗口外的类别，就说明触发了补类别。
*/
function windowCategories(all, mode, levelIndex) {
	return planWindow(all, mode, levelIndex)?.cats ?? [];
}
/**
* 按关卡抽图例。
*
* 难度曲线不靠"牌更多"单独支撑 —— 更要紧的是**同类干扰**：
* 高关卡把候选池收窄到 2~3 个类别里（比如全是交通类），
* 一堆长得像的符号混在一起才真正考人。
*
* 做法：类别按条目数从多到少排序，每关取一段"滑动窗口"，窗口宽度随关卡收窄；
* 起点在**够厚的那些位置**里轮转（理由见 windowStarts），
* 保证条目少的类别也能轮到上场，同时窗口永远塞得满本关对数。
*/
function pickLegends(all, mode, levelIndex, seed) {
	const plan = planWindow(all, mode, levelIndex);
	if (!plan) return [];
	const rnd = mulberry32(seed);
	const byCat = /* @__PURE__ */ new Map();
	for (const it of legendsForMode(all, mode)) {
		const list = byCat.get(it.category);
		if (list) list.push(it);
		else byCat.set(it.category, [it]);
	}
	const pool = [];
	for (const name of plan.cats) pool.push(...byCat.get(name));
	if (pool.length < plan.pairs) for (const name of byCat.keys()) {
		if (pool.length >= plan.pairs) break;
		if (!plan.cats.includes(name)) pool.push(...byCat.get(name));
	}
	return shuffle(pool, rnd).slice(0, plan.pairs);
}
/** 一副牌：每个图例出两张卡 —— 一张符号卡 + 一张名称卡，然后整体打乱。 */
function buildCards(legends, mode, levelIndex, seed) {
	const picked = pickLegends(legends, mode, levelIndex, seed);
	const raw = [];
	picked.forEach((it) => {
		raw.push({
			uid: `${it.id}::symbol`,
			legendId: it.id,
			face: "symbol"
		});
		raw.push({
			uid: `${it.id}::name`,
			legendId: it.id,
			face: "name"
		});
	});
	return shuffle(raw, mulberry32((seed ^ 2654435769) >>> 0));
}
/** 从还没消掉的卡里随便挑一对（提示用）。 */
function pickRemainingPair(cards, cleared, rnd) {
	const left = cards.filter((c) => !cleared.has(c.uid));
	if (left.length < 2) return [];
	const first = left[Math.floor(rnd() * left.length)];
	const mate = left.find((c) => c.legendId === first.legendId && c.uid !== first.uid);
	return mate ? [first.uid, mate.uid] : [];
}
/**
* 把 count 张卡"洒"在 boardW × boardH 的牌面上。
*
* 用的是**打乱的格子 + 格子内抖动**，而不是纯随机撒点：
* 纯拒绝采样在 30 多张卡时会大概率找不到位置，而格子法可以**证明**两两不重叠 ——
* 每张卡的旋转包围盒严格小于格子，抖动幅度又限制在"格子边长 − 包围盒"的一半以内，
* 于是任意相邻两格的卡片中心距 ≥ 包围盒边长，必然不相交，也不会越界。
*/
function layoutCards(count, boardW, boardH, seed) {
	const out = [];
	if (count <= 0 || boardW <= 0 || boardH <= 0) return out;
	const rnd = mulberry32(seed);
	const cols = Math.max(1, Math.ceil(Math.sqrt(count * (boardW / boardH))));
	const rows = Math.max(1, Math.ceil(count / cols));
	const cw = boardW / cols;
	const ch = boardH / rows;
	const rotScale = Math.cos(7 * DEG) + Math.sin(7 * DEG);
	const maxW = cw / rotScale * .92;
	const maxH = ch / rotScale * .92;
	let cardW = Math.min(maxW, maxH * CARD_ASPECT, 168);
	cardW = Math.max(cardW, Math.min(56, maxW));
	let cardH = cardW / CARD_ASPECT;
	if (cardH > maxH) {
		cardH = maxH;
		cardW = cardH * CARD_ASPECT;
	}
	const bw = cardW * rotScale;
	const bh = cardH * rotScale;
	const jx = Math.max(0, cw / 2 - bw / 2 - 4);
	const jy = Math.max(0, ch / 2 - bh / 2 - 4);
	const cells = [];
	for (let i = 0; i < cols * rows; i += 1) cells.push(i);
	const cellOrder = shuffle(cells, rnd);
	for (let k = 0; k < count; k += 1) {
		const cell = cellOrder[k];
		const col = cell % cols;
		const row = Math.floor(cell / cols);
		const x = (col + .5) * cw + (rnd() * 2 - 1) * jx;
		const y = (row + .5) * ch + (rnd() * 2 - 1) * jy;
		const rot = (rnd() * 2 - 1) * 7;
		out.push({
			x,
			y,
			w: cardW,
			h: cardH,
			rot
		});
	}
	return out;
}
function initialMatchState(seed, mode) {
	return {
		mode,
		levelIndex: 0,
		seed,
		cleared: [],
		selected: null,
		wrongPair: [],
		focus: null,
		score: 0,
		combo: 0,
		maxCombo: 0,
		matched: 0,
		wrongCount: 0,
		hintsLeft: 3,
		hintPair: null,
		phase: "play",
		seconds: 0,
		started: false
	};
}
/**
* 配对状态机。所有"结束"的判定都收敛在这里，组件只负责画。
*
* 规矩（沿用本仓库 province-quiz 的教训）：**每条能让局面往前走的分支都必须有出口**。
* 这里的两条出口是 closeFocus（消掉一对）与 nextLevel（进下一关），
* 除此之外没有任何分支会改动 phase，所以不存在"卡在某个中间态"的可能。
*/
function matchReducer(state, action) {
	switch (action.type) {
		case "tick":
			if (!state.started || state.phase !== "play" || state.focus) return state;
			return {
				...state,
				seconds: state.seconds + 1
			};
		case "click": {
			if (state.phase !== "play" || state.focus) return state;
			if (state.wrongPair.length > 0 || state.cleared.includes(action.uid)) return state;
			const sel = state.selected;
			if (!sel) return {
				...state,
				selected: {
					uid: action.uid,
					legendId: action.legendId,
					face: action.face
				},
				started: true,
				hintPair: null
			};
			if (sel.uid === action.uid) return {
				...state,
				selected: null
			};
			if (sel.legendId === action.legendId && sel.face !== action.face) {
				const gain = 100 + Math.min(state.combo, 5) * 20;
				const combo = state.combo + 1;
				return {
					...state,
					selected: null,
					hintPair: null,
					focus: {
						legendId: action.legendId,
						pair: [sel.uid, action.uid],
						gain,
						combo
					},
					score: state.score + gain,
					combo,
					maxCombo: Math.max(state.maxCombo, combo)
				};
			}
			return {
				...state,
				selected: null,
				hintPair: null,
				wrongPair: [sel.uid, action.uid],
				combo: 0,
				wrongCount: state.wrongCount + 1,
				score: Math.max(0, state.score - 20)
			};
		}
		case "clearWrong": return state.wrongPair.length ? {
			...state,
			wrongPair: []
		} : state;
		case "closeFocus": {
			if (!state.focus) return state;
			const cleared = [...state.cleared, ...state.focus.pair];
			const matched = state.matched + 1;
			const done = cleared.length >= pairsForLevel(state.mode, state.levelIndex) * 2;
			let phase = "play";
			if (done) phase = state.levelIndex + 1 >= levelCount(state.mode) ? "runDone" : "levelDone";
			return {
				...state,
				cleared,
				matched,
				focus: null,
				phase,
				selected: null
			};
		}
		case "nextLevel":
			if (state.phase !== "levelDone") return state;
			return {
				...initialMatchState(action.seed, state.mode),
				levelIndex: state.levelIndex + 1,
				score: state.score,
				maxCombo: state.maxCombo,
				matched: state.matched,
				wrongCount: state.wrongCount,
				seconds: state.seconds,
				started: true
			};
		case "skipToEnd":
			if (state.phase !== "levelDone") return state;
			return {
				...state,
				phase: "runDone"
			};
		case "restart": return initialMatchState(action.seed, state.mode);
		case "hint":
			if (state.phase !== "play" || state.focus || state.hintsLeft <= 0) return state;
			if (state.hintPair || action.pair.length !== 2) return state;
			return {
				...state,
				hintsLeft: state.hintsLeft - 1,
				hintPair: action.pair,
				selected: null,
				score: Math.max(0, state.score - 30)
			};
		case "clearHint": return state.hintPair ? {
			...state,
			hintPair: null
		} : state;
		default: return state;
	}
}
//#endregion
exports.CARD_ASPECT = CARD_ASPECT;
exports.CARD_MAX_W = CARD_MAX_W;
exports.CARD_MIN_W = CARD_MIN_W;
exports.CARD_PAD = CARD_PAD;
exports.COMBO_CAP = COMBO_CAP;
exports.COMBO_STEP = COMBO_STEP;
exports.DEFAULT_MODE = DEFAULT_MODE;
exports.HINTS_PER_LEVEL = HINTS_PER_LEVEL;
exports.HINT_PENALTY = HINT_PENALTY;
exports.MAX_ROT_DEG = MAX_ROT_DEG;
exports.MODES = MODES;
exports.MODE_ORDER = MODE_ORDER;
exports.PAIR_POINTS = PAIR_POINTS;
exports.WRONG_PENALTY = WRONG_PENALTY;
exports.buildCards = buildCards;
exports.initialMatchState = initialMatchState;
exports.layoutCards = layoutCards;
exports.legendsForMode = legendsForMode;
exports.levelCount = levelCount;
exports.matchReducer = matchReducer;
exports.modeConfig = modeConfig;
exports.mulberry32 = mulberry32;
exports.pairsForLevel = pairsForLevel;
exports.pickLegends = pickLegends;
exports.pickRemainingPair = pickRemainingPair;
exports.shuffle = shuffle;
exports.totalPairs = totalPairs;
exports.windowCategories = windowCategories;
exports.windowFor = windowFor;
