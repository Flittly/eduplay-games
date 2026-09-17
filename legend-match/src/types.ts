export interface PlayerInfo {
  studentId: number;
  studentName: string;
  className: string | null;
  studentNo?: string;
}

/** 单人模式的成绩：配对成功的对数 + 用时 + 得分。 */
export interface RunResult {
  score: number;
  timeSeconds: number;
  /** 配对成功的对数（对应平台的 correctCount） */
  matchedCount: number;
  /** 本局需要配对的总对数（对应平台的 totalCount） */
  totalCount: number;
}

export interface RoundRecord {
  player: PlayerInfo;
  result: RunResult;
  /** 配错的次数 */
  wrongCount: number;
  maxCombo: number;
  finishedAt: number;
}

export interface LegendItem {
  id: string;
  /** 教材/图册上的正式名称（揭晓大卡与图鉴用） */
  name: string;
  /** 牌面上的简称（最长 6 字，小卡放得下） */
  short: string;
  category: string;
  categoryName: string;
  summary: string;
  image: string;
}

export interface LegendData {
  game: string;
  categories: { id: string; name: string }[];
  legends: LegendItem[];
}

/** 牌面上的一张卡：要么是图例符号卡，要么是它的名称卡。 */
export type CardFace = "symbol" | "name";

export interface CardSpec {
  uid: string;
  legendId: string;
  face: CardFace;
}

/** 散落布局算出来的位置（单位＝牌面像素）。 */
export interface CardLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
}

export interface Card extends CardSpec, CardLayout {}

/** 配对成功后在屏幕中央放大复现的那张卡。 */
export interface FocusInfo {
  legendId: string;
  pair: string[];
  gain: number;
  /** 结算之后的连击数 */
  combo: number;
}

export type MatchPhase = "play" | "levelDone" | "runDone";

export interface SelectedCard {
  uid: string;
  legendId: string;
  face: CardFace;
}

export interface MatchState {
  levelIndex: number;
  seed: number;
  cleared: string[];
  selected: SelectedCard | null;
  /** 配错的两张卡，用来播抖动动画；非空期间锁住输入 */
  wrongPair: string[];
  focus: FocusInfo | null;
  score: number;
  combo: number;
  maxCombo: number;
  matched: number;
  wrongCount: number;
  hintsLeft: number;
  hintPair: string[] | null;
  phase: MatchPhase;
  seconds: number;
  started: boolean;
}

export type MatchAction =
  | { type: "click"; uid: string; legendId: string; face: CardFace }
  | { type: "closeFocus" }
  | { type: "nextLevel"; seed: number }
  | { type: "skipToEnd" }
  | { type: "restart"; seed: number }
  | { type: "hint"; pair: string[] }
  | { type: "clearHint" }
  | { type: "clearWrong" }
  | { type: "tick" };
