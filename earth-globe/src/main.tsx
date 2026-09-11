import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import EarthGlobe from "./EarthGlobe";
import type { PlayerInfo } from "./EarthGlobe";
import "./styles.css";

const gameCode = "earth_globe";
const version = "1.3.2";

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
      typeof source[nameKey] === "string"
        ? (source[nameKey] as string)
        : "",
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

  // 地球仪是课堂演示型应用：不等待名单，打开即可教学。
  return <EarthGlobe roster={roster} />;
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<GameApp />);
}
