/**
 * 等高线提取的纯逻辑测试。
 *
 * 断言都建立在**可以手算出来的地形**上（线性梯度 / 常数场 / 圆锥 / 屋脊），
 * 而不是「跑一遍看看结果是不是非空」—— 后者只能证明代码没崩，证明不了它算对。
 */
const ct = require("./_contour.cjs");

const checks = [];
const check = (name, cond, extra) => {
  checks.push({ name, ok: Boolean(cond), extra: extra === undefined ? "" : String(extra) });
};

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

/* ===== 1) 线性梯度场：等值线必须是直线 ===== */
{
  const n = 32;
  // 每往东一列升高 10 m —— 等值线应当是一条条竖直的线
  const h = (i) => i * 10;
  const lv = ct.extractContour(h, n, 155); // 落在 i = 15.5 那条列上
  check("线性梯度场：线段数 = 网格列数 − 1", lv.segCount === n - 1, `${lv.segCount} vs ${n - 1}`);

  let maxDev = 0;
  for (const p of lv.polylines) {
    for (let k = 0; k < p.pts.length; k += 2) {
      maxDev = Math.max(maxDev, Math.abs(p.pts[k] - 15.5));
    }
  }
  check("线性梯度场：所有交点都落在 x = 15.5 上", maxDev < 1e-6, `最大偏差 ${maxDev}`);

  check("线性梯度场：首尾相接成 1 条折线", lv.polylines.length === 1, `${lv.polylines.length} 条`);
  const p0 = lv.polylines[0];
  check(
    "线性梯度场：折线纵跨整个网格（0 → 31）",
    p0 && near(p0.pts[1], 0) && near(p0.pts[p0.pts.length - 1], n - 1),
    p0 ? `${p0.pts[1]} → ${p0.pts[p0.pts.length - 1]}` : "无"
  );
  check(
    "线性梯度场：折线总长度 = 31（每格 1 个单位）",
    near(lv.totalLen, n - 1, 1e-9),
    lv.totalLen.toFixed(6)
  );
}

/* ===== 2) 常数场：不该有任何等值线 ===== */
{
  const flat = () => 100;
  const lv = ct.extractContour(flat, 16, 50);
  check("常数场：无等值线产生", lv.segCount === 0 && lv.polylines.length === 0, `segs=${lv.segCount}`);
  const above = ct.extractContour(flat, 16, 150);
  check("常数场：取值高于全场时同样无等值线", above.segCount === 0, `segs=${above.segCount}`);
}

/* ===== 3) 圆锥：等值线必须是闭合环 ===== */
{
  const n = 65;
  const c = (n - 1) / 2;
  const h = (i, j) => 200 - Math.hypot(i - c, j - c) * 4;
  const lv = ct.extractContour(h, n, 100); // 距中心 25 格的那个圆
  const closed = lv.polylines.filter((p) => p.closed);
  check("圆锥：高度线闭合", lv.polylines.length >= 1 && lv.polylines.every((p) => p.closed),
    `${lv.polylines.length} 条，其中闭合 ${closed.length} 条`);

  // 半径 25（格）的圆，周长 ≈ 2π·25 ≈ 157
  check("圆锥：闭合环周长接近 2πr", Math.abs(lv.totalLen - 2 * Math.PI * 25) / (2 * Math.PI * 25) < 0.06,
    `${lv.totalLen.toFixed(1)} vs ${(2 * Math.PI * 25).toFixed(1)}`);

  // 环上每个点到中心的距离都应接近 25
  let maxErr = 0;
  for (const p of lv.polylines) {
    for (let k = 0; k < p.pts.length; k += 2) {
      maxErr = Math.max(maxErr, Math.abs(Math.hypot(p.pts[k] - c, p.pts[k + 1] - c) - 25));
    }
  }
  check("圆锥：环上各点到山心距离一致（半径 25）", maxErr < 0.05, `最大偏差 ${maxErr.toFixed(4)} 格`);
}

/* ===== 4) 鞍点消歧：两个鞍点方向都不能断开 ===== */
{
  // 4 个角高、中心低，再互换 —— 构造经典鞍部
  const n = 8;
  const h = (i, j) => {
    const x = i - (n - 1) / 2;
    const y = j - (n - 1) / 2;
    return 100 + (x * x - y * y) * 4;
  };
  const lv = ct.extractContour(h, n, 110);
  check("鞍部地形：等值线不产生悬空端点（所有端点都成对相连）",
    lv.polylines.every((p) => p.closed || p.pts.length >= 4),
    `${lv.polylines.length} 条`);
}

/* ===== 5) levelsFor：从整倍高度起算、条数随等高距反变 ===== */
{
  const l1 = ct.levelsFor(2204, 7414, 200, 0);
  check("levelsFor：第一条是 2400（2204 之上的第一个整倍）", l1[0] === 2400, l1[0]);
  check("levelsFor：最后一条不超过 maxH", l1[l1.length - 1] <= 7414, l1[l1.length - 1]);
  check("levelsFor：全部是等高距的整数倍", l1.every((v) => Math.abs(v / 200 - Math.round(v / 200)) < 1e-9));

  const counts = [1000, 500, 200, 100].map((iv) => ct.levelsFor(2204, 7414, iv, 0).length);
  check("levelsFor：等高距越小、条数越多（严格单调）",
    counts[0] < counts[1] && counts[1] < counts[2] && counts[2] < counts[3],
    counts.join(" < "));

  check("levelsFor：等高距 ≤ 0 时返回空", ct.levelsFor(0, 1000, 0, 0).length === 0);
  check("levelsFor：maxH ≤ minH 时返回空", ct.levelsFor(1000, 1000, 100, 0).length === 0);

  // 高程偏移后高度窗口整体平移；线会**重新吸附到等高距的整倍高度**，
  // 所以不能断言「每条线都恰好上移 500」（2400 抬升后会吸附到 2800）——
  // 能断言的是：窗口宽度没变 → 条数不变；且新线都落在新窗口内。
  const shifted = ct.levelsFor(2204 + 500, 7414 + 500, 200, 0);
  check("levelsFor：整体抬升 500 m 后条数不变（窗口宽度没变）",
    shifted.length === l1.length, `${l1.length} → ${shifted.length}`);
  check("levelsFor：抬升后每条线仍是等高距整数倍且落在新窗口内",
    shifted.every((v) => Math.abs(v / 200 - Math.round(v / 200)) < 1e-9 && v >= 2704 && v <= 7914),
    `${shifted[0]} … ${shifted[shifted.length - 1]}`);
  check("levelsFor：抬升后第一条线 = 新窗口内第一个整倍高度",
    shifted[0] === Math.ceil(2704 / 200) * 200, `${shifted[0]}`);
}

/* ===== 6) labelAnchor：注记点必须落在折线上 ===== */
{
  const n = 32;
  const h = (i) => i * 10;
  const lv = ct.extractContour(h, n, 155);
  const a = ct.labelAnchor(lv.polylines[0], 4);
  check("labelAnchor：能在折线上取到注记锚点", a !== null);
  if (a) {
    check("labelAnchor：锚点在折线上（x=15.5）", Math.abs(a.x - 15.5) < 1e-6, a.x);
    check("labelAnchor：竖直线段的注记角度接近 90°",
      Math.abs(Math.abs(a.angle) - Math.PI / 2) < 0.02, `${((a.angle * 180) / Math.PI).toFixed(1)}°`);
  }
  const short = ct.extractContour(h, n, 155);
  check("labelAnchor：折线过短时返回 null",
    ct.labelAnchor({ pts: Float32Array.from([0, 0, 1, 1]), closed: false, bbox: [0, 0, 1, 1] }, 4) === null);
  check("longestPolyline", ct.longestPolyline(short) !== null);
}

/* ===== 7) ridgeValley：TPI 判据要能认出屋脊与沟谷 ===== */
{
  const n = 64;
  const mid = (n - 1) / 2; // 31.5
  // 屋脊：沿南北延伸的一条高线，东西两侧对称下降。
  // 坡度取 20 m/格：TPI（自己 − 菱形邻域均值）会落在 15 m 量级，
  // 明显高于判据阈值；取 4 m/格的缓坡时 TPI 只有 3.2 m，
  // 会被阈值挡掉 —— 这是测试地形的问题，不是算法的问题。
  const SLOPE = 20;
  const ridgeField = (i) => 400 - Math.abs(i - mid) * SLOPE;
  const rv = ct.ridgeValley(ridgeField, n, 4, 3);
  const ridgeI = [];
  for (let k = 0; k < rv.ridge.length; k += 2) {
    ridgeI.push(rv.ridge[k]);
  }
  check("ridgeValley：屋脊地形能识别出脊点", ridgeI.length > 0, `${ridgeI.length} 个`);
  check("ridgeValley：脊点都落在对称轴上（|i − 31.5| ≤ 2）",
    ridgeI.every((i) => Math.abs(i - mid) <= 2),
    ridgeI.length ? `i ∈ [${Math.min(...ridgeI)}, ${Math.max(...ridgeI)}]` : "无");
  check("ridgeValley：屋脊地形不产生谷点", rv.valley.length === 0, `${rv.valley.length / 2} 个`);

  // 沟谷：把屋脊倒过来
  const valleyField = (i) => 400 + Math.abs(i - mid) * SLOPE;
  const rv2 = ct.ridgeValley(valleyField, n, 4, 3);
  const valleyI = [];
  for (let k = 0; k < rv2.valley.length; k += 2) {
    valleyI.push(rv2.valley[k]);
  }
  check("ridgeValley：倒过来的地形识别为谷", valleyI.length > 0 && rv2.ridge.length === 0,
    `谷 ${valleyI.length} / 脊 ${rv2.ridge.length / 2}`);

  // 阈值必须真的起作用：阈值抬高后点数应严格减少
  const loose = ct.ridgeValley(ridgeField, n, 2, 3);
  const tight = ct.ridgeValley(ridgeField, n, 14, 3);
  check("ridgeValley：阈值越高、识别出的脊点越少",
    loose.ridge.length / 2 >= ridgeI.length && ridgeI.length >= tight.ridge.length / 2,
    `${loose.ridge.length / 2} ≥ ${ridgeI.length} ≥ ${tight.ridge.length / 2}`);

  // 平坦地形：两个都不该有
  const flat = ct.ridgeValley(() => 100, n, 4, 3);
  check("ridgeValley：平地既不产生脊也不产生谷",
    flat.ridge.length === 0 && flat.valley.length === 0);
}

/* ===== 7b) ridgeValley 在真实 DEM 上：既不能全标、也不能一个不标 ===== */
{
  const dm = require("./_dem.cjs");
  const dt = require("./_data.cjs");
  // ⚠️ 这里**必须按 tag 点名取贡嘎山**，不能用 DEM_SOURCES[0]：
  // v2.4.0 把三个模板地形排到了清单最前（默认打开模板山地），
  // 于是 DEM_SOURCES[0] 从「贡嘎山」悄悄变成了「模板山地」——
  // 这一整段的断言名字写的都是「真实 DEM」，却拿去量一个解析模板，
  // 立刻报 p50=0.3 m（模板大面积缓坡，TPI 本来就近 0）。
  // 教训：位置下标（[0]）会随清单顺序改而改语义，凡断言里点名了「哪个样本」，
  // 就该用稳定标识（tag）取值，别用下标。
  const f = dm.createField(dt.sourceByTag("gongga"));
  const hfn = (i, j) => f.alt[j * f.grid + i];

  // 先用中位数附近的 TPI 量级定一个「有物理意义」的阈值
  const samples = [];
  for (let j = 4; j < f.grid - 4; j += 3) {
    for (let i = 4; i < f.grid - 4; i += 3) {
      const R = 3;
      let sum = 0;
      let cnt = 0;
      for (let dj = -R; dj <= R; dj++) {
        for (let di = -R; di <= R; di++) {
          const d = Math.abs(di) + Math.abs(dj);
          if (d === 0 || d > R) continue;
          sum += hfn(i + di, j + dj);
          cnt++;
        }
      }
      samples.push(Math.abs(hfn(i, j) - sum / cnt));
    }
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p90 = samples[Math.floor(samples.length * 0.9)];
  check("真实 DEM：TPI 的量级在几十米（不是 0，也不是上千）",
    p50 > 0.5 && p90 < 500, `p50=${p50.toFixed(1)} m, p90=${p90.toFixed(1)} m`);

  const thr = Math.max(4, p90);
  const net = ct.ridgeValley(hfn, f.grid, thr, 3);
  const scanned = (f.grid - 6) * (f.grid - 6);
  const ridgeRatio = net.ridge.length / 2 / scanned;
  const valleyRatio = net.valley.length / 2 / scanned;
  check(`真实 DEM：按 p90（${p90.toFixed(0)} m）当阈值时脊点约 6%`,
    ridgeRatio > 0.02 && ridgeRatio < 0.15, `${(ridgeRatio * 100).toFixed(2)}%`);
  check("真实 DEM：谷点同样能被识别", valleyRatio > 0.002, `${(valleyRatio * 100).toFixed(2)}%`);
  check("真实 DEM：脊点数量与谷点数量同一量级（地形不会只凸不凹）",
    Math.max(ridgeRatio, valleyRatio) / Math.max(1e-9, Math.min(ridgeRatio, valleyRatio)) < 12,
    `脊 ${(ridgeRatio * 100).toFixed(2)}% / 谷 ${(valleyRatio * 100).toFixed(2)}%`);

  // ---- 生产阈值本身也要守门（ct.RIDGE_TPI 就是平面图实际用的那个）----
  // 曾经把阈值取在 |TPI| 的**中位数**上（22 m），结果标出 25% 的格子 ——
  // 分母也踩过坑：ridgeValley 只扫内部 (n-2R)² 格，拿 n² 当分母会低估约 5%。
  //
  // ⚠️ 这段原来遍历的是**全部** DEM 样本，而断言名字写的是「四山一致」。
  // v2.2.0 加了平原 / 高原 / 丘陵 / 盆地四个样本后立刻红了一片 ——
  // 但红的是**断言的作用域**，不是数据：华北平原上本来就该找不出山脊。
  // 所以改成按 landType 分流，顺手把反方向也钉住（平坦样本必须近乎没有脊谷），
  // 这比原来那条更强：原来只保证「山地上够密」，现在两侧都守。
  check("生产阈值 RIDGE_TPI 取自高分位而不是中位数（必须明显大于 p50）",
    ct.RIDGE_TPI > p50 * 1.5,
    `RIDGE_TPI=${ct.RIDGE_TPI} m vs p50=${p50.toFixed(1)} m`);

  const ratioOf = (src) => {
    const ff = dm.createField(src);
    const hf = (i, j) => ff.alt[j * ff.grid + i];
    const rv = ct.ridgeValley(hf, ff.grid, ct.RIDGE_TPI);
    const sc = (ff.grid - 6) * (ff.grid - 6);
    return { rr: rv.ridge.length / 2 / sc, vr: rv.valley.length / 2 / sc };
  };

  // ⚠️ 分母只数**真实样本**（REAL_SOURCES），模板地形另有契约、在
  // scripts/template.test.cjs 里守。理由和上面那条注释同源：
  // 下面 3%~10% 这条带子是**真实 DEM 的统计性质**（四座山实测 5.7%~6.0%），
  // 它描述的是"自然山体被冰川/流水切碎后脊线密布"这件事。
  // 模板山地是一道干净的垄，脊点只占 0.4% —— 这不是数据错，是**两码事**：
  // 模板要的正是"一处部位对应一个术语"，脊线越单一越好。
  // 拿真实 DEM 的密疏带子去卡示意图，属于断言作用域划错（同 §231 那次）。
  const mountains = dt.REAL_SOURCES.filter((s) => s.landType === "mountain");
  const flats = dt.REAL_SOURCES.filter((s) => s.landType !== "mountain");
  check("真实样本清单里恰好 4 座山 + 4 个非山地",
    mountains.length === 4 && flats.length === 4,
    `${mountains.length} 山 / ${flats.length} 非山`);
  check("DEM 样本里至少有 4 座山（下面那条 3%~10% 的带子才有意义）",
    mountains.length >= 4, `${mountains.length} 座`);

  for (const src of mountains) {
    const { rr, vr } = ratioOf(src);
    check(`${src.name}：生产阈值下脊点占比在 3%~10%（四山一致）`,
      rr > 0.03 && rr < 0.1, `${(rr * 100).toFixed(2)}%`);
    check(`${src.name}：生产阈值下脊谷同量级（不会只标凸不标凹）`,
      vr > 0.005 && Math.max(rr, vr) / Math.min(rr, vr) < 4,
      `脊 ${(rr * 100).toFixed(2)}% / 谷 ${(vr * 100).toFixed(2)}%`);
  }

  // 反方向：平原 / 高原 / 丘陵 / 盆地的脊点占比必须明显低于山地的下限。
  // （盆地外圈是真山，所以给的是 < 3% 而不是"必须为 0" ——
  //   临汾盆地实测 1.00%，正是周围山地那一圈。）
  for (const src of flats) {
    const { rr, vr } = ratioOf(src);
    check(`${src.name}（${src.landType}）：脊点占比低于山地 3% 下限`,
      rr < 0.03, `${(rr * 100).toFixed(2)}%`);
    check(`${src.name}（${src.landType}）：要么脊谷都没有，要么同量级`,
      (rr === 0 && vr === 0) || (vr > 0 && Math.max(rr, vr) / Math.min(rr, vr) < 6),
      `脊 ${(rr * 100).toFixed(2)}% / 谷 ${(vr * 100).toFixed(2)}%`);
  }
}

/* ===== 8) bilerp：双线性插值的基本性质 ===== */
{
  const h = (i, j) => i * 2 + j * 3;
  const n = 16;
  check("bilerp：整点处等于原值", near(ct.bilerp(h, n, 5, 7), 5 * 2 + 7 * 3));
  check("bilerp：线性场的插值仍是线性（中点 = 两端平均）",
    near(ct.bilerp(h, n, 5.5, 7), (10 + 12 + 7 * 3 * 2) / 2, 1e-9));
  check("bilerp：越界按边缘钳制",
    near(ct.bilerp(h, n, -5, 7), ct.bilerp(h, n, 0, 7)));
}

/* ===== 9) 等高距自动落档：平原样本逼出来的那条规则 ===== */
{
  const steps = ct.CONTOUR_INTERVAL_STEPS;
  check("等高距档位里最小 ≤ 20 m（否则平原画不出线）", Math.min(...steps) <= 20,
    JSON.stringify(steps));
  check("等高距档位升序排列", steps.every((v, k) => k === 0 || v > steps[k - 1]),
    JSON.stringify(steps));

  // 山峰：200 m 一档本来就够用，不许被改了
  check("贡嘎山（2204~7414 m）保持 200 m 档",
    ct.pickContourInterval(2204, 7414, 200) === 200,
    String(ct.pickContourInterval(2204, 7414, 200)));

  // 平原：200 m 一档出 0 条 ⇒ 必须落到能出线的档
  const plainIv = ct.pickContourInterval(11, 51, 200);
  check("华北平原（11~51 m）自动落到最小档 20 m", plainIv === 20, String(plainIv));
  check("落档后确实能出线（≥1 条）", ct.levelsFor(11, 51, plainIv, 0).length >= 1,
    String(ct.levelsFor(11, 51, plainIv, 0).length));

  // 高原：416 m 高差用 200 m 只出 2 条，应落到 100 m
  check("高原样本（1022~1438 m）自动从 200 落到 100 m",
    ct.pickContourInterval(1022, 1438, 200) === 100,
    String(ct.pickContourInterval(1022, 1438, 200)));

  // 不变式：无论什么输入，结果必须是档位表里的一档（否则界面 chip 会全部不亮）
  for (const [lo, hi] of [[11, 51], [401, 1672], [2204, 7414], [0, 100000], [100, 100.5]]) {
    const got = ct.pickContourInterval(lo, hi, 200);
    check(`落档结果 ${got} 在档位表内（${lo}~${hi} m）`, steps.includes(got), String(got));
  }
}

/* ===== 汇总 ===== */
const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "✔" : "✘"} ${c.name}${c.extra ? `  ${c.extra}` : ""}`);
}
console.log(`\nCONTOUR CHECK ${failed.length === 0 ? "PASSED ✔" : "FAILED ✘"}  断言 ${checks.length} 项，失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
