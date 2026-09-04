# 行政区拼图

EduPlay 平台游戏插件（iframe 型），基于真实的中国省级行政区边界制作拖拽拼图。

## 玩法（v0.2.0）

- 使用 2022 年中国省级行政区划边界，共 34 个省级行政区（含香港、澳门、台湾）。
- 底部为打乱顺序的行政区拼块，拖到地图上对应的灰色轮廓位置，松手后自动吸附。
- 全部放回正确位置后完成，并向平台回传成绩（`GAME_COMPLETE`）。

## 数据来源与生成

边界数据来自「中国省市县2022年初行政区划数据」的 `2022省级` 图层（WGS84），
由脚本做简化、投影并生成 SVG 路径：

```powershell
python scripts/prepare_data.py --level province --emit
```

产物：`src/data/province.json`

> 说明：海南仅保留主岛轮廓，南海诸岛等远海碎岛未作为拼图内容展示。

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
- 游戏完成时调用 `onComplete`，入口把成绩以 `GAME_COMPLETE` 消息回传平台结算积分。
