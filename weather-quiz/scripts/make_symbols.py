# -*- coding: utf-8 -*-
"""
make_symbols.py —— 生成「天气符号」「风向风速符号」「气候统计图」三类 SVG
================================================================
运行：python scripts/make_symbols.py
输出：public/assets/weather/*.svg
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from svgkit import *  # noqa: F401,F403

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public", "assets", "weather")

S = 360          # 符号画布边长
CX, CY = 180, 180


def symbol(frame, body, caption=None):
    """统一符号外壳：居中留白 + 可选的底部小字说明。"""
    items = [body]
    if caption:
        items.append(txt(CX, S - 34, caption, size=17, fill=INK2, w=700))
    return wrap(S, S, "".join(items), grid=False)


# ------------------------------------------------------------------ 天气符号
def cloud_at(dy=0.0, s=1.3, fill=CLOUD):
    return cloud(CX, 140 + dy, s, fill=fill)


def drops_row(n, y=200, s=1.5, slant=False):
    xs = {1: [CX], 2: [CX - 30, CX + 30], 3: [CX - 54, CX, CX + 54],
          4: [CX - 60, CX - 20, CX + 20, CX + 60]}[n]
    fn = slant_drop if slant else drop
    return "".join(fn(x, y, s) for x in xs)


def snows_row(n, y=200, s=1.0):
    xs = {1: [CX], 2: [CX - 30, CX + 30], 3: [CX - 54, CX, CX + 54]}[n]
    return "".join(snow(x, y, s) for x in xs)


def sym_sunny():
    return symbol("sunny", sun(CX, CY + 4, 46, rays=8, ray_len=44, ray_wd=7))


def sym_partly():
    body = (sun(CX - 46, CY - 42, 34, rays=8, ray_len=28, ray_wd=6)
            + cloud(CX + 16, CY + 6, 1.35))
    return symbol("partly", body)


def sym_overcast():
    body = (cloud(CX - 34, CY - 20, 1.05, fill=CLOUD_DK)
            + cloud(CX + 14, CY + 14, 1.4))
    return symbol("overcast", body)


def sym_rain(n):
    return symbol("rain%d" % n, cloud_at() + drops_row(n))


def sym_shower():
    return symbol("shower", cloud_at() + drops_row(3, slant=True))


def sym_thunder():
    body = (cloud_at()
            + lightning(CX - 34, 208, 1.35)
            + drop(CX + 22, 200, 1.5) + drop(CX + 54, 200, 1.5))
    return symbol("thunder", body)


def sym_snow(n):
    return symbol("snow%d" % n, cloud_at() + snows_row(n))


def sym_sleet():
    body = cloud_at() + drop(CX - 34, 200, 1.5) + snow(CX + 32, 210, 1.15)
    return symbol("sleet", body)


def sym_hail():
    body = cloud_at() + hail(CX - 34, 208, 1.0) + hail(CX + 34, 208, 1.0)
    return symbol("hail", body)


def sym_fog():
    return symbol("fog", fog_lines(CX, CY + 4, n=5, w=196, gap=27, amp=8, wd=9))


def sym_frost():
    return symbol("frost", frost(CX, CY + 40, w=190))


def sym_sandstorm():
    return symbol("sandstorm", sandstorm_symbol(CX, CY, 1.0))


def sym_typhoon():
    return symbol("typhoon", typhoon_symbol(CX, CY - 4, 1.35))


def sym_front(kind):
    if kind == "cold":
        pts = [(58, 196), (140, 178), (222, 196), (302, 178)]
    elif kind == "warm":
        pts = [(302, 178), (222, 196), (140, 178), (58, 196)]
    else:
        pts = [(58, 186), (140, 186), (222, 186), (302, 186)]
    body = front_line(pts, kind, wd=7)
    return symbol("front_" + kind, body)


SYMBOLS = {
    "sunny": sym_sunny, "partly": sym_partly, "overcast": sym_overcast,
    "rain1": lambda: sym_rain(1), "rain2": lambda: sym_rain(2),
    "rain3": lambda: sym_rain(3), "rain4": lambda: sym_rain(4),
    "shower": sym_shower, "thunder": sym_thunder,
    "snow1": lambda: sym_snow(1), "snow2": lambda: sym_snow(2),
    "snow3": lambda: sym_snow(3),
    "sleet": sym_sleet, "hail": sym_hail, "fog": sym_fog, "frost": sym_frost,
    "sandstorm": sym_sandstorm, "typhoon": sym_typhoon,
    "front_cold": lambda: sym_front("cold"),
    "front_warm": lambda: sym_front("warm"),
    "front_static": lambda: sym_front("static"),
}

# ------------------------------------------------------------------ 风向风速
# 注意：图上**不能**写出风向与风力（否则题目直接送分），只画罗盘 + 风杆 + 风尾/风旗，
# 让作答者自己按"风杆指向来向、一道风尾 2 级、一面风旗 8 级"的规则读出来。
WIND_CASES = {
    "wind_n4": (0, 4),
    "wind_e6": (90, 6),
    "wind_sw8": (225, 8),
    "wind_n2": (0, 2),
}


def wind_svg(deg, level):
    body = wind_barb(CX, CY + 4, deg, level, shaft=104, compass=True)
    return wrap(S, S, body)


# ------------------------------------------------------------------ 气候统计图
CW, CH = 800, 470
PL, PR, PT, PB = 100, 706, 62, 392
PMIN, PMAX_T = -30, 30

CLIMATES = [
    # id, 名称, 月均温(12), 月降水(12), 降水轴上限
    ("clima_rainforest", "热带雨林气候",
     [26.0, 26.6, 27.2, 27.5, 27.7, 27.6, 27.2, 27.0, 27.0, 26.9, 26.6, 26.2],
     [234, 159, 171, 187, 166, 163, 159, 173, 170, 196, 252, 262], 300),
    ("clima_savanna", "热带草原气候",
     [20, 20, 21, 22, 24, 27, 28, 28, 28, 27, 25, 22],
     [1, 1, 0, 0, 1, 15, 90, 180, 140, 40, 2, 1], 300),
    ("clima_desert", "热带沙漠气候",
     [14, 17, 21, 26, 31, 34, 36, 36, 33, 28, 21, 16],
     [13, 9, 20, 24, 7, 0, 0, 0, 0, 1, 7, 13], 300),
    ("clima_tropical_monsoon", "热带季风气候",
     [24, 24, 27, 29, 30, 29, 27, 27, 27, 28, 27, 25],
     [1, 1, 0, 1, 20, 520, 700, 450, 280, 60, 15, 3], 800),
    ("clima_subtropical_monsoon", "亚热带季风气候",
     [4, 5, 9, 15, 20, 24, 28, 28, 24, 19, 12, 6],
     [74, 59, 94, 75, 84, 182, 146, 213, 122, 51, 51, 36], 300),
    ("clima_mediterranean", "地中海气候",
     [8, 9, 11, 14, 18, 22, 25, 25, 21, 17, 12, 9],
     [80, 75, 65, 65, 45, 35, 20, 30, 70, 110, 115, 95], 150),
    ("clima_temperate_monsoon", "温带季风气候",
     [-4, -1, 5, 14, 20, 24, 26, 25, 20, 13, 4, -2],
     [3, 5, 8, 20, 35, 75, 175, 180, 50, 20, 7, 2], 300),
    ("clima_temperate_oceanic", "温带海洋性气候",
     [5, 5, 7, 9, 13, 16, 18, 18, 15, 12, 8, 6],
     [55, 41, 42, 44, 49, 45, 45, 50, 49, 69, 59, 55], 150),
    ("clima_temperate_continental", "温带大陆性气候",
     [-9, -8, -3, 5, 12, 16, 18, 17, 11, 5, -2, -7],
     [40, 35, 35, 40, 50, 75, 85, 75, 65, 65, 55, 50], 150),
    ("clima_highland", "高原山地气候",
     [-2, 1, 5, 8, 12, 16, 15, 14, 13, 9, 3, -1],
     [1, 1, 2, 5, 27, 72, 120, 90, 60, 10, 2, 1], 300),
]


def climate_chart(temps, precs, pmax, show_title=None):
    pw, ph = PR - PL, PB - PT
    bw = pw / 12.0
    out = []

    # —— 温度轴网格 ——
    for t in range(PMIN, PMAX_T + 1, 10):
        y = PB - (t - PMIN) / (PMAX_T - PMIN) * ph
        strong = (t == 0)
        out.append(line(PL, y, PR, y, RED if strong else INK2, 3 if strong else 1.4,
                        dash=None if strong else "7 7", op=None if strong else 0.5))
        out.append(txt(PL - 16, y + 7, "%d" % t, size=17, anchor="end",
                       fill=RED if strong else INK2, w=800))

    # —— 降水柱 ——
    for i, p in enumerate(precs):
        h = (max(0.0, min(p, pmax)) / pmax) * ph
        x = PL + i * bw + bw * 0.22
        out.append(rect(x, PB - h, bw * 0.56, h, fill=SKY, stroke=COLD, wd=2))

    # —— 降水轴刻度 ——
    for k in range(0, 4):
        v = pmax * k / 3.0
        y = PB - (v / pmax) * ph
        out.append(txt(PR + 16, y + 7, "%d" % round(v), size=17, anchor="start",
                       fill=COLD, w=800))
        out.append(line(PR, y, PR + 9, y, COLD, 3))

    # —— 气温曲线 ——
    pts = [(PL + i * bw + bw / 2,
            PB - (max(PMIN, min(t, PMAX_T)) - PMIN) / (PMAX_T - PMIN) * ph)
           for i, t in enumerate(temps)]
    out.append(curve(pts, color=RED, wd=5))
    for x, y in pts:
        out.append(circ(x, y, 5.5, fill=PAPER2, stroke=RED, wd=3))

    # —— 坐标轴 ——
    out.append(line(PL, PT - 16, PL, PB, INK, 4))
    out.append(line(PR, PT - 16, PR, PB, INK, 4))
    out.append(line(PL, PB, PR, PB, INK, 4))
    for i in range(12):
        x = PL + i * bw + bw / 2
        out.append(line(x, PB, x, PB + 8, INK2, 2))
        out.append(txt(x, PB + 30, "%d" % (i + 1), size=17, fill=INK2, w=800))

    out.append(txt(PL + 4, PT - 30, "气温(℃)", size=19, anchor="start", fill=RED, w=900))
    out.append(txt(PR - 4, PT - 30, "降水量(mm)", size=19, anchor="end", fill=COLD, w=900))
    out.append(txt((PL + PR) / 2, PB + 60, "月份", size=19, fill=INK2, w=800))
    if show_title:
        out.append(txt(CW / 2, 40, show_title, size=24, fill=INK, w=900))
    return wrap(CW, CH, "".join(out), bg=PAPER2, grid=False)


# ------------------------------------------------------------------ main
def main():
    n = 0
    for name, fn in SYMBOLS.items():
        save(os.path.join(OUT, name + ".svg"), fn())
        n += 1
    for name, (deg, lv) in WIND_CASES.items():
        save(os.path.join(OUT, name + ".svg"), wind_svg(deg, lv))
        n += 1
    for cid, cname, temps, precs, pmax in CLIMATES:
        save(os.path.join(OUT, cid + ".svg"), climate_chart(temps, precs, pmax))
        n += 1
    print("已生成 %d 个 SVG → %s" % (n, OUT))


if __name__ == "__main__":
    main()
