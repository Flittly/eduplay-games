Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/geo.ts
/**
* 经纬度五子棋 · 纯逻辑层
*
* 棋盘几何：15 条线 × 每格 5° = 跨度 70°，每局只随机平移窗口位置，网格大小恒定。
*
* 四象限：窗口可以整块落在北纬 / 南纬 / 东经 / 西经，也可以跨赤道、跨本初子午线。
* 支撑这件事的是一条不变式 —— **`latTop` 永远是窗口最北的一条纬线、`lonLeft` 永远是最西的一条经线**，
* 于是 row = (latTop - lat) / 5、col = (lon - lonLeft) / 5 对带符号的值天然成立。
* 这就是为什么棋盘几何完全不需要为南纬 / 西经做特殊分支：只要窗口始终"从南到北、
* 从西到东"排列，坐标映射就与半球无关。窗口平移与半球归属是**正交**的两件事。
*
* 同理，坐标的"解析"与"落子"也正交：解析出的永远是带符号的度数，
* 落子只关心它是不是 5 的倍数、在不在窗口内。
*/
/** 每条轴的格线数量（15×15 交点）。 */
const GRID = 15;
/** 相邻两条格线的度数差。 */
const DEG_STEP = 5;
/** 窗口跨度：15 条线之间有 14 个间隔。 */
const SPAN = 70;
function steps(from, to, step) {
	const out = [];
	if (step > 0) for (let v = from; v <= to; v += step) out.push(v);
	else for (let v = from; v >= to; v += step) out.push(v);
	return out;
}
/**
* 纬度窗口上沿的可选值：90°N 一路到 20°S（下沿 = 上沿 − 70°），共 23 档。
* 恰好覆盖三种情形：整块在北纬 / 跨赤道 / 整块在南纬。
*/
const LAT_TOPS = steps(90, -20, -5);
/**
* 经度窗口左沿的可选值：180°W 一路到 110°E，共 59 档。
* 上界取 110°E 是为了让右沿恰好落在 180°E —— 窗口永不跨越 180° 经线，
* 否则"左沿数值最小"这条不变式会在换日线上断裂。
*/
const LON_LEFTS = steps(-180, 110, 5);
function randomBoardRange(rand = Math.random) {
	const pick = (list) => {
		const index = Math.floor(rand() * list.length);
		return list[Math.min(list.length - 1, Math.max(0, index))];
	};
	return {
		latTop: pick(LAT_TOPS),
		lonLeft: pick(LON_LEFTS)
	};
}
function latBottom(range) {
	return range.latTop - 70;
}
function lonRight(range) {
	return range.lonLeft + 70;
}
function buildAxes(range) {
	return {
		lats: Array.from({ length: 15 }, (_, index) => range.latTop - index * 5),
		lons: Array.from({ length: 15 }, (_, index) => range.lonLeft + index * 5)
	};
}
/** 纬度 → 行号（0 = 最北）。 */
function rowOfLat(lat, range) {
	return (range.latTop - lat) / 5;
}
/** 经度 → 列号（0 = 最西）。 */
function colOfLon(lon, range) {
	return (lon - range.lonLeft) / 5;
}
/**
* 某条轴上"实际出现"的半球（只统计非零格线）。
* 0° 既不算 N 也不算 S，它在任何窗口里都放行 —— 见 parseDegreeInput。
*/
function axisHemis(kind, range) {
	const out = [];
	if (kind === "lat") {
		if (range.latTop > 0) out.push("N");
		if (latBottom(range) < 0) out.push("S");
	} else {
		if (lonRight(range) > 0) out.push("E");
		if (range.lonLeft < 0) out.push("W");
	}
	return out;
}
/**
* 轴是否跨过 0° 线（赤道 / 本初子午线）—— 跨线时裸数字有歧义，必须写明半球。
* 注意"跨线"与"包含 0°"不是一回事：窗口 70°S—0° 包含赤道但整块在南纬。
*/
function axisHemisInfo(kind, range) {
	const positives = kind === "lat" ? range.latTop > 0 : lonRight(range) > 0;
	const negatives = kind === "lat" ? latBottom(range) < 0 : range.lonLeft < 0;
	return {
		positives,
		negatives,
		both: positives && negatives
	};
}
/** 轴标签上"0° 线"所处的格线序号；窗口不含 0° 线时为 null。 */
function zeroIndex(kind, range) {
	const raw = kind === "lat" ? range.latTop / 5 : -range.lonLeft / 5;
	if (!Number.isInteger(raw)) return null;
	return raw >= 0 && raw < 15 ? raw : null;
}
/** 0° 线的名称：赤道 / 本初子午线。 */
function zeroName(kind) {
	return kind === "lat" ? "赤道" : "本初子午线";
}
/** 棋盘轴标签用紧凑写法：`30°N` / `30°S` / `0°`。 */
function formatLatCompact(lat) {
	if (lat === 0) return "0°";
	return `${Math.abs(lat)}°${lat < 0 ? "S" : "N"}`;
}
function formatLonCompact(lon) {
	if (lon === 0) return "0°";
	return `${Math.abs(lon)}°${lon < 0 ? "W" : "E"}`;
}
/** 面板与记录用中文写法：`北纬30°` / `赤道`。 */
function formatLatCn(lat) {
	if (lat === 0) return "赤道";
	return `${lat < 0 ? "南纬" : "北纬"}${Math.abs(lat)}°`;
}
function formatLonCn(lon) {
	if (lon === 0) return "本初子午线";
	return `${lon < 0 ? "西经" : "东经"}${Math.abs(lon)}°`;
}
function formatAxis(kind, value, style) {
	if (kind === "lat") return style === "cn" ? formatLatCn(value) : formatLatCompact(value);
	return style === "cn" ? formatLonCn(value) : formatLonCompact(value);
}
/** 读数：`南纬5°—北纬65°`，含 0° 时用"赤道 / 本初子午线"代替。 */
function axisRangeText(kind, range) {
	const min = kind === "lat" ? latBottom(range) : range.lonLeft;
	const max = kind === "lat" ? range.latTop : lonRight(range);
	return `${formatAxis(kind, min, "cn")}—${formatAxis(kind, max, "cn")}`;
}
function axisName(kind) {
	return kind === "lat" ? "纬度" : "经度";
}
/** 半球名：南纬 / 北纬 / 西经 / 东经。 */
function hemiName(kind, hemi) {
	if (kind === "lat") return hemi === "N" ? "北纬" : "南纬";
	return hemi === "E" ? "东经" : "西经";
}
function hemiLetter(kind, hemi) {
	return hemi;
}
/** 某条轴上可选的两个半球，顺序按中文习惯：北纬在前、东经在前。 */
function hemiOptions(kind) {
	return kind === "lat" ? ["N", "S"] : ["E", "W"];
}
/** 本棋盘该轴的半球读数，例如 `只有北纬` / `北纬与南纬都有`。 */
function axisHemiText(kind, range) {
	const list = axisHemis(kind, range);
	if (list.length === 1) return `只有${hemiName(kind, list[0])}`;
	return `${hemiName(kind, list[0])}与${hemiName(kind, list[1])}都有`;
}
const DEFAULT_HIDE_MODE = "half";
const HIDE_MODES = [
	{
		id: "full",
		label: "全部标出",
		hint: "15 条线全部标出度数，先讲一遍"
	},
	{
		id: "half",
		label: "隔一标一",
		hint: "每 2 条标 1 条，另一条自己数"
	},
	{
		id: "anchor",
		label: "只留锚点",
		hint: "只标最北/中间/最南 3 条"
	}
];
/**
* 返回每条格线是否显示度数标签。
*
* 无论隐藏到哪一档，**0° 线（赤道 / 本初子午线）永远标出** —— 它是学生唯一可以
* 无条件信任的锚点，把它藏掉会把"数格子"变成"猜格子"。所以：
*   half   实际 8 或 9 条（索引 0,2,4,…,14 再加上 0° 线）
*   anchor 实际 3 或 4 条（索引 0,7,14 再加上 0° 线）
*/
function labelIndices(mode, zero) {
	const show = Array.from({ length: 15 }, (_, index) => {
		if (mode === "full") return true;
		if (mode === "half") return index % 2 === 0;
		return index === 0 || index === Math.floor(7) || index === 14;
	});
	if (zero !== null && zero >= 0 && zero < 15) show[zero] = true;
	return show;
}
function labelCount(mode, zero) {
	return labelIndices(mode, zero).filter(Boolean).length;
}
const LAT_CN = [
	["北纬", 1],
	["北", 1],
	["南纬", -1],
	["南", -1]
];
const LON_CN = [
	["东经", 1],
	["东", 1],
	["西经", -1],
	["西", -1]
];
/** 该轴"写错另一轴半球"时要提示的措辞，例如纬度写了东经。 */
function wrongAxisHint(kind) {
	return kind === "lat" ? "纬度要用北纬(N) 或 南纬(S)，不能写东经/西经" : "经度要用东经(E) 或 西经(W)，不能写北纬/南纬";
}
function formatHint(kind, range) {
	return `请按“${sampleInput(kind, range)}”的格式填写`;
}
/** 取窗口正中那条格线做示例，保证示例本身就是本棋盘上的合法坐标。 */
function sampleInput(kind, range, style = "cn") {
	const axes = buildAxes(range);
	const mid = Math.floor(7);
	return formatAxis(kind, kind === "lat" ? axes.lats[mid] : axes.lons[mid], style);
}
/**
* 解析一条坐标输入，返回**带符号**的度数。
*
* 接受的写法：`北纬30°` / `30°N` / `N30` / `30`（裸数字，仅在棋盘不跨 0° 线时）
* 以及 `0` / `赤道` / `本初子午线`。
*
* 三条刻意的取舍：
* ① 半球与负号不能同时出现（`南纬-30` 互相矛盾），直接判错而不是"以负号为准"；
* ② 棋盘跨 0° 线时**拒绝**裸数字 —— 此时"30"确实有两种读法，猜一个等于教错；
* ③ 写了本棋盘不存在的半球时单独给一条提示，而不是笼统地报"超出范围"，
*    因为学生真正需要知道的是"这局在南半球，没有北纬"。
*/
function parseDegreeInput(raw, kind, range) {
	const text = (raw ?? "").trim();
	if (!text) return {
		ok: false,
		error: `请填写${axisName(kind)}`
	};
	const ownLetters = kind === "lat" ? /[nNsS]/ : /[eEwW]/;
	const otherLetters = kind === "lat" ? /[eEwW]/ : /[nNsS]/;
	const ownTable = kind === "lat" ? LAT_CN : LON_CN;
	const otherTable = kind === "lat" ? LON_CN : LAT_CN;
	const zeroWord = zeroName(kind);
	let explicit = null;
	if (text.includes(zeroWord)) explicit = 0;
	if (explicit === null) {
		for (const [word, sign] of ownTable) if (text.includes(word)) {
			explicit = sign;
			break;
		}
	}
	if (explicit === null) {
		const own = text.match(ownLetters);
		if (own) {
			const letter = own[0].toLowerCase();
			explicit = letter === "n" || letter === "e" ? 1 : -1;
		}
	}
	if (explicit === null) {
		if (otherTable.some(([word]) => text.includes(word)) || otherLetters.test(text)) return {
			ok: false,
			error: wrongAxisHint(kind)
		};
	}
	const digitsText = text.replace(/[°度]/g, " ").replace(/北纬|南纬|东经|西经/g, " ").replace(/赤道|本初子午线/g, " ").replace(/[nNeEsSwW]/g, " ").replace(/\s+/g, "");
	let number;
	if (!digitsText) {
		if (explicit === 0) number = 0;
		else return {
			ok: false,
			error: formatHint(kind, range)
		};
	} else {
		number = Number(digitsText);
		if (!Number.isFinite(number) || !Number.isInteger(number)) return {
			ok: false,
			error: `没读到整数度数，${formatHint(kind, range)}`
		};
	}
	const info = axisHemisInfo(kind, range);
	const min = kind === "lat" ? latBottom(range) : range.lonLeft;
	const max = kind === "lat" ? range.latTop : lonRight(range);
	if (explicit === null && number < 0) {
		explicit = -1;
		number = Math.abs(number);
	}
	const validate = (value) => {
		if (value % 5 !== 0) return {
			ok: false,
			error: `本棋盘每格 5°，${axisName(kind)}只能填 5° 的倍数`
		};
		if (value < min || value > max) return {
			ok: false,
			error: `超出本棋盘范围（${axisName(kind)} ${axisRangeText(kind, range)}）`
		};
		return {
			ok: true,
			value
		};
	};
	if (explicit === 0) {
		if (number !== 0) return {
			ok: false,
			error: `${zeroWord}就是 0°，不要带度数`
		};
		return validate(0);
	}
	if (number === 0) return validate(0);
	if (explicit === null) {
		if (info.both) return {
			ok: false,
			error: `本棋盘跨${zeroWord}，请写明${hemiName(kind, "N")}还是${hemiName(kind, "S")}`
		};
		return validate((info.positives ? 1 : -1) * Math.abs(number));
	}
	if (number < 0) return {
		ok: false,
		error: `“${text}”里半球和负号矛盾了，只写一种就行`
	};
	if (explicit > 0 && !info.positives) {
		const only = axisHemis(kind, range)[0];
		return {
			ok: false,
			error: `本棋盘${axisName(kind)}只有${hemiName(kind, only)}（${axisRangeText(kind, range)}）`
		};
	}
	if (explicit < 0 && !info.negatives) {
		const only = axisHemis(kind, range)[0];
		return {
			ok: false,
			error: `本棋盘${axisName(kind)}只有${hemiName(kind, only)}（${axisRangeText(kind, range)}）`
		};
	}
	return validate(explicit * number);
}
/** 把落点格式化成记录文本：`南纬30° 西经45°` / `赤道 本初子午线`。 */
function formatMove(lat, lon) {
	return `${formatLatCn(lat)} ${formatLonCn(lon)}`;
}
/**
* 随机取一个合法坐标，供"电脑"演示落子提示使用（AI 自己按棋力选点，
* 这里只用于给学生展示坐标读法）。
*/
function formatRowCol(row, col, range) {
	const axes = buildAxes(range);
	return formatMove(axes.lats[row], axes.lons[col]);
}
/**
* 下拉框里那一列"等间隔"的度数：本棋盘该轴上出现过的度数**绝对值**，升序去重。
*
* 为什么取绝对值、半球另配一个选择器？因为窗口永远是"从南到北 / 从西到东"连续排布的，
* 于是 |度数| 必然是一条 0,5,10,… 的连续等差数列（本棋盘每格 5°）—— 学生看到的下拉列表
* 自然就是等间隔的；而"这个交点在北纬还是南纬"是另一半要考的东西，拆成第二个选择器
* 才不会顺手把答案一起送出去。
*
* 跨 0° 线时同一个绝对值会出现两次（如 +5° 与 −5°），所以这里必须去重：
* latTop=65 的窗口里 |度数| 只有 14 个，而不是 15 条格线。
*/
function axisDegreeOptions(kind, range) {
	const axes = buildAxes(range);
	const values = kind === "lat" ? axes.lats : axes.lons;
	const seen = /* @__PURE__ */ new Set();
	for (const value of values) seen.add(Math.abs(value));
	return [...seen].sort((a, b) => a - b);
}
/**
* 把下拉框的两个选择（度数 + 半球）合成为一句**手动输入也能识别的文本**。
*
* 这里刻意复用 parseDegreeInput 的文本格式，而不是另写一条"直接算行列"的捷径：
* 两条输入路径共用同一套校验，下拉框就永远不可能放行一个手动输入会被判错的坐标，
* 也不会出现"同一个交点，换个输入方式结果不一样"这种只能靠人肉记的差异。
*/
function composeDegreeInput(kind, degree, hemi) {
	if (degree === null) return "";
	if (degree === 0) return zeroName(kind);
	return `${hemiName(kind, hemi)}${degree}°`;
}
/**
* 下拉框里半球的默认值：取本轴**实际存在**的第一个半球。
*
* 不固定写 N / E —— 单半球棋盘的默认值若写反，学生第一次点"确认并落子"必定吃一个错，
* 而真正的考点（跨 0° 线时必须自己判断南北）丝毫不受影响：那种棋盘两个半球都存在，
* 默认北纬，学生想去南边就得自己切过去。
*/
function defaultHemi(kind, range) {
	const list = axisHemis(kind, range);
	if (list.length > 0) return list[0];
	return kind === "lat" ? "N" : "E";
}
//#endregion
exports.DEFAULT_HIDE_MODE = DEFAULT_HIDE_MODE;
exports.DEG_STEP = DEG_STEP;
exports.GRID = GRID;
exports.HIDE_MODES = HIDE_MODES;
exports.LAT_TOPS = LAT_TOPS;
exports.LON_LEFTS = LON_LEFTS;
exports.SPAN = SPAN;
exports.axisDegreeOptions = axisDegreeOptions;
exports.axisHemiText = axisHemiText;
exports.axisHemis = axisHemis;
exports.axisHemisInfo = axisHemisInfo;
exports.axisName = axisName;
exports.axisRangeText = axisRangeText;
exports.buildAxes = buildAxes;
exports.colOfLon = colOfLon;
exports.composeDegreeInput = composeDegreeInput;
exports.defaultHemi = defaultHemi;
exports.formatAxis = formatAxis;
exports.formatLatCn = formatLatCn;
exports.formatLatCompact = formatLatCompact;
exports.formatLonCn = formatLonCn;
exports.formatLonCompact = formatLonCompact;
exports.formatMove = formatMove;
exports.formatRowCol = formatRowCol;
exports.hemiLetter = hemiLetter;
exports.hemiName = hemiName;
exports.hemiOptions = hemiOptions;
exports.labelCount = labelCount;
exports.labelIndices = labelIndices;
exports.latBottom = latBottom;
exports.lonRight = lonRight;
exports.parseDegreeInput = parseDegreeInput;
exports.randomBoardRange = randomBoardRange;
exports.rowOfLat = rowOfLat;
exports.sampleInput = sampleInput;
exports.zeroIndex = zeroIndex;
exports.zeroName = zeroName;
