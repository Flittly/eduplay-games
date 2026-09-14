import { Component, useEffect, useMemo, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import WeatherQuiz from "./WeatherQuiz";
import DualQuiz from "./DualQuiz";
import Gallery from "./Gallery";
import { useBank, useGallery } from "./data";
import type { LevelId, PlayerInfo, QuizResult, RoundRecord } from "./types";
import "./styles.css";

const gameCode = "weather_quiz";
const version = "1.0.0";

function postToPlatform(message: unknown) {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(message, "*");
  }
}

function notifyReady() {
  postToPlatform({
    source: "eduplay-game",
    type: "GAME_READY",
    payload: {
      gameCode,
      version
    }
  });
}

function notifyComplete(player: PlayerInfo, result: QuizResult) {
  const roundId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  postToPlatform({
    source: "eduplay-game",
    type: "GAME_COMPLETE",
    payload: {
      roundId,
      studentId: player.studentId,
      studentName: player.studentName,
      className: player.className,
      timeSeconds: result.timeSeconds,
      score: result.score,
      correctCount: result.correctCount,
      totalCount: result.totalCount
    }
  });
}

function notifySessionEnd(records: RoundRecord[]) {
  postToPlatform({
    source: "eduplay-game",
    type: "GAME_SESSION_COMPLETE",
    payload: {
      gameCode,
      version,
      results: records.map((record) => ({
        studentId: record.player.studentId,
        studentName: record.player.studentName,
        className: record.player.className,
        studentNo: record.player.studentNo ?? null,
        score: record.result.score,
        timeSeconds: record.result.timeSeconds,
        correctCount: record.result.correctCount,
        totalCount: record.result.totalCount,
        mistakes: record.wrongAnswers
      }))
    }
  });
}

interface InitPayload {
  roster?: unknown;
  studentId?: unknown;
  studentName?: unknown;
  className?: unknown;
  studentNo?: unknown;
}

function toPlayer(
  source: Record<string, unknown>,
  studentKey = "studentId",
  nameKey = "studentName"
): PlayerInfo | null {
  const idValue = source[studentKey];
  const id =
    typeof idValue === "number"
      ? idValue
      : typeof idValue === "string"
        ? Number(idValue)
        : Number.NaN;
  if (!Number.isFinite(id)) {
    return null;
  }
  return {
    studentId: id,
    studentName:
      typeof source[nameKey] === "string" ? (source[nameKey] as string) : "",
    className:
      typeof source.className === "string" ? (source.className as string) : null,
    studentNo:
      typeof source.studentNo === "string"
        ? (source.studentNo as string)
        : undefined
  };
}

function parseRoster(payload: InitPayload): PlayerInfo[] {
  if (Array.isArray(payload.roster)) {
    const players: PlayerInfo[] = [];
    for (const item of payload.roster) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const player = toPlayer(item as Record<string, unknown>, "studentId", "studentName");
      if (player && !players.some((p) => p.studentId === player.studentId)) {
        players.push(player);
      }
    }
    return players;
  }

  // 兼容旧版平台：只下发单个学生。
  const single = toPlayer(payload as Record<string, unknown>);
  return single ? [single] : [];
}

/**
 * 平台没下发名单时（老师直接把游戏包丢进浏览器预览、或平台上短暂抽风），
 * 不能让学生对着"正在连接"干等。1.4 秒还收不到名单就切体验模式，
 * 用一位虚拟学生把流程跑通；真名单随后到达且未开局时会被替换掉。
 */
const GUEST_ROSTER: PlayerInfo[] = [
  { studentId: -1, studentName: "体验学生", className: null }
];

type Stage = "lobby" | "single" | "dual" | "gallery";

function GameApp() {
  const [roster, setRoster] = useState<PlayerInfo[]>([]);
  const [standalone, setStandalone] = useState(false);
  const [stage, setStage] = useState<Stage>("lobby");
  const [level, setLevel] = useState<LevelId>("junior");

  const bank = useBank();
  const gallery = useGallery();

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const message = event.data;
      if (
        !message ||
        typeof message !== "object" ||
        message.source !== "eduplay-platform" ||
        message.type !== "GAME_INIT"
      ) {
        return;
      }
      const payload = message.payload as InitPayload | undefined;
      if (payload) {
        const players = parseRoster(payload);
        if (players.length > 0) {
          setRoster(players);
          setStandalone(false);
        }
      }
    }

    window.addEventListener("message", onMessage);
    notifyReady();
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (roster.length > 0 || standalone) {
      return;
    }
    const timer = window.setTimeout(() => setStandalone(true), 1400);
    return () => window.clearTimeout(timer);
  }, [roster.length, standalone]);

  const levels = bank.data?.levels ?? [];
  const levelInfo = useMemo(
    () => levels.find((item) => item.id === level) ?? null,
    [levels, level]
  );

  // 必须 memo：DualQuiz 的 effect 依赖 questions 引用，每次渲染都新建数组会让它无限重置。
  const levelQuestions = useMemo(
    () => (bank.data?.questions ?? []).filter((q) => q.level === level),
    [bank.data, level]
  );

  const effectiveRoster = roster.length > 0 ? roster : standalone ? GUEST_ROSTER : [];

  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const q of bank.data?.questions ?? []) {
      counts[q.level] = (counts[q.level] ?? 0) + 1;
    }
    return counts;
  }, [bank.data]);

  if (bank.error || gallery.error) {
    const message = bank.error ?? gallery.error ?? "";
    return (
      <div className="screen-center">
        <div className="notice-card is-error">
          <h2>题库没能加载</h2>
          <p>错误信息：{message}</p>
          <p className="notice-sub">
            请确认 data/questions.json 与 data/elements.json 随游戏包一起发布；
            网络或磁盘读取失败也会这样。
          </p>
          <div className="notice-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                bank.retry();
                gallery.retry();
              }}
            >
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!bank.data) {
    return (
      <div className="screen-center">
        <div className="notice-card">
          <h2>气象要素识别</h2>
          <p>正在加载题库…</p>
        </div>
      </div>
    );
  }

  if (effectiveRoster.length === 0) {
    return (
      <div className="screen-center">
        <div className="notice-card">
          <h2>气象要素识别</h2>
          <p>正在等待平台下发学生名单…</p>
        </div>
      </div>
    );
  }

  if (stage === "gallery") {
    return <Gallery elements={gallery.data?.elements ?? []} onBack={() => setStage("lobby")} />;
  }

  if (stage === "dual") {
    return (
      <DualQuiz
        roster={effectiveRoster}
        questions={levelQuestions}
        level={level}
        levelInfo={levelInfo}
        onBack={() => setStage("lobby")}
      />
    );
  }

  if (stage === "single") {
    return (
      <WeatherQuiz
        roster={effectiveRoster}
        questions={levelQuestions}
        level={level}
        levelInfo={levelInfo}
        onComplete={notifyComplete}
        onSessionEnd={notifySessionEnd}
        onBack={() => setStage("lobby")}
      />
    );
  }

  return (
    <div className="lobby">
      <header className="lobby-head">
        <h1>气象要素识别</h1>
        <p className="lobby-lead">
          看图片，选名称。图片来自教材常见天气符号、真实气象照片、气候统计图与天气系统示意图。
          初中、高中各 {levelCounts.junior ?? 0} 题，共{" "}
          {bank.data.questions.length} 题。
        </p>
        {standalone && (
          <p className="lobby-standalone">
            未收到平台的学生名单，当前为体验模式（以「体验学生」身份作答）
          </p>
        )}
        <div className="lobby-roster">
          <strong>本次参与学生（{effectiveRoster.length} 人）</strong>
          <ul>
            {effectiveRoster.map((player) => (
              <li key={player.studentId}>{player.studentName}</li>
            ))}
          </ul>
        </div>
      </header>

      <section className="lobby-level">
        <div className="lobby-level-title">
          <strong>选择题组</strong>
          <span>两个组别的考查范围不同，可随时切换</span>
        </div>
        <div className="level-cards">
          {levels.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`level-card${item.id === level ? " is-active" : ""}`}
              onClick={() => setLevel(item.id)}
            >
              <strong>{item.name}组</strong>
              <span>{item.subtitle}</span>
              <em>{levelCounts[item.id] ?? 0} 题</em>
            </button>
          ))}
        </div>
      </section>

      {levelInfo && (
        <section className="scope-box">
          <strong>本级考查范围</strong>
          <ul>
            {levelInfo.scope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="lobby-mode">
        <div className="lobby-level-title">
          <strong>选择模式</strong>
          <span>课堂大屏建议用双人 PK</span>
        </div>
        <div className="mode-cards">
          <button type="button" onClick={() => setStage("single")}>
            <strong>单人模式</strong>
            <span>逐个学生上台作答题库，自动记分与排名</span>
          </button>
          <button type="button" onClick={() => setStage("dual")}>
            <strong>双人 PK</strong>
            <span>左右抢答 10 题，比谁更快更准</span>
          </button>
          <button type="button" onClick={() => setStage("gallery")}>
            <strong>要素图鉴</strong>
            <span>
              查看全部 {gallery.data?.elements.length ?? 0} 个气象要素，按等级与分类筛选
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * 错误边界：任何一处渲染抛错，都换成可读的错误卡片 + 重试按钮。
 * 没有它的话，React 会把整棵树卸载掉，学生在平台里看到的就是一片空白。
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[weather-quiz] 页面渲染出错：", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="screen-center">
          <div className="notice-card is-error">
            <h2>页面出错了</h2>
            <p>{this.state.error.message || String(this.state.error)}</p>
            <p className="notice-sub">
              可以重新加载试试；如果一直这样，请把上面这行信息反馈给老师。
            </p>
            <div className="notice-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={() => window.location.reload()}
              >
                重新加载
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <ErrorBoundary>
      <GameApp />
    </ErrorBoundary>
  );
}
