Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/game.ts
const BASE_POINTS = {
	area: 20,
	line: 12
};
const WRONG_PENALTY = 5;
const HINT_COST = 8;
const STREAK_BONUS = 15;
const STREAK_STEP = 3;
const MIN_SCORE = 0;
function createState() {
	return {
		score: 0,
		placed: [],
		attemptOf: {},
		wrongCount: 0,
		firstTry: 0,
		streak: 0,
		bestStreak: 0,
		history: []
	};
}
/** 第 n 次尝试的系数（n 从 1 开始） */
function attemptFactor(attempt) {
	if (attempt <= 1) return 1;
	if (attempt === 2) return .6;
	return .3;
}
function pointsFor(kind, attempt) {
	return Math.round(BASE_POINTS[kind] * attemptFactor(attempt));
}
/**
* 这一条现在放对能拿多少分（含连击奖励），没得过分才有意义。
*
* 为什么单独抽出来：给学生的提示文案里要报「+N」，而记分板上的数字由
* `applyCorrect` 算 —— 两个地方各写一个常数，就会出现「提示写 +20、
* 记分板只加 12」这种自相矛盾（用过提示的条目要乘 0.6 系数）。
* 学生一定会发现，而且会因此不再相信提示里的数字。所以两处共用一个算法。
*/
function gainFor(state, id, kind) {
	if (state.placed.includes(id)) return 0;
	const attempt = (state.attemptOf[id] ?? 0) + 1;
	const first = attempt === 1;
	const streak = first ? state.streak + 1 : 0;
	const bonus = first && streak > 0 && streak % 3 === 0 ? 15 : 0;
	return pointsFor(kind, attempt) + bonus;
}
/** 放对。已经放对过的条目直接忽略（幂等），避免重复加分。 */
function applyCorrect(state, id, kind) {
	if (state.placed.includes(id)) return state;
	const attempt = (state.attemptOf[id] ?? 0) + 1;
	const gained = gainFor(state, id, kind);
	const first = attempt === 1;
	const streak = first ? state.streak + 1 : 0;
	return {
		...state,
		score: state.score + gained,
		placed: [...state.placed, id],
		attemptOf: {
			...state.attemptOf,
			[id]: attempt
		},
		firstTry: state.firstTry + (first ? 1 : 0),
		streak,
		bestStreak: Math.max(state.bestStreak, streak),
		history: [...state.history, {
			id,
			kind,
			attempt,
			points: gained
		}]
	};
}
/**
* 放错。
*
* 扣分后不写回 attemptOf —— 当前这一格不算"尝试次数"，
* 真正的次数在放对时才结算。否则学生在同一条山脉上连点五次，
* 第五次放对只值 3 分，惩罚过重。
*/
function applyWrong(state) {
	return {
		...state,
		score: Math.max(0, state.score - 5),
		wrongCount: state.wrongCount + 1,
		streak: 0
	};
}
/** 用了一次提示：算作"多试了一轮"，所以该条目掉一档系数，并另扣提示费。 */
function applyHint(state, id) {
	const attempts = (state.attemptOf[id] ?? 0) + 1;
	return {
		...state,
		score: Math.max(0, state.score - 8),
		attemptOf: {
			...state.attemptOf,
			[id]: attempts
		}
	};
}
function progressOf(state, total, totalItems) {
	const done = state.placed.length;
	const answered = done + state.wrongCount;
	return {
		done,
		total,
		ratio: total === 0 ? 0 : done / total,
		firstTryRatio: answered === 0 ? 0 : state.firstTry / Math.max(done, 1)
	};
}
/** 结算评级：看得分，也看"一次答对率"——后者才反映真的记住了位置。 */
function gradeOf(state, total) {
	const ratio = state.firstTry / Math.max(1, total);
	if (state.wrongCount === 0 && ratio >= .9) return {
		key: "perfect",
		label: "地表学家",
		comment: "一条都没放错，中国地形已经在你脑子里立起来了。"
	};
	if (ratio >= .7) return {
		key: "great",
		label: "地势通",
		comment: "位置记得很牢，个别地方再看看说明书就更稳了。"
	};
	if (ratio >= .4) return {
		key: "good",
		label: "正在成图",
		comment: "大致骨架有了，把还含糊的那几块对着地图再过一遍。"
	};
	return {
		key: "keep",
		label: "再来一轮",
		comment: "先点开卡片看看每个地形区在哪儿，再回来塑形会顺很多。"
	};
}
/**
* 拖动落偏了要弹回，弹回时给个方向感的话。
*
* `dLon / dLat` 是「**从落点走到锚点**要走的位移」，所以它的符号直接就是
* 学生该往哪边走：落点在锚点南边时 dLat > 0，提示就该是「往偏北方向找」。
* （`lat` 越大越靠北；落到 28°N 而锚点在 33.86°N，要往北走 5.86°。）
*
* 这里曾经把两个符号都写反了 —— 落在南边却说「往偏南方向找」。
* 学生照着走只会离目标更远，而这件事从界面上完全看不出是 bug，
* 只会让人觉得"这提示没用"。`scripts/game.test.cjs` 里有四个方位的断言守着。
*/
function distanceHint(lon, lat, anchor) {
	const dLon = anchor[0] - lon;
	const dLat = anchor[1] - lat;
	const km = Math.round(Math.hypot(dLon * 90, dLat * 111));
	const ns = Math.abs(dLat) > 1.2 ? dLat > 0 ? "北" : "南" : "";
	const ew = Math.abs(dLon) > 1.2 ? dLon > 0 ? "东" : "西" : "";
	if (ns === "" && ew === "") return "很接近了，再挪一点点";
	return `大概还差 ${km} 公里，往${ew}${ns}方向找`;
}
//#endregion
exports.BASE_POINTS = BASE_POINTS;
exports.HINT_COST = HINT_COST;
exports.MIN_SCORE = MIN_SCORE;
exports.STREAK_BONUS = STREAK_BONUS;
exports.STREAK_STEP = STREAK_STEP;
exports.WRONG_PENALTY = WRONG_PENALTY;
exports.applyCorrect = applyCorrect;
exports.applyHint = applyHint;
exports.applyWrong = applyWrong;
exports.attemptFactor = attemptFactor;
exports.createState = createState;
exports.distanceHint = distanceHint;
exports.gainFor = gainFor;
exports.gradeOf = gradeOf;
exports.pointsFor = pointsFor;
exports.progressOf = progressOf;
