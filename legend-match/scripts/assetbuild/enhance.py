# -*- coding: utf-8 -*-
"""抠图增强：把裁片从"JPEG+纸底"重建成"净色块 + 平滑边缘"。

为什么必须这么做：
  直接双线性放大 = 把纸纹、JPEG 振铃、灰阶晕一起放大 ⇒ 糊。
  正确做法：先量化到少数几个调色板色（去噪），再按"到调色板色的距离"重算 alpha
  （边缘因此是平滑的而不是插值糊的），最后用符号本色重新上色 ⇒ 清晰。

本脚本还负责"色盲"修正：之前的灰度阈值漏掉了粉/蓝/绿等浅色符号。
"""
import os, io, json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = (r"D:\Users\Administrator\Documents\Tencent Files\Tencent Files\2605948957"
       r"\nt_qq\nt_data\Pic\2026-09\Ori\650e35ec2f30f2bf11e04aefea9955f4.jpg")


def detect_boxes():
    """彩色感知的符号定位。

    面板矩形由 `panels.py` 检测浅蓝边框得到（12 个面板，每个 = 地图色块 | 符号列），
    这里只需要在**符号列**里分行，再切分"符号 vs 名称文字"。

    切分判据（比"最大间隙"可靠）：汉字字形几乎占满整行高度，而图例符号都比行高矮得多
      ⇒ 从行首墨块起，只要"高度 < 0.85×行高"就继续算作符号，遇到第一个"占满行高"的墨块就停。
      行首墨块本身就占满行高时（如"机场"的圈机图标），退化为只取首个墨块。
    """
    im = Image.open(SRC).convert("RGB")
    a = np.asarray(im).astype(np.int16)
    ink = np.abs(255 - a).max(axis=2) > 42
    out = []
    for (x0, y0, x1, y1) in SYMBOL_COLUMNS:
        sub = ink[y0 + 5:y1 - 5, x0 + 5:x1 - 5]
        if not sub.any():
            continue
        rows = np.where(sub.any(axis=1))[0]
        segs = []
        start = prev = rows[0]
        for r in rows[1:]:
            if r - prev > 5:
                segs.append((start, prev)); start = r
            prev = r
        segs.append((start, prev))
        for (r0, r1) in segs:
            band = sub[r0:r1 + 1]
            bh = r1 - r0 + 1
            if bh < 5:
                continue
            cols = np.where(band.any(axis=0))[0]
            if len(cols) == 0:
                continue
            csegs = []
            cs = cp = cols[0]
            for c in cols[1:]:
                if c - cp > 3:
                    csegs.append((cs, cp)); cs = c
                cp = c
            csegs.append((cs, cp))
            keep = []
            for i, (c0, c1) in enumerate(csegs):
                col = band[:, c0:c1 + 1]
                rws = np.where(col.any(axis=1))[0]
                ch = (rws[-1] - rws[0] + 1) if len(rws) else 0
                if i > 0:
                    if c0 - csegs[i - 1][1] > 16:   # 与上一墨块断开 ⇒ 符号结束
                        break
                    if ch >= 0.85 * bh:             # 占满行高 ⇒ 是名称文字
                        break
                keep.append((c0, c1))
                if i == 0 and ch >= 0.85 * bh:      # 行首就是满高 ⇒ 只取这一个
                    break
            bx0 = x0 + 5 + min(k[0] for k in keep)
            bx1 = x0 + 5 + max(k[1] for k in keep) + 1
            by0 = y0 + 5 + r0
            by1 = y0 + 5 + r1 + 1
            if bx1 - bx0 >= 8 and by1 - by0 >= 4:
                out.append([int(bx0), int(by0), int(bx1), int(by1)])
    return out


# 12 个面板的**右侧符号列**（由 panels.py 检测浅蓝边框得到，无肉眼偏差）
SYMBOL_COLUMNS = [
    (307, 65, 664, 272), (869, 65, 1227, 272), (1428, 65, 1785, 272),
    (307, 290, 664, 498), (869, 290, 1227, 498), (1428, 290, 1785, 498),
    (307, 516, 664, 724), (869, 516, 1227, 724), (1428, 516, 1785, 724),
    (307, 742, 664, 950), (869, 742, 1227, 950), (1428, 742, 1785, 950),
]


# ---------------------------------------------------------------- 增强

def otsu(values):
    """Otsu 阈值（对"背景 vs 墨"这种双峰分布很稳）。values 为 0~255 的浮点数组。"""
    v = np.clip(values, 0, 255).astype(np.uint8)
    hist = np.bincount(v.ravel(), minlength=256).astype(np.float64)
    total = hist.sum()
    if total <= 0:
        return 0.0
    omega = np.cumsum(hist) / total
    mu = np.cumsum(hist * np.arange(256)) / total
    mu_t = mu[-1]
    denom = omega * (1.0 - omega)
    denom[denom <= 1e-12] = 1e-12
    sigma_b = (mu_t * omega - mu) ** 2 / denom
    return float(np.argmax(sigma_b))


def enhance(img, upscale=8, ncolors=6):
    """把裁片重建成"净色块 + 平滑边缘"的 RGBA。

    为什么不用"对每个调色板色算软 alpha"（写错过）：
      细线符号的裁片里 90% 是背景，浅色调色板色与纸底只差十几个灰阶，
      软距离判决会给整片背景一个中等 alpha，再经对比拉伸 ⇒ **整块变实色方块**。

    正确做法：
      ① 先把"到背景色的距离 d"算出来，用 **Otsu** 在 d 上取阈值 —— 这才是
         "墨 / 非墨"的分界，与符号是细线还是实心块无关；
      ② 阈值上下取一条窄过渡带得到 alpha（这就是抗锯齿边缘）；
      ③ 颜色不做混合，直接取**最近的深色调色板色**（硬分配）⇒ 线条不会被稀释。
    另：输出保持裁片自身宽高比，缩放交给 fit_square —— 直接 resize((size,size))
    会把圆点压成椭圆。
    """
    big = img.resize((img.width * upscale, img.height * upscale), Image.LANCZOS)
    arr = np.asarray(big).astype(np.float32)

    corners = np.concatenate([
        arr[:6, :6].reshape(-1, 3), arr[:6, -6:].reshape(-1, 3),
        arr[-6:, :6].reshape(-1, 3), arr[-6:, -6:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)

    d = np.linalg.norm(arr - bg, axis=2)
    thr = max(otsu(d), 12.0)
    lo, hi = thr * 0.55, thr * 1.45
    alpha = np.clip((d - lo) / max(hi - lo, 1e-6), 0.0, 1.0)

    q = big.quantize(colors=ncolors, method=Image.MEDIANCUT, dither=Image.NONE).convert("RGB")
    pal = np.unique(np.asarray(q).reshape(-1, 3).astype(np.float32), axis=0)
    fg = [c for c in pal if np.linalg.norm(c - bg) > thr * 0.8]
    if not fg:                                   # 退化：用墨区中位色兜底
        ink = arr[d > thr]
        if len(ink) == 0:
            return Image.new("RGBA", big.size, (0, 0, 0, 0))
        fg = [np.median(ink, axis=0)]
    fg.sort(key=lambda c: float(c.sum()))        # 浅 → 深，深色 wins

    dists = np.stack([np.linalg.norm(arr - c, axis=2) for c in fg], axis=0)
    lab = np.argmin(dists, axis=0)
    rgb = np.stack([fg[i] for i in range(len(fg))], axis=0)[lab]

    out = np.concatenate([np.clip(rgb, 0, 255), (alpha * 255.0)[..., None]], axis=2)
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def fit_square(img, size, pad=0.10):
    w, h = img.size
    inner = int(size * (1 - pad * 2))
    sc = inner / max(w, h)
    nw, nh = max(1, int(w * sc)), max(1, int(h * sc))
    r = img.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(r, ((size - nw) // 2, (size - nh) // 2), r)
    return canvas


if __name__ == "__main__":
    boxes = detect_boxes()
    print("检出 %d 个" % len(boxes))
    json.dump(boxes, io.open(os.path.join(HERE, "boxes_auto.json"), "w"), indent=1)
    im = Image.open(SRC).convert("RGB")
    d = ImageDraw.Draw(im)
    for b in boxes:
        d.rectangle(b, outline=(255, 0, 0))
    im.save(os.path.join(HERE, "detect2.png"))
    for b in boxes:
        print("  ", b, "%dx%d" % (b[2] - b[0], b[3] - b[1]))
