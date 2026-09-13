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
- **所有后端接口都在 `/api/v1` 下**（`/api/v1/admin/login`、`/api/v1/admin/games`、`/api/v1/store/games`）。
  手写探测脚本漏了这个前缀会打到静态资源上，被 `GlobalExceptionHandler` 包成 **HTTP 500
  `{"code":"INTERNAL_ERROR"}`**——看着像后端挂了，其实只是路径写错，别被误导去查数据库/日志。
- 验证截图：`screenshots/` 已被 `.gitignore` 忽略（`**/screenshots/`），归档的验证图只留本地、不进仓库。
- 脚本里 `POST /store/games/{code}/install` 用 admin token 会失败（"只有教师账号可以使用商城"；
  云端直接 500）。这是脚本的老问题，**不影响上架**——版本与 ACTIVE 状态都已生效。
- 校验方式：教师账号登录后 `GET /store/games` 确认 `gameCode` 可见且 version 是新的。
- **改 `manifest.json` 的 `description` 后重新上传包，商城/游戏中心简介会自动同步**：
  `AdminGameService.uploadPackage()` 里有 `if (manifest.description() != null) product.setDescription(...)`，
  不必另找更新接口。（简介要求"简短且不变"，地球仪 59 字 / 太阳系 66 字。）

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

## 地球仪 v1.4.1：特写视角下镜头怎么跟地球

- **「地球特写」下改公转位置时，只能平移镜头、不能重置机位**：给 `camera.position` 与
  `controls.target` **同时**加上「地球新旧位置的位移」，相对关系不变 → 地球在画面里
  位置与大小纹丝不动，只有光照（直射点纬度、晨昏线倾角）在变。
  千万不要在这种路径上再调 `applyEarthView()`（它按 `sunDir` 侧向重算机位），
  那样每转一下旋钮地球就"跳"回固定机位。
- 自检钩子 `readCamDebug()` 报 `earthScreen`（地心屏幕坐标）+ `diskRadiusPx`，
  用它来量化"地球有没有被挪走"，别靠肉眼比对截图。

## three.js：标注按「屏幕坐标」摆放（五带文字用的就是这套）

球面注记绑经纬度会被自转甩到背面；想让它永远朝镜头、永远可读，就按屏幕坐标摆：

```ts
renderer.getSize(tmpSize);                       // CSS 尺寸，不用读 DOM
const h = tmpSize.y;
project(earthPos) → 圆盘圆心 (cx, cy)
// 球面轮廓的像素半径（R=1、相机距地心 dist）
const limbPx = Math.tan(Math.asin(1 / dist)) * (h / 2) / Math.tan(fovRad / 2);
// 屏幕目标点 (tx, ty) → 相机前方 depth 处的世界坐标
const pxPerUnit = (h / 2) / (depth * Math.tan(fovRad / 2));
pos = camera.position
  + camFwd * depth
  + camRight * ((tx - cx) / pxPerUnit)
  + camUp * (-(ty - cy) / pxPerUnit);
// 想保持屏幕尺寸恒定：世界尺寸 × depth / 该 depth 的标称值
```
`camRight = (1,0,0)·camera.quaternion`，`camUp = (0,1,0)·camera.quaternion`。

**什么时候必须这么做**：地轴与视线接近垂直时，两极正好压在球面轮廓上，极地那条带是
贴着极点的小圆 —— 球面上根本不存在「既在轮廓内、又属于该带」的点，硬摆在纬度圈上
就会让文字飘到球体外面。实测第一版就这么翻的车。

**踩过的坑**：算圆盘半径别漏除 2。屏幕偏移 px = `ndcΔx * (w/2)`，所以
「±1 单位两点的距离的一半」= `(|ndcΔx|/2) * (w/2)`，写成 `* w` 会得到 2 倍半径。

## three.js 精灵贴图的「标签被裁」两类坑（v1.1.1 / v1.4.2）

1. **文字被画布右缘裁掉** → 病根在贴图画布宽度算错。`makeLabelSprite` /
   `makeLabelTexture` 若只按主标题量宽，比主标题更宽的副标题（如"恒星 · 太阳系的中心"）
   就会超出画布被裁。**必须主/副标题都量、取最大者 + 留白**。
   （另一层语义：副标题太长还会横向压住邻近天体，缩短文案本身也是修法。）
2. **文字被地球"切掉半截"** → 病根是精灵与弧面球的深度关系：标签精灵是一块正对镜头的
   **平面**，贴着球面摆时靠盘心一侧扎进地球前半面之下，被判遮挡。修法：
   `sprite.material.depthTest = false; depthWrite = false;`，**且必须配套真实遮挡判定**
   （每帧算 `front = 标签点 · 相机方向`，`front < -0.02` 就整个 `visible = false`），
   否则会"透过地球看见字"。

## 地球仪纬线标签：不绑经度、每帧重算落点（v1.4.2）

- 纬线标签（赤道/南北回归线/南北极圈）**不能绑死经度** —— 自转半圈就转到背面被地球挡住。
  每帧把「相机方向」「屏幕右方向」用 `tiltGroup.quaternion × spinGroup.quaternion` 的逆
  变换到**自转坐标系**，在那里每条纬线就是一个水平圆；在"正对镜头那点"左右
  ±`PL_SIDE_ANGLE`(26°) 采样，取**最靠画面左侧、且仍朝镜头**（`front ≥ PL_FRONT_MIN` = 0.2）的点。
- **极地俯视单列一套摆法**（`|相机方向的局部 y| > 0.85` 时）：此时几条纬线在屏幕上退化成
  **同心圆**，"朝镜头的一侧"没有横向意义。**沿半径方向错开不够**（赤道与回归线屏幕半径只差 8%，
  必然叠字），要**沿方位角扇开**：最外圈摆正左 180°，每往里一层再转 40°（180/140/100）。
  实现：把 `RightLocal`/`UpLocal` 投影到赤道面当屏幕方位的基 `eX/eY`，
  `点 = cl·(cosγ·eX + sinγ·eY) + sl·地轴`；可见性按 `sin(lat)·want > 0` 过滤。
  实测最近间距 224px（阈值 100px）。

