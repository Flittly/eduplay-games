import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import type { PlayerInfo } from "./types";
import "./styles.css";

const gameCode = "landform_quiz";
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

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<GameApp />);
}
