import { Fragment, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import Knob, { type KnobTick } from "./Knob";
import SubsolarCurve from "./SubsolarCurve";

export interface PlayerInfo {
  studentId: number;
  studentName: string;
  className: string | null;
  studentNo?: string;
}

export interface LayerState {
  /** 卫星影像（earth.jpg） */
  texture: boolean;
  /**
   * 双色底图（v1.5.0）：只分大洲与海洋两种情况 —— 海洋浅蓝、大洲深灰。
   * 与 `texture` / `white` 三选一。比影像干净得多：没有云、没有地形明暗干扰，
   * 学生一眼能认出大陆轮廓（需求①）。
   */
  baseMap: boolean;
  /**
   * 纯白地球：不贴任何贴图，用一个白球呈现。
   * 与 `texture` / `baseMap` 三选一。
   */
  white: boolean;
  /** 夜面底图：城市夜间灯光（NASA 夜间灯光影像），只贴在背光的一侧 */
  nightLights: boolean;
  /**
   * 关闭黑夜效果：整球按白天受光着色，晨昏线那一侧的黑色掩膜不再出现。
   * 用途是"看清地表全貌" —— 讲解地形/地名时，黑掉的那半边会把内容挡住。
   * 与 `nightLights` 是**包含**关系：黑夜关掉后夜面不存在，夜灯自然也没了意义。
   */
  nightOff: boolean;
  grid: boolean;
  equator: boolean;
  tropics: boolean;
  polar: boolean;
  meridian: boolean;
  climate: boolean;
  timezone: boolean;
  axis: boolean;
  stars: boolean;
  /**
   * 纯白背景（v1.5.0，需求②）：把画布背景从深空改成纯白，便于投影、打印、
   * 或嵌进浅色底稿。与「星空背景」互斥 —— 白底上看不见白色星点。
   */
  whiteBg: boolean;
  orbit: boolean;
  terminator: boolean;
  sunDisplay: boolean;
  rays: boolean;
  subsolar: boolean;
  zone: boolean;
}

interface MarkerInfo {
  lat: number;
  lon: number;
}

/** 主视图的视角预设。极地俯视不再是主视角模式——v1.4.3 起改为左下角两个独立子图。 */
/**
 * 视角：前三档都是「把镜头摆到某个固定机位上」（目标点＝太阳或地球），
 * `free` 是第四档 —— 不动镜头、只解锁：允许平移，于是目标点可以离开太阳/地球，
 * 旋转与滚轮都绕着这个新目标点发生，也就成了在太空里任意移动。
 */
type ViewKey = "orbit" | "top" | "earth" | "free";

/**
 * 地轴姿态（v1.5.0，需求③）：
 *  - `oblique`：地轴与公转轨道面成 66.5° 倾角（＝黄赤交角 23.5°），默认，四季的来源；
 *  - `vertical`：地轴垂直于轨道面（黄赤交角 0°）。直射点终年落在赤道、全球终年昼夜平分、
 *    极地没有极昼极夜 —— 把这一档和默认档对着看，"地轴倾斜是四季成因"这句话才立得住。
 *    它同时是"回归运动曲线为什么会起伏"的对照实验：切到垂直档，曲线当场拉平。
 */
export type AxisMode = "oblique" | "vertical";

/** 经纬网疏密档位（度）。需求⑥：经纬线原先写死 15°，现在可选。 */
export const GRID_STEPS = [30, 15, 10, 5] as const;
export const DEFAULT_GRID_STEP = 15;

/** 纯白背景（需求②）与深空背景 */
const BG_SPACE = 0x070c16;
const BG_WHITE = 0xffffff;

const DEG = Math.PI / 180;
const EARTH_TILT = 23.44;
const LINE_RADIUS = 1.004;
/** 五带分界纬度（= 回归线与极圈），与地轴倾角一致 */
const ZONE_TROPIC = EARTH_TILT;
const ZONE_POLAR = 90 - EARTH_TILT;
/** 时区宽度（度） */
const TZ_WIDTH = 15;
/** 叠加球壳半径：略大于球面，保证罩在地表之上又不与线条/太阳直射带打架 */
const OVERLAY_RADIUS = 1.014;
/** 透明地球的不透明度（需求⑤）：留一点底色才看得出球是球，又不挡住背面的经纬线 */
const GHOST_ALPHA = 0.26;

/**
 * 经纬度夹角演示（需求⑤）在**用户还没选点**时用的示例点：北京。
 * 为什么要有它：这一节讲的是"经度/纬度是怎么量出来的"，如果必须先在球上点一下
 * 才有东西看，老师第一次翻开这一节就是一片空白 —— 先给一个默认点，随时可讲；
 * 学生在球上点过之后，演示自动切到学生选的那一点。
 */
const DEMO_POINT: MarkerInfo = { lat: 39.9, lon: 116.4 };

/* ---------------- 日心（公转）模型常数 ---------------- */
/** 公转轨道半长轴（显示单位） */
const ORBIT_A = 9.2;
/** 轨道偏心率：真实仅 0.0167，此处适度放大，便于看出近/远日点的差异 */
const ORBIT_E = 0.16;
/** 太阳显示半径 */
const SUN_RADIUS = 1.75;
/** 地轴倾斜方位相对「近日点方向」的夹角：近日点出现在冬至之后约两周 */
const AXIS_AZIMUTH = 14;
/** 太阳直射点在地球本地坐标中的固定经度（使特写视角下晨昏线始终纵贯画面中央） */
const SUBSOLAR_LON = 15;
/** 公转演示速度（度/秒） */
const SPIN_SPEED = 12;
/** 地球自转演示速度（度/秒）：约 6°/秒，公转一周 ≈ 30 秒内自转约 5 圈 */
const ROTATION_SPEED = 60;

const EARTH_TILT_RAD = EARTH_TILT * DEG;
const AXIS_AZIMUTH_RAD = AXIS_AZIMUTH * DEG;

/**
 * 地球自转轴在世界坐标中的方向（一年中在空间保持不变，这正是四季的成因）。
 * 约定：近日点方向 = +X，公转平面 = XZ 平面，公转方向为从北极上方看的逆时针。
 */
const AXIS_WORLD = new THREE.Vector3(
  Math.sin(EARTH_TILT_RAD) * Math.cos(AXIS_AZIMUTH_RAD),
  Math.cos(EARTH_TILT_RAD),
  Math.sin(EARTH_TILT_RAD) * Math.sin(AXIS_AZIMUTH_RAD)
).normalize();

/**
 * 地轴在世界坐标中的方向（按档位取）。需求③：垂直档就是世界 +Y —— 地轴与轨道面垂直，
 * 于是太阳方向（始终落在轨道面 XZ 上）与地轴的点积恒为 0，直射点纬度恒为 0。
 * 这不是"把效果关掉"，而正是要演示的那个结论：没有倾角就没有四季。
 */
function axisWorldFor(mode: AxisMode): THREE.Vector3 {
  return mode === "vertical" ? WORLD_UP.clone() : AXIS_WORLD.clone();
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const RAY_AXIS = new THREE.Vector3(0, 1, 0);
const SUN_AXIS_Z = new THREE.Vector3(0, 0, 1);

const COLORS = {
  equator: 0xff3b30,
  tropics: 0xffa502,
  polar: 0x2ee6ff,
  meridian: 0x8f6bff,
  grid: 0xffffff,
  axis: 0xf2e8d5,
  markerPole: 0xd4a843,
  markerHead: 0xff4d3a,
  poleDot: 0xf2e8d5,
  terminator: 0xffd34d,
  sun: 0xffdf6b,
  sunRay: 0xffc23d,
  sunRayCore: 0xff5f2e,
  subsolar: 0xff8c3a,
  zone: 0xffc23d,
  calTropical: 0xff6b3d,
  calTemperate: 0x4ddc7a,
  calFrigid: 0x59b8ff,
  tzA: 0x5a86ff,
  tzB: 0xf0b840,
  orbit: 0x9fb6d8,
  perihelion: 0x5fd8ff,
  aphelion: 0x8fa6ff,
  season: 0xffd76a
};

/* ---------------- 二分二至：轨道上的真实位置 ---------------- */
/**
 * 真近点角 ν 由几何关系推出：sinδ = -sinε·cos(ν+ψ)，ψ=14°。
 * 由此得到 冬至 ν=346°、春分 ν=76°、夏至 ν=166°、秋分 ν=256°；
 * 近日点 ν=0°、远日点 ν=180°，即近日点在冬至后约两周、远日点在夏至后约两周。
 */
const SEASONS = [
  { key: "chunfen", label: "春分", date: "3月21日前后", nu: 76, decl: 0 },
  { key: "xiazhi", label: "夏至", date: "6月22日前后", nu: 166, decl: 23.44 },
  { key: "qiufen", label: "秋分", date: "9月23日前后", nu: 256, decl: 0 },
  { key: "dongzhi", label: "冬至", date: "12月22日前后", nu: 346, decl: -23.44 }
] as const;

type SeasonKey = (typeof SEASONS)[number]["key"];

const PERIHELION_NU = 0;
const APHELION_NU = 180;

const SEASON_NOTES: Record<SeasonKey, string> = {
  chunfen: "太阳直射赤道，晨昏线正好经过南北两极，全球昼夜等长。",
  xiazhi: "太阳直射北回归线（23.5°N），北半球昼最长夜最短，北极圈及以北出现极昼。",
  qiufen: "太阳直射赤道，晨昏线正好经过南北两极，全球昼夜等长。",
  dongzhi: "太阳直射南回归线（23.5°S），北半球夜最长昼最短，北极圈及以北出现极夜。"
};

/* ---------------- 轨道几何 ---------------- */

/** 由真近点角求日地距离 */
function orbitRadius(nuDeg: number): number {
  const nu = nuDeg * DEG;
  return (ORBIT_A * (1 - ORBIT_E * ORBIT_E)) / (1 + ORBIT_E * Math.cos(nu));
}

/** 由真近点角求真近点角对应的世界坐标（太阳在原点，近日点在 +X） */
function orbitPosition(nuDeg: number, out?: THREE.Vector3): THREE.Vector3 {
  const nu = nuDeg * DEG;
  const r = orbitRadius(nuDeg);
  const v = out ?? new THREE.Vector3();
  return v.set(r * Math.cos(nu), 0, -r * Math.sin(nu));
}

/** 由公转位置求太阳直射点纬度（太阳直射点纬度 = 太阳方向的赤纬）。axis 由地轴档位决定 */
function declinationForNu(nuDeg: number, axis: THREE.Vector3 = AXIS_WORLD): number {
  const p = orbitPosition(nuDeg).multiplyScalar(-1).normalize();
  return Math.asin(THREE.MathUtils.clamp(p.dot(axis), -1, 1)) / DEG;
}

function localFromLatLon(lat: number, lon: number): THREE.Vector3 {
  // three.js SphereGeometry 贴图约定：lon 0° 在 +x 方向，东经 90° 在 -z 方向。
  return new THREE.Vector3(
    Math.cos(lat * DEG) * Math.cos(lon * DEG),
    Math.sin(lat * DEG),
    -Math.cos(lat * DEG) * Math.sin(lon * DEG)
  );
}

function latLonFromLocal(local: THREE.Vector3): MarkerInfo {
  const v = local.clone().normalize();
  const lat = Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) / DEG;
  let lon = Math.atan2(-v.z, v.x) / DEG;
  if (lon > 180) {
    lon -= 360;
  }
  if (lon < -180) {
    lon += 360;
  }
  return { lat, lon };
}

/* ---------------- 基础几何构件 ---------------- */

/** 纬线圈（水平圆环），latDeg 为纬度。 */
function makeParallelRing(latDeg: number, tube: number, color: number): THREE.Mesh {
  const radius = Math.cos(latDeg * DEG);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 10, 200),
    new THREE.MeshBasicMaterial({ color })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = Math.sin(latDeg * DEG);
  return ring;
}

/** 经线大圆（过两极的竖直圆环），lonDeg 为经度。 */
function makeMeridianRing(lonDeg: number, tube: number, color: number): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1, tube, 10, 240),
    new THREE.MeshBasicMaterial({ color })
  );
  // Torus 默认位于 XY 平面（含 Y 轴，经过 lon 0°/180°），绕 Y 轴旋转到目标经度。
  ring.rotation.y = -lonDeg * DEG;
  return ring;
}

/** 细线圆（用于经纬网）。 */
function makeThinCircle(
  angleDeg: number,
  kind: "parallel" | "meridian"
): THREE.LineLoop {
  const points: THREE.Vector3[] = [];
  const segments = 128;
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    if (kind === "parallel") {
      const r = Math.cos(angleDeg * DEG);
      points.push(
        new THREE.Vector3(
          r * Math.cos(t) * LINE_RADIUS,
          Math.sin(angleDeg * DEG) * LINE_RADIUS,
          r * Math.sin(t) * LINE_RADIUS
        )
      );
    } else {
      points.push(
        new THREE.Vector3(Math.cos(t) * LINE_RADIUS, Math.sin(t) * LINE_RADIUS, 0)
      );
    }
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.LineLoop(
    geometry,
    new THREE.LineBasicMaterial({
      color: COLORS.grid,
      transparent: true,
      opacity: 0.3
    })
  );
  if (kind === "meridian") {
    line.rotation.y = -angleDeg * DEG;
  }
  return line;
}

/** 文本标签精灵：自动按文本宽度撑开画布。 */
function makeLabelSprite(
  text: string,
  color: string,
  fontPx = 44,
  worldScale = 0.115
): THREE.Sprite {
  const canvas = document.createElement("canvas");
  let width = 128;
  let height = Math.ceil(fontPx * 1.8);
  const probe = canvas.getContext("2d");
  if (probe) {
    probe.font = `900 ${fontPx}px 'Microsoft YaHei', 'PingFang SC', sans-serif`;
    width = Math.ceil(probe.measureText(text).width) + 40;
  }
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.font = `900 ${fontPx}px 'Microsoft YaHei', 'PingFang SC', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = fontPx * 0.18;
    ctx.strokeStyle = "rgba(8,14,26,0.92)";
    ctx.lineJoin = "round";
    ctx.strokeText(text, width / 2, height / 2);
    ctx.fillStyle = color;
    ctx.fillText(text, width / 2, height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true })
  );
  sprite.scale.set(worldScale * (width / height), worldScale, 1);
  return sprite;
}

function disposeSprite(sprite: THREE.Sprite) {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}

/**
 * 可反复改写的文字精灵（画布与贴图复用，只重绘内容），
 * 用于地方时这种每帧都可能变化的标签，避免频繁创建/销毁贴图。
 */
function makeDynamicLabel(
  color: string,
  fontPx = 44,
  worldScale = 0.115
): { sprite: THREE.Sprite; draw: (text: string) => void } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(fontPx * 7.2);
  canvas.height = Math.ceil(fontPx * 1.9);
  const fontSize = `900 ${fontPx}px 'Microsoft YaHei', 'PingFang SC', sans-serif`;
  let last = "";
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true })
  );
  sprite.scale.set(worldScale * (canvas.width / canvas.height), worldScale, 1);
  const draw = (text: string) => {
    if (text === last) {
      return;
    }
    last = text;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = fontSize;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = fontPx * 0.2;
    ctx.strokeStyle = "rgba(8,14,26,0.94)";
    ctx.lineJoin = "round";
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
    ctx.fillStyle = color;
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    texture.needsUpdate = true;
  };
  return { sprite, draw };
}

/** 太阳光晕精灵（径向渐变的加色混合）。 */
function makeGlowSprite(
  inner: string,
  mid: string,
  scale: number
): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
    gradient.addColorStop(0, inner);
    gradient.addColorStop(0.28, mid);
    gradient.addColorStop(1, "rgba(255,170,60,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  sprite.scale.setScalar(scale);
  return sprite;
}

/* ---------------- 程序化太阳表面贴图（离线生成） ---------------- */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16)
  ];
}

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** 太阳表面：米粒组织 + 太阳黑子 */
function makeSunTexture(): THREE.CanvasTexture {
  const fbm = makeFbm(3, 5);
  const bright = hexToRgb("#fff6d0");
  const mid = hexToRgb("#ffbb33");
  const dark = hexToRgb("#c9640f");
  const width = 512;
  const height = 256;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = x / width;
        const v = y / height;
        const n = fbm(u * 26, v * 26);
        const n2 = fbm(u * 74 + 17, v * 74 + 4);
        const t = n * 0.7 + n2 * 0.3;
        let color = t < 0.5 ? mixRgb(mid, dark, (0.5 - t) * 1.4) : mixRgb(mid, bright, (t - 0.5) * 1.9);
        const spots: [number, number, number][] = [
          [0.22, 0.36, 0.045],
          [0.61, 0.58, 0.032],
          [0.83, 0.3, 0.026]
        ];
        for (const [sx, sy, sr] of spots) {
          const d = Math.hypot(u - sx, (v - sy) * 2);
          if (d < sr * 2.4) {
            color = mixRgb(color, [96, 42, 8], Math.pow(Math.max(0, 1 - d / (sr * 2.4)), 2.2));
          }
        }
        const index = (y * width + x) * 4;
        image.data[index] = Math.max(0, Math.min(255, color[0]));
        image.data[index + 1] = Math.max(0, Math.min(255, color[1]));
        image.data[index + 2] = Math.max(0, Math.min(255, color[2]));
        image.data[index + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/* ---------------- 太阳光柱的几何 ----------------
   只有一根半透明光柱，从地球射向太阳。圆柱半径＝地球显示半径（球体半径 1），
   所以它的直径正好等于地球直径：近地端的开口圆环与地球轮廓相切、贴合成"光从地球出发"，
   远端也不收束，就是一束地球那么粗的光。
   中间另保留一条橙红色的太阳直射细柱，作为「太阳直射点」的基准线。 */
const BEAM_RADIUS = 1; // ＝地球显示半径 ⇒ 光柱直径＝地球直径
const CORE_RADIUS = 0.032; // 太阳直射光线（基准细柱）

/* ---------------- 地方时 / 时区 ---------------- */

export interface VisibilityState {
  grid: boolean;
  equator: boolean;
  climate: boolean;
  timezone: boolean;
  white: boolean;
  hasTex: boolean;
  /** 夜间灯光底图开关是否生效（夜面是否在叠加城市灯光） */
  nightLights: boolean;
  /** 黑夜效果是否被关掉（整球按白天受光着色） */
  nightOff: boolean;
  /** 夜面灯光贴图是否已加载成功 */
  hasNight: boolean;
  /** 双色底图是否被选为地表素材 */
  base: boolean;
  /** 双色底图贴图是否已加载成功 */
  hasBase: boolean;
  /** 透明地球是否打开，以及打开后的实际不透明度 */
  ghost: boolean;
  ghostAlpha: number;
  /** 经纬度夹角演示是否打开 */
  geoAngle: boolean;
  /** 画布背景是否为纯白 */
  whiteBg: boolean;
  /** 当前经纬网间隔（度）与线数（供回归核对"换档位真的重建了"） */
  gridStep: number;
  gridLines: number;
  /** 地轴图层开关、星空图层开关 */
  axis: boolean;
  stars: boolean;
  /** 五带文字标注（北寒带…南寒带）是否显示 */
  climateLabels: boolean;
}

export interface ClockPayload {  /** 自转角（0~360），供自转旋钮的指针使用 */
  spinAngle: number;
  /** 太阳直射经线（地理经度，-180~180）：该经线的地方时恰好为正午 12:00 */
  subsolarLon: number;
  /** 点击标记处的地方时（小时，0~24）；未标记时为 null */
  markerHours: number | null;
}

/** 由太阳直射经线求任意经线的地方时（小时，0~24）：每向东 15° 地方时早 1 小时 */
function localHoursAt(lon: number, subsolarLon: number): number {
  const h = 12 + (lon - subsolarLon) / 15;
  return ((h % 24) + 24) % 24;
}

/** 小时数 → "HH:MM" */
function formatClock(hours: number): string {
  const total = ((Math.round(hours * 60) % 1440) + 1440) % 1440;
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** 时区序号：全球按经度每 15° 划分，返回 -12 ~ 12 */
function zoneIndexOf(lon: number): number {
  return Math.round(lon / TZ_WIDTH);
}

function formatZone(lon: number): string {
  const z = zoneIndexOf(lon);
  if (z === 0) {
    return "中时区";
  }
  return `${z > 0 ? "东" : "西"}${Math.abs(z)}区`;
}

/* ---------------- 引擎 ---------------- */

interface WorldLabel {
  sprite: THREE.Sprite;
  base: THREE.Vector3;
  refDist: number;
}

interface Engine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  earthAnchor: THREE.Group;
  tiltGroup: THREE.Group;
  earthMesh: THREE.Mesh;
  earthMaterial: THREE.ShaderMaterial;
  /** 五带 / 时区叠加球壳的材质（两个图层共用一套着色器，各自开关） */
  overlayMaterial: THREE.ShaderMaterial;
  gridGroup: THREE.Group;
  equatorGroup: THREE.Group;
  tropicsGroup: THREE.Group;
  polarGroup: THREE.Group;
  meridianGroup: THREE.Group;
  axisGroup: THREE.Group;
  starsPoints: THREE.Points;
  markerGroup: THREE.Group;
  terminatorMesh: THREE.Mesh;
  terminatorLabel: THREE.Sprite;
  sunGroup: THREE.Group;
  subsolarGroup: THREE.Group;
  zoneGroup: THREE.Group;
  rayGroup: THREE.Group;
  orbitGroup: THREE.Group;
  earthLabel: THREE.Sprite;
  earthTexture: THREE.Texture | null;
  /** 双色底图（大洲深灰 / 海洋浅蓝），加载成功后由 applySurface 挂到着色器上 */
  baseTexture: THREE.Texture | null;
  /** 夜面灯光贴图（城市灯光），加载成功后由 applySurface 挂到着色器上 */
  nightTexture: THREE.Texture | null;
  autoRotateWanted: boolean;
  setOrbitNu: (nuDeg: number) => void;
  /** 直接设置自转角（度），供自转旋钮使用 */
  setSpinAngle: (deg: number) => void;
  readSpinAngle: () => number;
  /** 旋钮拖动期间暂停自动自转，松手后恢复 */
  setSpinDragging: (active: boolean) => void;
  /** 地表素材：卫星影像 / 双色底图 / 纯白，三选一（着色器内优先级 纯白 > 底图 > 影像） */
  applySurface: (options: { texture: boolean; baseMap: boolean; white: boolean }) => void;
  /** 地轴档位（需求③）：倾斜 23.5° / 垂直 */
  setAxisMode: (mode: AxisMode) => void;
  /** 经纬网疏密（需求⑥）：传入纬度/经度间隔（度），整组重建 */
  setGridStep: (stepDeg: number) => void;
  /** 画布背景（需求②）：true = 纯白，false = 深空 */
  setBackground: (white: boolean) => void;
  /** 透明地球（需求⑤） */
  setTransparent: (on: boolean) => void;
  /** 经纬度夹角演示（需求⑤）：开时按传入点重建夹角几何 */
  setGeoAngle: (on: boolean, info: MarkerInfo) => void;
  /** 当前地轴方向（世界坐标）—— 开发钩子用它核对档位真的换掉了 */
  readAxis: () => [number, number, number];
  /** 当前经纬网间隔（度） */
  readGridStep: () => number;
  /**
   * 开发自检：经纬度夹角演示的几何量。
   * `latArcDeg` / `lonArcDeg` 是从两条弧的**首尾点方向量出来的圆心角** ——
   * 拿它和该点的 |纬度| / |经度| 对，就能证明画出来的弧不是"看着像"，
   * 而是真的等于这个度数（画错的弧长是看不出来的）。
   */
  readGeoAngle: () => {
    visible: boolean;
    lat: number;
    lon: number;
    latArcDeg: number;
    lonArcDeg: number;
    /** 画出来的几何件数（管与顶点球；标签不计） */
    parts: number;
    /** 两个角各自的**两条边**与**弧两端**的方向（方位角）。
     *  弧的两端必须分别压在两条边上 —— 这是"夹角是一个完整的角"的可判据化说法。 */
    latEdges: MarkerInfo[];
    lonEdges: MarkerInfo[];
    latArcEnds: MarkerInfo[];
    lonArcEnds: MarkerInfo[];
    labels: string[];
  };
  /** 开发自检：调夹角线的粗细倍率（牙齿测试用：压细之后"线太细"的判据必须变红） */
  setAngleThickness: (scale: number) => void;
  /** 开发自检：两条夹角弧投影到屏幕的点（CSS 像素）—— 在**真实帧**上量"线有多粗"用 */
  readGeoArcScreen: () => { lat: { x: number; y: number }[]; lon: { x: number; y: number }[] };
  readDeclination: () => number;
  readNu: () => number;
  /** 太阳直射经线（地理经度，单位度）：该经线地方时为正午 12:00 */
  readSubsolarLon: () => number;
  onSpinChange: ((deg: number) => void) | null;
  onClock: ((payload: ClockPayload) => void) | null;
  setView: (key: ViewKey) => void;
  setSpin: (on: boolean) => void;
  setRotate: (on: boolean) => void;
  readGeometry: () => {
    camLat: number;
    camLon: number;
    sunLat: number;
    sunLon: number;
    angle: number;
    view: ViewKey;
  };
  readSubsolarLabelBox: () => {
    text: string;
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    center: { x: number; y: number };
    rayPoint: { x: number; y: number };
  };
  /**
   * 开发自检：夹角两标签 +「地方时」徽标的屏幕包围盒（CSS 像素）。
   * 「叠没叠」只能看屏幕像素 —— 世界坐标差多少与屏幕上差多少不是一回事。
   */
  readGeoLabelBoxes: () => {
    tag: string;
    text: string;
    visible: boolean;
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    cx: number;
    cy: number;
  }[];
  /** 开发自检：夹角标签的屏幕让位开关（牙齿测试用） */
  setLabelSeparate: (on: boolean) => void;
  onNuChange: ((nu: number) => void) | null;
  onViewChange: ((key: ViewKey) => void) | null;
  /** 开发自检：图层开关最终有没有落到场景上 */
  readVisibility: () => VisibilityState;
  /** 开发自检：五带文字标注的屏幕位置（确认真的画出来了、且没有叠在一起） */
  readZoneLabels: () => {
    text: string;
    visible: boolean;
    screen: { x: number; y: number };
  }[];
  /**
   * 极地俯视子图：在宿主元素里挂一块独立小画布，用一台沿地轴的相机
   * 单独渲染，不改变主视图的取景。收起面板时 detach。
   */
  attachPoleView: (pole: "north" | "south", host: HTMLDivElement) => void;
  detachPoleViews: () => void;
  /**
   * 开发自检：太阳光线束的形态（半径、材质、透明度、是否加法混合）
   * 与每根光柱两端/中点的屏幕取样坐标（用于像素采样验证"光柱真的可见"）。
   */
  readRays: () => {
    count: number;
    visible: boolean;
    /** 光柱半径（世界单位），恒等于地球显示半径 1 ⇒ 直径＝地球直径 */
    beamRadius: number;
    beamDiameter: number;
    earthRadius: number;
    coreRadius: number;
    beamOpacity: number;
    beamAdditive: boolean;
    beamMaterialType: string;
    coreMaterialType: string;
    beamLength: number;
    samples: {
      name: string;
      mid: { x: number; y: number };
      earthEnd: { x: number; y: number };
      sunEnd: { x: number; y: number };
      /** 近地端开口圆环的上下两点（屏幕坐标），用于核对柱径与地球视直径 */
      rimTop: { x: number; y: number };
      rimBottom: { x: number; y: number };
    }[];
  };
  /**
   * 开发自检：渲染一帧后直接从帧缓冲读像素（CSS 像素坐标 → RGBA）。
   * 比抓窗口截图可靠得多：不受浏览器合成时机影响，不会读到画了一半的帧。
   * 返回值附上这一次渲染的耗时，便于观察光柱这种大体量透明几何的性能代价。
   */
  samplePixels: (pts: { x: number; y: number }[]) => {
    pixels: { r: number; g: number; b: number }[];
    renderMs: number;
  };
  /** 开发自检：极地子图的画布矩形（页面坐标）与最近一帧画出的三角形数 */
  readPoleViews: () => {
    pole: "north" | "south";
    rect: { x: number; y: number; w: number; h: number };
    triangles: number;
  }[];
  dispose: () => void;
  placeMarker: (lat: number, lon: number) => void;
  clearMarker: () => void;
  /** 开发自检：标记点是否真的进了场景、投影到屏幕的什么位置 */
  readMarkerDebug: () => {
    children: number;
    worldPos: [number, number, number];
    screen: { x: number; y: number };
    earthScreen: { x: number; y: number };
    latLon: MarkerInfo | null;
  };
  focusLatLon: (lat: number, lon: number, distance?: number) => void;
  /**
   * 开发自检：纬线标签（赤道 / 回归线 / 极圈）每帧归位后的实际位置。
   * front = 标签点方向·相机方向，>0 才在朝向镜头的半球上，越大越正对镜头。
   */
  readLatLabels: () => {
    text: string;
    visible: boolean;
    screen: { x: number; y: number };
    front: number;
  }[];
}

function buildEngine(container: HTMLDivElement): Engine {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070c16);

  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / Math.max(container.clientHeight, 1),
    0.1,
    400
  );

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 1.4;
  controls.maxDistance = 62;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.4;

  const worldLabels: WorldLabel[] = [];
  function registerWorldLabel(sprite: THREE.Sprite, refDist = 30) {
    worldLabels.push({ sprite, base: sprite.scale.clone(), refDist });
  }

  /* ---- 地球：earthAnchor（公转位置）→ tiltGroup（地轴姿态）→ spinGroup（自转）---- */
  const earthAnchor = new THREE.Group();
  scene.add(earthAnchor);
  const tiltGroup = new THREE.Group();
  earthAnchor.add(tiltGroup);
  /* spinGroup 嵌在 tiltGroup 内，绕本地 Y 轴（与地轴重合）旋转；
     地球表面贴图、经纬线、用户标记都挂在这里，随自转一起转；
     地轴杆（axisGroup）、太阳直射带（zoneGroup）则留在 tiltGroup 上，保持地轴姿态。 */
  const spinGroup = new THREE.Group();
  tiltGroup.add(spinGroup);

  /**
   * 当前地轴方向（需求③）：`oblique` 恒为 AXIS_WORLD，`vertical` 恒为世界 +Y。
   * 做成**可变量**而不是常量，是因为 setOrbitNu / 极地子图取景 / 开发钩子都要读它，
   * 而档位随时可能切换 —— 三处各自去问档位、各自推一遍方向，迟早会推歪一处。
   */
  let axisWorld = axisWorldFor("oblique");
  let axisMode: AxisMode = "oblique";

  const earthMaterial = new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: null },
      /** 双色底图（大洲深灰 / 海洋浅蓝），与 earth.jpg 同投影同尺寸，可直接共用 UV */
      baseMap: { value: null },
      /** 夜面底图：城市夜间灯光影像（与白天贴图同一等距圆柱投影，可直接共用 UV） */
      nightMap: { value: null },
      uHasTex: { value: 0 },
      uHasBase: { value: 0 },
      uHasNight: { value: 0 },
      uBase: { value: 0 },
      uWhite: { value: 0 },
      uNight: { value: 1 },
      uNoNight: { value: 0 },
      /** 透明地球（需求⑤）：1 = 半透明，能看见背半球被挡住的经纬线 */
      uGhost: { value: 0 },
      uDayColor: { value: new THREE.Color(0x2a4d7f) },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) }
    },
    // 透明地球需要在**不透明档也要能正确遮挡**：alpha=1 时深度照写，视觉上与不透明完全一致；
    // 切到透明档再把 uGhostAlpha 压下来并停止写深度，背面的经纬线才能透出来。
    transparent: true,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalW;
      void main() {
        vUv = uv;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D dayMap;
      uniform sampler2D baseMap;
      uniform sampler2D nightMap;
      uniform float uHasTex;
      uniform float uHasBase;
      uniform float uHasNight;
      uniform float uBase;
      uniform float uWhite;
      uniform float uNight;
      uniform float uNoNight;
      uniform float uGhost;
      uniform vec3 uDayColor;
      uniform vec3 uSunDir;
      varying vec2 vUv;
      varying vec3 vNormalW;

      void main() {
        float d = dot(normalize(vNormalW), normalize(uSunDir));
        float dayAmt = smoothstep(-0.10, 0.10, d);
        // 「关闭黑夜」：把昼夜混合系数直接钉在 1 ⇒ 整球都用白天色着色。
        // 不用为它单独写一条 mix 分支，因为下面夜灯那一项乘的是 (1.0 - dayAmt)，
        // dayAmt 变成 1 之后灯光增益自然归零 —— 一个开关同时关掉黑面与城市灯光，
        // 不会出现"黑夜没了、灯还亮在半空"的中间态。
        if (uNoNight > 0.5) { dayAmt = 1.0; }
        // 地表素材三选一（纯白 > 双色底图 > 卫星影像 > 兜底纯色）。
        // 底图档直接采样那张两色图：海洋浅蓝、大洲深灰，边缘靠纹理双线性插值自然过渡。
        vec3 day = uWhite > 0.5
          ? vec3(1.0)
          : (uBase > 0.5 && uHasBase > 0.5)
            ? texture2D(baseMap, vUv).rgb
            : (uHasTex > 0.5 ? texture2D(dayMap, vUv).rgb : uDayColor.rgb);
        vec3 night = uWhite > 0.5
          ? vec3(0.13, 0.15, 0.20)
          : day * 0.10 + vec3(0.010, 0.024, 0.055);

        // 夜间城市灯光：夜半球仍然是上面那层「黑色半透明掩膜」，
        // 灯光只是这张黑底上的点缀，不替代底色。
        // 贴图已在离线阶段提纯成"纯灯光点阵"（海洋/陆地底色全部归零），
        // 这里再抬高一次阈值，把 JPEG 压缩在暗部留下的块状振铃一并抹掉，
        // 只让城市核心那极小比例的像素亮起来。
        if (uWhite < 0.5 && uNight > 0.5 && uHasNight > 0.5) {
          vec3 lights = texture2D(nightMap, vUv).rgb;
          lights = max(lights - 0.06, 0.0) / 0.94;
          // 暖白偏色，让灯光像钨丝灯而不是纯白噪点
          lights *= vec3(1.0, 0.88, 0.70);
          night += lights * (1.0 - dayAmt);
        }

        // 透明地球（需求⑤）：整球压到半透明，让背半球的经纬线透出来 ——
        // 「经线是半圆、纬线是整圆；纬度是点与赤道面的夹角」这些结论，只有能同时
        // 看见前后两面才看得清。alpha 由 uGhost 在两档之间取，不透明档恒为 1。
        float alpha = mix(1.0, ${GHOST_ALPHA.toFixed(2)}, uGhost);
        gl_FragColor = vec4(mix(night, day, dayAmt), alpha);
      }
    `
  });
  const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), earthMaterial);
  spinGroup.add(earthMesh);

  /* ---- 叠加球壳：五带 / 全球时区（半透明，单独开关） ----
     独立成一层而不是并进地球着色器，好处是两处：① 不被昼夜明暗压暗，夜里也能看清；
     ② 半透明叠加不会盖住地表影像与经纬线。球壳比地表大一点点，只画朝向镜头的那半面。 */
  const overlayMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uClimate: { value: 0 },
      uTz: { value: 0 }
    },
    vertexShader: `
      varying vec3 vLocal;
      void main() {
        vLocal = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uClimate;
      uniform float uTz;
      varying vec3 vLocal;

      const float TROPIC = 23.44;
      const float POLAR = 66.56;

      void main() {
        float lat = degrees(asin(clamp(vLocal.y, -1.0, 1.0)));
        float lon = degrees(atan(-vLocal.z, vLocal.x));
        float alat = abs(lat);

        // 用 over 叠加，保证五带与时区同时打开时不会互相"吃掉"
        vec4 o = vec4(0.0);

        if (uClimate > 0.5) {
          vec4 c;
          if (alat <= TROPIC) {
            c = vec4(1.00, 0.42, 0.24, 0.22);   // 热带
          } else if (alat <= POLAR) {
            c = vec4(0.26, 0.86, 0.46, 0.17);   // 温带
          } else {
            c = vec4(0.34, 0.70, 1.00, 0.28);   // 寒带
          }
          // 分界线（南北回归线 23.5°、南北极圈 66.5°）
          if (min(abs(alat - TROPIC), abs(alat - POLAR)) < 0.6) {
            c = vec4(1.0, 0.96, 0.76, 0.7);
          }
          o = vec4(c.rgb * c.a + o.rgb * (1.0 - c.a), c.a + o.a * (1.0 - c.a));
        }

        if (uTz > 0.5) {
          // k 以 15° 为一个单位，整数处即时区界线
          float k = (lon + 180.0) / 15.0;
          float band = mod(floor(k), 2.0);
          vec3 rgb = band > 0.5 ? vec3(0.98, 0.80, 0.36) : vec3(0.34, 0.58, 1.00);
          float a = 0.17;
          float db = min(fract(k), 1.0 - fract(k));
          if (db < 0.042) {
            rgb = vec3(1.0, 0.97, 0.80);
            a = 0.68;
          }
          o = vec4(rgb * a + o.rgb * (1.0 - a), a + o.a * (1.0 - a));
        }

        if (o.a < 0.004) {
          discard;
        }
        gl_FragColor = o;
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    // 上面用「over」把两层合成后，o.rgb 已经是按 alpha 预乘的颜色，
    // 因此必须用预乘混合（One / 1−srcAlpha），否则标准混合会再乘一次 alpha，
    // 半透明色带会被压成 alpha²（0.2 → 0.04）几乎看不见。
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor
  });
  const overlayMesh = new THREE.Mesh(
    new THREE.SphereGeometry(OVERLAY_RADIUS, 96, 64),
    overlayMaterial
  );
  spinGroup.add(overlayMesh);

  /* ---- 五带文字标注（北寒带 / 北温带 / 热带 / 南温带 / 南寒带） ----
     做法：按「屏幕坐标」摆放，不把文字绑到球面的经纬度上。每帧先算出球面投影
     圆盘的圆心与轮廓半径，再把五个标签沿圆盘左缘按纬度排成一道弧（赤道最靠左、
     两极往内收）。好处：① 无论什么季节、自转角度、镜头方位，文字都在同一处、
     永远朝镜头、永远可读；② 标签落在各条带左端，和色带对得上；③ 不会像绑定
     经纬度那样被自转甩到背面。
     为什么不直接摆在纬度圈上：地轴与视线接近垂直时两极正好压在球面轮廓上
     （北寒带是贴着极点的小圆），球面上根本没有既在轮廓内、又属于该带的位置，
     硬摆就会让文字飘到球体外面，看着像浮在太空里。 */
  const zoneLabelGroup = new THREE.Group();
  zoneLabelGroup.visible = false;
  earthAnchor.add(zoneLabelGroup);
  const ZONE_LABEL_DEFS = [
    { text: "北寒带", lat: 78.3, color: "#9ad4ff" },
    { text: "北温带", lat: 45, color: "#8bf0aa" },
    { text: "热带", lat: 0, color: "#ffab86" },
    { text: "南温带", lat: -45, color: "#8bf0aa" },
    { text: "南寒带", lat: -78.3, color: "#9ad4ff" }
  ];
  /** 标签弧所在圆的半径 = 轮廓半径 × 该比例（<1 表示缩进到轮廓以内） */
  const ZONE_LABEL_X_RATIO = 0.93;
  /** 纬度 → 圆周角的映射（度）：±90° 纬度对应该圆周角，于是五个标签沿左缘排成一道弧 */
  const ZONE_LABEL_ANGLE = 70;
  /** 标签平面比地心靠近相机多少世界单位（保证不被地表挡住） */
  const ZONE_LABEL_DEPTH_GAP = 1.25;
  const zoneLabels = ZONE_LABEL_DEFS.map((def) => {
    const sprite = makeLabelSprite(def.text, def.color, 40, 0.1);
    zoneLabelGroup.add(sprite);
    return { ...def, sprite, base: sprite.scale.clone() };
  });
  const tmpCamRel = new THREE.Vector3();
  const tmpCamRight = new THREE.Vector3();
  const tmpLabelUp = new THREE.Vector3();
  const tmpCamFwd = new THREE.Vector3();
  const tmpProj = new THREE.Vector3();
  const tmpSize = new THREE.Vector2();

  function updateZoneLabels() {
    // 只在「五带图层开启」且处于地球特写时显示：
    // 公转全景里地球只有拳头大，文字会糊成一团；拉远到看不全球面时同理。
    tmpCamRel.copy(camera.position).sub(earthPos);
    const dist = tmpCamRel.length();
    const on =
      overlayMaterial.uniforms.uClimate.value > 0.5 &&
      viewState.current === "earth" &&
      dist < 4.2;
    zoneLabelGroup.visible = on;
    if (!on) {
      return;
    }
    renderer.getSize(tmpSize);
    const w = tmpSize.x;
    const h = tmpSize.y;
    // 地心在屏幕上的位置
    tmpProj.copy(earthPos).project(camera);
    const cx = (tmpProj.x * 0.5 + 0.5) * w;
    const cy = (-tmpProj.y * 0.5 + 0.5) * h;
    // 球面轮廓的像素半径 = tan(asin(R/dist)) × 每单位像素数
    const limbPx =
      Math.tan(Math.asin(Math.min(1, 1 / dist))) * (h / 2) / Math.tan((camera.fov * DEG) / 2);
    tmpCamRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    tmpLabelUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    tmpCamFwd.copy(earthPos).sub(camera.position).normalize();
    // 标签所在平面：比地心靠近相机 1.25 个世界单位，投影到该深度的换算系数
    const depth = Math.max(0.6, dist - ZONE_LABEL_DEPTH_GAP);
    const pxPerUnit = h / 2 / (depth * Math.tan((camera.fov * DEG) / 2));
    const r = ZONE_LABEL_X_RATIO * limbPx;

    for (const item of zoneLabels) {
      const ang = (item.lat / 90) * ZONE_LABEL_ANGLE * DEG;
      // 目标屏幕位置：以圆盘左缘为基准、按纬度沿顺时针排布
      let tx = cx - Math.cos(ang) * r;
      let ty = cy - Math.sin(ang) * r;
      // 极端缩放下别把标签甩出画面
      tx = Math.min(Math.max(tx, 10), w - 10);
      ty = Math.min(Math.max(ty, 10), h - 10);
      const dxW = (tx - cx) / pxPerUnit;
      const dyW = -(ty - cy) / pxPerUnit;
      item.sprite.position
        .copy(camera.position)
        .addScaledVector(tmpCamFwd, depth)
        .addScaledVector(tmpCamRight, dxW)
        .addScaledVector(tmpLabelUp, dyW)
        .sub(earthPos);
      // 屏幕尺寸恒定：世界尺寸随深度等比例缩放
      const s = depth / (3 - ZONE_LABEL_DEPTH_GAP);
      item.sprite.scale.set(item.base.x * s, item.base.y * s, 1);
    }
  }

  // 地球所属的“环境”节点：与地球同位置，但不随地球自转轴倾斜（晨昏线、光线都在世界方向下定义）
  const envGroup = new THREE.Group();
  earthAnchor.add(envGroup);

  /* ---- 赤道 / 回归线 / 极圈 / 本初子午线（鲜明配色 + 经纬度标签） ---- */
  const labelLon = 105; // 经线标签仍固定在面向特写视角的东侧经线上
  function fixedLabelAt(latDeg: number, lonDeg: number, text: string, color: string, lift = 1.06) {
    const sprite = makeLabelSprite(text, color);
    sprite.position.copy(localFromLatLon(latDeg, lonDeg).multiplyScalar(lift));
    return sprite;
  }

  /* 纬线标签（赤道 / 南北回归线 / 南北极圈）不绑死经度：
     一旦绑死经度，地球自转半圈标签就跟着转到背面，被地球本体挡得看不见了。
     改为每帧按当前相机方向重算落点（见 updateParallelLabels），
     让标签始终停在该纬度圈朝镜头的那一侧。 */
  const parallelLabels: { sprite: THREE.Sprite; lat: number; lift: number; text: string }[] = [];
  function latLabel(latDeg: number, text: string, color: string, lift = 1.06) {
    const sprite = makeLabelSprite(text, color);
    // 关闭深度测试：标签精灵是一块「正对镜头的平面」，而地球是弧面。贴着球面摆放时，
    // 标签靠近盘心的那一侧会扎进地球前半面之下、被判定为被遮挡，文字就被切掉半截
    // （赤道那种短标签没事，南北回归线这种长标签就会断在中间）。
    // 标签点由 updateParallelLabels 保证永远落在朝向镜头的一侧，所以这里放开深度测试是安全的；
    // 真正转到背面时会把 sprite 整个隐藏掉，不会出现"透过地球看见字"。
    sprite.material.depthTest = false;
    sprite.material.depthWrite = false;
    parallelLabels.push({ sprite, lat: latDeg, lift, text });
    return sprite;
  }

  const equatorGroup = new THREE.Group();
  equatorGroup.add(makeParallelRing(0, 0.010, COLORS.equator));
  equatorGroup.add(latLabel(0, "赤道 0°", "#ff6b5e"));
  spinGroup.add(equatorGroup);

  const tropicsGroup = new THREE.Group();
  tropicsGroup.add(makeParallelRing(EARTH_TILT, 0.007, COLORS.tropics));
  tropicsGroup.add(makeParallelRing(-EARTH_TILT, 0.007, COLORS.tropics));
  tropicsGroup.add(latLabel(EARTH_TILT, "北回归线 23.5°N", "#ffc247"));
  tropicsGroup.add(latLabel(-EARTH_TILT, "南回归线 23.5°S", "#ffc247"));
  spinGroup.add(tropicsGroup);

  const polarGroup = new THREE.Group();
  polarGroup.add(makeParallelRing(66.56, 0.006, COLORS.polar));
  polarGroup.add(makeParallelRing(-66.56, 0.006, COLORS.polar));
  polarGroup.add(latLabel(66.56, "北极圈 66.5°N", "#6ee9ff"));
  polarGroup.add(latLabel(-66.56, "南极圈 66.5°S", "#6ee9ff"));
  spinGroup.add(polarGroup);

  const meridianGroup = new THREE.Group();
  meridianGroup.add(makeMeridianRing(0, 0.010, COLORS.meridian));
  meridianGroup.add(fixedLabelAt(42, 0, "本初子午线 0°", "#b39cff", 1.07));
  meridianGroup.add(fixedLabelAt(42, 180, "180°", "#b39cff", 1.07));
  spinGroup.add(meridianGroup);

  /* ---- 纬线标签每帧归位 ----
     把「相机方向」与「屏幕右方向」都变换到地球自转坐标系（spinGroup 局部系）后，
     在那里每条纬线圈就是一个水平圆。在该圆上「正对镜头那一点」左右各 PL_SIDE_ANGLE
     的范围内采样，取最靠画面左侧、且仍朝镜头的那一点当作标签落点。
     于是无论自转转到哪个角度、镜头从哪个方位看，标签都不会翻到背面去。 */
  const tmpPlQuat = new THREE.Quaternion();
  const tmpPlQuatInv = new THREE.Quaternion();
  const tmpPlCamLocal = new THREE.Vector3();
  const tmpPlRightLocal = new THREE.Vector3();
  const tmpPlUpLocal = new THREE.Vector3();
  const tmpPlE1 = new THREE.Vector3();
  const tmpPlE2 = new THREE.Vector3();
  const tmpPlAxis = new THREE.Vector3(0, 1, 0);
  const tmpPlPoint = new THREE.Vector3();
  const tmpPlBest = new THREE.Vector3();
  /** 标签相对「正对镜头那一点」朝画面左侧偏开的角度：偏离中央，避让直射点/晨昏线标签 */
  const PL_SIDE_ANGLE = 26 * DEG;
  /** 采样次数（绕该纬度圈） */
  const PL_SAMPLES = 72;
  /** 朝向镜头的最低要求：低于它的点已经贴到球面轮廓、甚至翻到背面，弃用 */
  const PL_FRONT_MIN = 0.2;
  /** 极地俯视专用：屏幕右/上方向在赤道面内的投影，作为“摆到某个屏幕方位”的基 */
  const tmpPlEx = new THREE.Vector3();
  const tmpPlEy = new THREE.Vector3();
  /** 极地俯视时最外侧纬线（赤道）标签的屏幕方位角：正左方 */
  const PL_POLAR_START = 180 * DEG;
  /** 每往里一层（半径更小的纬线）标签再转过的角度，扇开避免叠字 */
  const PL_POLAR_STEP = 40 * DEG;

  function updateParallelLabels() {
    if (parallelLabels.length === 0) {
      return;
    }
    tmpPlQuat.copy(tiltGroup.quaternion).multiply(spinGroup.quaternion);
    tmpPlQuatInv.copy(tmpPlQuat).invert();
    tmpPlCamLocal
      .copy(camera.position)
      .sub(earthPos)
      .normalize()
      .applyQuaternion(tmpPlQuatInv);
    tmpPlRightLocal
      .set(1, 0, 0)
      .applyQuaternion(camera.quaternion)
      .applyQuaternion(tmpPlQuatInv);
    tmpPlUpLocal
      .set(0, 1, 0)
      .applyQuaternion(camera.quaternion)
      .applyQuaternion(tmpPlQuatInv);

    // 纬度圈平面内、正对镜头的那一点的方向（把相机方向投到垂直于地轴的平面上）
    tmpPlE1.copy(tmpPlCamLocal).addScaledVector(tmpPlAxis, -tmpPlCamLocal.dot(tmpPlAxis));
    if (tmpPlE1.lengthSq() < 1e-6) {
      // 退化：镜头几乎沿地轴俯视，改用「屏幕上方」在地轴垂面上的投影作参考
      tmpPlE1.copy(tmpPlUpLocal).addScaledVector(tmpPlAxis, -tmpPlUpLocal.dot(tmpPlAxis));
    }
    if (tmpPlE1.lengthSq() < 1e-6) {
      tmpPlE1.set(1, 0, 0);
    }
    tmpPlE1.normalize();
    tmpPlE2.crossVectors(tmpPlAxis, tmpPlE1).normalize();

    // 视线几乎沿地轴（南北极俯视）：几条纬线在屏幕上退化成一组同心圆，
    // 此时“哪一侧朝镜头”没有横向意义，交给专门的同心圆摆法（见 placeLabelsPolar）。
    if (Math.abs(tmpPlCamLocal.y) > 0.85) {
      placeLabelsPolar(tmpPlCamLocal.y > 0);
      return;
    }

    for (const item of parallelLabels) {
      const lat = item.lat * DEG;
      const cl = Math.cos(lat);
      const sl = Math.sin(lat);
      let bestScore = -Infinity;
      let found = false;
      for (let i = 0; i < PL_SAMPLES; i++) {
        const beta = (i / (PL_SAMPLES - 1) - 0.5) * 2 * PL_SIDE_ANGLE;
        tmpPlPoint
          .copy(tmpPlE1)
          .multiplyScalar(Math.cos(beta) * cl)
          .addScaledVector(tmpPlE2, Math.sin(beta) * cl)
          .addScaledVector(tmpPlAxis, sl);
        const front = tmpPlPoint.dot(tmpPlCamLocal);
        if (front < PL_FRONT_MIN) {
          continue;
        }
        // 屏幕横向位置 ∝ (点·屏幕右方向) / 该点到相机的进深，越小越靠左
        const score = -tmpPlPoint.dot(tmpPlRightLocal) / front;
        if (score > bestScore) {
          bestScore = score;
          tmpPlBest.copy(tmpPlPoint);
          found = true;
        }
      }
      if (!found) {
        // 兜底：万一窗口内一个采样点都不够朝镜头，就整圈扫一遍取最靠左的点
        for (let i = 0; i < PL_SAMPLES; i++) {
          const beta = (i / PL_SAMPLES) * Math.PI * 2;
          tmpPlPoint
            .copy(tmpPlE1)
            .multiplyScalar(Math.cos(beta) * cl)
            .addScaledVector(tmpPlE2, Math.sin(beta) * cl)
            .addScaledVector(tmpPlAxis, sl);
          const front = Math.max(0.1, tmpPlPoint.dot(tmpPlCamLocal));
          const score = -tmpPlPoint.dot(tmpPlRightLocal) / front;
          if (score > bestScore) {
            bestScore = score;
            tmpPlBest.copy(tmpPlPoint);
            found = true;
          }
        }
      }
      if (found) {
        // 落在背面就直接藏掉，别让文字浮在球面上（例如转到地球背面的那条回归线）
        const front = tmpPlBest.dot(tmpPlCamLocal);
        item.sprite.visible = front > -0.02;
        if (item.sprite.visible) {
          item.sprite.position.copy(tmpPlBest).multiplyScalar(item.lift);
        }
      }
    }
  }

  /* ---- 极地俯视时的纬线标签摆法 ----
     从北极朝下 / 南极朝上看时，各条纬线在屏幕上退化成一组同心圆，
     这时「朝镜头的一侧」已经没有横向意义（整圈都朝向镜头）。
     于是改按「屏幕方位角」把标签错开：最外圈（赤道）摆在正左方，
     每往里一层再转过 PL_POLAR_STEP，像一把扇子从正左扇向左上方；
     各标签落在自己那一圈的圆环上，既与同心圆一一对应，又互不叠字。 */
  function placeLabelsPolar(northUp: boolean) {
    // 屏幕右 / 上方向在赤道面（垂直于地轴的平面）内的投影，当作“屏幕方位”的基
    tmpPlEx.copy(tmpPlRightLocal).addScaledVector(tmpPlAxis, -tmpPlRightLocal.dot(tmpPlAxis));
    tmpPlEy.copy(tmpPlUpLocal).addScaledVector(tmpPlAxis, -tmpPlUpLocal.dot(tmpPlAxis));
    if (tmpPlEx.lengthSq() < 1e-6) {
      tmpPlEx.copy(tmpPlE1);
    }
    if (tmpPlEy.lengthSq() < 1e-6) {
      tmpPlEy.crossVectors(tmpPlAxis, tmpPlEx);
    }
    tmpPlEx.normalize();
    tmpPlEy.normalize();

    // 俯视只能看见与镜头同一侧的半球：北俯视看到北回归线 / 北极圈，南俯视看到南回归线 / 南极圈
    const want = northUp ? 1 : -1;
    const visible = parallelLabels
      .filter((item) => Math.sin(item.lat * DEG) * want > -1e-6)
      .sort((a, b) => Math.cos(b.lat * DEG) - Math.cos(a.lat * DEG));
    const shown = new Set(visible);
    for (const item of parallelLabels) {
      if (!shown.has(item)) {
        item.sprite.visible = false;
      }
    }
    visible.forEach((item, k) => {
      const lat = item.lat * DEG;
      const cl = Math.cos(lat);
      const gamma = PL_POLAR_START - k * PL_POLAR_STEP;
      tmpPlPoint
        .copy(tmpPlEx)
        .multiplyScalar(cl * Math.cos(gamma))
        .addScaledVector(tmpPlEy, cl * Math.sin(gamma))
        .addScaledVector(tmpPlAxis, Math.sin(lat));
      item.sprite.visible = tmpPlPoint.dot(tmpPlCamLocal) > -0.02;
      item.sprite.position.copy(tmpPlPoint).multiplyScalar(item.lift);
    });
  }

  /* ---- 经纬网（需求⑥：疏密可调，默认 15°）----
     赤道与本初子午线另有专属图层，这里跳过，避免两条线叠在一起（颜色不同会互相打架）。

     为什么是"重建"而不是"显隐"：每条线都是一个独立几何体，间距 30° 与间距 5° 的线
     根本不是同一批 —— 15° 的格子里没有 5° 那条线可显。所以换档位时**整组重建**：
     先把旧几何体与旧标签贴图全部 dispose（贴图不释放就是显存泄漏，学生上课来回切几次
     几十张 2048 贴图就堆住了），再按新间距铺一遍。 */
  const gridGroup = new THREE.Group();
  let gridStepDeg = DEFAULT_GRID_STEP;

  /** 度数标注：30°/60° 纬线与 90°E / 90°W 经线（比专用线条的标注小一号，避免抢视觉） */
  function makeGridLabel(lat: number, lon: number, text: string): THREE.Sprite {
    const sprite = makeLabelSprite(text, "#a9bedd", 32, 0.072);
    sprite.position.copy(localFromLatLon(lat, lon).multiplyScalar(1.045));
    return sprite;
  }

  function buildGraticule(stepDeg: number) {
    // 先释放旧内容：几何体 + 线材质 + 标签精灵的贴图与材质
    for (const child of [...gridGroup.children]) {
      gridGroup.remove(child);
      if (child instanceof THREE.LineLoop) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      } else if (child instanceof THREE.Sprite) {
        disposeSprite(child);
      }
    }
    gridStepDeg = stepDeg;
    for (let lat = stepDeg; lat <= 90 - stepDeg; lat += stepDeg) {
      gridGroup.add(makeThinCircle(lat, "parallel"));
      gridGroup.add(makeThinCircle(-lat, "parallel"));
    }
    // 每条经线大圆同时覆盖 lon 与 lon+180，所以只铺 0~180 的开区间即可铺满全球
    for (let lon = stepDeg; lon < 180; lon += stepDeg) {
      gridGroup.add(makeThinCircle(lon, "meridian"));
    }
    // 标注集合与档位无关（30/60 与 90 在任一档位上都是格线），换档时只需重建线条
    for (const lat of [30, 60, -30, -60]) {
      gridGroup.add(makeGridLabel(lat, labelLon, `${Math.abs(lat)}°${lat > 0 ? "N" : "S"}`));
    }
    for (const lon of [90, -90]) {
      gridGroup.add(makeGridLabel(12, lon, `${Math.abs(lon)}°${lon > 0 ? "E" : "W"}`));
    }
  }

  buildGraticule(gridStepDeg);
  spinGroup.add(gridGroup);

  /* ---- 经纬度的度量（需求⑤）：把"纬度 / 经度各是哪两条线的夹角"画出来 ----
     纬度的定义 = 该点半径与**赤道面**的夹角；经度的定义 = 该点的**子午面**与
     本初子午面的夹角。两句话在球面上说不清，必须把夹角本身画出来：

       · 纬度弧：在**过该点的铅垂子午面**内（竖直面），从赤道面方向 C→Q 转到半径 C→P，
         圆心角即纬度。作图三件套 = 半径 C→P、从 P 到赤道面的垂线（垂足 Q）、C→Q。
       · 经度弧：在**赤道面**内（水平面），从本初子午线方向 (1,0,0) 转到该点所在经线方向，
         圆心角即经度。

     两条弧共用一个顶点 Q，一横一竖叠在同一张图里，"两种夹角"的差别一眼可辨 ——
     这也正是课本上两张图（侧视剖面 + 极地俯视）合并之后的样子。

     挂 `spinGroup` 而不是 `tiltGroup`：经度的零点钉在地表（本初子午线）上，
     整组几何必须跟着自转走，否则地球一转，弧扫到的经度就不对了。 */
  const geoAngleGroup = new THREE.Group();
  geoAngleGroup.visible = false;
  spinGroup.add(geoAngleGroup);
  const ARC_R_LAT = 0.92;
  const ARC_R_LON = 0.62;
  const ARC_SEGMENTS = 48;
  /**
   * 两个角的边一律画到**赤道半径 1**为止（v1.5.1 修）。为什么不是
   * 「画到各自的垂足」：
   *   · 经度角起始那条边（本初子午面方向 +x）原本**根本没画** —— 弧从半空中起笔，
   *     看起来不像一个角（用户报的第 1 条）。
   *   · 纬度角的下边原本只画到垂足（半径 cos φ = 0.767），而纬度弧在半径 0.92 ——
   *     **弧的下端也悬在半空**，同一类毛病，只是不容易看出来。
   * 两条赤道边等长、都落在赤道圈上，"角"才是闭合的：弧的两端一定压在某条边上。
   */
  const EQ_EDGE_R = 1;
  /**
   * 两条弧的**点串**：开发钩子要从它量圆心角。
   * ⚠ v1.5.1 之后弧不再是 `THREE.Line`，不能再从几何体的 position 属性上读点 ——
   * 点串在这里留着，量角度这件事与"用线还是用管"解耦。
   */
  let geoLatArcPts: THREE.Vector3[] = [];
  let geoLonArcPts: THREE.Vector3[] = [];
  /** 两个角各自的"两条边""弧的两端"的方向（方位角形式）。开发钩子据此断言角是**完整**的：
   *  弧的两端必须分别压在两条边上（少一条边 ⇒ 这组断言当场红）。 */
  let geoLatEdges: MarkerInfo[] = [];
  let geoLonEdges: MarkerInfo[] = [];
  let geoLatArcEnds: MarkerInfo[] = [];
  let geoLonArcEnds: MarkerInfo[] = [];
  let geoAnglePoint: MarkerInfo = { lat: 40, lon: 116 };
  /** 两个夹角标签的精灵引用（开发钩子要量它们的屏幕包围盒） */
  let gaLatLabel: THREE.Sprite | null = null;
  let gaLonLabel: THREE.Sprite | null = null;
  /** 两个标签的**几何自然锚点**（先算这个，屏幕上怎么让位交给 updateGeoAngleLabels） */
  const gaLatAnchor = new THREE.Vector3();
  const gaLonAnchor = new THREE.Vector3();

  function clearGroup(group: THREE.Group) {
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      } else if (child instanceof THREE.Sprite) {
        disposeSprite(child);
      } else if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
  }

  /* ---- 夹角立体的线宽：**只能用管（Tube），加粗线本身就是做不到的**（v1.5.1 修）----
     `THREE.Line` 的 `linewidth` 在 WebGL 上被忽略（绝大多数平台恒为 1 设备像素），
     所以"把夹角线画粗些"在它身上无解 —— 只能把线做成**有直径的几何体**。
     做成管还多一个好处：它是三维实体，跟着镜头缩放，与地球/经纬网同一套空间感；
     1px 的线反而越放大越显得细。 */
  const GA_TUBE_ARC = 0.0076;
  const GA_TUBE_EDGE = 0.006;
  /**
   * 线宽总倍率。**开发钩子**用它做牙齿测试：压到 0.1 就退回"1px 细线"的观感，
   * 屏幕上量出来的线宽判据必须当场变红 —— 否则那条判据证明不了任何事。
   * （与 `gaSeparateEnabled` 同一用途，不是给用户调的选项。）
   */
  let gaThickScale = 1;

  /**
   * 粗线：沿点串扫一根圆柱。两点＝直线段，多点＝Catmull-Rom（弧用它，天然光滑）。
   * 不透明、写深度：夹角画在地球**内部**，半透明材质会跟地球前半球再混一次、越混越淡，
   * 而这次要的恰恰是"醒目"。
   */
  function makeThickLine(
    points: THREE.Vector3[],
    color: number,
    radius: number
  ): THREE.Mesh | null {
    // 退化情形（例如选点正好落在赤道 / 本初子午线上，这个角本来就是 0°）不要建管：
    // 零长度曲线的标架算出来是 NaN，会画出满屏乱刺。不画才是对的。
    let span = 0;
    for (let i = 1; i < points.length; i += 1) {
      span = Math.max(span, points[i].distanceTo(points[0]));
    }
    if (span < 1e-4) {
      return null;
    }
    const curve =
      points.length === 2
        ? new THREE.LineCurve3(points[0], points[1])
        : new THREE.CatmullRomCurve3(points);
    return new THREE.Mesh(
      new THREE.TubeGeometry(
        curve,
        Math.max(2, points.length - 1),
        radius * gaThickScale,
        8,
        false
      ),
      new THREE.MeshBasicMaterial({ color })
    );
  }

  function updateGeoAngle(info: MarkerInfo) {
    clearGroup(geoAngleGroup);
    geoLatArcPts = [];
    geoLonArcPts = [];
    geoLatEdges = [];
    geoLonEdges = [];
    geoLatArcEnds = [];
    geoLonArcEnds = [];
    gaLatLabel = null;
    gaLonLabel = null;
    geoAnglePoint = info;
    const latRad = info.lat * DEG;
    const lonRad = info.lon * DEG;
    const p = localFromLatLon(info.lat, info.lon);
    // 赤道面上的水平方向：用纬度 0 的同经度点求，极点上也不会退化
    const flat = localFromLatLon(0, info.lon).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const origin = new THREE.Vector3(0, 0, 0);
    const foot = flat.clone().multiplyScalar(Math.cos(latRad));
    /** 本初子午面与赤道面的交线（+x）：经度角的**起始边**（v1.5.1 补上，原先这条边不存在） */
    const zeroDir = localFromLatLon(0, 0);

    const addTube = (points: THREE.Vector3[], color: number, radius: number) => {
      const mesh = makeThickLine(points, color, radius);
      if (mesh) {
        geoAngleGroup.add(mesh);
      }
    };

    /** 从球心画一条边到 `dir × len`，方向登记进 `bucket`（开发钩子要核对面齐不齐） */
    const radial = (dir: THREE.Vector3, len: number, color: number, bucket: MarkerInfo[]) => {
      const d = dir.clone().normalize();
      addTube([origin.clone(), d.clone().multiplyScalar(len)], color, GA_TUBE_EDGE);
      bucket.push(latLonFromLocal(d));
    };

    // ---- 纬度角：该点的子午面内，赤道面（C→Q）与 地心→该点（C→P）的夹角 ----
    radial(p, EQ_EDGE_R, 0xf2e8d5, geoLatEdges);
    // 赤道面那条边由下面的经度角画出（一条线同时是两个角的边）；
    // 这里只把方向补进纬度角的边表，不重复画线 —— 重复画会在同一位置叠两根管、看着发脏。
    geoLatEdges.push(latLonFromLocal(flat));
    // 垂线 P→Q：把"球面上那个点"落到赤道面上，纬度角才能搬到球心处读
    addTube([p.clone(), foot.clone()], 0x8fd8ff, GA_TUBE_EDGE);

    // ---- 经度角：赤道面内，本初子午面 与 该点所在子午面 的夹角 ----
    radial(zeroDir, EQ_EDGE_R, 0x5fd8ff, geoLonEdges); // 0° 那条边（原先漏画的就是它）
    radial(flat, EQ_EDGE_R, 0x8fd8ff, geoLonEdges); // 该点经线在赤道面上的方向

    // 纬度弧（竖直，位于该点的子午面内）
    for (let i = 0; i <= ARC_SEGMENTS; i += 1) {
      const t = (latRad * i) / ARC_SEGMENTS;
      geoLatArcPts.push(
        flat
          .clone()
          .multiplyScalar(Math.cos(t))
          .addScaledVector(up, Math.sin(t))
          .multiplyScalar(ARC_R_LAT)
      );
    }
    addTube(geoLatArcPts, 0xffd76a, GA_TUBE_ARC);
    geoLatArcEnds = [
      latLonFromLocal(geoLatArcPts[0]),
      latLonFromLocal(geoLatArcPts[geoLatArcPts.length - 1])
    ];

    // 经度弧（水平，位于赤道面内，自本初子午面方向起算）
    for (let i = 0; i <= ARC_SEGMENTS; i += 1) {
      const u = (lonRad * i) / ARC_SEGMENTS;
      geoLonArcPts.push(new THREE.Vector3(Math.cos(u), 0, -Math.sin(u)).multiplyScalar(ARC_R_LON));
    }
    addTube(geoLonArcPts, 0x5fd8ff, GA_TUBE_ARC);
    geoLonArcEnds = [
      latLonFromLocal(geoLonArcPts[0]),
      latLonFromLocal(geoLonArcPts[geoLonArcPts.length - 1])
    ];

    // 角的顶点：两条边都从球心出发，给顶点画个小球，"角"才有个看得见的顶
    // （二维示意图 `GeoAngleDiagram` 里也是这么画的）
    geoAngleGroup.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(GA_TUBE_EDGE * 2.6 * gaThickScale, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xf2e8d5 })
      )
    );

    const addLabel = (text: string, color: string, at: THREE.Vector3) => {
      const sprite = makeLabelSprite(text, color, 34, 0.085);
      sprite.position.copy(at);
      // 夹角弧画在球体内部，会被地球前半面挡住 ⇒ 关掉深度测试，让文字始终读得到
      sprite.material.depthTest = false;
      sprite.material.depthWrite = false;
      // 存下文字：开发钩子据此核对"两条弧各自标的是纬度还是经度"
      sprite.userData.text = text;
      geoAngleGroup.add(sprite);
      return sprite;
    };
    gaLatAnchor.copy(
      flat
        .clone()
        .multiplyScalar(Math.cos(latRad / 2))
        .addScaledVector(up, Math.sin(latRad / 2))
        .multiplyScalar(ARC_R_LAT * 1.22)
    );
    gaLonAnchor
      .set(Math.cos(lonRad / 2), 0, -Math.sin(lonRad / 2))
      .multiplyScalar(ARC_R_LON * 1.5);
    gaLatLabel = addLabel(`纬度 ${Math.abs(info.lat).toFixed(1)}°`, "#ffd76a", gaLatAnchor);
    gaLonLabel = addLabel(`经度 ${Math.abs(info.lon).toFixed(1)}°`, "#5fd8ff", gaLonAnchor);
    updateGeoAngleLabels();
  }

  /* ---- 夹角两标签的**屏幕空间**让位（v1.5.0 修「标签叠字」）----
     两个标签锚在**选点自己的赤道方向**那条射线上（半径 1.12 / 0.93），
     选点自己的「地方时」徽标也在这条射线上（半径 1.50）——
     选点纬度 ≈ 0（纬度弧退化）时三者屏幕上必然挤成一堆。实测最大相交 26.9px，
     而且**只出现在一部分自转角上**（6 个角里 2 个是干净的）：不扫一圈根本看不出来，
     这也是"看一眼截图没糊"不能当判据的原因。
     （注意：触发条件是**低纬度**，不是"经度≈0" —— |lat| 小才有这条公共射线；
       经度只决定那条射线朝哪儿。）

     为什么最后落到"按屏幕像素推开"：
       · 错开**几何锚点**没用 —— 镜头顺着那条射线看时，0.4 个单位的距离投影成 0 像素；
       · 固定沿**相机上方向**错开也只能保证"相对偏移量"，保证不了**上下次序**：
         实测南半球低纬那一组还剩 7.9px —— 徽标本来就落在经度标签下方时，
         把经度标签往下推等于往徽标身上推。
     所以按屏幕盒**自上而下依次下推**：只往下推、不打乱上下次序（否则标签会跳来跳去），
     推的像素数按该标签所在深度的"1 世界单位 = 多少像素"换回世界位移。
     只动标签、不动弧：弧画的仍然是该点真正的经纬度（G4/G5 守着这一点）。 */
  const GA_LABEL_GAP = 6;
  /**
   * 让位总开关：`false` = 退回「标签钉在自己的几何锚点上」的旧行为。
   * 留着它是为了**牙齿测试**：回归里同一个选点、同一圈自转角跑两遍，
   * 关掉必须红、打开必须绿 —— 否则你没法证明那条"不许叠字"的判据真的咬得住
   * （本项目已多次踩过"判据恒真、写了个寂寞"）。
   */
  let gaSeparateEnabled = true;
  const tmpSepUp = new THREE.Vector3();
  const tmpSepQuat = new THREE.Quaternion();

  /** 精灵的屏幕盒（CSS 像素）：中心 + 半宽半高 + 「1 世界单位 = 多少像素」 */
  function screenBoxOf(sprite: THREE.Sprite) {
    const rect = renderer.domElement.getBoundingClientRect();
    const wp = sprite.getWorldPosition(new THREE.Vector3());
    const n = wp.clone().project(camera);
    const dist = Math.max(1e-3, wp.distanceTo(camera.position));
    const k = rect.height / (2 * dist * Math.tan((camera.fov * DEG) / 2));
    return {
      cy: (-n.y * 0.5 + 0.5) * rect.height,
      hh: (sprite.scale.y / 2) * k,
      k
    };
  }

  /**
   * 每帧摆夹角两标签与「地方时」徽标。必须放在 `controls.update()` **之后** ——
   * 让位依赖当帧最终的相机姿态，用上一帧的姿态会慢半拍、拖影时看着在飘。
   */
  function updateGeoAngleLabels() {
    if (!geoAngleGroup.visible) {
      // 演示关掉时把徽标放回原位，否则会停在上一次被推开的落脚点
      if (markerClock && markerLabelAnchor) {
        markerClock.sprite.position.copy(markerLabelAnchor);
      }
      return;
    }
    tmpSepUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    spinGroup.getWorldQuaternion(tmpSepQuat);
    tmpSepUp.applyQuaternion(tmpSepQuat.invert());

    const items: {
      sprite: THREE.Sprite;
      box: { cy: number; hh: number; k: number };
    }[] = [];
    const collect = (sprite: THREE.Sprite | null, anchor: THREE.Vector3 | null) => {
      if (!sprite || !anchor) {
        return;
      }
      sprite.position.copy(anchor);
      items.push({ sprite, box: screenBoxOf(sprite) });
    };
    collect(gaLatLabel, gaLatAnchor);
    collect(gaLonLabel, gaLonAnchor);
    collect(markerClock ? markerClock.sprite : null, markerLabelAnchor);

    if (!gaSeparateEnabled) {
      return;
    }

    items.sort((a, b) => a.box.cy - b.box.cy);
    let cursor = -Infinity;
    for (const item of items) {
      const pushPx = Math.max(0, cursor + GA_LABEL_GAP - (item.box.cy - item.box.hh));
      if (pushPx > 0) {
        item.sprite.position.addScaledVector(tmpSepUp, -pushPx / item.box.k);
        item.box.cy += pushPx;
      }
      cursor = item.box.cy + item.box.hh;
    }
  }

  const axisGroup = new THREE.Group();
  const axisGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -1.5, 0),
    new THREE.Vector3(0, 1.5, 0)
  ]);
  const axisLine = new THREE.Line(
    axisGeometry,
    new THREE.LineDashedMaterial({
      color: COLORS.axis,
      dashSize: 0.09,
      gapSize: 0.055,
      transparent: true,
      opacity: 0.95
    })
  );
  axisLine.computeLineDistances();
  axisGroup.add(axisLine);
  for (const y of [1.5, -1.5]) {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 14, 10),
      new THREE.MeshBasicMaterial({ color: COLORS.poleDot })
    );
    dot.position.y = y;
    axisGroup.add(dot);
  }
  const northLabel = makeLabelSprite("N", "#f2e8d5", 56);
  northLabel.position.set(0, 1.72, 0);
  axisGroup.add(northLabel);
  const southLabel = makeLabelSprite("S", "#f2e8d5", 56);
  southLabel.position.set(0, -1.72, 0);
  axisGroup.add(southLabel);
  tiltGroup.add(axisGroup);

  // ---- 太阳直射带（南北回归线之间的半透明黄色区域） ----
  const zoneGroup = new THREE.Group();
  const zoneBand = new THREE.Mesh(
    new THREE.CylinderGeometry(
      Math.cos(EARTH_TILT * DEG) * 1.014,
      Math.cos(EARTH_TILT * DEG) * 1.014,
      2 * Math.sin(EARTH_TILT * DEG) * 1.014,
      96,
      1,
      true
    ),
    new THREE.MeshBasicMaterial({
      color: COLORS.zone,
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  );
  zoneGroup.add(zoneBand);
  zoneGroup.add(fixedLabelAt(0, 148, "太阳直射带", "#ffd76a", 1.16));
  tiltGroup.add(zoneGroup);

  // ---- 地球标签（只在公转视角显示） ----
  const earthLabel = makeLabelSprite("地球", "#9fe0ff", 44, 1.1);
  earthLabel.position.set(0, 1.55, 0);
  earthAnchor.add(earthLabel);
  registerWorldLabel(earthLabel, 18);

  /* ---- 星空 ---- */
  const starCount = 1400;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const dir = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1
    ).normalize();
    const dist = 150 + Math.random() * 120;
    starPositions[i * 3] = dir.x * dist;
    starPositions[i * 3 + 1] = dir.y * dist;
    starPositions[i * 3 + 2] = dir.z * dist;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  const starsPoints = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({
      color: 0xdfe8ff,
      size: 1.9,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    })
  );
  scene.add(starsPoints);

  /* ---- 太阳（真实表面贴图 + 双层光晕 + 标签） ---- */
  const sunGroup = new THREE.Group();
  const sunTexture = makeSunTexture();
  const sunBall = new THREE.Mesh(
    new THREE.SphereGeometry(SUN_RADIUS, 64, 48),
    new THREE.MeshBasicMaterial({ map: sunTexture })
  );
  sunGroup.add(sunBall);
  const sunGlowInner = makeGlowSprite("rgba(255,246,210,0.95)", "rgba(255,205,95,0.6)", SUN_RADIUS * 2.9);
  sunGroup.add(sunGlowInner);
  const sunGlowOuter = makeGlowSprite("rgba(255,214,120,0.42)", "rgba(255,170,60,0.22)", SUN_RADIUS * 5.2);
  sunGroup.add(sunGlowOuter);
  const sunLabel = makeLabelSprite("太阳", "#ffe08a", 48, 1.5);
  sunLabel.position.set(0, SUN_RADIUS + 1.05, 0);
  sunGroup.add(sunLabel);
  registerWorldLabel(sunLabel, 30);
  scene.add(sunGroup);

  /* ---- 公转轨道：椭圆 + 近日点/远日点 + 二分二至位置 + 日地连线 ---- */
  const orbitGroup = new THREE.Group();
  {
    const segments = 320;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < segments; i++) {
      // 用偏近点角 E 参数化，保证椭圆精确且太阳位于焦点
      const E = (i / segments) * Math.PI * 2;
      const x = ORBIT_A * (Math.cos(E) - ORBIT_E);
      const y = ORBIT_A * Math.sqrt(1 - ORBIT_E * ORBIT_E) * Math.sin(E);
      pts.push(new THREE.Vector3(x, 0, -y));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.2);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 420, 0.055, 8, true),
      new THREE.MeshBasicMaterial({ color: COLORS.orbit, transparent: true, opacity: 0.72 })
    );
    orbitGroup.add(tube);

    // 太阳与地球的连线（体现日地距离随公转变化）
    const radiusGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0)
    ]);
    const radiusLine = new THREE.Line(
      radiusGeometry,
      new THREE.LineDashedMaterial({
        color: 0x8fa6c8,
        dashSize: 0.42,
        gapSize: 0.3,
        transparent: true,
        opacity: 0.55
      })
    );
    radiusLine.computeLineDistances();
    radiusLine.userData.isRadiusLine = true;
    orbitGroup.add(radiusLine);

    // 近/远日点
    const apsis = (
      nu: number,
      label: string,
      color: number,
      outward: number,
      ringColor: number
    ) => {
      const p = orbitPosition(nu);
      const dir = p.clone().normalize();
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.155, 16, 12),
        new THREE.MeshBasicMaterial({ color })
      );
      dot.position.copy(p);
      orbitGroup.add(dot);
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.34, 0.028, 8, 40),
        new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.9 })
      );
      halo.position.copy(p);
      halo.rotation.x = Math.PI / 2;
      orbitGroup.add(halo);
      const sprite = makeLabelSprite(label, `#${ringColor.toString(16).padStart(6, "0")}`, 42, 1.0);
      sprite.position.copy(p).addScaledVector(dir, outward);
      orbitGroup.add(sprite);
      registerWorldLabel(sprite, 30);
    };
    apsis(PERIHELION_NU, "近日点（约1月初）", COLORS.perihelion, 1.5, 0x5fd8ff);
    apsis(APHELION_NU, "远日点（约7月初）", COLORS.aphelion, 1.5, 0x8fa6ff);

    // 二分二至在轨道上的位置（标签向轨道内侧偏移，避免与近/远日点标签重叠）
    for (const season of SEASONS) {
      const p = orbitPosition(season.nu);
      const dir = p.clone().normalize();
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 16, 12),
        new THREE.MeshBasicMaterial({ color: COLORS.season })
      );
      dot.position.copy(p);
      orbitGroup.add(dot);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.28, 0.022, 8, 40),
        new THREE.MeshBasicMaterial({ color: COLORS.season, transparent: true, opacity: 0.7 })
      );
      ring.position.copy(p);
      ring.rotation.x = Math.PI / 2;
      orbitGroup.add(ring);
      const sprite = makeLabelSprite(`${season.label}`, "#ffd76a", 44, 1.15);
      sprite.position.copy(p).addScaledVector(dir, -2.55);
      orbitGroup.add(sprite);
      registerWorldLabel(sprite, 30);
    }
  }
  scene.add(orbitGroup);

  /* ---- 晨昏线（垂直于太阳方向的大圆，随公转位置更新） ---- */
  const terminatorMesh = new THREE.Mesh(
    new THREE.TorusGeometry(1.006, 0.0068, 10, 240),
    new THREE.MeshBasicMaterial({ color: COLORS.terminator })
  );
  envGroup.add(terminatorMesh);
  const terminatorLabel = makeLabelSprite("晨昏线", "#ffd34d");
  envGroup.add(terminatorLabel);

  /* ---- 太阳直射点 ---- */
  const subsolarGroup = new THREE.Group();
  const subsolarDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 16, 12),
    new THREE.MeshBasicMaterial({ color: COLORS.subsolar })
  );
  subsolarGroup.add(subsolarDot);
  const subsolarFace = makeGlowSprite("rgba(255,180,80,0.9)", "rgba(255,150,60,0.42)", 0.5);
  subsolarGroup.add(subsolarFace);
  const subsolarLabelRef = { sprite: makeLabelSprite("太阳直射点", "#ffb46a") };
  subsolarGroup.add(subsolarLabelRef.sprite);
  envGroup.add(subsolarGroup);

  /* ---- 太阳光柱（一根，直径＝地球直径） ----
     一整根从地球射向太阳的半透明直圆柱：加法混合 + 轴向渐隐（近地端最实、太阳端淡出），
     边缘比正对镜头处略亮一点，看起来像一束有体积的光而不是一块平色矩形。
     中间那条（太阳直射光线）仍是橙红实心细柱，作为基准线。 */
  const rayGroup = new THREE.Group();
  const beamMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 48, 1, true),
    new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(COLORS.sunRay) },
        uOpacity: { value: 0.22 }
      },
      vertexShader: `
        varying vec2 vBeamUv;
        varying vec3 vNormalW;
        varying vec3 vPosW;
        void main() {
          vBeamUv = uv;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vPosW = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vBeamUv;
        varying vec3 vNormalW;
        varying vec3 vPosW;
        void main() {
          // uv.y：0 = 地球一端，1 = 太阳一端
          float fade = mix(1.0, 0.10, smoothstep(0.10, 1.0, vBeamUv.y));
          // 近地端再从 0 拉起来一点，让开口处不是一条硬边
          fade *= smoothstep(0.0, 0.022, vBeamUv.y);
          // 掠射角（柱壁边缘）略亮，正对镜头处略淡 → 有体积感
          float rim = 1.0 - abs(dot(normalize(vNormalW), normalize(cameraPosition - vPosW)));
          gl_FragColor = vec4(uColor, uOpacity * fade * mix(0.70, 1.0, rim));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      // 只画远侧壁：光柱半径＝地球半径，在地球特写（镜头距地心仅 3 个地球半径）时，
      // 面向镜头的近侧壁会正好压在地球盘面前方把地表糊掉；只保留背对镜头的远侧壁，
      // 既回避了这个问题，又仍是一层半透明曲面，"光的体积感"不受影响。
      side: THREE.BackSide
    })
  );
  rayGroup.add(beamMesh);

  const coreMaterial = new THREE.MeshBasicMaterial({
    color: COLORS.sunRayCore,
    transparent: true,
    opacity: 0.98,
    depthWrite: false
  });
  const coreMesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), coreMaterial);
  rayGroup.add(coreMesh);
  envGroup.add(rayGroup);

  /* ---- 点击标记 ---- */
  const markerGroup = new THREE.Group();
  spinGroup.add(markerGroup);

  /** 当前标记点的地理坐标（null 表示未标记） */
  let markerLatLon: MarkerInfo | null = null;
  /** 标记点旁的「地方时」浮动标签 */
  let markerClock: { sprite: THREE.Sprite; draw: (text: string) => void } | null = null;
  /** 徽标的几何锚点（半径 1.5 处）：屏幕让位以它为基点，见 updateGeoAngleLabels */
  let markerLabelAnchor: THREE.Vector3 | null = null;

  function clearMarker() {
    markerGroup.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        const material = child.material;
        if (material instanceof THREE.Material) {
          material.dispose();
        }
      } else if (child instanceof THREE.Sprite) {
        disposeSprite(child);
      }
    });
    markerGroup.clear();
    markerClock = null;
    markerLabelAnchor = null;
    markerLatLon = null;
  }

  function placeMarker(lat: number, lon: number) {
    clearMarker();
    markerLatLon = { lat, lon };
    const direction = localFromLatLon(lat, lon);
    const foot = direction.clone().multiplyScalar(1.006);
    const top = direction.clone().multiplyScalar(1.26);

    const pole = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([foot, top]),
      new THREE.LineBasicMaterial({ color: COLORS.markerPole })
    );
    markerGroup.add(pole);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 16, 12),
      new THREE.MeshBasicMaterial({ color: COLORS.markerHead })
    );
    head.position.copy(top);
    markerGroup.add(head);

    const footDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 12, 10),
      new THREE.MeshBasicMaterial({ color: COLORS.markerPole })
    );
    footDot.position.copy(foot);
    markerGroup.add(footDot);

    // 该点的地方时：随自转/公转实时改写
    markerClock = makeDynamicLabel("#ffd76a", 42, 0.1);
    markerLabelAnchor = direction.clone().multiplyScalar(1.5);
    markerClock.sprite.position.copy(markerLabelAnchor);
    markerClock.draw(`地方时 ${formatClock(localHoursAt(lon, subsolarLon))}`);
    markerGroup.add(markerClock.sprite);
  }

  /* ---- 公转状态 ---- */
  let nu = SEASONS[1].nu;
  let declination = declinationForNu(nu);
  let spinWanted = false;
  let rotateWanted = true;
  let spinAngle = 0;
  /** 自转旋钮拖动中：暂时停掉自动自转，避免和手动转动互相打架 */
  let spinDragging = false;
  /** 太阳直射经线（地理经度）：该经线地方时为正午 12:00 */
  let subsolarLon = 0;
  const spinWorldQuat = new THREE.Quaternion();
  const spinWorldQuatInv = new THREE.Quaternion();
  const sunInSpinFrame = new THREE.Vector3();
  const earthPos = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const rayQuat = new THREE.Quaternion();
  const termE1 = new THREE.Vector3();
  const termE2 = new THREE.Vector3();
  const viewState: { current: ViewKey } = { current: "orbit" };
  let onNuChange: ((value: number) => void) | null = null;
  let onViewChange: ((key: ViewKey) => void) | null = null;
  let onSpinChange: ((deg: number) => void) | null = null;
  let onClock: ((payload: ClockPayload) => void) | null = null;

  function radiusLine(): THREE.Line | null {
    const found = orbitGroup.children.find(
      (child) => child.userData.isRadiusLine === true
    );
    return found instanceof THREE.Line ? found : null;
  }

  function updateRadiusLine() {
    const line = radiusLine();
    if (!line) {
      return;
    }
    const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.setXYZ(0, 0, 0, 0);
    attr.setXYZ(1, earthPos.x, earthPos.y, earthPos.z);
    attr.needsUpdate = true;
  }

  /**
   * 反算太阳直射经线：把「地球 → 太阳」方向变换到地球的地理坐标系（贴图所在的自转坐标系），
   * 所得经度就是太阳直射经线。该经线上太阳正当天顶、地方时恰为 12:00，
   * 其余各条经线的地方时都以它为基准 —— 这是第 5 项「点击显示地方时」的计算核心。
   */
  function updateSubsolarLon() {
    // earthAnchor 只有位移没有旋转，故 spinGroup 的世界姿态 = tiltGroup × spinGroup
    spinWorldQuat.copy(tiltGroup.quaternion).multiply(spinGroup.quaternion);
    spinWorldQuatInv.copy(spinWorldQuat).invert();
    sunInSpinFrame.copy(sunDir).applyQuaternion(spinWorldQuatInv);
    subsolarLon = Math.atan2(-sunInSpinFrame.z, sunInSpinFrame.x) / DEG;
  }

  function updateRays() {
    // uStart：太阳那一端（留出半个太阳半径，别插进太阳里）
    const uStart = Math.max(1.3, earthPos.length() - SUN_RADIUS * 0.5);
    // uEnd = 0：近地端落在过地心、垂直于日地连线的那个平面 ——
    // 此时半径为 1 的开口圆环正好就是地球的轮廓，光柱像是从地球里长出来的
    const length = Math.max(0.1, uStart);
    rayQuat.setFromUnitVectors(RAY_AXIS, sunDir);
    const mid = uStart / 2;
    beamMesh.position.copy(sunDir).multiplyScalar(mid);
    beamMesh.quaternion.copy(rayQuat);
    beamMesh.scale.set(BEAM_RADIUS, length, BEAM_RADIUS);
    coreMesh.position.copy(beamMesh.position);
    coreMesh.quaternion.copy(rayQuat);
    coreMesh.scale.set(CORE_RADIUS, length, CORE_RADIUS);
  }

  /** 太阳直射点标签：沿日地连线外推的距离，以及在屏幕上「让开直射光线」的下移量（世界单位） */
  const SUBSOLAR_LABEL_DIST = 1.32;
  const SUBSOLAR_LABEL_DROP = 0.34;

  const tmpCamUp = new THREE.Vector3();
  const tmpDropDir = new THREE.Vector3();
  /** 特写视角下镜头跟随地球的位移量 */
  const tmpFollow = new THREE.Vector3();
  /** 极地俯视用的「上方向」临时量 */
  const tmpPoleUp = new THREE.Vector3();

  /**
   * 摆放「太阳直射点 xx°N」标签。
   * 中心那条太阳直射光线正好沿 sunDir 方向、与地球中心同高，标签若直接放在 sunDir 上会被光线穿过；
   * 这里把标签从光线下方让开：让开方向取「相机上方向在垂直于 sunDir 平面内的投影」的相反方向。
   * 之所以用相机上方向而不是世界竖直方向——特写视角的相机会随地球姿态（季节）略转，
   * 世界竖直方向在屏幕上的投影随之改变，会导致有的季节标签被地球边缘切掉；用相机基向量则各季节表现一致。
   */
  function updateSubsolarLabelPosition() {
    const label = subsolarLabelRef.sprite;
    tmpCamUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    tmpDropDir.copy(tmpCamUp).addScaledVector(sunDir, -tmpCamUp.dot(sunDir));
    if (tmpDropDir.lengthSq() < 1e-6) {
      // 相机上方向与光线几乎平行（如正俯视），退化时直接用世界竖直方向
      tmpDropDir.set(0, -1, 0);
    } else {
      tmpDropDir.normalize().multiplyScalar(-1);
    }
    label.position
      .copy(sunDir)
      .multiplyScalar(SUBSOLAR_LABEL_DIST)
      .addScaledVector(tmpDropDir, SUBSOLAR_LABEL_DROP);
  }

  /** 公转位置更新：地球定位 + 地轴姿态 + 太阳方向 + 晨昏线/直射点/光线 */
  function setOrbitNu(value: number) {
    // 先记下旧位置：特写视角下要靠这个位移把镜头一起平移（见函数末尾）
    const prevX = earthPos.x;
    const prevY = earthPos.y;
    const prevZ = earthPos.z;
    nu = ((value % 360) + 360) % 360;
    orbitPosition(nu, earthPos);
    earthAnchor.position.copy(earthPos);

    // 太阳方向（地球 → 太阳）
    sunDir.copy(earthPos).multiplyScalar(-1).normalize();

    // 地轴指向空间固定方向 axisWorld（四季成因）。
    // tiltGroup 只承担姿态，不再"模拟"自转——真实的连续自转由 spinGroup 承担，
    // 这样贴图会真的转动，地球特写视角下能看到白天/黑夜在球面上滚过。
    // 垂直档（需求③）下 axisWorld 是世界 +Y：太阳方向永远落在轨道面上、与地轴垂直
    // ⇒ 直射点纬度恒为 0、全球终年昼夜平分、没有极昼极夜，也就没有四季。
    tiltGroup.quaternion.setFromUnitVectors(WORLD_UP, axisWorld);

    declination = Math.asin(THREE.MathUtils.clamp(sunDir.dot(axisWorld), -1, 1)) / DEG;

    // 昼夜着色器
    earthMaterial.uniforms.uSunDir.value.copy(sunDir);

    // 晨昏线
    terminatorMesh.quaternion.setFromUnitVectors(SUN_AXIS_Z, sunDir);
    const camDir = tmpV.copy(camera.position).sub(earthPos).normalize();
    if (camDir.lengthSq() < 1e-6) {
      camDir.set(0, 0, 1);
    }
    termE1
      .crossVectors(sunDir, Math.abs(sunDir.y) < 0.9 ? WORLD_UP : new THREE.Vector3(1, 0, 0))
      .normalize();
    termE2.crossVectors(sunDir, termE1).normalize();
    let bestTheta = 0;
    let bestDot = -Infinity;
    for (let i = 0; i < 96; i++) {
      const theta = (i / 96) * Math.PI * 2;
      const p = termE1
        .clone()
        .multiplyScalar(Math.cos(theta))
        .addScaledVector(termE2, Math.sin(theta));
      const score = p.dot(camDir);
      if (score > bestDot) {
        bestDot = score;
        bestTheta = theta;
      }
    }
    terminatorLabel.position
      .copy(termE1)
      .multiplyScalar(Math.cos(bestTheta))
      .addScaledVector(termE2, Math.sin(bestTheta))
      .multiplyScalar(1.14);

    // 太阳直射点
    subsolarDot.position.copy(sunDir).multiplyScalar(1.008);
    subsolarFace.position.copy(sunDir).multiplyScalar(1.05);
    const declText =
      Math.abs(declination) < 0.05
        ? "0°（赤道）"
        : `${Math.abs(declination).toFixed(1)}°${declination > 0 ? "N" : "S"}`;
    const oldLabel = subsolarLabelRef.sprite;
    subsolarGroup.remove(oldLabel);
    disposeSprite(oldLabel);
    const label = makeLabelSprite(`太阳直射点 ${declText}`, "#ffb46a");
    subsolarLabelRef.sprite = label;
    updateSubsolarLabelPosition();
    subsolarGroup.add(label);

    // 平行光线 + 日地连线
    updateRays();
    updateRadiusLine();

    // 特写视角：镜头跟着地球平移同样的位移，保持用户当前的观察方向与距离。
    // 这里刻意不调用 applyEarthView()——那会把镜头重置到固定机位（sunDir 的侧向），
    // 一转公转旋钮地球就"跳"回原位，体验上和自转旋钮不一致。
    // 只要相机与 target 同步平移，地球在画面里的位置与大小就完全不变，
    // 变的只有光照（太阳直射点纬度、晨昏线倾角），这正是要看的东西。
    if (isEarthLocked()) {
      tmpFollow.set(earthPos.x - prevX, earthPos.y - prevY, earthPos.z - prevZ);
      camera.position.add(tmpFollow);
      controls.target.add(tmpFollow);
    }
  }

  /* ---- 视角预设 ---- */
  /** 镜头是否锁定在地球上（地球特写），用于公转时同步平移相机 */
  function isEarthLocked() {
    return viewState.current === "earth";
  }

  /**
   * 自由视角的开关：只改 OrbitControls 的「允许做什么」，不动相机本身。
   *  - `enablePan`：唯一的解锁项。OrbitControls 的平移会把 camera 与 target **同量**搬走，
   *    于是 target 可以离开太阳与地球；之后左键旋转、滚轮推近都绕着这个新 target 发生，
   *    也就是「在太空里任意移动」，而不是「绕着太阳/地球放大缩小」。
   *    这里刻意不自己写 WASD/滚轮飞行：沿视线前进与 dolly 在数学上是同一件事
   *    （都是 camera 沿 target→camera 轴移动，target 不动），自己写只会多出一份
   *    与 `controls.update()` 抢状态的代码。
   *  - 距离上下限放宽：默认 1.4~62 是为「看太阳系」定的；自由视角下要能贴近地表也能退到
   *    星空外，放宽到 0.5~170（`camera.far` 是 400，不会裁掉）。
   */
  function setFreeRoam(on: boolean) {
    controls.enablePan = on;
    controls.screenSpacePanning = true;
    controls.minDistance = on ? 0.5 : 1.4;
    controls.maxDistance = on ? 170 : 62;
  }

  function applyOrbitView() {
    viewState.current = "orbit";
    setFreeRoam(false);
    camera.up.copy(WORLD_UP);
    controls.target.set(0, 0, 0);
    const d = ORBIT_A * 2.65;
    camera.position.set(d * 0.12, d * 0.66, d * 0.74);
    controls.update();
    onViewChange?.("orbit");
  }

  function applyTopView() {
    viewState.current = "top";
    setFreeRoam(false);
    camera.up.copy(WORLD_UP);
    controls.target.set(0, 0, 0);
    camera.position.set(0.0016, ORBIT_A * 2.95, 0.0016);
    controls.update();
    onViewChange?.("top");
  }

  function applyEarthView() {
    viewState.current = "earth";
    setFreeRoam(false);
    camera.up.copy(WORLD_UP);
    controls.target.copy(earthPos);
    // 镜头放在 sunDir 的侧向：视线垂直于太阳方向，晨昏线纵贯画面中央。
    // 这样地球自转时，画面里能直接看到"白天 → 黑夜"的滚动；
    // 地轴倾斜导致极昼/极夜区域也正好出现在画面上下的对应一侧。
    const up = Math.abs(sunDir.y) > 0.94 ? new THREE.Vector3(1, 0, 0) : WORLD_UP;
    const side = new THREE.Vector3().crossVectors(sunDir, up).normalize();
    camera.position.copy(earthPos).addScaledVector(side, 3.0);
    controls.update();
    onViewChange?.("earth");
  }

  /**
   * 自由视角：**不动相机**，只解锁平移 —— 当前看的是地球特写就从地球开始挪，
   * 看的是公转全景就从太阳开始挪，不会因为切视角把镜头弹到别处。
   * 自动旋转在这里必须关掉：它绕 target 匀速转，会让「停在某处观察」做不到。
   */
  function applyFreeView() {
    viewState.current = "free";
    setFreeRoam(true);
    engine.autoRotateWanted = false;
    controls.autoRotate = false;
    controls.update();
    onViewChange?.("free");
  }

  /* ---- 极地俯视子图（左下角两个独立小画布，不动主视图相机） ----
     北极朝下看 = 相机在地轴正方向往球心看；南极朝上看反之。
     子图与主图共用同一个 scene：图层开关、昼夜、自转全都实时同步，
     只是各自用一台独立相机 + 一块独立的小 WebGL 画布。 */
  const POLE_VIEW_SIZE = 128;
  const POLE_VIEW_DIST = 3.2;
  const poleViews: {
    pole: "north" | "south";
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    host: HTMLDivElement;
  }[] = [];
  /** 渲染子图前临时藏起来的文字标签（沿轴看时它们会全挤到圆心附近叠成一团） */
  const poleHiddenSprites: { sprite: THREE.Sprite; was: boolean }[] = [];

  function attachPoleView(pole: "north" | "south", host: HTMLDivElement) {
    const existed = poleViews.findIndex((p) => p.pole === pole);
    if (existed >= 0) {
      if (poleViews[existed].host === host) {
        return;
      }
      disposePoleView(existed);
    }
    const pr = new THREE.WebGLRenderer({ antialias: true });
    // 小图不追求分辨率：pixelRatio 固定 1，软渲染（SwiftShader）验证时也省算力
    pr.setPixelRatio(1);
    pr.setSize(POLE_VIEW_SIZE, POLE_VIEW_SIZE);
    const pc = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    host.appendChild(pr.domElement);
    poleViews.push({ pole, renderer: pr, camera: pc, host });
  }

  function disposePoleView(index: number) {
    const pv = poleViews[index];
    pv.renderer.dispose();
    pv.renderer.domElement.remove();
    poleViews.splice(index, 1);
  }

  function detachPoleViews() {
    while (poleViews.length > 0) {
      disposePoleView(0);
    }
  }

  /** 把两个子图各自渲染一帧：藏标签 → 沿轴取景 → 渲染 → 还原标签可见性 */
  function renderPoleViews() {
    for (const pv of poleViews) {
      if (!pv.host.isConnected) {
        continue;
      }
      // 与地轴垂直的「上」参考：把世界 +Z 投影到地轴垂面（退化时改用 +X），
      // 否则视线（沿地轴）与 camera.up 平行，取景会翻滚不定
      tmpPoleUp.set(0, 0, 1).addScaledVector(axisWorld, -axisWorld.z);
      if (tmpPoleUp.lengthSq() < 1e-6) {
        tmpPoleUp.set(1, 0, 0).addScaledVector(axisWorld, -axisWorld.x);
      }
      pv.camera.up.copy(tmpPoleUp.normalize());
      pv.camera.position
        .copy(earthPos)
        .addScaledVector(axisWorld, pv.pole === "north" ? POLE_VIEW_DIST : -POLE_VIEW_DIST);
      pv.camera.lookAt(earthPos);
      pv.camera.updateProjectionMatrix();

      poleHiddenSprites.length = 0;
      scene.traverse((obj) => {
        const sprite = obj as THREE.Sprite;
        if (sprite.isSprite) {
          poleHiddenSprites.push({ sprite, was: sprite.visible });
          sprite.visible = false;
        }
      });
      pv.renderer.render(scene, pv.camera);
      for (const item of poleHiddenSprites) {
        item.sprite.visible = item.was;
      }
    }
  }

  function readPoleViews() {
    return poleViews.map((pv) => {
      const rect = pv.renderer.domElement.getBoundingClientRect();
      return {
        pole: pv.pole,
        rect: {
          x: +rect.x.toFixed(1),
          y: +rect.y.toFixed(1),
          w: +rect.width.toFixed(1),
          h: +rect.height.toFixed(1)
        },
        triangles: pv.renderer.info.render.triangles
      };
    });
  }

  /** 开发自检：太阳光柱的形态（半径/直径/透明度/混合模式/长度）+ 屏幕取样点 */
  function readRays() {    const rect = renderer.domElement.getBoundingClientRect();
    const proj = (v: THREE.Vector3) => {
      const p = v.clone().project(camera);
      return {
        x: +((p.x * 0.5 + 0.5) * rect.width).toFixed(1),
        y: +((-p.y * 0.5 + 0.5) * rect.height).toFixed(1)
      };
    };
    const beamMat = beamMesh.material as THREE.ShaderMaterial;
    // 近地端开口圆环的上下两点：垂直于日地连线的一个方向
    const upRef = new THREE.Vector3(0, 1, 0);
    if (Math.abs(sunDir.dot(upRef)) > 0.94) upRef.set(1, 0, 0);
    const perpUp = upRef.clone().addScaledVector(sunDir, -upRef.dot(sunDir)).normalize();
    const nearCenter = earthPos.clone(); // u=0：过地心、垂直于日地连线的平面
    const sample = (mesh: THREE.Mesh, name: string, radius: number) => {
      mesh.updateMatrixWorld();
      const mid = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
      const half = mesh.scale.y / 2;
      return {
        name,
        mid: proj(mid),
        earthEnd: proj(mid.clone().addScaledVector(sunDir, -half)),
        sunEnd: proj(mid.clone().addScaledVector(sunDir, half)),
        rimTop: proj(nearCenter.clone().addScaledVector(perpUp, radius)),
        rimBottom: proj(nearCenter.clone().addScaledVector(perpUp, -radius))
      };
    };
    return {
      count: rayGroup.children.length,
      visible: rayGroup.visible,
      beamRadius: BEAM_RADIUS,
      beamDiameter: BEAM_RADIUS * 2,
      earthRadius: 1,
      coreRadius: CORE_RADIUS,
      beamOpacity: +beamMat.uniforms.uOpacity.value.toFixed(3),
      beamAdditive: beamMat.blending === THREE.AdditiveBlending,
      beamMaterialType: beamMat.type,
      coreMaterialType: (coreMesh.material as THREE.Material).type,
      beamLength: +beamMesh.scale.y.toFixed(3),
      samples: [sample(beamMesh, "beam", BEAM_RADIUS), sample(coreMesh, "core", CORE_RADIUS)]
    };
  }

  /**
   * 开发自检：渲染一帧后立刻从帧缓冲读像素。
   * 之所以不抓窗口截图：软渲染下抓图可能落在"画了一半"的帧上，
   * 同帧两次截图的差异都能有数十万像素，开关对比会被噪声淹没。
   * 这里 render + readPixels 在同一个任务内完成，读到的一定是完整一帧。
   */
  function samplePixels(pts: { x: number; y: number }[]) {
    const t0 = performance.now();
    renderer.render(scene, camera);
    const renderMs = +(performance.now() - t0).toFixed(1);
    const gl = renderer.getContext();
    const dpr = renderer.getPixelRatio();
    const wpx = renderer.domElement.width;
    const hpx = renderer.domElement.height;
    const buf = new Uint8Array(4);
    const pixels = pts.map((p) => {
      const bx = Math.max(0, Math.min(wpx - 1, Math.round(p.x * dpr)));
      const by = Math.max(0, Math.min(hpx - 1, Math.round(p.y * dpr)));
      gl.readPixels(bx, hpx - 1 - by, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return { r: buf[0], g: buf[1], b: buf[2] };
    });
    return { pixels, renderMs };
  }

  applyOrbitView();

  /* ---- 渲染循环 ---- */
  let raf = 0;
  let lastTime = performance.now();
  let lastNotify = 0;
  function animate() {
    raf = requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.12);
    lastTime = now;

    if (spinWanted) {
      setOrbitNu(nu + dt * SPIN_SPEED);
    }

    // 地球自转：始终围绕地轴（tiltGroup 本地 Y 轴）连续旋转，
    // 不论是否在公转演示中。这样画面里能持续看到白天/黑夜的滚动。
    // 自转旋钮拖动期间暂停自动推进，松手后自动接着转。
    if (rotateWanted && !spinDragging) {
      spinAngle += dt * ROTATION_SPEED;
      spinGroup.rotation.y = spinAngle * DEG;
    }

    // 太阳直射经线：地方时的基准，每帧重算
    updateSubsolarLon();

    // 节流回传（约 7 次/秒）：自转角、直射经线、标记点地方时。
    // 用节流而不是每帧 setState，避免高频重渲染拖慢 WebGL 场景。
    if (now - lastNotify > 140) {
      lastNotify = now;
      const spinDeg = ((spinAngle % 360) + 360) % 360;
      const markerHours = markerLatLon
        ? localHoursAt(markerLatLon.lon, subsolarLon)
        : null;
      if (spinWanted) {
        onNuChange?.(nu);
      }
      onSpinChange?.(spinDeg);
      if (markerClock && markerHours !== null) {
        markerClock.draw(`地方时 ${formatClock(markerHours)}`);
      }
      onClock?.({ spinAngle: spinDeg, subsolarLon, markerHours });
    }

    // 世界标签按距离缩放，保持屏幕尺寸基本恒定
    for (const item of worldLabels) {
      item.sprite.getWorldPosition(tmpV2);
      const d = tmpV2.distanceTo(camera.position);
      const f = THREE.MathUtils.clamp(d / item.refDist, 0.42, 3.2);
      item.sprite.scale.set(item.base.x * f, item.base.y * f, 1);
    }

    controls.update();
    // 相机姿态可能刚被改变（切换视角/自动旋转），逐帧重算直射点标签的让位方向
    updateSubsolarLabelPosition();
    // 夹角两标签的让位方向同样依赖当帧相机姿态（见 updateGeoAngleLabels 的注释）
    updateGeoAngleLabels();
    // 五带文字标注：必须放在 controls.update() 之后——它依赖当帧最终的相机姿态，
    // 用来把标签摆到球面轮廓内最靠左的位置（避让中央的晨昏线与直射点标签）。
    updateZoneLabels();
    // 纬线标签（赤道 / 回归线 / 极圈）：同样依赖当帧最终相机姿态
    updateParallelLabels();
    renderer.render(scene, camera);
    // 极地俯视子图（挂在左下角面板里）：面板收起时 poleViews 为空，零开销
    renderPoleViews();
  }
  animate();

  const resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) {
      return;
    }
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  resizeObserver.observe(container);

  function dispose() {
    cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    controls.dispose();
    clearMarker();
    disposeSprite(terminatorLabel);
    disposeSprite(sunLabel);
    disposeSprite(subsolarLabelRef.sprite);
    for (const item of worldLabels) {
      disposeSprite(item.sprite);
    }
    worldLabels.length = 0;
    sunTexture.dispose();
    scene.traverse((child) => {
      if (
        child instanceof THREE.Mesh ||
        child instanceof THREE.Line ||
        child instanceof THREE.Points
      ) {
        child.geometry.dispose();
        const material = (child as THREE.Mesh).material;
        if (material instanceof THREE.Material) {
          const map = (material as THREE.MeshBasicMaterial).map;
          if (map && map !== sunTexture) {
            map.dispose();
          }
          material.dispose();
        }
      }
    });
    earthTexture?.dispose();
    nightTexture?.dispose();
    earthMaterial.dispose();
    overlayMaterial.dispose();
    detachPoleViews();
    renderer.dispose();
    if (renderer.domElement.parentElement === container) {
      container.removeChild(renderer.domElement);
    }
  }

  /* ---- 地表素材：卫星影像 / 双色底图 / 纯白，三选一 ---- */
  let earthTexture: THREE.Texture | null = null;
  let baseTexture: THREE.Texture | null = null;
  let nightTexture: THREE.Texture | null = null;
  const surfaceState = { texture: true, baseMap: false, white: false };
  function applySurface(): void {
    // 三种素材各自判断"开了而且贴图已加载"。贴图是异步到的，所以每次到达都要重跑本函数。
    const hasTex = surfaceState.texture && earthTexture ? 1 : 0;
    const hasBase = surfaceState.baseMap && baseTexture ? 1 : 0;
    earthMaterial.uniforms.uHasTex.value = hasTex;
    earthMaterial.uniforms.dayMap.value = hasTex ? earthTexture : null;
    earthMaterial.uniforms.uHasBase.value = hasBase;
    earthMaterial.uniforms.baseMap.value = hasBase ? baseTexture : null;
    earthMaterial.uniforms.uBase.value = surfaceState.baseMap ? 1 : 0;
    earthMaterial.uniforms.uWhite.value = surfaceState.white ? 1 : 0;
    // 夜间灯光贴图与「素材三选一」无关：纯白模式下着色器会主动忽略它，
    // 这里始终把已加载的贴图挂上去，开关由 uNight 控制。
    earthMaterial.uniforms.uHasNight.value = nightTexture ? 1 : 0;
    earthMaterial.uniforms.nightMap.value = nightTexture ?? null;
  }

  const engine: Engine = {
    renderer,
    scene,
    camera,
    controls,
    earthAnchor,
    tiltGroup,
    earthMesh,
    earthMaterial,
    overlayMaterial,
    gridGroup,
    equatorGroup,
    tropicsGroup,
    polarGroup,
    meridianGroup,
    axisGroup,
    starsPoints,
    markerGroup,
    terminatorMesh,
    terminatorLabel,
    sunGroup,
    subsolarGroup,
    zoneGroup,
    rayGroup,
    orbitGroup,
    earthLabel,
    earthTexture: null,
    baseTexture: null,
    nightTexture: null,
    autoRotateWanted: true,
    setOrbitNu,
    setSpinAngle: (deg: number) => {
      spinAngle = deg;
      spinGroup.rotation.y = spinAngle * DEG;
      updateSubsolarLon();
    },
    readSpinAngle: () => ((spinAngle % 360) + 360) % 360,
    setSpinDragging: (active: boolean) => {
      spinDragging = active;
    },
    applySurface: (options: { texture: boolean; baseMap: boolean; white: boolean }) => {
      surfaceState.texture = options.texture;
      surfaceState.baseMap = options.baseMap;
      surfaceState.white = options.white;
      applySurface();
    },
    setAxisMode: (mode: AxisMode) => {
      if (mode === axisMode) {
        return;
      }
      axisMode = mode;
      axisWorld = axisWorldFor(mode);
      // 地轴换了方向，必须重跑一遍姿态与光照，否则画面要等下一次 setOrbitNu 才更新。
      // 传当前 nu 而不是别的位置：这一档只改"怎么歪"，不该顺带把公转位置挪走。
      setOrbitNu(nu);
    },
    setGridStep: (stepDeg: number) => {
      if (stepDeg === gridStepDeg) {
        return;
      }
      buildGraticule(stepDeg);
      // 重建后新线的可见性要跟上当前开关（gridGroup.visible 由 React 侧设，但新加的
      // 子节点继承的是父组的 visible，所以这里无需逐个处理）
    },
    readGridStep: () => gridStepDeg,
    readGeoAngle: () => {
      /** 点串两端的**方向夹角**（度）：弧画的度数对不对，只跟方向有关、与半径无关 */
      const span = (pts: THREE.Vector3[]): number => {
        if (pts.length < 2) {
          return -1;
        }
        const a = pts[0].clone().normalize();
        const b = pts[pts.length - 1].clone().normalize();
        return Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)) / DEG;
      };
      const dirs = (list: MarkerInfo[]) =>
        list.map((e) => ({ lat: +e.lat.toFixed(3), lon: +e.lon.toFixed(3) }));
      return {
        visible: geoAngleGroup.visible,
        lat: geoAnglePoint.lat,
        lon: geoAnglePoint.lon,
        latArcDeg: span(geoLatArcPts),
        lonArcDeg: span(geoLonArcPts),
        parts: geoAngleGroup.children.filter(
          (c) => c instanceof THREE.Mesh || c instanceof THREE.Line
        ).length,
        latEdges: dirs(geoLatEdges),
        lonEdges: dirs(geoLonEdges),
        latArcEnds: dirs(geoLatArcEnds),
        lonArcEnds: dirs(geoLonArcEnds),
        labels: geoAngleGroup.children
          .filter((c): c is THREE.Sprite => c instanceof THREE.Sprite)
          .map((c) => String((c.userData as { text?: string }).text ?? ""))
      };
    },
    readAxis: () => [axisWorld.x, axisWorld.y, axisWorld.z],
    setBackground: (white: boolean) => {
      scene.background = new THREE.Color(white ? BG_WHITE : BG_SPACE);
    },
    setTransparent: (on: boolean) => {
      earthMaterial.uniforms.uGhost.value = on ? 1 : 0;
      // 透明档必须停止写深度：否则背半球的经纬线仍被地球挡住，"透过去看"就无从谈起。
      // 不透明档恢复写深度，遮挡关系与以前完全一致。
      earthMaterial.depthWrite = !on;
      earthMaterial.needsUpdate = true;
    },
    setGeoAngle: (on: boolean, info: MarkerInfo) => {
      geoAngleGroup.visible = on;
      if (on) {
        updateGeoAngle(info);
      }
    },
    /** 开发自检：关掉夹角标签的屏幕让位 ⇒ 退回旧行为，用来做「判据咬得住吗」的牙齿测试 */
    setLabelSeparate: (on: boolean) => {
      gaSeparateEnabled = on;
      updateGeoAngleLabels();
    },
    /**
     * 开发自检：改夹角线粗细。牙齿测试用 —— 先量「细」再量「粗」，
     * 同一次运行内就能证明"线宽判据"确实咬得住（而不是恒真的空判据）。
     */
    setAngleThickness: (scale: number) => {
      gaThickScale = scale;
      if (geoAngleGroup.visible) {
        updateGeoAngle(geoAnglePoint);
      }
    },
    readGeoArcScreen: () => {
      const rect = renderer.domElement.getBoundingClientRect();
      // 组的世界矩阵平时由渲染循环刷新；这个钩子可能被单独调用，先自己刷一遍父链
      geoAngleGroup.updateWorldMatrix(true, false);
      const project = (pts: THREE.Vector3[]) =>
        pts.map((p) => {
          const n = geoAngleGroup.localToWorld(p.clone()).project(camera);
          return {
            x: (n.x * 0.5 + 0.5) * rect.width,
            y: (-n.y * 0.5 + 0.5) * rect.height
          };
        });
      return { lat: project(geoLatArcPts), lon: project(geoLonArcPts) };
    },
    readDeclination: () => declination,
    readNu: () => nu,
    readSubsolarLon: () => subsolarLon,
    setView: (key: ViewKey) => {
      if (key === "orbit") {
        applyOrbitView();
      } else if (key === "top") {
        applyTopView();
      } else if (key === "free") {
        applyFreeView();
      } else {
        applyEarthView();
      }
    },
    attachPoleView,
    detachPoleViews,
    readPoleViews,
    readRays,
    samplePixels,
    setSpin: (on: boolean) => {
      spinWanted = on;
    },
    setRotate: (on: boolean) => {
      rotateWanted = on;
    },
    readGeometry: () => {
      const inv = tiltGroup.quaternion.clone().invert();
      const camDirW = camera.position.clone().sub(earthPos).normalize();
      const camLocal = camDirW.clone().applyQuaternion(inv).normalize();
      const sunLocal = sunDir.clone().applyQuaternion(inv).normalize();
      const lonOf = (v: THREE.Vector3) => Math.atan2(-v.z, v.x) / DEG;
      const latOf = (v: THREE.Vector3) =>
        Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) / DEG;
      return {
        camLat: latOf(camLocal),
        camLon: lonOf(camLocal),
        sunLat: latOf(sunLocal),
        sunLon: lonOf(sunLocal),
        angle:
          Math.acos(THREE.MathUtils.clamp(camDirW.dot(sunDir), -1, 1)) / DEG,
        view: viewState.current
      };
    },
    /** 开发自检：直射点标签在画布上的像素包围盒（CSS 像素，与截图坐标一致） */
    readSubsolarLabelBox: () => {
      const label = subsolarLabelRef.sprite;
      const wpos = new THREE.Vector3();
      label.getWorldPosition(wpos);
      const rect = renderer.domElement.getBoundingClientRect();
      const toPx = (v: THREE.Vector3) => {
        const n = v.clone().project(camera);
        return {
          x: (n.x * 0.5 + 0.5) * rect.width,
          y: (-n.y * 0.5 + 0.5) * rect.height
        };
      };
      const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const halfW = label.scale.x / 2;
      const halfH = label.scale.y / 2;
      const a = toPx(wpos.clone().addScaledVector(camRight, -halfW));
      const b = toPx(wpos.clone().addScaledVector(camRight, halfW));
      const c = toPx(wpos.clone().addScaledVector(camUp, -halfH));
      const d = toPx(wpos.clone().addScaledVector(camUp, halfH));
      return {
        text: (label.material.map as THREE.CanvasTexture | null) ? "sprite" : "none",
        x0: Math.min(a.x, b.x),
        x1: Math.max(a.x, b.x),
        y0: Math.min(c.y, d.y),
        y1: Math.max(c.y, d.y),
        center: toPx(wpos),
        rayPoint: toPx(earthPos.clone().add(sunDir))
      };
    },
    /**
     * 开发自检：夹角两标签 +「地方时」徽标在画布上的像素包围盒（CSS 像素）。
     *
     * 为什么要它：这三个标签都钉在**本初子午线正方向**这条射线上
     * （半径 0.93 / 1.12 / 1.50），选点经度 ≈ 0 时屏幕上必然挤成一堆 ——
     * 而这正是教学上最自然的例子（赤道 × 本初子午线）。
     * 判"叠没叠"只能看**屏幕像素**：世界坐标差 0.2 个单位，镜头一斜可能只差几像素，
     * 也可能差出 100 像素（取决于那条射线与视线的夹角）。
     *
     * 盒子按 sprite 的 scale 算（沿相机右/上方向取半宽半高再投影）——
     * 比文字实际占地略大（贴图四周有留白），所以"盒子不重叠"是**保守**结论：
     * 盒子都错开了，文字一定错得开。
     */
    readGeoLabelBoxes: () => {
      const rect = renderer.domElement.getBoundingClientRect();
      const toPx = (v: THREE.Vector3) => {
        const n = v.clone().project(camera);
        return {
          x: (n.x * 0.5 + 0.5) * rect.width,
          y: (-n.y * 0.5 + 0.5) * rect.height
        };
      };
      const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const boxOf = (sprite: THREE.Sprite | null, tag: string) => {
        if (!sprite) {
          return null;
        }
        const wp = sprite.getWorldPosition(new THREE.Vector3());
        const hw = sprite.scale.x / 2;
        const hh = sprite.scale.y / 2;
        const a = toPx(wp.clone().addScaledVector(camRight, -hw));
        const b = toPx(wp.clone().addScaledVector(camRight, hw));
        const c = toPx(wp.clone().addScaledVector(camUp, -hh));
        const d = toPx(wp.clone().addScaledVector(camUp, hh));
        return {
          tag,
          text: String((sprite.userData as { text?: string }).text ?? ""),
          // 只在**夹角演示开着**并且这个精灵本身可见时才算数
          visible: sprite.visible && geoAngleGroup.visible,
          x0: Math.min(a.x, b.x),
          x1: Math.max(a.x, b.x),
          y0: Math.min(c.y, d.y),
          y1: Math.max(c.y, d.y),
          cx: (a.x + b.x) / 2,
          cy: (c.y + d.y) / 2
        };
      };
      // 徽标的文字是每帧重绘的，userData.text 由 makeDynamicLabel 的 draw 之外单独记
      const clockSprite = markerClock ? markerClock.sprite : null;
      if (clockSprite) {
        clockSprite.userData.text = `地方时 ${formatClock(
          markerLatLon ? localHoursAt(markerLatLon.lon, subsolarLon) : 12
        )}`;
      }
      return [
        boxOf(gaLatLabel, "lat"),
        boxOf(gaLonLabel, "lon"),
        boxOf(clockSprite, "clock")
      ].filter((b) => b !== null);
    },
    onNuChange: null,
    onViewChange: null,
    onSpinChange: null,
    onClock: null,
    dispose,
    placeMarker,
    clearMarker,
    readMarkerDebug: () => {
      const rect = renderer.domElement.getBoundingClientRect();
      const toScreen = (v: THREE.Vector3) => {
        const n = v.clone().project(camera);
        return {
          x: +((n.x * 0.5 + 0.5) * rect.width).toFixed(1),
          y: +((-n.y * 0.5 + 0.5) * rect.height).toFixed(1)
        };
      };
      const head = markerGroup.children[0];
      const wp = new THREE.Vector3();
      if (head) {
        head.getWorldPosition(wp);
      }
      return {
        children: markerGroup.children.length,
        worldPos: [+wp.x.toFixed(3), +wp.y.toFixed(3), +wp.z.toFixed(3)],
        screen: toScreen(wp),
        earthScreen: toScreen(earthPos),
        latLon: markerLatLon ? { ...markerLatLon } : null
      };
    },
    readVisibility: () => ({
      grid: gridGroup.visible,
      equator: equatorGroup.visible,
      climate: overlayMaterial.uniforms.uClimate.value === 1,
      timezone: overlayMaterial.uniforms.uTz.value === 1,
      white: earthMaterial.uniforms.uWhite.value === 1,
      hasTex: earthMaterial.uniforms.uHasTex.value === 1,
      nightLights: earthMaterial.uniforms.uNight.value === 1,
      nightOff: earthMaterial.uniforms.uNoNight.value === 1,
      hasNight: earthMaterial.uniforms.uHasNight.value === 1,
      base: earthMaterial.uniforms.uBase.value === 1,
      hasBase: earthMaterial.uniforms.uHasBase.value === 1,
      ghost: earthMaterial.uniforms.uGhost.value === 1,
      ghostAlpha: earthMaterial.uniforms.uGhost.value === 1 ? GHOST_ALPHA : 1,
      geoAngle: geoAngleGroup.visible,
      whiteBg: (scene.background as THREE.Color).getHex() === BG_WHITE,
      gridStep: gridStepDeg,
      gridLines: gridGroup.children.filter((c) => c instanceof THREE.Line).length,
      axis: axisGroup.visible,
      stars: starsPoints.visible,
      climateLabels: zoneLabelGroup.visible
    }),
    readZoneLabels: () => {
      const rect = renderer.domElement.getBoundingClientRect();
      return zoneLabels.map((item) => {
        const v = item.sprite.getWorldPosition(new THREE.Vector3()).project(camera);
        return {
          text: item.text,
          visible: zoneLabelGroup.visible,
          screen: {
            x: +((v.x * 0.5 + 0.5) * rect.width).toFixed(1),
            y: +((-v.y * 0.5 + 0.5) * rect.height).toFixed(1)
          }
        };
      });
    },
    readLatLabels: () => {
      const rect = renderer.domElement.getBoundingClientRect();
      const camDir = new THREE.Vector3().copy(camera.position).sub(earthPos).normalize();
      return parallelLabels.map((item) => {
        const world = item.sprite.getWorldPosition(new THREE.Vector3());
        const v = world.clone().project(camera);
        const u = world.clone().sub(earthPos).normalize();
        return {
          text: item.text,
          visible: item.sprite.visible,
          screen: {
            x: +((v.x * 0.5 + 0.5) * rect.width).toFixed(1),
            y: +((-v.y * 0.5 + 0.5) * rect.height).toFixed(1)
          },
          front: +u.dot(camDir).toFixed(3)
        };
      });
    },
    focusLatLon: (lat: number, lon: number, distance = 3) => {
      viewState.current = "earth";
      setFreeRoam(false);
      const dir = localFromLatLon(lat, lon).applyQuaternion(tiltGroup.quaternion).normalize();
      controls.target.copy(earthPos);
      camera.position.copy(earthPos).addScaledVector(dir, distance);
      controls.update();
    }
  };

  // 把 onNuChange / onViewChange 透传（外部赋值后引擎可回调）
  Object.defineProperty(engine, "onNuChange", {
    get: () => onNuChange,
    set: (fn: ((value: number) => void) | null) => {
      onNuChange = fn;
    }
  });
  Object.defineProperty(engine, "onViewChange", {
    get: () => onViewChange,
    set: (fn: ((key: ViewKey) => void) | null) => {
      onViewChange = fn;
    }
  });
  Object.defineProperty(engine, "onSpinChange", {
    get: () => onSpinChange,
    set: (fn: ((deg: number) => void) | null) => {
      onSpinChange = fn;
    }
  });
  Object.defineProperty(engine, "onClock", {
    get: () => onClock,
    set: (fn: ((payload: ClockPayload) => void) | null) => {
      onClock = fn;
    }
  });

  // 纹理异步加载（失败时保持深蓝球体，线条教学仍可用）。
  new THREE.TextureLoader().load(
    "./textures/earth.jpg",
    (texture) => {
      texture.colorSpace = THREE.NoColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      earthTexture = texture;
      engine.earthTexture = texture;
      // 贴图是异步到达的，这里必须按当前「影像 / 纯白」状态重新决定是否启用
      applySurface();
    },
    undefined,
    () => {
      // 加载失败：保持纯色球体。
    }
  );

  // 双色底图（大洲深灰 / 海洋浅蓝，2048×1024，与 earth.jpg 同投影同尺寸，共用 UV）。
  // 素材由 `scripts/make_basemap.py` 从 Natural Earth 陆地矢量栅格化而来 —— 不含云、
  // 不含任何政治边界，只有"是陆地 / 是海洋"两种情况。加载失败时退回纯色球体。
  new THREE.TextureLoader().load(
    "./textures/earth_base.png",
    (texture) => {
      texture.colorSpace = THREE.NoColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      baseTexture = texture;
      engine.baseTexture = texture;
      applySurface();
    },
    undefined,
    () => {
      // 加载失败：底图档退回纯色球体，其余功能不受影响。
    }
  );

  // 夜面灯光底图（NASA 城市灯光，2048×1024，与白天贴图同投影同尺寸，直接共用 UV）。
  // 加载失败时着色器退回原来的暗蓝夜面，其它功能不受影响。
  new THREE.TextureLoader().load(
    "./textures/earth_night.jpg",
    (texture) => {
      texture.colorSpace = THREE.NoColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      nightTexture = texture;
      engine.nightTexture = texture;
      applySurface();
    },
    undefined,
    () => {
      // 加载失败：夜面保持原样。
    }
  );

  setOrbitNu(SEASONS[1].nu); // 默认夏至：北极圈极昼，昼夜对比最直观
  return engine;
}

/* ---------------- 展示格式化 ---------------- */

function formatDeg(value: number): string {
  const d = Math.floor(value);
  const m = Math.round((value - d) * 60);
  if (m === 60) {
    return `${d + 1}°00′`;
  }
  return `${d}°${String(m).padStart(2, "0")}′`;
}

function formatLat(lat: number): string {
  return `${lat >= 0 ? "北纬" : "南纬"} ${formatDeg(Math.abs(lat))}`;
}

function formatLon(lon: number): string {
  return `${lon >= 0 ? "东经" : "西经"} ${formatDeg(Math.abs(lon))}`;
}

function formatDecl(decl: number): string {
  if (Math.abs(decl) < 0.05) {
    return "赤道 0°";
  }
  return `${decl > 0 ? "北纬" : "南纬"} ${Math.abs(decl).toFixed(1)}°`;
}

/** 经度 → "120°E" 这种紧凑写法（用于时区中央经线） */
function formatMeridian(lon: number): string {
  const v = ((lon % 360) + 360) % 360;
  const w = v > 180 ? 360 - v : v;
  const dir = w === 0 || w === 180 ? "" : v < 180 ? "E" : "W";
  return `${w % 1 === 0 ? w.toFixed(0) : w.toFixed(1)}°${dir}`;
}

/** 公转旋钮的四条刻度：二分二至在轨道上的真实位置 */
const SEASON_TICKS: KnobTick[] = SEASONS.map((item, index) => ({
  value: item.nu,
  label: ["春", "夏", "秋", "冬"][index],
  color: "#c98a1e",
  strong: true
}));

/** 自转旋钮的辅助刻度 */
const SPIN_TICKS: KnobTick[] = [0, 90, 180, 270].map((value) => ({
  value,
  color: "#7d8899"
}));

/* ---------------- 经纬度平面位置图（需求④）---------------- */

/**
 * 平面图画布尺寸：360×180 —— **故意取经纬度的原值**（经度差 360、纬度差 180），
 * 这样 viewBox 坐标就等于"经度 + 180 / 纬度取反 + 90"，画线与算点都不用再换算一遍。
 * 配套的 preserveAspectRatio="none" 让这张 2:1 的图拉伸填满容器。
 */
const PLANE_W = 360;
const PLANE_H = 180;
/** 每 30° 一条辅助线。零点线（本初子午线 / 赤道）不在这里，单独画粗以突出"零点" */
const PLANE_MERIDIANS = [30, 60, 90, 120, 150, 210, 240, 270, 300, 330];
const PLANE_PARALLELS = [30, 60, 120, 150];

/**
 * 经纬度 → 平面图上的百分比位置。
 * ⚠ 经度必须先归一到 (−180, 180]：太阳直射经线的读数在代码里可能落在 0~360 区间，
 * 不归一的话 190° 这种值会让点跑到图的左边框外（视觉上"点消失了"）。
 */
function planeDotAt(lat: number, lon: number): { left: string; top: string } {
  const norm = (((lon + 180) % 360) + 360) % 360 - 180;
  return {
    left: `${((norm + 180) / 360) * 100}%`,
    top: `${((90 - lat) / 180) * 100}%`
  };
}

/* ---------------- 经纬度夹角示意图（需求⑤，二维）---------------- */

/**
 * 为什么有了三维的夹角弧还要这张二维图：
 *  三维那条弧挂在自转坐标系上，地球一转就转到背面去了 —— 讲定义时（"纬度到底是哪两条线
 *  的夹角"）需要一张**永远正对读者、永远那一副样子**的图。这张剖面示意图就是干这个的：
 *  左图是自赤道面侧看（量纬度），右图是自北极俯视（量经度），两张合起来正好是课本上
 *  分开画的那两幅。
 *  图上一切都在 244×112 的 viewBox 内按经纬度真值作图，不是画着像 —— 纬度 30° 的弧
 *  圆心角就是 30°。
 */
function GeoAngleDiagram({ lat, lon }: { lat: number; lon: number }) {
  const R = 40;
  // 左图：自赤道面侧看，圆心 (54,56)
  const cx = 54;
  const cy = 56;
  const lr = (lat * Math.PI) / 180;
  const gr = (lon * Math.PI) / 180;
  const ar = 19;
  const mid = lr / 2;
  // 右图：自北极俯视，圆心 (186,56)
  const ox = 186;
  const oy = 56;
  const oar = 25;
  const omid = gr / 2;
  return (
    <svg
      className="geo-diagram"
      viewBox="0 0 244 112"
      width="100%"
      role="img"
      aria-label={`经纬度夹角示意：纬度 ${Math.abs(lat).toFixed(1)} 度、经度 ${Math.abs(lon).toFixed(1)} 度`}
    >
      {/* ---- 左：自赤道面侧看，量的角是纬度 ---- */}
      <circle className="geo-globe" cx={cx} cy={cy} r={R} />
      <line className="geo-axis" x1={cx} y1={cy - R - 8} x2={cx} y2={cy + R + 8} />
      <line className="geo-equator" x1={cx - R - 6} y1={cy} x2={cx + R + 6} y2={cy} />
      {/* 半径 C→P 与 P 到赤道面的垂线：把"该点的纬度"翻译成圆心处的夹角 */}
      <line className="geo-radius" x1={cx} y1={cy} x2={cx + R * Math.cos(lr)} y2={cy - R * Math.sin(lr)} />
      <line
        className="geo-drop"
        x1={cx + R * Math.cos(lr)}
        y1={cy - R * Math.sin(lr)}
        x2={cx + R * Math.cos(lr)}
        y2={cy}
      />
      <path
        className="geo-arc-lat"
        d={`M${cx + ar},${cy} A${ar},${ar} 0 0 0 ${cx + ar * Math.cos(lr)},${cy - ar * Math.sin(lr)}`}
      />
      <circle className="geo-dot" cx={cx + R * Math.cos(lr)} cy={cy - R * Math.sin(lr)} r={2.6} />
      <text className="geo-label is-lat" x={cx + (ar + 10) * Math.cos(mid)} y={cy - (ar + 10) * Math.sin(mid)}>
        纬度
      </text>
      <text className="geo-label is-faint" x={cx - R - 4} y={cy - 5} textAnchor="start">
        赤道面
      </text>
      <text className="geo-label is-faint" x={cx + 5} y={cy - R - 11} textAnchor="start">
        地轴
      </text>

      {/* ---- 右：自北极俯视，量的角是经度 ---- */}
      <circle className="geo-globe" cx={ox} cy={oy} r={R} />
      <line className="geo-equator" x1={ox} y1={oy} x2={ox + R} y2={oy} />
      <line className="geo-radius" x1={ox} y1={oy} x2={ox + R * Math.cos(gr)} y2={oy - R * Math.sin(gr)} />
      <path
        className="geo-arc-lon"
        d={`M${ox + oar},${oy} A${oar},${oar} 0 0 ${Math.abs(lon) > 180 ? 1 : 0} ${ox + oar * Math.cos(gr)},${oy - oar * Math.sin(gr)}`}
      />
      <circle className="geo-dot" cx={ox} cy={oy} r={2} />
      <circle className="geo-dot" cx={ox + R * Math.cos(gr)} cy={oy - R * Math.sin(gr)} r={2.6} />
      <text className="geo-label is-lon" x={ox + (oar + 11) * Math.cos(omid)} y={oy - (oar + 11) * Math.sin(omid)}>
        经度
      </text>
      <text className="geo-label is-faint" x={ox + R - 12} y={oy + 13} textAnchor="start">
        本初子午线
      </text>
      <text className="geo-label is-faint" x={ox - R - 2} y={oy + R + 12} textAnchor="start">
        自北极俯视
      </text>
    </svg>
  );
}

interface LayerDef {
  key: keyof LayerState;
  label: string;
  color: string;
  /**
   * 这一项在当前状态下是否失效：返回原因字符串则置灰并显示原因。
   * 置灰**必须给出原因** —— 「点了没反应」比「点不动、并写明为什么」更难懂，
   * 用的人只会以为功能坏了。返回 null 表示可用。
   */
  disabledIn?: (layers: LayerState) => string | null;
}

/**
 * 图层按用途分组，避免十几个开关堆成一坨不好找。
 *
 * v1.5.0 重排（需求⑦）：原来只有三组、且「地球表面」一组塞了 10 项，
 * 分不清"换地表素材"和"叠一层光效"是两类事。现在按**它到底改了画面的什么**切四组：
 *   ① 地表素材：只换球面本身贴什么（三选一，互斥）
 *   ② 线网：球面上画的线
 *   ③ 光照与分区：昼夜、直射、五带、时区
 *   ④ 太阳与画布：天上的东西 + 画布底色
 */
const LAYER_GROUPS: { title: string; items: LayerDef[] }[] = [
  {
    title: "地表素材",
    items: [
      { key: "texture", label: "卫星影像", color: "#3f6b4f" },
      { key: "baseMap", label: "双色底图（大洲·海洋）", color: "#a8d8f0" },
      /*
        这里**故意不加** `disabledIn: whiteBg` —— 别照着「星空背景」那条顺手对称过来。
        白球叠白底确实会"看不见球"，但那是一个**有意义的档位**：
        纯白地球 + 纯白背景 + 经纬网 = 一张可直接投影/打印的经纬网图，
        正是「纯白背景（投影·打印）」这个选项存在的理由。把它禁掉等于砍掉能力。
        （星空不同：星点是纯装饰，在白底上既不承载信息也无法形成"网"，禁掉只是省一个开关。）
      */
      { key: "white", label: "纯白地球", color: "#ffffff" },
      {
        key: "nightLights",
        label: "夜间灯光（夜面城市灯光）",
        color: "#ffcf5a",
        disabledIn: (l) => (l.nightOff ? "已关闭黑夜，夜面与城市灯光一起消失" : null)
      }
    ]
  },
  {
    title: "线网",
    items: [
      { key: "grid", label: "经纬网", color: "#ffffff" },
      { key: "equator", label: "赤道 0°", color: "#ff3b30" },
      { key: "tropics", label: "南北回归线 23.5°", color: "#ffa502" },
      { key: "polar", label: "南北极圈 66.5°", color: "#2ee6ff" },
      { key: "meridian", label: "本初子午线 0°", color: "#8f6bff" },
      { key: "axis", label: "地轴", color: "#f2e8d5" }
    ]
  },
  {
    title: "光照与分区",
    items: [
      { key: "nightOff", label: "关闭黑夜（整球均匀受光）", color: "#8ecbff" },
      { key: "terminator", label: "晨昏线（昼夜分界）", color: "#ffd34d" },
      { key: "subsolar", label: "太阳直射点", color: "#ff8c3a" },
      { key: "zone", label: "太阳直射带（回归线间）", color: "#ffc23d" },
      { key: "climate", label: "五带（热·温·寒）", color: "#ff6b3d" },
      { key: "timezone", label: "全球时区（24 个）", color: "#5a86ff" }
    ]
  },
  {
    title: "太阳与画布",
    items: [
      { key: "orbit", label: "公转轨道·近远日点", color: "#9fb6d8" },
      { key: "sunDisplay", label: "太阳", color: "#ffdf6b" },
      { key: "rays", label: "平行太阳光", color: "#ffc23d" },
      { key: "stars", label: "星空背景", color: "#8ea2c9",
        disabledIn: (l) => (l.whiteBg ? "纯白背景下星点与底色同色，看不见" : null) },
      { key: "whiteBg", label: "纯白背景（投影·打印）", color: "#f2e8d5" }
    ]
  }
];

const VIEW_DEFS: { key: ViewKey; label: string; hint?: string }[] = [
  { key: "orbit", label: "公转全景" },
  { key: "top", label: "俯视轨道" },
  { key: "earth", label: "地球特写" },
  {
    key: "free",
    label: "自由视角",
    hint: "按住右键拖动＝在太空中平移（目标点跟着走，从此不再以太阳或地球为中心）；左键拖动＝转身，滚轮＝朝视线前方进退。"
  }
];

export default function EarthGlobe({ roster }: { roster: PlayerInfo[] }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  /** 极地俯视子图的画布宿主：引擎会把各自的小 WebGL 画布 append 进来 */
  const northPoleHostRef = useRef<HTMLDivElement>(null);
  const southPoleHostRef = useRef<HTMLDivElement>(null);
  const markerLastRef = useRef<MarkerInfo | null>(null);

  const [layers, setLayers] = useState<LayerState>({
    texture: true,
    baseMap: false,
    // 夜面灯光默认开启：黑的那一侧直接是城市灯光，昼夜对比一目了然
    nightLights: true,
    // 黑夜效果默认**保留**（和 v1.4.6 一致）：昼夜交替本来就是这颗球要讲的主线，
    // 「关闭黑夜」是讲解地形时的临时手电筒，不该默认打开。
    nightOff: false,
    white: false,
    grid: true,
    equator: true,
    tropics: true,
    polar: false,
    meridian: true,
    climate: false,
    timezone: false,
    axis: true,
    stars: true,
    // 深空背景是主场（星空 + 地球）；纯白背景是"投影/打印"档，默认关
    whiteBg: false,
    orbit: true,
    terminator: true,
    sunDisplay: true,
    rays: true,
    subsolar: true,
    zone: true
  });
  /** 地轴档位（需求③）：默认倾斜 23.5°，即黄赤交角档 */
  const [axisMode, setAxisMode] = useState<AxisMode>("oblique");
  /** 经纬网疏密（需求⑥）：角度间隔，默认 15° */
  const [gridStep, setGridStep] = useState<number>(DEFAULT_GRID_STEP);
  /** 透明地球（需求⑤）：让背半球的经纬线透出来 */
  const [ghost, setGhost] = useState(false);
  /** 经纬度夹角演示（需求⑤）：把"纬度/经度是哪两条线的夹角"画到球里 */
  const [geoOn, setGeoOn] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [marker, setMarker] = useState<MarkerInfo | null>(null);
  const [nu, setNu] = useState<number>(SEASONS[1].nu);
  const [view, setView] = useState<ViewKey>("orbit");
  const [spinning, setSpinning] = useState(false);
  const [rotating, setRotating] = useState(true);
  const [spinDeg, setSpinDeg] = useState(0);
  /** 各浮动栏的最小化状态：把画面尽量让给地球。左栏三块自 v1.4.8 起合成一栏 */
  const [open, setOpen] = useState({
    rail: true,
    panel: true,
    /** v1.5.0：底部「图层」栏（由原先那条 .globe-hint 提示条改造而来） */
    layers: true
  });
  const togglePanel = (key: keyof typeof open) =>
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  /**
   * 左栏「演示台」内部三节各自的展开状态（v1.4.8 合并进来时保留）。
   *
   * 为什么合成一栏之后还留分节折叠：分开时这三块各有自己的收起按钮，矮屏
   * （1120×740 实测）下把上面两块收掉就能把「极地投影」顶进可视区。若合成一栏后
   * 只留整栏一个开关，这条已经存在、课堂上用得上的操作路径就没了 ——
   * 合并是为了整齐，不该顺手砍掉能力。分节标题本身即开关，视觉层级与右栏一致。
   *
   * v1.5.0：`poles` 并入 `view`。原来的「视角」按钮在右栏、「极地投影」在左栏，
   * 两者回答的是同一个问题（从哪个方向看地球），却被拆到两栏去了 —— 现在合成
   * 左栏第三节「视角与投影」，主视角、自动旋转、两张极地子图同处一节。
   */
  const [railOpen, setRailOpen] = useState({
    knobs: true,
    subsolar: true,
    view: true
  });
  const toggleRailSection = (key: keyof typeof railOpen) =>
    setRailOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  /** 自转旋钮拖动中的即时值（优先于引擎回传值，保证指针跟手） */
  const [spinDragValue, setSpinDragValue] = useState<number | null>(null);
  /** 引擎回传的时钟信息：直射经线 + 标记点地方时 */
  const [clock, setClock] = useState<ClockPayload>({
    spinAngle: 0,
    subsolarLon: 0,
    markerHours: null
  });

  useEffect(() => {
    const container = mountRef.current;
    if (!container) {
      return;
    }
    const engine = buildEngine(container);
    engineRef.current = engine;
    engine.onNuChange = (value: number) => setNu(value);
    engine.onViewChange = (key: ViewKey) => setView(key);
    engine.onSpinChange = (deg: number) => setSpinDeg(deg);
    engine.onClock = (payload: ClockPayload) => setClock(payload);

    // 点击球面读取经纬度（与拖拽区分：位移 < 6px 视为点击）。
    let downX = 0;
    let downY = 0;
    let downTime = 0;
    function onPointerDown(event: PointerEvent) {
      downX = event.clientX;
      downY = event.clientY;
      downTime = Date.now();
    }
    function onPointerUp(event: PointerEvent) {
      const dx = event.clientX - downX;
      const dy = event.clientY - downY;
      if (Math.hypot(dx, dy) >= 6 || Date.now() - downTime > 600) {
        return;
      }
      const rect = engine.renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, engine.camera);
      const hits = raycaster.intersectObject(engine.earthMesh, false);
      if (hits.length === 0) {
        return;
      }
      const local = engine.earthMesh.worldToLocal(hits[0].point.clone());
      const info = latLonFromLocal(local);
      markerLastRef.current = info;
      engine.placeMarker(info.lat, info.lon);
      setMarker(info);
    }
    engine.renderer.domElement.addEventListener("pointerdown", onPointerDown);
    engine.renderer.domElement.addEventListener("pointerup", onPointerUp);

    // 拖拽时暂停自动旋转，松手 2.5 秒后恢复。
    let resumeTimer = 0;
    function onPause() {
      engine.controls.autoRotate = false;
      window.clearTimeout(resumeTimer);
    }
    function onResume() {
      window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        engine.controls.autoRotate = engine.autoRotateWanted;
      }, 2500);
    }
    engine.controls.addEventListener("start", onPause);
    engine.controls.addEventListener("end", onResume);

    // 开发/测试辅助。
    (window as unknown as Record<string, unknown>).__globeDebug = {
      focus: (lat: number, lon: number) => {
        engine.controls.autoRotate = false;
        engine.focusLatLon(lat, lon, 2.8);
      },
      readMarker: () => (markerLastRef.current ? { ...markerLastRef.current } : null),
      setNu: (value: number) => engine.setOrbitNu(value),
      /**
       * 走 React 状态改公转位置 —— 与拖「公转位置」旋钮、点节气按钮**同一条路**。
       * ⚠ 与上面的 `setNu` 不是一回事：`setNu` 只改引擎姿态，React 侧的 nu 不动，
       * 于是左侧的直射点读数与曲线会停在旧值上。那是像素搜索需要的能力（只转姿态、不惊动 UI），
       * 但它**不是用户能走到的状态** —— 凡是验「读数/曲线跟着 ν 走」的用例必须用这个钩子。
       */
      setOrbit: (value: number) => setNu(value),
      readState: () => ({
        nu: engine.readNu(),
        decl: engine.readDeclination()
      }),
      readGeometry: () => engine.readGeometry(),
      readSubsolarLabelBox: () => engine.readSubsolarLabelBox(),
      readGeoLabelBoxes: () => engine.readGeoLabelBoxes(),
      /** 开发自检：关掉夹角标签的屏幕让位（牙齿测试用：关掉必须能测出叠字） */
      setLabelSeparate: (on: boolean) => engine.setLabelSeparate(on),
      setSpin: (deg: number) => engine.setSpinAngle(deg),
      /** 开发自检：冻结/恢复自转推进，便于在固定自转角下反复读取同一帧的布局 */
      setRotate: (on: boolean) => engine.setRotate(on),
      setAutoRotate: (on: boolean) => {
        engine.autoRotateWanted = on;
        engine.controls.autoRotate = on;
      },
      readClock: () => ({
        subsolarLon: engine.readSubsolarLon(),
        spinDeg: engine.readSpinAngle()
      }),
      readMarkerHours: (lat: number, lon: number) =>
        localHoursAt(lon, engine.readSubsolarLon()),
      readMarkerDebug: () => engine.readMarkerDebug(),
      readVisibility: () => engine.readVisibility(),
      /**
       * 屏幕点 → 该点处的昼夜因子输入 `d = dot(法线, 光照方向)`，与着色器**同源**
       * （着色器就是拿 `vNormalW` 与 `uSunDir` 点乘再喂 smoothstep）。
       *
       * 为什么需要它：要断言"白天区域不该被关黑夜影响"，先得知道**哪些点是白天**。
       * 靠像素亮度猜不行 —— 亮度 = mix(夜面色, 白天贴图色, dayAmt)，
       * 把"贴图本身多亮"混了进来：实测贴图亮的过渡带点亮度能到 159，
       * 比贴图暗的纯白天点还亮，于是"按亮度取最亮的 25%"取到的正是过渡带点。
       *
       * 有了 d，"该不该变"就完全确定：
       *   d > 0.1  ⇒ dayAmt 恒为 1（纯白天，关黑夜不该有任何变化）
       *   d < −0.1 ⇒ dayAmt 恒为 0（纯夜面，关黑夜必须变亮）
       *   ±0.1 之间是晨昏线过渡带（本来就会部分变亮，不该混进上面两类断言）
       * 未命中球面的点返回 null（盘外的星空）。
       */
      readSunDot: (pts: { x: number; y: number }[]) => {
        const rect = engine.renderer.domElement.getBoundingClientRect();
        const camera = engine.camera;
        const center = engine.earthAnchor.position;
        const radius = engine.earthMesh.getWorldScale(new THREE.Vector3()).x;
        const sunDirW = (engine.earthMaterial.uniforms.uSunDir.value as THREE.Vector3)
          .clone()
          .normalize();
        return pts.map((p) => {
          const ndc = new THREE.Vector3(
            (p.x / rect.width) * 2 - 1,
            -(p.y / rect.height) * 2 + 1,
            0.5
          ).unproject(camera);
          const origin = camera.position;
          const dir = ndc.sub(origin).normalize();
          // 射线与球求交。球体的法线就是径向（世界空间）—— spin/tilt 的旋转对圆球不影响法线，
          // 所以这里不需要把它们还原回来。
          const oc = origin.clone().sub(center);
          const b = oc.dot(dir);
          const c = oc.dot(oc) - radius * radius;
          const disc = b * b - c;
          if (disc < 0) {
            return null;
          }
          const t = -b - Math.sqrt(disc);
          if (t < 0) {
            return null;
          }
          const normal = origin
            .clone()
            .addScaledVector(dir, t)
            .sub(center)
            .normalize();
          return +normal.dot(sunDirW).toFixed(4);
        });
      },
      readZoneLabels: () => engine.readZoneLabels(),
      readLatLabels: () => engine.readLatLabels(),
      readCamDebug: () => {
        const rect = engine.renderer.domElement.getBoundingClientRect();
        const earth = engine.earthAnchor.position.clone().project(engine.camera);
        // 球面轮廓在屏幕上的像素半径：投影赤道方向 ±1 单位取一半，再按 asin/atan 修正到轮廓
        const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(engine.camera.quaternion);
        const a = engine.earthAnchor.position.clone().add(camRight).project(engine.camera);
        const b = engine.earthAnchor.position.clone().sub(camRight).project(engine.camera);
        const eqR = (Math.abs(a.x - b.x) / 2) * (rect.width / 2);
        const dist = engine.camera.position.distanceTo(engine.earthAnchor.position);
        const silhouette = eqR * (Math.asin(Math.min(1, 1 / dist)) / Math.atan(Math.min(1, 1 / dist)));
        const target = engine.controls.target;
        return {
          view: engine.readGeometry().view,
          earthScreen: {
            x: +((earth.x * 0.5 + 0.5) * rect.width).toFixed(1),
            y: +((-earth.y * 0.5 + 0.5) * rect.height).toFixed(1)
          },
          diskRadiusPx: +silhouette.toFixed(1),
          camPos: [
            +engine.camera.position.x.toFixed(3),
            +engine.camera.position.y.toFixed(3),
            +engine.camera.position.z.toFixed(3)
          ],
          // 自由视角相关：三个数各自回答一个问题 ——
          // 能不能平移、平移把 target 搬到哪了、到现在这个 target 的距离是多少
          panEnabled: engine.controls.enablePan,
          autoRotate: engine.controls.autoRotate,
          minDistance: engine.controls.minDistance,
          maxDistance: engine.controls.maxDistance,
          target: [+target.x.toFixed(3), +target.y.toFixed(3), +target.z.toFixed(3)],
          camTargetDistance: +engine.camera.position.distanceTo(target).toFixed(3),
          earthTargetDistance: +target.distanceTo(engine.earthAnchor.position).toFixed(3)
        };
      },
      setLayers: (patch: Partial<LayerState>) =>
        setLayers((prev) => ({ ...prev, ...patch })),
      /* ---- v1.5.0 新增自检钩子 ----
         ⚠ 一律走 **React 状态**（与用户点按钮同一条路），不要直接调 engine.setXxx：
         那是"只改引擎、不改 UI"的近路，拿它验出来的绿是假绿（见 setNu/setOrbit 那条注释）。 */
      setAxisMode: (mode: AxisMode) => setAxisMode(mode),
      setGridStep: (step: number) => setGridStep(step),
      setGhost: (on: boolean) => setGhost(on),
      setGeoAngle: (on: boolean) => setGeoOn(on),
      readGeoAngle: () => engine.readGeoAngle(),
      /** 开发自检：夹角线粗细（牙齿测试）+ 弧的屏幕点（在真实帧上量线宽） */
      setAngleThickness: (scale: number) => engine.setAngleThickness(scale),
      readGeoArcScreen: () => engine.readGeoArcScreen(),
      readGridStep: () => engine.readGridStep(),
      /** 开发自检：地轴两端投影到屏幕的位置（验证极地俯视时极点确实落在画面中心） */
      readPoleAxis: () => {
        const rect = engine.renderer.domElement.getBoundingClientRect();
        const proj = (p: THREE.Vector3) => {
          const v = p.clone().project(engine.camera);
          return {
            x: +((v.x * 0.5 + 0.5) * rect.width).toFixed(1),
            y: +((-v.y * 0.5 + 0.5) * rect.height).toFixed(1)
          };
        };
        const base = engine.earthAnchor.position;
        // 用**当前档位**的地轴，而不是倾斜档的常量：垂直档切换后这里必须跟着变，
        // 否则"地轴真的立直了"就没有任何可断言的证据。
        const axis = new THREE.Vector3(...engine.readAxis());
        return {
          view: engine.readGeometry().view,
          axis: [+axis.x.toFixed(3), +axis.y.toFixed(3), +axis.z.toFixed(3)],
          north: proj(base.clone().addScaledVector(axis, 1)),
          south: proj(base.clone().addScaledVector(axis, -1)),
          earth: proj(base.clone())
        };
      },
      view: (key: ViewKey) => {
        if (key === "earth") {
          engine.controls.autoRotate = false;
          engine.autoRotateWanted = false;
        }
        engine.setView(key);
      },
      readPoleViews: () => engine.readPoleViews(),
      readRays: () => engine.readRays(),
      samplePixels: (pts: { x: number; y: number }[]) => engine.samplePixels(pts)
    };

    return () => {
      window.clearTimeout(resumeTimer);
      engine.renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      engine.renderer.domElement.removeEventListener("pointerup", onPointerUp);
      engine.controls.removeEventListener("start", onPause);
      engine.controls.removeEventListener("end", onResume);
      delete (window as unknown as Record<string, unknown>).__globeDebug;
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // 极地投影子图：两块宿主 div 挂上去时把画布交给引擎，卸载时摘掉。
  // 依赖 polesMounted 而不是某一个开关 —— v1.4.8 起宿主 div 的存亡取决于
  // 「整栏展开」与「极地投影这一节展开」**两个条件同时成立**，少算一个就会出现
  // 「宿主已经卸载、引擎还拿着脱离 DOM 的画布每帧渲染」。
  // v1.5.0：极地投影并入左栏第三节「视角与投影」，故跟着 railOpen.view 走。
  const polesMounted = open.rail && railOpen.view;
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    if (polesMounted) {
      if (northPoleHostRef.current) {
        engine.attachPoleView("north", northPoleHostRef.current);
      }
      if (southPoleHostRef.current) {
        engine.attachPoleView("south", southPoleHostRef.current);
      }
    }
    return () => engine.detachPoleViews();
  }, [polesMounted]);

  // 图层开关
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    engine.gridGroup.visible = layers.grid;
    engine.equatorGroup.visible = layers.equator;
    engine.tropicsGroup.visible = layers.tropics;
    engine.polarGroup.visible = layers.polar;
    engine.meridianGroup.visible = layers.meridian;
    engine.axisGroup.visible = layers.axis;
    // 纯白背景下星点与背景同色 ⇒ 一片看不见的星，直接不显示（开关也置灰说明原因）
    engine.starsPoints.visible = layers.stars && !layers.whiteBg;
    engine.terminatorMesh.visible = layers.terminator;
    engine.terminatorLabel.visible = layers.terminator;
    engine.sunGroup.visible = layers.sunDisplay;
    engine.rayGroup.visible = layers.rays;
    engine.subsolarGroup.visible = layers.subsolar;
    engine.zoneGroup.visible = layers.zone;
    // 五带 / 时区叠加球壳
    engine.overlayMaterial.uniforms.uClimate.value = layers.climate ? 1 : 0;
    engine.overlayMaterial.uniforms.uTz.value = layers.timezone ? 1 : 0;
    // 地表素材三选一：影像 / 双色底图 / 纯白
    engine.applySurface({
      texture: layers.texture,
      baseMap: layers.baseMap,
      white: layers.white
    });
    // 夜面灯光底图开关（贴图本身在加载完成后由 applySurface 挂上）
    engine.earthMaterial.uniforms.uNight.value = layers.nightLights ? 1 : 0;
    // 关闭黑夜：着色器把昼夜混合系数钉在 1，夜面与城市灯光一并消失
    engine.earthMaterial.uniforms.uNoNight.value = layers.nightOff ? 1 : 0;
  }, [layers]);

  // 画布背景（需求②）：深空 / 纯白
  useEffect(() => {
    engineRef.current?.setBackground(layers.whiteBg);
  }, [layers.whiteBg]);

  // 地轴档位（需求③）
  useEffect(() => {
    engineRef.current?.setAxisMode(axisMode);
  }, [axisMode]);

  // 经纬网疏密（需求⑥）
  useEffect(() => {
    engineRef.current?.setGridStep(gridStep);
  }, [gridStep]);

  // 透明地球（需求⑤）
  useEffect(() => {
    engineRef.current?.setTransparent(ghost);
  }, [ghost]);

  // 经纬度夹角演示（需求⑤）：未选点时用默认示例点，保证这一节永远有东西可讲
  useEffect(() => {
    engineRef.current?.setGeoAngle(geoOn, marker ?? DEMO_POINT);
  }, [geoOn, marker]);

  // 公转轨道与地球标签只在公转视角显示（特写时轨道会横穿地球、标签会遮挡画面）
  useEffect(() => {
    const engine = engineRef.current;
    if (engine) {
      const show = layers.orbit && view !== "earth";
      engine.orbitGroup.visible = show;
      engine.earthLabel.visible = show;
    }
  }, [layers.orbit, view]);

  // 自动旋转开关
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    engine.autoRotateWanted = autoRotate;
    engine.controls.autoRotate = autoRotate;
  }, [autoRotate]);

  // 公转演示开关
  useEffect(() => {
    engineRef.current?.setSpin(spinning);
  }, [spinning]);

  // 地球自转开关（默认开启，演示用 60°/秒；公转演示不影响自转）
  useEffect(() => {
    engineRef.current?.setRotate(rotating);
  }, [rotating]);

  // 公转位置变化（公转演示运行期间由引擎自行推进，避免回写造成抖动）
  useEffect(() => {
    if (spinning) {
      return;
    }
    engineRef.current?.setOrbitNu(nu);
  }, [nu, spinning]);

  /** 这一项在当前状态下失效的原因（null＝可用）。置灰与守卫共用，避免两处判断各写一份 */
  function layerDisabledReason(key: keyof LayerState, state: LayerState): string | null {
    for (const group of LAYER_GROUPS) {
      const item = group.items.find((i) => i.key === key);
      if (item?.disabledIn) {
        return item.disabledIn(state);
      }
    }
    return null;
  }

  function toggleLayer(key: keyof LayerState) {
    setLayers((prev) => {
      // 置灰的项在 UI 上已经点不动，这里再挡一道：拖动/键盘等路径绕过 checkbox 时
      // 也不该切出一个"开了却没效果"的状态。
      if (layerDisabledReason(key, prev)) {
        return prev;
      }
      const next = { ...prev, [key]: !prev[key] };
      // 地表素材是**三选一**（卫星影像 / 双色底图 / 纯白地球）：点亮其中一个就关掉另两个。
      // 为什么不做成单选按钮组：这三种素材在别处也用「图层开关」这个词在讲，
      // 而且"全部关掉"是一个有意义的档位（露出兜底纯色球，用来讲球面几何）。
      if (key === "texture" && next.texture) {
        next.baseMap = false;
        next.white = false;
      }
      if (key === "baseMap" && next.baseMap) {
        next.texture = false;
        next.white = false;
      }
      if (key === "white" && next.white) {
        next.texture = false;
        next.baseMap = false;
      }
      // 纯白背景与星空互斥：白底上的白色星点等于没有，留着只会让人以为图层坏了
      if (key === "whiteBg" && next.whiteBg) {
        next.stars = false;
      }
      return next;
    });
  }

  function applySeason(key: SeasonKey) {
    const item = SEASONS.find((s) => s.key === key);
    if (!item) {
      return;
    }
    setSpinning(false);
    setNu(item.nu);
  }

  function applyView(key: ViewKey) {
    engineRef.current?.setView(key);
    setView(key);
    if (key === "earth" || key === "free") {
      // 特写用于讲解昼夜与自转、自由视角用于「停在某处观察」，两者都要求取景稳定 ⇒ 关自动旋转
      setAutoRotate(false);
    }
  }

  /** 点直射点曲线跳到那一天：与点「夏至」按钮走同一条路（先停公转演示，再设 ν） */
  function jumpToNu(value: number) {
    setSpinning(false);
    setNu(Math.round(value * 10) / 10);
  }

  function resetView() {
    applyView("orbit");
  }

  function clearMarkerClick() {
    engineRef.current?.clearMarker();
    setMarker(null);
    markerLastRef.current = null;
  }

  /**
   * 地轴向量（按档位）。React 侧的一切读数都从这一个量推 —— 直射点纬度、四季说明、
   * 极昼极夜、平面图上的晨昏线，全都跟着它走。引擎内部也有一份（`axisWorld`），
   * 但那台是给渲染用的；两边的"档位"是同一个 React 状态，所以不会背离。
   */
  const axisVertical = axisMode === "vertical";
  const declination = declinationForNu(nu, axisVertical ? WORLD_UP : AXIS_WORLD);

  // 由公转位置推导当前节气：环形距离（单位：度）
  function seasonDistance(key: SeasonKey): number {
    const item = SEASONS.find((s) => s.key === key);
    return item ? Math.abs(((nu - item.nu + 540) % 360) - 180) : 999;
  }
  const activeSeason = (key: SeasonKey) => seasonDistance(key) < 1.0;

  let nearestKey: SeasonKey = SEASONS[0].key;
  let nearestD = 999;
  for (const item of SEASONS) {
    const d = Math.abs(((nu - item.nu + 540) % 360) - 180);
    if (d < nearestD) {
      nearestD = d;
      nearestKey = item.key;
    }
  }
  const seasonNote = axisVertical
    ? // 垂直档：这里必须**单独写一句**，不能落到下面"直射赤道、昼夜等长"那个兜底分支上 ——
      // 兜底分支读起来像"今天正好是二分日"，而这一档说的是**终年如此**，是两种完全不同的结论。
      "地轴与轨道面垂直：太阳终年直射赤道，全球各地终年昼夜等长，既没有四季更替，也没有极昼极夜。"
    : nearestD < 1.0
      ? SEASON_NOTES[nearestKey]
      : declination > 0
        ? `太阳直射点位于北纬 ${declination.toFixed(1)}°。直射点在南北回归线之间往返移动，此时北半球昼长夜短。`
        : declination < 0
          ? `太阳直射点位于南纬 ${Math.abs(declination).toFixed(1)}°。直射点在南北回归线之间往返移动，此时北半球昼短夜长。`
          : "太阳直射赤道，全球昼夜等长。";

  /**
   * 平面位置图上的晨昏线。等距圆柱坐标里太阳高度角为 0 的轨迹（时角 H = 经度 − 直射经度）：
   *   sinφ·sinδ + cosφ·cosδ·cosH = 0  ⇒  φ = atan(−cosH / tanδ)
   * δ=0（二分日）时分母为 0，轨迹退化成**直射经线 ±90° 那两条经线**，得单独画 ——
   * 不能硬代公式，那样会得到 atan(±∞)，各点乱跳。
   */
  const terminatorPath = (() => {
    if (!layers.terminator) {
      return "";
    }
    const norm = (((clock.subsolarLon + 180) % 360) + 360) % 360 - 180;
    if (Math.abs(declination) < 0.5) {
      return (
        `M${norm + 90 + 180},0 L${norm + 90 + 180},${PLANE_H} ` +
        `M${norm - 90 + 180},0 L${norm - 90 + 180},${PLANE_H}`
      );
    }
    const tanD = Math.tan(declination * DEG);
    const pts: string[] = [];
    for (let h = -180; h <= 180; h += 2) {
      const lat = Math.atan(-Math.cos(h * DEG) / tanD) / DEG;
      pts.push(`${h + norm + 180},${90 - lat}`);
    }
    return `M${pts.join(" L")}`;
  })();

  const distanceAu = 1 - ORBIT_E * Math.cos(nu * DEG);
  const nearAphelion = distanceAu > 1;
  /** 夹角演示与位置图共用的"当前演示点"：球面选过点就用选点，否则用示例点 */
  const geoPoint = marker ?? DEMO_POINT;

  /* ---- 地方时 / 区时 ---- */
  // 太阳直射经线上地方时为 12:00，其余经线按「每向东 15° 早 1 小时」推算。
  const markerHours = clock.markerHours;
  const markerClockText = markerHours === null ? "--:--" : formatClock(markerHours);
  const markerZone = marker ? zoneIndexOf(marker.lon) : 0;
  // 区时 = 该时区中央经线上的地方时；与地方时的差值恒为 (中央经线 − 该地经度)/15 小时
  const zoneHours = ((12 + markerZone - clock.subsolarLon / 15) % 24 + 24) % 24;
  const localMinusZone =
    marker === null ? 0 : ((marker.lon - markerZone * TZ_WIDTH) / TZ_WIDTH) * 60;
  const nearestSeasonLabel =
    SEASONS.find((item) => item.key === nearestKey)?.label ?? "";
  const nearestSeasonText =
    nearestD < 1.0 ? `正处${nearestSeasonLabel}` : `临近${nearestSeasonLabel}`;
  const spinKnobValue = spinDragValue === null ? spinDeg : spinDragValue;
  /** 当前视角的操作提示（只有需要额外说明的视角才写，其余为 undefined） */
  const viewHint = VIEW_DEFS.find((item) => item.key === view)?.hint;
  /**
   * 两极此刻是极昼还是极夜 —— 由直射点纬度直接决定，不需要另算太阳高度角：
   * 直射点在北半球 ⇒ 北极圈内整日不落（极昼）、南极圈内整日不升（极夜）；二分日两极昼夜平分。
   * 放在极地投影那两行读数上，是因为这两张图存在的意义就是看极昼极夜的范围。
   */
  const polarState = (north: boolean) => {
    if (Math.abs(declination) < 0.05) {
      return "昼夜平分";
    }
    const day = declination > 0;
    return (north ? day : !day) ? "极昼" : "极夜";
  };

  return (
    <div className="globe-app">
      {/* 舞台：画布 + 左右两条浮动栏。v1.5.0 起把这一层单独套出来，是为了让底部
          「图层」栏成为一个**正常的流式元素**，而不是又一条绝对定位的浮层 ——
          浮层之间只能靠调 top/bottom 的魔数互不重叠（v1.4.6 左栏重叠 135px 就是这么来的），
          流式布局则从结构上不可能压住对方，也不必为"提示条多高"留一个猜出来的 60px。 */}
      <div className="globe-stage">
        <div className="globe-canvas" ref={mountRef} />

        {/* 左栏「演示台」（.globe-rail）：一栏三节 —— 公转与自转 / 地轴倾角与太阳直射点 /
            视角与投影。三节都是"**动手改状态**"的入口：转旋钮、切档位、换视角。
            与右栏「控制台」的分工是一条界：左边改，右边读。

            v1.4.8 之前这里是三张各自带边框、各自带收起按钮的独立卡片，三处不齐：
            ① 右边缘不齐：实测 .globe-knobs / .globe-subsolar 的右边缘都在 214，
               而 .globe-poles 是 width:auto，缩到画布宽只有 170，右边白白空出 44px；
            ② 标题三套风格（.knob-name / .subsolar-title / .pole-title），层级看不出来；
            ③ 三张卡各自再排一遍内边距，竖向净多出 100px 以上。
            现在合成**一张卡 + 三个 <section> + 统一的 h2**：边框、内边距、分节虚线、
            h2 的字级/字距/颜色全部与右栏「控制台」共用同一套 CSS 规则
            （见 styles.css 里 .globe-panel / .globe-rail 的合并选择器），
            每节正文一律占满内容宽、左边缘与 h2 对齐 —— 右栏的「整齐」就是这么来的。 */}
        <div className={open.rail ? "globe-rail" : "globe-rail is-collapsed"}>
          <button
            type="button"
            className="panel-toggle"
            title={open.rail ? "收起演示台" : "展开演示台"}
            onClick={() => togglePanel("rail")}
          >
            {open.rail ? "—" : "演示台 ＋"}
          </button>
          {open.rail && (
            <>
          {/* ① 公转与自转：整块从右栏抽出来放左边 —— 右手拖旋钮、左手不挡画面，
              右栏留给参数读数。
              v1.5.0：把「二分二至」四个按钮从右栏搬到这里。它们与公转旋钮做的是
              **同一件事**（把 ν 设到某个值），原先一个在左一个在右，等于把同一个
              操作拆成两处找。 */}
          <section>
            <h2>
              <button
                type="button"
                className="rail-section-toggle"
                aria-expanded={railOpen.knobs}
                onClick={() => toggleRailSection("knobs")}
              >
                <span>公转与自转</span>
                <span className="rail-section-caret">{railOpen.knobs ? "▾" : "▸"}</span>
              </button>
            </h2>
            {railOpen.knobs && (
              <>
          <div className="knob-block">
            <Knob
              value={nu}
              size={116}
              accent="#e0a83c"
              ticks={SEASON_TICKS}
              ariaLabel="公转位置旋钮"
              onDrag={(deg) => {
                setSpinning(false);
                setNu(deg);
              }}
            />
            <div className="knob-head">
              <span className="knob-name">公转位置</span>
              <strong className="knob-value">{nu.toFixed(0)}°</strong>
            </div>
            <span className="knob-sub">{nearestSeasonText}</span>
            <button
              type="button"
              className={spinning ? "spin-btn is-on" : "spin-btn"}
              onClick={() => setSpinning((v) => !v)}
            >
              {spinning ? "演示中" : "自动公转"}
            </button>
          </div>

          <div className="season-grid is-compact">
            {SEASONS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={activeSeason(item.key) ? "season-btn is-active" : "season-btn"}
                onClick={() => applySeason(item.key)}
              >
                {item.label}
                <small>{item.date}</small>
              </button>
            ))}
          </div>

          <div className="knob-block">
            <Knob
              value={spinKnobValue}
              size={116}
              accent="#3f8cff"
              wrap={false}
              ticks={SPIN_TICKS}
              ariaLabel="地球自转旋钮"
              onDrag={(deg) => {
                setSpinDragValue(deg);
                engineRef.current?.setSpinAngle(deg);
              }}
              onDragStart={() => engineRef.current?.setSpinDragging(true)}
              onDragEnd={() => {
                engineRef.current?.setSpinDragging(false);
                setSpinDragValue(null);
              }}
            />
            <div className="knob-head">
              <span className="knob-name">地球自转</span>
              <strong className="knob-value">{Math.round(spinDeg)}°</strong>
            </div>
            <span className="knob-sub">可一圈圈连续转动</span>
            <button
              type="button"
              className={rotating ? "spin-btn is-on" : "spin-btn"}
              onClick={() => setRotating((v) => !v)}
            >
              {rotating ? "自转中" : "已暂停"}
            </button>
          </div>

          <p className="knob-deck-hint">
            按住圆盘绕中心拖动即可自由转动；旋钮刻度为二分二至 / 四象限。
          </p>
              </>
            )}
          </section>

          {/* ② 地轴倾角 + 太阳直射点回归运动（2D 曲线）
              v1.5.0 把「地轴倾角」并进这一节：地轴倾角最直接的后果就是**直射点的
              回归运动**。切到「垂直」档，下面那条曲线当场被拉平成赤道 —— 把开关与
              曲线放在同一节里，学生点一下就能看见因果关系，不必跨栏对照。

              曲线横轴与上面「公转位置」旋钮是同一个量（ν），所以转旋钮时曲线上的橙点
              与三维画面里光柱打到的纬度永远一致。 */}
          <section>
            <h2>
              <button
                type="button"
                className="rail-section-toggle"
                aria-expanded={railOpen.subsolar}
                onClick={() => toggleRailSection("subsolar")}
              >
                <span>地轴倾角与太阳直射点</span>
                <span className="rail-section-caret">{railOpen.subsolar ? "▾" : "▸"}</span>
              </button>
            </h2>
            {railOpen.subsolar && (
              <>
                <div className="seg-row" role="group" aria-label="地轴倾角">
                  <span className="seg-label">地轴</span>
                  <button
                    type="button"
                    className={axisMode === "oblique" ? "is-on" : ""}
                    data-axis="oblique"
                    onClick={() => setAxisMode("oblique")}
                  >
                    倾斜 23.5°
                  </button>
                  <button
                    type="button"
                    className={axisMode === "vertical" ? "is-on" : ""}
                    data-axis="vertical"
                    onClick={() => setAxisMode("vertical")}
                  >
                    垂直
                  </button>
                </div>
                <SubsolarCurve
                  nu={nu}
                  obliquity={axisMode === "vertical" ? 0 : EARTH_TILT}
                  onJump={jumpToNu}
                />
              </>
            )}
          </section>

          {/* ③ 视角与投影：主视角预设 + 自动旋转 + 极地投影两张子图。
              v1.5.0 把右栏的「视角」搬过来与前两版就有的「极地投影」合并 ——
              两者回答的是**同一个问题**（从哪个方向看这颗球），原先一左一右，
              老师要连着用就得在屏幕上两头找。

              极地投影：两台相机分别位于地轴南北两端、沿地轴看向球心，各自一块独立小画布，
              与主视图互不影响；画布由引擎在挂载时塞进宿主 div（WebGL 上下文归引擎管）。
              两行读数给出此刻两极是极昼还是极夜 —— 这两张图存在的意义就是看极昼极夜的范围。 */}
          <section>
            <h2>
              <button
                type="button"
                className="rail-section-toggle"
                aria-expanded={railOpen.view}
                onClick={() => toggleRailSection("view")}
              >
                <span>视角与投影</span>
                <span className="rail-section-caret">{railOpen.view ? "▾" : "▸"}</span>
              </button>
            </h2>
            {railOpen.view && (
              <>
                <div className="view-actions">
                  {VIEW_DEFS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={view === item.key ? "is-on" : ""}
                      onClick={() => applyView(item.key)}
                    >
                      {item.label}
                    </button>
                  ))}
                  <button type="button" onClick={resetView}>
                    复位视角
                  </button>
                  <button
                    type="button"
                    className={autoRotate ? "is-on" : ""}
                    onClick={() => setAutoRotate((v) => !v)}
                  >
                    {autoRotate ? "自动旋转：开" : "自动旋转：关"}
                  </button>
                </div>
                {viewHint && <p className="teach-note">{viewHint}</p>}
                <div className="readout-row">
                  <span>自北极俯视</span>
                  <strong>{polarState(true)}</strong>
                </div>
                <div className="pole-canvas" ref={northPoleHostRef} />
                <div className="readout-row">
                  <span>自南极俯视</span>
                  <strong>{polarState(false)}</strong>
                </div>
                <div className="pole-canvas" ref={southPoleHostRef} />
                <p className="knob-hint">
                  相机位于地轴两端、沿地轴俯视球心：经线在极点交汇成一点，自转方向自北极看是逆时针、自南极看是顺时针。
                </p>
              </>
            )}
          </section>
            </>
          )}
        </div>

      <aside className={open.panel ? "globe-panel" : "globe-panel is-collapsed"}>
        <button
          type="button"
          className="panel-toggle"
          title={open.panel ? "收起面板" : "展开面板"}
          onClick={() => togglePanel("panel")}
        >
          {open.panel ? "—" : "控制台 ＋"}
        </button>
        {open.panel && (
          <div className="panel-body">
        {/* ---- 右栏「控制台」：只读 ---- 
            v1.5.0 重排（需求⑦）把原先 7 节收敛成 4 节，两条规矩：
             ① 同一主题不许拆到两栏：「坐标读取·地方时」与「自转与地方时」原本是两节，
                讲的是同一件事（经度 ↔ 时间），名字里还各带一次"地方时"，现在合并成一节。
             ② 大块只读清单不占读数栏：图层那一整块（19 项）搬到底部「图层」栏。
            「教学提示」的两条都讲公转轨道，并进左栏第二节；「视角」并入左栏第三节。
            剩下四节：坐标与地方时 / 经纬度位置图 / 经纬度是怎么量出来的 / 公转与四季。 */}
        <section>
          <h2>坐标与地方时</h2>
          {marker ? (
            <div className="coord-card">
              <div className="coord-row">{formatLat(marker.lat)}</div>
              <div className="coord-row">{formatLon(marker.lon)}</div>
              <div className="coord-decimal">
                {marker.lat.toFixed(2)}°, {marker.lon.toFixed(2)}°
              </div>
              <div className="coord-time">
                地方时 <strong>{markerClockText}</strong>
              </div>
              <div className="coord-meta">
                {formatZone(marker.lon)}（中央经线 {formatMeridian(markerZone * TZ_WIDTH)}）
                · 区时 {formatClock(zoneHours)}
              </div>
              <div className="coord-meta">
                与区时相差 {localMinusZone >= 0 ? "+" : "−"}
                {Math.abs(Math.round(localMinusZone))} 分钟
              </div>
              <button type="button" className="coord-clear" onClick={clearMarkerClick}>
                清除标记
              </button>
            </div>
          ) : (
            <p className="coord-empty">
              切到「地球特写」后点击球面任意位置，即可读取该点经纬度与当地地方时。
            </p>
          )}
          <div className="readout-row">
            <span>太阳直射经线</span>
            <strong>{formatLon(clock.subsolarLon)}</strong>
          </div>
          <p className="teach-note">
            <b>地方时</b>：太阳位于该地正上方时为正午 12:00，随地球自转持续变化。
            由于地球自西向东转，<b>东边比西边先看到日出</b>，每向东 15° 地方时早 1 小时。
            太阳直射经线的地方时恒为 <b>12:00</b>，它就是全球地方时的零点线。
          </p>
        </section>

        {/* 经纬度平面位置图（需求④）
            为什么值得单独占一节：**球面是弯的**。"点在球上哪儿"与"点在图上哪一格
            （东经多少度、北纬多少度）是两种空间感；对着平面图找经纬度比对着球找容易得多。
            底图直接复用双色底图那张素材（同投影、同尺寸）⇒ 平面图与球面用的是同一套海陆
            轮廓、同一组配色，不会出现"两处画的陆地不一样"。三者同处一张图：
            红点＝选点、橙点＝此刻太阳直射点、黄线＝晨昏线。 */}
        <section>
          <h2>经纬度位置图</h2>
          <div className="plane-map">
            <div className="plane-map-frame">
              <img
                src="./textures/earth_base.png"
                alt="世界海陆底图（等距圆柱投影，海洋浅蓝、大洲深灰）"
                draggable={false}
              />
              <svg
                className="plane-map-grid"
                viewBox={`0 0 ${PLANE_W} ${PLANE_H}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {PLANE_MERIDIANS.map((x) => (
                  <line key={`m${x}`} x1={x} y1={0} x2={x} y2={PLANE_H} />
                ))}
                {PLANE_PARALLELS.map((y) => (
                  <line key={`p${y}`} x1={0} y1={y} x2={PLANE_W} y2={y} />
                ))}
                {/* 本初子午线与赤道画重一些：这两条是经纬度的**零点**，读图先认它们 */}
                <line className="is-prime" x1={180} y1={0} x2={180} y2={PLANE_H} />
                <line className="is-equator" x1={0} y1={90} x2={PLANE_W} y2={90} />
                {terminatorPath && (
                  <path className="plane-map-terminator" d={terminatorPath} />
                )}
              </svg>
              {/* 直射点常显：它给出"此刻哪条经线的地方是正午" */}
              <span
                className="plane-map-dot is-subsolar"
                style={planeDotAt(declination, clock.subsolarLon)}
                title="太阳直射点"
              />
              {marker && (
                <span
                  className="plane-map-dot is-marker"
                  style={planeDotAt(marker.lat, marker.lon)}
                  data-plane-marker="1"
                />
              )}
            </div>
            <p className="plane-map-axis">
              横轴＝经度（西 180° → 0° → 东 180°）· 纵轴＝纬度（北 90° → 0° → 南 90°）
              <br />
              红点＝所选点
              {marker ? `（${marker.lon.toFixed(1)}°, ${marker.lat.toFixed(1)}°）` : "（未选点）"}
              · 橙点＝太阳直射点 · 黄线＝晨昏线
            </p>
          </div>
        </section>

        {/* 经纬度是怎么量出来的（需求⑤）
            这一节回答的是"定义"，不是"读数"。光看球面上那些线，学生记不住"纬度是哪两条线的
            夹角"——**线是结果，夹角才是定义**。所以这里一手在三维球里把夹角画出来
            （透明地球 + 两条弧），一手配一张二维剖面示意图：三维图会随自转转到背面，
            二维示意图永远正对读者，讲定义时用它更稳。 */}
        <section>
          <h2>经纬度是怎么量出来的</h2>
          <div className="switch-row">
            <label>
              <input
                type="checkbox"
                checked={ghost}
                data-ghost="1"
                onChange={(event) => setGhost(event.target.checked)}
              />
              <span>透明地球（看见背面的经纬线）</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={geoOn}
                data-geo-angle="1"
                onChange={(event) => setGeoOn(event.target.checked)}
              />
              <span>夹角演示（画出两条夹角弧）</span>
            </label>
          </div>

          <GeoAngleDiagram lat={geoPoint.lat} lon={geoPoint.lon} />

          <div className="readout-row">
            <span>演示点</span>
            <strong>{marker ? "球面所选点" : "示例 · 北京"}</strong>
          </div>
          <div className="readout-row">
            <span>纬度（与赤道面的夹角）</span>
            <strong data-geo-lat="">
              {Math.abs(geoPoint.lat).toFixed(1)}°{geoPoint.lat >= 0 ? "N" : "S"}
            </strong>
          </div>
          <div className="readout-row">
            <span>经度（与本初子午面的夹角）</span>
            <strong data-geo-lon="">
              {Math.abs(geoPoint.lon).toFixed(1)}°{geoPoint.lon >= 0 ? "E" : "W"}
            </strong>
          </div>
          <p className="teach-note">
            <b>纬度</b>量的是<b>竖起来</b>的那个角：地心→该点 与 地心→赤道面 的夹角。
            所以纬度 0° 在赤道、90° 在极点，同一条纬线上各点纬度相同。
            <b>经度</b>量的是<b>转过去</b>的那个角：该点所在子午面 与 本初子午面 的夹角。
            所以经度 0° 在本初子午线上，向东为正、向西为负。
          </p>
          {!marker && (
            <p className="knob-hint">
              还没选点，先用示例点（北京 39.9°N, 116.4°E）。在「地球特写」下点球面即可换成该点。
            </p>
          )}
        </section>

        <section>
          <h2>公转与四季</h2>
          <div className="readout-row">
            <span>太阳直射点</span>
            <strong>{formatDecl(declination)}</strong>
          </div>
          <div className="readout-row">
            <span>日地距离</span>
            <strong>
              {distanceAu.toFixed(3)} AU{nearAphelion ? "（偏远）" : "（偏近）"}
            </strong>
          </div>
          <p className="season-note">{seasonNote}</p>
          <p className="teach-note">
            近日点约在 <b>1月初</b>（冬至后约两周），远日点约在 <b>7月初</b>（夏至后约两周）。
          </p>
          <p className="teach-note is-warn">
            注意：为便于观察，图中<b>轨道偏心率已放大</b>。实际上地球轨道非常接近正圆，
            <b>四季的形成主要取决于地轴倾斜（23.5°）</b>，而不是日地距离的远近 ——
            把左侧「地轴倾角」切到<b>垂直</b>档就能看出：日地距离照旧在变，四季却没了。
          </p>
        </section>

        {roster.length > 0 && (
          <section>
            <h2>观摩学生</h2>
            <p className="roster-names">
              {roster.map((student) => student.studentName).join("、")}
            </p>
          </section>
        )}
          </div>
        )}
      </aside>
      </div>

      {/* 底部「图层」栏（需求⑦）
          为什么把 19 个图层开关整块搬到下边栏，而不是继续留在右栏：
           ① 它原来一个人占了右栏将近一半高度，把「读数」挤到要滚两屏才看得全 ——
              而它与读数根本不是一类事（一个是"画什么"，一个是"读什么"）；
           ② 图层项全是短标签，**天生适合横排**：竖着排 19 行要 400+px，横排成四列只要
              四五行的位置，而且分组标题成了列头，比原来"标题 + 缩进列表"更一目了然；
           ③ 用户本来就有下边栏的位置（原先那条操作提示）—— 把提示收进这一栏的栏头，
              屏幕底部仍然是**一块**而不是两块，净高度反而省了。

          「经纬网」的疏密档位（需求⑥）就挂在线网那一列里：它改的就是这一列画什么线，
          放在别处又要跨栏找。 */}
      <div className={open.layers ? "globe-layers" : "globe-layers is-collapsed"}>
        <div className="layers-head">
          <span className="layers-title">图层</span>
          <span className="hint-text">
            拖动旋转 · 滚轮缩放 · 「地球特写」点球面读经纬度 · 「自由视角」右键拖动在太空移动
          </span>
          <button
            type="button"
            className="layers-toggle"
            title={open.layers ? "收起图层栏" : "展开图层栏"}
            onClick={() => togglePanel("layers")}
            data-layers-toggle="1"
          >
            {open.layers ? "收起 ▾" : "图层 ＋"}
          </button>
        </div>
        {open.layers && (
          <div className="layers-body">
            {LAYER_GROUPS.map((group) => (
              <div className="layer-col" key={group.title}>
                <div className="layer-group-title">{group.title}</div>
                <ul className="layer-list">
                  {group.items.map((item) => {
                    const disabledReason = layerDisabledReason(item.key, layers);
                    return (
                      <li key={item.key} className={disabledReason ? "is-disabled" : undefined}>
                        <label title={disabledReason ?? undefined}>
                          <input
                            type="checkbox"
                            checked={layers[item.key]}
                            disabled={disabledReason !== null}
                            data-layer={item.key}
                            onChange={() => toggleLayer(item.key)}
                          />
                          <span className="layer-chip" style={{ background: item.color }} />
                          <span className="layer-label">{item.label}</span>
                        </label>
                        {disabledReason && (
                          <span className="layer-disabled-note">{disabledReason}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {group.title === "线网" && (
                  <div className="seg-row is-grid-step" role="group" aria-label="经纬网疏密">
                    <span className="seg-label">疏密</span>
                    {GRID_STEPS.map((step) => (
                      <button
                        key={step}
                        type="button"
                        className={gridStep === step ? "is-on" : ""}
                        data-grid-step={step}
                        title={`经线与纬线每 ${step}° 一条`}
                        onClick={() => setGridStep(step)}
                      >
                        {step}°
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {/* 五带图例只在该图层打开时出现：它是那一项的注解，不是常驻装饰 */}
            {layers.climate && (
              <div className="zone-legend">
                <span>
                  <i style={{ background: "#59b8ff" }} />
                  北寒带 66.5°N 以北
                </span>
                <span>
                  <i style={{ background: "#4ddc7a" }} />
                  北温带 23.5°~66.5°N
                </span>
                <span>
                  <i style={{ background: "#ff6b3d" }} />
                  热带 23.5°N~23.5°S
                </span>
                <span>
                  <i style={{ background: "#4ddc7a" }} />
                  南温带 23.5°~66.5°S
                </span>
                <span>
                  <i style={{ background: "#59b8ff" }} />
                  南寒带 66.5°S 以南
                </span>
                <span className="zone-legend-note">
                  球面上的五带文字标注只在「地球特写」视角显示
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
