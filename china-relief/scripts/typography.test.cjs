/**
 * 字号体系静态回归（v2.0.2）。
 *
 * 纯静态：只把 `src/styles.css` / `src/terrain.ts` / `src/App.tsx` 当**文本**读，
 * 不打包、不开浏览器。挂进 `npm run test:data`。
 *
 * ## 这个文件要守的三件事
 *
 * ① **收敛**：CSS 里不许再有裸 px 的 `font-size`。
 *    改之前这里有 **16 个不同的 px 值、69 处声明**（9/10/11/12/12.5/13/14/15/
 *    17/19/20/21/22/24/27/30）。散点的后果不是"难看"，而是**改不动** ——
 *    用户说"字体都太小了"，没有任何一处代表"整体"，于是每轮只能挑一个显眼的
 *    地方调（上一轮就只放大了「南海诸岛」四个字）。这正是用户反馈
 *    "只放大了南海诸岛"的机制性原因。
 *
 * ② **同源**：canvas 读不到 CSS 变量，所以 `terrain.ts` 里镜像了一份 `FS` 常量。
 *    两边逐档锁死 —— 只改一边就报红。**真出过的事**：右栏字大了、图里的字没变。
 *
 * ③ **三套单位空间分家**：`--fs-*` 是**屏幕 px**；SVG 的 `font-size` 是
 *    **用户单位**、随容器缩放。混用的表现是"`getComputedStyle` 报 24px、
 *    投影出来只有 8.53px"，而**所有 DOM 断言全绿**。本作的 SVG（南海附图）
 *    里没有文本，所以这一条以"不给将来开口子"的方式守。
 *
 * 另外把 v2.0.2 那个核心 bug 也静态锁住（见第 6 节）：`vector-effect`
 * **不是继承属性**，写在 `<g>` 上等于没写。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

/**
 * 剥掉块注释与整行 `//` 注释。
 *
 * ⚠️ **静态文本断言必须先剥注释** —— 这是本轮真踩的一个坑：
 * 上面第 6 节要断言"App.tsx 里不再出现 `vectorEffect`"，而我自己刚在
 * `NanhaiInset` 的注释里写了一句「别再给这两个 `<g>` 加 `vectorEffect`」，
 * 于是**那条解释"为什么不能这么写"的注释把断言判成了红**。
 * 只剥"整行 `//`"而不剥行尾的，是为了不误伤代码里的 `https://`。
 */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

const readCode = (rel) => stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));

const CSS = readCode("src/styles.css");
const TERRAIN = readCode("src/terrain.ts");
const APP = readCode("src/App.tsx");

const checks = [];
const check = (name, cond, extra) => {
  checks.push({ name, ok: Boolean(cond), extra: extra === undefined ? "" : String(extra) });
};
const note = (name, extra) => {
  checks.push({ name, ok: true, extra: `（记录）${extra}`, record: true });
};

const TIERS = ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"];

/* ============ 1) 档位表本身：完整、单调、满足教室尺度 ============ */

/** 抠出 `:root` 里的 `--fs-x: Npx;` */
const CSS_TOKENS = {};
for (const m of CSS.matchAll(/--fs-([a-z0-9]+):\s*([0-9.]+)px/g)) {
  CSS_TOKENS[m[1]] = Number(m[2]);
}

check(
  "档位表有且只有 7 档，名字正好是 2xs/xs/sm/md/lg/xl/2xl",
  JSON.stringify(Object.keys(CSS_TOKENS).sort()) === JSON.stringify([...TIERS].sort()),
  `实际 ${JSON.stringify(Object.keys(CSS_TOKENS))}`
);

const VALUES = TIERS.map((t) => CSS_TOKENS[t]);
check(
  "7 档严格单调递增（档位表自己不自洽的话，后面所有夹取都会怪怪的）",
  VALUES.every((v, i) => i === 0 || v > VALUES[i - 1]),
  VALUES.join(" < ")
);

// 教室场景（投影仪 + 后排）的两条硬约束
const MIN_FS = Math.min(...VALUES);
const MAX_FS = Math.max(...VALUES);
check(
  "最小档 ≥ 12px（教室场景：投影仪上小于 12px 就糊了）",
  MIN_FS >= 12,
  `最小档 ${MIN_FS}px`
);
check(
  "最大 / 最小 ≥ 2.5（层级要拉得开）",
  MAX_FS / MIN_FS >= 2.5,
  `${MAX_FS} / ${MIN_FS} = ${(MAX_FS / MIN_FS).toFixed(2)}`
);

note(
  "本轮整体抬升",
  `最小档 9 → ${MIN_FS}px（+${((MIN_FS / 9 - 1) * 100).toFixed(0)}%）；` +
    `最大档 30 → ${MAX_FS}px；原来 16 个散值收敛成 7 档`
);

/* ============ 2) 收敛：CSS 里不许再有裸 px 的 font-size ============ */

const bareFontSizes = CSS.match(/font-size:\s*[0-9.]+px/g) || [];
check(
  "styles.css 里没有裸 px 的 font-size（全部走 --fs-* 档位表）",
  bareFontSizes.length === 0,
  bareFontSizes.length ? `还有 ${bareFontSizes.length} 处：${bareFontSizes.slice(0, 4).join(", ")}` : "0 处"
);

const usedTokens = [...CSS.matchAll(/font-size:\s*var\(--fs-([a-z0-9]+)\)/g)].map((m) => m[1]);
const badTokens = [...new Set(usedTokens)].filter((t) => !TIERS.includes(t));
check(
  "用到的每个 --fs-* 都在档位表里定义过（拼成 --fs-3xl 这种要当场抓出来）",
  badTokens.length === 0,
  badTokens.length ? `未定义：${badTokens.join(", ")}` : `用到 ${new Set(usedTokens).size} 档 / 共 ${usedTokens.length} 处`
);
check(
  "每一处 font-size 都用的是档位 token（没有漏网的第三种写法）",
  usedTokens.length === (CSS.match(/font-size:/g) || []).length,
  `font-size 共 ${(CSS.match(/font-size:/g) || []).length} 处，其中走 token 的 ${usedTokens.length} 处`
);

/* ============ 3) 同源：canvas 的 FS 镜像必须与 CSS 逐档同值 ============ */

/** 抠出 `terrain.ts` 里 `const FS = { "2xs": 12, … }` 这一块 */
const fsBlock = TERRAIN.match(/const FS = \{([\s\S]*?)\} as const;/);
check("terrain.ts 里有 canvas 侧的 FS 镜像表", Boolean(fsBlock));

const CANVAS_FS = {};
if (fsBlock) {
  for (const m of fsBlock[1].matchAll(/"?([a-z0-9]+)"?:\s*([0-9.]+)/g)) {
    CANVAS_FS[m[1]] = Number(m[2]);
  }
}

const mismatch = TIERS.filter((t) => CANVAS_FS[t] !== CSS_TOKENS[t]);
check(
  "canvas 的 FS 与 CSS 的 --fs-* 逐档同值（只改一边 ⇒ 右栏字大了、图里的字没变）",
  mismatch.length === 0,
  mismatch.length
    ? mismatch.map((t) => `${t}: css ${CSS_TOKENS[t]} vs canvas ${CANVAS_FS[t]}`).join(" / ")
    : TIERS.map((t) => `${CANVAS_FS[t]}`).join(" / ")
);

check(
  "canvas 的 FS 表没有多出来的档位（多出来 = 有人在这里自造了一套）",
  Object.keys(CANVAS_FS).length === TIERS.length,
  `canvas ${Object.keys(CANVAS_FS).length} 档 / CSS ${TIERS.length} 档`
);

// canvas 只该用其中几个档；关键不变量是"不许自造"，不是"每档都要用到"
const canvasRefs = [...TERRAIN.matchAll(/FS\.([A-Za-z0-9]+)/g)].map((m) => m[1]);
const badRefs = [...new Set(canvasRefs)].filter((r) => !TIERS.includes(r));
check(
  "canvas 里引用的每个 FS.x 都是合法档位（不许自造）",
  badRefs.length === 0,
  badRefs.length ? `非法：${badRefs.join(", ")}` : `引用 ${canvasRefs.length} 处，用到 ${new Set(canvasRefs).size} 档（这就对了：canvas 只该用其中几档）`
);

/* ============ 4) canvas 的字号必须由 FS 夹取，不许改回字面数 ============ */

const minFS = (TERRAIN.match(/Math\.min\(FS\./g) || []).length;
const maxFS = (TERRAIN.match(/Math\.max\(FS\./g) || []).length;
check(
  "地名与阶梯名的字号都用 FS 夹取（Math.min(FS.…) / Math.max(FS.…) 各 2 处）",
  minFS === 2 && maxFS === 2,
  `Math.min(FS.…) ${minFS} 处 / Math.max(FS.…) ${maxFS} 处`
);

const oldClamps = [
  /Math\.max\(11,\s*mapScale/,
  /Math\.max\(14,\s*mapScale/,
  /Math\.min\(16,\s*Math\.max/,
  /Math\.min\(21,\s*Math\.max/
];
const hitOld = oldClamps.filter((re) => re.test(TERRAIN)).map((re) => String(re));
check(
  "旧的裸数字夹取已全部消失（11/14/16/21 那四个）",
  hitOld.length === 0,
  hitOld.length ? `仍在：${hitOld.join(" , ")}` : "4 个全清"
);

/*
 * canvas 字号是**设备无关像素**：setup() 里已 setTransform(dpr, …)。
 * 再乘一次 dpr 的后果是字大一倍（或在小 dpr 屏上小一半），而且只在部分机器上出现。
 */
check(
  "canvas 的字号表达里没有乘 dpr（已 setTransform(dpr,…)，乘了就大一倍）",
  !/font\s*=\s*`[^`]*\$\{[^}]*dpr[^}]*\}/.test(TERRAIN),
  "字体串里不含 dpr"
);

/* ============ 5) 三套单位空间分家 ============ */

const svgFontRules = [];
{
  // 逐条规则扫：选择器里含 svg 的，不许用 --fs-* 设 font-size
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of CSS.matchAll(ruleRe)) {
    const sel = m[1].trim().split("\n").pop().trim();
    const bodyTxt = m[2];
    if (/svg/i.test(sel) && /font-size:\s*var\(--fs-/.test(bodyTxt)) {
      svgFontRules.push(sel);
    }
  }
}
check(
  "SVG 元素不许用 --fs-*（那族是屏幕 px，SVG 的 font-size 是用户单位、随容器缩放）",
  svgFontRules.length === 0,
  svgFontRules.length ? `违规选择器：${svgFontRules.join(" , ")}` : "0 条"
);

/** 本作的 SVG 里没有文本 ⇒ 不存在用户单位字号；这一条是"不给将来开口子" */
const nanhaiFn = APP.slice(APP.indexOf("function NanhaiInset"));
const nanhaiBody = nanhaiFn.slice(0, nanhaiFn.indexOf("\n}\n"));
check(
  "南海附图的 SVG 里没有 <text>（有文本的话就必须另起一套用户单位 token，不能借 --fs-*）",
  !/<text/.test(nanhaiBody),
  "无 <text> 元素"
);

/* ============ 6) 南海附图：把 v2.0.2 那个静默失效静态锁住 ============ */

check(
  "styles.css 在 path 层给了 vector-effect: non-scaling-stroke",
  /\.cr-nanhai svg path\s*\{[^}]*vector-effect:\s*non-scaling-stroke/.test(CSS),
  "规则存在"
);
// 只认**真正的 JSX 属性**（带 `=`）—— 注释里提个名字不算
const veAttr = /vectorEffect\s*=/.test(APP);
check(
  "App.tsx 里不再有 vectorEffect=（它不是继承属性，写在 <g> 上等于没写 —— 正是本轮修的 bug）",
  !veAttr,
  veAttr ? "仍有 <g vectorEffect=…>，会静默失效" : "0 处（注释里提到名字不算）"
);

const boxMatch = APP.match(/const NANHAI_BOX_W = (\d+)/);
check(
  "小图宽度不再缩回 124px 那种尺寸（用户反馈「过于小」的正是那一版）",
  boxMatch && Number(boxMatch[1]) >= 170,
  boxMatch ? `NANHAI_BOX_W = ${boxMatch[1]}px` : "没找到 NANHAI_BOX_W"
);

/*
 * 岛礁：fill 必须在 CSS 里定死（不许回到「近白 / 浅绿」—— 缩到 2px 在浅蓝海上看不见），
 * 而且描边必须配 `paint-order: stroke`。
 *
 * 为什么 `paint-order` 是硬要求：196 块岛礁没有一块超过 3px，若描边画在填充**之上**
 * （默认），1px 的边就把整块吃掉、全图退化成深色点阵 —— 这不只是难看，
 * 是**看不出东沙/西沙/中沙/南沙四组**（教学上要看的就是这四组）。
 */
const islRule = CSS.match(/\.cr-nanhai-islands path\s*\{([^}]*)\}/);
check(
  "岛礁的填充色在 CSS 里定（不许回到「近白 / 浅绿」—— 缩到 2px 在浅蓝海上看不见）",
  Boolean(islRule) && /fill:\s*#[0-9a-fA-F]{6}/.test(islRule[1]),
  islRule ? (islRule[1].match(/fill:\s*#[0-9a-fA-F]{6}/) || ["无 fill"])[0] : "没找到规则"
);
check(
  "岛礁描边配了 paint-order: stroke（默认顺序下 1px 描边会吃掉 2px 的小礁，四组岛礁就看不出分了）",
  Boolean(islRule) && /paint-order:\s*stroke/.test(islRule[1]),
  islRule ? (/paint-order:\s*stroke/.test(islRule[1]) ? "stroke fill" : "缺 paint-order") : "没找到规则"
);
/**
 * 十段线必须是 butt 端头。
 * ⚠️ 报错文案只看 **`.cr-nanhai-dashes` 那一条规则的内容** —— 不能整份 CSS 里
 * 搜 `round`（别处还有 `stroke-linejoin: round` 之类），那会给出误导性的提示。
 */
const dashRule = CSS.match(/\.cr-nanhai-dashes path\s*\{([^}]*)\}/);
check(
  "十段线用 butt 端头（round 会把每一小段渲染成圆点，与岛礁长得一模一样）",
  Boolean(dashRule) && /stroke-linecap:\s*butt/.test(dashRule[1]),
  dashRule
    ? /stroke-linecap:\s*round/.test(dashRule[1])
      ? "！！这条规则里还是 round"
      : "butt"
    : "没找到 .cr-nanhai-dashes path 规则"
);
check(
  "十段线的颜色与岛礁分家（线用暗红、面用绿）",
  /\.cr-nanhai-dashes path\s*\{[^}]*stroke:\s*#[0-9a-fA-F]{6}/.test(CSS),
  "有 stroke 规则"
);

check(
  "「南海诸岛」标题的字号跟档位表走（--fs-sm），不是又写死一个 px",
  /\.cr-nanhai span\s*\{[^}]*font-size:\s*var\(--fs-sm\)/.test(CSS),
  "用 --fs-sm"
);
check(
  "「南海诸岛」仍在图正中（v2.0.0 的既定需求，别在后续改动里被挪走）",
  /\.cr-nanhai span\s*\{[^}]*left:\s*50%;[\s\S]*?top:\s*50%;[\s\S]*?translate\(-50%,\s*-50%\)/.test(CSS),
  "left/top 50% + translate(-50%,-50%)"
);

/* ============ 汇总 ============ */

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? (c.record ? "·" : "✔") : "✘"} ${c.name}${c.extra ? `  ${c.extra}` : ""}`);
}
console.log(
  `\nTYPOGRAPHY CHECK ${failed.length === 0 ? "PASSED ✔" : "FAILED ✘"}  断言 ${checks.length} 项，失败 ${failed.length} 项`
);
process.exit(failed.length === 0 ? 0 : 1);
