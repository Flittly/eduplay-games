# EduPlay Games

EduPlay 平台的可插拔游戏模块仓库。

当前模块：

- 行政区拼图 `province-puzzle`
- 省级行政区识别 `province-quiz`
- 经纬度五子棋 `geo-gomoku`
- 山河三消（省区要素匹配）`shanhe-match3`
- 寰宇地球仪（日心公转模型）`earth-globe`
- 寰宇太阳系 `solar-system`
- 地貌人格测试 `landform-quiz`
- 天气现象竞答 `weather-quiz`
- 口袋地形 · 垂直地带性（模板 + 真实 DEM）`mountain-zones`
- 山河塑形 · 中国地形（地形区与山脉）`china-relief`

每个游戏是一个独立插件包，平台底座通过插件包的 `manifest.json` 和前端入口进行加载。

> **`requiresRoster` 别填错**：平台判定式是 `needsRoster = manifest.requiresRoster !== false`。
> 只有「不需要点名的展示型游戏」（地球仪 / 太阳系 / 山地沙盘 / 中国地形沙盘）才写 `false`；
> 源码里有 `roster.length === 0` 渲染闸门或双人逻辑的必须是 `true`（或缺省）。
> 填错的表现是进游戏只有「正在等待平台下发学生名单…」永久进不去，而**游戏本身没毛病**，
> 从游戏侧完全看不出问题。`scripts/roster-guard.cjs` 就是替人对这一步的。

## 模块结构

```text
eduplay-games/
├── province-puzzle/
│   ├── manifest.json
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── index.ts
│       ├── ProvincePuzzle.tsx
│       └── styles.css
```

## 构建单个游戏

```powershell
cd province-puzzle
npm install
npm run build
```

构建产物位于：

```text
province-puzzle/dist/web/index.js
```

后续平台插件安装器会把 `manifest.json` 和 `dist/web` 打包成带签名的插件包，例如：

```text
province-puzzle-0.1.0.zip
├── manifest.json
└── web/
    └── index.js
```
