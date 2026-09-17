import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { CardLayout, CardSpec, LegendItem } from "./types";

interface CardBoardProps {
  /** 牌面顺序固定，位置由 layout 一一对应给出 */
  cards: CardSpec[];
  layout: CardLayout[];
  legendMap: Map<string, LegendItem>;
  cleared: Set<string>;
  selected: string | null;
  wrongPair: string[];
  hintPair: string[];
  onPick: (card: CardSpec) => void;
  disabled?: boolean;
  onResize: (w: number, h: number) => void;
  extraClass?: string;
}

/**
 * 牌面本体：一堆散落的卡片。
 *
 * 位置由 gameData.layoutCards 用"打乱的格子 + 格子内抖动"算好（可证明两两不重叠），
 * 这里只负责画。尺寸必须实测容器后才知道，所以由 ResizeObserver 上报给父组件，
 * 父组件据此重算布局 —— 窗口改变大小时牌面会重排，但已经消掉的卡不会复活。
 */
export default function CardBoard({
  cards, layout, legendMap, cleared, selected, wrongPair, hintPair,
  onPick, disabled, onResize, extraClass
}: CardBoardProps) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!el) {
      return;
    }
    const measure = () => onResize(el.clientWidth, el.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, onResize]);

  return (
    <div className={`card-board${extraClass ? " " + extraClass : ""}`} ref={setEl}>
      {cards.map((card, i) => {
        const pos = layout[i];
        const legend = legendMap.get(card.legendId);
        if (!pos || !legend) {
          return null;
        }
        const isCleared = cleared.has(card.uid);
        const cls = [
          "lcard",
          "is-" + card.face,
          selected === card.uid ? "is-selected" : "",
          isCleared ? "is-cleared" : "",
          wrongPair.includes(card.uid) ? "is-wrong" : "",
          hintPair.includes(card.uid) ? "is-hinted" : ""
        ].filter(Boolean).join(" ");

        return (
          <button
            key={card.uid}
            type="button"
            className={cls}
            data-uid={card.uid}
            data-legend={card.legendId}
            data-face={card.face}
            data-cleared={isCleared ? "1" : "0"}
            aria-label={
              card.face === "symbol"
                ? `图例符号：${legend.name}`
                : `图例名称：${legend.name}`
            }
            draggable={false}
            disabled={disabled}
            onClick={() => onPick(card)}
            style={{
              left: pos.x,
              top: pos.y,
              width: pos.w,
              height: pos.h,
              // 旋转角走 CSS 变量，这样 hover / 选中态还能在 transform 上叠加位移
              "--rot": `${pos.rot.toFixed(2)}deg`
            } as CSSProperties}
          >
            {card.face === "symbol" ? (
              <img src={legend.image} alt="" draggable={false} />
            ) : (
              <span className="lcard-name">{legend.short}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
