/**
 * 《捕鱼达人 · 洋流版》纯逻辑引擎
 * ================================
 *
 * 这个文件**不 import React、不碰 DOM**，所以可以直接被 Node 单测
 * （照 china-relief/src/game.ts 的范式）。
 *
 * 它负责四件事：
 *   1. 出题：给一个海域，生成「这是什么洋流」的四个选项（含强制干扰项）
 *   2. 判定：第一问（认名称）+ 第二问（判方向），两层全对才起网
 *   3. 计分：按洋流品质结算渔获，叠加连击
 *   4. 进度：环流集齐、下网次数、通关判定
 */

import {
  CURRENTS,
  CONFUSABLE_PAIRS,
  GYRES,
  NO_SOLO_ZONE,
  QUALITY_RULES,
  STAGES,
  WIN_GYRES,
  playableCurrents,
  type Current,
  type CurrentKind,
  type FlowDirection,
  type Stage
} from "./data";
import { llToXY, normToXY } from "./proj";

/* ------------------------------------------------------------------ *
 * 一、随机数（种子化 —— 否则测试没法复现）
 * ------------------------------------------------------------------ */

/**
 * mulberry32：小而稳的种子随机数。
 * 合成/出题这类"可复现"的场景必须用它，不能用 Math.random。
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 洗牌（不改原数组）。 */
export function shuffle<T>(list: readonly T[], random: () => number): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 二、出题：选项生成（防作弊是硬要求）
 * ------------------------------------------------------------------ */

/** 一道选择题。 */
export interface Choice {
  id: string;
  name: string;
  kind: CurrentKind;
  /** 是否正确答案（结算时用来判，不在界面上暴露）。 */
  correct: boolean;
}

/**
 * 生成「这是什么洋流」的选项。
 *
 * 防作弊的两条硬约束（**不能放宽**）：
 *   1. **同性质至少一个**——否则学生看到红色就选暖流，根本不读名称；
 *   2. **同半球至少一个**——否则学生靠"南北半球"就能蒙对一半。
 *
 * 剩下的位置优先从**真实易混对**里抽——错的选项越像，这一题越有价值。
 */
export function buildOptions(
  target: Current,
  pool: Current[],
  random: () => number,
  optionCount = 4
): Choice[] {
  const others = pool.filter((c) => c.id !== target.id);

  // ① 先挑易混对里的对手（最有教学价值）
  const confusableIds = CONFUSABLE_PAIRS.filter(
    (p) => p.a === target.id || p.b === target.id
  ).map((p) => (p.a === target.id ? p.b : p.a));
  const confusable = others.filter((c) => confusableIds.includes(c.id));

  // ② 再挑"同性质 + 同半球"的（最容易看混）
  const sameBoth = others.filter(
    (c) =>
      c.kind === target.kind &&
      c.hemisphere === target.hemisphere &&
      !confusable.some((x) => x.id === c.id)
  );

  // ③ 兜底：同性质 / 同半球，各至少补一个
  const sameKind = others.filter(
    (c) =>
      c.kind === target.kind &&
      !confusable.some((x) => x.id === c.id) &&
      !sameBoth.some((x) => x.id === c.id)
  );
  const sameHemi = others.filter(
    (c) =>
      c.hemisphere === target.hemisphere &&
      !confusable.some((x) => x.id === c.id) &&
      !sameBoth.some((x) => x.id === c.id) &&
      !sameKind.some((x) => x.id === c.id)
  );
  const rest = others.filter(
    (c) =>
      !confusable.some((x) => x.id === c.id) &&
      !sameBoth.some((x) => x.id === c.id) &&
      !sameKind.some((x) => x.id === c.id) &&
      !sameHemi.some((x) => x.id === c.id)
  );

  const picked: Current[] = [];
  const take = (from: Current[], n: number) => {
    const shuffled = shuffle(from, random);
    for (const c of shuffled) {
      if (picked.length >= optionCount - 1 || n <= 0) break;
      if (!picked.some((p) => p.id === c.id)) {
        picked.push(c);
        n -= 1;
      }
    }
  };

  const need = optionCount - 1;
  // 易混对先占 1 个，其余按"同性质+同半球 → 同性质 → 同半球 → 其他"补
  take(confusable, 1);
  take(sameBoth, need - picked.length);
  take(sameKind, need - picked.length);
  take(sameHemi, need - picked.length);
  take(rest, need - picked.length);

  // 硬保证：同性质与同半球各至少一个（若池子太小无法满足，也不许放水——
  // 这里直接用剩下的兜，实在凑不齐就说明池子有问题，由测试兜住）
  const hasSameKind = picked.some((c) => c.kind === target.kind);
  const hasSameHemi = picked.some((c) => c.hemisphere === target.hemisphere);
  if (!hasSameKind || !hasSameHemi) {
    for (const c of others) {
      if (picked.length >= need) break;
      if (picked.some((p) => p.id === c.id)) continue;
      const fillsKind = !hasSameKind && c.kind === target.kind;
      const fillsHemi = !hasSameHemi && c.hemisphere === target.hemisphere;
      if (fillsKind || fillsHemi) picked.push(c);
    }
  }

  const choices: Choice[] = [
    { id: target.id, name: target.name, kind: target.kind, correct: true },
    ...picked
      .slice(0, optionCount - 1)
      .map((c) => ({ id: c.id, name: c.name, kind: c.kind, correct: false }))
  ];

  return shuffle(choices, random);
}

/* ------------------------------------------------------------------ *
 * 三、判定
 * ------------------------------------------------------------------ */

/**
 * 第二问的选项（初中版）。
 * ⚠️ 措辞按半球换：北半球暖流是"向高纬（向北）"，不能用统一说法。
 * ⚠️ 两个选项**必须都算出标签**（下面漏掉这一条就会渲染出一个空白按钮，
 *    而且它比另一个矮一半，看着像"排版坏了"）：
 *    高纬在北半球叫"向北"、在南半球叫"向南"；低纬反之。
 */
export function directionChoice(current: Current): {
  options: { value: FlowDirection; label: string }[];
  answer: FlowDirection;
} {
  const south = current.hemisphere === "S";
  const poleLabel = south ? "向高纬（向南）" : "向高纬（向北）";
  const equatorLabel = south ? "向低纬（向北）" : "向低纬（向南）";

  const options: { value: FlowDirection; label: string }[] = [
    { value: "pole-ward", label: poleLabel },
    { value: "equator-ward", label: equatorLabel }
  ];

  return { options, answer: current.direction };
}

/** 第一问判定。 */
export function judgeName(current: Current, chosenId: string): boolean {
  return current.id === chosenId;
}

/**
 * 第二问判定（初中版：二选一）。
 * 只有 `pole-ward` / `equator-ward` 参与；东西向的流在初中版按"向高纬/向低纬"近似问。
 */
export function judgeDirection(current: Current, chosen: FlowDirection): boolean {
  return current.direction === chosen;
}

/**
 * 第二问判定（高中版：在图上画箭头）。
 * 允许 ±45° 误差——学生手抖不该算错，方向对不对才是考点。
 *
 * ## 口径统一（v0.1.0 起必须走画布像素，不能混用经纬度）
 *
 * `drawn` 是玩家在屏幕上拖出来的，已经由 CurrentMap 归一化成 0~1 的**画布比例**；
 * 而 `current.arrow` 现在是**真实经纬度**。两者不是同一套坐标，直接相减没有意义。
 * 所以先把标准答案的经纬度端点用 `llToXY` 投到画布（1000×560），
 * 再把玩家那条乘上同一尺寸，两边都变成"画布像素方向"再比角度。
 *
 * ⚠️ 反过来（把玩家的画布坐标反投影成经纬度再比）**也能算对角度**，
 * 但要在纬度方向乘 cos 修正，容易写错、也不直观；
 * 统一到画布像素就不存在这个坑。
 */
export function judgeArrow(
  current: Current,
  drawn: { x1: number; y1: number; x2: number; y2: number }
): boolean {
  // 标准答案：经纬度 → 画布像素
  const a1 = llToXY(current.arrow.lon1, current.arrow.lat1);
  const a2 = llToXY(current.arrow.lon2, current.arrow.lat2);
  const ax = a2.x - a1.x;
  const ay = a2.y - a1.y;

  // 玩家画的：归一化比例 → 画布像素
  const b1 = normToXY({ x: drawn.x1, y: drawn.y1 });
  const b2 = normToXY({ x: drawn.x2, y: drawn.y2 });
  const bx = b2.x - b1.x;
  const by = b2.y - b1.y;

  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la === 0 || lb === 0) return false;
  const cos = (ax * bx + ay * by) / (la * lb);
  const cos45 = Math.SQRT1_2;
  // 方向一致即可，长度不参与判定
  return cos >= cos45;
}

/* ------------------------------------------------------------------ *
 * 四、计分
 * ------------------------------------------------------------------ */

/** 单条鱼的价值。品质越高越贵——顶级区单网价值约为普通区的 20 倍。 */
export const UNIT_PRICE: Record<number, number> = {
  5: 8,
  4: 6,
  3: 4,
  2: 2,
  1: 1
};

/** 单网鱼数范围（下界含、上界含）。 */
export const CATCH_RANGE: Record<number, [number, number]> = {
  5: [10, 14],
  4: [7, 10],
  3: [5, 7],
  2: [2, 4],
  1: [0, 1]
};

export interface CatchResult {
  fishCount: number;
  unitPrice: number;
  base: number;
  /** 连击加成后的最终分。 */
  total: number;
  /** 结算后的连击数。 */
  combo: number;
}

/**
 * 结算一网。
 * 连击规则：连续成功每多一次 +10% 加成，上限 +50%（第 5 次封顶）。
 * 为什么要有上限：否则一路顺下去后段分值爆表，前面的积累就没意义了。
 */
export function settleCatch(
  current: Current,
  comboBefore: number,
  random: () => number
): CatchResult {
  const [lo, hi] = CATCH_RANGE[current.quality] ?? [1, 1];
  const fishCount = lo + Math.floor(random() * (hi - lo + 1));
  const unitPrice = UNIT_PRICE[current.quality] ?? 1;
  const base = fishCount * unitPrice;
  const combo = comboBefore + 1;
  const bonus = Math.min(0.1 * comboBefore, 0.5);
  return {
    fishCount,
    unitPrice,
    base,
    total: Math.round(base * (1 + bonus)),
    combo
  };
}

/** 无鱼区（环流中心"海洋荒漠"）。 */
export function settleBarren(random: () => number): CatchResult {
  const fishCount = Math.floor(random() * 2); // 0 或 1
  const unitPrice = 1;
  return {
    fishCount,
    unitPrice,
    base: fishCount,
    total: fishCount,
    combo: 0
  };
}

/* ------------------------------------------------------------------ *
 * 五、对局状态
 * ------------------------------------------------------------------ */

/** 一次下网的三个阶段。 */
export type CastPhase =
  | "idle" // 等待玩家选海域
  | "ask-name" // 第一问：认名称
  | "ask-direction" // 第二问：判方向
  | "result"; // 结算展示

/** 追问流程里的临时数据。 */
export interface PendingCast {
  currentId: string;
  nameChoices: Choice[];
  /** 第一问是否已答对（决定要不要进第二问）。 */
  namePassed: boolean;
  /** 第二问是否已答对。 */
  directionPassed: boolean;
  /** 本网是否已经失败（失败就锁住，等玩家关闭结算卡）。 */
  failed: boolean;
  /** 失败原因，用于反馈文案。 */
  failReason: "name" | "direction" | "timeout" | null;
  /** 选错的选项 id，用于"你选的是 XX"这类反馈。 */
  wrongPickId: string | null;
}

export interface SessionState {
  stage: Stage;
  seed: number;
  castsLeft: number;
  castsUsed: number;
  score: number;
  combo: number;
  maxCombo: number;
  /** 本局已认对的洋流 id。 */
  recognized: string[];
  /** 认错过的次数，按 id 计。 */
  mistakes: Record<string, number>;
  /** 已集齐的环流 id。 */
  completedGyres: string[];
  /** 本局"看见过"的拓展洋流（不计入通关，只作提示）。 */
  metExtension: string[];
  won: boolean;
  over: boolean;
}

/** 开局。 */
export function createSession(stage: Stage, seed: number): SessionState {
  return {
    stage,
    seed,
    castsLeft: STAGES[stage].casts,
    castsUsed: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    recognized: [],
    mistakes: {},
    completedGyres: [],
    metExtension: [],
    won: false,
    over: false
  };
}

/**
 * 这一局的**可捕捞海域池**。
 * 排掉"交汇的另一方"（千岛寒流 / 拉布拉多寒流）——它们不设独立捕捞区。
 */
export function zonePool(stage: Stage): Current[] {
  return playableCurrents(stage);
}

/** 开局第一网：随机挑一个可捕捞海域。 */
export function pickZone(stage: Stage, random: () => number): Current {
  const pool = zonePool(stage);
  return pool[Math.floor(random() * pool.length)];
}

/** 玩家点了一处海域，开一道题。 */
export function startCast(
  current: Current,
  stage: Stage,
  random: () => number
): PendingCast {
  // ⚠️ 拓展层只认名称、不判方向 —— 这是分层最实在的落地。
  const isExtension = current.tier === "extension";
  return {
    currentId: current.id,
    nameChoices: buildOptions(current, zonePool(stage), random),
    namePassed: false,
    // 拓展层算作"第二问不需要"：直接置 true，起网流程就跳过了。
    directionPassed: isExtension,
    failed: false,
    failReason: null,
    wrongPickId: null
  };
}

/** 这一步是否需要追问方向。 */
export function needsDirection(current: Current): boolean {
  return current.tier !== "extension";
}

/** 应用会话变更（纯函数，返回新状态）。 */
export function applySession(
  state: SessionState,
  patch: Partial<SessionState>
): SessionState {
  return { ...state, ...patch };
}

/**
 * 记下一条洋流被认对。
 * 顺带检查环流是否因此闭合——**这是通关的唯一入口**（拓展层不参与）。
 */
export function recordRecognized(
  state: SessionState,
  currentId: string
): SessionState {
  const recognized = state.recognized.includes(currentId)
    ? state.recognized
    : [...state.recognized, currentId];

  const current = CURRENTS.find((c) => c.id === currentId);
  const metExtension =
    current?.tier === "extension" && !state.metExtension.includes(currentId)
      ? [...state.metExtension, currentId]
      : state.metExtension;

  // 环流闭合判定：只在**重点层**成员范围内算，拓展层不许进来。
  const completedGyres = [...state.completedGyres];
  for (const g of GYRES) {
    if (completedGyres.includes(g.id)) continue;
    const allCore = g.members.every((id) => {
      const c = CURRENTS.find((x) => x.id === id);
      return c?.tier === "core";
    });
    if (!allCore) continue;
    if (g.members.every((id) => recognized.includes(id))) {
      completedGyres.push(g.id);
    }
  }

  const won = WIN_GYRES.every((id) => completedGyres.includes(id));

  return {
    ...state,
    recognized,
    metExtension,
    completedGyres,
    won,
    // 集齐四大环流即通关；通关后不强制结束，允许把剩余下网次数用完
    over: state.over
  };
}

/** 记一次认错。 */
export function recordMistake(
  state: SessionState,
  currentId: string
): SessionState {
  return {
    ...state,
    mistakes: {
      ...state.mistakes,
      [currentId]: (state.mistakes[currentId] ?? 0) + 1
    },
    combo: 0
  };
}

/**
 * 结算页的「最常认错」。
 * 只报**真实易混对**里的组合——否则会报出一堆毫无关系的随机错。
 */
export function topConfusions(
  mistakes: Record<string, number>,
  limit = 3
): ConfusablePair[] {
  const scored = CONFUSABLE_PAIRS.map((p) => ({
    pair: p,
    // 一对里任一条被认错都算这一对的账
    hits: (mistakes[p.a] ?? 0) + (mistakes[p.b] ?? 0)
  }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  return scored.slice(0, limit).map((x) => x.pair);
}

export interface ConfusablePair {
  a: string;
  b: string;
  why: string;
}

/** 通关判定（供 UI 与测试共用同一个口径）。 */
export function isWon(state: SessionState): boolean {
  return WIN_GYRES.every((id) => state.completedGyres.includes(id));
}

/** 剩余可认的洋流数（重点层内、排除无独立捕捞区的）。 */
export function remainingCore(stage: Stage, state: SessionState): number {
  return zonePool(stage).filter((c) => !state.recognized.includes(c.id)).length;
}

/** 品质 → 星级字符串。 */
export function stars(quality: number): string {
  return "★".repeat(quality) + "☆".repeat(5 - quality);
}

/** 品质 → 文字档位。 */
export function qualityLabel(quality: number): string {
  return (
    {
      5: "顶级渔场",
      4: "高品渔场",
      3: "中品渔场",
      2: "普通海域",
      1: "无鱼区"
    }[quality] ?? "未知"
  );
}

/** 成因档位（解释卡标题用）。 */
export function reasonTier(quality: number): keyof typeof QUALITY_RULES {
  return (
    {
      5: "upwelling",
      4: "convergence",
      3: "shelf",
      2: "gyre",
      1: "barren"
    }[quality] as keyof typeof QUALITY_RULES
  ) ?? "shelf";
}

/** 排除"交汇搭档"的判定（UI 里画图要用到）。 */
export function isSoloZone(current: Current): boolean {
  return !(NO_SOLO_ZONE as readonly string[]).includes(current.id);
}
