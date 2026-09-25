/**
 * 寰宇月球 · 主组件
 *
 * 三块画面：
 *  ① 三维场景（左「演示台」改状态 / 右「控制台」读数据 / 底「图层」决定画什么）
 *  ② 独立月相小窗：**从地球方向**看月球的实时渲染（可拖动、可收起）
 *  ③ 月相成因示意图（SVG，在右栏）
 *
 * ## 两个视角模式（v1.0.0 新增）
 *
 * **「日地月系统」（`orbit`，默认）** —— 地球固定在原点，真实的太阳在 +X 远处，
 * 月球沿半径 `MOON_ORBIT_R` 的轨道绕地球公转。它回答的是"月相是怎么来的"。
 *
 * **「月球特写」（`moon`）** —— 月球钉在原点，可自由旋转，太阳方向绕着它转。
 * 它回答的是"月面上现在哪里亮着"。
 *
 * ## 两个模式共用同一套物理，这不是巧合
 *
 * 体固坐标系：**+Z 恒指向地球**（潮汐锁定：月球对着地球的那张脸永远不转）、
 * +X 是月面东经、+Y 是北极。于是太阳在**体固系**里的方向恒为
 * `(sin λ, 0, cos λ)`、`λ = 180° − 360°×月龄/T` —— 两个模式都一样，
 * 因为"月面上现在是白天还是黑夜"本来就只取决于月龄。
 *
 * 两个模式只是在**世界系**里换了个讲法：
 *
 * | 模式 | 月球的世界位置 | 月球的世界姿态 | 世界太阳方向 |
 * |---|---|---|---|
 * | 月球特写 | `(0,0,0)` | 单位阵（体固系＝世界系） | `(sin λ, 0, cos λ)` |
 * | 日地月系统 | `r(cos φ, 0, −sin φ)` | `R_y(φ − 90°)` | 恒为 `(1, 0, 0)` |
 *
 * 其中 `φ = 360°×月龄/T` 是**公转方位角**（月龄 0 ＝ 新月 ＝ 月球跑到日地之间）。
 * 两条线能对上不是拟合出来的，是解出来的：把体固系的太阳方向用 `R_y(φ−90°)`
 * 转到世界系，恰好得 `(1,0,0)`，与"太阳固定在 +X"完全一致（见 §「轨道几何」注释）。
 *
 * ⚠ 不要「顺手」给月球加一个自转动画、也不要把两个模式的 `λ` 分开写：
 *   小窗里月相的形状完全由 `λ` 决定，两处一旦不同步，就会出现
 *   "大屏是满月、小窗是弯月"这种没人查得出来的矛盾。
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import PhaseDiagram from "./PhaseDiagram";
import SiteDialog from "./SiteDialog";
import {
  FEATURE_COLORS,
  FEATURE_KIND_NAMES,
  KEY_PHASES,
  MOON_FEATURES,
  ORBIT_COMPRESSION,
  ORBIT_SCENE,
  SYNODIC_MONTH,
  directionFor,
  earthFrameYaw,
  earthOrbitAngle,
  earthOrbitPosition,
  earthSpinAngle,
  isLandingSite,
  nearestPhaseDays,
  normalizeAge,
  orbitPosition,
  orbitYaw,
  phaseInfo,
  phaseName
} from "./moonPhase";
import type { MoonFeature } from "./moonPhase";
import { formatLat, formatLon } from "./moonSites";

export interface PlayerInfo {
  studentId: number;
  studentName: string;
  className: string | null;
  studentNo?: string;
}

/** 图层开关（底部「图层」栏的四列） */
export interface LayerState {
  /** 昼夜明暗：关掉＝整球受光，便于看清环形山与月海 */
  lighting: boolean;
  /** 晨昏线（昼夜分界的大圆），只在「昼夜明暗」打开时有意义 */
  terminator: boolean;
  /** 经纬网（月面经纬度，30° 一格） */
  grid: boolean;
  /** 月面地名标注 */
  features: boolean;
  /** 太阳方向指示（含光柱与"太阳"标记） */
  sunMarker: boolean;
  /** 地月方向指示（近地面中心朝向地球） */
  earthDir: boolean;
  /** 星空背景 */
  stars: boolean;
}

const DEFAULT_LAYERS: LayerState = {
  lighting: true,
  terminator: true,
  grid: false,
  features: true,
  sunMarker: true,
  earthDir: false,
  stars: true
};

const BG_SPACE = 0x070c16;
const BG_PHASE = 0x05090f;
/** 角度制 → 弧度。放在最前面：下面的常量表里就要用它 */
const DEG = Math.PI / 180;
const MOON_RADIUS = 1;
const CAM_DIST = 5.2;
const CAMERA_FOV = 42;
const PHASE_FOV = 30;
const PHASE_DIST = 4.6;
/**
 * 月相小窗的正交视景体半高（世界单位，月球半径=1）。
 * 取 1.2 ⇒ 月盘半径占半高的 1/1.2 = 83.3%，四周留一圈边。
 *
 * ⚠ 小窗**必须用正交相机**，这不是"随便挑一种投影"：
 *   课本公式「受照比例 = (1+cos 相位角)/2」是**正交投影**下的面积结果。
 *   用透视相机会引入 O(R/d) 量级的偏差 —— 实测 d=4.6 时，蛾眉月量出来 0.085
 *   而公式给 0.146（差 6 个百分点，肉眼完全看不出来，但数一数就对不上）。
 *   物理上也该是正交：地球离月球 38 万公里，视线几乎就是平行光。
 *   （另一个解法是把期望值改成透视公式 —— 那是拿"错模型"去迁就渲染，不可取。）
 */
const PHASE_FRUSTUM = 1.2;
/** 月相小窗的画布边长（CSS px）。CSS 与引擎必须用同一个值，否则画布被拉伸。 */
export const PHASE_CANVAS = 150;
/** 夜面环境光：给一点点，让"暗面"仍能看出月盘轮廓（真实世界里叫地照） */
const AMBIENT = 0.055;
const SUN_MARKER_DIST = 3.5;
/** 自动推进：一个朔望月走多少秒 */
const PLAY_SECONDS_PER_MONTH = 11;
const DEFAULT_AGE = SYNODIC_MONTH / 4; // 上弦月：晨昏线正好过正中，一眼能看懂

/* ---------------- 「日地月系统」视角的尺寸（世界单位，月球半径 = 1） ----------------
 * 口径全部住在 `moonPhase.ts` 的 `ORBIT_SCENE`（数据层，Node 单测能直接复算），
 * 这里只是取出来起个短名字 —— 同一个数字绝不在两处各写一遍。
 *
 * v1.1.0 起：**天体大小按真实比例**（地球 = 月球的 3.667 倍），距离压缩，太阳额外缩小。
 * 为什么必须压缩、各压缩了多少倍，见 `ORBIT_SCENE` / `ORBIT_COMPRESSION` 的注释。 */
const EARTH_RADIUS = ORBIT_SCENE.earthR;
const MOON_ORBIT_R = ORBIT_SCENE.moonDist;
const SUN_DIST = ORBIT_SCENE.sunDist;
const SUN_RADIUS = ORBIT_SCENE.sunR;
/**
 * 系统视角里"装饰"的世界尺寸相对 v1.2.0 要放大的倍数。
 *
 * v1.4.0 起取景要装下**整条地球公转轨道**（地球真的会走完一圈，见 `orbitFitPoints`），
 * 相机从约 60 退到约 171 ⇒ 一切世界尺寸在屏幕上按 1/2.85 缩小。
 * **天体半径不能跟着放大**（地球/月球 = 3.667 是教学事实，判据 I17 钉着），
 * 但虚线间隔（0.2 ⇒ 屏幕上只剩 0.9px）这种装饰放大了没有副作用，
 * 不放就会掉到 1 像素以下，直接看不见 —— 轨道虚线会糊成一条实线。
 *
 * ⚠ v1.4.5 起这里**不再管箭杆粗细** —— 阳光箭头整个删掉了（见 `sunArrow` 那一段的说明）。
 *
 * 取 2.7 = 太阳半径的放大倍数（5 → 13.5）：那个数就是为了同一件事定的
 * （按 1120×740 的取证窗口标定）。窗口比例不同时会有 ±20% 的出入 ——
 * 装饰差一点点无所谓，只有天体大小必须真实。
 */
const ORBIT_DECO = SUN_RADIUS / 5;
/**
 * 「日地月系统」取景要装下的**包络半径**（世界单位，**与地球走到哪儿无关**）。
 *
 * 最外圈 = 地球公转轨道 + 月球轨道 + 月球半径：地球在轨道上的任何位置，
 * 整个地月系都超不出这个圆。取景按它算 ⇒ **构图永远一样** ——
 * 地球绕到哪儿都不会出画，也不会随着"离相机远近"忽大忽小。
 */
const ORBIT_FIT_R = SUN_DIST + MOON_ORBIT_R + MOON_RADIUS * 1.15;
/**
 * 太阳两层辉光的世界半径（倍数与 v1.2.0 相同：2.1 / 3.6 × 太阳半径）。
 * 改倍数时两处一起改，别各写一份数字。
 */
const SUN_GLOW_INNER = SUN_RADIUS * 2.1;
const SUN_GLOW_OUTER = SUN_RADIUS * 3.6;

/* ---------------- 「追月特写」＝地球视角（v1.4.5） ----------------
 * 用户的要求（原话）：「应该是从地球看月球的这个特写，方向就是从地球看向月球」。
 * 做法：把相机钉在**地球朝向月球那一侧的地表外侧**，每帧看向月球中心。
 * 于是主视图里的月相就是**地球观测者看到的月相** —— 与右上角月相小窗同一个答案
 * （小窗的相机是 `moonGroup` 的子节点、挂在体固系 +Z，而 +Z 永远朝着地球）。
 *
 * 为什么不能用 v1.3.0 那种"增量平移"（`camera.position += (moonPos - anchor)`）：
 * 那条机位向量是"地心 → 月心"的反方向，地球绕太阳、月球绕地球，这个方向**每帧都在转**
 * —— 平移补不了旋转。所以每帧按绝对位置重摆（`syncFollow`）。
 */
/**
 * 相机离地心的距离（单位：地球半径）。
 * 1.05 ⇒ 地表外面一点点（3.85 世界单位）：既不会钻进地球里，也能理直气壮地说"站在地球上"。
 * 副作用是好的：整个地球都在视平面**之后**（任一地球点沿视线的分量 ≤ 3.667 < 3.85）
 * ⇒ 地球一个像素都不会出现在画面上，跟月相小窗一样"眼里只有月亮"。
 */
const FOLLOW_EYE_LIFT = 1.05;
/**
 * 进入「追月特写」时的视场角。相机到月心 = 15 − 3.85 = 11.15，月盘角半径 ≈ 5.14° ⇒
 * 22° 时月盘占屏高约 0.46（1120×740 窗口下直径约 268px），一眼就是个特写。
 * 别再往小调太多：`FOLLOW_FOV_MIN` 以下月盘就顶出画面了。
 */
const FOLLOW_FOV = 22;
/** 滚轮＝望远镜焦距。10° 时月盘直径约 590px（几乎占满竖边），55° 时退回"小月亮" */
const FOLLOW_FOV_MIN = 10;
const FOLLOW_FOV_MAX = 55;
/** 地轴倾角：真实的 23.44°，正是四季的成因 */
const EARTH_TILT = 23.44 * DEG;
/** 地球的初始自转角：随便挑一个，让默认机位能看到太平洋与亚洲 */
const EARTH_SPIN = 1.15;
/**
 * 「日地月系统」默认机位方向（世界系）：太阳在**原点**，地球绕着它公转。
 *
 * ⚠ 这个方向是**量出来的**，几条互相打架的要求之间只能取平衡，别随手改：
 *  ① 地球要落在两栏之间那条竖带里（见 `usableBandNdc`）。地球在默认月龄时位于 −X 附近
 *     （见 `earthOrbitAngle` 的约定），相机取 +X 一侧（u.x > 0）既能让地球离相机更近
 *     （画面更大），又正好看到**被太阳照亮**的那一面 —— `(1+u.x)/2` 的老口径在日心
 *     布局下变成「相机方向与地球→太阳方向的夹角」，+(−X 侧地球) 的组合实测亮面 >90%。
 *  ② 太阳在原点 ⇒ 只要取景以原点为目标，太阳永远在画面正中，不可能被两栏挡住
 *     （v1.1.0 用 `num` 小心伺候的"太阳进竖带"，日心布局下自动成立）。
 *  ③ 新月时月球在日地之间，横向间距要够 —— 拉大 u.z 的占比即可，与 v1.1.0 同理。
 *
 * ⚠ v1.4.0 起 ① 这条**不能再假设"地球在 −X"**：地球真的沿轨道走完一圈（`earthOrbitAngle`），
 *   默认机位是**固定**的，所以地球会轮到相机的近侧与远侧（屏幕半径 22px ↔ 13px，
 *   这是真实的透视，不是抖动）。取景换成 `ORBIT_FIT_R` 包络圈之后，构图与地球位置无关，
 *   ①里"地球离相机更近所以更大"只是默认那一刻的运气，别再拿它当判据。
 *
 * 现在这组 (0.82, 0.43, −0.37) 沿用 v1.1.0 实测折中：仰角 25°，取景 ≈ 3.7·SUN_DIST。
 */
const ORBIT_CAM_DIR = new THREE.Vector3(0.82, 0.43, -0.37).normalize();
/**
 * 系统视角里相机**能退到多远**（`controls.maxDistance`）。
 *
 * ⚠ 这个值**必须由场景尺度算出来，绝不能写死**。v1.0.0 写死成 46，v1.1.0 把尺度一拉大
 *   （月球轨道 3.6→15、太阳 7.4→48），`fitOrbitDistance` 算出来要退到 80 开外才装得下
 *   整个系统，却被 46 夹住 ⇒ **太阳被挤出画面**，而"轨道半径 / 姿态角 / 太阳方向"那一整
 *   节数学判据照样全绿（它们量的都是世界量，跟相机在哪儿无关）。
 *   实测症状：`orbitState().camDist` 恰好等于 46.00 —— 一个"太整"的数就是被夹住的信号。
 *
 * v1.4.0 换口径后由 `ORBIT_FIT_R` 推出来：取证窗口（1120×740，两栏之间那条竖带）
 * 实测要退到约 171，= 2.75 × ORBIT_FIT_R。取 **4.5 × ORBIT_FIT_R（≈280）**：
 * 窗口变窄、两栏变宽时取景会更远，留出余量。一旦又被夹住，
 * 症状还是那个"太整"的数 —— `camDist` 恰好等于 ORBIT_MAX_DIST。
 */
const ORBIT_MAX_DIST = ORBIT_FIT_R * 4.5;
/** 点到「月球特写」里月球表面的距离用的基准机位 */
const MARKER_BASE_DIST = CAM_DIST;

/** three.js 图层：小窗与主视图共用月球本体，但各看各的装饰 */
const LAYER_SHARED = 0;
const LAYER_MAIN = 1;
const LAYER_PHASE_ONLY = 2;

function setLayerDeep(obj: THREE.Object3D, layer: number) {
  obj.traverse((child) => child.layers.set(layer));
}

/** 在球面上按经纬度（东经为正）摆放一个点 */
function surfacePoint(lat: number, lon: number, radius: number): THREE.Vector3 {
  const d = directionFor(lat, lon);
  return new THREE.Vector3(d.x, d.y, d.z).multiplyScalar(radius);
}

/** 一条圆的管（线宽在 WebGL 下只有管粗才可靠） */
function makeCircleTube(radius: number, tube: number, color: number, opacity = 1) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 128; i += 1) {
    const a = (i / 128) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true);
  const geo = new THREE.TubeGeometry(curve, 160, tube, 6, true);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: false
  });
  return new THREE.Mesh(geo, mat);
}

/** 月面经纬网：纬线（不含极点）＋经线 */
function buildGraticule(radius: number): THREE.Group {
  const group = new THREE.Group();
  const tube = 0.0026;
  const color = 0x5fd8ff;
  const opacity = 0.45;

  // 纬线：每 30° 一条（±60 / ±30 / 0）
  for (const lat of [-60, -30, 0, 30, 60]) {
    const pts: THREE.Vector3[] = [];
    const r = radius * Math.cos(lat * DEG);
    const y = radius * Math.sin(lat * DEG);
    for (let i = 0; i <= 128; i += 1) {
      const a = (i / 128) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 160, tube, 5, true),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: lat === 0 ? opacity + 0.2 : opacity,
        depthWrite: false
      })
    );
    group.add(mesh);
  }

  // 经线：每 30° 一条（半个大圆，从南极到北极）
  for (let lon = 0; lon < 360; lon += 30) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i += 1) {
      const lat = -90 + (i / 96) * 180;
      pts.push(surfacePoint(lat, lon, radius));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 128, tube, 5, false),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
    );
    group.add(mesh);
  }
  return group;
}

/**
 * 星空背景（v1.2.0 起是一张**贴图**，不再是场景里的三维星点）。
 *
 * 为什么换掉 —— 旧的 1400 颗星是撒在半径 60 的球面上的 `THREE.Points`：
 * 学生一滚轮拉远（系统视角能退到 156），星星就"缩成一小团"，球壳的边缘也能看出来，
 * 很露馅。贴图挂在 `scene.background` 上是**无穷远**：怎么旋转、怎么拉远都不变形。
 *
 * 实现：等距柱状投影（经度 → x，纬度 → y），固定种子 ⇒ 每次刷新完全一致，截图回归可比。
 * ⚠ 星色**全部偏暖**（蓝分量 ≤ 红分量 +18）：系统视角的若干判据在数"偏蓝的月面记号"，
 *   冷色星会污染计数。这不是审美选择，是给回归让路。
 */
function buildStarBackground(): THREE.CanvasTexture {
  const W = 2048;
  const H = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    // 深空底色：亮度必须压在渲染器清屏色（0x070c16，亮度 ≈11.6）附近 ——
    // I10 那条"地球亮于背景 +20"的判据拿背景当中尺，贴图底色一亮它就误报。
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#070c15");
    g.addColorStop(0.5, "#05080f");
    g.addColorStop(1, "#070c15");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 银河带：一条斜跨画面的柔光带 + 沿带密集的暗星
    ctx.save();
    ctx.translate(W * 0.5, H * 0.52);
    ctx.rotate(-0.32);
    const band = ctx.createLinearGradient(0, -170, 0, 170);
    band.addColorStop(0, "rgba(150,170,210,0)");
    band.addColorStop(0.5, "rgba(150,170,210,0.07)");
    band.addColorStop(1, "rgba(150,170,210,0)");
    ctx.fillStyle = band;
    ctx.fillRect(-W, -170, W * 2, 340);
    ctx.restore();

    let seed = 20260925;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    // 沿银河带的暗星（小而密）
    for (let i = 0; i < 520; i += 1) {
      const t = rnd() * Math.PI * 2;
      const spread = (rnd() + rnd() + rnd() - 1.5) * 90;
      const x = W * 0.5 + Math.cos(t) * W * 0.55 - Math.sin(t) * spread;
      const y = H * 0.52 + Math.sin(t) * W * 0.55 * 0.32 + Math.cos(t) * spread;
      ctx.fillStyle = `rgba(226,232,244,${0.25 + rnd() * 0.4})`;
      ctx.fillRect(((x % W) + W) % W, ((y % H) + H) % H, 1, 1);
    }
    // 全天散布的普通星：大小 / 亮度 / 色温都略有差别
    for (let i = 0; i < 760; i += 1) {
      const x = rnd() * W;
      const y = rnd() * H;
      const r = 0.5 + rnd() * 1.4;
      const warm = rnd();
      // 暖白为主，少数带一点凉意，但蓝分量永不比红分量多出 18 以上
      const col =
        warm < 0.72
          ? [242, 232, 213]
          : warm < 0.92
            ? [255, 226, 188]
            : [226, 230, 244];
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.4 + rnd() * 0.6})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 十几颗亮星：带柔光辉（径向渐变），贴图上认得出"这是颗亮星"
    for (let i = 0; i < 16; i += 1) {
      const x = rnd() * W;
      const y = rnd() * H;
      const r = 2.2 + rnd() * 1.6;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
      glow.addColorStop(0, "rgba(242,238,225,0.95)");
      glow.addColorStop(0.35, "rgba(242,238,225,0.35)");
      glow.addColorStop(1, "rgba(242,238,225,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r * 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------------- 「日地月系统」用到的程序化素材 ----------------
 * 太阳不引外部贴图，全部用固定种子的噪声现画：
 *  ① 包体积：太阳在画面里只有几十像素，为它加一张 200KB 的贴图不划算；
 *  ② 可复现：固定种子 ⇒ 每次刷新完全一样，截图回归才比得出来。
 * 地球用的是真实卫星影像（public/textures/earth.jpg + earth_night.jpg）——
 * 那是这一节最重要的教学信息（海洋/大陆/云），不能拿噪声糊弄。 */

function hash2(i: number, j: number, seed: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** 二维值噪声（双线性 + smoothstep 插值） */
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 37);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number) {
  const k = Math.max(0, Math.min(1, t));
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k
  ] as [number, number, number];
}

/** 太阳表面：米白核心 + 橙黄米粒组织 + 几颗黑子 */
function makeSunTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const bright: [number, number, number] = [255, 250, 224];
  const mid: [number, number, number] = [255, 190, 70];
  const dark: [number, number, number] = [196, 96, 16];
  if (ctx) {
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const u = x / W;
        const v = y / H;
        const t = fbm(u * 24, v * 24, 11) * 0.66 + fbm(u * 70 + 13, v * 70 + 5, 29) * 0.34;
        let col =
          t < 0.5 ? mixRgb(mid, dark, (0.5 - t) * 1.5) : mixRgb(mid, bright, (t - 0.5) * 1.8);
        // 两颗黑子：只做点缀，别让它看起来像"太阳长麻子"
        for (const [sx, sy, sr, sseed] of [
          [0.24, 0.38, 0.05, 3],
          [0.71, 0.62, 0.035, 7]
        ] as [number, number, number, number][]) {
          const d = Math.hypot(u - sx, (v - sy) * 2);
          if (d < sr * 2.2) {
            const k = Math.pow(Math.max(0, 1 - d / (sr * 2.2)), 2) * (0.55 + 0.45 * fbm(u * 90, v * 90, sseed));
            col = mixRgb(col, [92, 40, 8], k);
          }
        }
        const i = (y * W + x) * 4;
        img.data[i] = Math.max(0, Math.min(255, col[0]));
        img.data[i + 1] = Math.max(0, Math.min(255, col[1]));
        img.data[i + 2] = Math.max(0, Math.min(255, col[2]));
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** 圆形辉光：加色混合的 Sprite，给太阳套一层"过曝"的光晕 */
function makeGlowSprite(inner: string, outer: string, size: number): THREE.Sprite {
  const S = 256;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.45, outer);
    g.addColorStop(1, "rgba(255,150,40,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  sprite.scale.set(size, size, 1);
  return sprite;
}

interface PhaseMeasure {
  /** 月盘上的像素总数（由"全照亮"那一帧判定，与贴图明暗无关） */
  diskPixels: number;
  /** 其中被判为"受光"的像素数 */
  litPixels: number;
  /** 受照比例（像素口径） */
  litFraction: number;
  leftFraction: number;
  rightFraction: number;
  /**
   * 受光像素在屏幕横向上的**重心**（相对盘心，已按盘半径归一化）。
   * 这是判断"亮面在左还是在右"唯一对**所有相位都成立**的指标：
   * 用 left/right 两个比例去比不行 —— 盈凸月的左半边也有大量受光像素
   * （亮面 ＝ 整个右半 + 大半左半），差值是 0.7 而不是 1。
   * 重心法对蛾眉、凸月、弦月一视同仁：盈 ⇒ 正、亏 ⇒ 负。
   */
  litCentroidX: number;
  /** 按盘心的实际像素坐标，供报告用 */
  centerX: number;
  diskRadiusPx: number;
  width: number;
  height: number;
}

/**
 * **主视图**月盘的受照量（v1.4.5）。
 *
 * 与 `PhaseMeasure` 用的是同一套像素判据（两遍渲、比值 > 0.5），差别只在"量的是哪台相机"：
 * `PhaseMeasure` 量月相小窗（正交、权威口径），这个量主视图（透视、跟着当前机位走）。
 * 「追月特写＝从地球看月球」能不能成立，就看这两个数在容差内一致、且亮面在同一侧。
 */
interface MainPhaseMeasure {
  diskPixels: number;
  litPixels: number;
  litFraction: number;
  leftFraction: number;
  rightFraction: number;
  /** 受光像素横向重心（相对**月心**，按实测盘半径归一化）：盈 ⇒ 正、亏 ⇒ 负 */
  litCentroidX: number;
  /** 月心在画布里的位置（CSS px）——判据拿它核对"月球在画面正中" */
  centreXPx: number;
  centreYPx: number;
  /** 由投影算出的月盘半径 */
  diskRadiusPx: number;
  /** 由像素数反算的月盘半径（两者接近才说明采样框没跑偏） */
  measuredRadiusPx: number;
  /** 量的时候的视场角（追月特写＝22 起步，滚轮还能变） */
  fov: number;
}

interface FeatureProbe {
  name: string;
  visible: boolean;
  front: number;
  x: number;
  y: number;
}

/** 视角模式：`orbit` = 地球居中·月球公转；`moon` = 月球居中·自由旋转 */
export type ViewMode = "orbit" | "moon";

/** 站点在屏幕上的落点与朝向（点击拾取、回归判据都用它） */
export interface SiteProbe {
  name: string;
  kind: MoonFeature["kind"];
  /** >0 表示落在朝向相机的那半球（背面站点点不到） */
  front: number;
  x: number;
  y: number;
}

interface Engine {
  setAge(age: number): void;
  /** 直接摆累计天数（自检专用：要精确摆到"相机看到地球白天"的那一刻） */
  setDaysRaw(days: number): void;
  age(): number;
  setLayers(l: LayerState): void;
  setPlaying(on: boolean): void;
  isPlaying(): boolean;
  /** 自动推进时每 ~70ms 回调一次，只用于刷新 React 读数（不再回灌引擎） */
  setOnAge(cb: ((a: number) => void) | null): void;
  setView(kind: "near" | "north" | "south" | "top" | "tilt" | "reset"): void;
  setViewMode(mode: ViewMode): void;
  viewMode(): ViewMode;
  /** 把主镜头转到某个站点正上方（点击记号、点列表都走这里） */
  focusFeature(f: MoonFeature): void;
  /**
   * 「追月特写」开关（**v1.4.5 起＝从地球看月球**：相机钉在地球表面、始终朝着月心）。
   *
   * 两代旧实现的毛病：v1.1.0 是"一次性把镜头搬到月球"（到位那一刻对着月球，月球一动就跑）；
   * v1.3.0 改成"每帧按月球位移平移相机"（月球钉住了，但机位方向取的是当时的视线方向 ⇒
   * 从斜视档按下去等于"顺着看太阳的方向飞到月球旁边"，看到的月相与地球观测者无关）。
   * 现在每帧按"地心→月心"这条视线重摆机位，见 `placeEarthEye`。
   */
  startFollowMoon(): void;
  stopFollowMoon(): void;
  following(): boolean;
  setSelected(name: string | null): void;
  hitSite(x: number, y: number, maxPx?: number): (SiteProbe & { dist: number }) | null;
  sitesOnScreen(): SiteProbe[];
  /** 「日地月系统」的自检读数：月球世界位置 / 姿态偏航 / 三个天体在不在画面里 */
  orbitState(): {
    pos: [number, number, number];
    yaw: number;
    yawDeg: number;
    orbitR: number;
    earthPos: [number, number, number];
    /** 累计天数（单调时间基，v1.4.0 新增；地球公转/自转都从它算） */
    days: number;
    earthYaw: number;
    earth: { x: number; y: number; r: number; onScreen: boolean };
    moon: { x: number; y: number; r: number; onScreen: boolean };
    sun: { x: number; y: number; r: number; onScreen: boolean };
    sunDirWorld: [number, number, number];
    camDist: number;
  };
  /** 星空背景自检读数（等距柱状贴图的尺寸；关闭时为 null） */
  starBackground(): {
    kind: string;
    width: number;
    height: number;
    mapping: number;
  } | null;
  resize(): void;
  stopLoop(): void;
  startLoop(): void;
  settle(frames?: number): void;
  samplePixels(pts: { x: number; y: number }[]): { r: number; g: number; b: number }[];
  samplePair(pts: { x: number; y: number }[]): {
    x: number;
    y: number;
    base: [number, number, number];
    real: [number, number, number];
    ratio: number;
  }[];
  countBluish(): number;
  measurePhase(): PhaseMeasure;
  /** 主视图月盘的受照量（追月特写＝地球视角的像素证据） */
  measureMainMoon(): MainPhaseMeasure | null;
  textureReady(): boolean;
  /** 地球昼夜贴图是否加载成功（没加载成功会退成一颗深蓝球） */
  earthReady(): boolean;
  featureNames(): string[];
  probeFeatures(): FeatureProbe[];
  labelBoxes(): {
    name: string;
    visible: boolean;
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    cx: number;
    cy: number;
  }[];
  cameraState(): {
    pos: [number, number, number];
    target: [number, number, number];
    dist: number;
    moonDist: number;
  };
  diskOnScreen(): { cx: number; cy: number; radius: number } | null;
  dispose(): void;
}

const LABEL_FONT = 11;
const LABEL_H = 17;
const LABEL_GAP = 3;

function buildEngine(host: HTMLDivElement, phaseHost: HTMLDivElement): Engine {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(BG_SPACE, 1);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_SPACE);

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.05, 400);
  camera.position.set(0, 0, CAM_DIST);
  camera.layers.enable(LAYER_MAIN);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.rotateSpeed = 0.9;
  controls.zoomSpeed = 0.8;
  controls.enablePan = false;
  controls.minDistance = 1.5;
  controls.maxDistance = 13;
  controls.target.set(0, 0, 0);
  // 用户一动手拖动，就退出「俯视黄道面」的朝向跟踪 —— 他想看别的角度了，
  // 不能再跟时间抢镜头（与追月跟随同一套取舍）。见 `syncTopView`。
  controls.addEventListener("start", () => {
    topViewLocked = false;
  });

  // ---- 月相小窗的独立渲染器（同一 scene，另一台相机）----
  const phaseRenderer = new THREE.WebGLRenderer({ antialias: true });
  phaseRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  phaseRenderer.setClearColor(BG_PHASE, 1);
  phaseHost.appendChild(phaseRenderer.domElement);
  const phaseCamera = new THREE.OrthographicCamera(
    -PHASE_FRUSTUM,
    PHASE_FRUSTUM,
    PHASE_FRUSTUM,
    -PHASE_FRUSTUM,
    0.1,
    100
  );
  phaseCamera.position.set(0, 0, PHASE_DIST);
  // ⚠ 这里**不能**写 `phaseCamera.lookAt(0,0,0)`：相机马上要挂到 `moonGroup` 下面
  //   （见下），要保持局部旋转为单位阵 —— 也就是"沿自己所属的那个月球坐标系的 −Z 看"。
  //   一旦写成 lookAt，切到「日地月系统」后相机就只会盯着世界原点，而月球已经不在那了。
  phaseCamera.layers.set(LAYER_SHARED);
  phaseCamera.layers.enable(LAYER_PHASE_ONLY);

  // ---- 月球本体 ----
  const moonGroup = new THREE.Group();
  scene.add(moonGroup);
  /**
   * 把小窗相机挂在月球组下面，是整个模式切换方案的关键一步：
   *
   *  「从地球看月球」= 站在月球的 +Z 方向看回来。而 +Z 是**体固系**的轴 ——
   *  在「日地月系统」里，月球既公转又自转（潮汐锁定），世界系的 +Z 早就不是它了。
   *  挂成子节点之后，相机的世界变换 = 月球的世界变换 × 局部变换，
   *  局部 +Z 恒等于"近地面中心指向地球"，于是**两个模式下小窗看到的都是同一件事**，
   *  一行跟随代码都不用写。
   *
   *  代价：`renderer.render(scene, phaseCamera)` 的相机在场景图里。three.js 允许这么做
   *  （`scene.updateMatrixWorld()` 会连带更新相机的 matrixWorld；只有当 `camera.parent === null`
   *  时它才自己去 updateMatrixWorld），所以前提是这台相机必须**挂在场景内的对象上**。
   */
  moonGroup.add(phaseCamera);

  const moonUniforms = {
    uMap: { value: null as THREE.Texture | null },
    uSunDir: { value: new THREE.Vector3(0, 0, 1) },
    uAmbient: { value: AMBIENT },
    uAllLit: { value: 0 }
  };

  const moonMat = new THREE.ShaderMaterial({
    uniforms: moonUniforms,
    // 月球没有大气 ⇒ 晨昏线是一条硬边。smoothstep 的窗口只留抗锯齿所需的宽度。
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
      uniform sampler2D uMap;
      uniform vec3 uSunDir;
      uniform float uAmbient;
      uniform float uAllLit;
      varying vec2 vUv;
      varying vec3 vNormalW;
      void main() {
        vec3 n = normalize(vNormalW);
        float d = dot(n, normalize(uSunDir));
        float lit = smoothstep(-0.012, 0.012, d);
        if (uAllLit > 0.5) { lit = 1.0; }
        vec3 base = texture2D(uMap, vUv).rgb;
        vec3 col = base * mix(uAmbient, 1.0, lit);
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });

  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(MOON_RADIUS, 128, 80),
    moonMat
  );
  // 贴图中心对准近地面中心：SphereGeometry 的 u=0.5 落在 +X 方向，
  // 而我们要它落在 +Z（朝地球）——绕 Y 轴转 −90° 正好把 +X 搬到 +Z，
  // 同时让东经落在屏幕右侧（与天文照片的"北在上、东在右"一致）。
  moonMesh.rotation.y = -Math.PI / 2;
  moonMesh.layers.set(LAYER_SHARED);
  moonGroup.add(moonMesh);

  // 月面影像：colorSpace 用 NoColorSpace，让屏幕颜色与素材逐位一致
  // （与 earth-globe 同一约定 —— 否则会被多做一次 sRGB 编码，整体发灰发亮）。
  // 加载失败时给一张 1×1 的中性灰兜底：宁可"月球变灰球"，也不能整场黑掉。
  const fallbackTex = new THREE.DataTexture(
    new Uint8Array([130, 130, 130, 255]),
    1,
    1,
    THREE.RGBAFormat
  );
  fallbackTex.colorSpace = THREE.NoColorSpace;
  fallbackTex.needsUpdate = true;
  moonUniforms.uMap.value = fallbackTex;

  let textureReady = false;
  new THREE.TextureLoader().load(
    "textures/moon.jpg",
    (texture) => {
      texture.colorSpace = THREE.NoColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      moonUniforms.uMap.value = texture;
      textureReady = true;
    },
    undefined,
    () => {
      moonUniforms.uMap.value = fallbackTex;
    }
  );

  // ---- 经纬网 ----
  const graticule = buildGraticule(MOON_RADIUS * 1.0015);
  setLayerDeep(graticule, LAYER_MAIN);
  graticule.visible = false;
  moonGroup.add(graticule);

  // ---- 晨昏线：垂直于太阳方向的大圆 ----
  const terminator = makeCircleTube(MOON_RADIUS * 1.0035, 0.0034, 0xffd34d, 0.95);
  setLayerDeep(terminator, LAYER_MAIN);
  moonGroup.add(terminator);

  // ---- 太阳方向指示 ----
  const sunGroup = new THREE.Group();
  {
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffd34d })
    );
    core.position.set(0, 0, SUN_MARKER_DIST);
    sunGroup.add(core);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.22 })
    );
    halo.position.copy(core.position);
    sunGroup.add(halo);

    // 从月面外侧指向"太阳"的一根虚线轴 + 箭头
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, MOON_RADIUS * 1.08),
      new THREE.Vector3(0, 0, SUN_MARKER_DIST - 0.24)
    ]);
    const line = new THREE.Line(
      lineGeo,
      new THREE.LineDashedMaterial({
        color: 0xffd34d,
        dashSize: 0.09,
        gapSize: 0.07,
        transparent: true,
        opacity: 0.85
      })
    );
    line.computeLineDistances();
    sunGroup.add(line);

    const head = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, 0.2, 16),
      new THREE.MeshBasicMaterial({ color: 0xffd34d })
    );
    head.position.set(0, 0, SUN_MARKER_DIST - 0.34);
    head.rotation.x = Math.PI / 2;
    sunGroup.add(head);
  }
  setLayerDeep(sunGroup, LAYER_MAIN);
  scene.add(sunGroup);

  // ---- 地月方向指示（近地面中心永远朝着地球）----
  const earthGroup = new THREE.Group();
  {
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, MOON_RADIUS * 1.08),
      new THREE.Vector3(0, 0, 2.15)
    ]);
    const line = new THREE.Line(
      lineGeo,
      new THREE.LineDashedMaterial({
        color: 0x7fb2e5,
        dashSize: 0.1,
        gapSize: 0.08,
        transparent: true,
        opacity: 0.9
      })
    );
    line.computeLineDistances();
    earthGroup.add(line);

    const head = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.22, 16),
      new THREE.MeshBasicMaterial({ color: 0x7fb2e5 })
    );
    head.position.set(0, 0, 2.32);
    head.rotation.x = Math.PI / 2;
    earthGroup.add(head);

    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0x3f9be0 })
    );
    dot.position.set(0, 0, 2.0);
    earthGroup.add(dot);
  }
  setLayerDeep(earthGroup, LAYER_MAIN);
  earthGroup.visible = false;
  scene.add(earthGroup);

  /* ================= 「日地月系统」场景 =================
   * 世界系：+Y 是黄道北、太阳在 +X 远处、地球在原点、月球沿半径 MOON_ORBIT_R 的圆轨道公转。
   *
   * 整组装进一个 `orbitGroup`，切到「月球特写」时**一次隐藏**，而不是逐个设 visible ——
   * 逐个设最容易在后来加东西时漏掉一个，症状是"切回特写后还飘着一个太阳"。
   */
  let viewMode: ViewMode = "orbit";

  const orbitGroup = new THREE.Group();
  orbitGroup.visible = false;
  scene.add(orbitGroup);

  /**
   * 「追月特写＝地球视角」里要**暂时藏起来**的物体（v1.4.5）。
   *
   * 声明在这儿（而不是挨着跟随逻辑）是因为它要**在场景搭建时就登记**：
   * `eyeHidden.push(orbitSun)` 之类的调用都发生在下面几百行里，
   * 而 `const` 在声明前是 TDZ —— 放到后面会直接抛 `ReferenceError` 把整个引擎打断。
   * 消费它的 `applyEyeVisibility()` 仍然住在跟随逻辑那一段（那里才需要读 `followMoon`）。
   */
  const eyeHidden: THREE.Object3D[] = [];

  // ---- 地月系整体：地球公转时，地球本体与月球轨道圈必须**一起**走 ----
  // 月球本体的 `moonGroup` 挂在场景根上（「月球特写」要用它），不进这里 ——
  // 它的世界位置由 `updateMoonTransform` 按"地心 + R_y(β)·本地轨道位置"逐帧算。
  const earthSystem = new THREE.Group();
  orbitGroup.add(earthSystem);

  // ---- 地球：真实昼夜卫星影像。夜面用夜景图，晨昏线比月球软得多（因为有大气）----
  const earthUniforms = {
    uDay: { value: null as THREE.Texture | null },
    uNight: { value: null as THREE.Texture | null },
    // 初始值随便给（下一行 setAge 就会覆盖成"地球→太阳"的真实方向）；
    // 单独提出来是因为 v1.1.0 前它恒为 +X、从不更新 —— 日心布局下这是每帧都要算的量。
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uAmbient: { value: 0.05 }
  };
  const earthMat = new THREE.ShaderMaterial({
    uniforms: earthUniforms,
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
      uniform sampler2D uDay;
      uniform sampler2D uNight;
      uniform vec3 uSunDir;
      uniform float uAmbient;
      varying vec2 vUv;
      varying vec3 vNormalW;
      void main() {
        vec3 n = normalize(vNormalW);
        float d = dot(n, normalize(uSunDir));
        // 地球有大气的散射 ⇒ 晨昏线是一条宽过渡带，不像月球那样是刀切
        float lit = smoothstep(-0.12, 0.18, d);
        vec3 day = texture2D(uDay, vUv).rgb;
        vec3 night = texture2D(uNight, vUv).rgb;
        vec3 col = mix(night, day, lit) + day * uAmbient;
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });

  const earthTilt = new THREE.Group();
  earthTilt.rotation.z = EARTH_TILT; // 23.44°：四季就是这么来的
  const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, 96, 64), earthMat);
  // 自转角每帧由 `updateMoonTransform` 按 `EARTH_SPIN + earthSpinAngle(age)` 重设
  earthMesh.rotation.y = EARTH_SPIN;
  earthTilt.add(earthMesh);
  earthSystem.add(earthTilt);

  // 素材没到位时退成一颗深蓝的球，绝不把整个场景拖黑
  const earthFallback = new THREE.DataTexture(
    new Uint8Array([36, 58, 108, 255]),
    1,
    1,
    THREE.RGBAFormat
  );
  earthFallback.colorSpace = THREE.NoColorSpace;
  earthFallback.needsUpdate = true;
  earthUniforms.uDay.value = earthFallback;
  earthUniforms.uNight.value = earthFallback;
  let earthTextureReady = false;
  const texLoader = new THREE.TextureLoader();
  texLoader.load(
    "textures/earth.jpg",
    (t) => {
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      earthUniforms.uDay.value = t;
      earthTextureReady = true;
    },
    undefined,
    () => undefined
  );
  texLoader.load(
    "textures/earth_night.jpg",
    (t) => {
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      earthUniforms.uNight.value = t;
    },
    undefined,
    () => undefined
  );

  // ---- 太阳：程序化表面 + 两层加色辉光。v1.2.0 起在**原点**（日心布局），更大更亮 ----
  const orbitSun = new THREE.Group();
  {
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_RADIUS, 64, 48),
      new THREE.MeshBasicMaterial({ map: makeSunTexture() })
    );
    orbitSun.add(ball);
    // 辉光半径跟着 SUN_RADIUS 走（倍数与 v1.2.0 相同，屏幕上就没有变化）：
    // 太阳本体现在就很大，再大的辉光会糊掉半个可用竖带，把地月系从画面上"洗掉"。
    orbitSun.add(makeGlowSprite("rgba(255,247,214,0.95)", "rgba(255,203,92,0.5)", SUN_GLOW_INNER));
    orbitSun.add(makeGlowSprite("rgba(255,214,120,0.3)", "rgba(255,168,58,0.16)", SUN_GLOW_OUTER));
  }
  orbitSun.position.set(0, 0, 0); // 日心布局：太阳就在系统中心
  orbitGroup.add(orbitSun);
  // 进「追月特写」要连太阳一起藏（理由见 `applyEyeVisibility`）
  eyeHidden.push(orbitSun);

  /* ---- 阳光方向箭头：**v1.4.5 已整个删除**，不要加回来 ----
   * 它活过三个版本：
   *   · v1.2.0 把 9 条横贯画面的黄虚线线束收成**一支**箭头（用户："很干扰学生的阅读"）；
   *   · v1.4.0 因为太阳世界半径放大到 13.5、机位退到 214，改成按构图量定位并把箭杆加粗到
   *     3px（不这么做就只剩 1.9px，像素采样会踩在抗锯齿边缘上）；
   *   · v1.4.5 用户："可以不要了，看起来很奇怪" —— 收工。
   *
   * 为什么它一直很别扭（删掉是正解，不是偷懒）：
   *   ① 世界半径 13.5 的太阳是**为 214 远的相机**定的夸张值，地球上看到的太阳角半径
   *      只有 0.5°；画一支"从辉光外缘伸到地球轨道内侧"的箭头，等于给一个**不存在的方向**
   *      画了根 8 个世界单位的杆子，比例怎么调都别扭；
   *   ② 它和"太阳本身就在画面里"这件事重复 —— 光从哪边来，看被照亮的那半边就够了；
   *   ③ 它挡在日地连线上，把"地月系"这一小团挤在画面一侧。
   * 现在系统视角里只剩天体、轨道虚线与地月连线；"昼夜明暗"这一层仍然管用
   * （它管的是月面的晨昏线，见 `setLayers`）。
   *
   * ⚠ 删掉它**没动** `sunDirFromEarth` —— 那是着色器用的"地球→太阳"方向，
   *   两个天体的平行光都靠它，删了整颗月亮会变成全黑。
   *   禁表指纹：`0xffd34d`（箭头本色）只此一处用过，已登记进 `publish_moon.py` 的 `GONE_JS`。
   */

  // ---- 月球轨道（虚线圆）＋ 地球公转轨道（虚线圆）----
  // 月球轨道圈**挂在地月系组里**：地球公转到哪儿，月球的轨道圈就跟到哪儿 ——
  // 这正是"月球绕着地球转，而不是绕着太阳转"的直观画面。
  {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 256; i += 1) {
      const a = (i / 256) * Math.PI * 2;
      pts.push(new THREE.Vector3(MOON_ORBIT_R * Math.cos(a), 0, -MOON_ORBIT_R * Math.sin(a)));
    }
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({
        color: 0x9fb6d8,
        dashSize: 0.2 * ORBIT_DECO,
        gapSize: 0.18 * ORBIT_DECO,
        transparent: true,
        opacity: 0.55
      })
    );
    ring.computeLineDistances();
    earthSystem.add(ring);
    eyeHidden.push(ring);
  }
  // 地球公转轨道：日心布局的教学新元素 —— 学生要能看到"地球也在走一圈"。
  // 故意只画圈、不进取景点（见 `orbitFitPoints`）：圈比系统本体大得多，
  // 若要求它整个可见，相机会退到月球只剩几个像素。圈出画没有关系，虚线本来就在说"还有一圈"。
  {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 256; i += 1) {
      const a = (i / 256) * Math.PI * 2;
      pts.push(new THREE.Vector3(SUN_DIST * Math.cos(a), 0, -SUN_DIST * Math.sin(a)));
    }
    const orbitRing = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({
        color: 0x7d90ad,
        dashSize: 0.55 * ORBIT_DECO,
        gapSize: 0.5 * ORBIT_DECO,
        transparent: true,
        opacity: 0.38
      })
    );
    orbitRing.computeLineDistances();
    orbitGroup.add(orbitRing);
    eyeHidden.push(orbitRing);
  }

  // ---- 地月连线：近地面永远朝着地球，这条线就是"潮汐锁定"的可视化 ----
  const linkLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineDashedMaterial({
      color: 0x7fb2e5,
      dashSize: 0.16 * ORBIT_DECO,
      gapSize: 0.12 * ORBIT_DECO,
      transparent: true,
      opacity: 0.8
    })
  );
  orbitGroup.add(linkLine);
  // 站在地球上时，"地月连线"是从脚下一直伸到月球的 —— 在画面上就是贴着视线的一段，
  // 只会糊在月盘前面，没有信息量。跟太阳一起藏。
  eyeHidden.push(linkLine);

  setLayerDeep(orbitGroup, LAYER_MAIN);

  function updateLinkLine() {
    // v1.2.0：地球不再在原点 —— 连线两端从**地心**与月球当前位置各退一个半径
    const ep = earthSystem.position;
    const p = moonGroup.position;
    const u = p.clone().sub(ep);
    const len = u.length();
    if (len < 1e-3) {
      return;
    }
    u.divideScalar(len);
    const a = ep.clone().add(u.clone().multiplyScalar(EARTH_RADIUS * 1.02));
    const b = p.clone().sub(u.clone().multiplyScalar(MOON_RADIUS * 1.02));
    const attr = linkLine.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.setXYZ(0, a.x, a.y, a.z);
    attr.setXYZ(1, b.x, b.y, b.z);
    attr.needsUpdate = true;
    linkLine.computeLineDistances();
    linkLine.geometry.computeBoundingSphere();
  }

  /* ---- 「日地月系统」里的天体名（DOM 浮层）----
   * 三维里不写文字（贴图字会糊、Sprite 要额外纹理），用 DOM 跟着投影位置走最清晰，
   * 也和月面地名标注是同一套做法。 */
  const orbitLabelHost = document.createElement("div");
  orbitLabelHost.className = "orbit-labels";
  host.appendChild(orbitLabelHost);

  interface OrbitLabelItem {
    text: string;
    el: HTMLDivElement;
    radius: number;
    world: THREE.Vector3;
    /** 每帧刷新世界坐标（三个天体现在都会动：月球绕地球、地球绕太阳、太阳钉在原点） */
    refresh: () => void;
  }

  function makeOrbitLabel(text: string, tone: string, radius: number, getPos: () => THREE.Vector3) {
    const el = document.createElement("div");
    el.className = "orbit-label";
    el.dataset.body = text;
    const dot = document.createElement("i");
    dot.style.background = tone;
    const span = document.createElement("span");
    span.textContent = text;
    el.appendChild(dot);
    el.appendChild(span);
    orbitLabelHost.appendChild(el);
    const item: OrbitLabelItem = {
      text,
      el,
      radius,
      world: getPos().clone(),
      refresh: () => item.world.copy(getPos())
    };
    return item;
  }

  const ORBIT_ORIGIN = new THREE.Vector3(0, 0, 0);
  const orbitLabels: OrbitLabelItem[] = [
    makeOrbitLabel("太阳", "#ffd34d", SUN_RADIUS, () => ORBIT_ORIGIN),
    makeOrbitLabel("地球", "#3f9be0", EARTH_RADIUS, () => earthSystem.position),
    makeOrbitLabel("月球", "#e8e2cf", MOON_RADIUS, () => moonGroup.position)
  ];

  const tmpProj = new THREE.Vector3();

  function layoutOrbitLabels() {
    if (viewMode !== "orbit") {
      return;
    }
    camera.updateMatrixWorld();
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    // 半视场角读 `camera.fov`：追月特写会把它压到 22（还能用滚轮继续压），
    // 写死 CAMERA_FOV 会让"顶到球面外侧"的偏移量算小一倍 ⇒ 标签压在月盘上。
    const tanHalf = Math.tan((camera.fov * DEG) / 2);
    for (const item of orbitLabels) {
      item.refresh();
      const el = item.el;
      // 「追月特写」里太阳是被藏起来的（见 `applyEyeVisibility`），它的标签也得跟着藏 ——
      // 否则画面上会飘着"太阳"两个字，而太阳本身一个像素都没有。
      if (followMoon && viewMode === "orbit" && item.text === "太阳") {
        el.style.display = "none";
        continue;
      }
      const dist = camera.position.distanceTo(item.world);
      tmpProj.copy(item.world).project(camera);
      const x = (tmpProj.x * 0.5 + 0.5) * w;
      const y = (-tmpProj.y * 0.5 + 0.5) * h;
      // 天体半径在屏幕上的像素数：把标签顶到球面外侧，别压在球上
      const radiusPx = ((item.radius / Math.max(dist, 0.01)) * (h / 2)) / tanHalf;
      el.style.left = `${x.toFixed(1)}px`;
      el.style.top = `${(y - radiusPx - 9).toFixed(1)}px`;
      el.style.display = tmpProj.z > 1 ? "none" : "flex";
    }
  }

  // ---- 月相小窗专用的月盘轮廓（只在小窗里画）----
  // 同样挂在 moonGroup 下：它必须跟着月球走，否则切到「日地月系统」后
  // 这圈轮廓还留在原点，小窗里就会看到一个"没人住的圆环"。
  const phaseRing = makeCircleTube(MOON_RADIUS * 1.012, 0.0028, 0x35507a, 1);
  setLayerDeep(phaseRing, LAYER_PHASE_ONLY);
  moonGroup.add(phaseRing);

  /* ---- 站点记号：贴在月面上的小球，点击弹出介绍 ----
   * 为什么不用射线求交（Raycaster）而用屏幕空间命中：
   *   ① 记号只有几个像素，孩子们点不准 —— 屏幕空间可以给 18px 的宽容半径；
   *   ② Raycaster 默认只测第 0 层（`Layers` 的默认 mask 就是 1），
   *      而这些记号在第 1 层（要避开月相小窗），还得额外配一次 layers，容易埋雷；
   *   ③ 背面遮挡用「法线·视线」的符号判掉就够了（球是凸的，正半球必可见）。
   */
  interface MarkerItem {
    feature: MoonFeature;
    mesh: THREE.Mesh;
    /** 体固系单位法线 */
    dir: THREE.Vector3;
    /** 体固系表面点（局部坐标，随 moonGroup 一起变换） */
    local: THREE.Vector3;
  }

  const markerGeoSmall = new THREE.SphereGeometry(0.024, 14, 10);
  const markerGeoBig = new THREE.SphereGeometry(0.032, 16, 12);
  const markerMatCache = new Map<string, THREE.MeshBasicMaterial>();
  function markerMaterial(kind: MoonFeature["kind"]) {
    let mat = markerMatCache.get(kind);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: FEATURE_COLORS[kind] });
      markerMatCache.set(kind, mat);
    }
    return mat;
  }

  const markers: MarkerItem[] = MOON_FEATURES.map((f) => {
    const d = directionFor(f.lat, f.lon);
    const dir = new THREE.Vector3(d.x, d.y, d.z);
    const mesh = new THREE.Mesh(
      isLandingSite(f) ? markerGeoBig : markerGeoSmall,
      markerMaterial(f.kind)
    );
    mesh.position.copy(dir).multiplyScalar(MOON_RADIUS * 1.006);
    mesh.layers.set(LAYER_MAIN);
    moonGroup.add(mesh);
    return { feature: f, mesh, dir, local: mesh.position.clone() };
  });

  /** 选中环：套在当前查看的那个站点外面 */
  const selectRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.07, 0.008, 8, 40),
    new THREE.MeshBasicMaterial({ color: 0xffe9a8 })
  );
  selectRing.layers.set(LAYER_MAIN);
  selectRing.visible = false;
  moonGroup.add(selectRing);

  let selectedName: string | null = null;
  function setSelected(name: string | null) {
    selectedName = name;
    const item = markers.find((m) => m.feature.name === name);
    if (!item) {
      selectRing.visible = false;
      return;
    }
    selectRing.position.copy(item.local);
    selectRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), item.dir.clone().normalize());
    selectRing.visible = true;
  }

  /**
   * 记号的**屏幕尺寸恒定**：世界尺寸按"相机到月球的距离"等比放大。
   * 不这么做的话，「日地月系统」默认机位（约 11）比「月球特写」（5.2）远一倍多，
   * 记号会缩到不足 3px —— 看得见才怪，更别说点。
   */
  function updateMarkerScale() {
    const dist = camera.position.distanceTo(moonGroup.position);
    const k = Math.min(Math.max(dist / MARKER_BASE_DIST, 0.5), 4.2);
    for (const m of markers) {
      m.mesh.scale.setScalar(k);
    }
    selectRing.scale.setScalar(k);
  }

  // 星空贴图挂在 scene.background 上（无穷远，拉不远都露不了馅）；
  // 「图层 → 星空背景」开关切的是 scene.background 本身，见 setLayers。
  const starTexture = buildStarBackground();

  // ---- 月面地名标注（DOM 浮层）----
  const labelHost = document.createElement("div");
  labelHost.className = "moon-labels";
  host.appendChild(labelHost);

  interface LabelItem {
    feature: (typeof MOON_FEATURES)[number];
    el: HTMLDivElement;
    /** 体固系单位法线 */
    dir: THREE.Vector3;
    /** 体固系表面点（略抬离球面，避免和地形打架） */
    local: THREE.Vector3;
  }

  const labels: LabelItem[] = MOON_FEATURES.map((f) => {
    const el = document.createElement("div");
    el.className = `moon-label is-${f.kind}`;
    el.dataset.feature = f.name;
    const dot = document.createElement("i");
    dot.style.background = FEATURE_COLORS[f.kind];
    const text = document.createElement("span");
    text.textContent = f.name;
    el.appendChild(dot);
    el.appendChild(text);
    labelHost.appendChild(el);
    const d = directionFor(f.lat, f.lon);
    const dir = new THREE.Vector3(d.x, d.y, d.z);
    return { feature: f, el, dir, local: dir.clone().multiplyScalar(MOON_RADIUS * 1.001) };
  });

  const tmpNdc = new THREE.Vector3();
  const tmpRot = new THREE.Matrix4();
  const tmpDir = new THREE.Vector3();
  /** 摆机位用的暂存向量（与 `tmpDir` 分开，因为 `toWorldDir` 会占着 tmpDir） */
  const tmpVec = new THREE.Vector3();
  const Z_AXIS = new THREE.Vector3(0, 0, 1);
  const UP_Y = new THREE.Vector3(0, 1, 0);
  /** 体固系里的太阳方向：两个模式共用同一条 `λ = 180° − 360°×月龄/T` */
  const bodySun = new THREE.Vector3(1, 0, 0);
  const camToMoon = new THREE.Vector3();

  /**
   * 「月球此刻怎么看」的三件套：相机指向月球中心的单位向量、月球的**世界旋转**、
   * 以及把体固向量搬到世界系的工具。
   *
   * ⚠ 这是 v1.0.0 引入「日地月系统」后**必须**补上的一步。v0.0.1 里月球永远在原点、
   *   姿态是单位阵，于是"体固系 = 世界系"，直接拿 `item.dir` 点乘相机方向就是对的。
   *   现在月球既公转又自转，还用老写法的话，症状是「标注贴着屏幕而不是贴着月球」——
   *   月面转过去了、字还留在原地。这种错在单张静态截图里几乎看不出来。
   */
  function moonFrame() {
    moonGroup.updateMatrixWorld(true);
    camToMoon.copy(camera.position).sub(moonGroup.position).normalize();
    tmpRot.extractRotation(moonGroup.matrixWorld);
  }
  /** 体固系单位向量 → 世界系单位向量（结果放在复用的 tmpDir 里，用完即取） */
  function toWorldDir(local: THREE.Vector3) {
    return tmpDir.copy(local).applyMatrix4(tmpRot).normalize();
  }

  function layoutLabels() {
    // 「日地月系统」里月球只有百来像素，十几个标注框会糊成一团 —— 那个视角
    // 要讲的是"公转"，不是"月面地形"。想读地名就切回「月球特写」。
    if (viewMode !== "moon") {
      return;
    }
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    moonFrame();
    const boxes: { el: HTMLDivElement; x: number; y: number; w: number; h: number }[] = [];

    for (const item of labels) {
      // 地名在球面上是活的：转到背面就必须收起来，否则会"透过月球看见字"。
      // 判据是「该点法线与视线夹角」——front<0.12 约等于转到 83° 以外。
      const front = toWorldDir(item.dir).dot(camToMoon);
      if (front < 0.12) {
        item.el.style.display = "none";
        continue;
      }
      tmpNdc.copy(item.local).applyMatrix4(moonGroup.matrixWorld).project(camera);
      const x = (tmpNdc.x * 0.5 + 0.5) * w;
      const y = (-tmpNdc.y * 0.5 + 0.5) * h;
      const textW = item.feature.name.length * LABEL_FONT + 12 + 10;
      boxes.push({ el: item.el, x, y, w: textW, h: LABEL_H });
    }

    // 屏幕空间让位：按 y 排序后逐个下推，保证任意两个标注框不相交。
    // （地名在月面东北角天然挤在一起 —— 静海与阿波罗11号着陆点相距不到 0.14 个球半径。）
    boxes.sort((a, b) => a.y - b.y || a.x - b.x);
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const b of boxes) {
      let cy = b.y;
      for (let guard = 0; guard < 40; guard += 1) {
        const x0 = b.x - b.w / 2;
        const x1 = b.x + b.w / 2;
        const y0 = cy - b.h / 2;
        const y1 = cy + b.h / 2;
        const hit = placed.find(
          (p) => !(x1 < p.x0 - 1 || x0 > p.x1 + 1 || y1 < p.y0 - 1 || y0 > p.y1 + 1)
        );
        if (!hit) {
          placed.push({ x0, x1, y0, y1 });
          // ⚠ 必须是 flex，不能写成 block：.moon-label 靠 `display:flex` 把
          // 「色块 <i> + 文字 <span>」**并排**放进 17px 高的框里。
          // 写成 block 会把 <i>（自己也是 block）压成独占一行，文字被挤到第二行，
          // 于是 10px 图标 + 14px 行高 = 24px 的内容塞进 14px 的框 ——
          // 框的下边线正好从字中间穿过，字的下半截溢出到月面照片上。
          // 这个坏法在 DOM 上**看不出**：getBoundingClientRect 量的是框本身，
          // 溢出内容不算在内 ⇒ 判据只量框就会全绿（F4b 专门量"框装不装得住内容"）。
          b.el.style.display = "flex";
          b.el.style.left = `${x0.toFixed(1)}px`;
          b.el.style.top = `${y0.toFixed(1)}px`;
          break;
        }
        cy = hit.y1 + b.h / 2 + LABEL_GAP;
      }
    }
  }

  /** 「地球→太阳」的世界方向（平行光照的方向）。`updateMoonTransform` 每帧重算 */
  const sunDirFromEarth = new THREE.Vector3(1, 0, 0);
  /** 暂存：月球本地轨道位置（转 β 之前的那个向量） */
  const tmpLocal = new THREE.Vector3();

  /**
   * 把太阳方向写进「两个坐标系」：
   *  - `terminator` / `sunGroup` 是月球（或月球所在坐标系）的**子节点** ⇒ 用体固系方向摆；
   *  - 着色器里 `dot(世界法线, uSunDir)` ⇒ **必须**给世界系方向。
   * 两者在「月球特写」里恰好相等（体固系＝世界系）。「日地月系统」里给
   * `sunDirFromEarth`（地球→太阳方向）：地球和月球拿到**同一个**方向 ⇒
   * 着色器用的是平行光，与右栏"受照比例 = (1+cos 相位角)/2"的平行光公式严格一致。
   */
  function applySun() {
    terminator.quaternion.setFromUnitVectors(Z_AXIS, bodySun);
    sunGroup.quaternion.setFromUnitVectors(Z_AXIS, bodySun);
    if (viewMode === "orbit") {
      moonUniforms.uSunDir.value.copy(sunDirFromEarth);
      earthUniforms.uSunDir.value.copy(sunDirFromEarth);
    } else {
      moonUniforms.uSunDir.value.copy(bodySun);
    }
  }

  /**
   * 天体位姿总更新（v1.4.0：日心三球仪 + 单调时间基）。
   *
   * 「月球特写」= 月球钉在原点、姿态为单位阵（体固系就是世界系）；
   * 「日地月系统」= 地球带着月球绕太阳公转（`earthOrbitPosition`）、
   * 月球绕地球公转 + 潮汐锁定自转（本地方位角 `φ` 与姿态 `φ−90°`，v1.0.0 的推导原样保留，
   * 整体再转 `earthFrameYaw` 搬进世界系）、地球自转（`earthSpinAngle`，真实速度）。
   *
   * ⚠ 入参是**累计天数**（单调），不是月龄。两个量各归各位：
   *   · 月相几何（月球位置/姿态、太阳直射点）吃 `normalizeAge(days)`；
   *   · 地球的公转与自转只吃 `days`。
   *   以前两边都吃月龄 ⇒ 月龄一回卷，地球沿轨道倒跳 29.1°、屏幕跳 230px。
   */
  function updateMoonTransform(days: number) {
    if (viewMode === "orbit") {
      const a = normalizeAge(days);
      const ep = earthOrbitPosition(days, SUN_DIST);
      earthSystem.position.set(ep.x, ep.y, ep.z);
      const beta = earthFrameYaw(days);
      const p = orbitPosition(a, MOON_ORBIT_R);
      tmpLocal.set(p.x, p.y, p.z).applyAxisAngle(UP_Y, beta);
      moonGroup.position.copy(earthSystem.position).add(tmpLocal);
      moonGroup.quaternion.setFromAxisAngle(UP_Y, beta + orbitYaw(a));
      // 地球自转：真实速度（一天 366.25/365.25 圈），绕自己的（被地轴倾角倾斜过的）极轴。
      // 累计天数是单调的 ⇒ 这个角也是单调的，跨朔望月边界不会跳。
      earthMesh.rotation.y = EARTH_SPIN + earthSpinAngle(days);
      // 平行光方向 = 地球→太阳。太阳在原点，地球在 ep ⇒ 方向 = −ê。
      // （v1.4.5 删掉了阳光箭头，这里只剩着色器要用的方向 —— 别以为"没人用了"就删掉它。）
      sunDirFromEarth.set(-ep.x, -ep.y, -ep.z).normalize();
    } else {
      moonGroup.position.set(0, 0, 0);
      moonGroup.quaternion.identity();
    }
    moonGroup.updateMatrixWorld(true);
    earthSystem.updateMatrixWorld(true);
    updateLinkLine();
  }

  /**
   * 时间基：**累计天数**（单调，可以 > 朔望月、也可以为负），不是"月龄"。
   *
   * v1.3.0 及以前只有一个循环的 `currentAge`（0..T），地球公转也吃它 ⇒ 每过一个朔望月，
   * 地球沿轨道倒跳 29.1°（屏幕上 230px、世界坐标 23 个单位）。自动推进 11 秒跨一次边界，
   * 于是学生看到「旋转的时候会有异动，瞬间的卡动」（真机探针实测那一帧 279 倍于正常帧）。
   * 现在：月相几何吃 `normalizeAge(currentDays)`，地球只吃 `currentDays` —— 两边永不打架。
   */
  let currentDays = DEFAULT_AGE;

  /**
   * 时间推进的**唯一入口**：改的是累计天数。月相与地球各自取用自己那一份，
   * 见 `updateMoonTransform`。
   */
  function setDays(days: number) {
    currentDays = days;
    const a = normalizeAge(days);
    const lon = 180 - (360 * a) / SYNODIC_MONTH;
    const rad = lon * DEG;
    // 体固坐标系：+Z 朝地球、+X 为东经方向 ⇒ 太阳方向 = (sin λ, 0, cos λ)
    bodySun.set(Math.sin(rad), 0, Math.cos(rad));
    updateMoonTransform(days);
    applySun();
  }

  /**
   * 拨到某个**月龄**（滑杆、快捷月相、复位视角都走这里）。
   *
   * ⚠ 取的是"离当前时刻**最近**的同相位天数"（`nearestPhaseDays`），不是直接赋值：
   *   往前拖到 0.1 天 = 又过了一个月（地球继续往前走 29.1°），往回拖才是退回上个月。
   *   直接赋值的话，滑杆一穿过边界地球就闪一下 —— 那正是这次要修的毛病。
   */
  function setPhase(monthAge: number) {
    setDays(nearestPhaseDays(monthAge, currentDays));
  }

  /** 当前月龄（0..朔望月）—— UI 读数与月相几何都用它 */
  function currentAgePhase() {
    return normalizeAge(currentDays);
  }

  let layerState: LayerState = { ...DEFAULT_LAYERS };
  function setLayers(l: LayerState) {
    layerState = { ...l };
    moonUniforms.uAllLit.value = l.lighting ? 0 : 1;
    terminator.visible = l.lighting && l.terminator;
    graticule.visible = l.grid;
    // 星空 = 背景贴图：开就是 scene.background，关就是 null（还原成渲染器的清屏色）
    scene.background = l.stars ? starTexture : null;
    const orbit = viewMode === "orbit";
    // 「太阳方向 / 地月方向」这两个指示器只在「月球特写」里存在 ——
    // 系统视角里有真的太阳和真的地球，再画两个箭头就重复了。
    sunGroup.visible = !orbit && l.sunMarker;
    earthGroup.visible = !orbit && l.earthDir;
    const showLabels = !orbit && l.features;
    labelHost.style.display = showLabels ? "block" : "none";
    if (!showLabels) {
      for (const item of labels) {
        item.el.style.display = "none";
      }
    }
    for (const m of markers) {
      m.mesh.visible = l.features;
    }
    selectRing.visible = l.features && selectedName !== null;
    // 「追月特写」藏起来的那几样要在这里**重新按一遍** —— `setViewMode` 会调 `setLayers`，
    // 漏了这一行就出现"切模式回来太阳还在，但那几样本该恢复的却还是 hidden"这类错位。
    applyEyeVisibility();
  }

  let playing = false;
  let onAge: ((a: number) => void) | null = null;

  /** OrbitControls 会把用户的旋转增量按阻尼慢慢释放；直接摆机位时必须先把增量清掉 */
  function snapControls() {
    const keep = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = keep;
  }

  /**
   * 「日地月系统」里要装进画面的采样点：**与地球位置无关的包络圈**。
   *
   * v1.2.0~v1.3.0 是按"此刻的地月系"现算的 —— 那时地球公转角是从**月龄**这个循环量
   * 算的，地球其实只在一个 29° 的小弧上来回蹭，取景围着它收紧没问题。
   * v1.4.0 修掉回卷 bug 之后（见 `moonPhase.ts` 的时间基注释），地球会**真的走完一整圈**：
   * 用旧口径，地球播着播着就走出画外（I15/I23 的读数就是它），而且"离相机远近"
   * 还会让地球忽大忽小。
   *
   * 所以改成**包络圈**：以太阳为心、半径 `ORBIT_FIT_R`（＝地球轨道 + 月球轨道 + 月球半径）
   * 的整圈，加地球那 ±一个半径的离面余量。构图从此与时间无关 ——
   * 代价是相机退到约 171，天体在屏幕上小了一圈（太阳的世界半径已同步放大，见 `ORBIT_SCENE`；
   * 地球/月球不能放大，那是教学比值 ⇒ 系统视角里月球只有 9px 直径，
   * 看月相走 150px 的月相小窗，看月面细节走「月球特写」/「追月特写」）。
   *
   * 地球公转轨道圈（半径 46）自然落在包络圈之内，于是**整圈都可见** ——
   * 这一点是白捡的教学好处：学生能直接看到"地球在这一圈上走"。
   */
  function orbitFitPoints(): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    // 太阳本体：圆心处垂直方向的极点（横向那一圈由下面的包络圈覆盖）
    for (const dy of [SUN_RADIUS, -SUN_RADIUS]) {
      pts.push(new THREE.Vector3(0, dy, 0));
    }
    // 包络圈：环上 36 个方向 × 三个高度（地球是半径 3.667 的球，会离开黄道面一点点）
    const lift = EARTH_RADIUS * 1.05;
    for (let i = 0; i < 36; i += 1) {
      const a = (i / 36) * Math.PI * 2;
      const x = ORBIT_FIT_R * Math.cos(a);
      const z = -ORBIT_FIT_R * Math.sin(a);
      pts.push(new THREE.Vector3(x, 0, z));
      pts.push(new THREE.Vector3(x, lift, z));
      pts.push(new THREE.Vector3(x, -lift, z));
    }
    return pts;
  }

  /**
   * 「日地月系统」取景要**避开左右两栏**，这里把"没被挡住的那条竖带"换算成 NDC。
   *
   * 两栏是**浮在画布上**的（固定宽 210 / 272），画布本身满屏 ⇒ 只按画布取景，系统两端
   * 会正好落在两栏背后。v1.1.0 第一次跑就是这个症状：太阳被左栏盖住，
   * 而 `onScreen` 判据照样是 true（它确实"在画布里"）—— 几何量判据全绿、肉眼一看没有。
   * 所以取景目标不再是整幅画布，而是两栏之间那条竖带。
   *
   * 读数用 `host.parentElement`（＝舞台）而不是 `document`：这样连在这个页面里放两份游戏
   * 也不会互相串。布局异常（两栏把画布挤没了）时退回整幅，宁可难看也不要算出个负数。
   */
  function usableBandNdc(): { cx: number; halfX: number } {
    const el = renderer.domElement;
    const cw = el.clientWidth || 1;
    const box = el.getBoundingClientRect();
    const root: ParentNode = host.parentElement ?? host.ownerDocument;
    const gap = 14;
    let left = 0;
    let right = cw;
    const rail = root.querySelector?.(".moon-rail");
    const panel = root.querySelector?.(".moon-panel");
    if (rail) {
      const r = rail.getBoundingClientRect().right - box.left;
      if (r > left) {
        left = r + gap;
      }
    }
    if (panel) {
      const r = panel.getBoundingClientRect().left - box.left;
      if (r > 0 && r < cw) {
        right = r - gap;
      }
    }
    if (right - left < cw * 0.2) {
      return { cx: 0, halfX: 0.9 };
    }
    return {
      cx: ((left + right) / cw) - 1,
      halfX: (right - left) / cw
    };
  }

  /**
   * 求一个"刚好装得下整个日地月系统、并且不被左右两栏挡住"的相机距离。
   *
   * 用**迭代投影**而不是解析式：解析式要自己算透视缩短、视场角与宽高比的耦合，
   * 很容易差那么一点（尤其是相机带仰角、内容又不对称的时候）。
   * 这里直接按当前视锥把采样点投到 NDC，量出最大偏移再按比例缩放距离，
   * 迭代几次就收敛 —— 顺便把"屏幕很窄"这种情形也一起照顾到了。
   */
  function fitOrbitDistance(dir: THREE.Vector3, up: THREE.Vector3): number {
    const keepUp = camera.up.clone();
    const keepPos = camera.position.clone();
    const keepTarget = controls.target.clone();
    const band = usableBandNdc();
    // ⚠ `up` 必须**传进来**，不能再写死 (0,1,0)：俯视黄道面那一档的 up 是
    //   `(-sin ψ, 0, -cos ψ)`（见 `setView`），而写死的 (0,1,0) 与正俯视的视线方向
    //   平行 ⇒ three 的 `lookAt` 会**退化**并自己乱推一个 up 出来，取景就算偏了。
    camera.up.copy(up);
    camera.updateProjectionMatrix();
    // 迭代起点：取"最远的采样点再往外一截"。起点若太小（v1.0.0 是 12），太阳会落在相机
    // **背后**，投影出来的 NDC 又大又翻号，迭代要么收敛很慢、要么在两端来回蹦。
    // 按包络半径取就与地球走到哪儿无关了 —— 以后改多远都还是从"外面"往回收。
    let d = ORBIT_FIT_R * 3.2;
    for (let iter = 0; iter < 20; iter += 1) {
      camera.position.copy(dir).multiplyScalar(d);
      controls.target.set(0, 0, 0);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      let k = 0;
      for (const p of orbitFitPoints()) {
        const q = p.clone().project(camera);
        // 横向按"可用竖带"量（q.x = 0 是画布中线，竖带中心在 band.cx），
        // 纵向没有遮挡，照旧按整幅留 10% 边距。
        k = Math.max(k, Math.abs(q.x - band.cx) / (band.halfX * 0.9), Math.abs(q.y) / 0.9);
      }
      const factor = k;
      d *= factor;
      if (Math.abs(factor - 1) < 0.004) {
        break;
      }
    }
    camera.up.copy(keepUp);
    camera.position.copy(keepPos);
    controls.target.copy(keepTarget);
    return d;
  }

  function setView(kind: "near" | "north" | "south" | "top" | "tilt" | "reset") {
    // 任何一个"重新取景"的动作都会把机位搬到别处 ⇒ 先退出追月跟随。
    // （切模式走的是 `setViewMode` → `setView("reset")`，于是也一并退出，不用另写。）
    stopFollowMoon();
    // 「俯视黄道面」是唯一一档要"跟着时间转朝向"的，见 syncTopView
    topViewLocked = viewMode === "orbit" && kind === "top";
    if (viewMode === "orbit") {
      controls.target.set(0, 0, 0);
      if (kind === "top") {
        // 「俯视黄道面」：相机在 +Y，**up 跟着地球的方位转**。
        //
        // 教学承诺（右栏「月相成因」示意图）：太阳在左、新月在地球的太阳一侧、
        // 上弦在下方、俯视逆时针 —— 学生要能"把上面这张图直接抄到下面这张图上"。
        //
        // ⚠ v1.4.0 之前这里写的是 up=(0,0,1)，靠"地球恰好在 −X"这条**约定**凑出
        //   "太阳在地球左侧"。地球真的开始公转之后这条约定不再成立：地球走到 +X 一侧时
        //   太阳就跑到地球右边去了，两张图对不上（而三维画面本身依然"看着正常"）。
        //   现在取 up = (−sin ψ, 0, −cos ψ)：它让**屏幕右 = 地球的外向方向**，
        //   于是"太阳在地球左侧、新月在两者之间"在**任何时刻**都成立（判据 I15b 扫一年）。
        //   代价：俯视图不再显示"地球在轨道上跑"（画面在反着转）——
        //   要看公转用默认的斜视档，那一档镜头是固定的，地球会绕着走一整圈。
        const psi = earthOrbitAngle(currentDays);
        const up = new THREE.Vector3(-Math.sin(psi), 0, -Math.cos(psi));
        camera.up.copy(up);
        const d = fitOrbitDistance(new THREE.Vector3(0, 1, 0), up);
        camera.position.set(0, d, 0.0001);
      } else {
        camera.up.set(0, 1, 0);
        const d = fitOrbitDistance(ORBIT_CAM_DIR, new THREE.Vector3(0, 1, 0));
        camera.position.copy(ORBIT_CAM_DIR).multiplyScalar(d);
      }
      snapControls();
      return;
    }
    camera.up.set(0, 1, 0);
    const dir =
      kind === "north"
        ? new THREE.Vector3(0.001, 1, 0.001).normalize()
        : kind === "south"
          ? new THREE.Vector3(0.001, -1, 0.001).normalize()
          : new THREE.Vector3(0, 0, 1);
    camera.position.copy(dir.multiplyScalar(CAM_DIST));
    controls.target.set(0, 0, 0);
    snapControls();
  }

  function setViewMode(mode: ViewMode) {
    viewMode = mode;
    const orbit = mode === "orbit";
    orbitGroup.visible = orbit;
    orbitLabelHost.style.display = orbit ? "block" : "none";
    controls.maxDistance = orbit ? ORBIT_MAX_DIST : 13;
    // 最近距离也得跟着地球半径走：v1.0.0 地球半径 1.35，写死 1.6 刚好在球外；
    // v1.1.0 地球半径变成 3.667，还是 1.6 的话镜头会**钻进地球里面**（画面一片黑）。
    // 取 1.2 × EARTH_RADIUS ≈ 4.4：既在地球外，又小于 `focusFeature` 在系统视角用的 4.6，
    // 免得把"追月特写"那一下的机位一起夹歪。
    controls.minDistance = orbit ? EARTH_RADIUS * 1.2 : 1.5;
    updateMoonTransform(currentDays);
    setLayers(layerState);
    applySun();
    setView("reset");
  }

  /**
   * 把主镜头搬到某个站点的正上方：相机沿该点的**世界法线**后退，
   * 于是站点落在月盘正中。
   * 之所以不"只把站点点亮"——孩子们点了一个地名，最想知道的是"它在月球的哪儿"，
   * 让镜头直接飞过去比给个高亮有用得多。
   */
  function focusFeature(f: MoonFeature) {
    // 定位到某个站点 = 又要搬机位了 ⇒ 退出追月（否则下一秒又被拉回月球中心）
    stopFollowMoon();
    moonFrame();
    const d = directionFor(f.lat, f.lon);
    // ⚠ `toWorldDir` 返回的是内部复用的 `tmpDir`，必须 `.clone()` 之后再用 ——
    //   否则下面 `multiplyScalar` 会把引擎下一帧要读的方向向量一起改掉。
    const w = toWorldDir(tmpVec.set(d.x, d.y, d.z)).clone();
    const dist = viewMode === "orbit" ? 4.6 : CAM_DIST;
    camera.up.set(0, 1, 0);
    const target = moonGroup.position.clone();
    controls.target.copy(target);
    camera.position.copy(target).add(w.multiplyScalar(MOON_RADIUS + dist));
    snapControls();
  }

  /**
   * v1.4.5：「追月特写」＝**从地球看月球**（相机钉在地球上，永远看向月心）。
   *
   * 三个版本的口径演变（改之前先看清前两版为什么都不对）：
   *   · v1.1.0 是"一次性把镜头搬到月球"（`focusFeature` 那一路）——到位那一帧确实对着月球，
   *     之后月球在公转、相机不动 ⇒ 月球立刻跑掉。用户原话：「如果现在是在自动运动，
   *     那么就会闪一下就走了，并不能将视角一直保持在这个月球上面」。
   *   · v1.3.0 改成"每帧增量平移"，月球确实钉住了，但**机位方向取的是当时的视线方向**：
   *     从默认斜视档按下去，等于"顺着看太阳的方向飞到月球旁边" ⇒ 看到的月相与
   *     地球观测者毫无关系。
   *   · v1.4.5（本版）用户原话：「应该是从地球看月球的这个特写，方向就是从地球看向月球」。
   *     相机钉在**地球朝向月球那一侧的地表外侧**（`地心 + ê · EARTH_RADIUS × 1.05`），
   *     每帧看向月心。于是主视图里的月相就是**地球观测者看到的月相** ——
   *     与右上角月相小窗（它的相机挂在月球体固系 +Z，而 +Z 永远朝着地球）是同一个答案。
   *
   * ⚠ v1.3.0 的"增量平移"在这里**用不了**：那条机位向量是"地心→月心"的方向，
   *   地球绕太阳、月球绕地球 ⇒ 它每帧都在**转**，平移补不了旋转。
   *   所以 `syncFollow` 每帧按绝对位置重摆（position 与 target 一起给）。
   *   OrbitControls 的 `update()` 每帧都会从"当前的 position 与 target"反推球坐标，
   *   只要没有待释放的拖动增量，绝对重摆就不会被它改回去。
   *
   * ⚠ 进了这个模式**旋转/缩放全关**（机位一离开地球，"从地球看"就不成立了），
   *   但**滚轮改吃视场角**（`FOLLOW_FOV_MIN/MAX`，＝换镜头／望远镜变焦）——
   *   否则"鼠标怎么动画面都不动"会被当成卡死（v1.3.0 的教训）。
   *
   * 退出：再按一次「追月特写」，或按别的视角按钮 / 切模式
   * （都要重新取景，统一走 `setView` / `focusFeature` 里的 `stopFollowMoon`）。
   */
  let followMoon = false;
  /**
   * 「俯视黄道面」是否处于**朝向跟踪**状态（v1.4.0）：按了这一档就开着，
   * 用户自己拖动 / 切到别的档就关掉。见 `syncTopView`。
   */
  let topViewLocked = false;
  /**
   * 进「追月特写」时要**暂时藏起来**的东西：太阳（含两层辉光）、两条轨道虚线、地月连线。
   * 全都在这个模式下才藏，退出即恢复（`applyEyeVisibility`）。
   *
   * **为什么必须藏太阳**：世界半径 13.5 是"给 214 远的相机"定的夸张值。相机一挪到地球表面，
   * 太阳的角半径就变成 `asin(13.5/42) ≈ 18.7°`、辉光外缘 `atan(48.6/42) ≈ 49°`，
   * 而 fov 22 时的半视场角只有 11° ⇒ **整幅画面被阳光与辉光糊满**（新月最惨，
   * 因为"新月"本来就是月球跑到太阳那一侧）。这不是渲染 bug，是"夸张太阳 + 近距观察"的必然。
   * 从地球抬头看月亮，眼里本来就只有月亮和星空 —— 这也正是月相小窗的口径（它只画月亮）。
   *
   * 轨道虚线同理：相机就坐在月球轨道圈上，那条圆会贴着画面横扫过去。
   *
   * （`eyeHidden` 这个数组本身声明在场景搭建的开头 —— 它要在建场景时就登记，
   * 而 `const` 在声明前是 TDZ，放在这里会晚于 `eyeHidden.push(...)` 的执行。）
   */
  /** 这个模式下被藏起来的物体是否恢复可见。`setLayers` 与进/出跟随都要调一次 */
  function applyEyeVisibility() {
    const hide = followMoon && viewMode === "orbit";
    for (const o of eyeHidden) {
      o.visible = !hide;
    }
  }

  function stopFollowMoon() {
    followMoon = false;
    // 视场角与鼠标操作都要还回去 —— 否则切到别的视角还顶着一个"望远镜"
    if (camera.fov !== CAMERA_FOV) {
      camera.fov = CAMERA_FOV;
      camera.updateProjectionMatrix();
    }
    controls.enableRotate = true;
    controls.enableZoom = true;
    applyEyeVisibility();
  }

  /** 地心 → 月心的单位方向：就是"从地球看向月球"这条视线 */
  const eyeDir = new THREE.Vector3();

  /**
   * 把相机摆到"站在地球上看向月球"的位置与朝向。方向退化（地月重合）时返回 false 不摆。
   *
   * 机位在**地表外侧**（1.05 × 地球半径 = 3.85）有两个好处：
   *   ① 不会钻进地球里；
   *   ② 整个地球都在视平面**之后**（任一地球点沿视线的分量 ≤ 3.667 < 3.85）⇒ 地球一个像素
   *      都不出现，跟月相小窗一样"眼里只有月亮"（所以也不需要给地球做任何透明/裁剪）。
   */
  function placeEarthEye() {
    const mp = moonGroup.position;
    const ep = earthSystem.position;
    eyeDir.copy(mp).sub(ep);
    if (eyeDir.lengthSq() < 1e-9) {
      return false;
    }
    eyeDir.normalize();
    // 地月方向永远躺在黄道面内（月球轨道就在这个面上）⇒ 与 up=(0,1,0) 不可能平行，
    // lookAt 的 up 不会退化，不必像 v1.3.0 那样兜底换 up。
    camera.up.set(0, 1, 0);
    camera.position.copy(ep).addScaledVector(eyeDir, EARTH_RADIUS * FOLLOW_EYE_LIFT);
    controls.target.copy(mp);
    return true;
  }

  function startFollowMoon() {
    // 这个承诺只对「日地月系统」成立（按钮也只在这一档出现）：月球特写里地月关系是
    // 画出来的示意，没有可站的地球。
    if (viewMode !== "orbit") {
      return;
    }
    followMoon = true;
    if (camera.fov !== FOLLOW_FOV) {
      camera.fov = FOLLOW_FOV;
      camera.updateProjectionMatrix();
    }
    // 旋转/缩放全关：这个模式的承诺是"机位在地球上"，拖走就不成立了
    controls.enableRotate = false;
    controls.enableZoom = false;
    applyEyeVisibility();
    placeEarthEye();
    snapControls();
  }

  /**
   * 每帧的跟随：把相机重新摆回"地球上看向月球"（v1.4.5）。
   *
   * ⚠ 必须**在 `controls.update()` 之前**调用：OrbitControls 的 `update()` 会拿当时的
   *   `camera.position` 与 `controls.target` 反推球坐标、再按内部增量修正一次 ——
   *   先摆好，这一帧的朝向才是我要的。
   */
  function syncFollow() {
    if (!followMoon || viewMode !== "orbit") {
      return;
    }
    placeEarthEye();
  }

  /**
   * 「追月特写」里的滚轮＝**换镜头**（改视场角，不是推拉相机）。
   *
   * 为什么不能交给 OrbitControls：它的滚轮是"沿视线推拉相机" ⇒ 相机会离开地球表面，
   * "从地球看月球"当场不成立。改 fov 则机位不动、只是把月亮放大，正是望远镜在做的事。
   * ⚠ 必须自己 `preventDefault()`（`passive: false` 才拦得住），否则画面跟着整页滚动。
   */
  function onEyeWheel(ev: WheelEvent) {
    if (!followMoon || viewMode !== "orbit") {
      return;
    }
    ev.preventDefault();
    const step = ev.deltaY > 0 ? 2 : -2;
    const next = Math.min(FOLLOW_FOV_MAX, Math.max(FOLLOW_FOV_MIN, camera.fov + step));
    if (next !== camera.fov) {
      camera.fov = next;
      camera.updateProjectionMatrix();
    }
  }
  renderer.domElement.addEventListener("wheel", onEyeWheel, { passive: false });

  /**
   * 「俯视黄道面」的朝向**每帧跟着地球的方位转**（v1.4.0 新增）。
   *
   * 为什么必须每帧转：这一档的教学承诺是"与右栏月相成因示意图逐项对上"——
   * 太阳在地球左侧、新月夹在两者之间。屏幕右 = 地球的外向方向 ⇒ up 必须是
   * `(-sin ψ, 0, -cos ψ)`（推导见 `setView`）。而 ψ 随时间走 1°/天，
   * 只在按按钮那一刻摆一次的话，自动推进半分钟就偏掉 20°，两张图就对不上了。
   *
   * 与追月跟随的取舍一致：用户一旦**自己拖动**（controls 的 `start` 事件），
   * 就说明他想看别的角度 ⇒ 停掉跟踪，不再跟用户抢镜头。
   */
  function syncTopView() {
    if (viewMode !== "orbit" || !topViewLocked) {
      return;
    }
    const psi = earthOrbitAngle(currentDays);
    camera.up.set(-Math.sin(psi), 0, -Math.cos(psi));
  }

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w > 0 && h > 0) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    phaseRenderer.setSize(PHASE_CANVAS, PHASE_CANVAS, false);
    phaseCamera.left = -PHASE_FRUSTUM;
    phaseCamera.right = PHASE_FRUSTUM;
    phaseCamera.top = PHASE_FRUSTUM;
    phaseCamera.bottom = -PHASE_FRUSTUM;
    phaseCamera.updateProjectionMatrix();
  }


  function renderBoth() {
    renderer.render(scene, camera);
    // 月相小窗是"从地球看月球"的特写：保持纯深空底色，不带星空贴图 ——
    // scene.background 对所有相机生效，必须在这里临时摘掉再还给主视图。
    const keepBg = scene.background;
    scene.background = null;
    phaseRenderer.render(scene, phaseCamera);
    scene.background = keepBg;
  }

  let raf = 0;
  let lastTime = performance.now();
  let lastNotify = 0;

  function animate() {
    raf = requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    if (playing) {
      // ⚠ 累计天数**不回卷**（回卷就是那个瞬移 bug）。月龄由 `normalizeAge` 现算，
      //   所以"月龄"看起来仍然是 0..29.53 循环，而时间本身一直往前走。
      currentDays += (dt * SYNODIC_MONTH) / PLAY_SECONDS_PER_MONTH;
      setDays(currentDays);
      if (onAge && now - lastNotify > 70) {
        lastNotify = now;
        onAge(currentAgePhase());
      }
    }

    // 追月跟随必须排在 `controls.update()` **之前**（见 syncFollow 的说明）
    syncFollow();
    // 俯视图的 up 同理：要在 controls.update() 之前摆好，那一帧的朝向才生效
    syncTopView();
    controls.update();
    updateMarkerScale();
    renderBoth();
    if (layerState.features) {
      layoutLabels();
    }
    layoutOrbitLabels();
  }

  resize();
  setDays(DEFAULT_AGE);
  setLayers(DEFAULT_LAYERS);
  renderBoth();
  raf = requestAnimationFrame(animate);

  // ---------- 自检 API ----------
  function samplePixels(pts: { x: number; y: number }[]) {
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const dpr = renderer.getPixelRatio();
    const wpx = renderer.domElement.width;
    const hpx = renderer.domElement.height;
    const buf = new Uint8Array(4);
    return pts.map((p) => {
      const bx = Math.max(0, Math.min(wpx - 1, Math.round(p.x * dpr)));
      const by = Math.max(0, Math.min(hpx - 1, Math.round(p.y * dpr)));
      gl.readPixels(bx, hpx - 1 - by, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return { r: buf[0], g: buf[1], b: buf[2] };
    });
  }

  /**
   * 量月相小窗里「受照比例」的**像素口径**。
   *
   * 直接数"亮点"是不行的：月海与高地本身明暗差 3 倍，地形亮斑会被误判成受光。
   * 做法是**同一帧渲两遍**：先全照亮（uAllLit=1）拿到"每像素的本底亮度"，
   * 再按真实太阳方向渲一遍。于是逐像素比值 r = 实渲/全亮 = mix(环境光, 1, lit)，
   * **与贴图完全无关**（贴图项被约掉了），r>0.5 就是"受光"。
   * 月盘本身也从"全亮"那一帧识别 —— 否则暗面太黑，会被当成背景漏掉。
   */
  function measurePhase(): PhaseMeasure {
    const gl = phaseRenderer.getContext();
    const w = phaseRenderer.domElement.width;
    const h = phaseRenderer.domElement.height;
    const litBuf = new Uint8Array(w * h * 4);
    const realBuf = new Uint8Array(w * h * 4);

    // ⚠ 量之前先把月盘轮廓环摘掉：它的亮度（0x35507a）远高于深空背景，
    // 会被"背景阈值"误判成月盘的一部分，于是 40x 的环被算进分母与分子
    // ⇒ 受照比例凭空偏大几个百分点（新月量出来不是 0）。摘掉再量最干净。
    phaseRing.visible = false;
    moonUniforms.uAllLit.value = 1;
    phaseRenderer.render(scene, phaseCamera);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, litBuf);
    moonUniforms.uAllLit.value = layerState.lighting ? 0 : 1;
    phaseRenderer.render(scene, phaseCamera);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, realBuf);
    phaseRing.visible = true;
    renderer.render(scene, camera);

    const cx = w / 2;
    let disk = 0;
    let lit = 0;
    let lTot = 0;
    let lLit = 0;
    let rTot = 0;
    let rLit = 0;
    let litSumX = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const base = (litBuf[i] + litBuf[i + 1] + litBuf[i + 2]) / 3;
        if (base < 18) {
          continue; // 背景（深空）
        }
        disk += 1;
        const real = (realBuf[i] + realBuf[i + 1] + realBuf[i + 2]) / 3;
        const ratio = real / Math.max(base, 1);
        const isLit = ratio > 0.5;
        if (isLit) {
          lit += 1;
          // 注意 readPixels 是自下而上的，但这里只关心横向重心，y 方向不影响
          litSumX += x + 0.5 - cx;
        }
        if (x < cx) {
          lTot += 1;
          if (isLit) {
            lLit += 1;
          }
        } else {
          rTot += 1;
          if (isLit) {
            rLit += 1;
          }
        }
      }
    }
    const diskRadiusPx = Math.sqrt(disk / Math.PI);
    return {
      diskPixels: disk,
      litPixels: lit,
      litFraction: disk ? lit / disk : 0,
      leftFraction: lTot ? lLit / lTot : 0,
      rightFraction: rTot ? rLit / rTot : 0,
      litCentroidX: lit && diskRadiusPx > 0 ? litSumX / lit / diskRadiusPx : 0,
      centerX: cx,
      diskRadiusPx,
      width: w,
      height: h
    };
  }

  /**
   * 量**主视图**里月盘的受照比例（v1.4.5）——「追月特写＝从地球看月球」的像素证据。
   *
   * 月相小窗的 `measurePhase` 是"从地球看月球"的**权威口径**（它的相机挂在月球体固系 +Z，
   * 而 +Z 永远朝着地球）。这里把**同一套口径**搬到主视图上逐项对照：
   *   · 同一帧渲两遍（全照亮 / 按真实太阳方向），逐像素比值 > 0.5 判"受光" ——
   *     与贴图明暗无关（月海与高地的差别被约掉），和 `measurePhase` 用的是同一个判据；
   *   · 只读月盘**外接矩形**那一片像素（`readPixels` 本来就支持子矩形），
   *     阈值 18 挡掉星空背景。
   *
   * ⚠ 两处**不会逐位相等**，这是设计使然、不是误差要藏起来：主视图的相机在地球**表面**
   *   （离月心 11.15），而小窗的"地球观测者"在 15 外。透视让主视图多看到一点点背面
   *   （新月时主视图量出来会比小窗略大 —— 也就是"站在地表 vs 站在地心"的差别）。
   *   所以判据比的是"在合理容差内一致 + 亮面在同一侧"，不是相等。
   */
  function measureMainMoon() {
    const rect = diskOnScreen();
    if (!rect || !(rect.radius > 2)) {
      return null;
    }
    const gl = renderer.getContext();
    const dpr = renderer.getPixelRatio();
    const wpx = renderer.domElement.width;
    const hpx = renderer.domElement.height;
    // readPixels 的 y 轴自下而上 ⇒ 先把 CSS 坐标换算成 GL 坐标，再夹进画布
    // （越界会抛 GL 错误把整支脚本打断）
    const x0 = Math.max(0, Math.floor((rect.cx - rect.radius) * dpr));
    const x1 = Math.min(wpx, Math.ceil((rect.cx + rect.radius) * dpr));
    const yTop = Math.max(0, Math.floor((rect.cy - rect.radius) * dpr));
    const yBot = Math.min(hpx, Math.ceil((rect.cy + rect.radius) * dpr));
    const rw = Math.max(1, x1 - x0);
    const rh = Math.max(1, yBot - yTop);
    const glY0 = Math.max(0, hpx - yBot);
    const n = rw * rh;
    const litBuf = new Uint8Array(n * 4);
    const realBuf = new Uint8Array(n * 4);

    // ⚠ 量之前摘掉**月面记号**与**选中环**：彩色小球比"暗面"亮得多，会被算成受光，
    //   亮面重心也跟着偏（与 `measurePhase` 摘 `phaseRing` 是同一个理由）。
    const keepVisible = markers.map((m) => m.mesh.visible);
    for (const m of markers) {
      m.mesh.visible = false;
    }
    const keepRingVisible = selectRing.visible;
    selectRing.visible = false;

    const keepAllLit = moonUniforms.uAllLit.value;
    // ⚠ **必须把星空背景摘掉再量**（与小窗在 `renderBoth` 里置 null 是同一个理由）。
    //   星空是贴在图上的等距柱状图，银河那一段的亮度会超过"背景阈值 18"⇒ 那些像素被
    //   算进"月盘"，而两遍渲染里背景完全一样 ⇒ 比值 = 1 ⇒ 又被判成"受光"。
    //   症状特别好认：`measuredRadiusPx` 比 `diskRadiusPx` 大出好几像素
    //   （实测下弦时 121.0 vs 113.3 的 8px 差额，就是背景在偷偷加分）。
    const keepBg = scene.background;
    scene.background = null;
    moonUniforms.uAllLit.value = 1;
    renderer.render(scene, camera);
    gl.readPixels(x0, glY0, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, litBuf);
    moonUniforms.uAllLit.value = layerState.lighting ? 0 : 1;
    renderer.render(scene, camera);
    gl.readPixels(x0, glY0, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, realBuf);
    moonUniforms.uAllLit.value = keepAllLit;
    scene.background = keepBg;
    for (let i = 0; i < markers.length; i += 1) {
      markers[i].mesh.visible = keepVisible[i];
    }
    selectRing.visible = keepRingVisible;
    renderer.render(scene, camera);

    // 亮面横向重心：以**月心**（不是外接矩形中心）为原点，单位是月盘半径
    const cxPx = (rect.cx - x0 / dpr) * dpr;
    let disk = 0;
    let lit = 0;
    let lTot = 0;
    let lLit = 0;
    let rTot = 0;
    let rLit = 0;
    let litSumX = 0;
    for (let y = 0; y < rh; y += 1) {
      for (let x = 0; x < rw; x += 1) {
        const i = (y * rw + x) * 4;
        const base = (litBuf[i] + litBuf[i + 1] + litBuf[i + 2]) / 3;
        if (base < 18) {
          continue; // 背景（深空/星空）
        }
        disk += 1;
        const real = (realBuf[i] + realBuf[i + 1] + realBuf[i + 2]) / 3;
        const isLit = real / Math.max(base, 1) > 0.5;
        if (isLit) {
          lit += 1;
          litSumX += x + 0.5 - cxPx;
        }
        if (x + 0.5 < cxPx) {
          lTot += 1;
          if (isLit) {
            lLit += 1;
          }
        } else {
          rTot += 1;
          if (isLit) {
            rLit += 1;
          }
        }
      }
    }
    const rad = Math.sqrt(disk / Math.PI);
    return {
      diskPixels: disk,
      litPixels: lit,
      litFraction: disk ? lit / disk : 0,
      leftFraction: lTot ? lLit / lTot : 0,
      rightFraction: rTot ? rLit / rTot : 0,
      litCentroidX: lit && rad > 0 ? litSumX / lit / rad : 0,
      centreXPx: rect.cx,
      centreYPx: rect.cy,
      diskRadiusPx: rect.radius,
      measuredRadiusPx: rad,
      fov: camera.fov
    };
  }

  /**
   * 同一个屏幕点取两次色：「全照亮」与「按真实太阳方向」。
   * 两者的**比值**就是该店的受光系数（与贴图明暗无关）——
   * 这是"关掉昼夜明暗后这半边亮了多少倍"这类断言的唯一可靠口径。
   */
  function samplePair(pts: { x: number; y: number }[]) {
    const gl = renderer.getContext();
    const dpr = renderer.getPixelRatio();
    const wpx = renderer.domElement.width;
    const hpx = renderer.domElement.height;
    const buf = new Uint8Array(4);
    const grab = () => {
      renderer.render(scene, camera);
      return pts.map((p) => {
        const bx = Math.max(0, Math.min(wpx - 1, Math.round(p.x * dpr)));
        const by = Math.max(0, Math.min(hpx - 1, Math.round(p.y * dpr)));
        gl.readPixels(bx, hpx - 1 - by, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        return [buf[0], buf[1], buf[2]] as [number, number, number];
      });
    };
    const keep = moonUniforms.uAllLit.value;
    moonUniforms.uAllLit.value = 1;
    const base = grab();
    moonUniforms.uAllLit.value = keep;
    const real = grab();
    return pts.map((p, i) => {
      const b = (base[i][0] + base[i][1] + base[i][2]) / 3;
      const r = (real[i][0] + real[i][1] + real[i][2]) / 3;
      return { x: p.x, y: p.y, base: base[i], real: real[i], ratio: b > 0 ? r / b : 0 };
    });
  }

  /**
   * 数"偏蓝"的像素个数。用来判定经纬网有没有真的画上去 ——
   * 经纬网管半径只有 0.0026 ⇒ 屏上不到 1px，靠"取几个点看看"必然漏掉；
   * 而**把月面记号摘掉之后**场景里除它之外没有别的偏蓝元素
   * （深空 b−r≈15、月面灰、太阳与晨昏线是暖黄），
   * 所以"b−r>20 的像素数"是一个干净、单调、可复现的计数型指标。
   */
  function countBluish() {
    // ⚠ v1.0.0 必须先把**月面记号**摘掉再数。
    //   这条指标的全部依据是"场景里除经纬网之外没有别的偏蓝元素" ——
    //   而月海的记号色 `#7fb2e5`、盆地的 `#c9a0ff` 都满足 `b−r>20`。
    //   不摘的话"关掉经纬网"也会数出几百个偏蓝像素，判据里那句"关＝0"就成了假红。
    //   （实测 v1.0.0 未摘时：关=300 / 开=3028。）
    const keepVisible = markers.map((m) => m.mesh.visible);
    for (const m of markers) {
      m.mesh.visible = false;
    }
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let n = 0;
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i + 2] - buf[i] > 20 && buf[i + 2] > 50) {
        n += 1;
      }
    }
    markers.forEach((m, i) => {
      m.mesh.visible = keepVisible[i];
    });
    renderer.render(scene, camera);
    return n;
  }

  function probeFeatures(): FeatureProbe[] {
    renderer.render(scene, camera);
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    moonFrame();
    return labels.map((item) => {
      const front = toWorldDir(item.dir).dot(camToMoon);
      tmpNdc.copy(item.local).applyMatrix4(moonGroup.matrixWorld).project(camera);
      return {
        name: item.feature.name,
        visible: front >= 0.12,
        front,
        x: (tmpNdc.x * 0.5 + 0.5) * w,
        y: (-tmpNdc.y * 0.5 + 0.5) * h
      };
    });
  }

  /**
   * 站点记号在屏幕上的落点。
   * `front` 用来判「在朝我们的那一面吗」：球是凸的，正半球必可见，
   * 所以不必做真正的深度测试（也就避开了遮挡、透明排序那一堆边界情况）。
   */
  function sitesOnScreen(): SiteProbe[] {
    renderer.render(scene, camera);
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    moonFrame();
    return markers.map((m) => {
      const front = toWorldDir(m.dir).dot(camToMoon);
      tmpNdc.copy(m.local).applyMatrix4(moonGroup.matrixWorld).project(camera);
      return {
        name: m.feature.name,
        kind: m.feature.kind,
        front,
        x: (tmpNdc.x * 0.5 + 0.5) * w,
        y: (-tmpNdc.y * 0.5 + 0.5) * h
      };
    });
  }

  /**
   * 屏幕空间命中，宽容半径 18px。
   * 记号在屏幕上只有六七个像素，按"点中记号本身"来判小学生根本点不着；
   * 多出来的这圈宽容不会误伤 —— 最近者胜出，而且背面站点先被 front 滤掉了。
   */
  function hitSite(x: number, y: number, maxPx = 18) {
    if (!layerState.features) {
      return null;
    }
    let best: (SiteProbe & { dist: number }) | null = null;
    for (const s of sitesOnScreen()) {
      if (s.front < 0.12) {
        continue;
      }
      const dist = Math.hypot(s.x - x, s.y - y);
      if (dist <= maxPx && (!best || dist < best.dist)) {
        best = { ...s, dist };
      }
    }
    return best;
  }

  function labelBoxes() {
    const hostRect = host.getBoundingClientRect();
    return labels.map((item) => {
      const r = item.el.getBoundingClientRect();
      const shown = item.el.style.display !== "none" && r.width > 0;
      return {
        name: item.feature.name,
        visible: shown,
        x0: r.left - hostRect.left,
        x1: r.right - hostRect.left,
        y0: r.top - hostRect.top,
        y1: r.bottom - hostRect.top,
        cx: r.left - hostRect.left + r.width / 2,
        cy: r.top - hostRect.top + r.height / 2
      };
    });
  }

  function diskOnScreen() {
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    // ⚠ 距离要用「相机到月球」而不是「相机到原点」：切到「日地月系统」后
    //   月球已经不在原点了，用 position.length() 会算出一个偏大的距离，
    //   月盘半径跟着偏大 —— 判据全绿而屏幕上其实对不上。
    const dist = camera.position.distanceTo(moonGroup.position);
    if (!(h > 0) || dist <= 1) {
      return null;
    }
    camera.updateMatrixWorld();
    tmpNdc.copy(moonGroup.position).project(camera);
    // ⚠ 半视场角一律读 `camera.fov`，**不能写死 CAMERA_FOV**：v1.4.5 起「追月特写」
    //   会把 fov 改到 FOLLOW_FOV（滚轮还能继续变），写死的话月盘半径会算小一半左右
    //   —— 症状是像素判据的采样圈比真实月盘小，判据量到的全是背景。
    const limbPx =
      (Math.tan(Math.asin(MOON_RADIUS / dist)) * (h / 2)) / Math.tan((camera.fov * DEG) / 2);
    return {
      cx: (tmpNdc.x * 0.5 + 0.5) * w,
      cy: (-tmpNdc.y * 0.5 + 0.5) * h,
      radius: limbPx
    };
  }

  /** 把一个天体的世界坐标投到屏幕，顺便给出它在屏幕上的半径与"在不在画面里" */
  function projectBody(world: THREE.Vector3, radius: number) {
    camera.updateMatrixWorld();
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    const dist = camera.position.distanceTo(world);
    const q = world.clone().project(camera);
    // 半视场角读 `camera.fov`（不是 CAMERA_FOV）：追月特写的 fov 与默认不同，见 `moonLimb`
    const rPx = ((radius / Math.max(dist, 0.01)) * (h / 2)) / Math.tan((camera.fov * DEG) / 2);
    return {
      x: (q.x * 0.5 + 0.5) * w,
      y: (-q.y * 0.5 + 0.5) * h,
      r: rPx,
      /** 世界半径（场景单位）。自检靠它核对"天体大小比"这个**与相机无关**的不变量 */
      wr: radius,
      /** 到相机的距离。自检靠它把"屏幕半径比 ≠ 世界半径比"分解成**透视**造成的差异 */
      dist,
      onScreen:
        q.z < 1 &&
        Math.abs(q.x) <= 1 + (w > 0 ? rPx / (w / 2) : 1) &&
        Math.abs(q.y) <= 1 + (h > 0 ? rPx / (h / 2) : 1)
    };
  }

  function orbitState() {
    const p = moonGroup.position;
    const euler = new THREE.Euler().setFromQuaternion(moonGroup.quaternion, "YXZ");
    const ep = earthSystem.position;
    return {
      pos: [p.x, p.y, p.z] as [number, number, number],
      yaw: euler.y,
      yawDeg: (euler.y * 180) / Math.PI,
      /** 月球到**地心**的距离（月球绕的是地球，不是太阳） */
      orbitR: p.distanceTo(ep),
      /** 地球的世界位置（绕太阳公转，每帧在动） */
      earthPos: [ep.x, ep.y, ep.z] as [number, number, number],
      /** 累计天数（单调时间基）。判据靠它对"地球公转/自转是不是从循环的月龄算出来的" */
      days: currentDays,
      /** 地球自转角（含初始偏置 EARTH_SPIN；判据看它随**累计天数**的增量：一天 1.002738 圈） */
      earthYaw: earthMesh.rotation.y,
      earth: projectBody(ep.clone(), EARTH_RADIUS),
      moon: projectBody(p.clone(), MOON_RADIUS),
      sun: projectBody(new THREE.Vector3(0, 0, 0), SUN_RADIUS),
      sunDirWorld: [
        moonUniforms.uSunDir.value.x,
        moonUniforms.uSunDir.value.y,
        moonUniforms.uSunDir.value.z
      ] as [number, number, number],
      camDist: camera.position.length(),
      /**
       * 「追月特写＝地球视角」的自检读数（v1.4.5）。
       *
       * 判据要回答的正是用户那句话："方向就是从地球看向月球" —— 所以给的是**两个角度**：
       *   · `devDeg`：地心→月心 与 地心→相机 的夹角。0 = 相机正站在这条视线上；
       *   · `distToEarth`：相机离地心多远（应 = EARTH_RADIUS × FOLLOW_EYE_LIFT = 3.848）。
       * 再加一个 `fov`：滚轮＝换镜头，判据要看它**会变**（同时也守住"机位不动"——
       *   变的是焦距、不是相机位置）。
       */
      eye: {
        on: followMoon,
        distToEarth: camera.position.distanceTo(ep),
        distToSurface: camera.position.distanceTo(ep) - EARTH_RADIUS,
        distToMoon: camera.position.distanceTo(p),
        devDeg: (() => {
          const a = eyeProbeA.copy(p).sub(ep).normalize();
          const b = eyeProbeB.copy(camera.position).sub(ep).normalize();
          const dot = Math.max(-1, Math.min(1, a.dot(b)));
          return (Math.acos(dot) * 180) / Math.PI;
        })(),
        fov: camera.fov,
        /** 这个模式下被藏起来的物体（太阳/轨道虚线/地月连线）数一数——判据要看它们真的没了 */
        hiddenCount: followMoon ? eyeHidden.filter((o) => !o.visible).length : 0,
        hiddenTotal: eyeHidden.length,
        /** 太阳此刻在不在渲染里（判据：进追月特写后必须 false） */
        sunVisible: orbitSun.visible,
        /** 月盘在画面上的像素半径（读 `camera.fov`，所以跟随模式下也是对的） */
        moonRadiusPx: diskOnScreen()?.radius ?? 0
      }
    };
  }

  /** 自检用的两个临时向量；**别跟引擎逐帧复用的暂存抢**（`tmpVec` 是 `updateLinkLine` 的） */
  const eyeProbeA = new THREE.Vector3();
  const eyeProbeB = new THREE.Vector3();

  /** 星空背景的自检读数：确认它真的是一张等距柱状贴图，而不是又回到了三维星点 */
  function starBackground() {
    const bg = scene.background as THREE.Texture | null;
    if (!bg) {
      return null;
    }
    const img = bg.image as HTMLCanvasElement | undefined;
    return {
      kind: "equirect-texture",
      width: img ? img.width : 0,
      height: img ? img.height : 0,
      mapping: bg.mapping
    };
  }

  function settle(frames = 6) {
    for (let i = 0; i < frames; i += 1) {
      syncFollow();
      syncTopView();
      controls.update();
    }
    updateMarkerScale();
    renderBoth();
    if (layerState.features) {
      layoutLabels();
    }
    layoutOrbitLabels();
  }

  return {
    /** 拨到某个**月龄**：内部换算成"离当前时刻最近的同相位天数" ⇒ 地球公转连续 */
    setAge(monthAge: number) {
      setPhase(monthAge);
    },
    /** 直接摆累计天数（自检专用，见 debug API 里的说明） */
    setDaysRaw(days: number) {
      setDays(days);
    },
    /** 当前月龄（0..朔望月）。UI 读数用；累计天数走 `orbitState().days` */
    age: () => currentAgePhase(),
    setLayers,
    setPlaying(on: boolean) {
      playing = on;
      lastTime = performance.now();
    },
    isPlaying: () => playing,
    setOnAge(cb: ((a: number) => void) | null) {
      onAge = cb;
    },
    setView,
    setViewMode,
    viewMode: () => viewMode,
    focusFeature,
    startFollowMoon,
    stopFollowMoon,
    following: () => followMoon,
    setSelected,
    hitSite,
    sitesOnScreen,
    orbitState,
    resize,
    stopLoop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
    startLoop() {
      if (!raf) {
        lastTime = performance.now();
        raf = requestAnimationFrame(animate);
      }
    },
    settle,
    samplePixels,
    samplePair,
    countBluish,
    measurePhase,
    measureMainMoon,
    probeFeatures,
    labelBoxes,
    cameraState: () => ({
      pos: [camera.position.x, camera.position.y, camera.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
      // `dist` 保留"到世界原点"，是给「月球特写」用的老口径；
      // 「日地月系统」里月球不在原点，量月盘要用的必须是 `moonDist`。
      dist: camera.position.length(),
      moonDist: camera.position.distanceTo(moonGroup.position)
    }),
    textureReady: () => textureReady,
    earthReady: () => earthTextureReady,
    starBackground,
    diskOnScreen,
    featureNames: () => MOON_FEATURES.map((f) => f.name),
    dispose() {
      cancelAnimationFrame(raf);
      controls.dispose();
      moonMesh.geometry.dispose();
      moonMat.dispose();
      earthMat.dispose();
      earthMesh.geometry.dispose();
      starTexture.dispose();
      fallbackTex.dispose();
      earthFallback.dispose();
      renderer.domElement.remove();
      phaseRenderer.domElement.remove();
      labelHost.remove();
      orbitLabelHost.remove();
      renderer.dispose();
      phaseRenderer.dispose();
    }
  };
}

// ---------------------------------------------------------------------------

interface PhaseWindowPos {
  x: number;
  y: number;
}

const PHASE_WINDOW_W = 178;

export default function MoonGlobe({ roster = [] }: { roster?: PlayerInfo[] }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const phaseHostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Engine | null>(null);

  const [age, setAge] = useState(DEFAULT_AGE);
  const [playing, setPlaying] = useState(false);
  const [layers, setLayers] = useState<LayerState>({ ...DEFAULT_LAYERS });
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [layersCollapsed, setLayersCollapsed] = useState(false);
  const [phaseCollapsed, setPhaseCollapsed] = useState(false);
  const [phasePos, setPhasePos] = useState<PhaseWindowPos>({ x: 236, y: 16 });
  /**
   * 视角模式。默认「日地月系统」—— 打开就能看到地球、太阳和月球在同一幅画面里，
   * 这是这个游戏最该被一眼看懂的一件事；「月球特写」是第二层，一点就到。
   */
  const [viewMode, setViewMode] = useState<ViewMode>("orbit");
  /**
   * 「追月特写」是否处于**持续跟随**中（v1.3.0 起它是个开关，按钮要显示选中态）。
   *
   * 引擎是真相源（`engine.following()`），这里只是给按钮用的镜像；
   * 任何"会重新取景"的动作都要把它同步回 false —— 引擎内部会自己退出跟随
   * （`setView`/`focusFeature` 里调了 `stopFollowMoon`），React 这一侧若忘了同步，
   * 症状就是"按钮显示着在跟随、实际没跟"。
   */
  const [following, setFollowing] = useState(false);
  /** 当前打开介绍的站点（null = 没有弹窗） */
  const [activeSite, setActiveSite] = useState<MoonFeature | null>(null);
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const activeSiteRef = useRef(activeSite);
  activeSiteRef.current = activeSite;

  /** 拖动小窗时要读「按下那一刻」的位置，用 ref 避免把监听器绑到每次 state 变化上 */
  const phasePosRef = useRef(phasePos);
  phasePosRef.current = phasePos;
  /**
   * 图层状态的镜像。自检钩子里合并 patch 时必须读**最新的**这份，而不是闭包里的那份：
   * 连做两次 `setLayers`（自动化测试常这么写）时，第二次若基于旧闭包合并，
   * 前一次改的位会被悄悄撤掉 —— 症状是"脚本说开了、界面没开"。
   */
  const layersRef = useRef(layers);
  layersRef.current = layers;

  const info = phaseInfo(age);

  // 引擎只建一次
  useEffect(() => {
    const host = hostRef.current;
    const phaseHost = phaseHostRef.current;
    if (!host || !phaseHost) {
      return undefined;
    }
    const engine = buildEngine(host, phaseHost);
    engineRef.current = engine;
    engine.setAge(DEFAULT_AGE);
    engine.setLayers(DEFAULT_LAYERS);
    engine.setViewMode(viewModeRef.current);
    // 自动推进时引擎每 ~70ms 回报一次月龄 —— 只更新 React 读数，
    // **不再回灌引擎**，否则会和引擎自己的推进互相打断（读数抖动）。
    engine.setOnAge((a) => setAge(a));

    const ro = new ResizeObserver(() => {
      engine.resize();
      engine.settle(2);
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // 用户操作 → 同时改 React 状态与引擎（自动推进只走引擎 → React 单向，不会打架）
  function applyAge(a: number) {
    const next = ((a % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
    setAge(next);
    engineRef.current?.setAge(next);
    engineRef.current?.settle(1);
  }

  function applyLayers(next: LayerState) {
    setLayers(next);
    engineRef.current?.setLayers(next);
    engineRef.current?.settle(1);
  }

  function toggleLayer(key: keyof LayerState) {
    const next = { ...layers, [key]: !layers[key] };
    if (key === "lighting" && layers.lighting) {
      // 全月面照亮时晨昏线不存在，顺手关掉，免得留下一圈悬空的黄线
      next.terminator = false;
    }
    applyLayers(next);
  }

  function togglePlaying() {
    const next = !playing;
    setPlaying(next);
    engineRef.current?.setPlaying(next);
  }

  /** 切视角模式：引擎负责整个场景的重排，React 只管按钮的选中态 */
  function applyViewMode(mode: ViewMode) {
    setViewMode(mode);
    // 切模式会重排整个场景并重新取景 ⇒ 追月跟随必须一起退出（引擎内部也会退，这里同步按钮态）
    setFollowing(false);
    engineRef.current?.setViewMode(mode);
    engineRef.current?.settle(8);
  }

  /**
   * 三个"固定机位"按钮（斜视全景 / 俯视黄道面 / 复位视角）的公共入口。
   *
   * 统一走这里是为了**只写一处**退出追月跟随的同步 —— 这类"引擎里退出了、
   * 按钮还亮着"的不一致，正是最容易漏掉的半截改动。
   */
  function pickView(kind: "near" | "north" | "south" | "top" | "tilt" | "reset") {
    setFollowing(false);
    engineRef.current?.setView(kind);
    engineRef.current?.settle(8);
  }

  /**
   * 「追月特写」开关。
   *
   * 两版演变：v1.3.0 把"一次性飞过去"改成**持续跟随**（旧写法 `setView` 家族都是
   * "把机位摆到某处就不管了"，月球一动就丢 —— 用户原话：「如果现在是在自动运动，
   * 那么就会闪一下就走了」）；v1.4.5 又把机位口径改成**从地球看月球**（用户原话：
   * 「应该是从地球看月球的这个特写，方向就是从地球看向月球」），见 `startFollowMoon`。
   * 按钮这一层没变：读引擎的真相源、只负责同步镜像。
   */
  function toggleFollowMoon() {
    const e = engineRef.current;
    if (!e) {
      return;
    }
    if (following) {
      e.stopFollowMoon();
      setFollowing(false);
    } else {
      e.startFollowMoon();
      e.settle(2);
      // 读引擎的真相源，不要"按了就当开着" —— `startFollowMoon` 在月球特写里是空操作
      setFollowing(!!e.following());
    }
  }

  /** 打开站点介绍。**同时把主镜头搬过去** —— 弹窗挡住的不只是画面，还有"它在月球的哪儿" */
  function openSite(f: MoonFeature) {
    setActiveSite(f);
    engineRef.current?.setSelected(f.name);
    // 点站点＝镜头要飞到那个站点正上方 ⇒ 引擎里会退出追月特写（`focusFeature` 里调的），
    // 按钮态必须跟着同步。⚠ v1.4.5 之前这两处漏了：那时它只影响按钮高亮（不容易瞧出来），
    // 现在 `following` 还决定底部提示条与右侧说明的文案 ⇒ 不同步就是"提示说在追月、
    // 镜头其实已经飞到站点头上"。
    setFollowing(false);
    engineRef.current?.focusFeature(f);
    engineRef.current?.settle(8);
  }

  function closeSite() {
    setActiveSite(null);
    engineRef.current?.setSelected(null);
  }

  /**
   * 「去三维视图看看」。
   *
   * ⚠ 这里**必须**顺手把弹窗关掉。弹窗是带遮罩的全屏模态，三维视图在它后面 ——
   *   只搬镜头而不关窗，用户按了按钮会觉得"什么也没发生"（实测：判据 L14 全绿、
   *   而 L15 红 —— 镜头确实飞过去了，可人根本看不见）。
   */
  function locateSite(f: MoonFeature) {
    setActiveSite(null);
    engineRef.current?.setSelected(f.name);
    // 同上：又要搬镜头了，追月特写会退出，按钮态一起同步
    setFollowing(false);
    engineRef.current?.focusFeature(f);
    engineRef.current?.settle(8);
  }

  // 点击月面记号 → 弹出介绍
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }
    let downX = 0;
    let downY = 0;
    let downT = 0;
    let armed = false;

    function onDown(e: PointerEvent) {
      if (e.button !== 0) {
        return;
      }
      armed = true;
      downX = e.clientX;
      downY = e.clientY;
      downT = performance.now();
    }

    function onUp(e: PointerEvent) {
      if (!armed) {
        return;
      }
      armed = false;
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      // 与"拖动旋转"区分开：真要转月球，指针一定会走远。
      // 位移 ≤5px 且按下不超过 400ms 才算点击，否则拖一下就被误判成点了某个记号。
      if (moved > 5 || performance.now() - downT > 400) {
        return;
      }
      const rect = host!.getBoundingClientRect();
      const hit = engineRef.current?.hitSite(e.clientX - rect.left, e.clientY - rect.top);
      if (!hit) {
        return;
      }
      const f = MOON_FEATURES.find((x) => x.name === hit.name);
      if (f) {
        openSite(f);
      }
    }

    host.addEventListener("pointerdown", onDown);
    // ⚠ `pointerup` 挂在 window 上，不是挂在画布上。
    //   Electron 的 `sendInputEvent` 合成指针时 `setPointerCapture` 不生效，
    //   pointerup 会投给"光标底下的那个元素"，挂在画布上就收不到（真机回归里
    //   表现为"点了没反应"）。挂 window 靠冒泡兜住，合成事件也一样收得到。
    window.addEventListener("pointerup", onUp);
    return () => {
      host.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 拖动月相小窗
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return undefined;
    }
    const header = stage.querySelector<HTMLElement>(".phase-head");
    if (!header) {
      return undefined;
    }
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let base: PhaseWindowPos = { x: 0, y: 0 };

    function onMove(e: PointerEvent) {
      if (!dragging) {
        return;
      }
      const stageRect = stage!.getBoundingClientRect();
      const nx = base.x + (e.clientX - startX);
      const ny = base.y + (e.clientY - startY);
      setPhasePos({
        x: Math.max(4, Math.min(stageRect.width - PHASE_WINDOW_W - 4, nx)),
        y: Math.max(4, Math.min(stageRect.height - 40, ny))
      });
    }
    function onUp() {
      dragging = false;
      header!.classList.remove("is-dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    function onDown(e: PointerEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("button")) {
        return;
      }
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      base = phasePosRef.current;
      header!.classList.add("is-dragging");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      e.preventDefault();
    }
    header.addEventListener("pointerdown", onDown);
    return () => {
      header.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  // ---- 自检 API（供真机渲染回归使用）----
  useEffect(() => {
    const api = {
      version: "1.4.5",
      phaseInfo: (a?: number) => phaseInfo(a === undefined ? engineRef.current?.age() ?? 0 : a),
      age: () => engineRef.current?.age() ?? 0,
      setAge: (a: number) => applyAge(a),
      setAgeEngine: (a: number) => engineRef.current?.setAge(a),
      /**
       * 直接摆**累计天数**（不走 `nearestPhaseDays`）。
       *
       * 为什么需要它：v1.4.0 起"哪一天"决定了两件与画面有关的事 ——
       *   ① 地球在轨道上的位置（相机看到的可能是白天，也可能是黑夜）；
       *   ② 地球自转角。
       * 判据要能**精确**摆到"相机正好看到地球白天"的那一刻，否则一条"地球是亮的"
       * 的判据会随之前跑过的用例漂到黑夜里去（实测就是这么红的，不是引擎的问题）。
       */
      setDaysRaw: (d: number) => engineRef.current?.setDaysRaw(d),
      setLayers: (patch: Partial<LayerState>) => applyLayers({ ...layersRef.current, ...patch }),
      layers: () => ({ ...layersRef.current }),
      setPlaying: (on: boolean) => {
        setPlaying(on);
        engineRef.current?.setPlaying(on);
      },
      playing: () => !!engineRef.current?.isPlaying(),
      setView: (k: "near" | "north" | "south" | "top" | "tilt" | "reset") => {
        setFollowing(false);
        engineRef.current?.setView(k);
        engineRef.current?.settle(8);
      },
      /**
       * v1.3.0 起就有、**v1.4.5 换了含义**：追月特写＝「从地球看月球」（相机钉在地球上）。
       * 三个入口都给出来：
       * 判据要能"开 → 推进时间 → 量月球是否还在画面中心、相机是否还在地球上 → 关"，
       * 还要能读引擎的真实状态（`following()` 是真相源；React 侧那个 state 只是按钮的镜像）。
       */
      setFollowMoon: (on: boolean) => {
        const e = engineRef.current;
        if (!e) {
          return false;
        }
        if (on) {
          e.startFollowMoon();
        } else {
          e.stopFollowMoon();
        }
        setFollowing(on);
        e.settle(2);
        return true;
      },
      following: () => !!engineRef.current?.following(),
      setViewMode: (m: ViewMode) => applyViewMode(m),
      viewMode: () => viewModeRef.current,
      orbitState: () => engineRef.current?.orbitState() ?? null,
      sitesOnScreen: () => engineRef.current?.sitesOnScreen() ?? [],
      hitSite: (x: number, y: number, maxPx?: number) =>
        engineRef.current?.hitSite(x, y, maxPx ?? 18) ?? null,
      openSite: (name: string) => {
        const f = MOON_FEATURES.find((x) => x.name === name);
        if (f) {
          openSite(f);
        }
        return !!f;
      },
      closeSite: () => closeSite(),
      activeSite: () => activeSiteRef.current?.name ?? null,
      featureNames: () => engineRef.current?.featureNames() ?? [],
      settle: (n?: number) => engineRef.current?.settle(n ?? 8),
      stopLoop: () => engineRef.current?.stopLoop(),
      startLoop: () => engineRef.current?.startLoop(),
      samplePixels: (pts: { x: number; y: number }[]) =>
        engineRef.current?.samplePixels(pts) ?? [],
      samplePair: (pts: { x: number; y: number }[]) => engineRef.current?.samplePair(pts) ?? [],
      countBluish: () => engineRef.current?.countBluish() ?? 0,
      measurePhase: () => engineRef.current?.measurePhase() ?? null,
      measureMainMoon: () => engineRef.current?.measureMainMoon() ?? null,
      textureReady: () => !!engineRef.current?.textureReady(),
      earthReady: () => !!engineRef.current?.earthReady(),
      starBackground: () => engineRef.current?.starBackground() ?? null,
      probeFeatures: () => engineRef.current?.probeFeatures() ?? [],
      labelBoxes: () => engineRef.current?.labelBoxes() ?? [],
      cameraState: () => engineRef.current?.cameraState() ?? null,
      diskOnScreen: () => engineRef.current?.diskOnScreen() ?? null,
      openPhaseWindow: () => setPhaseCollapsed(false),
      collapsePhaseWindow: () => setPhaseCollapsed(true),
      phaseWindowPos: () => ({ ...phasePosRef.current })
    };
    (window as unknown as Record<string, unknown>).__moonDebug = api;
    return () => {
      delete (window as unknown as Record<string, unknown>).__moonDebug;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const layerDefs: { key: keyof LayerState; label: string; group: string; chip: string }[] = [
    { key: "lighting", label: "昼夜明暗", group: "光照", chip: "#ffd34d" },
    { key: "terminator", label: "晨昏线", group: "光照", chip: "#ffb020" },
    { key: "grid", label: "月面经纬网", group: "线网", chip: "#5fd8ff" },
    { key: "features", label: "月面地名", group: "标注", chip: "#ff6b3d" },
    { key: "sunMarker", label: "太阳方向", group: "标注", chip: "#ff8c3a" },
    { key: "earthDir", label: "地月方向", group: "标注", chip: "#7fb2e5" },
    { key: "stars", label: "星空背景", group: "背景", chip: "#f2e8d5" }
  ];

  const groups = ["光照", "线网", "标注", "背景"];

  /** 「太阳方向」「地月方向」两个箭头只在月球特写里存在，系统视角里禁用掉并说明原因 */
  const moonOnlyLayers: (keyof LayerState)[] = ["sunMarker", "earthDir"];
  const isOrbit = viewMode === "orbit";

  const landformFeatures = MOON_FEATURES.filter((f) => !isLandingSite(f));
  const landingFeatures = MOON_FEATURES.filter(isLandingSite);

  return (
    <div className="moon-app">
      <div className="moon-stage" ref={stageRef}>
        <div className="moon-canvas" ref={hostRef} />

        {/* ---------- 左栏：演示台（改状态）---------- */}
        <aside className={`moon-rail${railCollapsed ? " is-collapsed" : ""}`}>
          <button
            className="panel-toggle"
            onClick={() => setRailCollapsed((v) => !v)}
            title={railCollapsed ? "展开演示台" : "收起演示台"}
          >
            {railCollapsed ? "演示台" : "—"}
          </button>

          {!railCollapsed && (
            <>
              <section>
                <h2>时间与月相</h2>
                <div className="moon-age-card">
                  <div className="moon-age-row">
                    <span className="moon-age-name">{info.name}</span>
                    <span className="moon-age-num">
                      {info.age.toFixed(2)}
                      <small>天</small>
                    </span>
                  </div>
                  <input
                    className="moon-range"
                    type="range"
                    min={0}
                    max={SYNODIC_MONTH}
                    step={0.01}
                    value={info.age}
                    aria-label="月龄（天）"
                    onChange={(e) => applyAge(Number(e.target.value))}
                  />
                  <div className="moon-range-ticks">
                    {KEY_PHASES.map((p) => (
                      <button
                        key={p.short}
                        className={Math.abs(info.age - p.age) < 0.05 ? "is-on" : ""}
                        onClick={() => applyAge(p.age)}
                      >
                        {p.short}
                      </button>
                    ))}
                  </div>
                  <p className="moon-hint">
                    拖动滑杆＝把时间拨到某一天。月球被地球潮汐锁定，
                    <b>近地面永远朝着地球</b>，所以变的是太阳照过来的方向 ——
                    晨昏线就是这样一天天扫过整个月面的。
                  </p>
                </div>
                <button className={`spin-btn${playing ? " is-on" : ""}`} onClick={togglePlaying}>
                  {playing ? "暂停时间" : "自动推进时间"}
                </button>
              </section>

              <section>
                <h2>视角</h2>
                <div className="mode-switch" role="group" aria-label="视角模式">
                  <button
                    className={!isOrbit ? "is-on" : ""}
                    aria-pressed={!isOrbit}
                    onClick={() => applyViewMode("moon")}
                  >
                    月球特写
                  </button>
                  <button
                    className={isOrbit ? "is-on" : ""}
                    aria-pressed={isOrbit}
                    onClick={() => applyViewMode("orbit")}
                  >
                    日地月系统
                  </button>
                </div>
                <div className="view-actions">
                  {isOrbit ? (
                    <>
                      <button onClick={() => pickView("tilt")}>斜视全景</button>
                      <button onClick={() => pickView("top")}>俯视黄道面</button>
                      <button onClick={() => pickView("reset")}>复位视角</button>
                      <button
                        className={following ? "is-on" : ""}
                        aria-pressed={following}
                        title="从地球看月球：镜头钉在地球表面、始终朝着月球"
                        onClick={toggleFollowMoon}
                      >
                        追月特写
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => pickView("near")}>正对地球</button>
                      <button onClick={() => pickView("north")}>俯视北极</button>
                      <button onClick={() => pickView("south")}>俯视南极</button>
                      <button
                        onClick={() => {
                          engineRef.current?.setAge(info.age);
                          pickView("near");
                        }}
                      >
                        复位视角
                      </button>
                    </>
                  )}
                </div>
                {isOrbit ? (
                  <p className="teach-note">
                    <b>太阳在中心</b>：地球绕着太阳公转（一年一圈，拖一个月地球走 29°），
                    月球绕着地球转、还永远以同一面朝着地球；地球也在<b>自转</b>，
                    按<b>真实速度</b>：一天（24 小时）恰好转一圈。
                    <br />
                    所以一个朔望月里，地球自转了 29.5 圈 —— 也就是 29.5 个昼夜。
                    自动推进时一个月只有 11 秒，看着转得飞快，比例是对的。
                    <br />
                    拖动滑杆让月球走一圈，看它离太阳远近怎样决定我们是看见<b>满月还是新月</b>
                    —— 被太阳照亮的那半边，就是站在地球上看到的样子。
                    <br />
                    这个视角把地球的<b>整条公转轨道</b>都装进了画面 —— 地球会沿着虚线真的
                    走完一整圈（约 2.2 分钟），所以天体看着比前一版小。
                    <br />
                    按<b>追月特写</b>＝站到<b>地球上看月亮</b>：镜头钉在地球上、始终朝着月球，
                    无论时间在自动推进还是你拖滑杆，月亮都留在画面正中；看到的月相与右上角
                    <b>月相小窗</b>完全一致。站在地球上时画面里没有太阳（就像抬头看月亮），
                    <b>滚轮＝换镜头</b>可以拉近拉远，再按一次退出。
                    <br />
                    想看月面细节（环形山、月海、着陆点），切到<b>月球特写</b>。
                  </p>
                ) : (
                  <p className="teach-note">
                    按住<b>左键拖动</b>可绕月球任意旋转，滚轮（或双指）缩放。
                    转到<b>背面</b>就能看到月球永远不朝地球的那一面。
                    点击月面上的<b>彩色圆点</b>可以查看该地点的介绍。
                  </p>
                )}
                <p className="moon-hint">
                  {following && isOrbit
                    ? `站在地球上抬头看月亮：镜头钉在地球表面、始终朝着月球，所以画面里只有月亮和星空
                      —— 太阳看着只有 0.5° 宽，本来也装不进这一幅特写。这个模式下视角是钉住的
                      （拖动不改变机位），滚轮＝换镜头。`
                    : isOrbit
                      ? `天体大小按真实比例 —— 地球直径是月球的 ${(
                          ORBIT_SCENE.earthR / ORBIT_SCENE.moonR
                        ).toFixed(1)} 倍。但距离压缩了约 ${Math.round(
                          ORBIT_COMPRESSION.moonDist
                        )} 倍、地球公转的轨道压了约 ${Math.round(
                          ORBIT_COMPRESSION.sunDist
                        )} 倍，太阳也画小了（真实直径是地球的 109 倍，这里画成 ${(
                          ORBIT_SCENE.sunR / ORBIT_SCENE.earthR
                        ).toFixed(1)} 倍）：真按比例画，三个天体没法出现在同一幅图里。
                      自转按真实的恒星日算：一天（24 小时）转 366.25/365.25 圈 —— 多出来的那一点，
                      就是恒星日 23 时 56 分与太阳日 24 小时的差。`
                      : "月球特写里，月球钉在中央不动，变的是太阳照过来的方向。"}
                </p>
              </section>
            </>
          )}
        </aside>

        {/* ---------- 右栏：控制台（只读数据）---------- */}
        <aside className={`moon-panel${panelCollapsed ? " is-collapsed" : ""}`}>
          <button
            className="panel-toggle"
            onClick={() => setPanelCollapsed((v) => !v)}
            title={panelCollapsed ? "展开控制台" : "收起控制台"}
          >
            {panelCollapsed ? "控制台" : "—"}
          </button>

          {!panelCollapsed && (
            <>
              <section>
                <h2>当前月相</h2>
                <div className="coord-card">
                  <div className="coord-row">{info.name}</div>
                  <div className="coord-decimal">
                    约当农历{info.lunarDay === 1 ? "初一" : `第${info.lunarDay}天`} ·{" "}
                    {info.waxing ? "盈（亮面在右）" : "亏（亮面在左）"}
                  </div>
                  <div className="coord-time">
                    受照比例 <strong>{info.illuminationPct.toFixed(1)}%</strong>
                  </div>
                  <div className="coord-meta">{info.note}</div>
                </div>
                <div className="readout-row">
                  <span>月龄</span>
                  <strong>{info.age.toFixed(2)} 天</strong>
                </div>
                <div className="readout-row">
                  <span>相位角（日—月—地）</span>
                  <strong>{info.phaseAngle.toFixed(1)}°</strong>
                </div>
                <div className="readout-row">
                  <span>日月角距</span>
                  <strong>{info.elongation.toFixed(1)}°</strong>
                </div>
                <div className="readout-row">
                  <span>太阳直射点经度</span>
                  <strong>
                    {Math.abs(info.subsolarLon).toFixed(1)}°{info.subsolarLon >= 0 ? "E" : "W"}
                  </strong>
                </div>
                <p className="moon-hint">
                  相位角 0° 时太阳在观测者背后（满月），180° 时太阳在月球背后（新月）；
                  受照比例＝(1+cos 相位角)/2。
                </p>
              </section>

              <section>
                <h2>月相成因</h2>
                <PhaseDiagram age={info.age} />
                <p className="teach-note">
                  月球不发光，任何时刻只有<b>朝太阳的那一半</b>是亮的。
                  它绕地球跑一圈（一个朔望月 ≈ 29.53 天），亮面相对我们的角度就变了 ——
                  这就是月相。
                </p>
              </section>

              <section>
                <h2>月面与中国探月</h2>
                <p className="moon-hint">
                  点任意一行（或点月面上的彩色圆点）可以查看介绍和关键数据。
                </p>
                <h3 className="site-sub">中国探月着陆点</h3>
                <ul className="feature-list is-clickable">
                  {landingFeatures.map((f) => (
                    <li key={f.name}>
                      <button
                        className={`feature-btn${activeSite?.name === f.name ? " is-active" : ""}`}
                        onClick={() => openSite(f)}
                      >
                        <i style={{ background: FEATURE_COLORS[f.kind] }} />
                        <span className="feature-name">{f.name}</span>
                        <span className="feature-en">
                          {f.en}
                          {f.far ? " · 背面" : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <h3 className="site-sub">月面地形</h3>
                <ul className="feature-list is-clickable">
                  {landformFeatures.map((f) => (
                    <li key={f.name}>
                      <button
                        className={`feature-btn${activeSite?.name === f.name ? " is-active" : ""}`}
                        onClick={() => openSite(f)}
                      >
                        <i style={{ background: FEATURE_COLORS[f.kind] }} />
                        <span className="feature-name">{f.name}</span>
                        <span className="feature-en">
                          {f.en}
                          {f.far ? " · 背面" : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="moon-hint">
                  嫦娥七号计划 2026 年下半年发射，目标是月球南极 —— 它还没着陆，
                  所以月面上暂时没有它的点。
                </p>
              </section>

              {roster.length > 0 && (
                <section>
                  <h2>观摩学生</h2>
                  <p className="roster-names">
                    {roster.map((p) => p.studentName || `学生${p.studentId}`).join("、")}
                  </p>
                </section>
              )}
            </>
          )}
        </aside>

        {/* ---------- 独立月相小窗 ---------- */}
        <section
          className={`phase-window${phaseCollapsed ? " is-collapsed" : ""}`}
          style={{ left: `${phasePos.x}px`, top: `${phasePos.y}px`, width: `${PHASE_WINDOW_W}px` }}
          aria-label="月相小窗"
        >
          <header className="phase-head" title="按住拖动可以移动这个小窗">
            <span className="phase-title">月相小窗</span>
            <button
              className="phase-min"
              onClick={() => setPhaseCollapsed((v) => !v)}
              title={phaseCollapsed ? "展开" : "收起"}
            >
              {phaseCollapsed ? "▸" : "▾"}
            </button>
          </header>
          {!phaseCollapsed && (
            <div className="phase-body">
              <p className="phase-sub">从地球上看到的月相</p>
              <div className="phase-canvas" ref={phaseHostRef} />
              <div className="phase-readout">
                <span className="phase-name">{info.name}</span>
                <span className="phase-pct">{info.illuminationPct.toFixed(1)}%</span>
              </div>
              <div className="phase-foot">
                月龄 {info.age.toFixed(2)} 天 · 亮面在{info.side === "right" ? "右" : "左"}
              </div>
            </div>
          )}
        </section>

        <div className="moon-tip">
          {following && isOrbit
            ? "站在地球上看月亮 · 滚轮＝换镜头（拉近拉远）· 拖动不改变机位 · 再按一次「追月特写」退出"
            : isOrbit
              ? "拖动旋转 · 滚轮缩放 · 拖左栏滑杆让月球绕地球转一圈 · 点彩点看介绍"
              : "拖动旋转 · 滚轮缩放 · 点月面彩点看该地点的介绍 · 右上小窗实时显示当月月相"}
        </div>
      </div>

      {/* ---------- 底部图层栏 ---------- */}
      <div className="moon-layers">
        <div className="layers-head">
          <span className="layers-title">图层</span>
          <span className="hint-text">
            {isOrbit
              ? "系统视角里太阳在中心，地球自转并绕太阳公转；两个方向指示器只在「月球特写」里有意义"
              : "月面影像始终显示；「昼夜明暗」关掉即整球受光，便于看清环形山与月海"}
          </span>
          <button className="layers-toggle" onClick={() => setLayersCollapsed((v) => !v)}>
            {layersCollapsed ? "图层＋" : "图层－"}
          </button>
        </div>
        {!layersCollapsed && (
          <div className="layers-body">
            {groups.map((g) => (
              <div className="layer-col" key={g}>
                <div className="layer-group-title">{g}</div>
                <ul className="layer-list">
                  {layerDefs
                    .filter((d) => d.group === g)
                    .map((d) => {
                      const noLight = d.key === "terminator" && !layers.lighting;
                      const moonOnly = isOrbit && moonOnlyLayers.includes(d.key);
                      const disabled = noLight || moonOnly;
                      return (
                        <li key={d.key} className={disabled ? "is-disabled" : ""}>
                          <label>
                            <input
                              type="checkbox"
                              checked={layers[d.key]}
                              disabled={disabled}
                              onChange={() => toggleLayer(d.key)}
                            />
                            <span className="layer-chip" style={{ background: d.chip }} />
                            <span className="layer-label">{d.label}</span>
                          </label>
                          {noLight && (
                            <span className="layer-disabled-note">
                              已全月面照亮，晨昏线不存在
                            </span>
                          )}
                          {moonOnly && (
                            <span className="layer-disabled-note">
                              系统视角用真实天体，不需要方向箭头
                            </span>
                          )}
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {activeSite && (
        <SiteDialog feature={activeSite} onClose={closeSite} onLocate={locateSite} />
      )}
    </div>
  );
}

export { phaseName };
