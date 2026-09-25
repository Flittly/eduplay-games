/**
 * 月相数据层单测（`node scripts/moonPhase.test.cjs`）。
 *
 * 跑之前必须先重新生成 CJS：
 *   node_modules/.bin/rolldown src/moonPhase.ts --format cjs --file scripts/_moonPhase.cjs
 * 这一步由 package.json 的 `test:data` 串起来，别手抄旧产物。
 *
 * 为什么这些断言值得写：月相是「差一个符号就整体左右翻转」的几何，
 * 渲染图上看起来都"像个弯月"，只有把角度与方向钉死才能查出来。
 */
const assert = require("node:assert/strict");
const M = require("./_moonPhase.cjs");

const T = M.SYNODIC_MONTH;
let pass = 0;
const reds = [];

function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    reds.push(name);
    console.log(`  ✘ ${name}\n      ${err.message}`);
  }
}

function close(a, b, tol = 1e-9) {
  assert.ok(Math.abs(a - b) <= tol, `期望 ${b}，实际 ${a}（容差 ${tol}）`);
}

console.log("— 月龄归一化 —");
check("新月 0 天保持 0", () => close(M.normalizeAge(0), 0));
check("满一个朔望月折回 0", () => close(M.normalizeAge(T), 0));
check("负数月龄折到同一个月内", () => close(M.normalizeAge(-1), T - 1));
check("超过一个周期的月龄折回", () => close(M.normalizeAge(T + 5), 5));
check("NaN 兜底为 0", () => close(M.normalizeAge(Number.NaN), 0));

console.log("— 受照比例（从地球看到的亮面占比）—");
check("新月受照 0", () => close(M.illumination(0), 0, 1e-12));
check("满月受照 1", () => close(M.illumination(T / 2), 1, 1e-12));
check("上弦月受照 0.5", () => close(M.illumination(T / 4), 0.5, 1e-12));
check("下弦月受照 0.5", () => close(M.illumination((T * 3) / 4), 0.5, 1e-12));
check("受照比例在 [0,1] 内（全域扫 2000 点）", () => {
  let lo = 1;
  let hi = 0;
  for (let i = 0; i <= 2000; i += 1) {
    const k = M.illumination((i / 2000) * T);
    lo = Math.min(lo, k);
    hi = Math.max(hi, k);
  }
  close(lo, 0, 1e-9);
  close(hi, 1, 1e-9);
});
check("前半程（新月→满月）受照比例单调增加", () => {
  let prev = -1;
  for (let i = 0; i <= 500; i += 1) {
    const k = M.illumination((i / 500) * (T / 2));
    assert.ok(k >= prev - 1e-12, `第 ${i} 步回落：${prev} → ${k}`);
    prev = k;
  }
});

console.log("— 月相名与档位 —");
check("8 个档位名齐全", () => assert.equal(M.PHASE_NAMES.length, 8));
check("月龄 0 → 新月", () => assert.equal(M.phaseName(0), "新月（朔）"));
check("月龄 T/4 → 上弦月", () => assert.equal(M.phaseName(T / 4), "上弦月"));
check("月龄 T/2 → 满月", () => assert.equal(M.phaseName(T / 2), "满月（望）"));
check("月龄 3T/4 → 下弦月", () => assert.equal(M.phaseName((3 * T) / 4), "下弦月"));
check("月龄 T/8 → 蛾眉月", () => assert.equal(M.phaseName(T / 8), "蛾眉月"));
check("月龄 3T/8 → 盈凸月", () => assert.equal(M.phaseName((3 * T) / 8), "盈凸月"));
check("月龄 5T/8 → 亏凸月", () => assert.equal(M.phaseName((5 * T) / 8), "亏凸月"));
check("月龄 7T/8 → 残月", () => assert.equal(M.phaseName((7 * T) / 8), "残月"));
check("月龄 29.4（月末）→ 新月，不会漏回残月", () =>
  assert.equal(M.phaseName(29.4), "新月（朔）"));
check("档位索引与八个关键月龄一一对应", () => {
  for (let i = 0; i < 8; i += 1) {
    assert.equal(M.phaseIndex((i * T) / 8), i, `第 ${i} 档`);
  }
});
check("档位索引全程落在 0..7", () => {
  for (let i = 0; i <= 3000; i += 1) {
    const idx = M.phaseIndex((i / 3000) * T);
    assert.ok(idx >= 0 && idx <= 7, `越界：${idx}`);
  }
});

console.log("— 盈亏与亮面朝向 —");
check("月龄 1 天是盈、亮面在右", () => {
  assert.equal(M.isWaxing(1), true);
  assert.equal(M.litSide(1), "right");
});
check("月龄 20 天是亏、亮面在左", () => {
  assert.equal(M.isWaxing(20), false);
  assert.equal(M.litSide(20), "left");
});
check("上弦与下弦受照比例相同、亮面左右相反", () => {
  const up = M.phaseInfo(T / 4);
  const down = M.phaseInfo((3 * T) / 4);
  close(up.illumination, down.illumination, 1e-12);
  assert.notEqual(up.side, down.side);
});
check("亮面朝向与太阳方向的东/西符号一致", () => {
  for (let i = 1; i <= 200; i += 1) {
    const age = (i / 200) * T;
    const s = M.phaseInfo(age);
    // 太阳偏东（x>0）⇒ 亮面在右；偏西（x<0）⇒ 亮面在左
    if (Math.abs(s.sun.x) > 1e-6) {
      assert.equal(s.sun.x > 0 ? "right" : "left", s.side, `月龄 ${age.toFixed(2)}`);
    }
  }
});

console.log("— 太阳方向 —");
check("新月时太阳在月球背面 (0,0,-1)", () => {
  const s = M.sunDirection(0);
  close(s.x, 0, 1e-12);
  close(s.y, 0, 1e-12);
  close(s.z, -1, 1e-12);
});
check("满月时太阳在近地面正上方 (0,0,1)", () => {
  const s = M.sunDirection(T / 2);
  close(s.x, 0, 1e-12);
  close(s.z, 1, 1e-12);
});
check("上弦时太阳偏东（x>0）", () => {
  const s = M.sunDirection(T / 4);
  assert.ok(s.x > 0.999, `x=${s.x}`);
});
check("太阳方向恒为单位向量", () => {
  for (let i = 0; i <= 1000; i += 1) {
    const s = M.sunDirection((i / 1000) * T);
    close(Math.hypot(s.x, s.y, s.z), 1, 1e-12);
  }
});
check("太阳直射经度 = 连续递减值对 360° 取模", () => {
  // 「单调递减」在 ±180 缝合线处必然看起来回升一次，所以不能直接比相邻两点大小。
  // 正确写法：把它和**连续表达式** λc = 180 − 360·月龄/T 对齐后比 —— 这样
  // 既证明「一直在往西走」（λc 恒递减），又证明折返点没算错。
  let prevContinuous = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= 400; i += 1) {
    const age = (i / 400) * T;
    const continuous = 180 - (360 * age) / T;
    assert.ok(continuous < prevContinuous, `第 ${i} 步连续值没有递减`);
    prevContinuous = continuous;
    const got = M.subsolarLongitude(age);
    let diff = got - continuous;
    while (diff > 180) diff -= 360;
    while (diff <= -180) diff += 360;
    assert.ok(Math.abs(diff) < 1e-9, `第 ${i} 步：${got} 与连续值 ${continuous} 差 ${diff}`);
  }
});
check("直射经度值域落在 (-180, 180]", () => {
  for (let i = 0; i <= 2000; i += 1) {
    const l = M.subsolarLongitude((i / 2000) * T);
    assert.ok(l > -180 && l <= 180, `越界：${l}`);
  }
});

console.log("— 相位角 / 角距 / 农历 —");
check("新月相位角 180°、日月角距 0°", () => {
  close(M.phaseAngle(0), 180, 1e-9);
  close(M.elongation(0), 0, 1e-9);
});
check("满月相位角 0°、日月角距 180°", () => {
  close(M.phaseAngle(T / 2), 0, 1e-9);
  close(M.elongation(T / 2), 180, 1e-9);
});
check("月龄 0 约当农历初一", () => assert.equal(M.lunarDay(0), 1));
check("满月约当农历十五", () => assert.equal(M.lunarDay(T / 2), 15));
check("月末约当农历三十", () => assert.equal(M.lunarDay(T - 0.2), 30));
check("农历日恒在 1..30", () => {
  for (let i = 0; i <= 3000; i += 1) {
    const d = M.lunarDay((i / 3000) * T);
    assert.ok(d >= 1 && d <= 30, `越界：${d}`);
  }
});

console.log("— 四个关键相位按钮 —");
check("按钮月龄与档位名一致", () => {
  const want = ["新月（朔）", "上弦月", "满月（望）", "下弦月"];
  M.KEY_PHASES.forEach((p, i) => {
    assert.equal(p.name, want[i]);
    assert.equal(M.phaseName(p.age), want[i]);
  });
});

console.log("— 月面地名 —");
check("每处地名都给得出单位向量", () => {
  for (const f of M.MOON_FEATURES) {
    const d = M.directionFor(f.lat, f.lon);
    close(Math.hypot(d.x, d.y, d.z), 1, 1e-12);
  }
});
check("近地面地名都在前半球（z>0）", () => {
  const near = M.MOON_FEATURES.filter((f) => !f.far);
  assert.ok(near.length >= 7, `近地面地名只有 ${near.length} 个`);
  for (const f of near) {
    const d = M.directionFor(f.lat, f.lon);
    assert.ok(d.z > 0.2, `${f.name} z=${d.z.toFixed(3)} 跑到背面去了`);
  }
});
check("背面地名确实在后半球（z<0）", () => {
  const far = M.MOON_FEATURES.filter((f) => f.far);
  assert.ok(far.length >= 1);
  for (const f of far) {
    assert.ok(M.directionFor(f.lat, f.lon).z < -0.2, `${f.name} 不在背面`);
  }
});
check("东经为正：危海（59.1°E）在雨海（15.6°W）右边", () => {
  const crisium = M.directionFor(17, 59.1);
  const imbrium = M.directionFor(32.8, -15.6);
  assert.ok(crisium.x > imbrium.x, "危海应当更靠东（屏幕右侧）");
});

/* ===========================================================================
 * v1.0.0 新增：轨道几何
 *
 * 这一节的存在理由：`orbitYaw()` 是一个**差一个符号就整体反相**的函数。
 * 把 θ = φ−90° 写成 −φ−90°，屏幕上一样是"月球绕着地球转、永远同一面朝着地球"，
 * 肉眼看不出任何异常 —— 但月相会整体反相（新月变满月），而且只有拿
 * 「世界太阳方向必须恒等于 +X」这条独立事实去对，才咬得住它。
 * =========================================================================== */

/** 绕 Y 轴把向量旋转 theta 弧度（右手系，与 THREE.Matrix4.makeRotationY 同向） */
function rotY(v, theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

function near(v, w, tol, label) {
  assert.ok(
    Math.abs(v.x - w.x) <= tol && Math.abs(v.y - w.y) <= tol && Math.abs(v.z - w.z) <= tol,
    `${label}：期望 (${w.x.toFixed(6)}, ${w.y.toFixed(6)}, ${w.z.toFixed(6)})，` +
      `实际 (${v.x.toFixed(6)}, ${v.y.toFixed(6)}, ${v.z.toFixed(6)})`
  );
}

console.log("— 轨道几何：月球的位置 —");
check("满一圈后回到起点", () => {
  const a = M.orbitPosition(0, 3.6);
  const b = M.orbitPosition(T, 3.6);
  near(a, b, 1e-12, "一个朔望月后");
});
check("新月时月球在日地之间（本地方系的 +X 就是'地球→太阳'的方向）", () => {
  const p = M.orbitPosition(0, 3.6);
  close(p.x, 3.6, 1e-12);
  close(p.y, 0, 1e-12);
  close(p.z, 0, 1e-12);
});
check("满月时月球跑到地球背对太阳的一侧（−X）", () => {
  const p = M.orbitPosition(T / 2, 3.6);
  close(p.x, -3.6, 1e-12);
  close(p.z, 0, 1e-12);
});
check("上弦时月球在 −Z（俯视看是逆时针四分之一圈）", () => {
  const p = M.orbitPosition(T / 4, 3.6);
  close(p.x, 0, 1e-9);
  close(p.z, -3.6, 1e-9);
});
check("轨道恒落在黄道面 y=0 上、半径恒定", () => {
  for (let i = 0; i <= 720; i += 1) {
    const p = M.orbitPosition((i / 720) * T, 3.6);
    close(p.y, 0, 1e-12);
    close(Math.hypot(p.x, p.z), 3.6, 1e-12);
  }
});
check("公转方位角与月龄成正比、值域 0..360", () => {
  close(M.orbitAngle(0), 0, 1e-12);
  close(M.orbitAngle(T / 4), 90, 1e-12);
  close(M.orbitAngle(T / 2), 180, 1e-12);
  for (let i = 0; i <= 2000; i += 1) {
    const a = M.orbitAngle((i / 2000) * T);
    assert.ok(a >= 0 && a < 360, `越界：${a}`);
  }
});

console.log("— 轨道几何：地球公转与自转（v1.4.0：单调时间基 + 真实自转速度）—");
check("地球公转轨道恒在黄道面上、半径恒定（连扫两个月，参数是**累计天数**不是月龄）", () => {
  for (let i = 0; i <= 720; i += 1) {
    const p = M.earthOrbitPosition((i / 720) * 2 * T, 46);
    close(p.y, 0, 1e-12);
    close(Math.hypot(p.x, p.z), 46, 1e-12);
  }
});
check("公转与月球公转**同向**（俯视都是逆时针：方位角都随天数增）", () => {
  const step = T / 48;
  for (let i = 0; i < 48; i += 1) {
    const a = i * step;
    const dMoon = M.orbitAngle(a + step) - M.orbitAngle(a);
    const dEarth =
      ((M.earthOrbitAngle(a + step) - M.earthOrbitAngle(a)) * 180) / Math.PI;
    assert.ok(
      dMoon > 0 && dEarth > 0,
      `天数 ${a.toFixed(2)}：月球 ${dMoon.toFixed(3)}° / 地球 ${dEarth.toFixed(4)}°，方向必须一致`
    );
  }
});
check("一个朔望月里地球公转 ≈29.1°（这就是恒星月≠朔望月的来源）", () => {
  // v1.4.0 起可以直接拿 T 量：时间基是单调的，不再有 normalizeAge 把整周期折成 0 的问题
  //（旧版这里必须"量半周期再翻倍"，那个别扭写法本身就是回卷 bug 的味道）。
  const dDeg = ((M.earthOrbitAngle(T) - M.earthOrbitAngle(0)) * 180) / Math.PI;
  close(dDeg, (360 * T) / 365.25, 1e-12);
  close(dDeg, 29.106, 0.01);
});
check("⚠ 跨朔望月边界时地球公转**连续**（旧实现沿轨道倒跳 29.1°，真机实测那一帧 23.03 单位 / 279 倍）", () => {
  // ① 连续：越过边界的一小步，位置变化也只是一小步
  const eps = 1e-6;
  const before = M.earthOrbitPosition(T - eps, 46);
  const after = M.earthOrbitPosition(T + eps, 46);
  const jump = Math.hypot(after.x - before.x, after.z - before.z);
  assert.ok(jump < 1e-4, `边界处跳了 ${jump.toExponential(2)} 单位（应当只有 1e-5 量级）`);
  // ② 不回卷：走完一个月的地球**不等于**出发时的地球 —— 它已经沿轨道前进了 29.1°
  const start = M.earthOrbitPosition(0, 46);
  const oneMonth = M.earthOrbitPosition(T, 46);
  const chord = Math.hypot(oneMonth.x - start.x, oneMonth.z - start.z);
  close(chord, 46 * 2 * Math.sin((Math.PI * T) / 365.25), 1e-9);
  // 这个弦长就是"旧实现回卷那一帧的瞬移距离"—— 真机探针在 v1.3.0 上量到 23.03，对得上
  assert.ok(chord > 22 && chord < 24, `弦长 ${chord.toFixed(2)} 应当是 23 上下（旧实现就是跳这么远）`);
  // ③ 严格单调：角度只增不减（负天数也照样连续）
  let prev = -Infinity;
  for (let i = -200; i <= 800; i += 1) {
    const v = M.earthOrbitAngle(i / 20);
    assert.ok(v > prev, `第 ${i} 步角度没增：${v} <= ${prev}`);
    prev = v;
  }
});
check("earthFrameYaw = 公转角 + π（把本地 +X 对到'地球→太阳'）", () => {
  for (let i = 0; i <= 200; i += 1) {
    const d = (i / 200) * T;
    close(M.earthFrameYaw(d), M.earthOrbitAngle(d) + Math.PI, 1e-12, `天数 ${d.toFixed(3)}`);
  }
});
check("⚠ 地球自转 = 真实速度：一天（太阳日）相对太阳恰好一圈，恒星日一天 366.25/365.25 圈", () => {
  const S = M.SIDEREAL_PER_DAY;
  close(S, 366.25 / 365.25, 1e-12);
  close(S, 1.002738, 1e-6);
  // ① 恒星日：相对星空一天多转 0.002738 圈
  close(M.earthSpinAngle(1) - M.earthSpinAngle(0), 2 * Math.PI * S, 1e-12);
  // ② 太阳日：自转角增量 − 太阳方位角增量 == **整一圈**（这就是"一天 24 小时"的定义）
  for (const d of [0, 3.7, T / 2, 400, -12.5]) {
    const spin = M.earthSpinAngle(d + 1) - M.earthSpinAngle(d);
    const sunAz = M.earthFrameYaw(d + 1) - M.earthFrameYaw(d); // β = 地球→太阳的方位角
    close(spin - sunAz, 2 * Math.PI, 1e-12, `d=${d}`);
  }
  // ③ 一个朔望月 = 29.53 圈（29.53 个昼夜）—— 与月相的关系是真的，不是凑的
  close((M.earthSpinAngle(T) - M.earthSpinAngle(0)) / (2 * Math.PI), T * S, 1e-12);
  close((M.earthSpinAngle(T) - M.earthSpinAngle(0)) / (2 * Math.PI), 29.61, 0.01);
  assert.ok((M.earthSpinAngle(T) - M.earthSpinAngle(0)) / (2 * Math.PI) > 29.5, "一个月不到 29 圈，说明放慢口径又回来了");
  // ④ 旧口径（一月一圈）应当被明确排除：新速率是它的 29.53 倍
  const oldRate = (2 * Math.PI) / T;
  const newRate = M.earthSpinAngle(1) - M.earthSpinAngle(0);
  close(newRate / oldRate, (T / 1) * S, 1e-9);
  assert.ok(newRate / oldRate > 29, `新速率只有旧口径的 ${(newRate / oldRate).toFixed(2)} 倍，放慢没去掉`);
});
check("⚠ nearestPhaseDays：滑杆拨月龄时地球**连续**走（往前拨=又过一个月，往回拨=退回上个月）", () => {
  // 往前穿过边界：当前 29.4 天，用户拨到 0.2 ⇒ 应当落在 29.53+0.2（继续往前），而不是回到 0.2
  close(M.nearestPhaseDays(0.2, 29.4), T + 0.2, 1e-9);
  // 往回穿过边界：当前 0.2 天，用户拨到 29.4 ⇒ 应当落在 29.4 - T（退回上个月）
  close(M.nearestPhaseDays(29.4, 0.2), 29.4 - T, 1e-9);
  // 同一个月内拨动：原样
  close(M.nearestPhaseDays(7.4, 6.0), 7.4, 1e-9);
  // 相位仍然正确：折回月龄 == 用户要的那个月龄
  for (const cur of [-100, -0.3, 0, 7.38, 29.5, 40.7, 1000.2]) {
    for (const want of [0, 0.001, 14.765, 29.529]) {
      const d = M.nearestPhaseDays(want, cur);
      close(M.normalizeAge(d), M.normalizeAge(want), 1e-9, `cur=${cur} want=${want}`);
      // 且离当前时刻不超过半个月（"最近"这个性质）
      assert.ok(Math.abs(d - cur) <= T / 2 + 1e-9, `cur=${cur} want=${want} 得到 ${d}，离得太远`);
    }
  }
  // 连续推进：天数是单调的（模拟自动推进跨过十个朔望月）
  let days = 0;
  let last = M.earthOrbitAngle(days);
  for (let i = 1; i <= 3000; i += 1) {
    days += T / 300;
    const v = M.earthOrbitAngle(days);
    assert.ok(v > last, `推进第 ${i} 步角度没增（回卷了？）`);
    last = v;
  }
});

console.log("— 三球仪端到端：月相几何在'会动的地球'下仍然成立 —");
/** 月球的世界位置：地心 + R_y(β)·本地轨道位置（与引擎 updateMoonTransform 同一算法） */
function moonWorld(age, moonOrbitR, earthOrbitR) {
  const ep = M.earthOrbitPosition(age, earthOrbitR);
  const lp = rotY(M.orbitPosition(age, moonOrbitR), M.earthFrameYaw(age));
  return { x: ep.x + lp.x, y: ep.y + lp.y, z: ep.z + lp.z };
}
check("新月：月球在日地之间（比地球更靠太阳）", () => {
  const age = 0;
  const m = moonWorld(age, 15, 46);
  const e = M.earthOrbitPosition(age, 46);
  close(Math.hypot(m.x, m.z), 46 - 15, 1e-9, "月日距离应 = 地日距离 − 地月距离");
  const toSun = { x: -e.x, y: 0, z: -e.z };
  const toMoon = { x: m.x - e.x, y: 0, z: m.z - e.z };
  assert.ok(
    toSun.x * toMoon.x + toSun.z * toMoon.z > 0,
    "月球应当在地球的向日侧"
  );
});
check("满月：地球在日地之间（月球到了背日侧）", () => {
  const age = T / 2;
  const m = moonWorld(age, 15, 46);
  const e = M.earthOrbitPosition(age, 46);
  close(Math.hypot(m.x, m.z), 46 + 15, 1e-9, "月日距离应 = 地日距离 + 地月距离");
});
check("任意月龄：月球到**地心**的距离恒为轨道半径（绕的是地球，不是太阳）", () => {
  for (let i = 0; i <= 720; i += 1) {
    const age = (i / 720) * T;
    const m = moonWorld(age, 15, 46);
    const e = M.earthOrbitPosition(age, 46);
    close(Math.hypot(m.x - e.x, m.z - e.z), 15, 1e-9, `月龄 ${age.toFixed(3)}`);
  }
});

console.log("— 轨道几何：潮汐锁定（这一节才是真正的守门人）—");
check("自检：体固系太阳方向按 β+orbitYaw 转到世界系，必须对准'地球→太阳'方向", () => {
  // 这条就是源码注释里那条推导的可执行版本。它不是"再算一遍公式"，
  // 而是拿两个**互相独立**的事实去对：体固系太阳方向 (sinφ,0,−cosφ)
  // 与世界系里指向太阳的方向（日心布局下 = −地球位置的方向）。
  // 只有 θ = φ−90° 加上正确的 β 能让两者重合。
  for (let i = 0; i <= 720; i += 1) {
    const age = (i / 720) * T;
    const sBody = M.sunDirection(age);
    const world = rotY({ x: sBody.x, y: sBody.y, z: sBody.z },
      M.earthFrameYaw(age) + M.orbitYaw(age));
    const e = M.earthOrbitPosition(age, 46);
    const d = Math.hypot(e.x, e.z);
    near(world, { x: -e.x / d, y: 0, z: -e.z / d }, 1e-9, `月龄 ${age.toFixed(3)}`);
  }
});
check("反向也对：把'地球→太阳'方向转回体固系，必须落在 (sinφ,0,−cosφ)", () => {
  for (let i = 0; i <= 720; i += 1) {
    const age = (i / 720) * T;
    const sBody = M.sunDirection(age);
    const e = M.earthOrbitPosition(age, 46);
    const d = Math.hypot(e.x, e.z);
    const back = rotY({ x: -e.x / d, y: 0, z: -e.z / d },
      -(M.earthFrameYaw(age) + M.orbitYaw(age)));
    near(back, sBody, 1e-9, `月龄 ${age.toFixed(3)}`);
  }
});
check("潮汐锁定：近地面中心 (+Z) 恒指向地球（也就是 −P̂）", () => {
  for (let i = 0; i <= 720; i += 1) {
    const age = (i / 720) * T;
    const zWorld = rotY({ x: 0, y: 0, z: 1 }, M.orbitYaw(age));
    const p = M.orbitPosition(age, 3.6);
    const r = Math.hypot(p.x, p.z);
    near(zWorld, { x: -p.x / r, y: 0, z: -p.z / r }, 1e-9, `月龄 ${age.toFixed(3)}`);
  }
});
check("极点朝向不受公转影响：+Y 转过去还是 +Y", () => {
  for (let i = 0; i <= 200; i += 1) {
    const y = rotY({ x: 0, y: 1, z: 0 }, M.orbitYaw((i / 200) * T));
    near(y, { x: 0, y: 1, z: 0 }, 1e-12, `第 ${i} 步`);
  }
});
check("反证：错解 θ = −φ−90° 会被上面那条自检抓住（证明它真的会红）", () => {
  // 这条断言的存在意义是给「自检有效」提供证据。
  // 如果哪天有人把自检写成了同义反复，这条会第一时间变成红。
  let worst = 0;
  for (let i = 0; i <= 720; i += 1) {
    const age = (i / 720) * T;
    const phi = (M.orbitAngle(age) * Math.PI) / 180;
    const wrongYaw = -phi - Math.PI / 2;
    const sBody = M.sunDirection(age);
    // 正确答案：θ = φ−90°（再叠加 β）。错解与正确解的太阳世界方向差必须接近 2 个单位。
    const right = rotY({ x: sBody.x, y: sBody.y, z: sBody.z },
      M.earthFrameYaw(age) + M.orbitYaw(age));
    const wrong = rotY({ x: sBody.x, y: sBody.y, z: sBody.z },
      M.earthFrameYaw(age) + wrongYaw);
    worst = Math.max(worst, Math.hypot(wrong.x - right.x, wrong.y - right.y, wrong.z - right.z));
  }
  assert.ok(worst > 1.9, `错解应当在某处偏出近 2 个单位（实际最大偏差 ${worst.toFixed(3)}）`);
});
check("反证：错解在四分之一月龄处就已经明显跑偏", () => {
  const age = T / 4;
  const phi = (M.orbitAngle(age) * Math.PI) / 180;
  const sBody = M.sunDirection(age);
  const right = rotY({ ...sBody }, M.earthFrameYaw(age) + M.orbitYaw(age));
  const wrong = rotY({ ...sBody }, M.earthFrameYaw(age) - phi - Math.PI / 2);
  const dev = Math.hypot(wrong.x - right.x, wrong.y - right.y, wrong.z - right.z);
  assert.ok(dev > 1.5, `上弦月处错解应当明显跑偏（实际偏差 ${dev.toFixed(3)}）`);
});
check("反证：漏掉 −90° 偏移（θ = φ）同样会被抓住", () => {
  // 这是另一种更"自然"的错法：直接把方位角当月球的偏航角用。
  // 它的问题不是反相，而是 +Z 指向轨道**切向**（月球像在"侧着身子"公转）。
  const age = T / 4;
  const phi = (M.orbitAngle(age) * Math.PI) / 180;
  const zWorld = rotY({ x: 0, y: 0, z: 1 }, phi);
  const p = M.orbitPosition(age, 3.6);
  const r = Math.hypot(p.x, p.z);
  const toEarth = { x: -p.x / r, y: 0, z: -p.z / r };
  const dev = Math.hypot(zWorld.x - toEarth.x, zWorld.y - toEarth.y, zWorld.z - toEarth.z);
  assert.ok(dev > 1, `+Z 应当明显偏离地心方向（实际偏差 ${dev.toFixed(3)}）`);
});
check("两个模式共用一套物理：把'地球→太阳'方向转进体固系，两个模式结果相同", () => {
  // 「月球特写」模式姿态是单位阵 ⇒ 体固系＝世界系，太阳方向就是 sunDirection()。
  // 「日地月系统」模式则要先按 β+orbitYaw 转一次。这一条把两个模式的说法钉在同
  // 一套数上，防止有人在某个模式里"顺手"换个符号（症状是大屏满月、小窗弯月）。
  for (let i = 0; i <= 360; i += 1) {
    const age = (i / 360) * T;
    const moonMode = M.sunDirection(age);
    const e = M.earthOrbitPosition(age, 46);
    const d = Math.hypot(e.x, e.z);
    const orbitMode = rotY({ x: -e.x / d, y: 0, z: -e.z / d },
      -(M.earthFrameYaw(age) + M.orbitYaw(age)));
    near(orbitMode, moonMode, 1e-9, `月龄 ${age.toFixed(3)}`);
  }
});

console.log("— 月面站点清单（v1.0.0 扩到 14 处）—");
check("站点总数 14、中国探月 5 处", () => {
  assert.equal(M.MOON_FEATURES.length, 14);
  assert.equal(M.MOON_FEATURES.filter((f) => f.kind === "cn").length, 5);
});
check("每一处中国站点都绑定了任务名", () => {
  for (const f of M.MOON_FEATURES.filter((x) => x.kind === "cn")) {
    assert.ok(typeof f.mission === "string" && f.mission.length > 0, `${f.name} 缺 mission`);
  }
});
check("五处中国站点名称齐全", () => {
  const names = M.MOON_FEATURES.filter((f) => f.kind === "cn").map((f) => f.name);
  for (const want of ["嫦娥一号撞月点", "嫦娥三号着陆点", "嫦娥四号着陆点", "嫦娥五号着陆点", "嫦娥六号着陆点"]) {
    assert.ok(names.includes(want), `缺少「${want}」`);
  }
});
check("嫦娥七号尚未发射 ⇒ 不作站点", () => {
  for (const f of M.MOON_FEATURES) {
    assert.ok(!/七号/.test(f.name), `${f.name} 不应该出现在月面上（还没着陆）`);
  }
});
check("中国站点坐标与公布值逐一对齐", () => {
  const want = {
    嫦娥一号撞月点: [-1.5, 52.36],
    嫦娥三号着陆点: [44.1214, -19.5117],
    嫦娥四号着陆点: [-45.5, 177.6],
    嫦娥五号着陆点: [43.0576, -51.9161],
    嫦娥六号着陆点: [-41.6385, -153.9852]
  };
  for (const f of M.MOON_FEATURES.filter((x) => x.kind === "cn")) {
    const [lat, lon] = want[f.name];
    close(f.lat, lat, 1e-9);
    close(f.lon, lon, 1e-9);
  }
});
check("背面标记与经纬度自洽（嫦娥四号/六号在背面，三号/五号在正面）", () => {
  const byName = Object.fromEntries(M.MOON_FEATURES.map((f) => [f.name, f]));
  for (const [name, far] of [
    ["嫦娥四号着陆点", true],
    ["嫦娥六号着陆点", true],
    ["嫦娥三号着陆点", false],
    ["嫦娥五号着陆点", false],
    ["嫦娥一号撞月点", false],
    ["阿波罗11号着陆点", false]
  ]) {
    const f = byName[name];
    assert.ok(f, `找不到 ${name}`);
    assert.equal(Boolean(f.far), far, `${name} 的 far 标记不对`);
    const z = M.directionFor(f.lat, f.lon).z;
    // 阈值取 0.3 而不是 0.5：嫦娥五号（43.06°N / 51.92°W）的 z 只有 0.451，
    // 卡在 0.5 会变成一条恒红的假判据。这里要守的是"在不在前半球"，
    // 不是"离正中心多近"，0.3 已经足够把半球分开。
    assert.ok(far ? z < -0.3 : z > 0.3, `${name} z=${z.toFixed(3)} 与 far=${far} 不符`);
  }
});
check("中国站点无一落在南极-艾特肯盆地以外的错误半球", () => {
  // 嫦娥四号与六号都在南极-艾特肯盆地内，纬度应当都是南纬
  for (const name of ["嫦娥四号着陆点", "嫦娥六号着陆点"]) {
    const f = M.MOON_FEATURES.find((x) => x.name === name);
    assert.ok(f.lat < 0, `${name} 应当在南纬（实际 ${f.lat}）`);
  }
});
check("isLandingSite 只认着陆点两类", () => {
  for (const f of M.MOON_FEATURES) {
    const want = f.kind === "site" || f.kind === "cn";
    assert.equal(M.isLandingSite(f), want, `${f.name}（${f.kind}）判定错误`);
  }
});
check("着陆点总数 = 阿波罗11 + 中国 5 处", () => {
  assert.equal(M.MOON_FEATURES.filter(M.isLandingSite).length, 6);
});
check("每个类别都有颜色与中文名，没有漏配", () => {
  for (const f of M.MOON_FEATURES) {
    assert.ok(M.FEATURE_COLORS[f.kind], `${f.kind} 缺颜色`);
    assert.ok(M.FEATURE_KIND_NAMES[f.kind], `${f.kind} 缺中文名`);
  }
  // 五个类别都真的用上了（否则图例里会出现永远不出现的项）
  const used = new Set(M.MOON_FEATURES.map((f) => f.kind));
  assert.deepEqual([...used].sort(), ["basin", "cn", "crater", "mare", "site"]);
});
check("中国站点颜色与阿波罗站点颜色可区分", () => {
  assert.notEqual(M.FEATURE_COLORS.cn, M.FEATURE_COLORS.site);
});

console.log("— 日地月比例（v1.1.0：天体大小按真实比例，距离压缩，太阳额外缩小）—");

check("真实天文常数与 NASA / IAU 公布值一字不差", () => {
  // 这几个数是整个比例口径的地基，抄错一位后面全错；写下期望值当"外部锚"。
  const R = M.REAL_LUNAR;
  assert.equal(R.earthR, 6371, "地球平均半径 km");
  assert.equal(R.moonR, 1737.4, "月球平均半径 km");
  assert.equal(R.sunR, 696000, "太阳半径 km");
  assert.equal(R.moonDist, 384400, "地月平均距离 km");
  assert.equal(R.sunDist, 149600000, "日地距离 km（1 AU）");
});

check("地球半径 ÷ 月球半径 = 真实比值 3.667（v1.0.0 用的 1.35，两个球看着差不多大）", () => {
  const want = M.REAL_LUNAR.earthR / M.REAL_LUNAR.moonR;
  close(want, 3.667, 1e-3);
  assert.ok(
    Math.abs(M.ORBIT_SCENE.earthR - 1.35) > 1,
    `地球半径还是 v1.0.0 的 1.35（实际 ${M.ORBIT_SCENE.earthR}）`
  );
});

check("两个天体的大小比 = 真实比值（不是手抄一个 3.667 进场景）", () => {
  // 期望值**现算**，不写死 —— 写死的话"源码里 3.667 抄成 3.660"两边一起错、判据照绿。
  close(
    M.ORBIT_SCENE.earthR / M.ORBIT_SCENE.moonR,
    M.REAL_LUNAR.earthR / M.REAL_LUNAR.moonR,
    1e-12
  );
  close(M.ORBIT_SCENE.moonR, 1, 1e-12); // 月球半径是场景的长度基准
});

check("地月距离拉开：场景 15 个（v1.0.0 是 3.6），真实是 60.3 个地球半径", () => {
  close(M.ORBIT_SCENE.moonDist, 15, 1e-12);
  const sceneRatio = M.ORBIT_SCENE.moonDist / M.ORBIT_SCENE.earthR;
  assert.ok(
    sceneRatio > 3.5,
    `场景地月距离只有 ${sceneRatio.toFixed(2)} 个地球半径（v1.0.0 是 2.67，要求明显拉开）`
  );
  close(M.REAL_LUNAR.moonDist / M.REAL_LUNAR.earthR, 60.34, 0.01);
});

check("太阳退远：地日 ÷ 地月 由 v1.1.0 的 2.4 提到 3.07（用户：太阳还要再远一点）", () => {
  close(M.ORBIT_SCENE.sunDist, 46, 1e-12);
  const r = M.ORBIT_SCENE.sunDist / M.ORBIT_SCENE.moonDist;
  close(r, 46 / 15, 1e-9);
  assert.ok(r > 2.8, `地日:/地月 只有 ${r.toFixed(2)}，太阳还是贴着月球轨道`);
});

check("距离确实被压缩了，而且地日压得比地月更狠", () => {
  // 压缩倍数 = 真实倍数 ÷ 场景倍数，是个可以直接读给学生听的量。
  close(M.ORBIT_COMPRESSION.moonDist, 384400 / 1737.4 / 15, 1e-9);
  close(M.ORBIT_COMPRESSION.sunDist, 149600000 / 1737.4 / 46, 1e-9);
  assert.ok(M.ORBIT_COMPRESSION.moonDist > 10, `地月才压了 ${M.ORBIT_COMPRESSION.moonDist}`);
  assert.ok(
    M.ORBIT_COMPRESSION.sunDist > M.ORBIT_COMPRESSION.moonDist,
    "地日应当比地月压得更狠（否则画面里太阳会顶到月球轨道上）"
  );
});

check("太阳是唯一天体半径没按真实比例的（真按比例是 400 个月球半径）", () => {
  const realSunInMoonR = M.REAL_LUNAR.sunR / M.REAL_LUNAR.moonR;
  close(realSunInMoonR, 400.6, 0.1);
  // v1.2.0 太阳加大到 5、v1.4.0 再加大到 13.5（取景换成"装下整条公转轨道"的包络圈，
  // 相机从约 60 退到约 171 ⇒ 世界半径同步放大 2.7 倍，屏幕上才守得住
  // v1.2.0「太阳可以再远一点，然后体积可以更大」）。上限放宽到真实值的 1/20 ——
  // 仍然"缩够了"（差 30 倍），只是不再是 v1.1.0 的 1.7。
  assert.ok(
    M.ORBIT_SCENE.sunR < realSunInMoonR / 20,
    `太阳半径 ${M.ORBIT_SCENE.sunR} 相对真实值 ${realSunInMoonR.toFixed(1)} 没缩够`
  );
  close(M.ORBIT_COMPRESSION.sunRadius, realSunInMoonR / M.ORBIT_SCENE.sunR, 1e-9);
  // v1.2.0：太阳要"更大"—— 画面里得明显压过地球（地球 3.667）
  assert.ok(
    M.ORBIT_SCENE.sunR > M.ORBIT_SCENE.earthR,
    `太阳半径 ${M.ORBIT_SCENE.sunR} 不该比地球 ${M.ORBIT_SCENE.earthR.toFixed(3)} 还小`
  );
  // v1.4.0：左栏文案直接写"这里画成 3.7 倍"（真实 109 倍），这个数必须与场景一致
  close(M.ORBIT_SCENE.sunR / M.ORBIT_SCENE.earthR, 3.68, 0.01);
});

check("三个天体互不穿模：月球在地球外、月球轨道不撞进太阳、太阳吞不掉地月系", () => {
  const S = M.ORBIT_SCENE;
  assert.ok(S.moonDist > S.earthR + S.moonR, `月球轨道 ${S.moonDist} 撞进地球`);
  // 日心布局：月球最靠里时离太阳 = sunDist − moonDist − moonR，必须仍在太阳本体之外
  assert.ok(
    S.sunDist - S.moonDist - S.moonR > S.sunR,
    `月球轨道内缘 ${S.sunDist - S.moonDist - S.moonR} 撞进太阳（半径 ${S.sunR}）`
  );
  assert.ok(S.sunDist > S.sunR + S.earthR, "太阳吞掉了地球");
});

console.log(
  `\n月相数据层：${pass} 通过 / ${reds.length} 红${reds.length ? " → " + reds.join(" | ") : ""}`
);
process.exit(reds.length ? 1 : 0);
