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

/* ===== 10) labelCandidates / majorLabelCandidates：三维高程注记的候选点 ===== */
{
  /** 造一条折线：flat = [x0,y0, x1,y1, ...] */
  const line = (flat, closed = false) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < flat.length; i += 2) {
      x0 = Math.min(x0, flat[i]); x1 = Math.max(x1, flat[i]);
      y0 = Math.min(y0, flat[i + 1]); y1 = Math.max(y1, flat[i + 1]);
    }
    return { pts: Float32Array.from(flat), closed, bbox: [x0, y0, x1, y1] };
  };

  // 100 个点、间距 1 的水平直线：每个窗口一样水平也一样长 ⇒ 分数全等，
  // 稳定排序下按 k 递增取点。win=4、count=9 ⇒ minSep = floor(100/10) = 10。
  const flat = [];
  for (let k = 0; k < 100; k++) flat.push(k, 0);
  const cands = ct.labelCandidates(line(flat), 4, 9);
  check("labelCandidates：水平直线上取满 9 个候选", cands.length === 9, String(cands.length));
  check("labelCandidates：候选全部落在折线上（y = 0）", cands.every((c) => c.y === 0),
    cands.map((c) => c.y).join(","));
  // 落点 = 该窗口两端的中点 ⇒ x = 2, 12, 22, …, 82（手算值）
  const xs = cands.map((c) => c.x);
  check("labelCandidates：x = 2,12,…,82（窗口中点，手算值）",
    xs.length === 9 && xs.every((x, i) => Math.abs(x - (2 + i * 10)) < 1e-4), xs.join(","));

  /*
   * 候选之间必须**真的隔开**。
   *
   * 第一版没有这道约束：打分最高的前几名全落在同一个弯里，等于只有一个候选
   * —— "挑一个离已放的注记最远的"就挑不动了，高空那几级的数字照样叠在一起。
   */
  let minGap = Infinity;
  for (let i = 1; i < xs.length; i++) minGap = Math.min(minGap, xs[i] - xs[i - 1]);
  check("labelCandidates：相邻候选在折线上隔 ≥ floor(100/10) = 10", minGap >= 10 - 1e-4,
    `最小 ${minGap.toFixed(3)}`);

  /*
   * 竖直线：一个"水平窗口"都挑不出来（分数全负），但**不能因此返回空**
   * —— 陡坡上的等高线整条都竖，返回空就是"这座山一个数字都不标"。
   */
  const vflat = [];
  for (let k = 0; k < 100; k++) vflat.push(0, k);
  const vc = ct.labelCandidates(line(vflat), 4, 9);
  check("labelCandidates：竖直线上仍给出 9 个候选（不因分数低就静默返回空）",
    vc.length === 9, String(vc.length));
  check("labelCandidates：竖直线上的候选 x 全为 0（仍落在折线上）",
    vc.every((c) => c.x === 0), vc.map((c) => c.x).join(","));

  // 边界：折线太短 / count < 1 ⇒ 空数组（不是抛错）
  check("labelCandidates：折线点数 ≤ win 时返回空",
    ct.labelCandidates(line([0, 0, 1, 1, 2, 2]), 4, 9).length === 0);
  check("labelCandidates：count < 1 时返回空",
    ct.labelCandidates(line(flat), 4, 0).length === 0);
  // count 只是**上限**，实际个数还受"折线上有几个窗口"约束：100 点、win=4 ⇒ 96 个窗口
  check("labelCandidates：count 超过窗口数时按实际窗口数封顶（96）",
    ct.labelCandidates(line(flat), 4, 999).length === 96,
    String(ct.labelCandidates(line(flat), 4, 999).length));

  const mk = (level, pts) => ({ level, polylines: [line(pts)], segCount: 1, totalLen: 1 });
  const ladder = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map((v) => mk(v, flat));

  const majors = ct.majorLabelCandidates(ladder, 100, 5, 3);
  check("majorLabelCandidates：只留 500 的整数倍（计曲线），不是每条等高线都标",
    majors.length > 0 && majors.every((m) => m.level % 500 === 0),
    majors.map((m) => m.level).join(",") || "空");
  check("majorLabelCandidates：计曲线一条不漏（500 与 1000，共 2 级）",
    majors.length === 2, majors.map((m) => m.level).join(",") || "空");
  check("majorLabelCandidates：按高程**从高到低**排（高的先挑位置，峰顶读数不被挤到边角）",
    majors.length === 2 && majors[0].level === 1000 && majors[1].level === 500,
    majors.map((m) => m.level).join(",") || "空");
  check("majorLabelCandidates：每级带上 perLevel 个候选",
    majors.length === 2 && majors.every((m) => m.cands.length === 3),
    majors.map((m) => m.cands.length).join(",") || "空");

  const asc = [500, 1000].map((v) => mk(v, flat));
  check("majorLabelCandidates：与输入顺序无关（升序进来也降序出去）",
    ct.majorLabelCandidates(asc, 100, 5, 3).map((m) => m.level).join(",") === "1000,500",
    ct.majorLabelCandidates(asc, 100, 5, 3).map((m) => m.level).join(","));

  /*
   * 浮点容差：高程是从高度场插值出来的，难免带 1e-7 级误差。
   * 判据若写成 `level % majorSpan === 0`，差一点点就会**整级漏标**（一声不响）。
   */
  check("majorLabelCandidates：1e-6 以内的浮点误差不会漏掉一整级",
    ct.majorLabelCandidates([mk(500.0000004, flat), mk(999.9999996, flat)], 100, 5, 3).length === 2,
    String(ct.majorLabelCandidates([mk(500.0000004, flat), mk(999.9999996, flat)], 100, 5, 3).length));
  check("majorLabelCandidates：真的偏了 1 m 就不算计曲线",
    ct.majorLabelCandidates([mk(501, flat)], 100, 5, 3).length === 0,
    String(ct.majorLabelCandidates([mk(501, flat)], 100, 5, 3).length));

  // 折线太短的计曲线 ⇒ **整级不出现**，不留一个 `cands: []` 的条目
  // （engine 那边靠"条目存在"判断要不要推给视图，空条目会推出一层空注记）
  check("majorLabelCandidates：折线太短的计曲线整级不出现（不留空 cands 条目）",
    ct.majorLabelCandidates([mk(500, [0, 0, 1, 1, 2, 2])], 100, 5, 3).length === 0,
    String(ct.majorLabelCandidates([mk(500, [0, 0, 1, 1, 2, 2])], 100, 5, 3).length));

  // 默认参数必须就是那个常量 —— 否则工程量里会有第二个 "5"
  const def = ct.majorLabelCandidates(ladder, 100);
  const exp = ct.majorLabelCandidates(ladder, 100, ct.CONTOUR_MAJOR_EVERY);
  check("majorLabelCandidates：默认 majorEvery 与 CONTOUR_MAJOR_EVERY 同源（口径只有一处）",
    def.length === exp.length && def.every((m, i) => m.level === exp[i].level && m.cands.length === exp[i].cands.length),
    `CONTOUR_MAJOR_EVERY=${ct.CONTOUR_MAJOR_EVERY}`);

  /*
   * 走一遍**真实提取路径**（`extractContour` 出来的折线，不是手搓的直线）。
   *
   * 圆锥地形是少数"半径可以直接手算"的形状：h = 3000 − 100·r ⇒
   * 高程 L 的等高线就是半径 (3000 − L)/100 的圆。于是可以断言
   * **每个候选点都落在它那一级的环上** —— 这是"候选确实取自该级等高线"
   * 的直接证据（只断言"候选非空"证明不了它没取错环）。
   */
  const n = 48;
  const cc = (n - 1) / 2;
  const cone = (i, j) => Math.max(0, 3000 - Math.hypot(i - cc, j - cc) * 100);
  const coneLevels = ct.levelsFor(0, 3000, 100, 0).map((L) => ct.extractContour(cone, n, L));
  const coneMajors = ct.majorLabelCandidates(coneLevels, 100, 5, 5);
  let maxRadErr = 0;
  for (const m of coneMajors) {
    const want = (3000 - m.level) / 100;
    for (const p of m.cands) {
      maxRadErr = Math.max(maxRadErr, Math.abs(Math.hypot(p.x - cc, p.y - cc) - want));
    }
  }
  check("真实提取（圆锥）：候选确实取自计曲线（每级至少 4 档）",
    coneMajors.length >= 4, `${coneMajors.length} 档：${coneMajors.map((m) => m.level).join(",")}`);
  check("真实提取（圆锥）：只取 500 的整数倍那几级",
    coneMajors.every((m) => m.level % 500 === 0), coneMajors.map((m) => m.level).join(","));
  check("真实提取（圆锥）：每个候选点都落在它那一级的环上（半径 =（3000 − 高程）/100）",
    maxRadErr < 1.5, `最大半径偏差 ${maxRadErr.toFixed(3)} 格`);
}

/* ===== 11) isMajorLevel / majorLevels：计曲线口径（标数字与铺切面共用一处） ===== */
{
  check("isMajorLevel：等高距 100、每 5 条一条 ⇒ 500 的整数倍",
    ct.isMajorLevel(0, 100, 5) && ct.isMajorLevel(500, 100, 5) && ct.isMajorLevel(1000, 100, 5));
  check("isMajorLevel：非整数倍一律不算（100/200/300/400/600 都不是计曲线）",
    ![100, 200, 300, 400, 600].some((L) => ct.isMajorLevel(L, 100, 5)));
  check("isMajorLevel：默认 majorEvery 就是 CONTOUR_MAJOR_EVERY（口径只有一处）",
    ct.isMajorLevel(500, 100) === ct.isMajorLevel(500, 100, ct.CONTOUR_MAJOR_EVERY) &&
      ct.CONTOUR_MAJOR_EVERY === 5,
    `CONTOUR_MAJOR_EVERY=${ct.CONTOUR_MAJOR_EVERY}`);
  /*
   * 浮点容差。`level` 是 `k · interval` 累加出来的，200 m 这一档上
   * `5 × 200` 落成 `999.9999999999995` —— 判据若写成 `level % span === 0`
   * 会**整级漏判**，而症状是"切面少了一层"，最难联想到取模。
   */
  check("isMajorLevel：1e-6 以内的浮点误差仍判为计曲线",
    ct.isMajorLevel(500.0000004, 100, 5) && ct.isMajorLevel(999.9999996, 100, 5),
    `999.9999999999995 ⇒ ${ct.isMajorLevel(999.9999999999995, 200, 5)}`);
  check("isMajorLevel：真的偏了 1 m 就不算",
    !ct.isMajorLevel(501, 100, 5) && !ct.isMajorLevel(499, 100, 5));

  /*
   * 造一个 ContourLevel：`hasLine` 决定有没有交线。
   *
   * 折线取**100 个点**的直线 —— 不能只给两点：`labelCandidates` 要求
   * 点数 ≥ `win + 1`（默认 5），两点的折线在注记那边会被判为"太短"，
   * 于是下面那条"两个口径指向同一批层"的交叉判据会两边都空、**假绿**。
   */
  const flat2 = [];
  for (let k = 0; k < 100; k++) flat2.push(k, 0);
  const mkLv = (level, hasLine) => ({
    level,
    polylines: hasLine
      ? [{ pts: Float32Array.from(flat2), closed: false, bbox: [0, 0, 99, 0] }]
      : [],
    segCount: hasLine ? 1 : 0,
    totalLen: hasLine ? 99 : 0
  });
  const ladder2 = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map((L) => mkLv(L, true));
  check("majorLevels 夹具自身有效（折线够长，注记侧不会因\"太短\"而空）",
    ct.majorLabelCandidates(ladder2, 100, 5, 3).length === 2,
    String(ct.majorLabelCandidates(ladder2, 100, 5, 3).length));

  check("majorLevels：只留 500 的整数倍（计曲线），细线一层不铺",
    ct.majorLevels(ladder2, 100, 5).join(",") === "1000,500",
    ct.majorLevels(ladder2, 100, 5).join(",") || "空");
  check("majorLevels：从高到低（切面自上而下铺，与读图顺序一致）",
    ct.majorLevels([mkLv(500, true), mkLv(1000, true)], 100, 5).join(",") === "1000,500",
    ct.majorLevels([mkLv(500, true), mkLv(1000, true)], 100, 5).join(","));
  check("majorLevels：与输入顺序无关（升序进来也降序出去）",
    ct.majorLevels([...ladder2].reverse(), 100, 5).join(",") === "1000,500",
    ct.majorLevels([...ladder2].reverse(), 100, 5).join(","));
  /*
   * `extractAll` 对传入的**每一个**高度都返回一个 ContourLevel，哪怕一条交线都没有
   * （高于山顶的那一级就是这样）。给它铺一块水平面 = 山顶上方悬着一块空板子。
   */
  check("majorLevels：没有交线的那一级不铺（否则山顶上空悬一块板子）",
    ct.majorLevels([mkLv(1000, true), mkLv(500, false)], 100, 5).join(",") === "1000",
    ct.majorLevels([mkLv(1000, true), mkLv(500, false)], 100, 5).join(",") || "空");
  check("majorLevels：空输入 → 空（不铺任何切面）", ct.majorLevels([], 100, 5).length === 0);
  check("majorLevels：默认 majorEvery 与 CONTOUR_MAJOR_EVERY 同源",
    ct.majorLevels(ladder2, 100).join(",") === ct.majorLevels(ladder2, 100, ct.CONTOUR_MAJOR_EVERY).join(","),
    ct.majorLevels(ladder2, 100).join(","));
  /*
   * 两个口径**必须指向同一批层**：数字标在 3000 而切面铺在 2500 是
   * "画面正常、知识点自相矛盾"的错，机器不查就没人会发现。
   */
  check("majorLevels 与 majorLabelCandidates 指向同一批层（同源）",
    ct.majorLevels(ladder2, 100, 5).join(",") ===
      ct.majorLabelCandidates(ladder2, 100, 5, 3).map((m) => m.level).join(","),
    `${ct.majorLevels(ladder2, 100, 5).join(",")} vs ` +
      ct.majorLabelCandidates(ladder2, 100, 5, 3).map((m) => m.level).join(","));

  /*
   * 真实提取路径（圆锥）交叉验证 —— 与第 10 段的圆锥同一口径。
   * 断言的是"**有数字的那一层一定有切面**"：反过来（有切面没数字）是允许的，
   * 因为数字会因屏幕上放不下而被丢掉几条（见 `view3d.setContourLabels`），
   * 而切面没有这个约束。
   */
  const cn = 48;
  const ccc = (cn - 1) / 2;
  const coneShape = (i, j) => Math.max(0, 3000 - Math.hypot(i - ccc, j - ccc) * 100);
  const coneLv = ct.levelsFor(0, 3000, 100, 0).map((L) => ct.extractContour(coneShape, cn, L));
  const sliceLv = ct.majorLevels(coneLv, 100, 5);
  const candLv = ct.majorLabelCandidates(coneLv, 100, 5, 5).map((m) => m.level);
  check("真实提取（圆锥）：切面层级 ⊇ 数字注记层级（有数字的那层一定有面）",
    candLv.every((L) => sliceLv.includes(L)), `面 ${sliceLv.join(",")} / 字 ${candLv.join(",")}`);
  check("真实提取（圆锥）：切面层级严格从高到低",
    sliceLv.every((L, i) => i === 0 || sliceLv[i - 1] > L), sliceLv.join(","));
  check("真实提取（圆锥）：切面层级全是 500 的整数倍",
    sliceLv.length >= 4 && sliceLv.every((L) => L % 500 === 0), sliceLv.join(",") || "空");
}

/* ===== 汇总 ===== */
const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "✔" : "✘"} ${c.name}${c.extra ? `  ${c.extra}` : ""}`);
}
console.log(`\nCONTOUR CHECK ${failed.length === 0 ? "PASSED ✔" : "FAILED ✘"}  断言 ${checks.length} 项，失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
