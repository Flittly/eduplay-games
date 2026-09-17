# eduplay-games 项目长期记忆

> 只放高频规则索引（目标 ≤4 KB）。明细按需查：`pitfalls-archive.md`（历史坑与复现打法）、
> `store-and-assets-notes.md`（双端商城取证 / 素材采集 / 编辑纪律全文）、
> `globe-and-solar-notes.md`、`mountain-zones-notes.md`；逐日日志 `YYYY-MM-DD.md`。

## 环境（本机固定）

- **bash PATH 被污染**，每条命令前先修：
  `export PATH="/usr/bin:/bin:/c/Users/Administrator/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:/c/Users/Administrator/.workbuddy/binaries/PortableGit/versions/1.2.0/mingw64/bin:/c/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3:/c/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12:$PATH"`
- 图形/Electron 另需 `export MSYS2_ARG_CONV_EXCL='*'` + `unset ELECTRON_RUN_AS_NODE`。
- 本仓库无 electron：`E:/Self/workspace/eduplay/desktop/node_modules/electron/dist/electron.exe`。
- 带 Pillow 的 Python：`C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe`。
- Git Bash 里 `python /e/...` 会解析成 `E:\e\...` ⇒ 一律 `cd "E:/Self/..."` 或写 `E:/...`。

## 改版本必做的三件同步

1. `manifest.json` / `package.json` / `src/main.tsx` 的 `version` 三处一致。
2. **`requiresRoster` 别填错**。平台判定 `needsRoster = manifest.requiresRoster !== false`；
   填 `false` ⇒ 跳过选人页 + 只发空 roster ⇒ **分数无归属**（china_relief v1.0.0 就这么坏的）。
   只适合纯展示型（地球仪 / 太阳系 / 山地沙盘）。**源码里有 `roster.length === 0` 渲染闸门
   或多人/计分逻辑的必须 `true`**。填错的表现是永远停在「正在等待平台下发学生名单…」，
   游戏本身没毛病，从游戏侧完全看不出。
3. **上架 ≠ 可用**：`GET /store/games/{code}/manifest` 读的是
   `plugins/installed/{userId}/{code}/{version}/` 那份，不是刚上传的包。补
   `POST /store/games/{code}/package-install`（multipart `file=`，教师令牌、不需激活码；
   `.../install` 会被 `ENTITLEMENT_REQUIRED` 拦）。**唯一成功判据**＝该接口返回新 version 且字段生效。

机器检查：`node scripts/roster-guard.cjs`（版本三处一致 + requiresRoster + 目录/清单一致）。

## 打包 / 上架

- 构建：游戏目录 `npm run build`（`tsc --noEmit && vite build` → `dist/web/`）。
- 一条龙：`.workbuddy/tmp/publish_<name>.py`（照 `publish_china_relief.py` 抄）= 打 zip
  （顶层只有 `manifest.json` + `web/`，脚本内自检）→ `POST /admin/games/{code}/packages`
  → `PATCH .../status ACTIVE`。
- 双后端：本地 `7070`（H2 文件库 `eduplay/backend/data/eduplay.mv.db`）、
  云端 `17070`（MySQL，其实也在本机）；admin `admin/admin123`、教师 `123456/123456`。
- **接口全在 `/api/v1` 下**；漏前缀或接口不存在都被包成 **HTTP 500 `INTERNAL_ERROR`**
  （看着像后端崩了）。判「接口不存在」去 `server/server-run.log` 找 `NoResourceFoundException`。
- 云端 `CloudGameStoreController` 只有 `/games`、`/redeem`、`/games/{code}/package|cover`；
  `/manifest`、`/install`、`/package-install` 在云端全 500 ⇒ **云端核对版本要下 `/package` 的 zip
  解开读包内 manifest**。`/package` 对未兑换游戏返回 `ENTITLEMENT_REQUIRED`（JSON）⇒ **先认 `PK` 魔数**。
- 商城条目数 == `game_product` 里 `status='ACTIVE'` 的行数（只按这一个条件过滤）。
  「线上少了」最常见的真因是**看错了端**：「游戏商城」读云端 MySQL，「游戏中心」读本地 H2。
- 双端盘点/补齐：`scripts/publish_batch.py`（`--audit` 只读矩阵；不维护清单，每次现算）；
  取证工具 `scripts/binlog_audit.py`。**id 空洞 ≠ 被删过**（Hibernate 号段 allocationSize=50），
  要判删除只看 binlog 的 `DELETE FROM` 计数。
- **双端令牌不通用**：拿 7070 的教师令牌查 17070 的 `/store/games` 返回的是**空列表**（不是 401），
  看着像"云端商城空了"。两实例签名密钥不同 ⇒ **每个 host 必须各自登录取 token**。
- **改 `manifest.json` 的 description / name 之后必须重跑一遍整套上架**（manifest 不进 bundle，
  不用重新 build）：上传包时后端用 manifest 覆盖游戏记录，且 `plugins/installed/` 那份
  **只有 `package-install` 才会刷新**。只 publish 不 install ⇒ 商城列表显示新版本、用户拿到的还是旧字段。

## 通用编辑纪律

- **一个文件永远串行改**；同文件多处 Edit 或并行 Edit 都会**静默丢改动**。改完 `grep` 关键标记 + 立即 build。
- **静态服务不能跨 Bash 调用存活**：`http.server` 要用后台任务起；起服务 → 探活 → 跑 Electron 要接得上。
- **改玩法/状态机上架前必做真实渲染回归**（Electron 指真实 `dist/web` + `sendInputEvent`），
  套路见 skill `frontend-visual-verify` §9；`shot.js` 脚手架在 `.workbuddy/tmp/crverify/`。
- 产物新鲜度只看 `dist/web/index.html` + `assets/index-*` 的 mtime，**别含 `package.json`**。

## 游戏设计层的固定结论

- **每条分支都必须有出口**：轮次/抢答类把推进逻辑抽成唯一 `settleQuestion()`，所有结束分支都调它；
  用 ref 做「已结算 + 定时器」双保险。
- **消除是检查点**（`shanhe-match3`）：消除分支清空历史栈，悔棋只能回退消除之后的操作；置灰要说原因。
- **双人 PK 三阶段** `arrange → battle → result`，N 人擂台制负者不回流，全程用姓名；
  照抄 `weather-quiz/src/DualQuiz.tsx`。CSS 标红须写 `.pk-side .pk-options button.is-answer`（0,3,1）。
- **多人同屏游戏：放错不换人**（否则「答错＝把难题丢给下一位」成最优解，是反激励）；
  分要各自独立记账，同一条目换人按**各人自己的**尝试次数给分。
- **哨兵值不能和真实 id 撞车**：`china_relief` 用 `-1` 表示「没有当前答题人」，
  虚拟学生曾用 `studentId: -1` ⇒ 落位被静默丢弃。
- **验证断言必须从「期望行为」重写，不能照抄实现**；新断言先跑旧产物复现红、再跑修复版全绿，两份 report 都归档。
- **断言必须尺度无关或匹配物理尺度**。反例：`province_puzzle` 用"卡片上边缘像素数增加"
  证"更细致"——37 px 高的卡片上 120 m 容差的海岸线只有 ≈0.05 px/转折，**物理分辨不出**，
  改前改后都是 170，会得出"没改善"的错误结论。改量**几何量**（路径周长香港 1.71×、澳门 3.69×）。
- **绝对阈值作用在规模差数量级的集合上 = 对小对象是灾难**。`province_puzzle` 的
  `SIMPLIFY_TOLERANCE_METERS=3800` 是按省的平均规模定的，落到澳门（宽 12 km）就把轮廓压成三角形。
  见到这类 bug 先问「**这个阈值是相对谁定的**」，再按对象规模分档，别急着换数据源。
- **取整会吃掉精度，比容差更隐蔽**：`province_puzzle` 全图 viewBox 仅 1200 单位宽（1 单位≈5.3 km），
  澳门跨度 1.34 单位 ⇒ `round()` 后外环 47 顶点只剩 **4 个不同坐标**。调容差没用，**得放小数位**。
  连带：**`bbox` / `centroid` 必须与 `d` 同精度**（卡片拿 bbox 当 viewBox，不同精度会偏出取景框）。
- **出处标记字段要自动派生**：手写的 `data.version` 从 0.3.3 一路滞后到游戏 0.3.7 没人发现 ——
  改成从 `package.json` 读，消除一个手同步点。说假话的元数据比没有更糟。
- 打包自检要有**能识别"打了陈旧 dist"的指纹**：产物哈希/结构全对也照样能装，但内容是旧的。
  `publish_province_puzzle.py` 的写法是断言**包内 JS 含细粒度数据的唯一路径前缀**。
- **同一组图例必须共用同一条几何路径、只差线型**。符号类素材必须单独拼大图复核。
- `roster.length === 1` 时部分游戏跳过选人环节 ⇒ 自动化脚本先判元素存在再点。

## 纯逻辑模块的 Node 测试写法

本机无 esbuild，用 Vite 8 自带的 rolldown：`rolldown src/x.ts --format cjs --file scripts/_x.cjs`
打成 CJS 供 `require`；约定 `npm run test:data` = 重新生成 + 跑 `scripts/*.test.cjs`。改源码必须重跑生成。

## mountain_zones 专属（详见 `mountain-zones-notes.md`）

①**海拔（`elevationOffset` 真值）与视觉高度（`verticalExaggeration` 仅渲染）必须两份数组**，
`raw` 只读 / `alt = max(0, raw+offset)` / `visualY = alt*exag` 只在顶点用一次；
②**TPI 阈值取高分位（p90≈70 m）**，取中位数会标出 25% 的格子；
③**水系阈值前必须守卫 `maxAcc > 0`**（全山在雪线以上会把 65536 格全判成河道）。

## 游戏清单（`gameCode` / 当前版本）

`province_puzzle 1.0.0` · `shanhe_match3 1.0.1` · `province_quiz 1.0.0` · `geo_gomoku 1.1.0`
· `earth_globe 1.4.5` · `solar_system 1.1.2` · `landform_quiz 1.3.0` · `weather_quiz 1.0.0`
· `legend_match 0.0.1` · `mountain_zones 2.0.0` · `china_relief 1.2.0`（山河塑形·中国地形）

> `province_puzzle` **v1.0.0**：港澳走 `SMALL_AREA_OVERRIDES`（容差 120/50 m、最小岛面积
> 0.00001°²、**坐标保留 2 位小数**），其他 32 个行政区参数一字未动（逐字节复核 32/32）。
> 详见 `2026-09-17.md`。**踩点**：`stroke-width` 是 viewBox 单位 ⇒ 37 px 卡片上澳门被糊成实心块，
> 用 `TINY_BBOX=22` + `vector-effect: non-scaling-stroke` 修。
> 回归：数据层 `verify_data.py` 6 组 + Electron `shot.js` **37 项**（全部在 `.workbuddy/tmp/ppverify/`）。
> `publish_province_puzzle.py` 的自检是**包内 JS 必须含港澳细粒度路径指纹**（防打到陈旧 dist）。
> ⚠ 旧告警「云端 0.3.8 孤儿版本」**已消解**（1.0.0 严格大于它）；`plugins/installed/{2,37}/`
> 下仍留有 0.3.8 目录，平台按最新版本取，属历史残留。

> `china_relief`：38 张卡 = 11 地形区 + 27 山脉。DEM 用 AWS Terrarium
> （`h = R*256 + G + B/256 − 32768`），等距圆柱 + cos(36°) 经度修正。
> **v1.0.0 起渲染层是 Canvas 2D 俯视分层设色（卡通），已彻底摘掉 three.js**；
> 高度场仍是 `y = alt[k]·lift[k] + add[k]`，只用来判 7 个色档 + 明暗 + 档间描边。
> **v1.1.0 起 `requiresRoster=true`**，新增进场大厅（选人 / 选模式 / 选底图）、
> 轮流 + 指定两种模式与逐人积分、三种底图（分层设色 / 地势晕渲 / 天地图影像）＋逐人上报。
> **v1.2.0 起 `src/plan.ts`**：`scope`（全部/只练高原/盆地/平原/山脉）× `start`（空白地图 /
> 随机预置 `EASY_KEEP=0.6`）→ 两个集合 **`required`（要塑，计分/分母/上报）
> 与 `preset`（一进场就在图上，不计分不记归属）**；`isSettled()`=并集 vs `isPlaced()`=只算学生塑，
> 刻意分开；`planRound(…, rng = Math.random)` 随机源可注入（回归传 `mulberry32(seed)`）；
> `plannedCount()` 独立，大厅分母与开局分母同源。`terrain.ts` 加**归属图 `owner: Uint8Array`**
> （与 `lift/add` 同批格子同时写）→ 每条目一条 **HSL 描边**（明度固定 0.26，不是 `rgb×0.5`），
> 轮廓**先于底图分支算**（影像底图下塑形区抠透明，轮廓要留）；**轮廓 ≠ 档界**，开关管不着档界。
> 回归：`npm run test` = **104**（纯逻辑）+ 16（图源规则）；Electron `shot.js` **227 项 / 19 张截图**；
> `.workbuddy/tmp/publish_china_relief.py` 双端上架（描述随版本改，需**重跑一遍**才生效）。
