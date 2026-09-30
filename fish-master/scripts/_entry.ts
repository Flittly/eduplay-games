/**
 * 测试专用入口
 * ============
 * 把 data.ts / game.ts / proj.ts / basemap.ts 的导出汇总到一个模块，
 * 供 rolldown 打成单文件 CJS。
 * ⚠️ 这只是**测试用的胶水文件**，不进 `src/`、不参与游戏构建（tsconfig 的 include 只含 src）。
 *    写在 scripts/ 下是为了让 `npm run build` 不会把它算进产物。
 *
 * 为什么要带上 proj / basemap：judgeArrow 的判定口径要跟投影层对齐，
 * 坐标范围与瓦片布局也需要能被单测覆盖（这些是"位置错了但界面看着正常"
 * 的重灾区，必须有机检）。
 */

export * from "../src/data";
export * from "../src/game";
export * from "../src/proj";
export * from "../src/basemap";
