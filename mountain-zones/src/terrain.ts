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
  /** 重算顶点高度与颜色（改海拔 / 换山 / 换季都要调） */
  update(field: DemField, colorOf: (altitude: number) => Rgb): void;
  setContours(s: ContourSettings): void;
  /** 地形中心的视觉高度，供相机对准 */
  centerY(): number;
  dispose(): void;
}

/** 底座在最低点之下再延伸这么多（占地形跨度的比例） */
const SKIRT_DROP = 0.055;

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

  /** 裙边与底板的深色（顶部略浅、底部近黑，像土壤-基岩剖面） */
  const SKIRT_TOP = new THREE.Color("#5b4a3a");
  const SKIRT_BOT = new THREE.Color("#241c16");
  const tmpColor = new THREE.Color();

  let baseY = 0;
  let lastCenterY = 0;

  function update(f: DemField, colorFn: (altitude: number) => Rgb): void {
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

    baseY = visualY(f, f.minH) - span * SKIRT_DROP;
    lastCenterY = (visualY(f, f.minH) + visualY(f, f.maxH)) / 2;

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
  }

  function setContours(s: ContourSettings): void {
    uEnabled.value = s.enabled ? 1 : 0;
    uInterval.value = Math.max(20, s.interval);
    uMajor.value = Math.max(2, Math.round(s.majorEvery));
    uOpacity.value = Math.max(0, Math.min(1, s.opacity));
    uHighlight.value = s.highlight == null ? -99999 : s.highlight;
  }

  update(field, colorOf);
  setContours({ enabled: true, interval: 200, majorEvery: 5, opacity: 0.5, highlight: null });

  return {
    group,
    update,
    setContours,
    centerY: () => lastCenterY,
    dispose() {
      geo.dispose();
      skirtGeo.dispose();
      baseGeo.dispose();
      material.dispose();
      skirtMat.dispose();
      baseMat.dispose();
    }
  };
}
