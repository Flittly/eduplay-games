import { useMemo, useState } from "react";
import provinceData from "./data/provinces.json";
import { PROVINCE_HINTS } from "./hints";

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

interface DualQuizProps {
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

function silhouetteViewBox(feature: Feature): string {
  const [minX, minY, maxX, maxY] = feature.bbox;
  const pad = Math.max(maxX - minX, maxY - minY) * 0.08 + 12;
  return `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
}

const TOTAL_QUESTIONS = 10;
const CORRECT_POINTS = 10;

export default function DualQuiz({ onBack }: DualQuizProps) {
  const [queue, setQueue] = useState(() =>
    shuffle(FEATURES).slice(0, TOTAL_QUESTIONS)
  );
  const [index, setIndex] = useState(0);
  const [leftScore, setLeftScore] = useState(0);
  const [rightScore, setRightScore] = useState(0);
  const [leftWrong, setLeftWrong] = useState(false);
  const [rightWrong, setRightWrong] = useState(false);
  const [winnerName, setWinnerName] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  const target = queue[index];
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

  function answer(side: "left" | "right", name: string) {
    if (!target || finished) {
      return;
    }
    if (side === "left" && leftWrong) {
      return;
    }
    if (side === "right" && rightWrong) {
      return;
    }
    if (name !== target.name) {
      if (side === "left") {
        setLeftWrong(true);
      } else {
        setRightWrong(true);
      }
      return;
    }
    if (side === "left") {
      setLeftScore((value) => value + CORRECT_POINTS);
    } else {
      setRightScore((value) => value + CORRECT_POINTS);
    }
    setWinnerName(side === "left" ? "左侧" : "右侧");
    window.setTimeout(() => {
      const next = index + 1;
      if (next >= queue.length) {
        setFinished(true);
        return;
      }
      setIndex(next);
      setLeftWrong(false);
      setRightWrong(false);
      setWinnerName(null);
    }, 900);
  }

  if (finished || !target) {
    return (
      <section className="dual-pk">
        <h2>双人 PK 结果</h2>
        <div className="pk-score-board">
          <div>左侧 {leftScore}</div>
          <div>右侧 {rightScore}</div>
        </div>
        <p className="pk-result-text">
          {leftScore > rightScore
            ? "左侧获胜！"
            : rightScore > leftScore
              ? "右侧获胜！"
              : "平局！"}
        </p>
        <button onClick={onBack}>返回模式选择</button>
      </section>
    );
  }

  return (
    <section className="dual-pk">
      <header className="pk-header">
        <button onClick={onBack}>退出PK</button>
        <div>
          <h2>双人 PK</h2>
          <span>
            第 {index + 1} / {queue.length} 题
          </span>
        </div>
        <div className="pk-score">
          <b>左 {leftScore}</b>
          <b>右 {rightScore}</b>
        </div>
      </header>

      {winnerName ? (
        <p className="pk-message">{winnerName} 答对 +{CORRECT_POINTS}</p>
      ) : leftWrong && rightWrong ? (
        <p className="pk-message">双方均答错，本题作废</p>
      ) : leftWrong ? (
        <p className="pk-message">左侧答错锁定，右侧请作答</p>
      ) : rightWrong ? (
        <p className="pk-message">右侧答错锁定，左侧请作答</p>
      ) : (
        <p className="pk-message">点击自己一侧的名称抢答</p>
      )}

      <div className="pk-board">
        <div className="pk-side left-side">
          <h3>左侧玩家</h3>
          <div className="pk-options pk-options-4">
            {options.map((name) => (
              <button
                key={`left-${name}`}
                disabled={leftWrong || Boolean(winnerName)}
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
            <path d={target.d} fill="#d4a843" stroke="#1a1a1a" strokeWidth={3} />
          </svg>
          <p>这是哪个省级行政区？</p>
          {hints.slice(0, 1).map((hint) => (
            <small key={hint}>{hint}</small>
          ))}
        </div>

        <div className="pk-side right-side">
          <h3>右侧玩家</h3>
          <div className="pk-options pk-options-4">
            {options.map((name) => (
              <button
                key={`right-${name}`}
                disabled={rightWrong || Boolean(winnerName)}
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
