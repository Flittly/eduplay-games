/**
 * 洋流图鉴
 * ========
 *
 * 图鉴是"看得见的知识地图"：三层的视觉差异在这里也必须保持一致，
 * 否则学生在游戏里分得清、在图鉴里又分不清了。
 */

import { useMemo, useState } from "react";
import { CURRENTS, GYRES, QUALITY_RULES, type Current, type CurrentTier } from "./data";
import { qualityLabel, stars } from "./game";

interface Props {
  onBack: () => void;
}

const TIER_LABEL: Record<CurrentTier, string> = {
  core: "① 重点层",
  extension: "② 拓展层",
  reference: "③ 了解层"
};

const TIER_BLURB: Record<CurrentTier, string> = {
  core: "教材要求熟记：能认名称、能判性质、能判方向。",
  extension: "教材体系外但真实存在：认得名字即可，不判方向。",
  reference: "教材「洋流的影响」里点名的例子，只作理解，不考。"
};

export default function Gallery({ onBack }: Props) {
  const [tier, setTier] = useState<CurrentTier>("core");
  const [openId, setOpenId] = useState<string | null>(null);

  /**
   * ⚠️ reference 层的三条洋流**本体**已在 core 层（北大西洋暖流等），
   * 这里展示的是它们的"影响用法"，所以按名字去 core 里取数据。
   */
  const list = useMemo<Current[]>(() => CURRENTS.filter((c) => c.tier === tier), [tier]);

  const open = openId ? CURRENTS.find((c) => c.id === openId) ?? null : null;

  return (
    <div className="gallery">
      <header className="gallery-head">
        <button type="button" className="btn-ghost" onClick={onBack}>
          ← 返航
        </button>
        <h1>洋流图鉴</h1>
        <p className="gallery-lead">
          洋流清单分三层：教材熟记的要能认能判，其余真实洋流认得名字就行。
          加粗显示的是这一层的纳入标准。
        </p>
      </header>

      <nav className="tier-tabs">
        {(Object.keys(TIER_LABEL) as CurrentTier[]).map((t) => {
          const n = CURRENTS.filter((c) => c.tier === t).length;
          return (
            <button
              key={t}
              type="button"
              data-tier-tab={t}
              className={t === tier ? "is-active" : ""}
              aria-pressed={t === tier}
              onClick={() => {
                setTier(t);
                setOpenId(null);
              }}
            >
              <b>{TIER_LABEL[t]}</b>
              <span>{n} 条</span>
            </button>
          );
        })}
      </nav>

      <p className="tier-blurb" data-hud="tier-blurb">
        {TIER_BLURB[tier]}
        {tier === "extension" && (
          <em> —— 这些在界面上用虚线箭头 + 「拓展」角标标出，一眼可辨。</em>
        )}
      </p>

      <div className="gyre-blocks">
        {GYRES.filter((g) =>
          // 只显示与当前层级有交集的环流分组
          g.members.some((id) => CURRENTS.find((c) => c.id === id)?.tier === tier)
        ).map((g) => {
          const members = g.members
            .map((id) => CURRENTS.find((c) => c.id === id))
            .filter((c): c is Current => !!c && c.tier === tier);
          if (members.length === 0) return null;
          return (
            <section key={g.id} className="gyre-block" data-gyre-block={g.id}>
              <h2>
                {g.name}
                <em>{g.spin === "clockwise" ? "顺时针" : "逆时针"}</em>
              </h2>
              <p className="gyre-order">
                按流向顺序：
                {g.members
                  .map((id) => CURRENTS.find((c) => c.id === id)?.name)
                  .filter(Boolean)
                  .join(" → ")}
              </p>
              <div className="fish-cards">
                {members.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    data-current-card={c.id}
                    className={`fish-card is-${c.tier} ${openId === c.id ? "is-open" : ""}`}
                    onClick={() => setOpenId(openId === c.id ? null : c.id)}
                  >
                    <div className={`fish-card-dot is-${c.kind}`} aria-hidden="true" />
                    <strong>{c.name}</strong>
                    <span className="fish-card-stars">{stars(c.quality)}</span>
                    <em>{c.kind === "warm" ? "暖流" : "寒流"}</em>
                    {c.tier === "extension" && (
                      <span className="fish-card-ext">拓展</span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          );
        })}

        {/* 不属于任何环流分组的（拓展层的零散条目） */}
        {(() => {
          const inGyre = new Set(GYRES.flatMap((g) => g.members));
          const loose = list.filter((c) => !inGyre.has(c.id));
          if (loose.length === 0) return null;
          return (
            <section className="gyre-block">
              <h2>其他洋流<em>不成环流</em></h2>
              <div className="fish-cards">
                {loose.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    data-current-card={c.id}
                    className={`fish-card is-${c.tier} ${openId === c.id ? "is-open" : ""}`}
                    onClick={() => setOpenId(openId === c.id ? null : c.id)}
                  >
                    <div className={`fish-card-dot is-${c.kind}`} aria-hidden="true" />
                    <strong>{c.name}</strong>
                    <span className="fish-card-stars">{stars(c.quality)}</span>
                    <em>{c.kind === "warm" ? "暖流" : "寒流"}</em>
                    {c.tier === "extension" && (
                      <span className="fish-card-ext">拓展</span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          );
        })()}
      </div>

      {open && (
        <div className="gallery-detail" data-detail={open.id}>
          <h3>
            {open.name}
            <span className="detail-stars">{stars(open.quality)}</span>
            <span className={`detail-kind is-${open.kind}`}>
              {open.kind === "warm" ? "暖流" : "寒流"}
            </span>
            {open.tier === "extension" && (
              <span className="detail-ext">拓展 · 课标不考</span>
            )}
          </h3>
          <dl>
            <dt>流向</dt>
            <dd>{open.flowText}</dd>
            <dt>鱼群</dt>
            <dd>{open.fish.map((f) => f.name).join("、")}</dd>
            <dt>品质</dt>
            <dd>
              {qualityLabel(open.quality)}（{stars(open.quality)}）
            </dd>
            <dt>成因</dt>
            <dd>{open.reason}</dd>
            <dt>层级</dt>
            <dd>{open.note}</dd>
          </dl>
        </div>
      )}

      <section className="quality-rules">
        <h2>品质是怎么定出来的</h2>
        <p>
          高品质渔场只有三条真实地理依据，不是游戏编的：
        </p>
        <ul>
          <li>
            <b>上升补偿流</b>（{stars(QUALITY_RULES.upwelling)}）—— 离岸风把表层海水吹走，
            深层冷水上涌带来营养盐。典型是秘鲁寒流。
          </li>
          <li>
            <b>寒暖流交汇</b>（{stars(QUALITY_RULES.convergence)}）—— 冷暖水相遇使海水受扰动上泛，
            饵料丰富。如北海道渔场、纽芬兰渔场。
          </li>
          <li>
            <b>大陆架宽广</b>（{stars(QUALITY_RULES.shelf)}）—— 光照充足、饵料一般。
          </li>
          <li>
            <b>大洋环流中部</b>（{stars(QUALITY_RULES.gyre)}）—— 风力微弱、饵料极少。
          </li>
        </ul>
        <p className="quality-note">
          秘鲁寒流是<b>寒流</b>却渔获最高 —— 这是本节最反直觉的一点，
          关键在于「上升补偿流」而不是冷暖性质。
        </p>
      </section>
    </div>
  );
}
