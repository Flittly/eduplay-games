import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import GeoGomoku from "./GeoGomoku";
import type {
  MatchResult,
  PlayerInfo,
  RoundRecord
} from "./GeoGomoku";
import "./styles.css";

const gameCode = "geo_gomoku";
const version = "0.1.3";

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

function notifyComplete(player: PlayerInfo, result: MatchResult) {
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

  // 兼容旧版平台：只下发单个学生。
  const single = toPlayer(payload as Record<string, unknown>);
  return single ? [single] : [];
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

  if (roster.length === 0) {
    return (
      <div className="init-card">
        <h1>经纬度五子棋</h1>
        <p>正在等待平台下发学生名单…</p>
      </div>
    );
  }

  return (
    <GeoGomoku
      roster={roster}
      onComplete={notifyComplete}
      onSessionEnd={notifySessionEnd}
    />
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<GameApp />);
}
