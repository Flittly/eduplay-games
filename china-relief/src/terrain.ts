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
  xToLon,
  zToLat
} from "./geo";

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
/** 明暗分档的坡度阈值（米/格） */
const SHADE_DEG = 60;
const SHADE_UP = 1.14;
const SHADE_DOWN = 0.86;
/** 档界描边的压暗系数 */
const EDGE_DARK = 0.66;

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
   */
  refresh(alt: Float32Array, lift: Float32Array, add: Float32Array, animating: boolean): void;
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
    // 整张中国地图等比铺满舞台，留 2% 呼吸位
    mapScale = Math.min(w / SPAN_X, h / SPAN_Z) * 0.96;
    mapX = (w - SPAN_X * mapScale) / 2;
    mapY = (h - SPAN_Z * mapScale) / 2;
    return { w, h };
  }

  /* --------------------------- 状态缓存 --------------------------- */
  let lastAlt: Float32Array | null = null;
  let lastLift: Float32Array | null = null;
  let lastAdd: Float32Array | null = null;

  /* ---------------------------- 出图 ---------------------------- */
  let img: ImageData | null = null;
  let imgW = 0;
  let imgH = 0;

  function render(step: number) {
    const { w, h } = layout();

    const da = lastAlt;
    const dl = lastLift;
    const dAdd = lastAdd;
    if (!da || !dl || !dAdd) {
      return;
    }

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
          } else {
            /* -------- 已塑形：色档 + 档界 + 明暗 -------- */
            const bd = bandAll[k];
            const c = BAND_RGB[bd - 1];
            const northH = hAll[k - GRID_W];
            let mul = 1;
            if (northH >= 0) {
              if (hv > northH + SHADE_DEG) {
                mul = SHADE_UP;
              } else if (hv < northH - SHADE_DEG) {
                mul = SHADE_DOWN;
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

        px[o] = r;
        px[o + 1] = g;
        px[o + 2] = b;
        px[o + 3] = 255;
      }
    }

    offCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(off, 0, 0, W, H, mapX, mapY, SPAN_X * mapScale, SPAN_Z * mapScale);
  }

  /* --------------------------- 对外接口 --------------------------- */
  function refresh(alt: Float32Array, lift: Float32Array, add: Float32Array, animating: boolean) {
    lastAlt = alt;
    lastLift = lift;
    lastAdd = add;
    render(animating ? 2 : 1);
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
      render(1);
    }
  });
  ro.observe(canvas);

  function dispose() {
    ro.disconnect();
    img = null;
  }

  return { refresh, pick, project, dispose };
}
