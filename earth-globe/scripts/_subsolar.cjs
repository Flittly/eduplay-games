Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/subsolar.ts
/**
* 太阳直射点回归运动（左侧 2D 曲线）的纯逻辑层。
*
* 三个概念在这里被拆开，别混：
*  ① **纬度**：`declinationForNu(nu)` —— 与 3D 引擎里 `declinationForNu` **同一条公式**
*     （`sinδ = −sinε·cos(ν+ψ)`，ε=23.44°、ψ=14°）。两边必须一致，否则左侧曲线上的点
*     与画面里光柱打到的那个纬度会差出一个可见的角度。
*  ② **时间**：`nuToDay` / `dayToNu` —— 由二分二至**真实日期**锚点做分段线性插值。
*     分段线性不是偷懒：四段的天数不一样（75/93/93/90 天），这正对应「夏半年 186 天 >
*     冬半年 179 天」，本身就是这节课要讲的东西。
*     注意这一步**与引擎无关**：引擎只认 ν（公转位置），日期只是给横轴加一层人话标注，
*     所以横轴主刻度仍然是 ν，日期出现在读数与说明里。
*  ③ **画布**：`nuToX` / `declToY` / `buildSubsolarChart` —— 纯映射，不碰 React、不碰 DOM。
*
* 本模块不依赖 three.js，可以被打成 CJS 直接跑 Node 回归。
*/
const DEG = Math.PI / 180;
/** 黄赤交角：北回归线 = 23.44°N，南回归线 = −23.44° */
const EARTH_TILT = 23.44;
const TILT_RAD = EARTH_TILT * DEG;
/** 地轴在世界坐标里的方位角，与引擎的 AXIS_AZIMUTH 相同 */
const AXIS_AZIMUTH = 14;
/** 由公转位置 ν（0~360°）求太阳直射点纬度（+ 为北纬，− 为南纬） */
function declinationForNu(nuDeg) {
	return -Math.asin(Math.sin(TILT_RAD) * Math.cos((nuDeg + AXIS_AZIMUTH) * DEG)) / DEG;
}
/**
* 日期锚点：`day` 是年内第几天（1 月 1 日 = 0）。
* 前 5 条来自二分二至的真实日期 + 近日点（≈1 月 5 日）；第 6 条是闭环用的次年年初。
* 春分→秋分 186 天、秋分→春分 179 天，与「夏半年比冬半年长」一致。
*/
const DATE_ANCHORS = [
	{
		nu: 0,
		day: 4
	},
	{
		nu: 76,
		day: 79
	},
	{
		nu: 166,
		day: 172
	},
	{
		nu: 256,
		day: 265
	},
	{
		nu: 346,
		day: 355
	},
	{
		nu: 360,
		day: 369
	}
];
/** 一年的天数（曲线横轴走完 ν 0→360° 对应的天数） */
const YEAR_DAYS = DATE_ANCHORS[DATE_ANCHORS.length - 1].day - DATE_ANCHORS[0].day;
/**
* 公转位置 → 年内天数（夹在锚点区间内，不外推）。
* ⚠ 端点：ν=360° 与 ν=0° 是**同一天**，但这里**不能折回 0** —— 折回会让曲线右端从
* 368 天直接跳回 4 天，读出来是「一年走完又回到年初」，而函数本身就不再单调了。
* 只有真正超出一圈（ν≥360 或为负）才做取模。
*/
function nuToDay(nuDeg) {
	let nu = (nuDeg % 360 + 360) % 360;
	if (nu === 0 && nuDeg >= 360) nu = 360;
	for (let i = 0; i < DATE_ANCHORS.length - 1; i += 1) {
		const a = DATE_ANCHORS[i];
		const b = DATE_ANCHORS[i + 1];
		if (nu >= a.nu && nu <= b.nu) {
			const t = b.nu === a.nu ? 0 : (nu - a.nu) / (b.nu - a.nu);
			return a.day + t * (b.day - a.day);
		}
	}
	return DATE_ANCHORS[0].day;
}
/** 年内天数 → 公转位置（nuToDay 的反函数） */
function dayToNu(day) {
	const d = Math.min(Math.max(day, DATE_ANCHORS[0].day), DATE_ANCHORS[DATE_ANCHORS.length - 1].day);
	for (let i = 0; i < DATE_ANCHORS.length - 1; i += 1) {
		const a = DATE_ANCHORS[i];
		const b = DATE_ANCHORS[i + 1];
		if (d >= a.day && d <= b.day) {
			const t = b.day === a.day ? 0 : (d - a.day) / (b.day - a.day);
			return a.nu + t * (b.nu - a.nu);
		}
	}
	return 0;
}
/** 年内第几天 → 「3月21日」（MONTH_DAYS 按平年） */
const MONTH_DAYS = [
	31,
	28,
	31,
	30,
	31,
	30,
	31,
	31,
	30,
	31,
	30,
	31
];
function formatDayOfYear(day) {
	let d = Math.round((day % 365 + 365) % 365);
	let month = 0;
	while (d >= MONTH_DAYS[month]) {
		d -= MONTH_DAYS[month];
		month += 1;
		if (month >= 12) month = 0;
	}
	return `${month + 1}月${d + 1}日`;
}
const SEASON_MARKS = [
	{
		key: "chunfen",
		label: "春分",
		date: "3月21日",
		nu: 76
	},
	{
		key: "xiazhi",
		label: "夏至",
		date: "6月22日",
		nu: 166
	},
	{
		key: "qiufen",
		label: "秋分",
		date: "9月23日",
		nu: 256
	},
	{
		key: "dongzhi",
		label: "冬至",
		date: "12月22日",
		nu: 346
	}
].map((item) => {
	const raw = declinationForNu(item.nu);
	return {
		...item,
		decl: Math.abs(raw) < 1e-9 ? 0 : raw
	};
});
/** 当前公转位置离哪个节气最近（返回 key 与角距离，单位：度） */
function nearestSeason(nuDeg) {
	let best = SEASON_MARKS[0];
	let bestD = 999;
	for (const mark of SEASON_MARKS) {
		const d = Math.abs(((nuDeg - mark.nu + 540) % 360 + 360) % 360 - 180);
		if (d < bestD) {
			bestD = d;
			best = mark;
		}
	}
	return {
		mark: best,
		distance: bestD
	};
}
/**
* 图表版式的**单一真源**：组件与回归测试都从这里取，避免「测试里另抄一份尺寸」——
* 抄一份的下场是改了组件尺寸而测试还在按旧尺寸判「不重叠」，等于没测。
* 宽度 172 是量出来的：左栏 204px 减掉面板内边距 20 与边框 6 正好 172 ⇒ 图表按 1:1 渲染，
* 刻度字不会被等比缩小糊掉。高度 118 = 绘图区 92 + 上留白 10 + 刻度行 16。
*/
const SUBSOLAR_SVG = {
	w: 172,
	h: 118
};
/** 绘图区：左侧 32px 留白给参考线文字（23.5°N 之类），下方 16px 给节气刻度 */
const SUBSOLAR_PLOT = {
	x: 32,
	y: 10,
	w: 128,
	h: 92
};
const SUBSOLAR_TICK_FONT = 8;
const SUBSOLAR_REF_FONT = 7.5;
/** 公转位置 → 画布 x（0° 在最左、360° 在最右） */
function nuToX(nuDeg, box) {
	return box.x + nuDeg / 360 * box.w;
}
/**
* 直射点纬度 → 画布 y。
* y 轴范围**正好取 ±黄赤交角**：曲线与南北回归线相切（课本上就是这个画法），
* 参考线因此落在绘图区的上下边缘上，所以文字标注一律放到左侧留白里，不压在线上。
*/
function declToY(decl, box) {
	return box.y + (EARTH_TILT - decl) / (2 * EARTH_TILT) * box.h;
}
/** 采样步长：1° 一步 ⇒ 361 点，折线在 134px 宽上每段 0.37px，肉眼已是光滑曲线 */
const SAMPLE_STEP_DEG = 1;
/** 文字宽度估算（中日韩字符按 1em 全角、其余按 0.58em），用于「刻度标签不重叠」的判定 */
function labelWidth(text, fontSize) {
	let w = 0;
	for (const ch of text) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? fontSize : fontSize * .58;
	return w;
}
/** 曲线上的点：与「当前直射点」用的是同一个 declinationForNu，天然不会两级背离 */
function subsolarPoints(box, stepDeg = 1) {
	const pts = [];
	for (let nu = 0; nu <= 360 + 1e-9; nu += stepDeg) {
		const decl = declinationForNu(nu);
		pts.push({
			nu,
			decl,
			x: nuToX(nu, box),
			y: declToY(decl, box)
		});
	}
	return pts;
}
/** 由数据点拼 SVG 路径（保留 2 位小数就够：134px 宽的图上 0.01px 无意义） */
function pathFromPoints(points, precision = 2) {
	if (points.length === 0) return "";
	const f = (v) => v.toFixed(precision);
	let d = `M${f(points[0].x)},${f(points[0].y)}`;
	for (let i = 1; i < points.length; i += 1) d += `L${f(points[i].x)},${f(points[i].y)}`;
	return d;
}
function buildSubsolarChart(box, tickFont = 8) {
	const points = subsolarPoints(box);
	return {
		box,
		points,
		path: pathFromPoints(points),
		refLines: [
			{
				key: "tropicN",
				label: "23.5°N",
				decl: EARTH_TILT,
				y: declToY(EARTH_TILT, box)
			},
			{
				key: "equator",
				label: "0°",
				decl: 0,
				y: declToY(0, box)
			},
			{
				key: "tropicS",
				label: "23.5°S",
				decl: -23.44,
				y: declToY(-23.44, box)
			}
		],
		ticks: SEASON_MARKS.map((mark) => ({
			key: mark.key,
			label: mark.label,
			date: mark.date,
			nu: mark.nu,
			x: nuToX(mark.nu, box),
			y: declToY(mark.decl, box),
			halfWidth: labelWidth(mark.label, tickFont) / 2
		}))
	};
}
/** 当前直射点的画布坐标 */
function currentPoint(nuDeg, box) {
	const decl = declinationForNu(nuDeg);
	return {
		nu: nuDeg,
		decl,
		x: nuToX(nuDeg, box),
		y: declToY(decl, box)
	};
}
/** 画布 x → 公转位置（点曲线上任意一点就跳到那一天用），结果夹在 0~360° */
function xToNu(x, box) {
	const t = (x - box.x) / box.w;
	return Math.min(360, Math.max(0, t * 360));
}
//#endregion
exports.DATE_ANCHORS = DATE_ANCHORS;
exports.EARTH_TILT = EARTH_TILT;
exports.SAMPLE_STEP_DEG = SAMPLE_STEP_DEG;
exports.SEASON_MARKS = SEASON_MARKS;
exports.SUBSOLAR_PLOT = SUBSOLAR_PLOT;
exports.SUBSOLAR_REF_FONT = SUBSOLAR_REF_FONT;
exports.SUBSOLAR_SVG = SUBSOLAR_SVG;
exports.SUBSOLAR_TICK_FONT = SUBSOLAR_TICK_FONT;
exports.YEAR_DAYS = YEAR_DAYS;
exports.buildSubsolarChart = buildSubsolarChart;
exports.currentPoint = currentPoint;
exports.dayToNu = dayToNu;
exports.declToY = declToY;
exports.declinationForNu = declinationForNu;
exports.formatDayOfYear = formatDayOfYear;
exports.labelWidth = labelWidth;
exports.nearestSeason = nearestSeason;
exports.nuToDay = nuToDay;
exports.nuToX = nuToX;
exports.pathFromPoints = pathFromPoints;
exports.subsolarPoints = subsolarPoints;
exports.xToNu = xToNu;
