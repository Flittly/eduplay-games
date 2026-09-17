# 行政区拼图

EduPlay 平台游戏插件（iframe 型），基于真实的中国省级行政区边界制作拖拽拼图。

## 玩法

- 使用 2022 年中国省级行政区划边界，共 34 个省级行政区（含香港、澳门、台湾）。
- 左侧为打乱顺序的行政区拼块，拖到右侧地图上对应的灰色轮廓位置，松手后自动吸附。
- 全部放回正确位置后完成，并向平台回传成绩（`GAME_COMPLETE`）。
- 教师可先在平台选择多位学生，游戏按学生轮流计时；右侧排行榜按完成用时排序。
- 教师可在游戏内「积分规则」中自定义每块得分、错误扣分和速度奖励。
- 计时器支持「开始计时 / 暂停 / 继续 / 重新打乱」。
- 地图右下角带「南海诸岛」小地图，显示九段线与南海岛礁。

## 数据来源与生成

边界数据来自「中国省市县2022年初行政区划数据」的 `2022省级` 图层（WGS84），
由脚本做简化、投影并生成 SVG 路径：

```powershell
python scripts/prepare_data.py --level province --emit
```

产物：`src/data/province.json`

> 说明：地图使用 Albers 等积圆锥投影（中央经线 105°E、标准纬线 25°N/47°N）。
> 海南仅保留主岛轮廓，南海诸岛等远海碎岛未作为拼图内容展示。

### 港澳为什么要单独配置（v1.0.0）

`prepare_data.py` 里的简化容差 `SIMPLIFY_TOLERANCE_METERS = 3800` 是**一个统一的绝对长度**，
而省级行政区的面积差着四个数量级：新疆 166 万 km²、香港 1110 km²、澳门 33 km²。
按"省份的平均规模"定的 3800 m 落到澳门身上就是灾难 —— 它整个只有 12 km 宽，
外环被压成三角形、内环压成 4 个完全重合的点，界面上一个像素都画不出来。

所以港澳走 `SMALL_AREA_OVERRIDES` 单独配置（容差 / 最小岛面积 / 坐标小数位），
三条参数都是按「它在这个游戏里占几个像素」定的，不是拍脑袋：

| | 简化容差 | 最小岛面积 | 坐标小数位 |
|---|---|---|---|
| 其他 32 个行政区 | 3800 m | 0.0002°²（≈2.3 km²） | 0（取整） |
| 香港 810000 | 120 m | 0.00001°²（≈0.11 km²） | 2 |
| 澳门 820000 | 50 m | 0.00001°²（≈0.11 km²） | 2 |

**⚠ 这里最容易踩的坑是「坐标取整」而不是容差。** 全图 viewBox 只有 1200 单位宽
（1 单位 ≈ 5.3 km），澳门真实跨度 1.34×2.25 单位 —— `round()` 成整数后外环
只落在 **4 个不同点**上，源数据再细也白搭。所以 `SMALL_AREA_OVERRIDES` 里的
小数位一旦被改回 0，前面的容差调多小都没用。`prepare_data.py` 结尾有自检会直接断言失败。

改了参数后**务必重跑一遍全量回归**（数据层 + 渲染层），别只看输出文件大小：

```powershell
python scripts/prepare_data.py --level province --emit   # 末尾自带小面积精度自检
```

托盘卡片侧另有一条配套规则：港澳的 bbox 很小，卡片 svg 固定 37 px 高时
`stroke-width` 是按 viewBox 单位算的，会把形状糊成实心块。
`src/styles.css` 里 `.tray-card.is-tiny svg path` 用 `vector-effect: non-scaling-stroke`
把描边固定成设备像素；`ProvincePuzzle.tsx` 里的 `TINY_BBOX = 22` 只在港澳命中，不影响其他行政区。

## 开发

```powershell
npm install
npm run dev
```

## 构建

```powershell
npm run build
```

产物位于 `dist/web`（`index.html` + `assets/`）。

## 打包插件

```powershell
scripts/package.ps1
```

自动读取 `manifest.json` 的版本号，打包成：

```text
dist/province_puzzle-<version>.zip
├── manifest.json
└── web/
    ├── index.html
    └── assets/
```

打包完成后可在管理后台「游戏管理」上传该 zip 发布新版本。

## 插件通信

- 游戏加载后向平台发送 `GAME_READY`，平台回传 `GAME_INIT`（含班级/学生信息）。
- `GAME_INIT` 中的 `roster` 是教师批量选择的学生名单。
- 每名学生完成一轮时发送 `GAME_COMPLETE`（含 `studentId`、用时和成绩），平台按学生结算积分。
- 所有学生完成或教师提前结束时发送 `GAME_SESSION_COMPLETE`，平台展示按用时排序的最终排行榜。
