import { useEffect, useMemo, useState } from "react";

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

const GRID = 15;
const RULES_STORAGE_KEY = "eduplay.geo-gomoku.rules.v1";

const DEFAULT_RULES: ScoreRules = {
  winPoints: 20,
  losePoints: 5,
  drawPoints: 10
};

// 经线：东经 60°—130°，每 5° 一条。
const LONGS = Array.from({ length: GRID }, (_, index) => 60 + index * 5);
// 纬线：北纬 70°—0°，从上往下排列。
const LATS = Array.from({ length: GRID }, (_, index) => 70 - index * 5);

type Phase = "setup" | "playing" | "coord" | "roundDone";
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

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function GeoGomoku({
  roster,
  onComplete,
  onSessionEnd
}: GeoGomokuProps) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [pairAId, setPairAId] = useState<number | null>(null);
  const [pairBId, setPairBId] = useState<number | null>(null);
  const [currentIndex, setCurrentIndex] = useState<0 | 1>(0);
  const [board, setBoard] = useState<Cell[][]>(() => emptyBoard());
  const [pending, setPending] = useState<{ row: number; col: number } | null>(
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

  const completedIds = useMemo(
    () => new Set(records.map((record) => record.player.studentId)),
    [records]
  );

  const playerA =
    roster.find((player) => player.studentId === pairAId) ?? null;
  const playerB =
    roster.find((player) => player.studentId === pairBId) ?? null;
  const currentPlayer =
    currentIndex === 0 ? playerA : playerB;

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
    if (roster.length < 2) {
      return;
    }
    const pairValid =
      pairAId !== null &&
      pairBId !== null &&
      pairAId !== pairBId &&
      roster.some((player) => player.studentId === pairAId) &&
      roster.some((player) => player.studentId === pairBId);
    if (!pairValid) {
      const available = roster.filter(
        (player) => !completedIds.has(player.studentId)
      );
      if (available.length >= 2) {
        setPairAId(available[0].studentId);
        setPairBId(available[1].studentId);
      }
    }
  }, [completedIds, pairAId, pairBId, roster]);

  useEffect(() => {
    if (phase !== "playing" && phase !== "coord") {
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

  function resetBoard() {
    setBoard(emptyBoard());
    setPending(null);
    setWinnerIndex(null);
    setIsDraw(false);
    setSeconds(0);
    setCurrentIndex(0);
    setPhase("setup");
  }

  function startMatch() {
    if (!playerA || !playerB || playerA.studentId === playerB.studentId) {
      return;
    }
    resetBoard();
    setPhase("playing");
  }

  function selectIntersection(row: number, col: number) {
    if (
      phase !== "playing" ||
      !currentPlayer ||
      board[row][col] !== null
    ) {
      return;
    }
    setPending({ row, col });
    setPhase("coord");
  }

  function confirmCoordinate() {
    if (!pending || !playerA || !playerB) {
      return;
    }
    const { row, col } = pending;
    if (board[row][col] !== null) {
      setPending(null);
      setPhase("playing");
      return;
    }
    const next = board.map((line) => [...line]) as Cell[][];
    next[row][col] = currentIndex;
    setBoard(next);
    setPending(null);

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
    setPhase("playing");
  }

  function cancelCoordinate() {
    setPending(null);
    setPhase("playing");
  }

  function finishMatch(winner: 0 | 1 | null, draw: boolean) {
    if (!playerA || !playerB) {
      return;
    }
    const first: PlayerInfo = playerA;
    const second: PlayerInfo = playerB;
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
    let secondRecord: RoundRecord;
    if (draw) {
      firstRecord = createRecord(first, rules.drawPoints, false);
      secondRecord = createRecord(second, rules.drawPoints, false);
    } else {
      const firstWon = winner === 0;
      firstRecord = createRecord(
        first,
        firstWon ? rules.winPoints : rules.losePoints,
        firstWon
      );
      secondRecord = createRecord(
        second,
        firstWon ? rules.losePoints : rules.winPoints,
        !firstWon
      );
    }

    const nextRecords = [...records, firstRecord, secondRecord];
    setRecords(nextRecords);
    window.setTimeout(() => {
      onComplete(firstRecord.player, firstRecord.result);
      onComplete(secondRecord.player, secondRecord.result);
    }, 350);
  }

  function startNextMatch() {
    const available = roster.filter(
      (player) => !completedIds.has(player.studentId)
    );
    setMatchNo((value) => value + 1);
    resetBoard();
    if (available.length >= 2) {
      setPairAId(available[0].studentId);
      setPairBId(available[1].studentId);
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
  const canNextMatch = remainingPlayers.length >= 2;
  const bottomY = TOP + (GRID - 1) * STEP;
  const rightX = LEFT + (GRID - 1) * STEP;

  return (
    <div className="game">
      <header className="game-topbar">
        <div className="game-heading">
          <strong>经纬度五子棋</strong>
          <span>横线是纬线、竖线是经线，报出坐标后才能落子</span>
        </div>
        <div className="topbar-actions">
          <div className="score-panel">
            <div className="score-row">
              <span className="score-student">
                {currentPlayer
                  ? `当前：${currentPlayer.studentName}`
                  : "选择两名学生"}
              </span>
              <span className="timer-badge">⏱ {formatTime(seconds)}</span>
            </div>
            <div className="score-row score-metrics">
              <strong>
                {phase === "roundDone"
                  ? isDraw
                    ? "平局"
                    : `${winnerIndex === 0 ? playerA?.studentName : playerB?.studentName} 获胜`
                  : phase === "setup"
                    ? "第" + matchNo + "局"
                    : `${playerA?.studentName} 红方 vs ${playerB?.studentName} 黑方`}
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
                选择两名学生。落子前必须报出交点坐标，
                先连成五子的一方获胜。
              </p>
              <div className="rules-summary">
                胜方 +{rules.winPoints} · 负方 +{rules.losePoints} · 平局 +
                {rules.drawPoints}
              </div>

              {roster.length < 2 ? (
                <p className="setup-error">
                  请先在平台选择至少两名学生，再进入本游戏。
                </p>
              ) : (
                <>
                  <div className="pair-select">
                    <div className="pair-column">
                      <strong className="red-text">红方 A</strong>
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
                  </div>
                  <button
                    type="button"
                    className="start-btn"
                    disabled={
                      !playerA || !playerB || playerA.studentId === playerB.studentId
                    }
                    onClick={startMatch}
                  >
                    开始第 {matchNo} 局
                  </button>
                </>
              )}
            </section>
          )}

          {phase !== "setup" && (
            <section className="board-section">
              <div className="board-legend">
                <span className="legend-red">● {playerA?.studentName ?? "红方"}</span>
                <span className="legend-black">● {playerB?.studentName ?? "黑方"}</span>
                <span>横轴为经度 · 纵轴为纬度</span>
              </div>

              <svg
                className="board-svg"
                viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                onClick={(event) => {
                  const rect = (event.target as Element).getBoundingClientRect?.();
                  const svg = event.currentTarget;
                  const pt = svg.createSVGPoint();
                  pt.x = event.clientX;
                  pt.y = event.clientY;
                  const ctm = svg.getScreenCTM();
                  const local = ctm ? pt.matrixTransform(ctm.inverse()) : pt;
                  if (local.x < LEFT || local.x > rightX || local.y < TOP || local.y > bottomY) {
                    return;
                  }
                  const col = Math.round((local.x - LEFT) / STEP);
                  const row = Math.round((local.y - TOP) / STEP);
                  if (row >= 0 && row < GRID && col >= 0 && col < GRID) {
                    selectIntersection(row, col);
                  }
                }}
              >
                <rect width="100%" height="100%" className="board-bg" />

                <g className="grid-lines">
                  {LONGS.map((_, col) => {
                    const x = LEFT + col * STEP;
                    return (
                      <line
                        key={`lon-${col}`}
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
                        x1={LEFT}
                        y1={y}
                        x2={rightX}
                        y2={y}
                      />
                    );
                  })}
                </g>

                <g className="axis-labels">
                  {LATS.map((lat, row) => (
                    <text
                      key={`lat-label-${row}`}
                      x={LEFT - 10}
                      y={TOP + row * STEP + 6}
                    >
                      {lat}°N
                    </text>
                  ))}
                  {LONGS.map((lon, col) => (
                    <text
                      key={`lon-label-${col}`}
                      className="lon-label"
                      x={LEFT + col * STEP}
                      y={bottomY + 26}
                    >
                      {lon}°E
                    </text>
                  ))}
                </g>

                <text x={LEFT - 4} y={TOP - 24} className="axis-heading">
                  纬度 ↑
                </text>
                <text x={rightX - 12} y={bottomY + 48} className="axis-heading" textAnchor="end">
                  经度 →
                </text>

                {pending && (
                  <circle
                    className="pending-marker"
                    cx={point(pending.row, pending.col).x}
                    cy={point(pending.row, pending.col).y}
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
          )}
        </main>

        <aside className="roster-panel">
          <div className="roster-panel-head">
            <h3>学生排行榜</h3>
            <span>
              已赛 {records.length / 2}/{Math.floor(roster.length / 2)}
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

      {phase === "coord" && pending && currentPlayer && (
        <div className="overlay-mask">
          <div className="coordinate-card">
            <h3>请报出坐标</h3>
            <p>
              <strong className="current-player">{currentPlayer.studentName}</strong>
              ，请面向棋盘说出你选择交点的经纬度。
            </p>
            <p className="coordinate-tip">
              先读纬度（北纬 N），再读经度（东经 E）。
              确认读对后才能落子。
            </p>
            <div className="coordinate-actions">
              <button
                type="button"
                className="primary"
                onClick={confirmCoordinate}
              >
                已读对，落子
              </button>
              <button
                type="button"
                className="secondary"
                onClick={cancelCoordinate}
              >
                读错了，重选
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "roundDone" && (
        <div className="overlay-mask">
          <div className="result-card">
            <h2>{isDraw ? "平局" : "分出胜负！"}</h2>
            <p className="result-main">
              {isDraw
                ? `${playerA?.studentName} 与 ${playerB?.studentName} 平局，各 +${rules.drawPoints}`
                : `${winnerIndex === 0 ? playerA?.studentName : playerB?.studentName} 获胜 +${rules.winPoints}`}
            </p>
            <p className="result-sub">
              用时 {formatTime(seconds)} · 负方 +
              {rules.losePoints}
            </p>
            <div className="result-actions">
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
          </div>
        </div>
      )}

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
