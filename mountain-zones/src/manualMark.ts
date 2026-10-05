/**
 * 人工标注（v2.4.5 新增）—— 教师自己标的地形部位，存在本机 `localStorage`。
 *
 * ## 为什么要有这个模块
 *
 * v2.4.1~v2.4.4 的部位标注是**纯机器检出**的：`findPeaks` / `findSaddles` / `findCliffs`
 * 各有一套阈值，在真实 DEM 上会出现"标 16 处陡崖挤在一角""6 个峰只差 23 m"
 * 这类读不出教学意义的结果（见 `.workbuddy/evidence/` 里的取证）。
 * 而**标注本来就是教师该做的事** —— 一座演示用的山，该标哪三处、标在哪里，
 * 是教学决策，不是判据能自动决定的。
 *
 * 于是改成：**机器检出降级为「候选」**，教师可以删、可以加、可以改位置；
 * 人工标注一旦存在就以它为准（`source: "manual"`）。
 *
 * ## 为什么存本机而不是后端
 *
 * 三个理由，按重要性排：
 *  1. 标注是**一次性备课产物**，不是学生数据 —— 不需要跨设备同步；
 *  2. 后端要加表、要迁移、要在云端验收环境同步，代价远大于收益；
 *  3. **离线可用**：机房断网时标注照样在。
 * 代价是"换电脑就没了"，所以界面必须提供**导出/导入 JSON**，让老师能带走。
 *
 * ## 口径纪律：人工标注的数值必须现场量，不能存
 *
 * 存储里只有**网格坐标**（`i` / `j`），`h` / `drop` / `slopeDeg` 一律在读取时
 * 用当前高度场现算（`measurePeak` / `measureSaddle` / `measureCliff`）。
 * 原因有两个：
 *  - 学生可以拖「高程偏移」滑杆 —— 存了数值，改了偏移就对不上图；
 *  - 同一份标注要在三块画面（沙盘 / 图纸 / 平面图）上显示，实测口径必须一致，
 *    而 `findCliffs` 的 6 边坡度公式藏在函数内部、没法直接复用。
 * 这三个函数是**照着 `landform.ts` 的对应实现逐字搬的**，不是重写的近似 ——
 * `scripts/manual-mark.test.cjs` 会拿真检出点反证"人工测量 == 机器测量"。
 */

import { CLIFF_MIN_SLOPE_DEG, type LandPartMarks } from "./landform";

/** 可人工标注的三类（山脊/山谷是线，手绘不现实，仍走机器骨架） */
export type ManualKind = "peak" | "saddle" | "cliff";

export interface ManualMark {
  kind: ManualKind;
  /** 网格坐标（浮点：陡崖在格中心，峰/鞍在格点或边中点） */
  i: number;
  j: number;
}

/** 存在本机的标注集合（一个样本一份） */
export interface ManualMarkSet {
  version: 1;
  marks: ManualMark[];
}

/** `localStorage` 键的前缀。带版本号 ⇒ 将来换结构时老数据自动作废而不是读出乱码 */
export const MANUAL_KEY_PREFIX = "mountain-zones.manualMarks.v1.";

export function manualKey(tag: string): string {
  return MANUAL_KEY_PREFIX + tag;
}

/* ------------------------------------------------------------------ */
/* 三类部位的现场测量（与 landform.ts 同口径）                            */
/* ------------------------------------------------------------------ */

/**
 * 峰顶海拔：直接取格点高程。
 *
 * 机器版 `findPeaks` 存的就是 `h(i, j)`，所以两者**必然相等**（不是近似）。
 */
export function measurePeak(h: (i: number, j: number) => number, i: number, j: number): number {
  return h(Math.round(i), Math.round(j));
}

/**
 * 鞍部下凹量：机器版是「两峰中较低的那个 − 垭口高程」，
 * 而人工标注时**没有"两峰"这个参照**。
 *
 * 采用的口径：**邻域最高点 − 本点高程**（窗口 ±6 格）。
 * 理由：鞍部的教学含义是"两个高点之间的低处"，邻域最高点就是那两个高点之一，
 * `drop` 因此读作"它比周围最高的山顶低多少"——正是课堂上问的那句话。
 * 代价是与机器 `drop` 数值不同（机器拿的是指定配对峰），
 * 所以 UI 上标注的 `drop` 一律叫「低于周围最高」，不叫「鞍部下凹」，
 * 免得两个口径混在同一张图上说不清。
 */
export function measureSaddle(
  h: (i: number, j: number) => number,
  n: number,
  i: number,
  j: number
): { h: number; drop: number } {
  const ci = Math.round(i);
  const cj = Math.round(j);
  const hv = h(ci, cj);
  const R = 6;
  let hi = -Infinity;
  for (let dj = -R; dj <= R; dj++) {
    const jj = cj + dj < 0 ? 0 : cj + dj > n - 1 ? n - 1 : cj + dj;
    for (let di = -R; di <= R; di++) {
      const ii = ci + di < 0 ? 0 : ci + di > n - 1 ? n - 1 : ci + di;
      /*
       * 跳过中心格本身。**这一格不能参与max**：峰顶所在格就是邻域最高，
       * 算出来的 drop 恒为 0 —— 于是"教师站在峰顶标鞍部"会显示"低于周围最高 0 米"，
       * 一个字也说不通。排除之后，峰位上 drop 就是它相对周围的高出量，必 > 0。
       */
      if (di === 0 && dj === 0) continue;
      const v = h(ii, jj);
      if (v > hi) hi = v;
    }
  }
  return { h: hv, drop: Math.max(0, hi - hv) };
}

/**
 * 陡崖的坡度/高差/等高线条数：**照抄 `findCliffs` 的 6 边公式**。
 *
 * 位置取所在格的整数角 `(floor(i), floor(j))`，与机器版 `i + 0.5` 约定对应
 * （机器版记的是格中心，这里记格角；差半格，渲染上肉眼不可辨，
 *  但**测量必须用同一个四边形**，否则"同一处崖"两个读数会差几度）。
 */
export function measureCliff(
  h: (i: number, j: number) => number,
  n: number,
  cellM: number,
  i: number,
  j: number,
  refInterval = 100
): { h: number; slopeDeg: number; drop: number; lines: number; ok: boolean } {
  const ii = Math.max(0, Math.min(n - 2, Math.floor(i)));
  const jj = Math.max(0, Math.min(n - 2, Math.floor(j)));
  const a = h(ii, jj);
  const b = h(ii + 1, jj);
  const c = h(ii, jj + 1);
  const d = h(ii + 1, jj + 1);
  const qmin = Math.min(a, b, c, d);
  const qmax = Math.max(a, b, c, d);
  const lines = Math.floor(qmax / refInterval) - Math.floor(qmin / refInterval);
  const tan = Math.max(
    Math.abs(b - a) / cellM,
    Math.abs(c - a) / cellM,
    Math.abs(d - b) / cellM,
    Math.abs(d - c) / cellM,
    Math.abs(d - a) / (cellM * Math.SQRT2),
    Math.abs(c - b) / (cellM * Math.SQRT2)
  );
  const slopeDeg = (Math.atan(tan) * 180) / Math.PI;
  return {
    h: (qmin + qmax) / 2,
    slopeDeg,
    drop: qmax - qmin,
    lines,
    /* 与机器判据同一条门槛：教师标的"陡崖"若只有 40°，界面上要如实说"这不是陡崖" */
    ok: slopeDeg >= CLIFF_MIN_SLOPE_DEG
  };
}

/* ------------------------------------------------------------------ */
/* 读写本机存储                                                        */
/* ------------------------------------------------------------------ */

/**
 * 取本机的存储对象；拿不到（Node 测试环境 / 极端环境）时返回 `null`。
 *
 *⚠️ 用 `globalThis` 而不是 `window`：浏览器里两者是**同一个对象**（`window === globalThis`），
 * 而 `window` 在 Node 下**根本不存在** —— 直接写 `window.localStorage` 会让整个函数落进
 * `catch`，于是数据层测试永远只读到 `null`，测的就不是真实路径了。
 */
function store(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    //某些环境访问 `localStorage` 本身就会抛（沙箱 iframe、禁用存储）
    return null;
  }
}

/**
 * 本机存储**现在**能不能用。
 *
 * ## 为什么必须"真写一条再删掉"，不能只判断 `store() !== null`
 *
 * `store()` 只能证明**读得到**。实际上有三档都能通过它：
 *   1. 完全正常；
 *   2. 读得到、写**一写就抛**（Safari 无痕模式、配额为 0、存储被策略禁用）；
 *   3. 对象存在但 `setItem` 静默失败（少数嵌WebView）。
 * 而 2 / 3 两种情况下 `saveManualMarks` 会返回 `false`、引擎把 `sessionOnly`
 * 置上 —— 也就是说**要等用户标完第一个点，界面才会说"这次不会保存"**。
 * 第一次进游戏、还没标任何东西时，界面完全看不出这台电脑存不了，
 * 用户标了半天才被告知"白标了"。
 *
 * 所以这里**主动试写一条哨兵**：能写完再删掉才算可用。
 * 代价是一次 `setItem` + 一次 `removeItem`，只在进入人工标注模式时调一次。
 *
 * ⚠️ 键名带 `__probe` 后缀且**写完立刻删**：万一 `removeItem` 也失败，
 * 残留的也只是一条 8 字节的哨兵，不会污染 `manualKey(tag)` 的数据。
 */
export function storageAvailable(): boolean {
  const s = store();
  if (!s) {
    return false;
  }
  const probeKey = `${MANUAL_KEY_PREFIX}__probe`;
  try {
    s.setItem(probeKey, "1");
    s.removeItem(probeKey);
    return true;
  } catch {
    try {
      s.removeItem(probeKey);
    } catch {
      /* 连删都失败就算了，不影响主流程 */
    }
    return false;
  }
}

/**
 * 读一份标注。**任何异常都退回 `null`**，绝不抛错也绝不返回半截数据。
 *
 * 返回**裸数组**而不是 `ManualMarkSet`：版本号与校验都在这一层内部处理掉了，
 * 调用方（引擎）拿到的就是"这座山标了哪几处"，不需要再解一层包装。
 * `null` 与 `[]` 的区别必须保留 —— 前者"从没标过"、后者"教师清空过"。
 *
 * 为什么这么保守：这是 `localStorage`，内容可能被上一版游戏写过、被别的标签页
 * 写坏、被人手改成 JSON 片段。标注只是"锦上添花"的辅助功能，
 * 读不出来时应当安静地回到"用机器检出"，而不是让整个游戏白屏。
 */
export function loadManualMarks(tag: string): ManualMark[] | null {
  try {
    const s = store();
    const raw = s?.getItem(manualKey(tag));
    if (!raw) {
      return null;
    }
    const v = JSON.parse(raw) as ManualMarkSet;
    if (!v || v.version !== 1 || !Array.isArray(v.marks)) {
      return null;
    }
    // 逐条校验：kind 必须是三种之一、坐标必须是有限数
    for (const m of v.marks) {
      if (
        !m ||
        (m.kind !== "peak" && m.kind !== "saddle" && m.kind !== "cliff") ||
        !Number.isFinite(m.i) ||
        !Number.isFinite(m.j)
      ) {
        return null;
      }
    }
    return v.marks.map((m) => ({ kind: m.kind, i: m.i, j: m.j }));
  } catch {
    return null;
  }
}

export function saveManualMarks(tag: string, marks: ManualMark[]): boolean {
  try {
    const s = store();
    if (!s) {
      return false;
    }
    s.setItem(manualKey(tag), JSON.stringify({ version: 1, marks } satisfies ManualMarkSet));
    return true;
  } catch {
    /* 隐私模式 / 配额满 / 存储被禁用：标注功能降级为"本次会话有效" */
    return false;
  }
}

export function clearManualMarks(tag: string): void {
  try {
    store()?.removeItem(manualKey(tag));
  } catch {
    /* 同上，删不掉不影响本次会话 */
  }
}

/** 这台机器上存过几个样本的标注（设置页显示"你已标注 N 座山"用） */
export function countStoredTags(): number {
  try {
    const s = store();
    if (!s) {
      return 0;
    }
    let n = 0;
    for (let k = 0; k < s.length; k++) {
      const key = s.key(k);
      if (key && key.startsWith(MANUAL_KEY_PREFIX)) n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* 增删改（纯函数，UI 与测试共用）                                       */
/* ------------------------------------------------------------------ */

/**
 * 加一个标注。**同类同位置**（距离 < 2 格）视为重复，直接拒绝 ——
 * 连点两下插两个完全重叠的点，视觉上只是"更粗的同一个点"，只会让人困惑。
 */
export function addMark(
  marks: ManualMark[],
  kind: ManualKind,
  i: number,
  j: number
): { marks: ManualMark[]; reason?: "duplicate" } {
  for (const m of marks) {
    if (m.kind === kind && Math.hypot(m.i - i, m.j - j) < 2) {
      return { marks, reason: "duplicate" };
    }
  }
  return { marks: [...marks, { kind, i, j }] };
}

/**
 * 点掉一个标注：删掉**同类里离点击点最近、且在命中范围内**的那一个。
 *
 * ⚠️ `hitCells` 是**格**不是像素。记号在屏幕上的大小随缩放变化，而调用方手上
 *  只有"点中了没有"这个结果 —— 所以由调用方把屏幕像素换算成格（见UI 层的
 * `pxToCells`）再传进来。若把像素直接当格用，`hitPx=8` 会变成"8 格的半径"，
 * 于是轻轻一点就把半张图上的同类标注全删了。
 *
 * `hitCells <= 0` 视为不命中（调用方算不出换算时宁可不删 —— 误删要重标，漏删再点一次）。
 */
export function removeMarkAt(
  marks: ManualMark[],
  kind: ManualKind,
  i: number,
  j: number,
  hitCells: number
): { marks: ManualMark[]; hitIndex: number } {
  if (!(hitCells > 0)) {
    return { marks, hitIndex: -1 };
  }
  let hitIndex = -1;
  let best = Infinity;
  for (let k = 0; k < marks.length; k++) {
    const m = marks[k];
    if (m.kind !== kind) continue;
    const d = Math.hypot(m.i - i, m.j - j);
    if (d <= hitCells && d < best) {
      best = d;
      hitIndex = k;
    }
  }
  if (hitIndex < 0) return { marks, hitIndex: -1 };
  return { marks: marks.filter((_, k) => k !== hitIndex), hitIndex };
}

/**
 * 从机器检出结果生成"初始标注"——一键把机器认出来的那些收进人工标注。
 *
 * 这是**人工与机器之间的桥**：教师不需要从零标，点一下"采用机器结果"，
 * 就得到一份可编辑的起点，然后增删改。
 *
 * ⚠️ `maxPerKind` 是刻意有的上限：真实 DEM 上机器会检出 6 峰 / 16 崖，
 * 全收进来等于"一键把旧的毛病又装回来"。默认每类只收**最显著的 3 个**。
 *
 * 三类各自的"最显著"口径**与机器判据的排序一致**：
 *峰按海拔、鞍按下凹量、崖按"穿过几条等高线 → 坡度"（见 `findCliffs` 的注释：
 *单比坡度会被 0.1° 的量化噪声牵着走，"重叠了几条线"是整数、更稳）。
 */
export function seedFromMachine(
  marks: LandPartMarks,
  maxPerKind = 3
): ManualMark[] {
  const out: ManualMark[] = [];
  for (const p of [...marks.peaks].sort((a, b) => b.h - a.h).slice(0, maxPerKind)) {
    out.push({ kind: "peak", i: p.i, j: p.j });
  }
  for (const s of [...marks.saddles].sort((a, b) => b.drop - a.drop).slice(0, maxPerKind)) {
    out.push({ kind: "saddle", i: s.i, j: s.j });
  }
  for (const c of [...marks.cliffs].sort((x, y) =>
    y.lines === x.lines ? (y.slopeDeg === x.slopeDeg ? y.drop - x.drop : y.slopeDeg - x.slopeDeg) : y.lines - x.lines
  ).slice(0, maxPerKind)) {
    out.push({ kind: "cliff", i: c.i, j: c.j });
  }
  return out;
}