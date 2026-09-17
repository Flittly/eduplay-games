/**
 * 三维视图编排：渲染器 / 场景 / 相机 / 光照 / 拾取 / 巡游。
 *
 * ## 光照随季节变
 *
 * 太阳高度角随季节改变（夏季高、冬季低），方向光的仰角也跟着变 ——
 * 所以同一座山在夏季是"顶光、阴影短"，冬季是"侧光、阴影拉长"。
 * 这不是装饰：它和雪线升降一起构成"冬季"这个季节的完整观感。
 *
 * ## 拾取用 ray-march 而不是 Raycaster
 *
 * 地形是高度场，射线求交可以直接沿射线步进比较「射线高度 vs 地表高度」，
 * 几十步就能定位，比让 Raycaster 遍历 13 万个三角形快一个量级 ——
 * 而 hover 卡片是跟着鼠标实时更新的，这个开销必须小。
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DemField } from "./data/types";
import type { ContourSettings, Rgb } from "./terrain";
import { createTerrain, type TerrainHandle } from "./terrain";
import { altitudeAtWorld, sampleGrid, worldToGrid } from "./dem";
import { SEASONS, type SeasonId } from "./zonation";

export type ViewMode = "observe" | "roam";

export interface HoverHit {
  /** 网格索引（分数） */
  gx: number;
  gy: number;
  /** 海拔（米） */
  alt: number;
}

export interface View3dHandle {
  /** 换山 / 改海拔 / 换季后重算地形 */
  refresh(field: DemField, colorOf: (altitude: number) => Rgb): void;
  setContours(s: ContourSettings): void;
  setSun(season: SeasonId): void;
  setMode(mode: ViewMode): void;
  /** 巡游路径（从山麓到山顶的网格索引序列），供剖面图与巡游按钮共用 */
  route(): Array<[number, number]>;
  resize(): void;
  pick(clientX: number, clientY: number): HoverHit | null;
  debug(): Record<string, unknown>;
  dispose(): void;
}

const SKY = new THREE.Color("#c9dcea");
const FOG_NEAR = 1.05;
const FOG_FAR = 3.4;

export function createView3d(container: HTMLElement): View3dHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(SKY, 1);
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";

  const scene = new THREE.Scene();
  scene.background = SKY.clone();

  const camera = new THREE.PerspectiveCamera(46, 1, 20, 500000);

  // ---------- 光照 ----------
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 12;
  scene.add(sun);
  scene.add(sun.target);

  const sky = new THREE.HemisphereLight(0xdff0ff, 0x6d5c48, 0.85);
  scene.add(sky);
  const fill = new THREE.AmbientLight(0xffffff, 0.28);
  scene.add(fill);

  // ---------- 地形 ----------
  let terrain: TerrainHandle | null = null;
  let field: DemField | null = null;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minPolarAngle = Math.PI * 0.02;

  let mode: ViewMode = "observe";
  let roamT = 0;
  let roamDir = 1;
  let routePts: Array<[number, number]> = [];
  let routeDist: number[] = [];
  let routeTotal = 0;
  let frame = 0;
  let disposed = false;

  // ---------- 尺寸 ----------
  function resize(): void {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // ---------- 太阳方位 ----------
  const SUN_AZIMUTH = -0.62; // 东南方照过来
  function setSun(season: SeasonId): void {
    // 夏季太阳高（0.92 rad ≈ 53°）、冬季低（0.42 rad ≈ 24°）
    const elev: Record<SeasonId, number> = { spring: 0.70, summer: 0.92, autumn: 0.60, winter: 0.42 };
    const r = (field?.spanM ?? 30000) * 1.7;
    const e = elev[season];
    const y = Math.sin(e) * r;
    const horiz = Math.cos(e) * r;
    sun.position.set(Math.sin(SUN_AZIMUTH) * horiz, y, Math.cos(SUN_AZIMUTH) * horiz);
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();

    const span = field?.spanM ?? 30000;
    const casts = season === "winter" || season === "autumn";
    // 冬季光弱、色温偏冷；夏季光强、偏暖
    sun.intensity = season === "summer" ? 2.6 : season === "winter" ? 1.75 : 2.25;
    sky.intensity = casts ? 0.75 : 0.9;

    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      fog.near = span * FOG_NEAR;
      fog.far = span * FOG_FAR;
    }
    if (sun.shadow.camera instanceof THREE.OrthographicCamera) {
      const c = sun.shadow.camera;
      c.left = -span * 0.62; c.right = span * 0.62;
      c.top = span * 0.62; c.bottom = -span * 0.62;
      c.near = 1; c.far = span * 4;
      c.updateProjectionMatrix();
    }
  }

  // ---------- 巡游路径 ----------
  /** 从峰顶沿最陡下降方向追踪一条到低处的路线，再反向（山麓 → 山顶） */
  function buildRoute(f: DemField): void {
    const g = f.grid;
    let ci = f.peakI;
    let cj = f.peakJ;
    const raw: Array<[number, number]> = [[ci, cj]];
    const visited = new Set<number>([cj * g + ci]);
    for (let step = 0; step < 20000; step++) {
      let bi = -1;
      let bj = -1;
      let bh = Infinity;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 1 || nj < 1 || ni >= g - 1 || nj >= g - 1) continue;
          const k = nj * g + ni;
          if (visited.has(k)) continue;
          const h = f.alt[k];
          if (h < bh) { bh = h; bi = ni; bj = nj; }
        }
      }
      if (bi < 0) break;
      visited.add(bj * g + bi);
      ci = bi; cj = bj;
      raw.push([ci, cj]);
      if (f.alt[cj * g + ci] <= f.minH + (f.maxH - f.minH) * 0.06) break;
    }
    raw.reverse();
    // 抽稀：路径太密会让相机移动过慢
    const stride = Math.max(1, Math.round(raw.length / 240));
    routePts = raw.filter((_, k) => k % stride === 0 || k === raw.length - 1);
    if (routePts.length < 2) routePts = [[1, 1], [f.peakI, f.peakJ]];
    routeDist = [0];
    routeTotal = 0;
    for (let k = 1; k < routePts.length; k++) {
      const [ax, ay] = routePts[k - 1];
      const [bx, by] = routePts[k];
      routeTotal += Math.hypot(bx - ax, by - ay);
      routeDist.push(routeTotal);
    }
  }

  /** 路径参数 t ∈ [0,1]（按弧长）→ 网格索引 + 该处海拔 */
  function routeAt(t: number): { gx: number; gy: number; alt: number } {
    if (!field || routePts.length < 2) {
      return { gx: 0, gy: 0, alt: 0 };
    }
    const d = Math.max(0, Math.min(1, t)) * routeTotal;
    let lo = 0;
    let hi = routeDist.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (routeDist[mid] <= d) lo = mid;
      else hi = mid;
    }
    const seg = Math.max(1e-6, routeDist[hi] - routeDist[lo]);
    const f = (d - routeDist[lo]) / seg;
    const gx = routePts[lo][0] + (routePts[hi][0] - routePts[lo][0]) * f;
    const gy = routePts[lo][1] + (routePts[hi][1] - routePts[lo][1]) * f;
    return { gx, gy, alt: sampleGrid(field, gx, gy) };
  }

  // ---------- 拾取 ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function pick(clientX: number, clientY: number): HoverHit | null {
    if (!field) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    if (ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1) return null;
    ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin;
    const dir = ray.ray.direction;
    const span = field.spanM;
    const tMax = span * 4;

    const heightAt = (t: number) => {
      const x = o.x + dir.x * t;
      const z = o.z + dir.z * t;
      return o.y + dir.y * t - altitudeAtWorld(field!, x, z) * field!.verticalExaggeration;
    };

    let prev = heightAt(0);
    const step = span / 260;
    let hitT = -1;
    for (let t = step; t < tMax; t += step) {
      const cur = heightAt(t);
      if (prev > 0 && cur <= 0) {
        // 二分细化
        let a = t - step;
        let b = t;
        for (let k = 0; k < 22; k++) {
          const m = (a + b) / 2;
          if (heightAt(m) > 0) a = m;
          else b = m;
        }
        hitT = (a + b) / 2;
        break;
      }
      prev = cur;
    }
    if (hitT < 0) return null;
    const x = o.x + dir.x * hitT;
    const z = o.z + dir.z * hitT;
    const [gx, gy] = worldToGrid(field, x, z);
    return { gx, gy, alt: sampleGrid(field, gx, gy) };
  }

  // ---------- 主循环 ----------
  function tick(): void {
    if (disposed) return;
    frame++;
    if (mode === "roam" && field) {
      roamT += roamDir * 0.0016;
      if (roamT > 1) { roamT = 1; roamDir = -1; }
      if (roamT < 0) { roamT = 0; roamDir = 1; }
      const p = routeAt(roamT);
      const [wx, wz] = [
        (p.gx / (field.grid - 1)) * field.spanM - field.spanM / 2,
        (p.gy / (field.grid - 1)) * field.spanM - field.spanM / 2
      ];
      // 站在地表上方 1.6·span 的相对高度；用近视点体会「跟着海拔爬升」
      const eye = p.alt * field.verticalExaggeration + field.spanM * 0.012;
      const ahead = routeAt(Math.min(1, roamT + 0.035));
      const [ax, az] = [
        (ahead.gx / (field.grid - 1)) * field.spanM - field.spanM / 2,
        (ahead.gy / (field.grid - 1)) * field.spanM - field.spanM / 2
      ];
      camera.position.lerp(new THREE.Vector3(wx, eye, wz), 0.18);
      controls.target.lerp(
        new THREE.Vector3(ax, ahead.alt * field.verticalExaggeration, az),
        0.18
      );
    }
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  function refresh(f: DemField, colorOf: (altitude: number) => Rgb): void {
    const isNewField = field !== f;
    field = f;
    if (!terrain) {
      terrain = createTerrain(f, colorOf);
      scene.add(terrain.group);
      // 第一次拿到地形时摆好相机
      const span = f.spanM;
      scene.fog = new THREE.Fog(SKY.clone(), span * FOG_NEAR, span * FOG_FAR);
      camera.position.set(span * 0.62, span * 0.44, span * 0.78);
      controls.target.set(0, terrain.centerY(), 0);
      controls.minDistance = span * 0.12;
      controls.maxDistance = span * 2.2;
      camera.far = span * 6;
      camera.updateProjectionMatrix();
      buildRoute(f);
    } else {
      terrain.update(f, colorOf);
    }
    if (isNewField) {
      buildRoute(f);
      // 换山：把相机拉回默认视角（否则新山可能整个在视野外）
      const span = f.spanM;
      camera.position.set(span * 0.62, span * 0.44, span * 0.78);
      controls.target.set(0, terrain!.centerY(), 0);
      roamT = 0;
      roamDir = 1;
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.near = span * FOG_NEAR;
        scene.fog.far = span * FOG_FAR;
      }
    }
  }

  function setMode(m: ViewMode): void {
    mode = m;
    controls.enabled = m === "observe";
    if (m === "observe" && field) {
      roamT = 0;
      roamDir = 1;
    }
    if (m === "roam") {
      roamT = 0;
      roamDir = 1;
    }
  }

  function debug(): Record<string, unknown> {
    return {
      mode,
      roamT,
      routeLen: routePts.length,
      cameraPos: [camera.position.x, camera.position.y, camera.position.z],
      cameraTarget: [controls.target.x, controls.target.y, controls.target.z],
      frames: frame,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles
    };
  }

  resize();
  tick();

  return {
    refresh,
    setContours: (s) => terrain?.setContours(s),
    setSun,
    setMode,
    route: () => routePts.slice(),
    resize,
    pick,
    debug,
    dispose() {
      disposed = true;
      controls.dispose();
      terrain?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    }
  };
}

/** 「哪种季节配哪种天光」——面板与截图脚本共用，避免两处不一致 */
export const SEASON_SUN_LABEL: Record<SeasonId, string> = {
  spring: "春日斜照",
  summer: "夏日高照",
  autumn: "秋日偏斜",
  winter: "冬日低照"
};

export const ALL_SEASONS: SeasonId[] = [...SEASONS];
