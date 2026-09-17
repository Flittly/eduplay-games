Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/game.ts
const BASE_POINTS = {
	area: 20,
	line: 12
};
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
//#endregion
//#region src/session.ts
/**
* 多人接力会话（v1.1.0 新增，v1.2.0 加上"本局计划"）。
*
* ## 一张地图，轮流答题
*
* 课堂上更自然的做法是**全班合力塑一幅中国地形图**：讲台上一张图，
* 学生一个接一个上来放卡片，谁放的、放对了几张、拿了多少分，
* 各记各的。所以这里的地图状态（`placed`）是**全局共用**的，
* 而记分状态（`GameState`）是**每人一份**。
*
* 之所以把每人的状态整份留着而不是"只留一个总分"：
* 记分规则本身是带状态的 —— 同一张卡第几次才放对（`attemptOf`）、
* 当前连击（`streak`）、一次答对率（`firstTry`）—— 这些都要按人算。
* 直接复用 `game.ts` 里那套函数，等于复用已经回归过的规则，
* 不必为一个"多人版"再写一份会走样的积分代码。
*
* ## 两种模式的区别只在"什么时候换人"
*
* - `relay`（轮流答题）：**放对一张就换下一位**，全自动轮转。
* - `pick` （指定答题人）：不自动换，老师点谁谁答，答到换人为止。
*
* 两种模式下**放错都不换人**。这一条是刻意的：如果答错就换人，
* 学生很快会发现"答错＝把难题丢给下一个人"，于是乱丢一气，
* 反而比认真想更划算 —— 那是把规则设计成了反激励。
* 放错扣 5 分已经足够让"想清楚再放"划算，不需要再动用换人。
*
* 这一层不依赖 React，可以像 `game.ts` 一样直接在 Node 里跑回归。
*
* ## v1.2.0：本局计划（`required` / `preset`）
*
* 低难度模式与"只练某一类"都要在地图上**先摆好一批地形**。
* 这批地形与"学生塑出来的"是两件事，所以是两个集合：
* 只有 `placed` 进成绩，`preset` 只影响"图上有没有"。
* 判断"这块地完成了没有"一律走 `isSettled()`，别用 `isPlaced()`。
*/
const EMPTY_PLAN = {
	required: [],
	preset: []
};
function createSession(players, mode, plan = EMPTY_PLAN) {
	const order = players.map((p) => p.studentId);
	const names = {};
	const rounds = {};
	const seconds = {};
	for (const p of players) {
		names[p.studentId] = p.studentName;
		rounds[p.studentId] = createState();
		seconds[p.studentId] = 0;
	}
	return {
		mode,
		order,
		names,
		cursor: 0,
		rounds,
		placed: [],
		required: plan.required.slice(),
		preset: plan.preset.slice(),
		owner: {},
		turns: [],
		seconds
	};
}
/**
* 「当前没有答题人」的哨兵值（名单为空时）。
*
* ⚠ **学生的 id 不能是负数，尤其不能是 -1。** 这一层用 `id < 0` 判
* "没人可记分"，所以负数 id 会被所有提交函数静默丢弃：
* `commitCorrect` 直接返回原 session（不落位、不加分），
* 而界面那边 `cur >= 0` 也不成立（记分板显示 0、讲解卡不说"下一位"）。
* 症状是"提示一切正常、地图纹丝不动"，极难定位。
*
* 这条不是理论风险：v1.1.0 的体验模式（`GUEST_ROSTER`）最早写的就是
* `studentId: -1`，于是单人预览时 38 张卡一张都落不下去 —— 真机渲染回归
* 抓出来的。现在虚拟学生用一个显眼的正数（见 `main.tsx`）。
*/
const NO_CURRENT = -1;
function currentId(session) {
	return session.order.length === 0 ? -1 : session.order[session.cursor];
}
function currentName(session) {
	const id = currentId(session);
	return id < 0 ? "" : session.names[id] ?? "";
}
function roundOf(session, studentId) {
	return session.rounds[studentId] ?? createState();
}
function isPlaced(session, itemId) {
	return session.placed.includes(itemId);
}
/**
* 这张卡"已经在图上"了没有 —— **学生塑的 ∪ 一进场就预置的**。
*
* 界面上凡是问"这块地还要不要学生动手"的地方，一律问这个函数，
* 别去问 `isPlaced`：拿 `isPlaced` 当"完成"用的话，预置的地块会被当成
* 还没塑，学生拖上去还能再加一次分（同一块地算两遍）。
*/
function isSettled(session, itemId) {
	return session.placed.includes(itemId) || session.preset.includes(itemId);
}
/** 本局还要学生塑的条目（进度分母）。计划缺失时退化成 0，调用方自己保证传了计划 */
function requiredCount(session) {
	return session.required.length;
}
/** 本局是不是已经全部完成 */
function allSettled(session) {
	return session.required.length > 0 && session.required.every((id) => session.placed.includes(id));
}
/** 换人。`relay` 模式在放对之后由调用方触发；`pick` 模式只在点名时用 */
function advance(session) {
	if (session.order.length === 0) return session;
	return {
		...session,
		cursor: (session.cursor + 1) % session.order.length
	};
}
/** 点名：把答题人切到某一位。名单外的人直接忽略，不改变状态 */
function focusPlayer(session, studentId) {
	const idx = session.order.indexOf(studentId);
	if (idx < 0 || idx === session.cursor) return session;
	return {
		...session,
		cursor: idx
	};
}
function setMode(session, mode) {
	return session.mode === mode ? session : {
		...session,
		mode
	};
}
/**
* 放对：给当前答题人加分，并把这张卡记进共用地图。
*
* 已经归位的卡直接返回 `gained: 0` 且不改状态 —— 幂等。
* ⚠️ 闸门用的是 `isSettled`（含预置），不是 `isPlaced`：
* 预置的地块已经在图上了，学生再拖上去一次不该加第二次分。
*/
function commitCorrect(session, itemId, kind) {
	const studentId = currentId(session);
	if (studentId < 0 || isSettled(session, itemId)) return {
		session,
		gained: 0,
		studentId,
		studentName: session.names[studentId] ?? ""
	};
	const state = roundOf(session, studentId);
	if (state.placed.includes(itemId)) return {
		session,
		gained: 0,
		studentId,
		studentName: session.names[studentId] ?? ""
	};
	const gained = gainFor(state, itemId, kind);
	const next = {
		...session,
		rounds: {
			...session.rounds,
			[studentId]: applyCorrect(state, itemId, kind)
		},
		placed: [...session.placed, itemId],
		owner: {
			...session.owner,
			[itemId]: studentId
		},
		turns: [...session.turns, {
			studentId,
			studentName: session.names[studentId] ?? "",
			itemId,
			kind,
			gained
		}]
	};
	return {
		session: next.mode === "relay" ? advance(next) : next,
		gained,
		studentId,
		studentName: session.names[studentId] ?? ""
	};
}
/** 放错：扣当前答题人的分，**不换人**（理由见文件头） */
function commitWrong(session) {
	const studentId = currentId(session);
	if (studentId < 0) return session;
	return {
		...session,
		rounds: {
			...session.rounds,
			[studentId]: applyWrong(roundOf(session, studentId))
		}
	};
}
/** 用提示：算作该条目多试了一轮，并扣提示费 —— 与单人版同一条规则 */
function commitHint(session, itemId) {
	const studentId = currentId(session);
	if (studentId < 0 || isSettled(session, itemId)) return session;
	return {
		...session,
		rounds: {
			...session.rounds,
			[studentId]: applyHint(roundOf(session, studentId), itemId)
		}
	};
}
/** 累计答题时间（App 在每次换人 / 结算时把这段时间记账到当时那位身上） */
function addSeconds(session, studentId, sec) {
	if (studentId < 0 || !(studentId in session.seconds) || sec <= 0) return session;
	return {
		...session,
		seconds: {
			...session.seconds,
			[studentId]: (session.seconds[studentId] ?? 0) + sec
		}
	};
}
/** 上报平台用的成绩单，按得分从高到低 */
function resultsOf(session, totalItems) {
	return session.order.map((studentId) => {
		const state = roundOf(session, studentId);
		return {
			studentId,
			studentName: session.names[studentId] ?? "",
			score: state.score,
			timeSeconds: Math.round(session.seconds[studentId] ?? 0),
			correctCount: state.placed.length,
			totalCount: totalItems,
			mistakes: state.wrongCount,
			firstTry: state.firstTry,
			bestStreak: state.bestStreak
		};
	}).sort((a, b) => b.score - a.score || b.correctCount - a.correctCount);
}
/**
* 全班作为一个整体的评级。
*
* 拼一份"合计状态"再交给 `gradeOf`，而不是另写一套评级标准 ——
* 单人版那套（看一次答对率、放错次数）在班级尺度上同样成立，
* 而且两边口径一致，学生的体感才对得上。
*/
function classGrade(session, totalItems) {
	let score = 0;
	let wrongCount = 0;
	let firstTry = 0;
	let bestStreak = 0;
	for (const id of session.order) {
		const s = roundOf(session, id);
		score += s.score;
		wrongCount += s.wrongCount;
		firstTry += s.firstTry;
		bestStreak = Math.max(bestStreak, s.bestStreak);
	}
	return gradeOf({
		score,
		placed: session.placed,
		attemptOf: {},
		wrongCount,
		firstTry,
		streak: 0,
		bestStreak,
		history: []
	}, totalItems);
}
//#endregion
exports.NO_CURRENT = NO_CURRENT;
exports.addSeconds = addSeconds;
exports.advance = advance;
exports.allSettled = allSettled;
exports.classGrade = classGrade;
exports.commitCorrect = commitCorrect;
exports.commitHint = commitHint;
exports.commitWrong = commitWrong;
exports.createSession = createSession;
exports.currentId = currentId;
exports.currentName = currentName;
exports.focusPlayer = focusPlayer;
exports.isPlaced = isPlaced;
exports.isSettled = isSettled;
exports.requiredCount = requiredCount;
exports.resultsOf = resultsOf;
exports.roundOf = roundOf;
exports.setMode = setMode;
