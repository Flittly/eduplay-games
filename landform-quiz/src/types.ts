/** 地貌人格测试 · 类型定义 */

export type Category = "domestic" | "international";

export interface Dimension {
  key: string;
  name: string;
  lowLabel: string;
  highLabel: string;
  lowDesc: string;
  highDesc: string;
}

export interface Profile {
  [key: string]: number;
}

export interface Landform {
  id: string;
  name: string;
  en: string;
  category: Category;
  type: string;
  country: string;
  region: string;
  lat: number;
  lon: number;
  photo: string;
  photoSource: string;
  summary: string;
  intro: string;
  traits: string[];
  cause: string;
  personality: string;
  profile: Profile;
}

export interface LandformData {
  dimensions: Dimension[];
  landforms: Landform[];
}

export interface QuestionOption {
  label: string;
  delta: Record<string, number>;
}

export interface Question {
  id: string;
  text: string;
  options: QuestionOption[];
}

export interface QuestionData {
  questions: Question[];
}

export interface MapMeta {
  projection: "lambert-conic-conformal" | "equirectangular";
  params: Record<string, number>;
  scale: number;
  offset: [number, number];
  viewBox: [number, number, number, number];
  source: string;
  note: string;
}

export interface ChinaMap {
  meta: MapMeta;
  outline: string;
  provinces: string;
  nineDash: string;
}

export interface WorldMap {
  meta: MapMeta;
  land: string;
  china: string;
}

export interface PlayerInfo {
  studentId: number;
  studentName: string;
  className: string | null;
  studentNo?: string;
}

export interface ScoredLandform {
  landform: Landform;
  distance: number;
  score: number;
}

export interface QuizResult {
  /** 用户五维画像，0-100 */
  vector: Profile;
  /** 按接近程度排序的候选地貌（含本人格类型） */
  ranked: ScoredLandform[];
}
