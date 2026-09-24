# -*- coding: utf-8 -*-
"""检测教材图的面板矩形（靠浅蓝边框），再定位每个面板里的图例符号。

之前用肉眼读的显示坐标有系统偏差，导致 国界/港口 等框打偏。
边框颜色是可判别的浅蓝，直接按"整行/整列大量像素接近该颜色"来定面板，没有偏差来源。
"""
import os, io, json
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = (r"D:\Users\Administrator\Documents\Tencent Files\Tencent Files\2605948957"
       r"\nt_qq\nt_data\Pic\2026-09\Ori\650e35ec2f30f2bf11e04aefea9955f4.jpg")


def main():
    im = Image.open(SRC).convert("RGB")
    a = np.asarray(im).astype(np.int16)
    H, W = a.shape[:2]
    print("图", W, "x", H)

    # 取样边框色：面板边框是浅蓝，取几个已知边框上的点
    # 先找"偏蓝且不算白"的像素
    blue = (a[:, :, 2] - a[:, :, 0] > 25) & (a[:, :, 2] > 150) & (a[:, :, 2] < 250) & (a[:, :, 0] < 200)
    print("偏蓝像素占比 %.2f%%" % (blue.mean() * 100))

    rows = blue[:, 100:1740].sum(axis=1)
    cols = blue[60:1080, :].sum(axis=0)
    RT = (1740 - 100) * 0.45
    CT = (1080 - 60) * 0.35
    rlines = [i for i in range(H) if rows[i] > RT]
    clines = [i for i in range(W) if cols[i] > CT]

    def merge(v, gap=6):
        out = []
        for x in v:
            if out and x - out[-1][-1] <= gap:
                out[-1].append(x)
            else:
                out.append([x])
        return [int(np.mean(g)) for g in out]

    rl, cl = merge(rlines), merge(clines)
    print("水平边框 y:", rl)
    print("垂直边框 x:", cl)

    # 面板 = 相邻边框对
    panels = []
    for i in range(len(rl) - 1):
        for j in range(len(cl) - 1):
            y0, y1 = rl[i], rl[i + 1]
            x0, x1 = cl[j], cl[j + 1]
            if y1 - y0 < 60 or x1 - x0 < 150:
                continue
            panels.append([x0, y0, x1, y1])
    print("面板数:", len(panels))
    for p in panels:
        print("  ", p, "%dx%d" % (p[2] - p[0], p[3] - p[1]))

    im2 = im.copy()
    from PIL import ImageDraw
    d = ImageDraw.Draw(im2)
    for p in panels:
        d.rectangle(p, outline=(255, 0, 0))
    im2.save(os.path.join(HERE, "panels.png"))
    json.dump(panels, io.open(os.path.join(HERE, "panels.json"), "w"))


if __name__ == "__main__":
    main()
