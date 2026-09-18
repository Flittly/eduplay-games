/* 港澳轮廓保真度测试（v1.1.0）
 *
 * 用法：node scripts/tiny.test.cjs
 * 依赖 scripts/gameData.test.cjs（由 `npm run test:data` 从 src/gameData.ts 重新生成）
 *
 * 两条线各测一层：
 *   数据层 —— 港澳的 `d` 是否真的细到能辨认形状（而不是被 round 抹成方块）
 *   渲染层 —— `TINY_BBOX` 这条阈值是否**只圈中港澳**，不会静默误伤别的行政区
 *
 * ⚠ 断言全部写成**尺度无关的几何量**（环数 / 顶点数 / 最大环的不同坐标数），
 *   不写"截图里边缘像素变多"那种量 —— 牌面才 68×67 px，
 *   120 m 容差的真实海岸线换算过去只有 0.05 px/个转折，物理上渲染不出来。
 *   像素量只留作"确实画出来了"的辅助证据，不下"更细致"的结论。
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

const HK = "810000";
const MO = "820000";

/** 从 path 的 d 算尺度无关的几何量 */
function pathGeom(d) {
  const rings = d.split("M").filter(Boolean);
  let verts = 0;
  let maxUniq = 0;
  let degenerate = 0;
  const perRing = [];
  for (const ring of rings) {
    const pts = ring.replace(/Z$/, "").split("L").filter(Boolean);
    const uniq = new Set(pts);
    verts += pts.length;
    maxUniq = Math.max(maxUniq, uniq.size);
    if (uniq.size <= 1) {
      degenerate += 1;
    }
    perRing.push(uniq.size);
  }
  return { rings: rings.length, verts, maxUniq, degenerate, perRing };
}

console.log("—— 数据层：港澳轮廓足够细，能辨认形状 ——");
for (const [code, label, minRings] of [
  [HK, "香港", 30],
  [MO, "澳门", 4]
]) {
  const p = gd.getProvince(code);
  const g = pathGeom(p.d);
  console.log(`  ${label}: 环=${g.rings} 顶点=${g.verts} 最大环不同坐标=${g.maxUniq}`);
  check(`${label}：环数 ≥${minRings}（离岛/海岸线碎块都在）`, g.rings >= minRings, `环=${g.rings}`);
  check(`${label}：顶点数 ≥90（不是被简化容差压扁的）`, g.verts >= 90, `顶点=${g.verts}`);
  // 这一条是 v1.1.0 的核心：澳门改前最大环只有 **2** 个不同坐标（就是一条线段），
  // 香港 16。低于 20 说明坐标又被 round 到整数了 —— 再细的源数据也白搭。
  check(
    `${label}：最大环的不同坐标 ≥20（没被坐标取整抹平）`,
    g.maxUniq >= 20,
    `最大环不同坐标=${g.maxUniq}`
  );
  check(`${label}：没有塌成单点的环`, g.degenerate === 0, `退化环=${g.degenerate}`);
}

console.log("");
console.log("—— 数据层：bbox 与 d 精度一致（牌面是拿 bbox 当 viewBox 的）——");
for (const [code, label] of [
  [HK, "香港"],
  [MO, "澳门"]
]) {
  const p = gd.getProvince(code);
  const [, , w, h] = p.bbox;
  // 澳门真实跨度只有 1.59 × 2.41 单位；取整会变成 1×2，形状直接偏出取景框。
  const fractional = ![w, h].every((v) => Number.isInteger(v));
  check(`${label}：bbox 的宽高带小数（说明与 d 同一精度，没取整）`, fractional, `w=${w} h=${h}`);
}

console.log("");
console.log("—— 渲染层：TINY_BBOX 只圈中港澳 ——");
const tiny = gd.PROVINCES.filter((p) => gd.bboxSize(p) < gd.TINY_BBOX).map((p) => p.id);
check(
  "低于阈值的**正好**是香港与澳门两个",
  tiny.length === 2 && tiny.includes(HK) && tiny.includes(MO),
  tiny.map((id) => `${id}(${gd.bboxSize(gd.getProvince(id))})`).join(", ")
);
const hkSize = gd.bboxSize(gd.getProvince(HK));
const moSize = gd.bboxSize(gd.getProvince(MO));
const shSize = gd.bboxSize(gd.getProvince("310000"));
check(
  "阈值落在「港澳」与「上海」的间隙里（不敏感，也不误伤上海）",
  moSize < hkSize && hkSize < gd.TINY_BBOX && gd.TINY_BBOX < shSize,
  `澳门 ${moSize} < 香港 ${hkSize} < ${gd.TINY_BBOX} < 上海 ${shSize}`
);
check(
  "最接近阈值、却没被圈中的那个是上海（顺序没被打乱）",
  gd.PROVINCES.filter((p) => gd.bboxSize(p) >= gd.TINY_BBOX)
    .sort((a, b) => gd.bboxSize(a) - gd.bboxSize(b))[0].id === "310000"
);
check("全部 34 个行政区齐全", gd.PROVINCES.length === 34, `n=${gd.PROVINCES.length}`);
check(
  "其余 32 个行政区的 bbox 仍是整数（只有港澳走了小数精度这条路）",
  gd.PROVINCES.filter((p) => p.id !== HK && p.id !== MO).every((p) =>
    p.bbox.every((v) => Number.isInteger(v))
  )
);

console.log(failed === 0 ? "TINY CHECK PASSED ✔" : `TINY CHECK FAILED ✘ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
