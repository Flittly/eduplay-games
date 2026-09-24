import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import CardBoard from "./CardBoard";
import {
  HINTS_PER_LEVEL, buildCards, initialMatchState, layoutCards, levelCount,
  matchReducer, modeConfig, pairsForLevel, pickRemainingPair, totalPairs
} from "./gameData";
import type {
  CardSpec, GameMode, LegendItem, PlayerInfo, RoundRecord, RunResult
} from "./types";

/** 配对成功后"放大复现"停留多久（也可以点一下立刻继续）。 */
const FOCUS_MS = 1700;
const WRONG_SHAKE_MS = 520;
const HINT_FLASH_MS = 2200;

interface LegendMatchProps {
  legends: LegendItem[];
  roster: PlayerInfo[];
  /** 本局组别：在大厅选定，进来只读。关卡数与对数表都跟着它走。 */
  mode: GameMode;
  onComplete: (player: PlayerInfo, result: RunResult) => void;
  onSessionEnd: (records: RoundRecord[]) => void;
  onBack: () => void;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function newSeed(): number {
  return (Math.floor(Math.random() * 0xffffff) ^ Date.now()) >>> 0;
}

/**
 * 单人闯关：逐关加量，每位学生依次上场。
 *
 * 玩法的核心是「配对 → 原地放大复现」：把图例符号和它的名称配成一对，
 * 这一对会在屏幕中央被放大再展示一次（符号 + 全称 + 一句话解释），
 * 点一下或等 1.7 秒自动继续 —— 复现这一下才是加深印象的关键，
 * 所以它被做成必经的中间态，而不是一闪而过的动画。
 *
 * 关卡数、每关对数、提示窗口全由 `mode` 决定（见 gameData 的 MODES）。
 * 组别不从大厅切进来改：`main.tsx` 用 `key={mode}` 把本组件整体重挂载，
 * 状态机里的 mode 跟着重置，绝不会出现"上半局初中组、下半局高级组"。
 */
export default function LegendMatch({
  legends, roster, mode, onComplete, onSessionEnd, onBack
}: LegendMatchProps) {
  const safeRoster = roster.length > 0 ? roster : [];
  const [playerIndex, setPlayerIndex] = useState(0);
  const [seed, setSeed] = useState(newSeed);
  const [view, setView] = useState<"run" | "rank">("run");
  const [records, setRecords] = useState<RoundRecord[]>([]);
  const [board, setBoard] = useState({ w: 0, h: 0 });

  const reportedRef = useRef<Set<number>>(new Set());
  const sessionSentRef = useRef(false);

  const [state, dispatch] = useReducer(
    matchReducer,
    { seed, mode },
    (init) => initialMatchState(init.seed, init.mode)
  );

  const player: PlayerInfo = safeRoster[Math.min(playerIndex, safeRoster.length - 1)] ?? {
    studentId: -1, studentName: "体验学生", className: null
  };

  const legendMap = useMemo(() => {
    const map = new Map<string, LegendItem>();
    legends.forEach((l) => map.set(l.id, l));
    return map;
  }, [legends]);

  const cards = useMemo(
    () => buildCards(legends, mode, state.levelIndex, state.seed),
    [legends, mode, state.levelIndex, state.seed]
  );

  const layout = useMemo(
    () => layoutCards(cards.length, board.w, board.h, (state.seed ^ 0x2545f491) >>> 0),
    [cards.length, board.w, board.h, state.seed]
  );

  const clearedSet = useMemo(() => new Set(state.cleared), [state.cleared]);

  // ---------------------------------------------------------------- 副作用
  const handleResize = useCallback((w: number, h: number) => {
    setBoard((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  }, []);

  // 复现卡自动收起
  useEffect(() => {
    if (!state.focus) {
      return;
    }
    const t = window.setTimeout(() => dispatch({ type: "closeFocus" }), FOCUS_MS);
    return () => window.clearTimeout(t);
  }, [state.focus]);

  // 配错抖动结束后解锁输入
  useEffect(() => {
    if (state.wrongPair.length === 0) {
      return;
    }
    const t = window.setTimeout(() => dispatch({ type: "clearWrong" }), WRONG_SHAKE_MS);
    return () => window.clearTimeout(t);
  }, [state.wrongPair]);

  // 提示高亮自动消失
  useEffect(() => {
    if (!state.hintPair) {
      return;
    }
    const t = window.setTimeout(() => dispatch({ type: "clearHint" }), HINT_FLASH_MS);
    return () => window.clearTimeout(t);
  }, [state.hintPair]);

  // 计时：状态机自己会在"未开局 / 复现卡开着 / 已结束"时忽略 tick
  useEffect(() => {
    if (view !== "run") {
      return;
    }
    const t = window.setInterval(() => dispatch({ type: "tick" }), 1000);
    return () => window.clearInterval(t);
  }, [view]);

  // 一轮结束 → 上报这一位学生的成绩（每位学生只上报一次）
  useEffect(() => {
    if (state.phase !== "runDone" || reportedRef.current.has(playerIndex)) {
      return;
    }
    reportedRef.current.add(playerIndex);
    const result: RunResult = {
      score: state.score,
      timeSeconds: state.seconds,
      matchedCount: state.matched,
      totalCount: totalPairs(mode)
    };
    setRecords((prev) => [
      ...prev.filter((r) => r.player.studentId !== player.studentId),
      {
        player,
        result,
        wrongCount: state.wrongCount,
        maxCombo: state.maxCombo,
        finishedAt: Date.now()
      }
    ]);
    onComplete(player, result);
    // 依赖里带上成绩字段是故意的：guard 保证只上报一次，
    // 而成绩一旦变化（提前结算的场景）也希望能带上最新的。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, playerIndex, state.score, state.seconds, state.matched,
      state.wrongCount, state.maxCombo, player, onComplete]);

  // ---------------------------------------------------------------- 交互
  const handlePick = useCallback((card: CardSpec) => {
    dispatch({
      type: "click", uid: card.uid, legendId: card.legendId, face: card.face
    });
  }, []);

  function useHint() {
    const pair = pickRemainingPair(cards, clearedSet, Math.random);
    if (pair.length === 2) {
      dispatch({ type: "hint", pair });
    }
  }

  function goNextLevel() {
    dispatch({ type: "nextLevel", seed: newSeed() });
  }

  function nextPlayer() {
    const next = playerIndex + 1;
    if (next >= safeRoster.length) {
      return;
    }
    const s = newSeed();
    setPlayerIndex(next);
    setSeed(s);
    dispatch({ type: "restart", seed: s });
  }

  function finishSession() {
    if (!sessionSentRef.current) {
      sessionSentRef.current = true;
      onSessionEnd(records);
    }
    setView("rank");
  }

  function restartSession() {
    const s = newSeed();
    sessionSentRef.current = false;
    reportedRef.current = new Set();
    setRecords([]);
    setPlayerIndex(0);
    setSeed(s);
    dispatch({ type: "restart", seed: s });
    setView("run");
  }

  // ---------------------------------------------------------------- 派生显示值
  const leftPairs = Math.max(0, Math.round((cards.length - state.cleared.length) / 2));
  const nextUp = safeRoster[playerIndex + 1] ?? null;
  const focusLegend = state.focus ? legendMap.get(state.focus.legendId) ?? null : null;

  if (view === "rank") {
    const sorted = [...records].sort((a, b) => b.result.score - a.result.score);
    return (
      <div className="game">
        <header className="game-topbar">
          <button type="button" className="control-btn" onClick={onBack}>返回模式选择</button>
          <div className="lm-title">
            <strong>本轮排行榜</strong>
            <span>
              {modeConfig(mode).name} · {sorted.length} 位同学已完成
            </span>
          </div>
        </header>
        <div className="lm-rank">
          {sorted.length === 0 && <p className="lm-empty">本轮还没有人完成闯关。</p>}
          {sorted.map((r, i) => (
            <div key={r.player.studentId} className="lm-rank-row">
              <span className="lm-rank-no">{i + 1}</span>
              <strong className="lm-rank-name">{r.player.studentName}</strong>
              <span className="lm-rank-score">{r.result.score}</span>
              <span className="lm-rank-meta">
                配对 {r.result.matchedCount}/{r.result.totalCount} · 用时{" "}
                {fmtTime(r.result.timeSeconds)} · 最大连击 ×{r.maxCombo} · 配错{" "}
                {r.wrongCount} 次
              </span>
            </div>
          ))}
          <div className="notice-actions">
            <button type="button" className="btn-primary" onClick={restartSession}>
              再来一轮
            </button>
            <button type="button" onClick={onBack}>返回模式选择</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="game">
      <header className="game-topbar">
        <button type="button" className="control-btn" onClick={onBack}>退出</button>
        <div className="lm-title">
          <strong>{player.studentName}</strong>
          <span data-hud="level">
            第 {state.levelIndex + 1} / {levelCount(mode)} 关 · 剩余 {leftPairs} 对
          </span>
        </div>
        <div className="lm-hud">
          <span className="hud-cell">
            <small>组别</small>
            <b data-hud="game-mode">{modeConfig(mode).name}</b>
          </span>
          <span className="hud-cell"><small>得分</small><b data-hud="score">{state.score}</b></span>
          <span className="hud-cell"><small>连击</small><b data-hud="combo">×{state.combo}</b></span>
          <span className="hud-cell"><small>用时</small><b data-hud="time">{fmtTime(state.seconds)}</b></span>
          <button
            type="button"
            className="control-btn is-hint"
            data-hud="hint"
            disabled={state.hintsLeft <= 0 || state.phase !== "play" || Boolean(state.focus)}
            onClick={useHint}
          >
            提示 {state.hintsLeft}
          </button>
        </div>
      </header>

      <p className="lm-tip">
        点一张<em>图例符号</em>，再点它对应的<em>名称</em>。配对成功的那一对会在屏幕中央
        放大复现一次，看清楚再继续。
      </p>

      <div className="lm-stage">
        <CardBoard
          cards={cards}
          layout={layout}
          legendMap={legendMap}
          cleared={clearedSet}
          selected={state.selected ? state.selected.uid : null}
          wrongPair={state.wrongPair}
          hintPair={state.hintPair ?? []}
          onPick={handlePick}
          onResize={handleResize}
        />
      </div>

      {focusLegend && state.focus && (
        <div
          className="overlay-mask is-focus"
          onClick={() => dispatch({ type: "closeFocus" })}
        >
          <div className="legend-focus" onClick={(e) => e.stopPropagation()}>
            <div className="legend-focus-tag">
              配对成功 · 第 {state.matched + 1} 对
            </div>
            <div className="legend-focus-body">
              <div className="legend-focus-symbol">
                <img src={focusLegend.image} alt={focusLegend.name} draggable={false} />
              </div>
              <div className="legend-focus-info">
                <h3>{focusLegend.name}</h3>
                <p className="legend-focus-cat">{focusLegend.categoryName}</p>
                <p className="legend-focus-text">{focusLegend.summary}</p>
              </div>
            </div>
            <div className="legend-focus-bar">
              <span>+{state.focus.gain} 分</span>
              <span>连击 ×{state.focus.combo}</span>
            </div>
            <div className="legend-focus-progress">
              <i style={{ animationDuration: `${FOCUS_MS}ms` }} />
            </div>
            <p className="legend-focus-hintline">点一下可以立刻继续</p>
          </div>
        </div>
      )}

      {state.phase === "levelDone" && (
        <div className="overlay-mask">
          <div className="legend-panel">
            <h2>第 {state.levelIndex + 1} 关完成</h2>
            <ul className="legend-stats">
              <li>累计得分 <b data-hud="panel-score">{state.score}</b></li>
              <li>最大连击 <b>×{state.maxCombo}</b></li>
              <li>用时 <b>{fmtTime(state.seconds)}</b></li>
            </ul>
            <p className="legend-panel-note">
              下一关是 {pairsForLevel(mode, state.levelIndex + 1)} 对，
              同一类别的图例会更多，注意区分细节。
            </p>
            <div className="notice-actions">
              <button type="button" className="btn-primary" onClick={goNextLevel}>
                进入第 {state.levelIndex + 2} 关
              </button>
              <button
                type="button"
                data-action="skip-to-end"
                onClick={() => dispatch({ type: "skipToEnd" })}
              >
                提前结算，交成绩
              </button>
            </div>
          </div>
        </div>
      )}

      {state.phase === "runDone" && (
        <div className="overlay-mask">
          <div className="legend-panel is-result">
            <h2>{player.studentName} 的闯关成绩</h2>
            <p className="legend-result-mode">
              <span data-hud="final-mode">{modeConfig(mode).name}</span>
              · 共 {levelCount(mode)} 关 / {totalPairs(mode)} 对
            </p>
            <div className="legend-big-score" data-hud="final-score">{state.score}</div>
            <ul className="legend-stats">
              <li>
                配对成功 <b>{state.matched} / {totalPairs(mode)}</b>
              </li>
              <li>用时 <b>{fmtTime(state.seconds)}</b></li>
              <li>最大连击 <b>×{state.maxCombo}</b></li>
              <li>配错 <b>{state.wrongCount}</b> 次</li>
            </ul>
            <div className="notice-actions">
              {nextUp ? (
                <button type="button" className="btn-primary" onClick={nextPlayer}>
                  下一位上场：{nextUp.studentName}
                </button>
              ) : (
                <button type="button" className="btn-primary" onClick={finishSession}>
                  结束本轮，看排行榜
                </button>
              )}
              {nextUp && (
                <button type="button" onClick={finishSession}>
                  结束本轮，看排行榜
                </button>
              )}
              <button type="button" onClick={onBack}>返回模式选择</button>
            </div>
          </div>
        </div>
      )}

      <p className="lm-foot">
        本关 {pairsForLevel(mode, state.levelIndex)} 对 ·
        每关提示 {HINTS_PER_LEVEL} 次（每次 −30 分）· 配错 −20 分并中断连击
      </p>
    </div>
  );
}
