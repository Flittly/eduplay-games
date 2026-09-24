import { Component, useEffect, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import MountainZones from "./MountainZones";
import type { PlayerInfo } from "./MountainZones";
import "./styles.css";

const gameCode = "mountain_zones";
const version = "2.4.4";

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
      const player = toPlayer(
        item as Record<string, unknown>,
        "studentId",
        "studentName"
      );
      if (player && !players.some((p) => p.studentId === player.studentId)) {
        players.push(player);
      }
    }
    return players;
  }
  return [];
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

  // 本游戏是课堂演示型沙盘（manifest 里 requiresRoster=false）：
  // 不等待名单，打开即可教学；名单只用来在面板底部显示"本次课堂 N 人"。
  return <MountainZones roster={roster} />;
}

/**
 * 错误边界：渲染抛错时换成可读的错误卡片，而不是让学生在平台里看到一片空白。
 * 这一版回到 WebGL（three.js + 真实 DEM 三维地形），所以显卡驱动异常、
 * WebGL 上下文丢失这类问题会走到这里；三维视图内部还有一层 try/catch，
 * 会把具体原因直接显示在画布位置上。
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[mountain-zones] 页面渲染出错：", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="screen-center">
          <div className="notice-card is-error">
            <h2>页面出错了</h2>
            <p>{this.state.error.message || String(this.state.error)}</p>
            <p className="notice-sub">可以重新加载试试；若一直如此，请把这条错误信息反馈给开发者。</p>
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
