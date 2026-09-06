import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import ProvinceQuiz from "./ProvinceQuiz";
import DualQuiz from "./DualQuiz";
import type {
  PlayerInfo,
  QuizResult,
  RoundRecord
} from "./ProvinceQuiz";
import "./styles.css";

const gameCode = "province_quiz";
const version = "0.2.0";

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
  const [mode, setMode] = useState<"pick" | "single" | "dual">("pick");

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
        <h1>省级行政区识别</h1>
        <p>正在等待平台下发学生名单…</p>
      </div>
    );
  }

  if (mode === "pick") {
    return (
      <div className="mode-picker">
        <h1>省级行政区识别</h1>
        <p>选择本局游戏模式</p>
        <div className="mode-cards">
          <button onClick={() => setMode("single")}>
            <strong>单人模式</strong>
            <span>个人完成全部题目</span>
          </button>
          <button onClick={() => setMode("dual")}>
            <strong>双人 PK</strong>
            <span>大屏抢答，看谁更快更准</span>
          </button>
        </div>
      </div>
    );
  }

  if (mode === "dual") {
    return <DualQuiz onBack={() => setMode("pick")} />;
  }

  return (
    <ProvinceQuiz
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
