/**
 * 棋盘皮肤 · 贴图绘制层
 *
 * 这一层**有副作用**（要摸 canvas 和 Image），所以不并进纯逻辑的测试包；
 * 但它自己不重算任何一个投影公式 —— 反投影一律走 projection.ts 的 makeUnprojector。
 * 两处各写一份球面公式，日子久了必然走偏，而走偏的样子是全屏的、一眼看不出对错。
 *
 * 两种形状的贴图路径完全不同，原因是投影不同：
 *
 *   flat  等距圆柱对等距圆柱 —— 贴图本身就是这个投影，所以**裁剪一块就行**，
 *         一个 drawImage 搞定，快且无损。
 *   globe 球面正射 —— 贴图是"平的"，要贴到球上再投出来，只能**逐像素反投影重采样**。
 *         不做这一步的后果很具体：经纬线是弯的、大陆是平的，学生会以为地图画错了。
 */

import { makeUnprojector, type FlatViewport, type GlobeViewport, type Viewport } from "./projection";
import type { BoardSpec } from "./geo";

export type SkinId = "paper" | "earth" | "night";

export const SKINS: {
  id: SkinId;
  label: string;
  hint: string;
  src: string | null;
}[] = [
  {
    id: "paper",
    label: "纸纹",
    hint: "默认。米色纸底 + 墨色格线，格线最清楚，投影到教室大屏也看得清",
    src: null
  },
  {
    id: "earth",
    label: "卫星影像",
    hint: "真实地表（NASA 蓝色弹珠）。一眼看出这块棋盘落在世界的哪个位置",
    src: "./textures/earth.jpg"
  },
  {
    id: "night",
    label: "夜晚灯光",
    hint: "同一颗地球的夜间灯光。顺手就能讲人口与城市分布",
    src: "./textures/earth_night.jpg"
  }
];

export const DEFAULT_SKIN: SkinId = "paper";

export function skinSrc(id: SkinId): string | null {
  const found = SKINS.find((item) => item.id === id);
  return found ? found.src : null;
}

/** 贴图叠在棋盘上的浓度：全不透明会把格线压得看不见，太淡又白加。 */
export const TEXTURE_ALPHA = 0.92;
/**
 * 贴图上再盖一层浅色"洗淡"罩，让墨色格线与棋子始终有对比。
 *
 * 0.34 是在"大陆要看得清"和"格线要读得出"之间的取值：再淡大陆更好看，
 * 但深色海面上的格线就开始糊；再浓就成了一片米色，卫星影像的意义就没了。
 */
export const TEXTURE_WASH = "rgba(252,249,242,0.22)";

export function loadSkinImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`贴图加载失败：${src}`));
    img.src = src;
  });
}

/**
 * 贴图的像素缓冲。逐像素重采样时不能每帧 getImageData 一次
 * （那是一次 GPU→CPU 回读，十几毫秒起步），所以按图片元素缓存。
 */
const pixelCache = new WeakMap<HTMLImageElement, ImageData>();

function texPixels(img: HTMLImageElement): ImageData {
  const cached = pixelCache.get(img);
  if (cached) {
    return cached;
  }
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("拿不到 2D 上下文，无法读取贴图");
  }
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  pixelCache.set(img, data);
  return data;
}

/** 等距圆柱贴图的一个经纬度 → 源图像素坐标（整数、夹紧到边界内）。 */
function texelOf(
  lon: number,
  lat: number,
  width: number,
  height: number,
  out: [number, number]
): void {
  let sx = Math.floor(((lon + 180) / 360) * width);
  let sy = Math.floor(((90 - lat) / 180) * height);
  // 经度可以落在 [−180, 180) 之外（贴图左右是连着的），夹紧比取模更省事，
  // 差别只在换日线那一列像素上，看不出来。
  sx = sx < 0 ? 0 : sx >= width ? width - 1 : sx;
  sy = sy < 0 ? 0 : sy >= height ? height - 1 : sy;
  out[0] = sx;
  out[1] = sy;
}

/** 方形棋盘：窗口是等距圆柱的一个矩形，贴图直接裁那一块。 */
export function paintFlatSkin(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  vp: FlatViewport,
  spec: BoardSpec,
  canvasSize: number
): void {
  ctx.clearRect(0, 0, canvasSize, canvasSize);
  const size = vp.step * (spec.grid - 1);
  const lonSpan = spec.degStep * (spec.grid - 1);
  const latSpan = spec.degStep * (spec.grid - 1);
  const tw = img.naturalWidth;
  const th = img.naturalHeight;
  const sx = ((vp.lonLeft + 180) / 360) * tw;
  const sy = ((90 - vp.latTop) / 180) * th;
  const sw = (lonSpan / 360) * tw;
  const sh = (latSpan / 180) * th;
  ctx.save();
  ctx.globalAlpha = TEXTURE_ALPHA;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, vp.left, vp.top, size, size);
  ctx.restore();
}

/**
 * 圆形棋盘：逐像素反投影。
 *
 * 对圆盘内每一个像素求它对应的经纬度，再去等距圆柱贴图上取色。
 * 圆盘外与球的背面都不涂（保持透明），于是贴图的外轮廓自然就是那个圆。
 *
 * 940×940 的画布上实际有效像素约 55 万，实测在本机约 50~90 ms —— 一局只跑一次
 * （换范围 / 换形状 / 换尺寸 / 换皮肤才重算），可以接受。
 */
export function paintGlobeSkin(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  vp: GlobeViewport,
  canvasSize: number
): void {
  ctx.clearRect(0, 0, canvasSize, canvasSize);
  const tex = texPixels(img);
  const tw = tex.width;
  const th = tex.height;
  const src = tex.data;
  const out = ctx.createImageData(canvasSize, canvasSize);
  const dst = out.data;
  const unproject = makeUnprojector(vp);
  // 圆盘的"单位球半径"：半径 / 缩放。超出它的像素不属于这张棋盘。
  const discUnit = vp.radius / vp.scale;
  const discUnitSq = discUnit * discUnit;
  const texel: [number, number] = [0, 0];

  for (let y = 0; y < canvasSize; y += 1) {
    const py = y + 0.5;
    for (let x = 0; x < canvasSize; x += 1) {
      const px = x + 0.5;
      const dx = (px - vp.cx) / vp.scale;
      const dy = (vp.cy - py) / vp.scale;
      if (dx * dx + dy * dy > discUnitSq) {
        continue;
      }
      const ll = unproject(px, py);
      if (!ll) {
        continue;
      }
      texelOf(ll.lon, ll.lat, tw, th, texel);
      const s = (texel[1] * tw + texel[0]) * 4;
      const d = (y * canvasSize + x) * 4;
      dst[d] = src[s];
      dst[d + 1] = src[s + 1];
      dst[d + 2] = src[s + 2];
      dst[d + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

/** 画布尺寸固定等于 SVG 的 viewBox 边长，两层坐标系才严格对齐。 */
export function paintSkin(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  vp: Viewport,
  spec: BoardSpec,
  box: number
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  if (vp.shape === "flat") {
    paintFlatSkin(ctx, img, vp, spec, box);
  } else {
    paintGlobeSkin(ctx, img, vp, box);
  }
  washSkin(ctx, vp, spec);
}

/**
 * 贴图上再盖一层浅色"洗淡"罩。
 *
 * 真实卫星影像的局部对比度很高（雪、沙漠、深海），墨色格线直接压上去会被吃掉。
 * 洗淡之后格线始终在贴图之上有对比，而大陆轮廓仍然一眼认得出 —— 两件事都要。
 * 位置严格跟随同一套 viewport，所以方形只洗棋盘那一块、圆形只洗圆盘。
 */
function washSkin(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  spec: BoardSpec
): void {
  ctx.save();
  ctx.fillStyle = TEXTURE_WASH;
  if (vp.shape === "flat") {
    const size = vp.step * (spec.grid - 1);
    ctx.fillRect(vp.left, vp.top, size, size);
  } else {
    ctx.beginPath();
    ctx.arc(vp.cx, vp.cy, vp.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
