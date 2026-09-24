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
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { DemField } from "./data/types";
import type { ContourSettings, ProjectionSettings, ProfileSegmentDraw, Rgb } from "./terrain";
import { createTerrain, type TerrainHandle } from "./terrain";
import { altitudeAtWorld, gridToWorld, sampleGrid, visualY, worldToGrid } from "./dem";
import { PART_COLORS, type PartAnnotation } from "./panels";
import { SEASONS, type SeasonId } from "./zonation";
import {
  CAM_PITCH_2D_DEG,
  CAM_PITCH_DEG,
  FOG_FAR,
  FOG_NEAR,
  FOV_DEG,
  fitCameraPose
} from "./layout";

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
  setProjection(s: ProjectionSettings): void;
  setProfile(segs: ProfileSegmentDraw[]): void;
  /**
   * 地形部位标注层（v2.4.1）。
   *
   * 传 `null` = 清空这一层（五类都没打开，或换样本时旧点位已失效）。
   * 传进来的 `PartAnnotation` 已经**按开关过滤过**（见 engine 的 `annotationOf`），
   * 所以这里不做取舍，只负责把坐标换成世界坐标画出来。
   */
  setAnnotations(a: PartAnnotation | null): void;
  /**
   * 三维沙盘本体的显隐。
   *
   * 关掉后要做三件事，缺一件都会让学生以为"坏了"：
   *  1. 相机改成俯视图纸的取景（否则镜头对着空气）；
   *  2. 拾取平面从**地表高度场**切换为**图纸平面** —— 此时鼠标指着的是纸面，
   *     读到的海拔仍是该点的真实海拔，所以 hover 读数与"在图上画剖面"照常可用；
   *  3. 巡游模式失效（巡游是跟着地表爬升的），由 `engine` 退回观察模式。
   */
  setTerrainVisible(visible: boolean): void;
  /**
   * 把相机钉在指定位姿（回归取证专用，见实现处的说明）。
   * 传 `null` 表示解除，交回自动取景。
   */
  lockCamera(
    eye: [number, number, number] | null,
    target?: [number, number, number]
  ): void;
  setSun(season: SeasonId): void;
  setMode(mode: ViewMode): void;
  /** 巡游路径（从山麓到山顶的网格索引序列），供剖面图与巡游按钮共用 */
  route(): Array<[number, number]>;
  resize(): void;
  pick(clientX: number, clientY: number): HoverHit | null;
  /**
   * 网格坐标 → 画布像素坐标（client 坐标，含画布在页面里的偏移）。
   *
   * 它和 `pick` 是一对**互逆**的映射：`pick` 把指针的屏幕位置换算成网格坐标，
   * `project` 把网格坐标换算回屏幕位置。做「指针是否落在某个已存在的剖面端点上」
   * 这类屏幕距离判定时，必须用 `project` 把端点投到屏幕上再比距离 ——
   * 直接拿网格距离比是错的，因为远处（屏幕小）和近处（屏幕大）同样 4 格
   * 对应的像素差了好几倍，学生看到的是屏幕距离。
   */
  project(gx: number, gy: number): { x: number; y: number } | null;
  debug(): Record<string, unknown>;
  dispose(): void;
}

const SKY = new THREE.Color("#c9dcea");

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

  // 视场角必须来自 layout：拟合相机距离的公式按它反解，写死别的值会对不上
  const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 20, 500000);

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
  /**
   * 三维沙盘本体是否显示。
   *
   * 关掉后它不是"什么都没有"：只剩二维图纸，相机与拾取都要跟着换口径
   * （见 `frameAssembly` 与 `pick`），否则镜头对着空气、鼠标点什么都没反应。
   */
  let terrainVisible = true;
  /**
   * 二维图纸是否显示（与 `terrain` 内部同步一份）。
   *
   * 取景要用它决定装配体的下端是"图纸高度"还是"沙盘底边"—— 藏起图纸后
   * 相机的取景必须收回到沙盘上，否则沙盘会一直缩在画面中间那一小块里
   * （用户点"关图纸"是想专心看山，不是想看它变小）。
   */
  let projVisible = true;

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

  /* ---------- 地形部位标注层（v2.4.1） ---------- */
  /**
   * 标注层单独一个 `Group`，**每次重建整层**。
   *
   * 为什么不"增量更新"：五类部位数量差异极大（山峰 0~6 个、山脊折线 0~60 条），
   * 增量更新的分支比重建还长，而重建的代价只有几十个对象 —— 点一下按钮
   * 重建一层是毫秒级的，换来的是"状态永远等于数据"。
   */
  const annotGroup = new THREE.Group();
  annotGroup.name = "landform-annotations";
  scene.add(annotGroup);
  /** `LineMaterial` 必须知道画布尺寸才能把 `linewidth` 换算成像素 */
  const annotResolution = new THREE.Vector2(1, 1);
  /** 当前活着的标注线材质（`resize` 时要逐个更新 resolution） */
  const annotMaterials: LineMaterial[] = [];
  /**
   * 最近一次收到的标注数据。
   *
   * 留着它是因为**贴地**这件事与纵向夸张耦合：`refresh` 改了夸张之后
   * 必须用同一份数据重铺一遍（见 `refresh` 末尾）。数据本身由 engine 提供，
   * 这里只是记个引用，不重新计算任何东西。
   */
  let lastAnnot: PartAnnotation | null = null;

  // ---------- 尺寸 ----------
  function resize(): void {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // 屏幕像素宽度的线要跟着画布走，否则换窗口大小后线会变粗/变细
    annotResolution.set(w, h);
    for (const m of annotMaterials) {
      m.resolution.copy(annotResolution);
    }
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

    /*
     * 沙盘收起来时，鼠标指着的是**图纸平面**，不是地表。
     *
     * 换成射线与水平面求交即可，交点到网格坐标的换算与地表那条路径**完全一致**
     * （同一个 `worldToGrid` + `sampleGrid`），所以 hover 读数与"在图上画剖面"
     * 都不需要另写一套逻辑 —— 学生关掉三维后在平面图上点两个点，剖面照样出来。
     */
    if (!terrainVisible) {
      const projY = terrain?.projectionY() ?? 0;
      if (Math.abs(dir.y) < 1e-6) return null;
      const t = (projY - o.y) / dir.y;
      if (t <= 0) return null;
      const px = o.x + dir.x * t;
      const pz = o.z + dir.z * t;
      const half = field.spanM / 2;
      if (Math.abs(px) > half || Math.abs(pz) > half) return null;
      const [gx, gy] = worldToGrid(field, px, pz);
      return { gx, gy, alt: sampleGrid(field, gx, gy) };
    }

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

  /** 复用同一个向量，避免每次指针移动都新建对象（命中判定每帧都会调） */
  const projV = new THREE.Vector3();

  function project(gx: number, gy: number): { x: number; y: number } | null {
    if (!field) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const [wx, wz] = gridToWorld(field, gx, gy);
    /*
     * 纵坐标必须用**视觉**高度（含垂直夸张），否则夸张 ≠ 1 时端点球会脱开地表。
     *
     * 沙盘收起来时端点画在纸面上，口径要跟着换成图纸高度 —— 否则拖拽用的
     * 屏幕距离判定会按一个**已经不存在的地表**算，鼠标和端点对不上，
     * 而且这种错位不会报错（学生只觉得"拖不动"）。
     */
    const wy = terrainVisible
      ? sampleGrid(field, gx, gy) * field.verticalExaggeration
      : (terrain?.projectionY() ?? 0);
    projV.set(wx, wy, wz).project(camera);
    // 在相机背后时 project() 会把坐标镜像回来，必须显式排除
    if (projV.z > 1) return null;
    return {
      x: rect.left + ((projV.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projV.y) / 2) * rect.height
    };
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

  /**
   * 把相机对准"整组展品"：沙盘 + 它正下方那张二维图纸。
   *
   * 位姿**不是写死的比例**，而是按装配体包围盒拟合出来的（`fitCameraPose`）。
   * 装配体的高度 = 沙盘起伏 + 底座厚度 + 图纸间隙，随样本与显隐开关变化；
   * 写死比例要么切掉图纸、要么留一大片空白。
   *
   * 俯角也固定在 `layout.ts` 里，因为**它与图纸间隙是一对耦合参数**：
   * 间隙必须 ≥ tan(俯角) 图纸才露得出来（这就是 v2.2.0 图纸看不见的原因）。
   * 改俯角一定要回头看间隙，反之亦然 —— 所以两个值放在同一个模块里。
   */
  function frameAssembly(f: DemField): void {
    if (!terrain) return;
    const span = f.spanM;
    const projY = terrain.projectionY();
    /*
     * 装配体的上端 / 下端随两个开关变：
     *  - 都开：山在上、纸在下（默认，最能讲清"投影"这件事）
     *  - 只沙盘：下端收到沙盘底边，镜头自然拉近
     *  - 只图纸：包围盒退化成一张平面
     * 不跟着变的话，关掉图纸后相机还停在"沙盘 + 图纸"的远处，
     * 沙盘会一直缩在画面中间那一小块 —— 而用户点"关图纸"是想专心看山。
     */
    const topY = terrainVisible ? terrain.centerY() : projY;
    const botY = projVisible ? projY : terrain.baseBottomY();
    const pitch = terrainVisible ? CAM_PITCH_DEG : CAM_PITCH_2D_DEG;
    const pose = fitCameraPose(span, topY, botY, camera.aspect, pitch);
    camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
    controls.target.set(pose.target[0], pose.target[1], pose.target[2]);
    controls.minDistance = span * 0.12;
    controls.maxDistance = span * 3.2;
    camera.far = span * 8;
    camera.updateProjectionMatrix();
  }

  function refresh(f: DemField, colorOf: (altitude: number) => Rgb): void {
    const isNewField = field !== f;
    field = f;
    /*
     * 采样框（网格数 / 边长米）变了必须**重建**，不能只 `update`。
     *
     * `createTerrain` 里地表平面、裙边、底板、投影面这四块几何的 X/Z 坐标
     * 都是构造时按 `span` 一次摊开的，`update()` 只重算顶点高度；而拾取
     * (`pick` → `worldToGrid`)、屏幕投影 (`project`)、剖面折世界坐标
     * (`buildProfile`) 用的一律是**当次** `field.spanM`。
     *
     * 于是"第一个样本是 30 km、之后切到 60 km 的临汾盆地"这种组合会静默错位：
     * 网格按 30 km 摊开、剖面按 60 km 折坐标 ⇒ 端点飞到滑板外，
     * 整块地形还按一半的水平尺度显示。旧代码只在 `terrain === null` 时建，
     * 之后永远 `update`，跨样本换跨度就没人管了。
     */
    if (terrain && (terrain.spanM !== f.spanM || terrain.grid !== f.grid)) {
      scene.remove(terrain.group);
      terrain.dispose();
      terrain = null;
    }
    if (!terrain) {
      terrain = createTerrain(f, colorOf);
      scene.add(terrain.group);
      /*
       * 重建后**必须自己补上沙盘显隐**。
       *
       * 与下面的 setContours / setProjection / setProfile 不同：那三样是
       * `engine` 的参数，换山时它紧接着就会重灌；而 `terrainVisible` 是
       * **view3d 自己的状态**，换山不会让它变化 ⇒ engine 不会重新下发。
       * 不补的话，学生在"只看平面图"模式下切一座山，沙盘会自己冒出来。
       */
      terrain.setTerrainVisible(terrainVisible);
      // 第一次拿到地形时摆好相机
      scene.fog = new THREE.Fog(SKY.clone(), f.spanM * FOG_NEAR, f.spanM * FOG_FAR);
      frameAssembly(f);
      buildRoute(f);
      // ⚠ 重建后**不在这里**补 setContours / setProjection / setProfile：
      // 调用方（engine.apply 的 mountainChanged 分支）紧接着就会重新灌一遍，
      // 在这里再灌一次会和它抢顺序、也容易漏掉它才知道的 state。
    } else {
      terrain.update(f, colorOf);
    }
    if (isNewField) {
      buildRoute(f);
      // 换山：把相机拉回默认视角（否则新山可能整个在视野外）
      frameAssembly(f);
      roamT = 0;
      roamDir = 1;
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.near = f.spanM * FOG_NEAR;
        scene.fog.far = f.spanM * FOG_FAR;
      }
    }
    /*
     * 标注线是**贴地**的 —— 纵向夸张一改，地表抬了/压了，旧线的 Y 就全错位
     * （夸张 ×20 的华北大平原上，按 ×1 记下的 Y 会让整条脊线沉进地下）。
     * 所以这里用**同一份标注数据**重铺一遍，坐标重新按新 `visualY` 算。
     * 数据没变，所以不需要 engine 参与。
     */
    if (lastAnnot) {
      setAnnotations(lastAnnot);
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

  /**
   * 三维沙盘显隐。**必须重新取景**：关掉后画面里只剩那张纸，
   * 相机若还停在"沙盘 + 图纸"的中点，图纸会缩在画面一角。
   */
  function setTerrainVisible(visible: boolean): void {
    terrainVisible = visible;
    terrain?.setTerrainVisible(visible);
    /*
     * 部位标注同样是"贴在地表上"的东西：沙盘收起来（只剩平面图纸）之后，
     * 那些记号会孤零零浮在半空，不如整层一起收掉 ——
     * 学生这时要看的是**图纸上**那份标注，由 `drawProjectionMap` 画。
     */
    annotGroup.visible = visible;
    if (field) frameAssembly(field);
  }

  /**
   * 切二维图纸的显隐 + **必要时重新取景**。
   *
   * 图纸的显隐会改变装配体的下端（图纸高度 ↔ 沙盘底边），取景得跟着更新。
   * 只在可见性**真的变了**时才重取景 —— `pushProjection` 在改海拔 / 换季节 /
   * 画剖面时都会被调用，每次都重置视角会把学生自己转好的角度一直打回去。
   */
  function setProjection(s: ProjectionSettings): void {
    terrain?.setProjection(s);
    if (s.visible !== projVisible) {
      projVisible = s.visible;
      if (field) frameAssembly(field);
    }
  }

  /**
   * 清空标注层。
   *
   * 几何体/材质都要 `dispose`，否则每点一次按钮就漏一份显存。
   * 一类记号共用同一个 geometry/material，于是同一个对象会被多个子节点
   * 各 dispose 一次 —— 这是**安全的**：three.js 的 dispose 只是把资源从
   * renderer 的缓存里摘掉，重复摘同一个键是空操作。
   */
  function clearAnnotations(): void {
    for (const child of annotGroup.children) {
      const withGeo = child as THREE.Mesh;
      withGeo.geometry?.dispose?.();
      const mat = withGeo.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) {
        for (const x of mat) {
          x.dispose();
        }
      } else {
        mat?.dispose?.();
      }
    }
    annotGroup.clear();
    annotMaterials.length = 0;
  }

  /**
   * 画一条**贴地**的骨架折线（山脊 / 山谷）。
   *
   * 用 `LineSegments2` 而不是 `THREE.Line`：WebGL 下 `LineBasicMaterial.linewidth`
   * 在绝大多数平台被忽略（永远细成 1 px），山脊线压在花花绿绿的地形上根本看不清。
   * `Line2` 家族是在着色器里按屏幕像素扩宽的，`linewidth: 2.5` 处处都是 2.5 px。
   *
   * 顶点逐一按 `sampleGrid + visualY` 抬到地表之上 `liftM`，
   * 否则会和地表 z-fighting 闪成虚线 —— 与 `terrain.ts` 里贴地折线同一个口径。
   *
   * `liftM` **必须是显式参数**，不能省：同一条折线现在要画两遍（白垫线 + 彩线），
   * 两遍落在**完全相同的深度**上时谁压谁由浮点误差决定，彩线会被垫线啃成虚线
   * （看起来比不加垫线还糊）。垫线低一点、彩线高一点，遮挡关系才是确定的。
   */
  function addDrapedLines(
    f: DemField,
    lines: Array<Array<[number, number]>>,
    color: string,
    opts: { width: number; liftM: number; order: number; opacity?: number }
  ): void {
    const seg: number[] = [];
    for (const ln of lines) {
      if (ln.length < 2) {
        continue;
      }
      let prev = worldPoint(f, ln[0][0], ln[0][1], opts.liftM);
      for (let k = 1; k < ln.length; k++) {
        const cur = worldPoint(f, ln[k][0], ln[k][1], opts.liftM);
        seg.push(prev[0], prev[1], prev[2], cur[0], cur[1], cur[2]);
        prev = cur;
      }
    }
    if (!seg.length) {
      return;
    }
    const geo = new LineSegmentsGeometry();
    geo.setPositions(seg);
    const mat = new LineMaterial({
      color: new THREE.Color(color).getHex(),
      linewidth: opts.width,
      // 画在等高线之上、剖面段之下（剖面是学生自己画的东西，优先级最高）
      depthTest: true,
      transparent: true,
      opacity: opts.opacity ?? 0.95
    });
    mat.resolution.copy(annotResolution);
    annotMaterials.push(mat);
    const obj = new LineSegments2(geo, mat);
    obj.renderOrder = opts.order;
    annotGroup.add(obj);
  }

  /** 网格坐标 + 海拔 → 世界坐标（抬到地表之上一点点，避免 z-fighting） */
  function worldPoint(f: DemField, gx: number, gy: number, liftM = 0): [number, number, number] {
    const [x, z] = gridToWorld(f, gx, gy);
    const alt = sampleGrid(f, gx, gy);
    return [x, visualY(f, alt) + liftM, z];
  }

  /**
   * 部位记号的几何形状。
   *
   * 三块画面（三维 / 投影图纸 / 平面图）用的是**同一套形状语义**：
   *   山峰 ▲向上  鞍部 ◆菱形  陡崖 ▼向下
   * 形状本身带信息，所以色觉不同的学生也能靠形状区分这几类。
   */
  function addMarkers(
    f: DemField,
    pts: Array<{ i: number; j: number }>,
    color: string,
    kind: "up" | "down" | "diamond"
  ): void {
    if (!pts.length) {
      return;
    }
    const r = f.spanM * 0.006;
    const geo =
      kind === "diamond"
        ? new THREE.OctahedronGeometry(r, 0)
        : new THREE.ConeGeometry(r, r * 2.1, 4); // 四棱锥：正面看就是一个三角形记号
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color) });
    geo.rotateY(Math.PI / 4);
    if (kind === "down") {
      geo.rotateX(Math.PI);
    }
    for (const p of pts) {
      const [x, y, z] = worldPoint(f, p.i, p.j);
      const m = new THREE.Mesh(geo, mat);
      // 记号中心抬半个身高，看起来像是"立在地面上"
      m.position.set(x, y + r * 1.05, z);
      m.renderOrder = 3;
      annotGroup.add(m);
    }
  }

  /**
   * 重建整个标注层。
   *
   * 前一次的对象先释放；`field` 为空（视图刚建、还没 refresh）时直接清空返回。
   */
  function setAnnotations(a: PartAnnotation | null): void {
    lastAnnot = a;
    clearAnnotations();
    const f = field;
    if (!f || !a) {
      return;
    }
    /*
     * 谷线画两遍：**白垫线打底 + 彩线叠上**；脊线保持原样。
     *
     * 起因：收到的反馈是「模板山地里山谷的标注不太明显」。先量再改（真机探针，
     * 逐类开关的三维差集）：山谷的屏幕足迹只有 **104 px**、最大通道差 **118**；
     * 山脊 **359 px** / **196** —— 足迹差 3.5 倍。
     *
     * 数量上两者并不悬殊（模板山地检出 76 vs 63 格），差的是**形态**：
     * 山脊是一条完整脊线，山谷是树枝状散点，骨架化出来的折线总长
     * 99.2 格 vs 46.2 格。长度属于地形结构，改它要动模板判定与全部基线；
     * 能改的是显示层 —— 用垫线把谷线从等高线底色里"抠"出来，并适当加粗。
     *
     * ⚠ **脊线故意不加垫线**（第一版给它也加了，8 倍放大后发现问题）：
     * 脊线翻过山脊棱线时会被地形遮掉一截，垫线比彩线宽 ⇒ 被遮处**露出白边**，
     * 还散成几块白色碎片。而这本就是个"灯下黑"的改动：脊线原本就有 196 的
     * 通道差（五类最高），根本没有看不清的问题。**只改被点名的那一条**，
     * 顺带还让"带白边的蓝线 = 山谷"成为一种可区分的视觉特征。
     */
    const liftHalo = f.spanM * 0.004;
    const liftLine = f.spanM * 0.008;
    // 1 白垫线（先画、位置更低 ⇒ 彩线必然压在它之上）
    addDrapedLines(f, a.valleyLines, "#ffffff", { width: 5.4, liftM: liftHalo, order: 1, opacity: 0.7 });
    // 2 彩色骨架线（脊线口径与 v2.4.2 完全一致：2.6px、不抬升）
    addDrapedLines(f, a.ridgeLines, PART_COLORS.ridge, { width: 2.6, liftM: 0, order: 2 });
    addDrapedLines(f, a.valleyLines, PART_COLORS.valley, { width: 3.7, liftM: liftLine, order: 2 });
    addMarkers(f, a.peaks, PART_COLORS.peak, "up");
    addMarkers(f, a.saddles, PART_COLORS.saddle, "diamond");
    addMarkers(f, a.cliffs, PART_COLORS.cliff, "down");
    annotGroup.visible = terrainVisible;
  }

  /**
   * 把相机钉在一个位姿上（**回归取证专用**）。
   *
   * 「同机位差集」是判断"某个东西在屏幕上到底占了多少像素"最干净的手段，
   * 但切开关会触发重新取景 ⇒ 两张图机位不同，差集就废了。
   * 有了它就能"先切状态、再把相机摆回原处"，取证仍然干净。
   */
  function lockCamera(
    eye: [number, number, number] | null,
    target?: [number, number, number]
  ): void {
    if (!eye) {
      // 解除：交回自动取景
      if (field) frameAssembly(field);
      return;
    }
    camera.position.set(eye[0], eye[1], eye[2]);
    controls.target.set(target?.[0] ?? 0, target?.[1] ?? 0, target?.[2] ?? 0);
    controls.update();
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
      triangles: renderer.info.render.triangles,
      centerY: terrain?.centerY() ?? 0,
      projectionY: terrain?.projectionY() ?? 0,
      /** 沙盘本体是否显示（关掉后只剩图纸，拾取平面也随之切换） */
      terrainVisible,
      /** 二维图纸是否显示 */
      projectionVisible: terrain?.projectionVisible ?? false,
      /**
       * 场景里每个子对象的可见性明细。
       *
       * 只报一个布尔状态的调试钩子会被"状态改了、画面没变"骗过去 ——
       * 必须能读到对象**自己**的 `visible`，否则分不清是"没设上"还是"设上了但没渲染"。
       */
      meshes: terrain
        ? terrain.group.children.map((c) => ({ name: c.name || c.type, visible: c.visible }))
        : [],
      // 渲染网格**按哪个采样框建的**：必须与当前 field 的 grid/spanM 一致。
      // 不一致就说明"网格那一份"没跟上样本（剖面、拾取、投影全按 field.spanM 走）。
      terrainGrid: terrain?.grid ?? 0,
      terrainSpanM: terrain?.spanM ?? 0,
      /**
       * 部位标注层：对象个数与整层可见性。
       *
       * 只报 `showParts` 那种**参数**是不够的 —— 回归要验的是"对象真的建出来了"，
       * 所以这里报场景里的实际子对象数（0 就说明按钮点了但什么都没建）。
       */
      annotObjects: annotGroup.children.length,
      annotVisible: annotGroup.visible
    };
  }

  resize();
  tick();

  return {
    refresh,
    setContours: (s) => terrain?.setContours(s),
    setProjection,
    setProfile: (s) => terrain?.setProfile(s),
    setAnnotations,
    setTerrainVisible,
    lockCamera,
    setSun,
    setMode,
    route: () => routePts.slice(),
    resize,
    pick,
    project,
    debug,
    dispose() {
      disposed = true;
      controls.dispose();
      clearAnnotations();
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
