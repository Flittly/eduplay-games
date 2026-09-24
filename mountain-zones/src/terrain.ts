/**
 * 三维地形网格：把高程场变成一块可以看的地形模型。
 *
 * ## 为什么要有「裙边」
 *
 * 只渲染地表会得到一块**悬空的方片** —— 一转到侧视角就露馅，正是「看起来很假」的
 * 那种假。这里给四条边都加上侧壁、底下加一块底板，整块变成一个**地质标本块**
 * （像博物馆里那种地形沙盘）。侧壁高度跟着边缘地形走，所以任何视角下轮廓都合理，
 * 也顺带把「模型边界」这件事讲清楚了。
 *
 * ## 顶点顺序与 DEM 数组直接对齐
 *
 * `PlaneGeometry(w, h, grid-1, grid-1)` 绕 X 轴转 −90° 之后，顶点索引恰好等于
 * `j * grid + i`（i 向东、j 向南），与 `DemField.alt` 的行主序完全一致 ——
 * 不需要任何重映射，这也是能直接 `setY(k, ...)` 的原因。
 *
 * ## 等高线在地表上
 *
 * 用 `onBeforeCompile` 把等高线注入到标准材质的片元着色器里，按**顶点世界坐标的 y**
 * （即已经乘过垂直夸张的视觉高度）取模画线，并用 `fwidth` 做屏幕空间抗锯齿 ——
 * 这样线宽在远近处都恒定，不会像 `LineSegments` 那样受 `lineWidth` 只支持 1 px 的限制。
 */

import * as THREE from "three";
import type { DemField } from "./data/types";
import { visualY } from "./dem";
import { bilerp } from "./contour";
import {
  assemblyBaseY,
  assemblyCenterY,
  assemblyProjectionY
} from "./layout";

export type Rgb = [number, number, number];

export interface ContourSettings {
  enabled: boolean;
  /** 基本等高距（米，按视觉高度算） */
  interval: number;
  /** 每几条画一条加粗的「计曲线」 */
  majorEvery: number;
  opacity: number;
  /** 高亮某一条等高线（米）；null 表示不高亮 */
  highlight?: number | null;
}

export interface TerrainHandle {
  group: THREE.Group;
  /**
   * 这块网格是按哪个采样框建出来的（`grid` 顶点数、`spanM` 边长米）。
   *
   * ⚠️ 这两个值**只在构造时定一次**，`update()` 改不了 —— 地表平面、裙边、
   * 底板、投影面四块几何的 X/Z 位置全部是构造时按 `span` 摊开的，顶点高度才是
   * 每次 `update` 重算的。所以调用方换样本时**必须拿这两个值比对**：
   * 一旦新样本的采样框与旧的不同，就得整个重建，不能只 `update`。
   *
   * 这条不是理论洁癖：2026-09 的真实地形从 4 座山扩到 8 个样本时，只有
   * 临汾盆地是 60 km（其余 30 km），而剖面段是按**当次** `f.spanM` 折世界坐标的、
   * 网格还停在旧跨度 ⇒ 剖面端点被画到滑板外 4~8 km 的空中，
   * 且整块地形按一半的水平尺度显示（垂直夸张实际翻倍），
   * 剖面读数（29.1 km）也是地面真实长度的两倍。全程没有任何报错。
   */
  readonly grid: number;
  readonly spanM: number;
  /** 三维沙盘本体的显隐状态（供调试钩子与回归断言读取） */
  readonly terrainVisible: boolean;
  /** 二维图纸的显隐状态 */
  readonly projectionVisible: boolean;
  /** 重算顶点高度与颜色（改海拔 / 换山 / 换季都要调） */
  update(field: DemField, colorOf: (altitude: number) => Rgb): void;
  setContours(s: ContourSettings): void;
  /** 二维投影面（3D 山地正下方的等高线图）的显隐与重绘 */
  setProjection(s: ProjectionSettings): void;
  /**
   * 画学生点的剖面段：**贴地折线** + 两端各一条垂到图纸的引线。
   *
   * 贴地折线必须落在**地表之上**一点点（`PROFILE_LIFT`），否则会与地表 z-fighting
   * 闪成虚线；引线一直落到图纸面，把"山上这段 → 纸上这段"连起来。
   */
  setProfile(segs: ProfileSegmentDraw[]): void;
  /**
   * 三维沙盘本体的显隐（地表 + 裙边 + 底板 + 贴地剖面折线）。
   *
   * 关掉它只剩二维图纸，是为了**单看平面图** —— 所以四角引线与图纸不受影响，
   * 图纸上的剖面段也在（那是贴图上画的，由 `setProjection` 的 `draw` 负责）。
   * 这不是"隐藏整个 group"能替代的：论文图纸若一并隐藏，这个开关就没有意义了。
   */
  setTerrainVisible(visible: boolean): void;
  /** 地形中心的视觉高度，供相机对准 */
  centerY(): number;
  /** 沙盘"厚度"的底边高度（藏起图纸后，取景的下端就是它） */
  baseBottomY(): number;
  /** 二维投影面的视觉高度（相机取景要把这块也算进去） */
  projectionY(): number;
  dispose(): void;
}

/**
 * 二维投影面：在三维沙盘**正下方**铺一张等高线平面图，象"沙盘落在图纸上"。
 *
 * 这是本期教学上的关键一步 —— 学生要能从"摸得着的山"过渡到"纸上的等高线"，
 * 中间必须有一座桥。桥就是"垂直投影"这四个字：
 *
 *  - 图纸画的是同一份高程场（复用 `extractContour` 的折线，**不是**另算一套），
 *    所以纸上的圈圈和山上的圈圈逐条对得上；
 *  - 四角各有四条**竖直引线**从图纸拉到沙盘边缘，把"投影"这件事画出来；
 *  - 沙盘本身悬在图纸上方留一道缝（`PROJECTION_GAP`），而不是贴在纸面上 ——
 *    贴上去就分不清哪条是山、哪条是线了。
 *
 * ⚠️ 贴图是**调用方画好交给我们的**（`draw` 回调），`terrain.ts` 不认识等高线、
 * 不认识纸色。这样模块边界干净，也避免这里 import `panels.ts` 造成循环依赖。
 */
export interface ProjectionSettings {
  visible: boolean;
  /** 画布边长（像素），方形绘制区，调用方按这个尺寸铺满 */
  draw: ((g: CanvasRenderingContext2D, size: number) => void) | null;
}

/** 一条学生点的剖面段（网格坐标 + 配色） */
export interface ProfileSegmentDraw {
  color: string;
  a: [number, number];
  b: [number, number];
}

/**
 * 投影面贴图边长（像素）。1024 足够看清等高线注记，显存也才 4 MB。
 *
 * 注：「底座下落多少」「图纸离多远」这两个几何比例**不在这里定义** ——
 * 它们和相机取景是一套耦合的坐标约定，统一放在 `layout.ts`，
 * 免得改了一处、另一处还按旧口径取景（v2.2.0 的图纸被沙盘压住 94% 就是这么来的）。
 */
const PROJECTION_TEX = 1024;

export function createTerrain(field: DemField, colorOf: (altitude: number) => Rgb): TerrainHandle {
  const grid = field.grid;
  const span = field.spanM;
  const verts = grid * grid;

  // ---------- 地表 ----------
  const geo = new THREE.PlaneGeometry(span, span, grid - 1, grid - 1);
  geo.rotateX(-Math.PI / 2);
  const colors = new Float32Array(verts * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  // ---------- 等高线参数（注入材质） ----------
  const uInterval = { value: 200 };
  const uMajor = { value: 5 };
  const uOpacity = { value: 0.5 };
  const uEnabled = { value: 1 };
  /** 高亮线的高度；-99999 表示无高亮 */
  const uHighlight = { value: -99999 };

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0.0,
    flatShading: false
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uInterval = uInterval;
    shader.uniforms.uMajor = uMajor;
    shader.uniforms.uOpacity = uOpacity;
    shader.uniforms.uEnabled = uEnabled;
    shader.uniforms.uHighlight = uHighlight;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying float vVisualY;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vVisualY = (modelMatrix * vec4(transformed, 1.0)).y;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying float vVisualY;
         uniform float uInterval;
         uniform float uMajor;
         uniform float uOpacity;
         uniform float uEnabled;
         uniform float uHighlight;
         // 返回该点在屏幕上的「线上程度」：1 = 正好压线，0 = 离得远
         float contourLine(float y, float interval, float widthPx) {
           float rel = y / interval;
           float f = fract(rel);
           float d = min(f, 1.0 - f);
           // 陡坡上 fwidth 会很大，线会糊成一片 —— 钳一个上限
           float w = clamp(fwidth(rel) * widthPx, 1e-5, 0.12);
           return 1.0 - smoothstep(0.0, w, d);
         }
         // 指定高度附近的一条线（清单里点选的那条）
         float levelLine(float y, float level, float tol, float widthPx) {
           float rel = (y - level) / tol;
           float w = clamp(fwidth(rel) * widthPx, 1e-5, 0.12);
           return 1.0 - smoothstep(0.0, w, abs(rel));
         }`
      )
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
         if (uEnabled > 0.5) {
           float thin = contourLine(vVisualY, uInterval, 1.1);
           float thick = contourLine(vVisualY, uInterval * uMajor, 1.9);
           float k = max(thin * 0.55, thick);
           // 线色偏暖黑，压在地表上像铅笔线，不像黑色贴纸
           gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.13, 0.10, 0.08), k * uOpacity);
           if (uHighlight > -9999.0) {
             float hl = levelLine(vVisualY, uHighlight, max(8.0, uInterval * 0.35), 3.2);
             gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.78, 0.13, 0.07), hl);
           }
         }`
      );
  };
  // 注入过 shader 的材质要给它一个稳定的缓存键，否则换山重建时会命中旧程序
  material.customProgramCacheKey = () => "mz-terrain-contour-v1";

  const terrain = new THREE.Mesh(geo, material);
  terrain.name = "terrain";

  // ---------- 裙边（四壁） ----------
  const edgeCount = 4 * grid;
  const skirtGeo = new THREE.BufferGeometry();
  const skirtPos = new Float32Array(edgeCount * 2 * 3);
  const skirtCol = new Float32Array(edgeCount * 2 * 3);
  skirtGeo.setAttribute("position", new THREE.BufferAttribute(skirtPos, 3));
  skirtGeo.setAttribute("color", new THREE.BufferAttribute(skirtCol, 3));
  const skirtIdx: number[] = [];
  for (let e = 0; e < 4; e++) {
    const base = e * grid * 2;
    for (let k = 0; k < grid - 1; k++) {
      const a = base + k * 2;
      const b = base + k * 2 + 1;
      const c = base + (k + 1) * 2;
      const d = base + (k + 1) * 2 + 1;
      skirtIdx.push(a, b, c, b, d, c);
    }
    // 相邻两条边之间补一个四边形，避免转角处露出缺口
    if (e < 3) {
      const a = e * grid * 2 + (grid - 1) * 2;
      const b = e * grid * 2 + (grid - 1) * 2 + 1;
      const c = (e + 1) * grid * 2;
      const d = (e + 1) * grid * 2 + 1;
      skirtIdx.push(a, b, c, b, d, c);
    }
  }
  skirtGeo.setIndex(skirtIdx);
  const skirtMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
    side: THREE.DoubleSide
  });
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);
  skirt.name = "skirt";

  // ---------- 底板 ----------
  const baseGeo = new THREE.PlaneGeometry(span, span);
  baseGeo.rotateX(Math.PI / 2);
  const baseMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#241c16"),
    roughness: 1.0,
    metalness: 0.0
  });
  const basePlane = new THREE.Mesh(baseGeo, baseMat);
  basePlane.name = "base";

  const group = new THREE.Group();
  group.add(terrain, skirt, basePlane);

  // ---------- 二维投影面（正下方的等高线图纸） ----------
  const projCanvas = document.createElement("canvas");
  projCanvas.width = PROJECTION_TEX;
  projCanvas.height = PROJECTION_TEX;
  const projCtx = projCanvas.getContext("2d");
  const projTex = new THREE.CanvasTexture(projCanvas);
  // 输出色彩空间是 sRGB，贴图必须声明为 sRGB，否则纸色会偏暗偏灰
  projTex.colorSpace = THREE.SRGBColorSpace;
  projTex.anisotropy = 4;
  const projGeo = new THREE.PlaneGeometry(span, span);
  projGeo.rotateX(-Math.PI / 2);
  const projMat = new THREE.MeshBasicMaterial({
    map: projTex,
    side: THREE.DoubleSide,
    toneMapped: false,
    /*
     * 图纸不吃雾。
     *
     * 雾是「空气透视」—— 给远山加层次用的。可图纸是**图**，不是景物：
     * 它会落在离相机 1.9 跨度的地方，按山体的雾区间会被罩掉三成对比度，
     * 等高线糊成一片灰。关掉之后图纸永远是纸的本色。
     */
    fog: false
  });
  const projPlane = new THREE.Mesh(projGeo, projMat);
  projPlane.name = "projection";

  /**
   * 投影引线：四角各拉一条竖线，从图纸面拉到**底座高度**。
   * 不拉到地表 —— 地表高度是起伏的，四条线长短不一反而乱；
   * 拉到同一水平面（底座）读起来就是"这块沙盘是从下面那张图纸长出来的"。
   */
  const guideGeo = new THREE.BufferGeometry();
  const guidePos = new Float32Array(4 * 2 * 3);
  guideGeo.setAttribute("position", new THREE.BufferAttribute(guidePos, 3));
  const guideMat = new THREE.LineBasicMaterial({
    color: new THREE.Color("#8a7a63"),
    transparent: true,
    opacity: 0.55,
    // 与图纸同理：引线是"图纸的一部分"，不该被空气染淡（否则远端那两条几乎看不见）
    fog: false
  });
  const guideLines = new THREE.LineSegments(guideGeo, guideMat);
  guideLines.name = "projection-guides";

  group.add(projPlane, guideLines);

  /** 图纸面所在的 y（`update` 里随地形重算） */
  let lastProjY = 0;
  /** 最近一次的 field（`setProfile` 要用它把网格坐标折成世界坐标） */
  let lastField: DemField | null = null;
  /** 每条剖面段的采样点数：118 m 格距、30 km 跨度 ⇒ 一段最多 ~250 格，取 140 够密 */
  const PROFILE_SAMPLES = 140;
  /** 贴地折线抬离地表的高度（占跨度的比例）——不抬高会与地表 z-fighting */
  const PROFILE_LIFT = 0.006;

  const profileGroup = new THREE.Group();
  profileGroup.name = "profile";
  group.add(profileGroup);

  /** 裙边与底板的深色（顶部略浅、底部近黑，像土壤-基岩剖面） */
  const SKIRT_TOP = new THREE.Color("#5b4a3a");
  const SKIRT_BOT = new THREE.Color("#241c16");
  const tmpColor = new THREE.Color();

  let baseY = 0;
  let lastCenterY = 0;
  /** 三维沙盘本体是否显示（关掉后只剩二维图纸） */
  let terrainVisible = true;
  /** 二维图纸是否显示（由 `setProjection` 更新，供调试钩子读取） */
  let projectionVisible = false;

  function update(f: DemField, colorFn: (altitude: number) => Rgb): void {
    lastField = f;
    const { alt } = f;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col = geo.attributes.color as THREE.BufferAttribute;
    for (let k = 0; k < verts; k++) {
      const y = visualY(f, alt[k]);
      pos.setY(k, y);
      const c = colorFn(alt[k]);
      col.setXYZ(k, c[0], c[1], c[2]);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    baseY = assemblyBaseY(span, visualY(f, f.minH));
    lastCenterY = assemblyCenterY(visualY(f, f.minH), visualY(f, f.maxH));

    // 裙边顶点：顶边贴地形轮廓，底边落在 baseY
    const d = grid - 1;
    let w = 0;
    const putEdge = (iGetter: (k: number) => number, jGetter: (k: number) => number) => {
      for (let k = 0; k < grid; k++) {
        const i = iGetter(k);
        const j = jGetter(k);
        const x = (i / d) * span - span / 2;
        const z = (j / d) * span - span / 2;
        const topY = visualY(f, f.alt[j * grid + i]);
        // 上顶点
        skirtPos[w * 3] = x;
        skirtPos[w * 3 + 1] = topY;
        skirtPos[w * 3 + 2] = z;
        tmpColor.copy(SKIRT_TOP).multiplyScalar(0.85 + 0.3 * ((alt[j * grid + i] - f.minH) / Math.max(1, f.maxH - f.minH)));
        skirtCol[w * 3] = tmpColor.r;
        skirtCol[w * 3 + 1] = tmpColor.g;
        skirtCol[w * 3 + 2] = tmpColor.b;
        w++;
        // 下顶点
        skirtPos[w * 3] = x;
        skirtPos[w * 3 + 1] = baseY;
        skirtPos[w * 3 + 2] = z;
        skirtCol[w * 3] = SKIRT_BOT.r;
        skirtCol[w * 3 + 1] = SKIRT_BOT.g;
        skirtCol[w * 3 + 2] = SKIRT_BOT.b;
        w++;
      }
    };
    putEdge((k) => k, () => 0);                       // 北
    putEdge(() => grid - 1, (k) => k);                // 东
    putEdge((k) => grid - 1 - k, () => grid - 1);     // 南
    putEdge(() => 0, (k) => grid - 1 - k);            // 西

    (skirtGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (skirtGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    skirtGeo.computeVertexNormals();
    skirtGeo.computeBoundingSphere();

    basePlane.position.y = baseY;

    // ---- 二维投影面与四角引线 ----
    lastProjY = assemblyProjectionY(span, visualY(f, f.minH));
    projPlane.position.y = lastProjY;
    const half = span / 2;
    const corners: Array<[number, number]> = [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half]
    ];
    corners.forEach(([x, z], k) => {
      const o = k * 6;
      guidePos[o] = x;
      guidePos[o + 1] = lastProjY;
      guidePos[o + 2] = z;
      guidePos[o + 3] = x;
      guidePos[o + 4] = baseY;
      guidePos[o + 5] = z;
    });
    (guideGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    guideGeo.computeBoundingSphere();

    // 地表高度变了 ⇒ 贴地折线与端点球都要按新高度重画
    buildProfile();
  }

  /** 重画贴图 + 切显隐。`draw` 为 null 时只切显隐，不动贴图 */
  function setProjection(s: ProjectionSettings): void {
    projectionVisible = s.visible;
    projPlane.visible = s.visible;
    guideLines.visible = s.visible;
    if (s.draw && projCtx) {
      projCtx.setTransform(1, 0, 0, 1, 0, 0);
      projCtx.clearRect(0, 0, PROJECTION_TEX, PROJECTION_TEX);
      s.draw(projCtx, PROJECTION_TEX);
      projTex.needsUpdate = true;
    }
  }

  /** 当前要画的剖面段（`update` 改海拔后要按新高度重画，所以留着） */
  let lastSegs: ProfileSegmentDraw[] = [];

  /**
   * 清空剖面组里的所有子对象。几何与材质都要 dispose，
   * 不然改海拔几十次（每改一次就重画一次）会漏一堆 GPU 资源。
   */
  function clearProfile(): void {
    for (const child of [...profileGroup.children]) {
      profileGroup.remove(child);
      const m = child as THREE.Mesh | THREE.Line | THREE.LineSegments;
      m.geometry?.dispose();
      const mat = (m as THREE.Mesh).material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    }
  }

  /**
   * 按当前 field 重建剖面段几何。改海拔 / 调夸张 / 换山后地表高度变了，
   * 贴地折线必须跟着重画 —— 否则线会浮在空中或埋进山里。
   */
  function buildProfile(): void {
    clearProfile();
    const f = lastField;
    if (!f || lastSegs.length === 0) {
      return;
    }
    const d = f.grid - 1;
    const half = f.spanM / 2;
    const toWorldX = (gi: number) => (gi / d) * f.spanM - half;
    const toWorldZ = (gj: number) => (gj / d) * f.spanM - half;
    const h = (i: number, j: number) => f.alt[Math.max(0, Math.min(f.grid - 1, j)) * f.grid + Math.max(0, Math.min(f.grid - 1, i))];

    for (const seg of lastSegs) {
      const n = PROFILE_SAMPLES;
      const surface: number[] = [];
      const pin: number[] = [];
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        const gi = seg.a[0] + (seg.b[0] - seg.a[0]) * t;
        const gj = seg.a[1] + (seg.b[1] - seg.a[1]) * t;
        const x = toWorldX(gi);
        const z = toWorldZ(gj);
        const y = visualY(f, bilerp(h, f.grid, gi, gj)) + f.spanM * PROFILE_LIFT;
        surface.push(x, y, z);
        // 两端各拉一条竖线到图纸面
        if (k === 0 || k === n - 1) {
          pin.push(x, y, z, x, lastProjY, z);
        }
      }
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(surface), 3));
      const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(seg.color) });
      const line = new THREE.Line(lineGeo, lineMat);
      line.renderOrder = 3;
      profileGroup.add(line);

      const pinGeo = new THREE.BufferGeometry();
      pinGeo.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(pin), 3));
      const pinMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(seg.color),
        transparent: true,
        opacity: 0.5
      });
      profileGroup.add(new THREE.LineSegments(pinGeo, pinMat));

      // 端点小球：点的"那两个点"必须一眼看得见，否则学生不知道自己点在哪
      const ballGeo = new THREE.SphereGeometry(f.spanM * 0.007, 12, 10);
      const ballMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(seg.color) });
      for (const p of [seg.a, seg.b]) {
        const ball = new THREE.Mesh(ballGeo, ballMat);
        ball.position.set(
          toWorldX(p[0]),
          visualY(f, bilerp(h, f.grid, p[0], p[1])) + f.spanM * PROFILE_LIFT,
          toWorldZ(p[1])
        );
        profileGroup.add(ball);
      }
    }
  }

  function setProfile(segs: ProfileSegmentDraw[]): void {
    lastSegs = segs.map((s) => ({ color: s.color, a: [s.a[0], s.a[1]], b: [s.b[0], s.b[1]] }));
    buildProfile();
  }

  function setContours(s: ContourSettings): void {
    uEnabled.value = s.enabled ? 1 : 0;
    uInterval.value = Math.max(20, s.interval);
    uMajor.value = Math.max(2, Math.round(s.majorEvery));
    uOpacity.value = Math.max(0, Math.min(1, s.opacity));
    uHighlight.value = s.highlight == null ? -99999 : s.highlight;
  }

  /**
   * 三维沙盘本体的显隐。
   *
   * 只关这四样（地表 / 裙边 / 底板 / 贴地剖面），**图纸与四角引线留着** ——
   * 这个开关的用途正是"把沙盘收起来、单看那张平面图"。
   */
  function setTerrainVisible(visible: boolean): void {
    terrainVisible = visible;
    terrain.visible = visible;
    skirt.visible = visible;
    basePlane.visible = visible;
    // 贴地折线 / 端点球 / 垂到图纸的引线都属于"三维那一份"；
    // 图纸上的剖面段是画在贴图里的（`setProjection` 的 draw 负责），不归这里管。
    profileGroup.visible = visible;
  }

  update(field, colorOf);
  setContours({ enabled: true, interval: 200, majorEvery: 5, opacity: 0.5, highlight: null });

  return {
    group,
    get grid() {
      return grid;
    },
    get spanM() {
      return span;
    },
    update,
    setContours,
    setProjection,
    setProfile,
    setTerrainVisible,
    get terrainVisible() {
      return terrainVisible;
    },
    get projectionVisible() {
      return projectionVisible;
    },
    centerY: () => lastCenterY,
    baseBottomY: () => baseY,
    projectionY: () => lastProjY,
    dispose() {
      clearProfile();
      geo.dispose();
      skirtGeo.dispose();
      baseGeo.dispose();
      projGeo.dispose();
      guideGeo.dispose();
      projTex.dispose();
      material.dispose();
      skirtMat.dispose();
      baseMat.dispose();
      projMat.dispose();
      guideMat.dispose();
    }
  };
}
