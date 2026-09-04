import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import mapData from "./data/province.json";

export interface PuzzleResult {
  score: number;
  correctCount: number;
  totalCount: number;
}

export interface ProvincePuzzleProps {
  onComplete: (result: PuzzleResult) => void;
}

interface Feature {
  id: string;
  name: string;
  centroid: [number, number];
  bbox: [number, number, number, number];
  d: string;
}

interface MapData {
  viewBox: [number, number, number, number];
  features: Feature[];
}

const MAP = mapData as unknown as MapData;
const FEATURES = MAP.features;
const VB_WIDTH = MAP.viewBox[2];
const VB_HEIGHT = MAP.viewBox[3];

const TRAY_COLS = 8;
const PAD = 12;
const TRAY_CELL_WIDTH = (VB_WIDTH - PAD * (TRAY_COLS - 1)) / TRAY_COLS;
const TRAY_CELL_HEIGHT = 108;
const TRAY_TOP = VB_HEIGHT + 26;
const LABEL_SPACE = 24;
const TRAY_ROWS = Math.ceil(FEATURES.length / TRAY_COLS);
const MIN_SNAP = 30;

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function bboxSize(feature: Feature): number {
  return Math.max(
    feature.bbox[2] - feature.bbox[0],
    feature.bbox[3] - feature.bbox[1]
  );
}

function colorFor(index: number): string {
  const hue = (index * 137.508) % 360;
  return `hsl(${hue}, 56%, 62%)`;
}

export default function ProvincePuzzle({ onComplete }: ProvincePuzzleProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [placed, setPlaced] = useState<Set<string>>(() => new Set());
  const [dragging, setDragging] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [round, setRound] = useState(0);

  const trayOrder = useMemo(
    () => shuffle(FEATURES.map((feature) => feature.id)),
    // 每轮重新打乱。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [round]
  );

  const unplaced = trayOrder.filter((id) => !placed.has(id));
  const viewBoxHeight = TRAY_TOP + TRAY_ROWS * (TRAY_CELL_HEIGHT + PAD);

  function toSvgPoint(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) {
      return { x: 0, y: 0 };
    }
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const ctm = svg.getScreenCTM();
    const projected = ctm ? point.matrixTransform(ctm.inverse()) : point;
    return { x: projected.x, y: projected.y };
  }

  function handlePointerDown(event: ReactPointerEvent, id: string) {
    if (placed.has(id) || completed || dragging) {
      return;
    }
    const { x, y } = toSvgPoint(event.clientX, event.clientY);
    svgRef.current?.setPointerCapture(event.pointerId);
    setDragging({ id, x, y });
  }

  function handlePointerMove(event: ReactPointerEvent) {
    if (!dragging) {
      return;
    }
    const { x, y } = toSvgPoint(event.clientX, event.clientY);
    setDragging({ id: dragging.id, x, y });
  }

  function handlePointerUp() {
    if (!dragging) {
      return;
    }

    const feature = FEATURES.find((item) => item.id === dragging.id);
    if (!feature) {
      setDragging(null);
      return;
    }

    const [cx, cy] = feature.centroid;
    const distance = Math.hypot(dragging.x - cx, dragging.y - cy);
    const snapRadius = Math.max(bboxSize(feature) * 0.55, MIN_SNAP);

    if (distance <= snapRadius) {
      const next = new Set(placed);
      next.add(feature.id);
      setPlaced(next);
      setDragging(null);

      if (next.size === FEATURES.length) {
        setCompleted(true);
        const score = Math.max(0, FEATURES.length * 10 - mistakes * 5);
        window.setTimeout(() => {
          onComplete({
            score,
            correctCount: FEATURES.length,
            totalCount: FEATURES.length
          });
        }, 500);
      }
    } else {
      setMistakes((value) => value + 1);
      setDragging(null);
    }
  }

  function restart() {
    setPlaced(new Set());
    setMistakes(0);
    setCompleted(false);
    setDragging(null);
    setRound((value) => value + 1);
  }

  const draggingFeature = dragging
    ? FEATURES.find((item) => item.id === dragging.id)
    : null;

  return (
    <div className="puzzle">
      <header className="puzzle-header">
        <div>
          <h2>行政区拼图</h2>
          <p>把散乱的省级行政区拖回地图上的正确位置，松手后自动吸附。</p>
        </div>
        <div className="puzzle-stats">
          <span>
            已拼好 {placed.size} / {FEATURES.length}
          </span>
          <span>错误 {mistakes} 次</span>
          <button type="button" onClick={restart}>
            重新打乱
          </button>
        </div>
      </header>

      <svg
        ref={svgRef}
        className="puzzle-svg"
        viewBox={`0 0 ${VB_WIDTH} ${viewBoxHeight}`}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <g className="board">
          {FEATURES.map((feature) => {
            const active = dragging?.id === feature.id;
            const tiny = bboxSize(feature) < 22;
            return (
              <g key={feature.id}>
                <path
                  d={feature.d}
                  className={active ? "ghost ghost-active" : "ghost"}
                  fillRule="evenodd"
                />
                <text
                  x={feature.centroid[0]}
                  y={feature.centroid[1]}
                  className={tiny ? "ghost-label ghost-label-tiny" : "ghost-label"}
                >
                  {feature.name}
                </text>
              </g>
            );
          })}
        </g>

        <g className="placed">
          {FEATURES.map((feature) => {
            if (!placed.has(feature.id)) {
              return null;
            }
            return (
              <path
                key={feature.id}
                d={feature.d}
                fill={colorFor(FEATURES.indexOf(feature))}
                className="piece"
                fillRule="evenodd"
              />
            );
          })}
        </g>

        <g className="tray">
          {unplaced.map((id, index) => {
            const feature = FEATURES.find((item) => item.id === id);
            if (!feature) {
              return null;
            }
            const isSource = dragging?.id === id;
            const col = index % TRAY_COLS;
            const row = Math.floor(index / TRAY_COLS);
            const slotX = col * (TRAY_CELL_WIDTH + PAD);
            const slotY = TRAY_TOP + row * (TRAY_CELL_HEIGHT + PAD);
            const width = feature.bbox[2] - feature.bbox[0];
            const height = feature.bbox[3] - feature.bbox[1];
            const scale = Math.min(
              (TRAY_CELL_WIDTH - 18) / width,
              (TRAY_CELL_HEIGHT - LABEL_SPACE - 12) / height,
              1.3
            );
            const centerX = slotX + TRAY_CELL_WIDTH / 2;
            const centerY = slotY + (TRAY_CELL_HEIGHT - LABEL_SPACE) / 2;

            return (
              <g
                key={id}
                className={
                  isSource ? "tray-piece tray-piece-source" : "tray-piece"
                }
                onPointerDown={(event) => handlePointerDown(event, id)}
              >
                <rect
                  x={slotX}
                  y={slotY}
                  width={TRAY_CELL_WIDTH}
                  height={TRAY_CELL_HEIGHT}
                  className="tray-hit"
                />
                {!isSource && (
                  <>
                    <g
                      transform={`translate(${centerX},${centerY}) scale(${scale}) translate(${-feature.centroid[0]},${-feature.centroid[1]})`}
                    >
                      <path
                        d={feature.d}
                        fill={colorFor(FEATURES.indexOf(feature))}
                        fillRule="evenodd"
                      />
                    </g>
                    <text
                      x={slotX + TRAY_CELL_WIDTH / 2}
                      y={slotY + TRAY_CELL_HEIGHT - 8}
                      className="tray-label"
                    >
                      {feature.name}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </g>

        {dragging && draggingFeature && (
          <g className="dragging" pointerEvents="none">
            <path
              d={draggingFeature.d}
              fill={colorFor(FEATURES.indexOf(draggingFeature))}
              fillRule="evenodd"
              transform={`translate(${dragging.x - draggingFeature.centroid[0]},${dragging.y - draggingFeature.centroid[1]})`}
            />
            <text
              x={dragging.x}
              y={dragging.y}
              className="dragging-label"
            >
              {draggingFeature.name}
            </text>
          </g>
        )}
      </svg>

      {completed && (
        <div className="complete-overlay">
          <div className="complete-card">
            <h2>拼图完成！</h2>
            <p>你已把 {FEATURES.length} 个省级行政区全部拼回正确位置。</p>
            <p className="complete-score">
              得分 {Math.max(0, FEATURES.length * 10 - mistakes * 5)} · 错误{" "}
              {mistakes} 次
            </p>
            <button type="button" onClick={restart}>
              再玩一次
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
