/* 提示文案测试：验证 findHintInfo 能说清「还差什么」，且优先级正确。
 * 用法：node scripts/hint.test.cjs
 * 依赖 scripts/gameData.test.cjs（由 `npm run test:data` 从 src/gameData.ts 重新生成）
 */
const gd = require("./gameData.test.cjs");

let failed = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✘ ${name}${extra ? "  → " + extra : ""}`);
  }
}

/** 取出某省在牌面上的全部牌，删掉其中 n 张当作「已放进卡槽」 */
function scenario(level, provinceId, pickedKinds) {
  const tiles = gd.generateLayout(level);
  const picked = tiles.filter(
    (t) => t.provinceId === provinceId && pickedKinds.includes(t.kind)
  );
  const board = tiles.filter((t) => !picked.some((p) => p.uid === t.uid));
  return { board, tray: picked };
}

const L1 = gd.LEVELS[0];
const provinceId = L1.provinceIds[0];
const name = gd.getProvince(provinceId).name;

console.log(`测试省份：${name}`);

// 1) 空卡槽 → 应引导一个可点击的牌，并报出该省还差哪些要素
{
  const tiles = gd.generateLayout(L1);
  const info = gd.findHintInfo(tiles, []);
  check("空卡槽也能给出提示", info !== null);
  check("空卡槽时 present 为空", info && info.present.length === 0, JSON.stringify(info));
  check("空卡槽时 missing 为三项", info && info.missing.length === 3);
  check("文案提到「凑齐」或「先把压在上层」", /凑齐|先凑|压在上层|属于/.test(info.message), info.message);
  check("高亮的都是牌面上的牌", info.tileUids.every((uid) => tiles.some((t) => t.uid === uid)));
}

// 2) 卡槽已有两张 → 文案必须点名「只差」哪一个要素
for (const pair of [["shape", "abbr"], ["shape", "capital"], ["abbr", "capital"]]) {
  const { board, tray } = scenario(L1, provinceId, pair);
  const info = gd.findHintInfo(board, tray);
  check(`【${name}】已有 ${pair.join("+")} → 只差一项`, info && info.missing.length === 1, JSON.stringify(info));
  check(`【${name}】文案含「只差」`, /只差/.test(info.message), info.message);
}

// 3) 卡槽只有一张 → 文案必须报出还差两项
{
  const { board, tray } = scenario(L1, provinceId, ["shape"]);
  const info = gd.findHintInfo(board, tray);
  check(`【${name}】只有一张 → 还差两项`, info.missing.length === 2, JSON.stringify(info));
  check("文案含「还差」", /还差/.test(info.message), info.message);
  check("文案含剩余两个要素名", info.missing.every((k) => info.message.includes(gd.KIND_LABEL[k])), info.message);
}

// 4) 卡槽只剩 1 格 → 必须带告警前缀
{
  const tiles = gd.generateLayout(L1);
  const provinceIds = [...new Set(tiles.map((t) => t.provinceId))];
  const tray = [];
  for (const pid of provinceIds) {
    const first = tiles.find((t) => t.provinceId === pid && !tray.includes(t));
    if (first && tray.length < 5) {
      tray.push(first);
    }
  }
  const board = tiles.filter((t) => !tray.some((x) => x.uid === t.uid));
  const info = gd.findHintInfo(board, tray, 6);
  check("卡槽 5 格时带告警", info.message.startsWith("卡槽只剩 1 格"), info.message);
}

// 5) 只差一张且能立刻点到时，必须明确说「点它即可消除」
{
  const tiles = gd.generateLayout(L1);
  const provinceIds = [...new Set(tiles.map((t) => t.provinceId))];
  let hit = null;
  for (const pid of provinceIds) {
    const list = tiles.filter((t) => t.provinceId === pid);
    for (const free of list) {
      // 另外两张放进卡槽，这一张留在牌面
      const tray = list.filter((t) => t.uid !== free.uid);
      const board = tiles.filter((t) => !tray.some((x) => x.uid === t.uid));
      // 留下那张此刻必须是无遮挡、可点击的
      if (gd.computeCovered(board).has(free.uid)) {
        continue;
      }
      hit = { info: gd.findHintInfo(board, tray, 6), freeUid: free.uid };
      break;
    }
    if (hit) break;
  }
  check("能构造出「只差一张且可点」的局面", hit !== null);
  if (hit) {
    check("ready 为 true", hit.info.ready === true, JSON.stringify(hit.info));
    check("missing 只剩一项", hit.info.missing.length === 1);
    check("文案提示「点它即可消除」", /点它即可消除/.test(hit.info.message), hit.info.message);
    check("高亮里包含那张可点的牌", hit.info.tileUids.includes(hit.freeUid), JSON.stringify(hit.info.tileUids));
    check("高亮里也包含卡槽中已有的两张", hit.info.tileUids.length >= 2);
  }
}

// 6) 覆盖性回归：任意随机局面都必须给出非空文案
{
  let allGood = true;
  for (let run = 0; run < 60; run += 1) {
    const tiles = gd.generateLayout(L1);
    const pickCount = 1 + Math.floor(Math.random() * 4);
    const shuffled = [...tiles].sort(() => Math.random() - 0.5);
    const tray = [];
    for (const tile of shuffled) {
      if (tray.length >= pickCount) break;
      // 只允许取无遮挡的牌，贴近真实规则
      if (gd.computeCovered(tiles.filter((t) => !tray.some((x) => x.uid === t.uid))).has(tile.uid)) continue;
      tray.push(tile);
    }
    const board = tiles.filter((t) => !tray.some((x) => x.uid === t.uid));
    const info = gd.findHintInfo(board, tray, 6);
    if (!info || !info.message || info.message.length < 6) {
      allGood = false;
      console.log("    坏局:", JSON.stringify(info));
      break;
    }
  }
  check("60 个随机构造局面都能给出可读提示", allGood);
}

console.log(failed === 0 ? "HINT CHECK PASSED ✔" : `HINT CHECK FAILED ✘ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
