# -*- coding: utf-8 -*-
"""把教材图里的「常年河、湖」「时令河、湖」拆成"河"与"湖"两个符号。

这两个图例在教材上是一个组合符号（一条线末端扩成湖面），
但游戏里「常年河」与「湖泊」是两个独立图例 ⇒ 必须拆开，否则两张牌同图不可判定。

拆分判据：逐列统计 alpha 的**竖向跨度**。线段只有几个像素高，
湖面则高得多 ⇒ 跨度明显变大的连续列就是湖。
"""
import os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "crops_out")


def split(path_in, path_river, path_lake):
    im = Image.open(path_in).convert("RGBA")
    a = np.asarray(im)[:, :, 3] > 120
    H, W = a.shape
    span = np.zeros(W)
    for x in range(W):
        ys = np.where(a[:, x])[0]
        span[x] = (ys[-1] - ys[0] + 1) if len(ys) else 0
    nz = span[span > 0]
    if len(nz) == 0:
        raise RuntimeError("空图 %s" % path_in)
    med = float(np.median(nz))
    lake_cols = span > max(med * 2.2, med + 6)
    idx = np.where(lake_cols)[0]
    if len(idx) == 0:
        raise RuntimeError("没找到湖面 %s（中位跨度 %.1f）" % (path_in, med))
    # 取最长的连续段
    runs, s = [], idx[0]
    for i, x in enumerate(idx):
        if i and x - idx[i - 1] > 3:
            runs.append((s, idx[i - 1])); s = x
    runs.append((s, idx[-1]))
    lx0, lx1 = max(runs, key=lambda r: r[1] - r[0])
    pad = 3
    lx0 = max(0, lx0 - pad); lx1 = min(W - 1, lx1 + pad)

    # 湖：湖面列；河：湖面之前的线
    lake = im.crop((lx0, 0, lx1 + 1, H))
    river = im.crop((0, 0, max(1, lx0 - 2), H))
    for sub, p in ((lake, path_lake), (river, path_river)):
        sa = np.asarray(sub)[:, :, 3]
        ys, xs = np.where(sa > 8)
        sub = sub.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
        save_square(sub, p)
    print("%s -> 河 %s / 湖 %s (湖面列 %d-%d, 线高 %.1f)" %
          (os.path.basename(path_in), os.path.basename(path_river),
           os.path.basename(path_lake), lx0, lx1, med))


def save_square(im, path, size=320, pad=0.08):
    c = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sc = size * (1 - pad * 2) / max(im.width, im.height)
    r = im.resize((max(1, int(im.width * sc)), max(1, int(im.height * sc))), Image.LANCZOS)
    c.paste(r, ((size - r.width) // 2, (size - r.height) // 2), r)
    c.save(path)


if __name__ == "__main__":
    split(os.path.join(OUT, "crop_17.png"), os.path.join(OUT, "crop_17.png"),
          os.path.join(OUT, "crop_17b.png"))
    split(os.path.join(OUT, "crop_22.png"), os.path.join(OUT, "crop_22.png"),
          os.path.join(OUT, "crop_22b.png"))
