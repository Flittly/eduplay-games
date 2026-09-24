# 图例素材流水线（v1.1.0）

把「教材图抠图 + 开放授权图标库 + 按教材规范补绘」三类来源，统一成同一规格的
卡片素材：**512×512 透明底 PNG，符号长边固定占画布的 78%（≈399 px）**，
线条粗细统一到**长边的 6.3%（≈25 px）**。

产物落在 `public/assets/legends/<图例 id>.png`，由 `public/data/legends.json` 的
`image` 字段引用。图例 id 见 `../make_legends.py`（拼音，与文件名一一对应）。

## 运行

```bash
# 依赖：numpy / pillow / scipy，以及本目录（或其上级）的 node_modules：
#   @iconify-json/{mdi,maki,game-icons,fluent-emoji-flat,noto,twemoji}
#   @resvg/resvg-js
# 本仓库不收录 node_modules；脚本会先看本目录，再回退到 .workbuddy/tmp/iconsets/node_modules。

python enhance.py                     # 可选：出检测框核对图（不改素材）
python build_crops.py                 # ① 教材图 -> crops_out/crop_NN.png（Otsu 重建）
python split_river_lake.py            # ② 把「常年河、湖」「时令河、湖」拆成河 / 湖
python build_assets.py                # ③ 三类来源 -> public/assets/legends/*.png
python audit_style.py                 # ④ 审计：逐条量厚度，证明"统一"真的发生了
python stroke_metric.py               # 自检：厚度度量对已知宽度是否准确
python area_fill.py                   # 自检：面符号重建（实线 / 虚线轮廓）
python cardmock.py                    # 出「真实卡片尺寸」对照图（8/20/28/32 张牌四档）
python diffsheet.py 3 32              # 出「按类目分组、放大 3 倍」的可分辨性对照图
```

> `cardmock.py` 会先打印**从 `src/styles.css` 的 `:root` 解析出来的底卡取值**
> （`--card-ground / --card-bw / --card-pad / --card-drop`），并把它与真机实测的
> 锚点（内容盒、符号长边）交叉核对。读不到固定 px 值就直接退出 —— 这是故意的：
> 见「坑 3」。

## 各脚本职责

| 脚本 | 作用 |
|---|---|
| `panels.py` | 检测教材图的浅蓝面板边框 → 12 个符号列矩形（**消灭目测坐标**） |
| `enhance.py` | 定位符号框 + Otsu 重建单张裁片（净色块 + 平滑边缘） |
| `build_crops.py` | 批量出 24 张裁片到 `crops_out/`，并出核对网格 `shot_crops_all.png` |
| `split_river_lake.py` | 按"逐列竖向跨度"把组合符号拆成河 / 湖两个独立图例 |
| `spec.py` | **图例 → 来源**的映射表（crop / icon / draw / path）+ 类目色板 + 存在性/碰撞自检 |
| `drawings.py` | 教材图与图标库都没有的线状/抽象符号，按教材实测规范绘制 |
| `stroke_metric.py` | 「墨迹厚度」的**唯一**度量实现，生成与审计共用 |
| `area_fill.py` | 面状符号重建（净色填充 + 实线/虚线轮廓） |
| `build_assets.py` | 三类来源 → 512×512 统一规格 PNG（含线条加粗重建与面符号重建） |
| `audit_style.py` | 审计 73 张成品的厚度分布与离群项 |
| `cardmock.py` / `diffsheet.py` | 按**真实卡片尺寸**出图（判断"看得清吗"的唯一有效方式）。底卡几何从 `styles.css` 解析，`diffsheet` 复用 `cardmock.draw_card`，**不另抄一份** |

## 卡片上符号实际有多大

素材规格是 512×512 里占 78%，但**屏幕上**还要再过一道"卡片内容盒"：

```
内容盒 = (卡宽 − 2×3px 边框 − 2×6px 内边距, 卡高 − 同上)     卡高 = 卡宽 / 1.3
成像区 = min(内容盒宽, 内容盒高)      ← 1:1 素材塞进"宽而矮"的内容盒，被**高**卡住
屏幕上的符号长边 = 成像区 × 0.78
```

| 牌数（1252×694 牌面） | 卡宽 | 内容盒 | 成像区 | 屏幕上符号长边 |
|---|---|---|---|---|
| 8 张（最松） | 168 px | 150×111 | 111 | **87 px** |
| 20 张 | 148 px | 130×96 | 96 | 75 px |
| 28 / 32 张（最挤） | 129 px | 111×81 | 81 | 63 px |

图鉴缩略 / 详情 / 放大卡都是 `aspect-ratio: 1/1` 的**正方**盒，不受这条限制
（内容盒本身就是正方形）。⇒ 「方形符号在牌面上显得小」是 1.3 宽高比的几何必然，
不是 bug；而「图盒比内容盒高、被 `overflow: hidden` 平切」才是 bug（见坑 4）。

## 不在仓库里的输入

| 输入 | 说明 |
|---|---|
| 教材图 `650e35ec2f30f2bf11e04aefea9955f4.jpg` | 用户提供的 1920×1080 图（微信压缩）。路径写在 `enhance.py` 的 `SRC`。**没有它无法重跑 `build_crops.py`**，但 `crops_out/`（24 张裁片）已随仓库收录，`build_assets.py` 之后的全链路可独立重跑。 |
| `node_modules/` | 图标库与 SVG 渲染器，按上面的清单 npm 安装即可。 |

## 必须知道的坑

1. **`../make_legends.py` 不要再跑**。它会把 `legends.json` 的 `image` 写回
   `assets/legends/<id>.svg`（v1.0.0 的写法），并且会覆盖 v1.1.0 的所有素材改动。
   要改图例清单请改完它之后再手动把 `image` 改成 `.png`，或只改 `legends.json`。

2. **厚度度量只能用 3×3 全格（8 邻域）核**。用十字核会把方形孔的四个角"顶住"，
   带孔/带角的图形会多活好几步：实测宽 28 的方框被量成 37（+36%），
   于是一堆"其实已经够粗"的符号被判定为太细、继续加粗。
   `stroke_metric.py::_selftest()` 用"过心扫描线数出来的真宽"证明了度量是对的，
   改动度量前后都该先跑它。

3. **底卡内边距必须是定值，不能写成百分比**。`padding` 的百分比按**各自的包含块**
   解析，不是按卡片自己：`.lcard` 是 `position: absolute`，包含块是整块牌面
   （1280 下 1252 px）⇒ `4%` = 50 px，被 `clamp` 的上限兜到 8 px；
   `.gallery-thumb` 是网格项，包含块只有 ~116 px ⇒ `4%` = 4.64 px。
   于是 `clamp(3px, 4%, 8px)` 实测出来是"缩略图 4.64 px、其余 8 px"**两拨值**，
   看着像统一其实是巧合，而且上限一改就整体跳档。⇒ 现在写死 `6px`。
   本目录的脚本**从 `styles.css` 读这个值**，不另抄一份 —— 抄了就会重演
   "图是旧的、结论跟着旧"（`diffsheet.py` 原先自己抄了 `pad=4`）。

4. **`<img>` 的 `height: 100%` 在 auto 行轨道里会失效，符号会被平切**。
   底卡是 `display: grid`；行轨道若留 `auto`，轨道高度"由内容定"、内容高度又
   "按轨道算"，两头互相依赖 ⇒ 百分比被判成 `auto` ⇒ 高度退回按素材自身 1:1 比例
   算 = 宽度，得到 **151×151 的方盒**塞进牌面 151×112 的内容盒，纵向溢出 39 px，
   被 `overflow: hidden` 切掉。
   **症状极具迷惑性**：方块状的符号（核电站三叶、水库三角、首都五角星、居民点
   ◎●○ 阵列）底边被切平；横放的线状符号恰好落在框中间，完全看不出问题。
   ⇒ 修法：给底卡显式 `grid-template-rows/columns: minmax(0, 1fr)`，让轨道确定。
   判据要**全量 73 × 2 档尺寸**逐个量 `img.getBoundingClientRect()` 与内容盒之差
   （抽样很容易抽不到出事的那几张），并且要配一个反证（把 `grid-template-rows`
   注入回 `auto`，确认判据真会红）。取证脚本在 `.workbuddy/tmp/lm11verify/`。

5. **改底卡尺寸/边框/留白后，`shot_cardsize_*.png` 与 `shot_cat_*.png` 必须重出**。
   这两张是给人看的"看得清吗 / 分得开吗"的证据图，几何一变就是旧图。
   重出命令见上面的「运行」小节。

## 素材授权

| 来源 | 素材 | 许可 |
|---|---|---|
| Iconify `mdi` | 点状/图形类图例（★ ◎ ○ ☆、矿藏、电站、桥梁…） | Apache-2.0 |
| Iconify `maki` | 沼泽、泉 | CC0 |
| Iconify `game-icons` | 冰川（iceberg）、珊瑚礁（coral） | CC-BY-3.0（**需署名**，已在游戏 README 中列出） |
| 教材图抠图 | 线条类与面状符号（国界/省界/铁路/公路/等高线…） | 教材插图，仅供课堂教学使用 |
| 手绘 `drawings.py` | 教材与图标库都没有的线状符号 | 本项目原创 |
