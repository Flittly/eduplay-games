/**
 * 排版一致性：CSS 的 --fs-* 档位与 canvas 的 FS 常量必须逐字相同。
 *
 * 为什么需要这条：
 *   右栏（DOM）和底部三视图（canvas）是两套渲染路径，字号只能各写各的。
 *   一旦只改了其中一边，症状是"右栏的字变大了、图里的字还是小的"——
 *   单看哪一边都自洽，只有并排看才发现，很容易一路漏到上架。
 *
 * 顺带守住两件事：
 *   ① 不许在任何地方写裸字号（`font-size: 13px`）—— 档位之外的值等于把层级搞糊。
 *   ② 档位数量别膨胀 —— 加档之前先想清楚是不是真需要。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CSS = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
const PANELS = fs.readFileSync(path.join(ROOT, "src/panels.ts"), "utf8");

let pass = 0;
let fail = 0;
const bad = [];
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`[PASS] ${name}`);
  } else {
    fail++;
    bad.push(name);
    console.log(`[FAIL] ${name} :: ${detail}`);
  }
}

/* ---------- 1. 从 CSS 的 :root 里读档位 ---------- */
const cssTokens = {};
{
  // 只看 :root 块，避免把别处（比如注释里）的同名串进来
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(CSS);
  check("styles.css 里能找到 :root 块", Boolean(root), "没匹配到 :root{...}");
  const body = root ? root[1] : "";
  for (const m of body.matchAll(/--fs-([\w-]+):\s*([\d.]+)px/g)) {
    cssTokens[m[1]] = parseFloat(m[2]);
  }
}

/* ---------- 2. 从 panels.ts 里读 FS 常量 ---------- */
const tsTokens = {};
{
  const blk = /const FS = \{([\s\S]*?)\}\s*as const;/.exec(PANELS);
  check("panels.ts 里能找到 `const FS = {...} as const`", Boolean(blk), "没匹配到 FS 块");
  const body = blk ? blk[1] : "";
  for (const m of body.matchAll(/"?([\w-]+)"?:\s*([\d.]+)/g)) {
    tsTokens[m[1]] = parseFloat(m[2]);
  }
}

/* ---------- 3. 两边必须一一对应 ---------- */
const cssKeys = Object.keys(cssTokens).sort();
const tsKeys = Object.keys(tsTokens).sort();
check(`档位名两边一致（CSS ${cssKeys.length} 档 / TS ${tsKeys.length} 档）`,
  JSON.stringify(cssKeys) === JSON.stringify(tsKeys),
  `CSS=${JSON.stringify(cssKeys)} TS=${JSON.stringify(tsKeys)}`);
check("档位数量收敛在 5~8 档", cssKeys.length >= 5 && cssKeys.length <= 8, `${cssKeys.length} 档`);

for (const k of cssKeys) {
  check(`--fs-${k} = ${cssTokens[k]}（两边同值）`, tsTokens[k] === cssTokens[k],
    `CSS=${cssTokens[k]} TS=${tsTokens[k]}`);
}

/* ---------- 4. 档位必须是单调递增的 ---------- */
{
  const vals = cssKeys.map((k) => cssTokens[k]);
  const sortedUp = [...vals].sort((a, b) => a - b);
  check("档位数值单调递增（排序后与声明序一致形状）",
    new Set(vals).size === vals.length, `有重复值：${JSON.stringify(vals)}`);
  check("最小档 ≥ 11px（投影仪可读下限）", Math.min(...vals) >= 11, `最小 ${Math.min(...vals)}px`);
  check("最小档与最大档差 ≥ 2 倍", Math.max(...vals) / Math.min(...vals) >= 2,
    `${Math.max(...vals)} / ${Math.min(...vals)}`);
}

/* ---------- 5. 不许有裸字号 ---------- */
{
  const bareCss = [...CSS.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => m[0]);
  check("styles.css 里没有裸 font-size（全部走 var(--fs-*)）", bareCss.length === 0,
    `残留 ${bareCss.length} 处：${bareCss.slice(0, 3).join(", ")}`);

  const bareTs = [...PANELS.matchAll(/\.font\s*=\s*[`'"][^`'"]*?[\d.]+px/g)].map((m) => m[0]);
  check("panels.ts 里没有裸 canvas 字号（全部走 ${FS.*}）", bareTs.length === 0,
    `残留 ${bareTs.length} 处：${bareTs.slice(0, 3).join(", ")}`);
}

/* ---------- 6. 档位被真正用上了（不是定义了没人用） ---------- */
{
  const tpl = /var\(--fs-([\w-]+)\)/g;
  const usedCss = new Set([...CSS.matchAll(tpl)].map((m) => m[1]));
  const unused = cssKeys.filter((k) => !usedCss.has(k));
  check("每个 CSS 档位都至少被用了一次", unused.length === 0, `没人用：${JSON.stringify(unused)}`);

  // ⚠ 判据是"canvas 不许自造档位"，**不是**"每档都要被 canvas 用到"：
  //   FS 表为了与 CSS 同键而镜像全部档位，但 canvas 是图上的辅助标注，
  //   本来就不需要 21/24 那种大号标题。要求"全都要用到"是错的判据（会恒红）。
  const usedTs = new Set(
    [...PANELS.matchAll(/\$\{FS(?:\.([\w-]+)|\["([\w-]+)"\])\}/g)].map((m) => m[1] || m[2])
  );
  const orphan = [...usedTs].filter((k) => !tsKeys.includes(k));
  check("canvas 用到的档位都在 FS 表里（没有自造档位）", orphan.length === 0,
    `表外的键：${JSON.stringify(orphan)}`);
  // ⚠ 取"最小的两档"必须**按数值排**，不能拿 cssKeys[0]/[1] ——
  //   cssKeys 是按字母序的（"2xl" 排在 "2xs" 前面），按字母取会取到最大档。
  const bySize = [...cssKeys].sort((a, b) => cssTokens[a] - cssTokens[b]);
  check("canvas 至少用上了最小两档（图上标注走的是小号）",
    usedTs.has(bySize[0]) && usedTs.has(bySize[1]),
    `最小两档=${bySize.slice(0, 2)}，实际用到=${JSON.stringify([...usedTs])}`);
}

/* ---------- 7. SVG 用户单位与 DOM 屏幕像素必须分家 ---------- */
{
  // SVG 里的 font-size 是**用户单位**、随地图框宽等比缩放；--fs-* 那一族是 DOM 的屏幕 px。
  // 把 --fs-* 拿去给 SVG 文本用 = 两套坐标系混用：--fs-2xl 的 24 在 1024 宽视口下
  // 只渲染出 8.5px，而 DOM 断言照样全绿（计算出的 font-size 确实就是 24px）——
  // 只有量"渲染后的尺寸"才看得见。这条断言负责把这类写法挡在源头。
  const svgTok = /--svg-inset-label:\s*([\d.]+)px/.exec(CSS);
  check("定义了 SVG 用户单位 token（--svg-inset-label）", Boolean(svgTok), "没找到 --svg-inset-label");

  const blk = /\.mz-lm-inset-label\s*\{([\s\S]*?)\n\}/.exec(CSS);
  check("styles.css 里能找到 .mz-lm-inset-label 块", Boolean(blk), "没匹配到 .mz-lm-inset-label 块");
  const body = blk ? blk[1] : "";
  const decl = /font-size:\s*([^;]+);/.exec(body);
  check("插图标签走 SVG 用户单位 token，不用 --fs-* 档位",
    Boolean(decl) && decl[1].trim() === "var(--svg-inset-label)",
    `实际 font-size: ${decl ? decl[1].trim() : "(没有)"}`);

  // 反向也得挡：不许有人把用户单位塞进 --fs-* 家族（那会让"两边同值"的校验失去意义）
  const leak = cssKeys.filter((k) => /svg/.test(k));
  check("--fs-* 家族里没有 SVG 用户单位档位", leak.length === 0, `混入：${JSON.stringify(leak)}`);

  // 下限：屏幕 em ≥ 12px 是产品要求（教室后排可读）；上限是几何硬约束 ——
  // 4 个汉字 + 左边距(6) 必须留在插图框宽(150) 内 ⇒ ≤ 36。
  // 这两个数是"插图框宽 150 + 1024 宽视口缩放比 0.36"推出来的，改动其中任一项都要重算。
  if (svgTok) {
    const v = parseFloat(svgTok[1]);
    check(`--svg-inset-label 在几何允许区间内（12/0.36≈33.3 ≤ ${v} ≤ 36）`,
      v >= 33 && v <= 36, `实测 ${v}：过小投影看不清，过大撑破插图框`);
  }
}

console.log(`\n== typography：断言 ${pass + fail} 项，通过 ${pass}，失败 ${fail} ==`);
if (fail) {
  console.log("失败明细：\n" + bad.map((b) => "  " + b).join("\n"));
  process.exit(1);
}
