/**
 * 经纬度五子棋 · 纯逻辑层
 *
 * 棋盘几何：由 BoardSpec（每轴格线数 + 每格度数）决定，每局只随机平移窗口位置。
 *
 * v1.2.0 起有三档尺寸，**每格一律 5°**，变大只体现在"覆盖的地球范围变大"：
 *   小 15×15 → 跨度 70°   还能整块落在北纬或南纬，也可能跨赤道
 *   中 19×19 → 跨度 90°   恰好一个半球；纬度窗口只有 90°N…0° 这 19 档
 *   大 25×25 → 跨度 120°  超过一个半球，纬度上**必然跨赤道**（下沿最深到 90°S 时上沿是 30°N）
 *
 * 为什么不靠"把每格改小"来变大：这个游戏练的是**数格子读坐标**。
 * 每格度数一改，"两条线之间是几度"就变了形，学生上一局学会的步长下一局不成立；
 * 而"覆盖范围变大"只是把同样的读数练习铺到更大的地球上，步长不变。
 *
 * 四象限：窗口可以整块落在北纬 / 南纬 / 东经 / 西经，也可以跨赤道、跨本初子午线。
 * 支撑这件事的是一条不变式 —— **`latTop` 永远是窗口最北的一条纬线、`lonLeft` 永远是最西的一条经线**，
 * 于是 row = (latTop - lat) / degStep、col = (lon - lonLeft) / degStep 对带符号的值天然成立。
 * 这就是为什么棋盘几何完全不需要为南纬 / 西经做特殊分支：只要窗口始终"从南到北、
 * 从西到东"排列，坐标映射就与半球无关。窗口平移与半球归属是**正交**的两件事。
 *
 * 同理，坐标的"解析"与"落子"也正交：解析出的永远是带符号的度数，
 * 落子只关心它是不是 degStep 的倍数、在不在窗口内。
 *
 * ⚠ 所有对外函数都把 spec 放在**末尾且可选**，默认小盘 —— v1.0.0 起的调用与 165 项
 *   回归一个字都不用改。加尺寸这件事不应该顺带把老接口全掀一遍。
 */

/** 一张棋盘的几何规格：每轴格线数 + 相邻格线度数差。 */
export interface BoardSpec {
  grid: number;
  degStep: number;
}

export type BoardSizeId = "small" | "medium" | "large";

/**
 * 三档棋盘。跨度 = (格线数 − 1) × 每格度数，见 span()。
 * 中盘选 19（而不是 17 或 21）是为了让跨度正好 90°：一格不多一格不少地覆盖一个半球。
 */
export const BOARD_SIZES: {
  id: BoardSizeId;
  label: string;
  spec: BoardSpec;
  hint: string;
}[] = [
  {
    id: "small",
    label: "小",
    spec: { grid: 15, degStep: 5 },
    hint: "15×15，跨 70°。可能整块落在北纬或南纬，也可能跨赤道"
  },
  {
    id: "medium",
    label: "中",
    spec: { grid: 19, degStep: 5 },
    hint: "19×19，跨 90°——恰好一个半球那么大，读坐标要走更远"
  },
  {
    id: "large",
    label: "大",
    spec: { grid: 25, degStep: 5 },
    hint: "25×25，跨 120°——超过一个半球，纬度上必然跨赤道，考全局读图"
  }
];

export const DEFAULT_BOARD_SIZE: BoardSizeId = "small";

export function specOf(id: BoardSizeId): BoardSpec {
  const found = BOARD_SIZES.find((item) => item.id === id);
  return found ? found.spec : BOARD_SIZES[0].spec;
}

/** 小盘就是 v1.0.0 以来那一档，也是所有函数的默认规格。 */
export const SMALL_SPEC: BoardSpec = BOARD_SIZES[0].spec;

/** 每条轴的格线数量（小盘 15×15 交点）。保留导出：v1.0.0 起的旧调用与回归读它。 */
export const GRID = SMALL_SPEC.grid;

/** 相邻两条格线的度数差（小盘每格 5°）。 */
export const DEG_STEP = SMALL_SPEC.degStep;

/** 窗口跨度：gr 条格线之间有 gr − 1 个间隔。 */
export function span(spec: BoardSpec = SMALL_SPEC): number {
  return spec.degStep * (spec.grid - 1);
}

/** 小盘跨度（70°）。 */
export const SPAN = span(SMALL_SPEC);

export interface BoardRange {
  /** 窗口最北的纬线（数值最大）。 */
  latTop: number;
  /** 窗口最西的经线（数值最小）。 */
  lonLeft: number;
}

function steps(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  if (step > 0) {
    for (let v = from; v <= to; v += step) out.push(v);
  } else {
    for (let v = from; v >= to; v += step) out.push(v);
  }
  return out;
}

/**
 * 纬度窗口上沿的可选值：90°N 一路到 (跨度 − 90)°S。
 *
 * 下界由"窗口最南不越过 90°S"反推（小盘 90−70=20，于是到 20°S）。
 * 小盘恰好覆盖三种情形：整块在北纬 / 跨赤道 / 整块在南纬；
 * 跨度一旦 ≥ 90°，南纬那档就消失了 —— 这是几何决定的，不是取舍。
 */
export function latTops(spec: BoardSpec = SMALL_SPEC): number[] {
  return steps(90, -90 + span(spec), -spec.degStep);
}

/**
 * 经度窗口左沿的可选值：180°W 一路到 (180 − 跨度)°E。
 * 上界这样定是为了让右沿恰好落在 180°E —— 窗口永不跨越 180° 经线，
 * 否则"左沿数值最小"这条不变式会在换日线上断裂。
 */
export function lonLefts(spec: BoardSpec = SMALL_SPEC): number[] {
  return steps(-180, 180 - span(spec), spec.degStep);
}

/** 小盘的窗口枚举（v1.0.0 起就有，保留导出）。 */
export const LAT_TOPS: number[] = latTops(SMALL_SPEC);
export const LON_LEFTS: number[] = lonLefts(SMALL_SPEC);

export function randomBoardRange(
  rand: () => number = Math.random,
  spec: BoardSpec = SMALL_SPEC
): BoardRange {
  const pick = (list: number[]): number => {
    const index = Math.floor(rand() * list.length);
    return list[Math.min(list.length - 1, Math.max(0, index))];
  };
  return { latTop: pick(latTops(spec)), lonLeft: pick(lonLefts(spec)) };
}

export function latBottom(range: BoardRange, spec: BoardSpec = SMALL_SPEC): number {
  return range.latTop - span(spec);
}

export function lonRight(range: BoardRange, spec: BoardSpec = SMALL_SPEC): number {
  return range.lonLeft + span(spec);
}

export function buildAxes(
  range: BoardRange,
  spec: BoardSpec = SMALL_SPEC
): { lats: number[]; lons: number[] } {
  return {
    lats: Array.from({ length: spec.grid }, (_, index) => range.latTop - index * spec.degStep),
    lons: Array.from({ length: spec.grid }, (_, index) => range.lonLeft + index * spec.degStep)
  };
}

/** 纬度 → 行号（0 = 最北）。 */
export function rowOfLat(lat: number, range: BoardRange, spec: BoardSpec = SMALL_SPEC): number {
  return (range.latTop - lat) / spec.degStep;
}

/** 经度 → 列号（0 = 最西）。 */
export function colOfLon(lon: number, range: BoardRange, spec: BoardSpec = SMALL_SPEC): number {
  return (lon - range.lonLeft) / spec.degStep;
}

/* ===================== 半球 ===================== */

export type LatHemi = "N" | "S";
export type LonHemi = "E" | "W";
export type Hemi = LatHemi | LonHemi;

export type AxisKind = "lat" | "lon";

/**
 * 某条轴上"实际出现"的半球（只统计非零格线）。
 * 0° 既不算 N 也不算 S，它在任何窗口里都放行 —— 见 parseDegreeInput。
 */
export function axisHemis(kind: AxisKind, range: BoardRange, spec: BoardSpec = SMALL_SPEC): Hemi[] {
  const out: Hemi[] = [];
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
export function axisHemisInfo(
  kind: AxisKind,
  range: BoardRange,
  spec: BoardSpec = SMALL_SPEC
): { positives: boolean; negatives: boolean; both: boolean } {
  const positives = kind === "lat" ? range.latTop > 0 : lonRight(range, spec) > 0;
  const negatives = kind === "lat" ? latBottom(range, spec) < 0 : range.lonLeft < 0;
  return { positives, negatives, both: positives && negatives };
}

/** 轴标签上"0° 线"所处的格线序号；窗口不含 0° 线时为 null。 */
export function zeroIndex(
  kind: AxisKind,
  range: BoardRange,
  spec: BoardSpec = SMALL_SPEC
): number | null {
  const raw = kind === "lat" ? range.latTop / spec.degStep : -range.lonLeft / spec.degStep;
  if (!Number.isInteger(raw)) return null;
  return raw >= 0 && raw < spec.grid ? raw : null;
}

/** 0° 线的名称：赤道 / 本初子午线。 */
export function zeroName(kind: AxisKind): string {
  return kind === "lat" ? "赤道" : "本初子午线";
}

/* ===================== 格式化 ===================== */

/** 棋盘轴标签用紧凑写法：`30°N` / `30°S` / `0°`。 */
export function formatLatCompact(lat: number): string {
  if (lat === 0) return "0°";
  return `${Math.abs(lat)}°${lat < 0 ? "S" : "N"}`;
}

export function formatLonCompact(lon: number): string {
  if (lon === 0) return "0°";
  return `${Math.abs(lon)}°${lon < 0 ? "W" : "E"}`;
}

/** 面板与记录用中文写法：`北纬30°` / `赤道`。 */
export function formatLatCn(lat: number): string {
  if (lat === 0) return "赤道";
  return `${lat < 0 ? "南纬" : "北纬"}${Math.abs(lat)}°`;
}

export function formatLonCn(lon: number): string {
  if (lon === 0) return "本初子午线";
  return `${lon < 0 ? "西经" : "东经"}${Math.abs(lon)}°`;
}

export function formatAxis(kind: AxisKind, value: number, style: "compact" | "cn"): string {
  if (kind === "lat") return style === "cn" ? formatLatCn(value) : formatLatCompact(value);
  return style === "cn" ? formatLonCn(value) : formatLonCompact(value);
}

/** 读数：`南纬5°—北纬65°`，含 0° 时用"赤道 / 本初子午线"代替。 */
export function axisRangeText(kind: AxisKind, range: BoardRange, spec: BoardSpec = SMALL_SPEC): string {
  const min = kind === "lat" ? latBottom(range, spec) : range.lonLeft;
  const max = kind === "lat" ? range.latTop : lonRight(range, spec);
  return `${formatAxis(kind, min, "cn")}—${formatAxis(kind, max, "cn")}`;
}

export function axisName(kind: AxisKind): string {
  return kind === "lat" ? "纬度" : "经度";
}

/** 半球名：南纬 / 北纬 / 西经 / 东经。 */
export function hemiName(kind: AxisKind, hemi: Hemi): string {
  if (kind === "lat") return hemi === "N" ? "北纬" : "南纬";
  return hemi === "E" ? "东经" : "西经";
}

export function hemiLetter(kind: AxisKind, hemi: Hemi): string {
  return hemi;
}

/** 某条轴上可选的两个半球，顺序按中文习惯：北纬在前、东经在前。 */
export function hemiOptions(kind: AxisKind): Hemi[] {
  return kind === "lat" ? ["N", "S"] : ["E", "W"];
}

/** 本棋盘该轴的半球读数，例如 `只有北纬` / `北纬与南纬都有`。 */
export function axisHemiText(kind: AxisKind, range: BoardRange, spec: BoardSpec = SMALL_SPEC): string {
  const list = axisHemis(kind, range, spec);
  if (list.length === 1) return `只有${hemiName(kind, list[0])}`;
  // 按中文习惯排：北纬在前、东经在前（"北纬南纬""东经西经"），
  // 而不是按数值从小到大（南纬—北纬）的区间读法 —— 这里是并列枚举，不是范围。
  return `${hemiName(kind, list[0])}与${hemiName(kind, list[1])}都有`;
}

/* ===================== 标签隐藏 ===================== */

export type HideMode = "full" | "half" | "anchor";

export const DEFAULT_HIDE_MODE: HideMode = "half";

export const HIDE_MODES: { id: HideMode; label: string; hint: string }[] = [
  { id: "full", label: "全部标出", hint: "每条格线都标出度数，先讲一遍" },
  { id: "half", label: "隔一标一", hint: "每 2 条标 1 条，另一条自己数" },
  { id: "anchor", label: "只留锚点", hint: "只标最北/中间/最南 3 条" }
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
export function labelIndices(
  mode: HideMode,
  zero: number | null,
  grid: number = GRID,
  stride = 1
): boolean[] {
  const step = Math.max(1, Math.round(stride));
  const show = Array.from({ length: grid }, (_, index) => {
    if (mode === "full") return index % step === 0;
    if (mode === "half") return index % (2 * step) === 0;
    return index === 0 || index === Math.floor((grid - 1) / 2) || index === grid - 1;
  });
  if (zero !== null && zero >= 0 && zero < grid) {
    show[zero] = true;
  }
  return show;
}

export function labelCount(
  mode: HideMode,
  zero: number | null,
  grid: number = GRID,
  stride = 1
): number {
  return labelIndices(mode, zero, grid, stride).filter(Boolean).length;
}

/* ===================== 坐标输入解析 ===================== */

export type ParseResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

const LAT_CN: [string, 1 | -1][] = [
  ["北纬", 1],
  ["北", 1],
  ["南纬", -1],
  ["南", -1]
];

const LON_CN: [string, 1 | -1][] = [
  ["东经", 1],
  ["东", 1],
  ["西经", -1],
  ["西", -1]
];

/** 该轴"写错另一轴半球"时要提示的措辞，例如纬度写了东经。 */
function wrongAxisHint(kind: AxisKind): string {
  return kind === "lat"
    ? "纬度要用北纬(N) 或 南纬(S)，不能写东经/西经"
    : "经度要用东经(E) 或 西经(W)，不能写北纬/南纬";
}

function formatHint(kind: AxisKind, range: BoardRange, spec: BoardSpec = SMALL_SPEC): string {
  return `请按“${sampleInput(kind, range, "cn", spec)}”的格式填写`;
}

/** 取窗口正中那条格线做示例，保证示例本身就是本棋盘上的合法坐标。 */
export function sampleInput(
  kind: AxisKind,
  range: BoardRange,
  style: "cn" | "compact" = "cn",
  spec: BoardSpec = SMALL_SPEC
): string {
  const axes = buildAxes(range, spec);
  const mid = Math.floor((spec.grid - 1) / 2);
  const value = kind === "lat" ? axes.lats[mid] : axes.lons[mid];
  return formatAxis(kind, value, style);
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
export function parseDegreeInput(
  raw: string,
  kind: AxisKind,
  range: BoardRange,
  spec: BoardSpec = SMALL_SPEC
): ParseResult {
  const text = (raw ?? "").trim();
  if (!text) {
    return { ok: false, error: `请填写${axisName(kind)}` };
  }

  const ownLetters = kind === "lat" ? /[nNsS]/ : /[eEwW]/;
  const otherLetters = kind === "lat" ? /[eEwW]/ : /[nNsS]/;
  const ownTable = kind === "lat" ? LAT_CN : LON_CN;
  const otherTable = kind === "lat" ? LON_CN : LAT_CN;
  const zeroWord = zeroName(kind);

  let explicit: 1 | -1 | 0 | null = null;
  if (text.includes(zeroWord)) {
    explicit = 0;
  }
  if (explicit === null) {
    for (const [word, sign] of ownTable) {
      if (text.includes(word)) {
        explicit = sign;
        break;
      }
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
    // 写错轴要单独拦：中文写法（"东经"）和字母写法（"E"）都得认出来，
    // 否则会被后面"剥离半球词"那一步悄悄吃掉、当成合法数字放过。
    const otherWord = otherTable.some(([word]) => text.includes(word));
    if (otherWord || otherLetters.test(text)) {
      return { ok: false, error: wrongAxisHint(kind) };
    }
  }

  const digitsText = text
    .replace(/[°度]/g, " ")
    .replace(/北纬|南纬|东经|西经/g, " ")
    .replace(/赤道|本初子午线/g, " ")
    .replace(/[nNeEsSwW]/g, " ")
    .replace(/\s+/g, "");

  let number: number;
  if (!digitsText) {
    // 只写了"赤道 / 本初子午线"也算合法写法。
    if (explicit === 0) {
      number = 0;
    } else {
      return { ok: false, error: formatHint(kind, range, spec) };
    }
  } else {
    number = Number(digitsText);
    if (!Number.isFinite(number) || !Number.isInteger(number)) {
      return { ok: false, error: `没读到整数度数，${formatHint(kind, range, spec)}` };
    }
  }

  const info = axisHemisInfo(kind, range, spec);
  const min = kind === "lat" ? latBottom(range, spec) : range.lonLeft;
  const max = kind === "lat" ? range.latTop : lonRight(range, spec);

  // 裸负号（"-30"）本身就是半球声明，按负半球处理。
  // 不能 `Math.abs` 一抹了事 —— 那会把"南纬30°"悄悄变成"北纬30°"，
  // 学生写错半球却落了子，比报错糟糕得多。
  if (explicit === null && number < 0) {
    explicit = -1;
    number = Math.abs(number);
  }

  const validate = (value: number): ParseResult => {
    if (value % spec.degStep !== 0) {
      return {
        ok: false,
        error: `本棋盘每格 ${spec.degStep}°，${axisName(kind)}只能填 ${spec.degStep}° 的倍数`
      };
    }
    if (value < min || value > max) {
      return {
        ok: false,
        error: `超出本棋盘范围（${axisName(kind)} ${axisRangeText(kind, range, spec)}）`
      };
    }
    return { ok: true, value };
  };

  // 写明了"赤道 / 本初子午线"，就不能再带非零度数。
  if (explicit === 0) {
    if (number !== 0) {
      return { ok: false, error: `${zeroWord}就是 0°，不要带度数` };
    }
    return validate(0);
  }

  // 0° 在任何窗口都放行，不必写半球。
  if (number === 0) {
    return validate(0);
  }

  if (explicit === null) {
    if (info.both) {
      return {
        ok: false,
        error: `本棋盘跨${zeroWord}，请写明${hemiName(kind, "N")}还是${hemiName(kind, "S")}`
      };
    }
    const sign = info.positives ? 1 : -1;
    return validate(sign * Math.abs(number));
  }

  if (number < 0) {
    return {
      ok: false,
      error: `“${text}”里半球和负号矛盾了，只写一种就行`
    };
  }
  // 半球名必须从本轴**实际存在**的半球推出来。
  // 曾经这里按纬度硬编码成 S / N，于是经度棋盘（东经110°—180°）填西经时
  // 会提示"只有西经"——把要告诉学生的那件事说反了。
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
export function formatMove(lat: number, lon: number): string {
  return `${formatLatCn(lat)} ${formatLonCn(lon)}`;
}

/**
 * 随机取一个合法坐标，供"电脑"演示落子提示使用（AI 自己按棋力选点，
 * 这里只用于给学生展示坐标读法）。
 */
export function formatRowCol(
  row: number,
  col: number,
  range: BoardRange,
  spec: BoardSpec = SMALL_SPEC
): string {
  const axes = buildAxes(range, spec);
  return formatMove(axes.lats[row], axes.lons[col]);
}

/* ===================== 下拉选择输入 ===================== */

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
export function axisDegreeOptions(
  kind: AxisKind,
  range: BoardRange,
  spec: BoardSpec = SMALL_SPEC
): number[] {
  const axes = buildAxes(range, spec);
  const values = kind === "lat" ? axes.lats : axes.lons;
  const seen = new Set<number>();
  for (const value of values) {
    seen.add(Math.abs(value));
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * 把下拉框的两个选择（度数 + 半球）合成为一句**手动输入也能识别的文本**。
 *
 * 这里刻意复用 parseDegreeInput 的文本格式，而不是另写一条"直接算行列"的捷径：
 * 两条输入路径共用同一套校验，下拉框就永远不可能放行一个手动输入会被判错的坐标，
 * 也不会出现"同一个交点，换个输入方式结果不一样"这种只能靠人肉记的差异。
 */
export function composeDegreeInput(
  kind: AxisKind,
  degree: number | null,
  hemi: Hemi
): string {
  if (degree === null) return "";
  // 0° 不分半球，直接写成"赤道 / 本初子午线"，避免出现"北纬0°"这种别扭写法。
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
export function defaultHemi(kind: AxisKind, range: BoardRange, spec: BoardSpec = SMALL_SPEC): Hemi {
  const list = axisHemis(kind, range, spec);
  if (list.length > 0) return list[0];
  return kind === "lat" ? "N" : "E";
}
