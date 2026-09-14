# -*- coding: utf-8 -*-
"""
svgkit —— 「气象要素识别」矢量素材绘图工具库
============================================================
本仓库其它小游戏（province-quiz / landform-quiz / shanhe-match3 …）共用一套
粗野派（neo-brutalist）视觉语言：纸底 + 纯色 + 3px 粗墨线 + 硬投影 + 零圆角。
气象示意图也照这套走，保证和游戏界面同源，不会被一眼看出"另一套风格"。

约定
----
* 所有颜色取常量，不写魔法值。
* 文字一律用 <text>，字体族用单引号包裹（双引号会提前闭合属性 → 非法 XML →
  <img> 静默失败，本仓库 2026-09-12 在导出长图时踩过这个坑）。
* 每个绘图函数返回 SVG 片段字符串，由 make_*.py 拼装 + 落盘。
"""

import math
import os

# ---------------------------------------------------------------- 调色板
INK = "#1a1a1a"          # 主墨线
INK2 = "#5a5044"         # 次级文字
PAPER = "#f2e8d5"        # 纸底（与游戏界面 :root --paper 一致）
PAPER2 = "#fbf6ea"       # 高亮纸面（图表区）
RED = "#cc0000"          # 朱红（暖 / 高温 / 危险）
GOLD = "#d4a843"         # 金（太阳 / 高亮）
BROWN = "#8b4513"        # 棕
COLD = "#2d6ca8"         # 冷气团 / 冷色调（与 game 里的冷色一致）
WARM = "#cc3a26"         # 暖气团
CLOUD = "#cfc7b6"        # 云体
CLOUD_DK = "#b6ad9c"     # 云体暗部
GREEN = "#2f7d4f"        # 植被
SKY = "#a9c9de"          # 天空 / 高空
SAND = "#dfc188"         # 沙尘
VIOLET = "#6b4f9e"       # 气压中心 / 环流箭头

FONT = ("'Arial Black','Franklin Gothic Heavy','Microsoft YaHei',"
        "'PingFang SC',sans-serif")


# ---------------------------------------------------------------- 基础封装
def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def wrap(w, h, body, bg=PAPER, grid=False, border=True):
    """包成完整 SVG 文件。grid=True 时铺一层淡淡的方格网，像坐标纸。"""
    out = []
    out.append('<svg xmlns="http://www.w3.org/2000/svg" '
               'viewBox="0 0 %d %d" width="%d" height="%d" '
               'font-family="%s">' % (w, h, w, h, FONT))
    out.append('<rect x="0" y="0" width="%d" height="%d" fill="%s"/>' % (w, h, bg))
    if grid:
        out.append('<g stroke="%s" stroke-width="1" opacity="0.28">' % INK2)
        step = 26
        for x in range(step, w, step):
            out.append('<path d="M%d 0V%d"/>' % (x, h))
        for y in range(step, h, step):
            out.append('<path d="M0 %dH%d"/>' % (y, w))
        out.append('</g>')
    if border:
        out.append('<rect x="5" y="5" width="%d" height="%d" fill="none" '
                   'stroke="%s" stroke-width="4"/>' % (w - 10, h - 10, INK))
    out.append(body)
    out.append('</svg>')
    return "\n".join(out) + "\n"


def txt(x, y, s, size=18, anchor="middle", fill=INK, w=800, rot=None,
        ls=None, op=None, stroke=None, sw=0):
    a = ['x="%g"' % x, 'y="%g"' % y, 'font-size="%g"' % size,
         'text-anchor="%s"' % anchor, 'font-weight="%d"' % w, 'fill="%s"' % fill]
    if rot:
        a.append('transform="rotate(%g %g %g)"' % (rot, x, y))
    if ls:
        a.append('letter-spacing="%g"' % ls)
    if op is not None:
        a.append('opacity="%g"' % op)
    if stroke:
        a.append('stroke="%s" stroke-width="%g"' % (stroke, sw))
    return '<text %s>%s</text>' % (" ".join(a), esc(s))


def line(x1, y1, x2, y2, color=INK, wd=3, dash=None, cap="round", op=None):
    a = ['x1="%g"' % x1, 'y1="%g"' % y1, 'x2="%g"' % x2, 'y2="%g"' % y2,
         'stroke="%s"' % color, 'stroke-width="%g"' % wd, 'stroke-linecap="%s"' % cap]
    if dash:
        a.append('stroke-dasharray="%s"' % dash)
    if op is not None:
        a.append('opacity="%g"' % op)
    return '<line %s/>' % " ".join(a)


def pth(d, fill="none", stroke=INK, wd=3, dash=None, op=None,
        cap="round", join="round"):
    a = ['d="%s"' % d, 'fill="%s"' % fill]
    if stroke:
        a.append('stroke="%s"' % stroke)
        a.append('stroke-width="%g"' % wd)
        a.append('stroke-linejoin="%s"' % join)
        a.append('stroke-linecap="%s"' % cap)
    if dash:
        a.append('stroke-dasharray="%s"' % dash)
    if op is not None:
        a.append('opacity="%g"' % op)
    return '<path %s/>' % " ".join(a)


def circ(cx, cy, r, fill="none", stroke=INK, wd=3, op=None):
    a = ['cx="%g"' % cx, 'cy="%g"' % cy, 'r="%g"' % r, 'fill="%s"' % fill]
    if stroke:
        a.append('stroke="%s" stroke-width="%g"' % (stroke, wd))
    if op is not None:
        a.append('opacity="%g"' % op)
    return '<circle %s/>' % " ".join(a)


def rect(x, y, w, h, fill="none", stroke=INK, wd=3, op=None, rx=0):
    a = ['x="%g"' % x, 'y="%g"' % y, 'width="%g"' % w, 'height="%g"' % h,
         'fill="%s"' % fill]
    if stroke:
        a.append('stroke="%s" stroke-width="%g"' % (stroke, wd))
    if op is not None:
        a.append('opacity="%g"' % op)
    if rx:
        a.append('rx="%g"' % rx)
    return '<rect %s/>' % " ".join(a)


def g(body, tx=0.0, ty=0.0, s=1.0, rot=None, cx=None, cy=None):
    t = "translate(%g %g)" % (tx, ty)
    if s != 1.0:
        t += " scale(%g)" % s
    if rot:
        t += " rotate(%g %g %g)" % (rot, cx or 0, cy or 0)
    return '<g transform="%s">%s</g>' % (t, body)


def poly(pts, fill="none", stroke=INK, wd=3, close=True, op=None, join="round"):
    d = "M " + " L ".join("%g %g" % (x, y) for x, y in pts) + (" Z" if close else "")
    return pth(d, fill=fill, stroke=stroke, wd=wd, op=op, join=join)


def arrow(x1, y1, x2, y2, color=INK, wd=4, head=13, dash=None, op=None):
    """带箭头的线段（箭头按线段方向自动旋转）。"""
    d = math.hypot(x2 - x1, y2 - y1) or 1.0
    ux, uy = (x2 - x1) / d, (y2 - y1) / d
    bx, by = x2 - ux * head * 0.92, y2 - uy * head * 0.92
    out = [line(x1, y1, bx, by, color, wd, dash=dash, op=op)]
    px, py = -uy, ux
    h = head * 0.52
    out.append(poly([(x2, y2), (bx + px * h, by + py * h), (bx - px * h, by - py * h)],
                    fill=color, stroke=None))
    return "".join(out)


def arc_arrow(cx, cy, r, a0, a1, color=INK, wd=4, head=13, sweep=1):
    """圆弧箭头：a0→a1 为角度（度，0=正右，逆时针为正——数学惯例）。"""
    ra0, ra1 = math.radians(a0), math.radians(a1)
    x0, y0 = cx + r * math.cos(ra0), cy - r * math.sin(ra0)
    x1, y1 = cx + r * math.cos(ra1), cy - r * math.sin(ra1)
    large = 1 if abs(a1 - a0) > 180 else 0
    sw = 1 if sweep else 0
    out = [pth("M%g %gA%g %g 0 %d %d %g %g" % (x0, y0, r, r, large, sw, x1, y1),
               stroke=color, wd=wd)]
    # 箭头方向 = 圆弧在终点的切向
    tang = ra1 + (math.pi / 2 if sweep else -math.pi / 2)
    ux, uy = math.cos(tang), -math.sin(tang)
    bx, by = x1 - ux * head * 0.92, y1 - uy * head * 0.92
    px, py = -uy, ux
    h = head * 0.52
    out.append(line(x1, y1, bx, by, color, wd))
    out.append(poly([(x1, y1), (bx + px * h, by + py * h), (bx - px * h, by - py * h)],
                    fill=color, stroke=None))
    return "".join(out)


def curve(pts, color=INK, wd=3, tension=0.36, dash=None, fill="none", op=None):
    """过点的平滑曲线（Catmull-Rom → 三次贝塞尔），用于气温曲线等。"""
    if len(pts) < 2:
        return ""
    p = list(pts)
    d = "M%g %g" % p[0]
    for i in range(len(p) - 1):
        p0 = p[i - 1] if i > 0 else p[0]
        p1, p2 = p[i], p[i + 1]
        p3 = p[i + 2] if i + 2 < len(p) else p[-1]
        c1 = (p1[0] + (p2[0] - p0[0]) * tension / 2,
              p1[1] + (p2[1] - p0[1]) * tension / 2)
        c2 = (p2[0] - (p3[0] - p1[0]) * tension / 2,
              p2[1] - (p3[1] - p1[1]) * tension / 2)
        d += "C%g %g %g %g %g %g" % (c1[0], c1[1], c2[0], c2[1], p2[0], p2[1])
    return pth(d, fill=fill, stroke=color, wd=wd, dash=dash, op=op)


# ---------------------------------------------------------------- 气象图元
CLOUD_UNIT = ("M 22 70C 6 70 1 53 16 46C 12 29 33 18 46 27"
              "C 53 7 83 7 90 28C 109 30 115 51 100 62"
              "C 97 68 92 70 86 70Z")
CLOUD_CX, CLOUD_CY = 58.0, 38.0   # 单位云的视觉中心


def cloud(cx, cy, s=1.0, fill=CLOUD, stroke=INK, wd=3.4, op=None):
    """一朵云。cx,cy 是云的中心，s 为缩放（1.0 时云长约 115px）。"""
    body = pth(CLOUD_UNIT, fill=fill, stroke=stroke, wd=wd / s, op=op)
    return g(body, cx - CLOUD_CX * s, cy - CLOUD_CY * s, s)


def sun(cx, cy, r=26, rays=8, ray_len=None, ray_wd=4, color=GOLD):
    """太阳：实心圆 + 放射状光芒（晴 / 多云的太阳都用它）。"""
    ray_len = ray_len or r * 0.78
    out = [circ(cx, cy, r, fill=color, stroke=INK, wd=3.2)]
    for i in range(rays):
        a = math.radians(i * 360.0 / rays + 90.0 / rays * 0 + 0)
        a = math.radians(i * 360.0 / rays)
        x0, y0 = cx + math.cos(a) * (r + 6), cy + math.sin(a) * (r + 6)
        x1, y1 = cx + math.cos(a) * (r + 6 + ray_len), cy + math.sin(a) * (r + 6 + ray_len)
        out.append(line(x0, y0, x1, y1, INK, ray_wd))
    return "".join(out)


def drop(x, y, s=1.0, color=COLD):
    """雨点（水滴，尖端朝上）。x,y 为水滴上部尖端。"""
    d = ("M 0 0C 3.6 5.4 5.4 8.6 5.4 10.8A 5.4 5.4 0 1 1 -5.4 10.8"
         "C -5.4 8.6 -3.6 5.4 0 0Z")
    return g(pth(d, fill=color, stroke=INK, wd=2.6), x, y, s)


def slant_drop(x, y, s=1.0, color=COLD):
    """斜雨点：阵性降水的雨点画成斜线，用来和"小雨"的竖直雨点区分开。"""
    d = ("M 0 0C 3.4 5 5 8 5 9.8A 5 5 0 1 1 -5 9.8"
         "C -5 8 -3.4 5 0 0Z")
    return g(pth(d, fill=color, stroke=INK, wd=2.6), x, y, s, rot=28, cx=x + 3, cy=y + 10)


def snow(x, y, s=1.0, color=INK):
    """雪花：六根辐条 + 每根中段的小分叉。"""
    out = []
    for i in range(6):
        a = math.radians(i * 60)
        ux, uy = math.cos(a), math.sin(a)
        out.append(line(x - ux * 11, y - uy * 11, x + ux * 11, y + uy * 11, color, 3.4))
        for t in (0.55, 0.85):
            px, py = x + ux * 11 * t, y + uy * 11 * t
            for da in (-40, 40):
                b = a + math.radians(180 + da)
                out.append(line(px, py, px + math.cos(b) * 6.4, py + math.sin(b) * 6.4,
                                color, 2.8))
    return g("".join(out), 0, 0, s)


def hail(x, y, s=1.0, color=SKY):
    """冰雹：等边三角形（初中教材的巧记法就是"两个等边三角形"）。"""
    h = 19.0
    pts = [(x, y - h * 0.62), (x + h * 0.56, y + h * 0.42), (x - h * 0.56, y + h * 0.42)]
    return g(poly(pts, fill=color, stroke=INK, wd=3), 0, 0, s)


def lightning(x, y, s=1.0, color=GOLD):
    """闪电：折线。"""
    d = "M 3 -18L -7 2L 1 2L -3 18L 8 -3L 0 -3Z"
    return g(pth(d, fill=color, stroke=INK, wd=2.6), x, y, s)


def fog_lines(cx, cy, n=4, w=132, gap=19, amp=5.5, color=COLD, wd=7):
    """雾：几条弯曲横杠（人教版巧记："六条弯曲的横杠"）。"""
    out = []
    top = cy - gap * (n - 1) / 2.0
    for i in range(n):
        y = top + i * gap
        d = ("M%g %g q%g %g %g 0 q%g %g %g 0"
             % (cx - w / 2, y, w / 4, -amp, w / 2, w / 4, amp, w / 2))
        out.append(pth(d, stroke=color, wd=wd))
    return "".join(out)


def frost(cx, cy, w=120, color=COLD):
    """霜冻：教材画法是"一个被冻住的盒子"——碗状槽 + 上方霜晶。"""
    out = [pth("M%g %g v-34 a%g %g 0 0 0 %g 0 v34"
               % (cx - w / 2, cy, w / 2, w / 2, w), stroke=INK, wd=4)]
    for i in range(5):
        x = cx - w / 2 + 14 + i * (w - 28) / 4.0
        out.append(line(x, cy - 34, x, cy - 52, color, 3.4))
        out.append(line(x, cy - 40, x - 8, cy - 48, color, 2.6))
        out.append(line(x, cy - 40, x + 8, cy - 48, color, 2.6))
    return "".join(out)


def sandstorm_symbol(cx, cy, s=1.0):
    """沙尘暴：字母 S + 向右的箭头（巧记："在 S 上加箭头"）。"""
    out = [txt(cx - 6, cy + 26, "S", size=96, fill=BROWN, w=900)]
    out.append(arrow(cx + 22, cy, cx + 74, cy, color=BROWN, wd=7, head=20))
    out.append(line(cx + 22, cy + 22, cx + 62, cy + 22, BROWN, 4, op=0.55))
    return g("".join(out), 0, 0, s)


def typhoon_symbol(cx, cy, s=1.0, color=INK):
    """台风：两条反向螺旋臂。"""
    d1 = ("M 0 0C 0 -34 -46 -40 -58 -14C -66 4 -50 26 -28 22"
          "C -14 19 -10 6 -18 0C -24 -5 -33 -1 -33 8")
    out = [pth(d1, stroke=color, wd=6.4, cap="round")]
    d2 = ("M 0 0C 0 34 46 40 58 14C 66 -4 50 -26 28 -22"
          "C 14 -19 10 -6 18 0C 24 5 33 1 33 -8")
    out.append(pth(d2, stroke=color, wd=6.4, cap="round"))
    return g("".join(out), cx, cy, s)


def front_line(pts, kind="cold", color=None, wd=6):
    """锋线：冷锋用蓝色三角、暖锋用红色半圆，三角/半圆指向移动方向。

    关键：三角的**底边**与半圆的**直径**都压在锋线上（圆心落在锋线上），
    只朝线的一侧鼓起 —— 早期版本把半圆圆心放在法向 r 处，直径悬在线外
    r 像素、弧顶才碰到线，整块半圆看起来"骑"在线的上方。
    """
    color = color or (COLD if kind == "cold" else WARM)
    out = [curve(pts, color=color, wd=wd, tension=0.3)]
    # 沿折线等距放标记
    n = len(pts)
    for i in range(1, n - 1):
        x, y = pts[i]
        x2, y2 = pts[i + 1]
        dx, dy = x2 - x, y2 - y
        L = math.hypot(dx, dy) or 1
        ux, uy = dx / L, dy / L
        px, py = -uy, ux            # 法向（指向"行进方向"一侧，调用方保证 pts 顺序）

        def half_disc(r, fill):
            """直径与锋线重合的半圆（sweep=1 ⇒ 弧向 -p 侧鼓起）。"""
            return pth("M%g %g a%g %g 0 0 %d %g %g"
                       % (x - ux * r, y - uy * r, r, r, 1, ux * 2 * r, uy * 2 * r),
                       fill=fill, stroke=None)

        if kind == "cold":
            h = 13.0
            out.append(poly([(x + px * h * 1.5, y + py * h * 1.5),
                             (x + ux * h * 0.9, y + uy * h * 0.9),
                             (x - ux * h * 0.9, y - uy * h * 0.9)],
                            fill=color, stroke=None))
        elif kind == "warm":
            out.append(half_disc(10.0, color))
        else:  # 准静止锋：三角与半圆交替，分列两侧
            if i % 2 == 0:
                h = 12.0
                out.append(poly([(x + px * h * 1.5, y + py * h * 1.5),
                                 (x + ux * h * 0.9, y + uy * h * 0.9),
                                 (x - ux * h * 0.9, y - uy * h * 0.9)],
                                fill=COLD, stroke=None))
            else:
                out.append(half_disc(9.0, WARM))
    return "".join(out)


def wind_barb(cx, cy, from_deg, level, shaft=118, r=9, compass=True,
              barbs_at_tip=True):
    """风向风速符号。
    from_deg：风的**来向**方位角（0=北，90=东，顺时针），风杆指向来向。
    level：风力等级；一道风尾=2 级，半道=1 级，一面风旗（三角）=8 级。
    """
    rad = math.radians(from_deg)
    ux, uy = math.sin(rad), -math.cos(rad)          # 风杆方向（指向来向）
    tipx, tipy = cx + ux * shaft, cy + uy * shaft
    bx, by = -uy, ux                                # 风羽伸出的方向（风杆右侧）
    out = []
    if compass:
        out.append(circ(cx, cy, shaft + 34, stroke=INK2, wd=2, op=0.45))
        for ang, label in ((0, "北"), (90, "东"), (180, "南"), (270, "西")):
            a = math.radians(ang)
            lx, ly = cx + math.sin(a) * (shaft + 54), cy - math.cos(a) * (shaft + 54)
            out.append(txt(lx, ly + 7, label, size=21, fill=INK2))
        for ang in (0, 90, 180, 270):
            a = math.radians(ang)
            out.append(line(cx + math.sin(a) * (shaft + 40), cy - math.cos(a) * (shaft + 40),
                            cx + math.sin(a) * (shaft + 48), cy - math.cos(a) * (shaft + 48),
                            INK2, 3))
    out.append(line(cx, cy, tipx, tipy, INK, 5))
    out.append(circ(cx, cy, r, fill=PAPER2, stroke=INK, wd=4))

    flags, rest = divmod(level, 8)
    full, half = divmod(rest, 2)
    pos = 0.0

    def _at(d):
        return tipx - ux * d, tipy - uy * d

    for _ in range(flags):
        x, y = _at(pos)
        out.append(poly([(x, y), (x + bx * 30 - ux * 24, y + by * 30 - uy * 24),
                         (x - ux * 24, y - uy * 24)], fill=INK, stroke=None))
        pos += 26
    for _ in range(full):
        x, y = _at(pos)
        out.append(line(x, y, x + bx * 32, y + by * 32, INK, 4.6))
        pos += 15
    if half:
        x, y = _at(pos)
        out.append(line(x, y, x + bx * 16, y + by * 16, INK, 4.6))
    return "".join(out)


# ---------------------------------------------------------------- 落盘
def save(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    return path
