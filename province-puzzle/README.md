# 行政区拼图

EduPlay 平台游戏插件（iframe 型），基于真实的中国省级行政区边界制作拖拽拼图。

## 玩法（v0.3.3）

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
