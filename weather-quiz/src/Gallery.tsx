import { useMemo, useState } from "react";
import Media from "./Media";
import type { ElementEntry, MediaKind } from "./types";

interface GalleryProps {
  elements: ElementEntry[];
  onBack: () => void;
}

/** 图鉴条目没有单独的 kind 字段，按 id 前缀与分类推出来即可，无需改数据。 */
function kindOf(el: ElementEntry): MediaKind {
  if (el.id.startsWith("photo_")) {
    return "photo";
  }
  if (el.category === "气候类型判读") {
    return "chart";
  }
  if (el.category === "天气符号" || el.category === "风向与风力") {
    return "symbol";
  }
  return "diagram";
}

/** 气象要素图鉴：按分类与等级筛选，点卡片看详细说明。 */
export default function Gallery({ elements, onBack }: GalleryProps) {
  const [level, setLevel] = useState<"all" | "junior" | "senior">("all");
  const [category, setCategory] = useState<string>("全部");
  const [active, setActive] = useState<ElementEntry | null>(null);

  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const el of elements) {
      if (!seen.includes(el.category)) {
        seen.push(el.category);
      }
    }
    return ["全部", ...seen];
  }, [elements]);

  const list = useMemo(
    () =>
      elements.filter(
        (el) =>
          (level === "all" || el.level === level) &&
          (category === "全部" || el.category === category)
      ),
    [elements, level, category]
  );

  return (
    <div className="gallery">
      <header className="gallery-head">
        <button type="button" className="control-btn" onClick={onBack}>
          ← 返回
        </button>
        <div>
          <h2>气象要素图鉴</h2>
          <p>
            共 {elements.length} 个要素 · 当前显示 {list.length} 个
          </p>
        </div>
      </header>

      <div className="gallery-filters">
        <div className="filter-row">
          <strong>等级</strong>
          {(["all", "junior", "senior"] as const).map((lv) => (
            <button
              key={lv}
              type="button"
              className={level === lv ? "is-active" : ""}
              onClick={() => setLevel(lv)}
            >
              {lv === "all" ? "全部" : lv === "junior" ? "初中" : "高中"}
            </button>
          ))}
        </div>
        <div className="filter-row filter-row-wrap">
          <strong>分类</strong>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={category === cat ? "is-active" : ""}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="gallery-grid">
        {list.map((el) => (
          <button
            key={el.id}
            type="button"
            className="gallery-card"
            onClick={() => setActive(el)}
          >
            <div className="gallery-thumb">
              <img src={el.image} alt={el.name} loading="lazy" draggable={false} />
            </div>
            <strong>{el.name}</strong>
            <small>{el.category}</small>
          </button>
        ))}
        {list.length === 0 && <p className="gallery-empty">该筛选条件下没有要素。</p>}
      </div>

      {active && (
        <div className="overlay-mask" onClick={() => setActive(null)}>
          <div className="gallery-detail" onClick={(event) => event.stopPropagation()}>
            <Media src={active.image} alt={active.name} kind={kindOf(active)} />
            <h3>{active.name}</h3>
            <p className="gallery-detail-meta">
              {active.category} · {active.level === "junior" ? "初中" : "高中"}
            </p>
            <p className="gallery-detail-text">{active.summary}</p>
            <button
              type="button"
              className="control-btn"
              onClick={() => setActive(null)}
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
