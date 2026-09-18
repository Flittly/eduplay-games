Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/labels.ts
/**
* 挑出该标注的地名。**输出顺序就是避让优先级** ——
* `terrain.ts` 的 `drawLabels` 按这个顺序画，被已画过的包围盒压住的直接跳过。
*
* @param all        全部条目（按数据顺序）
* @param isSettled  判"这条已经在图上了吗"。调用方传 `isSettled(session, id)`，
*                   **不要传 `isPlaced`** —— 图鉴与分类专练里大量条目是预置的，
*                   按 isPlaced 过滤会让图鉴一个名字都没有（真实踩过的坑）。
* @param priorityId 提到最前的那一条（刚放对 / 刚点开）。不在场上就自动忽略。
*/
function pickLabels(all, isSettled, priorityId) {
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	const take = (src) => {
		if (!src || seen.has(src.id) || !src.anchor) return;
		seen.add(src.id);
		out.push({
			text: src.name,
			lon: src.anchor[0],
			lat: src.anchor[1],
			scale: src.scale
		});
	};
	if (priorityId) take(all.find((s) => s.id === priorityId && isSettled(s.id)));
	for (const s of all) if (isSettled(s.id)) take(s);
	return out;
}
//#endregion
exports.pickLabels = pickLabels;
