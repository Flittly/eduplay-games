/**
 * 平台入口
 * ========
 *
 * 与平台的协议（照 legend-match / 其它游戏的既有做法，别自创）：
 *   ← GAME_INIT           平台下发 roster / 学生信息
 *   → GAME_READY          游戏就绪
 *   → GAME_COMPLETE       一名学生一局结束
 *   → GAME_SESSION_COMPLETE  全班打完，汇总
 *
 * ⚠️ `requiresRoster` 在 manifest 里写的是 true —— 源码里必须有
 *    `roster.length === 0` 的渲染闸门，否则守门脚本会报不一致。
 */

import { Component, useEffect, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import FishMaster from "./FishMaster";
import Gallery from "./Gallery";
import ResultBoard from "./ResultBoard";
import CurrentMap from "./CurrentMap";
import { DEFAULT_STAGE, STAGES, type Stage } from "./data";
import type { PlayerInfo, RunResult } from "./types";
import { loadKey, saveKey } from "./imageryKey";
import { TIANDITU_KEY_PAGE } from "./basemap";
import "./styles.css";

const gameCode = "fish_master";
const version = "0.1.0";

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

function notifyComplete(player: PlayerInfo, result: RunResult) {
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
      correctCount: result.matchedCount,
      totalCount: result.totalCount
    }
  });
}

interface SessionRecord {
  player: PlayerInfo;
  result: RunResult;
  mistakes: number;
}

function notifySessionEnd(records: SessionRecord[]) {
  postToPlatform({
    source: "eduplay-game",
    type: "GAME_SESSION_COMPLETE",
    payload: {
      gameCode,
      version,
      results: records.map((r) => ({
        studentId: r.player.studentId,
        studentName: r.player.studentName,
        className: r.player.className,
        studentNo: r.player.studentNo ?? null,
        score: r.result.score,
        timeSeconds: r.result.timeSeconds,
        correctCount: r.result.matchedCount,
        totalCount: r.result.totalCount,
        mistakes: r.mistakes
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
  idKey = "studentId",
  nameKey = "studentName"
): PlayerInfo | null {
  const idValue = source[idKey];
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
  if (Array.isArray(payload.roster)) {
    const players: PlayerInfo[] = [];
    for (const item of payload.roster) {
      if (!item || typeof item !== "object") continue;
      const p = toPlayer(item as Record<string, unknown>);
      if (p && !players.some((x) => x.studentId === p.studentId)) players.push(p);
    }
    return players;
  }
  const single = toPlayer(payload as Record<string, unknown>);
  return single ? [single] : [];
}

/** 平台没下发名单时（老师直接把包丢浏览器里）用的体验学生。 */
const GUEST_ROSTER: PlayerInfo[] = [
  { studentId: -1, studentName: "体验学生", className: null }
];

type Screen = "lobby" | "play" | "gallery" | "board";

function GameApp() {
  const [roster, setRoster] = useState<PlayerInfo[]>([]);
  const [standalone, setStandalone] = useState(false);
  const [screen, setScreen] = useState<Screen>("lobby");
  const [stage, setStage] = useState<Stage>(DEFAULT_STAGE);
  const [records, setRecords] = useState<SessionRecord[]>([]);
  /** 天地图密钥（影像底图用）。空串 = 用内置矢量底图。 */
  const [tk, setTk] = useState<string>(() => loadKey());
  /** 底图设置面板是否展开 */
  const [showMapCfg, setShowMapCfg] = useState(false);

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
        const players = parseRoster(payload);
        if (players.length > 0) {
          setRoster(players);
          setStandalone(false);
        }
      }
    }
    window.addEventListener("message", onMessage);
    notifyReady();
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (roster.length > 0 || standalone) return;
    const timer = window.setTimeout(() => setStandalone(true), 1400);
    return () => window.clearTimeout(timer);
  }, [roster.length, standalone]);

  const effectiveRoster = roster.length > 0 ? roster : standalone ? GUEST_ROSTER : [];

  // 平台名单还没到：给出明确提示，不静默空白
  if (effectiveRoster.length === 0) {
    return (
      <div className="screen-center">
        <div className="notice-card">
          <h2>捕鱼达人 · 洋流版</h2>
          <p>正在等待平台下发学生名单…</p>
        </div>
      </div>
    );
  }

  if (screen === "gallery") {
    return <Gallery onBack={() => setScreen("lobby")} />;
  }

  if (screen === "board") {
    return <ResultBoard records={records} onBack={() => setScreen("lobby")} />;
  }

  if (screen === "play") {
    return (
      <FishMaster
        key={stage}
        roster={effectiveRoster}
        stage={stage}
        tiandituKey={tk}
        onComplete={notifyComplete}
        onSessionEnd={(recs) => {
          setRecords(recs);
          notifySessionEnd(recs);
          setScreen("board");
        }}
        onBack={() => setScreen("lobby")}
      />
    );
  }

  const cfg = STAGES[stage];

  return (
    <div className="lobby">
      <header className="lobby-head">
        <h1>捕鱼达人 · 洋流版</h1>
        <p className="lobby-lead">
          船在大洋上航行，你选一处海域下网。下网之后要过两关——
          先答对<em>这条洋流叫什么</em>，再判对<em>它往哪个方向流</em>，两关都过才能起网。
          洋流的性质与位置，决定了这一网能捕到什么鱼。
        </p>
        {standalone && (
          <p className="lobby-standalone">
            未收到平台的学生名单，当前为体验模式（以「体验学生」身份游戏）
          </p>
        )}
        <div className="lobby-roster">
          <strong>本次参与学生（{effectiveRoster.length} 人）</strong>
          <ul>
            {effectiveRoster.map((p) => (
              <li key={p.studentId}>{p.studentName}</li>
            ))}
          </ul>
        </div>
      </header>

      {/* ---------- 底图设置（真实地球影像） ---------- */}
      <section className="lobby-mapcfg" data-section="map">
        <div className="lobby-level-title">
          <strong>底图</strong>
          <span>
            默认用真实海岸线；填入天地图密钥后，换成真实卫星影像
          </span>
          <button
            type="button"
            className="btn-ghost is-small"
            data-hud="map-toggle"
            onClick={() => setShowMapCfg((v) => !v)}
          >
            {showMapCfg ? "收起" : "设置"}
          </button>
        </div>

        <div className="map-cfg-body">
          <div className="map-cfg-text">
            <div className="map-cfg-row">
              <span className={tk ? "map-badge is-on" : "map-badge"} data-hud="map-state">
                {tk ? "影像底图已启用" : "当前：内置海岸线底图（离线可用）"}
              </span>
              <a className="map-cfg-link" href={TIANDITU_KEY_PAGE} target="_blank" rel="noreferrer">
                去天地图免费申请密钥 ↗
              </a>
            </div>

            {showMapCfg && (
              <div className="map-cfg-panel">
                <p className="map-cfg-note">
                  影像来自「国家地理信息公共服务平台（天地图）」，是可以进课堂的官方图源。
                  密钥<strong>只保存在本机浏览器</strong>，不随游戏包分发、不上传服务器。
                  没填或没网时自动用内置海岸线，玩法不受影响。
                </p>
                <label className="map-cfg-field">
                  天地图密钥（tk）
                  <input
                    type="text"
                    spellCheck={false}
                    data-hud="tk-input"
                    placeholder="粘贴 32 位密钥，留空则用内置底图"
                    value={tk}
                    onChange={(e) => {
                      setTk(e.target.value);
                      saveKey(e.target.value);
                    }}
                  />
                </label>
              </div>
            )}
          </div>

          {/* 底图预览：让老师在开局前就看到底图长什么样 */}
          <div className="map-preview" data-hud="map-preview">
            <CurrentMap
              tiers={["core"]}
              tiandituKey={tk}
              interactive={false}
              showNames={false}
            />
          </div>
        </div>
      </section>

      <section className="lobby-tier" data-section="stage">
        <div className="lobby-level-title">
          <strong>① 选择学段</strong>
          <span>决定这一局用哪些层级的洋流、怎么判方向；进游戏后不再切换</span>
        </div>
        <div className="mode-cards is-tier">
          {(Object.keys(STAGES) as Stage[]).map((id) => {
            const c = STAGES[id];
            const on = id === stage;
            return (
              <button
                key={id}
                type="button"
                data-stage-pick={id}
                className={on ? "is-active" : ""}
                aria-pressed={on}
                onClick={() => setStage(id)}
              >
                <strong>{c.name}</strong>
                <span data-hud={`stage-${id}`}>
                  {c.tiers.includes("extension") ? "重点层 + 拓展层" : "仅重点层"} ·{" "}
                  {c.casts} 次下网
                </span>
                <em>{c.blurb}</em>
                <em className="tier-note">{c.note}</em>
              </button>
            );
          })}
        </div>
        <p className="lobby-note" data-hud="stage-summary">
          当前是 <b>{cfg.name}</b>：每问 {cfg.timeLimit} 秒、共 {cfg.casts} 次下网、
          {cfg.showQuality ? "显示" : "隐藏"}星级；
          第二问用{cfg.directionUI === "two-choice" ? "二选一" : "在图上画箭头"}。
        </p>
      </section>

      <section className="lobby-level">
        <div className="lobby-level-title">
          <strong>② 这一局要认什么</strong>
          <span>教材熟记的洋流要能认能判，其余真实洋流认得名字就行</span>
        </div>
        <div className="tier-explain">
          <div className="tier-item is-core">
            <b>① 重点层</b>
            <span>
              教材四个闭合环流的 16 条（含季风洋流）。要认名称、判方向，
              解释卡会详细讲渔场成因。
            </span>
          </div>
          <div className="tier-item is-extension">
            <b>② 拓展层</b>
            <span>
              图上标了箭头、但课标没要求熟记的真实洋流。
              <em>只认名称，不判方向</em>，界面上有「拓展」角标。
            </span>
          </div>
          <div className="tier-item is-reference">
            <b>③ 了解层</b>
            <span>
              教材讲「洋流对地理环境的影响」时点名的例子（如北大西洋暖流致不冻港）。
              只在解释卡里出现，不考。
            </span>
          </div>
        </div>
      </section>

      <section className="lobby-mode">
        <div className="lobby-level-title">
          <strong>③ 选择玩法</strong>
          <span>课堂大屏建议先看环流图鉴讲一遍，再开局</span>
        </div>
        <div className="mode-cards">
          <button type="button" data-mode="play" onClick={() => setScreen("play")}>
            <strong>出海捕鱼</strong>
            <span>
              逐个学生上台打一局（{cfg.name}），自动记分与排名
            </span>
          </button>
          <button type="button" data-mode="gallery" onClick={() => setScreen("gallery")}>
            <strong>洋流图鉴</strong>
            <span>按层级和环流查阅全部洋流，含鱼群与成因</span>
          </button>
          {records.length > 0 && (
            <button type="button" data-mode="board" onClick={() => setScreen("board")}>
              <strong>看战绩</strong>
              <span>查看上一局全班成绩与最常认错的洋流对</span>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

/** 错误边界：任何一处渲染抛错都换成可读卡片，别让学生看到白屏。 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[fish-master] 页面渲染出错：", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="screen-center">
          <div className="notice-card is-error">
            <h2>页面出错了</h2>
            <p>{this.state.error.message || String(this.state.error)}</p>
            <p className="notice-sub">
              可以重新加载试试；如果一直这样，请把上面这行信息反馈给老师。
            </p>
            <div className="notice-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={() => window.location.reload()}
              >
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
