/* eslint-disable no-console */
// 散落布局的几何自检：不重叠、不越界、可复现。
// 生成物由 `rolldown src/gameData.ts --format cjs --file scripts/gameData.test.cjs` 产出，
// 改了 src/gameData.ts 必须重跑（npm run test:data 已串好）。
const G = require("./gameData.test.cjs");

let pass = 0;
const fail = [];

function check(name, cond, extra) {
  if (cond) {
    pass += 1;
  } else {
    fail.push(name + (extra ? " —— " + extra : ""));
  }
}

/** 旋转后的轴对齐包围盒。 */
function aabb(p) {
  const r = (p.rot * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const w = p.w * c + p.h * s;
  const h = p.w * s + p.h * c;
  return { x0: p.x - w / 2, y0: p.y - h / 2, x1: p.x + w / 2, y1: p.y + h / 2 };
}

// 牌面尺寸覆盖课堂大屏(1280x720 可用区)、笔记本、以及很扁/很窄的极端比例
const BOARDS = [
  [1250, 560], [1100, 520], [980, 470], [820, 420],
  [640, 520], [480, 300], [1600, 620]
];
const COUNTS = [];

// 两种组别的每关牌数都要测（高级组末关 16 对 = 32 张是游戏里最大的牌面）
const ALL_PAIRS = [...new Set([...G.MODES.junior.pairs, ...G.MODES.senior.pairs])]
  .sort((a, b) => a - b);
for (const pairs of ALL_PAIRS) {
  COUNTS.push(pairs * 2);
}
COUNTS.push(2, 4, 30, 40); // 边界：只有一对 / 超出关卡上限

for (const [w, h] of BOARDS) {
  for (const n of COUNTS) {
    const tag = `${w}x${h} n=${n}`;
    const pos = G.layoutCards(n, w, h, 12345);
    check(`位置条数 ${tag}`, pos.length === n, `实际 ${pos.length}`);
    if (pos.length !== n) {
      continue;
    }

    // 1) 两两不重叠
    let worst = Infinity;
    for (let i = 0; i < pos.length; i += 1) {
      const a = aabb(pos[i]);
      for (let j = i + 1; j < pos.length; j += 1) {
        const b = aabb(pos[j]);
        const sepX = Math.max(b.x0 - a.x1, a.x0 - b.x1);
        const sepY = Math.max(b.y0 - a.y1, a.y0 - b.y1);
        const sep = Math.max(sepX, sepY);
        worst = Math.min(worst, sep);
        check(
          `卡片不重叠 ${tag} #${i}/#${j}`,
          sep > 0.01,
          `重叠 ${(-sep).toFixed(2)}px（a=${a.x0.toFixed(0)},${a.y0.toFixed(0)} b=${b.x0.toFixed(0)},${b.y0.toFixed(0)}）`
        );
      }
    }
    check(`最小间距为正 ${tag}`, worst > 0.01, `worst=${worst}`);

    // 2) 不越界
    let oob = null;
    for (const p of pos) {
      const b = aabb(p);
      if (b.x0 < -0.5 || b.y0 < -0.5 || b.x1 > w + 0.5 || b.y1 > h + 0.5) {
        oob = b;
        break;
      }
    }
    check(`不越界 ${tag}`, oob === null, oob ? JSON.stringify(oob) : "");

    // 3) 卡面尺寸：极小牌面上"每张都 ≥70px"在几何上不可能，所以按牌面大小分级。
    //    课堂大屏（≥980 宽）在游戏实际的最大牌数（32 张）以内必须给到 88px 以上，
    //    符号和名称才看得清；超出游戏上限的合成用例只保证几何正确。
    const maxPairs = Math.max(
      ...G.MODES.junior.pairs, ...G.MODES.senior.pairs
    );
    const gameMax = maxPairs * 2;
    const MIN_READABLE = w >= 900 ? (n <= gameMax ? 88 : 70) : 44;
    check(`卡面够大可读 ${tag}`, pos[0].w >= MIN_READABLE,
      `w=${pos[0].w.toFixed(1)} 需要 ≥${MIN_READABLE}`);
    check(`卡面高度够点 ${tag}`, pos[0].h >= 32, `h=${pos[0].h.toFixed(1)}`);
    check(`卡面比例正确 ${tag}`,
      Math.abs(pos[0].w / pos[0].h - G.CARD_ASPECT) < 0.001);
    check(`卡面有旋转抖动 ${tag}`,
      pos.some((p) => Math.abs(p.rot) > 0.5), "全部为 0 度，看着像表格");
  }
}

// 4) 同一 seed 必须给出同一副布局（React 重渲染不能把牌面抖散）
const a = G.layoutCards(20, 1200, 540, 777);
const b = G.layoutCards(20, 1200, 540, 777);
check("布局可复现", JSON.stringify(a) === JSON.stringify(b));
const c = G.layoutCards(20, 1200, 540, 778);
check("换 seed 会变", JSON.stringify(a) !== JSON.stringify(c));

// 5) 中心点应落在牌面内
for (const p of a) {
  check("中心点在牌面内", p.x > 0 && p.x < 1200 && p.y > 0 && p.y < 540);
}

// 6) 空输入不能抛
check("count=0 返回空", G.layoutCards(0, 100, 100, 1).length === 0);
check("尺寸为 0 返回空", G.layoutCards(5, 0, 100, 1).length === 0);

console.log(`layout.test：${pass} 条通过，${fail.length} 条失败`);
if (fail.length) {
  fail.forEach((f) => console.log("  × " + f));
  process.exit(1);
}
