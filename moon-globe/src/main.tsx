import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import MoonGlobe from "./MoonGlobe";
import type { PlayerInfo } from "./MoonGlobe";
import "./styles.css";

const gameCode = "moon_globe";
const version = "1.4.6";

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

function toPlayer(source: Record<string, unknown>): PlayerInfo | null {
  const idValue = source.studentId;
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
    studentName: typeof source.studentName === "string" ? (source.studentName as string) : "",
    className: typeof source.className === "string" ? (source.className as string) : null,
    studentNo: typeof source.studentNo === "string" ? (source.studentNo as string) : undefined
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
      const message = event.data as
        | { source?: string; type?: string; payload?: InitPayload }
        | undefined;
      if (
        !message ||
        typeof message !== "object" ||
        message.source !== "eduplay-platform" ||
        message.type !== "GAME_INIT"
      ) {
        return;
      }
      if (message.payload) {
        setRoster(parseRoster(message.payload));
      }
    }

    window.addEventListener("message", onMessage);
    notifyReady();
    return () => window.removeEventListener("message", onMessage);
  }, []);

  /**
   * 寰宇月球是课堂演示型应用（`requiresRoster: false`）：打开即可教学，
   * 不等平台下发名单；名单只在有学生时作为「观摩学生」显示在右栏。
   */
  return <MoonGlobe roster={roster} />;
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<GameApp />);
}
