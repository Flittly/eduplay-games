import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import mapData from "./data/province.json";

export interface PlayerInfo {
  studentId: number;
  studentName: string;
  className: string | null;
  studentNo?: string;
}

export interface PuzzleResult {
  score: number;
  timeSeconds: number;
  correctCount: number;
  totalCount: number;
}

export interface RoundRecord {
  player: PlayerInfo;
  result: PuzzleResult;
  mistakes: number;
  finishedAt: number;
}

export interface ScoreRules {
  perPiece: number;
  mistakePenalty: number;
  timeBonusEnabled: boolean;
  bonusWithinSeconds: number;
  bonusPoints: number;
}

export interface ProvincePuzzleProps {
  roster: PlayerInfo[];
  onComplete: (player: PlayerInfo, result: PuzzleResult) => void;
  onSessionEnd: (records: RoundRecord[]) => void;
}

interface Feature {
  id: string;
  name: string;
  centroid: [number, number];
  bbox: [number, number, number, number];
  d: string;
}

interface MapData {
  viewBox: [number, number, number, number];
  features: Feature[];
  inset?: {
    box: [number, number, number, number];
    viewBox: [number, number, number, number];
    dashD: string;
    islandsD: string;
  };
}

const MAP = mapData as unknown as MapData;
const FEATURES = MAP.features;
const VB_WIDTH = MAP.viewBox[2];
const VB_HEIGHT = MAP.viewBox[3];
const MIN_SNAP = 30;
const RULES_STORAGE_KEY = "eduplay.province-puzzle.rules.v1";

const DEFAULT_RULES: ScoreRules = {
  perPiece: 10,
  mistakePenalty: 5,
  timeBonusEnabled: true,
  bonusWithinSeconds: 120,
  bonusPoints: 60
};

type RoundPhase = "ready" | "running" | "paused" | "finished";

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function bboxSize(feature: Feature): number {
  return Math.max(
    feature.bbox[2] - feature.bbox[0],
    feature.bbox[3] - feature.bbox[1]
  );
}

function colorFor(index: number): string {
  const hue = (index * 137.508) % 360;
  return `hsl(${hue}, 56%, 62%)`;
}

function shortName(fullName: string): string {
  return fullName
    .replace(/壮族自治区$/, "")
    .replace(/回族自治区$/, "")
    .replace(/维吾尔自治区$/, "")
    .replace(/特别行政区$/, "")
    .replace(/自治区$/, "")
    .replace(/省$/, "")
    .replace(/市$/, "");
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function readSavedRules(): ScoreRules {
  try {
    const raw = localStorage.getItem(RULES_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_RULES };
    }
    const parsed = JSON.parse(raw) as Partial<ScoreRules>;
    const toNumber = (
      value: unknown,
      fallback: number
    ): number => {
      const num = Number(value);
      return Number.isFinite(num) && num >= 0 ? Math.round(num) : fallback;
    };
    return {
      perPiece: toNumber(parsed.perPiece, DEFAULT_RULES.perPiece),
      mistakePenalty: toNumber(
        parsed.mistakePenalty,
        DEFAULT_RULES.mistakePenalty
      ),
      timeBonusEnabled:
        typeof parsed.timeBonusEnabled === "boolean"
          ? parsed.timeBonusEnabled
          : DEFAULT_RULES.timeBonusEnabled,
      bonusWithinSeconds: toNumber(
        parsed.bonusWithinSeconds,
        DEFAULT_RULES.bonusWithinSeconds
      ),
      bonusPoints: toNumber(parsed.bonusPoints, DEFAULT_RULES.bonusPoints)
    };
  } catch {
    return { ...DEFAULT_RULES };
  }
}

function saveRules(rules: ScoreRules) {
  try {
    localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // 浏览器禁用 localStorage 时静默忽略，不影响游戏运行。
  }
}

function bonusFor(rules: ScoreRules, seconds: number): number {
  if (!rules.timeBonusEnabled) {
    return 0;
  }
  if (rules.bonusWithinSeconds <= 0) {
    return 0;
  }
  return seconds <= rules.bonusWithinSeconds ? rules.bonusPoints : 0;
}

function finalScoreFor(
  rules: ScoreRules,
  totalPieces: number,
  mistakeCount: number,
  seconds: number
): number {
  return Math.max(
    0,
    totalPieces * rules.perPiece -
      mistakeCount * rules.mistakePenalty +
      bonusFor(rules, seconds)
  );
}

export default function ProvincePuzzle({
  roster,
  onComplete,
  onSessionEnd
}: ProvincePuzzleProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [phase, setPhase] = useState<RoundPhase>("ready");
  const [seconds, setSeconds] = useState(0);
  const [placed, setPlaced] = useState<Set<string>>(() => new Set());
  const [dragging, setDragging] = useState<{
    id: string;
    bx: number;
    by: number;
  } | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [round, setRound] = useState(0);
  const [records, setRecords] = useState<RoundRecord[]>([]);
  const [roundWinner, setRoundWinner] = useState<RoundRecord | null>(null);
  const [rules, setRules] = useState<ScoreRules>(() => readSavedRules());
  const [draftRules, setDraftRules] = useState<ScoreRules>(DEFAULT_RULES);
  const [rulesEditorOpen, setRulesEditorOpen] = useState(false);

  const completedIds = useMemo(
    () => new Set(records.map((record) => record.player.studentId)),
    [records]
  );
  const activePlayer = useMemo(
    () =>
      roster.find((item) => item.studentId === activeId) ??
      roster.find((item) => !completedIds.has(item.studentId)) ??
      roster[0] ??
      null,
    [activeId, completedIds, roster]
  );

  // 平台下发学生名单后，默认选中第一位未完成的学生。
  useEffect(() => {
    if (roster.length === 0) {
      return;
    }
    if (
      activeId === null ||
      !roster.some((item) => item.studentId === activeId)
    ) {
      const firstOpen =
        roster.find((item) => !completedIds.has(item.studentId)) ?? roster[0];
      setActiveId(firstOpen ? firstOpen.studentId : null);
    }
  }, [activeId, completedIds, roster]);

  const trayOrder = useMemo(
    () => shuffle(FEATURES.map((feature) => feature.id)),
    // 每轮或切换学生时重新打乱。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [round, activeId]
  );

  const unplaced = trayOrder.filter((id) => !placed.has(id));
  const liveScore = Math.max(
    0,
    placed.size * rules.perPiece - mistakes * rules.mistakePenalty
  );

  useEffect(() => {
    if (phase !== "running") {
      return;
    }
    const timer = window.setInterval(() => {
      setSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, round, activeId]);

  const remainingPlayers = useMemo(
    () => roster.filter((item) => !completedIds.has(item.studentId)),
    [completedIds, roster]
  );

  const leaderboard = useMemo(
    () =>
      [...records].sort(
        (a, b) =>
          a.result.timeSeconds - b.result.timeSeconds ||
          b.result.score - a.result.score ||
          a.player.studentName.localeCompare(b.player.studentName, "zh-CN")
      ),
    [records]
  );

  function resetRound() {
    setPlaced(new Set());
    setMistakes(0);
    setSeconds(0);
    setPhase("ready");
    setRoundWinner(null);
    setDragging(null);
    setRound((value) => value + 1);
  }

  function startPlayer(studentId: number) {
    if (completedIds.has(studentId) || phase === "running") {
      return;
    }
    setActiveId(studentId);
    resetRound();
  }

  function toggleTimer() {
    if (!activePlayer) {
      return;
    }
    setPhase((current) =>
      current === "running" ? "paused" : "running"
    );
  }

  function restartRound() {
    if (!activePlayer || completedIds.has(activePlayer.studentId)) {
      return;
    }
    resetRound();
  }

  function toBoardPoint(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) {
      return { x: 0, y: 0 };
    }
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const ctm = svg.getScreenCTM();
    const projected = ctm ? point.matrixTransform(ctm.inverse()) : point;
    return { x: projected.x, y: projected.y };
  }

  function startDrag(event: ReactPointerEvent, id: string) {
    if (
      placed.has(id) ||
      phase !== "running" ||
      dragging ||
      !activePlayer
    ) {
      return;
    }
    const { x, y } = toBoardPoint(event.clientX, event.clientY);
    svgRef.current?.setPointerCapture(event.pointerId);
    setDragging({ id, bx: x, by: y });
  }

  function handlePointerMove(event: ReactPointerEvent) {
    if (!dragging) {
      return;
    }
    const { x, y } = toBoardPoint(event.clientX, event.clientY);
    setDragging({ id: dragging.id, bx: x, by: y });
  }

  function finishRound(secondsUsed: number) {
    if (!activePlayer) {
      return;
    }
    const score = finalScoreFor(
      rules,
      FEATURES.length,
      mistakes,
      secondsUsed
    );
    const result: PuzzleResult = {
      score,
      timeSeconds: secondsUsed,
      correctCount: FEATURES.length,
      totalCount: FEATURES.length
    };
    const record: RoundRecord = {
      player: activePlayer,
      result,
      mistakes,
      finishedAt: Date.now()
    };
    const nextRecords = [...records, record];
    setRecords(nextRecords);
    setRoundWinner(record);
    setPhase("finished");
    setDragging(null);

    window.setTimeout(() => {
      onComplete(activePlayer, result);
    }, 350);

    if (nextRecords.length === roster.length) {
      window.setTimeout(() => {
        onSessionEnd(nextRecords);
      }, 1500);
    }
  }

  function finishDrag(clientX: number, clientY: number) {
    if (!dragging || !activePlayer) {
      return;
    }

    const feature = FEATURES.find((item) => item.id === dragging.id);
    if (!feature) {
      setDragging(null);
      return;
    }

    const { x, y } = toBoardPoint(clientX, clientY);
    const [cx, cy] = feature.centroid;
    const distance = Math.hypot(x - cx, y - cy);
    const snapRadius = Math.max(bboxSize(feature) * 0.55, MIN_SNAP);
    const overBoard =
      x >= -30 && x <= VB_WIDTH + 30 && y >= -30 && y <= VB_HEIGHT + 30;

    if (distance <= snapRadius) {
      const next = new Set(placed);
      next.add(feature.id);
      setPlaced(next);
      setDragging(null);

      if (next.size === FEATURES.length) {
        finishRound(seconds);
      }
    } else if (overBoard) {
      setMistakes((value) => value + 1);
      setDragging(null);
    } else {
      setDragging(null);
    }
  }

  function handlePointerUp(event: ReactPointerEvent) {
    finishDrag(event.clientX, event.clientY);
  }

  function handlePointerCancel() {
    if (dragging) {
      setDragging(null);
    }
  }

  function openRulesEditor() {
    if (phase === "running") {
      return;
    }
    setDraftRules({ ...rules });
    setRulesEditorOpen(true);
  }

  function saveRulesEditor() {
    const toNumber = (value: number): number =>
      Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
    const next: ScoreRules = {
      perPiece: toNumber(draftRules.perPiece),
      mistakePenalty: toNumber(draftRules.mistakePenalty),
      timeBonusEnabled: draftRules.timeBonusEnabled,
      bonusWithinSeconds: toNumber(draftRules.bonusWithinSeconds),
      bonusPoints: toNumber(draftRules.bonusPoints)
    };
    setRules(next);
    saveRules(next);
    setRulesEditorOpen(false);
  }

  function finishSession() {
    if (records.length > 0) {
      onSessionEnd(records);
    }
  }

  const draggingFeature = dragging
    ? FEATURES.find((item) => item.id === dragging.id)
    : null;
  const timerLabel =
    phase === "running"
      ? "暂停"
      : phase === "paused"
        ? "继续计时"
        : "开始计时";
  const activeCompleted =
    activePlayer && completedIds.has(activePlayer.studentId);
  const nextPlayer =
    remainingPlayers.find((item) => item.studentId !== activeId) ??
    remainingPlayers[0] ??
    null;

  return (
    <div className="game">
      <header className="game-topbar">
        <div className="game-heading">
          <strong>行政区拼图</strong>
          <span>
            先选学生并点击“开始计时”，再把左侧拼块拖到右侧地图的正确位置
          </span>
        </div>

        <div className="topbar-actions">
          <div className="score-panel">
            <div className="score-row">
              <span className="score-student">
                {activePlayer
                  ? `${activePlayer.studentName}${
                      activePlayer.className
                        ? ` · ${activePlayer.className}`
                        : ""
                    }`
                  : "等待学生名单"}
              </span>
              <span className="timer-badge">⏱ {formatTime(seconds)}</span>
            </div>
            <div className="score-row score-metrics">
              <strong>
                {phase === "finished" && roundWinner
                  ? `${roundWinner.result.score} 分`
                  : `${liveScore} 分`}
              </strong>
              <span>已拼 {placed.size}/{FEATURES.length}</span>
              <span>错误 {mistakes}</span>
            </div>
          </div>

          <div className="timer-controls">
            {phase === "finished" && roundWinner ? (
              <button
                type="button"
                className="control-btn"
                disabled={!nextPlayer}
                onClick={() => {
                  if (nextPlayer) {
                    startPlayer(nextPlayer.studentId);
                  }
                }}
              >
                {nextPlayer ? `下一位：${nextPlayer.studentName}` : "本轮已完成"}
              </button>
            ) : (
              <button
                type="button"
                className={`control-btn ${
                  phase === "running" ? "is-primary" : ""
                }`}
                disabled={!activePlayer || activeCompleted}
                onClick={toggleTimer}
              >
                {timerLabel}
              </button>
            )}
            <button
              type="button"
              className="control-btn"
              disabled={!activePlayer || activeCompleted}
              onClick={restartRound}
            >
              重新打乱
            </button>
            <button
              type="button"
              className="control-btn"
              disabled={phase !== "ready"}
              onClick={openRulesEditor}
            >
              积分规则
            </button>
          </div>
        </div>
      </header>

      <div className="game-body">
        <aside className="tray">
          <p className="tray-rule">
            当前规则：拼对一块 +{rules.perPiece} · 放错一次 −
            {rules.mistakePenalty}
            {rules.timeBonusEnabled
              ? ` · ${formatTime(rules.bonusWithinSeconds)}内完成额外 +${rules.bonusPoints}`
              : " · 未启用时间奖励"}
            ，规则可由教师修改
          </p>
          {phase === "ready" && (
            <p className="tray-hint">点击「开始计时」后才能拖拽拼块</p>
          )}
          {phase === "paused" && (
            <p className="tray-hint">计时已暂停，点击「继续计时」恢复</p>
          )}
          <div className="tray-grid">
            {unplaced.map((id) => {
              const feature = FEATURES.find((item) => item.id === id);
              if (!feature) {
                return null;
              }
              const isSource = dragging?.id === id;
              const [minX, minY, maxX, maxY] = feature.bbox;
              const pad = Math.max(maxX - minX, maxY - minY) * 0.08 + 2;
              return (
                <button
                  key={id}
                  type="button"
                  className={[
                    "tray-card",
                    phase !== "running" ? "is-disabled" : "",
                    isSource ? "is-source" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onPointerDown={(event) => startDrag(event, id)}
                >
                  <svg
                    viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`}
                    aria-hidden="true"
                  >
                    <path
                      d={feature.d}
                      fill={colorFor(FEATURES.indexOf(feature))}
                      fillRule="evenodd"
                    />
                  </svg>
                  <span>{shortName(feature.name)}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="board">
          {phase === "ready" && activePlayer && (
            <div className="board-hint">
              <span>{activePlayer.studentName} 准备好了吗？</span>
              点击左上角「开始计时」后开始拼图
            </div>
          )}
          <svg
            ref={svgRef}
            className="board-svg"
            viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          >
            <g className="board-layer">
              {FEATURES.map((feature) => {
                const tiny = bboxSize(feature) < 22;
                return (
                  <g key={feature.id}>
                    <path
                      d={feature.d}
                      className="ghost"
                      fillRule="evenodd"
                    />
                    <text
                      x={feature.centroid[0]}
                      y={feature.centroid[1]}
                      className={
                        tiny ? "ghost-label ghost-label-tiny" : "ghost-label"
                      }
                    >
                      {feature.name}
                    </text>
                  </g>
                );
              })}
            </g>

            <g className="placed-layer">
              {FEATURES.map((feature) => {
                if (!placed.has(feature.id)) {
                  return null;
                }
                return (
                  <path
                    key={feature.id}
                    d={feature.d}
                    fill={colorFor(FEATURES.indexOf(feature))}
                    className="piece"
                    fillRule="evenodd"
                  />
                );
              })}
            </g>

            {MAP.inset && (
              <g className="inset-layer" pointerEvents="none">
                <svg
                  x={MAP.inset.box[0]}
                  y={MAP.inset.box[1]}
                  width={MAP.inset.box[2]}
                  height={MAP.inset.box[3]}
                  viewBox={`0 0 ${MAP.inset.viewBox[2]} ${MAP.inset.viewBox[3]}`}
                  className="inset-svg"
                  pointerEvents="none"
                >
                  <rect width="100%" height="100%" className="inset-ocean" />
                  <path
                    d={MAP.inset.islandsD}
                    className="inset-islands-path"
                    fillRule="evenodd"
                  />
                  <path d={MAP.inset.dashD} className="inset-dash" />
                </svg>
                <rect
                  className="inset-frame"
                  x={MAP.inset.box[0]}
                  y={MAP.inset.box[1]}
                  width={MAP.inset.box[2]}
                  height={MAP.inset.box[3]}
                />
              </g>
            )}

            {dragging && draggingFeature && (
              <g className="dragging" pointerEvents="none">
                <path
                  d={draggingFeature.d}
                  fill={colorFor(FEATURES.indexOf(draggingFeature))}
                  fillRule="evenodd"
                  transform={`translate(${dragging.bx - draggingFeature.centroid[0]},${dragging.by - draggingFeature.centroid[1]})`}
                />
                <text
                  x={dragging.bx}
                  y={dragging.by}
                  className="dragging-label"
                >
                  {shortName(draggingFeature.name)}
                </text>
              </g>
            )}
          </svg>
        </div>

        <aside className="roster-panel">
          <div className="roster-panel-head">
            <h3>学生排行榜</h3>
            <span>
              完成 {records.length}/{roster.length}
            </span>
          </div>
          <p className="roster-panel-tip">按完成用时由短到长排序</p>
          {roster.length === 0 ? (
            <p className="roster-empty">正在连接学生名单…</p>
          ) : (
            <ol className="roster-list">
              {leaderboard.map((record) => {
                const rank = leaderboard.indexOf(record) + 1;
                return (
                  <li
                    key={record.player.studentId}
                    className="roster-item is-done"
                  >
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
                .filter((item) => !completedIds.has(item.studentId))
                .map((item) => {
                  const isActive = item.studentId === activePlayer?.studentId;
                  return (
                    <li
                      key={item.studentId}
                      className={[
                        "roster-item",
                        isActive ? "is-active" : "is-pending",
                        phase !== "running" ? "is-clickable" : ""
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => startPlayer(item.studentId)}
                    >
                      <span className="rank-badge rank-badge-none">•</span>
                      <div className="roster-person">
                        <strong>{item.studentName}</strong>
                        <small>{isActive ? "当前学生" : "未开始"}</small>
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
              结束本次活动
            </button>
          )}
        </aside>
      </div>

      {roundWinner && phase === "finished" && (
        <div className="overlay-mask">
          <div className="complete-card">
            <h2>本轮完成！</h2>
            <p>
              {roundWinner.player.studentName} · 用时{" "}
              {formatTime(roundWinner.result.timeSeconds)} · 错误{" "}
              {roundWinner.mistakes} 次
            </p>
            <p className="complete-score">
              拼对 {FEATURES.length} 块 × {rules.perPiece} − 扣分{" "}
              {roundWinner.mistakes * rules.mistakePenalty}
              {rules.timeBonusEnabled
                ? ` + 速度奖励 ${bonusFor(rules, roundWinner.result.timeSeconds)}`
                : ""}
              = 本次 {roundWinner.result.score} 分
            </p>

            <div className="complete-ranks">
              <h3>当前排行榜</h3>
              <ol>
                {leaderboard.slice(0, 5).map((record, index) => (
                  <li key={record.player.studentId}>
                    <span>{index + 1}</span>
                    <strong>{record.player.studentName}</strong>
                    <small>{formatTime(record.result.timeSeconds)}</small>
                    <em>{record.result.score}分</em>
                  </li>
                ))}
              </ol>
            </div>

            <div className="complete-actions">
              {nextPlayer && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => startPlayer(nextPlayer.studentId)}
                >
                  下一位：{nextPlayer.studentName}
                </button>
              )}
              <button
                type="button"
                className="secondary"
                onClick={finishSession}
              >
                {nextPlayer ? "提前结束活动" : "结束活动并查看总成绩"}
              </button>
            </div>
          </div>
        </div>
      )}

      {rulesEditorOpen && (
        <div className="overlay-mask">
          <div className="rules-card">
            <h2>积分规则设置</h2>
            <p className="rules-tip">
              由教师为本次拼图自定义积分，修改后下一轮生效
            </p>

            <label className="rules-field">
              拼对一块得分
              <input
                type="number"
                min="0"
                value={draftRules.perPiece}
                onChange={(event) =>
                  setDraftRules({
                    ...draftRules,
                    perPiece: Number(event.target.value)
                  })
                }
              />
            </label>
            <label className="rules-field">
              放错一次扣分
              <input
                type="number"
                min="0"
                value={draftRules.mistakePenalty}
                onChange={(event) =>
                  setDraftRules({
                    ...draftRules,
                    mistakePenalty: Number(event.target.value)
                  })
                }
              />
            </label>

            <label className="rules-field rules-checkbox">
              <input
                type="checkbox"
                checked={draftRules.timeBonusEnabled}
                onChange={(event) =>
                  setDraftRules({
                    ...draftRules,
                    timeBonusEnabled: event.target.checked
                  })
                }
              />
              启用完成速度奖励
            </label>

            <div className="rules-bonus-row">
              <label className="rules-field">
                {formatTime(draftRules.bonusWithinSeconds)}内完成奖励
                <input
                  type="number"
                  min="0"
                  disabled={!draftRules.timeBonusEnabled}
                  value={draftRules.bonusWithinSeconds}
                  onChange={(event) =>
                    setDraftRules({
                      ...draftRules,
                      bonusWithinSeconds: Number(event.target.value)
                    })
                  }
                />
              </label>
              <label className="rules-field">
                奖励分数
                <input
                  type="number"
                  min="0"
                  disabled={!draftRules.timeBonusEnabled}
                  value={draftRules.bonusPoints}
                  onChange={(event) =>
                    setDraftRules({
                      ...draftRules,
                      bonusPoints: Number(event.target.value)
                    })
                  }
                />
              </label>
            </div>

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
