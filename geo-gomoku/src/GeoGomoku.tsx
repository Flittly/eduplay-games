import { useEffect, useMemo, useRef, useState } from "react";
import {
  BOARD_SIZES,
  DEFAULT_BOARD_SIZE,
  DEFAULT_HIDE_MODE,
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
  span,
  specOf,
  zeroIndex,
  zeroName,
  type AxisKind,
  type BoardRange,
  type BoardSizeId,
  type BoardSpec,
  type Hemi,
  type HideMode
} from "./geo";
import {
  BOARD_SHAPES,
  DEFAULT_BOARD_SHAPE,
  centerCellWidth,
  ghostMeridianSamples,
  ghostParallelSamples,
  globeSupportsSpec,
  makeViewport,
  meridianSamples,
  minNeighborGap,
  parallelSamples,
  pathFromSamples,
  project,
  randomRangeFor,
  rangeReachable,
  windowOutlineSamples,
  type BoardShape,
  type Box,
  type Viewport
} from "./projection";
import {
  DEFAULT_SKIN,
  SKINS,
  loadSkinImage,
  paintSkin,
  skinSrc,
  type SkinId
} from "./skin";

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

/**
 * 方形棋盘的绘制区：左边留一列纬度标签、下边留一行经度标签。
 * 四个数值与 v1.0.0 完全一致（118 / 80 / 30 / 70），老棋盘一格都没挪。
 */
const FLAT_BOX: Box = { x: 118, y: 80, w: VIEW_W - 118 - 30, h: VIEW_H - 80 - 70 };

/**
 * 圆形棋盘的绘制区：标签就摆在圆盘内部的中轴线上，所以四周只留一圈细边，
 * 圆盘铺满 848×848（半径 424）。
 * 画满是有理由的 —— 圆形棋盘的格子天生比方形的窄（球面上 5° 经度到高纬只剩 cos φ），
 * 只有把圆盘画到最大，格子和棋子才补得回可读的尺寸。
 */
const GLOBE_BOX: Box = { x: 46, y: 46, w: VIEW_W - 92, h: VIEW_H - 92 };

/** 两颗棋子之间的最小空隙占格距的比例：方形取 0.30（与 v1.0.0 的 16/56.4 一致）。 */
const FLAT_STONE_RATIO = 0.3;

/**
 * 圆形棋盘取 0.42，比如方形胖一圈。
 *
 * 不是为了好看：圆盘上格距从中心到边缘差好几倍，棋子半径得按**最窄那一格**定，
 * 于是相对中心那些宽格子就显得小。取大一点让中心附近的观感回来，
 * 同时 0.42×最窄格距 仍然小于半格，不会叠在一起。
 */
const GLOBE_STONE_RATIO = 0.42;

const MIN_STONE_R = 3;
const MAX_STONE_R = 22;

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

function emptyBoard(size: number): Cell[][] {
  return Array.from({ length: size }, () =>
    Array.from<Cell>({ length: size }).fill(null)
  );
}

function withDegreeSymbol(value: string): string {
  return value.replaceAll("度", "°");
}

/**
 * 五连判定。
 *
 * 棋盘边长一律读 `board.length`，**不读模块常量** —— v1.2.0 起有三种尺寸，
 * 任何一处漏改成 15，大棋盘上就会变成"只有左上角 15×15 能连成五子"，
 * 而且看起来完全像是学生自己没连对。
 */
function hasWin(
  board: Cell[][],
  row: number,
  col: number,
  player: 0 | 1
): boolean {
  const size = board.length;
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
        r < size &&
        c >= 0 &&
        c < size &&
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
  const size = board.length;
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
        r < size &&
        c >= 0 &&
        c < size &&
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
  const size = current.length;
  let best: { row: number; col: number } | null = null;
  let bestScore = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  const mid = (size - 1) / 2;
  const center = { row: mid, col: mid };

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
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
 * 与坐标输入方式共用一套外观。v1.2.0 起棋盘大小 / 形状 / 皮肤也用它。
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
  onChange,
  disabled
}: {
  title: string;
  value: T;
  options: SwitchOption<T>[];
  onChange: (value: T) => void;
  /** 置灰的选项。置灰的按钮仍然显示（学生能看见有这一档），只是点不动。 */
  disabled?: readonly T[];
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
            disabled={disabled ? disabled.includes(option.id) : false}
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
  spec,
  mode,
  text,
  onText,
  pick,
  onPick,
  onEnter
}: {
  kind: AxisKind;
  range: BoardRange;
  spec: BoardSpec;
  mode: InputMode;
  text: string;
  onText: (value: string) => void;
  pick: DegreePick;
  onPick: (value: DegreePick) => void;
  onEnter: () => void;
}) {
  const degrees = useMemo(
    () => axisDegreeOptions(kind, range, spec),
    [kind, range, spec]
  );
  // 半球没被显式选过时用本棋盘默认值：单半球棋盘不会一上来就吃一个必错的默认值。
  const hemi = pick.hemi ?? defaultHemi(kind, range, spec);
  const label = `${axisName(kind)}（${axisHemiText(kind, range, spec)}）`;

  if (mode === "type") {
    return (
      <label className="coord-field">
        {label}
        <input
          type="text"
          value={text}
          placeholder={`如 ${sampleInput(kind, range, "cn", spec)} / ${sampleInput(
            kind,
            range,
            "compact",
            spec
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
          : `度数每 ${spec.degStep}° 一档（共 ${degrees.length} 档），选完还要自己选半球`}
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
  const [boardSize, setBoardSize] = useState<BoardSizeId>(DEFAULT_BOARD_SIZE);
  const [boardShape, setBoardShape] = useState<BoardShape>(DEFAULT_BOARD_SHAPE);
  const [skin, setSkin] = useState<SkinId>(DEFAULT_SKIN);
  const spec = useMemo(() => specOf(boardSize), [boardSize]);
  const [board, setBoard] = useState<Cell[][]>(() =>
    emptyBoard(specOf(DEFAULT_BOARD_SIZE).grid)
  );
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
    () => buildAxes(range, spec),
    [range, spec]
  );

  /* ---------- 棋盘几何：两种形状共用同一套窗口，只换"经纬度 → 平面"这一步 ---------- */

  const isGlobe = boardShape === "globe";

  const viewport: Viewport = useMemo(
    () => makeViewport(boardShape, range, spec, isGlobe ? GLOBE_BOX : FLAT_BOX),
    [boardShape, range, spec, isGlobe]
  );

  /**
   * 棋子半径。
   *
   * 方形棋盘格距处处相等，直接按格子定；圆形棋盘从中心到边缘差好几倍，
   * 只能按**最窄的一对相邻交点**定 —— 否则边缘的棋子会叠在一起，
   * 而那正是圆形棋盘唯一"看起来不对"的地方（形状本身没问题，是尺寸没跟上）。
   */
  const stoneR = useMemo(() => {
    if (viewport.shape === "flat") {
      return Math.min(MAX_STONE_R, Math.max(MIN_STONE_R, viewport.step * FLAT_STONE_RATIO));
    }
    const gap = minNeighborGap(viewport, range, spec);
    return Math.min(MAX_STONE_R, Math.max(MIN_STONE_R, gap * GLOBE_STONE_RATIO));
  }, [viewport, range, spec]);

  /**
   * 轴标签字号。
   *
   * 方形按格距取 0.34；圆形取**视角中心那一格**的 0.30 ——
   * 不能按"最窄那一格"（在圆盘边缘、本来就不放标签）算，那会让中间的字小到读不清；
   * 也不能跟方形一样取 0.34，因为圆盘上经度标签是**横着排**的，
   * 而横排的可用宽度要再乘一个 cos(纬度)，是更紧的那一头（见 lonLabels）。
   */
  const labelFont = useMemo(() => {
    const basis =
      viewport.shape === "flat"
        ? viewport.step
        : centerCellWidth(viewport, spec);
    const ratio = viewport.shape === "flat" ? 0.34 : 0.3;
    return Math.min(20, Math.max(11, basis * ratio));
  }, [viewport, spec]);

  /** 每条格线是否标度数。三档尺寸的格线数都是奇数，隔一标一正好含末条。 */
  const latZero = zeroIndex("lat", range, spec);
  const lonZero = zeroIndex("lon", range, spec);
  const showLatLabel = useMemo(
    () => labelIndices(hideMode, latZero, spec.grid),
    [hideMode, latZero, spec.grid]
  );
  const showLonLabel = useMemo(
    () => labelIndices(hideMode, lonZero, spec.grid),
    [hideMode, lonZero, spec.grid]
  );
  const latRangeText = axisRangeText("lat", range, spec);
  const lonRangeText = axisRangeText("lon", range, spec);

  /* ---------- 圆形棋盘：把格线与标签按球面投影算成曲线 ---------- */

  const globePaths = useMemo(() => {
    if (viewport.shape !== "globe") {
      return null;
    }
    return {
      /** 窗口内：能下棋的那一块，画粗线。 */
      grid: LATS.map((lat, row) => ({
        key: `lat-${row}`,
        d: pathFromSamples(viewport, parallelSamples(range, spec, lat)),
        zero: row === latZero
      })).concat(
        LONGS.map((lon, col) => ({
          key: `lon-${col}`,
          d: pathFromSamples(viewport, meridianSamples(range, spec, lon)),
          zero: col === lonZero
        }))
      ),
      /**
       * 窗口外：同一条纬线 / 经线延伸到圆盘边界的部分，画得很淡。
       * 有它，圆盘那张图才读得出"一个地球仪"；没它，圆盘上会空出四个月牙。
       * 画淡是为了让"能下棋的范围"一眼可辨 —— 外面的线只是背景。
       */
      ghost: LATS.map((lat, row) => ({
        key: `ghost-lat-${row}`,
        d: pathFromSamples(viewport, ghostParallelSamples(lat))
      })).concat(
        LONGS.map((lon, col) => ({
          key: `ghost-lon-${col}`,
          d: pathFromSamples(viewport, ghostMeridianSamples(lon))
        }))
      ),
      /** 能下棋的范围那条边界。圆形下它是弧，学生靠它分清哪些交点可落。 */
      outline: pathFromSamples(viewport, windowOutlineSamples(range, spec))
    };
  }, [viewport, range, spec, LATS, LONGS, latZero, lonZero]);

  /* ---------- 皮肤贴图 ---------- */

  const skinCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [textures, setTextures] = useState<Record<string, HTMLImageElement>>({});

  useEffect(() => {
    let alive = true;
    const wanted = SKINS.map((item) => item.src).filter(
      (src): src is string => Boolean(src)
    );
    Promise.all(
      wanted.map((src) =>
        loadSkinImage(src)
          .then((img) => [src, img] as const)
          .catch(() => null)
      )
    ).then((loaded) => {
      if (!alive) {
        return;
      }
      const next: Record<string, HTMLImageElement> = {};
      for (const item of loaded) {
        if (item) {
          next[item[0]] = item[1];
        }
      }
      setTextures(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  const skinImage = useMemo(() => {
    const src = skinSrc(skin);
    return src ? textures[src] ?? null : null;
  }, [skin, textures]);

  useEffect(() => {
    const canvas = skinCanvasRef.current;
    if (!canvas) {
      return;
    }
    if (!skinImage) {
      // 换回「纸纹」时必须主动擦掉上一张贴图 ——
      // 这个 effect 早退的话，画布会保留上一张图继续显示，皮肤就"换不回去"了。
      canvas.getContext("2d")?.clearRect(0, 0, VIEW_W, VIEW_H);
      return;
    }
    paintSkin(canvas, skinImage, viewport, spec, VIEW_W);
  }, [skinImage, viewport, spec]);

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

  /**
   * 换棋盘大小 / 形状：只在设置界面可用。
   *
   * 为什么不能在对局中换：棋盘大小决定行列号的含义（同样"第 3 行"在不同规格下是不同的纬度），
   * 形状决定哪些窗口画得出来（圆形不伸进极区）。中途换要么把已有的棋子搬到别的坐标上，
   * 要么把这一局作废 —— 两个都不是学生能理解的。所以和「选人 / 分边」一样锁在设置界面。
   */
  function normalizeSize(nextSize: BoardSizeId, nextShape: BoardShape): BoardSizeId {
    // 圆形下"大"过不了可读性判据（见 projection.ts 的 globeSupportsSpec），自动退到中盘。
    if (nextShape === "globe" && !globeSupportsSpec(specOf(nextSize))) {
      return "medium";
    }
    return nextSize;
  }

  function applyBoardSetup(nextSize: BoardSizeId, nextShape: BoardShape) {
    if (phase !== "setup") {
      return;
    }
    const size = normalizeSize(nextSize, nextShape);
    const nextSpec = specOf(size);
    setBoardSize(size);
    setBoardShape(nextShape);
    // 窗口能留就留：三档的格线度数都是 5°，小盘的窗口在中盘 / 大盘里通常照样合法，
    // 只有"换了形状后落到极区"或"窗口比新棋盘还大"时才重掷。
    setRange((current) =>
      rangeReachable(current, nextSpec, nextShape)
        ? current
        : randomRangeFor(nextShape, nextSpec)
    );
  }

  function changeBoardSize(next: BoardSizeId) {
    applyBoardSetup(next, boardShape);
  }

  function changeBoardShape(next: BoardShape) {
    applyBoardSetup(boardSize, next);
  }

  function changeSkin(next: SkinId) {
    // 皮肤是对局中也能换的：它只影响底图，不动任何一个坐标。
    setSkin(next);
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
      pick.hemi ?? defaultHemi(kind, range, spec)
    );
  }

  function changeInputMode(mode: InputMode) {
    setInputMode(mode);
    setInputError("");
  }

  function resetBoard() {
    setBoard(emptyBoard(spec.grid));
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
    const latResult = parseDegreeInput(axisText("lat"), "lat", range, spec);
    if (!latResult.ok) {
      setInputError(latResult.error);
      return;
    }
    const lonResult = parseDegreeInput(axisText("lon"), "lon", range, spec);
    if (!lonResult.ok) {
      setInputError(lonResult.error);
      return;
    }
    const lat = latResult.value;
    const lon = lonResult.value;
    const row = rowOfLat(lat, range, spec);
    const col = colOfLon(lon, range, spec);
    // parseDegreeInput 已保证"落在窗口内 + 是每格度数的倍数"，
    // 两者合起来 row/col 必然在 0 ~ grid−1。
    // 这里只是兜底：万一以后窗口模型改了，宁可报错也不要把棋子画到棋盘外。
    if (row < 0 || row >= spec.grid || col < 0 || col >= spec.grid) {
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
        text: formatRowCol(row, col, range, spec)
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
    // 下一局的窗口按当前形状抽：圆形的可用窗口不伸进极区（见 projection.ts）。
    setRange(randomRangeFor(boardShape, spec));
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
  /* ---------- 绘制用的几何：全部由 viewport 推导，SVG 段只消费不推导 ---------- */

  /**
   * 棋盘四边。方形就是棋盘的外框；圆形是圆盘的外接方框。
   *
   * v1.0.0 那四个模块常量（LEFT / TOP / STEP / GRID）在这里被彻底替换掉 ——
   * 留着任何一个，换尺寸之后就会出现"棋子跟着走了、格线还在老位置"这类错，
   * 而且看起来完全像是学生数错了格子。
   */
  const boardEdges = useMemo(() => {
    if (viewport.shape === "flat") {
      const right = viewport.left + (spec.grid - 1) * viewport.step;
      const bottom = viewport.top + (spec.grid - 1) * viewport.step;
      return { left: viewport.left, top: viewport.top, right, bottom };
    }
    return {
      left: viewport.cx - viewport.radius,
      top: viewport.cy - viewport.radius,
      right: viewport.cx + viewport.radius,
      bottom: viewport.cy + viewport.radius
    };
  }, [viewport, spec.grid]);

  const { left: boardLeft, top: boardTop, right: rightX, bottom: bottomY } =
    boardEdges;

  /**
   * 圆盘上的两条中轴线。圆形棋盘的标签只贴着它们摆：
   * 圆盘越靠外格子越窄，标签只有在中间这一段才排得开。
   */
  const centerLon = range.lonLeft + span(spec) / 2;
  const centerLat = range.latTop - span(spec) / 2;

  /**
   * 纬度标签。方形沿左边界外缘竖排（沿用 v1.0.0 的摆法）；
   * 圆形沿中央经线竖排、落在圆盘内部 —— 圆盘没有"外侧"可以放标签。
   */
  const latLabels = useMemo(
    () =>
      LATS.map((lat, row) => {
        if (!showLatLabel[row]) {
          return null;
        }
        const text = formatLatCompact(lat);
        const zero = row === latZero;
        if (viewport.shape === "flat") {
          return {
            key: `lat-${row}`,
            text,
            zero,
            x: boardEdges.left - 10,
            y: boardEdges.top + row * viewport.step + 6
          };
        }
        const point = project(viewport, centerLon, lat);
        return point
          ? { key: `lat-${row}`, text, zero, x: point.x - 10, y: point.y + 5 }
          : null;
      }),
    [LATS, showLatLabel, latZero, viewport, boardEdges, centerLon]
  );

  /**
   * 经度标签。方形在棋盘下方横排；圆形沿中央纬线横排、落在圆盘内部。
   *
   * 圆形下还要多做一步「排得开才放」：球面上相邻经线的间距被 cos(纬度) 与正投影
   * 双重压缩，越靠圆盘边缘越窄，同一行的标签会叠成一团（「80°W75°W70°W…」）。
   * 与其把字号压到读不清，不如从中央经线往两边铺、铺不开的那几个就少放一个 ——
   * 被略过的度数仍然能从相邻标签数出来，格线本身一条没少。
   */
  const lonLabels = useMemo(() => {
    if (viewport.shape === "flat") {
      return LONGS.map((lon, col) => {
        if (!showLonLabel[col]) {
          return null;
        }
        return {
          key: `lon-${col}`,
          text: formatLonCompact(lon),
          zero: col === lonZero,
          x: boardEdges.left + col * viewport.step,
          y: boardEdges.bottom + 26
        };
      });
    }
    const midCol = (spec.grid - 1) / 2;
    const order = LONGS.map((_, col) => col).sort(
      (a, b) => Math.abs(a - midCol) - Math.abs(b - midCol)
    );
    /*
     * 标签的估算宽度（以字号为单位）。
     * 重体无衬线里数字约 0.6em、° 约 0.4em、字母约 0.75em；实测「80°W」
     * 在字号 14.5 时宽 42.6 单位 = 2.94em，即 0.735em/字符。
     * 这里取 0.75 并再加 0.12em 的缝 —— 略偏保守，宁可少放一个也不让它叠上。
     */
    const widthOf = (text: string) => text.length * 0.75 * labelFont;
    const needed = (a: string, b: string) =>
      (widthOf(a) + widthOf(b)) / 2 + labelFont * 0.12;
    const items: ({
      key: string;
      text: string;
      zero: boolean;
      x: number;
      y: number;
    } | null)[] = LONGS.map(() => null);
    const kept: { x: number; text: string }[] = [];
    const place = (col: number) => {
      const point = project(viewport, LONGS[col], centerLat);
      if (!point) {
        return;
      }
      const text = formatLonCompact(LONGS[col]);
      if (kept.some((other) => Math.abs(other.x - point.x) < needed(other.text, text))) {
        return;
      }
      kept.push({ x: point.x, text });
      items[col] = {
        key: `lon-${col}`,
        text,
        zero: col === lonZero,
        x: point.x,
        y: point.y + 20
      };
    };
    /*
     * 0° 那条先占位。
     *
     * 顺序很要紧：从中央经线往外铺的话，0° 经线可能正好卡在两个已占位之间被挤掉 ——
     * 而它恰恰是「只留锚点」档下学生唯一能依赖的那条。锚点优先于邻居。
     */
    if (lonZero !== null) {
      place(lonZero);
    }
    for (const col of order) {
      if (showLonLabel[col]) {
        place(col);
      }
    }
    return items;
  }, [
    LONGS,
    showLonLabel,
    lonZero,
    viewport,
    boardEdges,
    centerLat,
    spec.grid,
    labelFont
  ]);

  /**
   * 赤道 / 本初子午线的注记位置。这一版才有的参照物，学生一眼要能认出来。
   *
   * 方形贴在左边界内侧 / 上边界下方；圆形没有"外侧"，
   * 赤道挂在中央经线与赤道的交点旁、本初子午线挂在它与窗口上边界的交点旁。
   */
  const zeroNotes = useMemo(() => {
    const latText = zeroName("lat");
    const lonText = zeroName("lon");
    if (viewport.shape === "flat") {
      return {
        lat:
          latZero === null
            ? null
            : {
                text: latText,
                x: boardEdges.left + 8,
                y: boardEdges.top + latZero * viewport.step - 8
              },
        lon:
          lonZero === null
            ? null
            : {
                text: lonText,
                x: boardEdges.left + lonZero * viewport.step + 8,
                y: boardEdges.top + 16
              }
      };
    }
    const equator = latZero === null ? null : project(viewport, centerLon, 0);
    const prime = lonZero === null ? null : project(viewport, 0, range.latTop);
    return {
      lat: equator
        ? { text: latText, x: equator.x + 10, y: equator.y - 8 }
        : null,
      lon: prime ? { text: lonText, x: prime.x + 8, y: prime.y + 20 } : null
    };
  }, [viewport, boardEdges, latZero, lonZero, centerLon, range.latTop]);

  /**
   * 两条轴的标题。
   *
   * 方形沿用 v1.0.0 的摆法（贴着棋盘左下角外侧）；圆形摆到窗口边界的中点上 ——
   * "纬度 ↑"在北边界中点上方、"经度 →"在东边界中点右侧，才和圆盘对得上。
   * text-anchor 走内联样式：样式表里 `.axis-heading` 默认是 end（方形要的那个），
   * 圆形的"居中/齐左"必须内联才盖得住。
   */
  const axisHeadings = useMemo(() => {
    if (viewport.shape === "flat") {
      return {
        lat: {
          x: boardEdges.left - 4,
          y: boardEdges.top - 24,
          anchor: "end" as const,
          text: "纬度 ↑"
        },
        lon: {
          x: boardEdges.right - 12,
          y: boardEdges.bottom + 48,
          anchor: "end" as const,
          text: "经度 →"
        }
      };
    }
    const north = project(viewport, centerLon, range.latTop);
    const east = project(viewport, range.lonLeft + span(spec), centerLat);
    return {
      lat: {
        x: north ? north.x : viewport.cx,
        y: north ? north.y - 26 : boardEdges.top,
        anchor: "middle" as const,
        text: "纬度 ↑"
      },
      lon: {
        x: east ? east.x + 18 : boardEdges.right,
        y: east ? east.y : boardEdges.bottom,
        anchor: "start" as const,
        text: "经度 →"
      }
    };
  }, [viewport, boardEdges, centerLon, centerLat, range.latTop, range.lonLeft, spec]);

  /** 最后一手的画布坐标。圆形下球背面的点返回 null，这时候不画标记圈。 */
  const lastStonePoint = useMemo(
    () =>
      lastMove
        ? project(viewport, LONGS[lastMove.col], LATS[lastMove.row])
        : null,
    [lastMove, viewport, LONGS, LATS]
  );

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
                  （每格 {spec.degStep}°，共 {spec.grid}×{spec.grid} 个交点）
                </span>
                <button
                  type="button"
                  className="control-btn range-reroll"
                  onClick={() => setRange(randomRangeFor(boardShape, spec))}
                >
                  换一个范围
                </button>
              </div>

              <SegmentedSwitch
                title="棋盘形状"
                value={boardShape}
                options={BOARD_SHAPES}
                onChange={changeBoardShape}
              />

              <SegmentedSwitch
                title="棋盘大小"
                value={boardSize}
                options={BOARD_SIZES}
                onChange={changeBoardSize}
                disabled={isGlobe ? ["large"] : []}
              />

              {isGlobe && (
                <p className="setup-note">
                  圆形棋盘上「大」这一档用不了：25×25 跨 120° 铺到球面上，
                  最边上的格子会窄到看不清。所以圆盘只提供小 / 中两档。
                </p>
              )}

              <SegmentedSwitch
                title="棋盘皮肤"
                value={skin}
                options={SKINS}
                onChange={changeSkin}
              />

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
                  <span>
                    横轴为经度 · 纵轴为纬度 · 每格 {spec.degStep}°
                    {isGlobe ? " · 球面投影" : ""}
                  </span>
                </div>

                {/*
                  棋盘是两层叠出来的：canvas 在下面铺皮肤贴图，SVG 在上面画格线、标签、棋子。
                  两层都用 viewBox 的 940 用户单位做坐标系，所以严格对齐 ——
                  这也是为什么贴图不是"一张图片元素"，而是要按同一套 viewport 算出来。
                */}
                <div className="board-stage">
                  <canvas
                    ref={skinCanvasRef}
                    className="skin-canvas"
                    width={VIEW_W}
                    height={VIEW_H}
                  />

                  <svg className="board-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
                    {/* 纸纹皮肤没有贴图，底色只能由 SVG 自己铺 */}
                    {!skinImage &&
                      (viewport.shape === "flat" ? (
                        <rect width={VIEW_W} height={VIEW_H} className="board-bg" />
                      ) : (
                        <circle
                          className="board-bg"
                          cx={viewport.cx}
                          cy={viewport.cy}
                          r={viewport.radius}
                        />
                      ))}

                    {viewport.shape === "flat" ? (
                      <g className="grid-lines">
                        {LONGS.map((_, col) => {
                          const x = viewport.left + col * viewport.step;
                          return (
                            <line
                              key={`lon-${col}`}
                              className={col === lonZero ? "is-zero-line" : undefined}
                              x1={x}
                              y1={viewport.top}
                              x2={x}
                              y2={bottomY}
                            />
                          );
                        })}
                        {LATS.map((_, row) => {
                          const y = viewport.top + row * viewport.step;
                          return (
                            <line
                              key={`lat-${row}`}
                              className={row === latZero ? "is-zero-line" : undefined}
                              x1={viewport.left}
                              y1={y}
                              x2={rightX}
                              y2={y}
                            />
                          );
                        })}
                      </g>
                    ) : (
                      <>
                        {/*
                          窗口外延伸到圆盘边界的同一条格线，淡色。
                          有它，圆盘才读得出"一个地球仪"；没它，四角会空出四个月牙。
                        */}
                        <g className="ghost-lines">
                          {globePaths?.ghost.map((item) => (
                            <path key={item.key} d={item.d} />
                          ))}
                        </g>
                        <g className="grid-lines">
                          {globePaths?.grid.map((item) => (
                            <path
                              key={item.key}
                              className={item.zero ? "is-zero-line" : undefined}
                              d={item.d}
                            />
                          ))}
                        </g>
                        {globePaths && (
                          <path className="window-outline" d={globePaths.outline} />
                        )}
                        {/*
                          圆盘外圈。纸纹皮肤下棋盘底色与背景同色，没有这一圈
                          就看不出"这是一个地球仪"，只觉得格线画歪了。
                        */}
                        <circle
                          className="disc-outline"
                          cx={viewport.cx}
                          cy={viewport.cy}
                          r={viewport.radius}
                        />
                      </>
                    )}

                    {zeroNotes.lat && (
                      <text
                        className="zero-line-note"
                        x={zeroNotes.lat.x}
                        y={zeroNotes.lat.y}
                      >
                        {zeroNotes.lat.text}
                      </text>
                    )}
                    {zeroNotes.lon && (
                      <text
                        className="zero-line-note"
                        x={zeroNotes.lon.x}
                        y={zeroNotes.lon.y}
                      >
                        {zeroNotes.lon.text}
                      </text>
                    )}

                    {/*
                      字号按棋盘尺寸算（内联，样式表里那个固定 px 值盖不住）。
                      0° 那条再放大 12% —— v1.0.0 是靠一条 19px 的样式规则做的，
                      现在字号是变量，那条例就没法再表达"比别的大一点"了。
                    */}
                    <g className="axis-labels">
                      {latLabels.map((item) =>
                        item ? (
                          <text
                            key={item.key}
                            className={item.zero ? "is-zero-label" : undefined}
                            x={item.x}
                            y={item.y}
                            style={{
                              fontSize: item.zero ? labelFont * 1.12 : labelFont
                            }}
                          >
                            {item.text}
                          </text>
                        ) : null
                      )}
                      {lonLabels.map((item) =>
                        item ? (
                          <text
                            key={item.key}
                            className={
                              item.zero ? "lon-label is-zero-label" : "lon-label"
                            }
                            x={item.x}
                            y={item.y}
                            style={{
                              fontSize: item.zero ? labelFont * 1.12 : labelFont
                            }}
                          >
                            {item.text}
                          </text>
                        ) : null
                      )}
                    </g>

                    <text
                      className="axis-heading"
                      x={axisHeadings.lat.x}
                      y={axisHeadings.lat.y}
                      style={{ textAnchor: axisHeadings.lat.anchor }}
                    >
                      {axisHeadings.lat.text}
                    </text>
                    <text
                      className="axis-heading"
                      x={axisHeadings.lon.x}
                      y={axisHeadings.lon.y}
                      style={{ textAnchor: axisHeadings.lon.anchor }}
                    >
                      {axisHeadings.lon.text}
                    </text>

                    {lastStonePoint && (
                      <circle
                        className="last-marker"
                        cx={lastStonePoint.x}
                        cy={lastStonePoint.y}
                        r={stoneR * 0.94}
                      />
                    )}

                    {board.map((line, row) =>
                      line.map((cell, col) => {
                        if (cell === null) {
                          return null;
                        }
                        const center = project(
                          viewport,
                          LONGS[col],
                          LATS[row]
                        );
                        if (!center) {
                          return null;
                        }
                        return (
                          <circle
                            key={`${row}-${col}`}
                            className={
                              cell === 0 ? "stone stone-red" : "stone stone-black"
                            }
                            cx={center.x}
                            cy={center.y}
                            r={stoneR}
                          />
                        );
                      })
                    )}
                  </svg>
                </div>
              </section>

            {phase === "playing" && (
              <aside className="coordinate-panel">
                <h3>输入坐标落子</h3>
                <p className="coord-range-hint">
                  本棋盘经线、纬线每格 {spec.degStep}°，坐标要正好落在格点上
                </p>
                <SegmentedSwitch
                  title="格线标注"
                  value={hideMode}
                  options={HIDE_MODES}
                  onChange={setHideMode}
                />
                {/*
                  皮肤只换底图、不动任何坐标，所以对局中也允许随时换 ——
                  老师讲到"这块棋盘落在世界哪个位置"时直接切到卫星影像，不必退出重开。
                  尺寸与形状会动到窗口几何，只放在设置页。
                */}
                <SegmentedSwitch
                  title="棋盘皮肤"
                  value={skin}
                  options={SKINS}
                  onChange={changeSkin}
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
                      spec={spec}
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
                      spec={spec}
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
