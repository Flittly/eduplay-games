/**
 * 三维地形沙盘：一层真实高程的中国地形网面 + 海面 + 相机控制。
 *
 * ## 一张网面，两个高度来源
 *
 * 每个顶点的视觉高度是：
 *
 *     y = BASE_LIFT + (alt[k] × lift[k] + add[k]) × ALT_TO_WORLD
 *
 *  - `alt`：真实 DEM 高程（米），只读。
 *  - `lift[0..1]`：这块地**被塑出来了多少**。地形区拖对之后从 0 涨到 1，
 *    于是"平地上长出一片高原"；山脉拖对后它会在**走带走廊**里涨到 1，
 *    让那道山真正按它的实测海拔立起来。
 *  - `add`（米）：沿折线叠的一条高斯脊，山脉专用。全国 DEM 是 11.9 km/格，
 *    太行山、南岭这种宽 50~80 km 的山脉在这个尺度上只剩几格，脊线会被抹平；
 *    靠 `add` 把脊挑出来，配合 `lift` 放出的真实 DEM，两条叠加才既像山又落在
 *    正确的地形背景上。
 *
 * ## 未塑形的地方为什么是灰的
 *
 * `lift = 0` 时若直接按高程 0 上色，会得到一大片和沿海平原同色的浅绿，
 * 学生分不清"这块我还没放"和"这块本来就是低地"。所以未塑形统一用米灰色，
 * 塑形后才切到分层设色 —— 拖动之后同时拿到**高度**和**颜色**两重反馈。
 *
 * ## 为什么要有裙边
 *
 * 只渲染地表会得到一块悬空的纸片，一转到侧视角就露馅。这里沿陆地边界
 * 往下拉一圈侧壁，整块变成地质标本那样的"托盘"，同时裙边也跟着地形高度走，
 * 隆起之后不会在边缘露出空隙。
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  ALT_TO_WORLD,
  CHINA_DEM,
  GRID_H,
  GRID_W,
  SPAN_X,
  SPAN_Z,
  latToZ,
  lonToX,
  xToLon,
  zToLat
} from "./geo";

/** 未塑形地面的基准厚度（世界单位），让它略高于海面 */
const BASE_LIFT = 0.005;
/** 裙边往下伸多少（世界单位） */
const SKIRT_DEPTH = 0.10;
const SEA_COLOR = 0x9dc0da;
const UNSHAPED = new THREE.Color(0xded7c9);
const SKIRT_COLOR = new THREE.Color(0xbdb2a0);

/** 分层设色：低地绿 → 丘陵黄 → 高原褐 → 雪山白 */
const HYPSO: Array<[number, number]> = [
  [0, 0x7bab7f], [150, 0x93b87a], [500, 0xc6c078], [1200, 0xd0b473],
  [2200, 0xc09869], [3200, 0xb4835e], [4200, 0xa67d6d], [5200, 0xc2b3a9],
  [6000, 0xeae6e1], [7600, 0xffffff]
];

export function hypsoColor(alt: number, out = new THREE.Color()): THREE.Color {
  if (alt <= HYPSO[0][0]) {
    return out.setHex(HYPSO[0][1]);
  }
  for (let k = 0; k < HYPSO.length - 1; k++) {
    const [a, ca] = HYPSO[k];
    const [b, cb] = HYPSO[k + 1];
    if (alt <= b) {
      const t = (alt - a) / (b - a);
      out.setHex(ca);
      out.lerp(new THREE.Color(cb), t);
      return out;
    }
  }
  return out.setHex(HYPSO[HYPSO.length - 1][1]);
}

export interface PickResult {
  lon: number;
  lat: number;
}

export interface TerrainView {
  /**
   * 重新计算顶点位置与颜色。
   * `animating=true` 时跳算法线（34 万个三角形要 20~50 ms，逐帧算会卡），
   * 动画收尾时传 false 补算一次。
   */
  refresh(alt: Float32Array, lift: Float32Array, add: Float32Array, animating: boolean): void;
  pick(clientX: number, clientY: number): PickResult | null;
  /** 经纬度 → 画布内的像素坐标，用于给提示气泡定位 */
  project(lon: number, lat: number, heightM: number): { x: number; y: number } | null;
  resetCamera(): void;
  dispose(): void;
}

export function createTerrainView(canvas: HTMLCanvasElement, land: Uint8Array): TerrainView {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b3550);
  scene.fog = new THREE.Fog(0x1b3550, 110, 260);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 500);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = 1.32;
  controls.minDistance = 20;
  controls.maxDistance = 150;
  controls.screenSpacePanning = false;
  controls.enablePan = true;

  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.1);
  sun.position.set(-45, 80, 45);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xc2d4ea, 0.55);
  fill.position.set(55, 35, -45);
  scene.add(fill);

  // ---------------- 海面 ----------------
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(SPAN_X * 3, SPAN_Z * 3),
    new THREE.MeshBasicMaterial({ color: SEA_COLOR })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = 0;
  scene.add(sea);

  // ---------------- 地形网面 ----------------
  const dx = SPAN_X / (GRID_W - 1);
  const dz = SPAN_Z / (GRID_H - 1);
  const x0 = -SPAN_X / 2;
  const z0 = -SPAN_Z / 2;

  const geo = new THREE.PlaneGeometry(SPAN_X, SPAN_Z, GRID_W - 1, GRID_H - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  pos.setUsage(THREE.DynamicDrawUsage);
  const colorAttr = new THREE.BufferAttribute(new Float32Array(GRID_W * GRID_H * 3), 3);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("color", colorAttr);

  // 剔除任何一个顶点落在境外的三角形 —— 否则中国轮廓外会出现一整圈斜坡
  const index: number[] = [];
  for (let j = 0; j < GRID_H - 1; j++) {
    for (let i = 0; i < GRID_W - 1; i++) {
      const a = j * GRID_W + i;
      const b = (j + 1) * GRID_W + i;
      const c = (j + 1) * GRID_W + i + 1;
      const d = j * GRID_W + i + 1;
      if (land[a] && land[b] && land[d]) {
        index.push(a, b, d);
      }
      if (land[b] && land[c] && land[d]) {
        index.push(b, c, d);
      }
    }
  }
  geo.setIndex(index);
  geo.computeVertexNormals();

  const terrainMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide
  });
  const terrain = new THREE.Mesh(geo, terrainMat);
  scene.add(terrain);

  // ---------------- 裙边 ----------------
  const skirtIdx: number[] = [];
  const sPos: number[] = [];
  const sNor: number[] = [];
  const sCol: number[] = [];
  const sTri: number[] = [];
  let sBase = 0;

  function pushEdge(iA: number, jA: number, iB: number, jB: number, nx: number, nz: number) {
    const ax = x0 + iA * dx;
    const az = z0 + jA * dz;
    const bx = x0 + iB * dx;
    const bz = z0 + jB * dz;
    sPos.push(ax, 0, az, bx, 0, bz, ax, -SKIRT_DEPTH, az, bx, -SKIRT_DEPTH, bz);
    for (let k = 0; k < 4; k++) {
      sNor.push(nx, 0, nz);
      sCol.push(SKIRT_COLOR.r, SKIRT_COLOR.g, SKIRT_COLOR.b);
    }
    const b = sBase;
    if (nx + nz > 0) {
      sTri.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    } else {
      sTri.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    skirtIdx.push(jA * GRID_W + iA, jB * GRID_W + iB, jA * GRID_W + iA, jB * GRID_W + iB);
    sBase += 4;
  }

  for (let j = 0; j < GRID_H; j++) {
    for (let i = 0; i < GRID_W; i++) {
      const k = j * GRID_W + i;
      if (!land[k]) {
        continue;
      }
      if (i === 0 || !land[k - 1]) {
        pushEdge(i, j, i, j + 1, -1, 0);
      }
      if (i === GRID_W - 1 || !land[k + 1]) {
        pushEdge(i + 1, j, i + 1, j + 1, 1, 0);
      }
      if (j === 0 || !land[k - GRID_W]) {
        pushEdge(i, j, i + 1, j, 0, -1);
      }
      if (j === GRID_H - 1 || !land[k + GRID_W]) {
        pushEdge(i, j + 1, i + 1, j + 1, 0, 1);
      }
    }
  }

  const skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute("position", new THREE.Float32BufferAttribute(sPos, 3));
  skirtGeo.setAttribute("normal", new THREE.Float32BufferAttribute(sNor, 3));
  skirtGeo.setAttribute("color", new THREE.Float32BufferAttribute(sCol, 3));
  skirtGeo.setIndex(sTri);
  const skirtPosition = skirtGeo.attributes.position as THREE.BufferAttribute;
  skirtPosition.setUsage(THREE.DynamicDrawUsage);
  const skirt = new THREE.Mesh(skirtGeo, terrainMat);
  scene.add(skirt);

  // ---------------- 相机 ----------------
  function resetCamera() {
    camera.position.set(0, SPAN_Z * 0.80, SPAN_Z * 1.02);
    controls.target.set(0, 0.1, SPAN_Z * 0.02);
    controls.update();
  }

  // ---------------- 渲染循环 ----------------
  let needsRender = true;
  function loop() {
    requestAnimationFrame(loop);
    if (controls.update() || needsRender) {
      renderer.render(scene, camera);
      needsRender = false;
    }
  }

  function resize() {
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    if (canvas.width !== w || canvas.height !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      needsRender = true;
    }
  }

  // ---------------- 更新 ----------------
  const tmpColor = new THREE.Color();
  let curAlt: Float32Array | null = null;
  let curLift: Float32Array | null = null;
  let curAdd: Float32Array | null = null;

  function heightWorldAt(lon: number, lat: number): number {
    if (!curAlt || !curLift || !curAdd) {
      return BASE_LIFT;
    }
    const i = Math.min(GRID_W - 1, Math.max(0, Math.round(
      ((lon - CHINA_DEM.lon0) / (CHINA_DEM.lon1 - CHINA_DEM.lon0)) * (GRID_W - 1))));
    const j = Math.min(GRID_H - 1, Math.max(0, Math.round(
      ((CHINA_DEM.lat1 - lat) / (CHINA_DEM.lat1 - CHINA_DEM.lat0)) * (GRID_H - 1))));
    const k = j * GRID_W + i;
    return BASE_LIFT + (curAlt[k] * curLift[k] + curAdd[k]) * ALT_TO_WORLD;
  }

  function refresh(alt: Float32Array, lift: Float32Array, add: Float32Array, animating: boolean) {
    curAlt = alt;
    curLift = lift;
    curAdd = add;
    resize();
    const arr = pos.array as Float32Array;
    const col = colorAttr.array as Float32Array;
    const n = GRID_W * GRID_H;
    for (let k = 0; k < n; k++) {
      const hM = alt[k] * lift[k] + add[k];
      arr[k * 3 + 1] = BASE_LIFT + hM * ALT_TO_WORLD;
      if (lift[k] > 0.02 || add[k] > 1) {
        hypsoColor(hM, tmpColor);
      } else {
        tmpColor.copy(UNSHAPED);
      }
      col[k * 3] = tmpColor.r;
      col[k * 3 + 1] = tmpColor.g;
      col[k * 3 + 2] = tmpColor.b;
    }
    pos.needsUpdate = true;
    colorAttr.needsUpdate = true;

    const sp = skirtPosition.array as Float32Array;
    for (let q = 0, m = skirtIdx.length; q < m; q += 4) {
      const kA = skirtIdx[q];
      const kB = skirtIdx[q + 1];
      const hA = BASE_LIFT + (alt[kA] * lift[kA] + add[kA]) * ALT_TO_WORLD;
      const hB = BASE_LIFT + (alt[kB] * lift[kB] + add[kB]) * ALT_TO_WORLD;
      const base = q * 3;
      sp[base + 1] = hA;
      sp[base + 4] = hB;
      sp[base + 7] = hA;
      sp[base + 10] = hB;
    }
    skirtPosition.needsUpdate = true;

    if (!animating) {
      geo.computeVertexNormals();
      geo.attributes.normal.needsUpdate = true;
    }
    needsRender = true;
  }

  // ---------------- 拾取 ----------------
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const ndc = new THREE.Vector2();

  function pick(clientX: number, clientY: number): PickResult | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    plane.constant = 0;
    if (!raycaster.ray.intersectPlane(plane, hit)) {
      return null;
    }
    // 地形是立体的：直接打 y=0 平面在高处会明显偏，用当前高度迭代收敛
    for (let pass = 0; pass < 3; pass++) {
      const h = heightWorldAt(xToLon(hit.x), zToLat(hit.z));
      plane.constant = -h;
      if (!raycaster.ray.intersectPlane(plane, hit)) {
        return null;
      }
    }
    return { lon: xToLon(hit.x), lat: zToLat(hit.z) };
  }

  function project(lon: number, lat: number, heightM: number) {
    const v = new THREE.Vector3(lonToX(lon), BASE_LIFT + heightM * ALT_TO_WORLD + 0.03, latToZ(lat));
    v.project(camera);
    const rect = canvas.getBoundingClientRect();
    if (v.z > 1) {
      return null;
    }
    return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height };
  }

  function dispose() {
    controls.dispose();
    geo.dispose();
    skirtGeo.dispose();
    terrainMat.dispose();
    renderer.dispose();
  }

  resetCamera();
  resize();
  loop();

  return { refresh, pick, project, resetCamera, dispose };
}
