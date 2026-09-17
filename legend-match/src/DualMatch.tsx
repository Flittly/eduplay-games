import { useCallback, useEffect, useMemo, useState } from "react";
import CardBoard from "./CardBoard";
import { buildCards, layoutCards, pairsForLevel, pickRemainingPair } from "./gameData";
import type { CardSpec, LegendItem, PlayerInfo, SelectedCard } from "./types";

/**
 * 双人 PK。
 *
 * 和气象/省区识别保持一致的三阶段结构：
 *   arrange —— 出战安排：老师指定左右席，其余人排队候场（名单常常有 5~6 人，
 *              没有这一环第 3 个人起就无从上场，大屏上也认不出谁是谁）
 *   battle  —— 对战：共享一副牌面，轮流出手，全程显示姓名
 *   result  —— 本场结果：分高者胜，候场队首上台继续打擂台
 *
 * 对战规则选"共享牌面轮流出手"而不是"两块牌面各消各的"：
 * 1280 宽的大屏切成两块后每块只剩 600px，16 张卡会挤到看不清；
 * 共享一副牌面则两个人看的是同一盘棋，也好讲解。
 */
const PK_LEVEL = 1;                       // 复用第 2 关的抽牌强度 → 8 对 16 张
const PK_PAIRS = pairsForLevel(PK_LEVEL);
const PK_POINT = 10;
const FOCUS_MS = 1400;
const WRONG_SHAKE_MS = 560;
const HINT_FLASH_MS = 2200;

const SPARRING: PlayerInfo = {
  studentId: -2,
  studentName: "陪练同学",
  className: null
};

type PkStage = "arrange" | "battle" | "result";
type Side = "left" | "right";

interface DualMatchProps {
  legends: LegendItem[];
  roster: PlayerInfo[];
  onBack: () => void;
}

function newSeed(): number {
  return (Math.floor(Math.random() * 0xffffff) ^ Date.now()) >>> 0;
}

export default function DualMatch({ legends, roster, onBack }: DualMatchProps) {
  const seats = useMemo<PlayerInfo[]>(
    () => (roster.length >= 2 ? roster : [...roster, SPARRING]),
    [roster]
  );
  const needsSparring = roster.length < 2;

  const [stage, setStage] = useState<PkStage>("arrange");
  const [leftSeat, setLeftSeat] = useState<number | null>(null);
  const [rightSeat, setRightSeat] = useState<number | null>(null);
  const [bench, setBench] = useState<number[]>([]);
  const [boutNo, setBoutNo] = useState(1);

  const [seed, setSeed] = useState(newSeed);
  const [cleared, setCleared] = useState<string[]>([]);
  const [selected, setSelected] = useState<SelectedCard | null>(null);
  const [wrongPair, setWrongPair] = useState<string[]>([]);
  const [focus, setFocus] = useState<{ legendId: string; pair: string[]; side: Side } | null>(null);
  const [hintPair, setHintPair] = useState<string[]>([]);
  const [turn, setTurn] = useState<Side>("left");
  const [scores, setScores] = useState({ left: 0, right: 0 });
  const [wrongs, setWrongs] = useState({ left: 0, right: 0 });
  const [board, setBoard] = useState({ w: 0, h: 0 });
  const [seconds, setSeconds] = useState(0);
  const [finished, setFinished] = useState(false);

  const leftPlayer = seats.find((p) => p.studentId === leftSeat) ?? null;
  const rightPlayer = seats.find((p) => p.studentId === rightSeat) ?? null;
  const leftName = leftPlayer?.studentName ?? "左侧";
  const rightName = rightPlayer?.studentName ?? "右侧";
  const benchPlayers = bench
    .map((id) => seats.find((p) => p.studentId === id))
    .filter((p): p is PlayerInfo => Boolean(p));

  const legendMap = useMemo(() => {
    const map = new Map<string, LegendItem>();
    legends.forEach((l) => map.set(l.id, l));
    return map;
  }, [legends]);

  const cards = useMemo(() => buildCards(legends, PK_LEVEL, seed), [legends, seed]);
  const layout = useMemo(
    () => layoutCards(cards.length, board.w, board.h, (seed ^ 0x1f123bb5) >>> 0),
    [cards.length, board.w, board.h, seed]
  );
  const clearedSet = useMemo(() => new Set(cleared), [cleared]);
  const handleResize = useCallback((w: number, h: number) => {
    setBoard((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  }, []);

  /** 首次进入（或名单变化）时把前两人摆上左右席，其余人排队候场。 */
  useEffect(() => {
    const ids = seats.map((p) => p.studentId);
    setLeftSeat(ids[0] ?? null);
    setRightSeat(ids[1] ?? null);
    setBench(ids.slice(2));
    setBoutNo(1);
  }, [seats]);

  /** 开新一场：重新发牌、清零比分、先手给左席。 */
  function resetBout() {
    setSeed(newSeed());
    setCleared([]);
    setSelected(null);
    setWrongPair([]);
    setHintPair([]);
    setFocus(null);
    setTurn("left");
    setScores({ left: 0, right: 0 });
    setWrongs({ left: 0, right: 0 });
    setSeconds(0);
    setFinished(false);
  }

  // 复现卡自动收起 —— 本场唯一的"推进出口"就是这里，
  // 出手权在配对成功那一刻就定了（继续由本方出手），消除在这里落定。
  useEffect(() => {
    if (!focus) {
      return;
    }
    const t = window.setTimeout(() => closeFocus(), FOCUS_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  useEffect(() => {
    if (hintPair.length === 0) {
      return;
    }
    const t = window.setTimeout(() => setHintPair([]), HINT_FLASH_MS);
    return () => window.clearTimeout(t);
  }, [hintPair]);

  useEffect(() => {
    if (wrongPair.length === 0) {
      return;
    }
    const t = window.setTimeout(() => setWrongPair([]), WRONG_SHAKE_MS);
    return () => window.clearTimeout(t);
  }, [wrongPair]);

  useEffect(() => {
    if (stage !== "battle" || finished) {
      return;
    }
    const t = window.setInterval(() => setSeconds((v) => v + 1), 1000);
    return () => window.clearInterval(t);
  }, [stage, finished]);

  function closeFocus() {
    if (!focus) {
      return;
    }
    const next = [...cleared, ...focus.pair];
    setFocus(null);
    setSelected(null);
    setCleared(next);
    if (next.length >= cards.length) {
      setFinished(true);
      setStage("result");
    }
  }

  function handlePick(card: CardSpec) {
    if (stage !== "battle" || finished || focus || wrongPair.length > 0) {
      return;
    }
    if (clearedSet.has(card.uid)) {
      return;
    }
    if (!selected) {
      setSelected({ uid: card.uid, legendId: card.legendId, face: card.face });
      return;
    }
    if (selected.uid === card.uid) {
      setSelected(null);
      return;
    }
    const ok = selected.legendId === card.legendId && selected.face !== card.face;
    if (ok) {
      setScores((prev) => ({ ...prev, [turn]: prev[turn] + PK_POINT }));
      setFocus({ legendId: card.legendId, pair: [selected.uid, card.uid], side: turn });
      setSelected(null);
      return;
    }
    setWrongs((prev) => ({ ...prev, [turn]: prev[turn] + 1 }));
    setWrongPair([selected.uid, card.uid]);
    setSelected(null);
    // 配错即换手 —— 这是本玩法唯一的换手规则，配对成功则继续出手。
    setTurn((prev) => (prev === "left" ? "right" : "left"));
  }

  /** 提示只是把一对高亮出来，不代替学生出手，所以照样扣分、不换手。 */
  function useHintNow() {
    if (focus || wrongPair.length > 0 || finished) {
      return;
    }
    const pair = pickRemainingPair(cards, clearedSet, Math.random);
    if (pair.length !== 2) {
      return;
    }
    setSelected(null);
    setHintPair(pair);
    setScores((prev) => ({ ...prev, [turn]: Math.max(0, prev[turn] - PK_POINT) }));
  }

  /** 把某个学生放到左/右席：点对面席上的人=对调；点候场的人=他上台、原席位退回队首。 */
  function assignSeat(side: Side, studentId: number) {
    const prev = side === "left" ? leftSeat : rightSeat;
    const other = side === "left" ? rightSeat : leftSeat;
    if (studentId === prev) {
      return;
    }
    if (studentId === other) {
      if (side === "left") {
        setLeftSeat(studentId);
        setRightSeat(prev);
      } else {
        setRightSeat(studentId);
        setLeftSeat(prev);
      }
      return;
    }
    if (side === "left") {
      setLeftSeat(studentId);
    } else {
      setRightSeat(studentId);
    }
    setBench((list) => {
      const rest = list.filter((id) => id !== studentId);
      return prev === null ? rest : [prev, ...rest];
    });
  }

  function startBattle() {
    if (leftSeat === null || rightSeat === null) {
      return;
    }
    resetBout();
    setStage("battle");
  }

  /** 擂台延续：负者下场（不再回流），候场队首上台补位。平局约定右席下场。 */
  function nextChallenger() {
    const challenger = benchPlayers[0];
    if (!challenger) {
      return;
    }
    const loseSide: Side =
      scores.left < scores.right ? "left" : scores.right < scores.left ? "right" : "right";
    if (loseSide === "left") {
      setLeftSeat(challenger.studentId);
    } else {
      setRightSeat(challenger.studentId);
    }
    setBench((list) => list.filter((id) => id !== challenger.studentId));
    setBoutNo((v) => v + 1);
    resetBout();
    setStage("battle");
  }

  // ---------------------------------------------------------------- 安排页
  if (stage === "arrange") {
    return (
      <section className="dual-pk leg-pk is-arrange">
        <header className="pk-header">
          <button type="button" onClick={onBack}>返回模式选择</button>
          <div>
            <h2>双人 PK · 出战安排</h2>
            <span>共 {seats.length} 名学生，点名字把他们放到左席或右席</span>
          </div>
          <div className="pk-score"><b>第 {boutNo} 场</b></div>
        </header>

        <p className="pk-message is-note">
          对战规则：共享一副 {PK_PAIRS} 对（{PK_PAIRS * 2} 张）的牌面，
          轮流出手。<b>配对成功 +{PK_POINT} 分并继续出手，配错就换对方出手</b>。
          先被消完的牌面归零，分高者胜。
        </p>

        {needsSparring && (
          <p className="pk-message is-note">
            本次只选到 1 名学生，右席自动安排「陪练同学」，方便先把流程走一遍。
          </p>
        )}

        <div className="pk-seat-row">
          {(["left", "right"] as const).map((side) => {
            const current = side === "left" ? leftPlayer : rightPlayer;
            return (
              <div key={side} className={`pk-seat is-${side}`}>
                <div className="pk-seat-head">
                  <span className="pk-side-tag">{side === "left" ? "左" : "右"}</span>
                  <strong className="pk-seat-name">
                    {current ? current.studentName : "未指定"}
                  </strong>
                </div>
                <div className="pk-seat-options">
                  {seats.map((p) => {
                    const active = p.studentId === current?.studentId;
                    const otherSide = side === "left" ? rightSeat : leftSeat;
                    return (
                      <button
                        key={p.studentId}
                        type="button"
                        data-seat={`${side}-${p.studentId}`}
                        className={[
                          active ? "is-active" : "",
                          p.studentId === otherSide ? "is-other-seat" : ""
                        ].filter(Boolean).join(" ")}
                        onClick={() => assignSeat(side, p.studentId)}
                      >
                        {p.studentName}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="pk-bench">
          <div className="pk-bench-head">
            <strong data-hud="bench-count">候场 {benchPlayers.length} 人</strong>
            <span>
              每场结束后输的一方下场，候场第一位上台挑战 —— 人数再多也能一个不落地轮完
            </span>
          </div>
          {benchPlayers.length === 0 ? (
            <p className="pk-bench-empty">没有候场学生，本场就是最终对决</p>
          ) : (
            <ul className="pk-bench-list">
              {benchPlayers.map((p, order) => (
                <li key={p.studentId}>
                  <span className="pk-bench-order">{order + 1}</span>
                  {p.studentName}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="pk-result-actions">
          <button
            type="button"
            disabled={leftSeat === null || rightSeat === null}
            onClick={startBattle}
          >
            开始对战（{leftName} vs {rightName}）
          </button>
        </div>
      </section>
    );
  }

  // ---------------------------------------------------------------- 结果页
  if (stage === "result" || finished) {
    const winner =
      scores.left > scores.right
        ? { name: leftName, side: "left" as Side }
        : scores.right > scores.left
          ? { name: rightName, side: "right" as Side }
          : null;
    const challenger = benchPlayers[0] ?? null;
    const loseSide: Side =
      scores.left < scores.right ? "left" : scores.right < scores.left ? "right" : "right";
    const loseName = loseSide === "left" ? leftName : rightName;

    return (
      <section className="dual-pk leg-pk is-result">
        <header className="pk-header">
          <button type="button" onClick={onBack}>退出 PK</button>
          <div>
            <h2>第 {boutNo} 场结果</h2>
            <span>牌面已全部消完 · 用时 {seconds} 秒</span>
          </div>
        </header>

        <div className="pk-score-board" data-hud="pk-result">
          <div className={winner?.side === "left" ? "is-winner" : ""}>
            <small>{leftName}</small>
            <b data-hud="pk-left-score">{scores.left}</b>
            <em>配错 {wrongs.left} 次</em>
          </div>
          <span className="pk-score-vs">:</span>
          <div className={winner?.side === "right" ? "is-winner" : ""}>
            <small>{rightName}</small>
            <b data-hud="pk-right-score">{scores.right}</b>
            <em>配错 {wrongs.right} 次</em>
          </div>
        </div>
        <p className="pk-result-text">{winner ? `${winner.name} 获胜！` : "平局！"}</p>

        {challenger ? (
          <p className="pk-message is-note">
            下一位候选：<b>{challenger.studentName}</b>
            （将顶替{winner ? `负方 ${loseName}` : "右席"}的位置）
          </p>
        ) : (
          <p className="pk-message is-note">候场同学已全部上场，本场对决到此结束</p>
        )}

        <div className="pk-result-actions">
          {challenger && (
            <button type="button" onClick={nextChallenger}>
              下一位上台：{challenger.studentName}
            </button>
          )}
          <button type="button" onClick={startBattle}>这两名同学再战一局</button>
          <button
            type="button"
            onClick={() => {
              setBoutNo(1);
              setStage("arrange");
            }}
          >
            换人 / 返回出战安排
          </button>
        </div>
      </section>
    );
  }

  // ---------------------------------------------------------------- 对战页
  const turnName = turn === "left" ? leftName : rightName;
  return (
    <section className="dual-pk leg-pk">
      <header className="pk-header">
        <button type="button" onClick={onBack}>退出 PK</button>
        <div>
          <h2>双人 PK · 第 {boutNo} 场</h2>
          <span data-hud="pk-progress">
            剩余 {Math.max(0, Math.round((cards.length - cleared.length) / 2))} 对 ·
            用时 {seconds} 秒
          </span>
        </div>
        <div className="pk-score">
          <b data-hud="pk-left">{leftName} {scores.left}</b>
          <b data-hud="pk-right">{rightName} {scores.right}</b>
        </div>
      </header>

      <p className={`pk-message is-turn is-${turn}`} data-hud="pk-turn">
        现在由 <b>{turnName}</b> 出手 —— 配对成功继续出手，配错就换对方
      </p>

      <div className="leg-pk-stage">
        <CardBoard
          cards={cards}
          layout={layout}
          legendMap={legendMap}
          cleared={clearedSet}
          selected={selected ? selected.uid : null}
          wrongPair={wrongPair}
          hintPair={hintPair}
          onPick={handlePick}
          onResize={handleResize}
          extraClass="is-pk"
        />
      </div>

      <div className="pk-result-actions is-tight">
        <button
          type="button"
          data-action="pk-hint"
          disabled={Boolean(focus) || wrongPair.length > 0}
          onClick={useHintNow}
        >
          提示当前出手方一次（−{PK_POINT} 分）
        </button>
      </div>

      {focus && (
        <div className="overlay-mask is-focus" onClick={closeFocus}>
          {(() => {
            const legend = legendMap.get(focus.legendId);
            if (!legend) {
              return null;
            }
            return (
              <div className={`legend-focus is-${focus.side}`} onClick={(e) => e.stopPropagation()}>
                <div className="legend-focus-tag">
                  {focus.side === "left" ? leftName : rightName} 配对成功
                </div>
                <div className="legend-focus-body">
                  <div className="legend-focus-symbol">
                    <img src={legend.image} alt={legend.name} draggable={false} />
                  </div>
                  <div className="legend-focus-info">
                    <h3>{legend.name}</h3>
                    <p className="legend-focus-cat">{legend.categoryName}</p>
                    <p className="legend-focus-text">{legend.summary}</p>
                  </div>
                </div>
                <div className="legend-focus-bar">
                  <span>+{PK_POINT} 分</span>
                  <span>继续出手</span>
                </div>
                <div className="legend-focus-progress">
                  <i style={{ animationDuration: `${FOCUS_MS}ms` }} />
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </section>
  );
}
