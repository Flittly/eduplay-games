/**
 * 底部等高线栏的三个视图（canvas 2D 绘制）。
 *
 * 三视图共用同一份 `alt` 高程场与同一批 `ContourLevel`，
 * 所以「平面图上的某条线」与「三维地表上的那条线」在数值上必然是同一个高度 ——
 * 这是刻意保证的：学生把平面图的 3200 m 圈和三维里的线对起来时不会对不上。
 *
 * 视觉沿用整体的粗野派纸面：米色底、实墨线、方正无圆角。
 */

import type { DemField } from "./data/types";
import type { ContourLevel } from "./contour";
import { labelAnchor, longestPolyline } from "./contour";
import { beltAt, beltColor, beltDef, bandsFor, type Band, type SeasonId } from "./zonation";

const PAPER = "#f4eedf";
const PAPER_DARK = "#e6dcc6";
const INK = "#1f1b16";
const INK_SOFT = "#6f6353";
const RED = "#b41f16";
const BLUE = "#2a6f9e";

/**
 * 字号档位：**必须与 src/styles.css 的 `:root` 一一对应**。
 *
 * canvas 读不到 CSS 变量（`getComputedStyle(...).getPropertyValue("--fs-xs")` 每帧解析、
 * 且首帧可能拿不到值），所以这里镜像一份常量。两边一致性由
 * `scripts/typography.test.cjs` 机器校验 —— 改了 CSS 忘了改这里会直接判红，
 * 不会出现"右栏字变大、图里的字没变"这种半拉子状态。
 *
 * ⚠️ canvas 的字号是**设备无关像素**（`setup()` 里已经 `setTransform(dpr, ...)`），
 * 所以直接用 CSS 的 px 数值，不需要再乘 dpr。
 */
const FS = {
  "2xs": 11.5,
  xs: 13,
  sm: 14.5,
  md: 15.5,
  lg: 17,
  xl: 21,
  "2xl": 24
} as const;

function setup(canvas: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } | null {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 4 || h < 4) {
    return null;
  }
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext("2d");
  if (!g) {
    return null;
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.lineJoin = "round";
  g.lineCap = "round";
  return { g, w, h };
}

/** 十六进制 → rgba 字符串 */
function rgba(hex: string, a: number): string {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

/* ------------------------------------------------------------------ */
/* 视图一：平面等高线地形图                                            */
/* ------------------------------------------------------------------ */

/** 平面图的右栏图廓要素（宽屏时才有位置画） */
interface PlanLegendOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  field: DemField;
  lat: number;
  season: SeasonId;
  interval: number;
  majorEvery: number;
  contourCount: number;
  peakName?: string;
}

/**
 * 平面图右侧的图廓要素：自然带图例（**带海拔区间**，三维舞台那份图例没有）、
 * 本图说明、符号例。
 *
 * 为什么必须有这块：这一栏是 1100×230 的"矮宽"区域，而地形窗口是正方形 ——
 * 正方形居中摆放时只占 15% 宽度，左右都是空白，看着像界面没画完。
 * 把这些要素放上去既不浪费宽度，也确实是地形图该有的东西。
 */
function drawPlanLegend(g: CanvasRenderingContext2D, o: PlanLegendOptions): void {
  const ZH = "'Microsoft YaHei','Noto Sans SC',sans-serif";
  const MONO = "ui-monospace,Consolas,monospace";
  const cols = o.w >= 760 ? 3 : o.w >= 500 ? 2 : 1;
  const gap = 30;
  const colW = (o.w - gap * (cols - 1)) / cols;
  const colX = (i: number) => o.x + i * (colW + gap);

  const heading = (x: number, y: number, t: string): number => {
    g.fillStyle = INK;
    g.font = `700 ${FS.md}px ${ZH}`;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(t, x, y);
    const tw = g.measureText(t).width;
    g.strokeStyle = "rgba(31,27,22,0.30)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x + tw + 8, y + 0.5);
    g.lineTo(x + colW, y + 0.5);
    g.stroke();
    return y + 19;
  };

  // ---- 第 1 栏：自然带图例（含海拔区间）----
  let y = heading(colX(0), o.y + 8, "自然带（含海拔区间）");
  for (const b of bandsFor(o.lat, o.season, o.field.maxH)) {
    if (y > o.y + o.h - 4) {
      break;
    }
    const def = beltDef(b.belt);
    g.fillStyle = beltColor(b.belt, o.season);
    g.fillRect(colX(0), y - 5, 11, 11);
    g.strokeStyle = "rgba(31,27,22,0.55)";
    g.lineWidth = 1;
    g.strokeRect(colX(0) + 0.5, y - 4.5, 10, 10);
    g.fillStyle = INK;
    g.font = `400 ${FS.sm}px ${ZH}`;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(def.short, colX(0) + 17, y);
    g.fillStyle = INK_SOFT;
    g.font = `400 ${FS.xs}px ${MONO}`;
    g.textAlign = "right";
    g.fillText(`${Math.round(b.from)}–${Math.round(b.to)} m`, colX(0) + colW, y);
    g.textAlign = "left";
    y += 19;
  }

  if (cols < 2) {
    return;
  }

  // ---- 第 2 栏：本图说明 ----
  const rowAt = (x: number, yy: number, label: string, value: string) => {
    g.fillStyle = INK_SOFT;
    g.font = `400 ${FS.sm}px ${ZH}`;
    g.textAlign = "left";
    g.fillText(label, x, yy);
    g.fillStyle = INK;
    g.font = `700 ${FS.sm}px ${MONO}`;
    g.textAlign = "right";
    g.fillText(value, x + colW, yy);
    g.textAlign = "left";
  };
  const pk = o.field.alt[o.field.peakJ * o.field.grid + o.field.peakI];
  let y2 = heading(colX(1), o.y + 8, "本图说明");
  for (const [k, v] of [
    ["等高距 / 计曲线", `${o.interval} m / 每 ${o.majorEvery} 条`],
    ["等高线条数", `${o.contourCount} 条`],
    ["图幅", `${(o.field.spanM / 1000).toFixed(0)} km 见方`],
    ["网格", `${o.field.grid} × ${o.field.grid}`],
    ["当前海拔范围", `${Math.round(o.field.minH)}–${Math.round(o.field.maxH)} m`],
    [o.peakName ? `峰顶 · ${o.peakName}` : "峰顶", `${Math.round(pk)} m`]
  ] as Array<[string, string]>) {
    if (y2 > o.y + o.h - 4) {
      break;
    }
    rowAt(colX(1), y2, k, v);
    y2 += 19;
  }

  if (cols < 3) {
    return;
  }

  // ---- 第 3 栏：符号例（学生把平面图和三维地表对起来全靠它）----
  let y3 = heading(colX(2), o.y + 8, "符号");
  const sym = (draw: () => void, text: string) => {
    if (y3 > o.y + o.h - 4) {
      return;
    }
    draw();
    g.fillStyle = INK_SOFT;
    g.font = `400 ${FS.sm}px ${ZH}`;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(text, colX(2) + 30, y3);
    y3 += 18;
  };
  const cx3 = colX(2);
  sym(() => {
    g.strokeStyle = "rgba(31,27,22,0.34)";
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(cx3, y3);
    g.lineTo(cx3 + 20, y3);
    g.stroke();
  }, "等高线");
  sym(() => {
    g.strokeStyle = "rgba(31,27,22,0.86)";
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(cx3, y3);
    g.lineTo(cx3 + 20, y3);
    g.stroke();
  }, "计曲线（每 5 条）");
  sym(() => {
    g.fillStyle = "rgba(150,88,52,0.62)";
    g.beginPath();
    g.arc(cx3 + 10, y3, 2.4, 0, Math.PI * 2);
    g.fill();
  }, "山脊（TPI 高分位）");
  sym(() => {
    g.strokeStyle = "rgba(42,111,158,0.9)";
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(cx3, y3);
    g.lineTo(cx3 + 20, y3);
    g.stroke();
  }, "水系（D8 汇流）");
  sym(() => {
    g.fillStyle = RED;
    g.beginPath();
    g.moveTo(cx3 + 10, y3 - 4.5);
    g.lineTo(cx3 + 15.5, y3 + 4);
    g.lineTo(cx3 + 4.5, y3 + 4);
    g.closePath();
    g.fill();
  }, "峰顶");
}

export interface PlanOptions {
  field: DemField;
  contours: ContourLevel[];
  lat: number;
  season: SeasonId;
  /** 等高距（用于区分计曲线与高程注记） */
  interval: number;
  /** 是否为计曲线（每 5 条一条）加粗并注记 */
  majorEvery: number;
  /** 河道线段（网格坐标 [x1,y1,x2,y2,...]），可为空 */
  channels?: Float32Array;
  /** 山脊点（网格坐标 [x,y,...]），可为空 */
  ridges?: Float32Array;
  /** 是否画出「自然带配色」底图 */
  showBands: boolean;
  /** 主峰名（右栏图例里注一行"峰顶 · 贡嘎山主峰"） */
  peakName?: string;
}

export function drawPlanMap(canvas: HTMLCanvasElement, o: PlanOptions): void {
  const s = setup(canvas);
  if (!s) {
    return;
  }
  const { g, w, h } = s;
  const { field } = o;
  const n = field.grid;

  g.clearRect(0, 0, w, h);
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, h);

  // 方形绘图区，四周留出注记与标尺的位置
  const pad = 16;
  // 等高线栏是"矮而宽"的一栏（约 1100×230），而地形窗口是正方形 ——
  // 早先把正方形居中摆放，结果地图只占 15% 宽度、左右一大片空白，看着像没画完。
  // 所以宽屏时改成「地图靠左 + 右侧图廓要素（图例 / 本图说明）」，把宽度用起来。
  const natural = Math.min(w - pad * 2, h - pad * 2 - 14);
  const wide = w >= 620;
  const side = wide
    ? Math.min(natural, Math.max(132, w * 0.28), h - pad * 2 - 14)
    : natural;
  const ox = wide ? pad : (w - side) / 2;
  const oy = (h - side) / 2 - 6;
  const sx = (i: number) => ox + (i / (n - 1)) * side;
  const sy = (j: number) => oy + (j / (n - 1)) * side;

  // ---- 右栏：图例（自然带 + 海拔区间）与本图说明 ----
  if (wide) {
    drawPlanLegend(g, {
      x: ox + side + 22,
      y: Math.max(pad, oy),
      w: w - (ox + side + 22) - pad,
      h: side,
      field,
      lat: o.lat,
      season: o.season,
      interval: o.interval,
      majorEvery: o.majorEvery,
      contourCount: o.contours.length
    });
  }

  // ---- 底图：按自然带淡色填充（用低分辨率块，够看就行） ----
  if (o.showBands) {
    const blocks = 96;
    const bw = side / blocks;
    for (let bj = 0; bj < blocks; bj++) {
      for (let bi = 0; bi < blocks; bi++) {
        const gi = Math.round((bi + 0.5) / blocks * (n - 1));
        const gj = Math.round((bj + 0.5) / blocks * (n - 1));
        const alt = field.alt[gj * n + gi];
        const belt = beltAt(o.lat, alt, o.season);
        g.fillStyle = rgba(beltColor(belt, o.season), 0.34);
        g.fillRect(ox + bi * bw - 0.5, oy + bj * bw - 0.5, bw + 1, bw + 1);
      }
    }
  } else {
    // 裸地形：按高程做很淡的明暗
    const blocks = 96;
    const bw = side / blocks;
    for (let bj = 0; bj < blocks; bj++) {
      for (let bi = 0; bi < blocks; bi++) {
        const gi = Math.round((bi + 0.5) / blocks * (n - 1));
        const gj = Math.round((bj + 0.5) / blocks * (n - 1));
        const t = (field.alt[gj * n + gi] - field.minH) / Math.max(1, field.maxH - field.minH);
        const v = 0.74 + 0.2 * t;
        g.fillStyle = `rgb(${Math.round(v * 250)},${Math.round(v * 244)},${Math.round(v * 232)})`;
        g.fillRect(ox + bi * bw - 0.5, oy + bj * bw - 0.5, bw + 1, bw + 1);
      }
    }
  }

  // ---- 等高线 ----
  const majorSpan = Math.max(1, Math.round(o.majorEvery)) * o.interval;
  for (const lv of o.contours) {
    const isMajor = Math.abs(Math.round(lv.level / majorSpan) * majorSpan - lv.level) < 1e-6;
    g.strokeStyle = isMajor ? "rgba(31,27,22,0.86)" : "rgba(31,27,22,0.34)";
    g.lineWidth = isMajor ? 1.5 : 0.8;
    g.beginPath();
    for (const p of lv.polylines) {
      const pts = p.pts;
      g.moveTo(sx(pts[0]), sy(pts[1]));
      for (let k = 2; k < pts.length; k += 2) {
        g.lineTo(sx(pts[k]), sy(pts[k + 1]));
      }
      if (p.closed) {
        g.closePath();
      }
    }
    g.stroke();
  }

  // ---- 山脊（红棕点）与河道（蓝线） ----
  if (o.ridges && o.ridges.length) {
    g.fillStyle = "rgba(150,88,52,0.62)";
    const r = Math.max(0.7, side / 420);
    for (let k = 0; k < o.ridges.length; k += 2) {
      g.beginPath();
      g.arc(sx(o.ridges[k]), sy(o.ridges[k + 1]), r, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (o.channels && o.channels.length) {
    g.strokeStyle = "rgba(42,111,158,0.9)";
    g.lineWidth = Math.max(1, side / 340);
    g.beginPath();
    for (let k = 0; k < o.channels.length; k += 4) {
      g.moveTo(sx(o.channels[k]), sy(o.channels[k + 1]));
      g.lineTo(sx(o.channels[k + 2]), sy(o.channels[k + 3]));
    }
    g.stroke();
  }

  // ---- 计曲线的高程注记 ----
  // 峰顶标注最后才画、而且必须看得见，所以先把它的落点**预留**下来，
  // 让高程注记绕开它 —— 否则注记垫的那层纸色会正好把一个数字盖掉。
  const pkX = sx(field.peakI);
  const pkY = sy(field.peakJ);
  g.font = `700 ${FS.xs}px ui-sans-serif, system-ui, sans-serif`;
  const pkLabel = `▲ ${Math.round(field.maxH)} m`;
  const pkW = g.measureText(pkLabel).width;

  // 已占用的文字框（含垫底纸色）。注记之间也会互相压（实测 6000 被 7000 盖住 66%），
  // 字号放大后更明显 ⇒ 放不下的直接不画：一个被盖住的数字本来就等于没画。
  const placed: Array<[number, number, number, number]> = [
    [pkX + 8, pkY - 8, pkX + 8 + pkW + 6, pkY + 7]
  ];
  const isFree = (b: [number, number, number, number]): boolean =>
    !placed.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);

  g.font = `600 ${FS.xs}px ui-monospace, Menlo, Consolas, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const lv of o.contours) {
    const isMajor = Math.abs(Math.round(lv.level / majorSpan) * majorSpan - lv.level) < 1e-6;
    if (!isMajor) {
      continue;
    }
    const p = longestPolyline(lv);
    if (!p) {
      continue;
    }
    const a = labelAnchor(p, 4);
    if (!a) {
      continue;
    }
    const px = sx(a.x);
    const py = sy(a.y);
    if (px < ox + 6 || px > ox + side - 6 || py < oy + 6 || py > oy + side - 6) {
      continue;
    }
    const text = `${Math.round(lv.level)}`;
    const tw = g.measureText(text).width;
    const box: [number, number, number, number] = [px - tw / 2 - 2, py - 7, px + tw / 2 + 2, py + 6];
    if (!isFree(box)) {
      continue;
    }
    placed.push(box);
    // 给文字垫一层纸色，压住线，避免数字和线糊在一起
    g.fillStyle = rgba(PAPER, 0.86);
    g.fillRect(box[0], box[1], tw + 4, 13);
    g.fillStyle = INK;
    g.fillText(text, px, py);
  }

  // ---- 峰顶标记 ----
  // 复用上面预留的 pk* —— 位置和文字只在一处算，改了一边不会和预留框对不上。
  const px = pkX;
  const py = pkY;
  g.strokeStyle = RED;
  g.fillStyle = RED;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(px, py - 6);
  g.lineTo(px - 5, py + 4);
  g.lineTo(px + 5, py + 4);
  g.closePath();
  g.fill();
  g.font = `700 ${FS.xs}px ui-sans-serif, system-ui, sans-serif`;
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillStyle = rgba(PAPER, 0.9);
  g.fillRect(px + 8, py - 8, pkW + 6, 15);
  g.fillStyle = RED;
  g.fillText(pkLabel, px + 11, py);

  // ---- 指北针 ----
  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.lineWidth = 1.4;
  const nx = ox + side - 16;
  const ny = oy + 18;
  g.beginPath();
  g.moveTo(nx, ny - 11);
  g.lineTo(nx - 5, ny + 6);
  g.lineTo(nx, ny + 2);
  g.lineTo(nx + 5, ny + 6);
  g.closePath();
  g.fill();
  g.font = `700 ${FS["2xs"]}px ui-sans-serif, system-ui, sans-serif`;
  g.textAlign = "center";
  g.fillText("N", nx, ny + 16);

  // ---- 比例尺 ----
  const barKm = 10;
  const barPx = (barKm / field.source.spanKm) * side;
  const bx = ox + 14;
  const by = oy + side - 12;
  g.strokeStyle = INK;
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(bx, by);
  g.lineTo(bx + barPx, by);
  g.stroke();
  g.beginPath();
  g.moveTo(bx, by - 4); g.lineTo(bx, by + 4);
  g.moveTo(bx + barPx, by - 4); g.lineTo(bx + barPx, by + 4);
  g.stroke();
  g.font = `600 ${FS["2xs"]}px ui-sans-serif, system-ui, sans-serif`;
  g.textAlign = "left";
  g.textBaseline = "bottom";
  // 垫一层纸色 —— 和海拔注记用同一套语言。
  // 不垫的话比例尺文字直接压在地形明暗与等高线上，会被线穿过（放大后"10 km"糊成一团）。
  const barLabel = `${barKm} km`;
  const barLw = g.measureText(barLabel).width;
  g.fillStyle = rgba(PAPER, 0.9);
  g.fillRect(bx + 2, by - 6 - FS["2xs"], barLw + 4, FS["2xs"] + 3);
  g.fillStyle = INK;
  g.fillText(barLabel, bx + 4, by - 5);

  // ---- 外框 ----
  g.strokeStyle = INK;
  g.lineWidth = 2;
  g.strokeRect(ox, oy, side, side);
}

/* ------------------------------------------------------------------ */
/* 视图三：垂直剖面图                                                  */
/* ------------------------------------------------------------------ */

export interface ProfileOptions {
  field: DemField;
  /** 剖面路径（网格坐标序列），一般取「山麓 → 峰顶」的登山路线 */
  route: Array<[number, number]>;
  lat: number;
  season: SeasonId;
  /** 等高距（画水平参考线） */
  interval: number;
  bands: Band[];
  snowlineNow: number;
  treeline: number;
  /** 光标处对应的路径参数 t ∈ [0,1]，画一条指示线；null 表示不画 */
  cursorT?: number | null;
}

export function drawProfile(canvas: HTMLCanvasElement, o: ProfileOptions): void {
  const s = setup(canvas);
  if (!s) {
    return;
  }
  const { g, w, h } = s;
  const { field } = o;

  g.clearRect(0, 0, w, h);
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, h);

  const padL = 52;
  const padR = 18;
  const padT = 16;
  const padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  if (plotW < 20 || plotH < 20 || o.route.length < 2) {
    return;
  }

  // ---- 沿路径采样：累计水平距离 + 海拔 ----
  const n = field.grid;
  const cellM = field.spanM / (n - 1);
  const dists: number[] = [0];
  const alts: number[] = [];
  for (let k = 0; k < o.route.length; k++) {
    const [i, j] = o.route[k];
    alts.push(field.alt[Math.round(j) * n + Math.round(i)]);
    if (k > 0) {
      const [pi, pj] = o.route[k - 1];
      dists.push(dists[k - 1] + Math.hypot(i - pi, j - pj) * cellM);
    }
  }
  const totalM = Math.max(1, dists[dists.length - 1]);
  const lo = field.minH;
  const hi = field.maxH;
  const span = Math.max(1, hi - lo);

  const X = (m: number) => padL + (m / totalM) * plotW;
  const Y = (alt: number) => padT + plotH - ((alt - lo) / span) * plotH;

  // ---- 横向网格（每 1000 m 一条） ----
  g.strokeStyle = "rgba(31,27,22,0.16)";
  g.lineWidth = 1;
  const gridStep = span > 6000 ? 2000 : 1000;
  const first = Math.ceil(lo / gridStep) * gridStep;
  g.font = `600 ${FS["2xs"]}px ui-monospace, Menlo, Consolas, monospace`;
  g.fillStyle = INK_SOFT;
  g.textAlign = "right";
  g.textBaseline = "middle";
  for (let a = first; a <= hi; a += gridStep) {
    const y = Y(a);
    g.beginPath();
    g.moveTo(padL, y);
    g.lineTo(padL + plotW, y);
    g.stroke();
    g.fillText(`${a}`, padL - 6, y);
  }

  // ---- 地形填充：按自然带分色 ----
  g.save();
  g.beginPath();
  g.moveTo(X(dists[0]), Y(alts[0]));
  for (let k = 1; k < alts.length; k++) {
    g.lineTo(X(dists[k]), Y(alts[k]));
  }
  g.lineTo(X(totalM), padT + plotH);
  g.lineTo(X(0), padT + plotH);
  g.closePath();
  g.clip();
  // 逐段画带色（沿路径逐点取带，段内取中点判定）
  for (let k = 1; k < alts.length; k++) {
    const belt = beltAt(o.lat, (alts[k - 1] + alts[k]) / 2, o.season);
    g.fillStyle = beltColor(belt, o.season);
    const x0 = X(dists[k - 1]);
    const x1 = X(dists[k]);
    g.fillRect(x0 - 0.5, padT, x1 - x0 + 1, plotH);
  }
  g.restore();

  // ---- 地形轮廓 ----
  g.strokeStyle = INK;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(X(dists[0]), Y(alts[0]));
  for (let k = 1; k < alts.length; k++) {
    g.lineTo(X(dists[k]), Y(alts[k]));
  }
  g.stroke();

  // ---- 雪线 / 林线 ----
  const drawMarker = (alt: number, color: string, text: string, dashed: boolean) => {
    if (alt <= lo || alt >= hi) {
      return;
    }
    const y = Y(alt);
    g.strokeStyle = color;
    g.lineWidth = 1.6;
    g.setLineDash(dashed ? [6, 4] : []);
    g.beginPath();
    g.moveTo(padL, y);
    g.lineTo(padL + plotW, y);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = color;
    g.font = `700 ${FS["2xs"]}px ui-sans-serif, system-ui, sans-serif`;
    g.textAlign = "left";
    g.textBaseline = "bottom";
    g.fillText(text, padL + 4, y - 2);
  };
  drawMarker(o.snowlineNow, BLUE, `雪线 ${Math.round(o.snowlineNow)} m`, false);
  drawMarker(o.treeline, "#3f6b3a", `林线 ${Math.round(o.treeline)} m`, true);

  // ---- 各自然带的海拔区间（右侧竖排标签） ----
  g.font = `600 ${FS["2xs"]}px ui-sans-serif, system-ui, sans-serif`;
  g.textAlign = "right";
  g.textBaseline = "middle";
  for (const b of o.bands) {
    const yTop = Y(Math.min(b.to, hi));
    const yBot = Y(Math.max(b.from, lo));
    if (yBot - yTop < 13) {
      continue; // 太窄的带放不下字，跳过（反正平面图与清单里有）
    }
    const x = padL + plotW - 6;
    g.fillStyle = "rgba(244,238,223,0.82)";
    const t = `${Math.round(b.from)}–${Math.round(b.to)}`;
    const tw = g.measureText(t).width;
    g.fillRect(x - tw - 4, (yTop + yBot) / 2 - 7, tw + 6, 14);
    g.fillStyle = INK;
    g.fillText(t, x, (yTop + yBot) / 2);
  }

  // ---- 光标指示线 ----
  if (o.cursorT != null && o.cursorT >= 0 && o.cursorT <= 1) {
    const m = o.cursorT * totalM;
    const x = X(m);
    g.strokeStyle = RED;
    g.lineWidth = 1.4;
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(x, padT);
    g.lineTo(x, padT + plotH);
    g.stroke();
    g.setLineDash([]);
  }

  // ---- 坐标轴 ----
  g.strokeStyle = INK;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(padL, padT);
  g.lineTo(padL, padT + plotH);
  g.lineTo(padL + plotW, padT + plotH);
  g.stroke();
  g.fillStyle = INK;
  g.font = `600 ${FS["2xs"]}px ui-sans-serif, system-ui, sans-serif`;
  g.textAlign = "left";
  g.textBaseline = "top";
  g.fillText("海拔 m", padL + 4, padT + 2);
  g.textAlign = "right";
  g.textBaseline = "bottom";
  g.fillText(`水平距离 ${(totalM / 1000).toFixed(1)} km（山麓 → 峰顶）`, padL + plotW, padT + plotH + 20);
}

/* ------------------------------------------------------------------ */
/* 共享小工具                                                          */
/* ------------------------------------------------------------------ */

/** 把稀疏点集转成 Float32Array（供平面图绘制脊线） */
export function packPoints(pts: number[]): Float32Array {
  return Float32Array.from(pts);
}

/** 图层开关的按钮文案 */
export const PLAN_LAYER_LABEL = {
  bands: "自然带底图",
  ridges: "山脊线",
  channels: "水系"
} as const;

export { PAPER, PAPER_DARK, INK, INK_SOFT, RED, BLUE };
