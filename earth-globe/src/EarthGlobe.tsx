import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface PlayerInfo {
  studentId: number;
  studentName: string;
  className: string | null;
  studentNo?: string;
}

export interface LayerState {
  texture: boolean;
  grid: boolean;
  equator: boolean;
  tropics: boolean;
  polar: boolean;
  meridian: boolean;
  axis: boolean;
  stars: boolean;
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

type ViewKey = "orbit" | "top" | "earth";

const DEG = Math.PI / 180;
const EARTH_TILT = 23.44;
const LINE_RADIUS = 1.004;

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

/** 由公转位置求真近点角对应的太阳直射点纬度（太阳直射点纬度 = 太阳方向的赤纬） */
function declinationForNu(nuDeg: number): number {
  const p = orbitPosition(nuDeg).multiplyScalar(-1).normalize();
  return Math.asin(THREE.MathUtils.clamp(p.dot(AXIS_WORLD), -1, 1)) / DEG;
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
      opacity: 0.22
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

/* ---------------- 平行太阳光线束的偏移排布 ----------------
   只保留“正午面”——即同时包含日地连线和地轴所在竖直方向的那个平面，光线在这个平面内上下排布。
   竖向偏移量取 ±1 / ±0.5 / 0（单位＝地球显示半径），含义：
     ±1  最上、最下两条，恰好与地球相切、擦着球面边缘；夏至/冬至时切点正落在极圈上，
         这也是极昼极夜范围的几何来源；春秋分时切点落在南北两极。
     ±0.5 两条，射到纬度约 30° 处，把光线束均匀撑开。
     0    正中间一条为太阳直射光线，绘制时用另一种颜色（橙红）区分。 */
const RAY_PLANE_OFFSETS = [-1, -0.5, 0, 0.5, 1];
const RAY_OFFSETS: [number, number][] = RAY_PLANE_OFFSETS.map(
  (v) => [0, v] as [number, number]
);

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
  autoRotateWanted: boolean;
  setOrbitNu: (nuDeg: number) => void;
  readDeclination: () => number;
  readNu: () => number;
  setView: (key: ViewKey) => void;
  setSpin: (on: boolean) => void;
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
  onNuChange: ((nu: number) => void) | null;
  onViewChange: ((key: ViewKey) => void) | null;
  dispose: () => void;
  placeMarker: (lat: number, lon: number) => void;
  clearMarker: () => void;
  focusLatLon: (lat: number, lon: number, distance?: number) => void;
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

  /* ---- 地球：earthAnchor（公转位置）→ tiltGroup（地轴姿态）---- */
  const earthAnchor = new THREE.Group();
  scene.add(earthAnchor);
  const tiltGroup = new THREE.Group();
  earthAnchor.add(tiltGroup);

  const earthMaterial = new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: null },
      uHasTex: { value: 0 },
      uDayColor: { value: new THREE.Color(0x2a4d7f) },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) }
    },
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
      uniform float uHasTex;
      uniform vec3 uDayColor;
      uniform vec3 uSunDir;
      varying vec2 vUv;
      varying vec3 vNormalW;
      void main() {
        float d = dot(normalize(vNormalW), normalize(uSunDir));
        float dayAmt = smoothstep(-0.10, 0.10, d);
        vec3 day = uHasTex > 0.5 ? texture2D(dayMap, vUv).rgb : uDayColor.rgb;
        vec3 night = day * 0.10 + vec3(0.010, 0.024, 0.055);
        gl_FragColor = vec4(mix(night, day, dayAmt), 1.0);
      }
    `
  });
  const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), earthMaterial);
  tiltGroup.add(earthMesh);

  // 地球所属的“环境”节点：与地球同位置，但不随地球自转轴倾斜（晨昏线、光线都在世界方向下定义）
  const envGroup = new THREE.Group();
  earthAnchor.add(envGroup);

  /* ---- 赤道 / 回归线 / 极圈 / 本初子午线（鲜明配色 + 经纬度标签） ---- */
  const labelLon = 105; // 标签统一放在面向特写视角的东侧经线上
  function labelAt(latDeg: number, lonDeg: number, text: string, color: string, lift = 1.06) {
    const sprite = makeLabelSprite(text, color);
    sprite.position.copy(localFromLatLon(latDeg, lonDeg).multiplyScalar(lift));
    return sprite;
  }

  const equatorGroup = new THREE.Group();
  equatorGroup.add(makeParallelRing(0, 0.010, COLORS.equator));
  equatorGroup.add(labelAt(0, labelLon, "赤道 0°", "#ff6b5e"));
  tiltGroup.add(equatorGroup);

  const tropicsGroup = new THREE.Group();
  tropicsGroup.add(makeParallelRing(EARTH_TILT, 0.007, COLORS.tropics));
  tropicsGroup.add(makeParallelRing(-EARTH_TILT, 0.007, COLORS.tropics));
  tropicsGroup.add(labelAt(EARTH_TILT, labelLon, "北回归线 23.5°N", "#ffc247"));
  tropicsGroup.add(labelAt(-EARTH_TILT, labelLon, "南回归线 23.5°S", "#ffc247"));
  tiltGroup.add(tropicsGroup);

  const polarGroup = new THREE.Group();
  polarGroup.add(makeParallelRing(66.56, 0.006, COLORS.polar));
  polarGroup.add(makeParallelRing(-66.56, 0.006, COLORS.polar));
  polarGroup.add(labelAt(66.56, labelLon, "北极圈 66.5°N", "#6ee9ff"));
  polarGroup.add(labelAt(-66.56, labelLon, "南极圈 66.5°S", "#6ee9ff"));
  tiltGroup.add(polarGroup);

  const meridianGroup = new THREE.Group();
  meridianGroup.add(makeMeridianRing(0, 0.010, COLORS.meridian));
  meridianGroup.add(labelAt(42, 0, "本初子午线 0°", "#b39cff", 1.07));
  meridianGroup.add(labelAt(42, 180, "180°", "#b39cff", 1.07));
  tiltGroup.add(meridianGroup);

  const gridGroup = new THREE.Group();
  for (const lat of [30, -30, 60, -60]) {
    gridGroup.add(makeThinCircle(lat, "parallel"));
  }
  for (let lon = 0; lon < 180; lon += 30) {
    gridGroup.add(makeThinCircle(lon, "meridian"));
  }
  tiltGroup.add(gridGroup);

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
  zoneGroup.add(labelAt(0, 148, "太阳直射带", "#ffd76a", 1.16));
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

  /* ---- 平行太阳光线束 ---- */
  const rayGroup = new THREE.Group();
  const rayGeometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  const rayMaterial = new THREE.MeshBasicMaterial({
    color: COLORS.sunRay,
    transparent: true,
    opacity: 0.5,
    depthWrite: false
  });
  // 中间那条是太阳直射光线，用醒目的橙红色区分，并略微加粗
  const rayCoreMaterial = new THREE.MeshBasicMaterial({
    color: COLORS.sunRayCore,
    transparent: true,
    opacity: 0.98,
    depthWrite: false
  });
  const rayMeshes: THREE.Mesh[] = [];
  const rayRadii: number[] = [];
  RAY_OFFSETS.forEach(([ox, oy]) => {
    const isCore = ox === 0 && oy === 0;
    const mesh = new THREE.Mesh(rayGeometry, isCore ? rayCoreMaterial : rayMaterial);
    rayGroup.add(mesh);
    rayMeshes.push(mesh);
    rayRadii.push(isCore ? 0.032 : 0.017);
  });
  envGroup.add(rayGroup);

  /* ---- 点击标记 ---- */
  const markerGroup = new THREE.Group();
  tiltGroup.add(markerGroup);

  function clearMarker() {
    markerGroup.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        const material = child.material;
        if (material instanceof THREE.Material) {
          material.dispose();
        }
      }
    });
    markerGroup.clear();
  }

  function placeMarker(lat: number, lon: number) {
    clearMarker();
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
  }

  /* ---- 公转状态 ---- */
  let nu = SEASONS[1].nu;
  let declination = declinationForNu(nu);
  let spinWanted = false;
  const earthPos = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const rayQuat = new THREE.Quaternion();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const termE1 = new THREE.Vector3();
  const termE2 = new THREE.Vector3();
  const viewState: { current: ViewKey } = { current: "orbit" };
  let onNuChange: ((value: number) => void) | null = null;
  let onViewChange: ((key: ViewKey) => void) | null = null;

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

  function updateRays() {
    const up = Math.abs(sunDir.y) > 0.94 ? new THREE.Vector3(1, 0, 0) : WORLD_UP;
    e1.crossVectors(sunDir, up).normalize();
    e2.crossVectors(sunDir, e1).normalize();
    const uStart = Math.max(1.3, earthPos.length() - SUN_RADIUS * 0.5);
    rayQuat.setFromUnitVectors(RAY_AXIS, sunDir);
    for (let i = 0; i < rayMeshes.length; i++) {
      const [ox, oy] = RAY_OFFSETS[i];
      // 垂直偏移（相对光线方向的垂面）
      const perp = tmpV2
        .copy(e1)
        .multiplyScalar(ox)
        .addScaledVector(e2, oy);
      const r2 = ox * ox + oy * oy;
      // 与地球球面（半径 1）的相切/相交点：只有 |o|≤1 的光线才会落在昼半球上
      const uEnd = r2 < 1 ? Math.sqrt(1 - r2) : 0;
      const length = Math.max(0.08, uStart - uEnd);
      const mesh = rayMeshes[i];
      mesh.position.copy(perp).addScaledVector(sunDir, (uStart + uEnd) / 2);
      mesh.quaternion.copy(rayQuat);
      mesh.scale.set(rayRadii[i], length, rayRadii[i]);
    }
  }

  /** 太阳直射点标签：沿日地连线外推的距离，以及在屏幕上「让开直射光线」的下移量（世界单位） */
  const SUBSOLAR_LABEL_DIST = 1.32;
  const SUBSOLAR_LABEL_DROP = 0.34;

  const tmpCamUp = new THREE.Vector3();
  const tmpDropDir = new THREE.Vector3();

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
    nu = ((value % 360) + 360) % 360;
    orbitPosition(nu, earthPos);
    earthAnchor.position.copy(earthPos);

    // 太阳方向（地球 → 太阳）
    sunDir.copy(earthPos).multiplyScalar(-1).normalize();

    // 地轴指向空间固定方向 AXIS_WORLD；再绕地轴自转，使太阳始终位于本地经度 SUBSOLAR_LON，
    // 这样特写视角下晨昏线永远纵贯画面中央、经纬度标签也始终朝向镜头。
    const qBase = new THREE.Quaternion().setFromUnitVectors(WORLD_UP, AXIS_WORLD);
    const sLocal = tmpV.copy(sunDir).applyQuaternion(qBase.clone().invert());
    const lam = Math.atan2(-sLocal.z, sLocal.x);
    const spin = new THREE.Quaternion().setFromAxisAngle(
      WORLD_UP,
      lam - SUBSOLAR_LON * DEG
    );
    tiltGroup.quaternion.copy(qBase).multiply(spin);

    declination = Math.asin(THREE.MathUtils.clamp(sunDir.dot(AXIS_WORLD), -1, 1)) / DEG;

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

    // 特写视角跟随地球
    if (viewState.current === "earth") {
      applyEarthView();
    }
  }

  /* ---- 视角预设 ---- */
  function applyOrbitView() {
    viewState.current = "orbit";
    controls.target.set(0, 0, 0);
    const d = ORBIT_A * 2.65;
    camera.position.set(d * 0.12, d * 0.66, d * 0.74);
    controls.update();
    onViewChange?.("orbit");
  }

  function applyTopView() {
    viewState.current = "top";
    controls.target.set(0, 0, 0);
    camera.position.set(0.0016, ORBIT_A * 2.95, 0.0016);
    controls.update();
    onViewChange?.("top");
  }

  function applyEarthView() {
    viewState.current = "earth";
    controls.target.copy(earthPos);
    const dir = localFromLatLon(12, labelLon).applyQuaternion(tiltGroup.quaternion).normalize();
    camera.position.copy(earthPos).addScaledVector(dir, 3.0);
    controls.update();
    onViewChange?.("earth");
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
      if (now - lastNotify > 140) {
        lastNotify = now;
        onNuChange?.(nu);
      }
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
    renderer.render(scene, camera);
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
    earthMaterial.uniforms.dayMap.value?.dispose();
    earthMaterial.dispose();
    renderer.dispose();
    if (renderer.domElement.parentElement === container) {
      container.removeChild(renderer.domElement);
    }
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
    autoRotateWanted: true,
    setOrbitNu,
    readDeclination: () => declination,
    readNu: () => nu,
    setView: (key: ViewKey) => {
      if (key === "orbit") {
        applyOrbitView();
      } else if (key === "top") {
        applyTopView();
      } else {
        applyEarthView();
      }
    },
    setSpin: (on: boolean) => {
      spinWanted = on;
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
    onNuChange: null,
    onViewChange: null,
    dispose,
    placeMarker,
    clearMarker,
    focusLatLon: (lat: number, lon: number, distance = 3) => {
      viewState.current = "earth";
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

  // 纹理异步加载（失败时保持深蓝球体，线条教学仍可用）。
  new THREE.TextureLoader().load(
    "./textures/earth.jpg",
    (texture) => {
      texture.colorSpace = THREE.NoColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      engine.earthTexture = texture;
      earthMaterial.uniforms.dayMap.value = texture;
      earthMaterial.uniforms.uHasTex.value = 1;
    },
    undefined,
    () => {
      // 加载失败：保持纯色球体。
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

const LAYER_DEFS: { key: keyof LayerState; label: string; color: string }[] = [
  { key: "texture", label: "地球影像", color: "#3f6b4f" },
  { key: "grid", label: "经纬网（30°）", color: "#ffffff" },
  { key: "equator", label: "赤道 0°", color: "#ff3b30" },
  { key: "tropics", label: "南北回归线 23.5°", color: "#ffa502" },
  { key: "polar", label: "南北极圈 66.5°", color: "#2ee6ff" },
  { key: "meridian", label: "本初子午线 0°", color: "#8f6bff" },
  { key: "axis", label: "地轴", color: "#f2e8d5" },
  { key: "orbit", label: "公转轨道·近远日点", color: "#9fb6d8" },
  { key: "terminator", label: "晨昏线（昼夜分界）", color: "#ffd34d" },
  { key: "sunDisplay", label: "太阳", color: "#ffdf6b" },
  { key: "rays", label: "平行太阳光", color: "#ffc23d" },
  { key: "subsolar", label: "太阳直射点", color: "#ff8c3a" },
  { key: "zone", label: "太阳直射带（回归线间）", color: "#ffc23d" },
  { key: "stars", label: "星空背景", color: "#8ea2c9" }
];

const VIEW_DEFS: { key: ViewKey; label: string }[] = [
  { key: "orbit", label: "公转全景" },
  { key: "top", label: "俯视轨道" },
  { key: "earth", label: "地球特写" }
];

export default function EarthGlobe({ roster }: { roster: PlayerInfo[] }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const markerLastRef = useRef<MarkerInfo | null>(null);

  const [layers, setLayers] = useState<LayerState>({
    texture: true,
    grid: true,
    equator: true,
    tropics: true,
    polar: false,
    meridian: true,
    axis: true,
    stars: true,
    orbit: true,
    terminator: true,
    sunDisplay: true,
    rays: true,
    subsolar: true,
    zone: true
  });
  const [autoRotate, setAutoRotate] = useState(true);
  const [marker, setMarker] = useState<MarkerInfo | null>(null);
  const [nu, setNu] = useState<number>(SEASONS[1].nu);
  const [view, setView] = useState<ViewKey>("orbit");
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) {
      return;
    }
    const engine = buildEngine(container);
    engineRef.current = engine;
    engine.onNuChange = (value: number) => setNu(value);
    engine.onViewChange = (key: ViewKey) => setView(key);

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
      readState: () => ({
        nu: engine.readNu(),
        decl: engine.readDeclination()
      }),
      readGeometry: () => engine.readGeometry(),
      readSubsolarLabelBox: () => engine.readSubsolarLabelBox(),
      view: (key: ViewKey) => {
        if (key === "earth") {
          engine.controls.autoRotate = false;
          engine.autoRotateWanted = false;
        }
        engine.setView(key);
      }
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
    engine.starsPoints.visible = layers.stars;
    engine.terminatorMesh.visible = layers.terminator;
    engine.terminatorLabel.visible = layers.terminator;
    engine.sunGroup.visible = layers.sunDisplay;
    engine.rayGroup.visible = layers.rays;
    engine.subsolarGroup.visible = layers.subsolar;
    engine.zoneGroup.visible = layers.zone;
    const hasTex = layers.texture && engine.earthTexture ? 1 : 0;
    if (engine.earthMaterial.uniforms.uHasTex.value !== hasTex) {
      engine.earthMaterial.uniforms.uHasTex.value = hasTex;
      engine.earthMaterial.uniforms.dayMap.value = layers.texture
        ? engine.earthTexture
        : null;
    }
  }, [layers]);

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

  // 公转位置变化（公转演示运行期间由引擎自行推进，避免回写造成抖动）
  useEffect(() => {
    if (spinning) {
      return;
    }
    engineRef.current?.setOrbitNu(nu);
  }, [nu, spinning]);

  function toggleLayer(key: keyof LayerState) {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
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
    if (key === "earth") {
      // 特写视角用于讲解昼夜，关掉自动旋转以保持晨昏线取景稳定
      setAutoRotate(false);
    }
  }

  function resetView() {
    applyView("orbit");
  }

  function clearMarkerClick() {
    engineRef.current?.clearMarker();
    setMarker(null);
    markerLastRef.current = null;
  }

  const declination = declinationForNu(nu);

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
  const seasonNote =
    nearestD < 1.0
      ? SEASON_NOTES[nearestKey]
      : declination > 0
        ? `太阳直射点位于北纬 ${declination.toFixed(1)}°。直射点在南北回归线之间往返移动，此时北半球昼长夜短。`
        : declination < 0
          ? `太阳直射点位于南纬 ${Math.abs(declination).toFixed(1)}°。直射点在南北回归线之间往返移动，此时北半球昼短夜长。`
          : "太阳直射赤道，全球昼夜等长。";

  const distanceAu = 1 - ORBIT_E * Math.cos(nu * DEG);
  const nearAphelion = distanceAu > 1;

  return (
    <div className="globe-app">
      <div className="globe-canvas" ref={mountRef} />

      <header className="globe-title">
        <h1>寰宇地球仪</h1>
        <span>公转轨道 · 昼夜四季交互演示</span>
      </header>

      <aside className="globe-panel">
        <section>
          <h2>图层</h2>
          <ul className="layer-list">
            {LAYER_DEFS.map((item) => (
              <li key={item.key}>
                <label>
                  <input
                    type="checkbox"
                    checked={layers[item.key]}
                    onChange={() => toggleLayer(item.key)}
                  />
                  <span className="layer-chip" style={{ background: item.color }} />
                  <span className="layer-label">{item.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>公转与四季</h2>
          <div className="season-grid">
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
          <label className="decl-slider">
            <span>公转位置</span>
            <input
              type="range"
              min={0}
              max={360}
              step={0.5}
              value={nu}
              onChange={(event) => {
                setSpinning(false);
                setNu(Number(event.target.value));
              }}
            />
            <strong>{nu.toFixed(0)}°</strong>
          </label>
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
          <button
            type="button"
            className={spinning ? "spin-btn is-on" : "spin-btn"}
            onClick={() => setSpinning((v) => !v)}
          >
            {spinning ? "公转演示：运行中" : "公转演示：已暂停"}
          </button>
          <p className="season-note">{seasonNote}</p>
        </section>

        <section>
          <h2>坐标读取</h2>
          {marker ? (
            <div className="coord-card">
              <div className="coord-row">{formatLat(marker.lat)}</div>
              <div className="coord-row">{formatLon(marker.lon)}</div>
              <div className="coord-decimal">
                {marker.lat.toFixed(2)}°, {marker.lon.toFixed(2)}°
              </div>
              <button type="button" className="coord-clear" onClick={clearMarkerClick}>
                清除标记
              </button>
            </div>
          ) : (
            <p className="coord-empty">
              切到「地球特写」后点击球面任意位置，即可读取该点的经纬度。
            </p>
          )}
        </section>

        <section>
          <h2>视角</h2>
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
        </section>

        <section>
          <h2>教学提示</h2>
          <p className="teach-note">
            近日点约在 <b>1月初</b>（冬至后约两周），远日点约在 <b>7月初</b>（夏至后约两周）。
          </p>
          <p className="teach-note is-warn">
            注意：为便于观察，图中<b>轨道偏心率已放大</b>。实际上地球轨道非常接近正圆，
            <b>四季的形成主要取决于地轴倾斜（23.5°）</b>，而不是日地距离的远近。
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
      </aside>

      <footer className="globe-hint">
        拖动旋转 · 滚轮缩放 · 俯视轨道看四个节气位置 · 切「地球特写」点击球面读经纬度
      </footer>
    </div>
  );
}
