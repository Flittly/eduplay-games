/**
 * 地形部位识别与地形类型判据。
 *
 * ## 五类「地形部位」= 人教版等高线地形图的五个山体部位
 *
 * 山峰、山脊、山谷、鞍部、陡崖。**盆地不在其中** —— 盆地是「地形类型」
 * （平原 / 高原 / 山地 / 丘陵 / 盆地），两者不是同一个分类维度：
 * 部位回答"这块地形的哪个局部"，类型回答"这片区域整体算什么地貌"。
 * 混淆的后果是学生把"鞍部"和"盆地"当成并列概念去背。
 *
 * ## 每条判据都要能对回教科书那一句
 *
 * 本模块的每个判据都尽量写成教科书的**几何定义**，而不是"看起来像"的启发式：
 *
 * | 部位 | 教科书形态 | 本模块的判据 |
 * |---|---|---|
 * | 山峰 | 等高线闭合、数值由外向内增大 | 窗口内最高 + 相对周边起伏足够（见 `PEAK_*`） |
 * | 山脊 | 等高线凸向低处，脊线为分水线 | TPI 高分位（`contour.ts` 的 `RIDGE_TPI`，实测 p90） |
 * | 山谷 | 等高线凸向高处，谷线为集水线 | TPI 低分位（同阈值取负） |
 * | 鞍部 | 两峰之间相对低洼处，两侧等高线各自闭合 | **最大生成树**上两峰之间的 key col |
 * | 陡崖 | 多条等高线重叠在一起 | 单格内穿过 ≥2 条 100 m 参考等高线（`CLIFF_REF_INTERVAL`） |
 *
 * 鞍部那一条值得多说一句：**"两峰之间最低处"这个说法是错的**，
 * 按它实现会在两峰之间连一条直线取最低点 —— 而那条直线往往会穿过一条山谷，
 * 于是找到的是谷底而不是垭口。正确的地貌学定义是
 * **key col（最低通道上的最高点）**：所有连接两峰的路径中，先取每条路径上的最低点，
 * 再取这些最低点的最大值。等价的经典算法是「最大生成树」——
 *
 *   1. 把网格看成图，边权 `w(u,v) = min(h(u), h(v))`（两格中较低的那一格的海拔）；
 *   2. 求最大生成树；
 *   3. 两峰在树上的路径中，权重最小的那条边就是鞍部，其权值就是鞍部海拔。
 *
 * 这棵树就是地形学里的「merge tree」，鞍部海拔的物理含义一目了然：
 * **水位逐渐上涨时，两座峰所在的两个"岛"第一次连成一片的水位**。
 * 山谷穿越的情形会被自动排除 —— 因为一定存在一条不经过该山谷的更高路径。
 *
 * ## 纯函数
 *
 * 只吃 `(h, n, …)`，不碰 `DemField`、不碰 DOM，所以能直接 Node 单测。
 */

import { ridgeValley, RIDGE_TPI } from "./contour";

type HeightFn = (i: number, j: number) => number;

/* ------------------------------------------------------------------ */
/* 五类地形部位                                                        */
/* ------------------------------------------------------------------ */

export type LandPartId = "peak" | "ridge" | "valley" | "saddle" | "cliff";

export interface LandPartDef {
  id: LandPartId;
  name: string;
  /** 等高线图上的形态（课本上要背的那一句） */
  form: string;
  /** 本程序凭什么把它从 DEM 里找出来 */
  rule: string;
}

export const LAND_PARTS: LandPartDef[] = [
  {
    id: "peak",
    name: "山峰",
    form: "等高线闭合，数值由外向内增大",
    rule: "窗口内最高，且比周边最低点高出一定幅度"
  },
  {
    id: "ridge",
    name: "山脊",
    form: "等高线凸向低处；脊线是分水线",
    rule: `TPI（比菱形邻域平均值高）≥ ${RIDGE_TPI} m`
  },
  {
    id: "valley",
    name: "山谷",
    form: "等高线凸向高处；谷线是集水线",
    rule: `TPI ≤ −${RIDGE_TPI} m`
  },
  {
    id: "saddle",
    name: "鞍部",
    form: "两峰之间相对低洼处，两侧等高线各自闭合",
    rule: "最大生成树上两峰的 key col（最低通道上的最高点）"
  },
  {
    id: "cliff",
    name: "陡崖",
    form: "多条等高线重叠在一起",
    // ⚠️ 四个数字必须与 CLIFF_REF_INTERVAL / CLIFF_MIN_SLOPE_DEG / CLIFF_SLOPE_CAP_DEG /
    // CLIFF_WINDOW_RADIUS 一致（窗口落差上限由格距推导，不写成常数，故不出现在文案里）。
    // 这里写死字面量、不用模板字符串，是因为常量声明在本数组之后（会踩 TDZ）。
    // 一致性由 scripts/landform.test.cjs 的 "判据文案与常量一致" 一项机器守住。
    rule:
      "单格内穿过 ≥2 条 100 m 参考等高线（即等高线重叠），坡度 65°~80°；" +
      "再把 80° 这个上限用到 ±1 格窗口上（2 格跨度内落差 ≤ 2×格距×tan80°），挡 SRTM 空洞填充"
  }
];

export function landPartDef(id: LandPartId): LandPartDef {
  return LAND_PARTS.find((p) => p.id === id) ?? LAND_PARTS[0];
}

/* ------------------------------------------------------------------ */
/* 山峰                                                                */
/* ------------------------------------------------------------------ */

/** 非极大抑制窗口半径（格）。30 km / 255 格 ≈ 118 m/格，6 格 ≈ 0.7 km */
export const PEAK_NMS_RADIUS = 6;
/** 相对起伏的取样半径（格），12 格 ≈ 1.4 km */
export const PEAK_RELIEF_RADIUS = 12;
/**
 * 相对起伏阈值 = `max(PEAK_RELIEF_MIN, PEAK_RELIEF_FRAC × 全图高差)`。
 *
 * **必须按全图高差的比例给，不能给绝对值。** 山峰是个*相对*概念：
 * 华北平原上一处比周围高 40 m 的土丘在地图上根本不叫山峰，
 * 而贡嘎山里比周围高 40 m 的地方遍地都是。按比例给，
 * 平原自然就找不出山峰（这正是符合直觉的结论），高山也只挑得出真正的峰。
 */
export const PEAK_RELIEF_FRAC = 0.22;
export const PEAK_RELIEF_MIN = 45;
/** 峰之间至少隔这么远（格），避免一座平顶山被标成十几个峰 */
export const PEAK_MIN_SEP = 9;
/** 最多标几个峰（鞍部是两两配对，峰多了组合爆炸且没教学意义） */
export const PEAK_MAX_COUNT = 6;

export interface PeakPoint {
  /** 网格坐标（整数格） */
  i: number;
  j: number;
  /** 海拔（米） */
  h: number;
}

export function findPeaks(h: HeightFn, n: number, opt: Partial<{
  nmsRadius: number;
  reliefRadius: number;
  reliefFrac: number;
  reliefMin: number;
  minSep: number;
  maxCount: number;
}> = {}): PeakPoint[] {
  const nmsRadius = opt.nmsRadius ?? PEAK_NMS_RADIUS;
  const reliefRadius = opt.reliefRadius ?? PEAK_RELIEF_RADIUS;
  const reliefFrac = opt.reliefFrac ?? PEAK_RELIEF_FRAC;
  const reliefMin = opt.reliefMin ?? PEAK_RELIEF_MIN;
  const minSep = opt.minSep ?? PEAK_MIN_SEP;
  const maxCount = opt.maxCount ?? PEAK_MAX_COUNT;
  if (n < 2 * reliefRadius + 3) {
    return [];
  }

  let gmin = Infinity;
  let gmax = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = h(i, j);
      if (v < gmin) gmin = v;
      if (v > gmax) gmax = v;
    }
  }
  const relief = gmax - gmin;
  const thresh = Math.max(reliefMin, reliefFrac * relief);

  const marg = Math.max(nmsRadius, reliefRadius) + 1;
  const cand: PeakPoint[] = [];
  for (let j = marg; j < n - marg; j++) {
    for (let i = marg; i < n - marg; i++) {
      const hv = h(i, j);
      let isMax = true;
      for (let dj = -nmsRadius; dj <= nmsRadius && isMax; dj++) {
        for (let di = -nmsRadius; di <= nmsRadius; di++) {
          if (di === 0 && dj === 0) continue;
          if (h(i + di, j + dj) > hv) {
            isMax = false;
            break;
          }
        }
      }
      if (!isMax) continue;
      let lo = Infinity;
      for (let dj = -reliefRadius; dj <= reliefRadius; dj++) {
        for (let di = -reliefRadius; di <= reliefRadius; di++) {
          const v = h(i + di, j + dj);
          if (v < lo) lo = v;
        }
      }
      if (hv - lo < thresh) continue;
      cand.push({ i, j, h: hv });
    }
  }

  cand.sort((a, b) => b.h - a.h);
  const kept: PeakPoint[] = [];
  for (const c of cand) {
    let ok = true;
    for (const k of kept) {
      if (Math.hypot(k.i - c.i, k.j - c.j) < minSep) {
        ok = false;
        break;
      }
    }
    if (ok) {
      kept.push(c);
      if (kept.length >= maxCount) break;
    }
  }
  return kept;
}

/* ------------------------------------------------------------------ */
/* 鞍部：最大生成树上的 key col                                        */
/* ------------------------------------------------------------------ */

export interface SaddlePoint {
  /** 鞍部位置（网格坐标，取最低通道那条边两端的中间，故为分数） */
  i: number;
  j: number;
  /** 鞍部海拔（米）= key col 的高度 */
  h: number;
  /** 两侧的峰 */
  a: PeakPoint;
  b: PeakPoint;
  /** 比低的那座峰低多少米（教学读数："鞍部比两侧山峰低 XXX m"） */
  drop: number;
  /** 两峰之间的水平距离（米） */
  distM: number;
}

/**
 * 鞍部下凹幅度阈值：`max(SADDLE_MIN_DROP, SADDLE_MIN_DROP_FRAC × 全图高差)`。
 *
 * 为什么按全图高差的比例（3%）而不是给绝对米数：同一个"像样的垭口"，
 * 在贡嘎山（高差 5200 m）下凹 200 m 很平淡，在太白山（高差 2900 m）下凹 200 m
 * 已经很显眼 —— 绝对阈值在两者之间必然有一头是错的。
 * 而两峰几乎不下降的情形（同一道脊上的两个小鼓包）本就不该算鞍部。
 */
export const SADDLE_MIN_DROP_FRAC = 0.03;
export const SADDLE_MIN_DROP = 25;

/**
 * 两峰之间距离超过这么远就不再看（格）。
 * 30 km / 255 格 ≈ 118 m/格，90 格 ≈ 10.6 km —— 图幅 30 km，
 * 再远的两个峰之间的"垭口"多半已经出图，标出来学生也找不到。
 */
export const SADDLE_MAX_SPAN = 90;

export function findSaddles(
  h: HeightFn,
  n: number,
  peaks: PeakPoint[],
  spanM: number
): SaddlePoint[] {
  if (peaks.length < 2) {
    return [];
  }

  // ---- 1) 最大生成树（Kruskal，边权 = min(两端海拔)） ----
  const nodes = n * n;
  const edgeCount = 2 * n * (n - 1);
  const eu = new Int32Array(edgeCount);
  const ev = new Int32Array(edgeCount);
  const ew = new Float32Array(edgeCount);
  let e = 0;
  // 只连右邻与下邻 —— 四邻域足以构造 merge tree，八邻域会把"对角可通行"算进来，
  // 让本该分成两个岛的缓坡从对角漏过去，鞍部高度被系统性压低。
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const hk = h(i, j);
      if (i + 1 < n) {
        const k2 = j * n + i + 1;
        eu[e] = k;
        ev[e] = k2;
        ew[e] = Math.min(hk, h(i + 1, j));
        e++;
      }
      if (j + 1 < n) {
        const k2 = (j + 1) * n + i;
        eu[e] = k;
        ev[e] = k2;
        ew[e] = Math.min(hk, h(i, j + 1));
        e++;
      }
    }
  }
  const order = new Array<number>(e);
  for (let s = 0; s < e; s++) order[s] = s;
  order.sort((a, b) => ew[b] - ew[a]);

  const parent = new Int32Array(nodes);
  const rank = new Uint8Array(nodes);
  for (let k = 0; k < nodes; k++) parent[k] = k;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    // 路径压缩
    let c = x;
    while (parent[c] !== r) {
      const nx = parent[c];
      parent[c] = r;
      c = nx;
    }
    return r;
  };

  // 树用邻接表存（每个结点最多 4 条边）
  const adjHead = new Int32Array(nodes).fill(-1);
  const adjNext: number[] = [];
  const adjTo: number[] = [];
  const adjW: number[] = [];
  const addEdge = (u: number, v: number, w: number) => {
    adjTo.push(v); adjW.push(w); adjNext.push(adjHead[u]); adjHead[u] = adjTo.length - 1;
    adjTo.push(u); adjW.push(w); adjNext.push(adjHead[v]); adjHead[v] = adjTo.length - 1;
  };

  let added = 0;
  for (let s = 0; s < e && added < nodes - 1; s++) {
    const id = order[s];
    const ru = find(eu[id]);
    const rv = find(ev[id]);
    if (ru === rv) continue;
    if (rank[ru] < rank[rv]) parent[ru] = rv;
    else if (rank[ru] > rank[rv]) parent[rv] = ru;
    else { parent[rv] = ru; rank[ru]++; }
    addEdge(eu[id], ev[id], ew[id]);
    added++;
  }

  // ---- 2) 两峰配对：树上路径里权重最小的那条边 = 鞍部 ----
  const prev = new Int32Array(nodes);
  const prevEdge = new Int32Array(nodes);
  const queue = new Int32Array(nodes);
  /** BFS 访问标记。用单调递增的戳而不是「0/1 布尔」——
   *  否则每对峰之间都要把 65536 个结点重置一遍，15 对就是 100 万次无用写。 */
  const seen = new Int32Array(nodes);
  let stamp = 0;

  const out: SaddlePoint[] = [];
  for (let x = 0; x < peaks.length; x++) {
    for (let y = x + 1; y < peaks.length; y++) {
      const pa = peaks[x];
      const pb = peaks[y];
      const distCells = Math.hypot(pa.i - pb.i, pa.j - pb.j);
      if (distCells > SADDLE_MAX_SPAN) continue;

      const sa = pa.j * n + pa.i;
      const sb = pb.j * n + pb.i;
      const mark = ++stamp;
      let qh = 0;
      let qt = 0;
      queue[qt++] = sa;
      seen[sa] = mark;
      prev[sa] = -1;
      let found = false;
      while (qh < qt && !found) {
        const u = queue[qh++];
        for (let p = adjHead[u]; p !== -1; p = adjNext[p]) {
          const v = adjTo[p];
          if (seen[v] === mark) continue;
          seen[v] = mark;
          prev[v] = u;
          prevEdge[v] = p;
          if (v === sb) { found = true; break; }
          queue[qt++] = v;
        }
      }
      if (!found) continue;

      // 回溯路径，找权重最小的那条边
      let bestW = Infinity;
      let bestP = -1;
      let cur = sb;
      while (prev[cur] !== -1) {
        const p = prevEdge[cur];
        if (adjW[p] < bestW) {
          bestW = adjW[p];
          bestP = p;
        }
        cur = prev[cur];
      }
      if (bestP < 0) continue;
      // addEdge 成对 push，所以 p 与 p^1 就是这条边的两个端点
      const u = adjTo[bestP];
      const v = adjTo[bestP ^ 1];
      const ui = u % n;
      const uj = (u - ui) / n;
      const vi = v % n;
      const vj = (v - vi) / n;
      const colH = Math.min(h(ui, uj), h(vi, vj));
      const lower = Math.min(pa.h, pb.h);
      out.push({
        i: (ui + vi) / 2,
        j: (uj + vj) / 2,
        h: colH,
        a: pa,
        b: pb,
        drop: lower - colH,
        distM: distCells * (spanM / (n - 1))
      });
    }
  }

  // ---- 3) 阈值 + 去重 ----
  // 阈值取「全图高差的 3%」：两峰之间几乎不下降的（同一道脊上的两个小鼓包）
  // 不该算鞍部。给绝对米数不行 —— 太白山与贡嘎山的"像样下凹"差了近一倍。
  let gmin = Infinity;
  let gmax = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const val = h(i, j);
      if (val < gmin) gmin = val;
      if (val > gmax) gmax = val;
    }
  }
  const dropFloor = Math.max(SADDLE_MIN_DROP, SADDLE_MIN_DROP_FRAC * (gmax - gmin));
  // 同一处垭口可能被多对峰共用（三条山脊交于一鞍），按位置合并、只留下凹最深的那个
  const sorted = out.filter((s) => s.drop >= dropFloor).sort((x, y) => y.drop - x.drop);
  const dedup: SaddlePoint[] = [];
  for (const s of sorted) {
    let dup = false;
    for (const k of dedup) {
      if (Math.hypot(k.i - s.i, k.j - s.j) < PEAK_MIN_SEP) {
        dup = true;
        break;
      }
    }
    if (!dup) dedup.push(s);
  }
  return dedup;
}

/* ------------------------------------------------------------------ */
/* 陡崖：等高线重叠                                                     */
/* ------------------------------------------------------------------ */

/**
 * 判定陡崖时使用的**参考等高距**（米）。
 *
 * 为什么不直接用界面上的等高距滑块值：陡崖是地形的客观属性，
 * 不该因为老师把等高距从 200 m 调到 100 m 就冒出来或消失。
 * 取 100 m 作为基准 —— 它既是常用等高距，也让"单格高差 ≥100 m"
 * 与"坡度 > 40°"（30 km/255 格 ≈ 118 m/格）在量级上对上。
 */
export const CLIFF_REF_INTERVAL = 100;
/**
 * 坡度下限（度）。低于这个角度只是"陡坡"，谈不上崖。
 *
 * 定 65° 是量出来的，不是拍的：四座真实 DEM 在 118 m 网格上
 * 用「单格穿过 ≥2 条 100 m 等高线」筛出的候选，各坡度段的分布是
 *
 * | 坡度段 | 贡嘎 | 珠峰 | 梅里 | 太白 |
 * |---|---|---|---|---|
 * | 30–40° | 1993 | 1000 | 2432 | 1820 |
 * | 40–50° | 4624 | 3868 | 6106 | 2865 |
 * | 50–60° | 2853 | 3560 | 3184 | 769 |
 * | 60–70° | 529 | 1019 | 339 | 37 |
 * | 70–80° | 179 | 101 | 13 | 0 |
 *
 * 取 30° 会标出全图 8~18% 的格子（那是"山坡"，不是陡崖），
 * 取 65° 之后每座山只剩几十到上千个格，再经抑制后落到十几处。
 */
export const CLIFF_MIN_SLOPE_DEG = 65;
/**
 * ⚠️ **第一道闸门：物理可能性的上限 80°。超过它的一律判为 DEM 数据异常，不计入陡崖。**
 *
 * 这一条是本期最要紧的发现，来龙去脉如下。
 *
 * 贡嘎山取景窗东北 6 km 处（网格 i 142–187 / j 61–80）有一批格子算出的
 * 单格落差达 **1300–2308 m**（坡度 84–86°），聚成 15 团。118 m 水平距离
 * 掉 2308 m 等于垂直墙 —— 物理上不成立。逐层取证：
 *
 * 1. **不是我们采样造的**：扒开缓存的原始瓦片，相邻 33 m 像素之间本身就
 *    落差 774 m（≈87°）；
 * 2. **是填充产物**：换到 z=14 瓦片（8.3 m/像素），该处海拔**精确重复为
 *    3459.000**，跨 1 km 以上一字不差。真实地形在 8 m 分辨率下不可能完全平整 ——
 *    那是 SRTM 空洞（陡坡 + 积雪失相干产生无值区）被填充成了常数；
 * 3. **同一个数据集里能找到真实上限**：珠峰的洛子峰壁实测最大 **80.0°**、
 *    梅里 77.2°，而 >80° 的格子贡嘎有 106 个、其余三座**一个都没有**。
 *
 * 所以 80° 是"这个数据集里真实最陡壁"的实测值，用它当闸门既有依据、
 * 又能把伪值挡在外面。**没有去做通用的数据清洗，是因为试过之后发现代价太大**：
 * 「平滑 + 偏低 + 周边粗糙」这套判据会把珠峰的冰川表面（322 km²）、
 * 太白山北侧的渭河平原（100 km²）一起当空洞 —— 冰川本来就平滑。
 *
 * 剔除的数量不隐藏，由 `CliffScan.suspect` 如实报出，界面上照实显示。
 */
export const CLIFF_SLOPE_CAP_DEG = 80;
/**
 * ⚠️ **第二道闸门：同一坡度上限，在「±1 格窗口」上再卡一次。**
 *
 * 单看一格是不够的 —— 空洞缝在重采样之后会被"摊成阶梯"：源数据里的一步跳变，
 * 到 118 m 网格上变成连续 2~4 格、每格掉 ~600 m，**每一格都落在 80° 以内**。
 *
 * ⚠️ 这里**没有**第二个绝对米数常数。曾经写过 `CLIFF_MAX_QUAD_DROP = 950`，
 * 那是错的，两个原因：
 *
 * 1. **绝对米数不是分辨率无关的**。格距是变量（真山 118 m、平原样本可能几百米），
 *    500 m 格距上一道真实的 1500 m 崖会被 950 m 一刀切掉；
 * 2. **它恒真、是死代码**。坡度取的是四边形 6 条边的最大值，其中已含两条对角线，
 *    所以 `slopeDeg ≤ 80°` 蕴含 `quadDrop ≤ cellM·√2·tan80°`（118 m ⇒ 946 m，
 *    恰好就是原来那个 950）。判据永远不触发，却看着像在把关。
 *
 * 正确的写法是**由几何推导**：真实地形任一尺度上的坡度都不超过 80°，
 * 那么水平跨度 `2·winR·cellM` 的窗口里，落差就不可能超过
 * `2·winR·cellM·tan80°`。118 m 格距、winR=1 ⇒ **1338 m**。
 *
 * 这个推导值也过了实测：四座山陡格的窗口高差，真值上限 1146 m（珠峰北壁）、
 * 贡嘎空洞缝的伪值下限 1584 m —— 1338 m 正好落在这段空档里。
 */
export const CLIFF_WINDOW_RADIUS = 1;

/**
 * ⚠️ **第三道闸门：单格落差上限 1400 m —— 这一条是分辨率无关的。**
 *
 * 上面那条"窗口落差 ≤ 跨度×tan80°"是**纯几何**推导，它只保证"角度不超 80°"，
 * 挡不住"一整格就是一面崖"。合成反例（`scripts/landform.test.cjs` ②）：
 * 500 m 格距上，中间一格掉 2335 m ⇒ 角度 77.9°（合法）、
 * 窗口落差 2335 m < 2×500×tan80° = 5671 m（也合法）⇒ **闸门全过，假崖被留下**。
 *
 * 缺的那条物理事实是：**崖是有高度的**，不是"可以无限陡的坡"。
 * 地球上最高的近垂直岩壁也就 1000~1400 m 量级
 * （Great Trango 约 1340 m、洛子峰壁约 1100 m、鲁帕尔壁虽更高但平均坡度只有 50° 上下）。
 * 所以「一格之内能掉的米数」有一个与格距**无关**的绝对上限。
 *
 * 实测校准：四座真山单格落差最大 863 m（珠峰洛子峰壁）< 1400 m ⇒ 不误杀；
 * 贡嘎空洞缝 1600~2308 m、合成窄缝 2335 m ⇒ 全部拦下。
 *
 * 注意它与坡度上限**不是**冗余的：坡度上限只保证
 * `单格落差 ≤ 格距×√2×tan80°`，格距一大（500 m ⇒ 4000 m）就形同虚设，
 * 所以必须有这条绝对上限兜底。反过来在 118 m 格距上它确实是松弛的
 * （几何上限 946 m < 1400 m），那时真正起作用的是坡度门槛。
 */
export const CLIFF_MAX_CELL_DROP = 1400;

/** 由格距与坡度上限推出的窗口落差上限（米）。绝对不许再写成一个固定数字。 */
export function cliffWindowDropMax(
  cellM: number,
  slopeCapDeg: number = CLIFF_SLOPE_CAP_DEG,
  winR: number = CLIFF_WINDOW_RADIUS
): number {
  return 2 * winR * cellM * Math.tan((slopeCapDeg * Math.PI) / 180);
}
/**
 * 两道闸门**只作用于已经成为陡崖候选的格子**（只占全图 0.1%~0.5%），
 * 所以不会像全局数据清洗那样误伤平原和冰川表面 —— 那些地方根本没有候选格。
 * 被剔除的数量不隐藏，由 `CliffScan` 的计数如实报出：
 * 实测贡嘎剔 135 格，珠峰 / 梅里 / 太白 **各 0 格**，
 * 所以 `suspect > 0` 本身就是"这张 DEM 有空洞填充"的最干净信号。
 */
/** 最多标几处（图上画多了就成一片红，反而看不出哪里是崖） */
export const CLIFF_MAX_COUNT = 16;
/** 抑制半径（格）。太密会把一整面陡壁标成一串点 */
export const CLIFF_NMS_RADIUS = 4;

export interface CliffPoint {
  /** 网格坐标（格子中心，故为分数） */
  i: number;
  j: number;
  /** 该格内的中间海拔 */
  h: number;
  /** 该格内的最大坡度（度） */
  slopeDeg: number;
  /** 该格内的最大高差（米） */
  drop: number;
  /** 该格内穿过的参考等高线条数（≥2 即"等高线重叠"） */
  lines: number;
}

export interface CliffScan {
  /** 通过全部判据、抑制后保留的陡崖点 */
  cliffs: CliffPoint[];
  /** 坡度超过物理上限而被剔除的格数 —— DEM 数据异常，不计入陡崖 */
  suspectSlope: number;
  /** 单格高差或窗口高差超过物理上限而被剔除的格数 —— 同上 */
  suspectDrop: number;
  /** 被物理闸门剔除的总格数（= suspectSlope + suspectDrop，方便界面上直接显示） */
  suspect: number;
  /** 通过判据的候选总数（抑制前） */
  candidates: number;
}

export function findCliffs(h: HeightFn, n: number, cellM: number, opt: Partial<{
  refInterval: number;
  minSlopeDeg: number;
  slopeCapDeg: number;
  windowRadius: number;
  maxCellDrop: number;
  maxCount: number;
  nmsRadius: number;
}> = {}): CliffScan {
  const refInterval = opt.refInterval ?? CLIFF_REF_INTERVAL;
  const minSlopeDeg = opt.minSlopeDeg ?? CLIFF_MIN_SLOPE_DEG;
  const slopeCapDeg = opt.slopeCapDeg ?? CLIFF_SLOPE_CAP_DEG;
  const winR = opt.windowRadius ?? CLIFF_WINDOW_RADIUS;
  const maxCount = opt.maxCount ?? CLIFF_MAX_COUNT;
  const nmsRadius = opt.nmsRadius ?? CLIFF_NMS_RADIUS;
  if (!(cellM > 0) || n < 3) {
    return { cliffs: [], suspectSlope: 0, suspectDrop: 0, suspect: 0, candidates: 0 };
  }
  const minTan = Math.tan((minSlopeDeg * Math.PI) / 180);
  /** 窗口落差上限由格距几何推出，不是固定米数（见 `cliffWindowDropMax` 的注释） */
  const windowDropMax = cliffWindowDropMax(cellM, slopeCapDeg, winR);
  const maxCellDrop = opt.maxCellDrop ?? CLIFF_MAX_CELL_DROP;
  /**
   * 以 (i,j) 为中心、半径 winR 的方形窗口内的高差（最高 − 最低）。
   * 越界按边缘夹取 —— 与 `scripts/landform.test.cjs` 的量测口径完全一致。
   */
  const windowDrop = (ci: number, cj: number): number => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let dj = -winR; dj <= winR; dj++) {
      const jj = cj + dj < 0 ? 0 : cj + dj > n - 1 ? n - 1 : cj + dj;
      for (let di = -winR; di <= winR; di++) {
        const ii = ci + di < 0 ? 0 : ci + di > n - 1 ? n - 1 : ci + di;
        const v = h(ii, jj);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    return hi - lo;
  };
  const cand: CliffPoint[] = [];
  let suspectSlope = 0;
  let suspectDrop = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = h(i, j);
      const b = h(i + 1, j);
      const c = h(i, j + 1);
      const d = h(i + 1, j + 1);
      const qmin = Math.min(a, b, c, d);
      const qmax = Math.max(a, b, c, d);
      // 单格内穿过几条参考等高线：floor(max/ref) − floor(min/ref)
      const lines = Math.floor(qmax / refInterval) - Math.floor(qmin / refInterval);
      if (lines < 2) continue;
      const tan = Math.max(
        Math.abs(b - a) / cellM,
        Math.abs(c - a) / cellM,
        Math.abs(d - b) / cellM,
        Math.abs(d - c) / cellM,
        Math.abs(d - a) / (cellM * Math.SQRT2),
        Math.abs(c - b) / (cellM * Math.SQRT2)
      );
      const slopeDeg = (Math.atan(tan) * 180) / Math.PI;
      if (slopeDeg < minSlopeDeg) continue;
      // 闸门 ①：单格坡度超过物理上限 ⇒ DEM 异常
      if (slopeDeg > slopeCapDeg) {
        suspectSlope++;
        continue;
      }
      // 闸门 ②：同一上限在 ±1 格窗口（2 格跨度）上再卡一次 ——
      //         拦下"被重采样摊成阶梯"的空洞缝，那种缝每一级都合法，
      //         只有跨格累计才看得出不可能
      if (windowDrop(i, j) > windowDropMax) {
        suspectDrop++;
        continue;
      }
      // 闸门 ③：单格落差的绝对上限 —— 崖的高度是有上限的，与格距无关。
      //         格距一大，①②两条都会被"角度/跨度"放大而形同虚设。
      const quadDrop = qmax - qmin;
      if (quadDrop > maxCellDrop) {
        suspectDrop++;
        continue;
      }
      cand.push({
        i: i + 0.5,
        j: j + 0.5,
        h: (qmin + qmax) / 2,
        slopeDeg,
        drop: quadDrop,
        lines
      });
    }
  }
  // 排序口径＝教材口径：先看"穿过几条等高线"（重叠得越密越陡），再比坡度。
  // 单比坡度会被 0.1° 的量化噪声牵着走，而"重叠了几条线"是整数、更稳。
  cand.sort((x, y) =>
    y.lines === x.lines
      ? y.slopeDeg === x.slopeDeg
        ? y.drop - x.drop
        : y.slopeDeg - x.slopeDeg
      : y.lines - x.lines
  );
  const kept: CliffPoint[] = [];
  for (const c of cand) {
    let ok = true;
    for (const k of kept) {
      if (Math.hypot(k.i - c.i, k.j - c.j) < nmsRadius) {
        ok = false;
        break;
      }
    }
    if (ok) {
      kept.push(c);
      if (kept.length >= maxCount) break;
    }
  }
  return {
    cliffs: kept,
    suspectSlope,
    suspectDrop,
    suspect: suspectSlope + suspectDrop,
    candidates: cand.length
  };
}

/* ------------------------------------------------------------------ */
/* 汇总                                                                */
/* ------------------------------------------------------------------ */

export interface LandPartMarks {
  peaks: PeakPoint[];
  saddles: SaddlePoint[];
  cliffs: CliffPoint[];
  /** 山脊点（网格坐标 [i,j,...]） */
  ridges: Float32Array;
  /** 山谷点（网格坐标 [i,j,...]） */
  valleys: Float32Array;
  /**
   * 陡崖扫描的完整结果（含被物理闸门剔除的异常格数）。
   *
   * `suspect` 不隐藏 —— 界面要如实显示"本样本有 N 处超出物理可能的异常已被剔除"。
   * 偷偷抹掉等于让学生以为这座山很干净，而 DEM 数据本来就是测量结果、有质量信息。
   */
  cliffScan: CliffScan;
}

export interface LandPartCounts {
  peak: number;
  ridge: number;
  valley: number;
  saddle: number;
  cliff: number;
}

export function landPartCounts(m: LandPartMarks): LandPartCounts {
  return {
    peak: m.peaks.length,
    ridge: m.ridges.length / 2,
    valley: m.valleys.length / 2,
    saddle: m.saddles.length,
    cliff: m.cliffs.length
  };
}

/**
 * 检出数量有上限的部位 → 上限值。
 *
 * ## 为什么必须单独记这个
 *
 * `peak` 和 `cliff` 是**截断后**的数组长度（检出算法的 `maxCount` 闸门），
 * 而 `ridge` / `valley` / `saddle` 是真实总数。两者混在一起直接显示，
 * 就是伪精度：8 个样本里 7 个的 `peak` 都恰好是 6，看起来是"同样多"，
 * 实际上贡嘎山的峰远不止 6 个，内蒙古高原的是 6 个 84 m 小丘。
 * 图鉴里要写成 `6+`，学生才不会把截断值当测量值读。
 *
 * ## 为什么上限要跟部位放一起，而不是放进生成物
 *
 * 上限是**检测算法的属性**，不是某个样本的属性。放进 `landforms.ts`
 * 那份生成物里，就等于把同一个常量抄了 8 遍，改算法时必然漏抄。
 */
export const LAND_PART_CAP: Partial<Record<LandPartId, number>> = {
  peak: PEAK_MAX_COUNT,
  cliff: CLIFF_MAX_COUNT
};

/** 该部位的计数是否已经被上限截断（截断了就不能当准确数显示） */
export function isCappedPart(id: LandPartId, count: number): boolean {
  const cap = LAND_PART_CAP[id];
  return cap !== undefined && count >= cap;
}

/**
 * 一次算出五类部位。
 *
 * 山脊/山谷的点很密（占 6% / 3%），每次切样本都重算一遍 TPI 是浪费 ——
 * 调用方（`engine.ts`）负责在换山/改海拔时才调它，切季节不必重算。
 */
export function landParts(h: HeightFn, n: number, spanM: number): LandPartMarks {
  const peaks = findPeaks(h, n);
  const rv = ridgeValley(h, n, RIDGE_TPI);
  const cliffScan = findCliffs(h, n, spanM / (n - 1));
  return {
    peaks,
    saddles: findSaddles(h, n, peaks, spanM),
    cliffs: cliffScan.cliffs,
    ridges: Float32Array.from(rv.ridge),
    valleys: Float32Array.from(rv.valley),
    cliffScan
  };
}

/* ------------------------------------------------------------------ */
/* 地形类型判据                                                        */
/* ------------------------------------------------------------------ */

/**
 * 局部相对高差的窗口与取样间隔（单位：格）。
 *
 * radius 16 格 × 118 m ≈ **1.9 km** ⇒ 约 3.8 km 见方的局地窗口。
 * 这个尺度是照着"一眼能看成一块地貌体"定的：丘陵的丘陵高几十到两百米、
 * 宽度一两公里，正好落在这个窗口里。
 */
export const LOCAL_RELIEF_RADIUS = 16;
export const LOCAL_RELIEF_STEP = 6;
/** 局部高差超过它 ⇒ 山地（课本口径：相对高度 > 200 m） */
export const LOCAL_RELIEF_MOUNTAIN = 200;
/** 局部高差小于它 ⇒ 平原（课本口径：地面平坦、起伏很小） */
export const LOCAL_RELIEF_PLAIN = 40;

/**
 * 局部相对高差：在图上均匀取样，每个样点量 `±radius` 格窗口内的极差，取中位数。
 *
 * ## 为什么不能用"整幅图的高差"
 *
 * 这是判型模型的**关键修正**。课本里的「相对高度」说的是**某一块地貌体自身**的
 * 高差，而整幅 30 km 窗口的高差是"这片区域里最高的山到最低的谷"。
 * 两者在丘陵地区会差一个量级：
 *
 * | 样本 | 整幅高差 | 局部高差 | 该判成 |
 * |---|---|---|---|
 * | 湘中丘陵 30 km 窗 | 500 m 上下（窗里总能圈进一座山） | 100~150 m | 丘陵 |
 * | 华北平原 | 30 m | 个位数 | 平原 |
 * | 贡嘎山 | 5210 m | 1500 m 以上 | 山地 |
 *
 * 早先按整幅高差判，实测把**吉安 512 m / 沂蒙 894 m / 丽水 1189 m
 * 三个丘陵候选全判成了"山地"**，盆地候选也全军覆没。
 * 判据错了，选的样本再好也救不回来。
 *
 * ## 为什么取中位数而不是最大值
 *
 * 最大值会被窗口里偶然出现的那一座孤峰带跑；中位数代表"这片区域**典型**的
 * 起伏程度"，正是"这里是什么地形"要回答的问题。
 */
export function localReliefMedian(
  h: HeightFn,
  n: number,
  radius: number = LOCAL_RELIEF_RADIUS,
  step: number = LOCAL_RELIEF_STEP
): number {
  if (n <= 2 * radius + 1) {
    return 0;
  }
  const vals: number[] = [];
  for (let j = radius; j < n - radius; j += step) {
    for (let i = radius; i < n - radius; i += step) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let dj = -radius; dj <= radius; dj++) {
        for (let di = -radius; di <= radius; di++) {
          const v = h(i + di, j + dj);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      vals.push(hi - lo);
    }
  }
  if (vals.length === 0) {
    return 0;
  }
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}

export type LandTypeId = "plain" | "plateau" | "hill" | "mountain" | "basin";

export interface LandTypeDef {
  id: LandTypeId;
  name: string;
  /** 判据（给学生看的一句话） */
  rule: string;
}

// 顺序照课本（人教版八上）：平原·高原·山地·丘陵·盆地。
// ⚠️ 图鉴的类型标签栏直接按这个数组顺序排，所以顺序本身也是"口径"的一部分，
// `scripts/landform.test.cjs` 把它连同 id 一起锁死。
export const LAND_TYPES: LandTypeDef[] = [
  { id: "plain", name: "平原", rule: "局部高差很小（< 40 m），海拔一般较低" },
  { id: "plateau", name: "高原", rule: "海拔高（平均 > 1000 m）而顶面局部高差不大" },
  { id: "mountain", name: "山地", rule: "局部高差大（> 200 m），坡度陡" },
  { id: "hill", name: "丘陵", rule: "局部高差中等（40–200 m），坡度平缓" },
  {
    id: "basin",
    name: "盆地",
    rule:
      "四周高、中间低：外环比中心盘高 ≥ 120 m，" +
      "且 8 个方位里至少有 6 个方位的边缘高于中心"
  }
];

export function landTypeDef(id: LandTypeId): LandTypeDef {
  return LAND_TYPES.find((t) => t.id === id) ?? LAND_TYPES[0];
}

/* ---- 盆地判据的几何参数 ----
 *
 * 全部取「半幅的比例」而不是固定公里数：每个样本的 `spanKm` 可以不同
 * （山 30 km、盆地 100 km），固定公里数在窄图幅里会跑到画面外。
 */
/** 中心盘半径（占半幅的比例） */
export const BASIN_CORE_FRAC = 0.18;
/** 外环内径 / 外径（占半幅的比例） */
export const BASIN_RIM_IN_FRAC = 0.5;
export const BASIN_RIM_OUT_FRAC = 0.88;
/** 外环平均必须比中心盘高这么多（米） */
export const BASIN_RIM_ABOVE_CORE = 120;
/** 单个方位要高出这么多，才算"这一侧是高的"（米） */
export const BASIN_SECTOR_MARGIN = 40;
/** 8 个方位里至少几个要达标 */
export const BASIN_MIN_SECTORS = 6;
/** 窗口高差下限：全平的窗口不可能是盆地 */
export const BASIN_MIN_RELIEF = 300;

export interface ReliefStats {
  min: number;
  max: number;
  mean: number;
  /** 相对高差（起伏度）= max − min。**判型时不用它**，只作展示 */
  relief: number;
  /** 中心盘（半径 `BASIN_CORE_FRAC`×半幅）的平均海拔 */
  coreMean: number;
  /** 外环（`BASIN_RIM_IN_FRAC`~`BASIN_RIM_OUT_FRAC`×半幅）的平均海拔 */
  rimMean: number;
  /** `rimMean − coreMean`（> 0 才有"盆"的形态） */
  edgeMinusCore: number;
  /** 8 个方位各自的（该方位外环均值 − coreMean），从正北起顺时针 */
  sectors: number[];
  /** `sectors` 里超过 `BASIN_SECTOR_MARGIN` 的个数（0~8） */
  sectorsAbove: number;
  /** 局部相对高差的代表值（中位数）—— 判"平原/丘陵/山地"用它，见 `localReliefMedian` */
  localRelief: number;
}

/**
 * 统计起伏度与「四周高中间低」的形态指标。
 *
 * ## 为什么用**环形**而不是方框
 *
 * 早先用的是「最外 20% 的方框」当边缘、中间 40% 的方框当中心。
 * 方框的**四个角**离中心 1.41 倍远，一个方位上的高环山会被采样两次、
 * 而正东西南北只采一次 —— "四周"这个几何概念在方框里是失真的。
 * 改成同心圆圆盘 + 圆环后，8 个方位各自覆盖的面积相等，
 * 「有 6 个方位是高的」这句话才有意义。
 *
 * ## 为什么还要单独看 8 个方位
 *
 * 因为对一个**均质**的地貌（比如川中丘陵），中心盘与外环的均值应当**统计上相等** ——
 * 窗口只是同一片丘陵的一个随机样本，没有"中间低"这回事。
 * 所以「外环整体高 120 m」这一条只要窗口取在丘陵的凹处就可能偶然成立；
 * 而「8 个里有 6 个方位都高」在均质地貌上极难凑齐 —— 那才是"被围住"的形态。
 */
export function reliefStats(h: HeightFn, n: number): ReliefStats {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = h(i, j);
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
  }

  const c = (n - 1) / 2;
  const half = n / 2;
  const rCore = half * BASIN_CORE_FRAC;
  const rIn = half * BASIN_RIM_IN_FRAC;
  const rOut = half * BASIN_RIM_OUT_FRAC;

  let coreSum = 0;
  let coreCnt = 0;
  let rimSum = 0;
  let rimCnt = 0;
  const secSum = [0, 0, 0, 0, 0, 0, 0, 0];
  const secCnt = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const dx = i - c;
      const dy = j - c;
      const r = Math.hypot(dx, dy);
      const v = h(i, j);
      if (r <= rCore) {
        coreSum += v;
        coreCnt++;
      } else if (r >= rIn && r <= rOut) {
        rimSum += v;
        rimCnt++;
        // 正北起顺时针：图上 j 向南增大，所以"北"是 dy < 0
        const ang = (Math.atan2(dx, -dy) * 180) / Math.PI;
        const s = Math.floor(((ang + 360) % 360) / 45) % 8;
        secSum[s] += v;
        secCnt[s]++;
      }
    }
  }
  const coreMean = coreCnt ? coreSum / coreCnt : 0;
  const rimMean = rimCnt ? rimSum / rimCnt : 0;
  const sectors = secSum.map((s, k) => (secCnt[k] ? s / secCnt[k] - coreMean : 0));
  return {
    min,
    max,
    mean: sum / (n * n),
    relief: max - min,
    coreMean,
    rimMean,
    edgeMinusCore: rimMean - coreMean,
    sectors,
    sectorsAbove: sectors.filter((d) => d > BASIN_SECTOR_MARGIN).length,
    localRelief: localReliefMedian(h, n)
  };
}

/**
 * 由局部高差、平均海拔与"边高中低"程度**判**出地形类型。
 *
 * ⚠️ 这是给课堂演示用的**简化判据**，不是地貌学的完整分类：
 * 真实的一条界线（比如秦岭）算山地还是高原，还要看海拔、成因和区域尺度。
 * 图鉴里每个样本的「类型」标签是**人工写定**的（见 `data/landforms.ts`），
 * 这个函数的输出只作为**旁证**显示 —— 与 `data/locations.ts` 里
 * "省份手写 + 脚本反向校验"是同一套纪律：人工口径为准，机器负责抓笔误。
 *
 * ## 判定顺序是有讲究的
 *
 * **盆地优先于一切**，因为柴达木盆地、银川平原既"海拔 > 1000 m"又"顶面平缓"，
 * 只按海拔与高差会判成高原或平原；它们的"盆"表现在**形态**（四周高中间低）上，
 * 所以形态判据必须先看。
 *
 * 然后是 **山地优先于高原**：青藏高原上当然有山地，但一个 30 km 窗口里
 * 如果局部高差都超过 200 m，学生看到的画面就是山地，标成"高原"反而误导。
 *
 * ## "相对高度"取局部高差，不是整幅高差
 *
 * 详见 `localReliefMedian` 的注释：用整幅高差会把丘陵全判成山地（实测三例全中）。
 */
export function classifyLandType(stats: ReliefStats): { type: LandTypeId; reason: string } {
  const { relief, mean, edgeMinusCore, localRelief, sectorsAbove } = stats;
  if (
    relief >= BASIN_MIN_RELIEF &&
    edgeMinusCore >= BASIN_RIM_ABOVE_CORE &&
    sectorsAbove >= BASIN_MIN_SECTORS
  ) {
    return {
      type: "basin",
      reason:
        `外环比中心高 ${Math.round(edgeMinusCore)} m，` +
        `8 个方位中有 ${sectorsAbove} 个方位的边缘高于中心 ${BASIN_SECTOR_MARGIN} m 以上`
    };
  }
  if (localRelief > LOCAL_RELIEF_MOUNTAIN) {
    return { type: "mountain", reason: `局部高差中位数达 ${Math.round(localRelief)} m` };
  }
  if (mean >= 1000) {
    return {
      type: "plateau",
      reason: `平均海拔 ${Math.round(mean)} m 而局部高差只有 ${Math.round(localRelief)} m`
    };
  }
  if (localRelief < LOCAL_RELIEF_PLAIN) {
    return { type: "plain", reason: `局部高差仅 ${Math.round(localRelief)} m` };
  }
  return { type: "hill", reason: `局部高差 ${Math.round(localRelief)} m，属中等` };
}

/* ------------------------------------------------------------------ */
/* 自动垂直夸张                                                        */
/* ------------------------------------------------------------------ */

/**
 * 新样本（平原 / 高原 / 丘陵 / 盆地）带来的一个问题：**同一套「视觉纵轴」不够用了**。
 *
 * 四座真山都是「30 km 跨度 × 3000~5000 m 高差」，×1 就很挺立；
 * 而华北平原 30 km 内高差只有几十米 —— 按 ×1 渲染是一张纸，什么也看不见。
 * 反过来，把全局默认调到 ×20，四座山会立成尖塔。
 *
 * 所以夸张必须**按样本自动推荐**。问题是：按什么推荐？
 *
 * ## 第一版：起伏取向（已废弃，但很有教育意义）
 *
 * 先定一个想要的视觉纵横比（最高到最低的高度差占图幅跨度的比例），再反解：
 *
 *     exaggeration = 0.18 × spanM / reliefM
 *
 * 这个 0.18 恰好能从贡嘎山反推出来（`0.18 × 30000 / 5210 ≈ 1.04`，正是手调的 ×1），
 * 看起来"不是拍脑袋定的"。**但它其实是拿山地的观感当成了普适目标**：
 *
 * | 样本 | 跨度 | 起伏 | 起伏取向 | 后果 |
 * |---|---|---|---|---|
 * | 贡嘎山 | 30 km | 5210 m | ×1.04 | 合适 |
 * | 川中丘陵 | 30 km | 350 m | **×16.2** | 真实 25° 的丘坡被抬到 **72°** |
 * | 华北平原 | 30 km | 30 m | **×60（撞上限）** | 一片糊 |
 *
 * 丘陵的起伏本来就小，要凑够"18% 跨度"就得乘一个很大的倍数，而**整幅放大
 * 同时把每个丘的坡面也放大了** —— 于是丘陵被抬得比贡嘎山还陡，
 * 「山地陡、丘陵缓」这个**教学对比直接反过来了**。
 *
 * ## 现在：坡度取向
 *
 * 改成盯住「坡面」而不是「总高差」：
 *
 *     exaggeration = tan(25°) / tan(p90 坡度)
 *
 * 含义是「把地形里**典型偏陡**的那部分坡面抬到 25°」。
 * 用 p90 而不是最大坡度：最大值永远是离群的那一格（陡崖、数据毛刺），
 * 盯它会让所有地形都得到 ×1。p90 才是"这片地形有多陡"的代表值。
 *
 * | 样本 | p90 真实坡 | 坡度取向 | 抬完的坡面 |
 * |---|---|---|---|
 * | 贡嘎山 | 44.5° | ×1（本来已够陡） | 44° |
 * | 模板山地 | 31.8° | ×1 | 32° |
 * | 模板盆地 | 14.2° | ×1.84 | 25° |
 * | 川中丘陵 | 10.9° | ×2.42 | 25° |
 * | 模板丘陵 | 12.3° | ×2.14 | 25° |
 * | 内蒙古高原 | 4.5° | ×5.98 | 25° |
 * | 华北平原 | 1.0° | ×20（撞上限） | 20° |
 *
 * 关键差别：**已经够陡的地形会得到 ×1（不动它）**，只有真的太平的地形才被抬起来。
 * 山地 ×1、丘陵 ×2.4、高原 ×6、平原 ×20 —— 陡缓次序保住了，
 * 这正是垂直带谱游戏最需要的那条对比。
 */
export const EXAGGERATION_TARGET_SLOPE_DEG = 25;
/** 下限 1：**绝不把地形压平**。地形已经比目标陡时不需要"反向夸张"。 */
export const EXAGGERATION_LIMIT_MIN = 1;
/**
 * 上限 20。
 *
 * 设上限而不是让它自由上涨，是因为华北平原按公式要 ×26.7 —— 那样
 * 30 m 的起伏会被抬成 800 m，"平原"看起来就有丘陵的意思了。
 * ×20 给它 20° 的坡面（差一点点到 25°），视觉上"有起伏但明显比丘陵缓"，
 * 教学上要的那条界线反而更清楚。
 */
export const EXAGGERATION_LIMIT_MAX = 20;

/**
 * 单格坡度的 p90（度）。
 *
 * 用**中心差分**（`h(i+1) − h(i−1)` / `2·cellM`）而不是最大邻差：
 * 中心差分对单格毛刺有天然抑制，量出来的是"坡面"而不是"某个台阶"。
 *
 * `stride` 默认 2：256² 网格全量算 13 万个点没必要，隔一行一列取
 * 6.5 万个样本已经足够稳定（p90 是稳健统计量，抽样不改变它），
 * 而换山时这段代码是要跟着 `reliefStats` 一起跑的。
 */
export function slopeP90Deg(h: HeightFn, n: number, spanM: number, stride = 2): number {
  if (!(n > 2) || !(spanM > 0)) {
    return 0;
  }
  const cellM = spanM / (n - 1);
  const step = Math.max(1, Math.floor(stride));
  const vals: number[] = [];
  for (let j = 1; j < n - 1; j += step) {
    for (let i = 1; i < n - 1; i += step) {
      const dx = (h(i + 1, j) - h(i - 1, j)) / (2 * cellM);
      const dy = (h(i, j + 1) - h(i, j - 1)) / (2 * cellM);
      vals.push(Math.hypot(dx, dy));
    }
  }
  if (vals.length === 0) {
    return 0;
  }
  vals.sort((a, b) => a - b);
  // 取 p90（floor 而非 round：小样本下 round 可能越界）
  const slope = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.9))];
  return (Math.atan(slope) * 180) / Math.PI;
}

export function recommendExaggeration(slopeP90: number): number {
  if (!(slopeP90 > 0) || !isFinite(slopeP90)) {
    return 1;
  }
  const targetTan = Math.tan((EXAGGERATION_TARGET_SLOPE_DEG * Math.PI) / 180);
  const raw = targetTan / Math.tan((slopeP90 * Math.PI) / 180);
  const clamped = Math.max(EXAGGERATION_LIMIT_MIN, Math.min(EXAGGERATION_LIMIT_MAX, raw));
  // 落到两位小数，避免滑块出现 ×2.4200000001 这种数
  return Math.round(clamped * 100) / 100;
}
