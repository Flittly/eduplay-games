/**
 * 四座真实山体的**地理位置**（人工编纂，权威口径）。
 *
 * ## 为什么省份是手写、而不是由省界多边形自动判定
 *
 * 位置图上那个「所在省高亮 + 红点」看着像纯几何问题，实则不然：
 * 本文件用的省界来自阿里云 DataV（高德底图数据）的 `100000_full.json`，
 * 比例尺约 1:100 万，**几何位置本身有公里级误差**。实测四座山到最近省界的距离：
 *
 * | 山 | 到本省界 | 到最近**他省**界 | 结论 |
 * |---|---|---|---|
 * | 贡嘎山 | 229.0 km | 229.0 km | 无歧义 |
 * | 珠穆朗玛峰 | 0.28 km | 702.4 km | 那 0.28 km 是**国界**（中尼），省份无歧义 |
 * | 梅里雪山 | 0.86 km | **0.86 km** | **真正的省界情形** |
 * | 太白山 | 109.6 km | 109.6 km | 无歧义 |
 *
 * 梅里雪山（卡瓦格博峰）的取景中心离省界只有 0.86 km，而这条省界就是怒山主脊 ——
 * 山脊本身就是界线。多边形判定把它落在哪一侧，取决于几公里级的数据误差，
 * **不是一个可以交给几何去回答的问题**。所以：
 *
 *   * 省份在这里**人工写死**，按权威口径（中国西藏网 / 人民网 / 央广网一致表述：
 *     梅里雪山位于云南省迪庆藏族自治州德钦县，地处滇藏交界，主峰卡瓦格博为云南第一高峰）；
 *   * `prepare_maps.py` 再用点在多边形**反向校验**：无歧义的必须与多边形一致；
 *     声明为省界情形的，必须实测「到最近他省界 < 2 km」才算通过 ——
 *     这样既拦得住写错省的笔误，也不允许拿「省界情形」当借口掩盖错误。
 *
 * ⚠️ 若将来换更高精度的省界数据，先重跑 `prepare_maps.py` 看这几行校验数字再动本文件。
 */

export interface MountainLocation {
  /** 与 `DemSource.tag` 对应 */
  tag: string;
  /** 省级行政区名（权威口径） */
  province: string;
  /** 省级行政区代码，用于在位置图上高亮该省 */
  adcode: string;
  /** 所属山系 / 大地貌单元 */
  range: string;
  /** 一行定位说明（图上给学生看的） */
  note: string;
  /**
   * 是否位于**省界**上。
   * true ⇒ 界面必须提示"位于省界"，免得学生把红点理解成"省内腹地"；
   * 同时也把这条写进生成器的校验：声明 true 就必须实测到最近他省界 < 2 km。
   */
  onBorder: boolean;
}

export const MOUNTAIN_LOCATIONS: MountainLocation[] = [
  {
    tag: "gongga",
    province: "四川省",
    adcode: "510000",
    range: "大雪山（横断山系）",
    note: "四川盆地西缘、川西高原东缘，主峰为四川省最高峰。",
    onBorder: false
  },
  {
    tag: "everest",
    province: "西藏自治区",
    adcode: "540000",
    range: "喜马拉雅山脉",
    note: "中尼边界线上，北坡属西藏日喀则市定日县。",
    onBorder: false
  },
  {
    tag: "meili",
    province: "云南省",
    adcode: "530000",
    range: "怒山（横断山系）",
    note: "滇藏交界，怒山主脊即省界；主峰卡瓦格博为云南第一高峰。",
    onBorder: true
  },
  {
    tag: "taibai",
    province: "陕西省",
    adcode: "610000",
    range: "秦岭",
    note: "秦岭主脊，主峰拔仙台是青藏高原以东的最高峰。",
    onBorder: false
  }
];

export function locationByTag(tag: string): MountainLocation {
  return MOUNTAIN_LOCATIONS.find((m) => m.tag === tag) ?? MOUNTAIN_LOCATIONS[0];
}
