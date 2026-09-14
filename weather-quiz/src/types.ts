export interface PlayerInfo {
  studentId: number;
  studentName: string;
  className: string | null;
  studentNo?: string;
}

export interface QuizResult {
  score: number;
  timeSeconds: number;
  correctCount: number;
  totalCount: number;
}

export interface RoundRecord {
  player: PlayerInfo;
  result: QuizResult;
  wrongAnswers: number;
  finishedAt: number;
}

export type LevelId = "junior" | "senior";

/** symbol=天气符号/风向符号 · chart=气候统计图 · diagram=示意图 · photo=真实照片 */
export type MediaKind = "symbol" | "chart" | "diagram" | "photo";

export interface LevelInfo {
  id: LevelId;
  name: string;
  subtitle: string;
  scope: string[];
}

export interface Question {
  id: string;
  level: LevelId;
  category: string;
  image: string;
  kind: MediaKind;
  prompt: string;
  answer: string;
  options: string[];
  hints: string[];
  explain: string;
}

export interface ElementEntry {
  id: string;
  name: string;
  category: string;
  level: LevelId;
  summary: string;
  image: string;
}

export interface BankData {
  levels: LevelInfo[];
  questions: Question[];
}

export interface GalleryData {
  elements: ElementEntry[];
}

export interface ScoreRules {
  perCorrect: number;
  wrongPenalty: number;
  hintPenalty: number;
}
