# -*- coding: utf-8 -*-
"""
make_circulation.py —— 大气环流 / 季风 / 等压线等温线判读 类示意图
============================================================
全部为示意图（纬度带、等值线），不涉及真实政区地图。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from svgkit import *  # noqa: F401,F403
from make_fronts import chip, ground  # 复用

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public", "assets", "weather")


# ------------------------------------------------------------ 三圈环流
def three_cells():
    W, H = 1010, 640
    L, R = 60, 950
    X = lambda lat: L + (90.0 - lat) / 180.0 * (R - L)
    Y_T, Y_B = 128, 448
    o = []
    o.append(line(L, Y_B, R, Y_B, INK, 5))

    def cell(up_x, dn_x, color, off):
        o.append(arrow(up_x + off, Y_B - 22, up_x + off, Y_T + 22, color=color,
                       wd=5.5, head=15))
        o.append(arrow(dn_x - off, Y_T + 22, dn_x - off, Y_B - 22, color=color,
                       wd=5.5, head=15))
        o.append(arrow(up_x + off, Y_T, dn_x - off, Y_T, color=color, wd=5, head=14))
        o.append(arrow(dn_x - off, Y_B - 2, up_x + off, Y_B - 2, color=color,
                       wd=5, head=14))

    RED2, GRN2, VIO2 = RED, GREEN, VIOLET
    # 北半球：低纬（0→30N）/ 中纬（60N→30N）/ 高纬（90N→60N）
    cell(X(0), X(30), RED2, 15)
    cell(X(60), X(30), GRN2, -15)
    cell(X(60), X(90), VIO2, 15)
    # 南半球镜像
    cell(X(0), X(-30), RED2, -15)
    cell(X(-60), X(-30), GRN2, 15)
    cell(X(-60), X(-90), VIO2, -15)

    for lat, name in ((90, "90°N"), (60, "60°N"), (30, "30°N"), (0, "0°"),
                      (-30, "30°S"), (-60, "60°S"), (-90, "90°S")):
        o.append(line(X(lat), Y_B, X(lat), Y_B + 10, INK2, 2.4))
        o.append(txt(X(lat), Y_B + 34, name, size=17, fill=INK2, w=800))

    belt = [(X(0), "赤道低气压带", 496, RED),
            (X(30), "副热带高气压带", 496, COLD), (X(-30), "副热带高气压带", 536, COLD),
            (X(60), "副极地低气压带", 536, RED), (X(-60), "副极地低气压带", 496, RED),
            (X(90), "极地高气压带", 536, COLD), (X(-90), "极地高气压带", 496, COLD)]
    for x, name, y, color in belt:
        o.append(chip(x, y, name, size=17, fill="#f4e2de" if color == RED else "#e6eef6",
                      color=color))
    cell_lab = [(X(15), 200, "低纬环流", RED2), (X(45), 200, "中纬环流", GRN2),
                (X(75), 200, "高纬环流", VIO2),
                (X(-15), 200, "低纬环流", RED2), (X(-45), 200, "中纬环流", GRN2),
                (X(-75), 200, "高纬环流", VIO2)]
    for x, y, name, color in cell_lab:
        o.append(chip(x, y, name, size=17, fill=PAPER2, color=color))
    o.append(txt(X(35), 92, "北半球", size=21, fill=INK, w=900))
    o.append(txt(X(-35), 92, "南半球", size=21, fill=INK, w=900))
    o.append(txt(W / 2, 44, "三圈环流与气压带（示意）", size=26, fill=INK, w=900))
    o.append(txt(W / 2, 600, "箭头表示各环流圈中空气的运动方向",
                 size=18, fill=INK2, w=700))
    return wrap(W, H, "".join(o))


# ------------------------------------------------------------ 气压带风带
BELT_ROWS = [
    (90, "极地高气压带", COLD, "band"),
    (75, "极地东风带（北）", None, "wind"),
    (60, "副极地低气压带", RED, "band"),
    (45, "盛行西风带（北）", None, "wind"),
    (30, "副热带高气压带", COLD, "band"),
    (15, "东北信风带", None, "wind"),
    (0, "赤道低气压带", RED, "band"),
    (-15, "东南信风带", None, "wind"),
    (-30, "副热带高气压带", COLD, "band"),
    (-45, "盛行西风带（南）", None, "wind"),
    (-60, "副极地低气压带", RED, "band"),
    (-75, "极地东风带（南）", None, "wind"),
    (-90, "极地高气压带", COLD, "band"),
]

# 风带箭头：dx 向东为正，dy 向南（屏幕向下）为正。
WIND_ARROWS = {
    "极地东风带（北）": (-62, 62),    # 东北风 → 吹向西南
    "盛行西风带（北）": (62, -62),    # 西南风 → 吹向东北
    "东北信风带": (-62, 62),          # 东北风 → 吹向西南
    "东南信风带": (-62, -62),         # 东南风 → 吹向西北
    "盛行西风带（南）": (62, 62),     # 西北风 → 吹向东南
    "极地东风带（南）": (-62, -62),   # 东南风 → 吹向西北
}


def pressure_belts():
    W, H = 900, 720
    TOP, BOT = 76, 656
    Y = lambda lat: TOP + (90.0 - lat) / 180.0 * (BOT - TOP)
    XL, XR = 300, 620
    CX = (XL + XR) / 2
    o = [rect(XL, TOP, XR - XL, BOT - TOP, fill=PAPER2, stroke=INK, wd=3)]
    for lat, name, color, kind in BELT_ROWS:
        y = Y(lat)
        if kind == "band":
            h = 30
            o.append(rect(XL, y - h / 2, XR - XL, h,
                          fill="#f4e2de" if color == RED else "#e6eef6",
                          stroke=color, wd=2.4))
            o.append(txt(CX, y + 6, name, size=19, fill=color, w=900))
            if lat in (90, -90):
                o.append(line(XL, y, XR, y, INK, 4))
        else:
            dx, dy = WIND_ARROWS[name]
            o.append(arrow(CX - dx / 2.0, y - dy / 2.0, CX + dx / 2.0, y + dy / 2.0,
                           color=VIOLET, wd=5, head=15))
            o.append(txt(XR + 16, y + 6, name, size=18, anchor="start", fill=VIOLET, w=800))
    for lat in (90, 60, 30, 0, -30, -60, -90):
        y = Y(lat)
        o.append(txt(XL - 16, y + 7, ("%d°N" % lat) if lat > 0 else
                     ("0°" if lat == 0 else "%d°S" % -lat),
                     size=17, anchor="end", fill=INK2, w=800))
    o.append(txt(XL - 16, Y(45), "北半球", size=18, anchor="end", fill=INK2, w=800))
    o.append(txt(XL - 16, Y(-45), "南半球", size=18, anchor="end", fill=INK2, w=800))
    o.append(txt(W / 2, 40, "全球气压带与风带（示意）", size=26, fill=INK, w=900))
    o.append(txt(W / 2, 700, "风带的箭头表示风的去向；受地转偏向力影响，"
                 "北半球右偏、南半球左偏", size=18, fill=INK2, w=700))
    return wrap(W, H, "".join(o))


def pressure_shift():
    W, H = 940, 620
    o = []

    def panel(x0, title, shift, sub):
        out = [rect(x0, 74, 400, 420, fill=PAPER2, stroke=INK, wd=3)]
        out.append(chip(x0 + 200, 108, title, size=23))
        cx = x0 + 200
        y0 = 340 + shift
        out.append(line(x0 + 20, 340, x0 + 380, 340, INK, 4, dash="12 8"))
        out.append(txt(x0 + 380, 330, "赤道", size=17, anchor="end", fill=INK2, w=700))
        # 赤道低气压带
        out.append(rect(x0 + 90, y0 - 17, 220, 34, fill="#f4e2de", stroke=RED, wd=2.6))
        out.append(txt(cx, y0 + 6, "赤道低气压带", size=18, fill=RED, w=900))
        # 副热带高气压带
        for s in (-1, 1):
            yy = y0 + s * 152
            out.append(rect(x0 + 110, yy - 15, 180, 30, fill="#e6eef6", stroke=COLD, wd=2.4))
            out.append(txt(cx, yy + 6, "副热带高气压带", size=16, fill=COLD, w=800))
        out.append(arrow(cx + 176, y0 - 90, cx + 176, y0 - 30, color=VIOLET, wd=5,
                         head=14) if shift < 0 else
                   arrow(cx + 176, y0 + 30, cx + 176, y0 + 90, color=VIOLET, wd=5,
                         head=14))
        out.append(txt(cx, 448, sub, size=18, fill=INK2, w=700))
        return "".join(out)

    o.append(panel(24, "夏至（7 月前后）", -46, "图一"))
    o.append(panel(516, "冬至（1 月前后）", 46, "图二"))
    o.append(txt(W / 2, 42, "气压带、风带的季节移动", size=26, fill=INK, w=900))
    o.append(txt(W / 2, 546, "气压带、风带的移动方向与太阳直射点的移动方向一致，",
                 size=19, fill=INK2, w=700))
    o.append(txt(W / 2, 578, "大致夏季北移、冬季南移", size=19, fill=INK2, w=700))
    return wrap(W, H, "".join(o))


# ------------------------------------------------------------ 季风
def _monsoon(title, land_p, sea_p, wind_from, wind_to, sub):
    W, H = 900, 580
    GY_T, GY_B = 150, 430
    o = []
    o.append(rect(40, GY_T, 500, GY_B - GY_T, fill=SAND, stroke=INK, wd=3))
    o.append(rect(540, GY_T, 320, GY_B - GY_T, fill=SKY, op=0.5, stroke=COLD, wd=3))
    for i in range(3):
        y = GY_T + 60 + i * 70
        o.append(curve([(560, y), (660, y - 10), (760, y + 10), (846, y - 6)],
                       color=COLD, wd=3.4, op=0.7))
    o.append(txt(290, GY_B - 18, "亚欧大陆", size=23, fill=BROWN, w=900))
    o.append(txt(700, GY_B - 18, "海洋", size=23, fill=COLD, w=900))
    o.append(chip(290, 200, land_p, size=21, fill="#f4e2de", color=RED))
    o.append(chip(700, 200, sea_p, size=21, fill="#e6eef6", color=COLD))
    o.append(arrow(wind_from[0], wind_from[1], wind_to[0], wind_to[1],
                   color=VIOLET, wd=8, head=22))
    o.append(arrow(wind_from[0] + 120, wind_from[1] + 96, wind_to[0] + 120,
                   wind_to[1] + 96, color=VIOLET, wd=8, head=22))
    o.append(txt(W / 2, 46, title, size=26, fill=INK, w=900))
    o.append(txt(W / 2, 500, sub, size=19, fill=INK2, w=700))
    o.append(txt(W / 2, 540, "示意图：仅表示海陆相对位置，不代表真实政区",
                 size=16, fill=INK2, w=700))
    return wrap(W, H, "".join(o))


def monsoon_summer():
    return _monsoon("东亚季风——夏季", "亚洲低压（印度低压）", "夏威夷高压",
                    (760, 400), (300, 210),
                    "箭头表示此时盛行风向；夏季风带来温暖湿润的气流")


def monsoon_winter():
    return _monsoon("东亚季风——冬季", "亚洲高压（西伯利亚高压）", "阿留申低压",
                    (300, 210), (760, 400),
                    "箭头表示此时盛行风向；冬季风寒冷干燥，多大风降温")


def south_asia_monsoon():
    W, H = 900, 580
    o = []
    o.append(rect(40, 110, 820, 180, fill=SAND, stroke=INK, wd=3))
    o.append(txt(450, 216, "亚欧大陆", size=23, fill=BROWN, w=900))
    o.append(rect(40, 320, 820, 170, fill=SKY, op=0.5, stroke=COLD, wd=3))
    for i in range(2):
        y = 380 + i * 76
        o.append(curve([(70, y), (280, y - 10), (500, y + 10), (830, y - 6)],
                       color=COLD, wd=3.4, op=0.7))
    o.append(txt(450, 470, "印度洋", size=23, fill=COLD, w=900))
    o.append(chip(430, 176, "亚洲低压（印度低压）", size=21, fill="#f4e2de", color=RED))
    o.append(arrow(300, 420, 560, 216, color=VIOLET, wd=8, head=22))
    o.append(arrow(430, 420, 690, 216, color=VIOLET, wd=8, head=22))
    o.append(txt(W / 2, 46, "南亚季风——夏季", size=26, fill=INK, w=900))
    o.append(txt(W / 2, 530, "箭头表示此时盛行风向；该季风由东南信风越过赤道偏转形成",
                 size=19, fill=INK2, w=700))
    return wrap(W, H, "".join(o))


# ------------------------------------------------------------ 等压线
def isobar_parallel():
    W, H = 800, 580
    o = []
    vals = [1020, 1015, 1010, 1005, 1000]
    for i, v in enumerate(vals):
        x = 130 + i * 120
        o.append(curve([(x, 90), (x + 12, 300), (x, 500)], color=INK, wd=3.4))
        o.append(txt(x - 6, 76, str(v), size=19, fill=INK, w=800))
    o.append(chip(430, 556, "等压线（单位：hPa），数值由左向右减小",
                  size=18, fill=PAPER2))
    ax, ay = 310, 300
    o.append(circ(ax, ay, 10, fill=RED, stroke=INK, wd=3))
    o.append(txt(ax, ay - 26, "A", size=22, fill=INK, w=900))
    o.append(arrow(ax, ay, ax + 156, ay, color=COLD, wd=5, head=16, dash="10 7"))
    o.append(chip(ax + 118, ay - 34, "水平气压梯度力", size=18, fill="#e6eef6", color=COLD))
    o.append(arrow(ax, ay, ax + 128, ay + 104, color=RED, wd=6, head=18))
    o.append(chip(ax + 210, ay + 136, "风向", size=20, fill="#f4e2de", color=RED))
    o.append(arc_arrow(ax, ay, 128, 0, -39, color=INK2, wd=3, head=12, sweep=1))
    o.append(txt(ax + 158, ay + 44, "偏转", size=17, fill=INK2, w=700))
    o.append(txt(W / 2, 40, "北半球近地面风向的判定", size=25, fill=INK, w=900))
    return wrap(W, H, "".join(o))


def isobar_density():
    W, H = 900, 520
    o = []
    for pi, (x0, step, name, windlen, note) in enumerate(
            ((24, 40, "图 甲", 150, ""),
             (486, 108, "图 乙", 74, ""))):
        o.append(rect(x0, 66, 390, 340, fill=PAPER2, stroke=INK, wd=3))
        o.append(chip(x0 + 195, 104, name, size=23))
        for i in range(5):
            x = x0 + 52 + i * step
            o.append(line(x, 140, x, 372, INK, 3.2))
            o.append(txt(x, 132, str(1010 - i * 5), size=16, fill=INK, w=800))
        cx, cy = x0 + 195, 262
        o.append(circ(cx, cy, 9, fill=RED, stroke=INK, wd=3))
        o.append(arrow(cx, cy, cx + windlen, cy, color=RED, wd=6, head=17))
        o.append(txt(x0 + 195, 428, note, size=17, fill=INK2, w=700))
        _ = None
    o.append(txt(W / 2, 40, "风力大小的比较", size=25, fill=INK, w=900))
    return wrap(W, H, "".join(o))


# ------------------------------------------------------------ 等温线
def isotherm_hemi():
    W, H = 900, 520
    o = []
    for x0, name, vals, note in (
            (24, "甲", [22, 20, 18, 16, 14], ""),
            (486, "乙", [14, 16, 18, 20, 22], "")):
        o.append(rect(x0, 66, 390, 340, fill=PAPER2, stroke=INK, wd=3))
        o.append(chip(x0 + 195, 104, "图 " + name, size=23))
        for i, v in enumerate(vals):
            y = 146 + i * 58
            o.append(curve([(x0 + 26, y), (x0 + 130, y - 14), (x0 + 260, y + 14),
                            (x0 + 366, y)], color=RED, wd=3.6))
            o.append(txt(x0 + 20, y - 6, str(v), size=17, anchor="start", fill=RED, w=800))
            o.append(txt(x0 + 372, y + 30, str(v), size=17, anchor="end", fill=RED, w=800))
        o.append(txt(x0 + 195, 428, note, size=19, fill=INK2, w=700))
        _ = None
    o.append(txt(W / 2, 40, "根据等温线数值变化判断南北半球", size=25, fill=INK, w=900))
    o.append(txt(W / 2, 480, "读图判断甲、乙两图分别位于哪个半球",
                 size=18, fill=INK2, w=700))
    return wrap(W, H, "".join(o))


def isotherm_bend():
    W, H = 900, 560
    o = []
    for x0, name, bulge, note in (
            (24, "7 月（夏季）", -26, ""),
            (486, "1 月（冬季）", 26, "")):
        o.append(rect(x0, 70, 390, 330, fill=PAPER2, stroke=INK, wd=3))
        o.append(rect(x0, 70, 195, 330, fill=SAND, op=0.45, stroke=None))
        o.append(rect(x0 + 195, 70, 195, 330, fill=SKY, op=0.35, stroke=None))
        o.append(line(x0 + 195, 70, x0 + 195, 400, INK, 4, dash="12 8"))
        o.append(txt(x0 + 60, 384, "陆地", size=20, fill=BROWN, w=900))
        o.append(txt(x0 + 320, 384, "海洋", size=20, fill=COLD, w=900))
        for i, v in enumerate((24, 22, 20, 18)):
            y = 136 + i * 74
            d = bulge if i in (1, 2) else 0
            o.append(curve([(x0 + 16, y), (x0 + 110, y + d * 0.6), (x0 + 195, y + d),
                            (x0 + 286, y - d * 0.6), (x0 + 374, y)], color=RED, wd=3.4))
            o.append(txt(x0 + 12, y - 8, str(v), size=16, anchor="start", fill=RED, w=800))
        o.append(chip(x0 + 195, 108, name, size=22))
        o.append(txt(x0 + 195, 450, note, size=17, fill=INK2, w=700))
        _ = None
    o.append(txt(W / 2, 42, "海陆因素对等温线弯曲的影响（北半球）", size=25,
                 fill=INK, w=900))
    o.append(txt(W / 2, 512, "读图比较陆地与海洋上等温线的弯曲方向",
                 size=18, fill=INK2, w=700))
    return wrap(W, H, "".join(o))


def isotherm_terrain():
    W, H = 820, 600
    o = [rect(30, 70, 760, 420, fill=PAPER2, stroke=INK, wd=3)]
    # 只画闭合等温线，不画地形轮廓——地形类型要由作答者从"中心气温低"推断
    for i, (r, v) in enumerate(((196, 18), (150, 14), (104, 10), (58, 6))):
        o.append(circ(410, 280, r, stroke=RED, wd=3.4))
        o.append(txt(410 + r - 6, 280 - 8, "%d℃" % v, size=17, anchor="end",
                     fill=RED, w=800))
    o.append(txt(410, 44, "等温线分布图", size=25, fill=INK, w=900))
    o.append(txt(410, 528, "读图判断等温线闭合区域的地形类型", size=18,
                 fill=INK2, w=700))
    return wrap(W, H, "".join(o))


ITEMS = {
    "three_cells": three_cells,
    "pressure_belts": pressure_belts,
    "pressure_shift": pressure_shift,
    "monsoon_summer": monsoon_summer,
    "monsoon_winter": monsoon_winter,
    "south_asia_monsoon": south_asia_monsoon,
    "isobar_parallel": isobar_parallel,
    "isobar_density": isobar_density,
    "isotherm_hemi": isotherm_hemi,
    "isotherm_bend": isotherm_bend,
    "isotherm_terrain": isotherm_terrain,
}


def main():
    for name, fn in ITEMS.items():
        save(os.path.join(OUT, name + ".svg"), fn())
    print("已生成 %d 个环流/等值线示意图 → %s" % (len(ITEMS), OUT))


if __name__ == "__main__":
    main()
