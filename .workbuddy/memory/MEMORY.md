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
- ⚠ **响应包装不统一，写核对脚本前先 `curl` 一眼原始 JSON**：
  `/store/games`、`/auth/local/login` 都是 `{success,data:{...}}`；而
  **`/store/games/{code}/manifest` 返回的是**扁平** manifest 本体（顶层直接 `gameCode/version/...`，没有 `data`）**。
  照 `data` 包装的惯性写 `if "data" not in resp: 判为接口异常` ⇒ **假红**（我踩过，
  把一个好响应报成"后端坏了"）。假红和假绿一样费时间：先打原始响应，再写判据。
- **别把结构性缺失当缺陷报**：云端条目恒 `installed=false / installedVersion=null`
  （`CloudGameStoreController` 没有 install 概念），`/manifest` 在云端恒 `INTERNAL_ERROR` ——
  都是设计如此，不是这一轮弄坏的。
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
- **取景边距不能写绝对常数**：`pad = max(w,h)*0.08 + 12` 里的常数 `+12` 对长边 440 的要素
  只占框的 2.7%、对澳门（长边 2.41）却占 **96%** —— 同一类"绝对阈值作用在规模差 200 倍的集合上"
  的 bug（和 `SIMPLIFY_TOLERANCE_METERS` 同源）。按大小分档：小要素改**纯比例**。
  ⚠ 去掉常数后缩放会变得很大，**必须同时上 `non-scaling-stroke`**，否则描边跟着放大到 200 px+。
- **同一段逻辑在两个组件里各存一份 = 下一轮必漏一处**。`province_quiz` 的
  `silhouetteViewBox` 就重复在 `ProvinceQuiz.tsx` / `DualQuiz.tsx` 里，这轮抽成 `silhouette.ts`。
  加特例前先看有没有第二份副本。
- **有插值噪声的场合，判据不能写成「恰好为 0」**。`imageSmoothingEnabled = true` 到处都在
  （`china_relief` 的离屏缓冲放大 ~2 倍、`province_quiz` 的 svg 缩放），所以色块边界上**必然**
  有双线性过渡色。`china_relief` v1.5.0 就是写了"淡化色数量 === 0"而红在 213 px 上 ——
  逐点查坐标+四邻确认那是**散在色档交界处的孤立点**，不是残留。
  → 改成**自校准比值**（淡化色合计 < 原色合计的 1%，实测 0.085%，两版本差 1300 倍）。
  **一个"必须恰好为 0"的断言会被噪声长期打红；红了没人信的断言最后一定被删掉。**
- **断言的分母要匹配要证的结论**（同 §取景边距那条）：`changed / 整框 ≥ 0.5` 在
  "海陆一起变"时成立，海面回原色后掉到 34% 而**陆地占比 99%** ⇒ 分母该用陆地像素。
  改判据时先问"这个分母里有多少是与结论无关的区域"。
- **验证脚手架里别写死版本号**（`shot.js` 的 `VERSION = "1.4.0"` 一升版就红 3 条，
  而那 3 条红**看着像产品坏了**）⇒ 改成从 `manifest.json` 现读。
  ⚠ **但改"现读"时极易写成假绿**：原来 `MANIFEST.version === VERSION` 在 VERSION 也来自
  manifest 之后就成了自己跟自己比。**凡是把期望值改成"从被测对象读"的地方，
  都要回头检查这条断言还剩什么信息**（这里另读 `package.json` 当第二来源）。
- **旧帧要"改名保留"，别让新一跑覆盖**（`mv` 成 `P1-【v1.4.0旧】….png`）。它同时是
  汇报用对照图的左半 + "改前"基线 —— 改完才能测出现场数据（淡化色占陆地约三成、是原色的 280 倍）。
  一覆盖就再也拿不回来（v1.0.0 那次就是这么丢的）。
- `roster.length === 1` 时部分游戏跳过选人环节 ⇒ 自动化脚本先判元素存在再点。

## 纯逻辑模块的 Node 测试写法

本机无 esbuild，用 Vite 8 自带的 rolldown：`rolldown src/x.ts --format cjs --file scripts/_x.cjs`
打成 CJS 供 `require`；约定 `npm run test:data` = 重新生成 + 跑 `scripts/*.test.cjs`。改源码必须重跑生成。

## mountain_zones 专属（详见 `mountain-zones-notes.md`）

①**海拔（`elevationOffset` 真值）与视觉高度（`verticalExaggeration` 仅渲染）必须两份数组**，
`raw` 只读 / `alt = max(0, raw+offset)` / `visualY = alt*exag` 只在顶点用一次；
②**TPI 阈值取高分位（p90≈70 m）**，取中位数会标出 25% 的格子；
③**水系阈值前必须守卫 `maxAcc > 0`**（全山在雪线以上会把 65536 格全判成河道）。

## geo_gomoku 专属（详见 `2026-09-18.md`）

v1.2.0 起有**三档棋盘**（小 15×15 跨 70° / 中 19×19 跨 90° / 大 25×25 跨 120°，**每格恒为 5°**）、
**两种形状**（方形 / 圆形球面正射投影）、**三种皮肤**（纸纹 / 卫星影像 / 夜晚灯光）。
- 棋盘 **参数化**：`BoardSpec { grid, degStep }`，对外函数 `spec` 放末尾且默认小盘 ⇒ 老回归零改动。
  新增 `src/projection.ts`（投影 + 圆盘，纯逻辑）与 `src/skin.ts`（贴图，有副作用）。
- ⚠ **窗口档数 ≠ `span/5+1`**：纬度上沿最低滑到 `span−90` ⇒ 可选窗口 **小 23 / 中 19 / 大 13**，
  经度反过来 **59 / 55 / 49**（右沿恰好停在 180°E）。圆形下再用 `GLOBE_LAT_CAP = 70` 过滤 ⇒ **15 / 11 / 5**。
- ⚠ **圆形下「大」档置灰**（跨 120° 时边缘相邻交点只剩 7.9 单位 < 阈值 10）：判据是
  `globeSupportsSpec = globeWorstMinGap ≥ GLOBE_MIN_GAP_RATIO(0.0106)`，实测 0.0181 / 0.0133 / 0.0085。
- ⚠ 逆投影纬度必须 `/ RAD`（漏了＝经度全对纬度全错）；**极点是一个点**；圆盘半径＝窗口四角外接圆。
- ⚠ 圆形贴图**必须逐像素反投影重采样**，不能 `drawImage`（否则「经纬线弯、大陆平」）。
- 回归：`test:data` = **165 + 77 项**（`geo.test.cjs` + `proj.test.cjs`）；`shot.js` **205 项**；
  起服务 + Electron 同一脚本 `.workbuddy/tmp/ggverify/run_regress.sh`（`bash.exe run_regress.sh`）。

## 游戏清单（`gameCode` / 当前版本）

`province_puzzle 1.0.0` · `shanhe_match3 1.1.0` · `province_quiz 1.1.0` · `geo_gomoku 1.2.0`
· `earth_globe 1.4.5` · `solar_system 1.1.2` · `landform_quiz 1.3.0` · `weather_quiz 1.0.0`
· `legend_match 0.0.1` · `mountain_zones 2.0.0` · `china_relief 1.5.3`（山河塑形·中国地形）

> ⚠ **同源数据的副本会以三种形态漏掉修复**（都踩过了）：
> ① **手工落盘的第二份** —— `shanhe_match3` 与 `province_puzzle` 的轮廓同源，前者一直没跟上
> （32/34 逐字节相同、只有港澳不同）；② **派生的第三份** —— `province_quiz` 的数据由
> `provinces.json` 派生，而它的生成器只是个 **29 行拷贝器、没有自检**，上游修好后没重跑；
> ③ 以后新增副本同理。**判定与防线**：
> - 判据一律是**把两份的 `d` 逐字节比一遍**，修完应当是 **34/34 全相同**（三个游戏都成立）；
> - 每个副本都要有生成器，且生成器必须有 **`--check` 模式**；⚠ `--check` 要校验**磁盘上那份**、
>   不能校验"刚构造出来的 payload"（后者与原文件无关，恒为 34/34 = 等于没查）；
> - 生成器里的 `version` 一律**从 package.json 读**，别抄上游的（province_quiz 就抄着 `0.3.3`
>   一路滞后；shanhe_match3 抄着 `0.1.0`）。

> `province_puzzle` **v1.0.0**：港澳走 `SMALL_AREA_OVERRIDES`（容差 120/50 m、最小岛面积
> 0.00001°²、**坐标保留 2 位小数**），其他 32 个行政区参数一字未动（逐字节复核 32/32）。
> 详见 `2026-09-17.md`。**踩点**：`stroke-width` 是 viewBox 单位 ⇒ 37 px 卡片上澳门被糊成实心块，
> 用 `TINY_BBOX=22` + `vector-effect: non-scaling-stroke` 修。
> 回归：数据层 `verify_data.py` 6 组 + Electron `shot.js` **37 项**（全部在 `.workbuddy/tmp/ppverify/`）。
> `publish_province_puzzle.py` 的自检是**包内 JS 必须含港澳细粒度路径指纹**（防打到陈旧 dist）。
> ⚠ 旧告警「云端 0.3.8 孤儿版本」**已消解**（1.0.0 严格大于它）；`plugins/installed/{2,37}/`
> 下仍留有 0.3.8 目录，平台按最新版本取，属历史残留。

> `province_quiz` **v1.1.0**：港澳轮廓细粒度化。**三层根因**——数据是派生副本没重跑、
> 描边随要素缩放、**取景边距里的常数 `+12`**（对澳门＝框的 96% 空白，轮廓只画成 18×27 px）。
> 修法：`src/silhouette.ts`（单一真源，`TINY_BBOX=22`）＋小要素**纯比例边距**＋
> `non-scaling-stroke`。像素账：澳门 200%→**0.88%**、香港 22.2%→**0.60%**。
> 回归：`npm run test:data` 21 项；真机探针 `.workbuddy/tmp/pqverify/probe.js`
> **旧 11 红 → 新全绿**；`publish_province_quiz.py` 打包自检 **5 组**（比别的游戏多一组
> "**JS+CSS 各验一条渲染层指纹**"——只查一边会漏）。
> ⚠ 遗留观察：`DualQuiz.tsx` 的轮廓 `<path>` 缺 `fillRule="evenodd"`（`ProvinceQuiz.tsx` 有），
> 港澳无影响，但 PK 模式下"有内环"的省可能把洞填实。本轮故意没动。

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
> **v1.3.0 起加「图鉴」（只学不考）**：`createAtlasSession(allIds)` = `createSession([], "pick",
> { required: [], preset: 全部 })` —— 三个参数各封死一个方向：全预置 ⇒ 复用「已在图上不给拖但点得开」
> 零新交互；`required` 空 ⇒ 结算判据 `total > 0 && placed.length === total` **结构上不可能成立** ⇒ 永不上报；
> `order` 空 ⇒ `currentId() === NO_CURRENT` ⇒ 提交函数首闸 `studentId < 0` 挡住 ⇒ 不加分不扣分不换人。
> 图鉴是 **`stage`（lobby/play/atlas）不是第三种 `PlayMode`**（`mode` 只管"谁来答"）；
> `SceneView.focus` 与 `owner` 是**两个字段**（outline 答"分不分得开"、focus 答"在看哪一块"，互不控制），
> 非聚焦 `mul *= FOCUS_DIM 0.42`、聚焦地块边缘 `FOCUS_EDGE [214,48,36]` 且**排在归属轮廓之后**算，
> 影像底图下改盖暗纱 `FOCUS_VEIL 170 / rgb(26,30,38)`。**回大厅必须 `resetTerrain()`**（否则"图上看
> 已塑好、进度写 0/38"），**不能用 `location.reload()`**（名单是一次性消息，刷新后永远等不到），
> 出口还要把 `mode` 切回 `"relay"`。图鉴知识卡是**左下角浮层**（`.cr-sheet.is-atlas` +
> `pointer-events: none`，因 `.cr-sheet` 是 `inset:0` 连侧栏一起盖住）；翻页按**完整 38 条目录**、首尾相接。
> 回归：`npm run test` = **108**；`shot.js` **227 项**；`.workbuddy/tmp/crverify/atlas.js` **53 项 / 8 张截图**。
> **踩点**：置灰必须"外层 section 带 `is-muted` 让标题变浅 + 内层 `.cr-modes` 带 `is-muted` 让按钮组
> `pointer-events: none`"，只加一半＝半灰（标题浅了按钮还能点）；`createAtlasSession` 引入时把 ref 命名为
> `atlasRef` 而非 `stageRef`（后者已被 DOM 舞台占用，撞名后 `stageRef.current.clientWidth` 读成 `"atlas".clientWidth`）。
> **判据**：「完整体」不能用一个米灰总占比（不属于这 38 条的陆地本来就是米灰），要用 38 个锚点
> 逐条取样（`_geo.cjs` 的 `lonLatToCanvas`，5×5 邻域非米灰比例）+ 空白地图下的对照（全变回米灰）。
> **v1.4.0 起**：① 横断山脉改成 `lines`（**5 条平行岭**，数据带 `lift_half_deg: 0.20` 单独收窄走廊），
> `distToRange`/`buildRidge` 一律按"到**最近那一条**"算；② 新增第四种底图 **`soft` 浅色地形**
> （未塑形区取**真实高程 `da[k]`** 而不是 `hAll[k]` ⇒ 形状与塑好之后重合、只差浓淡；刻意不加档界描边与明暗）；
> ③ **地名标注** `labels.ts` 的 `pickLabels`（判据是 `isSettled` **不是** `isPlaced`，否则图鉴一个名字都没有），
> 舞台/大厅各一个开关；`drawLabels` 必须画在 `drawImage` **之后**，数组顺序即避让优先级。
> **三个坑**：真实间距摆必糊（走廊半宽 0.42° > 三江并流真实间距 40~60 km）⇒ 经度摊开到 1.10°；
> 走廊的**经度**覆盖 = `(half+fade)/lonScale`（lonScale=cos36°，漏了会低估 1.236 倍）；
> **窄河谷会被 `drawImage` 放大时的双线性插值"渗"掉**（480×358 → ~1164×1000，`imageSmoothingEnabled = true`）
> ⇒ 逐像素差永远回不到 0，固定阈值 12 会把 5 条数成 4 条，判据必须**按行自适应**（低于该行峰值 ×0.15 算断开）。
> 回归：`test:data` **119** · `shot.js` **245 项/23 图** · `atlas.js` **53 项**。
> 图鉴那条"其余 37 条被压暗"**要先关标签再量**（38 个地名会抬高陆地平均亮度、抵消压暗效果）。
> **v1.5.0 起**：底图 `soft` 的**白色掩膜拆了**，「浅色地形」改名 **`原色地形`**。
> 根因是 `fadeToWhite(c,k)=(1-k)·c+255k` 是**仿射**映射 ⇒ 把**所有**色差一律乘 `(1-k)`；
> 陆地 k=0.62 ⇒ ×0.38，七档相邻色差 97.7→37.8（只剩 39%），全挤进 `(206~247,204~245,187~242)`，
> 相邻档每通道只差 6~11 —— **和「分层设色」本身相冲**（它靠色相差异，向白插值是等比压缩）。
> 现在未塑形区直接用 `BAND_RGB` / `SEA_*` / `COAST` **原色**（海面也回原色，用户选定的）；
> **"塑形"的信号从「由淡转浓」换成「浮出档界描边 + 明暗」**。
> 连带：地名是「白描边+深字」，色域回到 R127~233 后**白描边的必要性回到 v1.3.0 水平**。
> 回归：`test:data` **121** · `shot.js` **249 项/23 图** · 打包自检 **5 组指纹**
> （标签新在/旧不在 + 原色在 + **淡化色 10 个全无** + 版本 + CSS）。实测：陆地重画 **99%**、
> 海面在两底图间 **0 像素变**、原色海 **665428 px**、淡化色 **213 px**（0.085% 于原色，v1.4.0 是各档 1.1~7.9 万 px）。
> `manifest.description` 310 → **137 字**（原是全仓库唯一的三位数，第二长 118）。
> ⚠ `dist/web/cover.svg` 是**手绘矢量**（`#7bab7f`/`#cdb070`），从来不是淡彩截图 ⇒ 改配色不用动封面。
> 详见 `2026-09-18.md`。
>
> **v1.5.1 起**：**只动摆放** —— 三条常驻浮层（底图 / 轮廓 / 名称）从舞台右上角搬到**左下角**。
> 定位从「每条写死 `top: 14/64/108`+`right: 14`」改成 **`.cr-corner` 一个 flex 列**统一摆位
> （`left:14; bottom:38; gap:6`），`.cr-basemap` 只留外观（**`position` 已删**），
> z-index 家族里 `.cr-basemap` 换成 `.cr-corner`。
> **图鉴例外**（**v1.5.2 已取消**，见下）：当时让三条留在右上角，因为图鉴的知识卡就钉在左下角，
> 硬搬会盖住卡片底部那行按钮（反事实重叠 **353×130 px**，其中按钮行本身 349×53）。
> **`bottom: 38px` 是量出来的**：`.cr-credit` 署名小字高 22px、顶到距底 32px + 6px 气口；
> 前提是它**永远一行** ⇒ 顺带加了 `white-space: nowrap; line-height: 14px`。
> 旧摆位的真实行距是 **2px 与 9px**（三条高实测 48/35/35，`64-(14+48)`、`108-(64+35)`）——
> 不是注释里曾写的 3/10。**这个数是"同一份产物上注入旧样式"的受控 A/B 量的**
> （`.workbuddy/tmp/crverify/ab.js` + `ab-report.json`）。
> ⚠ **量边距的分母是舞台（1164×1000）不是窗口（1500×1000）**，否则"右边距 14px"会被算成 350px。
> 回归：`test:data` **121** · `shot.js` **249 项/23 图**（新增 Q 段 11 条）· `atlas.js` **56 项**（新增 3 条）
> · 打包自检 **6 组指纹**（第 6 组＝摆位指纹，云端 `/package` 同一组）。双端 **v1.5.1 ACTIVE**。
> ⚠ 判据写死版本号会在**脚手架的另一个文件**里复发（本轮 `atlas.js` 漏改）⇒ 修完 grep 一遍目录。
> 详见 `2026-09-18.md`。
>
> **v1.5.2 起**：取消上面那个图鉴例外 —— 图鉴里三条也搬左下角，**改成知识卡往上让 176px**。
> `--cr-corner-reserve: 176px` = `bottom:38` + 三条浮层最高 130 + 8 气口（图鉴与答题现在共用左下角）。
> `margin-bottom` 与 `max-height` **必须成对改**：卡片是 `align-items:flex-end` 贴底生长，
> 只改 margin ⇒ 长讲解会把卡片顶穿顶栏长到屏幕外。`max-height: calc(100% - reserve - 80px)`，
> 80 = 图鉴顶栏底（实测 72）+ 8 气口。`.cr-stage.is-atlas .cr-corner` 只剩 `left: 18px`
> （对齐卡片的 `margin-left: 18px`）。实测：浮层 `x 18~371 y 832~962`、卡片 `y 321~824`（高 503 未变）、
> **重叠 0×0**（垂直间隙 8px）。`.cr-stage`/`.cr-root`/`.cr-sheet` 三者底边实测都是 1000 ⇒ 一个常量够用。
> ⚠ 又一次挖洞漏网：**`.cr-sheet-card` 从没进 `overlayRects()`** —— v1.5.1 它压在海面上没露馅，
> 上移后压在西北内陆上，亮纸底把"陆地均亮"抬高 ⇒ 压暗只测到 −13（阈值 15 ⇒ **假红**），挖掉后 −33。
> **"两个状态的差"看着免疫位置变化，但分母里混进 UI 就会跟着 UI 走。**（上一轮漏的是 `labelopts`）
> ⚠ 卡片绑的是 **`onPointerDown`**，不是 `onClick` ⇒ `el.click()` 无效，几何脚本要派发 pointerdown + pointerup。
> ⚠ 「不让位会叠多少」是**反事实**，两个实际状态都量不出（`overlap.before` 是 0×0）——
> `ab-atlas-report.json` 里单独给了 `counterfactual.hitCard`。
> 回归：`shot.js` **261 项/24 图**（多出的 12 项＝这次密钥可用、遥感段真的跑了）· `atlas.js` **58 项**
> （新增/改写 4 条）· `geom.js` 重叠列恒 0×0 · 打包自检 **7 组指纹**（第 7 组＝v1.5.2 摆位）。双端 **v1.5.2 ACTIVE**。
> 详见 `2026-09-18.md`。
>
> **v1.5.3 起**：**地图本身可点**（图鉴点任意一条 / 答题点**已归位**的那块 ⇒ 弹它自己的讲解）。
> 此前画布是**故意不接**点击的（"随手点一下就把答案点出来了"），用户要的是它的**安全版本**：
> 候选按 **`isSettled`**（`placed ∪ preset`）过滤 —— 答题侧＝"已经填好、图上有对的要素和文字"；
> 图鉴侧 `createAtlasSession` 把 38 条全塞进 `preset` ⇒ 全真。**两条需求共用一句判据，无需第二个分支。**
> 新模块 **`src/pick.ts`**（纯逻辑）三条路径按序：①锚点带（名字优先，`ANCHOR_RADIUS_DEG = 0.375°`）
> → ②走带（`geo.corridorHalfDeg(range)`，与塑形**共用同一个函数**）→ ③归属格
> （`regionGrid[grid] === area.gridId`，与落点判定**同一张位图**）。不变量：**点得中 = 画得出**。
> ⚠ **`RANGE_TOL_DEG`(0.55°) 是落点容差、不是命中容差**（刻意比走带宽；横断山脉只有 0.28）
> —— 拿它做命中会让山脉把手伸到带子外、把周围地形区整片吃掉，且只在边缘发生、最难归因。
> ②排③前：走带画在色块上面（`ownerGrid` 里山脉后写覆盖地形区），否则 27 条山脉里二十多条被压在
> 地形区底下（实测最大压盖 **青藏高原 30.3%**）。**R=0.375 的三个边界全是量出来的**：下界 0.31＝
> 被走带盖住的锚点里离脊线最远的（长江中下游平原↔大别山）、上界 0.53＝最近锚点对距 1.06° 的一半、
> 代价＝从走带拿走 0.32%；实测锚点带只占全部命中的 **3.2%**。
> ⚠ 锚点带对**山脉**要再截一刀 `Math.min(R, corridorHalfDeg(range))` —— 横断山脉走带 0.28° 比 R 还窄，
> 不截就会伸到画出来的带子外面（回归抓到 `误命中 1 条：横断山脉→anchor`）。地形区不截。
> 光标 `.cr-canvas.is-pickable{cursor:pointer}` 用**与点击同一个**命中函数（不会"手型却点不开"），
> 用 `onClick` 而非自己记 down/up（拖卡片松手不会走到这儿）。画布坐标原点实测 `{x:0,y:0,w:1164,h:1000}`。
> 回归：`test:data` **135** · `shot.js` **264 项**（F 段整段改写 + 新增 F1/F2 两图）· `atlas.js` **68 项**
> （新增 F2 段 10 条）· 打包自检 **8 组指纹**（第 8 组 **成对**：JS `is-pickable` ↔ CSS 手型规则；
> 红样例见 `.workbuddy/tmp/crverify/_fp_red.py`：v1.5.2 包全红、v1.5.3 全绿、拼一半也红）。双端 **v1.5.3 ACTIVE**。
> ⚠ `note(name, obj)` 要 `JSON.stringify`，否则日志里是 `[object Object]`＝这条记录白记。
> 详见 `2026-09-18.md`。
