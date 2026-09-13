# eduplay-games 项目长期记忆

## 本机环境约定

- **bash 的 PATH 被污染**：直接跑 `ls`/`wc`/`node` 会 `command not found`（shim 里 `dirname` 就失败了）。
  每条命令前先修 PATH，实测可用：

  ```bash
  export PATH="/usr/bin:/bin:/c/Users/Administrator/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:/c/Users/Administrator/.workbuddy/binaries/PortableGit/versions/1.2.0/mingw64/bin:/c/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3:/c/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12:$PATH"
  ```

- 图形命令（Electron 截图）需 `export MSYS2_ARG_CONV_EXCL='*'` + `unset ELECTRON_RUN_AS_NODE`，
  `taskkill /IM electron.exe /F` 前也要 `MSYS2_ARG_CONV_EXCL='*'`。
- 本机 WebGL 只能在 SwiftShader 软渲染下跑，Electron 需 `--no-sandbox --disable-gpu-sandbox
  --use-angle=swiftshader --enable-unsafe-swiftshader`，详见 skill `frontend-visual-verify`。

## 每个游戏的版本号必须三处同步

`manifest.json` 的 `version`、`package.json` 的 `version`、`src/main.tsx` 的 `const version`。
漏掉 `main.tsx` 会让平台收到的 `GAME_READY` 里版本与包里不一致。展示型游戏另需
`manifest.json` 里 `requiresRoster: false`（平台 `GamePage` 据此跳过选人环节）。

## 打包 / 上架

- 构建：在游戏目录 `npm run build`（`tsc --noEmit && vite build`，产物在 `dist/web/`）。
- 上架脚本：`.workbuddy/tmp/publish_solar.py`（单游戏）、`publish_demo_games.py`（earth-globe + solar-system）。
  流程 = 打 zip（`manifest.json` + `dist/web/**`）→ `POST /admin/games/{code}/packages` → `PATCH .../status ACTIVE`。
- 双后端：本地 `7070`、云端 `17070`，管理员 `admin/admin123`，教师演示账号 `123456/123456`。
- 脚本里 `POST /store/games/{code}/install` 用 admin token 会失败（"只有教师账号可以使用商城"；
  云端直接 500）。这是脚本的老问题，**不影响上架**——版本与 ACTIVE 状态都已生效。
- 校验方式：教师账号登录后 `GET /store/games` 确认 `gameCode` 可见且 version 是新的。

## 太阳系显示布局（v1.1.0）

- 轨道显示半径 `= 7.2 * aAU^0.45 + orbitOffset`。幂压缩会让外侧行星挤在一起，
  `orbitOffset` 是显示层微调（不影响天体档案里的真实数据）。
- 当前：土星/天王星/海王星各 `+2.0`（三者同步外移，彼此相对间距不变），木星不偏移。
  这样木星-土星最小中心距 6.23 > 两者最外侧卫星轨道半径之和 4.91。
- 卫星轨道半径 `= max(行星显示半径*2, 光环外缘倍率*行星显示半径+0.12) + 索引*0.15`，
  有光环的行星让卫星从光环外侧起步。
- 改这几个常量后，务必重算相邻行星（含卫星外缘）的净余量，别只看木星-土星。

## 地球仪图层与地方时（v1.4.0）

- 节点层级：`earthAnchor`(公转位置) → `tiltGroup`(地轴姿态，空间固定) → `spinGroup`(自转)。
  贴图/经纬线/网格/标记挂 `spinGroup`；地轴杆、太阳直射带留在 `tiltGroup`。
- 五带与时区是**独立的叠加球壳**（半径 1.014，`overlayMaterial`），不是并进地球着色器。
  这样不会被昼夜明暗压暗，也不影响地表影像。两个图层共用一套着色器、各自 uniform 开关。
- **叠加球壳必须用预乘混合**：着色器内部用「over」把两层合成后，`o.rgb` 已按 alpha 预乘，
  若还用默认 `NormalBlending` 会再乘一次 alpha → 色带被压成 alpha²（0.22 → 0.048）几乎看不见。
  正确写法：`blending: THREE.CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor`。
  （排查手法：把 alpha 提到 0.5 看有没有变化，若"变了一点但不明显"就是被平方了。）
- 地方时的算法：每帧把 `sunDir`（地球→太阳）用 `tiltGroup.quaternion × spinGroup.quaternion`
  的逆变换回地球地理坐标系 → `atan2(-z, x)` 即**太阳直射经线**（该经线地方时恒为 12:00）；
  任意经度地方时 `= 12 + (lon − 直射经线)/15`，绕 24 取模。区时用该时区中央经线代入。
  自检锚点：晨昏线上应读到 ≈06:00（晨线）或 ≈18:00（昏线）。
- 旋钮是 `src/Knob.tsx`：绕圆心角度拖动（`atan2(dx, -dy)`，0° 在正上方顺时针），
  跨 0°/360° 取最短方向；`wrap=false` 可连续多圈累计。拖动时 `setPointerDragging(true)`
  暂停自动自转，松手恢复。
- `setPointerCapture` 要包 try/catch：合成事件下没有活跃指针会抛 NotFoundError。
