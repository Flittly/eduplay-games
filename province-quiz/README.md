# 省级行政区识别

EduPlay 平台游戏插件（iframe 型）：显示省级行政区轮廓，学生从候选项中选出名称，
可查看地理/文化提示，答完一局后把成绩回传平台积分系统。

## 玩法（v0.1.2）

- 每局默认 10 题，可改为 20/34 题。
- 每题展示一个省级行政区轮廓与四个选项。
- 可点击「提示」，逐步显示该省的几条地理文化线索。
- 答对得基础分；答错和使用提示会扣分，单题最低 0 分。
- 结束后通过 `GAME_COMPLETE` / `GAME_SESSION_COMPLETE` 与平台结算积分。

## 数据来源

- 省界路径来自「2022 年中国省市县行政区划数据」，生成脚本见 `scripts/prepare_data.py`。
- 题目提示综合初中地理教材与公开地理资料整理，适合初高中生使用。

## 开发 / 构建 / 打包

```powershell
python scripts/prepare_data.py
npm install
npm run dev
npm run build
scripts/package.ps1
```
