/**
 * 战绩页
 * ======
 *
 * 两个教学抓手（这是本作相对"答题+图鉴"型游戏真正多出来的东西）：
 *   1. **环流集齐度** —— 学生看到"就差一条"，会想去补上（而不是只盯分数排名）；
 *   2. **容易被认错的洋流对** —— 老师能直接拿去讲，这是全班口径的备课抓手。
 *
 * ⚠️ 措辞纪律：本页只说「容易被认错的洋流对」（来自教材图上确实易混的组合），
 *    不谎称「全班最容易混的一对」——因为局内的错题统计只记"这条被答错"，
 *    没有留存"和哪个选项混了"。
 */

import { CONFUSABLE_PAIRS, GYRES, WIN_GYRES, currentById } from "./data";
import type { PlayerInfo } from "./types";
import type { RunResult } from "./types";

interface Record {
  player: PlayerInfo;
  result: RunResult;
  mistakes: number;
}

interface Props {
  records: Record[];
  onBack: () => void;
}

export default function ResultBoard({ records, onBack }: Props) {
  const ranked = records.slice().sort((a, b) => b.result.score - a.result.score);
  const best = ranked[0];
  const winners = records.filter((r) => r.result.win);

  return (
    <div className="board">
      <header className="board-head">
        <button type="button" className="btn-ghost" onClick={onBack}>
          ← 返航
        </button>
        <h1>本局战绩</h1>
        <p className="board-lead">
          排名看的是<em>认对了多少条洋流</em>，而不只是捕了多少鱼 ——
          认不出来的海域，鱼再多也下不了网。
        </p>
      </header>

      <table className="board-table">
        <thead>
          <tr>
            <th>名次</th>
            <th>学生</th>
            <th>渔获</th>
            <th>已认洋流</th>
            <th>集齐环流</th>
            <th>通关</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((r, i) => (
            <tr key={r.player.studentId} data-row={r.player.studentId}>
              <td className="board-rank">{i + 1}</td>
              <td>{r.player.studentName}</td>
              <td className="board-score">{r.result.score}</td>
              <td>
                {r.result.matchedCount} / {r.result.totalCount}
              </td>
              <td>
                {r.result.completedGyres ?? 0} / {WIN_GYRES.length}
              </td>
              <td>{r.result.win ? "✓" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {best && (
        <p className="board-best">
          本局最高渔获：<b>{best.player.studentName}</b>（{best.result.score} 分）
          {typeof best.result.maxCombo === "number" && best.result.maxCombo >= 2 && (
            <>　最高连击 ×{best.result.maxCombo}</>
          )}
        </p>
      )}

      {winners.length > 0 && (
        <p className="board-winners" data-hud="winners">
          🏆 集齐四大环流通关：{winners.map((w) => w.player.studentName).join("、")}
        </p>
      )}

      <section className="board-gyres">
        <h2>通关要求：集齐四大环流</h2>
        <p className="board-gyres-lead">
          每个环流要按流向顺序把成员全认出来。拓展层洋流<b>不计入</b>通关 ——
          认得名字就行。
        </p>
        <div className="gyre-progress">
          {GYRES.filter((g) => WIN_GYRES.includes(g.id as never)).map((g) => (
            <div key={g.id} className="gyre-progress-item" data-gyre-item={g.id}>
              <b>
                {g.name}
                <em>{g.spin === "clockwise" ? "顺时针" : "逆时针"}</em>
              </b>
              <p>
                {g.members
                  .map((id) => currentById(id)?.name)
                  .filter(Boolean)
                  .join(" → ")}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="board-confusions">
        <h2>容易被认错的洋流对</h2>
        <p className="board-confusions-lead">
          下面这些组合在图 4-24 上确实容易看混 —— 老师可以直接拿去讲：
        </p>
        <ul>
          {CONFUSABLE_PAIRS.map((p) => (
            <li key={`${p.a}-${p.b}`} data-confusable={`${p.a}-${p.b}`}>
              <b>
                {currentById(p.a)?.name} ↔ {currentById(p.b)?.name}
              </b>
              <span>{p.why}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
