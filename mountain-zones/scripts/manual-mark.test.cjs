/**
 * 人工标注（v2.4.5）纯逻辑回归。
 * 跑法：`npm run test:data`（会先 rolldown 出 `_landform.cjs` / `_dem.cjs` / `_data.cjs`
 * 与本文件要用的 `_manualmark.cjs`）
 *
 * ## 这个文件守的是人工标注的四条契约
 *
 * 1. **同源契约（最要紧的一条）**：教师标一个点，界面上显示的海拔/坡度/下凹量，
 *    必须与机器检出**同一个格**时的读数一致。这三个 `measure*` 函数是照着
 *    `landform.ts` 逐字搬的，所以本节拿真实检出点做逐值反证 ——
 *    数值一旦分叉，教师标的那处就和程序认出的那处"对不上账"。
 * 2. **存储契约**：只存坐标、不存数值；坏数据一律退回 `null`（而不是半截数据）；
 *    `null`（从没标过）与 `[]`（清空过）必须可区分。
 * 3. **编辑契约**：同类同位置拒重复；点掉只删最近的那个；一键收机器结果有上限。
 * 4. **教学契约**：教师标的"陡崖"若坡度不够，界面要能如实说"这不是陡崖" ——
 *    人工标注是让教师**表达意图**，不是让判据失效。
 *
 * ⚠️ 本文件在 **Node** 下跑，没有 `window`。为此 `manualMark.ts` 里的存储读写
 * 都是"先取 `globalThis.localStorage`"—— 真机上它是 `window.localStorage`，
 * 两者是同一个对象接口。取不到就退化成内存版（只影响 2 节的部分用例）。
 */
const lf = require("./_landform.cjs");
const dem = require("./_dem.cjs");
const data = require("./_data.cjs");
const mm = require("./_manualmark.cjs");

const checks = [];
const check = (name, cond, extra) => {
  checks.push({ name, ok: Boolean(cond), extra: extra === undefined ? "" : String(extra) });
};

/* ================================================================== */
/* 0)存储替身：Node 下没有 window.localStorage                          */
/* ================================================================== */
/*
 * 用 `Object.defineProperty` 挂到 globalThis 上，而不是 `globalThis.localStorage = …`：
 * 后者在严格模式的可写检查上会抛，且真实 `window.localStorage` 本身也是不可直接赋值的
 * 访问器属性。定义成**存取器**（get/set）才与浏览器里的行为一致 ——
 * 这也顺带守住了"代码不能假设 localStorage 是个普通变量"。
 */
function installStorage() {
  const mem = new Map();
  let broken = false;
  const api = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => {
      if (broken) throw new Error("QuotaExceededError");
      mem.set(k, String(v));
    },
    removeItem: (k) => {
      mem.delete(k);
    },
    get length() {
      return mem.size;
    },
    key: (i) => Array.from(mem.keys())[i] ?? null
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => (broken ? null : api)
  });
  return {
    breakIt: () => {
      broken = true;
    },
    heal: () => {
      broken = false;
    },
    size: () => mem.size,
    raw: (k) => (mem.has(k) ? mem.get(k) : null)
  };
}
const store = installStorage();

const SOURCES = data.DEM_SOURCES;

/* ================================================================== */
/* 1) 同源契约：人工测量== 机器测量（逐值）                             */
/* ================================================================== */
console.log("\n== 1) 人工测量的数值与机器检出逐值一致 ==");
{
  let peakChecked = 0;
  let peakBad = 0;
  let cliffChecked = 0;
  let cliffBad = 0;

  for (const src of SOURCES) {
    const f = dem.createField(src);
    const h = dem.heightFn(f);
    const n = f.grid;
    const cellM = f.spanM / (n - 1);
    const marks = lf.landParts(h, n, f.spanM);

    // ---- 峰：h 必须逐值相等（不是近似） ----
    for (const p of marks.peaks) {
      peakChecked++;
      const got = mm.measurePeak(h, p.i, p.j);
      if (Math.abs(got - p.h) > 1e-9) {
        peakBad++;
        if (peakBad <= 3) {
          console.log(`   ✘ ${src.tag} 峰 (${p.i},${p.j}) 人工 ${got} vs 机器 ${p.h}`);
        }
      }
    }

    // ---- 陡崖：坡度/落差/等高线条数三项必须逐值相等 ----
    for (const c of marks.cliffs) {
      cliffChecked++;
      // 机器记的是格中心 (i+0.5, j+0.5)，人工换算回格角再用 —— 同一个四边形
      const got = mm.measureCliff(h, n, cellM, c.i, c.j);
      const same =
        Math.abs(got.slopeDeg - c.slopeDeg) < 1e-9 &&
        Math.abs(got.drop - c.drop) < 1e-9 &&
        got.lines === c.lines;
      if (!same) {
        cliffBad++;
        if (cliffBad <= 3) {
          console.log(
            `   ✘ ${src.tag} 崖 (${c.i},${c.j}) 人工 ${got.slopeDeg.toFixed(3)}°/${got.drop}m/${got.lines}条` +
              ` vs 机器 ${c.slopeDeg.toFixed(3)}°/${c.drop}m/${c.lines}条`
          );
        }
      }
    }
  }
  check("峰的 11 个样本共 " + peakChecked + " 处，人工 h 与机器逐值相等", peakBad === 0, `不一致 ${peakBad} 处`);
  check(
    "陡崖共 " + cliffChecked + " 处，人工坡度/落差/等高线条数与机器逐值相等",
    cliffBad === 0,
    `不一致 ${cliffBad} 处`
  );
  check("峰与崖的核对样本量足够（峰 >30 / 崖 >30）", peakChecked > 30 && cliffChecked > 30,
    `峰 ${peakChecked} / 崖 ${cliffChecked}`);
}

/* ================================================================== */
/* 2) 鞍部：口径不同但必须自洽                                        */
/* ================================================================== */
console.log("== 2) 鞍部的「低于周围最高」口径 ==");
{
  const f = dem.createField(data.sourceByTag("gongga"));
  const h = dem.heightFn(f);
  const n = f.grid;
  let bad = 0;
  let monotoneBad = 0;
  for (let t = 0; t < 200; t++) {
    // 固定撒点（不引随机源：测试产物要可复现）
    const i = 10 + ((t * 37) % (n - 20));
    const j = 10 + ((t * 53) % (n - 20));
    const s = mm.measureSaddle(h, n, i, j);
    // h 必须是该格高程
    if (Math.abs(s.h - h(i, j)) > 1e-9) bad++;
    // drop 必须 ≥ 0（邻域最高必然不低于本点）
    if (s.drop < -1e-9) monotoneBad++;
  }
  check("鞍部 h == 该格高程（200 个固定撒点）", bad === 0, `偏差 ${bad} 个`);
  check("鞍部 drop ≥ 0（邻域最高不低于本点）", monotoneBad === 0, `越界 ${monotoneBad} 个`);

  const marks = lf.landParts(h, n, f.spanM);

  /*
   * 峰位上 `drop` 必然为 0 —— 峰顶自己就是邻域最高，"低于周围最高 0 米"。
   * 这**是正确的物理**，不是缺陷（所以这里钉住的是"为 0"，不是"> 0"）。
   * 真正要验的是反面：**两峰之间的垭口**上 drop 必须为正。
   */
  const peakDrops = marks.peaks.map((p) => mm.measureSaddle(h, n, p.i, p.j).drop);
  check(
    "机器检出的峰位上「低于周围最高」= 0（峰自己就是最高，这是正确的物理）",
    peakDrops.every((d) => d === 0),
    `最大 ${Math.max(...peakDrops)} m`
  );

  // 机器检出的鞍部位上，drop 必须显著为正（那才是"两高点之间的低处"）
  const sadDrops = marks.saddles.map((s) => mm.measureSaddle(h, n, s.i, s.j).drop);
  check(
    "机器检出的鞍部位上「低于周围最高」> 0（这才是鞍部该有的读数）",
    sadDrops.length > 0 && sadDrops.every((d) => d > 0),
    `最小 ${sadDrops.length ? Math.min(...sadDrops).toFixed(0) : "—"} m / 共 ${sadDrops.length} 处`
  );

  /*
   * ⚠️ 人工口径与机器口径**必然不同**，这也是设计决定：
   * 机器拿的是"指定配对峰"的下凹，人工拿的是"邻域最高"。所以只断言
   * **同一点上人工值 ≤ 机器值 + 容差**——人工窗口更大、参照点更远，
   * 读数不可能比"两座指定峰"更低。不等反而说明窗口写错了。
   */
  let bigger = 0;
  for (const s of marks.saddles) {
    const mine = mm.measureSaddle(h, n, s.i, s.j).drop;
    if (mine > s.drop + 1e-6) bigger++;
  }
  check("人工口径的 drop 不会超过机器口径（同一点、更宽的参照不该更低）", bigger === 0, `反了 ${bigger} 处`);
}

/* ================================================================== */
/* 3) 存储契约：坏数据退回 null，null 与 [] 可区分                       */
/* ================================================================== */
console.log("== 3) 存储的容错与「清空过 ≠ 从没标过」 ==");
{
  const K = mm.manualKey("tpl_mountain");
  store.heal();

  // 没存过⇒ null
  check("没存过 ⇒ null", mm.loadManualMarks("tpl_mountain") === null);

  // 正常存取
  mm.saveManualMarks("tpl_mountain", [{ kind: "peak", i: 100, j: 96 }]);
  const back = mm.loadManualMarks("tpl_mountain");
  check("存取往返一致", back && back.length === 1 && back[0].kind === "peak" && back[0].i === 100,
    JSON.stringify(back));

  // **只存坐标**（磁盘上没有 h / drop / slopeDeg）—— 这条最容易被后人"优化"掉
  const raw = store.raw(K) || "";
  check("落盘内容只有坐标，没有海拔/坡度字段",
    !/"h"|"drop"|"slopeDeg"|"alt"/.test(raw) && /"kind"/.test(raw) && /"i"/.test(raw),
    raw.slice(0, 120));

  // 清空过 ⇒ []（不是 null）
  mm.saveManualMarks("tpl_mountain", []);
  const emptied = mm.loadManualMarks("tpl_mountain");
  check("清空后读到的是 []（不是 null）", Array.isArray(emptied) && emptied.length === 0,
    JSON.stringify(emptied));

  // 各类坏数据
  const bad = [
    ["非法 JSON", "{不是 json"],
    ["版本不对", '{"version":99,"marks":[]}'],
    ["marks 不是数组", '{"version":1,"marks":{}}'],
    ["kind 不认识", '{"version":1,"marks":[{"kind":"volcano","i":1,"j":2}]}'],
    ["坐标是字符串", '{"version":1,"marks":[{"kind":"peak","i":"a","j":2}]}'],
    ["坐标是 null", '{"version":1,"marks":[{"kind":"peak","i":null,"j":2}]}'],
    ["条目是 null", '{"version":1,"marks":[null]}'],
    ["顶层是数组", "[]"]
  ];
  for (const [label, text] of bad) {
    window_stub_set(K, text);
    check(`坏数据「${label}」⇒ 退回 null（不抛错、不给半截）`, mm.loadManualMarks("tpl_mountain") === null);
  }

  // 存储不可用（隐私模式 / 配额满）：读要退回 null，写要如实返回 false
  store.breakIt();
  check("存储不可用时读 ⇒ null", mm.loadManualMarks("tpl_mountain") === null);
  check("存储不可用时写 ⇒ 返回 false（界面据此告知「本次有效」）",
    mm.saveManualMarks("tpl_mountain", [{ kind: "peak", i: 1, j: 1 }]) === false);
  store.heal();

  // 键名带版本号 ⇒ 换结构时老数据自动作废而不是读出乱码
  check("键名带 v1 版本前缀", mm.MANUAL_KEY_PREFIX.endsWith(".v1."), mm.MANUAL_KEY_PREFIX);
  check("键名含样本 tag（按山分键）", mm.manualKey("gongga") === mm.MANUAL_KEY_PREFIX + "gongga");

  // 分键：两个样本互不干扰
  mm.saveManualMarks("gongga", [{ kind: "peak", i: 1, j: 1 }]);
  mm.saveManualMarks("tpl_hill", [{ kind: "cliff", i: 2, j: 2 }, { kind: "peak", i: 3, j: 3 }]);
  check("按样本分键：贡嘎 1 处", (mm.loadManualMarks("gongga") || []).length === 1);
  check("按样本分键：模板丘陵 2 处", (mm.loadManualMarks("tpl_hill") || []).length === 2);
  check("清一台山不影响另一台", (() => {
    mm.clearManualMarks("gongga");
    return mm.loadManualMarks("gongga") === null && (mm.loadManualMarks("tpl_hill") || []).length === 2;
  })());
}

/** 直接往存储塞一段原始文本（用于坏数据用例）。写失败就跳过，不让测试崩在setup 上。 */
function window_stub_set(key, text) {
  try {
    globalThis.localStorage.setItem(key, text);
  } catch {
    /* 存储替身不可用时跳过 */
  }
}

/* ================================================================== */
/* 4) 编辑契约：拒重复 / 点掉最近 / 收机器有上限                         */
/* ================================================================== */
console.log("== 4) 编辑操作 ==");
{
  // 同类同位置拒重复
  let marks = [];
  marks = mm.addMark(marks, "peak", 100, 96).marks;
  const dup = mm.addMark(marks, "peak", 100.5, 96.5);
  check("同类同位置（<2 格）拒重复", dup.reason === "duplicate" && dup.marks.length === 1);
  // 不同类允许同位置（教师可能就在同一处标峰和鞍——让他标，判据不拦教师）
  const other = mm.addMark(marks, "saddle", 100.3, 96.3);
  check("不同类可以落在同一处（判据不拦教师）", other.marks.length === 2 && !other.reason);
  // 远一点可以加
  check("同类远距（≥2 格）可再加", mm.addMark(marks, "peak", 110, 96).marks.length === 2);

  // 点掉：只删最近的那个，且超距离不删
  const three = [
    { kind: "peak", i: 100, j: 96 },
    { kind: "peak", i: 104, j: 96 }
  ];
  const rm1 = mm.removeMarkAt(three, "peak", 100, 96, 8);
  check("点掉最近的 ⇒ 删中它", rm1.hitIndex === 0 && rm1.marks.length === 1 && rm1.marks[0].i === 104);
  // 半径 0.5 格：4 格外的那个（i=104）不该被误伤，而 i=100 那个离 0 格 ⇒ 仍应命中
  const rmTight = mm.removeMarkAt(three, "peak", 100, 96, 0.5);
  check("半径收小后仍只删最近的那个（不误伤远处的）",
    rmTight.hitIndex === 0 && rmTight.marks.length === 1 && rmTight.marks[0].i === 104);
  // 半径 ≤ 0 ⇒ 一律不删（调用方算不出换算时宁可不删：误删要重标，漏删再点一次）
  const rmZero = mm.removeMarkAt(three, "peak", 100, 96, 0);
  check("半径 ≤ 0 ⇒ 不删（宁漏不误删）", rmZero.hitIndex === -1 && rmZero.marks.length === 2);
  const rmOther = mm.removeMarkAt(three, "cliff", 100, 96, 8);
  check("类别不对 ⇒ 不删（点峰不会删掉鞍）", rmOther.hitIndex === -1 && rmOther.marks.length === 2);

  // 一键收机器结果：每类有上限
  const f = dem.createField(data.sourceByTag("gongga"));
  const h = dem.heightFn(f);
  const m = lf.landParts(h, f.grid, f.spanM);
  const seeded = mm.seedFromMachine(m, 3);
  const perKind = (k) => seeded.filter((x) => x.kind === k).length;
  check("「采用机器结果」每类 ≤ 3",
    perKind("peak") <= 3 && perKind("saddle") <= 3 && perKind("cliff") <= 3,
    `峰 ${perKind("peak")} 鞍 ${perKind("saddle")} 崖 ${perKind("cliff")}`);
  check("机器检出 16 处崖时只收 3 处（不是全收）", m.cliffs.length > 3 && perKind("cliff") === 3,
    `机器 ${m.cliffs.length} 处`);
  // 收进来的点必须真的在这张山上（不是别的样本的坐标）
  check("收进来的点都在图幅内", seeded.every((x) => x.i >= 0 && x.i < f.grid && x.j >= 0 && x.j < f.grid));
  // 排序口径：峰按海拔降序
  const peaks = seeded.filter((x) => x.kind === "peak")
    .map((x) => mm.measurePeak(h, x.i, x.j));
  check("收进来的峰按海拔从高到低", peaks.every((v, k) => k === 0 || peaks[k - 1] >= v - 1e-9),
    peaks.map((v) => Math.round(v)).join(" ≥ "));
}

/* ================================================================== */
/* 5) 教学契约：人工标的「陡崖」要能被如实判定不合格                */
/* ================================================================== */
console.log("== 5) 人工标注不豁免判据 ==");
{
  // ⚠️ **v2.4.6：样本从 tpl_mountain 换成 tpl_basin**。
  // 原来用模板山地，但用户要求它「就两座普通的山」⇒ 谷与崖**刻意为 0**，
  // 于是"机器检出的每一处崖，人工测量也认"这条** vacuous 真**（空集全对）。
  // 换成模板盆地（实测 16 处崖）才是真在验这条逻辑。
  const f = dem.createField(data.sourceByTag("tpl_basin"));
  const h = dem.heightFn(f);
  const n = f.grid;
  const cellM = f.spanM / (n - 1);
  const marks = lf.landParts(h, n, f.spanM);

  // 找一个**平缓**的格子：教师在那里标陡崖 ⇒ measureCliff 必须说 ok=false
  let flatI = -1;
  let flatJ = -1;
  for (let j = 8; j < n - 8 && flatI < 0; j += 3) {
    for (let i = 8; i < n - 8; i += 3) {
      const c = mm.measureCliff(h, n, cellM, i, j);
      if (!c.ok && c.slopeDeg < 25) {
        flatI = i;
        flatJ = j;
        break;
      }
    }
  }
  check("能在模板盆地里找到一个平缓格（前提）", flatI >= 0, flatI >= 0 ? `(${flatI},${flatJ})` : "没找到");
  if (flatI >= 0) {
    const c = mm.measureCliff(h, n, cellM, flatI, flatJ);
    check("平缓格上标的陡崖 ok=false（教师标错要被如实告知）", c.ok === false,
      `坡度 ${c.slopeDeg.toFixed(1)}°`);
  }
  // 真陡崖点上ok 必须是 true
  const allOk = marks.cliffs.every((c) =>
    mm.measureCliff(h, n, cellM, c.i, c.j).ok === true
  );
  check("机器检出的每一处崖，人工测量也认（ok=true）", allOk);
  check("模板盆地确实有崖可供核对（v2.4.6 起样本从模板山地换来）", marks.cliffs.length > 0, `${marks.cliffs.length} 处`);
}

/* ================================================================== */
/* 6) 静态纪律：不允许有人把「只存坐标」改成「连数值一起存」            */
/* ================================================================== */
console.log("== 6) 静态纪律 ==");
{
  const fs = require("fs");
  const src = fs.readFileSync(require("path").join(__dirname, "../src/manualMark.ts"), "utf8");
  check("落盘内容里没有 h/slopeDeg 等派生量", !/JSON\.stringify\(\{[^}]*\bh\s*:/.test(src));
  /*
   * ⚠️ 必须走 `store()` 间接层（先取 `globalThis.localStorage`），
   * **不能直接写 `window.localStorage`** —— 后者在 Node 下根本不存在，
   * 会让整段落进 catch，于是数据层测试永远只读到 `null`，测的就是假路径。
   * 这条断言就是守这个：谁把它改回 `window.` 立刻红。
   *
   * ⚠ 只看**代码**：注释里可以（也应该）提到 `window.localStorage` 来说明为什么不用它，
   * 所以先把注释整段剥掉再扫。
   */
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  check("代码里不出现 window.localStorage（注释里可以，说明为什么不用它）",
    !/window\.localStorage/.test(codeOnly));
  check("存储访问统一走 store() 间接层", /function store\(\): Storage \| null/.test(src));
  check("键构造走 manualKey（含版本前缀）",
    /s\?\.getItem\(manualKey\(/.test(src) && /s\.setItem\(manualKey\(/.test(src));
  const trys = (codeOnly.match(/try\s*\{/g) || []).length;
  check("store/load/save/clear/count 五处都包了 try（读取降级不许抛）", trys >= 5, `${trys} 处 try`);
  // 引擎侧：换样本时必须重载标注，否则上一座山的坐标会搬到新山上
  const eng = fs.readFileSync(require("path").join(__dirname, "../src/engine.ts"), "utf8");
  const mch = eng.match(/if \(mountainChanged\)[\s\S]*?pushAnnotations\(\)/);
  check("换样本分支里重载了人工标注（防止坐标跨山搬运）",
    mch ? /loadManualMarks\(params\.mountainTag\)/.test(mch[0]) : false);
}

/* ================================================================== */
/* 7) storageAvailable：能读 ≠ 能写（v2.4.5 真机回归 I14 抓到的缺口）           */
/* ================================================================== */
console.log("\n== 7) 主动试写探测 ==");
{
  check("存储正常时 storageAvailable() 为 true", mm.storageAvailable() === true);

  // 档 2：读得到、写一写就抛（隐私模式 / 配额为 0）
  store.breakIt();
  check("写就抛时 storageAvailable() 为 false（`store() !== null` 在这里会误报 true）",
    mm.storageAvailable() === false);
  check("写就抛时 saveManualMarks 返回 false（上层据此置 sessionOnly）",
    mm.saveManualMarks("tpl_mountain", [{ kind: "peak", i: 1, j: 1 }]) === false);
  store.heal();

  // 档 3：整个存储对象都拿不到
  {
    const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() { throw new Error("模拟：访问 localStorage 就抛"); }
    });
    check("访问 localStorage 就抛时 storageAvailable() 为 false（不抛异常）",
      mm.storageAvailable() === false);
    check("访问 localStorage 就抛时 loadManualMarks 返回 null（不抛异常）",
      mm.loadManualMarks("tpl_mountain") === null);
    if (real) Object.defineProperty(globalThis, "localStorage", real);
  }

  /*
   * 探测不能留下残留键 —— 但**只能查探针自己那一条**。
   * 写成 `store.size() === 0` 会红：前面几节故意存了数据（容错测试的样本）。
   * 正确口径是「探测前后**键的集合**没有变化」。
   */
  const keysBefore = [];
  for (let i = 0; i < localStorage.length; i++) keysBefore.push(localStorage.key(i));
  mm.storageAvailable();
  const keysAfter = [];
  for (let i = 0; i < localStorage.length; i++) keysAfter.push(localStorage.key(i));
  check("探测前后键集合不变（哨兵写完立刻删，不留残留）",
    keysBefore.slice().sort().join("|") === keysAfter.slice().sort().join("|"),
    `前 ${keysBefore.length} 个 / 后 ${keysAfter.length} 个` +
      (keysAfter.some((k) => k.includes("__probe")) ? "  —— 有 __probe 残留！" : ""));
}

/* ================================================================== */
const failed = checks.filter((c) => !c.ok);
console.log("");
console.log(`MANUAL MARK CHECK ${checks.length} 项 / 失败 ${failed.length} 项`);
for (const c of failed) {
  console.log(`   ✘ ${c.name}${c.extra ? "  [" + c.extra + "]" : ""}`);
}
process.exit(failed.length === 0 ? 0 : 1);