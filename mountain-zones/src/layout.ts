/**
 * 展品布局与取景——**纯数学，不依赖 three.js**。
 *
 * ## 为什么单独一个模块
 *
 * 「二维图纸摆在哪」与「相机摆在哪」这两件事是**互相决定**的，而且它们的耦合
 * 是隐式的：图纸铺在三维沙盘**正下方**，两者水平范围**完全相同**，只差一个
 * 垂直间隙 `gap`。从斜上方看，图纸整体在屏幕上只是「沙盘整体向下平移
 * `gap·cos(俯角)`」，而沙盘自身在屏幕上占 `L·sin(俯角)` —— 其中 `L` 是视线
 * 方向上的水平进深，正方形沿**对角**看时是 `1.41 × 边长`（不是边长！）。
 *
 * 于是「图纸能不能露出来」有一条硬几何门槛：
 *
 *     gap·cos(俯角) ≥ L·sin(俯角)   ⟹   gap ≥ tan(俯角) × 1.41
 *
 * v2.2.0 的取值是 `gap = 0.05`、相机俯角 ≈ 21°（tan ≈ 0.38）⇒ 差了整整一个
 * 数量级，图纸 **94% 被沙盘自己压住**，屏幕上只有最近的那个角露出一点点，
 * 看着就是「根本没有二维图纸」。这不是画错，是两处口径各自为政的结果：
 * 间隙写在 `terrain.ts`、相机写在 `view3d.ts`，**谁也不知道对方**。
 *
 * 现在三样东西（间隙 / 俯角 / 相机距离）统一收在这里：
 *  - 渲染模块**引用**它 —— 保证两边口径一致；
 *  - 测试**验算**它 —— 判据与实现调用同一份函数，不是复刻一份近似公式。
 *
 * ## 相机距离为什么是"拟合"而不是"比例"
 *
 * 老代码写死 `camera.position = (0.62, 0.44, 0.78) × span`，相机距离与装配体的
 * 实际高度无关。可装配体现在是「沙盘 + 间隙 + 图纸」，总高随 `gap` 与样本起伏
 * 变化 —— 写死比例要么切掉图纸、要么留一大片空白。`fitCameraPose()` 把装配体
 * 的 8 个角投到相机平面上量出真实半宽半高，再反解距离。
 */

/** 数值三元组（刻意不用 THREE.Vector3 —— 这个模块要能在 Node 里跑） */
export type Vec3 = [number, number, number];

/** 底座在最低点之下再延伸这么多（占跨度比例）——沙盘的"厚度" */
export const SKIRT_DROP = 0.055;

/**
 * 二维图纸离底座再往下这么多（占跨度比例）——"悬空"的那道缝。
 *
 * 取值 0.62 由几何门槛反推：俯角 24°（tan = 0.445）× 对角线系数 1.41 = 0.627。
 * 取 0.62 时实测可见率 98.5%~100%（见 `dem.test.cjs` 的投影面可见性一节）。
 * 这个值**不能凭好看调** —— 调小了图纸就会被沙盘压住，且**没有任何报错**。
 */
export const PROJECTION_GAP = 0.62;

/** 观察模式的相机俯角（度）。图纸可见性 = f(俯角, 间隙)，改这个要同步看间隙 */
export const CAM_PITCH_DEG = 24;

/**
 * 只看二维图纸时的相机俯角（度）。
 *
 * 此时没有东西遮挡，可以放心俯视：俯角越大，图纸在屏幕上的纵向压缩越小
 * （sin(俯角)），越接近"正射的平面图"。52° 时图纸占屏约 68%×89%，
 * 而沿用 24° 只有 89%×60% —— 白白浪费四成高度。
 * 与观察模式的角度差也是有用的反馈：视角一转，学生就知道"换模式了"。
 */
export const CAM_PITCH_2D_DEG = 52;

/** 相机方位角：东南方向看过去（保留 v2.0 以来的取景习惯） */
export const CAM_YAW = Math.atan2(0.62, 0.78);

/** 取景余量：装配体刚好贴边不好看，留 12% */
export const CAM_MARGIN = 1.12;

/** 垂直视场角（度）——`view3d.ts` 建相机时必须用这个值，否则拟合全部失效 */
export const FOV_DEG = 46;

/**
 * 雾的起止（占跨度比例）。**随相机距离一起标定**：相机被拟合公式拉远后，
 * 老的 1.05/3.4 会让远山糊成一片。放大到 1.65/5.3 后，远角雾度与 v2.2.0 相当。
 */
export const FOG_NEAR = 1.65;
export const FOG_FAR = 5.3;

/** 沙盘"厚度"的底边所在高度（世界 y，米） */
export function assemblyBaseY(spanM: number, minVisualY: number): number {
  return minVisualY - spanM * SKIRT_DROP;
}

/** 二维图纸所在高度（世界 y，米） */
export function assemblyProjectionY(spanM: number, minVisualY: number): number {
  return assemblyBaseY(spanM, minVisualY) - spanM * PROJECTION_GAP;
}

/** 沙盘本体的视觉高度中点（世界 y，米）——相机取景用 */
export function assemblyCenterY(minVisualY: number, maxVisualY: number): number {
  return (minVisualY + maxVisualY) / 2;
}

export interface CameraPose {
  eye: Vec3;
  target: Vec3;
  /** 相机到 target 的距离（米） */
  distance: number;
}

/**
 * 按装配体包围盒拟合相机位姿。
 *
 * `topY` / `botY` 是装配体在世界 y 上的上下端：
 *  - 沙盘 + 图纸都显示：`topY = 沙盘中点高度`、`botY = 图纸高度`
 *  - 只显示图纸：两者都传图纸高度（包围盒退化成一张平面）
 *
 * ## 距离是**精确解**，不是正交近似
 *
 * 直觉写法是"半高 / tan(半视场角)"，但那只在物体尺度远小于相机距离时成立：
 * 装配体有一半的角比 `target` 更靠近相机，它们的**深度更小 ⇒ 同样的世界偏移
 * 在屏幕上张得更大**，于是近侧的角会顶出画面（实测最靠边 1.26，即被切掉 26%）。
 *
 * 这里对每个角解不等式本身：`|横向偏移| ≤ 深度 × tan(半视场角)`，
 * 代入 `深度 = 距离 − 角点在视线方向的投影` 得
 *
 *     距离 ≥ |横向偏移| / tan(半视场角) + 角点在视线方向的投影
 *
 * 对 8 个角各解一次（横向、纵向各一条不等式），取最大值，再乘余量。
 */
export function fitCameraPose(
  spanM: number,
  topY: number,
  botY: number,
  aspect: number,
  pitchDeg: number = CAM_PITCH_DEG
): CameraPose {
  const pitch = (pitchDeg * Math.PI) / 180;
  const mid = (topY + botY) / 2;
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const cosY = Math.cos(CAM_YAW);
  const sinY = Math.sin(CAM_YAW);
  // 相机空间的两条横向轴 + 视线方向（三者两两正交）
  const xAxis: Vec3 = [cosY, 0, -sinY];
  const yAxis: Vec3 = [-sinP * sinY, cosP, -sinP * cosY];
  const dir: Vec3 = [sinY * cosP, sinP, cosY * cosP];

  const half = spanM / 2;
  const tanHalf = Math.tan((FOV_DEG * Math.PI) / 360);
  const tanWide = tanHalf * Math.max(0.2, aspect);
  let need = 0;
  for (const x of [-half, half]) {
    for (const z of [-half, half]) {
      for (const y of [topY, botY]) {
        const w: Vec3 = [x, y - mid, z];
        const depthComp = w[0] * dir[0] + w[1] * dir[1] + w[2] * dir[2];
        const cx = Math.abs(w[0] * xAxis[0] + w[1] * xAxis[1] + w[2] * xAxis[2]);
        const cy = Math.abs(w[0] * yAxis[0] + w[1] * yAxis[1] + w[2] * yAxis[2]);
        need = Math.max(need, cx / tanWide + depthComp, cy / tanHalf + depthComp);
      }
    }
  }
  const distance = Math.max(spanM * 0.2, need * CAM_MARGIN);
  return {
    eye: [sinY * cosP * distance, mid + sinP * distance, cosY * cosP * distance],
    target: [0, mid, 0],
    distance
  };
}

/**
 * 一条从相机射向图纸的视线，会不会被沙盘本体挡住？
 *
 * 判据的关键是**遮挡物只存在于 `y > baseY` 的那一段**：地表高度场与四壁裙边
 * 都长在底座之上，而图纸铺在底座**之下**，所以存在「从裙边底下钻进去」的
 * 合法视线 —— 那正是间隙存在的意义。因此一旦射线降到 `baseY` 之下就停止检查。
 *
 * ⚠️ 不能把"终点低于地表"当成遮挡 —— 图纸本来就该在地表之下。
 * （这一条写错过一次：把终点算进去，八个样本全部报 100% 被挡。）
 */
export function sightBlocked(
  eye: Vec3,
  target: Vec3,
  spanM: number,
  baseY: number,
  altAt: (x: number, z: number) => number,
  steps = 640
): boolean {
  const dx = target[0] - eye[0];
  const dy = target[1] - eye[1];
  const dz = target[2] - eye[2];
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return false;
  const ux = dx / dist;
  const uy = dy / dist;
  const uz = dz / dist;
  const half = spanM / 2;
  for (let k = 1; k < steps; k++) {
    const t = (dist * k) / steps;
    const y = eye[1] + uy * t;
    if (y <= baseY) return false; // 已降到裙边底边之下，再往下没有面
    const x = eye[0] + ux * t;
    const z = eye[2] + uz * t;
    if (x < -half || x > half || z < -half || z > half) continue;
    if (y < altAt(x, z)) return true;
  }
  return false;
}
