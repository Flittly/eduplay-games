import { useEffect, useState } from "react";
import type { MediaKind } from "./types";

interface MediaProps {
  src: string;
  alt: string;
  kind: MediaKind;
}

const KIND_CLASS: Record<MediaKind, string> = {
  symbol: "is-symbol",
  chart: "is-chart",
  diagram: "is-diagram",
  photo: "is-photo"
};

/**
 * 配图。图挂了不能静默空白 —— 显示一行说明，学生和老师都能看出"图没加载出来"。
 * 图标类（天气符号）是正方形，用窄一点的框，避免它被拉得又小又空。
 */
export default function Media({ src, alt, kind }: MediaProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  return (
    <figure className={`media-stage ${KIND_CLASS[kind] ?? ""}`} data-kind={kind}>
      {failed ? (
        <div className="media-missing">
          <strong>图片未能加载</strong>
          <small>{src}</small>
        </div>
      ) : (
        <img src={src} alt={alt} onError={() => setFailed(true)} draggable={false} />
      )}
    </figure>
  );
}
