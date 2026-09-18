import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bboxSize,
  computeCovered,
  findHintInfo,
  generateLayout,
  getProvince,
  KIND_LABEL,
  LEVELS,
  TILE_KINDS,
  TINY_BBOX
} from "./gameData";
import type { LevelDef, Tile, TileKind } from "./gameData";

export interface PlayerInfo {
  studentId: number;
  studentName: string;
  className: string | null;
  studentNo?: string;
}

export interface RoundResult {
  score: number;
  timeSeconds: number;
  correctCount: number;
  totalCount: number;
  won: boolean;
}

export interface RoundRecord {
  player: PlayerInfo;
  result: RoundResult;
  wrongAnswers: string[];
}

const TRAY_SIZE = 6;
const MAX_HINTS = 3;
const MAX_UNDOS = 3;
const SCORE_PER_GROUP = 10;
const HINT_COST = 5;
const UNDO_COST = 2;
const WIN_BONUS = 20;
/** 悔棋历史栈上限，避免长关卡无限增长 */
const HISTORY_LIMIT = 40;

const TILE_W = 74;
const TILE_H = 88;
const CELL_W = 37;
const CELL_H = 44;

const ARCHIVE_KEY = "shanhe_match3:mistakes:v1";

type Archive = Record<string, Record<string, number>>;

/** 一步操作前的完整局面，供悔棋精确回退 */
interface Snapshot {
  board: Tile[];
  tray: Tile[];
  cleared: string[];
  score: number;
}

/** 消除成功后的记忆弹窗；若这一手同时结束本局，把结算延后到关弹窗时执行 */
interface MatchCard {
  provinceId: string;
  outcome: {
    won: boolean;
    score: number;
    cleared: string[];
  } | null;
}

function loadArchive(): Archive {
  try {
    const raw = window.localStorage.getItem(ARCHIVE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Archive;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveArchive(archive: Archive) {
  try {
    window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
  } catch {
    // 本地存储不可用时静默降级，不影响游戏进行
  }
}

function mergeWeakness(studentId: number, provinceIds: string[]) {
  if (provinceIds.length === 0) {
    return;
  }
  const archive = loadArchive();
  const key = String(studentId);
  const entry = archive[key] ?? {};
  for (const provinceId of provinceIds) {
    entry[provinceId] = (entry[provinceId] ?? 0) + 1;
  }
  archive[key] = entry;
  saveArchive(archive);
}

function topWeak(studentId: number, limit: number): string[] {
  const entry = loadArchive()[String(studentId)];
  if (!entry) {
    return [];
  }
  return Object.entries(entry)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([provinceId]) => provinceId);
}

function TileFace({ tile }: { tile: Tile }) {
  const province = getProvince(tile.provinceId);
  // 港澳的 bbox 只有 1.59 / 12.19 单位，而牌面 svg 是拿 bbox 当 viewBox 单独缩放显示的，
  // 于是 stroke-width（viewBox 单位）换算到屏幕上会跟着放大 —— 澳门能放到 55.6 px，
  // 比形状本身（44 px）还宽，整块糊成实心红块。小要素改用不随缩放走的细描边。
  const tiny = bboxSize(province) < TINY_BBOX;
  return (
    <>
      <i className={`tile-tag tag-${tile.kind}`}>{KIND_LABEL[tile.kind]}</i>
      {tile.kind === "shape" ? (
        <svg
          className={tiny ? "tile-shape is-tiny" : "tile-shape"}
          viewBox={`${province.bbox[0]} ${province.bbox[1]} ${province.bbox[2]} ${province.bbox[3]}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          <path d={province.d} />
        </svg>
      ) : tile.kind === "abbr" ? (
        <span className="tile-abbr-text">{province.abbr}</span>
      ) : (
        <span className="tile-cap-text">{province.capital}</span>
      )}
    </>
  );
}

interface Props {
  roster: PlayerInfo[];
  onComplete: (player: PlayerInfo, result: RoundResult) => void;
  onSessionEnd: (records: RoundRecord[]) => void;
}

export default function ShanheMatch3({ roster, onComplete, onSessionEnd }: Props) {
  const [player, setPlayer] = useState<PlayerInfo | null>(
    roster.length === 1 ? roster[0] : null
  );
  const [records, setRecords] = useState<RoundRecord[]>([]);
  const [level, setLevel] = useState<LevelDef | null>(null);
  const [board, setBoard] = useState<Tile[]>([]);
  const [tray, setTray] = useState<Tile[]>([]);
  const [cleared, setCleared] = useState<string[]>([]);
  const [hinted, setHinted] = useState<string[]>([]);
  const [hintHighlight, setHintHighlight] = useState<number[]>([]);
  const [hintMessage, setHintMessage] = useState<string | null>(null);
  const [hintsLeft, setHintsLeft] = useState(MAX_HINTS);
  const [undosLeft, setUndosLeft] = useState(MAX_UNDOS);
  const [score, setScore] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [status, setStatus] = useState<"idle" | "playing" | "won" | "failed">(
    "idle"
  );
  const [trayBump, setTrayBump] = useState(0);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [matchCard, setMatchCard] = useState<MatchCard | null>(null);

  const covered = useMemo(() => computeCovered(board), [board]);

  useEffect(() => {
    // 记忆弹窗打开时暂停计时：读三要素卡片不该被计入用时
    if (status !== "playing" || matchCard) {
      return;
    }
    const timer = window.setInterval(() => {
      setSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [matchCard, status]);

  const startLevel = useCallback((def: LevelDef) => {
    setLevel(def);
    setBoard(generateLayout(def));
    setTray([]);
    setCleared([]);
    setHinted([]);
    setHintHighlight([]);
    setHintMessage(null);
    setHintsLeft(MAX_HINTS);
    setUndosLeft(MAX_UNDOS);
    setScore(0);
    setSeconds(0);
    setStatus("playing");
    setHistory([]);
    setMatchCard(null);
  }, []);

  const endRound = useCallback(
    (won: boolean, finalScore: number, clearedList: string[]) => {
      if (!player || !level) {
        return;
      }
      const weak = new Set<string>();
      for (const tile of tray) {
        weak.add(tile.provinceId);
      }
      for (const provinceId of hinted) {
        weak.add(provinceId);
      }
      const wrongAnswers = [...weak];
      mergeWeakness(player.studentId, wrongAnswers);

      const bonus = won ? WIN_BONUS : 0;
      const result: RoundResult = {
        score: Math.max(0, finalScore) + bonus,
        timeSeconds: seconds,
        correctCount: clearedList.length,
        totalCount: level.provinceIds.length,
        won
      };
      onComplete(player, result);
      setRecords((prev) => [...prev, { player, result, wrongAnswers }]);
      setStatus(won ? "won" : "failed");
    },
    [hinted, level, onComplete, player, seconds, tray]
  );

  const pickTile = useCallback(
    (tile: Tile) => {
      if (status !== "playing" || matchCard || covered.has(tile.uid)) {
        return;
      }
      const nextBoard = board.filter((item) => item.uid !== tile.uid);
      const nextTray = [...tray, tile];
      setHintHighlight([]);
      setHintMessage(null);

      const kinds = new Set(
        nextTray
          .filter((item) => item.provinceId === tile.provinceId)
          .map((item) => item.kind)
      );
      const complete = TILE_KINDS.every((kind) => kinds.has(kind));

      if (!complete) {
        // 记下这一手之前的局面，悔棋时精确回到这里
        setHistory((prev) => {
          const next = [...prev, { board, tray, cleared, score }];
          return next.length > HISTORY_LIMIT
            ? next.slice(next.length - HISTORY_LIMIT)
            : next;
        });
        setBoard(nextBoard);
        setTray(nextTray);
        if (nextTray.length >= TRAY_SIZE) {
          endRound(false, score, cleared);
        }
        return;
      }

      // 消除成功 = 本局检查点：这一组已计分、也弹过记忆卡，
      // 悔棋不能再把它变回卡槽/牌面（否则卡槽瞬间被塞满，消除计数与评分也被推翻）。
      // 所以清空历史栈 —— 悔棋只能回退「这次消除之后」的操作。
      setHistory([]);

      const finalTray = nextTray.filter(
        (item) => item.provinceId !== tile.provinceId
      );
      const nextScore = score + SCORE_PER_GROUP;
      const nextCleared = [...cleared, tile.provinceId];
      setBoard(nextBoard);
      setTray(finalTray);
      setScore(nextScore);
      setCleared(nextCleared);
      setTrayBump(Date.now());

      // 消除成功 → 弹窗把三要素再重复一遍（帮助学生记忆）。
      // 若这一手同时把本局打完，把结算推迟到弹窗关闭之后，学生仍能看到最后一组。
      const boardEmpty = nextBoard.length === 0;
      setMatchCard({
        provinceId: tile.provinceId,
        outcome: boardEmpty
          ? { won: finalTray.length === 0, score: nextScore, cleared: nextCleared }
          : null
      });
    },
    [board, cleared, covered, matchCard, score, status, tray]
  );

  const dismissMatchCard = useCallback(() => {
    const card = matchCard;
    setMatchCard(null);
    if (card?.outcome) {
      endRound(card.outcome.won, card.outcome.score, card.outcome.cleared);
    }
  }, [endRound, matchCard]);

  const handleHint = useCallback(() => {
    if (status !== "playing" || matchCard || hintsLeft <= 0) {
      return;
    }
    const info = findHintInfo(board, tray, TRAY_SIZE);
    if (!info) {
      return;
    }
    setHintHighlight(info.tileUids);
    setHintMessage(info.message);
    setHintsLeft((value) => value - 1);
    setScore((value) => Math.max(0, value - HINT_COST));
    setHinted((prev) =>
      prev.includes(info.provinceId) ? prev : [...prev, info.provinceId]
    );
  }, [board, hintsLeft, matchCard, status, tray]);

  const handleUndo = useCallback(() => {
    if (
      status !== "playing" ||
      matchCard ||
      undosLeft <= 0 ||
      history.length === 0
    ) {
      return;
    }
    const prev = history[history.length - 1];
    // 双保险：任何会让「已消除的组复活」的快照都不执行 —— 消除是检查点
    if (prev.cleared.length !== cleared.length) {
      setHistory([]);
      return;
    }
    setHistory((stack) => stack.slice(0, -1));
    setBoard(prev.board);
    setTray(prev.tray);
    setCleared(prev.cleared);
    // 先回到上一手之前的分值，再扣掉本次悔棋的代价
    setScore(Math.max(0, prev.score - UNDO_COST));
    setUndosLeft((value) => value - 1);
    setHintHighlight([]);
    setHintMessage(null);
  }, [cleared.length, history, matchCard, status, undosLeft]);

  const finishSession = useCallback(() => {
    if (records.length > 0) {
      onSessionEnd(records);
      setRecords([]);
    }
    setStatus("idle");
    setLevel(null);
    setBoard([]);
    setTray([]);
    setHistory([]);
    setMatchCard(null);
    setHintHighlight([]);
    setHintMessage(null);
  }, [onSessionEnd, records]);

  if (!player) {
    return (
      <div className="mode-picker">
        <h1>山河三消</h1>
        <p>请选择本次挑战的学生</p>
        <div className="student-grid">
          {roster.map((item) => (
            <button key={item.studentId} onClick={() => setPlayer(item)}>
              <strong>{item.studentName}</strong>
              <span>{item.className ?? "未分班"}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (status === "idle" || !level) {
    const weak = topWeak(player.studentId, 6);
    return (
      <div className="game">
        <header className="game-topbar">
          <div className="game-heading">
            <strong>山河三消</strong>
            <span>省级行政区三要素匹配 · 轮廓 × 简称 × 行政中心</span>
          </div>
          <div className="topbar-actions">
            <div className="score-panel">
              <div className="score-row">
                <span className="score-student">
                  {player.studentName} · {player.className ?? "未分班"}
                </span>
              </div>
            </div>
          </div>
        </header>
        <main className="quiz-main">
          <div className="start-card">
            <h2>选择关卡</h2>
            <div className="rules-summary">
              唯一消除规则：同省【轮廓 + 简称 + 行政中心】三张不同卡牌才能消除
            </div>
            <div className="level-list">
              {LEVELS.map((def) => (
                <button
                  key={def.id}
                  className="level-btn"
                  onClick={() => startLevel(def)}
                >
                  <strong>{def.name}</strong>
                  <span>{def.hint}</span>
                </button>
              ))}
            </div>
            {weak.length > 0 ? (
              <p className="weak-note">
                历史薄弱省区：
                {weak.map((id) => getProvince(id).name).join("、")}
              </p>
            ) : null}
            <button className="exit-session-btn" onClick={finishSession}>
              结束学习并上报记录
            </button>
          </div>
        </main>
      </div>
    );
  }

  const boardWidth = level.cols * CELL_W + TILE_W;
  const boardHeight = level.rows * CELL_H + TILE_H;
  const remainingGroups = level.provinceIds.length - cleared.length;
  const matchProvince = matchCard ? getProvince(matchCard.provinceId) : null;

  // 消除即检查点：刚消除完、手上没有可悔的棋时，把「按钮为什么是灰的」说清楚
  const undoLockedByCheckpoint =
    status === "playing" &&
    !matchCard &&
    !hintMessage &&
    history.length === 0 &&
    cleared.length > 0 &&
    undosLeft > 0;
  const lastClearedName =
    cleared.length > 0 ? getProvince(cleared[cleared.length - 1]).name : null;

  return (
    <div className="game">
      <header className="game-topbar">
        <div className="game-heading">
          <strong>山河三消</strong>
          <span>
            {level.name} · 剩余 {remainingGroups} 组 / 总 {level.provinceIds.length} 组
          </span>
        </div>
        <div className="topbar-actions">
          <div className="score-panel">
            <div className="score-row">
              <span className="score-student">
                {player.studentName} · {player.className ?? "未分班"}
              </span>
              <span className="timer-badge">{formatTime(seconds)}</span>
            </div>
            <div className="score-row score-metrics">
              <span>
                本局积分 <strong>{score}</strong>
              </span>
              <span>
                已消除 <strong>{cleared.length}</strong>
              </span>
            </div>
          </div>
          <button
            className="control-btn"
            onClick={handleHint}
            disabled={hintsLeft <= 0 || status !== "playing" || Boolean(matchCard)}
          >
            提示 ×{hintsLeft}
          </button>
          <button
            className="control-btn is-secondary"
            onClick={handleUndo}
            disabled={
              undosLeft <= 0 ||
              history.length === 0 ||
              status !== "playing" ||
              Boolean(matchCard)
            }
            title={
              history.length === 0
                ? "已消除的组合是检查点、不可悔棋；点一张牌之后才有可退回的棋"
                : "悔棋：把上一张牌退回它原来的位置（每次 -2 分）"
            }
          >
            悔棋 ×{undosLeft}
          </button>
        </div>
      </header>

      <main className="match-main">
        <div className="board-viewport">
          <div
            className="board"
            style={{ width: boardWidth, height: boardHeight }}
          >
            {board.map((tile) => {
              const isLocked = covered.has(tile.uid);
              const isHinted = hintHighlight.includes(tile.uid);
              return (
                <button
                  key={tile.uid}
                  className={[
                    "board-tile",
                    `kind-${tile.kind}`,
                    isLocked ? "is-locked" : "",
                    isHinted ? "is-hinted" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{
                    left: tile.c * CELL_W,
                    top: tile.r * CELL_H,
                    zIndex: 10 + tile.layer
                  }}
                  onClick={() => pickTile(tile)}
                  disabled={isLocked}
                  aria-label={`${getProvince(tile.provinceId).name}${
                    KIND_LABEL[tile.kind]
                  }`}
                >
                  <TileFace tile={tile} />
                </button>
              );
            })}
          </div>
        </div>

        <div
          className={`hint-bar${hintMessage ? " is-on" : ""}${
            undoLockedByCheckpoint ? " is-note" : ""
          }`}
        >
          <span className="hint-bar-label">
            {undoLockedByCheckpoint ? "检查点" : "提示"}
          </span>
          <p className="hint-bar-text">
            {hintMessage ??
              (undoLockedByCheckpoint
                ? `刚消除的【${
                    lastClearedName ?? "这一组"
                  }】已计分，这一组不会因悔棋回来；再点一张牌才有可悔的棋。`
                : "卡槽里凑齐同省【轮廓 + 简称 + 省会】即消除；僵局时点右上角「提示」看还差什么，点错可用「悔棋」退回上一张牌。")}
          </p>
        </div>

        <div className={`tray ${Date.now() - trayBump < 400 ? "is-bump" : ""}`}>
          <span className="tray-label">卡槽</span>
          <div className="tray-slots">
            {Array.from({ length: TRAY_SIZE }).map((_, index) => {
              const tile = tray[index];
              const isHinted = tile ? hintHighlight.includes(tile.uid) : false;
              return (
                <div
                  key={index}
                  className={[
                    "tray-slot",
                    tile ? `kind-${tile.kind}` : "is-empty",
                    isHinted ? "is-hinted" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-label={
                    tile
                      ? `${getProvince(tile.provinceId).name}${KIND_LABEL[tile.kind]}`
                      : `空卡槽${index + 1}`
                  }
                >
                  {tile ? <TileFace tile={tile} /> : null}
                </div>
              );
            })}
          </div>
          <span className="tray-rule">同省三要素自动消除 · 满 6 格无组合则失败</span>
        </div>
      </main>

      {matchCard && matchProvince ? (
        <div className="overlay-mask">
          <div className="match-card">
            <span className="match-card-badge">消除成功</span>
            <h2>{matchProvince.name}</h2>
            <div className="match-faces">
              {TILE_KINDS.map((kind) => (
                <div key={kind} className={`tray-slot match-face kind-${kind}`}>
                  <TileFace
                    tile={{
                      uid: -1,
                      provinceId: matchCard.provinceId,
                      kind,
                      c: 0,
                      r: 0,
                      layer: 0
                    }}
                  />
                </div>
              ))}
            </div>
            <p className="match-card-line">轮廓 × 简称 × 省会 三要素已集齐，再记一遍</p>
            <p className="match-card-memory">
              {matchProvince.name} · 简称「{matchProvince.abbr}」 · 行政中心{" "}
              {matchProvince.capital}
            </p>
            {matchCard.outcome ? (
              <p className="match-card-outcome">
                {matchCard.outcome.won
                  ? "最后一组也消除了，点「继续」查看成绩。"
                  : "牌堆已空，点「继续」查看本局结果。"}
              </p>
            ) : null}
            <button className="primary" onClick={dismissMatchCard}>
              记住了，继续
            </button>
          </div>
        </div>
      ) : null}

      {status === "won" || status === "failed" ? (
        <div className="overlay-mask">
          <div className="complete-card">
            <h2>{status === "won" ? "关卡通过！" : "本局失败"}</h2>
            <p className="complete-sub">
              {status === "won"
                ? `${level.name} 全部要素匹配完成`
                : "卡槽已满且无可消除组合"}
            </p>
            <div className="settle-grid">
              <div className="settle-item">
                <span>消除成功组数</span>
                <strong>{cleared.length}</strong>
              </div>
              <div className="settle-item">
                <span>独立完成（未用提示）</span>
                <strong>
                  {cleared.filter((id) => !hinted.includes(id)).length}
                </strong>
              </div>
              <div className="settle-item">
                <span>本局用时</span>
                <strong>{formatTime(seconds)}</strong>
              </div>
              <div className="settle-item">
                <span>本局获得积分</span>
                <strong>
                  {records.filter((r) => r.result.won === (status === "won")).slice(-1)[0]
                    ?.result.score ?? score}
                </strong>
              </div>
            </div>
            <div className="settle-weak">
              <h3>本局薄弱省区（已存入错题档案）</h3>
              {(() => {
                const weakIds = [
                  ...new Set([
                    ...tray.map((tile) => tile.provinceId),
                    ...hinted
                  ])
                ];
                return weakIds.length > 0 ? (
                  <p>{weakIds.map((id) => getProvince(id).name).join("、")}</p>
                ) : (
                  <p>没有薄弱省区，继续保持！</p>
                );
              })()}
            </div>
            <div className="complete-actions">
              {status === "won" && level.id < LEVELS.length ? (
                <button
                  className="primary"
                  onClick={() => startLevel(LEVELS[level.id])}
                >
                  下一关
                </button>
              ) : null}
              <button className="secondary" onClick={() => startLevel(level)}>
                再挑战本关
              </button>
              <button className="secondary" onClick={finishSession}>
                结束学习并上报记录
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
