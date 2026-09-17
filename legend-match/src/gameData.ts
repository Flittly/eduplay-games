/**
 * gameData —— 「图例消消乐」的纯逻辑层
 * ============================================================
 * 这里只放不依赖 DOM/React 的东西：随机数、关卡配置、抽牌、散落布局、
 * 以及整套配对状态机（matchReducer）。这样它们可以直接被 Node 测试覆盖
 * （scripts/*.test.cjs 用 rolldown 把本文件打成 CJS 后 require）。
 */
import type {
  CardLayout, CardSpec, LegendItem, MatchAction, MatchState
} from "./types";

// ---------------------------------------------------------------- 关卡配置
/** 六关逐关加量：对数 6 → 16。 */
export const LEVEL_PAIRS = [6, 8, 10, 12, 14, 16];
export const LEVEL_COUNT = LEVEL_PAIRS.length;

export const PAIR_POINTS = 100;
export const COMBO_STEP = 20;
export const COMBO_CAP = 5;
export const WRONG_PENALTY = 20;
export const HINT_PENALTY = 30;
export const HINTS_PER_LEVEL = 3;

/** 单张卡的最大旋转角（度）。旋转后的包围盒会撑大，布局时必须算进去。 */
export const MAX_ROT_DEG = 7;
/** 卡面宽高比（横向小卡片，名称才排得下）。 */
export const CARD_ASPECT = 1.3;
export const CARD_MAX_W = 168;
export const CARD_MIN_W = 56;
export const CARD_PAD = 4;

const DEG = Math.PI / 180;

export function pairsForLevel(levelIndex: number): number {
  const i = Math.max(0, Math.min(levelIndex, LEVEL_PAIRS.length - 1));
  return LEVEL_PAIRS[i];
}

export function totalPairs(): number {
  return LEVEL_PAIRS.reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------- 随机
/** 可复现的伪随机数（同一 seed 必然给出同一副牌面）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], rnd: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

// ---------------------------------------------------------------- 抽牌
/**
 * 按关卡抽图例。
 *
 * 难度曲线不靠"牌更多"单独支撑 —— 更要紧的是**同类干扰**：
 * 高关卡把候选池收窄到 2~3 个类别里（比如全是交通类），
 * 一堆长得像的符号混在一起才真正考人。
 *
 * 做法：类别按条目数从多到少排序，每关取一段"滑动窗口"，窗口宽度随关卡收窄；
 * 起点按关卡轮转，保证条目少的类别（地图基础 / 气候图线）也能轮到上场。
 * 池子不够凑满对数时继续沿轮转补类别，绝不会抽不满。
 */
export function pickLegends(
  all: LegendItem[], levelIndex: number, seed: number
): LegendItem[] {
  const pairs = pairsForLevel(levelIndex);
  const rnd = mulberry32(seed);

  const byCat = new Map<string, LegendItem[]>();
  for (const it of all) {
    const list = byCat.get(it.category);
    if (list) {
      list.push(it);
    } else {
      byCat.set(it.category, [it]);
    }
  }
  const cats = [...byCat.keys()].sort((a, b) => {
    const d = byCat.get(b)!.length - byCat.get(a)!.length;
    return d !== 0 ? d : a.localeCompare(b);
  });
  if (cats.length === 0) {
    return [];
  }

  const total = cats.length;
  const windowSize = Math.max(2, total - Math.max(0, levelIndex));
  const start = Math.max(0, levelIndex) % total;
  const pool: LegendItem[] = [];
  const used = new Set<string>();

  function addCat(offset: number) {
    const name = cats[offset % total];
    if (used.has(name)) {
      return;
    }
    used.add(name);
    pool.push(...byCat.get(name)!);
  }

  for (let i = 0; i < windowSize; i += 1) {
    addCat(start + i);
  }
  for (let i = windowSize; pool.length < pairs && i < windowSize + total; i += 1) {
    addCat(start + i);
  }

  return shuffle(pool, rnd).slice(0, pairs);
}

/** 一副牌：每个图例出两张卡 —— 一张符号卡 + 一张名称卡，然后整体打乱。 */
export function buildCards(
  legends: LegendItem[], levelIndex: number, seed: number
): CardSpec[] {
  const picked = pickLegends(legends, levelIndex, seed);
  const raw: CardSpec[] = [];
  picked.forEach((it) => {
    raw.push({ uid: `${it.id}::symbol`, legendId: it.id, face: "symbol" });
    raw.push({ uid: `${it.id}::name`, legendId: it.id, face: "name" });
  });
  return shuffle(raw, mulberry32((seed ^ 0x9e3779b9) >>> 0));
}

/** 从还没消掉的卡里随便挑一对（提示用）。 */
export function pickRemainingPair(
  cards: CardSpec[], cleared: Set<string>, rnd: () => number
): string[] {
  const left = cards.filter((c) => !cleared.has(c.uid));
  if (left.length < 2) {
    return [];
  }
  const first = left[Math.floor(rnd() * left.length)];
  const mate = left.find((c) => c.legendId === first.legendId && c.uid !== first.uid);
  return mate ? [first.uid, mate.uid] : [];
}

// ---------------------------------------------------------------- 散落布局
/**
 * 把 count 张卡"洒"在 boardW × boardH 的牌面上。
 *
 * 用的是**打乱的格子 + 格子内抖动**，而不是纯随机撒点：
 * 纯拒绝采样在 30 多张卡时会大概率找不到位置，而格子法可以**证明**两两不重叠 ——
 * 每张卡的旋转包围盒严格小于格子，抖动幅度又限制在"格子边长 − 包围盒"的一半以内，
 * 于是任意相邻两格的卡片中心距 ≥ 包围盒边长，必然不相交，也不会越界。
 */
export function layoutCards(
  count: number, boardW: number, boardH: number, seed: number
): CardLayout[] {
  const out: CardLayout[] = [];
  if (count <= 0 || boardW <= 0 || boardH <= 0) {
    return out;
  }
  const rnd = mulberry32(seed);
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * (boardW / boardH))));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cw = boardW / cols;
  const ch = boardH / rows;

  const rotScale = Math.cos(MAX_ROT_DEG * DEG) + Math.sin(MAX_ROT_DEG * DEG);
  const maxW = (cw / rotScale) * 0.92;
  const maxH = (ch / rotScale) * 0.92;
  let cardW = Math.min(maxW, maxH * CARD_ASPECT, CARD_MAX_W);
  cardW = Math.max(cardW, Math.min(CARD_MIN_W, maxW));
  let cardH = cardW / CARD_ASPECT;
  if (cardH > maxH) {
    cardH = maxH;
    cardW = cardH * CARD_ASPECT;
  }

  const bw = cardW * rotScale;
  const bh = cardH * rotScale;
  const jx = Math.max(0, cw / 2 - bw / 2 - CARD_PAD);
  const jy = Math.max(0, ch / 2 - bh / 2 - CARD_PAD);

  const cells: number[] = [];
  for (let i = 0; i < cols * rows; i += 1) {
    cells.push(i);
  }
  const cellOrder = shuffle(cells, rnd);

  for (let k = 0; k < count; k += 1) {
    const cell = cellOrder[k];
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    const x = (col + 0.5) * cw + (rnd() * 2 - 1) * jx;
    const y = (row + 0.5) * ch + (rnd() * 2 - 1) * jy;
    const rot = (rnd() * 2 - 1) * MAX_ROT_DEG;
    out.push({ x, y, w: cardW, h: cardH, rot });
  }
  return out;
}

// ---------------------------------------------------------------- 状态机
export function initialMatchState(seed: number): MatchState {
  return {
    levelIndex: 0,
    seed,
    cleared: [],
    selected: null,
    wrongPair: [],
    focus: null,
    score: 0,
    combo: 0,
    maxCombo: 0,
    matched: 0,
    wrongCount: 0,
    hintsLeft: HINTS_PER_LEVEL,
    hintPair: null,
    phase: "play",
    seconds: 0,
    started: false
  };
}

/**
 * 配对状态机。所有"结束"的判定都收敛在这里，组件只负责画。
 *
 * 规矩（沿用本仓库 province-quiz 的教训）：**每条能让局面往前走的分支都必须有出口**。
 * 这里的两条出口是 closeFocus（消掉一对）与 nextLevel（进下一关），
 * 除此之外没有任何分支会改动 phase，所以不存在"卡在某个中间态"的可能。
 */
export function matchReducer(state: MatchState, action: MatchAction): MatchState {
  switch (action.type) {
    case "tick": {
      if (!state.started || state.phase !== "play" || state.focus) {
        return state;
      }
      return { ...state, seconds: state.seconds + 1 };
    }

    case "click": {
      if (state.phase !== "play" || state.focus) {
        return state;
      }
      if (state.wrongPair.length > 0 || state.cleared.includes(action.uid)) {
        return state;
      }
      const sel = state.selected;
      if (!sel) {
        return {
          ...state,
          selected: { uid: action.uid, legendId: action.legendId, face: action.face },
          started: true,
          hintPair: null
        };
      }
      if (sel.uid === action.uid) {
        return { ...state, selected: null };
      }

      const ok = sel.legendId === action.legendId && sel.face !== action.face;
      if (ok) {
        const gain = PAIR_POINTS + Math.min(state.combo, COMBO_CAP) * COMBO_STEP;
        const combo = state.combo + 1;
        return {
          ...state,
          selected: null,
          hintPair: null,
          focus: { legendId: action.legendId, pair: [sel.uid, action.uid], gain, combo },
          score: state.score + gain,
          combo,
          maxCombo: Math.max(state.maxCombo, combo)
        };
      }
      return {
        ...state,
        selected: null,
        hintPair: null,
        wrongPair: [sel.uid, action.uid],
        combo: 0,
        wrongCount: state.wrongCount + 1,
        score: Math.max(0, state.score - WRONG_PENALTY)
      };
    }

    case "clearWrong":
      return state.wrongPair.length ? { ...state, wrongPair: [] } : state;

    case "closeFocus": {
      if (!state.focus) {
        return state;
      }
      const cleared = [...state.cleared, ...state.focus.pair];
      const matched = state.matched + 1;
      const done = cleared.length >= pairsForLevel(state.levelIndex) * 2;
      let phase: MatchState["phase"] = "play";
      if (done) {
        phase = state.levelIndex + 1 >= LEVEL_COUNT ? "runDone" : "levelDone";
      }
      return { ...state, cleared, matched, focus: null, phase, selected: null };
    }

    case "nextLevel": {
      if (state.phase !== "levelDone") {
        return state;
      }
      const next = initialMatchState(action.seed);
      return {
        ...next,
        levelIndex: state.levelIndex + 1,
        score: state.score,
        maxCombo: state.maxCombo,
        matched: state.matched,
        wrongCount: state.wrongCount,
        seconds: state.seconds,
        started: true
      };
    }

    case "skipToEnd": {
      // 课堂时间不够时提前收尾：只允许在本关已完成（分数是有效的阶段成绩）时用。
      if (state.phase !== "levelDone") {
        return state;
      }
      return { ...state, phase: "runDone" };
    }

    case "restart":
      return initialMatchState(action.seed);

    case "hint": {
      if (state.phase !== "play" || state.focus || state.hintsLeft <= 0) {
        return state;
      }
      if (state.hintPair || action.pair.length !== 2) {
        return state;
      }
      return {
        ...state,
        hintsLeft: state.hintsLeft - 1,
        hintPair: action.pair,
        selected: null,
        score: Math.max(0, state.score - HINT_PENALTY)
      };
    }

    case "clearHint":
      return state.hintPair ? { ...state, hintPair: null } : state;

    default:
      return state;
  }
}
