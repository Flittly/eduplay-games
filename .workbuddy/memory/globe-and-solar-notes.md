# 地球仪 / 太阳系 / three.js 渲染细节

> 2026-09-13 从 `MEMORY.md` 原文拆出（内容未改动），避免主记忆文件超长被后端截断。
> 改这两个游戏（或其 three.js 套路）前先读本文件。

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

## 地球仪贴图与太阳光柱（v1.4.5）

- 两张地表贴图都在 `public/textures/`，`TextureLoader` + `NoColorSpace` 加载：
  `earth.jpg`（白天影像 2048×1024）、`earth_night.jpg`（**黑底城市灯光点阵 2048×1024 / 47 KB**）。
- **夜图必须自己提纯，别直接拿 three-globe 的 `earth-night.jpg` 当灯阵用**：那张其实是
  "偏蓝的夜面影像"（海洋 RGB(0,0.09,0.20)、极区 0.28/0.40），整片蓝底把夜半球垫亮，
  看上去就是"夜间太亮"。分离办法：城市灯光近白（`min(R,G,B)≈0.5`）而蓝底 min≈0 ⇒
  用**最小通道**软阈值截取，再保色相、压冷色残留：
  `w=a.min(2); lights=clip((w-0.16)/(0.55-0.16),0,1)**1.15; rgb=hue*lights; rgb*=1-0.85*clip((B-R)*3,0,1)`
  产出暗像素 99.69%、亮点(>0.5) 仅 0.077%（太平洋/撒哈拉/亚马逊全 0，上海 0.92 / 纽约 1.0）。
- **接入任何外来贴图前先验对齐**：缩到同尺寸算灰度 NCC，并与「水平镜像」的 NCC 比。
  earth_night 对 earth.jpg：原图 0.842 / 镜像 0.694 ⇒ 同投影、无镜像，可共用 UV。
- **夜面 = 原黑色半透明掩膜 + 少量暖白灯光**：底色仍是原 `day*0.10 + vec3(0.010,0.024,0.055)`，
  只在其上加 `clip(lights-0.06,0)/0.94 * vec3(1.0,0.88,0.70) * (1-dayAmt)`。
  **别用大增益** —— v1.4.4 的 `*1.9` 正是"夜面被抬亮"的病根。`*(1-dayAmt)` 必留，
  否则白天一侧透灯点；纯白模式整段跳过。
- **太阳光柱是一整根圆柱，直径＝地球直径**（半径＝地球显示半径 1）：
  `CylinderGeometry(1,1,1,48,1,true)` + `scale.set(1,length,1)` +
  `quat.setFromUnitVectors(RAY_AXIS, sunDir)`；**近地端取 `uEnd=0`**，即端面为
  "过地心、垂直日地连线"的平面 —— 只有这时半径 1 的开口圆环才与地球轮廓重合。
  必须 **`side: THREE.BackSide`**：特写镜头下近侧壁（深度≈2.03）会压在地球盘面（2.0~4.0）
  前方糊住地表，只留远侧壁；远侧壁本身就是一层半透明光幕。
  要像"光"而不像"柱"靠三件事：`ShaderMaterial` + `AdditiveBlending` +
  片元按 `uv.y` 渐隐（近地端 1.0 → 太阳端 0.12）。太阳直射基准线仍是橙红实心细柱（半径 0.032）。
- 素材获取：本机 **GitHub raw 不通**（curl 返回 000），**jsdelivr 的 npm 包通**——
  `https://data.jsdelivr.com/v1/packages/npm/<pkg>?structure=flat` 列文件，
  `https://cdn.jsdelivr.net/npm/<pkg>@<ver>/<path>` 下载。Git Bash 下 `curl -w %{size_download}`
  会假报 0 字节，核对字节数/md5 用 Python。
