import { useMemo, useState } from "react";
import { modeConfig } from "./gameData";
import type { GameMode, LegendItem } from "./types";

/**
 * 图鉴的范围档位。
 *
 * 为什么不只做"全部"：老师上课时的两种用法差别很大 ——
 * 备课时想看全 73 条（`all`），课堂上跟着课文只想给学生看必会的那 54 条（`basic`），
 * 复习拔高时又只想点出那 19 条进阶条目（`advanced`）。
 * 「全部」和「初中必备」重叠，但这三档才是老师真实会点的三下。
 */
type Scope = "all" | "basic" | "advanced";

const SCOPE_ORDER: Scope[] = ["all", "basic", "advanced"];
const SCOPE_LABEL: Record<Scope, string> = {
  all: "全部",
  basic: "初中必备",
  advanced: "进阶条目"
};

interface GalleryProps {
  /** 全量图例（73 条）：图鉴要能跨组查阅，所以这里收的是全量而不是当前组别那份。 */
  allLegends: LegendItem[];
  categories: { id: string; name: string }[];
  /** 当前组别：只用来决定"一进来默认看哪档"。 */
  mode: GameMode;
  onBack: () => void;
}

/** 图例图鉴：先按范围档位（全部/初中必备/进阶）收窄，再按类别筛选，点卡片看放大符号与说明。 */
export default function Gallery({ allLegends, categories, mode, onBack }: GalleryProps) {
  const [scope, setScope] = useState<Scope>(mode === "junior" ? "basic" : "all");
  const [category, setCategory] = useState<string>("all");
  const [active, setActive] = useState<LegendItem | null>(null);

  const scoped = useMemo(
    () =>
      allLegends.filter((l) =>
        scope === "all" ? true : scope === "basic" ? l.tier === "basic" : l.tier === "advanced"
      ),
    [allLegends, scope]
  );

  /** 只列出**当前范围内真有图例**的类别 —— 否则会给出点进去空白的类别按钮。 */
  const cats = useMemo(
    () => categories.filter((c) => scoped.some((l) => l.category === c.id)),
    [categories, scoped]
  );

  /**
   * 当前生效的类别。用"派生"而不是"改档时把 category 重置"：
   * 换档位后原来选中的类可能已经不存在了（比如进阶档里没有"资源与能源"），
   * 派生一个兜底值就不需要 effect 去同步 state，也不会出现"一格空的图鉴"。
   */
  const activeCat = cats.some((c) => c.id === category) ? category : "all";

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of scoped) {
      map[l.category] = (map[l.category] ?? 0) + 1;
    }
    return map;
  }, [scoped]);

  const list = useMemo(
    () => scoped.filter((l) => activeCat === "all" || l.category === activeCat),
    [scoped, activeCat]
  );

  return (
    <div className="gallery">
      <header className="gallery-head">
        <button type="button" className="control-btn" onClick={onBack}>← 返回</button>
        <div>
          <h2>地图图例图鉴</h2>
          <p data-hud="gallery-count">
            {SCOPE_LABEL[scope]} {scoped.length} 个图例（全库 {allLegends.length} 个）·
            当前显示 {list.length} 个 · 本次课堂用{modeConfig(mode).name}
          </p>
        </div>
      </header>

      <div className="gallery-filters">
        <div className="filter-row filter-row-wrap">
          <strong>范围</strong>
          {SCOPE_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              data-scope={s}
              className={scope === s ? "is-active" : ""}
              onClick={() => setScope(s)}
            >
              {SCOPE_LABEL[s]}（
              {s === "all"
                ? allLegends.length
                : allLegends.filter((l) => l.tier === s).length}
              ）
            </button>
          ))}
        </div>
        <div className="filter-row filter-row-wrap">
          <strong>类别</strong>
          <button
            type="button"
            className={activeCat === "all" ? "is-active" : ""}
            onClick={() => setCategory("all")}
          >
            全部（{scoped.length}）
          </button>
          {cats.map((c) => (
            <button
              key={c.id}
              type="button"
              data-cat={c.id}
              className={activeCat === c.id ? "is-active" : ""}
              onClick={() => setCategory(c.id)}
            >
              {c.name}（{counts[c.id] ?? 0}）
            </button>
          ))}
        </div>
      </div>

      <div className="gallery-grid">
        {list.map((item) => (
          <button
            key={item.id}
            type="button"
            className="gallery-card"
            data-legend={item.id}
            data-tier={item.tier}
            onClick={() => setActive(item)}
          >
            <div className="gallery-thumb">
              <img src={item.image} alt={item.name} loading="lazy" draggable={false} />
            </div>
            <strong>{item.short}</strong>
            <small>{item.categoryName}</small>
            {item.tier === "advanced" ? (
              <em className="gallery-tier-tag" data-hud={`tier-${item.id}`}>进阶</em>
            ) : null}
          </button>
        ))}
        {list.length === 0 && <p className="gallery-empty">该类别下暂时没有图例。</p>}
      </div>

      {active && (
        <div className="overlay-mask" onClick={() => setActive(null)}>
          <div className="gallery-detail" onClick={(e) => e.stopPropagation()}>
            <div className="gallery-detail-symbol">
              <img src={active.image} alt={active.name} draggable={false} />
            </div>
            <h3>{active.name}</h3>
            <p className="gallery-detail-meta">
              {active.categoryName} ·{" "}
              {active.tier === "basic" ? "初中必备" : "进阶条目"}
            </p>
            <p className="gallery-detail-text">{active.summary}</p>
            <button type="button" className="control-btn" onClick={() => setActive(null)}>
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
