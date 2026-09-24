# -*- coding: utf-8 -*-
"""绘制类图例（教材图与图标库里都没有对应物的线状/抽象符号）。

原则：**照教材图的实测规范画**，与抠图素材共用同一套颜色与线宽比例，
      所以混在一起看不出是两个来源。

实测到的教材用法（作为规范）：
  国界=实线 3/119 ≈ 2.5% 线宽 · 未定国界=虚线 · 洲界=品红点划线 · 省界=点线
  常年河/湖=蓝实线 · 时令河/湖=蓝虚线 · 航海线=蓝虚线
  公路=品红实线 · 铁路=黑白相间 · 高速公路=橙实线
设计取舍：线宽放大到 5.5%（教材是纸面印刷，屏幕上太细看不清）；
      经线/纬线/赤道/回归线/极圈 沿用"地球仪做背景"的既有设计 ——
      这五个光靠线条无法区分，必须给上下文。
"""

INK = "#221f1c"
MAGENTA = "#c2185b"
MAGENTA_DK = "#8e2a4a"
BROWN = "#7a6a5c"
TERRAIN = "#3a3129"
WATER = "#2f9fd8"
ORANGE = "#e8a33d"
GREEN = "#3f9b5a"
INDIGO = "#3f51b5"
TEAL = "#00838f"
RED = "#cc0000"

W = 5.5          # 主线段线宽（100 单位制）—— **每一条手绘图例的主笔画都必须用它**
#                 辅助笔（连接短横、齿、指示小箭头）允许更细；
#                 "band 型"符号（复线铁路、管道、高速公路）是色带不是线，另有更宽的值。
GLOBE = ('<circle cx="50" cy="50" r="39" fill="#ffffff" stroke="%s" stroke-width="3.2"/>' % INK)


def line(y, x0=6, x1=94, color=INK, w=W, dash=None, cap="butt"):
    d = ' stroke-dasharray="%s"' % dash if dash else ""
    return ('<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="%s" stroke-width="%s" '
            'stroke-linecap="%s"%s/>' % (x0, y, x1, y, color, w, cap, d))


def path(d, color=INK, w=W, dash=None, fill="none", cap="round", join="round"):
    da = ' stroke-dasharray="%s"' % dash if dash else ""
    return ('<path d="%s" fill="%s" stroke="%s" stroke-width="%s" stroke-linecap="%s" '
            'stroke-linejoin="%s"%s/>' % (d, fill, color, w, cap, join, da))


def arrow(x, y, angle, color, size=13):
    import math
    a = math.radians(angle)
    bx, by = x - size * math.cos(a), y - size * math.sin(a)
    nx, ny = -math.sin(a), math.cos(a)
    p1 = (x, y)
    p2 = (bx + nx * size * 0.46, by + ny * size * 0.46)
    p3 = (bx - nx * size * 0.46, by - ny * size * 0.46)
    return ('<path d="M %.2f %.2f L %.2f %.2f L %.2f %.2f Z" fill="%s"/>'
            % (p1[0], p1[1], p2[0], p2[1], p3[0], p3[1], color))


DRAW = {
    # —— 界线家族（与抠图的 国界/未定国界/洲界/省界 并列）——
    # 地区界：细短划线（棕）。与「未定国界」（黑长划线）靠**颜色 + 划长**区分，
    # 与「特别行政区界」（品红 划+点）靠**有没有点**区分 —— 六种界线在卡片尺寸下都能分开。
    "boundary_region": line(50, color=BROWN, dash="7 6"),
    # 特别行政区界：短划 + 点（品红深）—— 「有点」是它与「地区界」的关键差别
    "boundary_sar": (
        "".join(path("M %d 50 L %d 50" % (x, x + 11), MAGENTA_DK) for x in (6, 26, 46, 66, 86)) +
        "".join('<circle cx="%d" cy="50" r="3.1" fill="%s"/>' % (x, MAGENTA_DK)
                for x in (21, 41, 61, 81))),

    # —— 地形家族 ——
    "contour": (
        path("M 22 34 C 40 20, 60 20, 78 34 C 86 41, 86 59, 78 66 C 60 80, 40 80, 22 66 C 14 59, 14 41, 22 34 Z",
             TERRAIN, W) +
        path("M 33 41 C 44 33, 56 33, 67 41 C 72 45, 72 55, 67 59 C 56 67, 44 67, 33 59 C 28 55, 28 45, 33 41 Z",
             TERRAIN, W) +
        path("M 43 48 C 47 44, 53 44, 57 48 C 59 50, 59 50, 57 52 C 53 56, 47 56, 43 52 C 41 50, 41 50, 43 48 Z",
             TERRAIN, W)),
    "isobath": (
        path("M 20 36 C 39 22, 61 22, 80 36 C 88 43, 88 57, 80 64 C 61 78, 39 78, 20 64 C 12 57, 12 43, 20 36 Z",
             WATER, W, dash="10 7") +
        path("M 32 43 C 44 35, 56 35, 68 43 C 73 47, 73 53, 68 57 C 56 65, 44 65, 32 57 C 27 53, 27 47, 32 43 Z",
             WATER, W, dash="10 7") +
        path("M 44 49 C 47 46, 53 46, 56 49 C 57 50, 57 50, 56 51 C 53 54, 47 54, 44 51 C 43 50, 43 50, 44 49 Z",
             WATER, W, dash="10 7")),
    "coastline": (
        path("M 6 58 C 18 50, 26 66, 38 56 C 48 48, 54 64, 64 56 C 74 48, 82 62, 94 54",
             WATER, W, cap="round") +
        '<circle cx="24" cy="76" r="3" fill="%s"/><circle cx="48" cy="80" r="2.2" fill="%s"/>'
        '<circle cx="72" cy="76" r="3" fill="%s"/>' % (WATER, WATER, WATER)),
    "trench": (
        line(48, color=WATER, w=W) +
        path("M 50 54 L 38 74 L 62 74 Z", fill=WATER) +
        path("M 50 54 L 38 74 M 50 54 L 62 74", WATER, 2.4)),
    "plate": (
        path("M 50 10 C 50 30, 50 40, 50 90", TERRAIN, W, dash="9 7") +
        arrow(50, 22, 90, RED, 13) + arrow(50, 22, 270, RED, 13) +
        arrow(50, 78, 90, RED, 13) + arrow(50, 78, 270, RED, 13)),

    # —— 水系家族 ——
    "canal": (
        path("M 8 44 L 92 44", WATER, W) + path("M 8 56 L 92 56", WATER, W) +
        path("M 44 44 L 44 56 M 56 44 L 56 56", WATER, 3.2) +
        path("M 44 36 L 44 44 M 56 36 L 56 44 M 44 56 L 44 64 M 56 56 L 56 64", WATER, 3.2)),
    "water_diversion": (
        path("M 8 50 L 84 50", WATER, W, dash="12 8") + arrow(92, 50, 0, WATER, 15)),

    # —— 交通家族 ——
    "rail_double": (
        # 黑白相间画两道 = 复线铁路；与抠图的单线铁路形成可判定差异
        path("M 8 42 L 92 42", INK, 9) + path("M 8 42 L 92 42", "#ffffff", 9, dash="14 14") +
        path("M 8 58 L 92 58", INK, 9) + path("M 8 58 L 92 58", "#ffffff", 9, dash="14 14")),
    "pipeline": (
        # 画成"管线 + 法兰"：主管加一排竖向短横。与「铁路」（黑白相间单排）、
        # 「复线铁路」（黑白相间双排）在缩到卡片尺寸后仍能一眼分开。
        line(50, color=INK, w=6.4) +
        "".join(path("M %d 37 L %d 63" % (x, x), INK, 3.4) for x in range(15, 92, 13))),
    "air_route": (
        path("M 8 50 L 78 50", INDIGO, W, dash="11 9") + arrow(90, 50, 0, INDIGO, 15)),
    "powerline": (
        line(50, color=GREEN, w=W, dash="7 6") +
        "".join(path("M %d 34 L %d 50 L %d 66" % (x, x, x), GREEN, 3.0) for x in (20, 50, 80))),

    # —— 地图基础 ——
    "north_arrow": (
        '<text x="50" y="24" font-size="22" text-anchor="middle" font-weight="800" '
        'font-family="system-ui,Microsoft YaHei,sans-serif" fill="%s">N</text>' % INK +
        path("M 50 32 L 68 78 L 50 64 L 32 78 Z", RED, 4.2, fill=RED)),
    "scalebar": (
        '<rect x="10" y="42" width="20" height="16" fill="%s"/>'
        '<rect x="30" y="42" width="20" height="16" fill="#ffffff"/>'
        '<rect x="50" y="42" width="20" height="16" fill="%s"/>'
        '<rect x="70" y="42" width="20" height="16" fill="#ffffff"/>'
        '<rect x="10" y="42" width="80" height="16" fill="none" stroke="%s" stroke-width="3.2"/>'
        % (INK, INK, INK) +
        "".join('<line x1="%d" y1="58" x2="%d" y2="66" stroke="%s" stroke-width="2.6"/>' % (x, x, INK)
                for x in (10, 50, 90)) +
        '<text x="10" y="80" font-size="11" text-anchor="middle" fill="%s" '
        'font-family="system-ui,Microsoft YaHei,sans-serif">0</text>' % INK +
        '<text x="90" y="80" font-size="11" text-anchor="middle" fill="%s" '
        'font-family="system-ui,Microsoft YaHei,sans-serif">40</text>' % INK),

    # 地球仪家族：五个符号单看线条无法区分，必须给"球"这个上下文
    "meridian": (GLOBE +
                 '<ellipse cx="50" cy="50" rx="13" ry="39" fill="none" stroke="%s" stroke-width="3"/>'
                 '<ellipse cx="50" cy="50" rx="26" ry="39" fill="none" stroke="%s" stroke-width="3"/>'
                 '<ellipse cx="50" cy="50" rx="39" ry="39" fill="none" stroke="%s" stroke-width="3.4"/>'
                 % (INK, INK, INK)),
    "parallel": (GLOBE +
                 '<ellipse cx="50" cy="50" rx="39" ry="13" fill="none" stroke="%s" stroke-width="3"/>'
                 '<ellipse cx="50" cy="50" rx="39" ry="26" fill="none" stroke="%s" stroke-width="3"/>'
                 '<ellipse cx="50" cy="50" rx="39" ry="39" fill="none" stroke="%s" stroke-width="3.4"/>'
                 % (INK, INK, INK)),
    "equator": (GLOBE +
                path("M 11 50 L 40 50", RED, W) + path("M 60 50 L 89 50", RED, W) +
                '<text x="50" y="55" font-size="14" text-anchor="middle" font-weight="800" '
                'font-family="system-ui,Microsoft YaHei,sans-serif" fill="%s">0°</text>' % RED),
    "tropic": (GLOBE +
               path("M 16 32 L 39 32", RED, W, dash="8 6") +
               path("M 61 32 L 84 32", RED, W, dash="8 6") +
               path("M 16 68 L 39 68", RED, W, dash="8 6") +
               path("M 61 68 L 84 68", RED, W, dash="8 6") +
               '<text x="50" y="35" font-size="12" text-anchor="middle" font-weight="800" '
               'font-family="system-ui,Microsoft YaHei,sans-serif" fill="%s">23.5°</text>' % RED),
    "polar": (GLOBE +
              path("M 30 22 L 70 22", INDIGO, W, dash="3 6") +
              path("M 30 78 L 70 78", INDIGO, W, dash="3 6") +
              '<text x="50" y="14" font-size="11" text-anchor="middle" font-weight="800" '
              'font-family="system-ui,Microsoft YaHei,sans-serif" fill="%s">66.5°</text>' % INDIGO),

    # —— 气候图线 ——
    "isotherm": (
        path("M 6 62 C 20 48, 30 72, 44 58 C 56 46, 66 70, 80 56 C 86 50, 90 50, 94 52", RED, W) +
        path("M 6 84 C 20 70, 30 94, 44 80 C 56 68, 66 92, 80 78 C 86 72, 90 72, 94 74", RED, W) +
        '<text x="50" y="24" font-size="15" text-anchor="middle" font-weight="800" '
        'font-family="system-ui,Microsoft YaHei,sans-serif" fill="%s">℃</text>' % RED),
    "isohyet": (
        path("M 6 60 C 20 46, 30 70, 44 56 C 56 44, 66 68, 80 54 C 86 48, 90 48, 94 50", TEAL, W,
             dash="10 7") +
        path("M 6 82 C 20 68, 30 92, 44 78 C 56 66, 66 90, 80 76 C 86 70, 90 70, 94 72", TEAL, W,
             dash="10 7") +
        '<text x="50" y="24" font-size="14" text-anchor="middle" font-weight="800" '
        'font-family="system-ui,Microsoft YaHei,sans-serif" fill="%s">mm</text>' % TEAL),
}

# 路径类：粗箭头 + 一个**真实网络图标**作徽标（台风/寒潮/沙尘暴 三个成一家）
PATHY = {
    "typhoon":    ("mdi:weather-hurricane", TEAL),
    "coldwave":   ("mdi:snowflake", "#2f6fb5"),
    "sandstorm":  ("mdi:weather-dust", "#b07b2a"),
}
PATH_ARROW = {
    "typhoon":   "M 8 72 C 30 72, 40 30, 62 30 C 74 30, 80 36, 84 44",
    "coldwave":  "M 8 30 C 34 30, 56 30, 84 30",
    "sandstorm": "M 8 66 C 30 66, 40 40, 62 40 C 74 40, 80 44, 84 50",
}
