Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/geo.ts
/**
* 三档棋盘。跨度 = (格线数 − 1) × 每格度数，见 span()。
* 中盘选 19（而不是 17 或 21）是为了让跨度正好 90°：一格不多一格不少地覆盖一个半球。
*/
const BOARD_SIZES = [
	{
		id: "small",
		label: "小",
		spec: {
			grid: 15,
			degStep: 5
		},
		hint: "15×15，跨 70°。可能整块落在北纬或南纬，也可能跨赤道"
	},
	{
		id: "medium",
		label: "中",
		spec: {
			grid: 19,
			degStep: 5
		},
		hint: "19×19，跨 90°——恰好一个半球那么大，读坐标要走更远"
	},
	{
		id: "large",
		label: "大",
		spec: {
			grid: 25,
			degStep: 5
		},
		hint: "25×25，跨 120°——超过一个半球，纬度上必然跨赤道，考全局读图"
	}
];
const DEFAULT_BOARD_SIZE = "small";
function specOf(id) {
	const found = BOARD_SIZES.find((item) => item.id === id);
	return found ? found.spec : BOARD_SIZES[0].spec;
}
/** 小盘就是 v1.0.0 以来那一档，也是所有函数的默认规格。 */
const SMALL_SPEC = BOARD_SIZES[0].spec;
/** 每条轴的格线数量（小盘 15×15 交点）。保留导出：v1.0.0 起的旧调用与回归读它。 */
const GRID = SMALL_SPEC.grid;
/** 相邻两条格线的度数差（小盘每格 5°）。 */
const DEG_STEP = SMALL_SPEC.degStep;
/** 窗口跨度：gr 条格线之间有 gr − 1 个间隔。 */
function span(spec = SMALL_SPEC) {
	return spec.degStep * (spec.grid - 1);
}
/** 小盘跨度（70°）。 */
const SPAN = span(SMALL_SPEC);
function steps(from, to, step) {
	const out = [];
	if (step > 0) for (let v = from; v <= to; v += step) out.push(v);
	else for (let v = from; v >= to; v += step) out.push(v);
	return out;
}
/**
* 纬度窗口上沿的可选值：90°N 一路到 (跨度 − 90)°S。
*
* 下界由"窗口最南不越过 90°S"反推（小盘 90−70=20，于是到 20°S）。
* 小盘恰好覆盖三种情形：整块在北纬 / 跨赤道 / 整块在南纬；
* 跨度一旦 ≥ 90°，南纬那档就消失了 —— 这是几何决定的，不是取舍。
*/
function latTops(spec = SMALL_SPEC) {
	return steps(90, -90 + span(spec), -spec.degStep);
}
/**
* 经度窗口左沿的可选值：180°W 一路到 (180 − 跨度)°E。
* 上界这样定是为了让右沿恰好落在 180°E —— 窗口永不跨越 180° 经线，
* 否则"左沿数值最小"这条不变式会在换日线上断裂。
*/
function lonLefts(spec = SMALL_SPEC) {
	return steps(-180, 180 - span(spec), spec.degStep);
}
/** 小盘的窗口枚举（v1.0.0 起就有，保留导出）。 */
const LAT_TOPS = latTops(SMALL_SPEC);
const LON_LEFTS = lonLefts(SMALL_SPEC);
function randomBoardRange(rand = Math.random, spec = SMALL_SPEC) {
	const pick = (list) => {
		const index = Math.floor(rand() * list.length);
		return list[Math.min(list.length - 1, Math.max(0, index))];
	};
	return {
		latTop: pick(latTops(spec)),
		lonLeft: pick(lonLefts(spec))
	};
}
function latBottom(range, spec = SMALL_SPEC) {
	return range.latTop - span(spec);
}
function lonRight(range, spec = SMALL_SPEC) {
	return range.lonLeft + span(spec);
}
function buildAxes(range, spec = SMALL_SPEC) {
	return {
		lats: Array.from({ length: spec.grid }, (_, index) => range.latTop - index * spec.degStep),
		lons: Array.from({ length: spec.grid }, (_, index) => range.lonLeft + index * spec.degStep)
	};
}
/** 纬度 → 行号（0 = 最北）。 */
function rowOfLat(lat, range, spec = SMALL_SPEC) {
	return (range.latTop - lat) / spec.degStep;
}
/** 经度 → 列号（0 = 最西）。 */
function colOfLon(lon, range, spec = SMALL_SPEC) {
	return (lon - range.lonLeft) / spec.degStep;
}
/**
* 某条轴上"实际出现"的半球（只统计非零格线）。
* 0° 既不算 N 也不算 S，它在任何窗口里都放行 —— 见 parseDegreeInput。
*/
function axisHemis(kind, range, spec = SMALL_SPEC) {
	const out = [];
	if (kind === "lat") {
		if (range.latTop > 0) out.push("N");
		if (latBottom(range, spec) < 0) out.push("S");
	} else {
		if (lonRight(range, spec) > 0) out.push("E");
		if (range.lonLeft < 0) out.push("W");
	}
	return out;
}
/**
* 轴是否跨过 0° 线（赤道 / 本初子午线）—— 跨线时裸数字有歧义，必须写明半球。
* 注意"跨线"与"包含 0°"不是一回事：窗口 70°S—0° 包含赤道但整块在南纬。
*/
function axisHemisInfo(kind, range, spec = SMALL_SPEC) {
	const positives = kind === "lat" ? range.latTop > 0 : lonRight(range, spec) > 0;
	const negatives = kind === "lat" ? latBottom(range, spec) < 0 : range.lonLeft < 0;
	return {
		positives,
		negatives,
		both: positives && negatives
	};
}
/** 轴标签上"0° 线"所处的格线序号；窗口不含 0° 线时为 null。 */
function zeroIndex(kind, range, spec = SMALL_SPEC) {
	const raw = kind === "lat" ? range.latTop / spec.degStep : -range.lonLeft / spec.degStep;
	if (!Number.isInteger(raw)) return null;
	return raw >= 0 && raw < spec.grid ? raw : null;
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
function axisRangeText(kind, range, spec = SMALL_SPEC) {
	const min = kind === "lat" ? latBottom(range, spec) : range.lonLeft;
	const max = kind === "lat" ? range.latTop : lonRight(range, spec);
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
function axisHemiText(kind, range, spec = SMALL_SPEC) {
	const list = axisHemis(kind, range, spec);
	if (list.length === 1) return `只有${hemiName(kind, list[0])}`;
	return `${hemiName(kind, list[0])}与${hemiName(kind, list[1])}都有`;
}
const DEFAULT_HIDE_MODE = "half";
const HIDE_MODES = [
	{
		id: "full",
		label: "全部标出",
		hint: "每条格线都标出度数，先讲一遍"
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
* `grid` 缺省 15（小盘）。`stride` 是"每隔几条标一条"的**额外倍率**：
* 缺省 1 表示不额外稀疏化；圆形棋盘上格子被球面投影压窄时会给 2，见 GeoGomoku 的标签间距估算。
*
* 无论隐藏到哪一档，**0° 线（赤道 / 本初子午线）永远标出** —— 它是学生唯一可以
* 无条件信任的锚点，把它藏掉会把"数格子"变成"猜格子"。所以：
*   half   实际 8 或 9 条（索引 0,2,4,…,grid−1 再加上 0° 线）
*   anchor 实际 3 或 4 条（索引 0,中,grid−1 再加上 0° 线）
*
* 三档尺寸的格线数都是奇数，所以 `索引 % 2 === 0` 天然含末条；
* 万一以后加了偶数格线的规格，末条要单独补上。
*/
function labelIndices(mode, zero, grid = GRID, stride = 1) {
	const step = Math.max(1, Math.round(stride));
	const show = Array.from({ length: grid }, (_, index) => {
		if (mode === "full") return index % step === 0;
		if (mode === "half") return index % (2 * step) === 0;
		return index === 0 || index === Math.floor((grid - 1) / 2) || index === grid - 1;
	});
	if (zero !== null && zero >= 0 && zero < grid) show[zero] = true;
	return show;
}
function labelCount(mode, zero, grid = GRID, stride = 1) {
	return labelIndices(mode, zero, grid, stride).filter(Boolean).length;
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
function formatHint(kind, range, spec = SMALL_SPEC) {
	return `请按“${sampleInput(kind, range, "cn", spec)}”的格式填写`;
}
/** 取窗口正中那条格线做示例，保证示例本身就是本棋盘上的合法坐标。 */
function sampleInput(kind, range, style = "cn", spec = SMALL_SPEC) {
	const axes = buildAxes(range, spec);
	const mid = Math.floor((spec.grid - 1) / 2);
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
function parseDegreeInput(raw, kind, range, spec = SMALL_SPEC) {
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
			error: formatHint(kind, range, spec)
		};
	} else {
		number = Number(digitsText);
		if (!Number.isFinite(number) || !Number.isInteger(number)) return {
			ok: false,
			error: `没读到整数度数，${formatHint(kind, range, spec)}`
		};
	}
	const info = axisHemisInfo(kind, range, spec);
	const min = kind === "lat" ? latBottom(range, spec) : range.lonLeft;
	const max = kind === "lat" ? range.latTop : lonRight(range, spec);
	if (explicit === null && number < 0) {
		explicit = -1;
		number = Math.abs(number);
	}
	const validate = (value) => {
		if (value % spec.degStep !== 0) return {
			ok: false,
			error: `本棋盘每格 ${spec.degStep}°，${axisName(kind)}只能填 ${spec.degStep}° 的倍数`
		};
		if (value < min || value > max) return {
			ok: false,
			error: `超出本棋盘范围（${axisName(kind)} ${axisRangeText(kind, range, spec)}）`
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
		const only = axisHemis(kind, range, spec)[0];
		return {
			ok: false,
			error: `本棋盘${axisName(kind)}只有${hemiName(kind, only)}（${axisRangeText(kind, range, spec)}）`
		};
	}
	if (explicit < 0 && !info.negatives) {
		const only = axisHemis(kind, range, spec)[0];
		return {
			ok: false,
			error: `本棋盘${axisName(kind)}只有${hemiName(kind, only)}（${axisRangeText(kind, range, spec)}）`
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
function formatRowCol(row, col, range, spec = SMALL_SPEC) {
	const axes = buildAxes(range, spec);
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
function axisDegreeOptions(kind, range, spec = SMALL_SPEC) {
	const axes = buildAxes(range, spec);
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
function defaultHemi(kind, range, spec = SMALL_SPEC) {
	const list = axisHemis(kind, range, spec);
	if (list.length > 0) return list[0];
	return kind === "lat" ? "N" : "E";
}
//#endregion
exports.BOARD_SIZES = BOARD_SIZES;
exports.DEFAULT_BOARD_SIZE = DEFAULT_BOARD_SIZE;
exports.DEFAULT_HIDE_MODE = DEFAULT_HIDE_MODE;
exports.DEG_STEP = DEG_STEP;
exports.GRID = GRID;
exports.HIDE_MODES = HIDE_MODES;
exports.LAT_TOPS = LAT_TOPS;
exports.LON_LEFTS = LON_LEFTS;
exports.SMALL_SPEC = SMALL_SPEC;
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
exports.latTops = latTops;
exports.lonLefts = lonLefts;
exports.lonRight = lonRight;
exports.parseDegreeInput = parseDegreeInput;
exports.randomBoardRange = randomBoardRange;
exports.rowOfLat = rowOfLat;
exports.sampleInput = sampleInput;
exports.span = span;
exports.specOf = specOf;
exports.zeroIndex = zeroIndex;
exports.zeroName = zeroName;
