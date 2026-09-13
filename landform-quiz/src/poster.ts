/**
 * 结果长图（竖版）渲染器 —— 纯 Canvas 原生绘制，不引入任何第三方库，
 * 保证离线打开也能导出，也避免为了一个功能给站点加几十 KB 依赖。
 *
 * 所有颜色取自 styles.css 的 :root，版式沿用本游戏的粗野派语言：
 * 直角、粗墨边、硬投影（无渐变、无圆角、无柔光）。
 *
 * 用法：
 *   const canvas = await renderPoster({ landform, score, vector, dims, similar, china, world });
 *   const url = await canvasToObjectUrl(canvas);
 */

import { BRAND, BRAND_LINE } from "./brand";
import { assetUrl, makeProjector } from "./logic";
import type {
  ChinaMap,
  Dimension,
  Landform,
  Profile,
  ScoredLandform,
  WorldMap
} from "./types";

/* ---------------------------- 配色（与 styles.css 保持一致） ---------------------------- */

const INK = "#241f18";
const INK_SOFT = "#5f5445";
const INK_FAINT = "#8b7f6e";
const PAPER = "#f5eee0";
const PAPER2 = "#fffbf3";
const LINE = "#ddcfb3";
const LINE_SOFT = "#ece1cb";
const OCHRE = "#b8791f";
const OCHRE_SOFT = "#e8cd93";
const CINNABAR = "#bd3b2d";
const JADE = "#33756a";
const MAP_BG = "#e6eef2";
/** 墨底上的浅色文字 */
const ON_INK = "#d9cdb6";

/* ---------------------------- 字体 ---------------------------- */

const F_DISPLAY = '"Arial Black","Microsoft YaHei","PingFang SC",sans-serif';
const F_BODY = '"Microsoft YaHei","PingFang SC","Hiragino Sans GB",sans-serif';
/**
 * 写进 SVG 属性时**必须用单引号**：双引号会提前闭合 font-family="..." 这个属性，
 * 让整段 SVG 变成非法 XML，图片加载直接失败（地图就是因此整段消失过）。
 */
const F_SVG = "'Microsoft YaHei','PingFang SC','Hiragino Sans GB',sans-serif";
const disp = (px: number) => `900 ${px}px ${F_DISPLAY}`;
const body = (px: number, weight = 400) => `${weight} ${px}px ${F_BODY}`;

/* ---------------------------- 画布骨架 ---------------------------- */

const W = 1080;
const PAD = 56;
const CW = W - PAD * 2; // 968
const MAX_H = 7200; // 先画在长画布上，最后按实际内容裁掉

/* ---------------------------- 基础绘制工具 ---------------------------- */

interface PanelOpt {
  fill?: string;
  border?: number;
  shadow?: number;
  stroke?: string;
}

/** 直角面板 + 粗墨边 + 硬投影（粗野派的标准块） */
function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  { fill = PAPER2, border = 4, shadow = 10, stroke = INK }: PanelOpt = {}
) {
  if (shadow) {
    ctx.fillStyle = stroke;
    ctx.fillRect(x + shadow, y + shadow, w, h);
  }
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  if (border) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = border;
    ctx.strokeRect(x + border / 2, y + border / 2, w - border, h - border);
  }
}

/** 按字符折行（中文逐字断行即可；英文单词会被拆断，但本游戏正文字段以中文为主） */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    if (ch === "\n") {
      lines.push(line);
      line = "";
      continue;
    }
    const probe = line + ch;
    if (line && ctx.measureText(probe).width > maxW) {
      lines.push(line);
      line = ch;
    } else {
      line = probe;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** 画一段自动折行的文字，返回结束后的 y */
function para(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lh: number,
  align: CanvasTextAlign = "left"
): number {
  const lines = wrap(ctx, text, maxW);
  ctx.textAlign = align;
  const ax = align === "center" ? x + maxW / 2 : align === "right" ? x + maxW : x;
  lines.forEach((ln, i) => ctx.fillText(ln, ax, y + i * lh));
  ctx.textAlign = "left";
  return y + lines.length * lh;
}

/** 章节标题：墨色小方块 + 文字 + 一条分隔线 */
function sectionTitle(ctx: CanvasRenderingContext2D, title: string, y: number): number {
  ctx.fillStyle = CINNABAR;
  ctx.fillRect(PAD, y + 6, 14, 30);
  ctx.fillStyle = INK;
  ctx.font = body(32, 800);
  ctx.textBaseline = "top";
  ctx.fillText(title, PAD + 26, y);
  const lineY = y + 52;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PAD, lineY);
  ctx.lineTo(PAD + CW, lineY);
  ctx.stroke();
  return lineY + 24;
}

/** 居中裁切绘制（cover 语义） */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const ir = img.naturalWidth / img.naturalHeight;
  const tr = w / h;
  let sw: number, sh: number, sx: number, sy: number;
  if (ir > tr) {
    sh = img.naturalHeight;
    sw = sh * tr;
    sx = (img.naturalWidth - sw) / 2;
    sy = 0;
  } else {
    sw = img.naturalWidth;
    sh = sw / tr;
    sx = 0;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

/** 等比缩放绘制（contain 语义），返回实际绘制尺寸 */
function drawContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  maxW: number,
  maxH: number
): { w: number; h: number } {
  const r = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
  const w = img.naturalWidth * r;
  const h = img.naturalHeight * r;
  ctx.drawImage(img, x + (maxW - w) / 2, y + (maxH - h) / 2, w, h);
  return { w, h };
}

/* ---------------------------- 资源加载 ---------------------------- */

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`图片加载失败：${src}`));
    im.src = src;
  });
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] as string
  );
}

/**
 * 把地图画成独立 SVG 字符串再转成图片。
 * 注意：独立 SVG 里没有外部样式表，所有填充/描边都要内联；
 * 且必须带 vector-effect="non-scaling-stroke"，否则世界图 viewBox 宽达 6315，
 * 0.7 单位的线宽缩到屏幕上等于不可见。
 */
function buildMapSvg(
  landform: Landform,
  china: ChinaMap | null,
  world: WorldMap | null
): string | null {
  const isDomestic = landform.category === "domestic";
  const map = isDomestic ? china : world;
  if (!map) return null;

  const [vbx, vby, vbw, vbh] = map.meta.viewBox;
  const proj = makeProjector(map.meta);
  const [mx, my] = proj(landform.lat, landform.lon);
  const px = mx - vbx;
  const py = my - vby;

  const stroke = (px_: number) => `vector-effect="non-scaling-stroke" stroke-width="${px_}"`;

  let paths = "";
  if (isDomestic && china) {
    paths = [
      `<path d="${china.outline}" fill="#f0e4c9" stroke="#9a763a" ${stroke(1.4)} stroke-linejoin="round"/>`,
      `<path d="${china.provinces}" fill="none" stroke="#c9b087" ${stroke(0.8)} stroke-linejoin="round"/>`,
      `<path d="${china.nineDash}" fill="${CINNABAR}" stroke="${CINNABAR}" ${stroke(1)} stroke-linecap="round"/>`
    ].join("");
  } else if (world) {
    paths = [
      `<path d="${world.land}" fill="#e9dcc0" stroke="#b8a37c" ${stroke(0.9)} stroke-linejoin="round"/>`,
      `<path d="${world.china}" fill="#e5b271" stroke="#a8762a" ${stroke(1.1)} stroke-linejoin="round"/>`
    ].join("");
  }

  // 世界图上标出「中国」，与页面内的做法一致
  let cnLabel = "";
  if (!isDomestic && world) {
    const p2 = makeProjector(world.meta);
    const [cx, cy] = p2(36, 103);
    cnLabel =
      `<text x="${cx - vbx}" y="${cy - vby}" font-size="${vbw * 0.016}" font-family="${F_SVG}" ` +
      `font-weight="700" fill="${INK}" text-anchor="middle" dominant-baseline="central" ` +
      `stroke="${PAPER2}" stroke-width="${vbw * 0.004}" paint-order="stroke">中国</text>`;
  }

  const r = vbw * 0.02;
  const atEnd = px / vbw > 0.62;
  const labelX = atEnd ? px - r * 2.2 : px + r * 2.2;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbx} ${vby} ${vbw} ${vbh}" preserveAspectRatio="xMidYMid meet">` +
    `<rect x="${vbx}" y="${vby}" width="${vbw}" height="${vbh}" fill="${MAP_BG}"/>` +
    paths +
    cnLabel +
    `<circle cx="${px}" cy="${py}" r="${r * 2}" fill="#ffffff" opacity="0.92"/>` +
    `<circle cx="${px}" cy="${py}" r="${r}" fill="${CINNABAR}" stroke="${INK}" stroke-width="${r * 0.45}"/>` +
    `<text x="${labelX}" y="${py}" font-size="${vbw * 0.017}" font-family="${F_SVG}" font-weight="800" ` +
    `fill="${INK}" text-anchor="${atEnd ? "end" : "start"}" dominant-baseline="central" ` +
    `stroke="${PAPER2}" stroke-width="${vbw * 0.004}" paint-order="stroke">${escapeXml(landform.name)}</text>` +
    `</svg>`
  );
}

/**
 * 加载 SVG 并验证它不会污染画布。
 * 一旦污染，后面的 canvas.toBlob() 会抛 SecurityError 导致整张长图导不出来 ——
 * 所以这里先在一张 2x2 的临时画布上试画并 getImageData，不通过就返回 null，
 * 宁可少一张小地图，也不能让导出整体失败。
 */
async function loadSvgSafely(svg: string): Promise<HTMLImageElement | null> {
  try {
    const img = await loadImg("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
    const c = document.createElement("canvas");
    c.width = 2;
    c.height = 2;
    const cc = c.getContext("2d");
    if (!cc) return null;
    cc.drawImage(img, 0, 0, 2, 2);
    cc.getImageData(0, 0, 1, 1); // 污染时抛 SecurityError
    return img;
  } catch {
    return null;
  }
}

/* ---------------------------- 主流程 ---------------------------- */

export interface PosterInput {
  landform: Landform;
  score: number;
  vector: Profile;
  dims: Dimension[];
  similar: ScoredLandform[];
  china: ChinaMap | null;
  world: WorldMap | null;
  studentName?: string;
}

export async function renderPoster(input: PosterInput): Promise<HTMLCanvasElement> {
  const { landform, score, vector, dims, similar, china, world, studentName } = input;

  const scratch = document.createElement("canvas");
  scratch.width = W;
  scratch.height = MAX_H;
  const ctx = scratch.getContext("2d");
  if (!ctx) throw new Error("当前浏览器不支持 Canvas");

  ctx.textBaseline = "top";
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, MAX_H);

  const isDomestic = landform.category === "domestic";
  const map = isDomestic ? china : world;

  // 资源并行加载；除主照片外都允许失败（失败就不画那一段，不影响整张图）
  const [photoR, qrR, mapImgR, simR] = await Promise.all([
    loadImg(assetUrl(landform.photo)).then((v) => v).catch(() => null),
    loadImg(assetUrl(BRAND.qr)).catch(() => null),
    (() => {
      const svg = buildMapSvg(landform, china, world);
      return svg ? loadSvgSafely(svg) : Promise.resolve(null);
    })(),
    Promise.allSettled(similar.map((s) => loadImg(assetUrl(s.landform.photo))))
  ]);

  const photo = photoR;
  const qr = qrR;
  const mapImg = mapImgR;
  const simImgs = simR.map((r) => (r.status === "fulfilled" ? r.value : null));

  let y = 0;

  /* ---------- 1. 顶部墨色标题带 ---------- */
  const HEAD_H = 176;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, HEAD_H);
  ctx.fillStyle = CINNABAR;
  ctx.fillRect(0, HEAD_H, W, 10);

  ctx.fillStyle = PAPER;
  ctx.font = disp(56);
  ctx.fillText(BRAND.game, PAD, 44);

  ctx.fillStyle = OCHRE_SOFT;
  ctx.font = body(26, 700);
  ctx.fillText(BRAND.tagline, PAD, 118);

  ctx.textAlign = "right";
  ctx.fillStyle = ON_INK;
  ctx.font = body(24, 700);
  ctx.fillText(`${BRAND.maker} 出品`, W - PAD, 62);
  ctx.font = body(22);
  ctx.fillText(BRAND_LINE, W - PAD, 100);
  ctx.textAlign = "left";
  y = HEAD_H + 10 + 44;

  /* ---------- 2. 主信息卡：匹配度 + 名称 ---------- */
  const HERO_H = 300;
  panel(ctx, PAD, y, CW, HERO_H);

  ctx.fillStyle = CINNABAR;
  ctx.font = disp(150);
  ctx.fillText(`${score}`, PAD + 40, y + 58);
  const scoreW = ctx.measureText(`${score}`).width;
  ctx.fillStyle = INK_SOFT;
  ctx.font = body(40, 800);
  ctx.fillText("%", PAD + 46 + scoreW, y + 124);
  ctx.font = body(24, 700);
  ctx.fillStyle = INK_FAINT;
  ctx.fillText("与你的人格匹配度", PAD + 40, y + 224);

  // 右侧：名称 + 英文 + 标签
  const rx = PAD + 460;
  const rw = CW - 460 - 40;
  ctx.fillStyle = INK;
  ctx.font = disp(76);
  const nameLines = wrap(ctx, landform.name, rw);
  nameLines.slice(0, 2).forEach((ln, i) => ctx.fillText(ln, rx, y + 46 + i * 86));

  let ry = y + 46 + nameLines.slice(0, 2).length * 86 + 4;
  ctx.fillStyle = INK_SOFT;
  ctx.font = body(26, 700);
  ctx.fillText(landform.en, rx, ry);
  ry += 44;
  ctx.fillStyle = INK_SOFT;
  ctx.font = body(26);
  ctx.fillText(`${landform.country} · ${landform.region}`, rx, ry);

  // 标签
  ry += 50;
  const chips = [isDomestic ? "中国地貌" : "国外地貌", landform.type];
  let chipX = rx;
  chips.forEach((label) => {
    ctx.font = body(24, 800);
    const cw = ctx.measureText(label).width + 34;
    ctx.fillStyle = INK;
    ctx.fillRect(chipX + 5, ry + 5, cw, 48);
    ctx.fillStyle = isDomestic ? OCHRE_SOFT : JADE;
    ctx.fillRect(chipX, ry, cw, 48);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.strokeRect(chipX + 1.5, ry + 1.5, cw - 3, 48 - 3);
    ctx.fillStyle = isDomestic ? INK : PAPER2;
    ctx.fillText(label, chipX + 17, ry + 11);
    chipX += cw + 14;
  });

  if (studentName) {
    ctx.fillStyle = INK_SOFT;
    ctx.font = body(24, 700);
    ctx.fillText(studentName, rx + 0, y + HERO_H - 46);
  }
  y += HERO_H + 44;

  /* ---------- 3. 地貌照片 ---------- */
  if (photo) {
    const ph = Math.round(CW * 0.625); // 16:10
    ctx.fillStyle = INK;
    ctx.fillRect(PAD + 10, y + 10, CW, ph);
    drawCover(ctx, photo, PAD, y, CW, ph);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.strokeRect(PAD + 2, y + 2, CW - 4, ph - 4);
    y += ph + 18;

    ctx.fillStyle = INK_SOFT;
    ctx.font = body(26);
    y = para(ctx, landform.summary, PAD, y, CW, 42);
    y += 16;
  }

  /* ---------- 4. 为什么说你像它 ---------- */
  y = sectionTitle(ctx, "为什么说你像它", y);
  ctx.fillStyle = INK;
  ctx.font = body(28);
  y = para(ctx, landform.personality, PAD, y, CW, 50);
  y += 40;

  /* ---------- 5. 人格五维 ---------- */
  y = sectionTitle(ctx, "你的人格五维", y);
  const BAR_H = 44;
  dims.forEach((d) => {
    const v = Math.max(0, Math.min(100, vector[d.key] ?? 50));
    const pole = v >= 50 ? d.highLabel : d.lowLabel;

    ctx.fillStyle = INK;
    ctx.font = body(30, 800);
    ctx.fillText(d.name, PAD, y);
    ctx.textAlign = "right";
    ctx.fillStyle = INK_SOFT;
    ctx.font = body(26, 700);
    ctx.fillText(`偏「${pole}」· ${v}`, PAD + CW, y + 2);
    ctx.textAlign = "left";
    y += 46;

    // 轨道
    ctx.fillStyle = LINE_SOFT;
    ctx.fillRect(PAD, y, CW, BAR_H);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.strokeRect(PAD + 1.5, y + 1.5, CW - 3, BAR_H - 3);
    // 中线
    ctx.fillStyle = LINE;
    ctx.fillRect(PAD + CW / 2 - 1.5, y + 3, 3, BAR_H - 6);
    // 白色衬底 + 朱红方块指针（与页面 .bar-dot 一致：直角 + 墨边）
    // 指针中心在轨道内留出半个指针的余量，否则 0%/100% 时会有一半探出轨道外
    const INSET = 15;
    const dx = PAD + INSET + ((CW - INSET * 2) * v) / 100;
    const cy = y + BAR_H / 2;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(dx - 21, cy - 21, 42, 42);
    ctx.fillStyle = CINNABAR;
    ctx.fillRect(dx - 15, cy - 15, 30, 30);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.strokeRect(dx - 13.5, cy - 13.5, 27, 27);
    y += BAR_H + 8;

    ctx.fillStyle = INK_FAINT;
    ctx.font = body(22, 700);
    ctx.fillText(d.lowLabel, PAD, y);
    ctx.textAlign = "right";
    ctx.fillText(d.highLabel, PAD + CW, y);
    ctx.textAlign = "left";
    y += 34;
  });
  y += 26;

  /* ---------- 6. 位置示意图 ---------- */
  if (mapImg && map) {
    y = sectionTitle(ctx, "它在哪儿", y);
    const maxW = 620;
    const maxH = 720;
    const bh = Math.min(maxH, (maxW * map.meta.viewBox[3]) / map.meta.viewBox[2]);
    const bw = (bh * map.meta.viewBox[2]) / map.meta.viewBox[3];
    const bx = PAD + (CW - bw) / 2;
    ctx.fillStyle = INK;
    ctx.fillRect(bx + 10, y + 10, bw, bh);
    ctx.fillStyle = MAP_BG;
    ctx.fillRect(bx, y, bw, bh);
    drawContain(ctx, mapImg, bx, y, bw, bh);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.strokeRect(bx + 2, y + 2, bw - 4, bh - 4);
    y += bh + 18;

    ctx.fillStyle = CINNABAR;
    ctx.font = body(24, 800);
    ctx.fillText("红点", PAD, y);
    ctx.fillStyle = INK_SOFT;
    ctx.font = body(24, 700);
    const coord =
      (landform.lat >= 0 ? `北纬 ${landform.lat.toFixed(2)}°` : `南纬 ${Math.abs(landform.lat).toFixed(2)}°`) +
      " · " +
      (landform.lon >= 0 ? `东经 ${landform.lon.toFixed(2)}°` : `西经 ${Math.abs(landform.lon).toFixed(2)}°`);
    ctx.fillText("即该地貌所在位置", PAD + 62, y);
    ctx.textAlign = "right";
    ctx.fillStyle = INK_FAINT;
    ctx.font = body(22, 700);
    ctx.fillText(coord, PAD + CW, y + 2);
    ctx.textAlign = "left";
    y += 50;
  }

  /* ---------- 7. 主要特点 ---------- */
  y = sectionTitle(ctx, "主要特点", y);
  ctx.font = body(28);
  landform.traits.forEach((t) => {
    ctx.fillStyle = OCHRE;
    ctx.fillRect(PAD, y + 14, 16, 16);
    ctx.fillStyle = INK;
    y = para(ctx, t, PAD + 34, y, CW - 34, 44) + 8;
  });
  y += 34;

  /* ---------- 8. 和它相近的地貌 ---------- */
  const shown = similar.slice(0, 3);
  if (shown.length) {
    y = sectionTitle(ctx, "性格相近的地貌", y);
    const GAP = 24;
    const cw = (CW - GAP * (shown.length - 1)) / shown.length;
    const ch = Math.round(cw * 0.66);
    shown.forEach((s, i) => {
      const x = PAD + i * (cw + GAP);
      const im = simImgs[i];
      ctx.fillStyle = INK;
      ctx.fillRect(x + 8, y + 8, cw, ch);
      if (im) {
        drawCover(ctx, im, x, y, cw, ch);
      } else {
        ctx.fillStyle = LINE_SOFT;
        ctx.fillRect(x, y, cw, ch);
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4;
      ctx.strokeRect(x + 2, y + 2, cw - 4, ch - 4);

      ctx.fillStyle = INK;
      ctx.font = body(28, 800);
      ctx.fillText(s.landform.name, x, y + ch + 16);
      ctx.fillStyle = INK_FAINT;
      ctx.font = body(22, 700);
      ctx.fillText(`${s.landform.type} · ${s.score}%`, x, y + ch + 56);
    });
    y += ch + 100;
  }

  /* ---------- 9. 页脚：制作者 + 二维码 + 版权 ---------- */
  y += 10;
  const QR = 236;
  const inner = 34;
  const rightH = 214;
  const bodyH = Math.max(QR, rightH);
  const noticeLH = 32;
  ctx.font = body(20);
  const noticeH = wrap(ctx, BRAND.notice, CW - inner * 2).length * noticeLH;
  // 面板高度必须把「主体 + 分隔线 + 数据说明 + 上下内边距」全部算进去，
  // 否则说明文字会跑到墨色面板外面、并被长图底边裁掉。
  const footH = inner + bodyH + 40 + noticeH + inner;
  panel(ctx, PAD, y, CW, footH, { fill: INK, stroke: INK, shadow: 10 });

  // 二维码卡片
  const qx = PAD + inner;
  const qy = y + inner;
  ctx.fillStyle = PAPER2;
  ctx.fillRect(qx, qy, QR, QR);
  if (qr) {
    const pad = 14;
    ctx.drawImage(qr, qx + pad, qy + pad, QR - pad * 2, QR - pad * 2);
  }
  ctx.strokeStyle = OCHRE_SOFT;
  ctx.lineWidth = 3;
  ctx.strokeRect(qx + 1.5, qy + 1.5, QR - 3, QR - 3);

  // 制作者文字
  let ty = y + inner + 6;
  const tx = qx + QR + 40;
  ctx.fillStyle = PAPER;
  ctx.font = disp(46);
  ctx.fillText(`制作者：${BRAND.maker}`, tx, ty);
  ty += 68;
  ctx.fillStyle = OCHRE_SOFT;
  ctx.font = body(28, 800);
  ctx.fillText(`小红书号：${BRAND.xiaohongshu}`, tx, ty);
  ty += 46;
  ctx.fillStyle = ON_INK;
  ctx.font = body(26);
  ctx.fillText("扫码在小红书找到我们", tx, ty);
  ty += 52;
  ctx.fillStyle = PAPER;
  ctx.font = body(28, 800);
  ctx.fillText(BRAND_LINE, tx, ty);

  // 分隔线 + 数据说明（横跨面板整宽）
  const divY = y + inner + bodyH + 20;
  ctx.strokeStyle = "#4a4136";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(qx, divY);
  ctx.lineTo(PAD + CW - inner, divY);
  ctx.stroke();
  ctx.fillStyle = "#a2937b";
  ctx.font = body(20);
  para(ctx, BRAND.notice, qx, divY + 20, CW - inner * 2, noticeLH);

  y += footH + 40;

  /* ---------- 裁剪到实际内容高度 ---------- */
  const H = Math.ceil(y);
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("当前浏览器不支持 Canvas");
  octx.drawImage(scratch, 0, 0, W, H, 0, 0, W, H);

  // 最终外框，让整张图有收边
  octx.strokeStyle = INK;
  octx.lineWidth = 8;
  octx.strokeRect(4, 4, W - 8, H - 8);

  return out;
}

/** 导出为可下载的 blob URL */
export function canvasToObjectUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("长图生成失败：无法编码图片"));
          return;
        }
        resolve(URL.createObjectURL(blob));
      }, "image/png");
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** 建议的下载文件名 */
export function posterFilename(landform: Landform): string {
  return `${BRAND.game}-${landform.name}.png`;
}
