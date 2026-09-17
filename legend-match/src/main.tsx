import { Component, useEffect, useMemo, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import LegendMatch from "./LegendMatch";
import DualMatch from "./DualMatch";
import Gallery from "./Gallery";
import { useLegends } from "./data";
import { LEVEL_PAIRS, totalPairs } from "./gameData";
import type { LegendItem, PlayerInfo, RoundRecord, RunResult } from "./types";
import "./styles.css";

const gameCode = "legend_match";
const version = "0.0.1";

function postToPlatform(message: unknown) {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(message, "*");
  }
}

function notifyReady() {
  postToPlatform({
    source: "eduplay-game",
    type: "GAME_READY",
    payload: { gameCode, version }
  });
}

function notifyComplete(player: PlayerInfo, result: RunResult) {
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
      correctCount: result.matchedCount,
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
        correctCount: record.result.matchedCount,
        totalCount: record.result.totalCount,
        mistakes: record.wrongCount
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
      typeof source.studentNo === "string" ? (source.studentNo as string) : undefined
  };
}

function parseRoster(payload: InitPayload): PlayerInfo[] {
  if (Array.isArray(payload.roster)) {
    const players: PlayerInfo[] = [];
    for (const item of payload.roster) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const player = toPlayer(item as Record<string, unknown>);
      if (player && !players.some((p) => p.studentId === player.studentId)) {
        players.push(player);
      }
    }
    return players;
  }
  const single = toPlayer(payload as Record<string, unknown>);
  return single ? [single] : [];
}

/**
 * 平台没下发名单时（老师把游戏包直接丢进浏览器、或平台上短暂抽风），
 * 1.4 秒还收不到就切体验模式，用一位虚拟学生把流程跑通。
 */
const GUEST_ROSTER: PlayerInfo[] = [
  { studentId: -1, studentName: "体验学生", className: null }
];

type Stage = "lobby" | "single" | "dual" | "gallery";

function GameApp() {
  const [roster, setRoster] = useState<PlayerInfo[]>([]);
  const [standalone, setStandalone] = useState(false);
  const [stage, setStage] = useState<Stage>("lobby");

  const bank = useLegends();
  const legends = bank.data?.legends ?? [];
  const categories = bank.data?.categories ?? [];

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

  const effectiveRoster = roster.length > 0 ? roster : standalone ? GUEST_ROSTER : [];

  const byCategory = useMemo(() => {
    const map: { name: string; count: number }[] = categories.map((c) => ({
      name: c.name,
      count: legends.filter((l: LegendItem) => l.category === c.id).length
    }));
    return map.filter((c) => c.count > 0);
  }, [categories, legends]);

  if (bank.error) {
    return (
      <div className="screen-center">
        <div className="notice-card is-error">
          <h2>图例数据没能加载</h2>
          <p>错误信息：{bank.error}</p>
          <p className="notice-sub">
            请确认 data/legends.json 与 assets/legends/ 随游戏包一起发布；
            网络或磁盘读取失败也会这样。
          </p>
          <div className="notice-actions">
            <button type="button" className="btn-primary" onClick={bank.retry}>重试</button>
          </div>
        </div>
      </div>
    );
  }

  if (!bank.data) {
    return (
      <div className="screen-center">
        <div className="notice-card">
          <h2>地图图例消消乐</h2>
          <p>正在加载图例库…</p>
        </div>
      </div>
    );
  }

  if (effectiveRoster.length === 0) {
    return (
      <div className="screen-center">
        <div className="notice-card">
          <h2>地图图例消消乐</h2>
          <p>正在等待平台下发学生名单…</p>
        </div>
      </div>
    );
  }

  if (stage === "gallery") {
    return (
      <Gallery
        legends={legends}
        categories={categories}
        onBack={() => setStage("lobby")}
      />
    );
  }

  if (stage === "dual") {
    return (
      <DualMatch legends={legends} roster={effectiveRoster} onBack={() => setStage("lobby")} />
    );
  }

  if (stage === "single") {
    return (
      <LegendMatch
        legends={legends}
        roster={effectiveRoster}
        onComplete={notifyComplete}
        onSessionEnd={notifySessionEnd}
        onBack={() => setStage("lobby")}
      />
    );
  }

  return (
    <div className="lobby">
      <header className="lobby-head">
        <h1>地图图例消消乐</h1>
        <p className="lobby-lead">
          牌面上散落着图例符号和它们的名称，把<em>符号</em>和<em>名称</em>配成一对就能消除；
          每消掉一对，这一对会在屏幕中央放大复现一次，看清楚它的样子再继续。
          共 {legends.length} 个初中地理常见图例，6 关逐关加量。
        </p>
        {standalone && (
          <p className="lobby-standalone">
            未收到平台的学生名单，当前为体验模式（以「体验学生」身份游戏）
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
          <strong>闯关进度</strong>
          <span>每关牌数递增，同类图例越来越多，越往后越容易看混</span>
        </div>
        <ol className="level-strip">
          {LEVEL_PAIRS.map((pairs, i) => (
            <li key={pairs}>
              <span className="level-strip-no">第 {i + 1} 关</span>
              <b>{pairs} 对</b>
              <em>{pairs * 2} 张卡</em>
            </li>
          ))}
        </ol>
        <p className="lobby-note">
          整局共 {totalPairs()} 对（{totalPairs() * 2} 张卡）；每关 3 次提示，配错扣 20 分并中断连击。
        </p>
      </section>

      <section className="lobby-cats">
        <strong>图例类别</strong>
        <div className="cat-chips">
          {byCategory.map((c) => (
            <span key={c.name} className="cat-chip">
              {c.name} <b>{c.count}</b>
            </span>
          ))}
        </div>
      </section>

      <section className="lobby-mode">
        <div className="lobby-level-title">
          <strong>选择模式</strong>
          <span>课堂大屏建议用双人 PK</span>
        </div>
        <div className="mode-cards">
          <button type="button" data-mode="single" onClick={() => setStage("single")}>
            <strong>单人闯关</strong>
            <span>逐个学生上台打完整 6 关，自动记分与排名</span>
          </button>
          <button type="button" data-mode="dual" onClick={() => setStage("dual")}>
            <strong>双人 PK</strong>
            <span>共享一副牌面轮流出手，配对成功继续出手、配错换人</span>
          </button>
          <button type="button" data-mode="gallery" onClick={() => setStage("gallery")}>
            <strong>图例图鉴</strong>
            <span>查看全部 {legends.length} 个图例，按 {byCategory.length} 个类别筛选</span>
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * 错误边界：任何一处渲染抛错都换成可读的错误卡片 + 重试按钮。
 * 没有它的话 React 会把整棵树卸载掉，学生在平台里看到的是一片空白。
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[legend-match] 页面渲染出错：", error, info);
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
