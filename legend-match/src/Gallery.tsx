import { useMemo, useState } from "react";
import type { LegendItem } from "./types";

interface GalleryProps {
  legends: LegendItem[];
  categories: { id: string; name: string }[];
  onBack: () => void;
}

/** 图例图鉴：按类别筛选，点卡片看放大符号与说明。 */
export default function Gallery({ legends, categories, onBack }: GalleryProps) {
  const [category, setCategory] = useState<string>("all");
  const [active, setActive] = useState<LegendItem | null>(null);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of legends) {
      map[l.category] = (map[l.category] ?? 0) + 1;
    }
    return map;
  }, [legends]);

  const list = useMemo(
    () => legends.filter((l) => category === "all" || l.category === category),
    [legends, category]
  );

  return (
    <div className="gallery">
      <header className="gallery-head">
        <button type="button" className="control-btn" onClick={onBack}>← 返回</button>
        <div>
          <h2>地图图例图鉴</h2>
          <p data-hud="gallery-count">
            共 {legends.length} 个图例 · 当前显示 {list.length} 个
          </p>
        </div>
      </header>

      <div className="gallery-filters">
        <div className="filter-row filter-row-wrap">
          <strong>类别</strong>
          <button
            type="button"
            className={category === "all" ? "is-active" : ""}
            onClick={() => setCategory("all")}
          >
            全部（{legends.length}）
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              data-cat={c.id}
              className={category === c.id ? "is-active" : ""}
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
            onClick={() => setActive(item)}
          >
            <div className="gallery-thumb">
              <img src={item.image} alt={item.name} loading="lazy" draggable={false} />
            </div>
            <strong>{item.short}</strong>
            <small>{item.categoryName}</small>
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
            <p className="gallery-detail-meta">{active.categoryName}</p>
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
