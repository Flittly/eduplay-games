import { useEffect, useMemo, useRef, useState } from "react";
import provinceData from "./data/provinces.json";
import { PROVINCE_HINTS } from "./hints";
import { silhouettePathClass, silhouetteViewBox } from "./silhouette";
import type { PlayerInfo } from "./ProvinceQuiz";

interface Feature {
  id: string;
  name: string;
  centroid: [number, number];
  bbox: [number, number, number, number];
  d: string;
}

interface QuizData {
  viewBox: [number, number, number, number];
  features: Feature[];
}

const DATA = provinceData as unknown as QuizData;
const FEATURES = DATA.features;

/**
 * 双人 PK 的三个阶段：
 *   arrange —— 出战安排：老师在这里指定左右两侧分别由谁上场，其余人排队候场
 *   battle  —— 对战：左右两侧全程显示学生姓名
 *   result  —— 本场结果：可以直接「下一位上台」把擂主打下去
 *
 * 为什么要有 arrange：平台下发的名单常常不止 2 人（一堂课选 5、6 个学生很常见），
 * 而 PK 一次只能上 2 个。没有这个环节的话，第 3 个人起就完全无从上场，
 * 大屏上也只能看到"左侧玩家 / 右侧玩家"，谁在答、谁答对都认不出来。
 */
interface DualQuizProps {
  roster: PlayerInfo[];
  onBack: () => void;
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const TOTAL_QUESTIONS = 10;
const CORRECT_POINTS = 10;
/** 有人答对后，停留多久再切下一题。 */
const ADVANCE_DELAY_MS = 900;
/** 双方都答错后，多停一会儿方便看清正确答案。 */
const VOID_DELAY_MS = 1600;

/** 名单只有 1 人时补的陪练席，保证"游戏包丢进浏览器直接试玩"也能走通 PK。 */
const SPARRING: PlayerInfo = {
  studentId: -2,
  studentName: "陪练同学",
  className: null
};

type PkStage = "arrange" | "battle" | "result";

export default function DualQuiz({ roster, onBack }: DualQuizProps) {
  // 名单不足 2 人时补一位陪练，否则 PK 根本开不了局。
  const seats = useMemo<PlayerInfo[]>(
    () => (roster.length >= 2 ? roster : [...roster, SPARRING]),
    [roster]
  );
  const needsSparring = roster.length < 2;

  const [stage, setStage] = useState<PkStage>("arrange");
  const [leftSeat, setLeftSeat] = useState<number | null>(null);
  const [rightSeat, setRightSeat] = useState<number | null>(null);
  /** 候场队列：本场输的人下场后，队首的同学上台补位。 */
  const [bench, setBench] = useState<number[]>([]);
  const [boutNo, setBoutNo] = useState(1);

  const [queue, setQueue] = useState<Feature[]>([]);
  const [index, setIndex] = useState(0);
  const [leftScore, setLeftScore] = useState(0);
  const [rightScore, setRightScore] = useState(0);
  const [leftWrong, setLeftWrong] = useState(false);
  const [rightWrong, setRightWrong] = useState(false);
  const [winnerSide, setWinnerSide] = useState<"left" | "right" | null>(null);
  const [finished, setFinished] = useState(false);
  // 本题是否已结算（有人答对 / 双方都答错），防止定时器被重复挂上导致跳题。
  const settledRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const leftPlayer = seats.find((p) => p.studentId === leftSeat) ?? null;
  const rightPlayer = seats.find((p) => p.studentId === rightSeat) ?? null;
  const leftName = leftPlayer?.studentName ?? "左侧";
  const rightName = rightPlayer?.studentName ?? "右侧";
  const benchPlayers = bench
    .map((id) => seats.find((p) => p.studentId === id))
    .filter((p): p is PlayerInfo => Boolean(p));

  /** 首次进入（或名单变化）时把前两人摆上左右席，其余人排队候场。 */
  useEffect(() => {
    const ids = seats.map((p) => p.studentId);
    setLeftSeat(ids[0] ?? null);
    setRightSeat(ids[1] ?? null);
    setBench(ids.slice(2));
    setBoutNo(1);
  }, [seats]);

  /** 抽题 + 清零比分。开新一场、再战一局都走这里。 */
  function resetBout() {
    settledRef.current = false;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setQueue(shuffle(FEATURES).slice(0, Math.min(TOTAL_QUESTIONS, FEATURES.length)));
    setIndex(0);
    setLeftScore(0);
    setRightScore(0);
    setLeftWrong(false);
    setRightWrong(false);
    setWinnerSide(null);
    setFinished(false);
  }

  useEffect(() => {
    resetBout();
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    []
  );

  /**
   * 结算本题并推进到下一题。答对与“双方都答错”两条路径都走这里，
   * 否则双方都答错时题号不动，游戏会永久卡住。
   * 题号用函数式更新：早期版本读闭包里的 index 再 +1，一旦 delay 期间
   * 因为 setLeftWrong 触发重渲染，读到的就是过期值。
   */
  function settleQuestion(delay: number) {
    if (settledRef.current) {
      return;
    }
    settledRef.current = true;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      settledRef.current = false;
      setIndex((current) => {
        const next = current + 1;
        if (next >= queue.length) {
          setFinished(true);
          return current;
        }
        setLeftWrong(false);
        setRightWrong(false);
        setWinnerSide(null);
        return next;
      });
    }, delay);
  }

  const target = queue[index] ?? null;
  const options = useMemo(
    () =>
      target
        ? shuffle([
            target.name,
            ...shuffle(
              FEATURES.filter((feature) => feature.name !== target.name)
            )
              .slice(0, 3)
              .map((feature) => feature.name)
          ])
        : [],
    [target]
  );
  const hints = target ? PROVINCE_HINTS[target.name] ?? [] : [];
  // 本题已揭晓（有人答对，或双方都答错）—— 此时把正确项标出来。
  const revealed = Boolean(winnerSide) || (leftWrong && rightWrong);

  function answer(side: "left" | "right", name: string) {
    if (!target || finished || settledRef.current) {
      return;
    }
    if (side === "left" && leftWrong) {
      return;
    }
    if (side === "right" && rightWrong) {
      return;
    }
    if (name !== target.name) {
      // 对方是否已经先答错：若已答错，本方这一下就是本题的最后一次机会。
      const otherAlreadyWrong = side === "left" ? rightWrong : leftWrong;
      if (side === "left") {
        setLeftWrong(true);
      } else {
        setRightWrong(true);
      }
      if (otherAlreadyWrong) {
        settleQuestion(VOID_DELAY_MS);
      }
      return;
    }
    if (side === "left") {
      setLeftScore((value) => value + CORRECT_POINTS);
    } else {
      setRightScore((value) => value + CORRECT_POINTS);
    }
    setWinnerSide(side);
    settleQuestion(ADVANCE_DELAY_MS);
  }

  /** 把某个学生放到左/右席。
   *  - 点的是对面席上的人 → 两人对调，候场队列不动；
   *  - 点的是候场里的人 → 他上台，原先那人退回候场队首（随时还能再被叫上来）。
   */
  function assignSeat(side: "left" | "right", studentId: number) {
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

  /**
   * 擂台延续：本场负者下场，候场队首上台补他的位置。平局时约定右席下场。
   * 负者不再回到候场（擂台制里他已经被淘汰），这样 N 个人恰好打 N-1 场就全员上场。
   */
  function nextChallenger() {
    const challenger = benchPlayers[0];
    if (!challenger) {
      return;
    }
    const loseSide: "left" | "right" =
      leftScore < rightScore ? "left" : rightScore < leftScore ? "right" : "right";
    if (loseSide === "left") {
      setLeftSeat(challenger.studentId);
    } else {
      setRightSeat(challenger.studentId);
    }
    setBench((list) => list.filter((id) => id !== challenger.studentId));
    setBoutNo((value) => value + 1);
    resetBout();
    setStage("battle");
  }

  if (stage === "arrange") {
    return (
      <section className="dual-pk is-arrange">
        <header className="pk-header">
          <button type="button" onClick={onBack}>
            返回模式选择
          </button>
          <div>
            <h2>双人 PK · 出战安排</h2>
            <span>共 {seats.length} 名学生，点名字把他们放到左席或右席</span>
          </div>
          <div className="pk-score">
            <b>第 {boutNo} 场</b>
          </div>
        </header>

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
                  {seats.map((player) => {
                    const active = player.studentId === current?.studentId;
                    const otherSide = side === "left" ? rightSeat : leftSeat;
                    return (
                      <button
                        key={player.studentId}
                        type="button"
                        className={[
                          active ? "is-active" : "",
                          player.studentId === otherSide ? "is-other-seat" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => assignSeat(side, player.studentId)}
                      >
                        {player.studentName}
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
            <strong>候场 {benchPlayers.length} 人</strong>
            <span>
              每场结束后输的一方下场，候场第一位上台挑战 ——
              人数再多也能一个不落地轮完
            </span>
          </div>
          {benchPlayers.length === 0 ? (
            <p className="pk-bench-empty">没有候场学生，本场就是最终对决</p>
          ) : (
            <ul className="pk-bench-list">
              {benchPlayers.map((player, order) => (
                <li key={player.studentId}>
                  <span className="pk-bench-order">{order + 1}</span>
                  {player.studentName}
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

  if (stage === "result" || finished || !target) {
    const winner =
      leftScore > rightScore
        ? { name: leftName, side: "left" as const }
        : rightScore > leftScore
          ? { name: rightName, side: "right" as const }
          : null;
    const challenger = benchPlayers[0] ?? null;
    const loseSide: "left" | "right" =
      leftScore < rightScore ? "left" : rightScore < leftScore ? "right" : "right";
    const loseName = loseSide === "left" ? leftName : rightName;

    return (
      <section className="dual-pk is-result">
        <h2>第 {boutNo} 场结果</h2>
        <div className="pk-score-board">
          <div className={winner?.side === "left" ? "is-winner" : ""}>
            <small>{leftName}</small>
            <b>{leftScore}</b>
          </div>
          <span className="pk-score-vs">:</span>
          <div className={winner?.side === "right" ? "is-winner" : ""}>
            <small>{rightName}</small>
            <b>{rightScore}</b>
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
          <button type="button" onClick={startBattle}>
            这两名同学再战一局
          </button>
          <button
            type="button"
            onClick={() => {
              setBoutNo(1);
              setStage("arrange");
            }}
          >
            换人 / 返回出战安排
          </button>
          <button type="button" onClick={onBack}>
            退出 PK
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="dual-pk">
      <header className="pk-header">
        <button type="button" onClick={onBack}>
          退出 PK
        </button>
        <div>
          <h2>双人 PK</h2>
          <span>
            第 {boutNo} 场 · 第 {index + 1} / {queue.length} 题
          </span>
        </div>
        <div className="pk-score">
          <b>
            {leftName} {leftScore}
          </b>
          <b>
            {rightName} {rightScore}
          </b>
        </div>
      </header>

      {winnerSide ? (
        <p className="pk-message">
          {winnerSide === "left" ? leftName : rightName} 答对 +{CORRECT_POINTS} ·
          正确答案：<b>{target.name}</b>
        </p>
      ) : leftWrong && rightWrong ? (
        <p className="pk-message">
          双方均答错，本题作废 · 正确答案：<b>{target.name}</b>
        </p>
      ) : leftWrong ? (
        <p className="pk-message">
          {leftName} 答错锁定，{rightName} 请作答
        </p>
      ) : rightWrong ? (
        <p className="pk-message">
          {rightName} 答错锁定，{leftName} 请作答
        </p>
      ) : (
        <p className="pk-message">点击自己一侧的名称抢答</p>
      )}

      <div className="pk-board">
        <div className="pk-side left-side">
          <h3 className="pk-player-name">
            <span className="pk-side-tag">左</span>
            {leftPlayer?.studentName ?? "左侧玩家"}
          </h3>
          <div className="pk-options pk-options-4">
            {options.map((name) => (
              <button
                key={`left-${name}`}
                className={revealed && name === target.name ? "is-answer" : ""}
                disabled={leftWrong || Boolean(winnerSide)}
                onClick={() => answer("left", name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        <div className="pk-map">
          <svg
            viewBox={silhouetteViewBox(target)}
            role="img"
            aria-label={`请识别 ${target.name}`}
          >
            <path
              d={target.d}
              fill="#d4a843"
              stroke="#1a1a1a"
              className={silhouettePathClass(target)}
            />
          </svg>
          <p>这是哪个省级行政区？</p>
          {hints.slice(0, 1).map((hint) => (
            <small key={hint}>{hint}</small>
          ))}
          {revealed && (
            <p className="pk-explain">
              {target.name}
              {hints.length > 0 ? " · " + hints[0] : ""}
            </p>
          )}
        </div>

        <div className="pk-side right-side">
          <h3 className="pk-player-name">
            <span className="pk-side-tag">右</span>
            {rightPlayer?.studentName ?? "右侧玩家"}
          </h3>
          <div className="pk-options pk-options-4">
            {options.map((name) => (
              <button
                key={`right-${name}`}
                className={revealed && name === target.name ? "is-answer" : ""}
                disabled={rightWrong || Boolean(winnerSide)}
                onClick={() => answer("right", name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
