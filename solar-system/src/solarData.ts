/**
 * 太阳系天体数据：轨道根数取自 J2000 历元实测值，
 * 描述文字面向八年级地理/科学教学。
 *
 * 轨道根数说明：
 *   aAU        —— 轨道半长轴（天文单位 AU，1 AU ≈ 1.496 亿公里）
 *   e          —— 轨道偏心率（0 = 正圆，越大越扁）
 *   periodDays —— 公转周期（地球日）
 *   inclinationDeg —— 轨道倾角（相对黄道面）
 *   perihelionLonDeg —— 近日点经度 ϖ
 *   m0Deg      —— 历元时刻的平近点角（用于错开各行星初始位置）
 *   rotationHours —— 自转周期（小时，负值表示逆向自转）
 *   tiltDeg    —— 自转轴倾角
 */

export interface MoonData {
  id: string;
  name: string;
  en: string;
  radiusKm: number;
  orbitKm: number;
  periodDays: number;
  color: string;
  desc: string;
  facts: [string, string][];
}

export interface RingData {
  inner: number;
  outer: number;
  color: string;
  opacity: number;
}

export interface BodyData {
  id: string;
  name: string;
  en: string;
  kind: "star" | "planet" | "dwarf";
  radiusKm: number;
  aAU: number;
  e: number;
  periodDays: number;
  inclinationDeg: number;
  perihelionLonDeg: number;
  m0Deg: number;
  rotationHours: number;
  tiltDeg: number;
  color: string;
  textureKey: string;
  desc: string;
  facts: [string, string][];
  moons: MoonData[];
  ring?: RingData;
  /** 自转轴倾角是否直接取自 tiltDeg（天王星等），默认 true */
  retrogradeRotation?: boolean;
}

export const ORBIT_K = 7.2;
export const ORBIT_POW = 0.45;
/** 行星显示半径 = PLANET_R_K * (半径/地球半径)^PLANET_R_POW，已做夸张放大以便观察 */
export const PLANET_R_K = 0.4;
export const PLANET_R_POW = 0.35;
export const SUN_DISPLAY_R = 1.75;

export const SUN: BodyData = {
  id: "sun",
  name: "太阳",
  en: "Sun",
  kind: "star",
  radiusKm: 696340,
  aAU: 0,
  e: 0,
  periodDays: 1,
  inclinationDeg: 0,
  perihelionLonDeg: 0,
  m0Deg: 0,
  rotationHours: 609.12,
  tiltDeg: 7.25,
  color: "#ffb92e",
  textureKey: "sun",
  desc:
    "太阳系唯一的恒星，质量占整个太阳系的 99.86%。它的核心不断把氢聚变成氦，释放出巨大的光和热，是地球上一切生命的能量来源。太阳的直径约是地球的 109 倍，表面温度约 5500℃。",
  facts: [
    ["类型", "G 型主序星（恒星）"],
    ["直径", "约 139.2 万公里（地球的 109 倍）"],
    ["表面温度", "约 5500℃"],
    ["核心温度", "约 1500 万℃"],
    ["自转周期", "赤道约 25.4 天"],
    ["质量占比", "太阳系的 99.86%"]
  ],
  moons: []
};

export const PLANETS: BodyData[] = [
  {
    id: "mercury",
    name: "水星",
    en: "Mercury",
    kind: "planet",
    radiusKm: 2439.7,
    aAU: 0.387098,
    e: 0.20563,
    periodDays: 87.969,
    inclinationDeg: 7.005,
    perihelionLonDeg: 77.456,
    m0Deg: 174,
    rotationHours: 1407.6,
    tiltDeg: 0.034,
    color: "#9c8e82",
    textureKey: "mercury",
    desc:
      "离太阳最近、体积最小的行星。几乎没有大气层，白天被太阳晒到 427℃，夜晚又降到 -173℃，昼夜温差是八大行星中最大的。表面布满环形山，看上去和月球很像。",
    facts: [
      ["类型", "类地行星"],
      ["直径", "4879 公里"],
      ["平均距日", "0.39 AU（约 5790 万公里）"],
      ["公转周期", "88 天"],
      ["自转周期", "58.6 天"],
      ["表面温度", "-173℃ ~ 427℃"],
      ["卫星数量", "0"]
    ],
    moons: []
  },
  {
    id: "venus",
    name: "金星",
    en: "Venus",
    kind: "planet",
    radiusKm: 6051.8,
    aAU: 0.723332,
    e: 0.006772,
    periodDays: 224.701,
    inclinationDeg: 3.3946,
    perihelionLonDeg: 131.533,
    m0Deg: 50,
    rotationHours: -5832.5,
    tiltDeg: 177.36,
    color: "#e6c07b",
    textureKey: "venus",
    retrogradeRotation: true,
    desc:
      "地球的“姊妹星”，大小与地球接近，但浓密的二氧化碳大气造成极强温室效应，使表面温度高达约 464℃，是太阳系最热的行星。它的自转方向与大多数行星相反，而且自转比公转还慢——金星上的一天比一年还长。",
    facts: [
      ["类型", "类地行星"],
      ["直径", "12104 公里"],
      ["平均距日", "0.72 AU（约 1.08 亿公里）"],
      ["公转周期", "225 天"],
      ["自转周期", "243 天（逆向自转）"],
      ["表面温度", "约 464℃"],
      ["主要大气", "二氧化碳（约 96%）"],
      ["卫星数量", "0"]
    ],
    moons: []
  },
  {
    id: "earth",
    name: "地球",
    en: "Earth",
    kind: "planet",
    radiusKm: 6371,
    aAU: 1.0,
    e: 0.016710,
    periodDays: 365.256,
    inclinationDeg: 0.00005,
    perihelionLonDeg: 102.947,
    m0Deg: 358,
    rotationHours: 23.9345,
    tiltDeg: 23.44,
    color: "#3d7ec4",
    textureKey: "earth",
    desc:
      "目前已知唯一存在生命的星球。约 71% 的表面被液态水覆盖，大气以氮气和氧气为主，还有一个天然卫星——月球。地轴倾斜 23.44°，带来了四季变化；自转一周约 24 小时，形成昼夜交替。",
    facts: [
      ["类型", "类地行星"],
      ["直径", "12742 公里"],
      ["平均距日", "1 AU（约 1.496 亿公里）"],
      ["公转周期", "365.26 天"],
      ["自转周期", "23 小时 56 分"],
      ["自转轴倾角", "23.44°"],
      ["平均温度", "约 15℃"],
      ["主要大气", "氮气 78%、氧气 21%"],
      ["卫星数量", "1（月球）"]
    ],
    moons: [
      {
        id: "moon",
        name: "月球",
        en: "Moon",
        radiusKm: 1737.4,
        orbitKm: 384400,
        periodDays: 27.322,
        color: "#c9c4bb",
        desc:
          "地球唯一的天然卫星，也是人类唯一登陆过的天体。它引起的潮汐塑造了海岸线，表面有暗色的月海和明亮的环形山。",
        facts: [
          ["直径", "3475 公里"],
          ["距地球", "约 38.4 万公里"],
          ["公转周期", "27.3 天"],
          ["自转周期", "27.3 天（潮汐锁定）"]
        ]
      }
    ]
  },
  {
    id: "mars",
    name: "火星",
    en: "Mars",
    kind: "planet",
    radiusKm: 3389.5,
    aAU: 1.523679,
    e: 0.093400,
    periodDays: 686.980,
    inclinationDeg: 1.850,
    perihelionLonDeg: 336.041,
    m0Deg: 19,
    rotationHours: 24.6229,
    tiltDeg: 25.19,
    color: "#c1502e",
    textureKey: "mars",
    desc:
      "因表面富含氧化铁而呈红色的行星，被称为“红色星球”。它有太阳系最高的火山（奥林帕斯山，高约 22 公里）和最大的峡谷（水手谷），两极存在由水冰和干冰组成的极冠。",
    facts: [
      ["类型", "类地行星"],
      ["直径", "6779 公里"],
      ["平均距日", "1.52 AU（约 2.28 亿公里）"],
      ["公转周期", "687 天"],
      ["自转周期", "24 小时 37 分"],
      ["平均温度", "约 -63℃"],
      ["主要大气", "二氧化碳（稀薄）"],
      ["卫星数量", "2（火卫一、火卫二）"]
    ],
    moons: [
      {
        id: "phobos",
        name: "火卫一",
        en: "Phobos",
        radiusKm: 11.3,
        orbitKm: 9376,
        periodDays: 0.3189,
        color: "#9a8d80",
        desc: "火星较大的卫星，形状不规则，像一块布满陨石坑的土豆，正缓慢向火星坠落。",
        facts: [
          ["平均直径", "22.5 公里"],
          ["距火星", "9376 公里"],
          ["公转周期", "7 小时 39 分"]
        ]
      },
      {
        id: "deimos",
        name: "火卫二",
        en: "Deimos",
        radiusKm: 6.2,
        orbitKm: 23463,
        periodDays: 1.263,
        color: "#8d8175",
        desc: "火星较小的卫星，表面相对平滑，被一层厚厚的尘土覆盖。",
        facts: [
          ["平均直径", "12.4 公里"],
          ["距火星", "23463 公里"],
          ["公转周期", "30.3 小时"]
        ]
      }
    ]
  },
  {
    id: "jupiter",
    name: "木星",
    en: "Jupiter",
    kind: "planet",
    radiusKm: 69911,
    aAU: 5.20260,
    e: 0.048498,
    periodDays: 4332.589,
    inclinationDeg: 1.303,
    perihelionLonDeg: 14.728,
    m0Deg: 20,
    rotationHours: 9.925,
    tiltDeg: 3.13,
    color: "#d8b48a",
    textureKey: "jupiter",
    desc:
      "太阳系最大的行星，质量是其他七颗行星总和的 2.5 倍。表面是明暗相间的云带，还有持续了数百年的巨型风暴“大红斑”。它自转极快，不到 10 小时就转一圈，是八大行星中自转最快的。",
    facts: [
      ["类型", "气态巨行星"],
      ["直径", "139820 公里（地球的 11 倍）"],
      ["平均距日", "5.2 AU（约 7.78 亿公里）"],
      ["公转周期", "11.86 年"],
      ["自转周期", "9 小时 56 分"],
      ["主要成分", "氢、氦"],
      ["卫星数量", "95 颗以上"]
    ],
    moons: [
      {
        id: "io",
        name: "木卫一·艾奥",
        en: "Io",
        radiusKm: 1821.6,
        orbitKm: 421700,
        periodDays: 1.769,
        color: "#e8d76a",
        desc: "太阳系中火山活动最剧烈的天体，表面被硫磺染成明黄色，有数百座活火山。",
        facts: [
          ["直径", "3643 公里"],
          ["公转周期", "1.77 天"],
          ["特点", "活火山最密集"]
        ]
      },
      {
        id: "europa",
        name: "木卫二·欧罗巴",
        en: "Europa",
        radiusKm: 1560.8,
        orbitKm: 671034,
        periodDays: 3.551,
        color: "#dcd2c0",
        desc: "表面覆盖光滑的冰层，冰层之下可能藏着液态水海洋，是寻找地外生命的热门目标。",
        facts: [
          ["直径", "3122 公里"],
          ["公转周期", "3.55 天"],
          ["特点", "冰下海洋"]
        ]
      },
      {
        id: "ganymede",
        name: "木卫三·盖尼米德",
        en: "Ganymede",
        radiusKm: 2634.1,
        orbitKm: 1070412,
        periodDays: 7.155,
        color: "#b9b2a5",
        desc: "太阳系最大的卫星，比水星还大，也是唯一拥有自身磁场的卫星。",
        facts: [
          ["直径", "5268 公里"],
          ["公转周期", "7.15 天"],
          ["特点", "太阳系最大卫星"]
        ]
      },
      {
        id: "callisto",
        name: "木卫四·卡利斯托",
        en: "Callisto",
        radiusKm: 2410.3,
        orbitKm: 1882709,
        periodDays: 16.689,
        color: "#8f8579",
        desc: "太阳系表面撞击坑最密集的天体之一，是一颗古老而“安静”的卫星。",
        facts: [
          ["直径", "4821 公里"],
          ["公转周期", "16.69 天"],
          ["特点", "撞击坑极多"]
        ]
      }
    ]
  },
  {
    id: "saturn",
    name: "土星",
    en: "Saturn",
    kind: "planet",
    radiusKm: 58232,
    aAU: 9.55491,
    e: 0.055508,
    periodDays: 10759.22,
    inclinationDeg: 2.488,
    perihelionLonDeg: 92.599,
    m0Deg: 317,
    rotationHours: 10.656,
    tiltDeg: 26.73,
    color: "#e3d3a3",
    textureKey: "saturn",
    ring: { inner: 1.25, outer: 2.35, color: "#e8dcb5", opacity: 0.85 },
    desc:
      "以壮观的光环闻名，光环由无数冰块和岩石碎片组成，厚度却不到 1 公里。它的平均密度比水还小，是太阳系中密度最低的行星——理论上能浮在水面上。",
    facts: [
      ["类型", "气态巨行星"],
      ["直径", "116460 公里"],
      ["平均距日", "9.55 AU（约 14.3 亿公里）"],
      ["公转周期", "29.46 年"],
      ["自转周期", "10 小时 39 分"],
      ["平均密度", "0.69 g/cm³（小于水）"],
      ["卫星数量", "146 颗以上"]
    ],
    moons: [
      {
        id: "enceladus",
        name: "土卫二·恩克拉多斯",
        en: "Enceladus",
        radiusKm: 252.1,
        orbitKm: 238020,
        periodDays: 1.370,
        color: "#eef2f5",
        desc: "南极有壮观的冰喷泉，喷出的水汽和冰粒形成了土星 E 环。",
        facts: [
          ["直径", "504 公里"],
          ["公转周期", "1.37 天"],
          ["特点", "冰喷泉"]
        ]
      },
      {
        id: "titan",
        name: "土卫六·泰坦",
        en: "Titan",
        radiusKm: 2574.7,
        orbitKm: 1221870,
        periodDays: 15.945,
        color: "#e0a94a",
        desc: "太阳系第二大卫星，也是唯一拥有浓密大气的卫星。表面有液态甲烷组成的湖泊和河流。",
        facts: [
          ["直径", "5150 公里"],
          ["公转周期", "15.95 天"],
          ["主要大气", "氮气"],
          ["特点", "有液态甲烷湖"]
        ]
      },
      {
        id: "rhea",
        name: "土卫五·瑞亚",
        en: "Rhea",
        radiusKm: 763.8,
        orbitKm: 527108,
        periodDays: 4.518,
        color: "#cfc9bf",
        desc: "土星第二大卫星，主要由水冰组成，表面布满明亮的撞击坑。",
        facts: [
          ["直径", "1528 公里"],
          ["公转周期", "4.52 天"]
        ]
      },
      {
        id: "iapetus",
        name: "土卫八·伊阿珀托斯",
        en: "Iapetus",
        radiusKm: 734.5,
        orbitKm: 3560820,
        periodDays: 79.32,
        color: "#b5a894",
        desc: "一颗“阴阳脸”卫星，一面亮一面暗，还有一道环绕赤道的巨大山脊。",
        facts: [
          ["直径", "1469 公里"],
          ["公转周期", "79.3 天"],
          ["特点", "两面明暗悬殊"]
        ]
      }
    ]
  },
  {
    id: "uranus",
    name: "天王星",
    en: "Uranus",
    kind: "planet",
    radiusKm: 25362,
    aAU: 19.21845,
    e: 0.046381,
    periodDays: 30688.5,
    inclinationDeg: 0.773,
    perihelionLonDeg: 170.964,
    m0Deg: 142,
    rotationHours: -17.24,
    tiltDeg: 97.77,
    color: "#8fd6dd",
    textureKey: "uranus",
    retrogradeRotation: true,
    ring: { inner: 1.65, outer: 2.0, color: "#9fb8c4", opacity: 0.35 },
    desc:
      "冰巨星，大气中的甲烷让它呈淡蓝绿色。它的自转轴几乎“躺”在轨道面上（倾角约 98°），像一个滚动的球，因此两极会各迎来长达 42 年的极昼和极夜。",
    facts: [
      ["类型", "冰巨星"],
      ["直径", "50724 公里"],
      ["平均距日", "19.2 AU（约 28.7 亿公里）"],
      ["公转周期", "84 年"],
      ["自转周期", "17 小时 14 分（逆向）"],
      ["自转轴倾角", "97.77°"],
      ["卫星数量", "28 颗"]
    ],
    moons: [
      {
        id: "miranda",
        name: "天卫五·米兰达",
        en: "Miranda",
        radiusKm: 235.8,
        orbitKm: 129390,
        periodDays: 1.413,
        color: "#cdd6da",
        desc: "表面地形极其破碎，有高达 20 公里的悬崖，像是被撞碎后重新拼起来的。",
        facts: [
          ["直径", "472 公里"],
          ["公转周期", "1.41 天"]
        ]
      },
      {
        id: "ariel",
        name: "天卫一·艾瑞尔",
        en: "Ariel",
        radiusKm: 578.9,
        orbitKm: 190900,
        periodDays: 2.520,
        color: "#d7dee2",
        desc: "天王星最亮的卫星，表面有大量峡谷和可能的冰火山痕迹。",
        facts: [
          ["直径", "1158 公里"],
          ["公转周期", "2.52 天"]
        ]
      },
      {
        id: "titania",
        name: "天卫三·泰坦尼亚",
        en: "Titania",
        radiusKm: 788.4,
        orbitKm: 435910,
        periodDays: 8.706,
        color: "#c6ccd0",
        desc: "天王星最大的卫星，表面有巨大的峡谷系统和少量冰火山活动。",
        facts: [
          ["直径", "1578 公里"],
          ["公转周期", "8.71 天"]
        ]
      },
      {
        id: "oberon",
        name: "天卫四·奥伯龙",
        en: "Oberon",
        radiusKm: 761.4,
        orbitKm: 583520,
        periodDays: 13.463,
        color: "#b9b4ae",
        desc: "天王星最外侧的大卫星，表面古老，撞击坑密布，坑底有暗色物质。",
        facts: [
          ["直径", "1523 公里"],
          ["公转周期", "13.46 天"]
        ]
      }
    ]
  },
  {
    id: "neptune",
    name: "海王星",
    en: "Neptune",
    kind: "planet",
    radiusKm: 24622,
    aAU: 30.11039,
    e: 0.009456,
    periodDays: 60195,
    inclinationDeg: 1.770,
    perihelionLonDeg: 44.971,
    m0Deg: 256,
    rotationHours: 16.11,
    tiltDeg: 28.32,
    color: "#3f6fd8",
    textureKey: "neptune",
    desc:
      "距太阳最远的行星，也是唯一先由数学计算预测、再被望远镜找到的行星。深蓝色的甲烷大气中刮着太阳系最快的风，时速可超过 2000 公里。",
    facts: [
      ["类型", "冰巨星"],
      ["直径", "49244 公里"],
      ["平均距日", "30.1 AU（约 45 亿公里）"],
      ["公转周期", "164.8 年"],
      ["自转周期", "16 小时 6 分"],
      ["风速", "最高超过 2000 公里/小时"],
      ["卫星数量", "16 颗"]
    ],
    moons: [
      {
        id: "triton",
        name: "海卫一·特里同",
        en: "Triton",
        radiusKm: 1353.4,
        orbitKm: 354759,
        periodDays: -5.877,
        color: "#dfe6e8",
        desc: "海王星最大的卫星，公转方向与其他大多数卫星相反，可能是被捕获的柯伊伯带天体。表面有氮气间歇泉。",
        facts: [
          ["直径", "2707 公里"],
          ["公转周期", "5.88 天（逆向）"],
          ["表面温度", "约 -235℃"]
        ]
      }
    ]
  }
];

export const PLUTO: BodyData = {
  id: "pluto",
  name: "冥王星",
  en: "Pluto",
  kind: "dwarf",
  radiusKm: 1188.3,
  aAU: 39.482,
  e: 0.2488,
  periodDays: 90560,
  inclinationDeg: 17.16,
  perihelionLonDeg: 224.07,
  m0Deg: 14,
  rotationHours: -153.29,
  tiltDeg: 122.53,
  color: "#c3ab96",
  textureKey: "pluto",
  retrogradeRotation: true,
  desc:
    "曾被认为是第九大行星，2006 年被国际天文学联合会重新归类为矮行星。它位于柯伊伯带，轨道又扁又斜，有时甚至比海王星更靠近太阳。它与卫星卡戎互相潮汐锁定，像一对共舞的双星。",
  facts: [
    ["类型", "矮行星"],
    ["直径", "2377 公里"],
    ["平均距日", "39.5 AU（约 59 亿公里）"],
    ["公转周期", "248 年"],
    ["自转周期", "6.39 天"],
    ["表面温度", "约 -229℃"],
    ["卫星数量", "5（最大为卡戎）"]
  ],
  moons: [
    {
      id: "charon",
      name: "冥卫一·卡戎",
      en: "Charon",
      radiusKm: 606,
      orbitKm: 19591,
      periodDays: 6.387,
      color: "#b0a89d",
      desc: "冥王星最大的卫星，直径超过冥王星的一半，两者互相潮汐锁定，永远以同一面相对。",
      facts: [
        ["直径", "1212 公里"],
        ["公转周期", "6.39 天"],
        ["特点", "与冥王星互绕"]
      ]
    }
  ]
};

export const ALL_BODIES: BodyData[] = [SUN, ...PLANETS, PLUTO];

export function bodyById(id: string): BodyData | undefined {
  return ALL_BODIES.find((item) => item.id === id);
}

export function moonById(body: BodyData, moonId: string): MoonData | undefined {
  return body.moons.find((item) => item.id === moonId);
}

/** 行星显示半径（已夸张，便于观察）。 */
export function displayRadius(radiusKm: number): number {
  return PLANET_R_K * Math.pow(radiusKm / 6371, PLANET_R_POW);
}

/** 卫星显示半径：适当放大，保证最小可见。 */
export function moonDisplayRadius(radiusKm: number): number {
  return Math.max(0.028, 0.115 * Math.pow(radiusKm / 1737.4, 0.4));
}

/** 卫星轨道显示半径：按索引向外排布，避开行星本体与光环。 */
export function moonOrbitRadius(planetDisplayR: number, index: number): number {
  return planetDisplayR * 2.5 + 0.14 + index * 0.18;
}
