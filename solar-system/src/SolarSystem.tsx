import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  ALL_BODIES,
  ORBIT_K,
  ORBIT_POW,
  SUN,
  SUN_DISPLAY_R,
  bodyById,
  displayRadius,
  moonDisplayRadius,
  moonOrbitRadius
} from "./solarData";
import type { BodyData, MoonData } from "./solarData";
import { buildTexture, makeGlowTexture, makeLabelTexture, makeRingTexture } from "./textures";

export interface PlayerInfo {
  studentId: number;
  studentName: string;
  className: string | null;
  studentNo?: string;
}

export interface LayerState {
  orbits: boolean;
  labels: boolean;
  moons: boolean;
  belt: boolean;
  kuiper: boolean;
  stars: boolean;
}

interface Selection {
  bodyId: string;
  moonId: string | null;
}

const DEG = Math.PI / 180;
const AU_SCALE = ORBIT_K;
const ASTEROID_COUNT = 1100;
const KUIPER_COUNT = 1200;

const KIND_LABEL: Record<BodyData["kind"], string> = {
  star: "恒星",
  planet: "行星",
  dwarf: "矮行星"
};

/* ------------------------------------------------------------------ */
/* 轨道计算                                                            */
/* ------------------------------------------------------------------ */

/** 牛顿迭代求解开普勒方程 E - e·sinE = M */
function solveKepler(meanAnomaly: number, e: number): number {
  let E = meanAnomaly;
  for (let i = 0; i < 5; i++) {
    const f = E - e * Math.sin(E) - meanAnomaly;
    const fp = 1 - e * Math.cos(E);
    E -= f / fp;
  }
  return E;
}

/** 由偏近点角计算轨道平面内的位置（单位：显示单位） */
function orbitPosition(
  aDisp: number,
  e: number,
  E: number,
  periLonDeg: number,
  incDeg: number,
  target = new THREE.Vector3()
): THREE.Vector3 {
  const r = aDisp * (1 - e * Math.cos(E));
  // 真近点角
  const nu =
    2 *
    Math.atan2(
      Math.sqrt(1 + e) * Math.sin(E / 2),
      Math.sqrt(1 - e) * Math.cos(E / 2)
    );
  const theta = nu + periLonDeg * DEG;
  const x = r * Math.cos(theta);
  const z = r * Math.sin(theta);
  const inc = incDeg * DEG;
  return target.set(x, -z * Math.sin(inc), z * Math.cos(inc));
}

/** 由平近点角（天）求位置 */
function positionAtTime(
  body: BodyData,
  timeDays: number,
  aDisp: number,
  target = new THREE.Vector3()
): THREE.Vector3 {
  const M = (body.m0Deg * DEG + (2 * Math.PI * timeDays) / body.periodDays) % (Math.PI * 2);
  const E = solveKepler(M, body.e);
  return orbitPosition(aDisp, body.e, E, body.perihelionLonDeg, body.inclinationDeg, target);
}

function orbitRadiusDisplay(body: BodyData): number {
  return AU_SCALE * Math.pow(body.aAU, ORBIT_POW);
}

/* ------------------------------------------------------------------ */
/* 场景                                                                */
/* ------------------------------------------------------------------ */

interface MoonRuntime {
  data: MoonData;
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  label: THREE.Sprite | null;
}

interface PlanetRuntime {
  data: BodyData;
  assembly: THREE.Group;
  spinGroup: THREE.Group;
  mesh: THREE.Mesh;
  aDisp: number;
  displayR: number;
  orbitLine: THREE.Line;
  moons: MoonRuntime[];
}

interface LabelEntry {
  sprite: THREE.Sprite;
  baseW: number;
  baseH: number;
  bodyId: string;
  moonIndex: number;
}

interface Engine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  planets: PlanetRuntime[];
  sunSprite: THREE.Sprite | null;
  starsPoints: THREE.Points;
  orbitGroup: THREE.Group;
  beltMesh: THREE.InstancedMesh | null;
  kuiperGroup: THREE.Group;
  labelEntries: LabelEntry[];
  simTime: number;
  playing: boolean;
  speed: number;
  selected: Selection | null;
  follow: boolean;
  setLayers: (layers: LayerState) => void;
  setPlaying: (value: boolean) => void;
  setSpeed: (value: number) => void;
  select: (selection: Selection | null, focus: boolean) => void;
  setFollow: (value: boolean) => void;
  applyView: (name: "overview" | "inner" | "outer" | "top") => void;
  dispose: () => void;
}

function makeLabelSprite(
  text: string,
  color: string,
  fontPx: number,
  height: number,
  sub?: string
): { sprite: THREE.Sprite; baseW: number; baseH: number } {
  const { texture, aspect } = makeLabelTexture(text, color, fontPx, sub);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false
    })
  );
  sprite.scale.set(height * aspect, height, 1);
  return { sprite, baseW: height * aspect, baseH: height };
}

/** 生成某天体的自转轴标线（可选显示） */
function buildEngine(container: HTMLDivElement, onTick: (timeDays: number) => void): Engine {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04060f);

  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / Math.max(container.clientHeight, 1),
    0.05,
    600
  );
  camera.position.set(0, 26, 36);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = true;
  controls.minDistance = 1.1;
  controls.maxDistance = 240;
  controls.rotateSpeed = 0.85;
  controls.saveState();

  scene.add(new THREE.AmbientLight(0xffffff, 0.16));

  // ---- 太阳 ----
  const sunTexture = buildTexture("sun");
  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(SUN_DISPLAY_R, 64, 48),
    new THREE.MeshBasicMaterial({ map: sunTexture })
  );
  scene.add(sunMesh);
  const glowInner = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture("rgba(255,244,190,0.95)", "rgba(255,186,70,0.55)"),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  glowInner.scale.setScalar(SUN_DISPLAY_R * 4.6);
  scene.add(glowInner);
  const glowOuter = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture("rgba(255,210,120,0.45)", "rgba(255,150,50,0.25)"),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  glowOuter.scale.setScalar(SUN_DISPLAY_R * 11);
  scene.add(glowOuter);
  const sunLight = new THREE.PointLight(0xfff4de, 3.1);
  sunLight.decay = 0;
  sunLight.distance = 0;
  scene.add(sunLight);

  const labelEntries: LabelEntry[] = [];
  const sunLabel = makeLabelSprite("太阳", "#ffd76a", 52, 2.4, "恒星 · 太阳系的中心");
  sunLabel.sprite.position.set(0, SUN_DISPLAY_R + 2.8, 0);
  scene.add(sunLabel.sprite);
  labelEntries.push({
    sprite: sunLabel.sprite,
    baseW: sunLabel.baseW,
    baseH: sunLabel.baseH,
    bodyId: "sun",
    moonIndex: -1
  });
  sunMesh.userData = { bodyId: "sun", moonId: null };

  // ---- 行星与卫星 ----
  const orbitGroup = new THREE.Group();
  scene.add(orbitGroup);
  const planets: PlanetRuntime[] = [];
  const pickTargets: THREE.Mesh[] = [sunMesh];
  const moonSharedGeo = new THREE.SphereGeometry(1, 24, 16);
  // 卫星共用一张灰度撞击坑纹理，配合各自颜色，兼顾观感与启动速度
  const moonDetailTexture = buildTexture("moonDetail");

  for (const data of ALL_BODIES) {
    if (data.kind === "star") {
      continue;
    }
    const aDisp = orbitRadiusDisplay(data);
    const r = displayRadius(data.radiusKm);
    const assembly = new THREE.Group();
    scene.add(assembly);

    const spinGroup = new THREE.Group();
    spinGroup.rotation.z = data.tiltDeg * DEG;
    assembly.add(spinGroup);

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, 48, 32),
      new THREE.MeshStandardMaterial({
        map: buildTexture(data.textureKey),
        roughness: data.kind === "planet" && data.radiusKm > 20000 ? 0.8 : 0.95,
        metalness: 0
      })
    );
    mesh.userData = { bodyId: data.id, moonId: null };
    spinGroup.add(mesh);
    pickTargets.push(mesh);

    // 光环
    if (data.ring) {
      const ringTexture = makeRingTexture(data.ring.color, data.id.length + 3);
      const inner = r * data.ring.inner;
      const outer = r * data.ring.outer;
      const ringGeo = new THREE.RingGeometry(inner, outer, 128, 1);
      // 调整 UV：让纹理沿半径方向展开
      const pos = ringGeo.attributes.position;
      const uv = ringGeo.attributes.uv;
      const v3 = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v3.fromBufferAttribute(pos, i);
        const dist = v3.length();
        const t = (dist - inner) / Math.max(outer - inner, 1e-6);
        uv.setXY(i, t, 0.5);
      }
      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          map: ringTexture,
          transparent: true,
          opacity: data.ring.opacity,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      );
      ring.rotation.x = Math.PI / 2;
      spinGroup.add(ring);
    }

    // 轨道线
    const orbitPoints: THREE.Vector3[] = [];
    const segments = 240;
    for (let i = 0; i <= segments; i++) {
      const E = (i / segments) * Math.PI * 2;
      orbitPoints.push(orbitPosition(aDisp, data.e, E, data.perihelionLonDeg, data.inclinationDeg));
    }
    const orbitLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(orbitPoints),
      new THREE.LineBasicMaterial({
        color: new THREE.Color(data.color),
        transparent: true,
        opacity: data.kind === "dwarf" ? 0.22 : 0.34
      })
    );
    orbitGroup.add(orbitLine);

    // 名称标签
    const label = makeLabelSprite(
      data.name,
      "#eef4ff",
      46,
      data.radiusKm > 20000 ? 1.8 : 1.6,
      data.en
    );
    label.sprite.position.set(0, r + 0.75, 0);
    assembly.add(label.sprite);
    labelEntries.push({
      sprite: label.sprite,
      baseW: label.baseW,
      baseH: label.baseH,
      bodyId: data.id,
      moonIndex: -1
    });

    // 卫星
    const moons: MoonRuntime[] = [];
    data.moons.forEach((moon, index) => {
      const mr = moonDisplayRadius(moon.radiusKm);
      const orbitR = moonOrbitRadius(r, index);
      const pivot = new THREE.Group();
      assembly.add(pivot);
      const moonMesh = new THREE.Mesh(
        moonSharedGeo,
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(moon.color),
          map: moonDetailTexture,
          roughness: 0.95
        })
      );
      moonMesh.scale.setScalar(mr);
      moonMesh.position.set(orbitR, 0, 0);
      moonMesh.userData = { bodyId: data.id, moonId: moon.id };
      pivot.add(moonMesh);
      pickTargets.push(moonMesh);

      // 卫星轨道圈
      const moonOrbit = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          Array.from({ length: 96 }, (_, i) => {
            const t = (i / 96) * Math.PI * 2;
            return new THREE.Vector3(orbitR * Math.cos(t), 0, orbitR * Math.sin(t));
          })
        ),
        new THREE.LineBasicMaterial({
          color: new THREE.Color(moon.color),
          transparent: true,
          opacity: 0.28
        })
      );
      pivot.add(moonOrbit);

      const moonLabel = makeLabelSprite(moon.name, "#dce8ff", 38, 0.8);
      moonLabel.sprite.position.set(orbitR, mr + 0.28, 0);
      moonLabel.sprite.visible = false;
      pivot.add(moonLabel.sprite);
      labelEntries.push({
        sprite: moonLabel.sprite,
        baseW: moonLabel.baseW,
        baseH: moonLabel.baseH,
        bodyId: data.id,
        moonIndex: index
      });

      moons.push({ data: moon, pivot, mesh: moonMesh, label: moonLabel.sprite });
    });

    planets.push({
      data,
      assembly,
      spinGroup,
      mesh,
      aDisp,
      displayR: r,
      orbitLine,
      moons
    });
  }

  // ---- 小行星带 ----
  const beltGeo = new THREE.IcosahedronGeometry(0.075, 0);
  const beltMat = new THREE.MeshStandardMaterial({ color: 0xb9ae9d, roughness: 1 });
  const beltMesh = new THREE.InstancedMesh(beltGeo, beltMat, ASTEROID_COUNT);
  const beltData: {
    aDisp: number;
    e: number;
    inc: number;
    peri: number;
    m0: number;
    period: number;
    size: number;
  }[] = [];
  {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < ASTEROID_COUNT; i++) {
      const aAU = 2.06 + rand() * 1.22; // 2.06 ~ 3.28 AU
      const aDisp = AU_SCALE * Math.pow(aAU, ORBIT_POW);
      beltData.push({
        aDisp,
        e: rand() * 0.16,
        inc: (rand() - 0.5) * 16,
        peri: rand() * 360,
        m0: rand() * Math.PI * 2,
        period: 365.25 * Math.pow(aAU, 1.5),
        size: 0.45 + rand() * 1.1
      });
    }
  }
  scene.add(beltMesh);

  // ---- 柯伊伯带（示意） ----
  const kuiperGroup = new THREE.Group();
  {
    const count = KUIPER_COUNT;
    const positions = new Float32Array(count * 3);
    let seed = 777;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < count; i++) {
      const aAU = 38 + rand() * 14;
      const aDisp = AU_SCALE * Math.pow(aAU, ORBIT_POW);
      const angle = rand() * Math.PI * 2;
      const inc = (rand() - 0.5) * 24 * DEG;
      positions[i * 3] = aDisp * Math.cos(angle);
      positions[i * 3 + 1] = Math.sin(inc) * aDisp * 0.35;
      positions[i * 3 + 2] = aDisp * Math.sin(angle) * Math.cos(inc);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    kuiperGroup.add(
      new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: 0x8fa8c8,
          size: 0.16,
          transparent: true,
          opacity: 0.5,
          depthWrite: false
        })
      )
    );
  }
  scene.add(kuiperGroup);

  // ---- 星空 ----
  const starsPoints = (() => {
    const count = 3600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    let seed = 4242;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(
        rand() * 2 - 1,
        rand() * 2 - 1,
        rand() * 2 - 1
      ).normalize();
      const dist = 240 + rand() * 220;
      positions[i * 3] = dir.x * dist;
      positions[i * 3 + 1] = dir.y * dist;
      positions[i * 3 + 2] = dir.z * dist;
      const warm = 0.72 + rand() * 0.28;
      colors[i * 3] = warm;
      colors[i * 3 + 1] = warm;
      colors[i * 3 + 2] = 0.85 + rand() * 0.15;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 1.5,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        sizeAttenuation: true
      })
    );
    scene.add(points);
    return points;
  })();

  /* ---------------- 状态与更新 ---------------- */

  const engine: Engine = {
    renderer,
    scene,
    camera,
    controls,
    planets,
    sunSprite: glowInner,
    starsPoints,
    orbitGroup,
    beltMesh,
    kuiperGroup,
    labelEntries,
    simTime: 0,
    playing: true,
    speed: 3,
    selected: null,
    follow: true,
    setLayers: (layers) => {
      orbitGroup.visible = layers.orbits;
      kuiperGroup.visible = layers.kuiper;
      beltMesh.visible = layers.belt;
      starsPoints.visible = layers.stars;
      for (const entry of labelEntries) {
        if (entry.moonIndex < 0) {
          entry.sprite.visible = layers.labels;
        } else {
          const planet = planets.find((item) => item.data.id === entry.bodyId);
          entry.sprite.visible =
            layers.labels &&
            layers.moons &&
            !!engine.selected &&
            engine.selected.bodyId === entry.bodyId &&
            planet !== undefined;
        }
      }
      for (const planet of planets) {
        for (const moon of planet.moons) {
          moon.pivot.visible = layers.moons;
        }
      }
    },
    setPlaying: (value) => {
      engine.playing = value;
    },
    setSpeed: (value) => {
      engine.speed = value;
    },
    select: (selection, focus) => {
      engine.selected = selection;
      if (focus && selection) {
        const target = new THREE.Vector3();
        if (selection.moonId) {
          const planet = planets.find((item) => item.data.id === selection.bodyId);
          const moon = planet?.moons.find((item) => item.data.id === selection.moonId);
          if (moon) {
            moon.mesh.getWorldPosition(target);
          }
        } else if (selection.bodyId === "sun") {
          target.set(0, 0, 0);
        } else {
          const planet = planets.find((item) => item.data.id === selection.bodyId);
          if (planet) {
            planet.assembly.getWorldPosition(target);
          }
        }
        const dir = camera.position.clone().sub(controls.target).normalize();
        if (dir.lengthSq() < 1e-6) {
          dir.set(0, 0.35, 1).normalize();
        }
        const dist = selection.moonId ? 2.2 : selection.bodyId === "sun" ? 12 : 4.2;
        controls.target.copy(target);
        camera.position.copy(target).addScaledVector(dir, dist);
        controls.update();
      }
    },
    setFollow: (value) => {
      engine.follow = value;
    },
    applyView: (name) => {
      const presets: Record<string, [number, number, number]> = {
        overview: [0, 52, 68],
        inner: [0, 9, 19],
        outer: [0, 30, 60],
        top: [0.01, 82, 0.01]
      };
      const position = presets[name];
      controls.target.set(0, 0, 0);
      camera.position.set(position[0], position[1], position[2]);
      controls.update();
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      controls.dispose();
      scene.traverse((child) => {
        if (
          child instanceof THREE.Mesh ||
          child instanceof THREE.Line ||
          child instanceof THREE.LineLoop ||
          child instanceof THREE.Points
        ) {
          child.geometry.dispose();
          const material = (child as THREE.Mesh).material;
          if (Array.isArray(material)) {
            material.forEach((item) => item.dispose());
          } else if (material instanceof THREE.Material) {
            material.dispose();
          }
        }
        if (child instanceof THREE.Sprite) {
          child.material.map?.dispose();
          child.material.dispose();
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    }
  };

  // ---- 点击拾取 ----
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
    if (Math.hypot(dx, dy) >= 6 || Date.now() - downTime > 700) {
      return;
    }
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(pickTargets, false);
    if (hits.length > 0) {
      const info = hits[0].object.userData as { bodyId: string; moonId: string | null };
      onPick?.(info.bodyId, info.moonId ?? null);
    }
  }
  let onPick: ((bodyId: string, moonId: string | null) => void) | null = null;
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  (engine as unknown as { setPickHandler: (fn: typeof onPick) => void }).setPickHandler = (fn) => {
    onPick = fn;
  };
  (engine as unknown as { removeListeners: () => void }).removeListeners = () => {
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
  };

  // ---- 渲染循环 ----
  const tmpVec = new THREE.Vector3();
  const dummy = new THREE.Object3D();
  let raf = 0;
  let last = performance.now();
  let tickAccum = 0;

  function animate() {
    raf = requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    if (engine.playing) {
      engine.simTime += dt * engine.speed;
    }
    const t = engine.simTime;

    // 行星位置与自转
    for (const planet of planets) {
      positionAtTime(planet.data, t, planet.aDisp, tmpVec);
      planet.assembly.position.copy(tmpVec);
      const rotationDays = planet.data.rotationHours / 24;
      planet.mesh.rotation.y = (2 * Math.PI * t) / rotationDays;
      for (const moon of planet.moons) {
        const period = moon.data.periodDays;
        const angle = (2 * Math.PI * t) / period;
        moon.pivot.rotation.y = -angle;
        moon.mesh.rotation.y = angle;
      }
    }

    // 太阳自转
    sunMesh.rotation.y = (2 * Math.PI * t) / (SUN.rotationHours / 24);

    // 小行星带
    const beltMatrix = new THREE.Matrix4();
    for (let i = 0; i < ASTEROID_COUNT; i++) {
      const item = beltData[i];
      const angle = item.m0 + (2 * Math.PI * t) / item.period;
      const r = item.aDisp * (1 + item.e * Math.cos(angle - item.peri * DEG));
      dummy.position.set(
        r * Math.cos(angle),
        Math.sin(item.inc * DEG) * r * 0.12,
        r * Math.sin(angle)
      );
      dummy.rotation.set(angle * 2.1, angle * 1.3, item.peri);
      dummy.scale.setScalar(item.size);
      dummy.updateMatrix();
      beltMatrix.copy(dummy.matrix);
      beltMesh.setMatrixAt(i, beltMatrix);
    }
    beltMesh.instanceMatrix.needsUpdate = true;

    // 柯伊伯带缓慢公转（整体旋转示意）
    kuiperGroup.rotation.y = (2 * Math.PI * t) / 110000;

    // 跟随所选天体
    if (engine.follow && engine.selected) {
      const target = new THREE.Vector3();
      if (engine.selected.moonId) {
        const planet = planets.find((item) => item.data.id === engine.selected?.bodyId);
        const moon = planet?.moons.find((item) => item.data.id === engine.selected?.moonId);
        if (moon) {
          moon.mesh.getWorldPosition(target);
        }
      } else if (engine.selected.bodyId === "sun") {
        target.set(0, 0, 0);
      } else {
        const planet = planets.find((item) => item.data.id === engine.selected?.bodyId);
        if (planet) {
          planet.assembly.getWorldPosition(target);
        }
      }
      const delta = target.clone().sub(controls.target);
      controls.target.copy(target);
      camera.position.add(delta);
    }

    // 标签随距离缩放，保持大致恒定的屏幕尺寸
    const camDistance = camera.position.distanceTo(controls.target);
    const labelFactor = Math.min(2.4, Math.max(0.18, camDistance / 40));
    for (const entry of labelEntries) {
      if (!entry.sprite.visible) {
        continue;
      }
      entry.sprite.scale.set(entry.baseW * labelFactor, entry.baseH * labelFactor, 1);
    }

    controls.update();
    renderer.render(scene, camera);

    tickAccum += dt;
    if (tickAccum > 0.25) {
      tickAccum = 0;
      onTick(engine.simTime);
    }
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

  engine.applyView("overview");
  return engine;
}

/* ------------------------------------------------------------------ */
/* 时间格式化                                                          */
/* ------------------------------------------------------------------ */

function formatSimTime(days: number): string {
  if (days < 365.25) {
    return `第 ${days.toFixed(1)} 天`;
  }
  const years = days / 365.25;
  return `约 ${years.toFixed(years < 100 ? 2 : 1)} 年`;
}

function formatSpeed(speed: number): string {
  if (speed < 1) {
    return `1 秒 ≈ ${(speed * 24).toFixed(1)} 小时`;
  }
  if (speed < 400) {
    return `1 秒 ≈ ${speed.toFixed(speed < 10 ? 1 : 0)} 天`;
  }
  return `1 秒 ≈ ${(speed / 365.25).toFixed(1)} 年`;
}

const LAYER_DEFS: { key: keyof LayerState; label: string; color: string }[] = [
  { key: "orbits", label: "行星轨道", color: "#8fb6ff" },
  { key: "labels", label: "天体名称", color: "#eef4ff" },
  { key: "moons", label: "卫星", color: "#c9d6ea" },
  { key: "belt", label: "小行星带", color: "#b9ae9d" },
  { key: "kuiper", label: "柯伊伯带", color: "#8fa8c8" },
  { key: "stars", label: "星空背景", color: "#ffffff" }
];

const SPEED_STEPS = [0.05, 0.2, 1, 3, 10, 40, 120, 400];
const SPEED_PRESETS: { label: string; value: number }[] = [
  { label: "慢", value: 0.2 },
  { label: "中", value: 3 },
  { label: "快", value: 40 }
];

export default function SolarSystem({ roster }: { roster: PlayerInfo[] }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [hudTime, setHudTime] = useState(0);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [layers, setLayers] = useState<LayerState>({
    orbits: true,
    labels: true,
    moons: true,
    belt: true,
    kuiper: true,
    stars: true
  });
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(3);
  const [follow, setFollow] = useState(true);

  const selectedBody = selected ? bodyById(selected.bodyId) : undefined;
  const selectedMoon: MoonData | undefined = useMemo(() => {
    if (!selected?.moonId || !selectedBody) {
      return undefined;
    }
    return selectedBody.moons.find((item) => item.id === selected.moonId);
  }, [selected, selectedBody]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) {
      return;
    }
    const engine = buildEngine(container, (time) => setHudTime(time));
    engineRef.current = engine;
    engine.setLayers(layers);

    const picker = engine as unknown as {
      setPickHandler: (fn: (bodyId: string, moonId: string | null) => void) => void;
      removeListeners: () => void;
    };
    picker.setPickHandler((bodyId, moonId) => {
      setSelected({ bodyId, moonId });
      engine.select({ bodyId, moonId }, true);
    });

    // 开发/测试辅助
    (window as unknown as Record<string, unknown>).__solarDebug = {
      select: (bodyId: string, moonId: string | null = null) => {
        setSelected({ bodyId, moonId });
        engine.select({ bodyId, moonId }, true);
      },
      setTime: (days: number) => {
        engine.simTime = days;
      },
      setSpeed: (value: number) => engine.setSpeed(value),
      setPlaying: (value: boolean) => engine.setPlaying(value),
      view: (name: "overview" | "inner" | "outer" | "top") => engine.applyView(name),
      readBody: (bodyId: string) => {
        const planet = engine.planets.find((item) => item.data.id === bodyId);
        if (!planet) {
          return null;
        }
        const pos = new THREE.Vector3();
        planet.assembly.getWorldPosition(pos);
        return {
          name: planet.data.name,
          position: [Number(pos.x.toFixed(3)), Number(pos.y.toFixed(3)), Number(pos.z.toFixed(3))],
          distanceFromSun: Number(pos.length().toFixed(3)),
          spin: Number(planet.mesh.rotation.y.toFixed(3)),
          moons: planet.moons.length
        };
      },
      time: () => engine.simTime
    };

    return () => {
      picker.removeListeners();
      delete (window as unknown as Record<string, unknown>).__solarDebug;
      engine.dispose();
      engineRef.current = null;
    };
    // 初始化一次即可，图层/速度等变化通过下面的 effect 同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setLayers(layers);
  }, [layers]);

  useEffect(() => {
    engineRef.current?.setPlaying(playing);
  }, [playing]);

  useEffect(() => {
    engineRef.current?.setSpeed(speed);
  }, [speed]);

  useEffect(() => {
    engineRef.current?.setFollow(follow);
  }, [follow]);

  function toggleLayer(key: keyof LayerState) {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function selectBody(bodyId: string, moonId: string | null = null) {
    setSelected({ bodyId, moonId });
    engineRef.current?.select({ bodyId, moonId }, true);
  }

  function resetView() {
    engineRef.current?.controls.reset();
    engineRef.current?.applyView("overview");
  }

  const info = selectedMoon ?? selectedBody;

  return (
    <div className="solar-app">
      <div className="solar-canvas" ref={mountRef} />

      <header className="solar-title">
        <h1>寰宇太阳系</h1>
        <span>行星轨道 · 自转公转 · 天体档案</span>
      </header>

      <div className="solar-hud">
        <div className="hud-row">
          <span className="hud-label">模拟时间</span>
          <strong>{formatSimTime(hudTime)}</strong>
        </div>
        <div className="hud-row">
          <span className="hud-label">播放速度</span>
          <strong>{playing ? formatSpeed(speed) : "已暂停"}</strong>
        </div>
      </div>

      <aside className="solar-panel">
        <section>
          <h2>天体导航</h2>
          <div className="body-list">
            {ALL_BODIES.map((body) => (
              <button
                key={body.id}
                type="button"
                className={
                  selected?.bodyId === body.id && !selected.moonId
                    ? "body-chip is-active"
                    : "body-chip"
                }
                onClick={() => selectBody(body.id)}
              >
                <span className="chip-dot" style={{ background: body.color }} />
                {body.name}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>{selectedMoon ? "卫星档案" : "天体档案"}</h2>
          {info && selectedBody ? (
            <div className="info-card">
              <div className="info-head">
                <strong>{info.name}</strong>
                <span className="info-en">{info.en}</span>
                <span className="info-kind">
                  {selectedMoon ? "卫星" : KIND_LABEL[selectedBody.kind]}
                </span>
              </div>
              {selectedMoon && (
                <button
                  type="button"
                  className="info-parent"
                  onClick={() => selectBody(selectedBody.id)}
                >
                  ← 返回 {selectedBody.name}
                </button>
              )}
              <p className="info-desc">{info.desc}</p>
              <ul className="facts-table">
                {info.facts.map(([label, value]) => (
                  <li key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </li>
                ))}
              </ul>
              {!selectedMoon && selectedBody.moons.length > 0 && (
                <div className="moon-chips">
                  <span className="moon-title">卫星（点击查看）</span>
                  <div className="moon-list">
                    {selectedBody.moons.map((moon) => (
                      <button
                        key={moon.id}
                        type="button"
                        className="moon-chip"
                        onClick={() => selectBody(selectedBody.id, moon.id)}
                      >
                        {moon.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="info-empty">
              点击左侧天体按钮，或直接点击场景中的星球，查看它的介绍与数据。
            </p>
          )}
        </section>

        <section>
          <h2>时间控制</h2>
          <div className="time-actions">
            <button
              type="button"
              className={playing ? "is-on" : ""}
              onClick={() => setPlaying((v) => !v)}
            >
              {playing ? "暂停" : "播放"}
            </button>
            {SPEED_PRESETS.map((item) => (
              <button
                key={item.label}
                type="button"
                className={speed === item.value ? "is-on" : ""}
                onClick={() => setSpeed(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="speed-slider">
            <span>倍速</span>
            <input
              type="range"
              min={0}
              max={SPEED_STEPS.length - 1}
              step={1}
              value={Math.max(0, SPEED_STEPS.indexOf(speed) === -1 ? 3 : SPEED_STEPS.indexOf(speed))}
              onChange={(event) => setSpeed(SPEED_STEPS[Number(event.target.value)])}
            />
            <strong>{formatSpeed(speed)}</strong>
          </label>
          <div className="time-actions is-two">
            <button type="button" onClick={() => engineRef.current && (engineRef.current.simTime = 0)}>
              回到起点
            </button>
            <button
              type="button"
              className={follow ? "is-on" : ""}
              onClick={() => setFollow((v) => !v)}
            >
              {follow ? "跟随所选天体" : "自由视角"}
            </button>
          </div>
        </section>

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
          <h2>视角</h2>
          <div className="view-actions">
            <button type="button" onClick={() => engineRef.current?.applyView("overview")}>
              全日系
            </button>
            <button type="button" onClick={() => engineRef.current?.applyView("inner")}>
              内行星
            </button>
            <button type="button" onClick={() => engineRef.current?.applyView("outer")}>
              外行星
            </button>
            <button type="button" onClick={() => engineRef.current?.applyView("top")}>
              俯视黄道
            </button>
            <button type="button" className="view-wide" onClick={resetView}>
              复位视角
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

        <p className="solar-note">
          说明：行星大小与轨道距离均已做压缩处理，方便同屏观察；天体数据采用真实值，
          公转轨道按真实偏心率与倾角绘制。
        </p>
      </aside>

      <footer className="solar-hint">
        拖动旋转视角 · 滚轮缩放 · 点击行星查看档案 · 用「内行星 / 外行星」切换观察范围
      </footer>
    </div>
  );
}
