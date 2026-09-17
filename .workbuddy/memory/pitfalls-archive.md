# 踩坑详情归档（MEMORY.md 的展开版，不自动注入，按需查阅）

> MEMORY.md 只留高频规则与结论；这里是每条规则的**完整来龙去脉、脚本路径、复现打法**。
> 新增踩坑时：结论写进 MEMORY.md，详细过程写到这里。

## 1. 本机环境（完整版）

- bash 的 PATH 被污染：直接跑 `ls`/`wc`/`node` 会 `command not found`
  （报错来自 `shim/shell-runtime-bash-env.sh: line 3: dirname: command not found`）。每条命令前先修：

  ```bash
  export PATH="/usr/bin:/bin:/c/Users/Administrator/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:/c/Users/Administrator/.workbuddy/binaries/PortableGit/versions/1.2.0/mingw64/bin:/c/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3:/c/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12:$PATH"
  ```

- 图形命令（Electron 截图）需 `export MSYS2_ARG_CONV_EXCL='*'` + `unset ELECTRON_RUN_AS_NODE`；
  `taskkill /IM electron.exe /F` 前也要 `MSYS2_ARG_CONV_EXCL='*'`。
- 本机 WebGL 只能在 SwiftShader 软渲染下跑，Electron 需 `--no-sandbox --disable-gpu-sandbox
  --use-angle=swiftshader --enable-unsafe-swiftshader`，详见 skill `frontend-visual-verify`。
- **eduplay-games 仓库自己没有 electron**，用平台仓库那个：
  `E:/Self/workspace/eduplay/desktop/node_modules/electron/dist/electron.exe`。
  跑法（`cd` 到验证目录后再跑，脚本目录只放 `shot.js` 与探针）：
  `export MSYS2_ARG_CONV_EXCL='*' && unset ELECTRON_RUN_AS_NODE && <上面那个 exe> .`
- **Git Bash 里 `python /e/...` 会被解析成 `E:\e\...`**（多一层盘符）。
  用 `cd "E:/Self/..."` 再跑相对路径，或直接写 `E:/...` 风格的 Windows 路径。
- Node/rolldown：别写 `node_modules/.bin/rolldown`，本机会报"不是内部或外部命令"，
  用 `npm run` 里写的相对路径。

## 2. 上架流程（完整版）

- 单游戏一条龙脚本：`.workbuddy/tmp/publish_<name>.py`，最全的是 `publish_legend.py`
  （多了 zip 结构自检 + 素材条数断言）；旧的：`publish_solar.py`、`publish_globe.py`、
  `publish_demo_games.py`（earth-globe + solar-system 一起）。
- 流程 = 打 zip（`manifest.json` + `dist/web/**`）→ `POST /admin/games/{code}/packages`
  → `PATCH /admin/games/{code}/status` = `ACTIVE`。
- `AdminGameService.uploadPackage()` 里有 `if (manifest.description() != null) product.setDescription(...)`，
  所以改 `manifest.json` 的 `description` 后重传包，商城/游戏中心简介自动同步，不必另找更新接口。
- **所有后端接口都在 `/api/v1` 下**（`/api/v1/admin/login`、`/api/v1/admin/games`、`/api/v1/store/games`）。
  手写探测脚本漏了这个前缀会打到静态资源上，被 `GlobalExceptionHandler` 包成
  **HTTP 500 `{"code":"INTERNAL_ERROR"}`** —— 看着像后端挂了，其实只是路径写错，别被误导去查数据库/日志。
- 脚本里 `POST /store/games/{code}/install` 用 admin token 会失败（本地 403「只有教师账号可以使用商城」，
  云端直接 500）。这是脚本的老问题，**不影响上架** —— 版本与 ACTIVE 状态都已生效。
- 校验方式：教师账号登录后 `GET /store/games` 确认 `gameCode` 可见且 version 是新的。
- 验证截图：`screenshots/` 已被 `.gitignore` 忽略（`**/screenshots/`），归档的验证图只留本地、不进仓库。

## 3. 双人 PK 结构（完整版）

平台下发的 roster 常常不止 2 人，而 PK 一次只能上 2 个。旧版 `DualQuiz` **根本不接 roster**，
大屏只有"左侧玩家 / 右侧玩家"，而且第 3 个人起完全无从上场 —— `province-quiz` 与
`weather-quiz` 都犯过。

- **三阶段**：`arrange → battle → result`。`arrange` 页 = 左/右席各一个候选人按钮组
  （全部学生都在里面）+ 下方「候场 N 人」有序列表。
  换人规则：**点对面席上的人 = 两边对调**；**点候场的人 = 他上台、原席位的人退回候场队首**。
- **负者不回流**（擂台制）：N 个人恰好打 N−1 场就全员上场；每场结果页给「下一位上台：某某」。
- **全程用姓名**：两侧标题、抢答/锁定提示、顶部计分板、结算板。PK 页不要出现"左侧/右侧玩家"。
- `roster.length < 2` 时补一位 `studentId: -2` 的「陪练同学」，体验模式（虚拟名单）也能试玩 PK。
- 新游戏照抄 `weather-quiz/src/DualQuiz.tsx`（最完整），别从 `province-quiz` 的老版派生。
- **CSS 陷阱**：`.right-side .pk-options button` 是 (0,3,0)，会压过 `.pk-options button.is-answer`
  的 (0,2,0) ⇒「双方都答错时右席的正确答案标红」静默失效。标红规则必须写成
  `.pk-side .pk-options button.is-answer` (0,3,1)。
- **PK 回归脚本**：`.workbuddy/tmp/pkcheck/shot.js`，参数化 `PK_PORT` / `GAME_LABEL`，两游戏各 25 条断言。

### 抢答/轮次类游戏的死锁教训（`province-quiz`）

推进下一题的 `setTimeout` **只写在"答对"分支里**，答错分支 `return` 掉；而按钮
`disabled={leftWrong || winnerName}` ⇒ 双方都答错时题号不动 + 按钮全禁 = 永久卡死
（界面还停在"本题作废"看着像正常状态）。

- 把推进逻辑抽成**唯一一个** `settleQuestion()`，所有"本题结束"的分支都调它；
- 用 ref 做**已结算**与**定时器**双保险，防止重复挂定时器导致跳题 / 卸载后 setState；
- 遍历**所有能结束本题**的分支（答对、答错、双方答错、超时、放弃…），逐个确认都有出口。

回归测试打法（无需知道正确答案）：左右两侧渲染的是**同一份 options 数组**，同下标必同名
⇒ 左侧押 0 号、若被锁定则右侧也押 0 号，必然复现"双方都答错"。然后断言每题题号都 +1、
最后能进结果页。脚本见 `.workbuddy/tmp/pkverify/shot.js`。

## 4. 消除即检查点（`shanhe-match3` v1.0.1）

悔棋按「每点一张牌前压一份局面快照」实现，于是**触发消除的那一手压进的快照是
「消除之前」的状态** ⇒ 消除后点悔棋，整组三张牌复活（两张回卡槽、一张回牌面），
卡槽被塞满，`cleared` 与积分也一起被推翻。用户报的就是这个。

- **消除是检查点**：消除分支里 `setHistory([])` 清空历史栈 ⇒ 悔棋按钮自动置灰，
  只能回退「这次消除之后」的操作。快照入栈只放在「未消除」分支，别在函数开头无条件入栈。
- `handleUndo` 加断言式兜底：`prev.cleared.length !== cleared.length` 就丢弃该快照并清栈。
- 按钮置灰必须**在提示栏说明原因**（`.hint-bar.is-note` 虚线冷底 + 标签「检查点」），
  否则学生只会觉得「点了没反应」。
- **验证脚本的断言要从「期望行为」重写，不能照抄实现**：上一轮脚本里那条
  「悔棋把整组三张牌都退回来」把错行为固化成了守门人，不改断言就永远测不出这个 bug。
  打法：新断言先跑**旧产物**复现（9 条红）→ 再跑修复版（47 条全绿），两份 report 都归档。

## 5. 验证脚手架三条铁律（三条都会**静默失败**）

1. **静态服务不能跨 Bash 调用存活**：`python -m http.server` 是子进程，上一次调用结束就被回收，
   下一次里 Electron 报 `ERR_CONNECTION_REFUSED`。固定动作 =「起服务 → 探活 → 跑 Electron → 收尾」
   **在同一次 Bash 调用里串完**；要跨调用就用 `run_in_background: true` 单独托管。
2. **验证目录绝不能和脚本目录共用**：`sync.py` 的 `V` 一旦指向脚本所在的 `…/lmrun/`，
   `shutil.rmtree(V)` 就会把 `shot.js` / `sync.py` / 截图一起删掉（本机 safe-delete 会拦下并报
   `OSError [safe-delete] ... trash operation`，别把"被拦下"当成"操作成功"）。
   站点一律单独开子目录（`…/lmrun/site/`），并用 `--directory` 起服务，彻底避开 cwd 与删除的牵连。
3. **`electron .` 要求 cwd 有 `package.json` 且写了 `main`**：缺这个文件时直接 exit=1 且日志**完全空白**，
   看着像 Electron 崩了。每个验证目录都补一份 `{"main":"shot.js"}`。

## 6. 重建后同步验证目录：先停服务再清目录

`python -m http.server` 的 cwd 就是它服务的目录，**Windows 下删不掉被当作 cwd 的目录**：
`rm -rf`（本机还会被 safe-delete 拦下，报 `genie-trash failed` + exit 1）和
`shutil.rmtree(ignore_errors=True)` **都会静默失败**，`copytree` 只是盖上去 →
旧的 `index-<旧hash>.js` 仍留在目录里、仍返回 200。曾因此拿"新旧混装"目录跑过一轮。

固定动作：`netstat -ano | grep <port>` 取 PID → `taskkill /PID <pid> /F` → 再 rmtree/重建 →
重启服务 → **用「旧 hash 必须 404、新 hash 必须 200」证明服务端真换了产物**。
清目录一律走 Python（`shutil.rmtree`），**不要用 `rm -rf`**。脚本：`.workbuddy/tmp/wqverify/sync.py`。

## 7. 全量素材体检

游戏包的图片有两类静默故障——路径写错、SVG 因引号/编码问题成非法 XML（`onerror` 但页面不报错）。
让页面自己 `fetch` 数据 JSON、把所有 `image` 一次性载一遍（`executeJavaScript` 会 await 返回的
Promise，直接写 async IIFE），断言 `checked === 期望条数` 且 `failed` 为空。
`weather-quiz` 用这招 3 秒扫完 188 个引用（100 题 + 88 图鉴），顺带证明了 `public/` 素材已进 `dist/web`。
**先跑它，再跑流程回归**，能省掉后面一堆噪声。

## 8. 样式是否生效看 `getComputedStyle`，不看截图

本机软渲染下 `capturePage()` 会给"**类名已生效、画面还是上一帧**"的图：断言读 DOM 拿到
`class="is-answer"` 是绿的，截图里按钮却还是旧配色，看着像"新样式没生效"，差点去白改 CSS。
只要结论依赖"某条 CSS 到底有没有生效"，就用 `getComputedStyle` 读
`backgroundColor / color / opacity / textDecorationLine` 的数字；截图只用于整体观感。

## 9. 符号类素材必须单独拼大图复核

游戏卡面只有 160~200px，符号"像不像"在这个尺寸下**无法判断**。`shanhe-match3` 与 `legend-match`
都是靠单独拼一版大图（240px）才抓出问题：宝塔被看成漏斗、拦河坝像一根黑棍贴在湖边、
梳状崖线挂在水管一侧。

更要紧的是**教学正确性**：同一组图例若除线型外还有别的系统性差异（如国界画直线、省界画波浪线），
学生能靠那个差异蒙对，绕开真正要考的能力。**同一组图例必须共用同一条几何路径、只差线型**
（国界＝双实线 / 未定国界＝双虚线 / 省界＝点划线 / 地区界＝短点线，共用 `BOUNDARY_D`）。

**实机截图里的异常像素要追**：`legend-match` 就是因一张卡上有根说不清的粗黑竖线，
追进去才连带发现另外 3 处画法问题。

## 10. 像素指标必须单调（`mountain-zones` v0.1.0 三维版）

**不要用「被改变的面积」衡量「密度/疏密」这类量。** 等高线疏密一开始用"开/关前后被压暗的
采样点数"当指标，读到 100m 184 点 / 200m 96 点 / 500m **781** 点 —— 细线密到一定程度
（每 ~7px 一条）会在屏幕上连成一片"面"，覆盖率反而先增后减。
**先问「这个指标随被测参数单调吗」，不单调就是指标写错了，不是功能坏了。**

正解换**计数型**指标：沿竖直扫描线取 900 点，逐点求"关/开"暗度，数下降穿过阈值的连续段
＝穿过几条等高线 ⇒ 暗带 42/21/9/6 vs 模型 42/21/8/4，既单调又自洽。
**能构造出「理论上应等于某个已知量」的指标，才是最强的断言。**
配套：写探针前先跑**漂移自检**（同状态隔 3 秒两次采样）。找指标过程的脚本要留下
（`mzverify/probe2.js` 面积法 vs `probe3.js` 扫描线法），它们是"为什么不用面积法"的证据。

## 11. three.js 时代的确定性像素采样（仅地球仪/太阳系/旧三维版适用）

- 构造「开/关某图层」的像素对比时，**必须先把自转和自动旋转都关掉**
  （`setRotate(false)` + `setAutoRotate(false)`；只 `setSpin(角度)` 不停止自转），
  并断言两次采样之间地球屏幕位置漂移 < 1px，否则对比无效。
- **软渲染下 `capturePage` 会抓到"画了一半的帧"**（同帧两次截图差可达 28 万像素），
  像素级对比一律改用**引擎内确定性采样**：`renderer.render(scene,camera)` + `gl.readPixels`
  放在同一个 JS 任务内完成（钩子 `__globeDebug.samplePixels(pts)`），同状态两次差 0~97。
- 采样点要**半格错相** `(i+0.5)/n` —— x＝地心那一列正压着 1~2px 宽的晨昏线细线，
  两种抗锯齿结果会让"确定性"自检假报不一致。
- **椭圆轨道不能用两点线性外推**求极值对应的角度（`ORBIT_E=0.16` 时残差可达 8.4°）：
  改"粗扫 24×15° + 细扫 ±15°（步长 2.5°）"取盘心亮度极值；且搜索前**先关掉干扰图层** ——
  找"正午"时忘了关城市灯光，上海午夜灯火（249）比白天（171）还亮，会把最亮点定到午夜。
  本机亮度标定：夜 40 / 昼 171 / 夜+灯火 249 ⇒ 判白天用 `>130`，不是 `>200`。
- **Canvas 2D 没有这些问题**：`getImageData` 可同步确定性取样，像素对比直接读即可。

## 12. 纯逻辑模块的 Node 测试写法（完整版）

- **本机没有 esbuild**，但 Vite 8 自带 **rolldown**：
  `rolldown src/gameData.ts --format cjs --file scripts/gameData.test.cjs`
  就能把含 `import json` 的 TS 模块打成 CJS 供 `require`。改了源文件必须重跑生成。
- 约定一条 npm script 串起来：`"test:data"` = 重新生成 + 跑 `scripts/*.test.cjs`。
  已有：`shanhe-match3`（布局可解性 + 提示文案）、`mountain-zones`。
- **改玩法/状态机，上架前必做真实渲染的逻辑回归**：Electron 指向真实 `dist/web`、
  `postMessage` 注入名单、`sendInputEvent` 驱动、断言 DOM 数字。套路见 skill
  `frontend-visual-verify` §9（含 3 个脚本自身的坑）。

## 13. GAME_INIT 名单人数会影响游戏首屏

`roster.length === 1` 时 `shanhe-match3` / `province-quiz` 会**跳过选人环节直接进主流程**。
写自动化脚本时不能无条件去点 `.student-grid button` —— 先
`Boolean(document.querySelector(...))` 判断，否则元素不存在 → promise 拒绝 →
electron 挂死不退出（本轮白等 4 分钟）。
