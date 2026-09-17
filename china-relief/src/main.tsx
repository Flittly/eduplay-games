import { Component, useCallback, useEffect, useMemo, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import ChinaRelief from "./App";
import type { PlayerInfo, SessionResult } from "./App";
import "./styles.css";

const gameCode = "china_relief";
const version = "1.2.0";

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

function newRoundId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

interface InitPayload {
  roster?: unknown;
  studentId?: unknown;
  studentName?: unknown;
  className?: unknown;
  studentNo?: unknown;
}

function toPlayer(source: Record<string, unknown>): PlayerInfo | null {
  const idValue = source.studentId;
  const id =
    typeof idValue === "number" ? idValue : typeof idValue === "string" ? Number(idValue) : Number.NaN;
  if (!Number.isFinite(id)) {
    return null;
  }
  return {
    studentId: id,
    studentName: typeof source.studentName === "string" ? source.studentName : "",
    className: typeof source.className === "string" ? source.className : null,
    studentNo: typeof source.studentNo === "string" ? source.studentNo : undefined
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
  // 兼容只下发单个学生的旧版平台
  const single = toPlayer(payload as Record<string, unknown>);
  return single ? [single] : [];
}

/**
 * 平台没下发名单时（老师把游戏包直接丢进浏览器预览）用来把流程走通的虚拟学生。
 *
 * v1.1.0 起这个游戏是**积分型**（manifest `requiresRoster: true`），平台侧
 * 会先让老师选学生、选完才发 `GAME_INIT`。但"游戏包被单独打开"这条路
 * 仍然要能玩 —— 卡在"正在等待平台下发学生名单…"比少记一次分糟糕得多。
 *
 * ⚠ 学号必须**非负**，这里踩过一次很难查的坑：
 * `session.ts` 里 `currentId()` 用 `-1` 表示「当前没有答题人」
 * （名单为空时），而 `commitCorrect()` 的第一道闸门就是 `studentId < 0`。
 * 早先这个虚拟学生的 id 写的是 `-1`，于是体验模式下**每一次落位都被
 * 那道闸门静默丢掉**：提示条照弹「青藏高原 归位 · 体验学生 +20」、
 * 讲解卡照样弹出，但那块地永远没落位、分数永远是 0，卡在 0/38 出不去。
 * 界面上完全看不出是 id 的问题。
 *
 * 所以：**哨兵值（-1）和学生真实 id 不能撞车**，虚拟学生用一个
 * 一眼就知道不是真学号的显眼数字。
 */
const GUEST_ROSTER: PlayerInfo[] = [
  { studentId: 999999001, studentName: "体验学生", className: null }
];

function GameApp() {
  const [roster, setRoster] = useState<PlayerInfo[]>([]);
  const [standalone, setStandalone] = useState(false);

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
      if (!payload) {
        return;
      }
      const players = parseRoster(payload);
      if (players.length > 0) {
        setRoster(players);
        setStandalone(false);
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
  const byId = useMemo(
    () => new Map(effectiveRoster.map((p) => [p.studentId, p])),
    [effectiveRoster]
  );

  /**
   * 全部归位后把成绩单交给平台。
   *
   * 先**每人一条 `GAME_COMPLETE`**：平台的 `submitGameScore` 是按学生记的，
   * 而且要带 `roundId` 做幂等；接力的成绩是"每个人各自的分"，
   * 所以这里逐人上报，而不是把全班总分丢给一个人。
   * 再发一条 `GAME_SESSION_COMPLETE`：平台据此在页面上出成绩榜、
   * 并把界面切回"再选一批学生"。
   *
   * 体验模式下**一条都不发** —— 虚拟学生的学号不在平台的选择名单里，
   * 发了只会让平台弹一句「游戏返回的学生不在本次选择名单中」。
   */
  const handleFinish = useCallback(
    (results: SessionResult[]) => {
      if (standalone) {
        return;
      }
      for (const r of results) {
        const p = byId.get(r.studentId);
        postToPlatform({
          source: "eduplay-game",
          type: "GAME_COMPLETE",
          payload: {
            roundId: newRoundId(),
            studentId: r.studentId,
            studentName: r.studentName,
            className: p?.className ?? null,
            score: r.score,
            timeSeconds: r.timeSeconds,
            correctCount: r.correctCount,
            totalCount: r.totalCount
          }
        });
      }
      postToPlatform({
        source: "eduplay-game",
        type: "GAME_SESSION_COMPLETE",
        payload: {
          gameCode,
          version,
          results: results.map((r) => {
            const p = byId.get(r.studentId);
            return {
              studentId: r.studentId,
              studentName: r.studentName,
              className: p?.className ?? null,
              studentNo: p?.studentNo ?? null,
              score: r.score,
              timeSeconds: r.timeSeconds,
              correctCount: r.correctCount,
              totalCount: r.totalCount,
              mistakes: r.mistakes
            };
          })
        }
      });
    },
    [standalone, byId]
  );

  return (
    <ChinaRelief roster={effectiveRoster} standalone={standalone} onFinish={handleFinish} />
  );
}

/** 错误边界：渲染抛错时给一张可读的错误卡片，而不是让师生看到一片空白 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[china-relief] 页面渲染出错：", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="screen-center">
          <div className="notice-card is-error">
            <h2>页面出错了</h2>
            <p>{this.state.error.message || String(this.state.error)}</p>
            <p className="notice-sub">
              可以重新加载试试；若一直如此，请把这条错误信息反馈给开发者。
            </p>
            <div className="notice-actions">
              <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
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
