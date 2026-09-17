/**
 * 卡通地形沙盘（Canvas 2D）
 *
 * ## 为什么不再用 WebGL
 *
 * v0.0.1 用 three.js 起了一层 480×358 的真实高程网面（约 34 万个三角形）：
 * 每帧要把 17 万个顶点的高度与颜色重算一遍，动画收尾还得重算法线
 * （20~50 ms），在教室那类没有独显的机器上就是明摆着的卡顿 —— 用户的原话是
 * "三维展示的时候有些卡顿"。
 *
 * 而这个游戏真正要教的东西 ——「这块地按它真实的海拔被塑起来了」——
 * 并不需要透视相机和多边形光照：**分层设色 + 档间描边 + 北向明暗**
 * 在俯视图上就读得出来，而且这正是地理教科书读地形图的方式。
 * 于是整层换成一张 Canvas 2D 俯视图，着色退化成一次线性扫描，
 * 帧成本从几十毫秒降到几毫秒，且不依赖 WebGL（老机器的显卡驱动也不会再拖后腿）。
 *
 * ## 一格像素怎么决定颜色
 *
 * 按优先级从外到内：
 *   1. **海洋**三层 —— 深海 / 近岸浅滩 / 陆地投影。投影是把陆地掩膜往东南
 *      平移两格后落在海里的那部分染深一档，整块陆地就有"浮在海面上"的卡通感。
 *   2. **陆地在境外**（mask=0 已排除）—— 不画。
 *   3. **未塑形**：米灰 + 每 4 格一档的淡斜纹。刻意不用浅绿 —— 直接按高程 0
 *      上色会和沿海平原同色，学生分不清"这块我还没放"和"这块本来就是低地"。
 *   4. **已塑形**：按 `alt × lift + add` 落到 7 个色档，档与档之间描一道深边
 *      （等于把等高线画出来），再按"北邻比自己高还是低"提亮/压暗一刀 ——
 *      两档量化的明暗就是卡通光照，能读出山脉的坡向，又不会糊成照片。
 *   5. **归属轮廓**（v1.2.0，可开关）：每格记着自己属于哪一条条目
 *      （归属图 `owner`），四邻里只要有一格不是同一条目，就把这格画成
 *      该条目自己的深色描边。于是相邻两块地之间有一条看得见的分界。
 *      注意它与第 4 步的"档界描边"是两件事：档界表达**海拔**（同一条脉上
 *      2000 m 与 500 m 的界线），轮廓表达**归属**。所以轮廓开关管不着档界。
 *
 * ## 为什么先算两块中间数组
 *
 * 上色要读邻居（判档界、判明暗）。若每个像素都现场再算一遍邻居的高程，
 * 常数直接变三倍。先把 `hAll`（高程）与 `bandAll`（色档）各扫一遍，
 * 上色就退化成查表 —— 两次线性扫描远比一次三倍常数的小循环便宜。
 *
 * ## 动画期间降采样
 *
 * `refresh(..., animating=true)` 时按 2 格 1 像素出图（4.3 万格），
 * 动画停止后补一次全分辨率。与 v0.0.1 在动画期间跳过法线是同一个取舍。
 */
import {
  GRID_H,
  GRID_W,
  SPAN_X,
  SPAN_Z,
  latToZ,
  lonToX,
  mapLayout,
  xToLon,
  zToLat
} from "./geo";
import type { BasemapKind } from "./basemap";

const N = GRID_W * GRID_H;

/* ------------------------------ 调色 ------------------------------ */

type RGB = readonly [number, number, number];

/** 深海 / 近岸浅滩 / 陆地投影 / 海岸线 */
const SEA_DEEP: RGB = [143, 192, 224];
const SEA_SHALLOW: RGB = [186, 222, 241];
const SEA_SHADOW: RGB = [109, 157, 196];
const COAST: RGB = [74, 109, 138];

/** 未塑形：米灰两色交替成斜纹 */
const UNSHAPED: RGB = [222, 215, 201];
const UNSHAPED_ALT: RGB = [211, 203, 187];

/**
 * 分层设色，7 档离散（卡通风的关键是**减少色阶**，连续插值会糊成照片）。
 * 阈值取 200 / 500 / 1000 / 2000 / 3500 / 5000 m，与地理教材的分层设色一致。
 */
const BAND_MAX = [200, 500, 1000, 2000, 3500, 5000];
const BAND_RGB: RGB[] = [
  [127, 176, 105], // ≤200   低地绿
  [168, 192, 106], // ≤500   黄绿
  [207, 195, 107], // ≤1000  土黄
  [209, 163, 95], // ≤2000  橙褐
  [184, 122, 77], // ≤3500  褐
  [156, 132, 120], // ≤5000  灰褐
  [233, 228, 221] // >5000  雪白
];

/** 色档下标（0 = 未塑形，1..7 = BAND_RGB 的下标 +1） */
function bandIndexOf(h: number): number {
  for (let b = 0; b < BAND_MAX.length; b++) {
    if (h <= BAND_MAX[b]) {
      return b + 1;
    }
  }
  return BAND_RGB.length;
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/** 陆地投影往东南偏几格 */
const SHADOW_STEP = 2;
/** 明暗分档的坡度阈值（米/格）—— 分层设色用「二值卡通明暗」 */
const SHADE_DEG = 60;
const SHADE_UP = 1.14;
const SHADE_DOWN = 0.86;
/** 档界描边的压暗系数 */
const EDGE_DARK = 0.66;

/** 一格的地面米数：全国 DEM 是 480×358 铺满 63°×38°，约 11.9 km/格 */
const CELL_M = 11900;
/**
 * 地势晕渲的连续明暗（分层设色改用这个时才是「晕渲底图」）。
 *
 * 光源取**西北仰角 45°** —— 这是地形图的惯例：光从左上打过来，
 * 山脊的东南坡是暗的、西北坡是亮的，人眼立刻读得出"隆起"而不是"凹陷"。
 * 反过来打光（东南）会让整个中国看起来像一群坑。
 */
const HS_LX = -0.5;
const HS_LY = -0.5; // y 轴向南为正 ⇒ -y 是北，西北方向就是 (-x, -y)
const HS_LZ = Math.SQRT1_2;
const HS_GAIN = 1.6;

/** 遥感底图下未塑形区的灰纱不透明度：0.72 = 影像还能透出 28% */
const SAT_VEIL = 184;

/* --------------------------- 轮廓（v1.2.0） --------------------------- */

/**
 * 把条目自己的颜色压成"描边色"。
 *
 * 用户的原话是「在地形的周围能够有颜色区分开，这样同学们也可以仔细」——
 * 要点是**相邻的两块地之间要有一条看得见的分界**，而且要能看出"这块是这块"。
 *
 * 所以不用一个统一的深墨色，而是**每条目用自己的色系压深**：
 * 相邻的黄土高原（黄褐）与华北平原（浅绿）压深之后仍然是两个不同的深色，
 * 边界一眼能分；统一用一个深墨色的话，就只有"有线"而没有"哪块是哪块"。
 *
 * 为什么走 HSL 而不是直接乘个系数：直接 `rgb × 0.5` 会把所有颜色一起推向黑，
 * 各条目的描边色互相趋同（区分度反而没了）；在 HSL 里把明度**压到固定档**
 * 同时把饱和度提上去，各条目就保持着自己的色相。
 */
export function outlineRGB(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    return [58, 50, 38];
  }
  const v = parseInt(m[1], 16);
  const r0 = ((v >> 16) & 255) / 255;
  const g0 = ((v >> 8) & 255) / 255;
  const b0 = (v & 255) / 255;
  const max = Math.max(r0, g0, b0);
  const min = Math.min(r0, g0, b0);
  const l0 = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 1e-6) {
    s = l0 > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r0) {
      h = ((g0 - b0) / d + (g0 < b0 ? 6 : 0)) / 6;
    } else if (max === g0) {
      h = ((b0 - r0) / d + 2) / 6;
    } else {
      h = ((r0 - g0) / d + 4) / 6;
    }
  }
  // 明度压到 0.26（比"档界压暗 0.66"更狠，因为它要压过色档本身的深浅）；
  // 饱和度提到 0.62~0.86，保住色相不往灰里跑
  const s2 = Math.min(0.86, Math.max(0.62, s * 1.5));
  const l2 = 0.26;
  const q = l2 < 0.5 ? l2 * (1 + s2) : l2 + s2 - l2 * s2;
  const p = 2 * l2 - q;
  const hue = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [Math.round(hue(h + 1 / 3) * 255), Math.round(hue(h) * 255), Math.round(hue(h - 1 / 3) * 255)];
}

/**
 * 渲染时要额外知道的东西。
 *
 * 传的是一个**可变对象**（App 侧放在 ref 里原地改），
 * 因为 `refresh()` 会在 rAF 里被高频调用，每次新建一个对象既费又没必要。
 */
export interface SceneView {
  /** 每格属于哪个条目：0 = 无归属，n = 第 n 个条目（1 起） */
  owner: Uint8Array | null;
  /** 是否画出条目轮廓 */
  outline: boolean;
  /** 描边色表，长度 3×(条目数+1)，下标 0 空着 */
  ownerColor: Uint8Array | null;
}

/* ------------------------------ 接口 ------------------------------ */

export interface PickResult {
  lon: number;
  lat: number;
}

export interface TerrainView {
  /**
   * 重新出图。
   * `animating=true` 时按 2 格 1 像素降采样（动画期间够用），
   * 动画收尾传 false 补一次全分辨率。
   * `basemap` 决定"已塑形"区画成什么样（见 basemap.ts）。
   * `scene` 提供归属图与轮廓开关（v1.2.0，可省）。
   */
  refresh(
    alt: Float32Array,
    lift: Float32Array,
    add: Float32Array,
    animating: boolean,
    basemap: BasemapKind,
    scene?: SceneView
  ): void;
  pick(clientX: number, clientY: number): PickResult | null;
  /** 经纬度 → 画布内的像素坐标，用于给提示气泡定位 */
  project(lon: number, lat: number): { x: number; y: number } | null;
  dispose(): void;
}

export function createTerrainView(canvas: HTMLCanvasElement, land: Uint8Array): TerrainView {
  // 声明成非空类型：TS 不会把 `if (!x) throw` 的窄化带进下面的嵌套函数里
  const ctxMaybe = canvas.getContext("2d");
  if (!ctxMaybe) {
    throw new Error("这个浏览器没有 Canvas 2D 上下文");
  }
  const ctx: CanvasRenderingContext2D = ctxMaybe;

  const off = document.createElement("canvas");
  const offMaybe = off.getContext("2d");
  if (!offMaybe) {
    throw new Error("离屏 Canvas 2D 上下文创建失败");
  }
  const offCtx: CanvasRenderingContext2D = offMaybe;

  /* -------------------- 近岸浅滩（只算一次） -------------------- */
  const nearShore = new Uint8Array(N);
  for (let j = 0; j < GRID_H; j++) {
    for (let i = 0; i < GRID_W; i++) {
      const k = j * GRID_W + i;
      if (land[k]) {
        continue;
      }
      let touch = false;
      for (let dj = -1; dj <= 1 && !touch; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= GRID_H) {
          continue;
        }
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= GRID_W) {
            continue;
          }
          if (land[jj * GRID_W + ii]) {
            touch = true;
            break;
          }
        }
      }
      nearShore[k] = touch ? 1 : 0;
    }
  }

  /* ---------------------- 中间数组（复用） ---------------------- */
  /** 高程（米）；未塑形为 -1，作为"没有地形"的哨兵 */
  const hAll = new Float32Array(N);
  /** 色档；0 = 未塑形 */
  const bandAll = new Uint8Array(N);

  /**
   * 连续晕渲明暗系数（「地势晕渲」底图用）。
   *
   * 四邻梯度 → 法线 → 与西北 45° 光矢量点积。邻居若是未塑形（hAll = -1）
   * 就退回自己的高程，**不能当作 0 米** —— 否则塑形区的边缘会长出一圈
   * 假断崖（那里根本没落差，只是"还没放"）。
   */
  function hillshadeMul(k: number, i: number, j: number): number {
    const h = hAll[k];
    const hL = i > 0 && hAll[k - 1] >= 0 ? hAll[k - 1] : h;
    const hR = i < GRID_W - 1 && hAll[k + 1] >= 0 ? hAll[k + 1] : h;
    const hU = j > 0 && hAll[k - GRID_W] >= 0 ? hAll[k - GRID_W] : h;
    const hD = j < GRID_H - 1 && hAll[k + GRID_W] >= 0 ? hAll[k + GRID_W] : h;
    const zx = (hR - hL) / (2 * CELL_M);
    const zy = (hD - hU) / (2 * CELL_M);
    const norm = Math.sqrt(zx * zx + zy * zy + 1);
    // 法线 N = (-zx, -zy, 1)/norm；L 已是单位矢量
    const ndl = (HS_LX * -zx + HS_LY * -zy + HS_LZ) / norm;
    const flat = HS_LZ; // 平地时 N·L = 0.7071 ⇒ 系数正好是 1
    const mul = 1 + (ndl - flat) * HS_GAIN;
    return mul < 0.4 ? 0.4 : mul > 1.5 ? 1.5 : mul;
  }

  /* ---------------------------- 布局 ---------------------------- */
  let mapX = 0;
  let mapY = 0;
  let mapScale = 1;

  function layout(): { w: number; h: number } {
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 整张中国地图等比铺满舞台。**与底图瓦片层共用 mapLayout**，
    // 见 geo.ts 的注释：两边各算一套迟早会错开半个像素。
    const m = mapLayout(w, h);
    mapScale = m.mapScale;
    mapX = m.mapX;
    mapY = m.mapY;
    return { w, h };
  }

  /* --------------------------- 状态缓存 --------------------------- */
  let lastAlt: Float32Array | null = null;
  let lastLift: Float32Array | null = null;
  let lastAdd: Float32Array | null = null;
  let lastBasemap: BasemapKind = "relief";
  let lastScene: SceneView | undefined;

  /* ---------------------------- 出图 ---------------------------- */
  let img: ImageData | null = null;
  let imgW = 0;
  let imgH = 0;

  function render(step: number, basemap: BasemapKind) {
    const { w, h } = layout();

    const da = lastAlt;
    const dl = lastLift;
    const dAdd = lastAdd;
    if (!da || !dl || !dAdd) {
      return;
    }

    // 轮廓：开关关掉时直接不认归属图，省掉下面每次都做的四邻比较
    const owner = lastScene?.outline && lastScene.owner ? lastScene.owner : null;
    const palette = owner ? lastScene?.ownerColor ?? null : null;
    // 「本格 + 四邻」是否同属一块地。留成局部函数是为了下面那两处分支共用同一判断
    const isOwnerEdge = (k: number, i: number, j: number, own: number): boolean => {
      if (!owner) {
        return false;
      }
      const left = i > 0 ? owner[k - 1] : 0;
      const right = i < GRID_W - 1 ? owner[k + 1] : 0;
      const up = j > 0 ? owner[k - GRID_W] : 0;
      const down = j < GRID_H - 1 ? owner[k + GRID_W] : 0;
      return left !== own || right !== own || up !== own || down !== own;
    };

    // ---- 第 1 遍：高程（全分辨率，邻居查询要用精确值） ----
    for (let k = 0; k < N; k++) {
      const l = dl[k];
      const a = dAdd[k];
      hAll[k] = l > 0.02 || a > 1 ? da[k] * l + a : -1;
    }
    // ---- 第 2 遍：色档 ----
    for (let k = 0; k < N; k++) {
      const hv = hAll[k];
      bandAll[k] = hv < 0 ? 0 : bandIndexOf(hv);
    }

    // ---- 第 3 遍：上色 ----
    const W = Math.ceil(GRID_W / step);
    const H = Math.ceil(GRID_H / step);
    /*
     * ⚠️ 离屏 canvas 的尺寸**必须**跟着 buffer 一起设。
     *
     * 踩过：只建了 `createImageData(480, 358)` 就直接 `putImageData`，
     * 而离屏 canvas 还是默认的 300×150 —— `putImageData` 超出画布的部分会被
     * **静默裁掉**，于是 480×358 的地图只有左上角 300×150 被写上，
     * 其余在 `drawImage` 时按透明处理，露出舞台背景色（正好也是海蓝）。
     *
     * 症状极具欺骗性：页面看上去"有海有陆地、轮廓也有"，只是陆地面积只有
     * 应有的五分之一、中国只剩了个西北角。肉眼扫一眼截图很难说清哪里不对 ——
     * 是"陆地像素总数 vs 掩膜期望值"那条断言把它钉出来的（实测 71,566 px vs 期望 380,323 px）。
     */
    if (!img || imgW !== W || imgH !== H || off.width !== W || off.height !== H) {
      off.width = W;
      off.height = H;
      img = offCtx.createImageData(W, H);
      imgW = W;
      imgH = H;
    }
    const px = img.data;

    let o = 0;
    for (let jj = 0; jj < H; jj++) {
      const j = Math.min(GRID_H - 1, jj * step);
      const rowBase = j * GRID_W;
      for (let ii = 0; ii < W; ii++, o += 4) {
        const i = Math.min(GRID_W - 1, ii * step);
        const k = rowBase + i;
        let r: number;
        let g: number;
        let b: number;
        let alpha = 255;

        if (!land[k]) {
          /* -------- 海洋 -------- */
          if (j >= SHADOW_STEP && i >= SHADOW_STEP && land[k - SHADOW_STEP * GRID_W - SHADOW_STEP]) {
            r = SEA_SHADOW[0];
            g = SEA_SHADOW[1];
            b = SEA_SHADOW[2];
          } else if (nearShore[k]) {
            r = SEA_SHALLOW[0];
            g = SEA_SHALLOW[1];
            b = SEA_SHALLOW[2];
          } else {
            r = SEA_DEEP[0];
            g = SEA_DEEP[1];
            b = SEA_DEEP[2];
          }
        } else if (i === 0 || i === GRID_W - 1 || j === 0 || j === GRID_H - 1 ||
          !land[k - 1] || !land[k + 1] || !land[k - GRID_W] || !land[k + GRID_W]) {
          /* -------- 海岸线 -------- */
          r = COAST[0];
          g = COAST[1];
          b = COAST[2];
        } else {
          const hv = hAll[k];
          if (hv < 0) {
            /* -------- 未塑形：米灰斜纹 -------- */
            const c = ((i >> 2) + (j >> 2)) & 1 ? UNSHAPED_ALT : UNSHAPED;
            r = c[0];
            g = c[1];
            b = c[2];
            /*
             * 遥感底图下这层改成**半透明灰纱**：卫星影像透出约三成，
             * 于是「换了底图」这件事一眼可见，而"已塑形 = 全彩影像"
             * 仍然和未塑形拉开明显差别。不做成纯透明是因为那样
             * 塑形前后就没有判据了 —— 学生会分不清"这块我还没放"
             * 和"这块本来就长这样"。
             */
            alpha = basemap === "satellite" ? SAT_VEIL : 255;
          } else {
            /*
             * -------- 已塑形 --------
             *
             * 归属轮廓（v1.2.0）**先于底图分支**算出来：遥感底图也必须画。
             * 遥感下已塑形区是"抠成透明、露出影像"，轮廓要是跟着一起透明，
             * 切到影像底图就完全看不到分界了 —— 而"相邻两块地要分得开"
             * 恰恰是切到影像之后更被需要的事。
             */
            const own = owner ? owner[k] : 0;
            let edge: readonly [number, number, number] | null = null;
            if (palette && own > 0 && isOwnerEdge(k, i, j, own)) {
              edge = [palette[own * 3], palette[own * 3 + 1], palette[own * 3 + 2]];
            }

            if (edge) {
              r = edge[0];
              g = edge[1];
              b = edge[2];
              alpha = 255;
            } else if (basemap === "satellite") {
              /* -------- 把这层"毛毡"整个抠掉 --------
                 画布在这里留透明，浏览器就把下面的影像瓦片层透出来了。
                 好处是不必读影像像素（跨域画布 getImageData 会抛），
                 也不必给 image 挂 canvas 去采样。 */
              r = 0;
              g = 0;
              b = 0;
              alpha = 0;
            } else {
              /* -------- 色档 + 档界 + 明暗 -------- */
              const bd = bandAll[k];
              const c = BAND_RGB[bd - 1];
              /*
               * 三种底图的区别全在这一处 `mul`：
               *   relief    —— 只比"北邻"，二值提亮/压暗，即卡通光照；
               *   hillshade —— 四邻梯度算真坡向，连续晕渲（西北 45° 光源）。
               * 色档与档界两者共用：色档是**海拔语义**，换底图不能把它丢了。
               *
               * 注意这里的"档界描边"与上面的"归属轮廓"是两件事，
               * 所以轮廓开关**管不着它**：档界表达的是海拔（同一条脉上
               * 2000 m 与 500 m 的界线），轮廓表达的是"这块地归哪一条目"。
               */
              let mul: number;
              if (basemap === "hillshade") {
                mul = hillshadeMul(k, i, j);
              } else {
                mul = 1;
                const northH = hAll[k - GRID_W];
                if (northH >= 0) {
                  if (hv > northH + SHADE_DEG) {
                    mul = SHADE_UP;
                  } else if (hv < northH - SHADE_DEG) {
                    mul = SHADE_DOWN;
                  }
                }
              }
              const rightB = i < GRID_W - 1 ? bandAll[k + 1] : bd;
              const downB = j < GRID_H - 1 ? bandAll[k + GRID_W] : bd;
              if ((rightB !== 0 && rightB !== bd) || (downB !== 0 && downB !== bd)) {
                mul *= EDGE_DARK;
              }
              r = clamp255(c[0] * mul);
              g = clamp255(c[1] * mul);
              b = clamp255(c[2] * mul);
            }
          }
        }

        px[o] = r;
        px[o + 1] = g;
        px[o + 2] = b;
        px[o + 3] = alpha;
      }
    }

    offCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(off, 0, 0, W, H, mapX, mapY, SPAN_X * mapScale, SPAN_Z * mapScale);
  }

  /* --------------------------- 对外接口 --------------------------- */
  function refresh(
    alt: Float32Array,
    lift: Float32Array,
    add: Float32Array,
    animating: boolean,
    basemap: BasemapKind,
    scene?: SceneView
  ) {
    lastAlt = alt;
    lastLift = lift;
    lastAdd = add;
    lastBasemap = basemap;
    lastScene = scene;
    render(animating ? 2 : 1, basemap);
  }

  /* ---------------------------- 拾取 ---------------------------- */
  function pick(clientX: number, clientY: number): PickResult | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }
    const wx = (clientX - rect.left - mapX) / mapScale - SPAN_X / 2;
    const wz = (clientY - rect.top - mapY) / mapScale - SPAN_Z / 2;
    if (wx < -SPAN_X / 2 || wx > SPAN_X / 2 || wz < -SPAN_Z / 2 || wz > SPAN_Z / 2) {
      return null;
    }
    return { lon: xToLon(wx), lat: zToLat(wz) };
  }

  function project(lon: number, lat: number) {
    if (!canvas.clientWidth) {
      return null;
    }
    return {
      x: mapX + (lonToX(lon) + SPAN_X / 2) * mapScale,
      y: mapY + (latToZ(lat) + SPAN_Z / 2) * mapScale
    };
  }

  /* ---------------------------- 尺寸联动 ---------------------------- */
  // 静止时不会再调 refresh，所以窗口变化必须由观察者自己触发一次重绘
  const ro = new ResizeObserver(() => {
    if (lastAlt && lastLift && lastAdd) {
      render(1, lastBasemap);
    }
  });
  ro.observe(canvas);

  function dispose() {
    ro.disconnect();
    img = null;
  }

  return { refresh, pick, project, dispose };
}
