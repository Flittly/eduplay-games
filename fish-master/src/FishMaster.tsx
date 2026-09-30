/**
 * 捕鱼对局主流程
 * ==============
 *
 * 完整走一遍：
 *   选海域 → ① 认洋流名称（4 选 1）→ ② 判流向（初中二选一 / 高中画箭头）
 *   → 两问全对才起网 → 解释卡 → 下一网
 *
 * 分层在流程上的落点是**判定的深度**：
 *   重点层走完两问；拓展层只走第一问，认得出名字就起网。
 *   ⚠️ 这不是偷工减料 —— 拓展层的学生体验应该是"我认识这条流，不错"，
 *      而不是"怎么又多一道题"。
 */

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import CurrentMap from "./CurrentMap";
import {
  CONFUSABLE_PAIRS,
  GYRES,
  STAGES,
  WIN_GYRES,
  currentById,
  type Current,
  type FlowDirection,
  type Stage
} from "./data";
import {
  type Choice,
  type PendingCast,
  type SessionState,
  createSession,
  directionChoice,
  judgeArrow,
  judgeDirection,
  judgeName,
  needsDirection,
  qualityLabel,
  recordMistake,
  recordRecognized,
  remainingCore,
  rng,
  settleBarren,
  settleCatch,
  stars,
  startCast,
  topConfusions,
  zonePool
} from "./game";
import type { PlayerInfo, RunResult } from "./types";


interface Props {
  roster: PlayerInfo[];
  stage: Stage;
  /**
   * 天地图密钥（tk），由大厅持有并传下来。
   *
   * ⚠️ 不能在本组件里"挂载时读一次 localStorage"—— 组件在 `key={stage}` 不变时
   *    会被 React **复用**（大厅 → 出海 → 返航 → 再出海，stage 都是 junior，
   *    实例是同一个）。那样老师在设置里填了密钥、点「出海捕鱼」进来，
   *    地图仍然是矢量底图，**要刷新页面才生效** —— 实测就是这个症状。
   *    让大厅持有、以 prop 传入，密钥一变这里就跟着变，不需要刷页面。
   */
  tiandituKey: string;
  onComplete: (player: PlayerInfo, result: RunResult) => void;
  onSessionEnd: (records: RoundRecord[]) => void;
  onBack: () => void;
}

interface RoundRecord {
  player: PlayerInfo;
  result: RunResult;
  mistakes: number;
}

/** 本局一网的结果快照，用来渲染结算卡。 */
interface CastOutcome {
  current: Current;
  success: boolean;
  failReason: "name" | "direction" | "timeout" | null;
  wrongName: string | null;
  fishCount: number;
  unitPrice: number;
  gained: number;
  combo: number;
  /** 是否让玩家在图上看到"正确答案是哪条"。 */
  revealId: string;
}

type Action =
  | { type: "cast"; outcome: CastOutcome; recognizedId: string; mistakeId?: string }
  | { type: "closeResult" }
  | { type: "nextPlayer" }
  | { type: "reset"; seed: number };

interface UiState {
  turnIndex: number;
  outcome: CastOutcome | null;
  /** 每个玩家的会话状态 */
  sessions: SessionState[];
  records: RoundRecord[];
  finished: boolean;
}

function initUi(rosterCount: number, stage: Stage, seed: number): UiState {
  return {
    turnIndex: 0,
    outcome: null,
    sessions: Array.from({ length: Math.max(rosterCount, 1) }, () =>
      createSession(stage, seed)
    ),
    records: [],
    finished: false
  };
}

export default function FishMaster({
  roster,
  stage,
  tiandituKey,
  onComplete,
  onSessionEnd,
  onBack
}: Props) {
  const cfg = STAGES[stage];
  const [tick, setTick] = useState(0);

  const [ui, dispatch] = useReducer(
    (state: UiState, action: Action): UiState => {
      switch (action.type) {
        case "cast": {
          const sessions = state.sessions.slice();
          const cur = sessions[state.turnIndex];
          let next = recordRecognized(cur, action.recognizedId);
          if (action.mistakeId) next = recordMistake(next, action.mistakeId);
          if (action.outcome.success) {
            next = {
              ...next,
              score: next.score + action.outcome.gained,
              combo: action.outcome.combo,
              maxCombo: Math.max(next.maxCombo, action.outcome.combo),
              castsLeft: next.castsLeft - 1,
              castsUsed: next.castsUsed + 1
            };
          } else if (action.outcome.failReason === "name") {
            // 只有"认错名称"才扣下网次数（知识性错误要付代价）
            next = {
              ...next,
              castsLeft: next.castsLeft - 1,
              castsUsed: next.castsUsed + 1
            };
          }
          // 方向答错不扣次数 —— 方向是易混点，别做成劝退点
          sessions[state.turnIndex] = next;
          return { ...state, sessions, outcome: action.outcome };
        }
        case "closeResult": {
          const sessions = state.sessions.slice();
          const cur = sessions[state.turnIndex];
          const outOfCasts = cur.castsLeft <= 0;
          return {
            ...state,
            outcome: null,
            // 下网次数用光 = 该玩家这局结束
            sessions,
            finished: outOfCasts && state.turnIndex >= state.sessions.length - 1
          };
        }
        case "nextPlayer": {
          const sessions = state.sessions.slice();
          const cur = sessions[state.turnIndex];
          const records = state.records.slice();
          const player = roster[state.turnIndex] ?? roster[0];
          if (player) {
            records.push({
              player,
              result: {
                score: cur.score,
                timeSeconds: 0,
                matchedCount: cur.recognized.length,
                totalCount: zonePool(stage).length,
                win: cur.won,
                maxCombo: cur.maxCombo,
                completedGyres: cur.completedGyres.length
              },
              mistakes: cur.castsUsed - cur.castsLeft
            });
          }
          const nextIndex = state.turnIndex + 1;
          const done = nextIndex >= sessions.length;
          return {
            ...state,
            records,
            turnIndex: done ? state.turnIndex : nextIndex,
            finished: done
          };
        }
        case "reset":
          return initUi(roster.length, stage, action.seed);
        default:
          return state;
      }
    },
    undefined,
    () => initUi(roster.length, stage, Date.now() & 0xffff)
  );

  const session = ui.sessions[ui.turnIndex];
  const player = roster[ui.turnIndex] ?? roster[0];

  /* ---------------- 出题状态 ---------------- */
  const [current, setCurrent] = useState<Current | null>(null);
  const [pending, setPending] = useState<PendingCast | null>(null);
  const [phase, setPhase] = useState<"pick" | "name" | "direction" | "done">("pick");
  const [wrongPick, setWrongPick] = useState<string | null>(null);
  const [drawnArrow, setDrawnArrow] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const [shake, setShake] = useState(false);
  const randomRef = useRef<() => number>(() => 0);
  /**
   * 天地图密钥（tk）—— 由大厅通过 props 传下来，**直接取用，不在这里再读一次**。
   * 详见 `Props.tiandituKey` 的注释：本组件会被 React 复用，
   * 自己挂载时读一次会导致"填了密钥进游戏仍看不到影像、要刷新才生效"。
   */
  const tk = tiandituKey;

  // 每次换玩家/换学段，重置出题状态
  useEffect(() => {
    randomRef.current = rng((ui.turnIndex + 1) * 7919 + tick * 104729);
    setCurrent(null);
    setPending(null);
    setPhase("pick");
    setWrongPick(null);
    setDrawnArrow(null);
  }, [ui.turnIndex, stage, tick]);

  const pool = useMemo(() => zonePool(stage), [stage]);

  /* ---------------- 选海域 ---------------- */
  function pickZone(c: Current) {
    if (phase !== "pick" || session.castsLeft <= 0) return;
    const p = startCast(c, stage, randomRef.current);
    setCurrent(c);
    setPending(p);
    setPhase("name");
    setWrongPick(null);
  }

  /* ---------------- 第一问：认名称 ---------------- */
  function answerName(choice: Choice) {
    if (!current || !pending || phase !== "name") return;
    if (judgeName(current, choice.id)) {
      // 答对：进第二问；拓展层直接起网
      if (needsDirection(current)) {
        setPending({ ...pending, namePassed: true });
        setPhase("direction");
        setDrawnArrow(null);
      } else {
        finishCast(true, null, pending);
      }
    } else {
      // 答错：鱼群散走，消耗一次下网
      setWrongPick(choice.id);
      setShake(true);
      window.setTimeout(() => setShake(false), 520);
      finishCast(false, "name", { ...pending, wrongPickId: choice.id });
    }
  }

  /* ---------------- 第二问：判方向 ---------------- */
  function answerDirection(value: FlowDirection) {
    if (!current || !pending || phase !== "direction") return;
    if (judgeDirection(current, value)) {
      finishCast(true, null, pending);
    } else {
      setShake(true);
      window.setTimeout(() => setShake(false), 520);
      finishCast(false, "direction", pending);
    }
  }

  function answerArrow() {
    if (!current || !pending || !drawnArrow || phase !== "direction") return;
    if (judgeArrow(current, drawnArrow)) {
      finishCast(true, null, pending);
    } else {
      setShake(true);
      window.setTimeout(() => setShake(false), 520);
      finishCast(false, "direction", pending);
    }
  }

  /* ---------------- 结算一网 ---------------- */
  function finishCast(
    success: boolean,
    failReason: "name" | "direction" | "timeout" | null,
    p: PendingCast
  ) {
    if (!current) return;
    const rnd = randomRef.current;

    if (success) {
      // 重点层里品质 2 的"环流中部"是普通海域；品质 1 才是无鱼区。
      // 本作没有品质 1 的独立捕捞区（无鱼区只在图上作说明），所以都走 settleCatch。
      const r = settleCatch(current, session.combo, rnd);
      const outcome: CastOutcome = {
        current,
        success: true,
        failReason: null,
        wrongName: null,
        fishCount: r.fishCount,
        unitPrice: r.unitPrice,
        gained: r.total,
        combo: r.combo,
        revealId: current.id
      };
      dispatch({ type: "cast", outcome, recognizedId: current.id });
      setPending({ ...p, namePassed: true, directionPassed: true });
    } else {
      const barren = settleBarren(rnd);
      const outcome: CastOutcome = {
        current,
        success: false,
        failReason,
        wrongName: p.wrongPickId,
        fishCount: barren.fishCount,
        unitPrice: barren.unitPrice,
        gained: barren.total,
        combo: 0,
        revealId: current.id
      };
      dispatch({
        type: "cast",
        outcome,
        recognizedId: "",
        mistakeId: failReason === "name" ? current.id : undefined
      });
      setPending({ ...p, failed: true, failReason });
    }
    setPhase("done");
  }

  /* ---------------- 关掉结算卡 ---------------- */
  function closeResult() {
    dispatch({ type: "closeResult" });
    // 下网次数用光 ⇒ 交下一棒
    if (session.castsLeft <= 0) {
      finishPlayer();
      return;
    }
    setPhase("pick");
    setCurrent(null);
    setPending(null);
    setWrongPick(null);
    setDrawnArrow(null);
  }

  function finishPlayer() {
    const next = ui.turnIndex + 1;
    if (next >= ui.sessions.length) {
      // 全部玩家打完
      const records = ui.records.concat(
        player
          ? [
              {
                player,
                result: {
                  score: session.score,
                  timeSeconds: 0,
                  matchedCount: session.recognized.length,
                  totalCount: pool.length,
                  win: session.won,
                  maxCombo: session.maxCombo,
                  completedGyres: session.completedGyres.length
                },
                mistakes: session.castsUsed - session.castsLeft
              }
            ]
          : []
      );
      if (player) {
        onComplete(player, records[records.length - 1].result);
      }
      onSessionEnd(records);
      return;
    }
    dispatch({ type: "nextPlayer" });
    setTick((t) => t + 1);
  }

  /* ---------------- 渲染 ---------------- */
  const nameOptions = pending?.nameChoices ?? [];
  const dirChoice = current ? directionChoice(current) : null;

  return (
    <div className="play" data-stage={stage}>
      {/* ---------- 顶栏 ---------- */}
      <header className="hud">
        <button type="button" className="btn-ghost" onClick={onBack}>
          ← 返航
        </button>

        <div className="hud-player">
          <b>{player?.studentName ?? "—"}</b>
          {roster.length > 1 && (
            <span className="hud-turn">
              第 {ui.turnIndex + 1} / {roster.length} 位
            </span>
          )}
        </div>

        <div className="hud-stats">
          <div className="hud-stat" data-hud="casts">
            <span>下网</span>
            <b>{session.castsLeft}</b>
            <em>/ {cfg.casts}</em>
          </div>
          <div className="hud-stat" data-hud="score">
            <span>渔获</span>
            <b>{session.score}</b>
          </div>
          <div className="hud-stat" data-hud="recognized">
            <span>已认洋流</span>
            <b>{session.recognized.length}</b>
            <em>/ {pool.length}</em>
          </div>
          {session.combo >= 2 && (
            <div className="hud-combo" data-hud="combo">
              连击 ×{session.combo}
            </div>
          )}
        </div>
      </header>

      <div className="play-body">
        {/* ---------- 地图 ---------- */}
        <div className={`map-wrap ${shake ? "is-shake" : ""}`}>
          <CurrentMap
            highlightId={
              phase === "done" || phase === "direction"
                ? (current?.id ?? null)
                : null
            }
            recognized={session.recognized}
            showNames={phase === "done"}
            tiers={cfg.tiers}
            interactive={phase === "pick"}
            tiandituKey={tk}
            onPick={(id) => {
              const c = currentById(id);
              if (c) pickZone(c);
            }}
            onDrawArrow={
              phase === "direction" && cfg.directionUI === "draw-arrow"
                ? (a) => setDrawnArrow(a)
                : undefined
            }
            drawnArrow={drawnArrow}
          />

          {phase === "pick" && (
            <p className="map-hint">
              点海图上的一支箭头下网 —— <em>箭头颜色就是它的性质</em>
            </p>
          )}
        </div>

        {/* ---------- 右侧问答区 ---------- */}
        <aside className="ask">
          {phase === "pick" && <PickPanel session={session} stage={stage} />}

          {phase === "name" && current && (
            <div className="ask-card" data-step="name">
              <div className="ask-step">第一问 · 认洋流</div>
              <h2>你在这片海域下网，这里的洋流是——</h2>
              <p className="ask-sub">
                图上只给颜色和方向，名字要你自己认。
                认错的话鱼群会受惊散走，而且会消耗一次下网。
              </p>
              <div className="choice-grid">
                {nameOptions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    data-choice={c.id}
                    className={`choice ${wrongPick === c.id ? "is-wrong" : ""}`}
                    onClick={() => answerName(c)}
                  >
                    <span className={`choice-dot is-${c.kind}`} aria-hidden="true" />
                    {c.name}
                  </button>
                ))}
              </div>
              <p className="ask-foot">
                选项里故意混了<b>同性质</b>和<b>同半球</b>的洋流 —— 只看颜色选不对。
              </p>
            </div>
          )}

          {phase === "direction" && current && dirChoice && (
            <div className="ask-card" data-step="direction">
              <div className="ask-step">第二问 · 判方向</div>
              <h2>{current.name}往哪个方向流？</h2>
              <p className="ask-sub">
                {current.kind === "warm"
                  ? "暖流由低纬流向高纬，会增温增湿。"
                  : "寒流由高纬流向低纬，会降温减湿。"}
              </p>

              {cfg.directionUI === "two-choice" ? (
                <div className="choice-grid is-two">
                  {dirChoice.options.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      data-dir={o.value}
                      className="choice"
                      onClick={() => answerDirection(o.value)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="draw-arrow">
                  <p className="draw-arrow-lead">
                    在图上<b>按住拖动</b>，画出这条洋流的方向：
                  </p>
                  <div className="draw-arrow-state" data-hud="arrow">
                    {drawnArrow ? "已画出一笔" : "还没有画"}
                  </div>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!drawnArrow}
                    onClick={answerArrow}
                  >
                    确认方向
                  </button>
                  {drawnArrow && (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setDrawnArrow(null)}
                    >
                      重画
                    </button>
                  )}
                </div>
              )}

              <p className="ask-foot">
                方向答错<b>不扣下网次数</b>，会给你重问一次 —— 方向是易混点，不该劝退。
              </p>
            </div>
          )}

          {phase === "done" && ui.outcome && (
            <ResultPanel
              outcome={ui.outcome}
              onNext={closeResult}
              castsLeft={session.castsLeft}
            />
          )}
        </aside>
      </div>

      {/* ---------- 集齐进度条 ---------- */}
      <footer className="gyre-bar">
        <span className="gyre-bar-title">环流图鉴</span>
        {GYRES.filter((g) => WIN_GYRES.includes(g.id as never)).map((g) => {
          const got = g.members.filter((id) => session.recognized.includes(id)).length;
          const done = session.completedGyres.includes(g.id);
          return (
            <div
              key={g.id}
              className={`gyre-chip ${done ? "is-done" : ""}`}
              data-gyre={g.id}
            >
              <b>{g.name}</b>
              <span>
                {got}/{g.members.length}
                {done ? " ✓" : ""}
              </span>
            </div>
          );
        })}
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 子面板
 * ------------------------------------------------------------------ */

function PickPanel({ session, stage }: { session: SessionState; stage: Stage }) {
  const left = remainingCore(stage, session);
  return (
    <div className="ask-card is-idle" data-step="pick">
      <div className="ask-step">出航</div>
      <h2>选一处海域下网</h2>
      <p className="ask-sub">
        箭头越粗越亮的是<b>重点洋流</b>（教材要求熟记）；
        虚线的是<b>拓展洋流</b>，认得名字就行。
      </p>
      <ul className="pick-list">
        <li>
          <span className="dot is-warm" /> 红色 = 暖流
        </li>
        <li>
          <span className="dot is-cold" /> 蓝色 = 寒流
        </li>
        <li>
          <span className="dot is-ext" /> 虚线 = 拓展（课标不考）
        </li>
      </ul>
      <p className="ask-foot">
        还有 <b>{left}</b> 条洋流没认出来。
        集齐四大环流就通关 —— 每凑齐一个环流另有奖励。
      </p>
    </div>
  );
}

function ResultPanel({
  outcome,
  onNext,
  castsLeft
}: {
  outcome: CastOutcome;
  onNext: () => void;
  castsLeft: number;
}) {
  const c = outcome.current;
  const wrong = outcome.wrongName ? currentById(outcome.wrongName) : null;
  const isExt = c.tier === "extension";

  return (
    <div
      className={`ask-card result ${outcome.success ? "is-success" : "is-fail"}`}
      data-result={outcome.success ? "success" : "fail"}
    >
      <div className="ask-step">
        {outcome.success ? "起网" : outcome.failReason === "name" ? "鱼群散走" : "空网"}
      </div>

      <h2>
        {outcome.success
          ? `${c.name} · ${qualityLabel(c.quality)}`
          : `${c.name} —— 这一网空了`}
      </h2>

      {outcome.success ? (
        <div className="catch-box">
          <div className="catch-line">
            <span>渔获</span>
            <b>
              {c.fish.map((f) => f.name).join("、")} × {outcome.fishCount}
            </b>
          </div>
          <div className="catch-line">
            <span>单价</span>
            <b>{outcome.unitPrice}</b>
          </div>
          <div className="catch-line is-total">
            <span>本网得分</span>
            <b data-hud="gained">+{outcome.gained}</b>
          </div>
          {outcome.combo >= 2 && (
            <p className="combo-note">连击 ×{outcome.combo}，本网已有加成</p>
          )}
        </div>
      ) : (
        <div className="fail-box">
          {outcome.failReason === "name" && wrong && (
            <p>
              你选的是<b>{wrong.name}</b>，正确答案是<b>{c.name}</b>。
              <br />
              <span className="fail-cost">消耗 1 次下网</span>
            </p>
          )}
          {outcome.failReason === "name" && !wrong && (
            <p>
              正确答案是<b>{c.name}</b>。<span className="fail-cost">消耗 1 次下网</span>
            </p>
          )}
          {outcome.failReason === "direction" && (
            <p>
              名称答对了，但方向判错了 —— 它<span className="fail-free">不扣下网次数</span>。
            </p>
          )}
        </div>
      )}

      {/* 解释卡 —— 必看；拓展层明确标注"课标不考" */}
      <div className={`reason-card ${isExt ? "is-extension" : ""}`}>
        <div className="reason-head">
          <span className="reason-tier">{qualityLabel(c.quality)}</span>
          <span className="reason-stars">{stars(c.quality)}</span>
          {isExt && <span className="reason-ext-badge">拓展 · 课标不考</span>}
        </div>
        <p className="reason-body">{c.reason}</p>
        <p className="reason-flow">
          流向：{c.flowText}
          {c.tier === "core" && c.direction === "east-to-west" && c.id === "indian-monsoon" && (
            <em>（提醒：这是「北半球冬季」的流向）</em>
          )}
        </p>
        <p className="reason-note">{c.note}</p>
      </div>

      <button type="button" className="btn-primary" onClick={onNext}>
        {castsLeft <= 0 ? "这局结束" : "继续下网"}
      </button>
    </div>
  );
}

export { CONFUSABLE_PAIRS, topConfusions };
