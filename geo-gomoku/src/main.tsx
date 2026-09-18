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
const version = "1.2.0";

/**
 * 平台没下发名单时的本地试玩学生。
 * 用负数 id 与真实学生区分开，且试玩状态下不上报成绩（见 GameApp）。
 */
const GUEST_ROSTER: PlayerInfo[] = [
  { studentId: -1, studentName: "试玩学生甲", className: null },
  { studentId: -2, studentName: "试玩学生乙", className: null }
];

/** 等名单超过这个时长就给出"试玩"出口，免得界面变成死路。 */
const ROSTER_WAIT_HINT_MS = 2500;

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
  const [trial, setTrial] = useState(false);
  const [showTrialOffer, setShowTrialOffer] = useState(false);

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

  // 平台迟迟不下发名单时给个出口。这里不做静默兜底，
  // 因为老师需要知道"成绩没计入"，而不是莫名其妙在跟"试玩学生甲"下棋。
  useEffect(() => {
    if (roster.length > 0 || trial) {
      return;
    }
    const timer = window.setTimeout(
      () => setShowTrialOffer(true),
      ROSTER_WAIT_HINT_MS
    );
    return () => window.clearTimeout(timer);
  }, [roster.length, trial]);

  // 判定顺序：真实名单 > 本地试玩 > 空。
  // 这样即使平台在学生已经试玩之后才把名单送到，真实名单也会立刻接管。
  const effectiveRoster =
    roster.length > 0 ? roster : trial ? GUEST_ROSTER : [];

  if (effectiveRoster.length === 0) {
    return (
      <div className="init-card">
        <h1>经纬度五子棋</h1>
        <p>正在等待平台下发学生名单…</p>
        {showTrialOffer && (
          <>
            <p className="init-hint">
              平台一直没有下发学生名单。常见原因是上一页没有勾选学生，
              返回上一页重新选择即可；也可以先用试玩学生练一局，
              <strong>试玩成绩不会计入积分榜</strong>。
            </p>
            <button
              type="button"
              className="init-trial-button"
              onClick={() => setTrial(true)}
            >
              先用试玩学生练一局
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <GeoGomoku
      roster={effectiveRoster}
      // 试玩时不上报成绩：上报会带着负数 id 打到平台上，只会换来一条无法结算的报错。
      onComplete={trial ? () => {} : notifyComplete}
      onSessionEnd={trial ? () => {} : notifySessionEnd}
    />
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<GameApp />);
}
