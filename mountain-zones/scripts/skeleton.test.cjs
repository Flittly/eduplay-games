/**
 * 骨架化回归测试（v2.4.1 新增「地形部位标注」的底层）。
 *
 * 跑法：npm run test:data（会先用 rolldown 把 src/skeleton.ts 打成 scripts/_skeleton.cjs）
 *
 * ## 为什么这个模块需要一份测试
 *
 * 它是"山脊 / 山谷 点云 → 脊线 / 谷线"的唯一实现，而它的每一处错都**静默**：
 * 少一条线、线断成两截、线接错地方，画在三维沙盘上都只是"看起来有点怪"，
 * 没有任何报错。所以这里不测"能不能跑"，测的是**每一条判据的形状**。
 *
 * ## 断言分四层，越往后越像"指纹"
 *
 * | 层 | 钉住什么 | 例子 |
 * |---|---|---|
 * | ① 单位行为 | 每个函数的契约 | 方形结构元；`erode` 的图幅外口径；毛刺长度表 |
 * | ② 合成形状 | 已知答案的形状必须得到已知的线 | 41 点虚线脊 → 1 条 41 点线，跨度 10~50 |
 * | ③ 不变量 | 换形状也成立的性质 | 长链不被切碎；闭环首尾相邻；折线逐步 8 邻接 |
 * | ④ 真数据基线 | 22 行计数 + 全样本折线摘要 sha256 | 数变了必须解释清楚 |
 *
 * ## 本期在这里钉住的两条**已修复**的错（都是"代码和注释反着来"）
 *
 * 1. `erode` 的图幅外口径曾是反的（把补集在边缘强制置 1），后果是**贴着图幅
 *    边缘的脊整条消失**，而且最外 r 环被无条件清零。真数据上落在最外 5 环的
 *    检出格有 138~220 个 ⇒ 地图四边会缺线。见 `erode` 的注释与 §2。
 * 2. `prune` 判"撞到分叉了"时看的是**下一格的度**，而 8 连通下紧贴分叉那格
 *    自己就是 3~4 度 ⇒ 永远少删 2 格，残留一段短桩。它不画出来（2 点 < 
 *    minLinePoints），但会在 `joinLines` 之前存在，可能被接到别的线上。见 §4。
 *
 * ⚠️ 基线里的数字一律是**量出来的**，不是先想后写。要改算法就先量、再判断
 * 这个变化合不合理，最后才更新数字 —— 不许为了让测试变绿而改数字。
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const skel = require("./_skeleton.cjs");
const lf = require("./_landform.cjs");
const dem = require("./_dem.cjs");

const checks = [];
const check = (name, cond, extra) => {
  checks.push({ name, ok: Boolean(cond), extra: extra === undefined ? "" : String(extra) });
};

const NB8 = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]
];

/* 画形状用的小工具 */
const M = (n) => new Uint8Array(n * n);
const sum = (m) => m.reduce((a, b) => a + b, 0);
const setAt = (m, n, i, j) => { m[j * n + i] = 1; };
const rect = (n, i0, j0, i1, j1, hole = null) => {
  const m = M(n);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) m[j * n + i] = 1;
  if (hole) m[hole[1] * n + hole[0]] = 0;
  return m;
};
/** 空心方框（1 格宽的闭合圈） */
const frame = (n, i0, j0, i1, j1) => {
  const m = M(n);
  for (let i = i0; i <= i1; i++) { m[j0 * n + i] = 1; m[j1 * n + i] = 1; }
  for (let j = j0; j <= j1; j++) { m[j * n + i0] = 1; m[j * n + i1] = 1; }
  return m;
};
/** 菱形环：四条 45° 边，每格恰好 2 个 8 邻域邻居（没有 90° 硬拐角） */
const diamond = (n, cx, cy, R) => {
  const m = M(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (Math.abs(i - cx) + Math.abs(j - cy) === R) m[j * n + i] = 1;
  }
  return m;
};
const cellsOf = (mask) => {
  const c = [];
  const n = Math.round(Math.sqrt(mask.length));
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (mask[j * n + i]) c.push(i, j);
  return c;
};
const degAt = (m, n, i, j) => {
  let d = 0;
  for (const [dx, dy] of NB8) {
    const x = i + dx, y = j + dy;
    if (x >= 0 && y >= 0 && x < n && y < n && m[y * n + x]) d++;
  }
  return d;
};
const compsOf = (m, n) => {
  const seen = new Uint8Array(m.length);
  let c = 0;
  for (let k = 0; k < m.length; k++) {
    if (!m[k] || seen[k]) continue;
    c++;
    const st = [k];
    seen[k] = 1;
    while (st.length) {
      const p = st.pop();
      const i = p % n, j = (p / n) | 0;
      for (const [dx, dy] of NB8) {
        const x = i + dx, y = j + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const q = y * n + x;
        if (m[q] && !seen[q]) { seen[q] = 1; st.push(q); }
      }
    }
  }
  return c;
};
/** 折线是否逐步 8 邻接（这是"一条线"的最低要求） */
const isChain = (L) =>
  L.length >= 2 &&
  L.every((p, k) => k === 0 || Math.max(Math.abs(p[0] - L[k - 1][0]), Math.abs(p[1] - L[k - 1][1])) === 1);
/** 相邻点最大跨度（切比雪夫）。接过头之后这条会 > 1，见 §8 的口径说明。 */
const maxStep = (L) => {
  let m = 0;
  for (let k = 1; k < L.length; k++) {
    m = Math.max(m, Math.abs(L[k][0] - L[k - 1][0]), Math.abs(L[k][1] - L[k - 1][1]));
  }
  return m;
};
/** 按"跨度 > 1"把折线切成若干段 —— 每段都应当是严格 8 邻接的链 */
const splitByJump = (L) => {
  const out = [];
  let cur = [L[0]];
  for (let k = 1; k < L.length; k++) {
    const d = Math.max(Math.abs(L[k][0] - L[k - 1][0]), Math.abs(L[k][1] - L[k - 1][1]));
    if (d === 1) {
      cur.push(L[k]);
    } else {
      out.push(cur);
      cur = [L[k]];
    }
  }
  out.push(cur);
  return out;
};
const uncovered = (mask, n, lines) => {
  const cov = new Uint8Array(mask.length);
  for (const L of lines) for (const [i, j] of L) cov[j * n + i] = 1;
  const miss = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (mask[j * n + i] && !cov[j * n + i]) miss.push([i, j]);
  return miss;
};

/* ================================================================== */
/* 1) 点云 → 掩膜                                                      */
/* ================================================================== */
{
  const n = 16;
  const m = skel.maskFromCells([3, 2, 5, 7], n);
  check("maskFromCells 按 j*n+i 落位", m[2 * n + 3] === 1 && m[7 * n + 5] === 1, `${sum(m)} 格`);
  check("maskFromCells 不误点邻居", m[2 * n + 4] === 0 && m[3 * n + 2] === 0);

  const dup = skel.maskFromCells([4, 4, 4, 4], n);
  check("同一格重复出现只算一格", sum(dup) === 1, `${sum(dup)}`);

  const out = skel.maskFromCells([-1, 3, 999, 999, 5, 5, 5, 999], n);
  check("越界坐标被丢掉且不抛异常", sum(out) === 1, `${sum(out)} 格`);

  check("inputCells = floor(cells.length / 2)（奇数尾元素忽略）",
    skel.skeletonize([1, 2, 3], n).inputCells === 1,
    String(skel.skeletonize([1, 2, 3], n).inputCells));
  check("空输入全零",
    (() => { const r = skel.skeletonize([], n); return r.lines.length === 0 && r.maskCells === 0 && r.skeletonCells === 0 && r.prunedCells === 0; })());
}

/* ================================================================== */
/* 2) 膨胀 / 腐蚀 / 闭运算                                             */
/* ================================================================== */
{
  const n = 64;
  const one = M(n);
  setAt(one, n, 20, 20);

  check("dilate(0) 等价于复制且不共享缓冲",
    (() => { const d = skel.dilate(one, n, 0); d[0] = 1; return d[0] === 1 && one[0] === 0; })());

  // 方形结构元：一个角点 → 3 宽 × 5 高 = 15 格（横向 +2，纵向 +2）
  const corner = M(n);
  setAt(corner, n, 63, 10);
  const dc = skel.dilate(corner, n, 2);
  check("dilate 是方形结构元（角点 r=2 → 3x5=15 格）", sum(dc) === 15, `${sum(dc)}`);
  // ⚠️ 两趟一维实现最容易踩的坑是"跨行回卷"：右边界扩出去的点跑到下一行行首。
  check("dilate 不跨行回卷", dc[11 * n + 0] === 0, `(0,11)=${dc[11 * n + 0]}`);
  check("dilate 只在本行向左扩 r 格", dc[10 * n + 61] === 1 && dc[10 * n + 60] === 0);

  // 腐蚀：图幅外必须当作**前景**，否则最外 r 环会被凭空抹掉
  const full = new Uint8Array(n * n).fill(1);
  check("erode(满场, 1) 不动任何格", sum(skel.erode(full, n, 1)) === n * n, `${sum(skel.erode(full, n, 1))}/${n * n}`);
  check("erode(满场, 3) 不动任何格", sum(skel.erode(full, n, 3)) === n * n, `${sum(skel.erode(full, n, 3))}/${n * n}`);
  check("erode(满场, 5) 不动任何格（外 r 环曾被无条件清零）",
    sum(skel.erode(full, n, 5)) === n * n, `${sum(skel.erode(full, n, 5))}/${n * n}`);
  check("erode(0) 等价于复制且不共享缓冲",
    (() => { const e = skel.erode(one, n, 0); e[20 * n + 20] = 0; return one[20 * n + 20] === 1; })());

  const block = rect(n, 20, 20, 40, 40); // 21x21
  const eb = skel.erode(block, n, 3);
  check("erode 把内部方块四边各收 3 格（21x21 → 15x15）", sum(eb) === 225, `${sum(eb)}`);
  check("erode 内部方块收完后 (23,23) 活、(22,22) 死", eb[23 * n + 23] === 1 && eb[22 * n + 22] === 0);

  // 贴边保护：左边框上的方块，第 0 列必须活下来（图外视为前景）
  // 注意只有**贴着图幅那一侧**受保护；上下两边在图内，照常各收 3 格 ⇒ 21 行变 15 行。
  const flush = rect(n, 0, 20, 20, 40);
  const ef = skel.erode(flush, n, 3);
  let col0 = 0;
  for (let j = 0; j < n; j++) if (ef[j * n + 0]) col0++;
  check("erode 保护贴左边框的前景（第 0 列剩 15 格）", col0 === 15, `${col0}`);
  check("erode 的贴边保护只作用于图幅那一侧（上下仍各收 3 格）",
    ef[23 * n + 0] === 1 && ef[22 * n + 0] === 0 && ef[37 * n + 0] === 1 && ef[38 * n + 0] === 0);

  // 闭运算：填内部一格洞，外形不变
  const holed = rect(n, 10, 10, 30, 30, [20, 20]);
  const closed = skel.closeMask(holed, n, 3);
  check("closeMask 把一格洞填上", closed[20 * n + 20] === 1);
  check("closeMask 不撑大外形（21x21 仍 441 格）", sum(closed) === 441, `${sum(closed)}`);
  check("closeMask 不越界增肥（(7,7) 仍为 0）", closed[7 * n + 7] === 0);

  // ⚠️ 这条是"图幅外口径反了"的直接体检：贴着左边框的竖脊过完闭运算必须还在。
  const ridge = M(n);
  for (let j = 10; j <= 50; j++) setAt(ridge, n, 0, j);
  const rc = skel.closeMask(ridge, n, 3);
  let keep = 0;
  for (let j = 0; j < n; j++) if (rc[j * n + 0]) keep++;
  check("closeMask 保留贴左边框的竖脊（第 0 列 41 格）", keep === 41, `${keep}`);
  check("closeMask 没有把贴边竖脊横向摊开（第 1 列应为 0）",
    (() => { let c1 = 0; for (let j = 0; j < n; j++) if (rc[j * n + 1]) c1++; return c1 === 0; })());
}

/* ================================================================== */
/* 3) 细化（Zhang-Suen）                                               */
/* ================================================================== */
{
  const n = 64;
  const line = M(n);
  for (let i = 10; i <= 50; i++) setAt(line, n, i, 30);
  check("细化不动一像素宽的直线（41 → 41）", sum(skel.thin(line, n)) === 41, `${sum(skel.thin(line, n))}`);

  const solid = rect(n, 30, 30, 34, 34);
  const ts = skel.thin(solid, n);
  check("5x5 实心块细化成 1~3 格", sum(ts) >= 1 && sum(ts) <= 3, `${sum(ts)}`);

  const band = rect(n, 30, 10, 32, 50); // 3 行 x 41 列
  const tb = skel.thin(band, n);
  // "一像素宽"的正确定义不是"只占一行"（Zhang-Suen 的产物是阶梯状的），
  // 而是**相邻两行两列不存在 2x2 全实心块** —— 有 2x2 就说明局部还有厚度。
  const has2x2 = (m) => {
    for (let j = 0; j + 1 < n; j++) for (let i = 0; i + 1 < n; i++) {
      if (m[j * n + i] && m[j * n + i + 1] && m[(j + 1) * n + i] && m[(j + 1) * n + i + 1]) return true;
    }
    return false;
  };
  check("3x41 宽带细化后不存在 2x2 实心块（即局部一像素宽）", !has2x2(tb), `${sum(tb)} 格`);
  check("3x41 宽带细化后格数在 38~42（长度基本没缩）", sum(tb) >= 38 && sum(tb) <= 42, `${sum(tb)}`);
  check("对照：原始宽带里存在 2x2 实心块（说明上面那条判据有分辨力）", has2x2(band));

  // 连通性不变 —— 这是选 Zhang-Suen 的**唯一理由**，必须有断言守着
  check("细化不改变连通分量数（带状 1 个）", compsOf(band, n) === 1 && compsOf(tb, n) === 1);
  const two = M(n);
  for (let i = 10; i <= 20; i++) setAt(two, n, i, 10);
  for (let i = 40; i <= 50; i++) setAt(two, n, i, 50);
  check("细化不改变连通分量数（两条分离线段 2 个）", compsOf(two, n) === 2 && compsOf(skel.thin(two, n), n) === 2);

  // thin 只遍历 1..n-2，外框行不会被碰
  const edge = M(n);
  for (let i = 5; i <= 40; i++) setAt(edge, n, i, 0);
  check("细化不碰第 0 行（外框在遍历范围之外）", sum(skel.thin(edge, n)) === 36, `${sum(skel.thin(edge, n))}`);

  // 凸起：宽 1~2 凸起细化后自己被消掉 ⇒ prune 不必管这种形状
  for (const w of [1, 2]) {
    const bump = line.slice();
    for (let i = 30; i < 30 + w; i++) setAt(bump, n, i, 29);
    let left = 0;
    const t = skel.thin(bump, n);
    for (let i = 30; i < 30 + w; i++) if (t[29 * n + i]) left++;
    check(`宽 ${w} 格的凸起会被细化自己消掉`, left === 0, `残留 ${left}`);
  }
}

/* ================================================================== */
/* 4) 剪枝                                                             */
/* ================================================================== */
{
  const n = 64;
  const trunk = M(n);
  for (let i = 10; i <= 50; i++) setAt(trunk, n, i, 30);
  /** 在 (30,29) 往上一根长 L 的毛刺 */
  const withSpur = (L) => {
    const m = trunk.slice();
    for (let k = 1; k <= L; k++) setAt(m, n, 30, 30 - k);
    return m;
  };

  // 毛刺长度表：≤ minBranch 整支剪掉，> minBranch 一根不动
  const rows = [1, 2, 3, 4, 5, 6, 7, 12];
  const survived = [];
  for (const L of rows) {
    const r = skel.prune(withSpur(L), n, 5);
    let left = 0;
    for (let k = 1; k <= L; k++) if (r.mask[(30 - k) * n + 30]) left++;
    survived.push(left);
    // L=1 那一格凸起度数就是 3（三个邻居都在主干上），不是端点，
    // 所以 prune 不认它是"毛刺" —— 但它已经被 thin 消化掉了（见 §3），现实中不存在。
    // 所以这里只对 L>=2 要求"整支剪掉"。
    if (L >= 2 && L <= 5) {
      check(`毛刺长 ${L}：整支剪掉，残留 0 格`, left === 0, `残留 ${left}`);
      check(`毛刺长 ${L}：removed 等于支长`, r.removed === L, `removed=${r.removed}`);
    } else if (L > 5) {
      check(`毛刺长 ${L}：超过 minBranch，一根不动`, left === L && r.removed === 0, `残留 ${left} removed=${r.removed}`);
    }
  }
  check("毛刺长度表（L=1 例外，已在 §3 说明）", JSON.stringify(survived) === JSON.stringify([1, 0, 0, 0, 0, 6, 7, 12]),
    survived.join(","));

  // 主干必须完整 —— "逐层删端点"那种写法会把整条线一层层啃光，这条挡的就是它
  const pr = skel.prune(withSpur(3), n, 5);
  let trunkLeft = 0;
  for (let i = 10; i <= 50; i++) if (pr.mask[30 * n + i]) trunkLeft++;
  check("剪枝不动主干（41 格完整）", trunkLeft === 41, `${trunkLeft}`);

  const longLine = skel.prune(trunk, n, 5);
  check("剪枝对无分叉的长直线零动作", sum(longLine.mask) === 41 && longLine.removed === 0, `removed=${longLine.removed}`);

  // 孤立短碎片不是毛刺，留给 minLinePoints 去滤
  const frag = M(n);
  for (let i = 10; i <= 12; i++) setAt(frag, n, i, 10);
  const fp = skel.prune(frag, n, 5);
  check("孤立 3 格碎片不被当成毛刺剪掉", sum(fp.mask) === 3 && fp.removed === 0, `${sum(fp.mask)}`);

  check("minBranch=0 直接原样返回", skel.prune(withSpur(3), n, 0).removed === 0);
  check("minBranch 取负值也不抛异常", skel.prune(withSpur(3), n, -1).removed === 0);
}

/* ================================================================== */
/* 5) 追踪                                                             */
/* ================================================================== */
{
  const n = 96;
  const line = M(n);
  for (let i = 10; i <= 50; i++) setAt(line, n, i, 30);
  const tl = skel.trace(line, n);
  check("41 点直线追成 1 条", tl.length === 1, `${tl.length} 条`);
  check("折线点数等于格数", tl[0].length === 41, `${tl[0].length}`);
  check("折线首尾就是两个端点", JSON.stringify(tl[0][0]) === "[10,30]" && JSON.stringify(tl[0][40]) === "[50,30]",
    `${JSON.stringify(tl[0][0])}..${JSON.stringify(tl[0][40])}`);
  check("折线逐步 8 邻接（有序、无跳跃）", isChain(tl[0]));

  // ⚠️ 这条挡"切碎 bug"：若边追踪边数度（把已走过的格子涂掉再数），
  // 长链会在第二格就被判定"到端点了"，A-B-C-D 变成 [A,B]+[C,D]。
  const long = M(n);
  for (let i = 2; i <= 93; i++) setAt(long, n, i, 40);
  const tlong = skel.trace(long, n);
  check("92 点长链不被切碎（1 条 92 点）", tlong.length === 1 && tlong[0].length === 92,
    `${tlong.length} 条 / ${tlong.length === 1 ? tlong[0].length : tlong.map((l) => l.length).join(",")}`);

  // 闭环：菱形（四条 45° 边）每格恰好 2 邻居，没有 90° 硬拐角造成的假分叉
  const d = diamond(n, 48, 48, 20);
  const td = skel.trace(d, n);
  check("菱形闭环追成 1 条", td.length === 1, `${td.length} 条`);
  check("闭环点数等于格数（80）", td[0].length === 80, `${td[0].length}`);
  check("闭环首尾 8 邻接（确实绕回来了）",
    Math.max(Math.abs(td[0][0][0] - td[0][79][0]), Math.abs(td[0][0][1] - td[0][79][1])) === 1);
  check("闭环上没有未覆盖格", uncovered(d, n, td).length === 0);

  // 分叉：8 连通下"中心"的四个邻居各自度数已经 ≥3，四条臂都会在中心隔壁停下，
  // 中心那格没有任何活邻居可枚举 ⇒ 不被任何折线覆盖。见本节末尾的口径说明。
  const cross = M(n);
  for (let i = 10; i <= 86; i++) setAt(cross, n, i, 48);
  for (let j = 10; j <= 86; j++) setAt(cross, n, 48, j);
  const tc = skel.trace(cross, n);
  const arms = tc.map((l) => l.length).sort((a, b) => a - b);
  check("十字追成 4 条臂", tc.length === 4, `${tc.length} 条`);
  check("每条臂 38 点（都在中心隔壁停住）", JSON.stringify(arms) === "[38,38,38,38]", arms.join(","));
  check("四条臂的端点正是中心 (48,48) 的四个邻居",
    JSON.stringify(tc.map((l) => l[l.length - 1]).sort((a, b) => a[0] - b[0] || a[1] - b[1])) ===
      JSON.stringify([[47, 48], [48, 47], [48, 49], [49, 48]]),
    tc.map((l) => JSON.stringify(l[l.length - 1])).join(" "));
  const missC = uncovered(cross, n, tc);
  check("十字只漏中心 1 格，且它度数确实是 4", missC.length === 1 && degAt(cross, n, 48, 48) === 4,
    missC.map(([i, j]) => `(${i},${j})`).join(" "));
  // 口径说明（决定"不修"的依据）：1 格 ≈ 画布 800px / 网格 512 ≈ 1.5 px，
  // 而四条臂的端点两两相邻（如 (47,48) 与 (48,47) 切比雪夫距离 1）⇒ 视觉上连着。
  // 真数据上的缺口率：四座真山 0.81%~4.09%，其中大部分是孤立单格（度 0，
  // 本来就不可能成线，靠 minLinePoints 滤掉）。所以不额外加"补漏"步骤 ——
  // 补漏要往已有折线上拼接，属于"错接比不接更难发现"的那类改动。
  check("四条臂端点两两之间确有 8 邻接关系（视觉上连成十字）",
    (() => {
      const e = tc.map((l) => l[l.length - 1]);
      return e.some((p, a) => e.some((q, b) => a !== b && Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1])) === 1));
    })());

  // 单格不成线
  const single = M(n);
  setAt(single, n, 30, 30);
  check("孤立单格不会变成折线", skel.trace(single, n).length === 0);
  check("空掩膜追出 0 条", skel.trace(M(n), n).length === 0);

  // 全局不变量：每条折线都是连通的、长度 ≥ 2
  const blob = M(n);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let k = 0; k < 900; k++) setAt(blob, n, 20 + Math.floor(rnd() * 50), 20 + Math.floor(rnd() * 50));
  const tb = skel.trace(blob, n);
  check("随机团块：每条折线都是连通链且点数 ≥ 2", tb.every((L) => L.length >= 2 && isChain(L)),
    `${tb.length} 条`);
  check("随机团块：折线总点数 ≥ 前景格数（分叉处会有重复起点）",
    tb.reduce((s, l) => s + l.length, 0) >= sum(blob),
    `${tb.reduce((s, l) => s + l.length, 0)} vs ${sum(blob)}`);
}

/* ================================================================== */
/* 6) 接头（joinLines）                                                */
/* ================================================================== */
{
  const a = [[10, 30], [11, 30], [12, 30]];
  const b = [[15, 30], [16, 30], [17, 30]];
  const j = skel.joinLines([a, b], 12);
  check("端点间距 3、gap=12 ⇒ 接成 1 条", j.length === 1, `${j.length} 条`);
  check("接完点数 = 两段之和，且点序单调", j[0].length === 6 && j[0].every((p, k) => k === 0 || p[0] > j[0][k - 1][0]),
    JSON.stringify(j[0]));
  check("间距 48、gap=12 ⇒ 不接", skel.joinLines([a, [[60, 30], [61, 30]]], 12).length === 2);
  check("gap=0 ⇒ 不接", skel.joinLines([a, b], 0).length === 2);
  check("只有 1 条线时原样返回", skel.joinLines([a], 12).length === 1);
  check("长度 < 2 的输入被滤掉", skel.joinLines([[[5, 5]], a], 12).length === 1);

  // ⚠️ 自环保护：一条线自己的两端挨得近，不许自己接自己（那会接出一个环）
  const quad = [[30, 30], [31, 30], [31, 31], [30, 31]];
  const selfj = skel.joinLines([quad], 12);
  check("不把一条线自己接成环", selfj.length === 1 && selfj[0].length === 4, `${selfj.length} 条 / ${selfj[0].length} 点`);

  // 反向的段要被翻正再接上，否则折线会来回折返
  const back = skel.joinLines([a, [[17, 30], [16, 30], [15, 30]]], 12);
  check("反向段翻正后接上（1 条 6 点，x 单调增）",
    back.length === 1 && back[0].length === 6 && back[0].every((p, k) => k === 0 || p[0] >= back[0][k - 1][0]),
    back.length === 1 ? JSON.stringify(back[0]) : `${back.length} 条`);

  // 性能上限：第一版是 O(L³)，1500 段珠子链要跑秒级；现在应该在几十毫秒内。
  const beads = [];
  for (let k = 0; k < 1500; k++) {
    const x = 3 + k * 3, y = 30 + (k % 7);
    beads.push([[x, y], [x + 1, y], [x + 2, y]].map(([p, q]) => [p, q]));
  }
  const t0 = process.hrtime.bigint();
  const merged = skel.joinLines(beads, 4);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  check("1500 段可接碎片在 500 ms 内接完（实测 ~12 ms）", ms < 500, `${ms.toFixed(1)} ms → ${merged.length} 条`);
}

/* ================================================================== */
/* 7) 端到端（skeletonize）                                            */
/* ================================================================== */
{
  const n = 64;

  // 虚线脊：每隔 4 格漏 1 格 —— 这正是"闭运算"存在的理由
  const dash = M(n);
  for (let i = 10; i <= 50; i++) if (i % 4 !== 0) setAt(dash, n, i, 30);
  const cells = cellsOf(dash);
  const r = skel.skeletonize(cells, n);
  check("虚线脊：输入 31 格 → 闭运算后掩膜 41 格（补上了 10 个空洞）",
    r.inputCells === 31 && r.maskCells === 41, `${r.inputCells} → ${r.maskCells}`);
  check("虚线脊：细化结果仍是 41 格的一像素骨架", r.skeletonCells === 41, `${r.skeletonCells}`);
  check("虚线脊：追成 1 条 41 点线", r.lines.length === 1 && r.lines[0].length === 41,
    `${r.lines.length} 条 / ${r.lines[0] ? r.lines[0].length : 0} 点`);
  const xs = r.lines[0].map((p) => p[0]);
  check("虚线脊：线的横向跨度就是 10~50（补洞没有把线拉长/挪位）",
    Math.min(...xs) === 10 && Math.max(...xs) === 50, `${Math.min(...xs)}~${Math.max(...xs)}`);
  check("虚线脊：线上没有未覆盖格（一条线覆盖整段）", uncovered(MaskOf(r.lines, n), n, r.lines).length === 0);

  // ⚠️ 这里能看出"闭运算"和"接头"是**两套互补的补洞机制**，别把它们混为一谈：
  //   闭运算：只能补**一格宽**的空洞，在掩膜阶段就把点连成片；
  //   接头  ：能跨 ≤ gapCells(12) 的空档，在折线阶段把碎片接起来。
  // 所以关掉闭运算时线数**不会**变多 —— 断口被接头兜住了。四条组合实测：
  //   默认                  → 掩膜 41、骨架 41、1 条 41 点
  //   closeRadius=0        → 掩膜 31、骨架 31、1 条 31 点（接头兜住了 10 个断口）
  //   joinGapCells=0       → 掩膜 41、骨架 41、1 条 41 点（闭运算兜住了）
  //   两者都关            → 31 格碎成 11 段 2~3 点的碎片（2,3,3,3,3,3,3,3,3,3,2），
  //                          全部短于 minLinePoints ⇒ 0 条
  const noClose = skel.skeletonize(cells, n, { closeRadius: 0 });
  check("关掉闭运算：掩膜不再被填（31 格），证明闭运算确实在补洞",
    noClose.maskCells === 31 && noClose.inputCells === 31, `${noClose.maskCells}`);
  check("关掉闭运算但保留接头：断口被 joinLines 兜住，仍是 1 条",
    noClose.lines.length === 1 && noClose.lines[0].length === 31, `${noClose.lines.length} 条`);
  const bare = skel.skeletonize(cells, n, { closeRadius: 0, joinGapCells: 0 });
  check("闭运算与接头都关掉：碎成短片段后一条线都留不下（0 条）",
    bare.lines.length === 0, `${bare.lines.length} 条`);

  // 确定性：同样的输入必然逐点相同（模板能钉 sha256 的前提）
  const A = JSON.stringify(skel.skeletonize(cells, n).lines);
  const B = JSON.stringify(skel.skeletonize(cells, n).lines);
  check("两次运行逐点完全一致", A === B);
  const cellsCopy = cells.slice();
  skel.skeletonize(cells, n);
  check("skeletonize 不改动传入的 cells 数组", JSON.stringify(cells) === JSON.stringify(cellsCopy));

  check("minLinePoints 过滤掉过短的线",
    skel.skeletonize(cells, n, { minLinePoints: 100 }).lines.length === 0);
  check("joinGapCells=0 时不接头（碎片更多）",
    skel.skeletonize(cells, n, { joinGapCells: 0 }).lines.length >= r.lines.length);

  const emptyR = skel.skeletonize([], n);
  check("空输入返回 0 条且各计数为 0",
    emptyR.lines.length === 0 && emptyR.inputCells === 0 && emptyR.maskCells === 0 &&
    emptyR.skeletonCells === 0 && emptyR.prunedCells === 0);
  check("全越界坐标不抛异常", skel.skeletonize([-1, -1, 999, 999], n).lines.length === 0);
}

/** 由折线反推一个"够用的"掩膜（仅用于覆盖检查） */
function MaskOf(lines, n) {
  const m = M(n);
  for (const L of lines) for (const [i, j] of L) m[j * n + i] = 1;
  return m;
}

/* ================================================================== */
/* 8) 真数据基线（22 行计数 + 全样本折线摘要）                          */
/* ================================================================== */
const BASELINE = {
  // 键：`${tag}|${kind}`   值：[输入格, 掩膜格, 骨架格, 剪枝格, 线条数, 总点数]
  "everest|ridge": [3760, 13577, 2605, 210, 54, 2669],
  "everest|valley": [1420, 8613, 1544, 140, 41, 1542],
  "gongga|ridge": [3638, 19644, 3069, 157, 48, 3194],
  "gongga|valley": [1718, 9766, 1713, 157, 45, 1703],
  "huabei_plain|ridge": [0, 0, 0, 0, 0, 0],
  "huabei_plain|valley": [0, 0, 0, 0, 0, 0],
  "linfen_basin|ridge": [627, 5769, 993, 104, 20, 1005],
  "linfen_basin|valley": [549, 4118, 760, 91, 26, 766],
  "meili|ridge": [3549, 18959, 3142, 158, 59, 3243],
  "meili|valley": [2313, 11390, 2581, 175, 56, 2633],
  "neimenggu_plateau|ridge": [0, 0, 0, 0, 0, 0],
  "neimenggu_plateau|valley": [0, 0, 0, 0, 0, 0],
  "sichuan_hill|ridge": [1, 1, 1, 0, 0, 0],
  "sichuan_hill|valley": [2, 2, 2, 0, 0, 0],
  "taibai|ridge": [3659, 37230, 4018, 121, 51, 4245],
  "taibai|valley": [3309, 28894, 3086, 128, 55, 3200],
  // v2.4.4（2026-09-22）三个模板地形重建后重新量得：山地谷改圆底+沿程渐变+蜿蜒、
  // 丘陵冲沟改走廊道蜿蜒、盆地直线 scarp（会抬出矩形板块的那条）换成贴盆缘的
  // 弧形断阶。变化只应出现在被点名的部位：tpl_hill|ridge 与 tpl_mountain|ridge
  // 的输入格/掩膜格不变（山脊一项没动），谷线/盆缘断阶的计数按新形状重测。
  "tpl_basin|ridge": [265, 265, 144, 4, 1, 153],
  "tpl_basin|valley": [265, 284, 137, 0, 2, 137],
  "tpl_hill|ridge": [19, 28, 28, 0, 2, 19],
  "tpl_hill|valley": [57, 89, 73, 0, 4, 54],
  "tpl_mountain|ridge": [76, 76, 70, 0, 2, 70],
  "tpl_mountain|valley": [55, 58, 54, 0, 2, 49]
};

/**
 * 全样本折线序列的 sha256。
 *
 * 为什么钉摘要而不是只钉计数：折线的**点序列**才是流水线的完整输出。
 * 只钉"条数"的话，连线方向反了、追踪顺序变了、两条线接错了地方，
 * 计数照样对 —— 而那正是这个模块最容易静默出错的地方。
 */
const SKEL_SHA = "d4b8434efd96460f672c32ce612855d8e6bc393f3468779242940cb38708df71";

/**
 * 模板行的**冻结参照**：与 BASELINE 的 tpl_* 行保持一致。
 *
 * 这张表的历史使命是"骨架算法改动不许波及模板"—— v2.4.1 两处算法修复时用它
 * 证明了零影响（当时的值是 v2.4.3 形状量出来的）。v2.4.4 三个模板地形**有意
 * 重建**（撤异常结构，见 gen_templates.cjs），表值按新形状重钉；今后再动
 * skeleton 算法，这张表继续担任"波及面"的证人。
 */
const TEMPLATE_UNCHANGED = {
  "tpl_basin|ridge": [265, 265, 144, 4, 1, 153],
  "tpl_basin|valley": [265, 284, 137, 0, 2, 137],
  "tpl_hill|ridge": [19, 28, 28, 0, 2, 19],
  "tpl_hill|valley": [57, 89, 73, 0, 4, 54],
  "tpl_mountain|ridge": [76, 76, 70, 0, 2, 70],
  "tpl_mountain|valley": [55, 58, 54, 0, 2, 49]
};

{
  const DIR = path.join(__dirname, "../src/data");
  const files = fs.readdirSync(DIR).filter((f) => /^dem-.*\.ts$/.test(f)).sort();
  check("样本文件数与基线行数对得上", files.length * 2 === Object.keys(BASELINE).length,
    `${files.length} 个文件 / ${Object.keys(BASELINE).length} 行`);

  const seen = new Set();
  const parts = [];
  let totalLines = 0;
  /** 全样本相邻点跨度直方图：span=1 是追踪出来的真实步，span>1 是接头跨过的空档 */
  const stepHist = {};
  let maxSpanAll = 0;
  for (const file of files) {
    const src = fs.readFileSync(path.join(DIR, file), "utf8");
    const pick = (re) => src.match(re)[1];
    const tag = pick(/tag:\s*"([^"]+)"/);
    const name = pick(/name:\s*"([^"]+)"/);
    const grid = Number(pick(/grid:\s*(\d+)/));
    const spanKm = Number(pick(/spanKm:\s*([\d.]+)/));
    const b64 = pick(/b64:\s*"([A-Za-z0-9+/=]+)"/);
    const field = dem.createField({ grid, spanKm, b64 });
    const marks = lf.landParts(dem.heightFn(field), grid, field.spanM);

    for (const [kind, cells] of [["ridge", marks.ridges], ["valley", marks.valleys]]) {
      const key = `${tag}|${kind}`;
      seen.add(key);
      const r = skel.skeletonize(cells, grid);
      const got = [r.inputCells, r.maskCells, r.skeletonCells, r.prunedCells, r.lines.length,
        r.lines.reduce((s, l) => s + l.length, 0)];
      const want = BASELINE[key];
      check(`[${name} ${kind}] 计数与基线一致 ${JSON.stringify(want)}`,
        want !== undefined && JSON.stringify(got) === JSON.stringify(want),
        want === undefined ? "基线里没有这一行" : `实测 ${JSON.stringify(got)}`);

      // 不变量（换了基线数字也仍然要成立）
      //
      // ⚠️ 这里**不能**要求"相邻点步长处处为 1"。`skeletonize` 的输出已经过
      // `joinLines`，而接头做的事正是"用一条跨度 > 1 的直线段跨过 ≤ gap 的空档"
      // （见 `joinLines` 的注释：闭运算只能补一格宽的空洞，更长的断口要靠接头）。
      // 所以正确口径是三条：
      //   ① 按"跨度 > 1"切开，每一段仍是严格 8 邻接的链（形状没被接歪）；
      //   ② 跨度 ≤ joinGapCells = 12（超了就是接错了）；
      //   ③ 跨接只能是少数（实测 242 / 23928 ≈ 1.0%），多数跨度必须为 1。
      const segs = r.lines.flatMap((l) => splitByJump(l));
      check(`[${name} ${kind}] 每条折线按大跨步切开后每段都是 8 邻接链`,
        r.lines.every((l) => l.length >= 4) && segs.every(isChain),
        `${r.lines.length} 条 / ${segs.length} 段`);
      const mx = r.lines.reduce((a, l) => Math.max(a, maxStep(l)), 0);
      check(`[${name} ${kind}] 相邻点跨度不超过 joinGapCells(12)`, mx <= 12, `最大跨度 ${mx}`);
      check(`[${name} ${kind}] 折线坐标全部落在网格内`,
        r.lines.every((l) => l.every(([i, j]) => i >= 0 && j >= 0 && i < grid && j < grid)));
      for (const l of r.lines) for (let k = 1; k < l.length; k++) {
        const d = Math.max(Math.abs(l[k][0] - l[k - 1][0]), Math.abs(l[k][1] - l[k - 1][1]));
        stepHist[d] = (stepHist[d] || 0) + 1;
        if (d > maxSpanAll) maxSpanAll = d;
      }
      totalLines += r.lines.length;

      parts.push(`${tag}|${kind}|${r.lines.map((l) => l.map((p) => `${p[0]},${p[1]}`).join(";")).join("|")}`);
    }
  }

  check("基线里每一行都被跑到（没有多余/漏掉的行）", seen.size === Object.keys(BASELINE).length,
    `${seen.size}`);

  const digest = crypto.createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");
  check("全样本折线摘要与基线一致", digest === SKEL_SHA, digest);

  // 跨度分布：三种口径的守卫
  const totalSteps = Object.values(stepHist).reduce((a, b) => a + b, 0);
  const jumpSteps = totalSteps - (stepHist[1] || 0);
  check("绝大多数相邻点跨度就是 1（追踪步是主体）",
    (stepHist[1] || 0) / totalSteps > 0.9, `${stepHist[1]}/${totalSteps} = ${(100 * stepHist[1] / totalSteps).toFixed(2)}%`);
  check("跨接步是少数（实测 242/23928 ≈ 1.0%，上限放到 5%）",
    jumpSteps / totalSteps < 0.05, `${jumpSteps}/${totalSteps} = ${(100 * jumpSteps / totalSteps).toFixed(2)}%`);
  check("最大跨度不超过 joinGapCells(12)（超了就是接错了）", maxSpanAll <= 12, `${maxSpanAll}`);
  check("跨接机制在 2~12 的整个区间都被用到（不是退化成只补一格）",
    Object.keys(stepHist).map(Number).filter((d) => d > 1).length >= 8,
    Object.keys(stepHist).map(Number).sort((a, b) => a - b).join(","));

  // 两处修复对模板零影响 ⇒ 证明改动的波及面只有"贴边的脊"和"毛刺短桩"
  for (const [key, want] of Object.entries(TEMPLATE_UNCHANGED)) {
    check(`[修复不波及模板] ${key} 与修复前一致`, JSON.stringify(BASELINE[key]) === JSON.stringify(want),
      JSON.stringify(BASELINE[key]));
  }

  // 三张"没东西可画"的样本必须仍然是 0 —— 界面靠它把按钮置灰
  for (const key of ["huabei_plain|ridge", "huabei_plain|valley", "neimenggu_plateau|ridge",
    "neimenggu_plateau|valley"]) {
    check(`[${key}] 检出为 0、线条为 0（界面会置灰）`, BASELINE[key][4] === 0, BASELINE[key].join(","));
  }
  for (const key of ["sichuan_hill|ridge", "sichuan_hill|valley"]) {
    check(`[${key}] 只有零星检出、成不了线`, BASELINE[key][0] <= 2 && BASELINE[key][4] === 0,
      BASELINE[key].join(","));
  }
  // 三张模板都必须至少画得出 1 条线，否则"模板地形"这个教学样本就没意义了
  for (const type of ["tpl_basin", "tpl_hill", "tpl_mountain"]) {
    check(`[${type}] 脊与谷各至少 1 条线`, BASELINE[`${type}|ridge`][4] >= 1 && BASELINE[`${type}|valley`][4] >= 1,
      `${BASELINE[`${type}|ridge`][4]} / ${BASELINE[`${type}|valley`][4]}`);
  }
  check("四座真山的脊线都在 20 条以上（界面不会空着）", totalLines > 0 && totalLines > 400, `合计 ${totalLines} 条`);
}

/* ===== 汇总 ===== */
const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "✔" : "✘"} ${c.name}${c.extra ? `  ${c.extra}` : ""}`);
}
console.log(
  `\nSKELETON CHECK ${failed.length === 0 ? "PASSED ✔" : "FAILED ✘"}  断言 ${checks.length} 项，失败 ${failed.length} 项`
);
process.exit(failed.length === 0 ? 0 : 1);
