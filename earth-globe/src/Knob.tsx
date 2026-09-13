import { useRef, useState } from "react";

const DEG = Math.PI / 180;

export interface KnobTick {
  /** 刻度所在角度：0° 在正上方，顺时针为正 */
  value: number;
  label?: string;
  color?: string;
  /** 加粗刻度（用于节气等关键位置） */
  strong?: boolean;
}

interface KnobProps {
  /** 指针角度：0° 在正上方，顺时针为正 */
  value: number;
  /** 拖动回调，返回归一化后的角度（wrap 为真时为 0~360） */
  onDrag: (deg: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** 是否把结果归一化到 0~360（自转旋钮需要连续累计时传 false） */
  wrap?: boolean;
  ticks?: KnobTick[];
  size?: number;
  accent?: string;
  ariaLabel?: string;
}

/**
 * 旋钮控件：按住圆盘绕圆心拖动即可连续旋转（0° 在正上方，顺时针为正）。
 * 相比滑杆，旋钮可以"一圈一圈地转"，更适合课堂演示连续转动。
 */
export default function Knob({
  value,
  onDrag,
  onDragStart,
  onDragEnd,
  wrap = true,
  ticks = [],
  size = 120,
  accent = "#e0a83c",
  ariaLabel
}: KnobProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef({ active: false, last: 0, start: 0, accum: 0 });
  const [dragging, setDragging] = useState(false);

  const c = size / 2;
  const rim = size * 0.33;

  /** 指针位置的极角（0° 正上方，顺时针）；离圆心太近时返回 null，避免抖动 */
  function angleAt(clientX: number, clientY: number): number | null {
    const el = svgRef.current;
    if (!el) {
      return null;
    }
    const rect = el.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    if (Math.hypot(dx, dy) < 9) {
      return null;
    }
    return ((Math.atan2(dx, -dy) / DEG) % 360 + 360) % 360;
  }

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    const a = angleAt(event.clientX, event.clientY);
    if (a === null) {
      return;
    }
    // 指针捕获让手指/鼠标移出圆盘后仍能继续转动；合成事件下可能不可用，失败不影响拖动
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    drag.current = { active: true, last: a, start: value, accum: 0 };
    setDragging(true);
    onDragStart?.();
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!drag.current.active) {
      return;
    }
    const a = angleAt(event.clientX, event.clientY);
    if (a === null) {
      return;
    }
    // 跨过 0°/360° 时取最短方向，避免指针跳变
    let delta = a - drag.current.last;
    if (delta > 180) {
      delta -= 360;
    } else if (delta < -180) {
      delta += 360;
    }
    drag.current.last = a;
    drag.current.accum += delta;
    let next = drag.current.start + drag.current.accum;
    if (wrap) {
      next = ((next % 360) + 360) % 360;
    }
    onDrag(next);
  }

  function endDrag(event: React.PointerEvent<SVGSVGElement>) {
    if (!drag.current.active) {
      return;
    }
    drag.current.active = false;
    setDragging(false);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* ignore */
    }
    onDragEnd?.();
  }

  const needleRad = value * DEG;
  const needleR = rim - 11;

  return (
    <svg
      ref={svgRef}
      className={dragging ? "knob-dial is-dragging" : "knob-dial"}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="slider"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={360}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <circle cx={c} cy={c} r={rim + 4} fill="#e6d8bd" stroke="#2b2620" strokeWidth={3} />
      <circle cx={c} cy={c} r={rim} fill="#fdf8ec" stroke="#2b2620" strokeWidth={2} />

      {ticks.map((tick, index) => {
        const rad = tick.value * DEG;
        const ux = Math.sin(rad);
        const uy = -Math.cos(rad);
        const inner = rim - (tick.strong ? 17 : 12);
        const outer = rim - 3;
        return (
          <g key={index}>
            <line
              x1={c + ux * inner}
              y1={c + uy * inner}
              x2={c + ux * outer}
              y2={c + uy * outer}
              stroke={tick.color ?? "#2b2620"}
              strokeWidth={tick.strong ? 3 : 2}
              strokeLinecap="round"
            />
            {tick.label ? (
              <text
                x={c + ux * (rim + 13)}
                y={c + uy * (rim + 13)}
                fill={tick.color ?? "#6b6154"}
                fontSize={12}
                fontWeight={900}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {tick.label}
              </text>
            ) : null}
          </g>
        );
      })}

      {/* 指针 */}
      <line
        x1={c - Math.sin(needleRad) * 7}
        y1={c + Math.cos(needleRad) * 7}
        x2={c + Math.sin(needleRad) * needleR}
        y2={c - Math.cos(needleRad) * needleR}
        stroke={accent}
        strokeWidth={5}
        strokeLinecap="round"
      />
      <circle cx={c} cy={c} r={9} fill="#2b2620" />
      <circle cx={c} cy={c} r={4} fill={accent} />
    </svg>
  );
}
