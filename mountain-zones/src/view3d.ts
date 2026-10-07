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
import { INK, PAPER, PART_COLORS, type PartAnnotation } from "./panels";
import type { ContourLabelAnchor, ContourLabelCandidate } from "./contour";
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
   * 三维沙盘上的**计曲线高程注记**（v2.5.4）。
   *
   * `null` = 整层收掉（开关关了，或等高线自己关了）。传进来的落点已经是
   * 网格坐标 + 当前海拔口径（engine 的 `majorLabelAnchors` 算的），
   * 这里只负责换成世界坐标、配一张数字贴图。
   */
  setContourLabels(entries: ContourLabelCandidate[] | null): ContourLabelAnchor[];
  /**
   * **屏幕上真的有**的那几条注记落点（网格坐标）。
   *
   * 与 `setContourLabels` 的返回值区别在于"什么时候读"：返回值是"这一次
   * 调用的结果"，而选址会在 `tick` 里因取景 / 画布比例变化被**再跑一次**
   * ⇒ 调用方必须现读，不能把返回值存起来当真相（理由见 `placedAnchors`）。
   */
  getContourLabels(): ContourLabelAnchor[];
  /**
   * 三维沙盘上的**高程切面 + 高度尺**（v2.5.5）。
   *
   * 传 `null` = 整层收掉（开关关了，或等高线自己关了）。传进来的层高程
   * 已经由 `contour.majorLevels` 筛好并排好序（**从高到低**），这里只负责
   * 按下标铺板子、在图幅右前角立一根带刻度的竖直尺。
   */
  setElevationSlices(levels: number[] | null): void;
  /**
   * **真的铺出来**的那几层高程（从高到低，现读）。
   *
   * 与 `getContourLabels` 同一个纪律：别把 `setElevationSlices` 的返回值
   * 存起来 —— `field` 还没就绪时它会静默不建层，缓存下来的那份副本
   * 会让快照报 N 层而画面是空的（v2.5.4 踩过同型的坑）。
   */
  getElevationSlices(): number[];
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

  /* ---------- 三维高程注记层（v2.5.4） ---------- */
  /**
   * 计曲线的高程数字，画成**贴在地表上立起来**的 billboard（`THREE.Sprite`）。
   *
   * ## 为什么用 Sprite 而不是"贴地文字"
   *
   * 两条路都试过账：
   *  ① 贴地平面（法线朝上、沿地表切平面摆）最像地图，但相机俯仰只有 24°，
   *     字被压成原来的 40% 高 —— 学生得把相机转到接近垂直才读得出来，等于没标。
   *  ② DOM 覆盖层字最清晰、还能直接吃 `--fs-*`，但**没法被地形遮挡**，
   *     山背后的数字会穿过山体浮在前面，比不标还乱（还有每帧同步的开销）。
   *  Sprite 让 GPU 逐像素做遮挡，转视角不用维护任何屏幕状态 —— 代价是文字要走贴图。
   *
   * ## 为什么 `sizeAttenuation: false`
   *
   * 开着的话注记的世界尺寸固定，相机一推远就缩成麻点。关掉之后缩放被抵消，
   * 注记**恒定占视口高度的 `LABEL_VIEW_H`**，与相机距离、与 DPR 都无关
   * （公式见下面 `labelScaleY` 的推导）—— 于是"多大才读得清"变成一个可复算的常数，
   * 不用靠试。
   */
  const labelGroup = new THREE.Group();
  labelGroup.name = "contour-labels";
  scene.add(labelGroup);
  /** 注记贴图里的字号（像素）。贴图按这个尺寸画，再缩到屏幕，所以取大一点不糊 */
  const LABEL_EM_PX = 62;
  /** 内边距（贴图像素）。纸垫太小会显得数字贴着墨框，太大又把数字挤小 */
  const LABEL_PAD_PX = 11;
  /**
   * 两块纸垫之间的最小间距，单位是"自身尺寸的倍数"（推导见 `setContourLabels`）。
   * 1.0 = 刚好贴边不重叠，取 1.15 留一点呼吸，免得两个数字挨得像一个数。
   */
  const LABEL_MIN_SEP = 1.15;
  /**
   * 注记（含纸垫）占**舞台高度**的比例。
   *
   * 0.052 ⇒ 555px 高的舞台上纸垫约 29px、里面的数字约 20px
   * （贴图里数字占 `62/(62+22) = 0.74`，与 `--fs-lg`(17px) 同档，投影仪后排也读得清）。
   * 第一版取的 0.04 ⇒ 数字只有 15px，比全站最小的 `--fs-2xs`(11.5px) 大不了多少，
   * 而它是**要"读"的数字**，不是页脚。
   */
  const LABEL_VIEW_H = 0.052;
  /** 每个注记各自的贴图，重建时逐个 `dispose` */
  let labelTextures: THREE.CanvasTexture[] = [];
  /** 最近一次的注记数据 —— 纵向夸张改了要用同一份数据重算 Y（见 `refresh` 末尾） */
  let lastLabels: ContourLabelCandidate[] | null = null;
  /**
   * "取景变了，选址要重做"的一次性标记（由 `frameAssembly` / `resize` 置位，
   * `tick` 消费）。**不能就地重算** —— 见 `tick` 里那段注释。
   */
  let labelsDirty = false;
  /**
   * 最近几次选址"当时看到的相机 / 画布"留痕（只给调试钩子用，最多留 6 条）。
   *
   * 存在的理由：选址结果**依赖相机**，而"同一次交互里前后两次选址给出不同条数"
   * 这种 bug 光看最终快照是查不出来的（两次快照的相机位姿一模一样，因为都是
   * 稳定之后读的）。必须能看到**选址那一刻**相机在哪、画布多大。
   */
  const labelLayoutLog: Array<Record<string, unknown>> = [];
  /**
   * **屏幕上当前真的有**的那几条注记落点（网格坐标）。
   *
   * 这是注记的唯一真相源：`engine` 不再自己存一份 `setContourLabels` 的返回值，
   * 而是在 `snapshot()` 时现读这里。
   *
   * 为什么必须现读：选址会在 `tick` 里被**再跑一次**（取景/画布比例变化后），
   * 而 `engine` 那次同步调用拿到的返回值马上就过期了 —— 存下来的话，
   * 快照报 4 条、画面上是 3 条，回归判据跟着一起骗人（v2.5.4 实测）。
   */
  let placedAnchors: ContourLabelAnchor[] = [];

  /* ---------- 高程切面层 + 高度尺（v2.5.5） ---------- */
  /**
   * 每条**计曲线**所在高度铺一块半透明的水平面，铺满整个图幅；
   * 图幅外的角上再立一根竖直的**高度尺**，按每层高程刻一道线 + 一个数字。
   *
   * ## 两个 Group 为什么要分开
   *
   * 切面与高度尺是同一件事的两半（一个给"面"、一个给"读数"），但取证要能
   * 分别数出"铺了几块板子"和"尺子上有几道刻度"—— 合在一起就分不清
   * 「尺子建好了、板子一块没铺」这种半成功状态。
   *
   * ## 为什么不用"逐顶点裁掉地形以下的部分"
   *
   * 想过：按 `sampleGrid` 把平面细分成网格、把低于地表的部分丢掉，只留露出来的环。
   * 放弃的原因是**半透明面本来就该盖在地形上**：学生要看的正是
   * "板子插进山里、从坡面上穿出来"这个关系；裁掉之后反而看不清板子有多深。
   * 遮挡交给 `depthTest` 就够了（见 `setElevationSlices` 里那段）。
   */
  /** 切面的填充色 —— 与纸垫、图纸同一种米色，构成"纸片插在山里"的观感 */
  const SLICE_FILL = PAPER;
  /** 切面的边框色（墨色）。没有轮廓的话，半透明面在图幅边缘会融进地形里 */
  const SLICE_EDGE = INK;
  /**
   * 填充的不透明度。
   *
   * 第一版给的 0.16，真机截图一看**只剩一圈线框**：地形是中间调的绿色，
   * 16% 的米色压上去只有 20 出头的通道差，肉眼几乎分不出"有面"和"没面"，
   * 而"面"正是这个功能要说的事（「等高线 = 水平面与地表的交线」）。
   * 提到 0.28 之后板子才立得起来。
   *
   * ⚠ 单层不能给太大：几层在屏幕空间里**必然是叠着的**（俯角只有 24°，
   * 一块 20 km 见方的水平面投影出来的纵向跨度 ≈ 20·sin24° ≈ 8 km，
   * 而层间距只有 1 km），叠加按 `1-(1-a)^n` 累积 —— 0.28 下 4 层重叠 ≈ 0.73，
   * 已经接近"糊成一片"的上限了。
   */
  const SLICE_OPACITY = 0.28;
  /** 切面层的渲染次序（透明队列）：填面在底、轮廓居中、尺子数字在注记之下 */
  const SLICE_ORDER = 1;
  /**
   * 高度尺数字占**舞台高度**的比例。比注记的 `LABEL_VIEW_H`(0.052) 小一档 ——
   * 它是尺子上的刻度读数，不该跟山上的高程注记抢视线。
   *
   * ⚠ 这个值被**下面那件事**卡着，不能凭好看调：两个相邻刻度在屏幕上的间距
   * 完全由「层间距 ÷ 跨度 × 纵轴夸张」决定，与字号无关。模板山地（20 km 跨度、
   * 夸张 ×1、层间距 1000 m）实测最挤的一对只摊到 **15.2 px**（杆全长才 47 px），
   * 而 0.034 的数字垫高 18.9 px ⇒ 四个数字垫**叠在一起**（真机截图里连成一整条）。
   *
   * 0.028（≈15.5 px）只差 0.3 px 就能塞下 —— 说明**再压字号已经无处可压**了。
   * 真正的解法是**把纸垫变薄**（见 `RULER_PAD_PX`）：垫子从 11 px 收到 4 px 后，
   * 同样 13.6 px 的外框里，字号反而从 11.0 px 涨到 11.8 px。
   * 回归里有一条 `rulerBoxes` 的两两不重叠判据守着这个上限。
   */
  const RULER_VIEW_H = 0.0245;
  /** 高度尺数字贴图的字号（像素），同样按大尺寸画再缩到屏幕 */
  const RULER_EM_PX = 54;
  /**
   * 高度尺数字的**纸垫厚度**（贴图像素）。比注记的 `LABEL_PAD_PX`(11) 薄得多 ——
   * 厚垫是为"在等高线上压出可读的背景"准备的，而尺子立在**图幅外的天空**上，
   * 背后本来就没有东西要挡。薄垫同时换来两件好事：外框能塞进 15.2 px 的层间距、
   * 字号在外框里的占比从 71% 涨到 87%（数字更大）。
   */
  const RULER_PAD_PX = 4;
  /** 高度尺离图幅边缘的距离（占跨度比例）。太大撑出取景框，太小会压到裙边 */
  const RULER_OUT = 0.04;
  /** 刻度线长度（占跨度比例） */
  const RULER_TICK = 0.02;

  const sliceGroup = new THREE.Group();
  sliceGroup.name = "elevation-slices";
  scene.add(sliceGroup);
  const rulerGroup = new THREE.Group();
  rulerGroup.name = "height-ruler";
  scene.add(rulerGroup);
  /** 切面层用到的可释放资源，分三类收着，重建时一起 `dispose` */
  const sliceTextures: THREE.Texture[] = [];
  const sliceGeometries: THREE.BufferGeometry[] = [];
  const sliceMaterials: THREE.Material[] = [];
  /**
   * 切面边框与高度尺用 `LineMaterial` 画的那些线 —— `resize` 时要同步 resolution。
   *
   * ⚠ 单独一个数组，**不能并进 `annotMaterials`**：那个数组在
   * `clearAnnotations()` 里会被清空（那是"部位标注层"的账本），
   * 并进去的话，点一次部位按钮就把切面线条从"分辨率同步名单"里除名，
   * 之后换窗口大小线宽就再也不更新了。
   */
  const sliceLineMaterials: LineMaterial[] = [];
  /** 最近一次收到的切面高程（`null` = 这一层整个关着）。改夸张时用同一份重铺 */
  let lastSlices: number[] | null = null;
  /** 真的铺出来的那几层（给 `getElevationSlices` 现读，engine 不留副本） */
  let placedSlices: number[] = [];
  /** 高度尺上刻了几道（= 几层切面），供调试钩子报数 */
  let rulerTicks = 0;
  /**
   * 高度尺杆的两个端点（世界坐标，杆底 / 杆顶），`null` = 这层没建。
   *
   * 留着它是为了调试钩子能把它投影到屏幕上 —— "尺子真的在画面右边"这件事
   * 光靠对象数（`rulerTicks`）证明不了：对象建好了却立在山背后同样是失败。
   */
  let rulerFoot: THREE.Vector3 | null = null;
  let rulerHead: THREE.Vector3 | null = null;

  /**
   * 某个屏幕高度比例 → Sprite 的 scale.y。
   *
   * Sprite 顶点着色器在 `sizeAttenuation: false` 时把 `scale` 乘上 `-mvPosition.z`，
   * 于是投影后的 NDC 高度 = `scale.y * (1 / tan(fov/2))`，与距离无关。
   * NDC 的 2.0 对应整屏高 ⇒ 想占 `h` 比例：`scale.y = 2 * h * tan(fov/2)`。
   * x 按贴图宽高比给（`scale.y * canvasW / canvasH`），数字才不会被拉扁。
   * `FOV_DEG` 从 `layout.ts` 来 —— 相机改视角时这里自动跟着走。
   *
   * 注记与高度尺数字共用它：**同一套"屏幕字号恒定"的机制**，
   * 各写一遍的话，改 FOV 时必然漏一处。
   */
  function viewScaleY(viewH: number): number {
    return 2 * viewH * Math.tan((FOV_DEG * Math.PI) / 180 / 2);
  }

  function labelScaleY(): number {
    return viewScaleY(LABEL_VIEW_H);
  }

  // ---------- 尺寸 ----------
  function resize(): void {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    /*
     * 画布比例变了 ⇒ 同一批落点在屏幕上落的位置全变 ⇒ 避让结论作废。
     * 这里**不重取景**（pose 是给"上一次那个比例"拟合的），但注记必须重选
     * —— 否则收起侧栏（舞台变宽）之后，几条数字还停在按旧比例调好的位置上。
     */
    labelsDirty = true;
    // 屏幕像素宽度的线要跟着画布走，否则换窗口大小后线会变粗/变细
    annotResolution.set(w, h);
    for (const m of annotMaterials) {
      m.resolution.copy(annotResolution);
    }
    /*
     * 切面边框与高度尺的线走的是**另一本账**（见 `sliceLineMaterials` 的说明）：
     * 它们不属于部位标注层，不能被 `clearAnnotations()` 顺手清掉。
     */
    for (const m of sliceLineMaterials) {
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
    /*
     * ⚠️⚠️ 必须在这里做**图幅内**检查，地表分支不能照抄平面分支的写法就完事。
     *
     * 病根：`altitudeAtWorld` 对图幅外的坐标是**钳制到边缘**的（边缘外一律给边缘值），
     * 所以一条射向"图幅外的天空"的射线，`heightAt(t)` 依然会穿过 0
     * —— 它穿过的不是地形，是**由边缘高度铺出去的那张虚假平面**。
     * 于是 `pick` 返回了 `gy = 376`（网格只有 0~255）这种越界坐标。
     *
     * 为什么现在才暴露：v2.4.5 之前 `pick` 的结果只用来算 `alt`（给 tooltip 显示），
     * 越界也无所谓；人工标注要拿它**当格坐标写进 localStorage**，
     * 越界值会被 `addManualMark` 当成"落在图幅外"拒掉 ——
     * 界面上表现为"点沙盘没反应"，而 `elementFromPoint` / 手势判据全是绿的，
     * 极难归因（这一版真机回归就是在这儿红了两条）。
     *
     * 所以边界检查放在**出口**（两条分支汇合后），而不是只补平面那一支 ——
     * 补一处的话，下一个人加第三条拾取路径还会再踩一次。
     */
    const halfSpan = field.spanM / 2;
    if (Math.abs(x) > halfSpan || Math.abs(z) > halfSpan) return null;
    const [gx, gy] = worldToGrid(field, x, z);
    return { gx, gy, alt: sampleGrid(field, gx, gy) };
  }

  /** 复用同一个向量，避免每次指针移动都新建对象（命中判定每帧都会调） */
  const projV = new THREE.Vector3();

  function project(gx: number, gy: number): { x: number; y: number } | null {
    if (!field) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    /*
     * 同 `setContourLabels`：投影依赖 `matrixWorldInverse`，而它只在渲染时刷新。
     * 一轮矩阵求逆是微秒级，换的是"任何调用时机都对"。
     */
    camera.updateMatrixWorld();
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
    /*
     * 取景变了 ⇒ 在这里（而不是在 `frameAssembly` 里）重选注记落点。
     *
     * 为什么不能在 `frameAssembly` 里就选：那个时刻**这一帧还没渲染**
     * （`matrixWorldInverse` 还是上一帧的），而且 `controls.update()` 还没跑
     * —— 它可能会把相机再挪一下。于是"选址时看到的画面"和"马上要渲染的
     * 画面"不是同一个，避让判据算出来的是另一套位置。
     *
     * 实测症状：挂载时选出 4 条，其中 `4000` 与 `3000` 的纸垫在画面上
     * 互相压住（按最终相机算，两枚中心只差 48 px，而纸垫本身宽约 59 px）；
     * 而"关掉再打开"会重选一次，那次用的是稳定后的相机 ⇒ 只剩 3 条且互不
     * 重叠。同一份数据、同一个相机位姿，两次结果不同 —— 差的就是**调用时机**。
     *
     * 放到这里之后，位姿与马上就要渲染的那一帧完全一致；而且只在
     * "取景刚被程序改动过"时触发一次，学生手动转视角（`controls` 自己改
     * `camera.position`）不会触发 ⇒ 数字不会跟着拖拽乱跳。
     */
    if (labelsDirty && lastLabels) {
      labelsDirty = false;
      setContourLabels(lastLabels);
    }
    /*
     * 高程注记的**站立高度每帧重算**。
     *
     * `sizeAttenuation: false` 的代价：注记的屏幕大小恒定了，但它的**世界**尺寸
     * 随相机距离线性变化（`worldH = scaleY × 距离`）。抬升量若在重建时定死，
     * 相机一拉远纸垫的下半截就沉进地表，被 `depthTest` 啃掉一条边 ——
     * 看起来像"字被切了一半"（第一版实测就是这样，4 倍放大才看清）。
     * 所以：**抬升 = 当前世界高度的一半 × 1.08**，条数最多十来条，每帧算一次可以忽略。
     */
    if (labelGroup.children.length) {
      const sy = labelScaleY();
      for (const c of labelGroup.children) {
        const baseY = c.userData.baseY;
        if (typeof baseY !== "number") {
          continue;
        }
        const d = camera.position.distanceTo(c.position);
        c.position.y = baseY + 0.5 * sy * d * 1.08;
      }
    }
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
    /*
     * ⚠ 只写 `camera.position` / `controls.target` 是**不够的**：
     * 相机的朝向（`camera.quaternion`）要等 `controls.update()` 里的
     * `lookAt(target)` 才会对上。在那之前任何 `project()` 拿到的都是
     * **上一个朝向**的视图矩阵。
     *
     * 实测踩过：挂载时按"还没转过来的旧朝向"算出一批高程注记落点，
     * 其中 `4000` 与 `3000` 的纸垫在**正确朝向**下会叠在一起；等
     * `controls.update()` 跑完再选一次就只剩 3 条、互不重叠。
     * 两次的 `camera.position` 打印值一模一样 —— 差别只在朝向，
     * 所以"同一份数据、同一个位姿、两次结果不同"看着像随机，其实不是。
     *
     * 与 `lockCamera` 用同一个口径（`controls.update()`），不自己写 `lookAt`：
     * 顺带把 OrbitControls 内部的球坐标状态也同步到新位姿上。
     */
    controls.update();
    // 换了个位姿 ⇒ 注记的屏幕落点全变 ⇒ 交给 tick 重选一次（见 `tick`）
    labelsDirty = true;
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
    /*
     * 高程注记同样贴地：夸张改了 Y 就全错位。用**同一份落点**重铺一遍
     * （落点是网格坐标，与海拔口径无关，所以这里不需要 engine 参与）。
     */
    if (lastLabels) {
      setContourLabels(lastLabels);
    }
    /*
     * 高程切面同理：一摞**水平板子**的高度全部是 `visualY(层高程)`，
     * 夸张一改整摞就错位。用**同一份层高程**重铺一遍（层高程与夸张口径无关，
     * 所以这里同样不需要 engine 参与）。高度尺跟着一起重建 ——
     * 它的杆顶/杆底就是最高与最低那层。
     */
    if (lastSlices) {
      setElevationSlices(lastSlices);
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
    /*
     * 高程注记同理：它是"贴在等高线上"的东西，沙盘一收，数字就悬在半空。
     * 学生这时该看的是图纸上那份，由 `drawProjectionMap` 画。
     */
    labelGroup.visible = visible && labelGroup.children.length > 0;
    /*
     * 高程切面同理：它是一摞**水平板子**，沙盘一收就变成悬在半空的玻璃。
     * 条件收在一个函数里（见 `applySliceVisibility`），免得两处各写一遍。
     */
    applySliceVisibility();
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
   * 一张高程注记的贴图。
   *
   * 外观与另外两块画面（底栏平面图 / 投影图纸）**同一套纸墨语义**：
   * 米色纸垫 + 1px 实墨边 + 零圆角 + 等宽数字。数字一律不带单位
   * （与 `drawPlanMap` 的计曲线注记逐字一致，学生看到的是同一个"2000"）。
   *
   * 贴图按 `LABEL_EM_PX` 这个较大的尺寸画、再缩到屏幕上，
   * 所以投影仪的 1024 宽画布上也够清晰；字体量不到时退回一个保守宽度，
   * 不抛错 —— 教室里 `measureText` 依赖的字体未必都在。
   */
  function makeLabelTexture(
    text: string,
    emPx = LABEL_EM_PX,
    padPx = LABEL_PAD_PX
  ): { texture: THREE.CanvasTexture; aspect: number } {
    const c = document.createElement("canvas");
    const g = c.getContext("2d");
    /*
     * 字号可传：高度尺（v2.5.5）的数字要比地形上的高程注记**小一档** ——
     * 它是"尺子的刻度"而不是"山上的读数"，同级大小会跟注记抢视线。
     * 只换字号、不换纸墨语义（米色垫 + 墨边 + 等宽数字），两处看着才是一套。
     *
     * 纸垫厚度也可传：地形注记的厚垫（`LABEL_PAD_PX`）是为了**挡住底下的等高线**，
     * 数字才从花花的背景里跳出来；高度尺立在**图幅外的天空上**，背后没有东西要挡，
     * 厚垫纯属浪费。而"浪费"在这里是有代价的 —— 尺子只有 47 px 高、每层摊到 15.2 px，
     * 垫子每厚一点就吃掉一点间距，厚垫会让相邻两枚数字的**墨边互相压住**（真机实测 −0.3 px）。
     * 所以尺子用薄垫：纸垫变小、间隔拉开，**字号反而能保持得更大**。
     */
    const EM = emPx;
    const font = `600 ${EM}px ui-monospace, Menlo, Consolas, monospace`;
    let tw = EM * text.length * 0.66;
    if (g) {
      g.font = font;
      const m = g.measureText(text).width;
      if (m > 0) {
        tw = m;
      }
    }
    const PAD = padPx;
    const w = Math.ceil(tw + PAD * 2);
    const h = Math.ceil(EM + PAD * 2);
    c.width = w;
    c.height = h;
    if (g) {
      // 纸垫（不透明：挡住底下的等高线，数字才读得出来）
      g.fillStyle = PAPER;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = INK;
      g.lineWidth = Math.max(2, EM / 16);
      // 半像素内缩，让 1px 的边正好落在像素上（不然两侧一边粗一边细）
      const lw = g.lineWidth / 2;
      g.strokeRect(lw, lw, w - g.lineWidth, h - g.lineWidth);
      g.font = font;
      g.fillStyle = INK;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, w / 2, h / 2 + EM * 0.04);
    }
    const texture = new THREE.CanvasTexture(c);
    /*
     * 贴图是"颜色表"而不是照片：必须关掉 sRGB 以外的插值伪影。
     * 用 `NearestFilter` 会让数字在缩放后锯齿明显，所以取线性 + mipmap，
     * 并把各向异性拉满 —— 斜看时数字最糊，正好是这里。
     */
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
    return { texture, aspect: w / h };
  }

  function clearContourLabels(): void {
    for (const t of labelTextures) {
      t.dispose();
    }
    labelTextures.length = 0;
    labelGroup.clear();
    placedAnchors = [];
  }

  /**
   * 重建高程注记层，并**返回真正放上去的那几条**。
   *
   * ## 为什么选址在这里而不在 `contour.ts`
   *
   * 判据是"屏幕上的两块纸垫不互相压住"，这需要相机；相机住在 `view3d.ts`。
   * `contour.ts` 只给每级的候选点（纯几何，可单测），挑哪个由这里定。
   *
   * ## 屏幕空间的间距判据
   *
   * 纸垫是轴对齐的矩形（`W × H` 像素，恒定不变）。两块矩形不重叠的充要条件：
   * `|dx| ≥ W` 或 `|dy| ≥ H`。所以取 `sep = max(|dx|/W, |dy|/H)`，
   * 要求 `sep ≥ 1.15`（给自己留 15% 呼吸）。
   *
   * ⚠ **这里必须用双轴的最大值，不能用欧氏距离**：两个纸垫一上一下贴着
   * （`dx=0, dy=H`）时"不重叠"，而欧氏距离正好等于 `H`，
   * 拿阈值跟 `H` 比会把这种"刚好摞着"判成合格 —— 而它在屏幕上是一条缝都不剩。
   *
   * ## 每一级挑"最空的那一个候选"
   *
   * 对当前级的所有候选算 `sep`，取最小的那个（= 离最近邻居最远）作为该级的分数，
   * 选分数最高的候选。分数低于 1.15 的候选一个都没有 ⇒ **这一级不标**
   * （宁可少一个数字，也不给一个看不清的数字）。
   *
   * ⚠ 选址只做一次（在数据/几何变化时），**不每帧重算**：
   * 每帧算的话，学生一转视角数字就会跳位置，比稍微重叠还难受。
   */
  function setContourLabels(entries: ContourLabelCandidate[] | null): ContourLabelAnchor[] {
    lastLabels = entries;
    clearContourLabels();
    const rect0 = renderer.domElement.getBoundingClientRect();
    const trace: Record<string, unknown> = {
      cam: camera.position.toArray().map((v) => +v.toFixed(1)),
      target: controls.target.toArray().map((v) => +v.toFixed(1)),
      aspect: +camera.aspect.toFixed(4),
      view: [+rect0.width.toFixed(1), +rect0.height.toFixed(1)],
      entries: entries ? entries.length : 0,
      chosen: [] as number[]
    };
    labelLayoutLog.push(trace);
    if (labelLayoutLog.length > 6) {
      labelLayoutLog.shift();
    }
    const f = field;
    if (!f || !entries || !entries.length) {
      return [];
    }
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      return [];
    }    const sy = labelScaleY();
    /*
     * ⚠ 投影之前必须**自己刷一次相机矩阵**。
     *
     * `camera.matrixWorldInverse` 是 `project()` 用的那个矩阵，而它只在
     * `renderer.render()`（每帧）与显式 `updateMatrixWorld()` 时才更新。
     * `frameAssembly` 只写了 `camera.position` —— 于是"换山后紧接着选址"
     * 这一次，拿到的是**上一座山**的相机矩阵：屏幕上算出来的位置全错，
     * 避让判据跟着全错 ⇒ 数字照样叠在一起（实测踩过，肉眼看就是"避让没生效"）。
     */
    camera.updateMatrixWorld();
    /*
     * 抬升的**基准初值**：真正的抬升量由 `tick` 每帧按相机距离补
     * （见那里的注释 —— 定死会在拉远时把纸垫埋进地里）。
     * 这里只给一个足够大的保守值，免得第一帧（tick 还没跑到）纸垫贴在地上。
     */
    const [dx0, dz0] = gridToWorld(f, 0, 0);
    const [dx1, dz1] = gridToWorld(f, f.grid - 1, f.grid - 1);
    const halfDiag = Math.hypot(dx1 - dx0, dz1 - dz0) / 2;
    // 纸垫在屏幕上的恒定尺寸（与 Sprite 的实际投影一致：见 `labelScaleY` 的推导）
    const labelH = Math.max(8, LABEL_VIEW_H * rect.height);
    const placed: Array<{ level: number; x: number; y: number; box: [number, number, number, number] }> = [];
    const chosen: ContourLabelAnchor[] = [];
    const liftCache = new Map<string, number>();
    /** 候选点 → 屏幕上纸垫的矩形（含 tick 每帧补的那段抬升） */
    const boxOf = (gx: number, gy: number, labelW: number): [number, number, number, number] | null => {
      const [wx, wz] = gridToWorld(f, gx, gy);
      const baseY = visualY(f, sampleGrid(f, gx, gy));
      const key = `${gx},${gy}`;
      let y = liftCache.get(key);
      if (y === undefined) {
        const d = camera.position.distanceTo(projV.set(wx, baseY, wz));
        y = baseY + 0.5 * sy * d * 1.08;
        liftCache.set(key, y);
      }
      projV.set(wx, y, wz).project(camera);
      if (projV.z > 1) {
        return null;
      }
      const px = ((projV.x + 1) / 2) * rect.width;
      const py = ((1 - projV.y) / 2) * rect.height;
      return [px - labelW / 2, py - labelH / 2, px + labelW / 2, py + labelH / 2];
    };

    for (const e of entries) {
      const text = `${Math.round(e.level)}`;
      const { texture, aspect } = makeLabelTexture(text);
      const labelW = labelH * aspect;
      let bestCand: { x: number; y: number } | null = null;
      let bestBox: [number, number, number, number] | null = null;
      let bestSep = -1;
      for (const c of e.cands) {
        const box = boxOf(c.x, c.y, labelW);
        if (!box) {
          continue;
        }
        let sep = Infinity;
        for (const q of placed) {
          const dx = Math.abs((box[0] + box[2]) / 2 - (q.box[0] + q.box[2]) / 2);
          const dy = Math.abs((box[1] + box[3]) / 2 - (q.box[1] + q.box[3]) / 2);
          const s = Math.max(dx / labelW, dy / labelH);
          if (s < sep) {
            sep = s;
          }
        }
        if (sep > bestSep) {
          bestSep = sep;
          bestCand = c;
          bestBox = box;
        }
      }
      if (!bestCand || !bestBox || bestSep < LABEL_MIN_SEP) {
        // 放不下这一级：把贴图还掉（它只是用来量宽度）
        texture.dispose();
        continue;
      }
      const mat = new THREE.SpriteMaterial({
        map: texture,
        // ⚠ 注记是"图"不是"景物"：跟图纸、剖面引线同一个口径，不吃雾。
        //   否则远端的数字会被雾漂白到读不出来，而它本来只是要报个数。
        fog: false,
        // 逐像素被地形遮挡 —— 山背后的数字就该看不见，这是 Sprite 方案的全部理由
        depthTest: true,
        depthWrite: false,
        sizeAttenuation: false,
        transparent: true
      });
      const sp = new THREE.Sprite(mat);
      const [x, z] = gridToWorld(f, bestCand.x, bestCand.y);
      const baseY = visualY(f, sampleGrid(f, bestCand.x, bestCand.y));
      sp.position.set(x, baseY + halfDiag * 0.06, z);
      // 地表高度留给 tick 每帧重算抬升（见 `tick` 里那段）
      sp.userData.baseY = baseY;
      // 记下它标的是哪条高程 —— 取证要按"哪一级"点名（见 `labelBoxes`）
      sp.userData.level = e.level;
      sp.userData.gx = bestCand.x;
      sp.userData.gy = bestCand.y;
      sp.scale.set(sy * aspect, sy, 1);
      /*
       * 抬高渲染次序，让它在同一深度上压住地表与等高线（线是画在
       * 着色器里的，和地表共用一份深度，谁先谁后由浮点误差决定）。
       */
      sp.renderOrder = 4;
      labelGroup.add(sp);
      labelTextures.push(texture);
      placed.push({ level: e.level, x: bestCand.x, y: bestCand.y, box: bestBox });
      chosen.push({ level: e.level, x: bestCand.x, y: bestCand.y });
    }
    labelGroup.visible = terrainVisible;
    trace.chosen = chosen.map((c) => c.level);
    placedAnchors = chosen.slice();
    return chosen;
  }

  /* ---------- 高程切面 + 高度尺（v2.5.5） ---------- */

  /**
   * 把切面层的资源还回去。
   *
   * 与 `clearAnnotations` 同一个口径：geometry / material / texture 各 dispose 一遍。
   * 同一份 geometry 被多个子节点共享时会被 dispose 多次 —— 这是**安全的**，
   * three.js 的 dispose 只是把资源从 renderer 的缓存里摘掉，重复摘同一个键是空操作。
   */
  function clearElevationSlices(): void {
    for (const t of sliceTextures) {
      t.dispose();
    }
    sliceTextures.length = 0;
    for (const g of sliceGeometries) {
      g.dispose();
    }
    sliceGeometries.length = 0;
    for (const m of sliceMaterials) {
      m.dispose();
    }
    sliceMaterials.length = 0;
    sliceLineMaterials.length = 0;
    sliceGroup.clear();
    rulerGroup.clear();
    placedSlices = [];
    rulerTicks = 0;
    rulerFoot = null;
    rulerHead = null;
  }

  /**
   * 重建「高程切面 + 高度尺」这一层。
   *
   * 传 `null` = 整层收掉（开关关了，或等高线自己关了）。
   *
   * ## 四条渲染口径（每条都是"不这样就不对"）
   *
   * - **面必须半透明**：切面在地形**以下**的那部分才是要讲的东西 ——
   *   学生要看见地形继续往下走（"板子下面还有实心的山"）。做成不透明的板子，
   *   整块山体被挡掉，他反而会以为板子就是地面。
   * - **`depthWrite: false`**：几块切面之间只按深度排序、不互相写深度。
   *   写深度的话上下两层会在同一像素上互相判定"我在前面"，交叠处闪出一圈
   *   硬边（多层半透明叠加的经典伪影）。
   * - **`depthTest: true`**：地形高出来的部分要能**挡住**它背后的切面 ——
   *   这正是"板子插进山体里、从坡面穿出来"的观感来源。关掉会变成一块飘在
   *   所有东西前面的玻璃板，地形的高低关系全丢。
   * - **`fog: false`**：与注记、图纸同一个口径。切面是"读图用的辅助面"，
   *   不是景物；让它吃雾的话最远那层会漂白，同一摞板子颜色深浅不一。
   *
   * ## 高度尺为什么要单独立一根
   *
   * 切面上的数字只报"我这一层是多少"，而学生要读的是**层与层之间的高差**
   * （"从 2000 到 4000 涨了多少"）。两个数字相减当然也行，但那个心算
   * 会挡在概念前面；一根带刻度的竖直标尺把"高差"直接变成眼睛能比的间距。
   */
  function setElevationSlices(levels: number[] | null): void {
    lastSlices = levels;
    clearElevationSlices();
    const f = field;
    if (!f || !levels || !levels.length) {
      sliceGroup.visible = false;
      rulerGroup.visible = false;
      return;
    }
    const span = f.spanM;

    /*
     * 一块**共用**几何：`PlaneGeometry` 默认躺在 XY 平面，绕 X 转 -90° 立成水平面。
     * 所有切面共用它 —— 它们的区别只有高度，形状完全一样。
     */
    const plane = new THREE.PlaneGeometry(span, span);
    plane.rotateX(-Math.PI / 2);
    sliceGeometries.push(plane);

    const fillMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(SLICE_FILL),
      transparent: true,
      opacity: SLICE_OPACITY,
      depthWrite: false,
      depthTest: true,
      // 从下方看也要能看见（学生把相机转到地平线以下时，板子的背面同样是"面"）
      side: THREE.DoubleSide,
      fog: false
    });
    sliceMaterials.push(fillMat);

    /*
     * 边框：闭合的方框（四段线），同样所有切面共用一份。
     * 用 `LineSegments2` 家族而不是 `THREE.Line` —— 后者在 WebGL 下
     * `linewidth` 被忽略、恒为 1px，在半透明面上细到看不见（与部位标注同一条纪律）。
     */
    const h2 = span / 2;
    const corners: Array<[number, number]> = [
      [-h2, -h2],
      [h2, -h2],
      [h2, h2],
      [-h2, h2]
    ];
    const borderPts: number[] = [];
    for (let k = 0; k < 4; k++) {
      const a = corners[k];
      const b = corners[(k + 1) % 4];
      borderPts.push(a[0], 0, a[1], b[0], 0, b[1]);
    }
    const borderGeo = new LineSegmentsGeometry();
    borderGeo.setPositions(borderPts);
    sliceGeometries.push(borderGeo);
    const borderMat = new LineMaterial({
      color: new THREE.Color(SLICE_EDGE).getHex(),
      linewidth: 1.8,
      transparent: true,
      opacity: 0.62,
      depthTest: true
    });
    borderMat.resolution.copy(annotResolution);
    sliceMaterials.push(borderMat);
    sliceLineMaterials.push(borderMat);

    for (const level of levels) {
      const y = visualY(f, level);
      const mesh = new THREE.Mesh(plane, fillMat);
      mesh.position.set(0, y, 0);
      mesh.renderOrder = SLICE_ORDER;
      sliceGroup.add(mesh);

      const edge = new LineSegments2(borderGeo, borderMat);
      edge.position.set(0, y, 0);
      edge.renderOrder = SLICE_ORDER + 1;
      sliceGroup.add(edge);
      placedSlices.push(level);
    }

    buildHeightRuler(f, levels);

    /*
     * 沙盘收起来时（只看二维图纸）切面与高度尺都是**悬空的板子**，
     * 不如整层一起收掉 —— 学生这时该看的是图纸上那份等高线。
     * 与 `labelGroup` / `annotGroup` 同一个口径。
     */
    applySliceVisibility();
  }

  /**
   * 图幅外角上的竖直高度尺：一根杆 + 每层一道刻度 + 一个高程数字。
   *
   * ## 为什么立在**左中角**（−x, +z）
   *
   * 相机方位由 `layout.ts` 的 `CAM_YAW` 定（东南方向看过来）。把它代进
   * `fitCameraPose` 的三条相机轴可以算出：四个角里
   *  - `(+half, +half)` 落在**画面下方中间**（离视点最近，但压在沙盘前角上）；
   *  - `(−half, −half)` 落在**画面上方**（最远）—— 会被山体整个挡住，排除；
   *  - `(+half, −half)` 与 `(−half, +half)` 对称地落在**画面右缘 / 左缘、高度居中**。
   *
   * 两者几何上等价，选**左侧**是**排版**的原因：舞台上有两块 DOM 浮层，
   * 右上角的「自然带」图例很高（约 190 px），左上角的样本信息卡只有约 85 px。
   * 第一版把尺子放在右缘，右侧的四个刻度数字**全被图例压掉一半**
   * （实测截图里只剩 `40 / 30 / 20 / 10`）—— 三维里画得再对，
   * 被 DOM 浮层盖住一样读不到。放到左缘之后整根尺子落在信息卡**下方**的空白区。
   *
   * ⚠ 尺寸全部按 `span` 走，**不写死米数**：样本跨度从 20 km 到 60 km 都有，
   * 写死的话 60 km 的样本上尺子会缩成一根牙签。
   */
  function buildHeightRuler(f: DemField, levels: number[]): void {
    const span = f.spanM;
    const half = span / 2;
    // 左缘外侧：刻度与数字一律朝 **−x** 长（离图幅越来越远），不与沙盘打架
    const xr = -(half + span * RULER_OUT);
    const zr = half;
    const tick = span * RULER_TICK;
    /*
     * 杆只覆盖**有切面的那段高度**（最低那层 ↔ 最高那层），不铺到地形零点：
     * 尺子是从"第一块板子"到"最后一块板子"的参照，再往下是空的。
     * `levels` 由 `majorLevels` 保证是**从高到低**，所以 [0] 是顶、末位是底。
     */
    const yTop = visualY(f, levels[0]);
    const yBot = visualY(f, levels[levels.length - 1]);
    rulerFoot = new THREE.Vector3(xr, yBot, zr);
    rulerHead = new THREE.Vector3(xr, yTop, zr);
    const pts: number[] = [xr, yBot, zr, xr, yTop, zr];
    for (const level of levels) {
      const y = visualY(f, level);
      pts.push(xr, y, zr, xr - tick, y, zr);
    }
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pts);
    sliceGeometries.push(geo);
    const mat = new LineMaterial({
      color: new THREE.Color(INK).getHex(),
      linewidth: 2.2,
      transparent: true,
      opacity: 0.92,
      depthTest: true
    });
    mat.resolution.copy(annotResolution);
    sliceMaterials.push(mat);
    sliceLineMaterials.push(mat);
    const pole = new LineSegments2(geo, mat);
    pole.renderOrder = SLICE_ORDER + 1;
    rulerGroup.add(pole);

    const sy = viewScaleY(RULER_VIEW_H);
    for (const level of levels) {
      const { texture, aspect } = makeLabelTexture(`${Math.round(level)}`, RULER_EM_PX, RULER_PAD_PX);
      sliceTextures.push(texture);
      const texMat = new THREE.SpriteMaterial({
        map: texture,
        // 与注记同一个口径：读数不吃雾，否则最远那层会漂白到读不出来
        fog: false,
        // 尺子在图幅外，正常不会被挡；留着 depthTest 是为了"转到山背面去"时
        // 它也能被正确地挡住 —— 它终究是立在场景里的一件东西
        depthTest: true,
        depthWrite: false,
        sizeAttenuation: false,
        transparent: true
      });
      sliceMaterials.push(texMat);
      const sp = new THREE.Sprite(texMat);
      /*
       * ⚠ 锚点改成**右中**（默认是正中）。
       *
       * 数字的**世界**宽度随相机距离线性变化（`sizeAttenuation: false` 的必然结果），
       * 用居中锚点的话，想让它"边缘不出框"就得按距离反算坐标 ——
       * 而相机一动那个数就过期了。锚在右边之后，`position` 就是文字的右边缘，
       * 无论它多宽都只会向**左**长，而左边（图幅外）是空的。
       */
      sp.center.set(1, 0.5);
      sp.position.set(xr - tick - span * 0.008, visualY(f, level), zr);
      sp.scale.set(sy * aspect, sy, 1);
      sp.renderOrder = SLICE_ORDER + 2;
      sp.userData.level = level;
      rulerGroup.add(sp);
      rulerTicks++;
    }
  }

  /**
   * 沙盘收起来时切面也跟着收。
   *
   * 单独抽一个函数是因为它有两个触发源（显隐开关、重建切面层），
   * 两处各写一遍条件迟早会不一致 —— 而不一致的表现是"关掉沙盘后
   * 还有几块板子飘在半空"。
   */
  function applySliceVisibility(): void {
    const on = lastSlices !== null && terrainVisible && sliceGroup.children.length > 0;
    sliceGroup.visible = on;
    rulerGroup.visible = on;
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

  /**
   * 每枚注记在**屏幕上的真实盒子**（中心 + 宽高，单位 = 画布 CSS px）。
   *
   * 存在的理由：判据"两块纸垫不互相压住"必须用**逐枚的真实尺寸**才成立 ——
   * 纸上数字的宽度随位数变（`1000` 与 `10000` 差一个字符 ≈ 0.9 倍宽），
   * 而"不重叠"的**充要条件**是「横向错开 ≥ 两者半宽之和 **或** 纵向错开
   * ≥ 两者半高之和」，用同一个宽度去套每一对是近似，不是等价的。
   *
   * 尺寸从**对象自身**推：`sizeAttenuation: false` 时 NDC 高度恒为
   * `2·LABEL_VIEW_H`（推导见 `labelScaleY`），与相机距离无关 ⇒
   * 屏幕高度 = `LABEL_VIEW_H × 画布高`，宽度再乘贴图宽高比 `scale.x/scale.y`。
   * 不另立一套"判据专用口径"，免得两边各算一遍、对不上时不知道谁错。
   */
  function labelBoxes(): Array<{ level: number; cx: number; cy: number; w: number; h: number }> {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      return [];
    }
    camera.updateMatrixWorld();
    const h = LABEL_VIEW_H * rect.height;
    const out: Array<{ level: number; cx: number; cy: number; w: number; h: number }> = [];
    for (const c of labelGroup.children) {
      const sp = c as THREE.Sprite;
      if (projV.copy(sp.position).project(camera).z > 1) {
        continue;
      }
      const w = h * (sp.scale.x / sp.scale.y);
      out.push({
        level: typeof sp.userData.level === "number" ? sp.userData.level : 0,
        cx: +(((projV.x + 1) / 2) * rect.width).toFixed(1),
        cy: +(((1 - projV.y) / 2) * rect.height).toFixed(1),
        w: +w.toFixed(1),
        h: +h.toFixed(1)
      });
    }
    return out;
  }

  /**
   * 高度尺刻度数字在**屏幕上的真实盒子**（逐枚）。
   *
   * 与 `labelBoxes` 同一个理由：判"四个数字没叠在一起"必须用逐枚的真实尺寸
   * （位数不同宽度不同）。而这里的**纵向间距由数据决定**
   * （层间距 ÷ 跨度 × 纵轴夸张），与字号无关 —— 换个更平的样本、
   * 或把夸张调回 ×1，间距就会缩到数字垫以下，而画面看上去只是"字挨得紧"。
   *
   * 锚点是**右中**（`center.set(1, 0.5)`），所以 `right` 给的是盒子的**右边缘**
   * （不是中心），盒子向左展开 `w`。
   */
  function rulerBoxes(): Array<{ level: number; x0: number; x1: number; cy: number; w: number; h: number }> {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      return [];
    }
    camera.updateMatrixWorld();
    const h = RULER_VIEW_H * rect.height;
    /*
     * ⚠ 输出**明确的左右边**（`x0` / `x1`），不要只给一个"锚点位置"。
     *
     * 曾经这里返回的是 `right` —— 那是个**含义会随锚点翻转**的字段：
     * `center.set(1, 0.5)`（立在左缘）时它是右边缘，`center.set(0, 0.5)`（立在右缘）
     * 时它是**左**边缘。判据拿它当"右边缘"用，于是在右缘那一版上把整枚数字垫
     * 算到了杆的**外侧**，尺子明明被 DOM 图例压住了却判成"不重叠"
     * （真机反证实测：图例从 x=660 开始、数字垫到 x≈681，判据仍报绿）。
     * 把 `center.x` 代进去换算，两版都成立。
     */
    const out: Array<{ level: number; x0: number; x1: number; cy: number; w: number; h: number }> = [];
    for (const c of rulerGroup.children) {
      const sp = c as THREE.Sprite;
      if (sp.isSprite !== true) {
        continue; // 杆与刻度是 LineSegments2，没有"文字盒"
      }
      if (projV.copy(sp.position).project(camera).z > 1) {
        continue;
      }
      const w = h * (sp.scale.x / sp.scale.y);
      const cx = ((projV.x + 1) / 2) * rect.width;
      const x0 = cx - w * sp.center.x;
      out.push({
        level: typeof sp.userData.level === "number" ? sp.userData.level : 0,
        x0: +x0.toFixed(1),
        x1: +(x0 + w).toFixed(1),
        cy: +(((1 - projV.y) / 2) * rect.height).toFixed(1),
        w: +w.toFixed(1),
        h: +h.toFixed(1)
      });
    }
    return out;
  }

  /**
   * 高度尺杆的屏幕投影（画布 CSS px，左上角为原点）。
   *
   * ⚠ 用 `renderer.domElement` 的 CSS 盒，与 `labelBoxes` 同一个口径 ——
   * 两处各算一套"屏幕坐标"的话，对不上时不知道该信哪个。
   * ⚠ 投影前自己刷一次相机矩阵（理由见 `setContourLabels` 里那段）。
   */
  function rulerScreenOf(
    a: THREE.Vector3,
    b: THREE.Vector3
  ): { a: { x: number; y: number }; b: { x: number; y: number } } | null {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      return null;
    }
    camera.updateMatrixWorld();
    const one = (v: THREE.Vector3) => {
      const p = v.clone().project(camera);
      return {
        x: +(((p.x + 1) / 2) * rect.width).toFixed(1),
        y: +(((1 - p.y) / 2) * rect.height).toFixed(1)
      };
    };
    return { a: one(a), b: one(b) };
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
       * 高程注记层（v2.5.4）：条数 + 整层可见性。
       *
       * 两个都要报：只看条数会被"对象建好了但整层 visible=false"骗过去
       * （沙盘收起来时正是这个状态），只看 visible 又分不清"开关没生效"
       * 与"这个样本本来就没有计曲线"。
       */
      labelCount: labelGroup.children.length,
      labelVisible: labelGroup.visible,
      /** 最近几次选址的"当时相机/画布/结果"，用于归因"两次选址结果不同" */
      labelLayouts: labelLayoutLog.slice(),
      /** 每枚注记的屏幕盒子 —— 判"两两不重叠"用（见 `labelBoxes`） */
      labelBoxes: labelBoxes(),
      /**
       * 高程切面层（v2.5.5）。
       *
       * `sliceCount` = **层数**（每层一块板子），`sliceObjects` = 场景里的对象数
       * （每层是"一块面 + 一圈轮廓"两个对象 ⇒ 恒为 `2 × sliceCount`）。
       * 两个都报是为了让"层数对但对象少"（轮廓没建出来）这种半成功状态能被看见。
       */
      sliceCount: placedSlices.length,
      sliceObjects: sliceGroup.children.length,
      sliceVisible: sliceGroup.visible,
      /** 切面层的高程（从高到低）—— 回归据此核对"切在哪几层" */
      sliceLevels: placedSlices.slice(),
      /** 高度尺刻了几道（应恒等于 `sliceCount`） */
      rulerTicks,
      rulerVisible: rulerGroup.visible,
      /**
       * 高度尺杆的**屏幕位置**（画布 CSS px，左上角为原点），`null` = 没建。
       *
       * 光有"对象建出来了"（`rulerTicks`）证明不了它**看得见**：立在山背后、
       * 或者落在取景框外，都同样是"建好了"。这里把杆底/杆顶投到屏幕，
       * 回归就能断言"它在舞台右半边、且两端都落在框内"。
       */
      rulerScreen: rulerFoot && rulerHead ? rulerScreenOf(rulerFoot, rulerHead) : null,
      /**
       * 每枚刻度数字的屏幕盒子 `{level,x0,x1,cy,w,h}` —— 判"四个数字没叠在一起"（D16c）
       * 与"尺子没被 DOM 浮层压住"（D16b）都用它。
       * ⚠ 给 `x0/x1` 而不是单一的"锚点位置"：锚点含义随 `center` 翻转，会骗过判据。
       */
      rulerBoxes: rulerBoxes(),
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
    setContourLabels,
    getContourLabels: () => placedAnchors.slice(),
    setElevationSlices,
    getElevationSlices: () => placedSlices.slice(),
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
      clearContourLabels();
      clearElevationSlices();
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
