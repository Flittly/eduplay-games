import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MiniMap from "./MiniMap";
import { buildVector, loadJson, makeResult, resultToText, assetUrl } from "./logic";
import type {
  ChinaMap,
  Dimension,
  Landform,
  LandformData,
  PlayerInfo,
  Profile,
  Question,
  QuestionData,
  ScoredLandform,
  WorldMap
} from "./types";

type Stage = "intro" | "quiz" | "result" | "atlas";
type PoolKey = "domestic" | "international" | "all";

const POOLS: { key: PoolKey; title: string; desc: string }[] = [
  { key: "domestic", title: "中国地貌", desc: "从青藏高原到南海之滨，在华夏山河里找和你最像的那一处" },
  { key: "international", title: "世界地貌", desc: "撒哈拉、亚马孙、大堡礁……在世界各地找你的同类" },
  { key: "all", title: "全部地貌", desc: "国内 40 处 + 国外 40 处放在一起比，结果可能更惊喜" }
];

function poolLandforms(all: Landform[], pool: PoolKey): Landform[] {
  if (pool === "all") return all;
  return all.filter((x) => x.category === pool);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* 降级 */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

/* ---------------------------- 左侧介绍栏 + 右侧详情 ---------------------------- */

interface DetailProps {
  landform: Landform;
  china: ChinaMap | null;
  world: WorldMap | null;
  dims: Dimension[];
  score?: number;
  vector?: Profile;
  similar?: ScoredLandform[];
  studentName?: string;
  onRetest?: () => void;
  onAtlas?: () => void;
  onBack?: () => void;
}

function DetailView({
  landform,
  china,
  world,
  dims,
  score,
  vector,
  similar,
  studentName,
  onRetest,
  onAtlas,
  onBack
}: DetailProps) {
  const [toast, setToast] = useState("");

  const doCopy = async () => {
    const text = resultToText(landform, score ?? 0, vector ?? landform.profile, dims);
    const ok = await copyText(
      studentName ? `${studentName} 的结果\n${text}` : text
    );
    setToast(ok ? "结果已复制到剪贴板" : "复制失败，请手动选取文字");
    window.setTimeout(() => setToast(""), 2200);
  };

  const map = landform.category === "domestic" ? china : world;

  return (
    <div className="detail">
      <aside className="detail-side">
        <div className="detail-head">
          <span className={`chip chip--${landform.category}`}>
            {landform.category === "domestic" ? "中国地貌" : "国外地貌"}
          </span>
          <span className="chip chip--type">{landform.type}</span>
        </div>

        <h1 className="detail-name">{landform.name}</h1>
        <p className="detail-en">{landform.en}</p>
        <p className="detail-meta">
          {landform.country} · {landform.region}
        </p>

        {typeof score === "number" ? (
          <div className="detail-score">
            <strong>{score}%</strong>
            <span>与你的人格匹配度</span>
          </div>
        ) : null}

        <MiniMap landform={landform} china={china} world={world} />

        <section className="block">
          <h3 className="block-title">这是什么</h3>
          <p className="block-text">{landform.intro}</p>
        </section>

        <section className="block">
          <h3 className="block-title">主要特点</h3>
          <ul className="traits">
            {landform.traits.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>

        <section className="block">
          <h3 className="block-title">它是怎么形成的</h3>
          <p className="block-text">{landform.cause}</p>
        </section>

        {map ? (
          <p className="detail-src">
            地图底图：{map.meta.source}
          </p>
        ) : null}
      </aside>

      <section className="detail-main">
        <figure className="photo">
          <img src={assetUrl(landform.photo)} alt={landform.name} loading="lazy" />
          <figcaption>
            <span>{landform.summary}</span>
            {landform.photoSource ? (
              <a href={landform.photoSource} target="_blank" rel="noreferrer noopener">
                图片来源
              </a>
            ) : null}
          </figcaption>
        </figure>

        <section className="speech">
          <h3>为什么说你像它</h3>
          <p>{landform.personality}</p>
        </section>

        {vector ? (
          <section className="bars">
            <h3>你的人格五维</h3>
            {dims.map((d) => {
              const v = vector[d.key] ?? 50;
              const pole = v >= 50 ? d.highLabel : d.lowLabel;
              return (
                <div className="bar-row" key={d.key}>
                  <div className="bar-top">
                    <span className="bar-name">{d.name}</span>
                    <span className="bar-pole">
                      偏「{pole}」· {v}
                    </span>
                  </div>
                  <div className="bar">
                    <span className="bar-mid" />
                    <span className="bar-dot" style={{ left: `${v}%` }} />
                  </div>
                  <div className="bar-ends">
                    <span>{d.lowLabel}</span>
                    <span>{d.highLabel}</span>
                  </div>
                </div>
              );
            })}
          </section>
        ) : null}

        {similar && similar.length ? (
          <section className="similar">
            <h3>和它相近的地貌</h3>
            <div className="similar-grid">
              {similar.map((s) => (
                <div className="similar-card" key={s.landform.id}>
                  <img src={assetUrl(s.landform.photo)} alt={s.landform.name} loading="lazy" />
                  <div>
                    <strong>{s.landform.name}</strong>
                    <span>{s.landform.type}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="actions">
          {onRetest ? (
            <button type="button" className="btn btn--primary" onClick={onRetest}>
              重新测试
            </button>
          ) : null}
          {onAtlas ? (
            <button type="button" className="btn" onClick={onAtlas}>
              查看全部地貌
            </button>
          ) : null}
          <button type="button" className="btn" onClick={doCopy}>
            复制我的结果
          </button>
          {onBack ? (
            <button type="button" className="btn btn--ghost" onClick={onBack}>
              ← 返回图鉴
            </button>
          ) : null}
        </div>
        {toast ? <div className="toast">{toast}</div> : null}
      </section>
    </div>
  );
}

/* ---------------------------- 主应用 ---------------------------- */

export default function App({ roster }: { roster: PlayerInfo[] }) {
  const [data, setData] = useState<LandformData | null>(null);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [china, setChina] = useState<ChinaMap | null>(null);
  const [world, setWorld] = useState<WorldMap | null>(null);
  const [error, setError] = useState("");

  const [stage, setStage] = useState<Stage>("intro");
  const [pool, setPool] = useState<PoolKey>("domestic");
  const [answers, setAnswers] = useState<number[]>([]);
  const [cursor, setCursor] = useState(0);
  const [atlasCategory, setAtlasCategory] = useState<PoolKey>("domestic");
  const [detail, setDetail] = useState<Landform | null>(null);
  const [flash, setFlash] = useState(-1);
  const flashTimer = useRef<number | null>(null);

  const player = roster.length ? roster[0] : null;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [lf, qs, cn, wd] = await Promise.all([
          loadJson<LandformData>("./data/landforms.json"),
          loadJson<QuestionData>("./data/questions.json"),
          loadJson<ChinaMap>("./assets/maps/china.json"),
          loadJson<WorldMap>("./assets/maps/world.json")
        ]);
        if (!alive) return;
        setData(lf);
        setQuestions(qs.questions);
        setChina(cn);
        setWorld(wd);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const dims = data?.dimensions ?? [];
  const dimKeys = useMemo(() => dims.map((d) => d.key), [dims]);

  const result = useMemo(() => {
    if (!data || !questions || answers.length !== questions.length) return null;
    const vector = buildVector(questions, answers, dimKeys);
    return makeResult(vector, poolLandforms(data.landforms, pool), dimKeys);
  }, [data, questions, answers, dimKeys, pool]);

  const pick = useCallback(
    (index: number) => {
      if (!questions) return;
      setFlash(index);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(-1), 200);
      setAnswers((prev) => {
        const next = prev.slice();
        next[cursor] = index;
        return next;
      });
      window.setTimeout(() => {
        if (cursor < questions.length - 1) {
          setCursor((c) => c + 1);
        } else {
          setStage("result");
        }
      }, 180);
    },
    [cursor, questions]
  );

  const restart = useCallback(() => {
    setAnswers([]);
    setCursor(0);
    setStage("quiz");
  }, []);

  /* 键盘：1-4 选项、← 上一题 */
  useEffect(() => {
    if (stage !== "quiz" || !questions) return;
    const onKey = (e: KeyboardEvent) => {
      const q = questions[cursor];
      if (!q) return;
      if (e.key >= "1" && e.key <= String(q.options.length)) {
        pick(Number(e.key) - 1);
      } else if (e.key === "ArrowLeft" || e.key === "Backspace") {
        setCursor((c) => Math.max(0, c - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, questions, cursor, pick]);

  if (error) {
    return (
      <div className="lq-app lq-center">
        <div className="card card--warn">
          <h2>数据加载失败</h2>
          <p>{error}</p>
          <p className="muted">
            请确认 data/landforms.json、data/questions.json 与 assets/maps/*.json 都在同一目录下。
          </p>
        </div>
      </div>
    );
  }

  if (!data || !questions) {
    return (
      <div className="lq-app lq-center">
        <div className="lq-loading">
          <span className="lq-loading__ring" />
          <p>正在加载地貌图谱…</p>
        </div>
      </div>
    );
  }

  const counts = {
    domestic: data.landforms.filter((x) => x.category === "domestic").length,
    international: data.landforms.filter((x) => x.category === "international").length,
    all: data.landforms.length
  };

  return (
    <div className="lq-app">
      <header className="lq-header">
        <div className="lq-brand">
          <span className="lq-logo">地</span>
          <div>
            <strong>地貌人格测试</strong>
            <em>15 道题，看看你的性格像地球上哪一种地貌</em>
          </div>
        </div>
        <div className="lq-header-right">
          {player ? <span className="lq-player">{player.studentName || `学生 ${player.studentId}`}</span> : null}
          <span className="lq-count">{data.landforms.length} 种地貌</span>
        </div>
      </header>

      {stage === "intro" ? (
        <main className="intro">
          <h2 className="intro-title">你的性格，是哪一片大地？</h2>
          <p className="intro-sub">
            我们把人比作地貌，不是随口比喻——地貌的五个属性，恰好对应人格的五个侧面：
            它有多热、有多高、有多硬、有多动、有多润。答完 15 道题，你会得到一条专属的人格曲线，
            再拿它去和 {data.landforms.length} 处真实地貌一一比对，最接近的那一处，就是你。
          </p>

          <div className="dims-intro">
            {dims.map((d) => (
              <div className="dim-chip" key={d.key}>
                <b>{d.name}</b>
                <span>
                  {d.lowLabel} ↔ {d.highLabel}
                </span>
              </div>
            ))}
          </div>

          <h3 className="intro-label">先选一个题库</h3>
          <div className="pool-grid">
            {POOLS.map((p) => (
              <button
                type="button"
                key={p.key}
                className={`pool-card${pool === p.key ? " is-active" : ""}`}
                onClick={() => setPool(p.key)}
              >
                <span className="pool-count">{counts[p.key]} 种</span>
                <strong>{p.title}</strong>
                <span className="pool-desc">{p.desc}</span>
              </button>
            ))}
          </div>

          <div className="intro-actions">
            <button type="button" className="btn btn--primary btn--lg" onClick={restart}>
              开始测试
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setAtlasCategory(pool);
                setDetail(null);
                setStage("atlas");
              }}
            >
              先看看地貌图鉴
            </button>
          </div>
        </main>
      ) : null}

      {stage === "quiz" ? (
        <main className="quiz">
          <div className="quiz-top">
            <span className="quiz-step">
              第 <b>{cursor + 1}</b> / {questions.length} 题
            </span>
            <div className="quiz-bar">
              <span style={{ width: `${((cursor + 1) / questions.length) * 100}%` }} />
            </div>
          </div>

          <h2 className="quiz-q">{questions[cursor].text}</h2>

          <div className="quiz-options">
            {questions[cursor].options.map((opt, i) => (
              <button
                type="button"
                key={opt.label}
                className={`quiz-opt${flash === i ? " is-flash" : ""}`}
                onClick={() => pick(i)}
              >
                <span className="quiz-opt__key">{i + 1}</span>
                <span className="quiz-opt__label">{opt.label}</span>
              </button>
            ))}
          </div>

          <div className="quiz-nav">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={cursor === 0}
              onClick={() => setCursor((c) => Math.max(0, c - 1))}
            >
              ← 上一题
            </button>
            <span className="quiz-hint">可以直接按数字键 1–{questions[cursor].options.length} 作答</span>
          </div>
        </main>
      ) : null}

      {stage === "result" && result ? (
        <DetailView
          landform={result.ranked[0].landform}
          score={result.ranked[0].score}
          vector={result.vector}
          similar={result.ranked.slice(1, 4)}
          dims={dims}
          china={china}
          world={world}
          studentName={player?.studentName}
          onRetest={restart}
          onAtlas={() => {
            setAtlasCategory(pool);
            setDetail(null);
            setStage("atlas");
          }}
        />
      ) : null}

      {stage === "atlas" ? (
        detail ? (
          <DetailView
            landform={detail}
            dims={dims}
            china={china}
            world={world}
            onBack={() => setDetail(null)}
            onRetest={restart}
          />
        ) : (
          <main className="atlas">
            <div className="atlas-head">
              <h2>地貌图鉴</h2>
              <div className="atlas-filter">
                {POOLS.map((p) => (
                  <button
                    type="button"
                    key={p.key}
                    className={atlasCategory === p.key ? "is-active" : ""}
                    onClick={() => setAtlasCategory(p.key)}
                  >
                    {p.title}
                    <em>{counts[p.key]}</em>
                  </button>
                ))}
              </div>
              <button type="button" className="btn" onClick={() => setStage("intro")}>
                回到首页
              </button>
            </div>
            <div className="atlas-grid">
              {poolLandforms(data.landforms, atlasCategory).map((lf) => (
                <button
                  type="button"
                  className="atlas-card"
                  key={lf.id}
                  onClick={() => setDetail(lf)}
                >
                  <img src={assetUrl(lf.photo)} alt={lf.name} loading="lazy" />
                  <div className="atlas-card__body">
                    <strong>{lf.name}</strong>
                    <span className="atlas-card__type">{lf.type}</span>
                    <span className="atlas-card__region">
                      {lf.country} · {lf.region}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </main>
        )
      ) : null}

      <footer className="lq-foot">
        地貌数据与照片：逐条整理自公开资料，地图底图为合规数据源（中国边界：阿里云 DataV／高德；
        世界陆地掩膜：Natural Earth）。仅用于教学演示。
      </footer>
    </div>
  );
}
