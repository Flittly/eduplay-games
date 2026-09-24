/**
 * 等高线提取：marching squares。
 *
 * 用途有三处，都从同一份高程场出发，保证三处显示的是同一条线：
 *  1. 3D 视图的地表等值线（这里算出来的高度参数喂给 shader）
 *  2. 平面等高线地形图（把 polylines 画成俯视图）
 *  3. 垂直剖面图（参考线的刻度）
 *
 * 为什么自己写而不是用 three.js 的等值线示例：那套是"把等值线当作 3D 线段"渲染，
 * 和我们要的"平面图 + 清单 + 剖面"三视图对不上；而且我们要按**显示高度**
 * （= 真实 DEM × 垂直夸张 + 偏移）取线，而不是按原始 DEM。
 *
 * 实现要点：
 * - 标准 15 情况查表；两个鞍点情况（case 5 / 10）用中心值做消歧，
 *   否则相邻等值线会在鞍部交叉、连成 X 形。
 * - 端点用「量化坐标」做 key 精确配对 —— marching squares 在同一条网格边上
 *   的插值结果逐位相同，所以能无误差拼接成折线（不需要做模糊匹配）。
 */

export interface ContourPolyline {
  /** 网格坐标下的折线点，[x0,y0, x1,y1, ...] */
  pts: Float32Array;
  closed: boolean;
  /** 折线包络盒，供标注定位用 */
  bbox: [number, number, number, number];
}

export interface ContourLevel {
  level: number;
  polylines: ContourPolyline[];
  /** 该高度上的总线段数（面板显示"共 N 条"用） */
  segCount: number;
  /** 该高度圈的近似周长（网格单位），用来挑"最值得标注"的那条 */
  totalLen: number;
}

type HeightFn = (i: number, j: number) => number;

const KEY_SCALE = 1e5;

function keyOf(x: number, y: number): string {
  return `${Math.round(x * KEY_SCALE)}:${Math.round(y * KEY_SCALE)}`;
}

/**
 * 提取单条等值线。
 *
 * @param h    高程取值函数（网格索引 → 米）
 * @param n    网格边长（格点数，格子数是 n-1）
 * @param level 等值线高度（米）
 */
export function extractContour(h: HeightFn, n: number, level: number): ContourLevel {
  const segs: number[] = []; // [x1,y1,x2,y2, ...]

  // 边的参数化：给出该边与 level 的交点
  // 边 0 = 上(a→b) / 1 = 右(b→c) / 2 = 下(d→c，注意方向) / 3 = 左(a→d)
  const edgePoint = (
    e: number,
    i: number,
    j: number,
    a: number, b: number, c: number, d: number
  ): [number, number] => {
    let t: number;
    switch (e) {
      case 0: t = (level - a) / (b - a); return [i + t, j];
      case 1: t = (level - b) / (c - b); return [i + 1, j + t];
      case 2: t = (level - d) / (c - d); return [i + t, j + 1];
      default: t = (level - a) / (d - a); return [i, j + t];
    }
  };

  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = h(i, j);
      const b = h(i + 1, j);
      const c = h(i + 1, j + 1);
      const d = h(i, j + 1);

      let mask = 0;
      if (a >= level) mask |= 1;
      if (b >= level) mask |= 2;
      if (c >= level) mask |= 4;
      if (d >= level) mask |= 8;
      if (mask === 0 || mask === 15) {
        continue;
      }

      const push = (e1: number, e2: number) => {
        const [x1, y1] = edgePoint(e1, i, j, a, b, c, d);
        const [x2, y2] = edgePoint(e2, i, j, a, b, c, d);
        segs.push(x1, y1, x2, y2);
      };

      switch (mask) {
        case 1: case 14: push(3, 0); break;
        case 2: case 13: push(0, 1); break;
        case 3: case 12: push(3, 1); break;
        case 4: case 11: push(1, 2); break;
        case 6: case 9: push(0, 2); break;
        case 7: case 8: push(2, 3); break;
        case 5:
        case 10: {
          // 鞍点：用中心值决定这一格里的等高线是「连左上-右下」还是「连右上-左下」
          const center = (a + b + c + d) / 4;
          const centerHigh = center >= level;
          if (mask === 5) {
            if (centerHigh) { push(3, 0); push(1, 2); }
            else { push(3, 2); push(0, 1); }
          } else {
            if (centerHigh) { push(0, 1); push(2, 3); }
            else { push(0, 3); push(1, 2); }
          }
          break;
        }
        default: break;
      }
    }
  }

  // ---- 线段 → 折线：端点精确配对 ----
  const ends = new Map<string, number[]>();
  const segCount = segs.length / 4;
  for (let s = 0; s < segCount; s++) {
    const x1 = segs[s * 4], y1 = segs[s * 4 + 1], x2 = segs[s * 4 + 2], y2 = segs[s * 4 + 3];
    const k1 = keyOf(x1, y1);
    const k2 = keyOf(x2, y2);
    if (!ends.has(k1)) ends.set(k1, []);
    if (!ends.has(k2)) ends.set(k2, []);
    ends.get(k1)!.push(s);
    ends.get(k2)!.push(s);
  }

  /** 一条线段的"另一端" */
  const otherEnd = (s: number, kx: number, ky: number): [number, number] => {
    const x1 = segs[s * 4], y1 = segs[s * 4 + 1];
    return keyOf(x1, y1) === keyOf(kx, ky) ? [segs[s * 4 + 2], segs[s * 4 + 3]] : [x1, y1];
  };

  const used = new Uint8Array(segCount);
  const polylines: ContourPolyline[] = [];
  let totalLen = 0;

  const walk = (startSeg: number, startX: number, startY: number, closed: boolean) => {
    const pts: number[] = [startX, startY];
    let seg = startSeg;
    let cx = startX, cy = startY;
    let len = 0;
    for (;;) {
      used[seg] = 1;
      const [nx, ny] = otherEnd(seg, cx, cy);
      pts.push(nx, ny);
      len += Math.hypot(nx - cx, ny - cy);
      cx = nx; cy = ny;
      const cand = ends.get(keyOf(cx, cy)) || [];
      let next = -1;
      for (const s of cand) {
        if (!used[s]) { next = s; break; }
      }
      if (next < 0) break;
      seg = next;
      if (closed && keyOf(cx, cy) === keyOf(startX, startY)) break;
    }
    totalLen += len;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = 0; k < pts.length; k += 2) {
      if (pts[k] < minX) minX = pts[k];
      if (pts[k] > maxX) maxX = pts[k];
      if (pts[k + 1] < minY) minY = pts[k + 1];
      if (pts[k + 1] > maxY) maxY = pts[k + 1];
    }
    polylines.push({
      pts: Float32Array.from(pts),
      closed,
      bbox: [minX, minY, maxX, maxY]
    });
  };

  // 先走开放链（端点数 = 1 的点），再走剩下的闭合环
  for (const [k, list] of ends) {
    if (list.length !== 1) continue;
    const s = list[0];
    if (used[s]) continue;
    const [sx, sy] = k.split(":").map(Number);
    walk(s, sx / KEY_SCALE, sy / KEY_SCALE, false);
  }
  for (let s = 0; s < segCount; s++) {
    if (used[s]) continue;
    const x1 = segs[s * 4], y1 = segs[s * 4 + 1];
    // 沿两端各走一次，取更长的那条（闭合环两个方向都能走通）
    const before = polylines.length;
    walk(s, x1, y1, true);
    if (polylines.length > before && polylines[polylines.length - 1].pts.length < 6) {
      // 太短的碎片直接丢弃（噪声）
      polylines.pop();
    }
  }

  const kept = polylines.filter((p) => p.pts.length >= 6);
  return { level, polylines: kept, segCount, totalLen };
}

/** 一批高度的等值线（面板「共 N 条」与平面图都用它） */
export function extractAll(h: HeightFn, n: number, levels: number[]): ContourLevel[] {
  return levels.map((lv) => extractContour(h, n, lv));
}

/**
 * 按等高距列出高度序列。
 *
 * 从 `base` 的第一条整倍线开始（默认 0 起），直到 `maxH`。
 * 用 `Math.floor` 而不是 `Math.round`，保证 base=0 时 1000 m 一定在列。
 */
export function levelsFor(minH: number, maxH: number, interval: number, base = 0): number[] {
  if (!(interval > 0) || !(maxH > minH)) {
    return [];
  }
  const first = Math.ceil((minH - base) / interval) * interval + base;
  const out: number[] = [];
  for (let v = first; v <= maxH + 1e-9; v += interval) {
    out.push(Math.round(v * 1000) / 1000);
  }
  return out;
}

/**
 * 等高距候选档（米）。
 *
 * 必须与界面 chip 行**同源** —— 两边各写一份的话，一旦自动落档落到了
 * 界面没列的档位，就会出现"一个 chip 都没亮着"的状态。
 *
 * 下探到 20 m 是因为新增的**平原样本**：华北平原 30 km 内高差只有 40 m，
 * 而这一版之前最小档是 100 m ⇒ 一条等高线都画不出来，平面图是一片空白。
 */
export const CONTOUR_INTERVAL_STEPS = [20, 50, 100, 200, 500, 1000];

/** 想要几条线：低于这个数就认为"没画出东西" */
export const CONTOUR_MIN_LEVELS = 3;

/**
 * 按样本自动落一档等高距。
 *
 * 山峰（贡嘎 2204~7414 m）用 200 m 一档正好出 26 条；
 * 同一个 200 m 用在平原上出 **0 条**。所以换地形时要检查当前档位够不够用：
 * 不够就落到"仍能出 ≥ `CONTOUR_MIN_LEVELS` 条线"里**最粗**的那一档
 * （线太少也不好看，太密则糊成一片）。
 *
 * 放在 `contour.ts` 而不是 `engine.ts`，是为了能 Node 单测 ——
 * engine 依赖 three.js 与 DOM，进不了纯逻辑测试。
 */
export function pickContourInterval(minH: number, maxH: number, preferred: number): number {
  const count = (iv: number) => levelsFor(minH, maxH, iv, 0).length;
  if (count(preferred) >= CONTOUR_MIN_LEVELS) {
    return preferred;
  }
  const ok = [...CONTOUR_INTERVAL_STEPS]
    .sort((a, b) => b - a)
    .filter((iv) => count(iv) >= CONTOUR_MIN_LEVELS);
  return ok.length ? ok[0] : CONTOUR_INTERVAL_STEPS[0];
}

/** 给某一层挑一条「最值得标注」的折线（最长的那条） */export function longestPolyline(lv: ContourLevel): ContourPolyline | null {
  let best: ContourPolyline | null = null;
  let bestLen = -1;
  for (const p of lv.polylines) {
    const ptCount = p.pts.length / 2;
    if (ptCount > bestLen) { bestLen = ptCount; best = p; }
  }
  return best;
}

/**
 * 在折线上取一个适合放高程注记的位置与角度。
 *
 * 取点规则：在折线的一段上找**最平缓**（近似水平或竖直，最好别是 45° 斜线）的窗口，
 * 这样注记文字摆下去不会跟线打架。返回网格坐标与弧度角。
 */
export function labelAnchor(
  p: ContourPolyline,
  win = 4
): { x: number; y: number; angle: number } | null {
  const cnt = p.pts.length / 2;
  if (cnt < win + 1) {
    return null;
  }
  let best = -1;
  let bestScore = -1;
  const mid = Math.floor(cnt / 2);
  const span = Math.min(mid, Math.floor(cnt * 0.25));
  for (let k = Math.max(0, mid - span); k + win < cnt && k <= mid + span; k++) {
    const x0 = p.pts[k * 2], y0 = p.pts[k * 2 + 1];
    const x1 = p.pts[(k + win) * 2], y1 = p.pts[(k + win) * 2 + 1];
    const dx = x1 - x0, dy = y1 - y0;
    const angle = Math.atan2(dy, dx);
    // 越接近水平（0 / π）得分越高
    const horiz = Math.abs(Math.cos(angle));
    if (horiz > bestScore) { bestScore = horiz; best = k; }
  }
  if (best < 0) {
    return null;
  }
  const x0 = p.pts[best * 2], y0 = p.pts[best * 2 + 1];
  const x1 = p.pts[(best + win) * 2], y1 = p.pts[(best + win) * 2 + 1];
  return {
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    angle: Math.atan2(y1 - y0, x1 - x0)
  };
}

/**
 * 山脊 / 山谷线识别（TPI 法，Topographic Position Index）。
 *
 * ## 为什么不用「垂直于最陡下降方向比较两侧」
 *
 * 那个判据看着很对，实际在**脊顶失效**：山脊线自己就是局部最高，
 * 梯度在那里正好消失（左右对称），代码会走进 `mag < 1e-6 → continue`，
 * 于是最该被标成山脊的点反而被全部跳过。同理谷底。
 *
 * ## TPI 的判据
 *
 * `TPI = h(自己) − mean(半径 R 的菱形邻域)`。
 * 比自己周围高 → 凸（脊）；比自己周围低 → 凹（谷）。
 * 这个量在脊顶、谷底都有定义，不受梯度消失影响，
 * 而且阈值可以按米来给，物理意义清楚（「比周边平均高 4 米以上才算脊」）。
 *
 * 返回稀疏点集（网格坐标，[i,j,i,j,...]），调用方自行连接或打点绘制。
 */
/**
 * 绘制山脊/山谷时默认使用的 TPI 阈值（米）。
 *
 * **这个值必须给大，给中位数是错的。** 曾经按「中位数附近」取 22 m，
 * 结果标出了 **25%** 的格子 —— 因为阈值取在中位数上，等于把正半轴的一半全部选中。
 * 「肉眼在山体上认得出的那几条脊」对应的是**高分位**，不是中位数。
 *
 * 四座真实 DEM 上实测的 |TPI| 分位（半径 3 格）：
 *
 * | 阈值 | 贡嘎 | 珠峰 | 梅里 | 太白 | 均值 |
 * | --- | --- | --- | --- | --- | --- |
 * | 40 m | 14.96% | 12.80% | 15.61% | 19.00% | 15.59% |
 * | 60 m | 8.12% | 7.84% | 8.14% | 9.25% | 8.34% |
 * | **70 m** | **5.82%** | **6.02%** | **5.68%** | **5.85%** | **5.84%** |
 * | 100 m | 2.01% | 2.61% | 1.71% | 1.02% | 1.84% |
 *
 * 取 70 m（≈ 四山的 p90，贡嘎实测 p90 = 65.8 m）：四座山都落在 5.7%~6.0%，
 * 跨山一致性好；平面上是 1 px 小点、62% 透明度，密度刚好读出"脊线纹理"
 * 又不至于糊掉下面的等高线。取 100 m 只剩 2%，脊线断断续续认不出来。
 *
 * ⚠️ `ridgeValley(h, n, thresh, radius)` 的**第 4 个参数是邻域半径**，默认 3 格。
 * 真机回归抓到过：调用处一度把半径也写成了 22 —— 邻域一放大到 2.6 km，
 * TPI 就从"局部凸凹"退化成"区域坡度"，同一阈值下脊点从 25% 飙到 44.5%。
 * 阈值只有一个，半径用默认值，别顺手多传一个。
 */
export const RIDGE_TPI = 70;

export function ridgeValley(h: HeightFn, n: number, thresh = 4, radius = 3): {
  ridge: number[];
  valley: number[];
} {
  const ridge: number[] = [];
  const valley: number[] = [];
  const R = radius;
  for (let j = R; j < n - R; j++) {
    for (let i = R; i < n - R; i++) {
      const self = h(i, j);
      let sum = 0;
      let cnt = 0;
      for (let dj = -R; dj <= R; dj++) {
        for (let di = -R; di <= R; di++) {
          const d = Math.abs(di) + Math.abs(dj);
          if (d === 0 || d > R) {
            continue;
          }
          sum += h(i + di, j + dj);
          cnt++;
        }
      }
      const tpi = self - sum / cnt;
      if (tpi > thresh) {
        ridge.push(i, j);
      } else if (tpi < -thresh) {
        valley.push(i, j);
      }
    }
  }
  return { ridge, valley };
}

/** 网格双线性采样（允许分数索引，越界按边缘钳制） */
export function bilerp(h: HeightFn, n: number, x: number, y: number): number {
  const cx = Math.max(0, Math.min(n - 1, x));
  const cy = Math.max(0, Math.min(n - 1, y));
  const i0 = Math.floor(cx);
  const j0 = Math.floor(cy);
  const i1 = Math.min(n - 1, i0 + 1);
  const j1 = Math.min(n - 1, j0 + 1);
  const fx = cx - i0;
  const fy = cy - j0;
  return (
    h(i0, j0) * (1 - fx) * (1 - fy) +
    h(i1, j0) * fx * (1 - fy) +
    h(i0, j1) * (1 - fx) * fy +
    h(i1, j1) * fx * fy
  );
}
