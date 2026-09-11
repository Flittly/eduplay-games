import * as THREE from "three";

/**
 * 程序化生成星球表面纹理（等距圆柱投影，贴到 SphereGeometry 上）。
 * 全部离线生成，不依赖任何外部贴图，保证离线导入包也能正常显示。
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D 值噪声 */
function makeNoise2D(seed: number) {
  const rand = mulberry32(seed);
  const size = 64;
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = rand();
  }
  const at = (x: number, y: number) => {
    const xi = ((x % size) + size) % size;
    const yi = ((y % size) + size) % size;
    return grid[yi * size + xi];
  };
  return (x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const n00 = at(x0, y0);
    const n10 = at(x0 + 1, y0);
    const n01 = at(x0, y0 + 1);
    const n11 = at(x0 + 1, y0 + 1);
    const nx0 = n00 + (n10 - n00) * sx;
    const nx1 = n01 + (n11 - n01) * sx;
    return nx0 + (nx1 - nx0) * sy;
  };
}

/** 分形叠加噪声 */
function makeFbm(seed: number, octaves = 4) {
  const noise = makeNoise2D(seed);
  return (x: number, y: number) => {
    let value = 0;
    let amp = 0.5;
    let freq = 1;
    let total = 0;
    for (let i = 0; i < octaves; i++) {
      value += noise(x * freq, y * freq) * amp;
      total += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return value / total;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16)
  ];
}

function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  const k = Math.max(0, Math.min(1, t));
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k
  ];
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** 通用像素绘制 */
function paint(
  width: number,
  height: number,
  colorAt: (u: number, v: number, px: number, py: number) => [number, number, number]
) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return canvas;
  }
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = colorAt(x / width, y / height, x, y);
      const index = (y * width + x) * 4;
      image.data[index] = Math.max(0, Math.min(255, r));
      image.data[index + 1] = Math.max(0, Math.min(255, g));
      image.data[index + 2] = Math.max(0, Math.min(255, b));
      image.data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** 岩石星球：斑驳底色 + 环形山 */
export function makeRockyTexture(options: {
  base: string;
  dark: string;
  light: string;
  craterCount?: number;
  seed?: number;
  contrast?: number;
}): THREE.CanvasTexture {
  const seed = options.seed ?? 7;
  const fbm = makeFbm(seed, 5);
  const base = hexToRgb(options.base);
  const dark = hexToRgb(options.dark);
  const light = hexToRgb(options.light);
  const contrast = options.contrast ?? 1;
  const canvas = paint(512, 256, (u, v) => {
    const n = fbm(u * 9, v * 9);
    const n2 = fbm(u * 34 + 11, v * 34 + 5);
    const t = (n * 0.65 + n2 * 0.35 - 0.5) * 2 * contrast;
    let color = t < 0 ? mix(base, dark, -t) : mix(base, light, t);
    // 极地稍亮（火星/水星极冠观感）
    const polar = Math.pow(Math.abs(v - 0.5) * 2, 6);
    color = mix(color, light, polar * 0.35);
    return color;
  });
  const ctx = canvas.getContext("2d");
  const rand = mulberry32(seed + 99);
  const craters = options.craterCount ?? 90;
  if (ctx) {
    for (let i = 0; i < craters; i++) {
      const cx = rand() * canvas.width;
      const cy = rand() * canvas.height;
      const r = 4 + rand() * 22;
      const shade = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      shade.addColorStop(0, "rgba(0,0,0,0.30)");
      shade.addColorStop(0.72, "rgba(0,0,0,0.16)");
      shade.addColorStop(0.86, "rgba(255,255,255,0.22)");
      shade.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return toTexture(canvas);
}

/** 气态巨行星 / 冰巨星：纬向色带 + 湍流 + 可选风暴斑 */
export function makeBandedTexture(options: {
  bands: [number, string][];
  turbulence?: number;
  seed?: number;
  spot?: { x: number; y: number; rx: number; ry: number; color: string };
  streaksOnly?: boolean;
}): THREE.CanvasTexture {
  const seed = options.seed ?? 21;
  const fbm = makeFbm(seed, 4);
  const turbulence = options.turbulence ?? 0.06;
  const bandStops = options.bands.map(
    ([pos, color]) => [pos, hexToRgb(color)] as [number, [number, number, number]]
  );
  const sampleBand = (v: number): [number, number, number] => {
    for (let i = 0; i < bandStops.length - 1; i++) {
      const [p0, c0] = bandStops[i];
      const [p1, c1] = bandStops[i + 1];
      if (v >= p0 && v <= p1) {
        const t = (v - p0) / Math.max(p1 - p0, 1e-6);
        const smooth = t * t * (3 - 2 * t);
        return mix(c0, c1, smooth);
      }
    }
    return bandStops[v < bandStops[0][0] ? 0 : bandStops.length - 1][1];
  };
  const canvas = paint(512, 256, (u, v) => {
    // 沿经度拉长的湍流，形成横向条纹感
    const turb = (fbm(u * 6, v * 26) - 0.5) * 2;
    const fine = (fbm(u * 22 + 3, v * 60 + 8) - 0.5) * 2;
    const vv = Math.max(0, Math.min(1, v + turb * turbulence + fine * turbulence * 0.45));
    let color = sampleBand(vv);
    const shade = 0.92 + turb * 0.12;
    color = [color[0] * shade, color[1] * shade, color[2] * shade];
    if (options.spot) {
      const dx = (u - options.spot.x) / options.spot.rx;
      const dy = (v - options.spot.y) / options.spot.ry;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1) {
        const spotColor = hexToRgb(options.spot.color);
        color = mix(color, spotColor, Math.pow(1 - d, 0.7));
      }
    }
    return color;
  });
  return toTexture(canvas);
}

/** 太阳表面：米粒组织 + 黑子 */
export function makeSunTexture(): THREE.CanvasTexture {
  const fbm = makeFbm(3, 5);
  const bright = hexToRgb("#fff3c4");
  const mid = hexToRgb("#ffb92e");
  const darkSpot = hexToRgb("#c96a12");
  const canvas = paint(512, 256, (u, v) => {
    const n = fbm(u * 26, v * 26);
    const n2 = fbm(u * 70 + 17, v * 70 + 4);
    const t = n * 0.7 + n2 * 0.3;
    let color = t < 0.5 ? mix(mid, darkSpot, (0.5 - t) * 1.4) : mix(mid, bright, (t - 0.5) * 1.9);
    // 几处太阳黑子
    const spots: [number, number, number][] = [
      [0.22, 0.36, 0.045],
      [0.61, 0.58, 0.032],
      [0.83, 0.3, 0.026]
    ];
    for (const [sx, sy, sr] of spots) {
      const d = Math.hypot(u - sx, (v - sy) * 2);
      if (d < sr * 2.4) {
        color = mix(color, [90, 40, 8], Math.pow(Math.max(0, 1 - d / (sr * 2.4)), 2.2));
      }
    }
    return color;
  });
  return toTexture(canvas);
}

/** 地球：海洋 + 大陆 + 极冠 + 云带 */
export function makeEarthTexture(): THREE.CanvasTexture {
  const fbm = makeFbm(11, 6);
  const ocean = hexToRgb("#1f5fa8");
  const oceanDeep = hexToRgb("#123c73");
  const land = hexToRgb("#3f7a3a");
  const landDry = hexToRgb("#b39a5b");
  const ice = hexToRgb("#f2f7fb");
  const canvas = paint(512, 256, (u, v) => {
    const n = fbm(u * 5.5, v * 5.5);
    const detail = fbm(u * 18 + 40, v * 18 + 9);
    const h = n * 0.78 + detail * 0.22;
    let color: [number, number, number];
    if (h > 0.545) {
      const t = (h - 0.545) / 0.2;
      color = mix(land, landDry, Math.min(1, t * 0.9));
    } else {
      color = mix(oceanDeep, ocean, Math.min(1, (h - 0.3) / 0.245));
    }
    // 极冠
    const polar = Math.pow(Math.abs(v - 0.5) * 2, 7.5);
    color = mix(color, ice, Math.min(1, polar * 1.5));
    // 云带
    const cloud = fbm(u * 9 + 77, v * 9 + 31);
    const cloudAmt = Math.max(0, cloud - 0.58) * 1.5;
    return mix(color, [245, 248, 252], Math.min(0.55, cloudAmt));
  });
  return toTexture(canvas);
}

/** 金星：浓密硫酸云，黄白色旋涡 */
export function makeVenusTexture(): THREE.CanvasTexture {
  const fbm = makeFbm(29, 5);
  const a = hexToRgb("#e8cf9a");
  const b = hexToRgb("#c99f56");
  const c = hexToRgb("#f3e6c4");
  const canvas = paint(512, 256, (u, v) => {
    const swirl = fbm(u * 4 + v * 3, v * 12);
    const fine = fbm(u * 20 + 5, v * 40 + 2);
    const t = swirl * 0.6 + fine * 0.4;
    let color = t < 0.5 ? mix(a, b, (0.5 - t) * 1.5) : mix(a, c, (t - 0.5) * 1.7);
    return color;
  });
  return toTexture(canvas);
}

/** 按 textureKey 生成纹理 */
export function buildTexture(key: string): THREE.CanvasTexture {
  switch (key) {
    case "sun":
      return makeSunTexture();
    case "mercury":
      return makeRockyTexture({
        base: "#9c8e82",
        dark: "#5f564d",
        light: "#c9bdb1",
        craterCount: 150,
        seed: 5,
        contrast: 1.15
      });
    case "venus":
      return makeVenusTexture();
    case "earth":
      return makeEarthTexture();
    case "mars":
      return makeRockyTexture({
        base: "#c1502e",
        dark: "#6f2a15",
        light: "#e08a63",
        craterCount: 90,
        seed: 13,
        contrast: 1.05
      });
    case "jupiter":
      return makeBandedTexture({
        bands: [
          [0.0, "#c9a877"],
          [0.12, "#e6d3ad"],
          [0.24, "#b98a5d"],
          [0.36, "#efe2c4"],
          [0.48, "#c79a6a"],
          [0.56, "#e8d6b3"],
          [0.68, "#b8875a"],
          [0.8, "#e3d0aa"],
          [1.0, "#c2a074"]
        ],
        turbulence: 0.055,
        seed: 31,
        spot: { x: 0.64, y: 0.64, rx: 0.075, ry: 0.05, color: "#c1573a" }
      });
    case "saturn":
      return makeBandedTexture({
        bands: [
          [0.0, "#d9c79b"],
          [0.2, "#efe4c4"],
          [0.4, "#ddc99c"],
          [0.55, "#f2e8cd"],
          [0.75, "#d5c096"],
          [1.0, "#cbb488"]
        ],
        turbulence: 0.035,
        seed: 47
      });
    case "uranus":
      return makeBandedTexture({
        bands: [
          [0.0, "#a7e2e6"],
          [0.35, "#93d8de"],
          [0.65, "#a3dfe4"],
          [1.0, "#8ed2d9"]
        ],
        turbulence: 0.02,
        seed: 53
      });
    case "neptune":
      return makeBandedTexture({
        bands: [
          [0.0, "#3f6fd8"],
          [0.3, "#4d81e6"],
          [0.55, "#3a63c9"],
          [0.8, "#4f86e8"],
          [1.0, "#3960c4"]
        ],
        turbulence: 0.03,
        seed: 61,
        spot: { x: 0.35, y: 0.62, rx: 0.06, ry: 0.04, color: "#1f3f92" }
      });
    case "pluto":
      return makeRockyTexture({
        base: "#bda892",
        dark: "#6d5b4b",
        light: "#e8dcc8",
        craterCount: 40,
        seed: 71,
        contrast: 1.2
      });
    case "moonDetail":
      // 卫星共用细节：明亮基底 + 密集撞击坑，配合材质 color 染色
      return makeRockyTexture({
        base: "#c9c9c9",
        dark: "#6a6a6a",
        light: "#ffffff",
        craterCount: 260,
        seed: 41,
        contrast: 1.1
      });
    default:
      return makeRockyTexture({
        base: "#8d8378",
        dark: "#544c44",
        light: "#c2b8ac",
        seed: 3
      });
  }
}

/** 土星/天王星光环纹理（径向条纹 + 透明间隙） */
export function makeRingTexture(color: string, seed = 5): THREE.CanvasTexture {
  const canvas = createCanvas(512, 32);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return toTexture(canvas);
  }
  const rand = mulberry32(seed);
  const base = hexToRgb(color);
  const image = ctx.createImageData(512, 32);
  // 先生成径向亮度曲线
  const profile = new Float32Array(512);
  for (let i = 0; i < 512; i++) {
    const t = i / 511;
    let alpha = 0.75;
    // 卡西尼缝等主要空隙
    const gaps: [number, number, number][] = [
      [0.42, 0.47, 0.12],
      [0.62, 0.65, 0.25],
      [0.82, 0.85, 0.35],
      [0.0, 0.06, 0.2],
      [0.97, 1.0, 0.6]
    ];
    for (const [g0, g1, depth] of gaps) {
      if (t >= g0 && t <= g1) {
        alpha *= 1 - depth;
      }
    }
    alpha *= 0.65 + rand() * 0.5;
    profile[i] = Math.max(0, Math.min(1, alpha));
  }
  // 轻微平滑
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < 511; i++) {
      profile[i] = (profile[i - 1] + profile[i] * 2 + profile[i + 1]) / 4;
    }
  }
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 512; x++) {
      const index = (y * 512 + x) * 4;
      const alpha = profile[x];
      image.data[index] = base[0];
      image.data[index + 1] = base[1];
      image.data[index + 2] = base[2];
      image.data[index + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 径向光晕精灵（用于太阳与恒星发光） */
export function makeGlowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const canvas = createCanvas(256, 256);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(128, 128, 2, 128, 128, 128);
    gradient.addColorStop(0, inner);
    gradient.addColorStop(0.28, outer);
    gradient.addColorStop(1, "rgba(255,180,60,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 文本标签精灵 */
export function makeLabelTexture(
  text: string,
  color: string,
  fontPx = 46,
  sub?: string
): { texture: THREE.CanvasTexture; aspect: number } {
  const canvas = createCanvas(16, 16);
  const probe = canvas.getContext("2d");
  const font = `900 ${fontPx}px 'Microsoft YaHei', 'PingFang SC', sans-serif`;
  let width = 160;
  if (probe) {
    probe.font = font;
    width = Math.ceil(probe.measureText(text).width) + 34;
  }
  const height = Math.ceil(fontPx * (sub ? 2.5 : 1.75));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = fontPx * 0.2;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(6,10,20,0.92)";
    const mainY = sub ? height * 0.36 : height / 2;
    ctx.strokeText(text, width / 2, mainY);
    ctx.fillStyle = color;
    ctx.fillText(text, width / 2, mainY);
    if (sub) {
      const subFont = `700 ${Math.round(fontPx * 0.6)}px 'Microsoft YaHei', 'PingFang SC', sans-serif`;
      ctx.font = subFont;
      ctx.lineWidth = fontPx * 0.16;
      ctx.strokeText(sub, width / 2, height * 0.76);
      ctx.fillStyle = "rgba(226,236,255,0.92)";
      ctx.fillText(sub, width / 2, height * 0.76);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: width / height };
}
