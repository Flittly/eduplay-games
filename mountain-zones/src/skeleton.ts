/**
 * 骨架化：把「山脊/山谷」的点云瘦成一条条**脊线 / 谷线**。
 *
 * ## 为什么需要这一步
 *
 * `landform.ts` 检出的山脊是**一堆满足 TPI 阈值的格点**（贡嘎山有 3638 格），
 * 山谷同理。直接把点画到地形上，看到的是一片毛毛雨 ——
 * 学生认不出"这是一条脊"，因为**脊是线状概念**，而点云丢掉了"哪些点属于同一条脊"
 * 这个信息。
 *
 * 所以要把"满足条件的格子"变成"线"。这正是图像处理里的**细化
 * （thinning / skeletonization）**：把一团有宽度的区域削成一条一像素宽的骨架，
 * 且保持拓扑（不断开、不新增连接）。
 *
 * ## 四步，每步都在解决一个具体问题
 *
 * ```
 * 点云 ──①建掩膜──▶ 0/1 位图 ──②闭运算──▶ 连成片 ──③细化──▶ 一像素骨架 ──④剪枝──▶ 折线
 * ```
 *
 * ① **建掩膜**：TPI 检出的是**离散格点**，相邻点之间常有空洞（坡度刚好差一点）。
 * ② **闭运算（先膨胀后腐蚀）**：填掉那些一格宽的空洞，让同一道脊连成一片。
 *    只膨胀不腐蚀会把脊加粗、还会把邻近的两条脊糊在一起 —— 必须成对使用。
 * ③ **Zhang-Suen 细化**：经典的两子迭代细化算法，一次删一层边缘像素，
 *    收敛后剩下 8 连通的一像素骨架。**选它是因为它保持连通性**：不会把一条脊
 *    削断成两截（很多细化算法会）。
 * ④ **剪枝 + 追踪**：细化会在拐弯和加宽处留下毛刺（长度 1~3 格的短枝）。
 *    按"端点能走多远"迭代剪掉短于 `MIN_BRANCH` 的支，再把剩下的像素
 *    走成有序折线。
 *
 * ## 一条必须说清的口径
 *
 * 输出**不是**手绘的脊线，而是"检出点云的骨架"。它的位置由 `RIDGE_TPI`
 * 阈值和闭运算半径共同决定，所以界面上必须如实写明这一点
 * （`MountainZones.tsx` 的图例里那行小字），不能让学生以为那是地形本身的分水线。
 *
 * ## 纯函数、无随机、可 Node 测试
 *
 * 不 import 任何 DOM / three.js 的东西，`scripts/skeleton.test.cjs` 直接在 Node 里跑。
 */

/** 网格坐标点（i, j）。与 `profile.ts` 的 `Pt` 结构一致，但不 import 它 —— 保持本模块零依赖。 */
export type SkelPt = [number, number];

/** 8 邻域偏移。**顺序固定**（右、右下、下、左下、左、左上、上、右上）——
 *  追踪时按它取"下一个像素"，顺序定了结果才可复现。 */
const NB8: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]
];

export interface SkeletonOptions {
  /**
   * 闭运算半径（格）。默认 2。
   *
   * 太小（0/1）时离散点之间的空洞补不上，骨架会是碎线；
   * 太大（≥4）时相邻的两条脊会被糊成一条，脊数虚少。
   * 2 是在真山（点稀疏）和模板（点连续）上都能用的值。
   */
  closeRadius?: number;
  /** 剪枝阈值（格）：短于它的支全部剪掉。默认 5。 */
  minBranch?: number;
  /** 输出的最短折线长度（点数）：短于它的整条丢掉。默认 4。 */
  minLinePoints?: number;
  /** 接头阈值（格）。> 0 时把端点相近的两条线接起来，见 `joinLines`。默认 0（不接）。 */
  joinGapCells?: number;
}

export interface SkeletonResult {
  /** 折线（网格坐标）。每条至少 `minLinePoints` 个点 */
  lines: SkelPt[][];
  /** 输入的点数（= cells.length / 2） */
  inputCells: number;
  /**
   * 闭运算**之后**掩膜里的格数。
   *
   * 与 `inputCells` 的比值说明"点云有多碎"：接近 1 说明点本来就连续
   * （闭运算无事可做，孤立点也补不上）；明显大于 1 说明闭运算填掉了不少空洞。
   */
  maskCells: number;
  /** 细化后的骨架格数 */
  skeletonCells: number;
  /** 剪枝掉的格数 */
  prunedCells: number;
}

/* ------------------------------------------------------------------ */
/* ① 点云 → 掩膜                                                       */
/* ------------------------------------------------------------------ */

/** 把 `landParts` 那种 `[i,j,i,j,...]` 的平铺坐标数组转成 0/1 掩膜 */
export function maskFromCells(cells: ArrayLike<number>, n: number): Uint8Array {
  const m = new Uint8Array(n * n);
  for (let k = 0; k + 1 < cells.length; k += 2) {
    const i = cells[k] | 0;
    const j = cells[k + 1] | 0;
    if (i < 0 || j < 0 || i >= n || j >= n) {
      continue;
    }
    m[j * n + i] = 1;
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* ② 闭运算（膨胀 → 腐蚀），方形结构元                                   */
/* ------------------------------------------------------------------ */

/**
 * 方形结构元的膨胀。用**两趟一维**实现：先横向滑一遍，再纵向滑一遍。
 * 2-D 方框的膨胀等价于"横向半径 r 的膨胀"再"纵向半径 r 的膨胀"，
 * 代价从 O(r²·n²) 降到 O(r·n²)。
 *
 * 实现技巧：预计算每行/每列上的"到上一个 1 的距离"，一遍扫完即可判定
 * 半径 r 内有没有 1 —— 这就是所谓"滑动窗口最小值"的简化版（因为值只有 0/1）。
 */
export function dilate(mask: Uint8Array, n: number, r: number): Uint8Array {
  if (r <= 0) {
    return mask.slice();
  }
  const tmp = new Uint8Array(n * n);
  // 横向
  for (let j = 0; j < n; j++) {
    const row = j * n;
    let last = -n; // 上一个 1 的列号（用 -n 保证开头不会误判）
    for (let i = 0; i < n; i++) {
      if (mask[row + i]) {
        last = i;
      }
      if (i - last <= r) {
        tmp[row + i] = 1;
      }
    }
    last = n * 2;
    for (let i = n - 1; i >= 0; i--) {
      if (mask[row + i]) {
        last = i;
      }
      if (last - i <= r) {
        tmp[row + i] = 1;
      }
    }
  }
  // 纵向
  const out = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) {
    let last = -n;
    for (let j = 0; j < n; j++) {
      if (tmp[j * n + i]) {
        last = j;
      }
      if (j - last <= r) {
        out[j * n + i] = 1;
      }
    }
    last = n * 2;
    for (let j = n - 1; j >= 0; j--) {
      if (tmp[j * n + i]) {
        last = j;
      }
      if (last - j <= r) {
        out[j * n + i] = 1;
      }
    }
  }
  return out;
}

/**
 * 腐蚀。用"反向的膨胀"实现：`erode(m, r) = ~dilate(~m, r)`。
 *
 * ## 图幅外必须视为**前景**（否则贴边的脊会被整条抹掉）
 *
 * 腐蚀的判据是"邻域里全是前景"；邻域一旦跨出图幅，跨出去的那些格子怎么算，
 * 决定了贴边的脊是活是死。DEM 边界外的地形虽然未知，但**不该因为未知就
 * 抹掉已经检出的脊** ⇒ 图幅外按"和边界内侧一样是前景"处理。
 *
 * 好消息：这个口径**不用额外写代码**。`~dilate(~m, r)` 里膨胀的是补集，
 * 而 `dilate` 把图幅外视为背景（= 补集为 0 = 原掩膜为前景），正好就是
 * 我们要的语义。所以直接用 `dilate` 即可。
 *
 * ## 踩过的坑：第一版多写了一个"edge-clamp"，方向刚好是反的
 *
 * 第一版怕贴边的脊被吃掉，额外写了个 `dilateEdgeClamped`（把**补集**在
 * 边缘 r 格内强制置 1）再取反。但补集置 1 ⇒ 原掩膜在那里为 0 ⇒ 这正是
 * "图幅外视为背景"，与想达到的效果**反了**，而且它还顺带把最外 r 环
 * 无条件清零。实测两组数字：
 *
 * | 输入 | 期望 | 第一版（错的） | 现在 |
 * |---|---|---|---|
 * | 满场(全 1) erode(3) | 4096 | 3364（外 3 环被凭空抹掉） | 4096 ✔ |
 * | 贴着左边框的竖脊过闭运算 | 第 0 列 ~41 格 | **整条消失（8 列全 0）** | 第 0 列 41 格 ✔ |
 *
 * 这条错的危害是**静默**的：图幅边缘的脊线整条不见，界面上只是"那里没有脊"，
 * 看不出是被算掉的。真数据上落在最外 5 环的检出格有 138~220 个
 * （珠峰 / 贡嘎 / 梅里 / 太白），所以不是理论问题。
 */
export function erode(mask: Uint8Array, n: number, r: number): Uint8Array {
  if (r <= 0) {
    return mask.slice();
  }
  const inv = new Uint8Array(n * n);
  for (let k = 0; k < n * n; k++) {
    inv[k] = mask[k] ? 0 : 1;
  }
  // 膨胀补集时"图幅外视为背景" ⇒ 反过来就是"图幅外视为前景"，正是想要的口径
  const dil = dilate(inv, n, r);
  const out = new Uint8Array(n * n);
  for (let k = 0; k < n * n; k++) {
    out[k] = dil[k] ? 0 : 1;
  }
  return out;
}

/** 闭运算 = 先膨胀后腐蚀（填内部空洞，外形基本不变） */
export function closeMask(mask: Uint8Array, n: number, r: number): Uint8Array {
  return erode(dilate(mask, n, r), n, r);
}

/* ------------------------------------------------------------------ */
/* ③ Zhang-Suen 细化                                                   */
/* ------------------------------------------------------------------ */

/** 取 8 邻域的取值写进 `out`（按 `NB8` 顺序，P2..P9） */
function neighbors8(mask: Uint8Array, n: number, i: number, j: number, out: number[]): void {
  for (let k = 0; k < 8; k++) {
    const x = i + NB8[k][0];
    const y = j + NB8[k][1];
    out[k] = x < 0 || y < 0 || x >= n || y >= n ? 0 : mask[y * n + x];
  }
}

/** 数 0→1 的跳变次数（Zhang-Suen 的判据之一） */
function transitions(p: number[]): number {
  let t = 0;
  for (let k = 0; k < 8; k++) {
    if (p[k] === 0 && p[(k + 1) % 8] === 1) {
      t++;
    }
  }
  return t;
}

/**
 * Zhang-Suen 细化。
 *
 * 两个子迭代交替执行，每次只标记**边缘**像素：
 *   - 子迭代 A 删的是"东、南、北都是背景"的（即上/左侧边界）
 *   - 子迭代 B 删的是"西、北、南都是背景"的（即下/右侧边界）
 * 分两次是为了**对称** —— 一轮里只按一个方向删，会系统性地把线往一侧偏。
 *
 * 四个条件缺一不可：
 *   ① 邻域里 2~6 个前景（1 个是端点、≥7 是内部块，都不能删）
 *   ② 0→1 跳变恰好 1 次（保证删掉后**连通性不变**，这条是"不断线"的关键）
 *   ③④ 该子迭代对应的三个方向必须都是背景
 *
 * 收敛判据：一轮下来没有任何像素被删。
 */
export function thin(mask: Uint8Array, n: number): Uint8Array {
  const m = mask.slice();
  const p: number[] = new Array(8).fill(0);
  const toRemove: number[] = [];
  let changed = true;
  // 迭代上限：一像素宽的线一轮就能收敛；上限定在 n 保证一定终止
  // （防止某些退化形状让算法在两个子迭代间来回震荡）
  for (let iter = 0; iter < n && changed; iter++) {
    changed = false;
    for (let sub = 0; sub < 2; sub++) {
      toRemove.length = 0;
      for (let j = 1; j < n - 1; j++) {
        for (let i = 1; i < n - 1; i++) {
          if (!m[j * n + i]) {
            continue;
          }
          neighbors8(m, n, i, j, p);
          let sum = 0;
          for (let k = 0; k < 8; k++) {
            sum += p[k];
          }
          if (sum < 2 || sum > 6) {
            continue;
          }
          if (transitions(p) !== 1) {
            continue;
          }
          // p[0]=P2(右) p[1]=P3(右下) p[2]=P4(下) p[3]=P5(左下)
          // p[4]=P6(左) p[5]=P7(左上) p[6]=P8(上) p[7]=P9(右上)
          const condA = p[0] * p[2] * p[4] === 0;
          const condB = p[2] * p[4] * p[6] === 0;
          if (sub === 0) {
            if (condA && condB) {
              toRemove.push(j * n + i);
            }
          } else if (p[0] * p[2] * p[6] === 0 && p[0] * p[4] * p[6] === 0) {
            toRemove.push(j * n + i);
          }
        }
      }
      if (toRemove.length) {
        changed = true;
        for (const k of toRemove) {
          m[k] = 0;
        }
      }
    }
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* ④ 剪枝 + 追踪                                                        */
/* ------------------------------------------------------------------ */

/**
 * 每个前景像素在原掩膜里的 8 邻域前景个数（"度"）。
 *
 * ⚠️ 必须**一次性预先算好，且用原始掩膜算**，不能在追踪里边走边数。
 * 踩过的坑：第一版是"每走一格 -> 先把这格涂掉 -> 再数它的度"，
 * 结果一条 A-B-C-D 的直链走到 B 时，A 已被涂掉、只剩 C 一个活邻居，
 * 度变成 1 ⇒ 判定"到端点了"⇒ 整条链被切成 `[A,B]`、`[C,D]` 两段碎片。
 * 症状是"骨架化之后线反而更多更短了"，而且没有任何报错。
 */
function degreeMap(mask: Uint8Array, n: number): Uint8Array {
  const deg = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (!mask[j * n + i]) {
        continue;
      }
      let d = 0;
      for (let k = 0; k < 8; k++) {
        const x = i + NB8[k][0];
        const y = j + NB8[k][1];
        if (x >= 0 && y >= 0 && x < n && y < n && mask[y * n + x]) {
          d++;
        }
      }
      deg[j * n + i] = d;
    }
  }
  return deg;
}

/**
 * 剪枝：删掉"挂在分叉上的短毛刺"。
 *
 * 细化在拐弯和加宽处会留下长度 1~3 格的短枝（毛刺）。判据是
 * "从端点出发走不到 `minBranch` 步就撞上分叉" —— 按**支长**判，不按层数判。
 *
 * ⚠️ 为什么不能用"删 N 层端点"那种写法：每条线都有端点，逐层删端点
 * 会把整条骨架一层层啃光，长线也一起没。按支长判就只动短枝。
 *
 * 另外要求 `hitJunction`（确实停在分叉上）：孤立的小碎片走几步就走到头了，
 * 那不是毛刺，留给 `minLinePoints` 去滤。
 *
 * ## 踩过的坑：判"到分叉了"不能看**下一格的度**，要看**当前格还剩几个没走过的邻居**
 *
 * 第一版是：往前看一格，若那一格的度 ≥ 3 就认为"撞上分叉了"，停。
 * 但 8 连通下**紧贴分叉的那一格自己的度往往就是 3~4**（它同时挨着分叉
 * 和分叉的另一个邻居），于是走出来是这样一张表（minBranch=5，T 形毛刺）：
 *
 * | 毛刺真长 | 第一版 removed | 残留 |
 * |---|---|---|
 * | 1 | 0 | 1 格 |
 * | 2 | 0 | 2 格 |
 * | 3 | 1 | 2 格 |
 * | 4 | 2 | 2 格 |
 * | 6 | 4 | 2 格 |
 *
 * 也就是**永远少删 2 格**，残留一段 2 格的短桩挂在分叉上。这个残留不会画出来
 * （2 点 < `minLinePoints`），但会：① 让 `prunedCells` / `skeletonCells` 虚高；
 * ② 更麻烦的是它在 `trace` 之后、`minLinePoints` 过滤**之前**就参与了
 * `joinLines` —— 一段正好落在别的线附近 12 格内的短桩，会被接上去，
 * 凭空长出一条错线。
 *
 * 现在的走法：走一步就把走过的格子记进 `path`，**每格的邻居数只数"还没走过的"**。
 * 于是紧贴分叉那格的"未走过邻居" = 分叉点自己（+ 分叉的另一侧邻居）≥ 2 ⇒
 * 到此为止，`path.length` 就是毛刺真长，整支一起删（分叉点不在 path 里，不动）。
 */
export function prune(mask: Uint8Array, n: number, minBranch: number): { mask: Uint8Array; removed: number } {
  const m = mask.slice();
  const deg0 = degreeMap(m, n);
  let removed = 0;
  if (minBranch <= 0) {
    return { mask: m, removed };
  }
  const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < n && j < n ? m[j * n + i] : 0);

  const ends: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (m[j * n + i] && deg0[j * n + i] === 1) {
        ends.push(j * n + i);
      }
    }
  }

  const kill = new Set<number>();
  const path: number[] = [];
  for (const e of ends) {
    if (kill.has(e)) {
      continue;
    }
    path.length = 0;
    path.push(e);
    let ci = e % n;
    let cj = (e / n) | 0;
    let hitJunction = false;
    for (;;) {
      if (path.length > minBranch) {
        break; // 已经比 minBranch 长了 ⇒ 不是毛刺，不再往下走
      }
      let ni = -1;
      let nj = -1;
      let cnt = 0;
      for (let k = 0; k < 8; k++) {
        const x = ci + NB8[k][0];
        const y = cj + NB8[k][1];
        if (!at(x, y) || kill.has(y * n + x)) {
          continue;
        }
        // ⚠️ 关键：已经走过的格子不算"邻居" —— 否则紧贴分叉那格会把自己
        // 数成度 3，误判成"这里就是分叉"而提前一格停下
        if (path.indexOf(y * n + x) >= 0) {
          continue;
        }
        ni = x;
        nj = y;
        cnt++;
      }
      if (cnt !== 1) {
        hitJunction = cnt > 1;
        break;
      }
      path.push(nj * n + ni);
      ci = ni;
      cj = nj;
    }
    // 长度不足、且确实停在分叉上 ⇒ 整支（不含分叉点）剪掉
    if (hitJunction && path.length <= minBranch) {
      for (const k of path) {
        kill.add(k);
      }
    }
  }
  for (const k of kill) {
    if (m[k]) {
      m[k] = 0;
      removed++;
    }
  }
  return { mask: m, removed };
}

/**
 * 把骨架像素走成有序折线。
 *
 * ## 三段式，各管一类起点
 *
 * ```
 * ①端点出发  度 = 1 的像素（链的两头）
 * ②分叉出发  度 ≥ 3 的像素，每个**尚未走过的邻域方向**各走一条
 * ③环        剩下的（度全是 2 的闭合圈）
 * ```
 *
 * 先端点、后分叉、最后环，是因为"从端点出发能一次走完整条链"，
 * 而从分叉出发只能走其中一条分支 —— 后者需要按方向枚举。
 *
 * ## 为什么度要用 `degreeMap` 预计算
 *
 * 见 `degreeMap` 的注释：边走边数会把长链切成碎片。
 */
export function trace(mask: Uint8Array, n: number): SkelPt[][] {
  const used = mask.slice();
  const deg = degreeMap(mask, n);
  const lines: SkelPt[][] = [];
  const alive = (i: number, j: number) => (i >= 0 && j >= 0 && i < n && j < n ? used[j * n + i] : 0);

  /**
   * 从 (si,sj) 起走一条链，把走过的像素从 `used` 上抹掉。
   * `forceK` 给出第一步必须走的方向（分叉点要按分支枚举时用）。
   */
  function walk(si: number, sj: number, forceK = -1): void {
    const line: SkelPt[] = [[si, sj]];
    used[sj * n + si] = 0;
    let ci = si;
    let cj = sj;
    let k0 = forceK;
    for (;;) {
      let ni = -1;
      let nj = -1;
      if (k0 >= 0) {
        const x = ci + NB8[k0][0];
        const y = cj + NB8[k0][1];
        if (alive(x, y)) {
          ni = x;
          nj = y;
        }
        k0 = -1;
      } else {
        for (let k = 0; k < 8; k++) {
          const x = ci + NB8[k][0];
          const y = cj + NB8[k][1];
          if (alive(x, y)) {
            ni = x;
            nj = y;
            break;
          }
        }
      }
      if (ni < 0) {
        break;
      }
      line.push([ni, nj]);
      used[nj * n + ni] = 0;
      // 到达"不是度 2 的点"（分叉或端点）就停 —— 那是另一条链的起点
      if (deg[nj * n + ni] !== 2) {
        break;
      }
      ci = ni;
      cj = nj;
    }
    if (line.length >= 2) {
      lines.push(line);
    }
  }

  // ① 端点
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (used[j * n + i] && deg[j * n + i] === 1) {
        walk(i, j);
      }
    }
  }
  // ② 分叉：每个还没走过的方向各走一条
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (!used[j * n + i] || deg[j * n + i] < 3) {
        continue;
      }
      for (let k = 0; k < 8; k++) {
        const x = i + NB8[k][0];
        const y = j + NB8[k][1];
        if (alive(x, y)) {
          walk(i, j, k);
        }
      }
      // 分支都走完了，分叉点自己也没用了
      used[j * n + i] = 0;
    }
  }
  // ③ 剩下的闭合环
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (used[j * n + i]) {
        walk(i, j);
      }
    }
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/* 串起来                                                              */
/* ------------------------------------------------------------------ */

/**
 * 默认参数（在 11 个样本上量出来的，见 `skel_combo` 那轮扫描）。
 *
 * | 参数 | 值 | 定它的依据 |
 * |---|---|---|
 * | `closeRadius` | 5 | 4 时模板丘陵的谷（46 个孤立检出格）细化后**一条线都画不出**；5 起能得到 1 条 13 点的谷线。再大（6+）会把真山里靠得近的两条脊糊成一条 |
 * | `joinGapCells` | 12 | 真山的碎片从 175 条降到 53 条（贡嘎山脊），而模板的 1~3 条线不受影响 |
 * | `minBranch` | 5 | 细化在拐弯处留的毛刺长度都在 1~4 格 |
 * | `minLinePoints` | 4 | 更短的不是"线"，是噪点 |
 */
const DEFAULTS: Required<SkeletonOptions> = {
  closeRadius: 5,
  minBranch: 5,
  minLinePoints: 4,
  joinGapCells: 12
};

/**
 * 点云 → 折线。四步流水线，见文件头。
 *
 * ⚠️ 全流程确定性：没有任何随机数，邻域顺序固定，遍历一律按栅格顺序
 * （先行后列）。同样的输入必然得到逐点相同的输出 —— 回归脚本可以钉指纹。
 */
export function skeletonize(
  cells: ArrayLike<number>,
  n: number,
  opts: SkeletonOptions = {}
): SkeletonResult {
  const o = { ...DEFAULTS, ...opts };
  const inputCells = Math.floor(cells.length / 2);
  const mask = maskFromCells(cells, n);
  let rawCells = 0;
  for (let k = 0; k < mask.length; k++) {
    if (mask[k]) {
      rawCells++;
    }
  }
  if (rawCells === 0) {
    return { lines: [], inputCells, maskCells: 0, skeletonCells: 0, prunedCells: 0 };
  }
  const closed = closeMask(mask, n, o.closeRadius);
  let maskCells = 0;
  for (let k = 0; k < closed.length; k++) {
    if (closed[k]) {
      maskCells++;
    }
  }
  const skel = thin(closed, n);
  const { mask: cut, removed } = prune(skel, n, o.minBranch);
  let skeletonCells = 0;
  for (let k = 0; k < cut.length; k++) {
    if (cut[k]) {
      skeletonCells++;
    }
  }
  let lines = trace(cut, n);
  if (o.joinGapCells > 0) {
    lines = joinLines(lines, o.joinGapCells);
  }
  lines = lines.filter((l) => l.length >= o.minLinePoints);
  return { lines, inputCells, maskCells, skeletonCells, prunedCells: removed };
}

/**
 * 把折线接成**更少、更长**的线：端点间距 ≤ `gapCells` 的两条线接起来。
 *
 * ## 为什么需要
 *
 * 闭运算只能补上"一格宽"的空洞。真实 DEM 的检出点云里有更长的断口
 * （一段脊的坡度整体差一点就整段漏检），细化后会得到一堆 2~5 点的小线段，
 * 画出来还是"毛毛雨"。接一下，视觉上才是一条脊。
 *
 * ## 性能：第一版是"每次合并就从头重扫"，O(L³) —— 实测 4.4 秒
 *
 * 太白山脊细化后有 1182 条碎片，朴素的
 * `while (有合并) { for a for b { ... } }` 每成功合并一次就把整轮 O(L²)
 * 重新跑一遍，总代价 ~L³ ≈ 1.3e9 次距离计算，**单次换样本 4.4 秒**
 * （其它所有步骤加起来不到 30 ms）。
 *
 * 现在改成：**端点空间索引 + 单向扫描**。
 *   - 端点按 `gapCells` 粗格分桶；两点距离 ≤ gap ⇒ 必在同一个或相邻粗格里，
 *     所以每个端点只需查 3×3 个桶，候选数是个位数。
 *   - 每条线只在"尾端"延伸（要接头的方向不对就先整条反向再试），
 *     接上一条就把被接的那条标记为已消费，**不回头重扫**。
 *   - 一轮下来没接上任何一条就收敛。
 * 复杂度从 O(L³) 降到 O(L·k·轮数)，实测降到 10 ms 量级。
 *
 * 判据刻意保守（只接**端点对端点**、不接成环），因为错接比不接更难发现：
 * 一条错误的连线看起来和正确的脊一模一样。
 */
export function joinLines(lines: SkelPt[][], gapCells = 6): SkelPt[][] {
  const cur: SkelPt[][] = lines.filter((l) => l.length >= 2).map((l) => l.slice());
  if (!(gapCells > 0) || cur.length < 2) {
    return cur;
  }
  const g = Math.max(1, Math.floor(gapCells));
  const dead = new Uint8Array(cur.length);
  const BIG = 1 << 16;
  const bucket = (x: number, y: number) => ((y / g) | 0) * BIG + ((x / g) | 0);

  for (let round = 0; round < 32; round++) {
    // 重建端点索引（上一轮接过之后端点位置变了）
    const idx = new Map<number, number[]>();
    for (let k = 0; k < cur.length; k++) {
      if (dead[k] || cur[k].length < 2) {
        continue;
      }
      const L = cur[k].length;
      for (const end of [0, 1] as const) {
        const p = cur[k][end === 0 ? 0 : L - 1];
        const b = bucket(p[0], p[1]);
        const list = idx.get(b);
        // 存 lineIdx * 2 + end（end 0 = 头，1 = 尾）
        if (list) {
          list.push(k * 2 + end);
        } else {
          idx.set(b, [k * 2 + end]);
        }
      }
    }

    /** 在 p 附近找一个可接的（另一条线的）端点；返回 { j, end } 或 null */
    const findNear = (p: SkelPt, self: number, forbid: SkelPt | null): { j: number; end: number; d: number } | null => {
      let best: { j: number; end: number; d: number } | null = null;
      const bx = (p[0] / g) | 0;
      const by = (p[1] / g) | 0;
      for (let cy = by - 1; cy <= by + 1; cy++) {
        for (let cx = bx - 1; cx <= bx + 1; cx++) {
          const list = idx.get(cy * BIG + cx);
          if (!list) {
            continue;
          }
          for (const ent of list) {
            const j = ent >> 1;
            if (j === self || dead[j]) {
              continue;
            }
            const q = cur[j][ent & 1 ? cur[j].length - 1 : 0];
            // 不许和"本线自己的另一端"相接（那会接成一个环）
            if (forbid && q[0] === forbid[0] && q[1] === forbid[1]) {
              continue;
            }
            const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
            if (d <= g && (!best || d < best.d)) {
              best = { j, end: ent & 1, d };
            }
          }
        }
      }
      return best;
    };

    let merged = 0;
    for (let k = 0; k < cur.length; k++) {
      if (dead[k] || cur[k].length < 2) {
        continue;
      }
      // 一条线最多在一个方向上挂满整轮；挂完再换另一端
      for (let side = 0; side < 2 && !dead[k]; side++) {
        for (;;) {
          const L = cur[k].length;
          const tail = cur[k][L - 1];
          const head = cur[k][0];
          let hit = findNear(tail, k, head);
          if (!hit) {
            // 尾端接不上 ⇒ 反向，用"头"当尾再试一次
            cur[k].reverse();
            hit = findNear(cur[k][cur[k].length - 1], k, cur[k][0]);
            if (!hit) {
              cur[k].reverse();
              break;
            }
          }
          const seg = hit.end === 0 ? cur[hit.j] : cur[hit.j].slice().reverse();
          // 去掉重复的接点，避免折线里出现一个位置的两个连续点
          const skip =
            seg.length > 1 && seg[0][0] === cur[k][cur[k].length - 1][0] &&
            seg[0][1] === cur[k][cur[k].length - 1][1]
              ? 1
              : 0;
          cur[k] = cur[k].concat(skip ? seg.slice(skip) : seg);
          dead[hit.j] = 1;
          merged++;
        }
      }
    }
    if (!merged) {
      break;
    }
    // 压缩：把已消费的线摘掉，下一轮重建索引
    let w = 0;
    for (let k = 0; k < cur.length; k++) {
      if (!dead[k]) {
        cur[w] = cur[k];
        dead[w] = 0;
        w++;
      }
    }
    cur.length = w;
    dead.fill(0, 0, w);
    if (w < 2) {
      break;
    }
  }
  return cur;
}
