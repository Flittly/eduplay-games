/**
 * 轮廓取景与描边的公共逻辑。
 *
 * 为什么单独抽一个模块：`ProvinceQuiz`（单人答题）和 `DualQuiz`（双人 PK）各有一份
 * **一模一样**的 `silhouetteViewBox` 实现。这次要给「小要素」加取景比例与描边特例，
 * 在两处各写一遍必然漏掉一处 —— 本仓库刚吃过一次同类亏：同源轮廓数据在两个游戏里
 * 各存了一份副本，修好了一个、另一个静默地停在旧版本上。
 *
 * 坐标约定：本游戏的 `bbox` 是 **角点式** `[minX, minY, maxX, maxY]`。
 * ⚠ 与 `shanhe_match3` 的 `[x, y, w, h]` 不同 —— 两边都是「1200 单位宽的等距圆柱投影」，
 * 所以面积/长度的数值可以直接互相参照，但取宽高的写法不能照抄。
 */

export interface SilhouetteFeature {
  id: string;
  name: string;
  /** [minX, minY, maxX, maxY] */
  bbox: [number, number, number, number];
  d: string;
}

/**
 * 「小要素」的 bbox 长边阈值（视图单位）。
 *
 * 取景框是按要素自己的 bbox 单独缩放的，于是 `stroke-width`（viewBox 单位）
 * 换算到屏幕上会被放大成 `stroke-width × 缩放`，要素越小描边越粗。
 * 实测（取景框 512×300、描边 2 单位）：
 *
 * | 要素 | bbox 长边 | 形状 | 描边 | 描边/形状短边 |
 * |---|---|---|---|---|
 * | 澳门 | 2.41 | 17.8×27.0 px | 22.4 px | **125.8%**（整块红，什么都看不出） |
 * | 香港 | 12.19 | 101.7×83.6 px | 16.7 px | **20.0%**（海岸线糊成一团） |
 * | 上海 | 27 | 124.7×146.4 px | 10.8 px | 8.7%（偏粗，但认得出） |
 * | 北京 | 38 | 149.8×167.5 px | 8.8 px | 5.9% |
 * | 内蒙古 | 440 | 275×241 px | 1.2 px | 0.5% |
 *
 * 22 这个值不拍脑袋：**定阈值前把 34 个要素按长边排了一遍序**（`.workbuddy/tmp/pqdata/budget.cjs`），
 * 命中澳门(2.41)、香港(12.19)，最近的一个未命中是上海(27) —— 间隙很宽，
 * 阈值落在 (12.19, 27) 之间都是安全的。取 22 与 `shanhe_match3` 的 `TINY_BBOX` 同一个数，
 * 两个游戏共用一套像素账，以后只有一个数要记。
 */
export const TINY_BBOX = 22;

/**
 * 小要素的描边宽度，**按屏幕像素解释**（配合 `vector-effect: non-scaling-stroke`）。
 *
 * 为什么必须换成像素：小要素的取景框按比例收紧之后缩放会很大
 * （澳门 107 px/单位、香港 25 px/单位），此时「2 个 viewBox 单位」的描边
 * 换算到屏幕上就是 214 px / 50 px —— 比换之前还灾难。
 * 1.5 px 对 250 px 上下的形状 = 0.6%，细到能看出一条干净的界线。
 */
export const TINY_STROKE_PX = 1.5;

/** 要素 bbox 的长边（视图单位）。 */
export function bboxSize(feature: SilhouetteFeature): number {
  const [minX, minY, maxX, maxY] = feature.bbox;
  return Math.max(maxX - minX, maxY - minY);
}

/** 是不是小到「描边会糊死形状」的要素。实测只圈中香港、澳门。 */
export function isTiny(feature: SilhouetteFeature): boolean {
  return bboxSize(feature) < TINY_BBOX;
}

/**
 * 生成 `<svg viewBox>` —— 取景框 = 要素 bbox 外扩一圈边距。
 *
 * 边距分两档，因为**绝对边距作用在规模差 200 倍的集合上必然对小对象是灾难**：
 *
 *  - 普通要素：`max(w,h) * 0.08 + 12`。常数 12 是为「形状别贴着边框」加的，
 *    对内蒙古（长边 440）只占取景框的 2.7%，无感。
 *  - 小要素：`max(w,h) * 0.08`，**去掉常数**。对澳门（长边 2.41）那个常数
 *    相当于取景框的 48%×2 = 96% 都是空白 —— 形状只剩 18×27 px 画在正中间，
 *    加上 22.4 px 的描边，屏幕上就是一颗看不出形状的红点。
 *    改成纯比例后澳门能画到 171×259 px（约 9.6 倍），轮廓才谈得上「用于识别」。
 *
 * ⚠ 去掉常数后缩放变得很大，所以这条路径**必须**同时用 `non-scaling-stroke`
 * （见 `.is-tiny` 的 CSS），否则描边会跟着放大到 200 px 以上。
 */
export function silhouetteViewBox(feature: SilhouetteFeature): string {
  const [minX, minY, maxX, maxY] = feature.bbox;
  const w = maxX - minX;
  const h = maxY - minY;
  const longest = Math.max(w, h);
  // longest 为 0 说明这个要素退化成一个点（老数据里澳门就是这样），
  // 纯比例边距会算出 0×0 的 viewBox，SVG 直接不渲染 —— 兜一个下限。
  const pad = longest * 0.08 + (isTiny(feature) ? 0 : 12) + (longest > 0 ? 0 : 1);
  return `${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`;
}

/**
 * 轮廓 `<path>` 的 class。
 * `is-tiny` 由 CSS 负责换成不随缩放走的细描边，两个渲染点都要带上。
 */
export function silhouettePathClass(feature: SilhouetteFeature): string {
  return isTiny(feature) ? "silhouette-path is-tiny" : "silhouette-path";
}
