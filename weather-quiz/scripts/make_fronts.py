# -*- coding: utf-8 -*-
"""
make_fronts.py —— 天气系统类示意图
============================================================
* 锋面剖面：冷锋 / 暖锋 / 准静止锋 / 锢囚锋
* 气压系统平面图：北半球气旋 / 反气旋 / 锋面气旋 / 高压脊 / 低压槽
* 台风结构、我国锋面雨带推移示意、冷锋过境天气变化曲线

说明：全部画成**示意图**（气候/天气系统示意），不绘制任何真实政区地图，
因而不涉及地图合规问题；雨带推移用"纬度带 + 月份"的示意条表达。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from svgkit import *  # noqa: F401,F403

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public", "assets", "weather")


# ------------------------------------------------------------------ 小工具
def _tw(s, size):
    return sum(size * (1.0 if ord(c) > 0x2E80 else 0.58) for c in s)


def chip(x, y, s, size=20, fill=PAPER2, color=INK, box=True, anchor="middle", op=None):
    """带方框的文字标签（硬边、零圆角，和游戏界面一致）。"""
    w = _tw(s, size) + 20
    bx = x - w / 2 if anchor == "middle" else (x if anchor == "start" else x - w)
    out = []
    if box:
        out.append(rect(bx, y - size * 0.92, w, size * 1.36, fill=fill, stroke=color,
                        wd=3, op=op))
    tx = x if anchor == "middle" else (x + 10 if anchor == "start" else x - 10)
    out.append(txt(tx, y + size * 0.33, s, size=size, fill=color, w=800))
    return "".join(out)


def ground(y, x0, x1, h=24, color=INK):
    out = [line(x0, y, x1, y, color, 6)]
    x = int(x0) + 10
    while x < x1 - 6:
        out.append(line(x, y, x - 13, y + h, INK2, 2.4, op=0.45))
        x += 27
    return "".join(out)


def rain_streaks(x0, x1, ytop, ybot, n=14, color=COLD, wd=3.6):
    out = []
    for i in range(n):
        x = x0 + (x1 - x0) * (i + 0.5) / n
        out.append(line(x, ytop, x - 12, ybot, color, wd, op=0.9))
    return "".join(out)


def stratus_band(x0, x1, y, s=0.62, fill=CLOUD):
    """层状云：一排相互叠压的小云 + 拉平的底部。"""
    out = []
    cx = x0
    while cx <= x1:
        out.append(cloud(cx, y, s, fill=fill))
        cx += 46 * s + 6
    out.append(line(x0 + 4, y + 32 * s, x1, y + 32 * s, INK2, 2.4, op=0.35))
    return "".join(out)


def cumulonimbus(cx, ybot, ytop, fill=CLOUD):
    """积雨云：竖直堆叠、顶部铺展成砧状。"""
    h = ybot - ytop
    steps = 5
    out = []
    for i in range(steps):
        t = i / (steps - 1.0)
        y = ybot - h * t * 0.88
        s = 1.15 - 0.42 * t
        out.append(cloud(cx + 8 * t, y, s, fill=fill))
    out.append(cloud(cx, ytop + 6, 0.72, fill=fill))
    return "".join(out)


def front_symbol_on_ground(x, y, kind, size=17, side=1):
    """在地面处画一个锋面符号（冷锋三角 / 暖锋半圆），指向移动方向。"""
    out = []
    if kind == "cold":
        out.append(poly([(x + size * 1.7 * side, y),
                         (x, y - size), (x, y + size)], fill=COLD, stroke=INK, wd=2.2))
    else:
        out.append(pth("M%g %g a%g %g 0 0 %d %g 0"
                       % (x, y - size, size, size, 1 if side > 0 else 0, size * 2),
                       fill=WARM, stroke=INK, wd=2.2))
    return "".join(out)


# ------------------------------------------------------------------ 锋面剖面
W, H = 900, 560
GY = 448


def front_cold_section():
    o = []
    # 冷气团（左下楔形）与暖气团（右上）
    o.append(poly([(24, 92), (150, 92), (612, GY), (24, GY)],
                  fill=COLD, op=0.16, stroke=None))
    o.append(poly([(150, 92), (876, 92), (876, GY), (612, GY)],
                  fill=WARM, op=0.13, stroke=None))
    o.append(pth("M150 92L612 %d" % GY, stroke=COLD, wd=7))
    # 云与降水
    o.append(cumulonimbus(640, 404, 96))
    o.append(rain_streaks(516, 612, 412, GY - 6, n=9))
    # 气流箭头
    o.append(arrow(180, 412, 316, 412, color=COLD, wd=6))
    o.append(arrow(168, 350, 300, 350, color=COLD, wd=6))
    o.append(arrow(560, 420, 452, 356, color=WARM, wd=6))
    o.append(arrow(646, 300, 552, 246, color=WARM, wd=6))
    o.append(ground(GY, 24, 876))
    o.append(front_symbol_on_ground(612, GY, "cold", side=1))
    # 标签
    o.append(chip(258, 392, "冷气团", fill="#dfe8f2", color=COLD))
    o.append(chip(500, 392, "暖气团", fill="#f4e2de", color=WARM))
    o.append(chip(786, 152, "暖气团被迫抬升", size=19, fill="#f4e2de", color=WARM))
    o.append(chip(410, 512, "降水区", size=20, color=COLD))
    o.append(line(410, 492, 560, 430, INK2, 2.2, dash="6 6"))
    o.append(chip(292, 250, "锋面", size=19, color=COLD))
    o.append(line(310, 268, 366, 300, INK2, 2.2, dash="6 6"))
    o.append(txt(450, 46, "某锋面剖面示意", size=27, fill=INK, w=900))
    o.append(chip(792, GY - 22, "冷气团前进方向", size=17, color=COLD))
    return wrap(W, H, "".join(o))


def front_warm_section():
    o = []
    o.append(poly([(24, 206), (150, 206), (574, GY), (24, GY)],
                  fill=COLD, op=0.16, stroke=None))
    o.append(poly([(150, 206), (876, 206), (876, GY), (574, GY)],
                  fill=WARM, op=0.13, stroke=None))
    o.append(pth("M150 206L574 %d" % GY, stroke=WARM, wd=7))
    # 层状云沿锋面爬升
    o.append(cloud(236, 250, 0.72))
    o.append(cloud(316, 268, 0.72))
    o.append(cloud(398, 292, 0.72))
    o.append(cloud(480, 316, 0.72))
    o.append(cloud(556, 342, 0.72))
    o.append(rain_streaks(150, 470, 300, GY - 6, n=16, wd=3.0))
    o.append(arrow(614, 404, 470, 296, color=WARM, wd=6))
    o.append(arrow(686, 350, 560, 252, color=WARM, wd=6))
    o.append(ground(GY, 24, 876))
    o.append(front_symbol_on_ground(574, GY, "warm", side=-1))
    o.append(chip(272, 400, "冷气团", fill="#dfe8f2", color=COLD))
    o.append(chip(556, 400, "暖气团", fill="#f4e2de", color=WARM))
    o.append(chip(792, 148, "暖气团主动爬升", size=19, fill="#f4e2de", color=WARM))
    o.append(chip(268, 512, "降水区", size=20, color=COLD))
    o.append(line(268, 492, 300, 430, INK2, 2.2, dash="6 6"))
    o.append(chip(240, 150, "锋面坡度缓", size=19, color=WARM))
    o.append(txt(450, 46, "某锋面剖面示意", size=27, fill=INK, w=900))
    return wrap(W, H, "".join(o))


def front_static_section():
    o = []
    o.append(poly([(24, 262), (150, 262), (560, GY), (24, GY)],
                  fill=COLD, op=0.16, stroke=None))
    o.append(poly([(150, 262), (876, 262), (876, GY), (560, GY)],
                  fill=WARM, op=0.13, stroke=None))
    o.append(pth("M150 262L560 %d" % GY, stroke=INK, wd=7, dash="22 12"))
    o.append(stratus_band(140, 660, 300, 0.7))
    o.append(rain_streaks(140, 620, 336, GY - 6, n=18, wd=2.8))
    o.append(arrow(196, 400, 300, 400, color=COLD, wd=6))
    o.append(arrow(700, 372, 596, 372, color=WARM, wd=6))
    o.append(ground(GY, 24, 876))
    o.append(chip(258, 396, "冷气团", fill="#dfe8f2", color=COLD))
    o.append(chip(704, 344, "暖气团", fill="#f4e2de", color=WARM))
    o.append(txt(450, 46, "某锋面剖面示意", size=27, fill=INK, w=900))
    return wrap(W, H, "".join(o))


def front_occluded_section():
    o = []
    # 暖气团被抬离地面，呈楔形悬在空中
    o.append(poly([(316, 336), (576, 336), (446, 106)], fill=WARM, op=0.16, stroke=None))
    o.append(pth("M316 336L446 106L576 336", stroke=WARM, wd=6))
    o.append(poly([(24, 336), (316, 336), (150, GY), (24, GY)],
                  fill=COLD, op=0.22, stroke=None))
    o.append(poly([(576, 336), (876, 336), (876, GY), (740, GY)],
                  fill=COLD, op=0.12, stroke=None))
    o.append(pth("M316 336L150 %d" % GY, stroke=COLD, wd=6))
    o.append(pth("M576 336L740 %d" % GY, stroke=COLD, wd=6))
    o.append(cloud(446, 150, 0.95))
    o.append(cumulonimbus(300, 400, 250, CLOUD_DK))
    o.append(cumulonimbus(596, 400, 250, CLOUD_DK))
    o.append(rain_streaks(228, 340, 408, GY - 6, n=7, wd=3.2))
    o.append(rain_streaks(560, 700, 408, GY - 6, n=8, wd=3.2))
    o.append(ground(GY, 24, 876))
    o.append(chip(132, 400, "冷气团", fill="#d7e2ee", color=COLD))
    o.append(chip(802, 400, "冷气团", fill="#e3ecf4", color=COLD))
    o.append(chip(446, 88, "暖气团被抬离地面", size=19, fill="#f4e2de", color=WARM))
    o.append(txt(450, 44, "某锋面剖面示意", size=27, fill=INK, w=900))
    return wrap(W, H, "".join(o))


def cold_front_weather_curve():
    """冷锋过境前后气温、气压、降水的变化曲线。"""
    W2, H2 = 880, 540
    l, r, t, b = 104, 800, 84, 404
    o = [rect(l, t, r - l, b - t, fill=PAPER2, stroke=INK2, wd=2)]
    for k in range(6):
        y = t + (b - t) * k / 5.0
        o.append(line(l, y, r, y, INK2, 1.2, dash="6 6", op=0.35))
    xf = l + (r - l) * 0.46
    o.append(rect(xf - 46, t, 92, b - t, fill=SKY, op=0.34, stroke=None))
    o.append(line(xf, t - 18, xf, b + 18, INK, 4, dash="12 8"))
    # 气温（下降）
    tp = [(l + 6, t + 52), (xf - 60, t + 66), (xf, t + 116), (xf + 60, t + 214),
          (r - 6, t + 246)]
    o.append(curve(tp, color=RED, wd=6))
    # 气压（升高）
    pp = [(l + 6, b - 72), (xf - 60, b - 92), (xf, b - 150), (xf + 60, b - 250),
          (r - 6, b - 276)]
    o.append(curve(pp, color=VIOLET, wd=6))
    o.append(line(l, b, r, b, INK, 4))
    o.append(line(l, t - 18, l, b, INK, 4))
    o.append(txt(xf, b + 44, "锋面过境", size=20, fill=INK, w=900))
    o.append(txt(l - 12, t + 6, "高", size=17, anchor="end", fill=INK2))
    o.append(txt(l - 12, b - 2, "低", size=17, anchor="end", fill=INK2))
    o.append(chip(646, 128, "降水区", size=19, color=COLD))
    o.append(txt(452, 44, "某锋面过境前后气温与气压的变化", size=25, fill=INK, w=900))
    o.append(txt(452, 508, "纵轴：气温 / 气压    横轴：时间（由早到晚）", size=18, fill=INK2, w=700))
    return wrap(W2, H2, "".join(o))


# ------------------------------------------------------------------ 平面气压系统
PW, PH = 780, 640
PCX, PCY = 390, 318


def _isobars(values, rx=250, ry=214, step=42, label_side=90, color=INK):
    """同心等压线 + 数值标注。"""
    o = []
    for i, v in enumerate(values):
        o.append(circ(PCX, PCY, rx - i * step, stroke=color, wd=3.2, op=0.9))
        o.append(txt(PCX + rx - i * step - 6, PCY - 8, str(v), size=18,
                     anchor="end", fill=color, w=800))
    return "".join(o)


def cyclone_nh():
    o = [_isobars([1010, 1005, 1000, 995], rx=252, ry=252, step=46)]
    o.append(txt(PCX, PCY + 4, "低", size=44, fill=VIOLET, w=900))
    o.append(txt(PCX, PCY + 34, "995 hPa", size=17, fill=VIOLET, w=800))
    for rr in (74, 130, 186):
        o.append(arc_arrow(PCX, PCY, rr, 40, 300, color=VIOLET, wd=5, head=15, sweep=0))
        o.append(arc_arrow(PCX, PCY, rr, 220, 480, color=VIOLET, wd=5, head=15, sweep=0))
    o.append(chip(390, 106, "北半球某天气系统", size=25))
    return wrap(PW, PH, "".join(o))


def anticyclone_nh():
    o = [_isobars([1000, 1005, 1010, 1015], rx=252, ry=252, step=46)]
    o.append(txt(PCX, PCY + 4, "高", size=44, fill=RED, w=900))
    o.append(txt(PCX, PCY + 34, "1015 hPa", size=17, fill=RED, w=800))
    for rr in (74, 130, 186):
        o.append(arc_arrow(PCX, PCY, rr, 300, 40, color=RED, wd=5, head=15, sweep=1))
        o.append(arc_arrow(PCX, PCY, rr, 120, 220, color=RED, wd=5, head=15, sweep=1))
    o.append(chip(390, 106, "北半球某天气系统", size=25))
    return wrap(PW, PH, "".join(o))


def front_cyclone_plan():
    W3, H3 = 900, 660
    cx, cy = 470, 250
    o = []
    for i, v in enumerate([1005, 1000, 995, 990]):
        rx, ry = 300 - i * 52, 232 - i * 42
        o.append(pth("M%g %g m%g 0 a%g %g 0 1 0 -%g 0 a%g %g 0 1 0 %g 0"
                     % (cx, cy, rx, rx, ry, rx * 2, rx, ry, rx * 2),
                     stroke=INK, wd=3.2, op=0.85))
        o.append(txt(cx + rx - 4, cy - ry + 20, str(v), size=17, fill=INK, w=800))
    o.append(txt(cx, cy + 6, "低", size=40, fill=VIOLET, w=900))
    # 冷锋（向西南伸展）
    cold = [(cx - 6, cy + 30), (330, 430), (232, 566)]
    o.append(front_line(cold, "cold", wd=6))
    # 暖锋（向东南伸展）
    warm = [(cx + 52, cy - 6), (664, 330), (788, 384)]
    o.append(front_line(warm, "warm", wd=6))
    o.append(chip(232, 168, "冷气团", size=21, fill="#dfe8f2", color=COLD))
    o.append(chip(700, 156, "暖气团", size=21, fill="#f4e2de", color=WARM))
    o.append(txt(cx, 54, "北半球某天气系统平面图", size=25, fill=INK, w=900))
    o.append(txt(cx, 640, "图中三角与半圆分别代表两种锋面", size=19,
                 fill=INK2, w=700))
    return wrap(W3, H3, "".join(o))


def ridge_svg():
    o = []
    o.append(curve([(60, 300), (170, 268), (300, 232), (390, 214), (470, 232),
                    (600, 262), (720, 286)], color=INK, wd=3.4))
    o.append(curve([(60, 402), (180, 372), (300, 336), (390, 318), (470, 336),
                    (600, 366), (720, 390)], color=INK, wd=3.4))
    o.append(txt(96, 288, "1010", size=18, fill=INK, w=800))
    o.append(txt(96, 390, "1008", size=18, fill=INK, w=800))
    o.append(txt(390, 168, "等压线分布图", size=26, fill=INK, w=900))
    o.append(arrow(390, 262, 390, 196, color=RED, wd=5))
    o.append(txt(390, 520, "读图判断这种等压线分布形式的名称",
                 size=19, fill=INK2, w=700))
    return wrap(780, 570, "".join(o))


def trough_svg():
    o = []
    o.append(curve([(60, 300), (170, 268), (300, 232), (390, 214), (470, 232),
                    (600, 262), (720, 286)], color=INK, wd=3.4))
    o.append(curve([(60, 402), (180, 372), (300, 336), (390, 318), (470, 336),
                    (600, 366), (720, 390)], color=INK, wd=3.4))
    o.append(txt(96, 288, "1002", size=18, fill=INK, w=800))
    o.append(txt(96, 390, "1004", size=18, fill=INK, w=800))
    o.append(txt(390, 168, "等压线分布图", size=26, fill=INK, w=900))
    o.append(arrow(390, 196, 390, 262, color=VIOLET, wd=5))
    o.append(txt(390, 520, "读图判断这种等压线分布形式的名称",
                 size=19, fill=INK2, w=700))
    return wrap(780, 570, "".join(o))


def typhoon_structure():
    W4, H4 = 780, 660
    cx, cy = 390, 320
    o = []
    for rr, arms in ((214, 4), (150, 3), (92, 2)):
        for k in range(arms):
            a0 = 90 + k * (360.0 / arms)
            o.append(arc_arrow(cx, cy, rr, a0, a0 + 78, color=COLD, wd=9, head=20, sweep=0))
    o.append(circ(cx, cy, 40, fill=PAPER2, stroke=INK, wd=5))
    o.append(txt(cx, cy + 8, "眼", size=30, fill=INK2, w=900))
    o.append(chip(cx, 106, "台风（热带气旋）结构", size=25))
    o.append(chip(148, 596, "外围大风区", size=19, color=COLD))
    o.append(chip(cx, 596, "旋涡风雨区", size=19, color=COLD))
    o.append(chip(646, 596, "台风眼", size=19, color=INK2))
    o.append(txt(cx, 640, "北半球，箭头表示气流旋转方向", size=18,
                 fill=INK2, w=700))
    return wrap(W4, H4, "".join(o))


def meiyu_band():
    """我国东部锋面雨带推移（示意条，非政区地图）。"""
    W5, H5 = 880, 620
    x0, x1 = 220, 660
    bands = [("华南地区", 500), ("长江中下游（江淮）", 386), ("华北、东北地区", 272)]
    o = []
    o.append(rect(x0, 214, x1 - x0, 356, fill=PAPER2, stroke=INK, wd=3))
    for name, y in bands:
        o.append(line(x0, y, x1, y, INK2, 2, dash="8 6", op=0.5))
        o.append(txt(x0 - 16, y + 7, name, size=20, anchor="end", fill=INK, w=800))
    o.append(rect(x0 + 26, 434, x1 - x0 - 52, 62, fill=SKY, op=0.7, stroke=COLD, wd=3))
    o.append(txt((x0 + x1) / 2, 474, "4—5 月", size=23, fill=INK, w=900))
    o.append(rect(x0 + 26, 320, x1 - x0 - 52, 62, fill=SKY, op=0.7, stroke=COLD, wd=3))
    o.append(txt((x0 + x1) / 2, 360, "6 月", size=23, fill=INK, w=900))
    o.append(rect(x0 + 26, 206, x1 - x0 - 52, 62, fill=SKY, op=0.7, stroke=COLD, wd=3))
    o.append(txt((x0 + x1) / 2, 246, "7—8 月", size=23, fill=INK, w=900))
    o.append(arrow(x0 + 74, 560, x0 + 74, 500, color=COLD, wd=5))
    o.append(arrow(x0 + 206, 560, x0 + 206, 386, color=COLD, wd=5))
    o.append(arrow(x0 + 338, 560, x0 + 338, 272, color=COLD, wd=5))
    o.append(txt(x0 + 200, 592, "雨带随夏季风北移", size=19, fill=COLD, w=800))
    o.append(arrow(784, 272, 784, 470, color=WARM, wd=5))
    o.append(txt(800, 380, "夏末南退", size=19, anchor="start", fill=WARM, w=800))
    o.append(txt(440, 70, "我国东部锋面雨带的推移", size=26, fill=INK, w=900))
    o.append(txt(440, 118, "示意图，仅表示纬度方向的相对位置", size=18, fill=INK2, w=700))
    return wrap(W5, H5, "".join(o))


ITEMS = {
    "front_cold_section": front_cold_section,
    "front_warm_section": front_warm_section,
    "front_static_section": front_static_section,
    "front_occluded_section": front_occluded_section,
    "cold_front_weather_curve": cold_front_weather_curve,
    "cyclone_nh": cyclone_nh,
    "anticyclone_nh": anticyclone_nh,
    "front_cyclone_plan": front_cyclone_plan,
    "ridge": ridge_svg,
    "trough": trough_svg,
    "typhoon_structure": typhoon_structure,
    "meiyu_band": meiyu_band,
}


def main():
    for name, fn in ITEMS.items():
        save(os.path.join(OUT, name + ".svg"), fn())
    print("已生成 %d 个天气系统示意图 → %s" % (len(ITEMS), OUT))


if __name__ == "__main__":
    main()
