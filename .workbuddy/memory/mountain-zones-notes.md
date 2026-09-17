# mountain-zones 专属笔记（真实 DEM 三维山地）

> 项目级长期约定见 `MEMORY.md`；逐日细节见 `YYYY-MM-DD.md`（v2.0.0 重构全程见 `2026-09-15.md`）。
> 本文件只放 **mountain-zones 需要反复查** 的技术事实。当前版本 **v2.0.0**。

## 数据源与解码

- **AWS Terrain Tiles**，Terrarium 编码，免 key、公有领域。
- 解码：`h = R*256 + G + B/256 − 32768`（24 bit 定点，**B 是小数部分**，不是 `B*256`）。
- 落盘：`Uint16` 小端 → base64 内嵌 bundle。**明确不做 zlib**（实测压缩率仅 0.767，
  却引入异步解码与额外的确定性风险，不值）。
- 四座山：贡嘎山 7556 m / 珠峰 8848 m / 梅里雪山 6740 m / 太白山 3743 m。
- 重投影：Mercator → 等距地面网格，横向按 `cos(center_lat)` 修正；**裁切窗口以峰顶为中心**（偏移全 0%）。

## 「海拔」与「视觉高度」必须分开（改这块之前先读）

两个滑块语义完全不同，**绝不能共用一个数组**：

| 滑块 | 语义 | 影响面 |
| --- | --- | --- |
| `elevationOffset`（±2000 m） | **真改海拔** | 读数 / 等高线 / 带谱 / 雪线 全变 |
| `verticalExaggeration`（×0.5~2.0） | **只改视觉纵轴** | 海拔真值不动 |

```ts
raw  = DEM 原值            // 只读真值，任何地方都不许改
alt  = max(0, raw + offset) // 当前海拔：等高线/读数/带谱都用它
visualY(f, alt) = alt * exag // 只在渲染顶点处用一次
```

由此天然得到两条可断言的行为：拉夸张滑块 → 等高线**不动**；拉偏移滑块 → 等高线**整体平移**。
回归里的 C 段就是靠这两条分辨"两个滑块有没有真的分开"。

## 算法参数（改前先看分位表）

- **等高线**：marching squares 15 情况查表 + 鞍点消歧 + 量化坐标 key 精确配对。
  shader 走 `onBeforeCompile` 注入，`fwidth` 做屏幕空间抗锯齿，`varying float vVisualY` 由顶点带下。
- **TPI 识别山脊/山谷**：`TPI = h(自己) − mean(菱形邻域)`，`radius = 3`。
  阈值 **`RIDGE_TPI = 70`（≈ 四山 p90）**，定义在 `contour.ts` 并附完整分位表注释。
  ⚠️ **阈值绝不能取在中位数上** —— 中位数把正半轴一切两半，实测会标出 **25%** 的格子。
  取 p90 后四山脊点占比 **5.68%~6.02%**（跨山一致性极好，可当回归基线）。
  ⚠️ `ridgeValley(h, n, thresh = 4, radius = 3)` 第 3 个参数是阈值、第 4 个是半径。
  把它误写成 `(..., 70, 70)` 会让半径变 70 → TPI 退化成区域坡度 → 脊点飙到 44%。
- **水系**：D8 流向 + 流量累积，树枝状；阈值 `maxAcc × ratio`。
  ⚠️ **必须守卫 `maxAcc > 0`**：全山在雪线以上时 `maxAcc = 0`，
  `acc[k] >= 0` 恒真 → 65536 格全被判成河道。
- **雪花线两个函数别混用**：`snowlineAnnual(lat)` 切带谱（四季恒等）／
  `snowline(lat, season)` 表示当下地表有无雪。
  做纬度对照实验时要注意别被雪线污染 —— 用 **太白山（3743 m，10°N~40°N 都不越雪线）** 才干净。
- 巡游路径：峰顶沿最陡方向下降到山麓再反向。
- 拾取：ray-march（比 `Raycaster` 快一个量级）。地形四周有**裙边**（地质标本块）封边。

## 布局

- 底行等高线栏 **300 px**（`@media(max-width:1120px)` 下 264 px），
  左：平面等高线图（正方形 224×224，含指北针与比例尺，靠左）；
  中：三栏自适应 `cols = w>=760?3 : w>=500?2 : 1`（自然带图例含海拔区间 / 本图说明 / 符号例）。
- 竖屏/窄屏时平面图居中；宽屏时靠左、右栏画图廓要素（`drawPlanLegend`）。
- 无动物、无植被精灵 —— **只有地表配色**。回归 F 段会同时扫源码、DOM、产物三处。

## 脚本与验证

| 用途 | 路径 |
| --- | --- |
| 打包上架 | `.workbuddy/tmp/publish_zones.py` |
| 封面生成 | `.workbuddy/tmp/make_cover.py` → `public/cover.svg` |
| 真机回归（129 项） | `.workbuddy/tmp/mzverify3/shot.js` |
| 封面多尺寸复核 | `.workbuddy/tmp/covercheck/shot.js` |

- 纯逻辑：`npm run test:data` → **203 项**（ZONATION 32 / CONTOUR 47 / DEM 79 / RUNOFF 45）。
- 真机回归：**130 项**（v2.0.0 定稿）。
- bundle 基线：`index-8IZzsPMe.js`（1.40 MiB / gzip 663 KB）+
  `index-COPqorTp.css`（7.4 KB / gzip 2 KB）。**以 `dist/web/index.html` 里写的为准**，
  别照抄本文档 —— 迭代一次就变一次（本文件就曾记成更早的 `index-rlN0pEM1.js`）。
