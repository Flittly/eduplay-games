/**
 * 地图点击的命中判定（v1.5.3）：点下去的这一下，落在**哪一条**地理要素上。
 *
 * ## 为什么单独一个模块
 *
 * 这个判断错起来全是静默的 —— 点太行山弹出青藏高原、点空白处弹出天山，
 * 画面上都"有反应"，只是反应错了，截图看不出来，只能一条条点着试。
 * 所以规则抽出来、不依赖 React 与 DOM，用 Node 直接跑（`scripts/game.test.cjs`
 * 第 11 段），把"38 条的锚点逐条点一遍都能命中自己"这种覆盖写成断言。
 *
 * ## 判定顺序（三条，都为"所见即所得"服务）
 *
 * ① **名字**：点在某个锚点带内（半径见 `ANCHOR_RADIUS_DEG`）⇒ 判给**最近**的那个锚点。
 *    锚点就是地图上写名字的地方，所以这一条等于"点在名字上就看这条"。
 *    它专门救一个实测出来的冲突：`长江中下游平原` 的锚点离 `大别山` 脊线只有
 *    0.31°，比走廊半宽（0.5°）还近 —— 少了这一条，"点着「长江中下游平原」
 *    那几个字，弹出来的是大别山"。
 *
 *    ⚠️ 这一带的半径对**山脉**要再截一刀：不能超过这条山脉自己的走带半宽。
 *    横断山脉的走带只有 0.28°（一列平行山岭要收窄才数得出一条一条），
 *    而 0.375 的锚点带比它还宽 —— 不截的话，点它带子外面两三个像素也会弹出
 *    横断山脉，"点得中就是画得出"这条不变量就破了（回归里那条"走带外、
 *    落点容差内不命中山脉"就是抓这个的）。地形区没有这一刀：它自己就是一大片。
 * ② **山带**：落在某条山脉的走带走廊内 ⇒ 判给最近的那条山脉。
 * ③ **地块**：按区域归属格 ⇒ 判给那一格所属的地形区。
 *
 * ② 排在 ③ 前面，是这条流水线里最要紧的一处取舍：走廊是**画在色块上面**的
 * 那条凸起带（`ownerGrid` 里也是山脉后写、覆盖地形区），点它就该讲这条山脉。
 * 反过来的话（面优先），27 条山脉里有二十多条会被压在某个地形区底下
 * —— 昆仑山、祁连山、喜马拉雅全在青藏高原的格子里 —— 等于山脉在图鉴里
 * 只能靠右侧目录点开，用户要的"点地图上的要素"就落空了。
 *
 * ## ②③ 的容差都取自**已经存在**的口径，不新发明
 *
 * · **地形区（面）**：查区域归属位图 —— `regionGrid[grid] === area.gridId`。
 *   这正是 `App.tsx` 的 `applyItem` 塑形时写的同一批格子（`data.region[k] === gid`
 *   ⇒ `liftTarget[k] = 1`），也是 `judgeAreaDrop` 落点判定用的同一张表。
 *   三处同源，于是"看得见的色块 / 点得中的范围 / 拖上去算对的范围"永远一致。
 *
 * · **山脉（线）**：`distToRange(...) <= corridorHalfDeg(range)` —— 走廊半宽
 *   取自 `geo.ts`，与 `buildRidge` 塑形用的是**同一个函数**。
 *   所以"点得中"就是"画得出"，横断山脉那种带 `lift_half_deg` 的自动收窄。
 *
 * ⚠️ **不要拿 `RANGE_TOL_DEG`（0.55°）当点击容差。** 那个是**落点**容差，
 *    比走廊宽得多（0.55 vs 0.50，横断是 0.28），是刻意留给学生的宽容度；
 *    拿它做命中会让山脉把手伸到自己那条带子外面，把周围的地形区整片吃掉 ——
 *    点塔里木盆地弹出天山，而且只在边缘一带发生，最难归因。
 *    回归里有一条断言专门盯这层窗口：走廊外、落点容差内必须**不**命中山脉。
 *
 * ## 过滤"谁能点"是调用方的事
 *
 * 传进来的 `targets` 里应当**只有此刻在图上、可以点开的条目**
 * （答题模式 = 已归位；图鉴 = 全部）。这样"山脉还没塑、点在它的位置上"
 * 会自动落到那片的地形区上 —— 那个回落不需要写一条分支，是"候选里没有它"
 * 自然得到的结果。
 */

import { SRC_W, corridorHalfDeg, distToPoint, distToRange, gridIndex } from "./geo";
import type { RangeDef } from "./data/regions";

/**
 * 锚点带半径（度）。这个数不是拍的，三个约束全是实测：
 *
 * · **下限 0.31** —— `长江中下游平原` 的锚点离 `大别山` 脊线 0.31°，不盖住它就会
 *   "点着名字却弹出隔壁那条山脉"；
 * · **上限 0.53** —— 全图最近的两个锚点（`长江中下游平原` ↔ `大别山`）相距 1.06°，
 *   超过一半就会两个锚点互相抢，而且谁赢取决于小数点后第三位；
 * · **越小越好** —— 它会让名字附近的点击从山脉走带里"拿走"一小块：
 *   0.375° 实测拿走 46 / 14462 = **0.32%** 的走廊格（0.6° 就涨到 0.78%，
 *   并且开始吃到巫山）。
 *
 * （导出是为了让回归能直接断言"这个数落在两个边界之间" —— 而不是在测试里
 *   再抄一份 0.375。）
 */
export const ANCHOR_RADIUS_DEG = 0.375;

/**
 * 能被点中的东西。**结构化最小接口**：不 import App.tsx 的 `Item`
 * （那会把 React 拽进来），只要"有 id 之外还能看出是面还是线"就行。
 */
export interface PickTarget {
  id: string;
  /**
   * 地形区才有：在区域归属位图里的编号 + **写名字的位置**（锚点）。
   * 锚点要参与判定 —— 见文件头那条"名字优先"。
   */
  area?: { gridId: number; anchor: [number, number] };
  /** 山脉才有 */
  range?: RangeDef;
}

export interface FeatureHit<T> {
  item: T;
  /**
   * 命中依据：
   * `anchor` = 落在它的名字附近（最近的那个锚点）；`corridor` = 落在山脉走带里；
   * `grid` = 落在该地形区的归属格上。
   */
  via: "anchor" | "corridor" | "grid";
  /** 到命中依据那个东西的距离（度）：锚点带 / 走带都有，地形区为 null */
  distDeg: number | null;
}

/**
 * @param lon,lat    点击位置（经纬度，由 `terrain.pick()` 从画布坐标反算）
 * @param targets    候选条目（**只放此刻可点开的**）
 * @param regionGrid 区域归属位图。传 `buildTerrainData().src.region`
 *                   （**原经纬度栅格**那份，不是投影网格那份）
 */
export function pickFeature<T extends PickTarget>(
  lon: number,
  lat: number,
  targets: readonly T[],
  regionGrid: Uint8Array
): FeatureHit<T> | null {
  // ① 名字：锚点带内取最近的那一条（见文件头与 ANCHOR_RADIUS_DEG）。
  //    山脉的锚点带要截到它自己的走带半宽以内 —— 否则"名字附近"会伸到画出来的
  //    带子外面（横断山脉的走带只有 0.28°，比 0.375 还窄）。
  let bestNamed: T | null = null;
  let bestNamedD = Infinity;
  for (const t of targets) {
    const a = t.area ? t.area.anchor : t.range ? t.range.anchor : null;
    if (!a) {
      continue;
    }
    const reach = t.range ? Math.min(ANCHOR_RADIUS_DEG, corridorHalfDeg(t.range)) : ANCHOR_RADIUS_DEG;
    const d = distToPoint(lon, lat, a);
    if (d <= reach && d < bestNamedD) {
      bestNamedD = d;
      bestNamed = t;
    }
  }
  if (bestNamed) {
    return { item: bestNamed, via: "anchor", distDeg: bestNamedD };
  }

  // ② 山带：走带内的取**最近**的一条。
  //    取最近而不是"第一条命中的"，是为了让交会处（太行山与燕山在北部相撞）
  //    给出确定的结果 —— 与 `judgeRangeDrop` 里"最近的那条必须是它"同口径。
  let bestRange: T | null = null;
  let bestD = Infinity;
  for (const t of targets) {
    if (!t.range) {
      continue;
    }
    const d = distToRange(lon, lat, t.range);
    if (d <= corridorHalfDeg(t.range) && d < bestD) {
      bestD = d;
      bestRange = t;
    }
  }
  if (bestRange) {
    return { item: bestRange, via: "corridor", distDeg: bestD };
  }

  // ③ 地块：这一格归谁。0 = 不属于任何地形区（含海面）
  /*
   * ⚠️ 这里用的是 `SRC_W`（**原经纬度栅格**的宽度），不是 `GRID_W`
   * （投影网格）。v2.0.0 起这两个数不一样了（480 vs 575），
   * 传错的表现是"点的位置和弹出来的条目差着一百多公里"——
   * 而它只在命中③这条路径上出现，① ② 两条（锚点带 / 走带）都对，
   * 所以看起来像"有些地方点不准"，极难归因。
   */
  const { i, j } = gridIndex(lon, lat);
  const gridId = regionGrid[j * SRC_W + i];
  if (!gridId) {
    return null;
  }
  const area = targets.find((t) => t.area?.gridId === gridId);
  return area ? { item: area, via: "grid", distDeg: null } : null;
}
