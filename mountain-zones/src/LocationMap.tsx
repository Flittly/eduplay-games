/**
 * 位置图：一座山在中国的哪里。
 *
 * 结构：SVG 画地图（国界 / 省界 / 所在省高亮 / 南海诸岛插图）+ HTML 层叠一个**闪烁的红点**。
 *
 * ## 两个刻意的选择
 *
 * ① **红点用 HTML 而不是 SVG 元素。** SVG 里做"从自身中心扩散"的脉冲动画要配
 *    `transform-box: fill-box`，而 HTML 绝对定位 + CSS `transform` 是浏览器上跑得最稳的那条路
 *    （`landform-quiz` 的同款小地图就是这么做的，已上线）。位置用百分比给，与
 *    `preserveAspectRatio="none"` 配合 —— 只要 SVG 是恰好奇妙地铺满容器，百分比定位与
 *    地图坐标就严格线性对应，红点不会因为留白而漂移。
 *    所以这里**不用** `xMidYMid meet`：容器宽高比一旦与 viewBox 差一点点，meet 会留白，
 *    而红点仍按百分比走 ⇒ 看着就是"红点偏了"。`none` 只会让地图被拉伸千分之几，肉眼无感。
 *
 * ② **红点的位置由 `projectToPercent` 统一算**，与生成脚本共用同一套投影参数。
 *    两边实现必须一致，`npm run test:data` 会拿生成时写下的 `meta.probe` 对表。
 *
 * ⚠️ 红点标的是**这座山的真实地理位置**，不受右侧「纬度」滑杆影响 ——
 *    那个滑杆是在做"把这座山搬到赤道/极圈"的思想实验，不是在地图上搬山。
 *    界面里有一行字说明这件事，别把它去掉。
 *
 * ⚠️ **所以坐标一律走 DemSource.lat / lon，绝不能用 `snapshot.lat`。**
 *    `snapshot.lon` 是真实经度（`field.source.lon`），但 `snapshot.lat` 是
 *    **滑杆值**（`params.lat`）—— 源码里这两个字段来源不同。用错的话，学生一拖纬度滑杆
 *    红点就跟着在中国版图上南北平移，"真实位置"这层意思当场就没了。
 *    为防止再次踩到，这里的 props 直接叫 `realLat` / `realLon`。
 */

import { useMemo } from "react";
import { projectToPercent, type ChinaMap } from "./locmap";
import type { MountainLocation } from "./data/locations";

interface Props {
  map: ChinaMap;
  location: MountainLocation;
  /** 山体名（红点旁的小标签） */
  mountainName: string;
  /** 真实纬度（北纬为正）—— 来自 DemSource.lat，**不是** snapshot.lat */
  realLat: number;
  /** 真实经度（东经为正）—— 来自 DemSource.lon */
  realLon: number;
}

/** 标签贴近右边界时改向左展开，免得被裁掉 */
function anchorMode(leftRatio: number): string {
  if (leftRatio > 0.66) {
    return "end";
  }
  return "start";
}

function coordText(lat: number, lon: number): string {
  const ns = lat >= 0 ? "北纬" : "南纬";
  const ew = lon >= 0 ? "东经" : "西经";
  return `${ns} ${Math.abs(lat).toFixed(2)}° · ${ew} ${Math.abs(lon).toFixed(2)}°`;
}

export default function LocationMap({ map, location, mountainName, realLat, realLon }: Props) {
  const pos = useMemo(() => projectToPercent(map, realLat, realLon), [map, realLat, realLon]);
  const [vbx, vby, vbw, vbh] = map.meta.viewBox;
  const [ix, iy, iw, ih] = map.inset.box;

  return (
    <div className="mz-locmap">
      <div className="mz-locmap-frame" style={{ aspectRatio: `${vbw} / ${vbh}` }}>
        <svg
          viewBox={`${vbx} ${vby} ${vbw} ${vbh}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${mountainName}在中国的位置：${location.province}`}
        >
          {/*
            ⚠️ 绘制顺序在这里是有讲究的，第一版就踩过：
            国界轮廓**带填充**画在省界之上，会把 34 条省界描边和所在省的金色高亮整块盖住 ——
            而 DOM 断言（getComputedStyle 拿到金色、fill-opacity 0.62）照样全绿，
            因为样式确实生效了、只是被一层不透明的米色压住。**只有像素能证明它看得见。**
            正确顺序：陆地底色（填充）→ 省界（描边 + 所在省填充）→ 国界（**只描边**）。
          */}
          <path className="mz-lm-land" d={map.outline} />

          {/* 省界：全部淡描一遍，所在省单独加深 */}
          <g className="mz-lm-prov">
            {Object.entries(map.provinces).map(([ad, d]) => (
              <path
                key={ad}
                d={d}
                className={ad === location.adcode ? "mz-lm-prov-on" : undefined}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          {/* 国界压在省界之上，轮廓才清楚 —— 但必须 fill:none，否则又把它盖回去了 */}
          <path className="mz-lm-outline" d={map.outline} vectorEffect="non-scaling-stroke" />

          {/* 南海诸岛插图 */}
          <g className="mz-lm-inset">
            <rect x={ix} y={iy} width={iw} height={ih} className="mz-lm-inset-bg" />
            <path d={map.inset.outline} className="mz-lm-inset-land" vectorEffect="non-scaling-stroke" />
            <path d={map.inset.nineDash} className="mz-lm-inset-nine" vectorEffect="non-scaling-stroke" />
            <rect x={ix} y={iy} width={iw} height={ih} className="mz-lm-inset-edge" vectorEffect="non-scaling-stroke" />
            {/* 标签放插图**左上角**：底部会压住最南端的岛屿（曾母暗沙一带），
                而左上角那一片是空海域（插图内容在顶部只占右侧台湾岛以东那一段断续线）。
                ⚠ `y` 是"文字块顶边"而不是基线 —— 靠 CSS 的 dominant-baseline 办的，
                  所以这里的 +6 是**固定上边距**、跟字号无关。
                  写成基线的写法（第一版是 `iy + 19`）会把字号和偏移耦死：
                  字号 24 时刚好，提到 34 之后文字就冒到插图框上边外面去了。 */}
            <text className="mz-lm-inset-label" x={ix + 6} y={iy + 6}>
              南海诸岛
            </text>
          </g>
        </svg>

        <span
          className="mz-locmap-dot"
          style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
          aria-hidden="true"
        >
          <i className="mz-locmap-dot-pulse" />
          <i className="mz-locmap-dot-core" />
        </span>

        <span
          className="mz-locmap-tag"
          data-anchor={anchorMode(pos.left / 100)}
          style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
          aria-hidden="true"
        >
          {mountainName}
        </span>
      </div>

      <div className="mz-locmap-readout">
        <b>{location.province}</b>
        <span>{location.range}</span>
      </div>
      <div className="mz-locmap-coord">{coordText(realLat, realLon)}</div>
      <p className="mz-locmap-note">
        {location.note}
        {location.onBorder ? (
          <em className="mz-locmap-border">该山位于省界上，红点几乎骑在界线上。</em>
        ) : null}
      </p>
      <p className="mz-hint">
        红点标的是该山的<b>真实位置</b>，不随「纬度」滑杆移动 —— 那根滑杆只在做
        「把这座山搬到赤道 / 极圈」的思想实验，不是在地图上搬山。
      </p>
    </div>
  );
}
