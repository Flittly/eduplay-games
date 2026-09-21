import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildSubsolarChart,
  currentPoint,
  nearestSeason,
  xToNu,
  SUBSOLAR_PLOT,
  SUBSOLAR_REF_FONT,
  SUBSOLAR_SVG,
  SUBSOLAR_TICK_FONT
} from "./subsolar";

/**
 * 太阳直射点回归运动曲线（左侧二维小图）。
 *
 * 为什么横轴是「公转位置」而不是「月份」：
 * 左侧的「公转位置」旋钮就是 ν，用同一个量做横轴，**转旋钮时曲线上的点与画面里的光柱
 * 永远是同一个纬度**（两者都调 `declinationForNu`，不存在两级背离）；日期作为读数与
 * 刻度说明出现。若横轴直接用月份，就得先把 ν 反解成日期，多一层近似。
 *
 * 为什么点画布能改公转位置：课本上"直射点回归运动"这张图是用来读日期的，
 * 学生读到"夏至"应当能立刻看到地球转到那一格 —— 点一下就跳过去，比拖旋钮找刻度快。
 *
 * 为什么还要能拖（v1.4.7）：点击只能给出**离散**的几个位置，"回归运动"这个过程
 * 恰恰是要看连续的 —— 拖着橙点在图上走，光柱在三维球面上同步南北扫过，读数一路变，
 * 这才把"往返移动"四个字演出来。拖与点共用同一条出口（`onJump` → `jumpToNu`），
 * 所以不存在"拖动走一套逻辑、点击走另一套"的分叉。
 *
 * v1.4.8：本组件不再自带卡框与卡内标题 —— 左侧三块已合并成「演示台」一栏，
 * 标题由所属 <section> 的 h2（「太阳直射点回归运动」）承担，本组件只画读数行 + 图 + 两行注解。
 */
const SVG_W = SUBSOLAR_SVG.w;
const SVG_H = SUBSOLAR_SVG.h;
const PLOT = SUBSOLAR_PLOT;
const TICK_FONT = SUBSOLAR_TICK_FONT;
const REF_FONT = SUBSOLAR_REF_FONT;

export default function SubsolarCurve({
  nu,
  onJump
}: {
  nu: number;
  onJump?: (nu: number) => void;
}) {
  // PLOT 是模块常量，图表结构（曲线路径、参考线、刻度）与 nu 无关 ⇒ 只算一次
  const chart = useMemo(() => buildSubsolarChart(PLOT, TICK_FONT), []);
  const point = currentPoint(nu, PLOT);
  const { mark, distance } = nearestSeason(nu);
  const decl = point.decl;
  const declText =
    Math.abs(decl) < 0.05 ? "0°（赤道）" : `${Math.abs(decl).toFixed(1)}°${decl > 0 ? "N" : "S"}`;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState(false);
  /**
   * `onJump` 每次父组件重渲染都是新函数（父组件里是普通函数声明）。
   * 若直接进 effect 依赖，拖动期间每一帧都会把 window 监听拆了重挂 —— 能跑，但白扔。
   * 存进 ref，effect 只依赖 dragging。
   */
  const jumpRef = useRef(onJump);
  jumpRef.current = onJump;

  /** 屏幕 x → ν。越界由 `xToNu` 钳到 [0,360]，所以拖出小图左/右边缘不会越界 */
  function nuFromClientX(clientX: number): number | null {
    const svg = svgRef.current;
    if (!svg) {
      return null;
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) {
      return null;
    }
    // 屏幕 → SVG 内部坐标：不能直接用 clientX，小图宽度随栏宽自适应
    return xToNu(((clientX - rect.left) / rect.width) * SVG_W, PLOT);
  }

  useEffect(() => {
    if (!dragging) {
      return;
    }
    // 拖动期间把监听挂在 window 上，而不是靠 setPointerCapture：
    // ① 指针移出这张 172px 的小图（甚至移出窗口）也要继续拖，否则一松出界就"粘住不动"；
    // ② setPointerCapture 需要真实 pointerId —— 回归脚本里页面内 dispatchEvent 造的合成
    //    事件没有它，会抛 NotFoundError，而 window 监听对真实指针与合成事件都成立。
    const move = (event: PointerEvent) => {
      const value = nuFromClientX(event.clientX);
      if (value !== null) {
        jumpRef.current?.(value);
      }
    };
    const stop = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  /**
   * 按下即定位 —— 所以「单击」也走这条路，与拖动共用出口，不需要再挂 onClick
   * （两者都挂会在松开时重复设一次 ν，白白多一次渲染）。
   */
  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (!jumpRef.current) {
      return;
    }
    const value = nuFromClientX(event.clientX);
    if (value === null) {
      return;
    }
    // 不阻止默认行为的话，触屏上拖动会变成滚动页面，桌面上会变成选中文字
    event.preventDefault();
    setDragging(true);
    jumpRef.current(value);
  }

  return (
    <div className="subsolar">
      {/* 标题（「太阳直射点回归运动」）由所属 <section> 的 h2 承担，这里只留读数行 ——
          用的就是右栏 .readout-row 那套「左标签 / 右数值」，两栏的读数语法保持同一套。 */}
      <div className="readout-row">
        <span>当前直射点</span>
        <strong>
          {Math.abs(decl) < 0.05 ? "赤道" : `${decl > 0 ? "北纬" : "南纬"} ${Math.abs(decl).toFixed(1)}°`}
        </strong>
      </div>
      <svg
        ref={svgRef}
        className={`subsolar-svg${dragging ? " is-dragging" : ""}`}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        role="img"
        aria-label={`太阳直射点回归运动曲线，当前直射点 ${declText}。可拖动曲线上的点改变公转位置。`}
        data-subsolar="svg"
        onPointerDown={handlePointerDown}
      >
        {/* 热带：两条回归线之间，颜色沿用五带图例 */}
        <rect
          className="subsolar-zone"
          x={PLOT.x}
          y={chart.refLines[0].y}
          width={PLOT.w}
          height={chart.refLines[2].y - chart.refLines[0].y}
        />
        {chart.refLines.map((line) => (
          <g key={line.key} className={`subsolar-ref is-${line.key}`}>
            <line x1={PLOT.x} y1={line.y} x2={PLOT.x + PLOT.w} y2={line.y} />
            <text x={PLOT.x - 3} y={line.y + 2.6} textAnchor="end" fontSize={REF_FONT}>
              {line.label}
            </text>
          </g>
        ))}
        {/* 曲线本体：与引擎里那条公式同源 */}
        <path className="subsolar-curve" d={chart.path} data-subsolar="curve" />
        {chart.ticks.map((tick) => (
          <g key={tick.key} className="subsolar-tick">
            <line x1={tick.x} y1={PLOT.y + PLOT.h} x2={tick.x} y2={PLOT.y + PLOT.h + 3.5} />
            <circle cx={tick.x} cy={tick.y} r={2.6} />
            <text x={tick.x} y={PLOT.y + PLOT.h + 13} textAnchor="middle" fontSize={TICK_FONT}>
              {tick.label}
            </text>
          </g>
        ))}
        {/* 当前直射点：竖虚线 + 抓取热区 + 实心点，颜色与三维画面里的直射点标记一致。
            热区（r=9）盖在点下面：点在动，鼠标要抓准 4.2 单位的圆很难，
            这里给一个透明的大圆托底，配合 cursor:grab 让"这个点能拖"看得出来。 */}
        <line
          className="subsolar-cursor-line"
          x1={point.x}
          y1={point.y}
          x2={point.x}
          y2={PLOT.y + PLOT.h}
        />
        <circle className="subsolar-grab" cx={point.x} cy={point.y} r={9} />
        <circle
          className="subsolar-cursor"
          cx={point.x}
          cy={point.y}
          r={dragging ? 5.4 : 4.2}
          data-subsolar="dot"
        />
      </svg>
      <p className="subsolar-note">
        横轴＝公转位置（与左侧旋钮同一个量）。当前
        {distance < 1 ? `正处${mark.label}` : `临近${mark.label}`}（{mark.date}）。
      </p>
      {onJump && (
        <p className="subsolar-hint">拖动橙点（或点曲线任意位置），地球连续转到那天。</p>
      )}
    </div>
  );
}
