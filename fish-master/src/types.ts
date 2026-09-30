/**
 * 与平台对接的类型 + 界面共用类型。
 * ⚠️ PlayerInfo / RunResult 的字段名必须与平台协议一致（照 legend-match 的 types.ts）。
 */

export interface PlayerInfo {
  studentId: number;
  studentName: string;
  className: string | null;
  studentNo?: string;
}

/** 一名学生一局的成绩。 */
export interface RunResult {
  score: number;
  timeSeconds: number;
  /** 认对的洋流条数 → 平台 correctCount */
  matchedCount: number;
  /** 本局可认的洋流总数 → 平台 totalCount */
  totalCount: number;
  /** 是否集齐四大环流通关。 */
  win?: boolean;
  maxCombo?: number;
  /** 集齐的环流数。 */
  completedGyres?: number;
}
