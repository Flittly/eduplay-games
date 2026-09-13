import { Component, useEffect, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import type { PlayerInfo } from "./types";
import "./styles.css";

const gameCode = "landform_quiz";
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

interface InitPayload {
  roster?: unknown;
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
  if (!Number.isFinite(id)) return null;
  return {
    studentId: id,
    studentName: typeof source[nameKey] === "string" ? (source[nameKey] as string) : "",
    className: typeof source.className === "string" ? (source.className as string) : null,
    studentNo: typeof source.studentNo === "string" ? (source.studentNo as string) : undefined
  };
}

function parseRoster(payload: InitPayload): PlayerInfo[] {
  if (!Array.isArray(payload.roster)) return [];
  const players: PlayerInfo[] = [];
  for (const item of payload.roster) {
    if (!item || typeof item !== "object") continue;
    const player = toPlayer(item as Record<string, unknown>);
    if (player && !players.some((p) => p.studentId === player.studentId)) {
      players.push(player);
    }
  }
  return players;
}

function GameApp() {
  const [roster, setRoster] = useState<PlayerInfo[]>([]);

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
      if (payload) setRoster(parseRoster(payload));
    }

    window.addEventListener("message", onMessage);
    notifyReady();
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // 这是自助型测试：不等待名单，打开即可作答。
  return <App roster={roster} />;
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
    console.error("[landform-quiz] 页面渲染出错：", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="lq-app lq-center">
          <div className="card card--warn">
            <h2>页面出错了</h2>
            <p>{this.state.error.message || String(this.state.error)}</p>
            <p className="muted">
              可以重新加载试试；如果一直这样，请把上面这行信息反馈给老师。
            </p>
            <p>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => window.location.reload()}
              >
                重新加载
              </button>
            </p>
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
