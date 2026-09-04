import { createRoot } from "react-dom/client";
import ProvincePuzzle from "./ProvincePuzzle";
import type { PuzzleResult } from "./ProvincePuzzle";
import "./styles.css";

const gameCode = "province_puzzle";
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

function notifyComplete(result: PuzzleResult) {
  const roundId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  postToPlatform({
    source: "eduplay-game",
    type: "GAME_COMPLETE",
    payload: {
      roundId,
      score: result.score,
      correctCount: result.correctCount,
      totalCount: result.totalCount
    }
  });
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (
    !message ||
    typeof message !== "object" ||
    message.source !== "eduplay-platform" ||
    message.type !== "GAME_INIT"
  ) {
    return;
  }
  // 这里可以接收平台传入的班级、学生等信息，为后续更复杂的游戏做准备。
});

notifyReady();

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <ProvincePuzzle onComplete={notifyComplete} />
  );
}
