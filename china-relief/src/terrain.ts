/**
 * 卡通地形沙盘（Canvas 2D）
 *
 * ## 为什么不再用 WebGL
 *
 * v0.0.1 用 three.js 起了一层 480×358 的真实高程网面（约 34 万个三角形）：
 * 每帧要把 17 万个顶点的高度与颜色重算一遍，动画收尾还得重算法线
 * （20~50 ms），在教室那类没有独显的机器上就是明摆着的卡顿 —— 用户的原话是
 * "三维展示的时候有些卡顿"。
 *
 * 而这个游戏真正要教的东西 ——「这块地按它真实的海拔被塑起来了」——
 * 并不需要透视相机和多边形光照：**分层设色 + 档间描边 + 北向明暗**
 * 在俯视图上就读得出来，而且这正是地理教科书读地形图的方式。
 * 于是整层换成一张 Canvas 2D 俯视图，着色退化成一次线性扫描，
 * 帧成本从几十毫秒降到几毫秒，且不依赖 WebGL（老机器的显卡驱动也不会再拖后腿）。
 *
 * ## 一格像素怎么决定颜色
 *
 * 按优先级从外到内：
 *   1. **海洋**三层 —— 深海 / 近岸浅滩 / 陆地投影。投影是把陆地掩膜往东南
 *      平移两格后落在海里的那部分染深一档，整块陆地就有"浮在海面上"的卡通感。
 *   2. **陆地在境外**（mask=0 已排除）—— 不画。
 *   3. **未塑形**：米灰 + 每 4 格一档的淡斜纹。刻意不用浅绿 —— 直接按高程 0
 *      上色会和沿海平原同色，学生分不清"这块我还没放"和"这块本来就是低地"。
 *   4. **已塑形**：按 `alt × lift + add` 落到 7 个色档，档与档之间描一道深边
 *      （等于把等高线画出来），再按"北邻比自己高还是低"提亮/压暗一刀 ——
 *      两档量化的明暗就是卡通光照，能读出山脉的坡向，又不会糊成照片。
 *   5. **归属轮廓**（v1.2.0，可开关）：每格记着自己属于哪一条条目
 *      （归属图 `owner`），四邻里只要有一格不是同一条目，就把这格画成
 *      该条目自己的深色描边。于是相邻两块地之间有一条看得见的分界。
 *      注意它与第 4 步的"档界描边"是两件事：档界表达**海拔**（同一条脉上
 *      2000 m 与 500 m 的界线），轮廓表达**归属**。所以轮廓开关管不着档界。
 *   6. **聚焦**（v1.3.0，图鉴用）：非聚焦的地块整体压暗，聚焦的那一条
 *      保持原色、边缘换成朱红，于是"现在看的是哪一块"从整幅图里浮出来。
 *      与第 5 步也是两件事（一个回答"分不分得开"，一个回答"在看哪块"），
 *      所以聚焦**不受轮廓开关控制**。
 *
 * ## 为什么先算两块中间数组
 *
 * 上色要读邻居（判档界、判明暗）。若每个像素都现场再算一遍邻居的高程，
 * 常数直接变三倍。先把 `hAll`（高程）与 `bandAll`（色档）各扫一遍，
 * 上色就退化成查表 —— 两次线性扫描远比一次三倍常数的小循环便宜。
 *
 * ## 地名标注是**画在最后的一层**
 *
 * 上面整段算出来的是一张 `ImageData`，而地名不是像素、是文字。所以它在
 * `drawImage` **之后**再往同一张画布上画一次（`drawLabels`），
 * 天然跟着每次重绘走，不需要另外维护状态。
 *
 * ## 四种底图的差别在哪两处
 *
 * 逐像素那段只有两个分支（未塑形 / 已塑形），四种底图的差别全落在这两处里面：
 *   · `relief` / `hillshade` —— 未塑形是米灰斜纹；已塑形按色档 + 明暗（二值 / 连续晕渲）；
 *   · `soft`                 —— 未塑形**也按真实高程画七档原色**（只是不给档界描边与明暗），
 *                              已塑形是同一套色再加那两样，于是"塑形"＝**浮出边界与起伏**；
 *   · `satellite`            —— 已塑形区抠成透明，露出下面的影像瓦片。
 *
 * ⚠ `soft` 在 v1.5.0 改过一次：v1.4.0 是"整幅向白插值成淡彩"，被用户否掉了
 * ——「不用浅色，那层白色掩膜不好看」。理由与改法见下面「原色地形」那一段。
 *
 * ## 动画期间降采样
 *
 * `refresh(..., animating=true)` 时按 2 格 1 像素出图（4.3 万格），
 * 动画停止后补一次全分辨率。与 v0.0.1 在动画期间跳过法线是同一个取舍。
 */
import {
  CELL_KM,
  GRID_H,
  GRID_W,
  SPAN_X,
  SPAN_Z,
  lonLatToWorld,
  mapLayout,
  worldToLonLat,
  type TerrainData
} from "./geo";
import { STEP_LINES } from "./data/regions";
import type { BasemapKind } from "./basemap";

const N = GRID_W * GRID_H;

/* ------------------------------ 调色 ------------------------------ */

type RGB = readonly [number, number, number];

/** 深海 / 近岸浅滩 / 陆地投影 / 海岸线 */
const SEA_DEEP: RGB = [143, 192, 224];
const SEA_SHALLOW: RGB = [186, 222, 241];
const SEA_SHADOW: RGB = [109, 157, 196];
const COAST: RGB = [74, 109, 138];

/*
 * v1.5.0 ~ v1.9 的"未塑形 = 米灰两色交替成斜纹"（`UNSHAPED` / `UNSHAPED_ALT`）
 * 在 v2.0.0 拆掉了，换成 `GRAY_BAND` 的灰阶地形 —— 理由见那里。
 * 两个旧常量一并删掉，免得后人 grep 到它们、以为还在用。
 */

/**
 * 分层设色，7 档离散（卡通风的关键是**减少色阶**，连续插值会糊成照片）。
 * 阈值取 200 / 500 / 1000 / 2000 / 3500 / 5000 m，与地理教材的分层设色一致。
 */
const BAND_MAX = [200, 500, 1000, 2000, 3500, 5000];
const BAND_RGB: RGB[] = [
  [127, 176, 105], // ≤200   低地绿
  [168, 192, 106], // ≤500   黄绿
  [207, 195, 107], // ≤1000  土黄
  [209, 163, 95], // ≤2000  橙褐
  [184, 122, 77], // ≤3500  褐
  [156, 132, 120], // ≤5000  灰褐
  [233, 228, 221] // >5000  雪白
];

/** 色档下标（0 = 未塑形，1..7 = BAND_RGB 的下标 +1） */
function bandIndexOf(h: number): number {
  for (let b = 0; b < BAND_MAX.length; b++) {
    if (h <= BAND_MAX[b]) {
      return b + 1;
    }
  }
  return BAND_RGB.length;
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/** 陆地投影往东南偏几格 */
const SHADOW_STEP = 2;
/** 明暗分档的坡度阈值（米/格）—— 分层设色用「二值卡通明暗」 */
const SHADE_DEG = 60;
const SHADE_UP = 1.14;
const SHADE_DOWN = 0.86;
/** 档界描边的压暗系数 */
const EDGE_DARK = 0.66;

/** 一格的地面米数。**从 geo 现读**，不再写死 11900 —— 投影网格的格距就是它算出来的 */
const CELL_M = CELL_KM * 1000;
/**
 * 地势晕渲的连续明暗（分层设色改用这个时才是「晕渲底图」）。
 *
 * 光源取**西北仰角 45°** —— 这是地形图的惯例：光从左上打过来，
 * 山脊的东南坡是暗的、西北坡是亮的，人眼立刻读得出"隆起"而不是"凹陷"。
 * 反过来打光（东南）会让整个中国看起来像一群坑。
 */
const HS_LX = -0.5;
const HS_LY = -0.5; // y 轴向南为正 ⇒ -y 是北，西北方向就是 (-x, -y)
const HS_LZ = Math.SQRT1_2;
const HS_GAIN = 1.6;

/** 遥感底图下未塑形区的灰纱不透明度：0.72 = 影像还能透出 28% */
const SAT_VEIL = 184;

/* ------------------- 未塑形区的灰阶地形（v2.0.0） ------------------- */

/**
 * 未塑形区按**真实高程**画地形，但只画灰度、不画档界与明暗。
 *
 * ## 为什么未塑形区现在要画地形
 *
 * v1.5.0 定的是"未塑形区一律米灰斜纹"。那条规则在只有「原色地形」一种底图时
 * 没问题，但用户切到「分层设色」「地势晕渲」时发现**画面纹丝不动**
 * （实测两张截图 195520 / 195504 字节，肉眼也一样）—— 因为这两张底图的
 * 区别全在"已塑形区长什么样"，而开局一块都没塑。底图开关于是成了摆设。
 *
 * 现在改成：未塑形区也画地形，但**只画灰度**。于是三件事同时成立：
 *   · 两张底图切过去都能看到中国地形（分层设色＝灰阶分档、地势晕渲＝灰阶+晕渲）；
 *   · 塑形的反馈变成**上色**（灰 → 彩），比"从无到有"更抓眼；
 *   · 仍然一眼分得清"我塑的"和"本来就有的"。
 *
 * ## 为什么不是"向白插值"（v1.5.0 否掉过的那版）
 *
 * 那一版是把彩色向白做**仿射混合** `(1-k)·c + 255k`：它把所有色差**等比**压缩，
 * 七档相邻色差 97.7 → 37.8（只剩 39%），分层设色事实上失效 —— 这正是它被否的原因。
 * 灰阶不是这么干的：它换掉的是**色相维度**（饱和度归零），而**明度差是重新给的**，
 * 相邻两档明度差 14~30，比彩色版的通道差还大。
 *
 * ## 为什么是"越高越深"
 *
 * 灰阶地形图的惯例（浮雕感），而且正好让**三级阶梯的形态**一眼可见：
 * 东部平原近白、青藏高原最深。这一条与下面「三级阶梯」那个图层是配套的。
 */
const GRAY_BAND: RGB[] = [
  [240, 238, 233], // ≤200   低地
  [226, 222, 214], // ≤500
  [206, 200, 190], // ≤1000
  [182, 176, 164], // ≤2000
  [156, 149, 136], // ≤3500
  [128, 121, 109], // ≤5000
  [98, 92, 82] //     >5000  高原雪山
];

/* --------------------- 三级阶梯（v2.0.1 重做） --------------------- */

/**
 * 三块阶梯面的颜色（下标 = `geo.stepIndexAt` 的返回：0 第三级 / 1 第二级 / 2 第一级）。
 *
 * ## v2.0.0 那套「按高程阈值画等值线」为什么整个废掉
 *
 * 用户 v2.0.1 的原话是：「阶梯不是这样的阶梯，阶梯是两条线构成的将中国划分为
 * 三个区域」。这话点得很准 —— 高程等值线只在青藏高原边缘碰巧对得上，别处全错：
 * 天山、阿尔泰那些 4000 m 上下的山头成了"第一级阶梯"的**飞地**；塔里木盆地、
 * 内蒙古高原这些**第二级阶梯的主体**大片低于 1000 m，被划进了第三级。
 * 最要命的是**线不跟着山脉走** —— 教材上那条线是"昆仑山—祁连山"，
 * 等值线却在地图上自己游来游去，学生拿它跟课本对不上。
 *
 * 阶梯是**地理区划**，不是高程分档。界线是那几条山脉的连线，
 * 判定与数据见 `geo.stepIndexAt` / `data/regions.ts` 的 `STEP_LINES`。
 *
 * ## 为什么「面 + 线 + 字」三样都要
 *
 * 面回答"这块地在第几级"，线回答"界线究竟从哪几条山脉过"，字回答"哪块是第几级"。
 * 只画面前两样不行：学生看得出三块颜色不同，却学不到教材上那两条**山脉连线**
 * 是什么 —— 而那正是这节课要背的东西。所以面上还要标名字，线下还要能被认出来。
 *
 * ## 配色为什么是青 / 赭 / 紫
 *
 * 地形底图已经占掉绿—黄—褐—灰白一整条色带，海洋还占着蓝。剩下区分度高的
 * 只有**青、品红、紫**这一圈。三级各取一个，色相拉得够开，于是相邻两级之间
 * 那条界在灰阶底图上也能一眼看出来。
 */
const STEP_FILL: RGB[] = [
  [78, 156, 178], // 0 = 第三级（平原丘陵）—— 青
  [214, 128, 92], // 1 = 第二级（高原盆地）—— 赭橙
  [132, 104, 188] // 2 = 第一级（青藏高原）—— 紫
];

/**
 * 面的不透明度。
 *
 * 0.32 是"看得清色块、又漏得出地形"的平衡点。再高（0.45+）青藏高原那一大片
 * 就糊成一块紫，山脊与河谷全被盖掉 —— 而这幅图的**主体信息是地形**，
 * 阶梯只是参考图层；再低（0.2 以下）灰阶底图上三块就分不出来了。
 */
const STEP_FILL_ALPHA = 0.32;

/**
 * 阶梯标题（级名 + 海拔特征）与它的文字色。
 *
 * 位置是**手工挑的**，挑法就是"地图上本来就空着的地方"：避开全部地形区锚点
 * 与山脉中点。第一级放藏北（`冈底斯` 与 `唐古拉` 之间那块），第二级放
 * 阿拉善以西的内蒙古高原西部，第三级放黄淮之间。
 * 海拔特征那三个数是教材原文（4000 m 以上 / 1000~2000 m / 500 m 以下），
 * 是这一课要记的东西，所以不省。
 *
 * ⚠️ 它们**先占避让表**，地名再让开（见 `drawStepTitles`）。
 */
const STEP_TITLE: { lon: number; lat: number; text: string; sub: string; ink: string }[] = [
  { lon: 84.5, lat: 34.0, text: "第一级阶梯", sub: "4000 米以上", ink: "#463072" },
  { lon: 97.5, lat: 42.0, text: "第二级阶梯", sub: "1000～2000 米", ink: "#7d421c" },
  { lon: 117.5, lat: 33.5, text: "第三级阶梯", sub: "500 米以下", ink: "#14505f" }
];

/**
 * 分界线的颜色与线宽（屏幕 px）。
 *
 * 和地名标注同一套路：**先描一圈白再上彩线**。底图从深褐一路到雪白七个档，
 * 单用浅色会在雪白档上消失、单用深色会在褐档上糊掉 —— 自带衬底才处处可读。
 *
 * 深赭红与地形色系协调（褐的邻居），又不会和海岸线的青灰撞。
 */
const STEP_EDGE: RGB = [172, 66, 46];
const STEP_EDGE_HALO = "rgba(255, 255, 255, 0.9)";
const STEP_EDGE_W = 3.4;
const STEP_EDGE_HALO_W = 6.4;

/** 标注与阶梯标题共用的字体栈 —— 两处各写一份，改字体时必然漏一个 */
const LABEL_FONT =
  '"Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif';

/**
 * canvas 侧的字号档位表 —— **与 styles.css 的 `--fs-*` 逐档同值**（v2.0.2）。
 *
 * 为什么要镜像一份：canvas 读不到 CSS 变量。每帧 `getComputedStyle` 解析既慢，
 * 首帧还可能拿到 null。所以数值常量在这里再写一份，两边由
 * `scripts/typography.test.cjs` **逐档锁死** —— 改一边不同步那边就会报红。
 *
 * ⚠ canvas 字号是**设备无关像素**：`setup()` 里已经 `setTransform(dpr, …)`，
 *   所以直接用 CSS 的 px 数值，**不要再乘 dpr**（乘了就大一倍）。
 * ⚠ `parseFloat(ctx.font)` 拿到的是**字重**（`"700 15.5px …"` → 700）。
 *   要量实际字号必须从字体串里抠 `(\d+(?:\.\d+)?)px`。
 */
const FS = {
  "2xs": 12,
  xs: 13.5,
  sm: 15.5,
  md: 17.5,
  lg: 20.5,
  xl: 24,
  "2xl": 32
} as const;


/* ------------------------ 原色地形底图（v1.5.0） ------------------------ */

/**
 * 「原色地形」：整幅中国地形**一开始就按原色画全**，塑形只负责把它"描出来"。
 *
 * ## v1.4.0 → v1.5.0：那层白色掩膜被拆了
 *
 * v1.4.0 的做法是把陆海**一起向白插值**（陆地 62%、海面 45%），整幅退成淡彩，
 * 让"塑形"表现为**由淡转浓**。用户 v1.5.0 的原话是：
 *
 *   「浅色地形还是使用原本的颜色即可，不用浅色，现在外面加了一层白色的
 *     掩膜反而不是特别的好看」
 *
 * 这个判断是对的，而且原因可以精确算出来。`fadeToWhite(c, k) = (1-k)·c + 255k`
 * 是一条**仿射**映射，所以它把**任何**色差一律乘 `(1-k)`——陆地 k=0.62 时
 * 就是**乘 0.38**，一个 43 的色差变成 17，七档之间的区分度整体掉到 38%。
 * 相邻档的 ΔRGB（曼哈顿，实测值）：
 *
 *   档 -> 下一档      原色间距   淡 62% 后   保留
 *   低地绿 -> 黄绿       58         22       38%
 *   黄绿   -> 土黄       43         17       40%
 *   土黄   -> 橙褐       46         18       39%
 *   橙褐   -> 褐         84         33       39%
 *   褐     -> 灰褐       81         32       40%
 *   灰褐   -> 雪白      274        105       38%
 *   ————————————————————————————————————————————
 *   平均                97.7       37.8      39%
 *
 * **七档色淡完之后全挤进 (206~247, 204~245, 187~242) 这个极窄的灰白区间**
 * （对比原色的 R 127~233 / G 122~228 / B 77~221），相邻档只差 17~33，
 * 摊到三个通道上每通道只有 6~11 —— 已经贴着"看不出区别"的边上。
 * 也就是"分层设色"这件事在这张底图上**基本失效了**：学生看到的是一层
 * 均匀的灰白纱，而不是一张地形图。截图实测吻合：地图里占面积最大的
 * 两种陆地色是 (238,220,194) 与 (206,225,198)，色差 32，
 * 而它们原本是"橙褐"和"低地绿"两个八竿子打不着的色相。
 *
 * ⇒ 结论不是"淡一点不好看"，而是**这套淡化方式与分层设色本身相冲突**：
 * 分层设色靠的就是色相差异，而向白插值是**等比例压缩**所有色差。
 * 要"浅"，应该压的是饱和度而不是往白里兑 —— 但那已经是另一套调色了。
 *
 * ## 改完之后的取舍（写清楚，免得下轮又改回去）
 *
 * 未塑形区直接给 `BAND_RGB` 原色，于是这张底图**一开局就是一整张配好色的
 * 中国地形图**，地形起伏提前全露（v1.4.0 就是这个取舍，只是当时还糊着）。
 * "塑形"的信号从「由淡转浓」换成**「浮出档界描边 + 明暗」**：
 *
 *   · 未塑形 —— 原色，但**不给**档界描边、**不给**明暗（`render` 的 soft 分支）；
 *   · 已塑形 —— 同一套色，加上档界描边与二值明暗。
 *
 * 好处是档界（＝等高线）本身就压得住七档的接近，是比"浓淡"更准的信号；
 * 代价是**开局的辨识难度比 `relief` 低**——想让学生"没放之前什么也看不见"，
 * 用 `relief`（未塑形是米灰斜纹）。
 *
 * 未塑形取的是**真实高程** `da[k]`、不是塑形后的高度场 `hAll[k]`：
 * 这样形状与高低都和塑好之后完全重合，学生看到的是"这里本来就长这样，
 * 我塑形只是把它描出来"，而不是"我塑形把地形改了"。
 */

/* --------------------------- 聚焦（v1.3.0） --------------------------- */

/**
 * 图鉴模式：侧栏点开哪一条，就把那一条从整幅图里**挑**出来。
 *
 * 做法是「压暗其余 + 圈出选中」这一对，而不是给选中项加个闪烁箭头：
 * 图鉴要回答的问题是「太行山到底是哪一溜」——一条 50 km 宽的窄脉，
 * 指着中心点闪一下是说不清的，得让**整条**从图里浮出来。所以非聚焦地块
 * 整体乘一个压暗系数，聚焦地块保持原色并把边缘换成高对比的朱红。
 *
 * 压暗系数取 0.42：再高（比如 0.7）对比不够，学生要在两幅图之间来回看；
 * 再低地形之间的相对高低就读不出来了 —— 而"哪块高哪块低"本身也是教学内容。
 */
const FOCUS_DIM = 0.42;

/**
 * 聚焦地块的边缘色：朱红。
 *
 * 挑红色有两个理由：① 地图的色系是暖黄 / 土褐 / 灰绿 / 雪白，
 * 红与它们**都不撞**；② 它与已有的归属描边（各条目自己的色系压深）在
 * 色相上离得最远，两条边同时出现时不会互相误认成对方。
 */
const FOCUS_EDGE: RGB = [214, 48, 36];

/** 遥感底图下非聚焦地块盖的暗纱：聚焦靠"别人暗下去"，影像也不例外 */
const FOCUS_VEIL = 170;

/* --------------------------- 轮廓（v1.2.0） --------------------------- */

/**
 * 把条目自己的颜色压成"描边色"。
 *
 * 用户的原话是「在地形的周围能够有颜色区分开，这样同学们也可以仔细」——
 * 要点是**相邻的两块地之间要有一条看得见的分界**，而且要能看出"这块是这块"。
 *
 * 所以不用一个统一的深墨色，而是**每条目用自己的色系压深**：
 * 相邻的黄土高原（黄褐）与华北平原（浅绿）压深之后仍然是两个不同的深色，
 * 边界一眼能分；统一用一个深墨色的话，就只有"有线"而没有"哪块是哪块"。
 *
 * 为什么走 HSL 而不是直接乘个系数：直接 `rgb × 0.5` 会把所有颜色一起推向黑，
 * 各条目的描边色互相趋同（区分度反而没了）；在 HSL 里把明度**压到固定档**
 * 同时把饱和度提上去，各条目就保持着自己的色相。
 */
export function outlineRGB(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    return [58, 50, 38];
  }
  const v = parseInt(m[1], 16);
  const r0 = ((v >> 16) & 255) / 255;
  const g0 = ((v >> 8) & 255) / 255;
  const b0 = (v & 255) / 255;
  const max = Math.max(r0, g0, b0);
  const min = Math.min(r0, g0, b0);
  const l0 = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 1e-6) {
    s = l0 > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r0) {
      h = ((g0 - b0) / d + (g0 < b0 ? 6 : 0)) / 6;
    } else if (max === g0) {
      h = ((b0 - r0) / d + 2) / 6;
    } else {
      h = ((r0 - g0) / d + 4) / 6;
    }
  }
  // 明度压到 0.26（比"档界压暗 0.66"更狠，因为它要压过色档本身的深浅）；
  // 饱和度提到 0.62~0.86，保住色相不往灰里跑
  const s2 = Math.min(0.86, Math.max(0.62, s * 1.5));
  const l2 = 0.26;
  const q = l2 < 0.5 ? l2 * (1 + s2) : l2 + s2 - l2 * s2;
  const p = 2 * l2 - q;
  const hue = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [Math.round(hue(h + 1 / 3) * 255), Math.round(hue(h) * 255), Math.round(hue(h - 1 / 3) * 255)];
}

/**
 * 一个地名标注（v1.4.0）。
 *
 * 只有**已经在图上**的条目才会进来 —— App 侧按 `isSettled` 过滤，
 * 而不是"学生自己放对的"（`isPlaced`）。理由：图鉴模式的 `required` 是空的，
 * 按 `isPlaced` 过滤的话图鉴里一个名字都不会有，而图鉴恰恰最需要名字。
 * 按 `isSettled` 则是：答题时预置的条目自带名字、学生自己放对的立刻浮出名字，
 * 图鉴里 38 条全标。
 */
export interface LabelDef {
  /** 要写的字，如「横断山脉」 */
  text: string;
  /** 标在哪（经纬度）。地形区用 ring 内的锚点，山脉用脊线中点 */
  lon: number;
  lat: number;
  /**
   * 字号倍率（1 = 常规）。地形区面积大、字大一点；山脉细长、字小一点，
   * 免得一条 50 km 宽的脉被三个大字整个压住。绝对值仍由地图缩放决定。
   */
  scale?: number;
}

/**
 * 渲染时要额外知道的东西。
 *
 * 传的是一个**可变对象**（App 侧放在 ref 里原地改），
 * 因为 `refresh()` 会在 rAF 里被高频调用，每次新建一个对象既费又没必要。
 */
export interface SceneView {
  /** 每格属于哪个条目：0 = 无归属，n = 第 n 个条目（1 起） */
  owner: Uint8Array | null;
  /** 是否画出条目轮廓 */
  outline: boolean;
  /** 描边色表，长度 3×(条目数+1)，下标 0 空着 */
  ownerColor: Uint8Array | null;
  /**
   * 当前聚焦的条目（图鉴，v1.3.0）：0 / 省略 = 不聚焦。
   *
   * ⚠️ 它**不受 `outline` 开关控制**，这是刻意的：两个开关回答的是
   * 两个问题 —— `outline` 是"相邻两块地分不分得开"，`focus` 是"现在在看哪一块"。
   * 把聚焦挂在轮廓开关下面，老师在图鉴里关掉轮廓就再也标不出位置了。
   */
  focus?: number;
  /**
   * 地名标注（v1.4.0，可开关）。
   *
   * ⚠️ **数组顺序有意义**：按顺序画，被前面压住的那个直接不画（见 `drawLabels`）。
   * App 侧把"最近刚落位的"与"图鉴里当前聚焦的"排在最前 ——
   * 保证学生刚放好的那一块一定能看到名字，而不是被邻居的名字挤掉。
   */
  labels?: LabelDef[];
  /**
   * 左侧要预留的像素宽（v2.0.0）。
   *
   * 介绍卡弹出时会盖住地图 —— 而学生此刻最想看的恰恰是"我刚放对的那一块"。
   * 所以卡片一开，地图就整体**右移并收窄**，把左边让出来（而不是裁掉一块）。
   * 该值同时传给 `geo.mapLayout`，**画布与影像瓦片层必须用同一个数**，
   * 否则影像和地形会错开（老问题，见 mapLayout 的注释）。
   */
  insetLeft?: number;
  /**
   * 是否画出中国地势三级阶梯（v2.0.1）。
   *
   * 打开时是**三层**：三块半透明色面（在像素混合阶段就掺进颜色里了）、
   * 两条分界线的矢量折线、图上三个阶梯名 —— 见 `STEP_FILL` 那一段注释。
   */
  steps?: boolean;
}

/* ------------------------------ 接口 ------------------------------ */

export interface PickResult {
  lon: number;
  lat: number;
}

export interface TerrainView {
  /**
   * 重新出图。
   * `animating=true` 时按 2 格 1 像素降采样（动画期间够用），
   * 动画收尾传 false 补一次全分辨率。
   * `basemap` 决定"已塑形"区画成什么样（见 basemap.ts）。
   * `scene` 提供归属图与轮廓开关（v1.2.0，可省）。
   */
  refresh(
    alt: Float32Array,
    lift: Float32Array,
    add: Float32Array,
    animating: boolean,
    basemap: BasemapKind,
    scene?: SceneView
  ): void;
  pick(clientX: number, clientY: number): PickResult | null;
  /** 经纬度 → 画布内的像素坐标，用于给提示气泡定位 */
  project(lon: number, lat: number): { x: number; y: number } | null;
  dispose(): void;
}

export function createTerrainView(canvas: HTMLCanvasElement, data: TerrainData): TerrainView {
  // 声明成非空类型：TS 不会把 `if (!x) throw` 的窄化带进下面的嵌套函数里
  const ctxMaybe = canvas.getContext("2d");
  if (!ctxMaybe) {
    throw new Error("这个浏览器没有 Canvas 2D 上下文");
  }
  const ctx: CanvasRenderingContext2D = ctxMaybe;

  const off = document.createElement("canvas");
  const offMaybe = off.getContext("2d");
  if (!offMaybe) {
    throw new Error("离屏 Canvas 2D 上下文创建失败");
  }
  const offCtx: CanvasRenderingContext2D = offMaybe;

  /**
   * 投影网格上的陆地遮罩与"范围外"标记。
   *
   * ⚠️ 这里是**投影网格**，不是判定层用的原经纬度栅格（见 geo.ts 的
   * `buildTerrainData`）。渲染与判定各用一套、名字还像，是这一版最容易
   * 传错的地方 —— 传错的表现是"判定整体偏了一百多公里"。
   */
  const land = data.land;
  const outside = data.outside;

  /* -------------------- 近岸浅滩（只算一次） -------------------- */
  const nearShore = new Uint8Array(N);
  for (let j = 0; j < GRID_H; j++) {
    for (let i = 0; i < GRID_W; i++) {
      const k = j * GRID_W + i;
      if (land[k]) {
        continue;
      }
      let touch = false;
      for (let dj = -1; dj <= 1 && !touch; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= GRID_H) {
          continue;
        }
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= GRID_W) {
            continue;
          }
          if (land[jj * GRID_W + ii]) {
            touch = true;
            break;
          }
        }
      }
      nearShore[k] = touch ? 1 : 0;
    }
  }

  /* ------------------ 三级阶梯（只算一次，v2.0.1） ------------------ */
  /**
   * 每格的阶梯级别（0 / 1 / 2）。
   *
   * 直接取 `data.step` —— 它在 `buildTerrainData` 反投影那一步**顺带**就算好了
   * （见 geo.ts 的 `buildTerrainData`）。这里再算一遍等于把 20 万次折线判定做两次。
   *
   * ⚠️ 它**不随"学生塑到哪一步"变化**：三级阶梯是地理事实。拿塑形后的高度场去判，
   * 界线会随着每一次落子在地图上爬。
   */
  const stepAll = data.step;

  /* ---------------------- 中间数组（复用） ---------------------- */
  /**
   * 显示用的地形高度（米）。
   *
   * v2.0.0 起它**不再有"没有地形"这个取值**：未塑形的格子也填真实高程
   * （因为未塑形区现在要画灰阶地形）。是不是"学生塑的"由 `shaped` 单独记 ——
   * 两件事合成一个哨兵值（老版本的 `-1`）会立刻自相矛盾：
   * 晕渲要对未塑形区生效、而档界描边只该出现在已塑形区。
   */
  const hAll = new Float32Array(N);
  /** 1 = 这一格已经被塑形（学生塑的或本局预置的） */
  const shaped = new Uint8Array(N);
  /** 显示用色档（1..7）。0 = 没有地形可画（海洋 / 图幅之外） */
  const bandAll = new Uint8Array(N);

  /**
   * 连续晕渲明暗系数（「地势晕渲」底图用）。
   *
   * 四邻梯度 → 法线 → 与西北 45° 光矢量点积。邻居若**没有地形**
   * （海洋 / 图幅之外，`bandAll = 0`）就退回自己的高程，**不能当作 0 米** ——
   * 否则海岸线会长出一圈假断崖（那里根本没落差，只是"到海里了"）。
   *
   * v2.0.0 起未塑形区也有地形了，所以"有没有地形"改看 `bandAll`
   * 而不是老版本的 `hAll >= 0` 哨兵 —— 那个哨兵现在永远是真，
   * 晕渲会把海岸线当成 4000 m 的断崖。
   */
  function hillshadeMul(k: number, i: number, j: number): number {
    const h = hAll[k];
    const okL = i > 0 && bandAll[k - 1] > 0;
    const okR = i < GRID_W - 1 && bandAll[k + 1] > 0;
    const okU = j > 0 && bandAll[k - GRID_W] > 0;
    const okD = j < GRID_H - 1 && bandAll[k + GRID_W] > 0;
    const hL = okL ? hAll[k - 1] : h;
    const hR = okR ? hAll[k + 1] : h;
    const hU = okU ? hAll[k - GRID_W] : h;
    const hD = okD ? hAll[k + GRID_W] : h;
    const zx = (hR - hL) / (2 * CELL_M);
    const zy = (hD - hU) / (2 * CELL_M);
    const norm = Math.sqrt(zx * zx + zy * zy + 1);
    // 法线 N = (-zx, -zy, 1)/norm；L 已是单位矢量
    const ndl = (HS_LX * -zx + HS_LY * -zy + HS_LZ) / norm;
    const flat = HS_LZ; // 平地时 N·L = 0.7071 ⇒ 系数正好是 1
    const mul = 1 + (ndl - flat) * HS_GAIN;
    return mul < 0.4 ? 0.4 : mul > 1.5 ? 1.5 : mul;
  }

  /* ---------------------------- 布局 ---------------------------- */
  let mapX = 0;
  let mapY = 0;
  let mapScale = 1;

  function layout(): { w: number; h: number } {
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    /*
     * 整张中国地图等比铺满舞台。**与底图瓦片层共用 mapLayout**，
     * 见 geo.ts 的注释：两边各算一套迟早会错开半个像素。
     *
     * v2.0.0 起多传一个"左侧预留"：介绍卡打开时地图右移让位。
     * ⚠️ 这个数**必须与 App 传给 `layoutTiles` 的完全一样**，
     * 否则影像瓦片还停在老位置、地形已经挪走 —— 而画面上只像是"影像糊了"。
     */
    const m = mapLayout(w, h, lastScene?.insetLeft ?? 0);
    mapScale = m.mapScale;
    mapX = m.mapX;
    mapY = m.mapY;
    return { w, h };
  }

  /* --------------------------- 状态缓存 --------------------------- */
  let lastAlt: Float32Array | null = null;
  let lastLift: Float32Array | null = null;
  let lastAdd: Float32Array | null = null;
  let lastBasemap: BasemapKind = "relief";
  let lastScene: SceneView | undefined;

  /* ---------------------------- 出图 ---------------------------- */
  let img: ImageData | null = null;
  let imgW = 0;
  let imgH = 0;

  function render(step: number, basemap: BasemapKind) {
    const { w, h } = layout();

    const da = lastAlt;
    const dl = lastLift;
    const dAdd = lastAdd;
    if (!da || !dl || !dAdd) {
      return;
    }

    /*
     * 「原色地形」：未塑形区**也画地形**，但用原色、不加档界描边与明暗。
     * v1.5.0 之前这里还叠了一层向白插值，已拆掉 —— 理由与实测色差见
     * 上面「原色地形底图」那一段。下面所有 `soft` 分支现在**只判断
     * "要不要画地形"**，不再改配色：四种底图的配色表已经统一成一套原色。
     */
    const soft = basemap === "soft";

    // 轮廓：开关关掉时直接不认归属图，省掉下面每次都做的四邻比较
    // ⚠️ `gridOwner` 与 `owner` 必须分开：图鉴的聚焦要用归属图，
    //    但不该被"轮廓"开关关掉（v1.3.0，理由见 SceneView.focus）
    const gridOwner = lastScene?.owner ?? null;
    const owner = lastScene?.outline ? gridOwner : null;
    const palette = owner ? lastScene?.ownerColor ?? null : null;
    const focusTag = lastScene?.focus ?? 0;
    /** 三级阶梯界线开关（v2.0.0）。级别表 `stepAll` 在视图创建时就算好了 */
    const stepOn = lastScene?.steps === true;
    // 「本格 + 四邻」是否同属一块地。留成局部函数是为了下面那几处分支共用同一判断
    const isOwnerEdge = (k: number, i: number, j: number, own: number): boolean => {
      if (!gridOwner) {
        return false;
      }
      const left = i > 0 ? gridOwner[k - 1] : 0;
      const right = i < GRID_W - 1 ? gridOwner[k + 1] : 0;
      const up = j > 0 ? gridOwner[k - GRID_W] : 0;
      const down = j < GRID_H - 1 ? gridOwner[k + GRID_W] : 0;
      return left !== own || right !== own || up !== own || down !== own;
    };

    // ---- 第 1 遍：显示高度 + "是否已塑形"（全分辨率，邻居查询要用精确值） ----
    /*
     * ⚠️ 这两件事**必须分开存**（v2.0.0）。
     * v1.5.0 用一个 `-1` 哨兵同时表达"没塑形"和"没有地形"，那是因为
     * 未塑形区根本不画地形、两者等价。现在未塑形区要画灰阶地形，
     * 于是"有地形"永远成立，哨兵失去意义 —— 留着它的表现是
     * **档界描边会画到未塑形区上去**（`bandAll = 0` 被当成"别人"），
     * 一层 11.9 km 粗的网罩在整幅底图上。
     */
    for (let k = 0; k < N; k++) {
      const l = dl[k];
      const a = dAdd[k];
      const isShaped = l > 0.02 || a > 1;
      shaped[k] = isShaped ? 1 : 0;
      hAll[k] = isShaped ? da[k] * l + a : da[k];
    }
    // ---- 第 2 遍：色档。未塑形区也填 —— 灰阶地形要用同一个档位 ----
    for (let k = 0; k < N; k++) {
      bandAll[k] = land[k] ? bandIndexOf(hAll[k]) : 0;
    }

    // ---- 第 3 遍：上色 ----
    const W = Math.ceil(GRID_W / step);
    const H = Math.ceil(GRID_H / step);
    /*
     * ⚠️ 离屏 canvas 的尺寸**必须**跟着 buffer 一起设。
     *
     * 踩过：只建了 `createImageData(480, 358)` 就直接 `putImageData`，
     * 而离屏 canvas 还是默认的 300×150 —— `putImageData` 超出画布的部分会被
     * **静默裁掉**，于是 480×358 的地图只有左上角 300×150 被写上，
     * 其余在 `drawImage` 时按透明处理，露出舞台背景色（正好也是海蓝）。
     *
     * 症状极具欺骗性：页面看上去"有海有陆地、轮廓也有"，只是陆地面积只有
     * 应有的五分之一、中国只剩了个西北角。肉眼扫一眼截图很难说清哪里不对 ——
     * 是"陆地像素总数 vs 掩膜期望值"那条断言把它钉出来的（实测 71,566 px vs 期望 380,323 px）。
     */
    if (!img || imgW !== W || imgH !== H || off.width !== W || off.height !== H) {
      off.width = W;
      off.height = H;
      img = offCtx.createImageData(W, H);
      imgW = W;
      imgH = H;
    }
    const px = img.data;

    let o = 0;
    for (let jj = 0; jj < H; jj++) {
      const j = Math.min(GRID_H - 1, jj * step);
      const rowBase = j * GRID_W;
      for (let ii = 0; ii < W; ii++, o += 4) {
        const i = Math.min(GRID_W - 1, ii * step);
        const k = rowBase + i;
        let r: number;
        let g: number;
        let b: number;
        let alpha = 255;

        if (outside[k]) {
          /* -------- 图幅之外（v2.0.0） --------
             圆锥投影下经纬度矩形的投影是"扇环"，它的外接矩形四角本来就
             没有东西。不在这里留透明的话，四角会被画成一大片海蓝，
             整个投影换了等于白换 —— 屏幕上看起来还是一个矩形。
             留透明之后，地图就是**扇形**，四角露出舞台背景色。 */
          r = 0;
          g = 0;
          b = 0;
          alpha = 0;
        } else if (!land[k]) {
          /* -------- 海洋 --------
             海陆用**同一套原色**（v1.5.0 起；v1.4.0 曾把海也淡掉 45%）。
             这里不再有 `soft` 分支：用户明确要"原本的颜色"。 */
          let sc: RGB;
          if (j >= SHADOW_STEP && i >= SHADOW_STEP && land[k - SHADOW_STEP * GRID_W - SHADOW_STEP]) {
            sc = SEA_SHADOW;
          } else if (nearShore[k]) {
            sc = SEA_SHALLOW;
          } else {
            sc = SEA_DEEP;
          }
          r = sc[0];
          g = sc[1];
          b = sc[2];
        } else if (i === 0 || i === GRID_W - 1 || j === 0 || j === GRID_H - 1 ||
          !land[k - 1] || !land[k + 1] || !land[k - GRID_W] || !land[k + GRID_W]) {
          /* -------- 海岸线 -------- */
          r = COAST[0];
          g = COAST[1];
          b = COAST[2];
        } else {
          const hv = hAll[k];
          if (!shaped[k]) {
            if (soft) {
              /* -------- 原色地形：未塑形区**也画地形**，且用**原色** --------
                 色档取的是**真实高程** `da[k]`（不是塑形后的高度场），
                 所以这块地的形状、高低和塑好之后完全重合 —— 差别**不在配色**，
                 而在"有没有档界描边与明暗"。

                 刻意不加档界描边与明暗：那两样是"这块已经塑好了"的信号，
                 提前给出去，学生就分不出"我塑的"和"本来就这样"了。
                 于是这张底图上"塑形"这个动作的反馈就是：**地块的边界与起伏
                 浮出来**，而颜色自始至终不变。 */
              const sb = BAND_RGB[bandAll[k] - 1];
              r = sb[0];
              g = sb[1];
              b = sb[2];
            } else {
              /* -------- 灰阶地形（v2.0.0） --------
                 分层设色 / 地势晕渲 / 遥感影像三种底图下，未塑形区画**灰阶**地形：
                 能看出"中国地形长什么样"，但一眼就知道"这块还没人塑"。
                 来龙去脉与配色理由见 `GRAY_BAND` 的注释。

                 仍然不加档界描边（那是"塑好了"的信号），但这一版**加明暗**：
                 「地势晕渲」这个名字要立得住 —— 切过去得能看出是晕渲；
                 而「分层设色」保持纯灰阶分档，于是两张底图一眼可辨：
                   · 分层设色 = 灰阶色块（同档同色，边界是水平分层）
                   · 地势晕渲 = 灰阶 + 连续光影（山脊山谷浮出来）

                 遥感底图下这层仍带半透明（`SAT_VEIL`）：影像透出约三成，
                 于是"换了底图"一眼可见，而"已塑形 = 全彩影像"仍然拉得开。 */
              const gb = GRAY_BAND[bandAll[k] - 1];
              const mul = basemap === "hillshade" ? hillshadeMul(k, i, j) : 1;
              r = clamp255(gb[0] * mul);
              g = clamp255(gb[1] * mul);
              b = clamp255(gb[2] * mul);
              alpha = basemap === "satellite" ? SAT_VEIL : 255;
            }
          } else {
            /*
             * -------- 已塑形 --------
             *
             * 归属轮廓（v1.2.0）**先于底图分支**算出来：遥感底图也必须画。
             * 遥感下已塑形区是"抠成透明、露出影像"，轮廓要是跟着一起透明，
             * 切到影像底图就完全看不到分界了 —— 而"相邻两块地要分得开"
             * 恰恰是切到影像之后更被需要的事。
             */
            const ownAny = gridOwner ? gridOwner[k] : 0;
            const own = owner ? ownAny : 0;
            let edge: readonly [number, number, number] | null = null;
            if (palette && own > 0 && isOwnerEdge(k, i, j, own)) {
              edge = [palette[own * 3], palette[own * 3 + 1], palette[own * 3 + 2]];
            }

            /*
             * -------- 图鉴聚焦（v1.3.0） --------
             * 放在归属轮廓**之后**算，于是聚焦的那圈朱红能盖住同一条目的
             * 归属描边（两条边同时出现时，问的永远是"现在在看哪一块"）。
             * 非聚焦的地块整体压暗，聚焦的那块保持原色浮出来 —— 见 FOCUS_DIM 的注释。
             */
            const dimmed = focusTag > 0 && ownAny > 0 && ownAny !== focusTag;
            if (focusTag > 0 && ownAny === focusTag && isOwnerEdge(k, i, j, ownAny)) {
              edge = FOCUS_EDGE;
            }

            if (edge) {
              r = edge[0];
              g = edge[1];
              b = edge[2];
              alpha = 255;
            } else if (basemap === "satellite") {
              /* -------- 把这层"毛毡"整个抠掉 --------
                 画布在这里留透明，浏览器就把下面的影像瓦片层透出来了。
                 好处是不必读影像像素（跨域画布 getImageData 会抛），
                 也不必给 image 挂 canvas 去采样。 */
              r = 0;
              g = 0;
              b = 0;
              alpha = 0;
              /*
               * 图鉴聚焦下不能再用"全透明"：影像底图里非聚焦的那几块必须
               * 暗下去，聚焦的那块才浮得出来。于是改盖一层半透明暗纱 ——
               * 这是唯一一处"用画布上的像素去压底下影像"的地方，
               * 因为这里要表达的是"别看这些"，而透明恰恰是"看影像本身"。
               */
              if (dimmed) {
                r = 26;
                g = 30;
                b = 38;
                alpha = FOCUS_VEIL;
              }
            } else {
              /* -------- 色档 + 档界 + 明暗 -------- */
              const bd = bandAll[k];
              const c = BAND_RGB[bd - 1];
              /*
               * 三种底图的区别全在这一处 `mul`：
               *   relief    —— 只比"北邻"，二值提亮/压暗，即卡通光照；
               *   hillshade —— 四邻梯度算真坡向，连续晕渲（西北 45° 光源）。
               * 色档与档界两者共用：色档是**海拔语义**，换底图不能把它丢了。
               *
               * 注意这里的"档界描边"与上面的"归属轮廓"是两件事，
               * 所以轮廓开关**管不着它**：档界表达的是海拔（同一条脉上
               * 2000 m 与 500 m 的界线），轮廓表达的是"这块地归哪一条目"。
               */
              let mul: number;
              if (basemap === "hillshade") {
                mul = hillshadeMul(k, i, j);
              } else {
                mul = 1;
                const northH = hAll[k - GRID_W];
                if (northH >= 0) {
                  if (hv > northH + SHADE_DEG) {
                    mul = SHADE_UP;
                  } else if (hv < northH - SHADE_DEG) {
                    mul = SHADE_DOWN;
                  }
                }
              }
              const rightB = i < GRID_W - 1 ? bandAll[k + 1] : bd;
              const downB = j < GRID_H - 1 ? bandAll[k + GRID_W] : bd;
              if ((rightB !== 0 && rightB !== bd) || (downB !== 0 && downB !== bd)) {
                mul *= EDGE_DARK;
              }
              // 图鉴聚焦：非聚焦地块压暗。放在最后乘 —— 色档与档界、明暗之间的
              // 相对关系全部保留，只是整体退到背景里
              if (dimmed) {
                mul *= FOCUS_DIM;
              }
              r = clamp255(c[0] * mul);
              g = clamp255(c[1] * mul);
              b = clamp255(c[2] * mul);
            }
          }
        }

        /*
         * ---- 三级阶梯的三块面（v2.0.1） ----
         *
         * 在所有地形配色**算完之后**再掺进去。于是"面是半透明的、地形从下面
         * 透出来"是数学成立的一件事，而不是靠两层绘制叠出来的 —— 那种做法一旦
         * 绘制顺序或 alpha 搞错，症状是"地形被色块盖死"，而看上去只是"颜色有点怪"。
         *
         * ⚠️ 界线**不再在这里画**（v2.0.0 是在这里把 level 边界的格子涂成深赭红）。
         * 逐格涂出来的线只有 1.65 px 宽，`drawImage` 放大时被双线性插值糊成一条
         * 渐变带 —— 而分界线是这一课的主角，必须锐利。改走矢量路径，见 `drawStepLines`。
         */
        if (stepOn && land[k]) {
          const c = STEP_FILL[stepAll[k]];
          if (alpha === 0) {
            /*
             * 遥感底图下"已塑形区"是**抠成透明、露出影像**的。这里不能沿用透明，
             * 否则一切到影像底图，阶梯面就凭空消失（而原因看着像"影像底图不支持阶梯"）。
             * 改成一片**半透明的面色**：ImageData 是非预乘的，于是这个像素与影像
             * 合成后正好是"32% 的阶梯色盖在影像上"。
             */
            r = c[0];
            g = c[1];
            b = c[2];
            alpha = Math.round(STEP_FILL_ALPHA * 255);
          } else {
            // 其余情况（含遥感底图未塑形区的 SAT_VEIL 半透明灰阶）照常掺色
            r = r * (1 - STEP_FILL_ALPHA) + c[0] * STEP_FILL_ALPHA;
            g = g * (1 - STEP_FILL_ALPHA) + c[1] * STEP_FILL_ALPHA;
            b = b * (1 - STEP_FILL_ALPHA) + c[2] * STEP_FILL_ALPHA;
          }
        }

        px[o] = r;
        px[o + 1] = g;
        px[o + 2] = b;
        px[o + 3] = alpha;
      }
    }

    offCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(off, 0, 0, W, H, mapX, mapY, SPAN_X * mapScale, SPAN_Z * mapScale);
    /*
     * 下面两样都必须画在 `drawImage` **之后**：这里是同一张画布的最上层，
     * 画在前面会被上面这一句整个盖掉 —— 而且完全静默，只是"标签不见了"。
     *
     * 顺序是：分界线 → （`drawLabels` 内部的）阶梯标题 → 地名。
     * 阶梯标题排在分界线之后，因为它自带白描边，压在线上正好把线"切断"一小段，
     * 反而显得字是浮在地图上的。
     */
    drawStepLines();
    drawLabels();
  }

  /**
   * 画地名标注（v1.4.0）。
   *
   * ## 为什么要避让，以及"谁优先"
   *
   * 38 个地名摊在 960 万 km² 上平均是够的，但**东部密集区**（华北、长江中下游、
   * 东南沿海）几个名字会叠在一起。叠成一团的字比没有字更糟 —— 学生看不出
   * 那一团到底是什么。所以做一步贪心避让：与已画过的任何一个相交就**跳过**。
   *
   * 跳过谁由**数组顺序**决定（先来的先占位），于是顺序变成有意义的东西：
   * 见 `SceneView.labels` 的注释 —— App 把刚落位的和当前聚焦的排在最前，
   * 于是"学生刚放对的那一块"永远不会被邻居的名字挤掉。
   *
   * ## 为什么是「白描边 + 深字」
   *
   * 底图有七档色，从深褐一路到雪白。单用浅字（深色底上清楚）会在雪白档上消失；
   * 单用深字（雪白上清楚）会在褐档上糊掉。先描一圈白外廓再填深色，
   * 等于给每个字自带一块衬底，七档底色上都能读。
   *
   * ⚠ v1.5.0 起 `soft` 底图也用**原色**了（不再淡化），所以这里**只有一套配色**、
   * 白描边的必要性**反而更强**：v1.4.0 那会儿七档色被压到 R 206~247 的浅区间，
   * 深字本来就都读得出来；现在恢复成 R 127~233，又回到"雪白档会吃掉浅字、
   * 褐档会吃掉深字"的老问题 —— 这一段不用改，但别把它当成多余。
   */
  /**
   * 画两条阶梯分界线的**矢量折线**（v2.0.1）。
   *
   * 为什么要走矢量、而不是像 v2.0.0 那样在像素循环里涂：那张底图是 575×387 的
   * 网格，放大到画布上每格只有 1.65 px，逐格涂出来的线被双线性插值糊成一条
   * 渐变带 —— 而分界线是这一课要背的东西，得锐利。
   *
   * 白描边 + 彩线的画法与地名标注同一套：底图从深褐到雪白七档，
   * 单一颜色的线在某一档上必然读不出来。
   *
   * 折线**按原样画到端点为止**，不做"延长到海里"：数据里的端点已经落在
   * 国界附近（横断山南端、雪峰山南延到中越边境），再往外画就出国了。
   */
  function drawStepLines(): void {
    if (!lastScene?.steps) {
      return;
    }
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const pass of [0, 1] as const) {
      ctx.lineWidth = pass === 0 ? STEP_EDGE_HALO_W : STEP_EDGE_W;
      ctx.strokeStyle = pass === 0
        ? STEP_EDGE_HALO
        : `rgb(${STEP_EDGE[0]}, ${STEP_EDGE[1]}, ${STEP_EDGE[2]})`;
      for (const ln of STEP_LINES) {
        ctx.beginPath();
        let started = false;
        for (const [lon, lat] of ln.line) {
          const p = project(lon, lat);
          if (!p) {
            continue;
          }
          if (started) {
            ctx.lineTo(p.x, p.y);
          } else {
            ctx.moveTo(p.x, p.y);
            started = true;
          }
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * 画三级阶梯的名字（级名 + 海拔特征），并把包围盒推进 `taken` 占位。
   *
   * 字号比地名再大一档：这三个词是开关打开时的主角。文字色用的是**与该级面片
   * 同一色系的深色**，于是"字"和"它讲的那块地"在视觉上是一组。
   *
   * ⚠️ `taken` 由调用方（`drawLabels`）传进来，而且这一批要**先占** ——
   * 地名让开。反过来（地名先占位）的后果是三个大字被小地名挤掉，
   * 界面表现是"开关打开了、图上却没有阶梯的名字"，而这正是这次要做的事。
   *
   * 字号（v2.0.2）：跟 `mapScale` 走（阶梯名该多大取决于地图画面多大），
   * 但夹进档位区间 `[--fs-md, --fs-xl]`。**真正起作用的是下限** ——
   * 实测 1024~1500 宽的视口下 `mapScale * 0.95` 只有 9.2~15.6，全部低于
   * 旧下限 14，所以"阶梯名一直是 14px"。抬下限（14 → 17.5）才是这轮
   * "字太小"的正解；系数 0.95 → 1.10 让大屏下也跟着长。
   */
  function drawStepTitles(taken: number[], cw: number, ch: number): void {
    if (!lastScene?.steps) {
      return;
    }
    const size = Math.min(FS.xl, Math.max(FS.md, mapScale * 1.1));
    const sub = size * 0.62;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    for (const t of STEP_TITLE) {
      const p = project(t.lon, t.lat);
      if (!p) {
        continue;
      }
      ctx.font = `700 ${size.toFixed(1)}px ${LABEL_FONT}`;
      const wTitle = ctx.measureText(t.text).width;
      ctx.font = `600 ${sub.toFixed(1)}px ${LABEL_FONT}`;
      const wSub = ctx.measureText(t.sub).width;
      const halfW = Math.max(wTitle, wSub) / 2 + 8;
      const halfH = size * 0.62 + sub * 0.62 + 6;
      const x0 = p.x - halfW;
      const x1 = p.x + halfW;
      const y0 = p.y - halfH;
      const y1 = p.y + halfH;
      // 出画布的不画：半个字挂在边上比不画还难看（与 `drawLabels` 同一条规则）
      if (x0 < 2 || y0 < 2 || x1 > cw - 2 || y1 > ch - 2) {
        continue;
      }
      taken.push(x0, y0, x1, y1);
      const yTitle = p.y - size * 0.52;
      const ySub = p.y + size * 0.52;
      ctx.font = `700 ${size.toFixed(1)}px ${LABEL_FONT}`;
      ctx.lineWidth = Math.max(3, size * 0.3);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
      ctx.strokeText(t.text, p.x, yTitle);
      ctx.fillStyle = t.ink;
      ctx.fillText(t.text, p.x, yTitle);
      ctx.font = `600 ${sub.toFixed(1)}px ${LABEL_FONT}`;
      ctx.lineWidth = Math.max(2.4, sub * 0.34);
      ctx.strokeText(t.sub, p.x, ySub);
      ctx.fillStyle = "#3a322a";
      ctx.fillText(t.sub, p.x, ySub);
    }
    ctx.restore();
  }

  function drawLabels() {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw || !ch) {
      return;
    }
    /** 已占位的包围盒，按 x0,y0,x1,y1 四个一组摊平存（避免每帧建对象） */
    const taken: number[] = [];
    /*
     * ⚠️ 阶梯标题要在**下面那个提前 return 之前**画。`list` 为空（开局一条都还没
     * 落位）时地名一个都不画，但阶梯图层开着就得有名字 —— 否则开关一打开却
     * 什么都看不到，看着就像功能坏了。
     */
    drawStepTitles(taken, cw, ch);

    const list = lastScene?.labels;
    if (!list || list.length === 0) {
      return;
    }
    /*
     * 字号：一个字该有多大，取决于"这块地在地图上占多大"，所以跟着 `mapScale` 走 ——
     * 而不是跟着屏幕宽度走（那会让小窗口里的字相对地图显得巨大）。
     * 再夹进档位区间 `[--fs-xs, --fs-md]`。
     *
     * ⚠️ **下限才是决定可读性的那一个数**（v2.0.2 实测）：1024~1500 宽的视口下
     *    `mapScale * 0.72` 只有 7.0~11.8，**几乎一律被夹到旧下限 11** ——
     *    所以"地图上的字一直是 11px"，投影仪后排自然读不出来。这轮把下限
     *    抬到 `--fs-xs`（13.5），并把系数 0.72 → 0.85（×1.18），大屏下也一起长。
     */
    const base = Math.min(FS.md, Math.max(FS.xs, mapScale * 0.85));
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    for (const lb of list) {
      const p = project(lb.lon, lb.lat);
      if (!p) {
        continue;
      }
      const size = base * (lb.scale ?? 1);
      ctx.font = `700 ${size.toFixed(1)}px ${LABEL_FONT}`;
      const halfW = ctx.measureText(lb.text).width / 2 + 3;
      const halfH = size * 0.72 + 2;
      const x0 = p.x - halfW;
      const x1 = p.x + halfW;
      const y0 = p.y - halfH;
      const y1 = p.y + halfH;
      // 出画布的不画：半个字挂在边上比不画还难看
      if (x0 < 2 || y0 < 2 || x1 > cw - 2 || y1 > ch - 2) {
        continue;
      }
      let clash = false;
      for (let t = 0; t < taken.length; t += 4) {
        if (x0 < taken[t + 2] && x1 > taken[t] && y0 < taken[t + 3] && y1 > taken[t + 1]) {
          clash = true;
          break;
        }
      }
      if (clash) {
        continue;
      }
      taken.push(x0, y0, x1, y1);
      ctx.lineWidth = Math.max(2.4, size * 0.32);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
      ctx.strokeText(lb.text, p.x, p.y);
      ctx.fillStyle = "#2f2820";
      ctx.fillText(lb.text, p.x, p.y);
    }
    ctx.restore();
  }

  /* --------------------------- 对外接口 --------------------------- */
  function refresh(
    alt: Float32Array,
    lift: Float32Array,
    add: Float32Array,
    animating: boolean,
    basemap: BasemapKind,
    scene?: SceneView
  ) {
    lastAlt = alt;
    lastLift = lift;
    lastAdd = add;
    lastBasemap = basemap;
    lastScene = scene;
    render(animating ? 2 : 1, basemap);
  }

  /* ---------------------------- 拾取 ---------------------------- */
  function pick(clientX: number, clientY: number): PickResult | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }
    const wx = (clientX - rect.left - mapX) / mapScale - SPAN_X / 2;
    const wz = (clientY - rect.top - mapY) / mapScale - SPAN_Z / 2;
    if (wx < -SPAN_X / 2 || wx > SPAN_X / 2 || wz < -SPAN_Z / 2 || wz > SPAN_Z / 2) {
      return null;
    }
    // 圆锥投影下 x/z 不再各自线性对应经纬度，必须走真正的反投影
    // （v2.0.0 之前这里是 `xToLon(wx)` / `zToLat(wz)` 两个独立函数）
    return worldToLonLat(wx, wz);
  }

  function project(lon: number, lat: number) {
    if (!canvas.clientWidth) {
      return null;
    }
    const p = lonLatToWorld(lon, lat);
    return {
      x: mapX + (p.x + SPAN_X / 2) * mapScale,
      y: mapY + (p.z + SPAN_Z / 2) * mapScale
    };
  }

  /* ---------------------------- 尺寸联动 ---------------------------- */
  // 静止时不会再调 refresh，所以窗口变化必须由观察者自己触发一次重绘
  const ro = new ResizeObserver(() => {
    if (lastAlt && lastLift && lastAdd) {
      render(1, lastBasemap);
    }
  });
  ro.observe(canvas);

  function dispose() {
    ro.disconnect();
    img = null;
  }

  return { refresh, pick, project, dispose };
}
