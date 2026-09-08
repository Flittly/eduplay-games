/* 布局可解性测试：
 * 1) 硬性要求：每次生成的布局都必须通过 referenceSolvable（存在实测通关路径）；
 * 2) 质量指标：统计贪心策略（不用提示/撤回）的通关率。
 */
const gd = require("./gameData.test.cjs");

let allOk = true;
for (const level of gd.LEVELS) {
  let refOk = 0;
  let greedyOk = 0;
  let maxLayerSeen = 0;
  const N = 100;
  for (let run = 0; run < N; run += 1) {
    const { tiles, order } = gd.buildLayout(level);
    if (gd.referenceSolvable(order)) {
      refOk += 1;
    } else {
      console.log(`L${level.id} run ${run}: reference path BROKEN ✘`);
      allOk = false;
    }
    if (gd.greedySolvable(tiles)) {
      greedyOk += 1;
    }
    maxLayerSeen = Math.max(maxLayerSeen, ...tiles.map((t) => t.layer));
  }
  console.log(
    `L${level.id}: reference-solvable ${refOk}/${N}, greedy-win ${greedyOk}/${N}, maxLayer=${maxLayerSeen} (cap ${level.maxLayers})`
  );
}
console.log(allOk ? "GUARANTEE CHECK PASSED ✔" : "GUARANTEE CHECK FAILED ✘");
process.exit(allOk ? 0 : 1);
