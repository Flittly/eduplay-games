# 山河三消（shanhe_match3）

省级行政区三要素匹配消消乐：集齐同一省份的【轮廓卡 + 简称卡 + 行政中心卡】三张不同要素牌即可消除，三张相同牌、同省缺牌、跨省混搭均不可消除。

- 关卡 1：8 个高频省区，2–3 层堆叠（课前热身）
- 关卡 2：18 个常见省区（含易混淆），3–4 层堆叠（课中巩固）
- 关卡 3：全部 34 个省级行政区，4–5 层堆叠（会考冲刺）
- 卡槽 6 格，满格无组合即失败；所有布局由构造式算法保证存在通关路径
- 每局提示 ×3（-5 分/次）、撤回 ×3（-2 分/次），通关整组 +10 分、过关 +20
- 结束后自动归集薄弱省区到学生本地错题档案（localStorage 永久留存）
- 平台对接：`GAME_READY` / `GAME_INIT(roster)` / `GAME_COMPLETE` / `GAME_SESSION_COMPLETE`

数据来源：`src/data/provinces.json` 轮廓数据与 province-puzzle 同源（2022 省级矢量，Albers 投影）。

## 构建

```powershell
cd shanhe-match3
npm install
npm run build
```

产物：`dist/web/`，随 `manifest.json` 打包为 `shanhe_match3-0.1.0.zip` 上架。
