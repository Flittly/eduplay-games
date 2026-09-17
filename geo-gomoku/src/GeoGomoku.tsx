import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_HIDE_MODE,
  DEG_STEP,
  GRID,
  HIDE_MODES,
  axisDegreeOptions,
  axisHemiText,
  axisName,
  axisRangeText,
  buildAxes,
  colOfLon,
  composeDegreeInput,
  defaultHemi,
  formatLatCompact,
  formatLonCompact,
  formatMove,
  formatRowCol,
  hemiName,
  hemiOptions,
  labelIndices,
  parseDegreeInput,
  randomBoardRange,
  rowOfLat,
  sampleInput,
  zeroIndex,
  zeroName,
  type AxisKind,
  type BoardRange,
  type Hemi,
  type HideMode
} from "./geo";

export interface PlayerInfo {
  studentId: number;
  studentName: string;
  className: string | null;
  studentNo?: string;
}

export interface MatchResult {
  score: number;
  timeSeconds: number;
  correctCount: number;
  totalCount: number;
}

export interface RoundRecord {
  player: PlayerInfo;
  result: MatchResult;
  wrongAnswers: number;
  finishedAt: number;
}

export interface ScoreRules {
  winPoints: number;
  losePoints: number;
  drawPoints: number;
}

interface GeoGomokuProps {
  roster: PlayerInfo[];
  onComplete: (player: PlayerInfo, result: MatchResult) => void;
  onSessionEnd: (records: RoundRecord[]) => void;
}

const AI_PLAYER: PlayerInfo = {
  studentId: -1,
  studentName: "电脑（AI）",
  className: null
};

interface MoveLog {
  no: number;
  playerName: string;
  text: string;
}

const RULES_STORAGE_KEY = "eduplay.geo-gomoku.rules.v1";

const DEFAULT_RULES: ScoreRules = {
  winPoints: 20,
  losePoints: 5,
  drawPoints: 10
};

// 棋盘经纬度范围与坐标解析都放在 ./geo（纯逻辑，有 Node 测试覆盖）。
// 这里只负责渲染与交互。

type Phase = "setup" | "playing" | "roundDone";
type GameMode = "pvp" | "ai";
type Cell = 0 | 1 | null;

const VIEW_W = 940;
const VIEW_H = 940;
const LEFT = 118;
const TOP = 80;
const RIGHT = 30;
const BOTTOM = 70;
const INNER = Math.min(
  VIEW_W - LEFT - RIGHT,
  VIEW_H - TOP - BOTTOM
);
const STEP = INNER / (GRID - 1);

function readSavedRules(): ScoreRules {
  try {
    const raw = localStorage.getItem(RULES_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_RULES };
    }
    const parsed = JSON.parse(raw) as Partial<ScoreRules>;
    const toNumber = (value: unknown, fallback: number): number => {
      const num = Number(value);
      return Number.isFinite(num) && num >= 0 ? Math.round(num) : fallback;
    };
    return {
      winPoints: toNumber(parsed.winPoints, DEFAULT_RULES.winPoints),
      losePoints: toNumber(parsed.losePoints, DEFAULT_RULES.losePoints),
      drawPoints: toNumber(parsed.drawPoints, DEFAULT_RULES.drawPoints)
    };
  } catch {
    return { ...DEFAULT_RULES };
  }
}

function saveRules(rules: ScoreRules) {
  try {
    localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // 忽略浏览器禁用 localStorage。
  }
}

function point(row: number, col: number) {
  return {
    x: LEFT + col * STEP,
    y: TOP + row * STEP
  };
}

function emptyBoard(): Cell[][] {
  return Array.from({ length: GRID }, () =>
    Array.from<Cell>({ length: GRID }).fill(null)
  );
}

function withDegreeSymbol(value: string): string {
  return value.replaceAll("度", "°");
}

function hasWin(
  board: Cell[][],
  row: number,
  col: number,
  player: 0 | 1
): boolean {
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];
  for (const [dr, dc] of dirs) {
    let count = 1;
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (
        r >= 0 &&
        r < GRID &&
        c >= 0 &&
        c < GRID &&
        board[r][c] === player
      ) {
        count += 1;
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (count >= 5) {
      return true;
    }
  }
  return false;
}

const AI_WEIGHT = [0, 1, 10, 100, 1000];

function lineScore(
  board: Cell[][],
  row: number,
  col: number,
  player: 0 | 1
): number {
  let total = 0;
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];
  for (const [dr, dc] of dirs) {
    let count = 1;
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (
        r >= 0 &&
        r < GRID &&
        c >= 0 &&
        c < GRID &&
        board[r][c] === player
      ) {
        count += 1;
        r += dr * sign;
        c += dc * sign;
      }
    }
    total += AI_WEIGHT[Math.min(count, 4)];
  }
  return total;
}

function findAiMove(current: Cell[][]): { row: number; col: number } | null {
  let best: { row: number; col: number } | null = null;
  let bestScore = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  const center = { row: 7, col: 7 };

  for (let row = 0; row < GRID; row += 1) {
    for (let col = 0; col < GRID; col += 1) {
      if (current[row][col] !== null) {
        continue;
      }
      const test = current.map((line) => [...line]) as Cell[][];
      test[row][col] = 1;
      if (hasWin(test, row, col, 1)) {
        return { row, col };
      }
      const block = current.map((line) => [...line]) as Cell[][];
      block[row][col] = 0;
      if (hasWin(block, row, col, 0)) {
        return { row, col };
      }
      const score =
        lineScore(test, row, col, 1) * 1.05 +
        lineScore(block, row, col, 0);
      const distance = Math.hypot(row - center.row, col - center.col);
      if (
        score > bestScore ||
        (score === bestScore && distance < bestDistance)
      ) {
        bestScore = score;
        bestDistance = distance;
        best = { row, col };
      }
    }
  }
  return best;
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * 分段切换控件：格线标注档位（老师先"全部标出"讲一遍，再切到"只留锚点"）
 * 与坐标输入方式共用一套外观。
 */
interface SwitchOption<T extends string> {
  id: T;
  label: string;
  hint: string;
}

function SegmentedSwitch<T extends string>({
  title,
  value,
  options,
  onChange
}: {
  title: string;
  value: T;
  options: SwitchOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="hide-mode-switch">
      <span className="hide-mode-title">{title}</span>
      <div className="hide-mode-options">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={value === option.id ? "is-active" : ""}
            title={option.hint}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 坐标输入方式：手写（学生自己读格线报坐标）/ 下拉（老师报坐标、学生找交点）。 */
type InputMode = "type" | "pick";

const INPUT_MODES: SwitchOption<InputMode>[] = [
  { id: "type", label: "手动输入", hint: "自己从格线上读出度数并写出来（含半球）" },
  { id: "pick", label: "下拉选择", hint: "度数从下拉框里选，半球另外选一次" }
];

/** 下拉选择模式的一次取值；hemi 为 null 表示"用本棋盘默认的那一半"。 */
interface DegreePick {
  degree: number | null;
  hemi: Hemi | null;
}

const EMPTY_PICK: DegreePick = { degree: null, hemi: null };

/**
 * 一条轴上的坐标输入框。
 *
 * 两种方式产出的是**同一句文本**（如「北纬45°」），交给同一个 parseDegreeInput 校验 ——
 * 所以下拉框不会成为绕过校验的后门，两种方式也永远给学生一样的对错反馈。
 */
function AxisField({
  kind,
  range,
  mode,
  text,
  onText,
  pick,
  onPick,
  onEnter
}: {
  kind: AxisKind;
  range: BoardRange;
  mode: InputMode;
  text: string;
  onText: (value: string) => void;
  pick: DegreePick;
  onPick: (value: DegreePick) => void;
  onEnter: () => void;
}) {
  const degrees = useMemo(() => axisDegreeOptions(kind, range), [kind, range]);
  // 半球没被显式选过时用本棋盘默认值：单半球棋盘不会一上来就吃一个必错的默认值。
  const hemi = pick.hemi ?? defaultHemi(kind, range);
  const label = `${axisName(kind)}（${axisHemiText(kind, range)}）`;

  if (mode === "type") {
    return (
      <label className="coord-field">
        {label}
        <input
          type="text"
          value={text}
          placeholder={`如 ${sampleInput(kind, range, "cn")} / ${sampleInput(
            kind,
            range,
            "compact"
          )}`}
          onChange={(event) => onText(withDegreeSymbol(event.target.value))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onEnter();
            }
          }}
        />
      </label>
    );
  }

  return (
    <div className="coord-field">
      {label}
      <div className="degree-picker">
        <select
          className="degree-select"
          value={pick.degree === null ? "" : String(pick.degree)}
          onChange={(event) =>
            onPick({
              ...pick,
              degree:
                event.target.value === "" ? null : Number(event.target.value)
            })
          }
        >
          <option value="">请选择度数</option>
          {degrees.map((degree) => (
            <option key={degree} value={degree}>
              {degree === 0 ? `0°（${zeroName(kind)}）` : `${degree}°`}
            </option>
          ))}
        </select>
        <div className="hemi-options">
          {hemiOptions(kind).map((option) => (
            <button
              key={option}
              type="button"
              className={hemi === option ? "is-active" : ""}
              // 0° 不属于任何半球，选不选都不影响结果，干脆置灰免得学生白纠结。
              disabled={pick.degree === 0}
              onClick={() => onPick({ ...pick, hemi: option })}
            >
              {hemiName(kind, option)}
            </button>
          ))}
        </div>
      </div>
      <small className="degree-picker-tip">
        {pick.degree === 0
          ? `${zeroName(kind)}就是 0°，不用再选半球`
          : `度数每 ${DEG_STEP}° 一档（共 ${degrees.length} 档），选完还要自己选半球`}
      </small>
    </div>
  );
}

export default function GeoGomoku({
  roster,
  onComplete,
  onSessionEnd
}: GeoGomokuProps) {
  const [gameMode, setGameMode] = useState<GameMode>("pvp");
  const [phase, setPhase] = useState<Phase>("setup");
  const [pairAId, setPairAId] = useState<number | null>(null);
  const [pairBId, setPairBId] = useState<number | null>(null);
  const [currentIndex, setCurrentIndex] = useState<0 | 1>(0);
  const [board, setBoard] = useState<Cell[][]>(() => emptyBoard());
  const [latInput, setLatInput] = useState("");
  const [lonInput, setLonInput] = useState("");
  const [inputError, setInputError] = useState("");
  const [moves, setMoves] = useState<MoveLog[]>([]);
  const [lastMove, setLastMove] = useState<{ row: number; col: number } | null>(
    null
  );
  const [seconds, setSeconds] = useState(0);
  const [records, setRecords] = useState<RoundRecord[]>([]);
  const [winnerIndex, setWinnerIndex] = useState<0 | 1 | null>(null);
  const [isDraw, setIsDraw] = useState(false);
  const [rules, setRules] = useState<ScoreRules>(() => readSavedRules());
  const [draftRules, setDraftRules] = useState<ScoreRules>(DEFAULT_RULES);
  const [rulesEditorOpen, setRulesEditorOpen] = useState(false);
  const [matchNo, setMatchNo] = useState(1);
  const [finishedMatches, setFinishedMatches] = useState(0);
  const [range, setRange] = useState<BoardRange>(() => randomBoardRange());
  const [hideMode, setHideMode] = useState<HideMode>(DEFAULT_HIDE_MODE);
  const [inputMode, setInputMode] = useState<InputMode>("type");
  const [latPick, setLatPick] = useState<DegreePick>(EMPTY_PICK);
  const [lonPick, setLonPick] = useState<DegreePick>(EMPTY_PICK);

  const { lats: LATS, lons: LONGS } = useMemo(
    () => buildAxes(range),
    [range]
  );

  // 0° 线（赤道 / 本初子午线）在棋盘上时的格线序号；不在棋盘上则是 null。
  const latZero = zeroIndex("lat", range);
  const lonZero = zeroIndex("lon", range);
  // 哪些格线显示度数标签。labelIndices 会保证 0° 线无论如何都标出来。
  const showLatLabel = useMemo(() => labelIndices(hideMode, latZero), [hideMode, latZero]);
  const showLonLabel = useMemo(() => labelIndices(hideMode, lonZero), [hideMode, lonZero]);
  const latRangeText = axisRangeText("lat", range);
  const lonRangeText = axisRangeText("lon", range);

  const completedIds = useMemo(
    () => new Set(records.map((record) => record.player.studentId)),
    [records]
  );

  const playerA =
    roster.find((player) => player.studentId === pairAId) ?? null;
  const playerB =
    roster.find((player) => player.studentId === pairBId) ?? null;
  const blackPlayer =
    gameMode === "ai" ? AI_PLAYER : playerB;
  const currentPlayer =
    currentIndex === 0 ? playerA : blackPlayer;

  const leaderboard = useMemo(
    () =>
      [...records].sort(
        (a, b) =>
          b.result.score - a.result.score ||
          a.result.timeSeconds - b.result.timeSeconds ||
          a.player.studentName.localeCompare(b.player.studentName, "zh-CN")
      ),
    [records]
  );

  useEffect(() => {
    const need = gameMode === "ai" ? 1 : 2;
    if (roster.length < need) {
      return;
    }
    const pairValid =
      gameMode === "ai"
        ? pairAId !== null &&
          roster.some((player) => player.studentId === pairAId)
        : pairAId !== null &&
          pairBId !== null &&
          pairAId !== pairBId &&
          roster.some((player) => player.studentId === pairAId) &&
          roster.some((player) => player.studentId === pairBId);
    if (!pairValid) {
      const available = roster.filter(
        (player) => !completedIds.has(player.studentId)
      );
      if (available.length >= need) {
        setPairAId(available[0].studentId);
        setPairBId(gameMode === "ai" ? null : available[1].studentId);
      }
    }
  }, [completedIds, gameMode, pairAId, pairBId, roster]);

  useEffect(() => {
    if (phase !== "playing") {
      return;
    }
    const timer = window.setInterval(() => {
      setSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, matchNo, pairAId, pairBId]);

  function pickPair(id: number, slot: "A" | "B") {
    if (phase !== "setup" || completedIds.has(id)) {
      return;
    }
    if (gameMode === "ai" && slot === "B") {
      return;
    }
    if (slot === "A") {
      if (id === pairBId) {
        setPairBId(null);
      }
      setPairAId(id);
    } else {
      if (id === pairAId) {
        setPairAId(null);
      }
      setPairBId(id);
    }
  }

  function changeGameMode(mode: GameMode) {
    if (phase !== "setup") {
      return;
    }
    setGameMode(mode);
    setPairAId(null);
    setPairBId(null);
  }

  /** 当前输入方式下，该轴真正要提交的文本 —— 手动输入与下拉选择在这里汇成同一句话。 */
  function axisText(kind: AxisKind): string {
    if (inputMode === "type") {
      return kind === "lat" ? latInput : lonInput;
    }
    const pick = kind === "lat" ? latPick : lonPick;
    return composeDegreeInput(
      kind,
      pick.degree,
      pick.hemi ?? defaultHemi(kind, range)
    );
  }

  function changeInputMode(mode: InputMode) {
    setInputMode(mode);
    setInputError("");
  }

  function resetBoard() {
    setBoard(emptyBoard());
    setLatInput("");
    setLonInput("");
    setLatPick(EMPTY_PICK);
    setLonPick(EMPTY_PICK);
    setInputError("");
    setMoves([]);
    setLastMove(null);
    setWinnerIndex(null);
    setIsDraw(false);
    setSeconds(0);
    setCurrentIndex(0);
    setPhase("setup");
  }

  function startMatch() {
    const validPvp =
      gameMode === "pvp" &&
      playerA &&
      playerB &&
      playerA.studentId !== playerB.studentId;
    const validAi = gameMode === "ai" && playerA !== null;
    if (!validPvp && !validAi) {
      return;
    }
    resetBoard();
    setPhase("playing");
  }

  function submitCoordinate() {
    if (
      phase !== "playing" ||
      !currentPlayer ||
      !playerA ||
      (gameMode === "pvp" && !playerB)
    ) {
      return;
    }
    if (gameMode === "ai" && currentIndex !== 0) {
      return;
    }
    // 两条轴分开校验：纬度写错时不要拿经度的错误去提示学生。
    // 校验的输入是 axisText()——手动输入与下拉选择在这里共用同一条校验路径。
    const latResult = parseDegreeInput(axisText("lat"), "lat", range);
    if (!latResult.ok) {
      setInputError(latResult.error);
      return;
    }
    const lonResult = parseDegreeInput(axisText("lon"), "lon", range);
    if (!lonResult.ok) {
      setInputError(lonResult.error);
      return;
    }
    const lat = latResult.value;
    const lon = lonResult.value;
    const row = rowOfLat(lat, range);
    const col = colOfLon(lon, range);
    // parseDegreeInput 已保证"落在窗口内 + 是 5° 的倍数"，两者合起来 row/col 必然在 0~14。
    // 这里只是兜底：万一以后窗口模型改了，宁可报错也不要把棋子画到棋盘外。
    if (row < 0 || row >= GRID || col < 0 || col >= GRID) {
      setInputError(
        `这个坐标不在棋盘上（纬度 ${latRangeText} / 经度 ${lonRangeText}），请对照格线重新数一遍`
      );
      return;
    }
    if (board[row][col] !== null) {
      setInputError("该交点已有棋子，请换一个坐标");
      return;
    }

    const next = board.map((line) => [...line]) as Cell[][];
    next[row][col] = currentIndex;
    setBoard(next);
    setLastMove({ row, col });
    setInputError("");
    setLatInput("");
    setLonInput("");
    // 下拉框也清空，逼学生重新看一次格线：否则连点两次"确认"只会撞上"该交点已有棋子"。
    setLatPick(EMPTY_PICK);
    setLonPick(EMPTY_PICK);
    setMoves((current) => [
      ...current,
      {
        no: current.length + 1,
        playerName: currentPlayer.studentName,
        text: formatMove(lat, lon)
      }
    ]);

    if (hasWin(next, row, col, currentIndex)) {
      setWinnerIndex(currentIndex);
      setPhase("roundDone");
      finishMatch(currentIndex, false);
      return;
    }

    const full = next.every((line) => line.every((cell) => cell !== null));
    if (full) {
      setIsDraw(true);
      setPhase("roundDone");
      finishMatch(null, true);
      return;
    }

    setCurrentIndex(currentIndex === 0 ? 1 : 0);
    if (gameMode === "ai" && currentIndex === 0) {
      window.setTimeout(() => {
        performAiMove(next);
      }, 700);
    }
  }

  function performAiMove(currentBoard: Cell[][]) {
    const best = findAiMove(currentBoard);
    if (!best || !playerA) {
      setIsDraw(true);
      setPhase("roundDone");
      finishMatch(null, true);
      return;
    }
    const { row, col } = best;
    const next = currentBoard.map((line) => [...line]) as Cell[][];
    next[row][col] = 1;
    setBoard(next);
    setLastMove({ row, col });
    setMoves((current) => [
      ...current,
      {
        no: current.length + 1,
        playerName: AI_PLAYER.studentName,
        text: formatRowCol(row, col, range)
      }
    ]);

    if (hasWin(next, row, col, 1)) {
      setWinnerIndex(1);
      setPhase("roundDone");
      finishMatch(1, false);
      return;
    }

    const full = next.every((line) => line.every((cell) => cell !== null));
    if (full) {
      setIsDraw(true);
      setPhase("roundDone");
      finishMatch(null, true);
      return;
    }

    setCurrentIndex(0);
  }

  function finishMatch(winner: 0 | 1 | null, draw: boolean) {
    if (!playerA || (gameMode === "pvp" && !playerB)) {
      return;
    }
    const first: PlayerInfo = playerA;
    const second: PlayerInfo | null =
      gameMode === "ai" ? null : playerB;
    const createRecord = (
      player: PlayerInfo,
      score: number,
      won: boolean
    ): RoundRecord => ({
      player,
      result: {
        score,
        timeSeconds: seconds,
        correctCount: won ? 1 : 0,
        totalCount: 1
      },
      wrongAnswers: 0,
      finishedAt: Date.now()
    });

    let firstRecord: RoundRecord;
    let secondRecord: RoundRecord | null = null;
    if (draw) {
      firstRecord = createRecord(first, rules.drawPoints, false);
      if (second) {
        secondRecord = createRecord(second, rules.drawPoints, false);
      }
    } else {
      const firstWon = winner === 0;
      firstRecord = createRecord(
        first,
        firstWon ? rules.winPoints : rules.losePoints,
        firstWon
      );
      if (second) {
        secondRecord = createRecord(
          second,
          firstWon ? rules.losePoints : rules.winPoints,
          !firstWon
        );
      }
    }

    const nextRecords = [
      ...records,
      firstRecord,
      ...(secondRecord ? [secondRecord] : [])
    ];
    setRecords(nextRecords);
    setFinishedMatches((value) => value + 1);
    window.setTimeout(() => {
      onComplete(firstRecord.player, firstRecord.result);
      if (secondRecord) {
        onComplete(secondRecord.player, secondRecord.result);
      }
    }, 350);
  }

  function startNextMatch() {
    const available = roster.filter(
      (player) => !completedIds.has(player.studentId)
    );
    const need = gameMode === "ai" ? 1 : 2;
    setMatchNo((value) => value + 1);
    setRange(randomBoardRange());
    resetBoard();
    if (available.length >= need) {
      setPairAId(available[0].studentId);
      setPairBId(gameMode === "ai" ? null : available[1].studentId);
    }
  }

  function finishSession() {
    if (records.length > 0) {
      onSessionEnd(records);
    }
  }

  function openRulesEditor() {
    if (phase !== "setup") {
      return;
    }
    setDraftRules({ ...rules });
    setRulesEditorOpen(true);
  }

  function saveRulesEditor() {
    const toNumber = (value: number): number =>
      Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
    const next: ScoreRules = {
      winPoints: toNumber(draftRules.winPoints),
      losePoints: toNumber(draftRules.losePoints),
      drawPoints: toNumber(draftRules.drawPoints)
    };
    setRules(next);
    saveRules(next);
    setRulesEditorOpen(false);
  }

  const remainingPlayers = roster.filter(
    (player) => !completedIds.has(player.studentId)
  );
  const canNextMatch =
    gameMode === "ai"
      ? remainingPlayers.length >= 1
      : remainingPlayers.length >= 2;
  const bottomY = TOP + (GRID - 1) * STEP;
  const rightX = LEFT + (GRID - 1) * STEP;

  return (
    <div className="game">
      <header className="game-topbar">
        <div className="game-heading">
          <strong>经纬度五子棋</strong>
          <span>横线是纬线、竖线是经线（可能是南纬 / 西经），学生报出带半球的坐标才能落子</span>
        </div>
        <div className="topbar-actions">
          <div className="score-panel">
            <div className="score-row">
              <span className="score-student">
                {currentPlayer
                  ? `当前：${currentPlayer.studentName}`
                  : "请先选择玩家"}
              </span>
              <span className="timer-badge">⏱ {formatTime(seconds)}</span>
            </div>
            <div className="score-row score-metrics">
              <strong>
                {phase === "roundDone"
                  ? isDraw
                    ? "平局"
                    : `${winnerIndex === 0 ? playerA?.studentName : blackPlayer?.studentName} 获胜`
                  : phase === "setup"
                    ? "第" + matchNo + "局"
                    : `${playerA?.studentName} 红方 vs ${blackPlayer?.studentName} 黑方`}
              </strong>
              <span>胜 +{rules.winPoints}</span>
            </div>
          </div>
          <button
            type="button"
            className="control-btn"
            disabled={phase !== "setup"}
            onClick={openRulesEditor}
          >
            积分规则
          </button>
        </div>
      </header>

      <div className="game-body">
        <main className="game-main">
          {phase === "setup" && (
            <section className="setup-card">
              <h2>经纬度五子棋</h2>
              <p>
                双人轮流输入坐标落子，也可以选择学生挑战电脑。
                棋盘可能是北纬、南纬、东经、西经，也可能同时跨赤道或本初子午线 ——
                所以坐标必须写明半球，且正好落在格点上才能落子。
              </p>
              <div className="rules-summary">
                胜方 +{rules.winPoints} · 负方 +{rules.losePoints} · 平局 +
                {rules.drawPoints}
              </div>

              <div className="range-summary">
                <span>
                  本局棋盘：纬度 {latRangeText} · 经度 {lonRangeText}
                  （每格 5°，共 15 条线）
                </span>
                <button
                  type="button"
                  className="control-btn range-reroll"
                  onClick={() => setRange(randomBoardRange())}
                >
                  换一个范围
                </button>
              </div>

              <SegmentedSwitch
                title="格线标注"
                value={hideMode}
                options={HIDE_MODES}
                onChange={setHideMode}
              />

              <div className="mode-select">
                <button
                  type="button"
                  className={gameMode === "pvp" ? "is-active" : ""}
                  onClick={() => changeGameMode("pvp")}
                >
                  双人对战
                </button>
                <button
                  type="button"
                  className={gameMode === "ai" ? "is-active" : ""}
                  onClick={() => changeGameMode("ai")}
                >
                  人机对战
                </button>
              </div>

              {roster.length < (gameMode === "ai" ? 1 : 2) ? (
                <p className="setup-error">
                  {gameMode === "ai"
                    ? "请先在平台选择至少一名学生。"
                    : "请先在平台选择至少两名学生。"}
                </p>
              ) : (
                <>
                  <div
                    className={
                      gameMode === "ai" ? "pair-select is-ai" : "pair-select"
                    }
                  >
                    <div className="pair-column">
                      <strong className="red-text">
                        {gameMode === "ai" ? "挑战电脑的学生（红方）" : "红方 A"}
                      </strong>
                      <div className="pair-options">
                        {roster.map((player) => {
                          const done = completedIds.has(player.studentId);
                          const active = player.studentId === pairAId;
                          return (
                            <button
                              key={player.studentId}
                              type="button"
                              className={[
                                done ? "is-done" : "",
                                active ? "is-active" : ""
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              disabled={done}
                              onClick={() => pickPair(player.studentId, "A")}
                            >
                              {player.studentName}
                              {done ? "（已完成）" : ""}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {gameMode === "pvp" && (
                      <div className="pair-column">
                        <strong>黑方 B</strong>
                        <div className="pair-options">
                          {roster.map((player) => {
                            const done = completedIds.has(player.studentId);
                            const active = player.studentId === pairBId;
                            return (
                              <button
                                key={player.studentId}
                                type="button"
                                className={[
                                  done ? "is-done" : "",
                                  active ? "is-active" : ""
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                disabled={done}
                                onClick={() => pickPair(player.studentId, "B")}
                              >
                                {player.studentName}
                                {done ? "（已完成）" : ""}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="start-btn"
                    disabled={
                      !playerA ||
                      (gameMode === "pvp" &&
                        (!playerB || playerA.studentId === playerB.studentId))
                    }
                    onClick={startMatch}
                  >
                    {gameMode === "ai" ? "开始人机对战" : "开始第 " + matchNo + " 局"}
                  </button>
                </>
              )}
            </section>
          )}

          {phase !== "setup" && (
            <div className="match-area">
              <section className="board-section">
                <div className="board-legend">
                  <span className="legend-red">● {playerA?.studentName ?? "红方"}</span>
                  <span className="legend-black">● {blackPlayer?.studentName ?? "黑方"}</span>
                  <span>横轴为经度 · 纵轴为纬度 · 每格 5°</span>
                </div>

                <svg
                  className="board-svg"
                  viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                >
                <rect width="100%" height="100%" className="board-bg" />

                <g className="grid-lines">
                  {LONGS.map((_, col) => {
                    const x = LEFT + col * STEP;
                    return (
                      <line
                        key={`lon-${col}`}
                        className={col === lonZero ? "is-zero-line" : undefined}
                        x1={x}
                        y1={TOP}
                        x2={x}
                        y2={bottomY}
                      />
                    );
                  })}
                  {LATS.map((_, row) => {
                    const y = TOP + row * STEP;
                    return (
                      <line
                        key={`lat-${row}`}
                        className={row === latZero ? "is-zero-line" : undefined}
                        x1={LEFT}
                        y1={y}
                        x2={rightX}
                        y2={y}
                      />
                    );
                  })}
                </g>

                {/* 赤道 / 本初子午线是这一版才有的参照物，学生一眼要能认出来 */}
                {latZero !== null && (
                  <text
                    x={LEFT + 8}
                    y={TOP + latZero * STEP - 8}
                    className="zero-line-note"
                  >
                    {zeroName("lat")}
                  </text>
                )}
                {lonZero !== null && (
                  <text
                    x={LEFT + lonZero * STEP + 8}
                    y={TOP + 16}
                    className="zero-line-note"
                  >
                    {zeroName("lon")}
                  </text>
                )}

                <g className="axis-labels">
                  {LATS.map((lat, row) =>
                    showLatLabel[row] ? (
                      <text
                        key={`lat-label-${row}`}
                        className={row === latZero ? "is-zero-label" : undefined}
                        x={LEFT - 10}
                        y={TOP + row * STEP + 6}
                      >
                        {formatLatCompact(lat)}
                      </text>
                    ) : null
                  )}
                  {LONGS.map((lon, col) =>
                    showLonLabel[col] ? (
                      <text
                        key={`lon-label-${col}`}
                        className={
                          col === lonZero ? "lon-label is-zero-label" : "lon-label"
                        }
                        x={LEFT + col * STEP}
                        y={bottomY + 26}
                      >
                        {formatLonCompact(lon)}
                      </text>
                    ) : null
                  )}
                </g>

                <text x={LEFT - 4} y={TOP - 24} className="axis-heading">
                  纬度 ↑
                </text>
                <text x={rightX - 12} y={bottomY + 48} className="axis-heading" textAnchor="end">
                  经度 →
                </text>

                {lastMove && (
                  <circle
                    className="last-marker"
                    cx={point(lastMove.row, lastMove.col).x}
                    cy={point(lastMove.row, lastMove.col).y}
                    r={15}
                  />
                )}

                {board.map((line, row) =>
                  line.map((cell, col) => {
                    if (cell === null) {
                      return null;
                    }
                    const p = point(row, col);
                    return (
                      <circle
                        key={`${row}-${col}`}
                        className={cell === 0 ? "stone stone-red" : "stone stone-black"}
                        cx={p.x}
                        cy={p.y}
                        r={16}
                      />
                    );
                  })
                )}
              </svg>
            </section>

            {phase === "playing" && (
              <aside className="coordinate-panel">
                <h3>输入坐标落子</h3>
                <p className="coord-range-hint">
                  本棋盘经线、纬线每格 5°，坐标要正好落在格点上
                </p>
                <SegmentedSwitch
                  title="格线标注"
                  value={hideMode}
                  options={HIDE_MODES}
                  onChange={setHideMode}
                />
                <p className="coord-current">
                  <span
                    className={
                      currentIndex === 0 ? "color-dot red-dot" : "color-dot black-dot"
                    }
                  >
                    ●
                  </span>
                  {currentPlayer?.studentName ?? ""} 的回合
                </p>

                {gameMode === "ai" && currentIndex === 1 ? (
                  <p className="ai-thinking">电脑正在计算坐标并落子…</p>
                ) : (
                  <>
                    <SegmentedSwitch
                      title="输入方式"
                      value={inputMode}
                      options={INPUT_MODES}
                      onChange={changeInputMode}
                    />
                    <AxisField
                      kind="lat"
                      range={range}
                      mode={inputMode}
                      text={latInput}
                      onText={(value) => {
                        setLatInput(value);
                        setInputError("");
                      }}
                      pick={latPick}
                      onPick={(value) => {
                        setLatPick(value);
                        setInputError("");
                      }}
                      onEnter={submitCoordinate}
                    />
                    <AxisField
                      kind="lon"
                      range={range}
                      mode={inputMode}
                      text={lonInput}
                      onText={(value) => {
                        setLonInput(value);
                        setInputError("");
                      }}
                      pick={lonPick}
                      onPick={(value) => {
                        setLonPick(value);
                        setInputError("");
                      }}
                      onEnter={submitCoordinate}
                    />
                    {inputMode === "type" && (
                      <p className="degree-hint">
                        要写明半球（北纬/南纬、东经/西经），也可以写 30°N、45°W 这样的字母写法；
                        直接输入「度」会自动变成「°」。
                      </p>
                    )}

                    <button
                      type="button"
                      className="place-btn"
                      onClick={submitCoordinate}
                    >
                      确认并落子
                    </button>
                    {inputError && <p className="coord-error">{inputError}</p>}
                  </>
                )}

                <div className="move-history">
                  <h4>落子记录</h4>
                  <ol>
                    {moves.length === 0 && <li>还没有落子</li>}
                    {moves.map((move) => (
                      <li key={move.no}>
                        <span>{move.no}.</span>
                        <strong>{move.playerName}</strong>
                        <em>{move.text}</em>
                      </li>
                    ))}
                  </ol>
                </div>
              </aside>
            )}

            {phase === "roundDone" && (
              <aside className="coordinate-panel result-panel">
                <h3>{isDraw ? "平局" : "分出胜负！"}</h3>
                <p className="result-main">
                  {isDraw
                    ? `${playerA?.studentName} 与 ${blackPlayer?.studentName} 平局，各 +${rules.drawPoints}`
                    : gameMode === "ai"
                      ? winnerIndex === 0
                        ? `${playerA?.studentName} 战胜电脑，获得 +${rules.winPoints}`
                        : `电脑获胜，${playerA?.studentName} 本次获得 +${rules.losePoints}`
                      : `${winnerIndex === 0 ? playerA?.studentName : blackPlayer?.studentName} 获胜 +${rules.winPoints}`}
                </p>
                <p className="result-sub">
                  {gameMode === "ai"
                    ? `用时 ${formatTime(seconds)}`
                    : `用时 ${formatTime(seconds)} · 负方 +${rules.losePoints}`}
                </p>
                <div className="coordinate-actions">
                  {canNextMatch && (
                    <button
                      type="button"
                      className="primary"
                      onClick={startNextMatch}
                    >
                      下一场
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    onClick={finishSession}
                  >
                    {canNextMatch ? "提前结束活动" : "结束活动并结算"}
                  </button>
                </div>
              </aside>
            )}
            </div>
          )}
        </main>

        <aside className="roster-panel">
          <div className="roster-panel-head">
            <h3>学生排行榜</h3>
            <span>
              已赛 {finishedMatches}/
              {gameMode === "ai"
                ? roster.length
                : Math.floor(roster.length / 2)}
            </span>
          </div>
          <p className="roster-panel-tip">按得分从高到低、用时从短到长排序</p>
          {roster.length === 0 ? (
            <p className="roster-empty">正在连接学生名单…</p>
          ) : (
            <ol className="roster-list">
              {leaderboard.map((record) => {
                const rank = leaderboard.indexOf(record) + 1;
                return (
                  <li key={`${record.player.studentId}-${record.finishedAt}`} className="roster-item is-done">
                    <span className="rank-badge">{rank}</span>
                    <div className="roster-person">
                      <strong>{record.player.studentName}</strong>
                      <small>{formatTime(record.result.timeSeconds)}</small>
                    </div>
                    <span className="roster-score">{record.result.score}</span>
                  </li>
                );
              })}
              {roster
                .filter((player) => !completedIds.has(player.studentId))
                .map((player) => {
                  const isPair =
                    player.studentId === pairAId ||
                    player.studentId === pairBId;
                  return (
                    <li
                      key={player.studentId}
                      className={[
                        "roster-item",
                        isPair ? "is-active" : "is-pending"
                      ].join(" ")}
                    >
                      <span className="rank-badge rank-badge-none">•</span>
                      <div className="roster-person">
                        <strong>{player.studentName}</strong>
                        <small>{isPair ? "本局参与" : "未参与"}</small>
                      </div>
                      <span className="roster-score">-</span>
                    </li>
                  );
                })}
            </ol>
          )}
          {records.length > 0 && (
            <button
              type="button"
              className="roster-finish-btn"
              onClick={finishSession}
            >
              结束活动
            </button>
          )}
        </aside>
      </div>

      {rulesEditorOpen && (
        <div className="overlay-mask">
          <div className="rules-card">
            <h2>积分规则设置</h2>
            <p className="rules-tip">由教师自定义胜负积分，保存后下一局生效</p>
            <label className="rules-field">
              获胜学生得分
              <input
                type="number"
                min="0"
                value={draftRules.winPoints}
                onChange={(event) =>
                  setDraftRules({
                    ...draftRules,
                    winPoints: Number(event.target.value)
                  })
                }
              />
            </label>
            <label className="rules-field">
              失败学生得分
              <input
                type="number"
                min="0"
                value={draftRules.losePoints}
                onChange={(event) =>
                  setDraftRules({
                    ...draftRules,
                    losePoints: Number(event.target.value)
                  })
                }
              />
            </label>
            <label className="rules-field">
              平局每人得分
              <input
                type="number"
                min="0"
                value={draftRules.drawPoints}
                onChange={(event) =>
                  setDraftRules({
                    ...draftRules,
                    drawPoints: Number(event.target.value)
                  })
                }
              />
            </label>
            <div className="rules-actions">
              <button type="button" className="primary" onClick={saveRulesEditor}>
                保存规则
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setRulesEditorOpen(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
