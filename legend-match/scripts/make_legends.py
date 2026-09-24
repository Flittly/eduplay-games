# -*- coding: utf-8 -*-
"""
make_legends —— 生成「地图图例消消乐」的 73 个图例矢量符号 + legends.json
============================================================
依据两条线：
1. 人教版初中地理（七上 / 七下 / 八上 / 八下）教材与配套地图册上出现的
   常见地图图例；
2. 教材图册的**标准「常用图例」页**（居民点 / 公路 / 铁路 / 高速铁路 /
   高速公路 / 山峰 / 火山 / 洲界 / 长城 / 关隘 / 水库 / 水电站 / 国界 /
   未定国界 / 机场 / 沙漠 / 时令河、湖 / 中国省、自治区、直辖市界 / 港口 /
   航海线 / 瀑布 / 常年河、湖）—— 这一页的每一条都必须在库里找得到对应条目。

按「居民点与城市 / 行政区划与界线 / 地形与地貌 / 河流与水域 / 交通与航线 /
资源与能源 / 人文景观 / 地图基础 / 气候图线」九类组织。
每条另有 `tier` 字段决定它进哪个模式：
**basic** → 初中组（教材正文必会）；**advanced** → 只进高级组（细分辨形条目）。

三条硬约束（自检里会强制断言）：
1. **符号卡上绝不能出现图例名称文字** —— 那是配对题的答案，写上去游戏就没得玩了。
   （度数、水深、比例尺数字这类**符号自带**的注记是允许的。）
2. SVG 必须是合法 XML（字体族只用单引号），否则 <img> 会静默失败。
3. 每条都必须标 tier，且 basic / advanced 的条数必须是 54 / 19 —— 漏标一条会
   静默掉进 basic，让「初中组」悄悄变大而不报错。

用法：
    python scripts/make_legends.py            # 生成 73 个 svg + data/legends.json
    python scripts/make_legends.py --sheet    # 额外输出 montage.jpg 拼版供目视复核
"""

import json
import math
import os
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from svgkit import (  # noqa: E402
    BROWN, C, COLD, GOLD, GREEN, H, INK, INK2, PAPER, PAPER2, RED, VIOLET,
    WATER, WATER_L, W, arrow, arrow_d, circ, curve, dots, esc, g, hatch, line,
    poly, pth, rect, save, star, txt, waves, wrap,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_SVG = os.path.join(ROOT, "public", "assets", "legends")
OUT_JSON = os.path.join(ROOT, "public", "data", "legends.json")


# ================================================================ 通用图元
def blob(cx, cy, r, seed, wob=0.13, n=16, ry=0.86, wd=6, stroke=INK,
         fill="none", dash=None):
    """不规则闭合“水塘形”曲线（湖泊 / 水库 / 等高线都用它）。"""
    import random
    rnd = random.Random(seed)
    pts = []
    for i in range(n):
        a = i * math.tau / n
        rr = r * (1.0 + (rnd.random() - 0.5) * 2 * wob)
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr * ry))
    pts.append(pts[0])
    # dash 必须真的传下去 —— 早期版本收了参数却没用，时令湖被画成了实线。
    return curve(pts, color=stroke, wd=wd, fill=fill, tension=0.4, dash=dash)


def dbl(d, color=WATER, outer=20, inner=9, dash=None):
    """双线河道的画法：粗线打底 + 同路径的纸色细线挖空中间，得到两条平行线。

    inner/outer 用**同一个 dash** 且 cap=butt，两层的分段才能严格对齐。
    """
    return (pth(d, stroke=color, wd=outer, dash=dash, cap="butt")
            + pth(d, stroke=PAPER, wd=inner, dash=dash, cap="butt"))


def mtn(pts, fill=PAPER2):
    """山体轮廓（闭合折线 + 纸色填充）。"""
    return poly(pts, fill=fill, stroke=INK, wd=7)


# ================================================================ 行政区划与界线
# 四条界线共用一条几何路径，**只有线型不同** —— 这是刻意的：
# 界线的区别本来就在「实双线 / 虚双线 / 点划线 / 短点线」这四种线型上，
# 早期版本把国界画成直线、省界画成波浪线，学生完全可以靠"弯不弯"去猜，
# 反而绕开了真正要考的能力。
BOUNDARY_D = "M16 130 C 56 106, 84 148, 120 126 S 188 100, 224 128"


def d_guojie():
    """国界线：最醒目的双实线。"""
    return dbl(BOUNDARY_D, color=INK, outer=15, inner=7)


def d_weiding_guojie():
    """未定国界：双虚线 —— 与国界同为双线，但一段段断开。"""
    return dbl(BOUNDARY_D, color=INK, outer=15, inner=7, dash="26 14")


def d_shengjie():
    """省、自治区、直辖市界：一长一短的点划线。"""
    return pth(BOUNDARY_D, stroke=INK, wd=8, dash="34 12 5 12", cap="butt")


def d_diqujie():
    """地区界：较短的等长点线。"""
    return pth(BOUNDARY_D, stroke=INK, wd=7, dash="12 12", cap="butt")


def d_zhoujie():
    """洲界：**红色**的一长两短点划线。

    与省界共用 BOUNDARY_D 这条几何路径，差别只在"线型 + 颜色" —— 界线的
    考点本来就在线型上，不该让学生靠"弯不弯"去猜（口径见 BOUNDARY_D 上方）。
    洲界单加**颜色**这一维，是因为它和另外三条界线（国界 / 省界 / 地区界）
    在形状上确实同族，不给颜色就真的会看混。
    """
    return pth(BOUNDARY_D, stroke=RED, wd=8, dash="30 12 5 12 5 12", cap="butt")


def d_tebie_xingzhengqujie():
    """特别行政区界：**棕色**的等长点线（比地区界更长、更疏）。

    港澳的界线在图册上是单列的（八上附录也单列一条）。用棕色 + 更疏的点距，
    与地区界（黑·12 12）拉开"颜色 + 疏密"两处差别，避免学生只靠猜。
    """
    return pth(BOUNDARY_D, stroke=BROWN, wd=8, dash="26 11", cap="butt")


def d_shoudu():
    """首都：红色五角星。"""
    return star(C, C + 4, 84, fill=RED, stroke=INK, wd=5)


def d_shenghui():
    """省级行政中心：双圆圈。"""
    return (circ(C, C, 62, fill=PAPER2, stroke=INK, wd=7)
            + circ(C, C, 26, fill="none", stroke=INK, wd=6))


def d_chengshi():
    """一般城市：单圆圈（比省级行政中心小，里面没有套圈）。"""
    return circ(C, C, 40, fill=PAPER2, stroke=INK, wd=8)


def d_waiguo_shoudu():
    """外国首都：黑色五角星，外面套一个圈。"""
    return (star(C, C + 3, 56, fill=INK, stroke=INK, wd=3)
            + circ(C, C, 86, fill="none", stroke=INK, wd=5.5))


# ================================================================ 居民点与城市
# 教材上「居民点」是和界线**分开**的一组（八上附录「本书常用地图图例」就是
# 这么分的：居民点 / 境界线 / 水系 / 地形地势 / 交通 / 其他）。v1.0.0 之前
# 首都、省级行政中心、一般城市、外国首都挂在「行政区划与界线」下 ——
# 那是分类错位，这一版拆出独立类别。
def d_jumindian():
    """居民点：三个大小不一的圆圈，斜着一路排开。

    这里画成三个**非同心**、直径递变的圆，并且实心 / 空心交错：
    - 与「省级行政中心」的**同心双圈**不同（这里是三个散开的圈）
    - 与「一般城市」的**单个**圆圈不同（这里是一簇）
    缩小到牌面上的 124px 也仍然读得出是"一簇大小不同的居民点"，
    而不会被当成某一个具体等级的城市。
    """
    return "".join([
        circ(62, 68, 15, fill=PAPER2, stroke=INK, wd=8),
        circ(118, 120, 32, fill=INK, stroke=INK, wd=6),
        circ(178, 176, 22, fill=PAPER2, stroke=INK, wd=8),
    ])


# ================================================================ 地形与地貌
def d_denggaoxian():
    """等高线：一圈套一圈的闭合曲线。"""
    return (blob(C, C, 98, 21, wd=4.6)
            + blob(C + 4, C - 2, 72, 22, wd=4.6)
            + blob(C - 3, C + 3, 47, 23, wd=4.6)
            + blob(C + 2, C, 23, 24, wd=4.6))


def d_shanfeng():
    """山峰：单峰山体 + 顶点的实心三角标记（和铁矿的纯黑三角区分开）。"""
    out = [mtn([(26, 202), (120, 82), (214, 202)])]
    out.append(poly([(120, 82), (144, 124), (96, 124)], fill=INK, stroke=None))
    return "".join(out)


def d_huoshan():
    """火山：锥形山体 + 火山口 + 喷出的红色岩浆与烟团。"""
    out = [mtn([(34, 196), (86, 100), (154, 100), (206, 196)]),
           pth("M86 100 q34 -32 68 0", stroke=INK, wd=7),
           pth("M120 96 C 106 62, 140 52, 124 20", stroke=RED, wd=12),
           circ(126, 28, 13, fill=RED, stroke=INK, wd=4),
           circ(100, 52, 9, fill=RED, stroke=INK, wd=3.4),
           circ(150, 46, 9, fill=RED, stroke=INK, wd=3.4)]
    return "".join(out)


def d_shamo():
    """沙漠：密集的棕色沙点 + 新月形沙丘弧。"""
    return (dots(7, C, C, 86, 70, 165, 2.0, 4.4, BROWN)
            + pth("M36 60 q40 -34 76 0", stroke=BROWN, wd=7)
            + pth("M132 182 q40 -32 76 0", stroke=BROWN, wd=7))


def d_zhaoze():
    """沼泽：长短交替的成组横线 + 几点芦苇（湿地水草）。

    早期版本每条横线上都竖着三根短毛，整体看起来像一把梯子，认得出来才怪。
    """
    out = []
    ys = (70, 104, 138, 172)
    for i, y in enumerate(ys):
        w = 118 if i % 2 == 0 else 76
        out.append(line(C - w / 2, y, C + w / 2, y, INK, 8, cap="butt"))
    for x, y in ((56, 186), (104, 186), (150, 186), (188, 186)):
        out.append(line(x, y, x, y - 20, GREEN, 4.4))
        out.append(line(x, y - 12, x - 9, y - 22, GREEN, 3.6))
        out.append(line(x, y - 12, x + 9, y - 22, GREEN, 3.6))
    return "".join(out)


def d_bingchuan():
    """冰川：山谷里的蓝色冰舌。"""
    return (mtn([(28, 194), (82, 88), (120, 122), (158, 88), (212, 194)])
            + pth("M94 126 C 84 154, 108 168, 98 198 L142 198 "
                  "C 132 168, 156 154, 146 126 Z",
                  fill=WATER_L, stroke=WATER, wd=6)
            + line(104, 154, 136, 154, WATER, 4)
            + line(102, 174, 138, 174, WATER, 4))


def d_changnian_jixue():
    """常年积雪：山顶那一顶浅蓝色雪帽。"""
    return (mtn([(28, 198), (84, 84), (120, 122), (156, 84), (212, 198)])
            + poly([(62, 130), (84, 84), (120, 122), (156, 84), (178, 130)],
                   fill=WATER_L, stroke=WATER, wd=5))


def d_haianxian():
    """海岸线：陆地（纸色）与海洋（浅蓝）之间那条实线。"""
    coast = "M8 112 C 50 84, 84 138, 124 108 S 192 80, 232 110"
    land = ("M8 8 L232 8 L232 110 C 192 80, 150 100, 124 108 "
            "C 84 138, 50 84, 8 112 Z")
    sea = ("M8 112 C 50 84, 84 138, 124 108 S 192 80, 232 110 "
           "L232 232 L8 232 Z")
    return (pth(land, fill=PAPER2, stroke=None)
            + pth(sea, fill=WATER_L, stroke=None)
            + pth(coast, stroke=INK, wd=10)
            + waves(C, 158, 190, n=2, gap=26, color=WATER, wd=5.5, amp=9))


def d_shanhu_jiao():
    """珊瑚礁：成排的小圆弧礁体 + 礁沙点。"""
    out = []
    for row, (y, n) in enumerate(((96, 6), (128, 6))):
        for i in range(n):
            x = 44 + i * 30 + (15 if row % 2 else 0)
            out.append(pth("M%d %d q15 -26 30 0" % (x, y), stroke=RED, wd=6))
    out.append(dots(31, C, 178, 74, 20, 44, 2.6, 5.0, BROWN))
    return "".join(out)


def d_sanjiaozhou():
    """三角洲：河流入海处泥沙堆积、河道分成几汊。"""
    return (pth("M120 18 L120 96", stroke=WATER, wd=24)
            + pth("M120 18 L120 96", stroke=PAPER, wd=12)
            + pth("M120 92 C 98 126, 74 146, 54 176", stroke=WATER, wd=17)
            + pth("M120 92 L120 180", stroke=WATER, wd=17)
            + pth("M120 92 C 142 126, 166 146, 186 176", stroke=WATER, wd=17)
            + line(16, 190, 224, 190, INK, 7)
            + waves(C, 212, 190, n=1, gap=0, color=WATER, wd=5, amp=8))


def d_dengshenxian():
    """等深线：**蓝色**的闭合曲线，一圈套一圈往深处收，线上注水深。

    等深线与等高线是成对讲的（七上「地形图的判读」），所以两处差别都做实：
    颜色（蓝 vs 黑）+ 注记的正负（这里写 -50 / -200）。注记只写数字，
    绝不会出现"等深线"三个字，否则等于把答案印在牌面上。
    """
    return (blob(C - 4, C + 2, 94, 71, wd=5.4, stroke=WATER)
            + blob(C + 2, C - 2, 62, 72, wd=5.4, stroke=WATER)
            + blob(C - 2, C + 4, 30, 73, wd=5.4, stroke=WATER)
            + txt(58, 74, "-50", size=19, fill=WATER)
            + txt(178, 180, "-200", size=19, fill=WATER))


def d_haigou():
    """海沟：弧形深槽 —— 一条粗弧线下切，齿**全部长在同一侧**。

    齿只指向深海一侧，这是它与"海岸线 / 等深线"的分界：海沟不是一条平平的
    线，而是"一侧陡、一侧缓"的槽。槽底再补一条蓝色细虚线示意深水。
    """
    out = [pth("M18 68 C 74 132, 166 132, 222 68", stroke=INK, wd=10)]
    for i in range(11):
        t = i / 10.0
        x = 18 + t * 204
        y = 68 + 4 * 64 * t * (1 - t)
        out.append(line(x, y, x, y + 26, INK, 5, cap="butt"))
    out.append(pth("M18 68 C 74 186, 166 186, 222 68", stroke=WATER, wd=6,
                   dash="18 12"))
    return "".join(out)


def d_bankuai_jiexian():
    """板块界线：锯齿状折线 + 上方一对相向的箭头（挤压 / 消亡边界）。

    教材上的板块分界线就是一条**锯齿线**，箭头表示相邻板块的运动方向。
    "锯齿"是它与长城唯一可能撞形的地方：长城的齿是长在一根横梁**上方**的
    矩形垛口，这里是一整条折线本体锯齿化，两者读起来完全不同。
    """
    zig = [(18, 168), (46, 120), (74, 168), (102, 120), (130, 168),
           (158, 120), (186, 168), (214, 122)]
    return "".join([
        poly(zig, fill="none", stroke=INK, wd=9, close=False),
        # 箭头压在锯齿峰顶上方 30px 处：第一版放在 y=46，离锯齿 74px，
        # 读起来像"两个不相干的箭头 + 一条锯齿线"，不成为一组。
        arrow(62, 90, 110, 90, color=RED, wd=7, head=19),
        arrow(178, 90, 130, 90, color=RED, wd=7, head=19),
    ])


# ================================================================ 河流与水域
def d_changnian_he():
    """常年河：双线河道，有一条支流汇入。"""
    main = "M18 74 C 66 74, 74 124, 118 124 S 172 176, 222 176"
    trib = "M60 24 C 62 56, 86 68, 104 74"
    return dbl(main, outer=22, inner=10) + dbl(trib, outer=15, inner=7)


def d_shiling_he():
    """时令河：虚线河道（只在雨季有水）。"""
    return pth("M20 66 C 74 66, 80 126, 126 126 S 180 182, 220 182",
               stroke=WATER, wd=9, dash="22 12")


def d_yunhe():
    """运河：笔直的双线河道，中间带一道道船闸横档。"""
    d = "M20 118 L220 118"
    out = [dbl(d, outer=26, inner=13)]
    for x in range(44, 210, 34):
        out.append(line(x, 108, x, 128, INK, 4.4, cap="butt"))
    return "".join(out)


def d_shuiku():
    """水库：拦河蓄水的人工湖 —— 水面被一道拦河坝截断。

    早期版本把坝画成一根压在湖面左缘上的黑竖条，看着像"黑棍贴在湖边上"：
    坝没有起到"坝"的作用。现在水面左缘是一段**直线**（贴着坝体），
    坝是一块竖长实体、上下都超出水面，外侧再加三道坝垛，读起来才是一道坝。
    """
    # 水面：左缘平直（贴坝），右侧是不规则岸线
    water = ("M48 54 C 104 36, 158 56, 182 92 C 206 128, 198 176, 162 198 "
             "C 126 220, 74 208, 52 182 L 48 54 Z")
    out = [pth(water, fill=WATER_L, stroke=WATER, wd=6)]
    out.append(waves(126, 118, 96, n=3, gap=24, color=WATER, wd=5, amp=8))
    # 拦河坝：竖长实体，比水面上下各多出一截；左侧三道坝垛
    out.append(rect(30, 38, 18, 176, fill=INK, stroke=INK, wd=3))
    for y in (74, 126, 178):
        out.append(line(12, y, 30, y, INK, 7, cap="butt"))
    return "".join(out)


def d_hupo():
    """湖泊：闭合的蓝色水面轮廓。"""
    return (blob(C, C, 92, 51, wd=7, stroke=WATER, fill=WATER_L)
            + waves(C, C, 130, n=3, gap=24, color=WATER, wd=5, amp=9))


def d_shiling_hu():
    """时令湖：虚线轮廓的水面（旱季会干涸）。"""
    return blob(C, C, 92, 51, wd=7, stroke=WATER, dash="20 12")


def d_pubu():
    """瀑布：河流在陡崖处跌落 —— 上游窄、过崖后河道变宽，崖下溅起水花。

    崖线（梳状齿）必须与河道同轴：早期把崖线中心放在 x=112 而水轴在 x=104，
    8px 的偏移让小图上看成了"梳子挂在水管一侧"。
    """
    out = [dbl("M104 18 L104 102", outer=18, inner=8),
           line(34, 114, 172, 114, INK, 11, cap="butt")]
    for x in range(42, 160, 16):
        out.append(line(x, 114, x + 10, 132, INK, 5.5))
    out.append(dbl("M104 130 L104 204", outer=40, inner=30))
    out.append(dbl("M104 130 L104 204", outer=26, inner=16))
    out.append(dots(61, 104, 186, 52, 20, 18, 2.6, 5.4, WATER))
    return "".join(out)


def d_quan():
    """泉：圆圈中间一点，下面是涌出的水波。"""
    return (circ(C, C - 20, 42, fill=PAPER2, stroke=INK, wd=7)
            + circ(C, C - 20, 12, fill=WATER, stroke=INK, wd=4)
            + waves(C, C + 62, 116, n=2, gap=21, color=WATER, wd=5, amp=8))


def d_haixia():
    """海峡：两块陆地之间那条蓝色的狭窄水道。"""
    top = "M8 8 L232 8 L232 74 C 190 92, 150 90, 118 82 C 84 74, 44 92, 8 100 Z"
    bot = "M8 232 L232 232 L232 166 C 190 148, 150 150, 118 158 C 84 166, 44 148, 8 140 Z"
    strait = ("M8 100 C 44 92, 84 74, 118 82 C 150 90, 190 92, 232 74 "
              "L232 166 C 190 148, 150 150, 118 158 C 84 166, 44 148, 8 140 Z")
    return (pth(top, fill=PAPER2, stroke=INK, wd=7)
            + pth(bot, fill=PAPER2, stroke=INK, wd=7)
            + pth(strait, fill=WATER_L, stroke=WATER, wd=5)
            + waves(122, 118, 92, n=1, gap=0, color=WATER, wd=4.4, amp=6))


def d_yinshui_luxian():
    """引水路线：带箭头的双虚线（跨流域调水工程）。"""
    d = "M18 182 C 62 182, 78 112, 124 112 S 184 152, 222 100"
    return (dbl(d, outer=20, inner=9, dash="26 16")
            + arrow(176, 132, 214, 104, color=WATER, wd=5, head=17))


# ================================================================ 交通与航线
def d_tielu():
    """铁路：实线加垂直横档的“花线”。"""
    out = [line(18, C, 222, C, INK, 9, cap="butt")]
    for x in range(28, 222, 17):
        out.append(line(x, 104, x, 136, INK, 6, cap="butt"))
    return "".join(out)


def d_gaosu_tielu():
    """高速铁路：**红线 + 深色横档**的花线。

    与铁路严格同构（实线 + 垂直横档），只把线身换成朱红。这是刻意的，理由
    与 BOUNDARY_D 那条一致：**铁路与高速铁路的区别本来就在颜色上**（黑花线 /
    红花线），让学生靠"像不像虚线"去猜反而绕开了真正要考的能力。

    ⚠️ 踩过的坑（记下来，别再试）：第一版照图册画"红线 + **白**档"，结果
    整条读成了"一串红方块 / 红色虚线"。根因是**白档对纸底的对比度为零** ——
    白档只能表现为红线上的缺口，永远读不出"档"。横档要看得见就必须比纸底深，
    所以这里用 INK 档；同时把红线加到 16px，保证"红"仍然是这条符号的主色。
    """
    out = [line(18, C, 222, C, RED, 16, cap="butt")]
    for x in range(30, 220, 20):
        out.append(line(x, 106, x, 134, INK, 5.5, cap="butt"))
    return "".join(out)


def d_fuxian_tielu():
    """复线铁路：两条并行的“花线”。"""
    out = []
    for y in (106, 134):
        out.append(line(18, y, 222, y, INK, 8, cap="butt"))
        for x in range(28, 222, 17):
            out.append(line(x, y - 13, x, y + 13, INK, 5.5, cap="butt"))
    return "".join(out)


def d_gaosu_gonglu():
    """高速公路：粗双实线，中间是虚线分隔带。"""
    return (line(18, 104, 222, 104, INK, 10, cap="butt")
            + line(18, 136, 222, 136, INK, 10, cap="butt")
            + line(18, C, 222, C, INK, 4, dash="18 13", cap="butt"))


def d_gonglu():
    """公路：弯曲的细双实线。"""
    d1 = "M18 100 C 66 100, 78 142, 122 142 S 178 178, 222 178"
    d2 = "M18 130 C 66 130, 78 172, 122 172 S 178 208, 222 208"
    return pth(d1, stroke=INK, wd=5.5) + pth(d2, stroke=INK, wd=5.5)


def d_suidao():
    """隧道：两端带洞门钩子的虚线。"""
    out = [line(48, C, 192, C, INK, 9, dash="20 15", cap="butt"),
           pth("M48 146 L48 116 L74 116", stroke=INK, wd=8),
           pth("M192 146 L192 116 L166 116", stroke=INK, wd=8)]
    return "".join(out)


def d_qiaoliang():
    """桥梁：道路跨过河道，两岸各一座桥台。"""
    return (dbl("M120 14 L120 226", outer=28, inner=15)
            + line(52, C, 188, C, INK, 10, cap="butt")
            + line(52, 100, 52, 140, INK, 9, cap="butt")
            + line(188, 100, 188, 140, INK, 9, cap="butt"))


def d_hanghaixian():
    """航海线：带箭头的虚线。"""
    d = "M18 182 C 68 182, 84 104, 128 104 S 186 146, 222 92"
    return (pth(d, stroke=INK, wd=7, dash="26 15")
            + arrow(74, 146, 100, 112, color=INK, wd=5, head=16)
            + arrow(156, 128, 188, 108, color=INK, wd=5, head=16))


def d_hangkongxian():
    """航空线：由小圆点串成的点线。"""
    d = "M22 176 C 72 176, 86 100, 130 100 S 190 140, 220 90"
    pts = [(22, 176), (50, 172), (74, 152), (92, 122), (110, 102), (130, 100),
           (152, 112), (172, 132), (196, 124), (220, 90)]
    out = [curve(pts, color=INK2, wd=3, tension=0.4)]
    for x, y in pts:
        out.append(circ(x, y, 6.4, fill=INK, stroke=None))
    out.append(circ(130, 100, 15, fill=PAPER2, stroke=INK, wd=5))
    return "".join(out)


def d_gangkou():
    """港口：船锚符号。"""
    out = [circ(C, 46, 13, fill="none", stroke=INK, wd=7),
           line(C, 60, C, 196, INK, 10, cap="butt"),
           line(84, 92, 156, 92, INK, 9, cap="butt"),
           pth("M46 148 C 54 194, 100 210, 120 210 C 140 210, 186 194, 194 148",
               stroke=INK, wd=10),
           poly([(46, 148), (30, 130), (68, 132)], fill=INK, stroke=None),
           poly([(194, 148), (210, 130), (172, 132)], fill=INK, stroke=None)]
    return "".join(out)


def d_jichang():
    """机场：俯视的飞机符号。"""
    body = ("M120 24 C 132 24, 136 44, 136 66 L136 100 L206 146 L206 166 "
            "L136 142 L136 180 L162 200 L162 214 L120 202 L78 214 L78 200 "
            "L104 180 L104 142 L34 166 L34 146 L104 100 L104 66 "
            "C 104 44, 108 24, 120 24 Z")
    return pth(body, fill=INK, stroke=INK, wd=3)


def d_guandao():
    """管道（输油 / 输气）：一条管线 + 沿线一格格法兰盘。

    刻意**不做**"双线 + 密排直横档"—— 那是铁路的花线，会撞形。这里用
    "细双线 + 沿线一圈实心管节"来读作管道：管节是圆的、隔得远，与铁路
    密排的直横档完全不同形。八上「西气东输」图上用的就是它。

    ⚠️ 管节半径与间距也是调出来的：第一版 r=17 / 间距 42 ⇒ 五个圆环几乎
    相切，整条读成了"一串念珠"。收到 r=12 / 间距 50，才有 26px 的裸管线
    露出来，管节才像"法兰"而不是"珠子"。
    """
    out = [line(16, 112, 224, 112, INK, 6, cap="butt"),
           line(16, 128, 224, 128, INK, 6, cap="butt")]
    for x in range(40, 222, 50):
        out.append(circ(x, C, 12, fill=PAPER2, stroke=INK, wd=6))
        out.append(circ(x, C, 5.5, fill=INK, stroke=None))
    return "".join(out)


# ================================================================ 资源与能源
def d_meikuang():
    """煤矿：方框里一个黑色方块。"""
    return (rect(40, 40, 160, 160, fill=PAPER2, stroke=INK, wd=8)
            + rect(84, 84, 72, 72, fill=INK, stroke=None))


def d_tiekuang():
    """铁矿：黑色三角形。"""
    return poly([(C, 38), (204, 196), (36, 196)], fill=INK, stroke=INK, wd=4)


def d_shiyou():
    """石油：油井架（A 字形井架 + X 斜撑 + 顶部滑轮）。"""
    def leg_x(y):
        return 52 + 68 * (206 - y) / 162.0

    out = [poly([(52, 206), (120, 44), (188, 206)], fill="none", stroke=INK,
                wd=9, close=False)]
    rungs = (188, 142, 96, 50)
    for y in rungs:
        out.append(line(leg_x(y), y, 240 - leg_x(y), y, INK, 5, cap="butt"))
    for y1, y2 in zip(rungs, rungs[1:]):
        out.append(line(leg_x(y1), y1, 240 - leg_x(y2), y2, INK, 4.4))
        out.append(line(240 - leg_x(y1), y1, leg_x(y2), y2, INK, 4.4))
    out.append(line(44, 206, 196, 206, INK, 10, cap="butt"))
    out.append(circ(120, 34, 12, fill=GOLD, stroke=INK, wd=6))
    return "".join(out)


def d_tianranqi():
    """天然气：火焰符号。"""
    outer = ("M120 22 C 150 68, 186 88, 186 134 C 186 176, 156 210, 120 210 "
             "C 84 210, 54 176, 54 134 C 54 88, 90 68, 120 22 Z")
    inner = ("M120 96 C 136 122, 150 132, 150 152 C 150 174, 136 188, 120 188 "
             "C 104 188, 90 174, 90 152 C 90 132, 104 122, 120 96 Z")
    return (pth(outer, fill=RED, stroke=INK, wd=7)
            + pth(inner, fill=GOLD, stroke=None))


def d_youse_kuang():
    """有色金属矿：菱形。"""
    return poly([(C, 34), (206, C), (C, 206), (34, C)], fill=PAPER2, stroke=INK, wd=9)


def d_shuidianzhan():
    """水电站：坝体 + 闪电。"""
    return (poly([(96, 58), (150, 58), (166, 190), (80, 190)], fill=PAPER2,
                 stroke=INK, wd=8)
            + waves(C, 206, 168, n=1, gap=0, color=WATER, wd=6, amp=9)
            + pth("M56 40 L20 112 L50 112 L34 176 L88 96 L54 96 Z",
                  fill=GOLD, stroke=INK, wd=4))


def d_huodianzhan():
    """火电站：厂房 + 冒烟的烟囱。"""
    return (rect(44, 130, 152, 78, fill=PAPER2, stroke=INK, wd=8)
            + line(84, 130, 84, 60, INK, 18, cap="butt")
            + line(160, 130, 160, 74, INK, 18, cap="butt")
            + circ(84, 46, 14, fill=INK2, stroke=None)
            + circ(102, 32, 10, fill=INK2, stroke=None)
            + circ(160, 62, 12, fill=INK2, stroke=None)
            + rect(58, 152, 42, 34, fill=PAPER, stroke=INK, wd=5)
            + rect(140, 152, 42, 34, fill=PAPER, stroke=INK, wd=5))


def d_hedianzhan():
    """核电站：原子符号。"""
    out = [circ(C, C, 20, fill=VIOLET, stroke=INK, wd=6)]
    for deg in (0, 60, 120):
        a = math.radians(deg)
        cx = C + math.cos(a) * 44
        cy = C + math.sin(a) * 44
        out.append('<ellipse cx="%g" cy="%g" rx="52" ry="22" fill="none" '
                   'stroke="%s" stroke-width="9" transform="rotate(%g %g %g)"/>'
                   % (cx, cy, VIOLET, deg, cx, cy))
    return "".join(out)


def d_shudian_luxian():
    """输电线路：两座铁塔之间挂着三条下垂的导线。

    「西电东送」工程图上的符号，与管道成对（一个送气、一个送电）。
    整张图例库里的**唯一**一个"塔"形，辨识度天然高，不需要额外做防撞。
    """
    out = []
    for x in (52, 188):
        out.append(poly([(x - 30, 202), (x, 84), (x + 30, 202)], fill="none",
                        stroke=INK, wd=8, close=False))
        out.append(line(x - 36, 132, x + 36, 132, INK, 7, cap="butt"))
        out.append(line(x - 24, 166, x + 24, 166, INK, 6, cap="butt"))
    for d in ("M52 132 Q 120 166 188 132",
              "M52 132 Q 120 184 188 132",
              "M52 166 Q 120 196 188 166"):
        out.append(pth(d, stroke=INK2, wd=5))
    return "".join(out)


def d_changcheng():
    """长城：一道连续的城墙 + 墙头一格格垛口。"""
    out = [rect(10, 152, 220, 42, fill=PAPER2, stroke=INK, wd=7)]
    x = 18
    while x + 28 <= 230:
        out.append(rect(x, 118, 28, 36, fill=PAPER2, stroke=INK, wd=6))
        x += 45
    for y in (162, 178):
        out.append(line(16, y, 224, y, INK2, 3, cap="butt"))
    return "".join(out)


def d_guanai():
    """关隘：一个粗壮的交叉（×）。

    与「长城」同属人文景观（关隘本来就是长城防线上的关口，图册上两者也
    排在一起）。整张图例库里没有第二个"两条粗斜线交叉"的符号 —— 泉是
    "圆圈中间一点"，不会撞形。
    """
    return "".join([
        line(38, 38, 202, 202, INK, 15, cap="butt"),
        line(202, 38, 38, 202, INK, 15, cap="butt"),
    ])


def d_mingsheng():
    """名胜古迹：宝塔。

    早期版本用「三角形 + 矩形」交替堆叠，渲染出来是漏斗／梯田，完全读不出塔。
    这里改成**实心填充的逐层收分塔身 + 挑出的檐口**（檐口两端比下方塔身更宽，
    才像"檐"），顶部收成小尖顶加一颗宝珠 —— 缩小到 165px 也认得出是塔。
    """
    out = [rect(40, 200, 160, 18, fill=PAPER2, stroke=INK, wd=6)]
    # (檐口四点梯形的上边/下边, 塔身矩形)：自下而上，檐口比下方塔身宽、塔身比下方檐口窄
    for eave, body in (
        ([(78, 152), (162, 152), (182, 168), (58, 168)], (82, 168, 76, 32)),
        ([(92, 106), (148, 106), (164, 120), (76, 120)], (96, 120, 48, 32)),
        ([(102, 72), (138, 72), (150, 84), (90, 84)], (106, 84, 28, 22)),
    ):
        out.append(poly(eave, fill=GOLD, stroke=INK, wd=5))
        out.append(rect(body[0], body[1], body[2], body[3],
                        fill=PAPER2, stroke=INK, wd=5))
    out.append(poly([(120, 46), (144, 72), (96, 72)], fill=GOLD, stroke=INK, wd=5))
    out.append(circ(120, 36, 7, fill=GOLD, stroke=INK, wd=5))
    return "".join(out)


def d_baohuqu():
    """自然保护区：树叶。"""
    leaf = ("M120 22 C 196 62, 202 146, 120 214 C 38 146, 44 62, 120 22 Z")
    return (pth(leaf, fill=GREEN, stroke=INK, wd=8)
            + line(120, 46, 120, 196, INK, 6)
            + line(120, 96, 78, 74, INK, 5)
            + line(120, 96, 162, 74, INK, 5)
            + line(120, 142, 72, 124, INK, 5)
            + line(120, 142, 168, 124, INK, 5))


def d_yuchang():
    """渔场：鱼形符号。"""
    body = ("M38 120 C 66 74, 128 60, 178 84 C 200 96, 208 108, 208 120 "
            "C 208 132, 200 144, 178 156 C 128 180, 66 166, 38 120 Z")
    return (pth(body, fill=WATER_L, stroke=INK, wd=8)
            + poly([(24, 120), (48, 92), (48, 148)], fill=WATER_L, stroke=INK, wd=7)
            + circ(176, 104, 8, fill=INK, stroke=None))


def d_yanchang():
    """盐场：方格状盐田。"""
    out = [rect(30, 56, 180, 128, fill=PAPER2, stroke=INK, wd=9)]
    for x in (90, 150):
        out.append(line(x, 56, x, 184, INK, 6, cap="butt"))
    out.append(line(30, 120, 210, 120, INK, 6, cap="butt"))
    out.append(dots(71, 60, 88, 20, 20, 12, 2.0, 3.6, INK2))
    return "".join(out)


# ================================================================ 地图基础
def d_bilichi():
    """比例尺：线段式比例尺。

    数字必须排得开 —— 早期版本 4 段 42px 宽、字号 22，数字彼此压在一起，
    而且「千米」写在 x=234 直接被画布切掉。
    """
    x0, y0, seg, hh = 30, 118, 44, 28
    out = []
    for i in range(4):
        out.append(rect(x0 + i * seg, y0, seg, hh,
                        fill=INK if i % 2 == 0 else PAPER, stroke=None))
    out.append(rect(x0, y0, seg * 4, hh, fill="none", stroke=INK, wd=6))
    for i in range(5):
        out.append(line(x0 + i * seg, y0 + hh, x0 + i * seg, y0 + hh + 11, INK, 5))
    for i, lab in enumerate(("0", "50", "100", "150", "200")):
        out.append(txt(x0 + i * seg, y0 - 11, lab, size=17, fill=INK))
    out.append(txt(x0 + seg * 2, y0 + hh + 40, "千米", size=17, fill=INK2))
    return "".join(out)


def d_zhixiangbiao():
    """指向标：指北的箭头。"""
    return (txt(C, 34, "N", size=34, fill=INK)
            + poly([(120, 52), (152, 184), (120, 152), (88, 184)],
                   fill=RED, stroke=INK, wd=6))


def d_jingxian():
    """经线：地球上的南北向弧线。"""
    out = [circ(C, C, 96, fill=PAPER2, stroke=INK, wd=6)]
    for rx in (28, 62, 96):
        out.append('<ellipse cx="%g" cy="%g" rx="%g" ry="96" fill="none" '
                   'stroke="%s" stroke-width="6"/>' % (C, C, rx, INK))
    return "".join(out)


def d_weixian():
    """纬线：地球上的东西向圆圈。"""
    out = [circ(C, C, 96, fill=PAPER2, stroke=INK, wd=6)]
    for ry in (28, 62, 96):
        out.append('<ellipse cx="%g" cy="%g" rx="96" ry="%g" fill="none" '
                   'stroke="%s" stroke-width="6"/>' % (C, C, ry, INK))
    return "".join(out)


# —— 赤道 / 南北回归线 / 南北极圈：三个都是"球上的一条特殊纬线"，
#    所以共用同一张小地球底座（半径与经线/纬线一致），靠**三条线索同时**
#    区分：线色（红实线 / 红点划 / 蓝点线）、纬度位置（0° / ±23.5° / ±66.5°）、
#    以及线上的度数注记。只靠其中任何一条都会有一对学生分不清 ——
#    度数注记是地图上的真实写法，且不泄露图例名称。
#    ⚠️ 纬度弦长按 GLOBE_R·cos(φ) 算，位置必须对得上真实纬度：
#       66.5° 的弦只有 ±38px 宽，写不下注记，所以极圈的注记改为放在
#       球心一侧并用一根引线指到线上（回归线 / 赤道的注记则直接嵌在线上）。
GLOBE_R = 96


def _lat_chord(deg):
    """纬度 deg 处的纬线弦：返回 (半宽, 相对球心的 y 偏移)。"""
    a = math.radians(deg)
    return GLOBE_R * math.cos(a), GLOBE_R * math.sin(a)


def _globe(extra):
    """小地球底座（纸色球面 + 粗墨线球缘）+ 已定位好的特殊纬线。"""
    return "".join([circ(C, C, GLOBE_R, fill=PAPER2, stroke=INK, wd=6)] + extra)


def d_chidao():
    """赤道：0° 纬线 —— 红色粗实线，平分地球，注记嵌在线上。"""
    hw, dy = _lat_chord(0)
    y = C + dy
    return _globe([
        line(C - hw, y, C - 18, y, RED, 12, cap="butt"),
        line(C + 18, y, C + hw, y, RED, 12, cap="butt"),
        txt(C, y + 8, "0°", size=21, fill=RED),
    ])


def d_huiguixian():
    """南、北回归线：±23.5° 纬线 —— 红色点划线，注记嵌在北回归线上。"""
    hw, dy = _lat_chord(23.5)
    out = []
    for sign in (-1, 1):
        y = C + sign * dy
        out.append(pth("M%g %g L%g %g" % (C - hw, y, C - 32, y),
                       stroke=RED, wd=10, dash="20 12", cap="butt"))
        out.append(pth("M%g %g L%g %g" % (C + 32, y, C + hw, y),
                       stroke=RED, wd=10, dash="20 12", cap="butt"))
    out.append(txt(C, C - dy + 8, "23.5°", size=17, fill=RED))
    return _globe(out)


def d_jiquan():
    """南、北极圈：±66.5° 纬线 —— 蓝色点线，注记用引线指到北极圈上。"""
    hw, dy = _lat_chord(66.5)
    out = []
    for sign in (-1, 1):
        y = C + sign * dy
        out.append(pth("M%g %g L%g %g" % (C - hw, y, C + hw, y),
                       stroke=COLD, wd=10, dash="4 11", cap="butt"))
    out.append(line(C, C - dy + 10, C, C - dy + 28, INK2, 4))
    out.append(txt(C, C - dy + 50, "66.5°", size=17, fill=COLD))
    return _globe(out)


# ================================================================ 气候图线
def d_dengwenxian():
    """等温线：开阔的曲线，线上注温度。"""
    return (curve([(16, 190), (62, 188), (78, 132), (116, 106), (152, 76),
                   (192, 56), (228, 48)], color=RED, wd=8)
            + curve([(16, 226), (70, 224), (92, 196), (134, 184), (180, 172),
                     (228, 168)], color=RED, wd=8)
            + txt(150, 40, "20℃", size=26, fill=RED)
            + txt(74, 214, "10℃", size=26, fill=RED))


def d_dengjiangshuiliang():
    """等降水量线：开阔的虚线，线上注毫米数。"""
    return (pth("M16 96 C 62 96, 74 148, 118 158 S 186 176, 228 168",
                stroke=COLD, wd=8, dash="20 12")
            + pth("M16 186 C 66 186, 82 214, 128 220 S 190 224, 228 214",
                  stroke=COLD, wd=8, dash="20 12")
            + txt(158, 158, "800 毫米", size=24, fill=COLD))


def d_taifeng_lujing():
    """台风路径：带螺旋的曲线。"""
    spiral = ("M0 0C 0 -20 -27 -24 -34 -8C -39 2 -29 15 -16 13"
              "C -8 11 -6 3 -11 0C -14 -3 -19 -1 -19 5")
    return (pth("M32 214 C 62 158, 40 108, 96 84 C 152 60, 166 128, 214 84",
                stroke=VIOLET, wd=8, dash="20 12")
            + arrow(196, 106, 214, 86, color=VIOLET, wd=6, head=17)
            + g(pth(spiral, stroke=VIOLET, wd=6.4, cap="round"), 68, 52)
            + g(pth(spiral, stroke=VIOLET, wd=6.4, cap="round"), 68, 52,
                rot=180, cx=0, cy=0))


def d_hanchao_lujing():
    """寒潮路径：自北向南的粗箭头 + 雪花。"""
    out = [arrow(70, 22, 42, 176, color=COLD, wd=11, head=26),
           arrow(150, 30, 178, 178, color=COLD, wd=11, head=26),
           arrow(206, 60, 214, 150, color=COLD, wd=9, head=22)]
    for x, y in ((24, 118), (110, 172), (196, 200)):
        for i in range(3):
            a = math.radians(i * 60)
            out.append(line(x - math.cos(a) * 13, y - math.sin(a) * 13,
                            x + math.cos(a) * 13, y + math.sin(a) * 13, COLD, 4.4))
    return "".join(out)


def d_shachenbao_lujing():
    """沙尘暴路径：带沙点的棕色箭头。"""
    out = [arrow(46, 26, 30, 168, color=BROWN, wd=12, head=26),
           arrow(132, 34, 156, 172, color=BROWN, wd=12, head=26),
           arrow(196, 66, 208, 158, color=BROWN, wd=10, head=22)]
    out.append(dots(91, C, 120, 104, 96, 66, 2.6, 5.4, BROWN, op=0.85))
    return "".join(out)


# ================================================================ 图例清单
# 类别顺序 = 图鉴里的显示顺序。城市等级符号（居民点）与界线分家，是因为
# 教材附录「本书常用地图图例」本来就把它们分成两组 —— v1.0.0 之前把
# 首都 / 省会 / 一般城市 / 外国首都挂在「行政区划与界线」下，属于分类错位。
CATS = [
    ("city", "居民点与城市"),
    ("boundary", "行政区划与界线"),
    ("terrain", "地形与地貌"),
    ("water", "河流与水域"),
    ("transport", "交通与航线"),
    ("resource", "资源与能源"),
    ("heritage", "人文景观"),
    ("mapbase", "地图基础"),
    ("climate", "气候图线"),
]

# tier：**basic** = 进「初中组」（教材正文必会的常用图例，含标准图例页全部条目）；
#       **advanced** = 只进「高级组」（地图册图例栏里有、课本正文不强调的细分辨形条目）。
# 高级组 ⊇ 初中组 —— 升组不丢基本盘，两组的成绩也才可比。
# 目标配比 basic 54 / advanced 19（main() 里有断言守着，漏标一个就会露）。
LEGENDS = [
    # ---- 居民点与城市 ----
    dict(id="jumindian", name="居民点", cat="city", tier="basic", draw=d_jumindian,
         summary="人类聚居的地方（城市、集镇、村庄），用大小不同的圆圈表示，圈越大聚落越大。"),
    dict(id="shoudu", name="首都", cat="city", tier="basic", draw=d_shoudu,
         summary="国家的首都，用红色的五角星标出。"),
    dict(id="shenghui", name="省级行政中心", cat="city", tier="basic", draw=d_shenghui,
         summary="省、自治区人民政府所在地，用双圆圈标出。"),
    dict(id="chengshi", name="一般城市", cat="city", tier="basic", draw=d_chengshi,
         summary="普通城市（县城等），用单圆圈标出，里面不套小圈。"),
    dict(id="waiguo_shoudu", name="外国首都", cat="city", tier="advanced",
         draw=d_waiguo_shoudu,
         summary="其他国家的首都，用黑色五角星外面套一个圈表示。"),

    # ---- 行政区划与界线 ----
    dict(id="guojie", name="国界", cat="boundary", tier="basic", draw=d_guojie,
         summary="国与国之间的界线，用最醒目的双实线画出。"),
    dict(id="weiding_guojie", name="未定国界", cat="boundary", tier="basic",
         draw=d_weiding_guojie,
         summary="尚未正式划定或存在争议的国界段，用断开的双虚线表示。"),
    dict(id="shengjie", name="中国省、自治区、直辖市界", short="省界",
         cat="boundary", tier="basic", draw=d_shengjie,
         summary="我国省级行政区的分界，用一长一短的点划线画出。"),
    dict(id="zhoujie", name="洲界", cat="boundary", tier="basic", draw=d_zhoujie,
         summary="亚洲、欧洲等大洲之间的分界，用红色的点划线画出。"),
    dict(id="diqujie", name="地区界", cat="boundary", tier="advanced", draw=d_diqujie,
         summary="地级市、自治州等地区一级的界线，用较短的等长点线表示。"),
    dict(id="tebie_xingzhengqujie", name="特别行政区界", cat="boundary",
         tier="advanced", draw=d_tebie_xingzhengqujie,
         summary="香港、澳门两个特别行政区与相邻省级行政区的分界，用棕色点线表示。"),

    # ---- 地形与地貌 ----
    dict(id="denggaoxian", name="等高线", cat="terrain", tier="basic", draw=d_denggaoxian,
         summary="海拔相同的各点连成的闭合曲线；线越密，坡越陡。"),
    dict(id="dengshenxian", name="等深线", cat="terrain", tier="advanced",
         draw=d_dengshenxian,
         summary="海洋（湖泊）中水深相同的各点连成的线，数值为负，表示水面以下的深度。"),
    dict(id="shanfeng", name="山峰", cat="terrain", tier="basic", draw=d_shanfeng,
         summary="山体的最高点，用三角形标出，旁边常注有海拔数值。"),
    dict(id="huoshan", name="火山", cat="terrain", tier="basic", draw=d_huoshan,
         summary="岩浆喷出地表堆成的锥形山体，图上还画出喷发的烟焰。"),
    dict(id="shamo", name="沙漠", cat="terrain", tier="basic", draw=d_shamo,
         summary="地表被沙覆盖的干旱地区，用密集的棕色沙点表示。"),
    dict(id="zhaoze", name="沼泽", cat="terrain", tier="basic", draw=d_zhaoze,
         summary="地表长期积水、生长湿生植物的低洼地，用成组的横线表示。"),
    dict(id="bingchuan", name="冰川", cat="terrain", tier="basic", draw=d_bingchuan,
         summary="高山或两极地区能自行流动的巨大冰体，用蓝色冰舌表示。"),
    dict(id="changnian_jixue", name="常年积雪", cat="terrain", tier="basic",
         draw=d_changnian_jixue,
         summary="常年不化的积雪覆盖区，用山顶那一顶浅蓝色雪帽表示。"),
    dict(id="haianxian", name="海岸线", cat="terrain", tier="basic", draw=d_haianxian,
         summary="陆地与海洋的分界线，线外向海的一侧画着水波纹。"),
    dict(id="shanhu_jiao", name="珊瑚礁", cat="terrain", tier="advanced", draw=d_shanhu_jiao,
         summary="热带浅海里珊瑚骨骼堆积成的礁体，用成排的小弧表示。"),
    dict(id="sanjiaozhou", name="三角洲", cat="terrain", tier="basic", draw=d_sanjiaozhou,
         summary="河流入海（湖）处泥沙堆积、河道分成几汊形成的低平陆地。"),
    dict(id="haigou", name="海沟", cat="terrain", tier="advanced", draw=d_haigou,
         summary="海洋底部狭长而深陷的凹槽，常出现在大陆板块与大洋板块相撞的消亡边界。"),
    dict(id="bankuai_jiexian", name="板块界线", cat="terrain", tier="advanced",
         draw=d_bankuai_jiexian,
         summary="地球岩石圈六大板块之间的分界，箭头表示相邻板块挤压或张裂的方向。"),

    # ---- 河流与水域 ----
    dict(id="changnian_he", name="常年河", cat="water", tier="basic", draw=d_changnian_he,
         summary="一年四季都有水的河流，用双线画出，有支流汇入主流。"),
    dict(id="shiling_he", name="时令河", cat="water", tier="basic", draw=d_shiling_he,
         summary="只在雨季或融雪期才有水的河流，用虚线表示；教材把它和时令湖合称「时令河、湖」。"),
    dict(id="hupo", name="湖泊", cat="water", tier="basic", draw=d_hupo,
         summary="陆地上汇集起来的水域，用闭合的蓝色轮廓表示；教材把它和常年河合称「常年河、湖」。"),
    dict(id="shiling_hu", name="时令湖", cat="water", tier="advanced", draw=d_shiling_hu,
         summary="旱季会干涸的湖泊，用虚线的闭合轮廓表示。"),
    dict(id="shuiku", name="水库", cat="water", tier="basic", draw=d_shuiku,
         summary="拦河蓄水形成的人工湖，一端画着拦河坝。"),
    dict(id="yunhe", name="运河", cat="water", tier="basic", draw=d_yunhe,
         summary="人工开凿的通航河道，用带一道道船闸横档的双线表示。"),
    dict(id="pubu", name="瀑布", cat="water", tier="basic", draw=d_pubu,
         summary="河流流经陡崖时跌落形成的水流，用断崖处的齿线表示。"),
    dict(id="quan", name="泉", cat="water", tier="advanced", draw=d_quan,
         summary="地下水自然涌出地表的地方，用圆圈中间加一点表示。"),
    dict(id="haixia", name="海峡", cat="water", tier="basic", draw=d_haixia,
         summary="两块陆地之间连接两个海域的狭窄水道。"),
    dict(id="yinshui_luxian", name="引水路线", cat="water", tier="basic",
         draw=d_yinshui_luxian,
         summary="跨流域调水的工程线路（如南水北调），用带箭头的双虚线表示。"),

    # ---- 交通与航线 ----
    dict(id="tielu", name="铁路", cat="transport", tier="basic", draw=d_tielu,
         summary="铁轨线路，用实线加一道道垂直横档的“花线”表示。"),
    dict(id="gaosu_tielu", name="高速铁路", cat="transport", tier="basic",
         draw=d_gaosu_tielu,
         summary="列车时速很高的铁路干线，用红线加白色横档的“花线”表示。"),
    dict(id="fuxian_tielu", name="复线铁路", cat="transport", tier="advanced",
         draw=d_fuxian_tielu,
         summary="有两条并行轨道的铁路，用两条并排的“花线”表示。"),
    dict(id="gaosu_gonglu", name="高速公路", cat="transport", tier="basic",
         draw=d_gaosu_gonglu,
         summary="全封闭、全立交的高等级公路，用中间带分隔线的粗双实线表示。"),
    dict(id="gonglu", name="公路", cat="transport", tier="basic", draw=d_gonglu,
         summary="普通公路，用弯曲的细双实线表示。"),
    dict(id="suidao", name="隧道", cat="transport", tier="advanced", draw=d_suidao,
         summary="穿过山体的通道，用两端带洞门钩子的虚线表示。"),
    dict(id="qiaoliang", name="桥梁", cat="transport", tier="advanced", draw=d_qiaoliang,
         summary="跨越河流的通道，在河道两岸各画出一座桥台。"),
    dict(id="guandao", name="管道", cat="transport", tier="advanced", draw=d_guandao,
         summary="输送石油、天然气的管线（如西气东输），用带一格格法兰盘的双线表示。"),
    dict(id="hanghaixian", name="航海线", cat="transport", tier="basic", draw=d_hanghaixian,
         summary="海上运输的航线，用带箭头的虚线表示。"),
    dict(id="hangkongxian", name="航空线", cat="transport", tier="basic",
         draw=d_hangkongxian,
         summary="飞机飞行的航线，用一串小圆点组成的点线表示。"),
    dict(id="gangkou", name="港口", cat="transport", tier="basic", draw=d_gangkou,
         summary="船舶停靠、装卸货物的码头，用船锚符号表示。"),
    dict(id="jichang", name="机场", cat="transport", tier="basic", draw=d_jichang,
         summary="飞机起降的场地，用俯视的飞机符号表示。"),

    # ---- 资源与能源 ----
    dict(id="meikuang", name="煤矿", cat="resource", tier="basic", draw=d_meikuang,
         summary="开采煤炭的矿区，用方框里加一个黑色方块表示。"),
    dict(id="tiekuang", name="铁矿", cat="resource", tier="basic", draw=d_tiekuang,
         summary="开采铁矿石的矿区，用黑色三角形表示。"),
    dict(id="shiyou", name="石油", cat="resource", tier="basic", draw=d_shiyou,
         summary="开采石油的油田，用油井架符号表示。"),
    dict(id="tianranqi", name="天然气", cat="resource", tier="basic", draw=d_tianranqi,
         summary="开采天然气的油气田，用火焰符号表示。"),
    dict(id="youse_kuang", name="有色金属矿", cat="resource", tier="advanced",
         draw=d_youse_kuang,
         summary="铜、铅锌、钨等有色金属矿区，用菱形表示。"),
    dict(id="shuidianzhan", name="水电站", cat="resource", tier="basic",
         draw=d_shuidianzhan,
         summary="利用水能发电的电站，用坝体加一道闪电表示。"),
    dict(id="huodianzhan", name="火电站", cat="resource", tier="basic",
         draw=d_huodianzhan,
         summary="燃烧煤炭等燃料发电的电站，用厂房加冒烟的烟囱表示。"),
    dict(id="hedianzhan", name="核电站", cat="resource", tier="basic", draw=d_hedianzhan,
         summary="利用核能发电的电站，用原子符号表示。"),
    dict(id="shudian_luxian", name="输电线路", cat="resource", tier="advanced",
         draw=d_shudian_luxian,
         summary="把电从电站送出的高压线（如西电东送），用铁塔之间下垂的导线表示。"),
    dict(id="yuchang", name="渔场", cat="resource", tier="basic", draw=d_yuchang,
         summary="鱼类集中、便于捕捞的海域，用鱼形符号表示。"),
    dict(id="yanchang", name="盐场", cat="resource", tier="basic", draw=d_yanchang,
         summary="靠晒海水制盐的滩地，用方格表示的盐田。"),

    # ---- 人文景观 ----
    dict(id="changcheng", name="长城", cat="heritage", tier="basic", draw=d_changcheng,
         summary="古代修筑的军事防御工程，用带城垛的锯齿线表示。"),
    dict(id="guanai", name="关隘", cat="heritage", tier="advanced", draw=d_guanai,
         summary="长城沿线设防的关口，用交错的叉号表示。"),
    dict(id="mingsheng", name="名胜古迹", cat="heritage", tier="advanced", draw=d_mingsheng,
         summary="有名的风景与文物古迹，用宝塔符号表示。"),
    dict(id="baohuqu", name="自然保护区", cat="heritage", tier="basic", draw=d_baohuqu,
         summary="为保护自然生态划定的区域（如三江源），用树叶符号表示。"),

    # ---- 地图基础 ----
    dict(id="bilichi", name="比例尺", cat="mapbase", tier="basic", draw=d_bilichi,
         summary="图上距离与实地距离之比，用带数字的线段表示。"),
    dict(id="zhixiangbiao", name="指向标", cat="mapbase", tier="basic",
         draw=d_zhixiangbiao,
         summary="地图上指示北方的小箭头，箭头指向就是北。"),
    dict(id="jingxian", name="经线", cat="mapbase", tier="basic", draw=d_jingxian,
         summary="连接南北两极、指示南北方向的线，又叫子午线。"),
    dict(id="weixian", name="纬线", cat="mapbase", tier="basic", draw=d_weixian,
         summary="与赤道平行、指示东西方向的圆圈。"),
    dict(id="chidao", name="赤道", cat="mapbase", tier="basic", draw=d_chidao,
         summary="0° 纬线，地球上最长的纬线，把地球平分成南北两半球。"),
    dict(id="huiguixian", name="南北回归线", short="回归线", cat="mapbase",
         tier="basic", draw=d_huiguixian,
         summary="23.5° 纬线，太阳直射点能到达的最北、最南界线，是热带与温带的分界。"),
    dict(id="jiquan", name="南北极圈", short="极圈", cat="mapbase", tier="basic",
         draw=d_jiquan,
         summary="66.5° 纬线，出现极昼极夜现象的最低纬度，是温带与寒带的分界。"),

    # ---- 气候图线 ----
    dict(id="dengwenxian", name="等温线", cat="climate", tier="basic", draw=d_dengwenxian,
         summary="气温相同的各点连成的线，线上注着温度数值。"),
    dict(id="dengjiangshuiliang", name="等降水量线", cat="climate", tier="basic",
         draw=d_dengjiangshuiliang,
         summary="降水量相同的各点连成的线，线上注着毫米数。"),
    dict(id="taifeng_lujing", name="台风路径", cat="climate", tier="basic",
         draw=d_taifeng_lujing,
         summary="台风移动的路线，用带螺旋的曲线画出。"),
    dict(id="hanchao_lujing", name="寒潮路径", cat="climate", tier="advanced",
         draw=d_hanchao_lujing,
         summary="寒潮侵入的方向，用自北向南的粗箭头表示。"),
    dict(id="shachenbao_lujing", name="沙尘暴路径", cat="climate", tier="advanced",
         draw=d_shachenbao_lujing,
         summary="沙尘暴移动的方向，用带沙点的棕色箭头表示。"),
]


# ================================================================ 封面
def build_cover():
    picks = ["denggaoxian", "gaosu_tielu", "shiyou", "jumindian", "hupo",
             "changcheng", "shanfeng", "gangkou", "chidao"]
    by_id = {it["id"]: it for it in LEGENDS}
    tile = 128
    cols, gap = 3, 14
    grid_w = cols * tile + (cols - 1) * gap
    x0 = (512 - grid_w) / 2
    y0 = 168
    out = [rect(0, 0, 512, 512, fill=PAPER, stroke=None),
           rect(10, 10, 492, 492, fill="none", stroke=INK, wd=8),
           rect(10, 10, 492, 44, fill=INK, stroke=None),
           rect(10, 422, 492, 80, fill=INK, stroke=None),
           txt(256, 88, "地图图例消消乐", size=52, fill=INK),
           txt(256, 126, "把符号和名称配成一对", size=22, fill=INK2)]
    for i, gid in enumerate(picks):
        r, c = divmod(i, cols)
        out.append('<g transform="translate(%g %g) scale(%g)">%s</g>'
                   % (x0 + c * (tile + gap), y0 + r * (tile + gap),
                      tile / 240.0, by_id[gid]["draw"]()))
    out.append(txt(256, 452, "73 个初中地理常用图例", size=24, fill=PAPER))
    out.append(txt(256, 484, "初中组 / 高级组 · 单人闯关 / 双人 PK", size=17,
                   fill=GOLD))
    return wrap(512, 512, "".join(out), border=False)


# ================================================================ 主流程
# 两个模式各自的条数。改任何一个都要同时改 pick.test.cjs 与 manifest 简介。
TIER_TOTAL = {"basic": 54, "advanced": 19}


def main():
    total = sum(TIER_TOTAL.values())
    assert len(LEGENDS) == total, "图例条数应为 %d，实际 %d" % (total, len(LEGENDS))
    ids = [it["id"] for it in LEGENDS]
    assert len(set(ids)) == len(ids), "图例 id 有重复"
    cat_ids = [c[0] for c in CATS]
    assert all(cat_ids.count(it["cat"]) for it in LEGENDS)
    # —— tier 必须标全，且配比不能漂 ——
    # 漏标一个 tier 会让它静默掉进 basic（初中组）而不是报错，所以这里必须
    # 对数不认"没标就算 basic"：先断言每个 tier 合法，再对数。
    tier_seen = {k: 0 for k in TIER_TOTAL}
    for it in LEGENDS:
        t = it.get("tier")
        assert t in TIER_TOTAL, "%s：tier 缺失或非法（%r）" % (it["id"], t)
        tier_seen[t] += 1
    assert tier_seen == TIER_TOTAL, \
        "tier 配比应为 %s，实际 %s" % (TIER_TOTAL, tier_seen)
    cat_name = dict(CATS)

    os.makedirs(OUT_SVG, exist_ok=True)
    problems = []
    records = []

    for it in LEGENDS:
        svg = wrap(W, H, it["draw"]())
        # —— 关键自检 1：符号卡上绝不能出现图例名称 ——
        name = it["name"]
        body_only = svg
        if name in body_only:
            problems.append("%s：符号里出现了名称「%s」，会直接泄露答案"
                            % (it["id"], name))
        # —— 关键自检 2：必须是合法 XML，否则 <img> 会静默失败 ——
        try:
            ET.fromstring(svg)
        except ET.ParseError as err:
            problems.append("%s：SVG 不是合法 XML —— %s" % (it["id"], err))
        # —— 关键自检 3：字体族不能用双引号 ——
        if 'font-family="' in svg and "'" not in svg.split('font-family="')[1][:60]:
            problems.append("%s：font-family 没有用单引号" % it["id"])
        # —— 自检 4：不能是空壳 ——
        if len(svg) < 420:
            problems.append("%s：SVG 内容过少（%d 字节），疑似没画出来"
                            % (it["id"], len(svg)))
        # —— 自检 5：dasharray 里不能出现 0 或负数 ——
        if '-0' in svg or "NaN" in svg or "inf" in svg.lower():
            problems.append("%s：SVG 里出现非法数值" % it["id"])

        save(os.path.join(OUT_SVG, it["id"] + ".svg"), svg)
        # short = 牌面上的简称。名称太长的小卡放不下，但揭晓大卡里仍给全称。
        short = it.get("short") or name
        if len(short) > 8:
            problems.append("%s：板面简称「%s」超过 8 字，小卡放不下" % (it["id"], short))
        records.append(dict(id=it["id"], name=name, short=short,
                            category=it["cat"],
                            categoryName=cat_name[it["cat"]],
                            tier=it["tier"],
                            summary=it["summary"],
                            image="assets/legends/%s.svg" % it["id"]))

    data = dict(
        game="地图图例消消乐",
        categories=[dict(id=c, name=n) for c, n in CATS],
        legends=records,
    )
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    save(os.path.join(ROOT, "public", "cover.svg"), build_cover())

    # 统计
    print("图例：%d 条" % len(records))
    for c, n in CATS:
        k = sum(1 for r in records if r["category"] == c)
        b = sum(1 for r in records if r["category"] == c and r["tier"] == "basic")
        print("  %-12s %2d  （初中组 %d / 高级组独有 %d）" % (n, k, b, k - b))
    print("模式：初中组 %d 条 / 高级组 %d 条（高级组 = 全部）"
          % (tier_seen["basic"], len(records)))
    files = sorted(os.listdir(OUT_SVG))
    print("SVG 文件：%d 个，合计 %d 字节"
          % (len(files), sum(os.path.getsize(os.path.join(OUT_SVG, f))
                             for f in files)))

    if problems:
        print("\n自检未通过：")
        for p in problems:
            print("  ×", p)
        return 1
    print("\n自检通过：名称未泄露 / XML 合法 / 字体族单引号 / 无空壳 / tier 配比正确")
    return 0


if __name__ == "__main__":
    sys.exit(main())
