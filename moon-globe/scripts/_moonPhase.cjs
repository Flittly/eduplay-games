Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/moonPhase.ts
/**
* 月相与月面光照的**数据层**（纯函数，无 three.js / 无 React 依赖）。
*
* 这一层是整个游戏的「唯一真相源」：三维场景的太阳光方向、右上角月相小窗的
* 盈亏形状、左右两栏的读数、以及打包脚本的指纹，全部从这里的公式推导。
* 之所以单独成模块，是因为它可以被 Node 直接 require 做单测 —— 月相这种
* 「差一个符号就整体翻转」的几何，只靠肉眼看渲染图是查不出来的。
*
* ## 坐标系（体固坐标系，全程只用这一套）
*
* 月球被地球潮汐锁定 ⇒ **近地面中心永远朝着地球**。把体固坐标系的 +Z 轴
* 定义为「近地面中心指向地球」的方向，把 +Y 定义为北极，那么按右手系
* **+X 就是月面东经方向**（东经为正）。于是：
*
* | 方向 | 含义 |
* |---|---|
* | `(0,0,1)` | 近地面中心（永远正对地球） |
* | `(1,0,0)` | 东经 90° 那个点 |
* | `(0,1,0)` | 北极 |
*
* 于是「从地球看月球」= 从 +Z 向原点看，屏幕上**北在上、东在右** ——
* 这正是天文照片里那张熟悉的正面（危海在右上、第谷环形山在下方）。
*
* ## 月龄与太阳方向
*
* 一个月里太阳在月球天空中自东向西走一圈（与地球上一样），所以
* **太阳直射点的月面经度随时间递减**。取新月那一刻直射点在远地面中心
* （经度 180°），则
*
* ```
* 直射经度 λ(月龄) = 180° − 360° × 月龄 / 朔望月
* 太阳方向        = (sin λ, 0, cos λ)
* ```
*
* 自检：月龄 0 ⇒ λ=180° ⇒ 太阳在 (0,0,−1)（月球背面，从地球看不见 ⇒ 新月）；
* 月龄 14.77 ⇒ λ=0° ⇒ 太阳在近地面中心正上方（⇒ 满月）；月龄 7.38 ⇒ λ=90°
* ⇒ 太阳在东侧（⇒ 上弦月，亮面在**右**）。
*/
/** 朔望月（天）：一次完整月相循环的周期 */
const SYNODIC_MONTH = 29.53059;
/** 半个朔望月（天）：新月 → 满月的间隔 */
const SYNODIC_HALF = SYNODIC_MONTH / 2;
/** 八个相位名，按「1/8 朔望月」等分分档，索引 = round(月龄 / 档宽) mod 8 */
const PHASE_NAMES = [
	"新月（朔）",
	"蛾眉月",
	"上弦月",
	"盈凸月",
	"满月（望）",
	"亏凸月",
	"下弦月",
	"残月"
];
/** 每一档的月相简述 —— 与 `PHASE_NAMES` 一一对应，用于右侧「控制台」的读数 */
const PHASE_NOTES = [
	"月球运行到日地之间，被照亮的一面完全背对我们，整夜看不见",
	"亮面只有细细一钩，出现在西边天空的傍晚",
	"亮面正好是右半边，正午升起、黄昏时位于正南方",
	"亮面大于一半，缺的是左侧一块，后半夜才落下",
	"月球运行到地球背对太阳的一侧，整夜可见、圆圆整整",
	"亮面大于一半，缺的是右侧一块，黄昏后才升起",
	"亮面正好是左半边，午夜升起、黎明时位于正南方",
	"亮面只剩细细一钩，出现在东边天空的黎明"
];
/** 太阳直射点月面纬度（度）。月球自转轴相对黄道只歪 1.5°，这里取 0 —— 晨昏线恰好过两极。 */
const SUBSOLAR_LAT = 0;
const DEG = Math.PI / 180;
/** 把任意月龄折回 [0, 朔望月) */
function normalizeAge(age) {
	if (!Number.isFinite(age)) return 0;
	const m = age % SYNODIC_MONTH;
	return m < 0 ? m + SYNODIC_MONTH : m;
}
/**
* 太阳直射点的月面经度（度，东经为正），值域 (−180, 180]。
* 新月时在远地面中心（180°，也就是 ±180），满月时在近地面中心（0°）。
*/
function subsolarLongitude(age) {
	let v = ((180 - 360 * normalizeAge(age) / SYNODIC_MONTH + 180) % 360 + 360) % 360 - 180;
	if (v === -180) v = 180;
	return v;
}
/** 月面 (纬度, 经度) → 体固坐标系单位向量 */
function directionFor(latDeg, lonDeg) {
	const la = latDeg * DEG;
	const lo = lonDeg * DEG;
	const c = Math.cos(la);
	return {
		x: c * Math.sin(lo),
		y: Math.sin(la),
		z: c * Math.cos(lo)
	};
}
/** 月龄 → 太阳方向的单位向量（体固坐标系） */
function sunDirection(age) {
	return directionFor(0, subsolarLongitude(age));
}
/**
* 相位角（度）：太阳—月球—地球三者的夹角。
* 0° = 满月（太阳在观测者背后），180° = 新月（太阳在月球背后）。
*/
function phaseAngle(age) {
	return Math.abs(subsolarLongitude(age));
}
/**
* 受照比例 k ∈ [0,1]：从地球看过去，月球正面被照亮的面积占比。
* `k = (1 + cos 相位角) / 2`
*/
function illumination(age) {
	return (1 + Math.cos(phaseAngle(age) * DEG)) / 2;
}
/**
* 日月角距（度）：从地球看，月球与太阳的角距离。
* 新月时与太阳同方向（0°），满月时正相反（180°）。
*/
function elongation(age) {
	return 180 - phaseAngle(age);
}
/** 是否盈（月龄不到半个朔望月 ⇒ 亮面一天比一天大） */
function isWaxing(age) {
	return normalizeAge(age) < SYNODIC_HALF;
}
/**
* 亮面出现在屏幕的哪一侧（从地球看、北在上）。
* 盈月亮面在西侧（右边），亏月亮面在东侧（左边）—— 这是北半球最常见的说法。
*/
function litSide(age) {
	return isWaxing(age) ? "right" : "left";
}
/** 月龄 → 相位档位索引（0..7，与 `PHASE_NAMES` 对齐） */
function phaseIndex(age) {
	const step = SYNODIC_MONTH / 8;
	const idx = Math.floor(normalizeAge(age) / step + .5) % 8;
	return idx < 0 ? idx + 8 : idx;
}
/** 月龄 → 月相名 */
function phaseName(age) {
	return PHASE_NAMES[phaseIndex(age)];
}
/**
* 约当农历日期（1..30）：月龄 0 对应初一，满月落在十五前后。
* 真实农历有大小月、朔的时刻也不一定在整点，所以这里只是**近似**读数。
*/
function lunarDay(age) {
	const d = Math.floor(normalizeAge(age)) + 1;
	return d > 30 ? 30 : d;
}
/** 一次算出界面上要用的全部读数 */
function phaseInfo(age) {
	const a = normalizeAge(age);
	const lon = subsolarLongitude(a);
	const i = Math.abs(lon);
	const k = (1 + Math.cos(i * DEG)) / 2;
	const idx = phaseIndex(a);
	return {
		age: a,
		subsolarLon: lon,
		phaseAngle: i,
		elongation: 180 - i,
		illumination: k,
		illuminationPct: Math.round(k * 1e3) / 10,
		name: PHASE_NAMES[idx],
		note: PHASE_NOTES[idx],
		index: idx,
		waxing: a < SYNODIC_HALF,
		side: a < 14.765295 ? "right" : "left",
		lunarDay: lunarDay(a),
		progress: a / SYNODIC_MONTH,
		sun: directionFor(0, lon)
	};
}
/** 四个关键相位的月龄（天），供「新月 / 上弦月 / 满月 / 下弦月」快捷按钮使用 */
const KEY_PHASES = [
	{
		name: "新月（朔）",
		short: "新月",
		age: 0
	},
	{
		name: "上弦月",
		short: "上弦",
		age: SYNODIC_MONTH / 4
	},
	{
		name: "满月（望）",
		short: "满月",
		age: SYNODIC_HALF
	},
	{
		name: "下弦月",
		short: "下弦",
		age: SYNODIC_MONTH * 3 / 4
	}
];
/**
* 公转方位角（度）：月龄 0（新月）时月球位于日地之间，取 0°，随月龄递增。
* 俯视黄道面时，月球由 +X 转向 −Z —— 也就是**逆时针**，与 `PhaseDiagram` 一致。
*/
function orbitAngle(age) {
	return 360 * normalizeAge(age) / SYNODIC_MONTH;
}
/** 月球在「日地月系统」里的世界坐标（`radius` 是世界单位的轨道半径） */
function orbitPosition(age, radius) {
	const p = orbitAngle(age) * DEG;
	return {
		x: radius * Math.cos(p),
		y: 0,
		z: -radius * Math.sin(p)
	};
}
/**
* 月球的**偏航角（弧度）**：潮汐锁定 ⇒ 近地面中心恒朝地球。
* 见上方推导，θ = φ − 90°。
*/
function orbitYaw(age) {
	return orbitAngle(age) * DEG - Math.PI / 2;
}
/**
* 回归年（天）。地球公转的周期。一个月里地球走 360°×29.53/365.25 ≈ 29.1° ——
* 播完一个朔望月，地日连线的方向真的会转过去将近 30°，这就是「月球公转其实比月相
* 多转一点」的来源（朔望月 > 恒星月）。
*/
const YEAR_DAYS = 365.25;
/** 把"用户拨到的月龄"换成最接近 `currentDays` 的同相位天数（地球公转因此永远连续） */
function nearestPhaseDays(monthAge, currentDays) {
	const a = normalizeAge(monthAge);
	return a + SYNODIC_MONTH * Math.round((currentDays - a) / SYNODIC_MONTH);
}
/**
* 一天自转几圈：**恒星日**（23 小时 56 分 04 秒）⇒ 366.25 圈/年，比 365.25 个太阳日多一圈。
*
* 多出来的这一圈正好抵消地球自身的公转：地球一边自转一边绕太阳走，太阳在星空背景上
* 每天东移约 1°，所以要让太阳回到同一条经线正上方，地球得**多转 1°**。
* 于是"相对太阳一天恰好一圈"= 太阳日 24 小时 —— 这就是 366.25 与 365.25 的差。
*/
const SIDEREAL_PER_DAY = 1.002737850787132;
/**
* 地球公转角（弧度）。`days` 是**累计天数**（单调）。
* 与月球公转**同向**（俯视黄道面都是逆时针）：`orbitPosition` 用 `(cos φ, 0, −sin φ)`，
* 这里也用同一函数形状。
*
* `π` 是**新月那一刻地球的方位**（任意约定，但必须定死，回归与截图才可复现）：
* 取"新月时地球在 −X" —— 于是默认月龄（上弦）时地球在画面远侧、被太阳照亮的那一面
* 正对相机（相机在 +X 一侧），一进页面看到的就是亮着的地球。
*/
function earthOrbitAngle(days) {
	return Math.PI + 2 * Math.PI * days / YEAR_DAYS;
}
/** 地球的世界位置：绕着**原点处的太阳**转，`radius` 是地日距离（世界单位），`days` 是累计天数。 */
function earthOrbitPosition(days, radius) {
	const p = earthOrbitAngle(days);
	return {
		x: radius * Math.cos(p),
		y: 0,
		z: -radius * Math.sin(p)
	};
}
/**
* 「地月系 → 世界系」的搬运角 β（弧度）。
*
* 月球的地月几何全部在「地球在原点、太阳在 +X」这个**本地系**里算（`orbitPosition` /
* `orbitYaw`，v1.0.0 定下、被回归钉死的约定，v1.2.0 原样保留）。地球公转后，本地系的
* +X 必须**跟着转到"地球→太阳"的方向**上，月相几何才不会错 —— 这个转角就是 β：
*
*   地球→太阳方向 = −ê(ψ) = `(cos(ψ+π), 0, −sin(ψ+π))` = `R_y(ψ+π)` 作用在 +X 上
*   ⇒ **β = ψ + π**。
*
* 于是月球的世界位置 = `地心 + R_y(β)·orbitPosition(月龄)`、
* 世界姿态角 = `β + orbitYaw(月龄)`（同轴旋转直接相加）。
* 月相是月龄的函数这件事由此保住：新月时月球确实在日地之间。
*/
function earthFrameYaw(days) {
	return earthOrbitAngle(days) + Math.PI;
}
/**
* 地球自转角（弧度）= 累计天数 × 一天 366.25/365.25 圈（**真实速度**）。
*
* v1.3.0 及以前这里是"一个朔望月一圈"（放慢了 29.5 倍），理由是怕大陆闪成一片。
* v1.4.0 按用户要求改成真实速度：「我们的目的是为了能够看到月球的变换，
* 地球自转速度很快也没有关系，但是一定要足够真实」。
* 现在播完一个朔望月，地球正好自转 29.5 圈（29.5 个昼夜）—— 与月相的关系也就是真的了：
* 一个朔望月 = 29.5 个地球日。
*/
function earthSpinAngle(days) {
	return 2 * Math.PI * days * SIDEREAL_PER_DAY;
}
/**
* 真实天体数据（NASA 公布值，单位 km）。**只用于界面标注与自检，不参与渲染。**
* 单独留一份的意义：界面要能写出"真实是多少"，数据层要能算出"压缩了多少倍"。
*/
const REAL_LUNAR = {
	earthR: 6371,
	moonR: 1737.4,
	sunR: 696e3,
	moonDist: 384400,
	sunDist: 1496e5
};
/**
* 「日地月系统」的场景尺度（世界单位，**月球半径 = 1**；v1.2.0 起为日心布局）。
*
* v1.1.0 的取舍：**天体之间的大小比保持真实，距离压缩，太阳额外缩小。**
*
* 为什么不能全都真实 —— 以月球半径为 1 折算，真实的地月距离是 221.3、地日距离约 8.6 万。
* 真按 221.3 画，相机要退到 500 开外，月球在 1120×740 的屏幕上只有约 2 个像素；
* 太阳（真实半径 400.6）更糟：既大得吞掉整个场景，又远得不在同一个视锥里。
*
* 于是：
*  - `earthR` 严格取真实比值（6371 / 1737.4 = 3.667）—— 这是学生最容易看错的一件事，
*    地球直径是月球的 3.7 倍。旧版画成 1.35 倍，看上去像"两个差不多大的球"；
*  - `moonDist` / `sunDist` 是压缩后的距离，压缩倍数见 `ORBIT_COMPRESSION`；
*  - `sunR` 是**唯一一个不按真实比例**的天体半径，左栏提示里有明确说明。
*
* ⚠ 这三个量（天体大小、地月距离、地日距离）**不可能同时按真实比例画进一幅图**，
*   这不是偷懒，是几何事实。压缩倍数要显示给学生看，比假装它是真的诚实。
*
* v1.2.0 的两处改动（都来自用户反馈）：
*  - **日心布局**：太阳挪到原点，`sunDist` 变成"地球公转轨道半径"（36 → 46）——
*    名字不改：它始终是"地日距离"，只是现在地球绕着太阳走、不再钉在原点；
*  - **太阳加大**：1.7 → 5（v1.4.0 再 → 13.5，理由见字段注释）。真实比值是 400.6，
*    画面里 13.5/3.667 ≈ 3.7 倍地球半径 —— 学生要一眼读出"太阳是个巨大的球"，
*    再由压缩表说明真实比例。
*/
const ORBIT_SCENE = {
	moonR: 1,
	earthR: REAL_LUNAR.earthR / REAL_LUNAR.moonR,
	/**
	* 太阳半径。**v1.4.0：5 → 13.5。**
	*
	* 原因不是"想画大点"，而是取景必须换口径：v1.4.0 起地球**真的会走完一整圈**
	* （真实比例：一个月 29.1°，一个模拟年约 2.2 分钟，见 `earthOrbitAngle`），
	* 镜头必须一次性把**整圈轨道**装进画面，否则地球播着播着就走出画外。
	* 取景口径换成"与地球位置无关的包络圈"后，相机从约 60 退到约 171，
	* 所有天体在屏幕上按 1/2.85 缩小。
	*
	* 而 v1.2.0 用户明确要求过「太阳可以再远一点，然后体积可以更大」——
	* 于是把太阳的**世界**半径放大同样的倍数（×2.7），屏幕上仍是 60px 上下（实测）。
	* 顺带把它与地球的比例从 1.36:1 拉到 3.7:1，比原来更接近真实的 109:1。
	*
	* ⚠ 这个数还有第二重身份：它是「日地月系统」视角的**装饰尺度标定**。
	*   `MoonGlobe.tsx` 的 `ORBIT_DECO = SUN_RADIUS / 5` 用它把箭杆粗细、虚线间隔
	*   这些"按世界单位写死"的装饰一起放大 —— 那些量不跟着取景缩放，
	*   就会掉到 1 像素以下（箭杆 0.1 半径 ⇒ 0.45px）直接看不见。
	*   改这里之前先看 `ORBIT_DECO` 的注释。天体半径不能跟着放（那是教学比值）。
	*/
	sunR: 13.5,
	moonDist: 15,
	sunDist: 46
};
/**
* 场景相对真实值压缩了多少倍 —— 界面文案与自检都读它，避免文案里手写数字对不上。
*
* 注意这三个倍数注定差很多：天体大小不动、只压距离，距离的倍数自然远大于 1。
*/
const ORBIT_COMPRESSION = {
	/** 地月距离压缩倍数（真实 ≈221.3 月球半径 → 15） */
	moonDist: REAL_LUNAR.moonDist / REAL_LUNAR.moonR / ORBIT_SCENE.moonDist,
	/** 地日距离（＝地球公转轨道半径）压缩倍数（真实 ≈8.6 万月球半径 → 46） */
	sunDist: REAL_LUNAR.sunDist / REAL_LUNAR.moonR / ORBIT_SCENE.sunDist,
	/** 太阳半径缩小倍数（真实 ≈400.6 月球半径 → 13.5） */
	sunRadius: REAL_LUNAR.sunR / REAL_LUNAR.moonR / ORBIT_SCENE.sunR
};
/**
* 月面站点清单。顺序即右栏列表顺序：先地形，后着陆点。
*
* ⚠ 中国探月各站点坐标一律用任务公布值 / 行星数据系统（PDS）收录值，
*   不要凭印象改 —— 这些数字会被拿去做教学，也会被回归判据直接断言。
*   嫦娥三号/四号/五号/六号坐标来源：NASA PDS Geosciences（Chang'e Missions）；
*   嫦娥一号受控撞月点为任务公布值。**嫦娥七号 2026-09 尚未发射，不作站点**。
*/
const MOON_FEATURES = [
	{
		name: "雨海",
		en: "Mare Imbrium",
		lat: 32.8,
		lon: -15.6,
		kind: "mare"
	},
	{
		name: "澄海",
		en: "Mare Serenitatis",
		lat: 28,
		lon: 17.5,
		kind: "mare"
	},
	{
		name: "静海",
		en: "Mare Tranquillitatis",
		lat: 8.5,
		lon: 30.4,
		kind: "mare"
	},
	{
		name: "危海",
		en: "Mare Crisium",
		lat: 17,
		lon: 59.1,
		kind: "mare"
	},
	{
		name: "风暴洋",
		en: "Oceanus Procellarum",
		lat: 18.4,
		lon: -57.4,
		kind: "mare"
	},
	{
		name: "第谷环形山",
		en: "Tycho",
		lat: -43.3,
		lon: -11.4,
		kind: "crater"
	},
	{
		name: "哥白尼环形山",
		en: "Copernicus",
		lat: 9.6,
		lon: -20.1,
		kind: "crater"
	},
	{
		name: "南极-艾特肯盆地",
		en: "S. Pole–Aitken",
		lat: -53,
		lon: -169,
		kind: "basin",
		far: true
	},
	{
		name: "阿波罗11号着陆点",
		en: "Apollo 11",
		lat: .7,
		lon: 23.5,
		kind: "site",
		mission: "阿波罗11号"
	},
	{
		name: "嫦娥一号撞月点",
		en: "Chang'e-1",
		lat: -1.5,
		lon: 52.36,
		kind: "cn",
		mission: "嫦娥一号"
	},
	{
		name: "嫦娥三号着陆点",
		en: "Chang'e-3",
		lat: 44.1214,
		lon: -19.5117,
		kind: "cn",
		mission: "嫦娥三号 · 玉兔号"
	},
	{
		name: "嫦娥四号着陆点",
		en: "Chang'e-4",
		lat: -45.5,
		lon: 177.6,
		kind: "cn",
		far: true,
		mission: "嫦娥四号 · 玉兔二号"
	},
	{
		name: "嫦娥五号着陆点",
		en: "Chang'e-5",
		lat: 43.0576,
		lon: -51.9161,
		kind: "cn",
		mission: "嫦娥五号"
	},
	{
		name: "嫦娥六号着陆点",
		en: "Chang'e-6",
		lat: -41.6385,
		lon: -153.9852,
		kind: "cn",
		far: true,
		mission: "嫦娥六号"
	}
];
/** 地形类别 → 标注点颜色（与月球影像的灰调拉开，保证小尺寸下也能分辨） */
const FEATURE_COLORS = {
	mare: "#7fb2e5",
	crater: "#ffd76a",
	site: "#ff6b3d",
	basin: "#c9a0ff",
	cn: "#ff2d55"
};
/** 类别中文名（弹窗徽章与列表分组用） */
const FEATURE_KIND_NAMES = {
	mare: "月海",
	crater: "环形山",
	basin: "盆地",
	site: "着陆点",
	cn: "中国探月"
};
/** 是否属于「探月着陆点」这一类（有任务背景、可点开看介绍） */
function isLandingSite(f) {
	return f.kind === "site" || f.kind === "cn";
}
//#endregion
exports.FEATURE_COLORS = FEATURE_COLORS;
exports.FEATURE_KIND_NAMES = FEATURE_KIND_NAMES;
exports.KEY_PHASES = KEY_PHASES;
exports.MOON_FEATURES = MOON_FEATURES;
exports.ORBIT_COMPRESSION = ORBIT_COMPRESSION;
exports.ORBIT_SCENE = ORBIT_SCENE;
exports.PHASE_NAMES = PHASE_NAMES;
exports.PHASE_NOTES = PHASE_NOTES;
exports.REAL_LUNAR = REAL_LUNAR;
exports.SIDEREAL_PER_DAY = SIDEREAL_PER_DAY;
exports.SUBSOLAR_LAT = SUBSOLAR_LAT;
exports.SYNODIC_HALF = SYNODIC_HALF;
exports.SYNODIC_MONTH = SYNODIC_MONTH;
exports.YEAR_DAYS = YEAR_DAYS;
exports.directionFor = directionFor;
exports.earthFrameYaw = earthFrameYaw;
exports.earthOrbitAngle = earthOrbitAngle;
exports.earthOrbitPosition = earthOrbitPosition;
exports.earthSpinAngle = earthSpinAngle;
exports.elongation = elongation;
exports.illumination = illumination;
exports.isLandingSite = isLandingSite;
exports.isWaxing = isWaxing;
exports.litSide = litSide;
exports.lunarDay = lunarDay;
exports.nearestPhaseDays = nearestPhaseDays;
exports.normalizeAge = normalizeAge;
exports.orbitAngle = orbitAngle;
exports.orbitPosition = orbitPosition;
exports.orbitYaw = orbitYaw;
exports.phaseAngle = phaseAngle;
exports.phaseIndex = phaseIndex;
exports.phaseInfo = phaseInfo;
exports.phaseName = phaseName;
exports.subsolarLongitude = subsolarLongitude;
exports.sunDirection = sunDirection;
