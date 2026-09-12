/** 数据加载、地图投影、人格打分与地貌匹配 */

import type {
  Landform,
  MapMeta,
  Profile,
  Question,
  QuizResult,
  ScoredLandform
} from "./types";

/* ------------------------- 运行时数据加载 ------------------------- */

/**
 * 所有数据都放在 web 根目录的 data/ 与 assets/ 下，用相对路径按需加载。
 * 这样「新增一个地貌」只要改 JSON + 丢一张图，不用重新构建，也不用改代码。
 */
export function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

export async function loadJson<T>(path: string): Promise<T> {
  const res = await fetch(assetUrl(path), { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`加载 ${path} 失败（HTTP ${res.status}）`);
  }
  return (await res.json()) as T;
}

/* ------------------------- 地图投影（与 scripts/prepare_maps.py 完全一致） ------------------------- */

const RAD = Math.PI / 180;

export type Projector = (lat: number, lon: number) => [number, number];

export function makeProjector(meta: MapMeta): Projector {
  if (meta.projection === "lambert-conic-conformal") {
    const { phi1, phi2, phi0, lam0 } = meta.params;
    const p1 = phi1 * RAD;
    const p2 = phi2 * RAD;
    const n =
      Math.abs(p1 - p2) < 1e-9
        ? Math.sin(p1)
        : Math.log(Math.cos(p1) / Math.cos(p2)) /
          Math.log(Math.tan(Math.PI / 4 + p2 / 2) / Math.tan(Math.PI / 4 + p1 / 2));
    const F = (Math.cos(p1) * Math.pow(Math.tan(Math.PI / 4 + p1 / 2), n)) / n;
    const rho0 = F / Math.pow(Math.tan(Math.PI / 4 + (phi0 * RAD) / 2), n);
    return (lat, lon) => {
      const phi = lat * RAD;
      const rho = F / Math.pow(Math.tan(Math.PI / 4 + phi / 2), n);
      const th = n * (lon * RAD - lam0 * RAD);
      // 与生成脚本一致：圆锥投影 y 向北增大，屏幕 y 向南增大，故取 rho*cos - rho0
      return [
        rho * Math.sin(th) * meta.scale - meta.offset[0],
        (rho * Math.cos(th) - rho0) * meta.scale - meta.offset[1]
      ];
    };
  }
  const latMin = meta.params.latMin;
  const latMax = meta.params.latMax;
  return (lat, lon) => {
    const c = Math.min(Math.max(lat, latMin), latMax);
    return [
      lon * RAD * meta.scale - meta.offset[0],
      -c * RAD * meta.scale - meta.offset[1]
    ];
  };
}

/* ------------------------- 打分 ------------------------- */

/** 每道题在每个维度上「理论上可达到的最大绝对值」之和，作为归一化分母 */
function dimensionCeilings(questions: Question[], dimKeys: string[]): Record<string, number> {
  const ceil: Record<string, number> = {};
  for (const d of dimKeys) {
    let sum = 0;
    for (const q of questions) {
      let local = 0;
      for (const o of q.options) {
        local = Math.max(local, Math.abs(o.delta[d] ?? 0));
      }
      sum += local;
    }
    ceil[d] = sum || 1;
  }
  return ceil;
}

/**
 * 把作答折算成五维画像（每维 0-100）。
 * 说明：极端选项很少会被全部选中，若直接按理论上限归一会把所有人都挤在 50 附近，
 * 因此乘一个 0.62 的折扣系数，让回答明确的人真正跑向两端。
 */
export function buildVector(
  questions: Question[],
  answers: number[],
  dimKeys: string[]
): Profile {
  const ceil = dimensionCeilings(questions, dimKeys);
  const raw: Record<string, number> = {};
  for (const d of dimKeys) raw[d] = 0;
  questions.forEach((q, i) => {
    const opt = q.options[answers[i]];
    if (!opt) return;
    for (const d of dimKeys) raw[d] += opt.delta[d] ?? 0;
  });
  const out: Profile = {};
  for (const d of dimKeys) {
    const t = Math.max(-1, Math.min(1, raw[d] / (ceil[d] * 0.62)));
    out[d] = Math.round(50 + 50 * t);
  }
  return out;
}

/** 按五维欧氏距离把地貌从近到远排序 */
export function rankLandforms(
  vector: Profile,
  pool: Landform[],
  dimKeys: string[]
): ScoredLandform[] {
  const maxDist = Math.sqrt(dimKeys.length) * 100;
  return pool
    .map((landform) => {
      let sum = 0;
      for (const d of dimKeys) {
        const diff = (landform.profile[d] ?? 50) - vector[d];
        sum += diff * diff;
      }
      const distance = Math.sqrt(sum);
      const score = Math.max(30, Math.round(100 * (1 - distance / maxDist)));
      return { landform, distance, score };
    })
    .sort((a, b) => a.distance - b.distance || a.landform.id.localeCompare(b.landform.id));
}

export function makeResult(
  vector: Profile,
  pool: Landform[],
  dimKeys: string[]
): QuizResult {
  return { vector, ranked: rankLandforms(vector, pool, dimKeys) };
}

/** 生成可复制的文字结果 */
export function resultToText(
  landform: Landform,
  score: number,
  vector: Profile,
  dims: { key: string; name: string; lowLabel: string; highLabel: string }[]
): string {
  const lines = [
    `【地貌人格测试】我的性格像——${landform.name}（${landform.en}）`,
    `${landform.type} · ${landform.country} ${landform.region} · 匹配度 ${score}%`,
    "",
    landform.personality,
    "",
    "我的人格五维：",
    ...dims.map((d) => {
      const v = vector[d.key] ?? 50;
      const pole = v >= 50 ? d.highLabel : d.lowLabel;
      return `  ${d.name} ${v}  → 偏「${pole}」`;
    })
  ];
  return lines.join("\n");
}
