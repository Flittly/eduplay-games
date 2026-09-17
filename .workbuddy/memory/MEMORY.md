# eduplay-games 项目长期记忆

> 高频规则索引。**完整来龙去脉、脚本路径、复现打法见 `pitfalls-archive.md`**（不自动注入，按需查）。
> 渲染专属细节见 `globe-and-solar-notes.md`、`mountain-zones-notes.md`；逐日日志见 `YYYY-MM-DD.md`。

## 环境（本机固定）

- **bash PATH 被污染**，每条命令前先修：
  `export PATH="/usr/bin:/bin:/c/Users/Administrator/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:/c/Users/Administrator/.workbuddy/binaries/PortableGit/versions/1.2.0/mingw64/bin:/c/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3:/c/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12:$PATH"`
- 图形/Electron 命令另需 `export MSYS2_ARG_CONV_EXCL='*'` + `unset ELECTRON_RUN_AS_NODE`。
- 本仓库无 electron，用 `E:/Self/workspace/eduplay/desktop/node_modules/electron/dist/electron.exe`。
- Git Bash 里 `python /e/...` 会被解析成 `E:\e\...`（多一层盘符）⇒ 用 `cd "E:/Self/..."` 或写 `E:/...`。

## 每个游戏改版本必须三处同步

`manifest.json` 的 `version` == `package.json` 的 `version` == `src/main.tsx` 的 `const version`。
机器检查：`node scripts/roster-guard.cjs`（顺带查版本三处一致 + 下面那条 requiresRoster）。

### `requiresRoster` 别填错（v1.0.0 就是这样把 geo_gomoku 弄挂的）

平台判定式：`needsRoster = manifest.requiresRoster !== false`。
**填 `false` 有两个后果**：①平台跳过选人页 ②只发空 roster。
⇒ 只适合「不需要点名的展示型游戏」（地球仪 / 太阳系 / 山地沙盘）。
**凡源码里有 `roster.length === 0` 渲染闸门或双人逻辑的游戏，都必须是 `true`（或缺省）。**
填错的表现：进游戏只有「正在等待平台下发学生名单…」，永久无法进入 —— 而**游戏本身没毛病**，
从游戏侧完全看不出问题在哪。`scripts/roster-guard.cjs` 就是替人对这一步的（负向测试验证过会红）。

### 上架 ≠ 可用：平台读的是「已安装」的那份 manifest

`GET /store/games/{code}/manifest` 读的是 `plugins/installed/{userId}/{code}/{version}/`，
**不是**刚上传的包里那份。所以改完 manifest 只做 publish，用户那边读到的还是旧字段。
补一步安装（教师令牌，不需要激活码）：`POST /store/games/{code}/package-install`（multipart `file=`）。
唯一成功判据升级为：`GET /store/games/{code}/manifest` 返回新 version **且字段已生效**。
注意 `POST /store/games/{code}/install` 会被 `ENTITLEMENT_REQUIRED` 拦住，这条才是要走的。

## 打包 / 上架

- 构建：游戏目录 `npm run build`（`tsc --noEmit && vite build` → `dist/web/`）。
- 一条龙脚本：`.workbuddy/tmp/publish_<name>.py`（照 `publish_legend.py` 抄）
  = 打 zip（`manifest.json` + `dist/web/**`）→ `POST /admin/games/{code}/packages` → `PATCH .../status ACTIVE`。
- 双后端：本地 `7070`、云端 `17070`；admin `admin/admin123`、教师 `123456/123456`。
- **接口全在 `/api/v1` 下**。漏前缀会打到静态资源、被包成 HTTP 500 `INTERNAL_ERROR`
  —— 看着像后端挂了，其实只是路径写错。
  同形状的坑：**接口在云端 `server` 模块里压根不存在**也会这样（如 `/store/games/{code}/manifest`、
  `/install`）。碰见全站所有游戏都 500 时，先去 `server/server-run.log` 找
  `NoResourceFoundException: No static resource ...` —— 那是"没有这个接口"，不是"接口报错"。
- **唯一成功判据**：教师令牌 `GET /store/games` 里该 `gameCode` 可见、版本是新的、ACTIVE。
  `POST /store/games/{code}/install` 报错是已知干扰项，不影响上架。
- **两个接口形状/有无的坑（2026-09-17 实测）**：
  ① `GET /store/games/{code}/manifest` **直接返回 manifest 本体**，不套 `{success,data}`
  —— 按包装解会拿到 None，看着像"接口没实现"，其实 HTTP 200。两种形状都要认。
  ② 云端 `server` 模块的 `CloudGameStoreController` 只有 `/games`、`/redeem`、
  `/games/{code}/package`、`/games/{code}/cover`；`/manifest`、`/install`、`/package-install` 全 500。
  所以**云端核对"用户拿到的版本"要下 `/package` 那个 zip、解开读包内 `manifest.json`**，
  不用去补 `package-install`。`publish_geomoku.py --install` 已按后端能力分流（`verify_installed()`）。
  ③ **云端 `/package` 对未兑换的游戏返回 `ENTITLEMENT_REQUIRED`（JSON）** ——
  直接拿 `zipfile` 开只会得到 `File is not a zip file`，看着像脚本坏了。**先认 `PK` 魔数**再分类报错；
  核不了就如实说"核不了"，判据退回"教师端可见 + 版本号 + ACTIVE"。
  ④ **本地 `/manifest` 读不到（`GAME_NOT_INSTALLED`）不等于失败** —— 新游戏首次上架时
  把它装上正是这一步的目的；旧脚本 `before is None → return False` 会让核对**永远失败且什么也没做**。

## 素材图（实景照片）采集

- 首选 **Wikimedia Commons 官方 API**（`generator=categorymembers` 取 `Category:`，不足再退自由文本搜索），
  只收 JPEG（地图/卫星图几乎都是 PNG）。360 图片源 2026-09 已死；百度作兜底但需先建 cookiejar。
- **能查分类就别搜关键词**，跨境山脉尤其：小兴安岭英文正名 `Lesser Khingan`，
  `Category:Lesser Khingan` 4 个文件里 3 个在俄罗斯。
- 缩略图**必须用 API 给的 `thumburl`**，非标准宽度（只认 20/40/60/120/250/330/500/960/1280/1920/3840）会 HTTP 400。
- 挑图**按裁完之后的样子**看（`normalize()` 先裁 16:10 偏上取 32% 再压 900px），
  别只看原图缩略图 —— 天空占比大的会挑错；`MIN_ACCEPT_W=700` 是在**裁切之后**量的。
- 五类"标题对、图不对"：同名寺庙/陵墓、同名古生物（`Yinshanosaurus`）、城市全景（山只当背景）、
  换了主体（"雪松林"→树皮特写）、舷窗照（带飞机翼尖）。
- 脚本跑在**带 Pillow** 的解释器上：`C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe`。
  参考实现 `china-relief/scripts/`（`fetch_photos.py` / `pick_photos.py` / `sheet_selected.py` / `photo_rules.test.py`）。
## 双端商城对齐（盘点 / 补齐 / 核对）

- **工具**：`scripts/publish_batch.py`（仓库根，2026-09-17 起）。`--audit` 只读出核对矩阵；
  默认双端对齐（缺的补、落后的升，再出矩阵）。**不维护"缺哪些"的清单，每次现算** ——
  仓库 manifest 是唯一真值：admin 无记录→create；教师端版本落后→publish；非 ACTIVE→activate。
- **"教师端拿到的版本"才是真的**：admin 列表的 `version` 是 `game_product.version` 独立列，会长期陈旧
  （本地 `province_quiz` 那列还写着 0.2.3，教师端早已 1.0.0）。核对读 `GET /store/games` 的版本。
- **三套存储别搞混**（2026-09-17 实测）：①**H2 文件库** `eduplay/backend/data/eduplay.mv.db`
  = **本地 7070**（**本地商城根本不碰 MySQL**，11 款游戏全在这份）；②**MySQL**
  `localhost:3306/eduplay_cloud` = **云端 17070**；③**MySQL(Docker)** `localhost:3307`
  = 研究生项目 / nacos，**从来没有任何 eduplay 库**。17070 虽叫"云端"，进程与库都在本机
  ⇒ 那是**用本机模拟云端**。读 H2 用 `org.h2.tools.Shell` + `AUTO_SERVER=TRUE`（文件被 7070 锁着也能读）。
- **两个侧边栏入口各读各的库**（"看起来游戏少了"的头号原因，2026-09-17 实测）：
  「**游戏商城**」`nav.store`（`StorePage.tsx`）= `cloudListStoreGames()` → `/cloud-api` → **云端 MySQL**；
  「**游戏中心**」`nav.games`（`DashboardPage.tsx`）= `listInstalledGames()` → `/api/v1/me/games` → **本地 H2**。
  商城页的**卡片数由云端决定**，卡上的「本机已安装」标记才是本地信息；**未登录云端账号时商城页只显示登录框**。
  `/cloud-api` **不是直连**：前端 → 本地 7070 `CloudApiProxyController` → `app_settings.cloud.base-url`
  （缺省回落 `application-local.yml` 的 `${EDUPLAY_CLOUD_URL:http://localhost:17070}`）。
  ⚠ 后端登录接口是 **`/api/v1/auth/local/login`**，写成 `/auth/login` 会返回 **500 `INTERNAL_ERROR`**
  （本项目"接口不存在"被包成 500 而非 404），极易误判成后端崩了。
- **判断"数据被删过吗"的五条硬取证**（都比数行数可靠）：①库目录 birth time（MySQL 8 每库一子目录，
  DROP 重建会刷新它）；②**`.ibd` 文件创建时间**（DROP 会连它一起删、重建会生成新文件 ⇒ 时间变新）；
  ③**binlog 全量按表数 `INSERT/UPDATE/DELETE` 次数**（最强，见下条）；④自增值 vs `MAX(id)`；
  ⑤数据目录里到底有没有那个库。
  注意 PowerShell 读 `C:\ProgramData` 会被沙箱拦成**空输出且 exit 0**（像"目录不存在"），改用 Python `os.stat().st_ctime`。
- **binlog 全量取证怎么用**：复制 binlog 到工作区 → `mysqlbinlog --base64-output=DECODE-ROWS -v` 解码 →
  跟踪 `use` 判当前库 → 按「库.表」统计事件。2026-09-17 实测 `eduplay_cloud.game_product`
  **INSERT 12 / DELETE 0**（从建库到当天只插过 12 行、一行没删），一次正面回答了"是不是表被删了"。
  ⚠ **两个坑**：①`### INSERT/UPDATE/DELETE` 行**也以 `#` 开头**，按"跳过 `#` 注释"过滤会把
  **全部 DML 一起扔掉**、只剩 DDL，于是得出"这库只有建表没有数据变更"的错误结论；
  ②不带库名前缀的 DDL 作用于"最近一次 `use` 的库"，看到 `drop database` 要先确认删的是哪个库
  （早期临时库 `eduplay` 的清理不是事故）。**工具：`scripts/binlog_audit.py`**（一条命令出报告：
  时间跨度 + 各表读写次数 + 危险语句），完整方法见 skill `eduplay-game-publish` §5.3。
- `game_package` **没有 `game_code` 列**（走 `game_id` 关联 `game_product`），按 code 直接查会报列不存在。
- **判断"用户实际能玩到哪版"最直接的证据**是 `eduplay/backend/plugins/installed/{userId}/{code}/`
  下**有哪些版本目录** —— 比查任何 DB 字段都准。
- **"数据库里明明有，怎么没了"先看自增值**：`auto_increment == MAX(id)+1` ⇒ 这些行**从未被创建过**
  （若曾创建再删除，计数会停在更大值上）。2026-09-17 就靠这条定性了
  "云端缺 6 款是**从未上架**，不是被删"。再顺手全库扫 `information_schema.tables LIKE '%game%'` 排除记错库。
- **但 id 有空洞 ≠ 被删过**：Hibernate 号段生成器（`allocationSize=50`）一次占一段 id、用不完就浪费。
  本地 H2 的 `game_product.id` 是 `1,2,3,4,35,36,37,69,70,71,101`，看着像删了几十行，其实不是。
  **要判删除，看 binlog 的 `DELETE FROM` 计数，不看 id 空洞。**
- **商城条目数 == `game_product` 里 `status='ACTIVE'` 的行数**：`CloudGameStoreService.listStoreGames()`
  只按这一个条件过滤（不看包、不看权益、不按用户过滤）。所以"商城少了几个"等价于"表里 ACTIVE 行少了几个"，
  而"线上看起来少"最常见的真因是**看错了端**（本地 H2 11 款 vs 云端 MySQL 到 09-08 只有 4 款）。
- `game_package.status` 有 `PUBLISHED` / `MISSING` 两态：**`MISSING` = 文件已从磁盘消失**
  ⇒ "DB 里有行"≠"用户下得到包"。云端包落在 `eduplay/server/plugins/packages/`。
- **端到端验证凑三层独立证据**（别只信自己脚本的输出）：DB 直查 → 磁盘文件存在 →
  **包 sha256 与本地打包字节逐一比对**（`game_package.sha256` 列直接对）。
- **产物新鲜度判据**：只看 `dist/web/index.html` + `assets/index-*.js|css` 的 mtime ——
  别用目录里最旧/最新（`public/` 的 cover.svg、textures/ 是复制过去的、保留原 mtime，会把
  **每个**游戏都误判成"需重建"）；判据里也**别含 `package.json`**（版本号三处同步会顺手动它）。
- **商店里版本比仓库高的不许静默降级**（孤儿版本，如 `province_puzzle 0.3.8`）：默认只报警，
  要动得显式 `--force`。判断孤儿版本是否有害，就解开两个 zip 逐文件比 sha256。

- **简介只改 `manifest.json` 的 `description`**，重传包即自动同步（别在脚本里硬编码 DESC）；目标 ≤120 字。
- `screenshots/` 已被 gitignore，验证图只留本地。

## 通用编辑纪律

- **同一文件连续多处 Edit 会静默丢改动**（曾在 `EarthGlobe.tsx` 上发生 6 次）⇒
  成批编辑后 `grep` 关键标记确认，立刻 `npm run build`。
  **更狠的一种：同一文件的两处 Edit 并行发出 = 后写覆盖先写**，而两次都报"成功"
  （2026-09-17 实测 2/2，`fetch_photos.py` 的 docstring 与 `MEMORY.md` 各丢一处）。
  ⇒ **一个文件永远串行改**；改完必须 `grep` 每个关键标记，不能只看工具回执。
- **验证脚手架三条铁律（都会静默失败）**：①静态服务不能跨 Bash 调用存活，须「起服务→探活→跑
  Electron→收尾」同一次调用串完；②验证目录绝不能与脚本目录共用（否则 rmtree 删掉脚本）；
  ③`electron .` 要求 cwd 有 `package.json` 且写 `main`，缺则 exit=1 日志空白。
- **前端回归尽量不往产品里塞调试钩子**：把随机源（如 `Math.random`）在 iframe 内换成确定队列，
  再点产品自带的"换一个"按钮触发；期望值从 **DOM 里学生实际看到的东西**读。
  产品零改动，断言口径与学生一致。套路见 skill `frontend-visual-verify` §9.10。
- **"两处都对、但两处不同"最容易把测试写成假红**（如范围读数从南到北、棋盘排版上北下南）。
  遇到就在断言里**把顺序本身也写成一条**，而不是调成"看起来一致"。
- **`grep -c` 匹配 0 行时退出码是 1**，串在 `&&` 后面会把整条命令链截断，看着像构建失败。
- **重建产物后同步验证目录**：先 `taskkill` 停服务（cwd 删不掉）再 rmtree，清目录一律走
  Python，**不要 `rm -rf`**；并用「旧 hash 404 + 新 hash 200」证明服务端真换了产物。
- **样式是否生效看 `getComputedStyle`，不看截图**（软渲染会给"类名生效、画面还上一帧"的图）。
- **像素指标必须随被测参数单调**，不单调就是指标写错了。优先用**计数型**指标，
  最好能构造「理论上应等于某个已知量」的断言；写探针前先跑漂移自检。
- **改玩法/状态机，上架前必做真实渲染逻辑回归**（Electron 指真实 `dist/web` + `sendInputEvent`），
  套路见 skill `frontend-visual-verify` §9。
- **写回归脚本的取点/取色辅助函数时，别踩这三个坑**（都会造成假红/假绿）：
  ①**别用"遍历顺序"当海拔顺序** —— 断言"最低带 vs 最高带"必须先按 `band.from` 排序；
  ②**别取"落在某带各列的中位"** —— 山有两坡、同一条带左右各出现一次，拼起来取中位拿到的是
  两坡交界那列（正压着带界），取到的是邻带配色；要取**离带海拔中点最近**的那列；
  ③**别用"单列 × 几像素"的小窗口做开/关图层对比** —— 那测的是"这列正好被一株植株压住没有"，
  是撞运气（同一份代码实测一次 Δ=78、一次 Δ=5）；改用**多列 × 多采样点计数**或**整带区域均值**。
- **模拟真实点击的辅助函数必须能自证**：先 `scrollIntoView`，再用 `document.elementFromPoint`
  回报"这个坐标最上层是哪个元素"，并把命中层写进失败信息。否则元素被遮/滚出视口时事件静默落空，
  表现成"点了没反应"，只能靠猜。另注意面板按钮文案常是**单字**（如季节「春/夏/秋/冬」）。
- **调精灵外观单开一个"只落盘拼版大图"的快脚本**（本项目 8 s vs 完整回归 48 s），
  照 `.workbuddy/tmp/mzverify2/sheetrun/sheet.js` 抄。它必须和主脚本一样加
  `app.commandLine.appendSwitch` 的 `no-sandbox` / `disable-gpu-sandbox` / `disable-http-cache`，
  漏掉时 GPU 进程连续崩溃且**日志一行没有**，看着像脚本写错了。
  纯外观迭代可**覆盖式同步**产物到验证目录（不停服务、不删目录），正式回归前才做干净同步。
- **小尺寸精灵里"会飞的东西"别画俯视双翼**：两翼共用同一翼尖会并成实心楔形（读不出是鸟）。
  改侧视剪影（躯干 + 头喙 + 尾羽 + 单只上扬的翼）。且**静止相（frame 0 / 任何 freeze 都要好看）**
  必须已有明显抬起的翼 —— 只抬 0.15·height 等于没改。蝴蝶要单独画，别套鸟的剪影。
- **黑名单 / 关键词过滤一律按"完整路径段或词边界"匹配，别做子串匹配** —— 子串会误杀地名，
  而误杀是**静默的**（表现只是"取不到"，看着像网络问题）。取舍标准：**误杀比误放更糟**——
  误放的坏图会在拼版复核里一眼看见，误杀只会让人以为"这里本来就没有图"。
  定稿后**双向**写规则自测（既拦真广告位，也放行 `Heshigten Banner.jpg` 这类正常文件名）；
  只测前一半的话，把规则收紧到"什么都不放行"也能全绿。见 `china-relief/scripts/photo_rules.test.py`。
- **补丁脚本按"跑第二遍无副作用"写**，最好按计数判断（如"同名小节出现 ≥2 次才删第二份"）——
  工具层的授权升级会把整条命令**重跑一遍**，追加型改动会静默变双份（本轮 skill 就被插了两遍）。
- **断言别只看"标签在不在"，要看"学生真的看到什么"**：`<img>` 存在 ≠ 图存在。
  要断言 `naturalWidth > 0` 并逐一点名应有几张。（china_relief 旧断言在 38 张照片**全部 404** 时
  仍然全绿，是典型假绿——从 `server.log` 里 `photos/*.jpg → 404` 才揪出来。）

## 游戏设计层的固定结论

- **每条分支都必须有出口**：轮次/抢答类游戏把推进逻辑抽成唯一 `settleQuestion()`，
  所有结束分支都调它；用 ref 做"已结算 + 定时器"双保险。
- **消除是检查点**（`shanhe-match3`）：消除分支清空历史栈，悔棋只能回退消除之后的操作；
  置灰必须说明原因。
- **双人 PK 三阶段** `arrange → battle → result`，先「出战安排」再对战，
  N 人擂台制负者不回流，全程用姓名；照抄 `weather-quiz/src/DualQuiz.tsx`。
  CSS 标红须写 `.pk-side .pk-options button.is-answer`（0,3,1），否则被 (0,3,0) 压过。
- **验证断言必须从「期望行为」重写，不能照抄实现**（否则把 bug 固化成守门人）；
  新断言先跑旧产物复现红、再跑修复版全绿，两份 report 都归档。
- **同一组图例必须共用同一条几何路径、只差线型**，否则学生靠别的差异蒙对。
- **符号类素材必须单独拼大图复核**（165px 卡面上判不出"像不像"）。
- `roster.length === 1` 时部分游戏会跳过选人环节 ⇒ 自动化脚本先判断元素存在再点。

## 纯逻辑模块的 Node 测试写法

本机无 esbuild，用 Vite 8 自带的 rolldown：`rolldown src/x.ts --format cjs --file scripts/_x.cjs`
把 TS 打成 CJS 供 `require`；约定 `npm run test:data` = 重新生成 + 跑 `scripts/*.test.cjs`。
改了源文件必须重跑生成。

## mountain_zones 专属

见 `mountain-zones-notes.md`。三条最容易踩的：
①**海拔（`elevationOffset`，真值）与视觉高度（`verticalExaggeration`，仅渲染）必须用两份数组**，
`raw` 只读 / `alt = max(0, raw+offset)` / `visualY = alt*exag` 只在顶点用一次；
②**TPI 阈值必须取高分位（p90≈70 m），取中位数会标出 25% 的格子**；
③**水系阈值前必须守卫 `maxAcc > 0`**（全山在雪线以上时会把 65536 格全判成河道）。

## 游戏清单（`gameCode` / 当前版本）

`province_puzzle 0.3.7` · `shanhe_match3 1.0.1` · `province_quiz 1.0.0` · `geo_gomoku 1.1.0`
· `earth_globe 1.4.5` · `solar_system 1.1.2` · `landform_quiz 1.3.0` · `weather_quiz 1.0.0`
· `legend_match 0.0.1` · `mountain_zones 2.0.0` · `china_relief 1.0.0`（山河塑形·中国地形）

> `china_relief`：纯展示型（`requiresRoster=false`），38 张卡 = 11 地形区 + 27 山脉，
> DEM 用 AWS Terrarium（`h = R*256 + G + B/256 − 32768`），等距圆柱 + cos(36°) 经度修正。
> **v1.0.0 起渲染层是 Canvas 2D 俯视分层设色（卡通），已彻底摘掉 three.js**：
> 高度场仍是 `y = alt[k]·lift[k] + add[k]`，但"高度"只用来判 7 个色档 + 明暗 + 档间描边，
> 不再驱动几何。回归：`npm run test` = 62（纯逻辑）+ 16（图源规则）项，
> Electron `shot.js` 85 项；`.workbuddy/tmp/publish_china_relief.py` 双端上架。
