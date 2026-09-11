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
  terminator: boolean;
  sunDisplay: boolean;
  subsolar: boolean;
  zone: boolean;
}

interface MarkerInfo {
  lat: number;
  lon: number;
}

const DEG = Math.PI / 180;
const EARTH_TILT = 23.44;
const LINE_RADIUS = 1.004;
/** 太阳方位（教学模拟中固定）：东经 15°，与默认视角（东经 105°）成 90°，晨昏线纵贯视野中央、昼夜各半。 */
const SUN_AZIMUTH_LON = 15;
const SUN_DISTANCE = 3.6;

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
  subsolar: 0xff8c3a,
  zone: 0xffc23d
};

const SEASONS = [
  { key: "chunfen", label: "春分", decl: 0, date: "3月21日前后" },
  { key: "xiazhi", label: "夏至", decl: 23.44, date: "6月22日前后" },
  { key: "qiufen", label: "秋分", decl: 0, date: "9月23日前后" },
  { key: "dongzhi", label: "冬至", decl: -23.44, date: "12月22日前后" }
] as const;

type SeasonKey = (typeof SEASONS)[number]["key"];

const SEASON_NOTES: Record<SeasonKey, string> = {
  chunfen: "太阳直射赤道，晨昏线正好经过南北两极，全球昼夜等长。",
  xiazhi: "太阳直射北回归线（23.5°N），北半球昼最长夜最短，北极圈及以北出现极昼。",
  qiufen: "太阳直射赤道，晨昏线正好经过南北两极，全球昼夜等长。",
  dongzhi: "太阳直射南回归线（23.5°S），北半球夜最长昼最短，北极圈及以北出现极夜。"
};

interface Engine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
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
  earthTexture: THREE.Texture | null;
  autoRotateWanted: boolean;
  dispose: () => void;
  placeMarker: (lat: number, lon: number) => void;
  clearMarker: () => void;
  focusLatLon: (lat: number, lon: number, distance?: number) => void;
  setSunDeclination: (declDeg: number) => void;
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

/** 太阳光晕精灵。 */
function makeGlowSprite(color: string, scale: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.35, "rgba(255,200,80,0.55)");
    gradient.addColorStop(1, "rgba(255,180,60,0)");
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
    200
  );
  // 默认面向东亚（约北纬 15°、东经 105°），适合中国课堂。
  camera.position.copy(localFromLatLon(15, 105).multiplyScalar(3.0));

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 1.45;
  controls.maxDistance = 9;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.55;
  controls.saveState();

  // ---- 地球（含 23.44° 倾斜，自定义着色器实现昼夜半球） ----
  const tiltGroup = new THREE.Group();
  tiltGroup.rotation.z = -EARTH_TILT * DEG;
  scene.add(tiltGroup);

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
  const earthMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 64),
    earthMaterial
  );
  tiltGroup.add(earthMesh);

  // ---- 赤道 / 回归线 / 极圈 / 本初子午线（鲜明配色 + 经纬度标签） ----
  const labelLon = 105; // 标签统一放在面向默认视角的东侧经线上
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

  // ---- 星空 ----
  const starCount = 900;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const dir = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1
    ).normalize();
    const dist = 28 + Math.random() * 22;
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
      size: 0.32,
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    })
  );
  scene.add(starsPoints);

  // ---- 太阳本体（发光球体 + 光晕 + 标签） ----
  const sunGroup = new THREE.Group();
  const sunBall = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 24, 18),
    new THREE.MeshBasicMaterial({ color: COLORS.sun })
  );
  sunGroup.add(sunBall);
  const sunGlow = makeGlowSprite("rgba(255,238,170,0.95)", 1.7);
  sunGroup.add(sunGlow);
  const sunLabel = makeLabelSprite("太阳", "#ffe08a", 48);
  sunGroup.add(sunLabel);
  scene.add(sunGroup);

  // ---- 晨昏线（垂直于太阳方向的大圆，随季节重建） ----
  const terminatorMesh = new THREE.Mesh(
    new THREE.TorusGeometry(1.006, 0.0068, 10, 240),
    new THREE.MeshBasicMaterial({ color: COLORS.terminator })
  );
  scene.add(terminatorMesh);
  const terminatorLabel = makeLabelSprite("晨昏线", "#ffd34d");
  scene.add(terminatorLabel);

  // ---- 太阳直射点（直射光线 + 落点光斑 + 标签） ----
  const subsolarGroup = new THREE.Group();
  const sunRay = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({
      color: COLORS.sunRay,
      dashSize: 0.14,
      gapSize: 0.09,
      transparent: true,
      opacity: 0.9
    })
  );
  subsolarGroup.add(sunRay);
  const subsolarDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 16, 12),
    new THREE.MeshBasicMaterial({ color: COLORS.subsolar })
  );
  subsolarGroup.add(subsolarDot);
  const subsolarFace = makeGlowSprite("rgba(255,170,70,0.9)", 0.5);
  subsolarGroup.add(subsolarFace);
  const subsolarLabelRef = { sprite: makeLabelSprite("太阳直射点", "#ffb46a") };
  subsolarGroup.add(subsolarLabelRef.sprite);
  scene.add(subsolarGroup);

  // ---- 点击标记 ----
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

  function focusLatLon(lat: number, lon: number, distance = 3) {
    const world = tiltGroup.localToWorld(localFromLatLon(lat, lon));
    camera.position.copy(world.normalize().multiplyScalar(distance));
    controls.target.set(0, 0, 0);
    controls.update();
  }

  // ---- 太阳方位（世界坐标）：由直射纬度（地平夹角）决定 ----
  const axisWorld = new THREE.Vector3(0, 1, 0)
    .applyQuaternion(tiltGroup.quaternion)
    .normalize();
  const sunAzimuthWorld = tiltGroup
    .localToWorld(localFromLatLon(0, SUN_AZIMUTH_LON))
    .normalize();
  const sunDir = new THREE.Vector3();
  const termE1 = new THREE.Vector3();
  const termE2 = new THREE.Vector3();

  function setSunDeclination(declDeg: number) {
    sunDir
      .copy(sunAzimuthWorld)
      .multiplyScalar(Math.cos(declDeg * DEG))
      .addScaledVector(axisWorld, Math.sin(declDeg * DEG))
      .normalize();

    // 太阳本体位置
    const sunPos = sunDir.clone().multiplyScalar(SUN_DISTANCE);
    sunBall.position.copy(sunPos);
    sunGlow.position.copy(sunPos);
    sunLabel.position.copy(sunPos).add(new THREE.Vector3(0, 0.36, 0));

    // 直射光线：太阳 → 直射点
    sunRay.geometry.dispose();
    sunRay.geometry = new THREE.BufferGeometry().setFromPoints([
      sunDir.clone().multiplyScalar(SUN_DISTANCE - 0.3),
      sunDir.clone().multiplyScalar(1.005)
    ]);
    sunRay.computeLineDistances();
    subsolarDot.position.copy(sunDir).multiplyScalar(1.008);
    subsolarFace.position.copy(sunDir).multiplyScalar(1.05);

    const declText =
      Math.abs(declDeg) < 0.05
        ? "0°（赤道）"
        : `${Math.abs(declDeg).toFixed(1)}°${declDeg > 0 ? "N" : "S"}`;
    const oldLabel = subsolarLabelRef.sprite;
    subsolarGroup.remove(oldLabel);
    disposeSprite(oldLabel);
    const label = makeLabelSprite(`太阳直射点 ${declText}`, "#ffb46a");
    label.position.copy(sunDir).multiplyScalar(1.2);
    subsolarGroup.add(label);
    subsolarLabelRef.sprite = label;
    terminatorMesh.geometry.dispose();
    terminatorMesh.geometry = new THREE.TorusGeometry(1.006, 0.0068, 10, 240);
    terminatorMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), sunDir);

    termE1.crossVectors(sunDir, Math.abs(sunDir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    termE2.crossVectors(sunDir, termE1).normalize();
    // 晨昏线标签放在最靠近相机的一侧
    const camDir = camera.position.clone().normalize();
    let bestTheta = 0;
    let bestDot = -Infinity;
    for (let i = 0; i < 64; i++) {
      const theta = (i / 64) * Math.PI * 2;
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
      .multiplyScalar(1.12);

    // 昼夜着色器太阳方向
    earthMaterial.uniforms.uSunDir.value.copy(sunDir);
  }

  // ---- 渲染循环与自适应 ----
  let raf = 0;
  function animate() {
    raf = requestAnimationFrame(animate);
    controls.update();
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
    scene.traverse((child) => {
      if (
        child instanceof THREE.Mesh ||
        child instanceof THREE.Line ||
        child instanceof THREE.Points
      ) {
        child.geometry.dispose();
        const material = (child as THREE.Mesh).material;
        if (material instanceof THREE.Material) {
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
    earthTexture: null,
    autoRotateWanted: true,
    dispose,
    placeMarker,
    clearMarker,
    focusLatLon,
    setSunDeclination
  };

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

  setSunDeclination(23.44); // 默认夏至：直射点在北回归线上，昼夜对比最直观
  return engine;
}

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

const LAYER_DEFS: { key: keyof LayerState; label: string; color: string }[] = [
  { key: "texture", label: "地球影像", color: "#3f6b4f" },
  { key: "grid", label: "经纬网（30°）", color: "#ffffff" },
  { key: "equator", label: "赤道 0°", color: "#ff3b30" },
  { key: "tropics", label: "南北回归线 23.5°", color: "#ffa502" },
  { key: "polar", label: "南北极圈 66.5°", color: "#2ee6ff" },
  { key: "meridian", label: "本初子午线 0°", color: "#8f6bff" },
  { key: "axis", label: "地轴", color: "#f2e8d5" },
  { key: "terminator", label: "晨昏线（昼夜分界）", color: "#ffd34d" },
  { key: "sunDisplay", label: "太阳", color: "#ffdf6b" },
  { key: "subsolar", label: "太阳直射点·光线", color: "#ff8c3a" },
  { key: "zone", label: "太阳直射带（回归线间）", color: "#ffc23d" },
  { key: "stars", label: "星空背景", color: "#8ea2c9" }
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
    terminator: true,
    sunDisplay: true,
    subsolar: true,
    zone: true
  });
  const [autoRotate, setAutoRotate] = useState(true);
  const [marker, setMarker] = useState<MarkerInfo | null>(null);
  const [sunDecl, setSunDecl] = useState(23.44);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) {
      return;
    }
    const engine = buildEngine(container);
    engineRef.current = engine;

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

    // 开发/测试辅助：聚焦到指定经纬度并停转。
    (window as unknown as Record<string, unknown>).__globeDebug = {
      focus: (lat: number, lon: number) => {
        engine.controls.autoRotate = false;
        engine.focusLatLon(lat, lon, 2.8);
      },
      readMarker: () => (markerLastRef.current ? { ...markerLastRef.current } : null),
      setSun: (decl: number) => engine.setSunDeclination(decl)
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
    engine.subsolarGroup.visible = layers.subsolar;
    engine.zoneGroup.visible = layers.zone;
    const hasTex = layers.texture && engine.earthTexture ? 1 : 0;
    if (engine.earthMaterial.uniforms.uHasTex.value !== hasTex) {
      engine.earthMaterial.uniforms.uHasTex.value = hasTex;
      if (!layers.texture) {
        engine.earthMaterial.uniforms.dayMap.value = null;
      } else {
        engine.earthMaterial.uniforms.dayMap.value = engine.earthTexture;
      }
    }
  }, [layers]);

  // 自动旋转开关
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    engine.autoRotateWanted = autoRotate;
    engine.controls.autoRotate = autoRotate;
  }, [autoRotate]);

  // 太阳直射点纬度变化
  useEffect(() => {
    engineRef.current?.setSunDeclination(sunDecl);
  }, [sunDecl]);

  function toggleLayer(key: keyof LayerState) {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function applySeason(key: SeasonKey) {
    const item = SEASONS.find((s) => s.key === key);
    if (!item) {
      return;
    }
    setSunDecl(item.decl);
  }

  function resetView() {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    engine.controls.reset();
    engine.controls.autoRotate = engine.autoRotateWanted;
  }

  function clearMarkerClick() {
    engineRef.current?.clearMarker();
    setMarker(null);
    markerLastRef.current = null;
  }

  // 由当前直射点纬度推导季节说明与按钮高亮（春分/秋分同为直射赤道，均高亮）。
  const activeSeason = (key: SeasonKey) => {
    const item = SEASONS.find((s) => s.key === key);
    return item ? Math.abs(sunDecl - item.decl) < 0.05 : false;
  };
  const seasonNote =
    Math.abs(sunDecl - 23.44) < 0.05
      ? SEASON_NOTES.xiazhi
      : Math.abs(sunDecl + 23.44) < 0.05
        ? SEASON_NOTES.dongzhi
        : Math.abs(sunDecl) < 0.05
          ? SEASON_NOTES.chunfen
          : sunDecl > 0
            ? `太阳直射点位于北纬 ${sunDecl.toFixed(1)}°。直射点一年中在南北回归线之间往返移动，此时北半球昼长夜短。`
            : `太阳直射点位于南纬 ${Math.abs(sunDecl).toFixed(1)}°。直射点一年中在南北回归线之间往返移动，此时北半球昼短夜长。`;

  return (
    <div className="globe-app">
      <div className="globe-canvas" ref={mountRef} />

      <header className="globe-title">
        <h1>寰宇地球仪</h1>
        <span>经纬度 · 昼夜四季交互演示</span>
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
                  <span
                    className="layer-chip"
                    style={{ background: item.color }}
                  />
                  <span className="layer-label">{item.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>太阳与四季</h2>
          <div className="season-grid">
            {SEASONS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={
                  activeSeason(item.key) ? "season-btn is-active" : "season-btn"
                }
                onClick={() => applySeason(item.key)}
              >
                {item.label}
                <small>{item.date}</small>
              </button>
            ))}
          </div>
          <label className="decl-slider">
            <span>直射点纬度</span>
            <input
              type="range"
              min={-23.44}
              max={23.44}
              step={0.02}
              value={sunDecl}
              onChange={(event) => setSunDecl(Number(event.target.value))}
            />
            <strong>
              {Math.abs(sunDecl) < 0.05
                ? "赤道 0°"
                : `${sunDecl > 0 ? "北纬" : "南纬"} ${Math.abs(sunDecl).toFixed(1)}°`}
            </strong>
          </label>
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
              <button
                type="button"
                className="coord-clear"
                onClick={clearMarkerClick}
              >
                清除标记
              </button>
            </div>
          ) : (
            <p className="coord-empty">点击球面任意位置，即可读取该点的经纬度。</p>
          )}
        </section>

        <section>
          <h2>视角</h2>
          <div className="view-actions">
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
        拖动旋转 · 滚轮缩放 · 点击球面读取经纬度 · 切换四季观察太阳直射点与晨昏线
      </footer>
    </div>
  );
}
