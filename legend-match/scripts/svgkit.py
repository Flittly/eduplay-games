# -*- coding: utf-8 -*-
"""
svgkit —— 「地图图例消消乐」矢量素材绘图工具库
============================================================
本仓库所有小游戏共用一套粗野派（neo-brutalist）视觉语言：
纸底 + 纯色 + 3px 粗墨线 + 硬投影 + 零圆角。地图图例符号也照这套走。

约定
----
* 所有颜色取常量，不写魔法值。
* 文字一律用 <text>，字体族用单引号包裹（双引号会提前闭合属性 → 非法 XML →
  <img> 静默失败，本仓库 2026-09-12 导出长图时踩过）。
* **图例符号卡上绝不写图例名称** —— 那是配对题的答案。只有符号本身自带的
  必要注记（比例尺数字、等温线的 20℃、指向标的 N）才允许出现。
* 每个绘图函数返回 SVG 片段字符串，由 make_legends.py 拼装 + 落盘。
"""

import math
import os
import random

# ---------------------------------------------------------------- 调色板
INK = "#1a1a1a"          # 主墨线
INK2 = "#5a5044"         # 次级灰
PAPER = "#f2e8d5"        # 纸底（与游戏 :root --paper 一致）
PAPER2 = "#fbf6ea"       # 高亮纸面
RED = "#cc0000"          # 朱红（首都 / 矿产 / 路径）
GOLD = "#d4a843"         # 金
BROWN = "#8b4513"        # 棕（沙 / 土）
WATER = "#3d7fb0"        # 水体蓝
WATER_L = "#9dc4dd"      # 浅水 / 冰
GREEN = "#2f7d4f"        # 植被
COLD = "#2d6ca8"         # 冷色
VIOLET = "#6b4f9e"       # 电 / 核

FONT = ("'Arial Black','Franklin Gothic Heavy','Microsoft YaHei',"
        "'PingFang SC',sans-serif")

W = H = 240               # 图例画布尺寸（正方形）
C = 120.0                 # 画布中心

# ---------------------------------------------------------------- 基础封装


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def wrap(w, h, body, bg=PAPER, border=True):
    out = ['<svg xmlns="http://www.w3.org/2000/svg" '
           'viewBox="0 0 %d %d" width="%d" height="%d" font-family="%s">'
           % (w, h, w, h, FONT)]
    out.append('<rect x="0" y="0" width="%d" height="%d" fill="%s"/>' % (w, h, bg))
    if border:
        out.append('<rect x="5" y="5" width="%d" height="%d" fill="none" '
                   'stroke="%s" stroke-width="4"/>' % (w - 10, h - 10, INK))
    out.append(body)
    out.append('</svg>')
    return "\n".join(out) + "\n"


def txt(x, y, s, size=18, anchor="middle", fill=INK, w=800, rot=None,
        ls=None, op=None):
    a = ['x="%g"' % x, 'y="%g"' % y, 'font-size="%g"' % size,
         'text-anchor="%s"' % anchor, 'font-weight="%d"' % w, 'fill="%s"' % fill]
    if rot:
        a.append('transform="rotate(%g %g %g)"' % (rot, x, y))
    if ls:
        a.append('letter-spacing="%g"' % ls)
    if op is not None:
        a.append('opacity="%g"' % op)
    return '<text %s>%s</text>' % (" ".join(a), esc(s))


def line(x1, y1, x2, y2, color=INK, wd=3, dash=None, cap="round", op=None):
    a = ['x1="%g"' % x1, 'y1="%g"' % y1, 'x2="%g"' % x2, 'y2="%g"' % y2,
         'stroke="%s"' % color, 'stroke-width="%g"' % wd,
         'stroke-linecap="%s"' % cap]
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


def arrow(x1, y1, x2, y2, color=INK, wd=6, head=18, dash=None, op=None):
    d = math.hypot(x2 - x1, y2 - y1) or 1.0
    ux, uy = (x2 - x1) / d, (y2 - y1) / d
    bx, by = x2 - ux * head * 0.9, y2 - uy * head * 0.9
    out = [line(x1, y1, bx, by, color, wd, dash=dash, op=op, cap="butt")]
    px, py = -uy, ux
    h = head * 0.55
    out.append(poly([(x2, y2), (bx + px * h, by + py * h), (bx - px * h, by - py * h)],
                    fill=color, stroke=None))
    return "".join(out)


def arrow_d(x, y, deg, length, color=INK, wd=6, head=18, dash=None):
    """从 (x,y) 沿 deg（度，0=正右，顺时针为正，屏幕坐标）画箭头。"""
    r = math.radians(deg)
    return arrow(x, y, x + math.cos(r) * length, y + math.sin(r) * length,
                 color=color, wd=wd, head=head, dash=dash)


def curve(pts, color=INK, wd=3, tension=0.36, dash=None, fill="none", op=None):
    """过点的平滑曲线（Catmull-Rom → 三次贝塞尔）。"""
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


def star(cx, cy, R, r=None, n=5, fill=GOLD, stroke=INK, wd=4, rot=-90):
    """正 n 角星。rot=-90 让一个角朝正上。"""
    r = r or R * 0.42
    pts = []
    for i in range(n * 2):
        ang = math.radians(rot + i * 180.0 / n)
        rad = R if i % 2 == 0 else r
        pts.append((cx + math.cos(ang) * rad, cy + math.sin(ang) * rad))
    return poly(pts, fill=fill, stroke=stroke, wd=wd)


def dots(seed, cx, cy, rx, ry, n, rmin=2.0, rmax=4.4, color=INK, op=None):
    """在椭圆范围内撒 n 个点（沙点 / 珊瑚礁 / 沙尘）。种子固定 ⇒ 可复现。"""
    rnd = random.Random(seed)
    out = []
    for _ in range(n):
        a = rnd.random() * math.tau
        k = math.sqrt(rnd.random())
        x = cx + math.cos(a) * rx * k
        y = cy + math.sin(a) * ry * k
        r = rmin + rnd.random() * (rmax - rmin)
        out.append(circ(x, y, r, fill=color, stroke=None, op=op))
    return "".join(out)


def waves(cx, cy, w, n=3, gap=15, color=WATER, wd=5, amp=7):
    """几条水波纹（海 / 湖泊 / 冰川水的通用底纹）。"""
    out = []
    top = cy - gap * (n - 1) / 2.0
    for i in range(n):
        y = top + i * gap
        d = ("M%g %g q%g %g %g 0 q%g %g %g 0"
             % (cx - w / 2, y, w / 4, -amp, w / 2, w / 4, amp, w / 2))
        out.append(pth(d, stroke=color, wd=wd))
    return "".join(out)


def hatch(x0, y0, x1, y1, step, color=INK, wd=5):
    """在矩形内画等距竖线（工事 / 坝体 / 城垛底纹）。"""
    out = []
    x = x0 + step * 0.5
    while x < x1:
        out.append(line(x, y0, x, y1, color, wd, cap="butt"))
        x += step
    return "".join(out)


# ---------------------------------------------------------------- 落盘
def save(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    return path
