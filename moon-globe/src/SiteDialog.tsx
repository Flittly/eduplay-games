/**
 * 站点介绍弹窗。
 *
 * 结构固定为「图 + 文 + 数」三段：
 *  ① 真实照片（`SITE_DETAILS[x].photo`，全部是航天任务的实拍照片，
 *     图注写明「照片里能看到什么」，右下角标出拍摄方）；
 *  ② 一句话定位 + 正文；
 *  ③ 定位盘（从地球看 / 从月背看）+ 关键数据表。
 *
 * 定位盘不是装饰：它回答的是「这个点在月面的哪一面」——
 * 近地面站点画在正对地球的那一盘上，背面站点换成从月背看的视角（东西会镜像，
 * 因为站在月球背后往前看，东边确实跑到了左边）。这一步没法靠三维视图讲清楚，
 * 因为三维里你总是可以拖到任意角度。
 */

import { useEffect } from "react";
import type { MoonFeature } from "./moonPhase";
import { FEATURE_COLORS, FEATURE_KIND_NAMES } from "./moonPhase";
import { formatLat, formatLon, siteDetailOf } from "./moonSites";

interface Props {
  feature: MoonFeature;
  onClose: () => void;
  onLocate: (f: MoonFeature) => void;
}

const LOCATOR_R = 44;
const LOCATOR_C = 52;

/** 月面经纬度 → 定位盘上的屏幕坐标（正交投影，单位圆再乘以半径） */
function discXY(lat: number, lon: number, far: boolean): { x: number; y: number } {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  const xb = Math.cos(la) * Math.sin(lo);
  const yb = Math.sin(la);
  // 从月背看时，屏幕右方向翻了 180°（相机站在 −Z 侧）
  const x = far ? -xb : xb;
  return { x: LOCATOR_C + x * LOCATOR_R, y: LOCATOR_C - yb * LOCATOR_R };
}

function LocatorDisc({ feature, far }: { feature: MoonFeature; far: boolean }) {
  const meridians = [-60, -30, 0, 30, 60];
  const parallels = [-60, -30, 0, 30, 60];
  const p = discXY(feature.lat, feature.lon, far);

  return (
    <svg className="site-locator" viewBox="0 0 104 104" role="img" aria-label="月面定位盘">
      <defs>
        <clipPath id="site-disc-clip">
          <circle cx={LOCATOR_C} cy={LOCATOR_C} r={LOCATOR_R} />
        </clipPath>
      </defs>
      <circle cx={LOCATOR_C} cy={LOCATOR_C} r={LOCATOR_R} fill="#2b2f3a" />
      <g clipPath="url(#site-disc-clip)">
        {/* 经线：固定经度，纬度扫一遍 */}
        <g stroke="rgba(242,232,213,0.28)" strokeWidth="0.8" fill="none">
          {meridians.map((lon) => {
            const pts: string[] = [];
            for (let lat = -90; lat <= 90; lat += 6) {
              const la = (lat * Math.PI) / 180;
              const lo = (lon * Math.PI) / 180;
              const xb = Math.cos(la) * Math.sin(lo);
              const yb = Math.sin(la);
              const x = LOCATOR_C + (far ? -xb : xb) * LOCATOR_R;
              const y = LOCATOR_C - yb * LOCATOR_R;
              pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
            }
            return <polyline key={`m${lon}`} points={pts.join(" ")} />;
          })}
          {parallels.map((lat) => {
            const la = (lat * Math.PI) / 180;
            const y = LOCATOR_C - Math.sin(la) * LOCATOR_R;
            const w = Math.cos(la) * LOCATOR_R;
            return (
              <line key={`p${lat}`} x1={LOCATOR_C - w} y1={y} x2={LOCATOR_C + w} y2={y} />
            );
          })}
          <line x1={LOCATOR_C - LOCATOR_R} y1={LOCATOR_C} x2={LOCATOR_C + LOCATOR_R} y2={LOCATOR_C} />
        </g>
      </g>
      {/* 南极-艾特肯盆地这类超大体量，用一圈虚环提示范围 */}
      {feature.kind === "basin" && (
        <circle
          cx={p.x}
          cy={p.y}
          r={LOCATOR_R * 0.62}
          fill="none"
          stroke={FEATURE_COLORS.basin}
          strokeWidth="1.2"
          strokeDasharray="3 3"
          opacity="0.7"
        />
      )}
      <circle cx={LOCATOR_C} cy={LOCATOR_C} r={LOCATOR_R} fill="none" stroke="#2b2620" strokeWidth="2" />
      {/* 站点 */}
      <circle cx={p.x} cy={p.y} r="6.2" fill="none" stroke={FEATURE_COLORS[feature.kind]} strokeWidth="1.6" />
      <circle cx={p.x} cy={p.y} r="3" fill={FEATURE_COLORS[feature.kind]} stroke="#2b2620" strokeWidth="1" />
      {/* 十字准线 */}
      <g stroke={FEATURE_COLORS[feature.kind]} strokeWidth="1" opacity="0.85">
        <line x1={p.x - 13} y1={p.y} x2={p.x - 8} y2={p.y} />
        <line x1={p.x + 8} y1={p.y} x2={p.x + 13} y2={p.y} />
        <line x1={p.x} y1={p.y - 13} x2={p.x} y2={p.y - 8} />
        <line x1={p.x} y1={p.y + 8} x2={p.x} y2={p.y + 13} />
      </g>
      <text className="site-locator-n" x={LOCATOR_C} y="9">
        北
      </text>
    </svg>
  );
}

export default function SiteDialog({ feature, onClose, onLocate }: Props) {
  const detail = siteDetailOf(feature);
  const far = !!feature.far;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tone = FEATURE_COLORS[feature.kind];

  return (
    <div className="site-modal" role="dialog" aria-modal="true" aria-label={`${feature.name}介绍`}>
      {/* 背板：半透明，让后面的三维月球仍然隐约可见 */}
      <div className="site-modal-backdrop" onClick={onClose} />
      <div className="site-card">
        <header className="site-card-head" style={{ borderTopColor: tone }}>
          <span className="site-badge" style={{ background: tone }}>
            {FEATURE_KIND_NAMES[feature.kind]}
          </span>
          <h3 className="site-title">{feature.name}</h3>
          <span className="site-en">{feature.en}</span>
          <button className="site-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        {/* 真实照片。v1.1.0 起这里是航天任务的实拍照片，不再是我们画的矢量插图 ——
            图注写在照片下沿的渐变条上（不占额外高度），拍摄方单独一行便于学生溯源。 */}
        <figure className="site-photo">
          <img src={detail.photo.src} alt={`${feature.name}的实拍照片`} />
          <figcaption>
            <span className="site-photo-caption">{detail.photo.caption}</span>
            <span className="site-photo-credit">图 · {detail.photo.credit}</span>
          </figcaption>
        </figure>

        <div className="site-card-body">
          {feature.mission && <p className="site-mission">任务 · {feature.mission}</p>}
          <p className="site-tagline">{detail.tagline}</p>
          <p className="site-body">{detail.body}</p>

          <div className="site-grid">
            <div className="site-grid-left">
              <LocatorDisc feature={feature} far={far} />
              <p className="site-locator-cap">
                {far ? "从月球背面看" : "从地球看（北在上）"}
              </p>
            </div>
            <div className="site-grid-right">
              <dl className="site-facts">
                <div className="site-fact">
                  <dt>经纬度</dt>
                  <dd>
                    {formatLat(feature.lat)} / {formatLon(feature.lon)}
                  </dd>
                </div>
                <div className="site-fact">
                  <dt>朝向</dt>
                  <dd className={far ? "is-far" : "is-near"}>
                    {far ? "月球背面 —— 从地球永远看不到" : "月球正面 —— 地球可见"}
                  </dd>
                </div>
                {detail.facts.map((f) => (
                  <div className="site-fact" key={f.label}>
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>

        <footer className="site-card-foot">
          <span className="site-foot-hint">主镜头已经对准这里了，关掉弹窗就能看到它落在月盘正中</span>
          <button className="site-btn is-primary" onClick={() => onLocate(feature)}>
            去三维视图看看
          </button>
          <button className="site-btn" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}
