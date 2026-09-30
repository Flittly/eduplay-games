/**
 * 世界洋流图（SVG + 真实地球影像底图）
 * =====================================
 *
 * 这张图是本游戏的"知识底图"，图 4-24 的重绘版。
 *
 * ## v0.1.0 的两处关键修正
 *
 * ### ① 底图：手绘简化多边形 → 地球真实影像图
 *
 * 上一版底图是 7 个"画得像地球"的多边形（北美/南美/欧非/亚洲/澳洲/
 * 格陵兰/南极），注释里写着"极度简化，不追求地图精度"。问题是：
 * 学生看图时要建立"**这条洋流在真实地球的哪里**"的认知，
 * 手绘多边形给不了这个认知——它连"澳洲在南纬 10~40°"都没画对
 * （实测被压在 −60~−31°，整体南移约 20°）。而且那张图**没有一致的经纬网**，
 * 各大陆的经纬尺度互相对不上（亚洲经度上限只到 141°E、非洲南端到 −48°）。
 *
 * 现在换成**真实卫星影像底图**（天地图，合规图源），并叠一层真实海岸线。
 *
 * ### ② 洋流坐标：手写归一化坐标 → 真实经纬度
 *
 * 上一版 `anchor: {x, y}` 是手工摆在手绘底图上的 0~1 值，与真实地理
 * **毫无对应**。实测偏差：加利福尼亚寒流被画到大西洋东岸（169°）、
 * 阿拉斯加暖流画到欧洲（181°）、南赤道暖流画到印度洋（215°）。
 *
 * 现在经纬度是唯一真相源，画布像素由 `proj.ts` 现算。
 *
 * ## 坐标系
 *
 * viewBox `0 0 1000 560`，等距圆柱投影，经纬范围满 −180~180 / −90~90。
 * 所有换算走 `proj.ts`，**本文件不出现任何手写的经纬→像素公式**。
 *
 * ## 三层分级的视觉呈现（分层最容易做成表面功夫，别偷懒）
 *
 *   - core      实心高亮箭头，颜色饱和（红＝暖流 / 蓝＝寒流）
 *   - extension 虚线描边 + 「拓展」角标，降饱和
 *   - reference 不单独标（只出现在解释卡文字里）
 */

import { useEffect, useRef, useState } from "react";
import { CURRENTS, currentById, type Current } from "./data";
import {
  buildTiles,
  DEFAULT_ZOOM,
  tiandituTileUrl,
  TIANDITU_ATTRIBUTION
} from "./basemap";
import {
  MAP_H,
  MAP_W,
  latToY,
  llToXY,
  lonToX,
  normToXY,
  splitAtAntimeridian
} from "./proj";

/** 暖流红、寒流蓝——与图 4-24 的配色一致，学生看图玩游戏才能建立同一套直觉。 */
const WARM = "#e0483a";
const COLD = "#2f6fb5";
const EXT_WARM = "#d98b80";
const EXT_COLD = "#85a8cc";

/** 陆地填充/描边（叠在影像上，让海岸线在影像上也清楚）。 */
const LAND_FILL = "rgba(232, 226, 210, 0.34)";
const LAND_STROKE = "rgba(120, 110, 90, 0.55)";

function kindColor(c: Current, dim = false): string {
  if (c.kind === "warm") return dim ? EXT_WARM : WARM;
  return dim ? EXT_COLD : COLD;
}

/* ------------------------------------------------------------------ *
 * 陆地轮廓数据（真实海岸线，Natural Earth 110m）
 * ------------------------------------------------------------------ */

interface WorldLand {
  meta: { source: string; note: string };
  /** 每个环是一串 [lon, lat] */
  rings: [number, number][][];
}

let landCache: WorldLand | null = null;
let landPromise: Promise<WorldLand | null> | null = null;

/** 载入陆地轮廓（只发一次请求，失败返回 null 由调用方降级）。 */
function loadLand(): Promise<WorldLand | null> {
  if (landCache) return Promise.resolve(landCache);
  if (!landPromise) {
    landPromise = fetch("./assets/world-land.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: WorldLand | null) => {
        landCache = j;
        return j;
      })
      .catch(() => null);
  }
  return landPromise;
}

/** 把一组经纬度环转成 SVG path 的 `d`（跨日界线的点要断开）。 */
function ringsToPath(rings: [number, number][][]): string {
  const parts: string[] = [];
  for (const ring of rings) {
    let open = false;
    let prevLon: number | null = null;
    for (const [lon, lat] of ring) {
      // 相邻两点经度跳变超过 180° ⇒ 这一条跨了日界线，断笔重起
      const jump = prevLon !== null && Math.abs(lon - prevLon) > 180;
      const x = lonToX(lon);
      const y = latToY(lat);
      parts.push(`${!open || jump ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
      open = true;
      prevLon = lon;
    }
    if (open) parts.push("Z");
  }
  return parts.join("");
}

/* ------------------------------------------------------------------ *
 * 影像底图（天地图）
 * ------------------------------------------------------------------ */

interface Props {
  /** 当前高亮的洋流 id（选了海域、或揭晓答案时）。 */
  highlightId?: string | null;
  /** 已认对的洋流 id —— 描成"已解锁"的样子。 */
  recognized?: string[];
  /** 是否显示名字。⚠️ 下网前**不能显示名字**，否则第一问就白问了。 */
  showNames?: boolean;
  /** 只显示哪些层级（初中版只有 core）。 */
  tiers?: ("core" | "extension" | "reference")[];
  /** 点选海域。 */
  onPick?: (id: string) => void;
  /** 是否可点（答题过程中要锁住）。 */
  interactive?: boolean;
  /** 画箭头模式下的落笔回调（高中版第二问）。 */
  onDrawArrow?: (a: { x1: number; y1: number; x2: number; y2: number }) => void;
  /** 已画的箭头（画箭头模式）。 */
  drawnArrow?: { x1: number; y1: number; x2: number; y2: number } | null;
  /** 天地图密钥（tk）。空串 = 不加载影像，只用矢量陆地。 */
  tiandituKey?: string;
  /** 影像加载失败时回调（上层据此提示"已切回矢量底图"）。 */
  onTileError?: () => void;
}

export default function CurrentMap({
  highlightId = null,
  recognized = [],
  showNames = false,
  tiers = ["core"],
  onPick,
  interactive = true,
  onDrawArrow,
  drawnArrow = null,
  tiandituKey = "",
  onTileError
}: Props) {
  const visible = CURRENTS.filter((c) => tiers.includes(c.tier));

  const [land, setLand] = useState<WorldLand | null>(landCache);
  const [tileFail, setTileFail] = useState(0);
  const failReported = useRef(false);

  useEffect(() => {
    let alive = true;
    loadLand().then((j) => {
      if (alive && j) setLand(j);
    });
    return () => {
      alive = false;
    };
  }, []);

  const wantImagery = Boolean(tiandituKey);
  /**
   * 失败多了就整体放弃影像，避免满屏破图（≥3 块失败即降级）。
   *
   * ⚠️ 降级是**有意设计**，不是缺陷：校机室没网 / 密钥过期 / 额度用尽都会让
   *    瓦片 404，此时必须回退到内置矢量海岸线（游戏照常可玩），
   *    而不是留一张满是破图的地图。所以"有密钥"与"影像真的显示出来了"
   *    是**两件事**：前者由我们控制，后者还取决于网络与密钥有效性。
   *    写判据时只能断言前者（§87：别写结果类断言）。
   */
  const imagery = wantImagery && tileFail < 3;
  const tiles = imagery ? buildTiles(DEFAULT_ZOOM) : [];

  useEffect(() => {
    if (!imagery && wantImagery && !failReported.current) {
      failReported.current = true;
      onTileError?.();
    }
  }, [imagery, wantImagery, onTileError]);

  // 画箭头：从 mousedown 到 mouseup 拉一条线
  let drawStart: { x: number; y: number } | null = null;

  function toCanvas(evt: React.MouseEvent<SVGSVGElement>) {
    const rect = evt.currentTarget.getBoundingClientRect();
    return {
      x: ((evt.clientX - rect.left) / rect.width) * MAP_W,
      y: ((evt.clientY - rect.top) / rect.height) * MAP_H
    };
  }

  const landPath = land ? ringsToPath(land.rings) : "";

  // 两个 data-* 只给机器判据用（不是样式钩子）：
  //   data-want-imagery  有密钥、打算用影像（由我们控制，可断言）
  //   data-imagery       影像层**正在显示**（还取决于网络/密钥有效性，
  //                      离线时会是 0 —— 那是设计内的降级，不是缺陷）
  // 分开暴露，判据才能只钉前者，不去写依赖外网的"结果类断言"。
  return (
    <div
      className="current-map-wrap"
      data-want-imagery={wantImagery ? "1" : "0"}
      data-imagery={imagery ? "1" : "0"}
    >
      {/* 影像瓦片层：绝对定位铺在 SVG 底下，由 SVG 只负责矢量与交互 */}
      {imagery && (
        <div className="map-tiles" aria-hidden="true">
          {tiles.map((t) => (
            <img
              key={`${t.z}/${t.x}/${t.y}/${t.row}`}
              className="map-tile"
              src={tiandituTileUrl(t.z, t.x, t.y, tiandituKey)}
              alt=""
              draggable={false}
              style={{
                left: `${(t.left / MAP_W) * 100}%`,
                top: `${(t.top / MAP_H) * 100}%`,
                width: `${(t.width / MAP_W) * 100}%`,
                height: `${(t.height / MAP_H) * 100}%`
              }}
              // 同一块瓦片的 8 条共用一张图，出错也一定一起出错 ⇒ 只在第 0 条计一次
              onError={t.row === 0 ? () => setTileFail((n) => n + 1) : undefined}
            />
          ))}
        </div>
      )}

      <svg
        className="current-map"
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        role="img"
        aria-label="世界表层洋流分布图"
        onMouseDown={(e) => {
          if (!onDrawArrow) return;
          drawStart = toCanvas(e);
        }}
        onMouseUp={(e) => {
          if (!onDrawArrow || !drawStart) return;
          const end = toCanvas(e);
          const start = drawStart;
          drawStart = null;
          // 太短的拖动当误触，不当画箭头
          if (Math.hypot(end.x - start.x, end.y - start.y) < 24) return;
          onDrawArrow({
            x1: start.x / MAP_W,
            y1: start.y / MAP_H,
            x2: end.x / MAP_W,
            y2: end.y / MAP_H
          });
        }}
      >
        <defs>
          {/* 无影像时的海面底色 */}
          <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#eaf3fb" />
            <stop offset="100%" stopColor="#dce9f6" />
          </linearGradient>
        </defs>

        {/* 海面底色 —— ⚠️ 只在**没有影像层**时画。
            这是一个踩过的坑（v0.1.0 修）：这个 <rect> 铺满整张画布且不透明，
            而它所在的 SVG 是 z-index 1、影像层 .map-tiles 是 z-index 0
            ⇒ 只要它无条件渲染，**影像瓦片即使 100% 加载成功也会被它整块盖住**。
            当时的表现极具迷惑性：DOM 量出来瓦片数量/位置/尺寸/可见性全对，
            naturalWidth=256 也全绿，就是屏幕上什么都看不到（实测画布区域
            平均亮度 232.5 = 恰好是 #dce9f6 的亮度）。
            所以判据不能只看几何，必须看**像素**。 */}
        {!imagery && (
          <rect x="0" y="0" width={MAP_W} height={MAP_H} fill="url(#sea)" />
        )}

        {/* 纬线：赤道与 40° 纬线的空间锚点（真实纬度） */}
        <g className="map-graticule">
          {[
            { lat: 0, label: "赤道", strong: true },
            { lat: -40, label: "南纬 40°", strong: false },
            { lat: 40, label: "北纬 40°", strong: false }
          ].map((g) => (
            <g key={g.lat}>
              <line
                x1={0}
                y1={latToY(g.lat)}
                x2={MAP_W}
                y2={latToY(g.lat)}
                stroke={g.strong ? "rgba(159,188,212,0.95)" : "rgba(195,216,232,0.75)"}
                strokeWidth={g.strong ? 1.4 : 1}
                strokeDasharray={g.strong ? "none" : "6 6"}
              />
              <text x={8} y={latToY(g.lat) - 6} className="map-label is-graticule">
                {g.label}
              </text>
            </g>
          ))}
        </g>

        {/* 陆地轮廓：真实海岸线。叠在影像上让大陆形状清楚；无影像时它就是底图 */}
        <g className="map-land" fill={imagery ? LAND_FILL : "#e6e2d6"} stroke={LAND_STROKE} strokeWidth={0.9}>
          {landPath && <path d={landPath} />}
        </g>

        {/* 洋流箭头：三层视觉差异就在这里 */}
        <g className="map-currents">
          {visible.map((c) => {
            const isExt = c.tier === "extension";
            const isOn = highlightId === c.id;
            const isKnown = recognized.includes(c.id);
            const color = kindColor(c, isExt);

            // 真实经纬度 → 画布像素，并处理跨日界线拆段
            const a = llToXY(c.anchor.lon, c.anchor.lat);
            const segs = splitAtAntimeridian(
              c.arrow.lon1,
              c.arrow.lat1,
              c.arrow.lon2,
              c.arrow.lat2
            );

            const strokeW = isOn ? 6 : isExt ? 3 : 4.5;
            const opacity = isExt ? 0.72 : isOn ? 1 : isKnown ? 0.95 : 0.85;

            return (
              <g
                key={c.id}
                className={[
                  "current-arrow",
                  isExt ? "is-extension" : "is-core",
                  isOn ? "is-active" : "",
                  isKnown ? "is-known" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-current={c.id}
                data-tier={c.tier}
              >
                {/* 箭头本体（可能多段）—— 纯装饰，一律 pointerEvents="none"，
                    命中统一交给最后那条透明热区 */}
                {segs.map((seg, si) => {
                  const p1 = llToXY(seg[0].lon, seg[0].lat);
                  const p2 = llToXY(seg[1].lon, seg[1].lat);
                  const isLast = si === segs.length - 1;
                  const ang =
                    (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
                  // 描边稍粗的浅色垫线，让箭头在真实影像上也压得住背景
                  return (
                    <g key={si} pointerEvents="none">
                      <line
                        x1={p1.x}
                        y1={p1.y}
                        x2={p2.x}
                        y2={p2.y}
                        stroke="rgba(255,255,255,0.72)"
                        strokeWidth={strokeW + 3}
                        strokeLinecap="round"
                        strokeDasharray={isExt ? "9 7" : "none"}
                        opacity={isExt ? 0.5 : 0.75}
                      />
                      <line
                        x1={p1.x}
                        y1={p1.y}
                        x2={p2.x}
                        y2={p2.y}
                        stroke={color}
                        strokeWidth={strokeW}
                        strokeLinecap="round"
                        strokeDasharray={isExt ? "9 7" : "none"}
                        opacity={opacity}
                      />
                      {si === 0 && (
                        <circle
                          cx={p1.x}
                          cy={p1.y}
                          r={isOn ? 5 : 3.5}
                          fill={color}
                          stroke="rgba(255,255,255,0.85)"
                          strokeWidth={1.2}
                          opacity={isExt ? 0.6 : 0.95}
                        />
                      )}
                      {isLast && (
                        <polygon
                          points="0,-7 11,0 0,7"
                          fill={color}
                          stroke="rgba(255,255,255,0.85)"
                          strokeWidth={1.1}
                          transform={`translate(${p2.x},${p2.y}) rotate(${ang})`}
                          opacity={isExt ? 0.72 : 1}
                        />
                      )}
                    </g>
                  );
                })}

                {/* 名字：只在揭晓/图鉴时显示 */}
                {showNames && (
                  <text
                    x={a.x}
                    y={a.y - 10}
                    className={isExt ? "map-label is-extension" : "map-label"}
                    textAnchor="middle"
                    pointerEvents="none"
                  >
                    {c.name}
                  </text>
                )}

                {/* 已认对：打一个小勾 */}
                {isKnown && !showNames && (
                  <text
                    x={a.x}
                    y={a.y - 9}
                    className="map-known-mark"
                    textAnchor="middle"
                    pointerEvents="none"
                  >
                    ✓
                  </text>
                )}

                {/* 拓展层角标 —— 呈现纪律的硬要求 */}
                {isExt && showNames && (
                  <g transform={`translate(${a.x},${a.y - 26})`} pointerEvents="none">
                    <rect
                      x={-13}
                      y={-9}
                      width={26}
                      height={13}
                      rx={6.5}
                      className="map-ext-badge-bg"
                    />
                    <text x={0} y={1} className="map-ext-badge" textAnchor="middle">
                      拓展
                    </text>
                  </g>
                )}

                {/* 命中热区：够大，学生点得中。
                    ⚠️ 必须画在**最后**（叠在最上层）—— SVG 里同一点上多个元素
                    都能命中时，**后画的赢**。上面所有可见元素都写了
                    pointerEvents="none"，于是热区成为唯一的命中目标。
                    ⚠️ 还必须显式 pointerEvents="all"：默认 visiblePainted 会把
                    「完全透明的描边」当作没画而跳过它（elementFromPoint 却仍能
                    命中，两者口径不同，极易验漏）。
                    实测：这两条少一条，真实点击就落到那条细箭头上（它没有处理
                    函数），表现为"热区看着在、点下去没反应"。 */}
                {onPick &&
                  segs.map((seg, si) => {
                    const p1 = llToXY(seg[0].lon, seg[0].lat);
                    const p2 = llToXY(seg[1].lon, seg[1].lat);
                    return (
                      <line
                        key={`hit${si}`}
                        x1={p1.x}
                        y1={p1.y}
                        x2={p2.x}
                        y2={p2.y}
                        stroke="transparent"
                        strokeWidth={30}
                        pointerEvents="all"
                        style={{ cursor: interactive ? "pointer" : "default" }}
                        onMouseDown={(e) => {
                          // 画箭头模式下不抢事件
                          if (onDrawArrow || !interactive) return;
                          e.stopPropagation();
                          onPick(c.id);
                        }}
                      />
                    );
                  })}
              </g>
            );
          })}
        </g>

        {/* 玩家画的箭头（高中版第二问） */}
        {drawnArrow && (
          <line
            className="map-drawn-arrow"
            x1={normToXY({ x: drawnArrow.x1, y: drawnArrow.y1 }).x}
            y1={normToXY({ x: drawnArrow.x1, y: drawnArrow.y1 }).y}
            x2={normToXY({ x: drawnArrow.x2, y: drawnArrow.y2 }).x}
            y2={normToXY({ x: drawnArrow.x2, y: drawnArrow.y2 }).y}
          />
        )}

        {/* 图例 */}
        <g className="map-legend" transform={`translate(${MAP_W - 210}, 16)`}>
          <rect x={0} y={0} width={196} height={tiers.includes("extension") ? 76 : 54} rx={8} className="map-legend-bg" />
          <line x1={14} y1={22} x2={54} y2={22} stroke={WARM} strokeWidth={4.5} strokeLinecap="round" />
          <text x={62} y={26} className="map-legend-text">
            暖流（低纬 → 高纬）
          </text>
          <line x1={14} y1={44} x2={54} y2={44} stroke={COLD} strokeWidth={4.5} strokeLinecap="round" />
          <text x={62} y={48} className="map-legend-text">
            寒流（高纬 → 低纬）
          </text>
          {tiers.includes("extension") && (
            <>
              <line
                x1={14}
                y1={64}
                x2={54}
                y2={64}
                stroke={EXT_COLD}
                strokeWidth={3}
                strokeDasharray="9 7"
                strokeLinecap="round"
              />
              <text x={62} y={68} className="map-legend-text is-extension">
                拓展（课标不考）
              </text>
            </>
          )}
        </g>

        {/* 来源标注：合规要求，影像底图必须标 */}
        {imagery && (
          <text x={8} y={MAP_H - 6} className="map-credit">
            {TIANDITU_ATTRIBUTION}
          </text>
        )}
      </svg>
    </div>
  );
}

/** 供外部按 id 取洋流（画结算卡时用）。 */
export { currentById };
