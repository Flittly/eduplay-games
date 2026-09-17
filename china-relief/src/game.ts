/**
 * 纯逻辑：积分规则、答题状态机、结算评级。
 *
 * 与 geo.ts 一样不依赖 React/three，可以直接在 Node 里跑回归。
 *
 * ## 积分规则（v0.0.1）
 *
 * | 事件 | 变化 |
 * |---|---|
 * | 地形区放对 | +20 × 尝试系数 |
 * | 山脉放对 | +12 × 尝试系数 |
 * | 放错 | −5 |
 * | 连续 3 次一次答对 | 额外 +15（连击奖励） |
 * | 用一次「看轮廓」提示 | −8（该条目尝试次数 +1，所以分数也会掉一档） |
 *
 * 尝试系数：第 1 次 ×1.0、第 2 次 ×0.6、第 3 次及以后 ×0.3。
 *
 * **为什么"放错"要扣分而不是不扣**：这是课堂练习，不是考试。
 * 不扣分的话，学生的最优策略是"把卡片挨个往地图上乱丢"—— 反正丢错没代价，
 * 试 11 次总能试出来，地形区的位置反而学不进去。扣 5 分（远小于放对的 20 分）
 * 让"想清楚再放"始终划算，又不至于一次失误就打击积极性。
 *
 * **为什么要把"尝试次数"算进系数**：同一张卡第二次放对只拿 6 成，
 * 是为了让"第一次就答对"有价值，同时不把答错的学生一棍子打死 ——
 * 他仍然能拿分、能通关，只是拿不到满分。
 */

export type ItemKind = "area" | "line";

export interface HistoryEntry {
  id: string;
  kind: ItemKind;
  /** 是第几次尝试才放对的（1 = 一次答对） */
  attempt: number;
  points: number;
}

export interface GameState {
  score: number;
  /** 已归位的条目 id */
  placed: string[];
  /** 每个条目答错过的次数 + 1 = 当前尝试序号 */
  attemptOf: Record<string, number>;
  /** 答错总次数 */
  wrongCount: number;
  /** 一次答对的条目数 */
  firstTry: number;
  /** 当前连击（一次答对才续） */
  streak: number;
  bestStreak: number;
  history: HistoryEntry[];
}

export const BASE_POINTS: Record<ItemKind, number> = { area: 20, line: 12 };
export const WRONG_PENALTY = 5;
export const HINT_COST = 8;
export const STREAK_BONUS = 15;
export const STREAK_STEP = 3;
export const MIN_SCORE = 0;

export function createState(): GameState {
  return {
    score: 0,
    placed: [],
    attemptOf: {},
    wrongCount: 0,
    firstTry: 0,
    streak: 0,
    bestStreak: 0,
    history: []
  };
}

/** 第 n 次尝试的系数（n 从 1 开始） */
export function attemptFactor(attempt: number): number {
  if (attempt <= 1) {
    return 1;
  }
  if (attempt === 2) {
    return 0.6;
  }
  return 0.3;
}

export function pointsFor(kind: ItemKind, attempt: number): number {
  return Math.round(BASE_POINTS[kind] * attemptFactor(attempt));
}

/**
 * 这一条现在放对能拿多少分（含连击奖励），没得过分才有意义。
 *
 * 为什么单独抽出来：给学生的提示文案里要报「+N」，而记分板上的数字由
 * `applyCorrect` 算 —— 两个地方各写一个常数，就会出现「提示写 +20、
 * 记分板只加 12」这种自相矛盾（用过提示的条目要乘 0.6 系数）。
 * 学生一定会发现，而且会因此不再相信提示里的数字。所以两处共用一个算法。
 */
export function gainFor(state: GameState, id: string, kind: ItemKind): number {
  if (state.placed.includes(id)) {
    return 0;
  }
  const attempt = (state.attemptOf[id] ?? 0) + 1;
  const first = attempt === 1;
  const streak = first ? state.streak + 1 : 0;
  const bonus = first && streak > 0 && streak % STREAK_STEP === 0 ? STREAK_BONUS : 0;
  return pointsFor(kind, attempt) + bonus;
}

/** 放对。已经放对过的条目直接忽略（幂等），避免重复加分。 */
export function applyCorrect(state: GameState, id: string, kind: ItemKind): GameState {
  if (state.placed.includes(id)) {
    return state;
  }
  const attempt = (state.attemptOf[id] ?? 0) + 1;
  const gained = gainFor(state, id, kind);
  const first = attempt === 1;
  const streak = first ? state.streak + 1 : 0;
  return {
    ...state,
    score: state.score + gained,
    placed: [...state.placed, id],
    attemptOf: { ...state.attemptOf, [id]: attempt },
    firstTry: state.firstTry + (first ? 1 : 0),
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    history: [...state.history, { id, kind, attempt, points: gained }]
  };
}

/**
 * 放错。
 *
 * 扣分后不写回 attemptOf —— 当前这一格不算"尝试次数"，
 * 真正的次数在放对时才结算。否则学生在同一条山脉上连点五次，
 * 第五次放对只值 3 分，惩罚过重。
 */
export function applyWrong(state: GameState): GameState {
  return {
    ...state,
    score: Math.max(MIN_SCORE, state.score - WRONG_PENALTY),
    wrongCount: state.wrongCount + 1,
    streak: 0
  };
}

/** 用了一次提示：算作"多试了一轮"，所以该条目掉一档系数，并另扣提示费。 */
export function applyHint(state: GameState, id: string): GameState {
  const attempts = (state.attemptOf[id] ?? 0) + 1;
  return {
    ...state,
    score: Math.max(MIN_SCORE, state.score - HINT_COST),
    attemptOf: { ...state.attemptOf, [id]: attempts }
  };
}

export interface Progress {
  done: number;
  total: number;
  ratio: number;
  /** 一次答对的比例，用于评级 */
  firstTryRatio: number;
}

export function progressOf(state: GameState, total: number, totalItems: number): Progress {
  const done = state.placed.length;
  const answered = done + state.wrongCount;
  return {
    done,
    total,
    ratio: total === 0 ? 0 : done / total,
    firstTryRatio: answered === 0 ? 0 : state.firstTry / Math.max(done, 1)
  };
}

export interface Grade {
  key: "perfect" | "great" | "good" | "keep";
  label: string;
  comment: string;
}

/** 结算评级：看得分，也看"一次答对率"——后者才反映真的记住了位置。 */
export function gradeOf(state: GameState, total: number): Grade {
  const ratio = state.firstTry / Math.max(1, total);
  if (state.wrongCount === 0 && ratio >= 0.9) {
    return {
      key: "perfect",
      label: "地表学家",
      comment: "一条都没放错，中国地形已经在你脑子里立起来了。"
    };
  }
  if (ratio >= 0.7) {
    return {
      key: "great",
      label: "地势通",
      comment: "位置记得很牢，个别地方再看看说明书就更稳了。"
    };
  }
  if (ratio >= 0.4) {
    return {
      key: "good",
      label: "正在成图",
      comment: "大致骨架有了，把还含糊的那几块对着地图再过一遍。"
    };
  }
  return {
    key: "keep",
    label: "再来一轮",
    comment: "先点开卡片看看每个地形区在哪儿，再回来塑形会顺很多。"
  };
}

/**
 * 拖动落偏了要弹回，弹回时给个方向感的话。
 *
 * `dLon / dLat` 是「**从落点走到锚点**要走的位移」，所以它的符号直接就是
 * 学生该往哪边走：落点在锚点南边时 dLat > 0，提示就该是「往偏北方向找」。
 * （`lat` 越大越靠北；落到 28°N 而锚点在 33.86°N，要往北走 5.86°。）
 *
 * 这里曾经把两个符号都写反了 —— 落在南边却说「往偏南方向找」。
 * 学生照着走只会离目标更远，而这件事从界面上完全看不出是 bug，
 * 只会让人觉得"这提示没用"。`scripts/game.test.cjs` 里有四个方位的断言守着。
 */
export function distanceHint(lon: number, lat: number, anchor: [number, number]): string {
  const dLon = anchor[0] - lon;
  const dLat = anchor[1] - lat;
  // 90 km/度经线 = 111.32 × cos(36°)，与地图自己的横向缩放一致，别改成 111
  const km = Math.round(Math.hypot(dLon * 90, dLat * 111));
  // 中文合成方位是"东西在前、南北在后"：东南 / 东北 / 西南 / 西北。
  // 顺序写反会拼出「南东」这种词。早先这里还有第二个毛病：攒成 ["偏南","偏东"]
  // 再 join("偏")，于是拼出「往偏南偏偏东方向找」—— 两个"偏"叠在一起。
  const ns = Math.abs(dLat) > 1.2 ? (dLat > 0 ? "北" : "南") : "";
  const ew = Math.abs(dLon) > 1.2 ? (dLon > 0 ? "东" : "西") : "";
  if (ns === "" && ew === "") {
    return "很接近了，再挪一点点";
  }
  return `大概还差 ${km} 公里，往${ew}${ns}方向找`;
}
