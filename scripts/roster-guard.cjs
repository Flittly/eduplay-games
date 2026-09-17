#!/usr/bin/env node
/**
 * 守门脚本：把「manifest 的 requiresRoster」和「游戏源码对名单的真实依赖」对起来。
 *
 * 为什么需要它
 * ------------
 * 平台侧的判定式是：
 *
 *     const needsRoster = manifest.requiresRoster !== false;
 *     if (needsRoster && selectedStudents.length === 0) return;   // 干脆不发 GAME_INIT
 *     roster: needsRoster ? selectedStudents.map(...) : []        // 展示型发空名单
 *
 * 也就是说 `requiresRoster: false` 有**两个**后果：跳过选人页 + 只发空名单。
 * 对地球仪那种展示型游戏正合适；但对「必须点名才能开局」的游戏，
 * 后果就是学生一个都没勾、GAME_INIT 里 roster 是空的，
 * 而游戏自己的闸门是 `if (roster.length === 0) return <等待平台下发学生名单…/>`，
 * 于是页面永久卡在等待文案上，谁也进不去。
 *
 * 这个字段的语义只写在平台代码里，游戏侧看不到，
 * 所以必须有一道机器检查替人对一遍：**源码要求名单 ⇒ manifest 不许说 false**。
 *
 * 用法：node scripts/roster-guard.cjs
 * 退出码：0 = 全过，1 = 有问题
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const PLATFORM_GAME_PAGE = path.resolve(
  REPO_ROOT,
  "..",
  "eduplay",
  "frontend",
  "src",
  "pages",
  "GamePage.tsx"
);

const problems = [];
const notes = [];
let checks = 0;

function check(name, ok, detail) {
  checks += 1;
  if (ok) {
    console.log(`  \u2714 ${name}`);
  } else {
    console.log(`  \u2718 ${name}  ${detail ?? ""}`);
    problems.push(`${name} ${detail ?? ""}`.trim());
  }
}

/** 读一个文件，读不到返回 null（用于可选的跨仓库文件）。 */
function readOrNull(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function listGames() {
  return fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((dir) =>
      fs.existsSync(path.join(REPO_ROOT, dir, "manifest.json"))
    )
    .sort();
}

/** 把 src/ 下所有 ts/tsx 拼起来，供关键词扫描。 */
function readSources(gameDir) {
  const srcDir = path.join(REPO_ROOT, gameDir, "src");
  if (!fs.existsSync(srcDir)) {
    return "";
  }
  const walk = (dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          return walk(full);
        }
        return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
      });
  return walk(srcDir)
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

console.log("== 1. 平台口径：先确认判定式本身没有变 ==");

const gamePage = readOrNull(PLATFORM_GAME_PAGE);
if (gamePage === null) {
  notes.push(
    `跳过平台交叉校验：读不到 ${PLATFORM_GAME_PAGE}（跨仓库，可能只克隆了 eduplay-games）`
  );
  console.log("  \u26a0 读不到平台 GamePage.tsx，跳过（不算失败）");
} else {
  check(
    "平台仍然用 requiresRoster !== false 判定是否需要选人",
    /manifest\.requiresRoster\s*!==\s*false/.test(gamePage),
    "平台侧判定式变了，这个守门脚本的假设要跟着更新"
  );
  check(
    "平台在没有选中学生时确实不发 GAME_INIT",
    /needsRoster\s*&&\s*selectedStudents\.length\s*===\s*0/.test(gamePage)
  );
  check(
    "平台对展示型游戏发的是空 roster",
    // 注意别把窗口开太小：三元表达式的真分支里是整段 map 回调，200 字符装不下，
    // 会误报成"平台改口径了"。
    /roster:\s*needsRoster[\s\S]{0,600}?:\s*\[\]\s*[,}]/.test(gamePage)
  );
}

console.log("\n== 2. 每个游戏：源码要不要名单 vs manifest 怎么说 ==");

const NEEDS_ROSTER_MARKERS = [
  // 硬闸门：名单为空就不渲染主界面
  { re: /roster\.length\s*===\s*0/, why: "有 roster.length === 0 的渲染闸门" },
  { re: /roster\.length\s*<\s*1/, why: "有 roster.length < 1 的闸门" },
  // 等待文案
  { re: /等待平台下发学生名单/, why: "有\"等待平台下发学生名单\"文案" },
  // 双人/多人逻辑必须有两个以上真实学生
  { re: /roster\.length\s*>=\s*2/, why: "有 roster.length >= 2 的双人逻辑" }
];

for (const game of listGames()) {
  const manifestPath = path.join(REPO_ROOT, game, "manifest.json");
  const raw = fs.readFileSync(manifestPath, "utf8");
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    check(`${game}: manifest.json 是合法 JSON`, false, String(err));
    continue;
  }

  const sources = readSources(game);
  const hits = NEEDS_ROSTER_MARKERS.filter((marker) =>
    marker.re.test(sources)
  ).map((marker) => marker.why);

  const saysDisplayOnly = manifest.requiresRoster === false;
  const claimsRoster = manifest.requiresRoster === true;

  console.log(
    `  · ${game.padEnd(18)} requiresRoster=${String(
      manifest.requiresRoster ?? "<缺省>"
    ).padEnd(6)} 源码依赖=${hits.length ? hits.join("；") : "无"}`
  );

  if (hits.length > 0 && saysDisplayOnly) {
    check(
      `${game}: 源码要名单，manifest 不能写 requiresRoster:false`,
      false,
      `—— 平台会跳过选人页并只发空名单，游戏会永久卡在等待页（${hits.join("；")}）`
    );
  } else if (hits.length > 0 && !claimsRoster) {
    // 缺省在平台口径里等价于 true，跑起来是对的，
    // 所以这里只提示、不算失败 —— 断言太严会让真问题被淹没。
    notes.push(
      `${game}: 缺 requiresRoster 字段（缺省等价于 true，能跑）。建议显式写 true，免得以后被顺手改成 false。`
    );
  }

  if (hits.length === 0 && claimsRoster) {
    notes.push(
      `${game}: requiresRoster 写 true，但源码里没扫到名单依赖。若它其实是展示型，老师会被迫白选一遍学生。`
    );
  }

  // 版本三处一致
  const pkg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, game, "package.json"), "utf8")
  );
  const main = readOrNull(path.join(REPO_ROOT, game, "src", "main.tsx")) ?? "";
  const mainVersion =
    (main.match(/const\s+version\s*=\s*"([^"]+)"/) ?? [])[1] ?? "<没找到>";
  check(
    `${game}: 版本三处一致（${manifest.version}）`,
    pkg.version === manifest.version && mainVersion === manifest.version,
    `manifest=${manifest.version} package=${pkg.version} main.tsx=${mainVersion}`
  );
}

console.log("\n== 3. 已构建产物 ==");

let built = 0;
for (const game of listGames()) {
  const distIndex = path.join(REPO_ROOT, game, "dist", "web", "index.html");
  if (!fs.existsSync(distIndex)) {
    notes.push(`${game}: 没有 dist/web/index.html，尚未构建`);
    continue;
  }
  built += 1;
  const html = fs.readFileSync(distIndex, "utf8");
  check(`${game}: dist/web 存在且引用了打包产物`, /assets\//.test(html));
}
notes.push(
  `dist/ 里不带 manifest 的版本号，所以"产物是不是当前版"这条机器判不了：` +
    `已构建 ${built}/${listGames().length} 个，上架前请逐个确认 manifest 的 version 是你要发的那版。`
);

console.log("\n== 4. 汇总 ==");
console.log(`  断言 ${checks} 项，失败 ${problems.length} 项`);
if (notes.length) {
  console.log("  提示：");
  for (const note of notes) {
    console.log(`    - ${note}`);
  }
}
if (problems.length) {
  console.log("  失败明细：");
  for (const problem of problems) {
    console.log(`    - ${problem}`);
  }
  process.exit(1);
}
console.log("  ALL PASSED \u2714");
