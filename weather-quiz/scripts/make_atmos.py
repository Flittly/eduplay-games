# -*- coding: utf-8 -*-
"""
make_atmos.py —— 大气受热过程 / 热力环流 / 逆温 类示意图
============================================================
面向人教版高中地理必修一「地球上的大气」与选择性必修一相关内容。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from svgkit import *  # noqa: F401,F403
from make_fronts import chip, ground, _tw  # 复用标签与地面画法

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public", "assets", "weather")


# ------------------------------------------------------------ 大气受热过程
def heat_process():
    W, H = 900, 620
    GY, TOP = 470, 170
    o = []
    o.append(rect(30, TOP, 840, GY - TOP, fill=SKY, op=0.15, stroke=None))
    o.append(line(30, TOP, 870, TOP, INK2, 2.4, dash="12 8", op=0.6))
    o.append(txt(862, TOP - 12, "大气上界", size=17, anchor="end", fill=INK2, w=700))
    o.append(sun(72, 96, 34, rays=8, ray_len=30, ray_wd=6))
    # 太阳短波辐射
    o.append(arrow(128, 132, 254, 458, color=GOLD, wd=7, head=17))
    o.append(chip(258, 226, "太阳短波辐射", size=19, fill="#f6eccd", color=BROWN))
    o.append(line(196, 220, 164, 222, INK2, 2.2, dash="6 6"))
    # 削弱作用
    o.append(arrow(312, 340, 400, 210, color=COLD, wd=6, head=15))
    o.append(chip(468, 178, "大气对太阳辐射的削弱作用", size=19,
                  fill="#e6eef6", color=COLD))
    # 地面辐射
    o.append(arrow(540, 460, 540, 274, color=BROWN, wd=7, head=17))
    o.append(chip(540, 248, "地面辐射（长波）", size=19, fill="#f1e0d3", color=BROWN))
    # 大气吸收
    o.append(chip(686, 342, "大气吸收大部分地面辐射", size=19, fill="#efe7d8"))
    # 大气逆辐射
    o.append(arrow(800, 316, 800, 456, color=RED, wd=7, head=17))
    o.append(chip(700, 292, "大气逆辐射", size=19, fill="#f4e2de", color=RED))
    # 射向宇宙空间
    o.append(arrow(648, 166, 648, 84, color=VIOLET, wd=6, head=15))
    o.append(chip(742, 72, "射向宇宙空间", size=18, fill="#e6e0f2", color=VIOLET))
    o.append(ground(GY, 30, 870))
    o.append(chip(214, 520, "地面吸收、增温", size=19, fill="#f1e0d3", color=BROWN))
    o.append(chip(520, 574, "大气逆辐射把热量还给地面，对地面起保温作用",
                  size=20, fill="#f4e2de", color=RED))
    o.append(txt(450, 42, "大气受热过程示意", size=27, fill=INK, w=900))
    o.append(txt(450, 552, "太阳短波辐射 → 地面吸收增温 → 地面长波辐射 → 大气吸收 → 大气逆辐射",
                 size=18, fill=INK2, w=700))
    return wrap(W, H, "".join(o))


# ------------------------------------------------------------ 削弱作用
def weakening():
    W, H = 930, 430
    o = []
    panels = [(16, "吸收"), (320, "反射"), (624, "散射")]
    for x, name in panels:
        o.append(rect(x, 66, 290, 300, fill=PAPER2, stroke=INK, wd=3))
        o.append(chip(x + 145, 108, name, size=23))
    # 吸收
    x = panels[0][0]
    o.append(txt(x + 145, 176, "臭氧吸收紫外线", size=19, fill=COLD, w=800))
    o.append(txt(x + 145, 210, "水汽、二氧化碳", size=19, fill=COLD, w=800))
    o.append(txt(x + 145, 240, "吸收红外线", size=19, fill=COLD, w=800))
    o.append(rect(x + 34, 268, 222, 24, fill=VIOLET, op=0.24, stroke=VIOLET, wd=2))
    o.append(txt(x + 145, 285, "大气层", size=15, fill=VIOLET, w=700))
    o.append(arrow(x + 52, 320, x + 226, 312, color=GOLD, wd=5))
    o.append(txt(x + 145, 348, "有选择性", size=18, fill=INK2, w=700))
    # 反射
    x = panels[1][0]
    o.append(cloud(x + 145, 196, 0.94))
    o.append(arrow(x + 40, 300, x + 116, 226, color=GOLD, wd=5))
    o.append(arrow(x + 176, 214, x + 250, 140, color=GOLD, wd=5))
    o.append(txt(x + 145, 336, "云层、尘埃反射", size=19, fill=COLD, w=800))
    o.append(txt(x + 145, 348, "无选择性", size=18, fill=INK2, w=700))
    # 散射
    x = panels[2][0]
    o.append(arrow(x + 34, 296, x + 124, 216, color=GOLD, wd=5))
    for ang in (200, 232, 264, 296, 328, 0):
        import math as _m
        a = _m.radians(ang)
        o.append(arrow(x + 145, 196, x + 145 + _m.cos(a) * 96,
                      196 - _m.sin(a) * 96, color=SKY, wd=4, head=11))
    o.append(circ(x + 145, 196, 13, fill=CLOUD, stroke=INK, wd=3))
    o.append(txt(x + 145, 336, "空气分子散射蓝紫光", size=19, fill=COLD, w=800))
    o.append(txt(x + 145, 358, "有选择性", size=18, fill=INK2, w=700))
    o.append(txt(W / 2, 38, "大气对太阳辐射的削弱作用", size=27, fill=INK, w=900))
    return wrap(W, H, "".join(o))


# ------------------------------------------------------------ 保温作用应用
def greenhouse():
    W, H = 900, 460
    o = []
    # 左：玻璃温室
    o.append(rect(24, 66, 412, 330, fill=PAPER2, stroke=INK, wd=3))
    o.append(pth("M78 300V182A114 60 0 0 1 382 182V300", stroke=COLD, wd=5))
    o.append(line(78, 300, 78, 336, COLD, 5))
    o.append(line(382, 300, 382, 336, COLD, 5))
    o.append(ground(336, 78, 382, h=16))
    o.append(sun(120, 116, 22, rays=8, ray_len=18, ray_wd=4))
    o.append(arrow(152, 138, 226, 318, color=GOLD, wd=5))
    o.append(arrow(268, 326, 268, 218, color=BROWN, wd=5))
    o.append(arrow(316, 226, 316, 322, color=RED, wd=5))
    o.append(chip(230, 366, "太阳短波辐射可进入，地面长波辐射被阻挡", size=17,
                  fill="#f1e0d3", color=BROWN))
    o.append(chip(230, 108, "玻璃温室", size=23))
    # 右：人造烟幕
    o.append(rect(464, 66, 412, 330, fill=PAPER2, stroke=INK, wd=3))
    o.append(ground(336, 520, 820, h=16))
    o.append(fog_lines(660, 168, n=4, w=286, gap=26, amp=9, color=INK2, wd=8))
    o.append(chip(660, 106, "人造烟幕", size=23))
    o.append(arrow(580, 326, 580, 230, color=BROWN, wd=5))
    o.append(arrow(742, 236, 742, 322, color=RED, wd=5))
    o.append(chip(660, 366, "烟幕增强大气逆辐射，减轻霜冻危害", size=17,
                  fill="#f4e2de", color=RED))
    o.append(txt(W / 2, 38, "大气保温作用的应用", size=27, fill=INK, w=900))
    o.append(txt(W / 2, 434, "二者都是通过增强大气逆辐射来保温", size=19,
                 fill=INK2, w=800))
    return wrap(W, H, "".join(o))


# ------------------------------------------------------------ 热力环流
def thermal_circulation():
    W, H = 900, 580
    GY = 448
    o = []
    o.append(ground(GY, 40, 860))
    # 环流圈
    o.append(arrow(250, 424, 250, 138, color=RED, wd=7, head=18))
    o.append(arrow(656, 152, 656, 428, color=COLD, wd=7, head=18))
    o.append(arrow(288, 128, 620, 128, color=VIOLET, wd=6, head=16))
    o.append(arrow(620, 418, 288, 418, color=VIOLET, wd=6, head=16))
    # 气压标记
    o.append(chip(150, 410, "低压", size=20, fill="#f4e2de", color=RED))
    o.append(chip(756, 410, "高压", size=20, fill="#e6eef6", color=COLD))
    o.append(chip(150, 150, "高压", size=20, fill="#e6eef6", color=COLD))
    o.append(chip(756, 150, "低压", size=20, fill="#f4e2de", color=RED))
    o.append(txt(452, 118, "高空", size=19, fill=INK2, w=800))
    o.append(txt(452, 442, "近地面", size=19, fill=INK2, w=800))
    # 冷热标记
    o.append(chip(250, 508, "受热", size=21, fill="#f4e2de", color=RED))
    o.append(chip(656, 508, "冷却", size=21, fill="#e6eef6", color=COLD))
    for dx in (-46, 0, 46):
        o.append(arrow(250 + dx, 472, 250 + dx, 492, color=RED, wd=4, head=10))
        o.append(arrow(656 + dx, 492, 656 + dx, 472, color=COLD, wd=4, head=10))
    o.append(txt(452, 44, "热力环流：地面冷热不均引起的大气运动", size=25, fill=INK, w=900))

    return wrap(W, H, "".join(o))


def _sea_land(day=True):
    W, H = 900, 560
    SEA_X, GY = 430, 400
    o = []
    o.append(rect(24, GY, SEA_X - 24, 84, fill=SKY, op=0.55, stroke=COLD, wd=3))
    for i in range(4):
        y = GY + 20 + i * 18
        o.append(curve([(44, y), (140, y - 9), (250, y + 9), (400, y - 9)],
                       color=COLD, wd=3.4, op=0.7))
    o.append(poly([(SEA_X - 24, GY), (876, GY), (876, GY + 84), (SEA_X - 24, GY + 84)],
                  fill=SAND, stroke=INK, wd=3))
    for x in (500, 610, 720):
        o.append(poly([(x, GY), (x + 34, GY), (x + 34, GY + 84), (x, GY + 84)],
                      fill="#c8b48d", stroke=INK, wd=2.4))
    o.append(line(SEA_X, GY - 96, SEA_X, GY + 84, INK, 4, dash="12 8"))
    o.append(txt(SEA_X - 8, GY + 116, "海洋", size=21, anchor="end", fill=COLD, w=900))
    o.append(txt(SEA_X + 8, GY + 116, "陆地", size=21, anchor="start", fill=BROWN, w=900))
    o.append(sun(456, 82, 34, rays=8, ray_len=30, ray_wd=6) if day
             else circ(456, 82, 32, fill=PAPER2, stroke=INK, wd=4)
             + txt(456, 90, "月" if not day else "", size=22, fill=INK2, w=800))
    # 环流
    if day:
        up, dn, near = 690, 190, "陆"
        o.append(arrow(690, 300, 690, 150, color=WARM, wd=7, head=18))
        o.append(arrow(190, 168, 190, 300, color=COLD, wd=7, head=18))
        o.append(arrow(232, 342, 646, 342, color=VIOLET, wd=6, head=16))
        o.append(arrow(646, 140, 232, 140, color=VIOLET, wd=6, head=16))
        o.append(chip(440, 380, "海风", size=23, fill="#e6eef6", color=COLD))

        o.append(txt(440, 44, "海陆风——白天（海风）", size=25, fill=INK, w=900))
    else:
        o.append(arrow(190, 300, 190, 152, color=WARM, wd=7, head=18))
        o.append(arrow(690, 168, 690, 300, color=COLD, wd=7, head=18))
        o.append(arrow(646, 342, 232, 342, color=VIOLET, wd=6, head=16))
        o.append(arrow(232, 140, 646, 140, color=VIOLET, wd=6, head=16))
        o.append(chip(440, 380, "陆风", size=23, fill="#f4e2de", color=WARM))

        o.append(txt(440, 44, "海陆风——夜晚（陆风）", size=25, fill=INK, w=900))
    return wrap(W, H, "".join(o))


def sea_breeze():
    return _sea_land(True)


def land_breeze():
    return _sea_land(False)


def _valley(day=True):
    W, H = 900, 560
    LEFT = [(40, 120), (400, 462)]
    RIGHT = [(860, 120), (500, 462)]
    o = []
    o.append(poly([(40, 120), (400, 462), (500, 462), (860, 120), (876, 476),
                   (24, 476)], fill=SAND, stroke=INK, wd=3.4))
    o.append(txt(452, 512, "谷底", size=20, fill=BROWN, w=900))
    o.append(sun(452, 84, 32, rays=8, ray_len=28, ray_wd=6) if day
             else circ(452, 84, 30, fill=PAPER2, stroke=INK, wd=4)
             + txt(452, 92, "月" if not day else "", size=21, fill=INK2, w=800))
    # 沿坡面的气流
    for (x0, y0) in ((150, 176), (250, 288), (620, 288), (760, 176)):
        sgn = 1 if x0 < 452 else -1
        if day:
            o.append(arrow(x0 - 30 * sgn, y0 + 44, x0 + 34 * sgn, y0 - 28,
                           color=WARM, wd=6, head=16))
        else:
            o.append(arrow(x0 + 34 * sgn, y0 - 28, x0 - 30 * sgn, y0 + 44,
                           color=COLD, wd=6, head=16))
    name = "谷风" if day else "山风"
    o.append(chip(452, 300, name, size=25, fill="#f4e2de" if day else "#e6eef6",
                  color=WARM if day else COLD))
    if day:
        o.append(txt(452, 44, "山谷风——白天", size=25, fill=INK, w=900))
        o.append(txt(452, 540, "箭头表示此时空气沿山坡的运动方向", size=19,
                     fill=INK2, w=700))
    else:
        o.append(txt(452, 44, "山谷风——夜晚", size=25, fill=INK, w=900))
        o.append(txt(452, 540, "箭头表示此时空气沿山坡的运动方向", size=19,
                     fill=INK2, w=700))
    return wrap(W, H, "".join(o))


def valley_breeze():
    return _valley(True)


def mountain_breeze():
    return _valley(False)


def urban_heat():
    W, H = 900, 560
    GY = 430
    o = []
    o.append(ground(GY, 30, 870))
    for i, x in enumerate((112, 216, 316)):
        o.append(rect(x, GY - 54, 76, 54, fill="#e8dcc4", stroke=INK, wd=3))
        o.append(poly([(x - 8, GY - 54), (x + 38, GY - 86), (x + 84, GY - 54)],
                      fill=RED, stroke=INK, wd=3))
    for i, (x, h) in enumerate(((520, 130), (620, 186), (720, 152), (810, 108))):
        o.append(rect(x, GY - h, 76, h, fill="#d9cfbc", stroke=INK, wd=3))
        for r in range(3):
            o.append(rect(x + 12, GY - h + 16 + r * 34, 16, 18, fill=SKY, stroke=INK2, wd=1.6))
            o.append(rect(x + 46, GY - h + 16 + r * 34, 16, 18, fill=SKY, stroke=INK2, wd=1.6))
    o.append(arrow(660, 250, 660, 112, color=WARM, wd=7, head=18))
    o.append(arrow(184, 122, 184, 262, color=COLD, wd=7, head=18))
    o.append(arrow(228, 300, 616, 300, color=VIOLET, wd=6, head=16))
    o.append(arrow(616, 92, 228, 92, color=VIOLET, wd=6, head=16))
    o.append(chip(184, GY - 108, "郊区", size=20, fill="#e6eef6", color=COLD))
    o.append(chip(660, 78, "城市", size=22, fill="#f4e2de", color=WARM))
    o.append(chip(422, 336, "近地面风由郊区吹向城市", size=19, fill="#e6e0f2", color=VIOLET))
    o.append(txt(452, 44, "城市热岛环流", size=25, fill=INK, w=900))
    o.append(txt(452, 508, "箭头表示空气的运动方向", size=19, fill=INK2, w=700))
    return wrap(W, H, "".join(o))


def inversion():
    W, H = 780, 600
    L, R, T, B = 158, 700, 76, 486
    o = [rect(L, T, R - L, B - T, fill=PAPER2, stroke=INK2, wd=2)]
    XV = lambda v: L + (v + 10) / 20.0 * (R - L)      # 气温 -10..10 ℃
    YV = lambda h: B - h / 1200.0 * (B - T)           # 高度 0..1200 m
    for h in range(0, 1201, 300):
        o.append(line(L, YV(h), R, YV(h), INK2, 1.2, dash="6 6", op=0.35))
        o.append(txt(L - 14, YV(h) + 6, "%d" % h, size=16, anchor="end", fill=INK2, w=700))
    for v in range(-10, 11, 5):
        o.append(line(XV(v), B, XV(v), B + 7, INK2, 2))
        o.append(txt(XV(v), B + 30, "%d" % v, size=16, fill=INK2, w=700))
    o.append(line(L, B, R, B, INK, 4))
    o.append(line(L, T, L, B, INK, 4))
    o.append(txt(L - 14, T - 14, "海拔(m)", size=17, anchor="end", fill=INK2, w=700))
    o.append(txt((L + R) / 2, B + 62, "气温(℃)", size=18, fill=INK2, w=800))
    # 逆温层底（把 0—700m 涂成阴影）
    o.append(rect(L, YV(700), R - L, YV(0) - YV(700), fill=SKY, op=0.25, stroke=None))
    o.append(line(L, YV(700), R, YV(700), VIOLET, 3, dash="10 7"))
    o.append(txt(R - 8, YV(700) - 12, "逆温层顶", size=17, anchor="end",
                 fill=VIOLET, w=800))
    # 正常气温垂直递减率（虚线）
    o.append(line(XV(0), YV(0), XV(-6), YV(1000), INK2, 3, dash="10 8"))
    o.append(txt(XV(-6.6), YV(1000) - 14, "正常垂直递减率", size=17,
                 anchor="start", fill=INK2, w=700))
    # 逆温实测曲线
    pts = [(XV(0), YV(0)), (XV(4), YV(300)), (XV(3), YV(560)), (XV(-1), YV(760)),
           (XV(-6), YV(1000))]
    o.append(curve(pts, color=RED, wd=6))
    for x, y in pts:
        o.append(circ(x, y, 5.5, fill=PAPER2, stroke=RED, wd=3))
    o.append(chip(344, 168, "逆温层：气温随高度升高", size=19,
                  fill="#e6e0f2", color=VIOLET))
    o.append(txt(W / 2, 40, "逆温现象示意", size=26, fill=INK, w=900))
    o.append(txt(W / 2, 552, "横轴为气温，纵轴为海拔；实线为当晚实测气温垂直变化",
                 size=19, fill=INK2, w=700))
    return wrap(W, H, "".join(o))


ITEMS = {
    "heat_process": heat_process,
    "weakening": weakening,
    "greenhouse": greenhouse,
    "thermal_circulation": thermal_circulation,
    "sea_breeze": sea_breeze,
    "land_breeze": land_breeze,
    "valley_breeze": valley_breeze,
    "mountain_breeze": mountain_breeze,
    "urban_heat": urban_heat,
    "inversion": inversion,
}


def main():
    for name, fn in ITEMS.items():
        save(os.path.join(OUT, name + ".svg"), fn())
    print("已生成 %d 个大气/环流示意图 → %s" % (len(ITEMS), OUT))


if __name__ == "__main__":
    main()
