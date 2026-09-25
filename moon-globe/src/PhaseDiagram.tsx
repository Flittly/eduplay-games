/**
 * 月相成因示意图（二维 SVG，右侧「控制台」用）。
 *
 * ## 这幅图在讲什么
 *
 * 月球本身不发光，任何时刻**只有朝向太阳的那一半被照亮**。我们看到什么形状，
 * 取决于月球跑到轨道的哪个位置 —— 也就是「被照亮的一半」有多少正对着地球。
 *
 * ## 图的画法与它的唯一真相源
 *
 * 图是**从黄道北极往下看**的俯视图，太阳在左边。于是把太阳方向定为 −X，
 * 月球的公转在俯视图里是**逆时针**的（自转/公转都是顺行）。取新月那一刻
 * 月球位于日地之间（方位角 180°），则
 *
 * ```
 * 方位角 φ(月龄) = 180° + 360° × 月龄 / 朔望月      （数学角，y 轴向上）
 * ```
 *
 * 四个基准位置（数学坐标）：
 *
 * | 位置 | 数学坐标 | 屏幕 | 被照亮的一半朝向 |
 * |---|---|---|---|
 * | 新月 | (−r, 0) | 左 | 背对地球 ⇒ 看不见 |
 * | 上弦月 | (0, −r) | 下 | 与视线垂直 ⇒ 右半边亮 |
 * | 满月 | (+r, 0) | 右 | 正对地球 ⇒ 全亮 |
 * | 下弦月 | (0, +r) | 上 | 与视线垂直 ⇒ 左半边亮 |
 *
 * ⚠ 「上弦月画在下方」不是随手摆的：由 φ 从 180° 逆时针增加可推出上弦（φ=270°）
 * 落在下方、下弦（φ=90°）落在上方。上下画反了，学生照着图推出来的
 * 「上弦月亮面朝哪边」就会跟着反 —— 这正是本模块导出 `diagramPoint()` 给回归
 * 脚本复算的原因：图的几何必须能被机器复核，而不是只能"看着像"。
 *
 * ⚠ 因为太阳恒在左侧，四个位置上月球的**被照亮面永远朝左**（同一个半圆），
 * 所以四个月亮画的是同一个「左亮右暗」的小图，差别只在它相对地球的方位。
 */
import { SYNODIC_MONTH } from "./moonPhase";

/** 画布尺寸（与 CSS width:100% 配合，等比缩放） */
export const DIAGRAM_VIEWBOX = { w: 230, h: 158 } as const;
/** 地球圆心与月球轨道半径 */
export const DIAGRAM_EARTH = { cx: 115, cy: 68, r: 10 } as const;
export const DIAGRAM_ORBIT_R = 42;
/** 四个位置上的月球半径 */
export const DIAGRAM_MOON_R = 9;

export interface DiagramPoint {
  /** 数学方位角（度，y 轴向上，0° = 正右） */
  phi: number;
  /** SVG 屏幕坐标 */
  x: number;
  y: number;
}

/**
 * 月龄 → 月球在俯视图里的位置。
 * `phi` 用数学角（y 向上），换算到 SVG 屏幕要翻一次 y。
 */
export function diagramPoint(age: number): DiagramPoint {
  const phi = 180 + (360 * age) / SYNODIC_MONTH;
  const rad = (phi * Math.PI) / 180;
  return {
    phi: ((phi % 360) + 360) % 360,
    x: DIAGRAM_EARTH.cx + DIAGRAM_ORBIT_R * Math.cos(rad),
    y: DIAGRAM_EARTH.cy - DIAGRAM_ORBIT_R * Math.sin(rad)
  };
}

/** 四个基准位置：月龄、名字、以及它相对地球的屏幕方位 */
export const DIAGRAM_STATIONS = [
  { age: 0, name: "新月", side: "left" as const, anchor: "middle" as const },
  {
    age: SYNODIC_MONTH / 4,
    name: "上弦月",
    side: "below" as const,
    anchor: "start" as const
  },
  { age: SYNODIC_MONTH / 2, name: "满月", side: "right" as const, anchor: "middle" as const },
  {
    age: (SYNODIC_MONTH * 3) / 4,
    name: "下弦月",
    side: "above" as const,
    anchor: "start" as const
  }
] as const;

/** 一个「左半边被照亮」的小月球（太阳在左 ⇒ 所有位置都是同一张） */
function LitMoon({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g className="diagram-moon">
      <circle cx={cx} cy={cy} r={r} className="diagram-moon-dark" />
      <path
        d={`M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r} Z`}
        className="diagram-moon-lit"
      />
      <circle cx={cx} cy={cy} r={r} className="diagram-moon-ring" />
    </g>
  );
}

export default function PhaseDiagram({ age }: { age: number }) {
  const cur = diagramPoint(age);
  const { cx, cy } = DIAGRAM_EARTH;

  const stations = [
    {
      ...DIAGRAM_STATIONS[0],
      x: cx - DIAGRAM_ORBIT_R,
      y: cy,
      lx: cx - DIAGRAM_ORBIT_R,
      ly: cy - 15
    },
    {
      ...DIAGRAM_STATIONS[1],
      x: cx,
      y: cy + DIAGRAM_ORBIT_R,
      lx: cx + 15,
      ly: cy + DIAGRAM_ORBIT_R + 4
    },
    {
      ...DIAGRAM_STATIONS[2],
      x: cx + DIAGRAM_ORBIT_R,
      y: cy,
      lx: cx + DIAGRAM_ORBIT_R,
      ly: cy - 15
    },
    {
      ...DIAGRAM_STATIONS[3],
      x: cx,
      y: cy - DIAGRAM_ORBIT_R,
      lx: cx + 15,
      ly: cy - DIAGRAM_ORBIT_R + 4
    }
  ];

  return (
    <svg
      className="phase-diagram"
      viewBox={`0 0 ${DIAGRAM_VIEWBOX.w} ${DIAGRAM_VIEWBOX.h}`}
      role="img"
      aria-label="月相成因示意：太阳光自左侧射来，月球绕地球公转，被照亮的一半恒朝向太阳"
    >
      {/* 太阳光：自左向右的一束平行光。四条箭头恰好掠过轨道外缘上下，不压月球。 */}
      <g className="diagram-rays">
        {[22, 46, 68, 90, 114].map((y) => (
          <line key={y} x1={6} y1={y} x2={50} y2={y} markerEnd="url(#moon-ray-head)" />
        ))}
      </g>
      <text className="diagram-sun-label" x={6} y={13}>
        太阳光（平行光）
      </text>

      {/* 月球轨道：虚线圆，表示公转路径 */}
      <circle cx={cx} cy={cy} r={DIAGRAM_ORBIT_R} className="diagram-orbit" />

      {/* 地球 */}
      <g className="diagram-earth">
        <circle cx={cx} cy={cy} r={DIAGRAM_EARTH.r} className="diagram-earth-body" />
        <text x={cx} y={cy + 3} className="diagram-earth-label">
          地球
        </text>
      </g>

      {/* 四个基准位置：太阳恒在左侧 ⇒ 被照亮的一半恒朝左 */}
      {stations.map((s) => (
        <g key={s.name} data-station={s.side}>
          <LitMoon cx={s.x} cy={s.y} r={DIAGRAM_MOON_R} />
          <text
            className="diagram-station-label"
            x={s.lx}
            y={s.ly}
            textAnchor={s.anchor}
          >
            {s.name}
          </text>
        </g>
      ))}

      {/* 当前月龄所在的方位：视线 + 红点 */}
      <line
        className="diagram-sight"
        x1={cx}
        y1={cy}
        x2={cur.x}
        y2={cur.y}
      />
      <circle className="diagram-cursor" cx={cur.x} cy={cur.y} r={3.2} />

      <text className="diagram-note" x={6} y={142}>
        淡色半边 = 被太阳照亮的一半（恒朝向太阳）
      </text>
      <text className="diagram-note" x={6} y={153}>
        月球绕地球公转一周 ≈ 29.53 天，俯视时逆时针
      </text>

      <defs>
        <marker
          id="moon-ray-head"
          markerWidth="5"
          markerHeight="5"
          refX="4"
          refY="2.5"
          orient="auto"
        >
          <path d="M0,0 L5,2.5 L0,5 z" className="diagram-ray-head" />
        </marker>
      </defs>
    </svg>
  );
}
