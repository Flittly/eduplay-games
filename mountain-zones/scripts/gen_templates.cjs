/**
 * 模板地形生成器（v2.4.0 新增）。
 *
 * ## 为什么要有「模板地形」这一档
 *
 * 现有 8 个样本全是**真实 DEM** —— 真实的好处是可信，代价是**不标准**：
 * 贡嘎山的山脊被冰川切得七零八落、山谷分叉成树枝状，学生在上面根本找不出
 * 「等高线凸向低处」那条规律。而课本上的等高线地形图是**示意图**：
 * 两个峰、一道脊、一条谷、一处陡崖、一个鞍部，五类部位各一个，干净利落。
 *
 * 模板地形补的就是这一块：**用解析函数造出来的、形状完全可控的地形**，
 * 每个样本只讲一件事，术语与课本严格对齐。真实样本一个不动，两档并存。
 *
 * ## 为什么是解析函数，不是噪声地形
 *
 * 模板的验收标准是「五类地形部位**都真的被检测出来**」，而检测判据
 * （`src/landform.ts`）是有物理门槛的：山脊要 `TPI ≥ 70 m`（即 3 格内相对起伏
 * 约 140 m），陡崖要单格坡度落在 `65°~80°` 之间。用噪声地形去凑这些门槛
 * 只能靠试；改成解析函数后，**每个门槛都能反解出参数**：
 *
 * | 部位 | 判据 | 反解出的设计式 |
 * |---|---|---|
 * | 山峰 | 比 ±12 格内最低点高 `max(45, 0.22×全图高差)` | 峰顶到 12 格外的落差直接给定 |
 * | 山脊 | `TPI ≥ 70` | 垄岗的横向坡度 ≥ `2×70/(3×格距)` |
 * | 山谷 | `TPI ≤ −70` | 同上，取负 |
 * | 鞍部 | 最大生成树上的 key col，下凹 ≥ `max(25, 0.03×全图高差)` | 两道垄之间的垭口高度直接给定 |
 * | 陡崖 | 单格坡度 `65°~80°`（超 80° 会被物理闸门当数据异常剔除） | 断层的落差/过渡带宽 = `tan(65°)~tan(80°)` |
 *
 * **顺带一个好处**：解析地形没有噪声，所以 `suspect`（被陡崖物理闸门剔除的异常格）
 * 必然是 0。真实 DEM 里贡嘎山剔了 135 格，模板地形一格都不该有 ——
 * 这一点由 `scripts/template.test.cjs` 钉住，它也顺便证明了"闸门不是摆设"。
 *
 * ## 三个模板各自的形状
 *
 * - **模板山地**：两个圆顶主峰 + 一道连接它们的垄岗（垭口就在垄上）+ 一条切进西南坡的
 *   山谷 + 西坡一段断层崖。五类部位各一处，对应课本那张标准的等高线地形图。
 *   （v2.4.4：山谷从"等深笔直尖底刻槽"重做成圆底、沿程加深加宽、蜿蜒。）
 * - **模板丘陵**：三条窄长的**垄岗状丘陵** + 一处小垭口。垄岗是丘陵里最典型的形态
 *   （川中丘陵的方山、黄土丘陵的墚），横向坡够陡才会被 TPI 认成山脊。
 *   （v2.4.4：三条冲沟从等深笔直刻槽重做成走廊道蜿蜒、圆底、两端收浅。）
 * - **模板盆地**：低平盆底 + 一圈环形山（盆缘），盆缘上有几个高低不一的峰与垭口、
 *   几条放射状冲沟（山谷）、以及西侧内坡上的一段盆缘断层崖。**断层崖是照着临汾盆地
 *   来的** —— 汾渭地堑的盆缘正断层在地貌上就是这么个东西。
 *   （v2.4.4：断层崖从"悬在盆底中央的直线墙"重做成贴盆缘的弧形断阶。）
 *
 * ## 纪律：模板地形绝不冒充真实地点
 *
 * 三个模板的 `isTemplate: true`，`lat/lon` 只是「纬度滑杆的默认值 / 占位符」，
 * **不对应任何真实经纬度**。界面上它们不画中国地图，只给一张说明卡；
 * `scripts/dem.test.cjs` 也把它们排除在「取景在中国境内」那条断言之外 ——
 * 让一条地理断言在模板身上"顺便通过"，等于悄悄把它说成真的。
 *
 * 用法：`node scripts/gen_templates.cjs`
 *      （需先 `npm run test:data` 刷新 `scripts/_landform.cjs`；下面有新鲜度守门）
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

/* ------------------------------------------------------------------ */
/* 新鲜度守门（同 gen_landforms.cjs 的约定）                            */
/* ------------------------------------------------------------------ */

const judgePath = path.join(__dirname, "_landform.cjs");
if (!fs.existsSync(judgePath)) {
  console.error(`\n✘ 缺少 ${path.basename(judgePath)} —— 先跑一次 \`npm run test:data\`。\n`);
  process.exit(3);
}
for (const src of ["src/landform.ts", "src/contour.ts"]) {
  const a = fs.statSync(path.join(ROOT, src)).mtimeMs;
  if (a > fs.statSync(judgePath).mtimeMs + 1) {
    console.error(
      `\n✘ ${src} 比 scripts/_landform.cjs 新 —— 判据产物过期了。\n` +
        `  先跑 \`npm run test:data\`（或 \`npm run gen:landforms\`）刷新它，再跑本脚本。\n`
    );
    process.exit(3);
  }
}
const lf = require(judgePath);

/* ------------------------------------------------------------------ */
/* 通用形状函数（全部解析、无随机数 ⇒ 每次生成逐字节一致）              */
/* ------------------------------------------------------------------ */

const GRID = 256;
const D = GRID - 1;

/**
 * 钟形核：中心 1、半径 R 处 0，且 R 处导数为 0（C¹ 连续，不会出现折角）。
 * `p` 越大顶部越"圆缓"、底部越"收得快"。横向最大坡度 = `1.5·H/R`（在 `r = R/√2` 处）。
 */
function dome(d, R, p) {
  if (d >= R) return 0;
  const t = 1 - (d / R) * (d / R);
  return Math.pow(t, p);
}

/**
 * 锥核：中心 1、半径 R 处 0，**顶部是尖的**（在中心处就有坡度 H/R）。
 *
 * ## 为什么必须有这一个，不能全用 `dome`
 *
 * 山脊的判据是 TPI ≥ 70 m（自己比菱形邻域平均值高 70 m）。`dome` 在顶点处导数为 0
 * —— 圆顶附近一片平坦，菱形邻域的平均值几乎等于顶点高度 ⇒ TPI 接近 0。
 * 算过一遍：半宽 1650 m、高 620 m 的圆顶垄，TPI 只有 **34 m**，怎么调都够不到 70。
 * 换成线性锥（顶点就是尖的、邻域立刻掉下去），半宽 560 m 时 TPI ≈ **103 m** ✔。
 *
 * 物理上也对：真实山脊的脊线本来就是尖的（两侧坡面相交成脊），不是圆顶。
 */
function cone(d, R) {
  if (d >= R) return 0;
  return 1 - d / R;
}

/**
 * 圆底锥：`cone` 的**尖底**换成半径 r 的圆角（C¹ 连接），两侧仍是线性坡。
 *
 * ## v2.4.4 为什么要有它
 *
 * 模板山地/丘陵的谷原来直接用 `cone` 刻 —— 中心线处是一个折角，三维渲染里
 * 读成"人工挖的水渠"（用户原话「很深、类似河道的不自然凹槽」）。
 * 但谷的检测判据（TPI ≤ −70 m）又不允许把底做宽：TPI 邻域 24 格里
 * **16 格在垂距 ≤1 格处**（垂距 0 的 6 格 + 垂距 1 的 10 格，见 buildHill 注释），
 * 剖面必须在 1 格内掉下 ≥0.2×全深，"宽平底"的 U 形谷会让 TPI 归零。
 * 圆底半径只敢取 **≤0.5 格**：两头的约束都能满足。
 *
 * 圆角段 `d<r`：`1−(d²+r²)/(2rW)`，在 d=r 处与线性段 C¹ 接上（值 1−r/W、斜率 −1/W），
 * 中心处斜率 0。r→0 时退化为 `cone`。
 */
function rcone(d, W, r) {
  if (d >= W) return 0;
  if (d < r) return 1 - (d * d + r * r) / (2 * r * W);
  return 1 - d / W;
}

function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** 平滑台阶：e0 处 0、e1 处 1，最大导数 = 1.5/(e1−e0) */
function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** 点到线段（含端点）的距离，单位与入参一致 */
function distSeg(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? clamp01((wx * vx + wy * vy) / len2) : 0;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function distPoly(px, py, pts) {
  let best = Infinity;
  for (let k = 0; k + 1 < pts.length; k++) {
    const d = distSeg(px, py, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * 带沿程位置的折线距离场：除了最近距离，还返回最近点在折线上的**归一化位置**
 * `pos ∈ [0,1]`（0=头、1=尾）。谷的深度/宽度沿程渐变全靠它：
 * 河谷是"源头浅窄、向下加深加宽"的，等深等宽的刻槽是运河的形状。
 *
 * 最近段切换处（拐角附近）pos 连续：两侧都映射到拐角自身的累计长度附近。
 */
function distPolyT(px, py, pts) {
  const segLen = [];
  let total = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const L = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
    segLen.push(L);
    total += L;
  }
  let best = Infinity;
  let bestPos = 0;
  let acc = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const ax = pts[k][0];
    const ay = pts[k][1];
    const vx = pts[k + 1][0] - ax;
    const vy = pts[k + 1][1] - ay;
    const len2 = vx * vx + vy * vy;
    const t = len2 > 0 ? clamp01(((px - ax) * vx + (py - ay) * vy) / len2) : 0;
    const d = Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
    if (d < best) {
      best = d;
      bestPos = total > 0 ? (acc + t * segLen[k]) / total : 0;
    }
    acc += segLen[k];
  }
  return { d: best, pos: bestPos };
}

/**
 * 确定性散列：把三个整数映射到 [0,1)。
 *
 * ## 为什么这不是"随机数"
 *
 * **没有种子、没有状态、没有调用顺序依赖** —— 同一个 `(a,b,k)` 永远给同一个值，
 * 在任何一台机器、任何一次运行上都是。所以"逐字节可复现"这条性质不受影响，
 * 生成物照样能拿 sha256 钉成只读契约。
 *
 * ## 为什么需要它
 *
 * 模板丘陵要 9×9 = 81 座丘。手写 81 组坐标既冗长、又很难写得"没有网格感"；
 * 而这里要的恰恰就是"没有网格感"，不是"随机"。用散列给格位加抖动，
 * 既打散了规律，又保持了表格式的可复现性。
 *
 * 实现用 `Math.imul`（32 位整数乘法）+ 异或移位，**全程整数运算** ——
 * 不用 `Math.sin` 那类实现精度由引擎决定的函数，避免跨机器不一致。
 */
function hash01(a, b, k) {
  let x = Math.imul(a + 0x9e37, 0x85ebca6b) ^ Math.imul(b + 0x79b9, 0xc2b2ae35) ^ Math.imul(k + 0x1f83, 0x27d4eb2f);
  x = Math.imul(x ^ (x >>> 15), 0x2545f491);
  x ^= x >>> 13;
  x = Math.imul(x ^ (x >>> 16), 0x9e3779b1);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

/**
 * 一段「断层崖」：沿线段 A→B 的带子，法向两侧高差 `drop`，过渡带宽 `w`。
 *
 * 两端按 `endFrac` 的比例做平滑收尾（不然会是一条横贯全图的墙）。
 * 法向最大坡度 = `1.5·drop/w`，收尾段最大坡度 = `1.5·drop/(endFrac·L)`；
 * 两者正交叠加，所以设计时要验算合成坡度别超过 80°（超了会被当数据异常剔掉）。
 */
function scarp(px, py, ax, ay, bx, by, drop, w, endFrac) {
  const vx = bx - ax;
  const vy = by - ay;
  const L = Math.hypot(vx, vy);
  if (!(L > 0)) return 0;
  const tx = vx / L;
  const ty = vy / L;
  const t = (px - ax) * tx + (py - ay) * ty;
  if (t < 0 || t > L) return 0;
  const s = -(px - ax) * ty + (py - ay) * tx; // 线段左侧为负、右侧为正
  const ramp = Math.min(endFrac * L, L / 2);
  const taper = smoothstep(0, ramp, t) * smoothstep(0, ramp, L - t);
  return drop * smoothstep(-w / 2, w / 2, s) * taper;
}

/* ------------------------------------------------------------------ */
/* 三个模板地形                                                        */
/* ------------------------------------------------------------------ */

/** 网格坐标 → 米（以图幅中心为原点，i 向东、j 向南） */
function meterAt(cell) {
  return (k) => (k - D / 2) * cell;
}

/**
 * 模板山地 · spanKm 30（格距 117.6 m，与四座真山同一把尺子）
 *
 * ## ⚠️ 第一版失败得很值得记：细节全挤在图中央 ⇒ 判型判成"平原"
 *
 * 第一版只放了两个峰（半径 2.1 km）+ 一条 1.7 km 宽的垄。结果 **30×30 km 的图里
 * 超过一半的窗口整个落在平坦底板上**，而 `localReliefMedian` 取的是**中位数**
 * ⇒ 中位数 = 0 m ⇒ 一座 2350 m 起伏的地形被判成「平原」。
 *
 * 判据本身没错（中位数正是为了不被孤峰带跑），错的是"山体只占图幅中央一小块"这个构图。
 * 修法是加一层 **山体基座**（半径 15.5 km 的缓穹隆）把整幅图垫起来 ——
 * 这也是真实图幅的样子：30 km 取景窗里，山体是**填满画面**的。
 *
 * ## 设计参数（全部按判据反解）
 *
 * - 基座 H=850 / R=15500 ⇒ 单坡 4.7°，保证每个窗口都有起伏、判型不为平原
 * - 两个峰 H=1250 / 1080，半径 1650 / 1500，**圆顶**（`dome`）⇒ 峰顶圆缓、像个山峰
 * - 连接垄岗 H=600 / 半宽 **560**、**线性锥**（`cone`）⇒ 横向坡度 47°，TPI ≈ 103 ✔
 *   （圆顶版只有 34，见 `cone()` 的注释）
 * - 垄上最低处就是两峰之间的 key col ⇒ 鞍部成立 ✔
 * - 山谷 H=380 / 半宽 420、线性锥 ⇒ 坡 42°，TPI ≈ −209 ✔
 * - 断层崖 drop=380、**w=60 m（≈0.5 格距）、且过渡带中心落在两个格点之间**（i=72.5）。
 *   这一条踩了两轮才立住，值得单独记：
 *   - 第一版 w=160 m（>1 格距）⇒ 过渡带被摊到两个格上，单格只掉半级 ⇒ 58.2°，没到 65°；
 *   - 第二版 w=70 m 但中心正好在 **格点 i=72** 上 ⇒ 两侧格点各看到**半级** ⇒ 还是 58.2°。
 *   阶跃的判据看的是"相邻两个网格点之间掉了多少"，所以**相位**（过渡中心 vs 格点位置）
 *   和宽度一样要紧：宽度 <1 格、中心落在两个格点中间，才能让某一对相邻格点跨过整级
 *   ⇒ 380/117.6 = **72.8°** ✔
 */
function buildMountain() {
  /**
   * spanKm **30 → 20**（v2.4.0 第二轮）。
   *
   * 真机渲染看出来的：30 km 图幅配 3.4 km 高差，两座峰只占画面宽度 12%，
   * 整幅图读起来是"一块大缓坡上摆了两个小包"，谈不上"一处部位对应一个术语"。
   * 收成 20 km 后特征相对放大 1.5 倍（峰半径 3600 m = 18% 图幅），
   * 而且 `高差 / 跨度 = 17.3%` 已经接近 `VISUAL_RELIEF_TARGET = 0.18`，
   * 也就是说**这张地形不需要垂直夸张就立得住**（实测自动夸张落到 ×1.04，
   * 与贡嘎山的 ×1.04 同一量级）—— 示意地形本来就该是"一眼就是山"的样子。
   *
   * 判据侧的代价：`localReliefMedian` 的窗口是 ±16 格，格距从 117.6 m 缩到 78.4 m
   * 之后窗口从 ±1.9 km 变成 ±1.25 km，只会让中位数更容易过 200 m，不会更难。
   * 陡崖那一处的相位论证也不受影响（w=60 m < 1 格，中心仍在两个格点之间）。
   */
  const spanKm = 20;
  const cell = (spanKm * 1000) / D;
  const X = meterAt(cell);
  const Y = meterAt(cell);
  const h = new Float64Array(GRID * GRID);

  const BASE = 700;
  /**
   * 山体基座：既要把整幅图垫起来，又必须**本身就是一道山坡**。
   *
   * v2.4.0 第二轮把它从 `H=850`（坡度 4.7°）提到 `H=1500`（8.3°）。
   * 依据是真机渲染：H=850 时整幅图是一块**平底板**，五个部位全挤在正中那一小块，
   * 学生第一眼看到的只有"一个圆盘加两个小包"。
   * 判据这边其实早就同意"山体必须填满图幅"（`localReliefMedian` 要求过半窗口有起伏），
   * 但**填满 ≠ 拍平** —— 把基座做陡不违反任何一条判据，反而让等高线铺满整幅图。
   */
  const MASSIF = { i: 134, j: 130, R: 15500, H: 1500 };
  /**
   * 两个主峰：圆顶（峰顶要圆缓，才是「山峰」而不是「锥子」）。
   *
   * ⚠️ 半径同样在第二轮放大约 2.2 倍（1650/1500 → 3600/3300）：
   * 1650 m 只占 30 km 图幅的 5.5%，画出来是两个针尖，等高线全糊在一起，
   * 谈不上"看清闭合圈由外向内增大"。3600 m ≈ 12% 图幅，闭合圈才数得出来。
   *
   * ⚠️ 两峰间距**必须 ≤ `SADDLE_MAX_SPAN`（90 格 ≈ 10.6 km）**，否则鞍部那一步
   * 根本不会把这两座峰配成一对 —— 学生看得见两个峰，界面却说没有鞍部。
   * 取 `(100,96) → (162,150)`：间距 82.2 格 = 9.7 km ✔（原来是 106 格，超了）。
   */
  const PEAKS = [
    { i: 100, j: 96, R: 3600, H: 1500 },
    { i: 162, j: 150, R: 3300, H: 1300 }
  ];
  /** 连接垄岗：线性锥 ⇒ 脊线是尖的。半宽随峰放大到 900 m（≈7.7 格），TPI 仍有 ~107 */
  const RIDGE = { a: [100, 96], b: [162, 150], W: 900, H: 700 };
  /**
   * 垄中点的一处浅下凹。
   *
   * 不加它的话，山体基座的**中心正好落在垄的中点上**：基座在这一点抬得最高，
   * 于是垄的中点反而成了整条垄上最鼓的地方，"两峰之间"根本不是一个低处。
   * 下凹之后主垭口落到垄中点。第二轮随特征尺度一起放大到 `R=4200 / H=260`。
   *
   * ⚠️ 实测垄上仍保留两处**小鼓包**（比主峰低 1100 m）与**第二个垭口**（下凹 103 m）——
   * 这是把"窄下凹"叠在"宽穹隆"上必然出现的 W 形，不是 bug，也没有害处：
   * 一道长垄上本来就不止一个垭口（真实山脊也是如此）。要消掉它得把下凹做得比基座更宽，
   * 那样又会把主垭口一起抹平，不划算。
   */
  const DIP = { i: 131, j: 123, R: 4200, H: 260 };
  /**
   * 山谷折线（格）· **v2.4.4 重做**。
   *
   * 旧版（v2.4.0~v2.4.3）是一条**等深、近乎笔直、尖底**的 cone 刻槽：
   * 从鞍部边上 (129,120) 一刀切到 (98,202)，全程 520 m 深。三维渲染里它读成
   * "人工河道"（用户原话「很深、类似河道的不自然凹槽」），病根有三：
   *
   *   1. **尖底**：cone 在中心线处是折角，渲染成一条刀刻线；
   *   2. **等深**：真实河谷源头浅、向下加深 —— 等深槽是运河的形状；
   *   3. **笔直**：三站折线几乎共线。
   *
   * 新版三处对症：**圆底锥**（rcone，r=0.4 格）、**沿程加深**（源头系数 0.42 →
   * 谷口 1.0）、**沿程加宽**（半宽 4.6 → 6.6 格）+ 六站蜿蜒。谷口一直伸到图幅
   * 边缘附近，谷身在画面里不断头。
   *
   * 判据侧的账（用 buildHill 注释里的邻域分解算的，改参数前先算、后验）：
   * 垂距 0/1/2/3 格的权重是 6/10/6/2。半宽 6.6 格（圆底 0.4 格）时
   * TPI/H ≈ 0.18 ⇒ 谷口全深 480 m 给 TPI ≈ −86；中段（系数 0.8、半宽 ~5.9 格）
   * ≈ −77 ⇒ 谷身大部分能被检出；源头浅段（系数 <0.5）检不出 ——
   * 那本来就该是"没有谷点"的浅洼，不是缺陷。
   * 壁坡：谷口 480/(6.6×78.4) = 42.6°，源头 200/(4.6×78.4) = 29°，离
   * 陡崖门槛 65° 远得很，不会误报陡崖。
   */
  const VALLEY = {
    pts: [
      [128, 127],
      [120, 146],
      [111, 168],
      [104, 192],
      [97, 216],
      [91, 252]
    ],
    W0: 4.6,
    W1: 6.6,
    H: 480,
    head: 0.42,
    r: 0.4
  };
  /** 断层崖：主峰西南坡上的一段（格）。x 取 72.5（非整数）见上面的相位说明 */
  const CLIFF = { a: [72.5, 70], b: [72.5, 120], drop: 380, w: 60, endFrac: 0.3 };

  const mx = X(MASSIF.i);
  const my = Y(MASSIF.j);
  const rax = X(RIDGE.a[0]);
  const ray = Y(RIDGE.a[1]);
  const rbx = X(RIDGE.b[0]);
  const rby = Y(RIDGE.b[1]);
  const vpts = VALLEY.pts.map(([i, j]) => [X(i), Y(j)]);
  const cax = X(CLIFF.a[0]);
  const cay = Y(CLIFF.a[1]);
  const cbx = X(CLIFF.b[0]);
  const cby = Y(CLIFF.b[1]);

  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const px = X(i);
      const py = Y(j);
      let v = BASE;
      v += MASSIF.H * dome(Math.hypot(px - mx, py - my), MASSIF.R, 1.5);
      for (const p of PEAKS) {
        v += p.H * dome(Math.hypot(px - X(p.i), py - Y(p.j)), p.R, 1.5);
      }
      v += RIDGE.H * cone(distSeg(px, py, rax, ray, rbx, rby), RIDGE.W);
      v -= DIP.H * dome(Math.hypot(px - X(DIP.i), py - Y(DIP.j)), DIP.R, 1.5);
      const vt = distPolyT(px, py, vpts);
      const vFac = VALLEY.head + (1 - VALLEY.head) * vt.pos; // 源头浅 → 谷口深
      const vW = (VALLEY.W0 + (VALLEY.W1 - VALLEY.W0) * vt.pos) * cell; // 源头窄 → 谷口宽
      v -= VALLEY.H * vFac * rcone(vt.d, vW, VALLEY.r * cell);
      v += scarp(px, py, cax, cay, cbx, cby, CLIFF.drop, CLIFF.w, CLIFF.endFrac);
      h[j * GRID + i] = Math.round(v);
    }
  }
  return { spanKm, h };
}

/**
 * 模板丘陵 · spanKm 20（格距 78.4 m）
 *
 * ## v2.4.1 重做：从「6 座丘摊在大平板上」改成「81 座丘的丘群」
 *
 * v2.4.0 那一版是 **6 座丘 + 三组长波平面波（波长 8.5~15 km）**，用户反馈
 * 「看得非常不像是丘陵」。打印成 ASCII 立体阴影（`.workbuddy/tmp/ascii_dem.cjs`）
 * 一眼就看明白了，三条病根：
 *
 *   1. **平面波比丘大一个数量级**（15 km vs 1.4 km）⇒ 整幅图的明暗主调是那几条
 *      斜向波带，丘只是散落的小亮点。看到的是"一片缓坡"，不是"一片丘"。
 *   2. **丘太少**：6 座摊在 20×20 km 上，平均每 66 km² 才一座。
 *   3. **坡度只有 `1.5×148/1250` = 6.8°**，而默认垂直夸张 = 1（不放大）
 *      ⇒ 屏幕上就是真实的 6.8°，6.8° 在 20 km 画幅里读起来就是平地。
 *
 * ## ⚠️ 三条**量出来**的约束（不是估的，全是这一轮踩出来的）
 *
 * ### ① 跨度不能小：脊线坡度有一个由格距决定的下限
 *
 * 山脊判据是「TPI ≥ 70 m」。TPI = 自己 − 菱形邻域（半径 3 **格**）的平均海拔，
 * 所以反解出来的**坡度下限只取决于格距**，与形状无关：
 *
 *     脊线最小坡度 = atan(59.8 / 格距m)
 *       格距 78.4 m（20 km 跨度）→ 37.3°
 *       格距 47.1 m（12 km 跨度）→ 51.8°
 *       格距 31.4 m（ 8 km 跨度）→ 62.3°  ← 逼近陡崖门槛 65°
 *
 * 也就是说**跨度越小，山脊被迫越陡**，小到 8 km 时判据自己会把山脊推成悬崖。
 * 所以这一版回到 **20 km**，脊坡 39°，是"梁"该有的样子。
 *
 * ### ② 丘不能相切：窗口 33 格，捕获多少高差是可算的
 *
 * `localReliefMedian` 的窗口是 **±16 格 = 33 格**，与跨度无关（它按格取）。
 * 若丘相切（半径 14 格），一个窗口就装下整座丘 + 邻居的坡脚 ⇒ 窗口高差
 * 逼近 `1.19×丘高`，很快越过 200 m 的"山地"线；要压住就只能把丘压到 9~12°
 * —— 又变成"平地上的包"。
 *
 * 所以**丘不相切**：半径 6 格（直径 12 格）配 28 格的格位间距，
 * 一个窗口装得下整座丘、装不下邻居 ⇒ 窗口高差 ≈ 丘高 + 缓起伏 ≈ 160 m ✔
 * "很多座"靠**数量**（9×9 = 81 座）而不是靠靠拢来给。
 *
 * ### ③ 判型余量
 *
 * 丘高 130 m ⇒ 窗口高差中位数实测约 160 m，落在
 * `LOCAL_RELIEF_PLAIN = 40` 与 `LOCAL_RELIEF_MOUNTAIN = 200` 之间，两侧都留余量。
 * **实测值见 `npm run gen:templates` 的自检输出，不要拿这里的估算当结论。**
 *
 * ## 几何全部以「格」为单位
 *
 * `cell`（格距）只在最后一步把格换算成米。这样换跨度只改真实尺度、
 * 不改形状，**TPI 与坡度都不会悄悄变** —— 这是踩出来的：
 * v2.4.0 把脊/沟半宽写成 `W = 150 m`，20 km 跨度下正好 1.9 格、判据达标；
 * 跨度改到 12 km 后同样的 150 m 变成 3.2 格，比 TPI 邻域还宽
 * ⇒ **山谷点数直接归零，而程序不报任何错**。
 *
 * ## 「丘陵到底有没有山脊」这条口径修正过一次，留在这里当教训
 *
 * 更早一版写的是：「山脊判据 TPI ≥ 70 m 等价于 3 格内起伏 ≥ 140 m，
 * 即坡度 ≥ 31°，而丘陵的课本定义是『相对高度 < 200 m、坡度较缓』，两者互斥，
 * 所以**模板丘陵不硬凑山脊**」。
 *
 * **但那句话只在「圆缓的独立丘」上成立，把它当成丘陵的通论是错的。**
 * 真实丘陵（黄土丘陵的「梁」、川中丘陵的垄岗）是**梁与冲沟相间**：
 * 梁坡就是被冲沟切出来的，和沟壁是同一场侵蚀的两个面 ——
 * 凭什么同一场侵蚀切出的梁坡只有 5°？「丘陵没有山脊」这个结论，
 * 实际测量的是**我的构图**（几个圆顶摆在平板上），不是丘陵本身。
 *
 * 于是补了 `RIBS`：窄脊的几何与 `GULLIES` **完全同构、只差一个正负号**。
 *
 * 丘陵**没有陡崖**这一条是硬的：梁坡 39°、沟壁 39°，离 `CLIFF_MIN_SLOPE_DEG = 65°`
 * 差得远；陡崖还要求「单格内穿过 ≥ 2 条 100 m 参考等高线」（即单格落差 ≥ 100 m），
 * 而 78.4 m 格距上 39° 每格只掉 **63 m**。要让丘陵出陡崖只能把相对高度做到
 * 300 m 以上 —— 那已经不是丘陵了。
 */
function buildHill(over = {}) {
  const spanKm = over.spanKm ?? 20;
  const cell = (spanKm * 1000) / D;
  const X = meterAt(cell);
  const Y = meterAt(cell);
  const h = new Float64Array(GRID * GRID);

  const BASE = 320;

  /* ---------- 地貌面：短波长缓起伏 ---------- */
  /**
   * 三组平面波，**波长与丘同量级**（33 / 26 / 41 格 ≈ 2.6 / 2.0 / 3.2 km），
   * 而**幅度只有 7/6/5 m** —— 它的任务是"防止丘间出现一片纯平板"，不是"造地形"。
   *
   * ⚠️ 幅度是被**量出来**才压到这么小的：第一版用 14/12/10 m，实测
   * 带显著度的局部高点有 **295 处**（丘只有 81 座）—— 说明平面波在制造
   * 视觉噪声、抢丘的戏。压到 7/6/5 之后局部高差中位数从 163 落到 135 m，
   * 判型余量反而更大（离 200 m 的山地线远了 65 m）。
   *
   * 早先的长波版本（波长 8.5~15 km、幅 34/28/22 m）是另一回事：
   * 那种波长比丘大一个数量级，整幅图的明暗主调变成波带、丘被淹没，
   * 那才是"看起来不像丘陵"的第一病根。**短波 + 小振幅**才是对的。
   */
  const WAVES = over.waves ?? [
    { A: 7, L: 33 * cell, deg: 37 },
    { A: 6, L: 26 * cell, deg: -117 },
    { A: 5, L: 41 * cell, deg: 155 }
  ];

  /* ---------- 丘群 ---------- */
  /**
   * 9×9 格位 + **确定性散列抖动**。
   *
   * 为什么不用手写坐标：81 组手写既冗长又难维护；而"看起来随机"本身不是目的，
   * "没有网格感"才是。`hash01()` 没有种子、没有状态，同一输入永远同一输出 ⇒
   * 逐字节可复现这条性质不受影响。
   *
   * ⚠️ 抖动幅度不能大：超过半个格位间距会让相邻丘挤在一起（窗口高差越线，
   * 见文件头约束 ②）。这里取 **0.55×间距**，既打散规律又不致重叠。
   */
  const NL = over.nl ?? 9;
  const PITCH = over.pitch ?? 28;
  const ORIGIN = over.origin ?? 17;
  const HILL_R_CELLS = over.hillR ?? 7.0;
  const HILL_H = over.hillH ?? 110;

  const HILLS = [];
  for (let b = 0; b < NL; b++) {
    for (let a = 0; a < NL; a++) {
      HILLS.push({
        i: ORIGIN + a * PITCH + (hash01(a, b, 1) - 0.5) * PITCH * 0.55,
        j: ORIGIN + b * PITCH + (hash01(a, b, 2) - 0.5) * PITCH * 0.55,
        /** 半径在 0.72~1.34 倍标称值之间，米制 */
        R: HILL_R_CELLS * (0.72 + 0.62 * hash01(a, b, 3)) * cell,
        /** 高度在 0.66~1.12 倍标称值之间 */
        H: HILL_H * (0.66 + 0.46 * hash01(a, b, 4))
      });
    }
  }
  const hillAt = (a, b) => HILLS[b * NL + a];

  /* ---------- 脊（梁）与沟 ---------- */
  /**
   * 脊、沟的半宽（**格**）与高度（米）。
   *
   * 反解：菱形邻域 24 格对一条直线来说，垂距为 0 的 6 格、1 格的 10 格、
   * 2 格的 6 格、3 格的 2 格。线性锥 `1 − d/W` 下
   *
   *     TPI / H = (1/24)·[10·min(1,1/W) + 6·min(1,2/W) + 2·min(1,3/W)]
   *
   * 取 `W = 2.2 格` ⇒ 比值 0.500 ⇒ **H = 140 m 给出 TPI = 70**。
   * 这里用 **150 m ⇒ TPI ≈ 75**，留出余量；坡度为 `150/(2.2×78.4)` = **41.0°**。
   */
  const RIB_H = over.ribH ?? 140;
  /** v2.4.4：沟深 140 → 165 —— 圆底 + 沿程收浅之后中段要深一点才够 TPI 门槛 */
  const GUL_H = over.gulH ?? 165;
  const W_HALF = over.wHalf ?? 2.2;

  const ribW = W_HALF * cell;

  /** 梁：连接相邻两座丘，只取中段 60% —— 两端让丘自己的圆顶收口，不会成一道长墙 */
  function ribBetween(A, B, HH) {
    const t0 = 0.2;
    const t1 = 0.8;
    const mid = 0.5;
    const bend = 0.14;
    return {
      H: HH,
      pts: [
        [A.i + (B.i - A.i) * t0, A.j + (B.j - A.j) * t0],
        [
          A.i + (B.i - A.i) * mid - (B.j - A.j) * bend,
          A.j + (B.j - A.j) * mid + (B.i - A.i) * bend
        ],
        [A.i + (B.i - A.i) * t1, A.j + (B.j - A.j) * t1]
      ]
    };
  }
  const RIBS = over.ribs ?? [
    ribBetween(hillAt(1, 1), hillAt(2, 1), RIB_H),
    ribBetween(hillAt(4, 3), hillAt(5, 3), RIB_H),
    ribBetween(hillAt(6, 6), hillAt(7, 6), RIB_H),
    ribBetween(hillAt(2, 7), hillAt(3, 7), RIB_H)
  ];

  /** 格位中心线（格坐标）：`rowJ(b)` 是第 b 行的 j，`colI(a)` 是第 a 列的 i（廊道取行列中点） */
  const corridorJ = (b) => ORIGIN + b * PITCH + PITCH / 2;
  const corridorI = (a) => ORIGIN + a * PITCH + PITCH / 2;

  /**
   * 冲沟 · **v2.4.4 重做**：仍然 3 条、仍然走丘间的廊道，但从"等深笔直的 cone
   * 刻槽"改成**蜿蜒 + 圆底 + 两端收浅**。
   *
   * 旧版的三条沟是真机渲染里"多处类似河道的不自然结构"（用户原话）：
   * 站点几乎共线 ⇒ 一条笔直的沟；cone 尖底 ⇒ 渲染成刀刻线；全程 140 m 等深 ⇒
   * 渠化。新版每条 5~6 站、走向在廊道中心线 ±4 格内摆动（丘距 28 格，摆幅不到
   * 半个丘距，不会切穿丘顶），深度按 `0.35 + 0.65·sin(π·pos)` 变化 ——
   * **中段最深、两端收浅到 1/3**，沟首沟尾"长进"地形里，而不是一头截断。
   *
   * 判据的账（邻域分解 6/10/6/2）：半宽 2.2 格（圆底 0.25 格）时孤立沟
   * TPI/H ≈ 0.46 ⇒ H=165 中段给 −75。**半宽不敢再放宽**：0.5 格的圆底就会把
   * TPI/H 吃掉一成，2.8 格时中段只剩 −58（第一版实测谷点=0，就是它）。
   * 沟走的是**廊道**，两侧丘坡把邻域均值再抬一截，实测 TPI 比孤立算的更低；
   * 收浅端（fac<0.7）检不出 —— 沟尾本来就该"长进"地形里，不是缺陷。
   * 壁坡 165/(2.2×78.4) = 43.7°，与梁坡（41°）同量级，离 65° 的陡崖门槛远。
   *
   * 沟的条数与覆盖面积仍然刻意压低 —— 教训在 `localReliefMedian` 的**中位数**上：
   * v2.4.1 第一版放 6 条横竖交错的沟，交叠处下切叠两遍（最低点掉到 6 m），
   * 含沟窗口一多，中位数被顶到 279 m、整幅图判成"山地"。3 条走廊道的沟，
   * 含沟窗口是少数，中位数仍由丘高决定。
   */
  const GUL_W_CELLS = over.gulWCells ?? 2.2;
  const GULLIES = over.gullies ?? [
    {
      // 廊道 1：丘阵第 1、2 行之间（j ≈ 59），东西走向
      H: GUL_H,
      pts: [
        [36, corridorJ(1) - 4],
        [62, corridorJ(1) + 3],
        [86, corridorJ(1) - 3],
        [110, corridorJ(1) + 5],
        [132, corridorJ(1) - 2],
        [152, corridorJ(1) + 3]
      ]
    },
    {
      // 廊道 2：丘阵第 2、3 列之间（i ≈ 87），南北走向
      H: GUL_H,
      pts: [
        [corridorI(2) - 3, 92],
        [corridorI(2) + 2, 112],
        [corridorI(2) - 4, 132],
        [corridorI(2) + 3, 152],
        [corridorI(2) - 1, 172]
      ]
    },
    {
      // 廊道 3：丘阵第 7、8 行之间（j ≈ 227），东西走向
      H: GUL_H,
      pts: [
        [86, corridorJ(7) - 5],
        [112, corridorJ(7) + 2],
        [138, corridorJ(7) - 4],
        [164, corridorJ(7) + 4],
        [194, corridorJ(7) - 1]
      ]
    }
  ];

  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const px = X(i);
      const py = Y(j);
      let v = BASE;
      for (const w of WAVES) {
        const th = (w.deg * Math.PI) / 180;
        const k = (2 * Math.PI) / w.L;
        v += w.A * Math.cos(k * (px * Math.cos(th) + py * Math.sin(th)));
      }
      for (const c of HILLS) {
        v += c.H * dome(Math.hypot(px - X(c.i), py - Y(c.j)), c.R, 1.5);
      }
      for (const g of GULLIES) {
        const gt = distPolyT(px, py, g.pts.map(([a, b]) => [X(a), Y(b)]));
        const fac = 0.5 + 0.5 * Math.sin(Math.PI * gt.pos); // 中段最深、两端收浅到一半
        v -= g.H * fac * rcone(gt.d, GUL_W_CELLS * cell, 0.25 * cell);
      }
      for (const r of RIBS) {
        v += r.H * cone(distPoly(px, py, r.pts.map(([a, b]) => [X(a), Y(b)])), ribW);
      }
      h[j * GRID + i] = Math.round(v);
    }
  }
  return { spanKm, h };
}

/**
 * 模板盆地 · spanKm 40（格距 156.9 m）
 *
 * - 盆底 400 m，向外微微抬起（`dish` 项），到盆缘再陡然升起
 * - 盆缘＝一圈环形山：`rimH=900`，环心在 0.72×半幅处、环宽 0.28×半幅
 *   ⇒ 盆底与盆缘差 ≈ 900 m ≫ `BASIN_RIM_ABOVE_CORE=120` ✔
 * - 环上叠 5 个高低不同的峰、再乘一个三瓣的角度调制 ⇒ 相邻峰之间出现真垭口
 * - 3 条放射状冲沟（山谷）：H=260、半宽 700 m ⇒ 横向坡度 0.56 ⇒ TPI ≈ −131 ✔
 * - 盆缘断层崖（v2.4.4 弧形断阶）：西侧内坡上与盆缘同心的一段弧，drop=500、
 *   w=94 m、相位落在格点之间 ⇒ 72.6°（65°~80° 之间）✔ —— 旧版的直线 scarp
 *   抬升侧不封边，把西南角抬成一块 500 m 的矩形板块（用户看到的「长方体」），
 *   病根与重做理由见 FAULT 的注释。
 */
function buildBasin() {
  const spanKm = 40;
  const cell = (spanKm * 1000) / D;
  const X = meterAt(cell);
  const Y = meterAt(cell);
  const h = new Float64Array(GRID * GRID);

  const FLOOR = 400;
  const DISH = 60; // 盆底向外微微抬起
  const HALF = 20000; // 半幅（米）
  const RING_R = 0.72 * HALF;
  const RING_W = 0.28 * HALF;
  const RIM_H = 900;
  /** 盆缘上的峰：极角（度，从正东起逆时针）、高度（米）、半径（米） */
  const RIM_PEAKS = [
    { deg: 12, H: 250, R: 2600 },
    { deg: 88, H: 190, R: 2300 },
    { deg: 176, H: 300, R: 2800 },
    { deg: 244, H: 160, R: 2200 },
    { deg: 310, H: 220, R: 2500 }
  ];
  /** 放射状冲沟：极角（度）、深度、半宽 */
  const GULLIES = [
    { deg: 60, H: 260, W: 700 },
    { deg: 200, H: 240, W: 680 },
    { deg: 330, H: 230, W: 660 }
  ];
  /**
   * 盆缘断层崖 · **v2.4.4 重做**（西侧内缘的一段弧形断阶）。
   *
   * ## 旧版的病根：scarp 的抬升侧不封边 ⇒ 一整块矩形板块
   *
   * 旧版是一条**直线 scarp**（A(40,108)→B(74,122)，drop=500）。`scarp()` 只在
   * 法向 w=94 m 内过渡、沿走向靠 taper 收尾，**法向抬升侧不衰减** —— 于是
   * 抬升侧是一条不封口的半无限带：西南侧整整一块 500 m 高、5.8 km 宽、20 km 长
   * 的**矩形板块**被原地抬起来，三维渲染里就是用户看到的「左下方一条非常规整的
   * 长方体结构」（掩码取证见 `.workbuddy/tmp/tpl_anomaly_probe.cjs`，覆盖 6.5%
   * 图幅、全是满档 500 m）。
   *
   * ## 新版：照它本来要模仿的对象重做
   *
   * 这条崖的教学人设是临汾盆地的盆缘正断层 —— 而断层的真实形态是**长在盆缘
   * 山梁的内坡上**、与盆缘同心的一段弧，不是悬在盆底中央的一堵直墙。新版：
   *
   * - 断层迹线 = 与盆缘同心的**圆弧**（r0 = 盆缘半径 − 1.3 km，落在内坡上）；
   * - 抬升块**向外按 dome 衰减**（半宽 6 km）—— 断块抬升离断层越远越弱，
   *   也顺带把"板块延伸到图角"的病根封死（外缘 6 km 外归零）；
   * - 角向 125°~235°（西侧 ±55°）smoothstep 收口。
   *
   * 相位论证（同山地崖踩过的教训）：过渡带 w=94 m < 1 格距 156.9 m，且 r0 取
   * 13178 m 让正西方向的过渡带中心正好落在 i≈43.5（两个格点之间）⇒ (43,44)
   * 一对格点跨满级，500/156.9 = 72.6° 落进 65°~80°。弧线各处相位不同，只有
   * 部分段跨满级 —— 陡崖检测只需要"有些格"达标；而任何相邻对都不可能超过
   * (500+dome 径向梯度≈18) m/格 = 73.2° < 80°，物理闸门必然放过（suspect=0）。
   */
  const FAULT = { a0: 125, a1: 235, r0: 13178, drop: 500, w: 94, endFrac: 0.18, falloff: 6000 };

  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const px = X(i);
      const py = Y(j);
      const r = Math.hypot(px, py);
      const ang = (Math.atan2(py, px) * 180) / Math.PI; // -180~180，从正东起、向南为正
      let v = FLOOR + DISH * (r / HALF) * (r / HALF);
      // 环形山：三瓣角度调制 ⇒ 环本身高低起伏，峰之间才有垭口
      const lobe = 1 + 0.16 * Math.cos((3 * ang * Math.PI) / 180);
      v += RIM_H * lobe * dome(Math.abs(r - RING_R), RING_W, 1.5);
      for (const p of RIM_PEAKS) {
        let dAng = ang - p.deg;
        while (dAng > 180) dAng -= 360;
        while (dAng < -180) dAng += 360;
        // 极坐标下的近似平面距离（小角差足够用，且天然落在环上）
        const arc = Math.abs((dAng * Math.PI) / 180) * RING_R;
        v += p.H * dome(Math.hypot(arc, r - RING_R), p.R, 1.5);
      }
      for (const g of GULLIES) {
        let dAng = ang - g.deg;
        while (dAng > 180) dAng -= 360;
        while (dAng < -180) dAng += 360;
        const arc = Math.abs((dAng * Math.PI) / 180) * RING_R;
        v -= g.H * dome(Math.hypot(arc, r - RING_R), g.W, 1.5);
      }
      {
        // 盆缘断层崖（弧形断阶）：角向窗口内的外侧抬升，径向 dome 衰减封边
        let dAng = ang - (FAULT.a0 + FAULT.a1) / 2;
        while (dAng > 180) dAng -= 360;
        while (dAng < -180) dAng += 360;
        const half = (FAULT.a1 - FAULT.a0) / 2;
        const tap = half * FAULT.endFrac;
        const angTaper = smoothstep(0, tap, half - Math.abs(dAng));
        // ⚠️ dome 的参数必须是 ≥0 的距离：r−r0 在盆心是 −13 km，Math.pow(负数,1.5)=NaN
        // （自检里「平均 NaN」就是这个露出来的；0×NaN 也是 NaN，smoothstep 挡不住）。
        // 径向 clamp 到 0 即可 —— r<r0 的地方 ss=0，dome 取什么都不会出场。
        v +=
          FAULT.drop *
          smoothstep(-FAULT.w / 2, FAULT.w / 2, r - FAULT.r0) *
          dome(Math.max(0, r - FAULT.r0), FAULT.falloff, 1.5) *
          angTaper;
      }
      h[j * GRID + i] = Math.round(v);
    }
  }
  return { spanKm, h };
}

/* ------------------------------------------------------------------ */
/* 自检：用真实判据量一遍，不达标就报错退出                            */
/* ------------------------------------------------------------------ */

const SPECS = [
  {
    tag: "tpl_mountain",
    name: "模板山地",
    landType: "mountain",
    peakName: "示意主峰",
    /** 五类部位必须全部检出 —— 这正是模板山地存在的理由 */
    needParts: ["peak", "ridge", "valley", "saddle", "cliff"],
    build: buildMountain
  },
  {
    tag: "tpl_hill",
    name: "模板丘陵",
    landType: "hill",
    peakName: "示意丘顶",
    /**
     * 丘陵有 **山峰 / 山脊 / 山谷 / 鞍部**，唯独没有陡崖。
     *
     * 山脊这里改过一次口径（v2.4.0 第二轮）：第一版写的是「丘陵没有山脊」，
     * 那是把**我的构图**（几个圆顶摆在平板上）说成了丘陵的通论。
     * 补上 `RIBS` 窄脊之后山脊就出来了 —— 梁与冲沟同形才是对的，
     * 详见 `buildHill()` 的注释。
     *
     * 陡崖则是**真的没有**，而且这条是硬的：梁坡 47.5°，
     * `CLIFF_MIN_SLOPE_DEG = 65°` 够不到；「单格穿过 2 条 100 m 等高线」
     * 还要求单格落差 ≥ 200 m，而 78.4 m 格距上 47.5° 每格只掉 85 m。
     * 想让丘陵出现陡崖，只能把相对高度做到 300 m 以上 —— 那已经不是丘陵了。
     */
    needParts: ["peak", "ridge", "valley", "saddle"],
    build: buildHill
  },
  {
    tag: "tpl_basin",
    name: "模板盆地",
    landType: "basin",
    peakName: "示意盆缘峰",
    needParts: ["peak", "ridge", "valley", "saddle", "cliff"],
    build: buildBasin
  }
];

function quantize(h) {
  const q = new Uint16Array(h.length);
  let mn = Infinity;
  let mx = -Infinity;
  let sum = 0;
  for (let k = 0; k < h.length; k++) {
    let v = Math.round(h[k]);
    if (v < 0) v = 0;
    if (v > 65535) v = 65535;
    q[k] = v;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    sum += v;
  }
  return { q, min: mn, max: mx, mean: sum / h.length };
}

/** 全图最大单格坡度（度）—— 用与 `findCliffs` 一致的四边形 6 边口径 */
function maxSlopeDeg(q, n, cellM) {
  let best = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = q[j * n + i];
      const b = q[j * n + i + 1];
      const c = q[(j + 1) * n + i];
      const d = q[(j + 1) * n + i + 1];
      const tan = Math.max(
        Math.abs(b - a) / cellM,
        Math.abs(c - a) / cellM,
        Math.abs(d - b) / cellM,
        Math.abs(d - c) / cellM,
        Math.abs(d - a) / (cellM * Math.SQRT2),
        Math.abs(c - b) / (cellM * Math.SQRT2)
      );
      if (tan > best) best = tan;
    }
  }
  return (Math.atan(best) * 180) / Math.PI;
}

/**
 * 导出三个 builder，供参数扫描 / 反证脚本 `require` 使用。
 *
 * ⚠️ 之所以要导出，是因为踩过一个死角：自检失败会 `process.exit(1)`，
 * 而**落盘在自检之后** —— 于是"调形状"这件事会卡住：改了参数 ⇒ 自检不过
 * ⇒ 文件没写 ⇒ 探针读到的还是旧场，看起来像"改了没生效"，
 * 很容易误判成"这个方向不行"。导出 builder 后，扫描脚本能直接拿内存里的场。
 */
module.exports = { buildMountain, buildHill, buildBasin, SPECS, GRID, D, quantize, maxSlopeDeg };

function main() {
const results = [];
let failed = 0;

for (const spec of SPECS) {
  const { spanKm, h } = spec.build();
  const { q, min, max, mean } = quantize(h);
  const spanM = spanKm * 1000;
  const cellM = spanM / D;
  const hf = (i, j) => q[j * GRID + i];

  const marks = lf.landParts(hf, GRID, spanM);
  const counts = lf.landPartCounts(marks);
  const stats = lf.reliefStats(hf, GRID);
  const cls = lf.classifyLandType(stats);
  const slope = maxSlopeDeg(q, GRID, cellM);

  const missingParts = spec.needParts.filter((p) => !(counts[p] > 0));
  const problems = [];
  if (cls.type !== spec.landType) {
    problems.push(`判型 ${cls.type} ≠ 声明 ${spec.landType}（${cls.reason}）`);
  }
  if (missingParts.length) {
    problems.push(`缺少部位 ${missingParts.join("/")}`);
  }
  if (marks.cliffScan.suspect > 0) {
    problems.push(`有 ${marks.cliffScan.suspect} 格被陡崖物理闸门剔除（解析地形不该有）`);
  }
  if (slope > lf.CLIFF_SLOPE_CAP_DEG) {
    problems.push(`全图最大坡度 ${slope.toFixed(1)}° 超过物理上限 ${lf.CLIFF_SLOPE_CAP_DEG}°`);
  }

  results.push({ spec, q, min, max, mean, counts, stats, cls, slope, spanKm, cellM, marks, problems });
  if (problems.length) failed++;
}

console.log("\n================ 模板地形自检 ================");
for (const r of results) {
  const { spec, min, max, mean, stats, cls, counts, slope, cellM, problems } = r;
  console.log(
    `\n【${spec.name}】${spec.tag}  span ${r.spanKm} km  格距 ${cellM.toFixed(1)} m\n` +
      `  高程 ${min}–${max} m（起伏 ${max - min}）· 平均 ${Math.round(mean)} m\n` +
      `  判型 ${cls.type}${cls.type === spec.landType ? " ✔" : " ✘"} — ${cls.reason}\n` +
      `  局部高差中位数 ${Math.round(stats.localRelief)} m · 外环−中心盘 ${Math.round(stats.edgeMinusCore)} m · ` +
      `高方位 ${stats.sectorsAbove}/8\n` +
      `  部位 峰${counts.peak} 脊${counts.ridge} 谷${counts.valley} 鞍${counts.saddle} 崖${counts.cliff}` +
      `   （需检出 ${spec.needParts.join("/")}）\n` +
      `  最大单格坡度 ${slope.toFixed(1)}° · 陡崖候选 ${r.marks.cliffScan.candidates} 格 · ` +
      `被闸门剔除 ${r.marks.cliffScan.suspect} 格`
  );
  // 点位明细：调形状时靠它一眼看出"峰在哪儿、垭口在哪儿、崖是直的一条吗"
  const fmt = (p) => `(${p.i.toFixed(0)},${p.j.toFixed(0)})${p.h !== undefined ? `@${Math.round(p.h)}m` : ""}`;
  console.log(
    `  峰位 ${r.marks.peaks.map(fmt).join(" ")}\n` +
      `  鞍位 ${r.marks.saddles.map((s) => `${fmt(s)}下凹${Math.round(s.drop)}m`).join(" ")}\n` +
      `  崖位 ${r.marks.cliffs.map((c) => `${fmt(c)}${c.slopeDeg.toFixed(0)}°/${c.lines}线`).join(" ")}`
  );
  if (problems.length) {
    console.log(`  ✘ ${problems.join("；")}`);
  }
}
console.log(`\n=============================================\n`);

if (failed) {
  console.error(`✘ ${failed} 个模板不达标 —— 调 build*() 里的参数，别改判据阈值。\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 落盘                                                                */
/* ------------------------------------------------------------------ */

function b64Of(q) {
  return Buffer.from(Buffer.from(q.buffer, q.byteOffset, q.byteLength)).toString("base64");
}

function tsSource(spec, r) {
  const { q, min, max, mean } = r;
  const spanKm = r.spanKm.toFixed(1);
  const headline =
    spec.landType === "mountain"
      ? "两座主峰 + 连接垄岗（垄上有垭口）+ 西南坡一条沿程加深加宽的山谷 + 断层崖，五类地形部位各有一处"
      : spec.landType === "hill"
        ? "81 座圆缓小丘的丘群，梁与冲沟相间；（丘陵没有陡崖）"
        : "低平盆底 + 一圈盆缘山（峰 / 垭口 / 冲沟），西侧内坡一段弧形盆缘断层崖";
  return `/**
 * ${spec.name} · **模板地形**（非真实 DEM）
 *
 * 地形类型：${spec.landType}（人工声明；\`landform.test.cjs\` 会用判据反向校验）
 * 教学定位：${headline}。
 *          真实样本（贡嘎山那四座）形状不受控、部位找不全，这一档专门给刚接触
 *          等高线地形图的学生用：一处部位对应一个术语，与课本示意图严格一致。
 *
 * 生成方式：\`scripts/gen_templates.cjs\` 的解析函数，**无随机数、可逐字节复现**。
 * 参数是这样反解出来的：先按 \`landform.ts\` 的判据门槛（TPI ≥ 70 m、陡崖 65°~80°、
 * 鞍部下凹 ≥ 3% 全图高差…）算出所需坡度与落差，再取几何尺寸。详见生成器注释。
 *
 * 取景：跨度 ${spanKm} km 见方（等距网格，无投影）
 * 网格：256×256
 * 编码：整数米 → Uint16 小端 → base64（与真实样本同一套解码器）
 * 高程范围：${min} ~ ${max} m（平均 ${Math.round(mean)} m）
 *
 * ⚠️ 本文件由 \`npm run gen:templates\` 生成，请勿手改。
 * ⚠️ \`lat/lon\` 只是「纬度滑杆默认值 / 占位符」，**不对应任何真实经纬度** ——
 *    模板地形是示意地形，界面上不画中国地图（见 \`isTemplate\`）。
 */
import type { DemSource } from "./types";

export const dem: DemSource = {
  tag: "${spec.tag}",
  name: "${spec.name}",
  peakName: "${spec.peakName}",
  peakAltitude: ${max},
  lat: 30.0,
  lon: 105.0,
  spanKm: ${spanKm},
  grid: ${GRID},
  landType: "${spec.landType}",
  isTemplate: true,
  demMin: ${min},
  demMax: ${max},
  b64: "${b64Of(q)}"
};
`;
}

for (const r of results) {
  const out = path.join(ROOT, "src/data", `dem-${r.spec.tag}.ts`);
  fs.writeFileSync(out, tsSource(r.spec, r), "utf8");
  console.log(`写入 ${path.relative(ROOT, out).replace(/\\/g, "/")}`);
}
console.log("\n✔ 三个模板地形已生成，且全部通过判型 + 部位自检。\n");
}

if (require.main === module) {
  main();
}
