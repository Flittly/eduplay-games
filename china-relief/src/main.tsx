import { Component, useEffect, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import ChinaRelief from "./App";
import type { PlayerInfo } from "./App";
import "./styles.css";

const gameCode = "china_relief";
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

interface InitPayload {
  roster?: unknown;
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
  if (!Array.isArray(payload.roster)) {
    return [];
  }
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
      if (payload) {
        setRoster(parseRoster(payload));
      }
    }
    window.addEventListener("message", onMessage);
    notifyReady();
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // 这个游戏是单人塑形练习（manifest 里 requiresRoster=false）：
  // **不等待名单**，打开即可玩；名单只用来在页脚显示"本次课堂 N 人"。
  // 平台不下发名单也不会变成死路 —— 这是踩过坑的地方。
  return <ChinaRelief roster={roster} />;
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
