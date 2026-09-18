/**
 * 多人接力会话（v1.1.0 新增，v1.2.0 加上"本局计划"，v1.3.0 加上图鉴）。
 *
 * ## 一张地图，轮流答题
 *
 * 课堂上更自然的做法是**全班合力塑一幅中国地形图**：讲台上一张图，
 * 学生一个接一个上来放卡片，谁放的、放对了几张、拿了多少分，
 * 各记各的。所以这里的地图状态（`placed`）是**全局共用**的，
 * 而记分状态（`GameState`）是**每人一份**。
 *
 * 之所以把每人的状态整份留着而不是"只留一个总分"：
 * 记分规则本身是带状态的 —— 同一张卡第几次才放对（`attemptOf`）、
 * 当前连击（`streak`）、一次答对率（`firstTry`）—— 这些都要按人算。
 * 直接复用 `game.ts` 里那套函数，等于复用已经回归过的规则，
 * 不必为一个"多人版"再写一份会走样的积分代码。
 *
 * ## 两种模式的区别只在"什么时候换人"
 *
 * - `relay`（轮流答题）：**放对一张就换下一位**，全自动轮转。
 * - `pick` （指定答题人）：不自动换，老师点谁谁答，答到换人为止。
 *
 * 两种模式下**放错都不换人**。这一条是刻意的：如果答错就换人，
 * 学生很快会发现"答错＝把难题丢给下一个人"，于是乱丢一气，
 * 反而比认真想更划算 —— 那是把规则设计成了反激励。
 * 放错扣 5 分已经足够让"想清楚再放"划算，不需要再动用换人。
 *
 * 这一层不依赖 React，可以像 `game.ts` 一样直接在 Node 里跑回归。
 *
 * ## v1.2.0：本局计划（`required` / `preset`）
 *
 * 低难度模式与"只练某一类"都要在地图上**先摆好一批地形**。
 * 这批地形与"学生塑出来的"是两件事，所以是两个集合：
 * 只有 `placed` 进成绩，`preset` 只影响"图上有没有"。
 * 判断"这块地完成了没有"一律走 `isSettled()`，别用 `isPlaced()`。
 *
 * ## v1.3.0：图鉴（`createAtlasSession`）
 *
 * 三种玩法里只有图鉴**不是**答题 —— 它是"整幅地形都在图上、慢慢看"。
 * 实现上就是把上面的机制推到极端（全预置 / 零待塑 / 无人），
 * 详见 `createAtlasSession` 上方的注释。
 */
import {
  applyCorrect,
  applyHint,
  applyWrong,
  createState,
  gainFor,
  gradeOf,
  type GameState,
  type Grade,
  type ItemKind
} from "./game";

export type PlayMode = "relay" | "pick";

export interface PlayerInfo {
  studentId: number;
  studentName: string;
  className?: string | null;
  studentNo?: string;
}

export interface TurnLog {
  studentId: number;
  studentName: string;
  itemId: string;
  kind: ItemKind;
  /** 这次放对拿了多少分 */
  gained: number;
}

/** 本局计划（由 `plan.ts` 算出）：哪些要学生塑、哪些一进场就已经在图上 */
export interface SessionPlan {
  required: string[];
  preset: string[];
}

const EMPTY_PLAN: SessionPlan = { required: [], preset: [] };

export interface Session {
  mode: PlayMode;
  /** 学生顺序（平台下发名单的顺序，也就是讲台上的座位顺序） */
  order: number[];
  names: Record<number, string>;
  /** 当前答题人在 `order` 里的下标 */
  cursor: number;
  /** 每人一份记分状态 */
  rounds: Record<number, GameState>;
  /** 共用地图上**由学生**归位的条目，按归位先后 */
  placed: string[];
  /** 本局要学生塑的条目（进度分母、结算判定、上报 totalCount 都用它） */
  required: string[];
  /**
   * 一进场就已在图上的条目（v1.2.0：低难度与分类专练）。
   *
   * ⚠️ **刻意与 `placed` 分开**，理由见 `plan.ts` 的文件头：
   * 预置是老师划定的起点，不是哪个学生塑出来的 —— 写进 `placed` 会让
   * 进度起点、结算的"塑成 N 张"、上报的 `correctCount` 一起虚高，
   * 还会给地块挂上一个没有归属人的"谁塑的"标记。
   * 界面上问"这块地完成了没有"要问 `isSettled()`（两个集合的并集）。
   */
  preset: string[];
  /** 每条是谁放的（结算页要说"这块是某某塑出来的"） */
  owner: Record<string, number>;
  turns: TurnLog[];
  /** 每人作为答题人的累计秒数 */
  seconds: Record<number, number>;
}

export function createSession(
  players: PlayerInfo[],
  mode: PlayMode,
  plan: SessionPlan = EMPTY_PLAN
): Session {
  const order = players.map((p) => p.studentId);
  const names: Record<number, string> = {};
  const rounds: Record<number, GameState> = {};
  const seconds: Record<number, number> = {};
  for (const p of players) {
    names[p.studentId] = p.studentName;
    rounds[p.studentId] = createState();
    seconds[p.studentId] = 0;
  }
  return {
    mode,
    order,
    names,
    cursor: 0,
    rounds,
    placed: [],
    required: plan.required.slice(),
    preset: plan.preset.slice(),
    owner: {},
    turns: [],
    seconds
  };
}

/**
 * 图鉴会话（v1.3.0）：整幅地形都在图上，**没有人在答题**。
 *
 * ## 为什么图鉴也走 `Session`
 *
 * 用户要的是"不需要答题的图鉴版本"。图鉴要回答的问题与答题模式是同一个：
 * 图上有什么、这块地归谁。另造一套"图鉴状态"等于把"这块地在图上了没有"
 * 回答两遍，两条代码路径迟早给出不同答案。
 *
 * 所以图鉴是一份**退化到极点的会话**，三个参数各封死一个方向：
 *
 * - `preset` = 全部条目 ⇒ 每条都 `isSettled()` 为真。界面里那条既有规则
 *   （已在图上的一律不给拖、但点得开，见 `App.tsx` 的 `onCardPointerDown`）
 *   随之生效 —— 图鉴**不必为卡片另写一套交互**，"点开看讲解"就是它要的行为；
 * - `required` = 空 ⇒ `requiredCount()` 为 0。结算判定是
 *   `total > 0 && placed.length === total`，这一步直接不成立：
 *   **图鉴在结构上不可能被判定为"做完了"**，因此绝不会触发上报。
 *   （真触发的话，平台会收到一批 0 分空成绩，把学生的积分记录弄脏。）
 * - `order` = 空 ⇒ `currentId()` 返回 `NO_CURRENT`，所有提交函数的
 *   第一道闸门 `studentId < 0` 全部挡住 ⇒ **不可能加分、不可能扣分、
 *   不可能换人**。不是"界面上没显示分数"，是分数根本不会产生。
 *
 * 这三个"封死"是可独立验证的：把任意一条改成非空/非全，图鉴立刻退化回
 * 答题模式 —— `scripts/game.test.cjs` 第 10 节对每一条都有断言守着。
 */
export function createAtlasSession(allIds: string[]): Session {
  return createSession([], "pick", { required: [], preset: allIds.slice() });
}

/**
 * 「当前没有答题人」的哨兵值（名单为空时）。
 *
 * ⚠ **学生的 id 不能是负数，尤其不能是 -1。** 这一层用 `id < 0` 判
 * "没人可记分"，所以负数 id 会被所有提交函数静默丢弃：
 * `commitCorrect` 直接返回原 session（不落位、不加分），
 * 而界面那边 `cur >= 0` 也不成立（记分板显示 0、讲解卡不说"下一位"）。
 * 症状是"提示一切正常、地图纹丝不动"，极难定位。
 *
 * 这条不是理论风险：v1.1.0 的体验模式（`GUEST_ROSTER`）最早写的就是
 * `studentId: -1`，于是单人预览时 38 张卡一张都落不下去 —— 真机渲染回归
 * 抓出来的。现在虚拟学生用一个显眼的正数（见 `main.tsx`）。
 */
export const NO_CURRENT = -1;

export function currentId(session: Session): number {
  return session.order.length === 0 ? NO_CURRENT : session.order[session.cursor];
}

export function currentName(session: Session): string {
  const id = currentId(session);
  return id < 0 ? "" : session.names[id] ?? "";
}

export function roundOf(session: Session, studentId: number): GameState {
  return session.rounds[studentId] ?? createState();
}

export function isPlaced(session: Session, itemId: string): boolean {
  return session.placed.includes(itemId);
}

/**
 * 这张卡"已经在图上"了没有 —— **学生塑的 ∪ 一进场就预置的**。
 *
 * 界面上凡是问"这块地还要不要学生动手"的地方，一律问这个函数，
 * 别去问 `isPlaced`：拿 `isPlaced` 当"完成"用的话，预置的地块会被当成
 * 还没塑，学生拖上去还能再加一次分（同一块地算两遍）。
 */
export function isSettled(session: Session, itemId: string): boolean {
  return session.placed.includes(itemId) || session.preset.includes(itemId);
}

/** 本局还要学生塑的条目（进度分母）。计划缺失时退化成 0，调用方自己保证传了计划 */
export function requiredCount(session: Session): number {
  return session.required.length;
}

/** 本局是不是已经全部完成 */
export function allSettled(session: Session): boolean {
  return session.required.length > 0 && session.required.every((id) => session.placed.includes(id));
}

/** 换人。`relay` 模式在放对之后由调用方触发；`pick` 模式只在点名时用 */
export function advance(session: Session): Session {
  if (session.order.length === 0) {
    return session;
  }
  return { ...session, cursor: (session.cursor + 1) % session.order.length };
}

/** 点名：把答题人切到某一位。名单外的人直接忽略，不改变状态 */
export function focusPlayer(session: Session, studentId: number): Session {
  const idx = session.order.indexOf(studentId);
  if (idx < 0 || idx === session.cursor) {
    return session;
  }
  return { ...session, cursor: idx };
}

export function setMode(session: Session, mode: PlayMode): Session {
  return session.mode === mode ? session : { ...session, mode };
}

export interface CorrectOutcome {
  session: Session;
  /** 加了多少分；0 表示这张已经被别人放过了 */
  gained: number;
  studentId: number;
  studentName: string;
}

/**
 * 放对：给当前答题人加分，并把这张卡记进共用地图。
 *
 * 已经归位的卡直接返回 `gained: 0` 且不改状态 —— 幂等。
 * ⚠️ 闸门用的是 `isSettled`（含预置），不是 `isPlaced`：
 * 预置的地块已经在图上了，学生再拖上去一次不该加第二次分。
 */
export function commitCorrect(session: Session, itemId: string, kind: ItemKind): CorrectOutcome {
  const studentId = currentId(session);
  if (studentId < 0 || isSettled(session, itemId)) {
    return { session, gained: 0, studentId, studentName: session.names[studentId] ?? "" };
  }
  const state = roundOf(session, studentId);
  if (state.placed.includes(itemId)) {
    return { session, gained: 0, studentId, studentName: session.names[studentId] ?? "" };
  }
  const gained = gainFor(state, itemId, kind);
  const next: Session = {
    ...session,
    rounds: { ...session.rounds, [studentId]: applyCorrect(state, itemId, kind) },
    placed: [...session.placed, itemId],
    owner: { ...session.owner, [itemId]: studentId },
    turns: [
      ...session.turns,
      { studentId, studentName: session.names[studentId] ?? "", itemId, kind, gained }
    ]
  };
  // 轮流答题：放对一张就换下一位。指定答题人模式不动
  return {
    session: next.mode === "relay" ? advance(next) : next,
    gained,
    studentId,
    studentName: session.names[studentId] ?? ""
  };
}

/** 放错：扣当前答题人的分，**不换人**（理由见文件头） */
export function commitWrong(session: Session): Session {
  const studentId = currentId(session);
  if (studentId < 0) {
    return session;
  }
  return {
    ...session,
    rounds: { ...session.rounds, [studentId]: applyWrong(roundOf(session, studentId)) }
  };
}

/** 用提示：算作该条目多试了一轮，并扣提示费 —— 与单人版同一条规则 */
export function commitHint(session: Session, itemId: string): Session {
  const studentId = currentId(session);
  if (studentId < 0 || isSettled(session, itemId)) {
    return session;
  }
  return {
    ...session,
    rounds: { ...session.rounds, [studentId]: applyHint(roundOf(session, studentId), itemId) }
  };
}

/** 累计答题时间（App 在每次换人 / 结算时把这段时间记账到当时那位身上） */
export function addSeconds(session: Session, studentId: number, sec: number): Session {
  if (studentId < 0 || !(studentId in session.seconds) || sec <= 0) {
    return session;
  }
  return {
    ...session,
    seconds: { ...session.seconds, [studentId]: (session.seconds[studentId] ?? 0) + sec }
  };
}

export interface SessionResult {
  studentId: number;
  studentName: string;
  score: number;
  timeSeconds: number;
  correctCount: number;
  totalCount: number;
  /** 放错次数 */
  mistakes: number;
  firstTry: number;
  bestStreak: number;
}

/** 上报平台用的成绩单，按得分从高到低 */
export function resultsOf(session: Session, totalItems: number): SessionResult[] {
  return session.order
    .map((studentId) => {
      const state = roundOf(session, studentId);
      return {
        studentId,
        studentName: session.names[studentId] ?? "",
        score: state.score,
        timeSeconds: Math.round(session.seconds[studentId] ?? 0),
        correctCount: state.placed.length,
        totalCount: totalItems,
        mistakes: state.wrongCount,
        firstTry: state.firstTry,
        bestStreak: state.bestStreak
      };
    })
    .sort((a, b) => b.score - a.score || b.correctCount - a.correctCount);
}

/**
 * 全班作为一个整体的评级。
 *
 * 拼一份"合计状态"再交给 `gradeOf`，而不是另写一套评级标准 ——
 * 单人版那套（看一次答对率、放错次数）在班级尺度上同样成立，
 * 而且两边口径一致，学生的体感才对得上。
 */
export function classGrade(session: Session, totalItems: number): Grade {
  let score = 0;
  let wrongCount = 0;
  let firstTry = 0;
  let bestStreak = 0;
  for (const id of session.order) {
    const s = roundOf(session, id);
    score += s.score;
    wrongCount += s.wrongCount;
    firstTry += s.firstTry;
    bestStreak = Math.max(bestStreak, s.bestStreak);
  }
  const flat: GameState = {
    score,
    placed: session.placed,
    attemptOf: {},
    wrongCount,
    firstTry,
    streak: 0,
    bestStreak,
    history: []
  };
  return gradeOf(flat, totalItems);
}
