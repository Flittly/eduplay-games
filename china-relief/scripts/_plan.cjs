Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/plan.ts
/**
* 低难度模式下**保留**（预置）的比例。
*
* 取 0.6 是照用户那句"图上已经有了很多的地形，只需要补充上面的没有的"定的：
* 38 张里留 23、要塑 15，一次课的时间刚好；再高就只剩个位数要塑，
* 学生会觉得"点两下就结束了"，反而没有练习量。
*/
const EASY_KEEP = .6;
/** 任何一局至少要有这么多张留给学生，否则这一局没有意义（只剩 1 张时保底 1 张） */
const MIN_REQUIRED = 2;
/** 确定性随机源（mulberry32）。测试用固定种子复现同一局 */
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = a + 1831565813 >>> 0;
		let t = a;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
function shuffled(arr, rng) {
	const out = arr.slice();
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		const t = out[i];
		out[i] = out[j];
		out[j] = t;
	}
	return out;
}
/**
* 算出本局的两串条目。
*
* `preset` 与 `required` 的并集恒等于全部条目、交集恒为空 ——
* 这两条不变量在 `scripts/game.test.cjs` 里对 5×2 共 10 种组合逐一断言过。
* 少了任何一条，都会出现"某张卡既不用塑又没在图上"（永远打不完）
* 或"某张卡既在图上又能塑"（分数算两遍）这类死局。
*/
function planRound(items, scope, start, rng = Math.random) {
	const inScope = (it) => scope === "all" || it.scopeKey === scope;
	const poolIds = items.filter(inScope).map((it) => it.id);
	const keep = /* @__PURE__ */ new Set();
	if (start === "easy" && poolIds.length > 1) {
		const floor = Math.max(1, Math.min(MIN_REQUIRED, poolIds.length - 1));
		let keepCount = Math.round(poolIds.length * EASY_KEEP);
		if (poolIds.length - keepCount < floor) keepCount = poolIds.length - floor;
		for (const id of shuffled(poolIds, rng).slice(0, keepCount)) keep.add(id);
	}
	const presetSet = new Set(keep);
	for (const it of items) if (!inScope(it)) presetSet.add(it.id);
	return {
		required: items.filter((it) => inScope(it) && !presetSet.has(it.id)).map((it) => it.id),
		preset: items.filter((it) => presetSet.has(it.id)).map((it) => it.id)
	};
}
/** 练习范围的选项表（大厅与"本局待塑"筛选共用一处文案） */
const SCOPES = [
	{
		scope: "all",
		label: "全部",
		note: "四大高原 + 四大盆地 + 三大平原 + 东南丘陵 + 27 条山脉，一次塑完整幅中国地形。"
	},
	{
		scope: "plateau",
		label: "只练高原",
		note: "地图上只有四大高原是空的，盆地、平原、丘陵、山脉都已经在图上。"
	},
	{
		scope: "basin",
		label: "只练盆地",
		note: "只补四大盆地，其余地形已就位，先把盆地的位置钉牢。"
	},
	{
		scope: "plain",
		label: "只练平原",
		note: "只补三大平原，重点记住它们都在东部第三级阶梯上。"
	},
	{
		scope: "hills",
		label: "只练丘陵",
		note: "只补东南丘陵 —— 我国面积最大的丘陵，地面起伏和缓，与横断山区正好相反。"
	},
	{
		scope: "range",
		label: "只练山脉",
		note: "只补 27 条山脉的走向，高原盆地平原丘陵都已经在图上。"
	}
];
const STARTS = [{
	start: "blank",
	label: "空白地图",
	note: "本局范围内的地形全部由学生塑，难度最高。"
}, {
	start: "easy",
	label: "随机预置",
	note: "范围内先随机塑好约六成，只补缺的那些，每次开局都不一样。"
}];
/** 默认就是 v1.0.0/v1.1.0 的老手感：整幅空白、全部要塑 */
const DEFAULT_SCOPE = "all";
const DEFAULT_START = "blank";
/**
* 本局要塑多少张 —— **不含随机**，所以大厅能在还没开局时就把这个数报出来。
*
* 单独抽一个函数是为了让大厅的"本局要塑 15 张"和真正开局后的分母
* 出自同一个算法。各写一遍的话，两个数字一旦不一致，学生第一眼就会
* 看到"大厅说 15 张、进来变成 14 张"，然后不再信任任何一个数。
*/
function plannedCount(items, scope, start) {
	const n = items.filter((it) => scope === "all" || it.scopeKey === scope).length;
	if (start !== "easy" || n <= 1) return n;
	const floor = Math.max(1, Math.min(MIN_REQUIRED, n - 1));
	let keepCount = Math.round(n * EASY_KEEP);
	if (n - keepCount < floor) keepCount = n - floor;
	return n - keepCount;
}
//#endregion
exports.DEFAULT_SCOPE = DEFAULT_SCOPE;
exports.DEFAULT_START = DEFAULT_START;
exports.EASY_KEEP = EASY_KEEP;
exports.SCOPES = SCOPES;
exports.STARTS = STARTS;
exports.mulberry32 = mulberry32;
exports.planRound = planRound;
exports.plannedCount = plannedCount;
