/**
 * 本局计划：把「练习范围 × 起始地图」换算成两串条目 id（v1.2.0）。
 *
 * ## 为什么这两件事要合成一个模块
 *
 * 用户提的是两条独立需求：
 *   1「一上来就是空白的，难度有些高，可以开发低难度模式，就是图上已经有了很多的地形，
 *      只需要补充上面的没有的即可，每次随机」；
 *   2「高原、盆地、平原、山脉同时可以分，地图上只缺少高原/盆地/平原/山脉，针对性训练」。
 *
 * 看上去是两件事，其实是**同一件事的两种触发方式**：
 *   - 低难度 = 从"本局范围"里随机留一部分已经塑好；
 *   - 分类专练 = 本局范围只留下某一类，其余**整类**已经塑好。
 *
 * 共同点都是「有一批条目**不由学生完成**」。所以这里只产出两个集合：
 *
 *   - `required` —— 本局要学生塑的（分母、结算判定、上报的 totalCount 都用它）
 *   - `preset`   —— 一进场就已经在图上、且**不属于任何人的成绩**（不计分、不记归属）
 *
 * 分成两件事写，就会出现"预置的地形算不算进度""算不算某人的塑成"这类
 * 在两条代码路径上给出不同答案的分歧 —— 一台机器两个口径，迟早对不上。
 *
 * ## 为什么预置的条目不计入成绩
 *
 * 预置是"老师划定的起点"，不是"某个学生塑出来的"。写进 `placed` 会有三个后果：
 * ① 进度条起点不是 0，学生以为自己少了 23 张；
 * ② 结算页的"塑成 N 张"虚高，上报给平台的 `correctCount` 也跟着虚高；
 * ③ 地块上会挂一个根本没有归属人的"谁塑的"标记。
 * 所以 `preset` 与 `placed` 是**两个集合**，只有 `placed` 进成绩。
 * 界面上"这块地已经完成了"这件事由 `isSettled()` 回答，答案 = 两个集合的并集。
 *
 * ## 随机要能被复现
 *
 * "每次随机"意味着不能把预置集合写死在数据里。但回归脚本又必须能复现同一局，
 * 所以随机源是**注入**的：产品传 `Math.random`，测试传 `mulberry32(seed)`。
 * 这样"随机"和"可复现"不用二选一，也不必往产品里塞测试开关。
 *
 * 本模块不依赖 React / DOM，可以直接在 Node 里跑回归（见 `scripts/game.test.cjs`）。
 */

/** 练习范围。`all` 之外每项对应数据里的一类条目 */
export type Scope = "all" | "plateau" | "basin" | "plain" | "hills" | "range";
/** 起始地图：`blank` 全空（原版），`easy` 随机预置一部分 */
export type StartMode = "blank" | "easy";

/**
 * 条目在"练习范围"这一维度上的身份 —— 由数据侧给出，别在这里猜分组名。
 *
 * ⚠️ 这五个字面量**必须**与 `regions.ts` 的 `AreaKind` 对齐：App 侧是直接
 * `scopeKey: d.kind` 拿过来的，少一个就会在那边报类型错（而报错位置看着
 * 跟"分组"毫无关系）。加一类地形 = 同时改 `AreaKind` + 这里的 `Scope` /
 * `ScopeKey` + 下面 `SCOPES` 的按钮表。
 */
export type ScopeKey = "plateau" | "basin" | "plain" | "hills" | "range";

export interface PlanItem {
  id: string;
  scopeKey: ScopeKey;
}

export interface ScopeDef {
  scope: Scope;
  label: string;
  note: string;
}

/**
 * 低难度模式下**保留**（预置）的比例。
 *
 * 取 0.6 是照用户那句"图上已经有了很多的地形，只需要补充上面的没有的"定的：
 * 38 张里留 23、要塑 15，一次课的时间刚好；再高就只剩个位数要塑，
 * 学生会觉得"点两下就结束了"，反而没有练习量。
 */
export const EASY_KEEP = 0.6;

/** 任何一局至少要有这么多张留给学生，否则这一局没有意义（只剩 1 张时保底 1 张） */
const MIN_REQUIRED = 2;

/** 确定性随机源（mulberry32）。测试用固定种子复现同一局 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(arr: T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

export interface RoundPlan {
  /** 本局要学生塑的条目，**按原始顺序**（卡片列表、提示序号都用它，顺序必须稳定） */
  required: string[];
  /** 一进场就已在图上的条目，也按原始顺序（归属图按这个顺序落盘，结果可复现） */
  preset: string[];
}

/**
 * 算出本局的两串条目。
 *
 * `preset` 与 `required` 的并集恒等于全部条目、交集恒为空 ——
 * 这两条不变量在 `scripts/game.test.cjs` 里对 5×2 共 10 种组合逐一断言过。
 * 少了任何一条，都会出现"某张卡既不用塑又没在图上"（永远打不完）
 * 或"某张卡既在图上又能塑"（分数算两遍）这类死局。
 */
export function planRound(
  items: PlanItem[],
  scope: Scope,
  start: StartMode,
  rng: () => number = Math.random
): RoundPlan {
  const inScope = (it: PlanItem): boolean => scope === "all" || it.scopeKey === scope;
  const poolIds = items.filter(inScope).map((it) => it.id);

  const keep = new Set<string>();
  if (start === "easy" && poolIds.length > 1) {
    // 至少留 MIN_REQUIRED 张（但池子本来就比这个小的时候不硬凑）
    const floor = Math.max(1, Math.min(MIN_REQUIRED, poolIds.length - 1));
    let keepCount = Math.round(poolIds.length * EASY_KEEP);
    if (poolIds.length - keepCount < floor) {
      keepCount = poolIds.length - floor;
    }
    for (const id of shuffled(poolIds, rng).slice(0, keepCount)) {
      keep.add(id);
    }
  }

  // 范围之外的**整类**都预置：这正是"地图上只缺高原"的实现方式
  const presetSet = new Set<string>(keep);
  for (const it of items) {
    if (!inScope(it)) {
      presetSet.add(it.id);
    }
  }

  return {
    required: items.filter((it) => inScope(it) && !presetSet.has(it.id)).map((it) => it.id),
    preset: items.filter((it) => presetSet.has(it.id)).map((it) => it.id)
  };
}

/** 练习范围的选项表（大厅与"本局待塑"筛选共用一处文案） */
export const SCOPES: ScopeDef[] = [
  { scope: "all", label: "全部", note: "四大高原 + 四大盆地 + 三大平原 + 东南丘陵 + 27 条山脉，一次塑完整幅中国地形。" },
  { scope: "plateau", label: "只练高原", note: "地图上只有四大高原是空的，盆地、平原、丘陵、山脉都已经在图上。" },
  { scope: "basin", label: "只练盆地", note: "只补四大盆地，其余地形已就位，先把盆地的位置钉牢。" },
  { scope: "plain", label: "只练平原", note: "只补三大平原，重点记住它们都在东部第三级阶梯上。" },
  { scope: "hills", label: "只练丘陵", note: "只补东南丘陵 —— 我国面积最大的丘陵，地面起伏和缓，与横断山区正好相反。" },
  { scope: "range", label: "只练山脉", note: "只补 27 条山脉的走向，高原盆地平原丘陵都已经在图上。" }
];

export const STARTS: { start: StartMode; label: string; note: string }[] = [
  { start: "blank", label: "空白地图", note: "本局范围内的地形全部由学生塑，难度最高。" },
  { start: "easy", label: "随机预置", note: "范围内先随机塑好约六成，只补缺的那些，每次开局都不一样。" }
];

/** 默认就是 v1.0.0/v1.1.0 的老手感：整幅空白、全部要塑 */
export const DEFAULT_SCOPE: Scope = "all";
export const DEFAULT_START: StartMode = "blank";

/**
 * 本局要塑多少张 —— **不含随机**，所以大厅能在还没开局时就把这个数报出来。
 *
 * 单独抽一个函数是为了让大厅的"本局要塑 15 张"和真正开局后的分母
 * 出自同一个算法。各写一遍的话，两个数字一旦不一致，学生第一眼就会
 * 看到"大厅说 15 张、进来变成 14 张"，然后不再信任任何一个数。
 */
export function plannedCount(items: PlanItem[], scope: Scope, start: StartMode): number {
  const n = items.filter((it) => scope === "all" || it.scopeKey === scope).length;
  if (start !== "easy" || n <= 1) {
    return n;
  }
  const floor = Math.max(1, Math.min(MIN_REQUIRED, n - 1));
  let keepCount = Math.round(n * EASY_KEEP);
  if (n - keepCount < floor) {
    keepCount = n - floor;
  }
  return n - keepCount;
}
