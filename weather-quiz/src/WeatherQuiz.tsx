import { useEffect, useMemo, useState } from "react";
import Media from "./Media";
import type {
  LevelId,
  LevelInfo,
  PlayerInfo,
  Question,
  QuizResult,
  RoundRecord,
  ScoreRules
} from "./types";

interface WeatherQuizProps {
  roster: PlayerInfo[];
  questions: Question[];
  level: LevelId;
  levelInfo: LevelInfo | null;
  onComplete: (player: PlayerInfo, result: QuizResult) => void;
  onSessionEnd: (records: RoundRecord[]) => void;
  onBack: () => void;
}

const RULES_STORAGE_KEY = "eduplay.weather-quiz.rules.v1";

const DEFAULT_RULES: ScoreRules = {
  perCorrect: 10,
  wrongPenalty: 2,
  hintPenalty: 2
};

type Phase = "ready" | "playing" | "answered" | "roundDone";

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
      perCorrect: toNumber(parsed.perCorrect, DEFAULT_RULES.perCorrect),
      wrongPenalty: toNumber(parsed.wrongPenalty, DEFAULT_RULES.wrongPenalty),
      hintPenalty: toNumber(parsed.hintPenalty, DEFAULT_RULES.hintPenalty)
    };
  } catch {
    return { ...DEFAULT_RULES };
  }
}

function saveRules(rules: ScoreRules) {
  try {
    localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // 浏览器禁用 localStorage 时忽略即可。
  }
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function WeatherQuiz({
  roster,
  questions,
  level,
  levelInfo,
  onComplete,
  onSessionEnd,
  onBack
}: WeatherQuizProps) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [questionCount, setQuestionCount] = useState(10);
  const [roundQuestions, setRoundQuestions] = useState<Question[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [wrongPicked, setWrongPicked] = useState<Set<string>>(new Set());
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [wrongClicks, setWrongClicks] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hintExpanded, setHintExpanded] = useState(false);

  const [score, setScore] = useState(0);
  const [firstTryCorrect, setFirstTryCorrect] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [round, setRound] = useState(0);

  const [records, setRecords] = useState<RoundRecord[]>([]);
  const [roundWinner, setRoundWinner] = useState<RoundRecord | null>(null);
  const [rules, setRules] = useState<ScoreRules>(() => readSavedRules());
  const [draftRules, setDraftRules] = useState<ScoreRules>(DEFAULT_RULES);
  const [rulesEditorOpen, setRulesEditorOpen] = useState(false);

  const choices = useMemo(() => {
    const total = questions.length;
    return [10, 20, 50].filter((n) => n <= total).length
      ? [10, 20, 50].filter((n) => n <= total)
      : [total];
  }, [questions.length]);

  const completedIds = useMemo(
    () => new Set(records.map((record) => record.player.studentId)),
    [records]
  );
  const activePlayer =
    roster.find((player) => player.studentId === activeId) ??
    roster.find((player) => !completedIds.has(player.studentId)) ??
    roster[0] ??
    null;

  useEffect(() => {
    if (roster.length === 0) {
      return;
    }
    if (activeId === null || !roster.some((player) => player.studentId === activeId)) {
      const firstOpen =
        roster.find((player) => !completedIds.has(player.studentId)) ?? roster[0];
      if (firstOpen) {
        setActiveId(firstOpen.studentId);
      }
    }
  }, [activeId, completedIds, roster]);

  // 切换等级时回到准备状态，避免把不同等级的题混在一局里。
  useEffect(() => {
    setPhase("ready");
    setRoundQuestions([]);
    setRecords([]);
    setRoundWinner(null);
    setQuestionIndex(0);
    setScore(0);
    setFirstTryCorrect(0);
    setMistakes(0);
    setSeconds(0);
  }, [level]);

  useEffect(() => {
    if (phase !== "playing" && phase !== "answered") {
      return;
    }
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase, round, activeId]);

  const currentQuestion =
    roundQuestions[Math.min(questionIndex, roundQuestions.length - 1)] ?? null;
  const currentHints = currentQuestion?.hints ?? [];
  const visibleHints = currentHints.slice(0, hintsUsed);

  const remainingPlayers = useMemo(
    () => roster.filter((player) => !completedIds.has(player.studentId)),
    [completedIds, roster]
  );

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

  function resetRoundForPlayer() {
    setQuestionIndex(0);
    setSelectedAnswer(null);
    setWrongPicked(new Set());
    setWrongClicks(0);
    setHintsUsed(0);
    setHintExpanded(false);
    setScore(0);
    setFirstTryCorrect(0);
    setMistakes(0);
    setSeconds(0);
    setRoundWinner(null);
    setPhase("ready");
    setRound((value) => value + 1);
  }

  function startPlayer(studentId: number) {
    if (completedIds.has(studentId) || phase === "playing" || phase === "answered") {
      return;
    }
    setActiveId(studentId);
    resetRoundForPlayer();
  }

  function startRound() {
    if (!activePlayer || questions.length === 0) {
      return;
    }
    const count = Math.min(Math.max(questionCount, 1), questions.length);
    setRoundQuestions(shuffle(questions).slice(0, count));
    setQuestionIndex(0);
    setSelectedAnswer(null);
    setWrongPicked(new Set());
    setWrongClicks(0);
    setHintsUsed(0);
    setHintExpanded(false);
    setScore(0);
    setFirstTryCorrect(0);
    setMistakes(0);
    setSeconds(0);
    setRoundWinner(null);
    setPhase("playing");
    setRound((value) => value + 1);
  }

  function revealHint() {
    if (phase !== "playing" || hintsUsed >= currentHints.length) {
      return;
    }
    setHintsUsed((value) => value + 1);
    setHintExpanded(true);
  }

  function openRulesEditor() {
    if (phase !== "ready") {
      return;
    }
    setDraftRules({ ...rules });
    setRulesEditorOpen(true);
  }

  function saveRulesEditor() {
    const toNumber = (value: number): number =>
      Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
    const next: ScoreRules = {
      perCorrect: toNumber(draftRules.perCorrect),
      wrongPenalty: toNumber(draftRules.wrongPenalty),
      hintPenalty: toNumber(draftRules.hintPenalty)
    };
    setRules(next);
    saveRules(next);
    setRulesEditorOpen(false);
  }

  function chooseOption(name: string) {
    if (!currentQuestion || phase !== "playing" || wrongPicked.has(name)) {
      return;
    }
    if (name === currentQuestion.answer) {
      const gained = Math.max(
        0,
        rules.perCorrect - wrongClicks * rules.wrongPenalty - hintsUsed * rules.hintPenalty
      );
      setScore((value) => value + gained);
      setFirstTryCorrect((value) => value + (wrongClicks === 0 ? 1 : 0));
      setSelectedAnswer(name);
      setPhase("answered");
    } else {
      setWrongPicked((value) => new Set(value).add(name));
      setWrongClicks((value) => value + 1);
      setMistakes((value) => value + 1);
    }
  }

  function goNextQuestion() {
    if (questionIndex + 1 < roundQuestions.length) {
      setQuestionIndex((value) => value + 1);
      setPhase("playing");
      setSelectedAnswer(null);
      setWrongPicked(new Set());
      setWrongClicks(0);
      setHintsUsed(0);
      setHintExpanded(false);
      return;
    }
    finishRound();
  }

  function finishRound() {
    if (!activePlayer) {
      return;
    }
    const result: QuizResult = {
      score,
      timeSeconds: seconds,
      correctCount: firstTryCorrect,
      totalCount: roundQuestions.length
    };
    const record: RoundRecord = {
      player: activePlayer,
      result,
      wrongAnswers: mistakes,
      finishedAt: Date.now()
    };
    const nextRecords = [...records, record];
    setRecords(nextRecords);
    setRoundWinner(record);
    setPhase("roundDone");

    window.setTimeout(() => onComplete(activePlayer, result), 300);

    if (nextRecords.length === roster.length) {
      window.setTimeout(() => onSessionEnd(nextRecords), 1300);
    }
  }

  function finishSession() {
    if (records.length > 0) {
      onSessionEnd(records);
    }
  }

  const nextPlayer =
    remainingPlayers.find((player) => player.studentId !== activeId) ??
    remainingPlayers[0] ??
    null;

  return (
    <div className="game">
      <header className="game-topbar">
        <div className="game-heading">
          <strong>气象要素识别</strong>
          <span>
            {levelInfo ? levelInfo.subtitle : ""} · 看图片选名称，答错或使用提示会扣分
          </span>
        </div>

        <div className="topbar-actions">
          <div className="score-panel">
            <div className="score-row">
              <span className="score-student">
                {activePlayer ? activePlayer.studentName : "等待学生名单"}
              </span>
              <span className="timer-badge">⏱ {formatTime(seconds)}</span>
            </div>
            <div className="score-row score-metrics">
              <strong>{score} 分</strong>
              <span>
                首答正确 {firstTryCorrect}/{roundQuestions.length || questionCount}
              </span>
              <span>错误 {mistakes}</span>
            </div>
          </div>
          <button
            type="button"
            className="control-btn"
            disabled={phase !== "ready"}
            onClick={openRulesEditor}
          >
            积分规则
          </button>
          <button type="button" className="control-btn" onClick={onBack}>
            切换等级
          </button>
        </div>
      </header>

      <div className="game-body">
        <main className="quiz-main">
          {phase === "ready" && (
            <section className="start-card">
              <h2>{levelInfo ? levelInfo.name + "组" : ""}气象要素识别</h2>
              <p>
                观察图片（天气符号、真实照片、气候统计图或天气系统示意图），
                从四个选项中选出正确答案。
              </p>

              {levelInfo && (
                <div className="scope-box">
                  <strong>本级考查范围</strong>
                  <ul>
                    {levelInfo.scope.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rules-summary">
                当前规则：答对 +{rules.perCorrect} · 答错 −{rules.wrongPenalty} ·
                每条提示 −{rules.hintPenalty}
              </div>
              <button type="button" className="rules-edit-btn" onClick={openRulesEditor}>
                修改积分规则
              </button>

              {roster.length > 1 && (
                <div className="player-pick">
                  <strong>本轮学生</strong>
                  <div className="player-pick-options">
                    {roster.map((player) => {
                      const done = completedIds.has(player.studentId);
                      const active = player.studentId === activePlayer?.studentId;
                      return (
                        <button
                          key={player.studentId}
                          type="button"
                          className={[done ? "is-done" : "", active ? "is-active" : ""]
                            .filter(Boolean)
                            .join(" ")}
                          disabled={done}
                          onClick={() => startPlayer(player.studentId)}
                        >
                          {player.studentName}
                          {done ? "（已完成）" : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="question-count">
                <strong>本局题目数</strong>
                <div className="question-count-options">
                  {choices.map((count) => (
                    <button
                      key={count}
                      type="button"
                      className={count === questionCount ? "is-active" : ""}
                      onClick={() => setQuestionCount(count)}
                    >
                      {count} 题
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                className="start-btn"
                disabled={!activePlayer || questions.length === 0}
                onClick={startRound}
              >
                开始本轮
              </button>
            </section>
          )}

          {phase !== "ready" && currentQuestion && (
            <section className="question-stage">
              <div className="question-progress">
                第 {Math.min(questionIndex + 1, roundQuestions.length)} /{" "}
                {roundQuestions.length} 题 · {currentQuestion.category} · 每答对 +
                {rules.perCorrect}
              </div>

              <Media
                src={currentQuestion.image}
                alt={currentQuestion.prompt}
                kind={currentQuestion.kind}
              />

              <p className="question-prompt">{currentQuestion.prompt}</p>

              <div className="hint-area">
                {!hintExpanded && phase === "playing" && (
                  <button
                    type="button"
                    className="hint-btn"
                    disabled={hintsUsed >= currentHints.length}
                    onClick={revealHint}
                  >
                    查看提示（扣 {rules.hintPenalty} 分）
                  </button>
                )}
                {hintExpanded && (
                  <>
                    {visibleHints.map((hint, index) => (
                      <p key={index} className="hint-text">
                        💡 {hint}
                      </p>
                    ))}
                    {phase === "playing" && hintsUsed < currentHints.length && (
                      <button
                        type="button"
                        className="hint-btn is-small"
                        onClick={revealHint}
                      >
                        再给一条提示
                      </button>
                    )}
                  </>
                )}
              </div>

              <div className="options-grid">
                {currentQuestion.options.map((name) => {
                  const isWrongPicked = wrongPicked.has(name);
                  const isCorrect =
                    phase === "answered" && name === currentQuestion.answer;
                  const isSelected = phase === "answered" && selectedAnswer === name;
                  const optionClass = [
                    isCorrect ? "is-correct" : "",
                    isSelected && !isCorrect ? "is-wrong" : "",
                    isWrongPicked ? "is-disabled" : ""
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <button
                      key={name}
                      type="button"
                      className={`option-btn ${optionClass}`}
                      disabled={phase === "answered" || isWrongPicked}
                      onClick={() => chooseOption(name)}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>

              {wrongPicked.size > 0 && phase === "playing" && (
                <p className="feedback-wrong">
                  选错了，再试一次（已扣 {rules.wrongPenalty} 分）
                </p>
              )}
              {phase === "answered" && (
                <div className="answered-bar">
                  <p>
                    ✅ 回答正确！正确答案是<b>{currentQuestion.answer}</b>
                  </p>
                  <p className="explain-text">{currentQuestion.explain}</p>
                  <button type="button" onClick={goNextQuestion}>
                    {questionIndex + 1 < roundQuestions.length
                      ? "下一题"
                      : "查看本轮成绩"}
                  </button>
                </div>
              )}
            </section>
          )}
        </main>

        <aside className="roster-panel">
          <div className="roster-panel-head">
            <h3>学生排行榜</h3>
            <span>
              完成 {records.length}/{roster.length}
            </span>
          </div>
          <p className="roster-panel-tip">按得分从高到低、用时从短到长排序</p>
          {roster.length === 0 ? (
            <p className="roster-empty">正在连接学生名单…</p>
          ) : (
            <ol className="roster-list">
              {leaderboard.map((record, index) => (
                <li key={record.player.studentId} className="roster-item is-done">
                  <span className="rank-badge">{index + 1}</span>
                  <div className="roster-person">
                    <strong>{record.player.studentName}</strong>
                    <small>{formatTime(record.result.timeSeconds)}</small>
                  </div>
                  <span className="roster-score">{record.result.score}</span>
                </li>
              ))}
              {roster
                .filter((player) => !completedIds.has(player.studentId))
                .map((player) => {
                  const active = player.studentId === activePlayer?.studentId;
                  return (
                    <li
                      key={player.studentId}
                      className={[
                        "roster-item",
                        active ? "is-active" : "is-pending",
                        phase === "ready" || phase === "roundDone" ? "is-clickable" : ""
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => startPlayer(player.studentId)}
                    >
                      <span className="rank-badge rank-badge-none">•</span>
                      <div className="roster-person">
                        <strong>{player.studentName}</strong>
                        <small>{active ? "当前学生" : "未开始"}</small>
                      </div>
                      <span className="roster-score">-</span>
                    </li>
                  );
                })}
            </ol>
          )}
          {records.length > 0 && (
            <button type="button" className="roster-finish-btn" onClick={finishSession}>
              结束活动
            </button>
          )}
        </aside>
      </div>

      {roundWinner && phase === "roundDone" && (
        <div className="overlay-mask">
          <div className="complete-card">
            <h2>本轮完成！</h2>
            <p>
              {roundWinner.player.studentName} · 用时{" "}
              {formatTime(roundWinner.result.timeSeconds)} · 得分{" "}
              {roundWinner.result.score}
            </p>
            <p className="complete-sub">
              首答正确 {roundWinner.result.correctCount}/
              {roundWinner.result.totalCount} · 答错 {roundWinner.wrongAnswers} 次
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
              <button type="button" className="secondary" onClick={finishSession}>
                {nextPlayer ? "提前结束活动" : "结束活动并结算"}
              </button>
            </div>
          </div>
        </div>
      )}

      {rulesEditorOpen && (
        <div className="overlay-mask">
          <div className="rules-card">
            <h2>积分规则设置</h2>
            <p className="rules-tip">由教师自定义本题积分，保存后下一轮生效</p>

            <label className="rules-field">
              每答对一题得分
              <input
                type="number"
                min="0"
                value={draftRules.perCorrect}
                onChange={(event) =>
                  setDraftRules({ ...draftRules, perCorrect: Number(event.target.value) })
                }
              />
            </label>
            <label className="rules-field">
              每答错一次扣分
              <input
                type="number"
                min="0"
                value={draftRules.wrongPenalty}
                onChange={(event) =>
                  setDraftRules({ ...draftRules, wrongPenalty: Number(event.target.value) })
                }
              />
            </label>
            <label className="rules-field">
              每查看一条提示扣分
              <input
                type="number"
                min="0"
                value={draftRules.hintPenalty}
                onChange={(event) =>
                  setDraftRules({ ...draftRules, hintPenalty: Number(event.target.value) })
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
