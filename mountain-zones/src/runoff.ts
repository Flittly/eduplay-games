/**
 * 地表径流：在真实 DEM 上做 D8 流向 + 流量累积，得到真实的水系。
 *
 * ## 为什么换成 D8
 *
 * 上一版是在二维剖面上「从山脊往两边撒水珠」，画出来的河流是几条平行斜线 ——
 * 看着就不像河。真实 DEM 自带真实的沟谷，只要按 D8 把每个格子的水送到
 * 八邻域中最陡的下游，再自高向低累积汇流量，**支流会自然汇成干流**，
 * 呈现出树枝状水系（dendritic drainage）—— 这是地形图上最漂亮也最真实的结构。
 *
 * ## 三个因素都参与
 *
 * - **降雨档位 × 季节降水强度**：决定总水量，进而决定「多大的沟才够格算河道」
 * - **植被覆盖**：产流权重 = 1 − 植被密度（植被越少，地表径流越强）
 * - **雪线以上不产流**：降水以固态为主，要等消融，当期不形成径流
 *
 * ## 关于洼地
 *
 * 真实 DEM 里存在少量闭合洼地（SRTM 噪声、或真实的内流湖）。这里不做填洼，
 * 水就在那里停住（`down = -1`）—— 对教学无碍，而且比「人为填平」更诚实。
 */

import type { DemField } from "./data/types";
import { beltAt, runoffWeight, type SeasonId } from "./zonation";

/** 各季节的降水强度（0~1），面板里的「雨」档位会再乘一遍 */
export const SEASON_RAIN: Record<SeasonId, number> = {
  spring: 0.45,
  summer: 0.9,
  autumn: 0.4,
  winter: 0.12
};

export interface RunoffNetwork {
  /** 汇流量（上游产流权重之和） */
  acc: Float32Array;
  /** 逐格产流权重（植被拦水、雪线归零都体现在这里），供诊断与断言 */
  prod: Float32Array;
  /** 下游格子索引，-1 表示无出流（边界或洼地） */
  down: Int32Array;
  maxAcc: number;
  /** 全山总产流量（面板读数） */
  totalProduced: number;
  /** 河道格子索引（阈值以上） */
  channels: Int32Array;
  /** 河道总长度（米） */
  channelLengthM: number;
  /** 最长的一条干流长度（米） */
  trunkLengthM: number;
  /** 本次实际使用的降雨强度（0~1），供 UI 回显 */
  rain: number;
}

const NEI: Array<[number, number, number]> = [
  [-1, -1, Math.SQRT2], [0, -1, 1], [1, -1, Math.SQRT2],
  [-1, 0, 1], [1, 0, 1],
  [-1, 1, Math.SQRT2], [0, 1, 1], [1, 1, Math.SQRT2]
];

const EMPTY: RunoffNetwork = {
  acc: new Float32Array(0),
  prod: new Float32Array(0),
  down: new Int32Array(0),
  maxAcc: 0,
  totalProduced: 0,
  channels: new Int32Array(0),
  channelLengthM: 0,
  trunkLengthM: 0,
  rain: 0
};

/**
 * 建水系。
 *
 * @param rainScale 降雨档位系数（0 = 无雨，1 = 大雨），再乘季节降水强度
 */
export function buildRunoff(
  field: DemField,
  lat: number,
  season: SeasonId,
  rainScale: number
): RunoffNetwork {
  const g = field.grid;
  const n = g * g;
  const h = field.alt;
  const cellM = field.spanM / (g - 1);
  const rain = Math.max(0, Math.min(1, rainScale)) * SEASON_RAIN[season];
  if (rain <= 1e-6) {
    return { ...EMPTY, rain: 0 };
  }

  // ---------- 1. 每个格子的产流权重 ----------
  const prod = new Float32Array(n);
  let totalProduced = 0;
  for (let k = 0; k < n; k++) {
    const w = runoffWeight(lat, h[k], season, field.maxH) * rain;
    prod[k] = w;
    totalProduced += w;
  }

  // ---------- 2. D8 流向 ----------
  const down = new Int32Array(n).fill(-1);
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      const k = j * g + i;
      const self = h[k];
      let bestSlope = 0;
      let best = -1;
      for (const [di, dj, dist] of NEI) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= g || nj >= g) {
          continue;
        }
        const nk = nj * g + ni;
        const slope = (self - h[nk]) / dist;
        if (slope > bestSlope) {
          bestSlope = slope;
          best = nk;
        }
      }
      down[k] = best; // < 0 表示这是个洼地 / 边界最低点
    }
  }

  // ---------- 3. 自高向低累积 ----------
  const idx = new Array<number>(n);
  for (let k = 0; k < n; k++) {
    idx[k] = k;
  }
  idx.sort((a, b) => h[b] - h[a]);

  const acc = new Float32Array(n);
  acc.set(prod);
  for (let q = 0; q < n; q++) {
    const k = idx[q];
    const d = down[k];
    if (d >= 0) {
      acc[d] += acc[k];
    }
  }
  let maxAcc = 0;
  for (let k = 0; k < n; k++) {
    if (acc[k] > maxAcc) maxAcc = acc[k];
  }

  // ---------- 4. 定河道阈值 ----------
  // 阈值取 maxAcc 的一个比例：雨越大，越小的沟也能成河 → 支流越多
  //
  // 守卫：整座山都在雪线以上（或全程无雨）时 totalProduced = 0 → maxAcc = 0 →
  // thr 也是 0，而 `acc[k] >= 0` 恒真，**会把全部 65536 个格子都判成河道**。
  // 必须显式要求 maxAcc > 0，并且逐格还要有真实汇流（acc > 0）。
  const ratio = 0.006 + 0.030 * (1 - Math.max(0, Math.min(1, rainScale)));
  const thr = maxAcc * ratio;
  const chIdx: number[] = [];
  if (maxAcc > 0) {
    for (let k = 0; k < n; k++) {
      if (acc[k] > 0 && acc[k] >= thr) {
        chIdx.push(k);
      }
    }
  }

  // ---------- 5. 河道长度统计 ----------
  const isChannel = new Uint8Array(n);
  for (const k of chIdx) {
    isChannel[k] = 1;
  }
  let channelLengthM = 0;
  let trunkLengthM = 0;
  const depth = new Float32Array(n); // 从源头起算的河道长度
  for (let q = 0; q < n; q++) {
    const k = idx[q];
    const d = down[k];
    if (isChannel[k] && d >= 0 && isChannel[d]) {
      const len = Math.hypot((d % g) - (k % g), Math.floor(d / g) - Math.floor(k / g)) * cellM;
      channelLengthM += len;
      depth[d] = Math.max(depth[d], depth[k] + len);
    }
  }
  for (const k of chIdx) {
    if (depth[k] > trunkLengthM) {
      trunkLengthM = depth[k];
    }
  }

  return {
    acc,
    prod,
    down,
    maxAcc,
    totalProduced,
    channels: Int32Array.from(chIdx),
    channelLengthM,
    trunkLengthM,
    rain
  };
}

/**
 * 把河网转成可渲染的线段（网格坐标，[x1,y1,x2,y2, ...]）。
 *
 * 每条线段是「河道格子 → 它的下游格子」，且都是单段 ——
 * 三维里直接画成 LineSegments，不拼长折线（拼了反而不好按流向做动画）。
 */
export function channelSegments(net: RunoffNetwork, grid: number): Float32Array {
  if (net.channels.length === 0) {
    return new Float32Array(0);
  }
  const isChannel = new Uint8Array(grid * grid);
  for (const k of net.channels) {
    isChannel[k] = 1;
  }
  const segs: number[] = [];
  for (const k of net.channels) {
    const d = net.down[k];
    if (d < 0 || !isChannel[d]) {
      continue;
    }
    segs.push(k % grid, Math.floor(k / grid), d % grid, Math.floor(d / grid));
  }
  return Float32Array.from(segs);
}

/** 面板读数 */
export function runoffSummary(net: RunoffNetwork): string {
  if (net.rain <= 0) {
    return "无降雨，暂不产流";
  }
  if (net.totalProduced <= 0) {
    // 有雨但一点水都没产出来 —— 只可能是全山都在雪线以上（降水以固态为主）。
    // 早先这里统一报「无降雨」，把"雪线抬到了山顶"说成了"没下雨"，是误导。
    return "降水以固态为主，暂不形成径流（全山在雪线以上）";
  }
  return `河网总长 ${(net.channelLengthM / 1000).toFixed(1)} km · 干流 ${(net.trunkLengthM / 1000).toFixed(1)} km · 河道 ${net.channels.length} 段`;
}

/** 雪线以上的格子不产流 —— 供测试断言用 */
export function producesRunoffAt(lat: number, alt: number, season: SeasonId): boolean {
  return beltAt(lat, alt, season) !== "snow";
}
