import { useMemo } from "react";
import { makeProjector } from "./logic";
import type { ChinaMap, Landform, WorldMap } from "./types";

interface Props {
  landform: Landform;
  china: ChinaMap | null;
  world: WorldMap | null;
}

/** 判断标签该往哪边展开，避免贴近右边界时被裁掉 */
function anchorMode(xRatio: number) {
  if (xRatio > 0.62) return "end";
  return "start";
}

export default function MiniMap({ landform, china, world }: Props) {
  const isDomestic = landform.category === "domestic";
  const map = isDomestic ? china : world;

  const projected = useMemo(() => {
    if (!map) return null;
    const proj = makeProjector(map.meta);
    const [x, y] = proj(landform.lat, landform.lon);
    const [vbx, vby, vbw, vbh] = map.meta.viewBox;
    return {
      x: x - vbx,
      y: y - vby,
      w: vbw,
      h: vbh,
      left: ((x - vbx) / vbw) * 100,
      top: ((y - vby) / vbh) * 100
    };
  }, [map, landform.lat, landform.lon]);

  const chinaOnWorld = useMemo(() => {
    if (isDomestic || !world) return null;
    const proj = makeProjector(world.meta);
    const [x, y] = proj(36, 103);
    const [vbx, vby, vbw, vbh] = world.meta.viewBox;
    return {
      left: ((x - vbx) / vbw) * 100,
      top: ((y - vby) / vbh) * 100
    };
  }, [isDomestic, world]);

  if (!map || !projected) {
    return (
      <div className="minimap minimap--empty">
        <span>地图数据未就绪</span>
      </div>
    );
  }

  const [vbx, vby, vbw, vbh] = map.meta.viewBox;

  return (
    <div className="minimap">
      <div className="minimap-frame" style={{ aspectRatio: `${vbw} / ${vbh}` }}>
        <svg
          viewBox={`${vbx} ${vby} ${vbw} ${vbh}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${landform.name}位置示意图`}
        >
          {isDomestic && china ? (
            <>
              <path className="mp-outline" d={china.outline} vectorEffect="non-scaling-stroke" />
              <path className="mp-prov" d={china.provinces} vectorEffect="non-scaling-stroke" />
              <path className="mp-nine" d={china.nineDash} vectorEffect="non-scaling-stroke" />
            </>
          ) : null}
          {!isDomestic && world ? (
            <>
              <path className="mp-land" d={world.land} vectorEffect="non-scaling-stroke" />
              <path className="mp-cn" d={world.china} vectorEffect="non-scaling-stroke" />
            </>
          ) : null}
        </svg>

        {chinaOnWorld ? (
          <span
            className="minimap-cn-label"
            style={{ left: `${chinaOnWorld.left}%`, top: `${chinaOnWorld.top}%` }}
          >
            中国
          </span>
        ) : null}

        <span className="minimap-dot" style={{ left: `${projected.left}%`, top: `${projected.top}%` }}>
          <i className="minimap-dot__pulse" />
          <i className="minimap-dot__core" />
        </span>

        <span
          className="minimap-tag"
          data-anchor={anchorMode(projected.left / 100)}
          style={{ left: `${projected.left}%`, top: `${projected.top}%` }}
        >
          {landform.name}
        </span>
      </div>
      <p className="minimap-foot">
        <b>红点</b>即该地貌所在位置
        <span className="minimap-scale">
          {landform.lat >= 0 ? `北纬 ${landform.lat.toFixed(2)}°` : `南纬 ${Math.abs(landform.lat).toFixed(2)}°`}
          {" · "}
          {landform.lon >= 0 ? `东经 ${landform.lon.toFixed(2)}°` : `西经 ${Math.abs(landform.lon).toFixed(2)}°`}
        </span>
      </p>
    </div>
  );
}
