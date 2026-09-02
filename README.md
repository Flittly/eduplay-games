# EduPlay Games

EduPlay 平台的可插拔游戏模块仓库。

当前模块：

- 行政区拼图 `province-puzzle`

每个游戏是一个独立插件包，平台底座通过插件包的 `manifest.json` 和前端入口进行加载。

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
