import { useCallback, useEffect, useMemo, useState } from "react";
import {
  computeCovered,
  findHintGroup,
  generateLayout,
  getProvince,
  LEVELS,
  TILE_KINDS
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

const TILE_W = 74;
const TILE_H = 88;
const CELL_W = 37;
const CELL_H = 44;

const KIND_LABEL: Record<TileKind, string> = {
  shape: "轮廓",
  abbr: "简称",
  capital: "省会"
};

const ARCHIVE_KEY = "shanhe_match3:mistakes:v1";

type Archive = Record<string, Record<string, number>>;

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
  return (
    <>
      <i className={`tile-tag tag-${tile.kind}`}>{KIND_LABEL[tile.kind]}</i>
      {tile.kind === "shape" ? (
        <svg
          className="tile-shape"
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
  const [hintsLeft, setHintsLeft] = useState(MAX_HINTS);
  const [undosLeft, setUndosLeft] = useState(MAX_UNDOS);
  const [score, setScore] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [status, setStatus] = useState<"idle" | "playing" | "won" | "failed">(
    "idle"
  );
  const [trayBump, setTrayBump] = useState(0);

  const covered = useMemo(() => computeCovered(board), [board]);

  useEffect(() => {
    if (status !== "playing") {
      return;
    }
    const timer = window.setInterval(() => {
      setSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  const startLevel = useCallback((def: LevelDef) => {
    setLevel(def);
    setBoard(generateLayout(def));
    setTray([]);
    setCleared([]);
    setHinted([]);
    setHintHighlight([]);
    setHintsLeft(MAX_HINTS);
    setUndosLeft(MAX_UNDOS);
    setScore(0);
    setSeconds(0);
    setStatus("playing");
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
      if (status !== "playing" || covered.has(tile.uid)) {
        return;
      }
      const nextBoard = board.filter((item) => item.uid !== tile.uid);
      const nextTray = [...tray, tile];
      setHintHighlight([]);

      const kinds = new Set(
        nextTray
          .filter((item) => item.provinceId === tile.provinceId)
          .map((item) => item.kind)
      );
      const complete = TILE_KINDS.every((kind) => kinds.has(kind));

      if (!complete) {
        setBoard(nextBoard);
        setTray(nextTray);
        if (nextTray.length >= TRAY_SIZE) {
          endRound(false, score, cleared);
        }
        return;
      }

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

      if (nextBoard.length === 0 && finalTray.length === 0) {
        endRound(true, nextScore, nextCleared);
      } else if (nextBoard.length === 0) {
        // 牌堆已空但卡槽还有凑不齐的组合，无法继续
        endRound(false, nextScore, nextCleared);
      }
    },
    [board, cleared, covered, endRound, score, status, tray]
  );

  const handleHint = useCallback(() => {
    if (status !== "playing" || hintsLeft <= 0) {
      return;
    }
    const group = findHintGroup(board, tray);
    if (!group) {
      return;
    }
    setHintHighlight(group.tileUids);
    setHintsLeft((value) => value - 1);
    setScore((value) => Math.max(0, value - HINT_COST));
    setHinted((prev) =>
      prev.includes(group.provinceId) ? prev : [...prev, group.provinceId]
    );
  }, [board, hintsLeft, status, tray]);

  const handleUndo = useCallback(() => {
    if (status !== "playing" || undosLeft <= 0 || tray.length === 0) {
      return;
    }
    const last = tray[tray.length - 1];
    setBoard((prev) => [...prev, last]);
    setTray((prev) => prev.slice(0, -1));
    setUndosLeft((value) => value - 1);
    setScore((value) => Math.max(0, value - UNDO_COST));
    setHintHighlight([]);
  }, [status, tray, undosLeft]);

  const finishSession = useCallback(() => {
    if (records.length > 0) {
      onSessionEnd(records);
      setRecords([]);
    }
    setStatus("idle");
    setLevel(null);
    setBoard([]);
    setTray([]);
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
            disabled={hintsLeft <= 0 || status !== "playing"}
          >
            提示 ×{hintsLeft}
          </button>
          <button
            className="control-btn is-secondary"
            onClick={handleUndo}
            disabled={undosLeft <= 0 || tray.length === 0 || status !== "playing"}
          >
            撤回 ×{undosLeft}
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
                >
                  {tile ? <TileFace tile={tile} /> : null}
                </div>
              );
            })}
          </div>
          <span className="tray-rule">同省三要素自动消除 · 满 6 格无组合则失败</span>
        </div>
      </main>

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
