/**
 * 展品布局与取景的测试（纯逻辑，不需要 GPU / Electron）。
 *
 * ## 这里守的是什么
 *
 * 「二维图纸在三维沙盘正下方」这件事有一个**反直觉的几何后果**：
 *
 *  - 图纸与沙盘水平范围完全相同，只差一个垂直间隙 `gap`；
 *  - 从斜上方看，图纸在屏幕上只是"沙盘整体向下平移 `gap·cos(俯角)`"，
 *    而沙盘自身在屏幕上占 `L·sin(俯角)`（`L` = 视线方向上的水平进深，
 *    正方形沿**对角**看时是 1.41 倍边长）；
 *  - 于是 `gap` 小于 `tan(俯角) × 1.41` 时，图纸**整个被沙盘自己压住**。
 *
 * v2.2.0 的取法是 `gap = 0.05`（临界值需要 ≈ 0.63），差了十几倍：
 * 屏幕上图纸只剩最近那个角露出 6%，看着就是"根本没有图纸"。
 * 更麻烦的是它**不报错、不警告**，八张截图里那张纸若隐若现，很容易被当成
 * "相机角度问题"糊过去。所以必须有一条机器判据。
 *
 * ## 判据为什么可信
 *
 * 相机位姿与遮挡判定都**调用 `layout.ts` 的实现**（`fitCameraPose` /
 * `sightBlocked`），不是在这里另写一套近似公式 —— 否则测试绿了也只能说明
 * "公式和公式一致"。最后再拿**老参数**跑同一条判据，必须红，用来证明牙口。
 */
const fs = require("fs");
const path = require("path");
const layout = require("./_layout.cjs");
const dem = require("./_dem.cjs");
const data = require("./_data.cjs");

const checks = [];
const check = (name, cond, extra) => {
  checks.push({ name, ok: Boolean(cond), extra: extra === undefined ? "" : String(extra) });
};

const SOURCES = data.DEM_SOURCES;
const ASPECT = 1128 / 677; // 取真机回归里量到的画布宽高比
const TAN_HALF = Math.tan((layout.FOV_DEG * Math.PI) / 360);

function readSrc(name) {
  return fs.readFileSync(path.join(__dirname, "..", "src", name), "utf8");
}

/**
 * 世界点 → NDC（three.js 透视投影的标准公式）。
 *
 * 这是**标准数学**，不是复刻 layout 的实现：layout 只负责"给出相机位姿"，
 * 投影由 three 的相机对象做。这里复刻一遍是为了在不引入 three 的前提下
 * 验算"拟合出来的相机到底框没框住装配体"。
 */
function ndcOf(pose, p) {
  const eye = pose.eye;
  const fwd = [
    pose.target[0] - eye[0],
    pose.target[1] - eye[1],
    pose.target[2] - eye[2]
  ];
  const fl = Math.hypot(...fwd);
  const zAxis = [-fwd[0] / fl, -fwd[1] / fl, -fwd[2] / fl]; // 指回相机（相机 +Z）
  const right = [
    zAxis[2] * 1 - 0,
    0,
    -zAxis[0]
  ];
  const rl = Math.hypot(...right) || 1;
  const xAxis = [right[0] / rl, right[1] / rl, right[2] / rl];
  const yAxis = [
    zAxis[1] * xAxis[2] - zAxis[2] * xAxis[1],
    zAxis[2] * xAxis[0] - zAxis[0] * xAxis[2],
    zAxis[0] * xAxis[1] - zAxis[1] * xAxis[0]
  ];
  const v = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
  const cx = v[0] * xAxis[0] + v[1] * xAxis[1] + v[2] * xAxis[2];
  const cy = v[0] * yAxis[0] + v[1] * yAxis[1] + v[2] * yAxis[2];
  const depth = v[0] * -zAxis[0] + v[1] * -zAxis[1] + v[2] * -zAxis[2];
  if (depth <= 1e-6) return null;
  return {
    x: cx / (depth * TAN_HALF * ASPECT),
    y: cy / (depth * TAN_HALF)
  };
}

/** 某个样本的装配体上下端与图纸高度 */
function levelsOf(src, gapRatio) {
  const f = dem.createField(src);
  const span = f.spanM;
  const vMin = dem.visualY(f, f.minH);
  const vMax = dem.visualY(f, f.maxH);
  const baseY = vMin - span * layout.SKIRT_DROP;
  return {
    f,
    span,
    topY: (vMin + vMax) / 2,
    baseY,
    projY: baseY - span * gapRatio
  };
}

/**
 * 图纸可见率：在图纸上取 N×N 个采样点，统计「落在屏幕内」且「视线不被沙盘挡住」的比例。
 *
 * 返回值同时给出 inView / occluded，便于失败时看清是"取景切掉了"还是"被压住了"。
 */
function visibility(pose, span, baseY, projY, altAt, N = 26) {
  let inView = 0;
  let occluded = 0;
  let total = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = (i / (N - 1) - 0.5) * span * 0.98;
      const z = (j / (N - 1) - 0.5) * span * 0.98;
      const p = [x, projY, z];
      total++;
      const nd = ndcOf(pose, p);
      if (!nd || Math.abs(nd.x) > 1 || Math.abs(nd.y) > 1) continue;
      inView++;
      if (layout.sightBlocked(pose.eye, p, span, baseY, altAt)) occluded++;
    }
  }
  return { inView, occluded, total };
}

/* ===== 1) 参数的几何依据 ===== */
// 视线在正方形上沿对角走，水平进深是边长的 (|cos yaw| + |sin yaw|) 倍
const DIAG = Math.abs(Math.cos(layout.CAM_YAW)) + Math.abs(Math.sin(layout.CAM_YAW));
const criticalGap = Math.tan((layout.CAM_PITCH_DEG * Math.PI) / 180) * DIAG;

check(
  "投影间隙落在几何临界值附近（不是随手写的好看值）",
  layout.PROJECTION_GAP > criticalGap * 0.9 && layout.PROJECTION_GAP < criticalGap * 1.25,
  `gap=${layout.PROJECTION_GAP} 临界≈${criticalGap.toFixed(3)} 对角线系数=${DIAG.toFixed(3)}`
);
check(
  "「只看平面图」用的俯角比观察模式更俯（图纸摊得更开）",
  layout.CAM_PITCH_2D_DEG > layout.CAM_PITCH_DEG + 15,
  `${layout.CAM_PITCH_DEG}° → ${layout.CAM_PITCH_2D_DEG}°`
);
check("取景余量是个正数且不过分", layout.CAM_MARGIN > 1.02 && layout.CAM_MARGIN < 1.5, layout.CAM_MARGIN);

/* ===== 2) 相机拟合：装配体 8 个角必须全在画面内 ===== */
const corners = (span, topY, projY) => {
  const half = span / 2;
  const out = [];
  for (const x of [-half, half]) {
    for (const z of [-half, half]) {
      for (const y of [topY, projY]) out.push([x, y, z]);
    }
  }
  return out;
};

for (const src of SOURCES) {
  const L = levelsOf(src, layout.PROJECTION_GAP);
  const pose = layout.fitCameraPose(L.span, L.topY, L.projY, ASPECT);
  let worst = 0;
  let behind = 0;
  for (const c of corners(L.span, L.topY, L.projY)) {
    const nd = ndcOf(pose, c);
    if (!nd) {
      behind++;
      continue;
    }
    worst = Math.max(worst, Math.abs(nd.x), Math.abs(nd.y));
  }
  check(`[${src.name}] 沙盘+图纸 8 个角全部落在画面内`, behind === 0 && worst <= 1,
    `最靠边 ${worst.toFixed(2)}（>1 就是被切掉） 相机距 ${(pose.distance / L.span).toFixed(2)} span`);

  // 只看图纸：装配体退化成一张平面，取景应收紧到纸上
  const p2 = layout.fitCameraPose(L.span, L.projY, L.projY, ASPECT, layout.CAM_PITCH_2D_DEG);
  const visibleH = (() => {
    const nd = corners(L.span, L.projY, L.projY).map((c) => ndcOf(p2, c)).filter(Boolean);
    if (!nd.length) return 0;
    const ys = nd.map((n) => n.y);
    return Math.max(...ys) - Math.min(...ys);
  })();
  check(`[${src.name}] 只看平面图时图纸纵向占屏 ≥ 70%`, visibleH >= 1.4,
    `${(visibleH * 50).toFixed(0)}%`);
}

/* ===== 3) 图纸可见率（这是本轮修复的正主） ===== */
let worstVis = 1;
for (const src of SOURCES) {
  const L = levelsOf(src, layout.PROJECTION_GAP);
  const pose = layout.fitCameraPose(L.span, L.topY, L.projY, ASPECT);
  const altAt = (x, z) => dem.altitudeAtWorld(L.f, x, z) * L.f.verticalExaggeration;
  const r = visibility(pose, L.span, L.baseY, L.projY, altAt);
  const ratio = r.inView ? (r.inView - r.occluded) / r.inView : 0;
  worstVis = Math.min(worstVis, ratio);
  check(
    `[${src.name}] 图纸可见率 ≥ 95%`,
    ratio >= 0.95,
    `可见 ${(ratio * 100).toFixed(1)}%  在屏 ${((r.inView / r.total) * 100).toFixed(0)}%  被挡 ${((r.occluded / Math.max(1, r.inView)) * 100).toFixed(0)}%`
  );
}

/* ===== 4) 牙口：老参数跑同一条判据必须红 ===== */
// v2.2.0 的真实取法：间隙 0.05、相机位置写死 (0.62, 0.44, 0.78)×span。
// 这里手工构造老位姿（属于**历史值**，不是复刻当前实现）。
const OLD_GAP = 0.05;
for (const src of SOURCES) {
  const L = levelsOf(src, OLD_GAP);
  const eye = [L.span * 0.62, L.span * 0.44, L.span * 0.78];
  const oldPose = { eye, target: [0, (L.topY + L.projY) / 2, 0] };
  const altAt = (x, z) => dem.altitudeAtWorld(L.f, x, z) * L.f.verticalExaggeration;
  const r = visibility(oldPose, L.span, L.baseY, L.projY, altAt);
  const ratio = r.inView ? (r.inView - r.occluded) / r.inView : 0;
  check(
    `[${src.name}] 老口径（间隙 0.05）下图纸可见率 < 15% —— 判据咬得住`,
    ratio < 0.15,
    `可见 ${(ratio * 100).toFixed(1)}%`
  );
}
check("新旧可见率之间有明显落差（判据不是恒真）", worstVis - 0.15 > 0.5, `新最差 ${(worstVis * 100).toFixed(1)}%`);

/* ===== 5) 雾的尺度：近处不许有雾、远处要有空气感 ===== */
for (const src of SOURCES) {
  const L = levelsOf(src, layout.PROJECTION_GAP);
  const pose = layout.fitCameraPose(L.span, L.topY, L.projY, ASPECT);
  const d = (x, z) =>
    Math.hypot(
      pose.eye[0] - x,
      pose.eye[1] - dem.visualY(L.f, dem.altitudeAtWorld(L.f, x, z)),
      pose.eye[2] - z
    );
  const half = L.span * 0.49;
  const near = Math.min(d(half, half), d(-half, half), d(half, -half), d(-half, -half));
  const far = Math.max(d(half, half), d(-half, half), d(half, -half), d(-half, -half));
  check(
    `[${src.name}] 近处山脚无雾、远角有空气感`,
    near < layout.FOG_NEAR * L.span && far > layout.FOG_NEAR * L.span,
    `近 ${(near / L.span).toFixed(2)} span / 远 ${(far / L.span).toFixed(2)} span / 雾起于 ${layout.FOG_NEAR} span`
  );
}

check(
  "雾随相机距离一起标定过（相机被拟合公式拉远后旧雾区间会让远山糊掉）",
  layout.FOG_NEAR >= 1.5 && layout.FOG_FAR > layout.FOG_NEAR * 2.5,
  `${layout.FOG_NEAR} / ${layout.FOG_FAR}`
);

/* ===== 6) 静态：口径只能有一份 ===== */
const terrainSrc = readSrc("terrain.ts");
const viewSrc = readSrc("view3d.ts");
const engineSrc = readSrc("engine.ts");
const uiSrc = readSrc("MountainZones.tsx");

check("terrain.ts 不再自己定义间隙 / 底座比例（口径已收进 layout.ts）",
  !/const\s+PROJECTION_GAP\s*=/.test(terrainSrc) && !/const\s+SKIRT_DROP\s*=/.test(terrainSrc));
check("terrain.ts 从 layout.ts 取底座与图纸高度",
  /assemblyBaseY/.test(terrainSrc) && /assemblyProjectionY/.test(terrainSrc));
check("view3d.ts 用 layout 的视场角建相机（写死别的值会让拟合失效）",
  /PerspectiveCamera\(FOV_DEG/.test(viewSrc));
check("view3d.ts 的取景是拟合出来的，不是写死比例",
  /fitCameraPose\(/.test(viewSrc) && !/camera\.position\.set\(span \* 0\.62/.test(viewSrc));
check("view3d.ts 的雾区间来自 layout", /from "\.\/layout"/.test(viewSrc) && !/const FOG_NEAR = 1\.05/.test(viewSrc));

/* ===== 7) 静态：两个开关各自独立且都能用 ===== */
check("图纸与引线不吃雾（它们是图，不是景物 —— 否则远端两条引线看不见）",
  (terrainSrc.match(/fog:\s*false/g) || []).length >= 2);
check("terrain.ts 的「关三维」只收沙盘本体，不动图纸",
  /function setTerrainVisible/.test(terrainSrc) &&
  /terrain\.visible = visible/.test(terrainSrc) &&
  /skirt\.visible = visible/.test(terrainSrc) &&
  /basePlane\.visible = visible/.test(terrainSrc) &&
  !/projPlane\.visible = visible/.test(terrainSrc));
check("view3d.ts 关掉沙盘后会重新取景（否则镜头对着空气）",
  /function setTerrainVisible[\s\S]{0,300}frameAssembly\(field\)/.test(viewSrc));
check("view3d.ts 关掉沙盘后拾取平面切到图纸（否则鼠标点什么都没反应）",
  /if \(!terrainVisible\)[\s\S]{0,600}projectionY\(\)/.test(viewSrc));
check("view3d.ts 关掉沙盘后端点投影也切到纸面（否则拖拽判定按不存在的地表算）",
  /terrainVisible\s*\n?\s*\?\s*sampleGrid\(field, gx, gy\) \* field\.verticalExaggeration/.test(viewSrc));
check("view3d.ts 重建地形时补回沙盘显隐（否则切山后沙盘自己冒出来）",
  /terrain\.setTerrainVisible\(terrainVisible\)/.test(viewSrc));
check("engine 有 showTerrain 参数与快照字段",
  /showTerrain: boolean;/.test(engineSrc) && /showTerrain: params\.showTerrain/.test(engineSrc));
check("engine 挡住了「沙盘与图纸同时关掉」（那样只剩天空）",
  /!params\.showTerrain && !params\.showProjection/.test(engineSrc));
check("engine 关掉沙盘时把巡游退回观察模式（没地表可爬）",
  /!params\.showTerrain && params\.mode === "roam"/.test(engineSrc));
check("界面给了「三维地形」开关，与「二维投影图纸」并列",
  /showTerrain: !snap\?\.showTerrain/.test(uiSrc) &&
  /showProjection: !snap\?\.showProjection/.test(uiSrc) &&
  /三维地形/.test(uiSrc));
check("取景的下端随图纸显隐切换（图纸高度 ↔ 沙盘底边）",
  /projVisible \? projY : terrain\.baseBottomY\(\)/.test(viewSrc) &&
  /baseBottomY/.test(terrainSrc) && /baseBottomY/.test(viewSrc));
check("view3d 关掉/打开图纸后也重新取景（否则沙盘缩在画面中间一小块）",
  /function setProjection[\s\S]{0,420}frameAssembly\(field\)/.test(viewSrc));
check("切开关才重取景，改海拔/换季节不会重置视角（否则学生会一直被掰回默认视角）",
  /s\.visible !== projVisible/.test(viewSrc));

/* ===== 汇总 ===== */
const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "✔" : "✘"} ${c.name}${c.extra ? `  ${c.extra}` : ""}`);
}
console.log(
  `\nLAYOUT CHECK ${failed.length === 0 ? "PASSED ✔" : "FAILED ✘"}  断言 ${checks.length} 项，失败 ${failed.length} 项`
);
process.exit(failed.length === 0 ? 0 : 1);
