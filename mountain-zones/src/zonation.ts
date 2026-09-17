/**
 * 山地垂直自然带：把"纬度 + 海拔 + 季节"换成一条可解释的带谱。
 *
 * 这一版是 **纯模型**，不依赖任何渲染/几何 —— 二维剖面的像素位置由 world2d.ts 负责，
 * 这里只管"某海拔属于哪个自然带、植被多密、产流多少"。好处是它能被 Node 直接单测。
 *
 * 模型（教学用简化，但方向与课本一致）：
 * - 纬度决定山麓的气温：`T0(lat) = 28 − 0.4·|lat|`（℃）
 *   → 0° ≈ 28℃、30° ≈ 16℃、40° ≈ 12℃、60° ≈ 4℃，正好让山麓自然带依次落在
 *     常绿阔叶林 / 落叶阔叶林 / 针叶林上。
 * - 气温直减率 0.6℃/100m：`T(lat,h) = T0(lat) − 0.006·h`（**年均温**）
 * - 各自然带由年均温区间界定；**基带（山麓带）就等于同纬度的水平自然带** ——
 *   这是"垂直地带性是水平地带性的缩影"这条结论的来源。
 *   带谱**不随季节改换**（同一海拔全年是同一个自然带，北京山麓不会夏天变成长绿阔叶林），
 *   季节体现在三处：雪线升降、林线随之升降、植被的季相（落叶/枯黄/积雪）。
 * - 雪线用经验式 `5000·cos^1.2(lat)`（0°≈4900m、45°≈3200m、60°≈2200m），
 *   再叠加季节位移。雪线优先于温度带（雪线之上统一是冰雪带）。
 */

export const DEG = Math.PI / 180;

/** 气温直减率 ℃/m */
export const LAPSE = 0.006;

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type SeasonId = (typeof SEASONS)[number];

export const SEASON_LABEL: Record<SeasonId, string> = {
  spring: "春",
  summer: "夏",
  autumn: "秋",
  winter: "冬"
};

/** 季节的等效气温偏移（℃）：只用于读数与"积雪埋没"深度的换算，不参与带谱划分 */
export const SEASON_DT: Record<SeasonId, number> = {
  spring: 1,
  summer: 3,
  autumn: 0,
  winter: -4
};

/** 雪线的季节位移（米）：夏季抬升、冬季下降 */
export const SEASON_SNOW_SHIFT: Record<SeasonId, number> = {
  spring: 120,
  summer: 380,
  autumn: -60,
  winter: -620
};

export type BeltId =
  | "evergreen"
  | "deciduous"
  | "mixed"
  | "conifer"
  | "meadow"
  | "desert"
  | "snow";

export interface BeltDef {
  id: BeltId;
  /** 完整名称（带谱图与读数用） */
  name: string;
  /** 短名（面板 chip 用） */
  short: string;
  /** 该带的年均温区间 [from, to) */
  tempFrom: number;
  tempTo: number;
  /** 植被覆盖度（0~1），越往上越稀疏 —— 也是"山越高植被越稀疏"的量化来源 */
  cover: number;
  /** 是否有乔木（用来算林线） */
  tree: boolean;
  /** 典型植被的文字描述（图鉴用 —— 去掉物种精灵后，知识靠这段文字承载） */
  typical: string;
}

/** 从山麓到山顶的顺序 */
export const BELTS: BeltDef[] = [
  {
    id: "evergreen", name: "亚热带常绿阔叶林带", short: "常绿阔叶林",
    tempFrom: 15, tempTo: 99, cover: 0.95, tree: true,
    typical: "樟、栲、木荷等常绿阔叶树，林冠浓密、终年不落叶，林下蕨类与藤本繁茂"
  },
  {
    id: "deciduous", name: "温带落叶阔叶林带", short: "落叶阔叶林",
    tempFrom: 8, tempTo: 15, cover: 0.85, tree: true,
    typical: "栎、桦、杨、槭等，秋冬落叶、春季萌发，季相变化非常明显"
  },
  {
    id: "mixed", name: "针阔混交林带", short: "针阔混交林",
    tempFrom: 4, tempTo: 8, cover: 0.72, tree: true,
    typical: "红松、冷杉与栎类、桦木混生，针叶树与阔叶树交错分布"
  },
  {
    id: "conifer", name: "寒温带针叶林带", short: "针叶林",
    tempFrom: 0, tempTo: 4, cover: 0.6, tree: true,
    typical: "云杉、冷杉、落叶松，树冠尖塔形、终年常绿，林相整齐而郁闭"
  },
  {
    id: "meadow", name: "高山草甸带", short: "高山草甸",
    tempFrom: -6, tempTo: 0, cover: 0.3, tree: false,
    typical: "嵩草、苔草、龙胆、绿绒蒿等，植株低矮贴地以抗风抗寒，花期集中而绚烂"
  },
  {
    id: "desert", name: "高寒荒漠·流石滩", short: "高寒荒漠",
    tempFrom: -99, tempTo: -6, cover: 0.07, tree: false,
    typical: "垫状点地梅、雪莲、红景天等垫状植物，地表大片裸露砾石与冻土"
  }
];

export const BELT_DEF: Record<BeltId, BeltDef> = BELTS.reduce(
  (acc, b) => {
    acc[b.id] = b;
    return acc;
  },
  {} as Record<BeltId, BeltDef>
);

/** 冰雪带不是"植被带"，单独给一条定义，方便带谱图统一处理 */
export const SNOW_DEF: BeltDef = {
  id: "snow",
  name: "积雪冰川带",
  short: "积雪冰川",
  tempFrom: -99,
  tempTo: -99,
  cover: 0,
  tree: false,
  typical: "终年积雪，冰川发育，粒雪与裸冰覆盖，无高等植物定居"
};

export function beltDef(id: BeltId): BeltDef {
  return id === "snow" ? SNOW_DEF : BELT_DEF[id];
}

/** ---------- 气温 / 雪线 ---------- */

/** 山麓（海拔 0）的年均温 */
export function seaLevelTemp(lat: number): number {
  return 28 - 0.4 * Math.abs(lat);
}

/** 某纬度、某海拔的**年均温**（℃）。带谱按它划分，所以全年稳定 */
export function tempAt(lat: number, altitude: number): number {
  return seaLevelTemp(lat) - LAPSE * altitude;
}

/** 某纬度、某海拔、某季节的气温（℃）——仅用于面板读数 */
export function tempAtSeason(lat: number, altitude: number, season: SeasonId): number {
  return tempAt(lat, altitude) + SEASON_DT[season];
}

/**
 * **多年平均雪线**（米）：只随纬度变化，不含季节位移。
 *
 * 为什么必须单独拎出来：垂直自然带谱是"多年气候稳定下来"的产物，
 * 所以带谱（`bandsFor`）要用它。早先 `bandsFor` 直接用 `snowline(lat, season)`，
 * 结果夏季 4200m 的山没有积雪带、冬季凭空多出一条积雪带 —— 切一下季节整条带谱就变了，
 * 和界面上那句"带谱本身不随季节改换"自相矛盾。真机回归把这条断言抓了出来。
 *
 * 季节性的升降仍然保留在 `snowline()` 里，它负责的是**地表当下有没有雪覆盖**
 * （渲染铺白、积雪埋没、产流判定），而不是"这条带叫什么"。
 */
export function snowlineAnnual(lat: number): number {
  const latClamped = Math.min(80, Math.abs(lat));
  return Math.max(0, 5000 * Math.pow(Math.cos(latClamped * DEG), 1.2));
}

/** 雪线海拔（米）：多年平均雪线 + 季节位移（夏季抬升 380m、冬季下降 620m） */
export function snowline(lat: number, season: SeasonId): number {
  return Math.max(0, snowlineAnnual(lat) + SEASON_SNOW_SHIFT[season]);
}

/** 林线（米）= 乔木能生长的最高海拔 = 针叶林带上限，且不得高于雪线 */
export function treeline(lat: number, season: SeasonId): number {
  const t = seaLevelTemp(lat) / LAPSE;
  return Math.max(0, Math.min(t, snowline(lat, season) - 60));
}

/** 冬季积雪会把雪线以下这么深的一条带埋掉（米） */
export function snowBurialDepth(season: SeasonId): number {
  // 60 m/℃ 时这条带只有 240 m 高、在屏幕上宽 3 art px，学生根本看不出"雪埋草甸"；
  // 放到 100 m/℃（冬季 400 m）才看得见半截埋在雪里的高山草甸。
  return Math.max(0, -SEASON_DT[season]) * 100;
}

/** 某点的自然带（带谱全年稳定；冰雪带按雪线单独判定） */
export function beltAt(lat: number, altitude: number, season: SeasonId): BeltId {
  if (altitude >= snowline(lat, season)) {
    return "snow";
  }
  const t = tempAt(lat, altitude);
  for (const b of BELTS) {
    if (t >= b.tempFrom && t < b.tempTo) {
      return b.id;
    }
  }
  return "desert";
}

/** ---------- 带谱（剖面） ---------- */

export interface Band {
  belt: BeltId;
  /** 起始海拔（米） */
  from: number;
  /** 结束海拔（米，不含） */
  to: number;
}

/**
 * 把 0~peakAltitude 切成若干连续的带，返回山麓 → 山顶的顺序。
 *
 * ⚠️ 积雪冰川带的下界用 `snowlineAnnual()`（**多年平均**雪线），不是 `snowline(lat, season)`。
 * 用后者会让带谱随季节变形 —— 详见 `snowlineAnnual` 的注释。
 */
export function bandsFor(lat: number, season: SeasonId, peakAltitude: number): Band[] {
  if (peakAltitude <= 0) {
    return [];
  }
  // 反解年均温窗口得到海拔窗口：h = (T0 − T) / LAPSE
  // （与逐米扫描等价 —— 测试里用扫描版做交叉验证）
  const shift = seaLevelTemp(lat);
  const snowStart = Math.min(peakAltitude, snowlineAnnual(lat));
  const out: Band[] = [];
  for (const b of BELTS) {
    const hLo = Math.max(0, (shift - b.tempTo) / LAPSE);
    const hHi = Math.min(peakAltitude, snowStart, (shift - b.tempFrom) / LAPSE);
    if (hHi - hLo <= 1e-6) {
      continue;
    }
    out.push({ belt: b.id, from: hLo, to: hHi });
  }
  if (snowStart < peakAltitude - 1e-6) {
    out.push({ belt: "snow", from: snowStart, to: peakAltitude });
  }
  return out;
}

/** 山麓基带 —— 应当等于该纬度的水平自然带 */
export function baseBelt(lat: number, season: SeasonId): BeltId {
  return beltAt(lat, 0, season);
}

/** ---------- 植被密度 ---------- */

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 某点的植被密度（0~1）= 该带覆盖度 × 带内稀疏系数 × 季节系数。
 * - 带内越接近上限越稀疏（过渡带）：这就是"山越高、植被越稀疏"的直接体现；
 * - **积雪埋没不在这里扣**：冬季雪线以下那条"埋没带"里的植被照样长着，
 *   只是渲染时被画成半埋在雪里（`PlantInst.buried`）。早期在这里乘 0.18，
 *   结果那条带的植被被压到几乎不长，学生看到的就是"冬天雪线以下忽然什么都不长"——
 *   该看见的"雪埋草甸"反而看不见了。
 */
export function densityAt(lat: number, altitude: number, season: SeasonId, peakAltitude: number): number {
  const belt = beltAt(lat, altitude, season);
  const def = beltDef(belt);
  if (def.cover <= 0) {
    return 0;
  }
  const bands = bandsFor(lat, season, Math.max(peakAltitude, altitude + 1));
  const band = bands.find((b) => b.belt === belt && altitude >= b.from && altitude < b.to);
  const span = band ? Math.max(1, band.to - band.from) : 1;
  const p = band ? Math.min(1, (altitude - band.from) / span) : 0;
  const sparse = 1 - 0.7 * smoothstep(0.45, 1, p);
  return def.cover * sparse;
}

/**
 * 产流权重（0~1）= 1 − 植被覆盖，也就是"植被越少、地表径流越强"。
 * 例外：**雪线以上降水以固态为主，不产流**（返回 0）—— 早期把雪带按"无植被裸地"处理，
 * 结果径流河源全跑到雪线以上去了（测试当场抓到）。
 */
export function runoffWeight(lat: number, altitude: number, season: SeasonId, peakAltitude: number): number {
  const belt = beltAt(lat, altitude, season);
  if (belt === "snow") {
    return 0;
  }
  return Math.max(0.05, 1 - densityAt(lat, altitude, season, peakAltitude));
}

/** ---------- 配色（地形渲染与带谱图共用，保证两处一致） ---------- */

const BELT_COLORS: Record<BeltId, Record<SeasonId, string>> = {
  evergreen: { spring: "#4a8a58", summer: "#38734c", autumn: "#417a5e", winter: "#2f6249" },
  deciduous: { spring: "#8db24c", summer: "#5e9639", autumn: "#d9a02c", winter: "#8d7d69" },
  mixed: { spring: "#57833f", summer: "#3d683c", autumn: "#857f37", winter: "#4f6050" },
  conifer: { spring: "#33613f", summer: "#2d5a42", autumn: "#2a553e", winter: "#264c3c" },
  meadow: { spring: "#96b45c", summer: "#79a34b", autumn: "#bfa552", winter: "#dce3e8" },
  desert: { spring: "#ac9d87", summer: "#a3927c", autumn: "#ac9d87", winter: "#ccd3da" },
  snow: { spring: "#f2f6fa", summer: "#f7fafd", autumn: "#eef3f8", winter: "#e4edf6" }
};

export function beltColor(belt: BeltId, season: SeasonId): string {
  return BELT_COLORS[belt][season];
}

/** 落叶阔叶林在冬季落叶（渲染与带谱图都用它决定是否画树冠） */
export function hasCanopy(belt: BeltId, season: SeasonId): boolean {
  if (belt === "deciduous" || belt === "mixed") {
    return season !== "winter";
  }
  return belt !== "snow" && belt !== "desert";
}

/** 给定山顶海拔与等高距，等高线条数（面板显示"共 N 条"） */
export function contourCount(peakAltitude: number, interval: number): number {
  if (interval <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor(peakAltitude / interval));
}
