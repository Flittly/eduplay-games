# eduplay-games 项目长期记忆

> 跨游戏的约定、纪律与踩坑放本文件（会被自动注入）。游戏专属的显示/渲染细节在
> `globe-and-solar-notes.md`（地球仪、太阳系、three.js 套路）；逐日工作日志在 `YYYY-MM-DD.md`。

## 本机环境约定

- **bash 的 PATH 被污染**：直接跑 `ls`/`wc`/`node` 会 `command not found`（shim 里 `dirname` 就失败了）。
  每条命令前先修 PATH，实测可用：

  ```bash
  export PATH="/usr/bin:/bin:/c/Users/Administrator/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:/c/Users/Administrator/.workbuddy/binaries/PortableGit/versions/1.2.0/mingw64/bin:/c/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3:/c/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12:$PATH"
  ```

- 图形命令（Electron 截图）需 `export MSYS2_ARG_CONV_EXCL='*'` + `unset ELECTRON_RUN_AS_NODE`，
  `taskkill /IM electron.exe /F` 前也要 `MSYS2_ARG_CONV_EXCL='*'`。
- 本机 WebGL 只能在 SwiftShader 软渲染下跑，Electron 需 `--no-sandbox --disable-gpu-sandbox
  --use-angle=swiftshader --enable-unsafe-swiftshader`，详见 skill `frontend-visual-verify`。

## 每个游戏的版本号必须三处同步

`manifest.json` 的 `version`、`package.json` 的 `version`、`src/main.tsx` 的 `const version`。
漏掉 `main.tsx` 会让平台收到的 `GAME_READY` 里版本与包里不一致。展示型游戏另需
`manifest.json` 里 `requiresRoster: false`（平台 `GamePage` 据此跳过选人环节）。

## 打包 / 上架

- 构建：在游戏目录 `npm run build`（`tsc --noEmit && vite build`，产物在 `dist/web/`）。
- 上架脚本：`.workbuddy/tmp/publish_solar.py`（单游戏太阳系）、`publish_globe.py`（单游戏地球仪）、
  `publish_demo_games.py`（earth-globe + solar-system 一起）。
  流程 = 打 zip（`manifest.json` + `dist/web/**`）→ `POST /admin/games/{code}/packages` → `PATCH .../status ACTIVE`。
- 双后端：本地 `7070`、云端 `17070`，管理员 `admin/admin123`，教师演示账号 `123456/123456`。
- **所有后端接口都在 `/api/v1` 下**（`/api/v1/admin/login`、`/api/v1/admin/games`、`/api/v1/store/games`）。
  手写探测脚本漏了这个前缀会打到静态资源上，被 `GlobalExceptionHandler` 包成 **HTTP 500
  `{"code":"INTERNAL_ERROR"}`**——看着像后端挂了，其实只是路径写错，别被误导去查数据库/日志。
- 验证截图：`screenshots/` 已被 `.gitignore` 忽略（`**/screenshots/`），归档的验证图只留本地、不进仓库。
- 脚本里 `POST /store/games/{code}/install` 用 admin token 会失败（"只有教师账号可以使用商城"；
  云端直接 500）。这是脚本的老问题，**不影响上架**——版本与 ACTIVE 状态都已生效。
- 校验方式：教师账号登录后 `GET /store/games` 确认 `gameCode` 可见且 version 是新的。
- **改 `manifest.json` 的 `description` 后重新上传包，商城/游戏中心简介会自动同步**：
  `AdminGameService.uploadPackage()` 里有 `if (manifest.description() != null) product.setDescription(...)`，
  不必另找更新接口。（简介要求"简短且不变"，地球仪 59 字 / 太阳系 66 字。）

## 编辑与验证纪律（本会话踩出来的）

- **同一文件连续多处 Edit 会静默丢改动**（本会话在 `EarthGlobe.tsx` 上发生过 6 次）。
  每次成批编辑后必须 `grep` 关键标记确认，然后立刻 `npm run build`。
- 构造「开/关某图层」的像素对比时，**必须先把自转和自动旋转都关掉**
  （`setRotate(false)` + `setAutoRotate(false)`；只 `setSpin(角度)` 不停止自转），
  并断言两次采样之间地球屏幕位置漂移 < 1px，否则对比无效（会被自转造成的明暗移位带偏）。
- **软渲染下 `capturePage` 会抓到"画了一半的帧"**（同帧两次截图差可达 28 万像素），
  像素级对比一律改用**引擎内确定性采样**：`renderer.render(scene,camera)` + `gl.readPixels`
  放在同一个 JS 任务内完成（本项目钩子 `__globeDebug.samplePixels(pts)`），同状态两次差 0~97。
  采样点要**半格错相** `(i+0.5)/n` —— x＝地心那一列正压着 1~2px 宽的晨昏线细线，
  两种抗锯齿结果会让"确定性"自检假报不一致。
- **椭圆轨道不能用两点线性外推**求极值对应的角度（`ORBIT_E=0.16` 时残差可达 8.4°）：
  改"粗扫 24×15° + 细扫 ±15°（步长 2.5°）"取盘心亮度极值；且搜索前**先关掉干扰图层** ——
  找"正午"时忘了关城市灯光，上海午夜灯火（249）比白天（171）还亮，会把最亮点定到午夜。
  本机亮度标定：夜 40 / 昼 171 / 夜+灯火 249 ⇒ 判白天用 `>130`，不是 `>200`。

## 抢答/轮次类游戏：每条分支都必须有「下一题」出口

`province-quiz` 双人 PK 曾死锁：推进下一题的 `setTimeout` **只写在"答对"分支里**，
答错分支 `return` 掉；而按钮 `disabled={leftWrong || winnerName}` ⇒ 双方都答错时
题号不动 + 按钮全禁 = 永久卡死（界面还停在"本题作废"看着像正常状态）。

写这类状态机时的固定规矩：
- 把推进逻辑抽成**唯一一个** `settleQuestion()`，所有"本题结束"的分支都调它；
- 用 ref 做**已结算**与**定时器**双保险，防止重复挂定时器导致跳题 / 卸载后 setState；
- 遍历**所有能结束本题**的分支（答对、答错、双方答错、超时、放弃…），逐个确认都有出口。

回归测试打法（无需知道正确答案）：左右两侧渲染的是**同一份 options 数组**，
同下标必同名 ⇒ 左侧押 0 号、若被锁定则右侧也押 0 号，必然复现"双方都答错"。
然后断言每题题号都 +1、最后能进结果页。脚本见 `.workbuddy/tmp/pkverify/shot.js`。

## 纯逻辑模块的 Node 测试写法（本仓库约定）

- **本机没有 esbuild**，但 Vite 8 自带 **rolldown**：
  `node_modules/.bin/rolldown src/gameData.ts --format cjs --file scripts/gameData.test.cjs`
  就能把含 `import json` 的 TS 模块打成 CJS 供 `require`。改了源文件必须重跑生成。
- 约定一条 npm script 串起来：`"test:data"` = 重新生成 + 跑 `scripts/*.test.cjs`。
  已有：`shanhe-match3`（布局可解性 + 提示文案），写新游戏时照抄。
- **改玩法/状态机，上架前必做真实渲染的逻辑回归**：Electron 指向真实 `dist/web`、
  `postMessage` 注入名单、`sendInputEvent` 驱动、断言 DOM 数字。套路见 skill
  `frontend-visual-verify` §9（含 3 个脚本自身的坑）。

## GAME_INIT 名单人数会影响游戏首屏

`roster.length === 1` 时，`shanhe-match3` / `province-quiz` 会**跳过选人环节直接进主流程**。
写自动化脚本时不能无条件去点 `.student-grid button` —— 先 `Boolean(document.querySelector(...))`
判断，否则元素不存在 → promise 拒绝 → electron 挂死不退出（本轮白等 4 分钟）。

## 消除即检查点：悔棋不能把已消除的一组变回来（v1.0.1）

`shanhe-match3` 的悔棋按「每点一张牌前压一份局面快照」实现，于是**触发消除的那一手压进的
快照是「消除之前」的状态** ⇒ 消除后点悔棋，整组三张牌复活（两张回卡槽、一张回牌面），
卡槽被塞满，`cleared` 与积分也一起被推翻。用户报的就是这个。

- **消除是检查点**：消除分支里 `setHistory([])` 清空历史栈 ⇒ 悔棋按钮自动置灰，只能回退
  「这次消除之后」的操作。快照入栈只放在「未消除」分支，别在函数开头无条件入栈。
- `handleUndo` 加断言式兜底：`prev.cleared.length !== cleared.length` 就丢弃该快照并清栈，
  防止以后重构又把「会让已消除组复活」的快照放进栈。
- 按钮置灰必须**在提示栏说明原因**（`.hint-bar.is-note` 虚线冷底 + 标签「检查点」），
  否则学生只会觉得「点了没反应」。
- **验证脚本的断言要从「期望行为」重写，不能照抄实现**：上一轮脚本里那条
  「悔棋把整组三张牌都退回来」把错行为固化成了守门人，不改断言就永远测不出这个 bug。
  打法：新断言先跑**旧产物**复现（9 条红）→ 再跑修复版（47 条全绿），两份 report 都归档。
