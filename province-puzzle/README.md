# 行政区拼图

EduPlay 平台内置的示例游戏插件。

## 开发

```powershell
npm install
npm run dev
```

## 构建插件

```powershell
npm run build
```

产物：

```text
dist/web/index.js
```

## 插件接口

插件默认导出一个 React 组件：

```tsx
export default function ProvincePuzzle({
  onComplete
}: ProvincePuzzleProps)
```

`onComplete` 会收到：

```ts
{
  score: number;
  correctCount: number;
  totalCount: number;
}
```
