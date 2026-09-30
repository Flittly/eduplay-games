/**
 * 《捕鱼达人 · 洋流版》数据层
 * ============================
 *
 * 本文件是**洋流清单的唯一真相源**。教学纪律见 docs/fishing-master-ocean-current-design.md
 * 第零条铁律：**先分类，再按教学重要性分层**。
 *
 * 三层结构（`CurrentTier`）：
 *   - core      ① 重点层：教材熟记环流。要求能认名称、能判性质、能判方向，详细讲。
 *   - extension ② 拓展层：教材体系外但真实存在、图 4-24 上有箭头的洋流。
 *                **只要求认得名字**，不考方向，界面上标「拓展」角标。
 *   - reference ③ 了解层：教材讲「洋流对地理环境的影响」时点名的用法，只作例证。
 *
 * ⚠️ 三层是**互斥**的：同一条洋流只能落在一层。`assertTiering()` 会在构建期强制这一点。
 * 分层不是"删掉教材没有的"，而是"让复习火力集中在考点上"。
 */

/* ------------------------------------------------------------------ *
 * 一、类型
 * ------------------------------------------------------------------ */

/** 洋流教学层级。新增洋流时必须显式声明——不写层级就编译不过。 */
export type CurrentTier = "core" | "extension" | "reference";

/** 寒暖性质。对应图 4-24：红＝暖流（低纬→高纬）、蓝＝寒流（高纬→低纬）。 */
export type CurrentKind = "warm" | "cold";

/** 半球。判方向题（向高纬 / 向低纬）要按半球换措辞。 */
export type Hemisphere = "N" | "S";

/** 流向。用于第二问的"拖箭头"判定与结算文案。 */
export type FlowDirection =
  | "west-to-east" // 自西向东
  | "east-to-west" // 自东向西
  | "equator-ward" // 由较高纬流向赤道（寒流常见）
  | "pole-ward"; // 由赤道流向较高纬（暖流常见）

/** 品质星级 1~5。由地理成因推出，不是我编的（见 QUALITY_RULES）。 */
export type Quality = 1 | 2 | 3 | 4 | 5;

/** 鱼群。`name` 用教材/常见名，`icon` 是 SVG 符号 id。 */
export interface FishSchool {
  name: string;
  icon: string;
}

/** 经纬度点。经度东正西负、纬度北正南负。 */
export interface LonLat {
  lon: number;
  lat: number;
}

/** 一条洋流的完整数据。 */
export interface Current {
  /** 稳定 id，作为数据主键；改名不改 id。 */
  id: string;
  /** 正式名称（图 4-24 上的写法）。 */
  name: string;
  /** 教学层级。**必填**——这是分层落到类型上的关键。 */
  tier: CurrentTier;
  /** 寒流 / 暖流。 */
  kind: CurrentKind;
  hemisphere: Hemisphere;
  /** 所属大洋（用于图鉴分组与大方向判定）。 */
  ocean: "pacific" | "atlantic" | "indian" | "arctic";
  /** 语料上的流向描述，如「自南向北 · 沿南美西岸北上」。 */
  flowText: string;
  /** 枚举化的流向，判定第二问用。 */
  direction: FlowDirection;
  /** 品质星级。 */
  quality: Quality;
  /** 鱼的种类。 */
  fish: FishSchool[];
  /** 成因说明——解释卡正文，**必须来自教材三条依据之一**。 */
  reason: string;
  /**
   * 洋流的**真实地理锚点**（经纬度）。
   *
   * ⚠️ 这是全项目唯一的坐标真相源。v0.1.0 起，画布像素由 `proj.ts` 从经纬度
   * 现算，**不再手写归一化坐标**——上一版手写坐标导致太平洋洋流整片错位
   * （加利福尼亚寒流被画到大西洋、阿拉斯加暖流被画到欧洲），见 proj.ts 顶部。
   */
  anchor: LonLat;
  /**
   * 箭头的起止点（真实经纬度）。起 = 上游、止 = 下游，箭头指止点。
   *
   * 允许跨 ±180° 日界线：渲染层用 `splitAtAntimeridian` 自动拆段，
   * 数据层照真实经度写即可，**不需要手工拆成两段**。
   */
  arrow: { lon1: number; lat1: number; lon2: number; lat2: number };
  /**
   * 只有重点层才有"教材"来源标注；拓展层写明"课标未要求熟记"。
   * 解释卡的脚注直接读这个字段。
   */
  note: string;
}

/** 图鉴分组：一个闭合环流。 */
export interface GyreGroup {
  id: string;
  name: string;
  /** 按流向顺序排列的洋流 id。凑齐 = 图鉴上这一环流闭环。 */
  members: string[];
  /** 环流方向（用于图鉴里画环形箭头）。 */
  spin: "clockwise" | "counter-clockwise";
}

/* ------------------------------------------------------------------ *
 * 二、三层名单（构建期校验的锚点）
 * ------------------------------------------------------------------ */

/**
 * ① 重点层：教材「按顺序熟记四个闭合环流 + 一条环球漂流」。
 * ⚠️ 西风漂流在三个环流里都出现，但它是**同一条流**，所以此处只列一次。
 */
export const CORE_CURRENTS = [
  // 北太平洋环流（顺时针）
  "北赤道暖流",
  "日本暖流",
  "北太平洋暖流",
  "加利福尼亚寒流",
  // 南太平洋环流（逆时针）
  "南赤道暖流",
  "东澳大利亚暖流",
  "西风漂流",
  "秘鲁寒流",
  // 北大西洋环流（顺时针）
  "墨西哥湾暖流",
  "北大西洋暖流",
  "加那利寒流",
  // 南大西洋环流（逆时针）
  "巴西暖流",
  "本格拉寒流",
  // 南印度洋环流（逆时针）
  "厄加勒斯暖流",
  "西澳大利亚寒流",
  // 北印度洋（高中版启用）
  "北印度洋季风洋流",
  // 教材「渔场成因」点名（作交汇搭档，不作独立捕捞区）
  "千岛寒流",
  "拉布拉多寒流"
] as const;

/**
 * ② 拓展层：教材体系外、但图 4-24 上标了箭头的真实洋流。
 * **只认名称，不判方向**（判定深度差异是分层最关键的一条）。
 */
export const EXTENSION_CURRENTS = [
  "阿拉斯加暖流",
  "赤道逆流",
  "东格陵兰寒流",
  "索马里寒流",
  "莫桑比克暖流",
  "北冰洋南下冷水"
] as const;

/**
 * ③ 了解层：教材「影响」部分点名过的**用法**。
 *
 * ⚠️ 重要：这些洋流**本体已经在重点层**（北大西洋暖流 / 秘鲁寒流 / 西澳大利亚寒流）。
 * 本层登记的是它们作为「影响例证」的那一面——比如"北大西洋暖流使摩尔曼斯克终年不冻"。
 * 所以：
 *   - 它**不与重点层互斥**，是"同一条流的另一个知识侧面"；
 *   - 不设独立捕捞区、不作判定，只进解释卡文字。
 * `assertTiering` 的互斥规则会**豁免本层**（见函数内注释）。
 */
export const REFERENCE_CURRENTS = [
  "北大西洋暖流",
  "秘鲁寒流",
  "西澳大利亚寒流"
] as const;

/* ------------------------------------------------------------------ *
 * 三、品质规则（三条教材依据 —— 「哪里鱼多」不是我编的）
 * ------------------------------------------------------------------ */

/** 品质由成因决定。这张表是**规则**，不是配置，改它要有教材依据。 */
export const QUALITY_RULES = {
  /** 上升补偿流：离岸风把表层水吹走，深层冷水上涌，营养盐极丰富。 */
  upwelling: 5,
  /** 寒暖流交汇：海水受扰动上泛，饵料丰富。 */
  convergence: 4,
  /** 大陆架宽广 / 中低纬：光照充足、饵料一般。 */
  shelf: 3,
  /** 大洋环流中部：饵料稀少。 */
  gyre: 2,
  /** 无鱼：环流中心"海洋荒漠"、冰封海域。 */
  barren: 1
} as const;

/* ------------------------------------------------------------------ *
 * 四、洋流总表
 * ------------------------------------------------------------------ */

/**
 * 洋流总表。排列顺序＝图鉴顺序＝地理上由北向南、由西向东的直觉顺序。
 *
 * ⚠️ 每条都必须出现在上面三份名单之一，且**只出现一次**——`assertTiering()` 会查。
 */
export const CURRENTS: Current[] = [
  /* ---------------- 北太平洋环流 ---------------- */
  {
    id: "kuroshio",
    name: "日本暖流",
    tier: "core",
    kind: "warm",
    hemisphere: "N",
    ocean: "pacific",
    flowText: "自南向北 · 沿日本列岛东侧北上",
    direction: "pole-ward",
    quality: 4,
    fish: [
      { name: "鲭鱼", icon: "mackerel" },
      { name: "金枪鱼", icon: "tuna" },
      { name: "秋刀鱼", icon: "saury" }
    ],
    reason:
      "与千岛寒流在北海道附近交汇：冷暖水相遇使海水受扰动上泛，饵料丰富，形成北海道渔场。",
    anchor: { lon: 138, lat: 28 },
    arrow: { lon1: 130, lat1: 22, lon2: 148, lat2: 36 },
    note: "① 重点层 · 教材图 4-24 北太平洋环流成员，别名「黑潮」。"
  },
  {
    id: "oyashio",
    name: "千岛寒流",
    tier: "core",
    kind: "cold",
    hemisphere: "N",
    ocean: "pacific",
    flowText: "自北向南 · 由千岛群岛南下",
    direction: "equator-ward",
    quality: 4,
    fish: [
      { name: "鲑鱼", icon: "salmon" },
      { name: "鳕鱼", icon: "cod" }
    ],
    reason:
      "与日本暖流交汇形成北海道渔场——本游戏里它只作为「交汇的另一方」出现，学生看图时应与日本暖流一起记。",
    anchor: { lon: 152, lat: 44 },
    arrow: { lon1: 160, lat1: 50, lon2: 147, lat2: 39 },
    note: "① 重点层 · 教材在「渔场成因」里点名（『日本暖流及千岛寒流交汇』），别名「亲潮」。"
  },
  {
    id: "north-pacific",
    name: "北太平洋暖流",
    tier: "core",
    kind: "warm",
    hemisphere: "N",
    ocean: "pacific",
    flowText: "自西向东 · 北纬 40° 附近横渡太平洋",
    direction: "west-to-east",
    quality: 3,
    fish: [
      { name: "金枪鱼", icon: "tuna" },
      { name: "剑鱼", icon: "swordfish" }
    ],
    reason: "中纬西风带推动，饵料一般；它把暖水从日本一带输送到北美西岸。",
    anchor: { lon: -170, lat: 40 },
    arrow: { lon1: 150, lat1: 40, lon2: -130, lat2: 44 },
    note: "① 重点层 · 教材图 4-24 北太平洋环流成员。"
  },
  {
    id: "california",
    name: "加利福尼亚寒流",
    tier: "core",
    kind: "cold",
    hemisphere: "N",
    ocean: "pacific",
    flowText: "自北向南 · 沿北美西岸南下",
    direction: "equator-ward",
    quality: 3,
    fish: [
      { name: "沙丁鱼", icon: "sardine" },
      { name: "鲱鱼", icon: "herring" }
    ],
    reason: "北美西岸有上升流，但规模明显小于秘鲁寒流，所以品质是 3 星而不是 5 星。",
    anchor: { lon: -128, lat: 34 },
    arrow: { lon1: -125, lat1: 44, lon2: -133, lat2: 26 },
    note: "① 重点层 · 教材图 4-24 北太平洋环流成员。"
  },

  /* ---------------- 南太平洋环流 ---------------- */
  {
    id: "east-australia",
    name: "东澳大利亚暖流",
    tier: "core",
    kind: "warm",
    hemisphere: "S",
    ocean: "pacific",
    flowText: "自北向南 · 沿澳大利亚东岸南下",
    direction: "pole-ward",
    quality: 3,
    fish: [
      { name: "鲭鱼", icon: "mackerel" },
      { name: "金枪鱼", icon: "tuna" }
    ],
    reason: "暖流，没有寒暖流交汇条件，也不在显著上升流区，所以品质中等。",
    anchor: { lon: 154, lat: -30 },
    arrow: { lon1: 150, lat1: -20, lon2: 155, lat2: -38 },
    note: "① 重点层 · 教材图 4-24 南太平洋环流成员。"
  },
  {
    id: "peru",
    name: "秘鲁寒流",
    tier: "core",
    kind: "cold",
    hemisphere: "S",
    ocean: "pacific",
    flowText: "自南向北 · 沿南美西岸北上",
    direction: "equator-ward",
    quality: 5,
    fish: [
      { name: "鳀鱼", icon: "anchovy" },
      { name: "鲣鱼", icon: "bonito" }
    ],
    reason:
      "上升补偿流：东南信风把表层海水吹离海岸，深层冷水带着营养盐上涌，饵料极丰富，形成秘鲁渔场。注意它是寒流却渔获最高。",
    anchor: { lon: -80, lat: -18 },
    arrow: { lon1: -76, lat1: -38, lon2: -82, lat2: -8 },
    note: "① 重点层 · 教材图 4-24 南太平洋环流成员；也是全游戏品质天花板（★×5）。"
  },

  /* ---------------- 北大西洋环流 ---------------- */
  {
    id: "gulf-stream",
    name: "墨西哥湾暖流",
    tier: "core",
    kind: "warm",
    hemisphere: "N",
    ocean: "atlantic",
    flowText: "自南向北 · 沿北美东岸北上",
    direction: "pole-ward",
    quality: 4,
    fish: [
      { name: "鳕鱼", icon: "cod" },
      { name: "鲱鱼", icon: "herring" }
    ],
    reason: "与拉布拉多寒流交汇形成纽芬兰渔场——冷暖水相遇使海水受扰动上泛，饵料丰富。",
    anchor: { lon: -72, lat: 33 },
    arrow: { lon1: -80, lat1: 26, lon2: -62, lat2: 40 },
    note: "① 重点层 · 教材图 4-24 北大西洋环流成员。"
  },
  {
    id: "labrador",
    name: "拉布拉多寒流",
    tier: "core",
    kind: "cold",
    hemisphere: "N",
    ocean: "atlantic",
    flowText: "自北向南 · 由拉布拉多半岛南下",
    direction: "equator-ward",
    quality: 4,
    fish: [
      { name: "鳕鱼", icon: "cod" },
      { name: "比目鱼", icon: "halibut" }
    ],
    reason: "与墨西哥湾暖流交汇形成纽芬兰渔场，本游戏里只作「交汇的另一方」出现。",
    anchor: { lon: -54, lat: 53 },
    arrow: { lon1: -58, lat1: 62, lon2: -52, lat2: 44 },
    note: "① 重点层 · 教材在「渔场成因」里点名（『拉布拉多寒流及墨西哥湾暖流交汇』）。"
  },
  {
    id: "north-atlantic",
    name: "北大西洋暖流",
    tier: "core",
    kind: "warm",
    hemisphere: "N",
    ocean: "atlantic",
    flowText: "自西向东 · 由北美东岸流向欧洲西北岸",
    direction: "west-to-east",
    quality: 4,
    fish: [
      { name: "鲱鱼", icon: "herring" },
      { name: "鲭鱼", icon: "mackerel" }
    ],
    reason: "与北冰洋南下冷水交汇形成北海渔场；同时它增温增湿，使西欧形成温带海洋性气候。",
    anchor: { lon: -28, lat: 47 },
    arrow: { lon1: -50, lat1: 42, lon2: 5, lat2: 60 },
    note: "① 重点层 · 教材图 4-24 北大西洋环流成员，也是「洋流影响」一节的原文例证。"
  },
  {
    id: "canary",
    name: "加那利寒流",
    tier: "core",
    kind: "cold",
    hemisphere: "N",
    ocean: "atlantic",
    flowText: "自北向南 · 沿非洲西北岸南下",
    direction: "equator-ward",
    quality: 3,
    fish: [
      { name: "沙丁鱼", icon: "sardine" },
      { name: "鲭鱼", icon: "mackerel" }
    ],
    reason: "中低纬大洋东岸，有上升流但规模一般，饵料中等。",
    anchor: { lon: -19, lat: 26 },
    arrow: { lon1: -14, lat1: 36, lon2: -21, lat2: 16 },
    note: "① 重点层 · 教材图 4-24 北大西洋环流成员。"
  },

  /* ---------------- 南大西洋环流 ---------------- */
  {
    id: "brazil",
    name: "巴西暖流",
    tier: "core",
    kind: "warm",
    hemisphere: "S",
    ocean: "atlantic",
    flowText: "自北向南 · 沿南美东岸南下",
    direction: "pole-ward",
    quality: 3,
    fish: [
      { name: "鲭鱼", icon: "mackerel" },
      { name: "鲨鱼", icon: "shark" }
    ],
    reason: "暖流，无交汇条件、无显著上升流，品质中等。",
    anchor: { lon: -42, lat: -26 },
    arrow: { lon1: -38, lat1: -12, lon2: -48, lat2: -38 },
    note: "① 重点层 · 教材图 4-24 南大西洋环流成员。"
  },
  {
    id: "benguela",
    name: "本格拉寒流",
    tier: "core",
    kind: "cold",
    hemisphere: "S",
    ocean: "atlantic",
    flowText: "自南向北 · 沿非洲西南岸北上",
    direction: "equator-ward",
    quality: 3,
    fish: [
      { name: "沙丁鱼", icon: "sardine" },
      { name: "鳀鱼", icon: "anchovy" }
    ],
    reason: "中低纬大洋东岸，有上升流但规模小于秘鲁，饵料中等。",
    anchor: { lon: 11, lat: -26 },
    arrow: { lon1: 15, lat1: -36, lon2: 9, lat2: -16 },
    note: "① 重点层 · 教材图 4-24 南大西洋环流成员。"
  },

  /* ---------------- 南印度洋环流 ---------------- */
  {
    id: "agulhas",
    name: "厄加勒斯暖流",
    tier: "core",
    kind: "warm",
    hemisphere: "S",
    ocean: "indian",
    flowText: "自北向南 · 沿非洲东南岸南下",
    direction: "pole-ward",
    quality: 3,
    fish: [
      { name: "鲭鱼", icon: "mackerel" },
      { name: "金枪鱼", icon: "tuna" }
    ],
    reason: "暖流，无交汇条件，品质中等。",
    anchor: { lon: 37, lat: -30 },
    arrow: { lon1: 33, lat1: -20, lon2: 40, lat2: -38 },
    note: "① 重点层 · 教材图 4-24 南印度洋环流成员。"
  },
  {
    id: "west-australia",
    name: "西澳大利亚寒流",
    tier: "core",
    kind: "cold",
    hemisphere: "S",
    ocean: "indian",
    flowText: "自南向北 · 沿澳大利亚西岸北上",
    direction: "equator-ward",
    quality: 3,
    fish: [
      { name: "沙丁鱼", icon: "sardine" },
      { name: "鲱鱼", icon: "herring" }
    ],
    reason: "中低纬大洋东岸，饵料中等；教材用它沿岸的荒漠作「寒流降温减湿」例证。",
    anchor: { lon: 108, lat: -28 },
    arrow: { lon1: 111, lat1: -36, lon2: 105, lat2: -18 },
    note: "① 重点层 · 教材图 4-24 南印度洋环流成员。"
  },

  /* ---------------- 赤道两侧 · 环球漂流 ---------------- */
  {
    id: "north-equatorial",
    name: "北赤道暖流",
    tier: "core",
    kind: "warm",
    hemisphere: "N",
    ocean: "pacific",
    flowText: "自东向西 · 由东北信风推动横穿太平洋与大西洋",
    direction: "east-to-west",
    quality: 2,
    fish: [
      { name: "飞鱼", icon: "flying-fish" },
      { name: "金枪鱼", icon: "tuna" }
    ],
    reason: "大洋环流中部海域风力微弱、饵料极少，鱼群稀疏。",
    anchor: { lon: -140, lat: 12 },
    arrow: { lon1: -110, lat1: 12, lon2: 165, lat2: 13 },
    note: "① 重点层 · 教材图 4-24 四大环流共有的南/北赤道暖流。"
  },
  {
    id: "south-equatorial",
    name: "南赤道暖流",
    tier: "core",
    kind: "warm",
    hemisphere: "S",
    ocean: "pacific",
    flowText: "自东向西 · 由东南信风推动横穿低纬海区",
    direction: "east-to-west",
    quality: 2,
    fish: [
      { name: "飞鱼", icon: "flying-fish" },
      { name: "金枪鱼", icon: "tuna" }
    ],
    reason: "同为大洋环流中部，饵料少、鱼群稀疏。",
    anchor: { lon: -130, lat: -8 },
    arrow: { lon1: -95, lat1: -6, lon2: 170, lat2: -10 },
    note: "① 重点层 · 教材图 4-24 四大环流共有的南/北赤道暖流。"
  },
  {
    id: "west-wind-drift",
    name: "西风漂流",
    tier: "core",
    kind: "cold",
    hemisphere: "S",
    ocean: "pacific",
    flowText: "自西向东 · 环绕南极大陆外围一周",
    direction: "west-to-east",
    quality: 2,
    fish: [
      { name: "磷虾", icon: "krill" },
      { name: "小型鱼", icon: "small-fish" }
    ],
    reason:
      "教材称为「世界最强大的寒流」。它环绕地球，水温低、风浪大，产量低；在南太平洋、南大西洋、南印度洋三个环流里出现的是同一条流。",
    anchor: { lon: -20, lat: -50 },
    arrow: { lon1: 60, lat1: -52, lon2: 160, lat2: -50 },
    note: "① 重点层 · 三个环流共用同一条流（数据里只建一个 id）。"
  },

  /* ---------------- 北印度洋（高中版启用） ---------------- */
  {
    id: "indian-monsoon",
    name: "北印度洋季风洋流",
    tier: "core",
    kind: "warm",
    hemisphere: "N",
    ocean: "indian",
    flowText: "北半球冬季自东向西（逆时针）／夏季自西向东（顺时针）",
    direction: "east-to-west",
    quality: 3,
    fish: [
      { name: "鲭鱼", icon: "mackerel" },
      { name: "沙丁鱼", icon: "sardine" }
    ],
    reason: "受季风驱动，流向随季节反向。图的标题是「北半球冬季」，所以本作按冬季记。",
    anchor: { lon: 66, lat: 12 },
    arrow: { lon1: 84, lat1: 16, lon2: 50, lat2: 6 },
    note: "① 重点层 · 高中版启用。⚠️ 讲它必须说明「北半球冬季」这个前提。"
  },

  /* ---------------- ② 拓展层（教材体系外 · 只认名称） ---------------- */
  {
    id: "alaska",
    name: "阿拉斯加暖流",
    tier: "extension",
    kind: "warm",
    hemisphere: "N",
    ocean: "pacific",
    flowText: "自南向北 · 沿北美西北岸北上",
    direction: "pole-ward",
    quality: 3,
    fish: [
      { name: "鲑鱼", icon: "salmon" },
      { name: "大比目鱼", icon: "halibut" }
    ],
    reason: "北太平洋环流在此分出的一支，属真实洋流，但不在教材熟记清单内。",
    anchor: { lon: -142, lat: 54 },
    arrow: { lon1: -132, lat1: 48, lon2: -152, lat2: 58 },
    note: "② 拓展层 · ⚠️ 课标未要求熟记，认得名字即可。"
  },
  {
    id: "equatorial-counter",
    name: "赤道逆流",
    tier: "extension",
    kind: "warm",
    hemisphere: "N",
    ocean: "pacific",
    flowText: "自西向东 · 在南北赤道暖流之间的赤道无风带东流",
    direction: "west-to-east",
    quality: 3,
    fish: [
      { name: "金枪鱼", icon: "tuna" },
      { name: "旗鱼", icon: "swordfish" }
    ],
    reason: "赤道无风带的水流，图 4-24 上有标注，但不属于熟记环流体系。",
    anchor: { lon: -160, lat: 5 },
    arrow: { lon1: 140, lat1: 5, lon2: -160, lat2: 6 },
    note: "② 拓展层 · ⚠️ 课标未要求熟记，认得名字即可。"
  },
  {
    id: "east-greenland",
    name: "东格陵兰寒流",
    tier: "extension",
    kind: "cold",
    hemisphere: "N",
    ocean: "arctic",
    flowText: "自北向南 · 沿格陵兰岛东岸南下",
    direction: "equator-ward",
    quality: 3,
    fish: [
      { name: "鳕鱼", icon: "cod" },
      { name: "格陵兰大比目鱼", icon: "halibut" }
    ],
    reason: "北冰洋边缘的冷水南下，图上画了箭头，但**不参与北大西洋环流的闭合**。",
    anchor: { lon: -20, lat: 70 },
    arrow: { lon1: -8, lat1: 78, lon2: -28, lat2: 62 },
    note: "② 拓展层 · ⚠️ 课标未要求熟记；注意它不参与北大西洋环流闭合。"
  },
  {
    id: "somali",
    name: "索马里寒流",
    tier: "extension",
    kind: "cold",
    hemisphere: "N",
    ocean: "indian",
    flowText: "自北向南 · 夏季沿非洲之角东岸南下",
    direction: "equator-ward",
    quality: 3,
    fish: [
      { name: "沙丁鱼", icon: "sardine" },
      { name: "金枪鱼", icon: "tuna" }
    ],
    reason: "北印度洋季风洋流的派生分支，夏季出现，属拓展内容。",
    anchor: { lon: 52, lat: 7 },
    arrow: { lon1: 58, lat1: 12, lon2: 47, lat2: 2 },
    note: "② 拓展层 · ⚠️ 课标未要求熟记，认得名字即可。"
  },
  {
    id: "mozambique",
    name: "莫桑比克暖流",
    tier: "extension",
    kind: "warm",
    hemisphere: "S",
    ocean: "indian",
    flowText: "自北向南 · 沿马达加斯加岛西侧南下",
    direction: "pole-ward",
    quality: 3,
    fish: [
      { name: "鲭鱼", icon: "mackerel" },
      { name: "鲨鱼", icon: "shark" }
    ],
    reason: "厄加勒斯暖流的上游段，教材图上常与它并称，本作单列为拓展条目。",
    anchor: { lon: 41, lat: -20 },
    arrow: { lon1: 42, lat1: -12, lon2: 38, lat2: -30 },
    note: "② 拓展层 · ⚠️ 课标未要求熟记，认得名字即可。"
  },
  {
    id: "arctic-outflow",
    name: "北冰洋南下冷水",
    tier: "extension",
    kind: "cold",
    hemisphere: "N",
    ocean: "arctic",
    flowText: "自北向南 · 由北冰洋注入北大西洋",
    direction: "equator-ward",
    quality: 4,
    fish: [
      { name: "鲱鱼", icon: "herring" },
      { name: "鳕鱼", icon: "cod" }
    ],
    reason: "教材在「北海渔场」成因里点到过它（与北大西洋暖流交汇），属体系边缘。",
    anchor: { lon: -12, lat: 74 },
    arrow: { lon1: -20, lat1: 80, lon2: -5, lat2: 68 },
    note: "② 拓展层 · 教材在北海渔场成因里提到过，但仍属拓展。"
  }
];

/* ------------------------------------------------------------------ *
 * 五、环流图鉴分组（"环流是闭合的"做成可感知的机制）
 * ------------------------------------------------------------------ */

/**
 * 四个闭合环流 + 季风洋流。成员按**流向顺序**排列——
 * 游戏里的收集顺序 = 课本上的背诵顺序。
 *
 * ⚠️ 西风漂流出现在三个环流里，是**同一条流**：此处 members 里重复列它是
 * 为了画图鉴的闭环，但数据主键始终是同一个 `west-wind-drift`。
 */
export const GYRES: GyreGroup[] = [
  {
    id: "north-pacific-gyre",
    name: "北太平洋环流",
    spin: "clockwise",
    members: ["north-equatorial", "kuroshio", "north-pacific", "california"]
  },
  {
    id: "south-pacific-gyre",
    name: "南太平洋环流",
    spin: "counter-clockwise",
    members: ["south-equatorial", "east-australia", "west-wind-drift", "peru"]
  },
  {
    id: "north-atlantic-gyre",
    name: "北大西洋环流",
    spin: "clockwise",
    members: ["north-equatorial", "gulf-stream", "north-atlantic", "canary"]
  },
  {
    id: "south-atlantic-gyre",
    name: "南大西洋环流",
    spin: "counter-clockwise",
    members: ["south-equatorial", "brazil", "west-wind-drift", "benguela"]
  },
  {
    id: "south-indian-gyre",
    name: "南印度洋环流",
    spin: "counter-clockwise",
    members: ["south-equatorial", "agulhas", "west-wind-drift", "west-australia"]
  },
  {
    id: "indian-monsoon-gyre",
    name: "北印度洋季风环流",
    spin: "counter-clockwise",
    // ⚠️ 只列重点层成员。索马里寒流是它的派生分支，但属拓展层——
    //    拓展层不参与通关闭环（名义拓展不能变必修），所以不进 members。
    //    图鉴里它会在「其他洋流」分组单独出现。
    members: ["indian-monsoon"]
  }
];

/** 通关要集齐的环流（拓展层不参与——名义拓展不能变必修）。 */
export const WIN_GYRES = [
  "north-pacific-gyre",
  "south-pacific-gyre",
  "north-atlantic-gyre",
  "south-atlantic-gyre",
  "south-indian-gyre"
] as const;

/* ------------------------------------------------------------------ *
 * 六、易混对（错题统计的教学抓手）
 * ------------------------------------------------------------------ */

/**
 * 真实且高频的易混对。结算页的「最常认错」直接统计这些组合。
 * 每一对的混淆原因都写清楚——老师可以直接拿去讲。
 */
export interface ConfusablePair {
  a: string;
  b: string;
  why: string;
}

export const CONFUSABLE_PAIRS: ConfusablePair[] = [
  {
    a: "benguela",
    b: "canary",
    why: "两条都是「非洲外海的中低纬寒流」，一南一北，学生只记「非洲西岸寒流」就分不清。"
  },
  {
    a: "peru",
    b: "california",
    why: "两条都是「大洋东岸的寒流」，分别在南北半球，都伴上升流但强度差很多。"
  },
  {
    a: "kuroshio",
    b: "gulf-stream",
    why: "两条都是「大洋西岸的强大暖流」，一条在太平洋、一条在大西洋。"
  },
  {
    a: "brazil",
    b: "east-australia",
    why: "两条都是南半球大洋西岸暖流，位置对调很容易记反。"
  },
  {
    a: "agulhas",
    b: "mozambique",
    why: "同在南印度洋西侧、同向流动，教材图上常并称，容易被当成一条。"
  },
  {
    a: "west-wind-drift",
    b: "north-pacific",
    why: "都是「自西向东」的流，但一条环绕南极、一条在北太平洋中纬，纬度完全不同。"
  }
];

/* ------------------------------------------------------------------ *
 * 七、学段模式
 * ------------------------------------------------------------------ */

export type Stage = "junior" | "senior";

export interface StageConfig {
  id: Stage;
  name: string;
  /** 这一局使用哪些层级。 */
  tiers: CurrentTier[];
  /** 第二问（判方向）的呈现方式。 */
  directionUI: "two-choice" | "draw-arrow";
  /** 是否显示星级（初中显示 = 降低"值不值得下网"的判断负担）。 */
  showQuality: boolean;
  /** 下网次数。 */
  casts: number;
  /** 每问时限（秒）。 */
  timeLimit: number;
  blurb: string;
  note: string;
}

export const STAGES: Record<Stage, StageConfig> = {
  junior: {
    id: "junior",
    name: "初中版",
    tiers: ["core"],
    directionUI: "two-choice",
    showQuality: true,
    casts: 12,
    timeLimit: 20,
    blurb: "教材熟记的 16 条洋流，认名称 + 二选一判方向",
    note: "只考重点层；显示星级，看到 ★×5 就知道值得下网。"
  },
  senior: {
    id: "senior",
    name: "高中版",
    tiers: ["core", "extension"],
    directionUI: "draw-arrow",
    showQuality: false,
    casts: 10,
    timeLimit: 15,
    blurb: "重点层 + 拓展层，图上画箭头判方向",
    note: "含北印度洋季风洋流与拓展洋流；拓展层只认名称、不判方向。"
  }
};

export const DEFAULT_STAGE: Stage = "junior";

/* ------------------------------------------------------------------ *
 * 八、取值工具
 * ------------------------------------------------------------------ */

const BY_ID = new Map(CURRENTS.map((c) => [c.id, c]));

/** 按 id 取洋流。取不到返回 undefined —— 调用方必须处理，不许静默兜底。 */
export function currentById(id: string): Current | undefined {
  return BY_ID.get(id);
}

/** 按名称取洋流（校验用）。 */
export function currentByName(name: string): Current | undefined {
  return CURRENTS.find((c) => c.name === name);
}

/**
 * 这一局里真正会出现在地图上的洋流。
 *
 * ⚠️ 注意**千岛寒流 / 拉布拉多寒流**虽然在重点层，但它们是"交汇的另一方"，
 * 不设独立捕捞区（学生在图上找不到显眼位置）。所以这里把它们排掉。
 */
export const NO_SOLO_ZONE = ["oyashio", "labrador"] as const;

export function playableCurrents(stage: Stage): Current[] {
  const cfg = STAGES[stage];
  return CURRENTS.filter(
    (c) =>
      cfg.tiers.includes(c.tier) &&
      !(NO_SOLO_ZONE as readonly string[]).includes(c.id)
  );
}

/** 图鉴要展示的全部条目（不过滤，图鉴是"看得见的知识地图"）。 */
export function allTiers(): CurrentTier[] {
  return ["core", "extension", "reference"];
}

/* ------------------------------------------------------------------ *
 * 九、构建期校验 —— 分层落到类型上，不靠人记
 * ------------------------------------------------------------------ */

/**
 * 校验洋流分层。三条规则，任一违反就抛错，构建期 exit(1)。
 *
 * 为什么不用一个白名单数组：
 *   白名单只能告诉你"这个名字合不合法"，**管不住"它该有多重要"**。
 *   用 `CurrentTier` 联合类型 + 这个校验，分层从"文档约定"变成"类型约束"。
 */
export function assertTiering(entries: readonly Current[] = CURRENTS): void {
  const errs: string[] = [];
  const lists: Record<CurrentTier, readonly string[]> = {
    core: CORE_CURRENTS,
    extension: EXTENSION_CURRENTS,
    reference: REFERENCE_CURRENTS
  };

  for (const e of entries) {
    const declared = lists[e.tier];
    if (!declared) {
      errs.push(`「${e.name}」的层级 "${e.tier}" 不是合法层级`);
      continue;
    }

    // 规则 1：名称必须真的属于所声明的层级
    // —— 防"降级逃避判定"（把重点层写成拓展层）和"升级冒充考点"（反过来）。
    if (!declared.includes(e.name)) {
      errs.push(
        `「${e.name}」声明层级为 ${e.tier}，但它不在 ${e.tier.toUpperCase()} 名单里`
      );
    }

    // 规则 2：同一名称不得跨层重复 —— 分层必须互斥
    //
    // ⚠️ 例外：`reference` 层**允许与 core 重叠**。
    //    它是"同一条流的另一个知识侧面"（如"北大西洋暖流"本身是重点层，
    //    但"它使摩尔曼斯克成不冻港"这个**影响用法**属了解层）。
    //    若这里也强制互斥，就会逼着把了解层的内容塞进重点层的 note 里，
    //    反而丢掉了"只作例证、不作判定"这个教学定位。
    //    所以只检查 core 与 extension 之间的互斥。
    if (e.tier !== "reference") {
      const other: readonly string[] =
        e.tier === "core" ? EXTENSION_CURRENTS : CORE_CURRENTS;
      if (other.includes(e.name)) {
        errs.push(
          `「${e.name}」同时出现在 core / extension 名单里，这两层必须互斥`
        );
      }
    }

    // 规则 3：同一数据里 id 不得重复
    const sameId = entries.filter((x) => x.id === e.id);
    if (sameId.length > 1) {
      errs.push(`id「${e.id}」重复出现 ${sameId.length} 次`);
      break; // 否则会刷屏
    }

    // 规则 4：分层与判定深度的一致性 ——
    // 这是分层最关键的一条：拓展层只认名称，它的存在意义就是"不判方向"。
    // 所以拓展层必须在可选名单里，且第二问要被跳过（由 game.ts 落实）。
    if (e.tier === "extension" && !e.note.includes("拓展层")) {
      errs.push(`「${e.name}」是拓展层，note 里必须标出「拓展层」以便界面显示角标`);
    }
  }

  // 规则 5：三份名单里的每一条都要在数据里有对应条目（不能只在名单里挂着）
  for (const tier of Object.keys(lists) as CurrentTier[]) {
    for (const name of lists[tier]) {
      if (!entries.some((e) => e.name === name)) {
        errs.push(`名单里的「${name}」（${tier}）在 CURRENTS 里找不到对应条目`);
      }
    }
  }

  // 规则 6：环流成员必须都存在，且不能引用拓展层（图鉴闭环只在重点层内成立）
  for (const g of GYRES) {
    for (const id of g.members) {
      const c = BY_ID.get(id);
      if (!c) {
        errs.push(`环流「${g.name}」引用了不存在的 id「${id}」`);
      } else if (c.tier !== "core") {
        errs.push(
          `环流「${g.name}」引用了非重点层的「${c.name}」—— 通关闭环只能在重点层内成立`
        );
      }
    }
  }

  if (errs.length) {
    throw new Error("洋流分层校验失败：\n  - " + errs.join("\n  - "));
  }
}

/** 允许的洋流名称全集（供测试断言用，不要用它替代 assertTiering）。 */
export function allowedCurrentNames(): string[] {
  return [...CORE_CURRENTS, ...EXTENSION_CURRENTS, ...REFERENCE_CURRENTS];
}
