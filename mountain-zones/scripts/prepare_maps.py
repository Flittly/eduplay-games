#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
位置图数据生成脚本 —— 输出 src/data/china-map.ts
================================================================

产出「四座山在中国哪里」这张小图需要的东西：主图（国界 + 省界 + 逐省 path 供高亮）
+ **左下角的南海诸岛插图**（岛屿 + 十段线），以及前端把经纬度换成图上坐标所需的投影参数。

## 数据来源（合规白名单内的中国境内服务）

  * 中国国界 / 省界 / 南海断续线：阿里云 DataV — 高德地图底图数据
        https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json
        https://geo.datav.aliyun.com/areas_v3/bound/100000.json
    含台湾省、香港特别行政区、澳门特别行政区及南海诸岛；断续线（adcode 100000_JD，
    现行官方口径为**十段线**，含台湾岛以东那一段）单独成层。
    与 `landform-quiz/scripts/prepare_maps.py` **同一个源、同一组投影参数**，
    两个游戏的中国图形状因此完全一致。

  * 不使用任何境外底图（Google / Bing / OSM / Mapbox 等），也不引在线瓦片 ——
    本游戏是离线 U 盘部署的静态包，教室里没有网络，图上一切必须来自包内数据。

## 为什么要有「南海诸岛插图」而不是把南海画进主图

主图若把整个南海都收进图框，图框会变成 788×941 的竖长条：
  * 右侧栏只有 336 px 宽 ⇒ 地图会被拉成 ~308×368 px，占掉面板近一半高度；
  * 更要紧的是**四座山全挤在图框上部 40%**，"在中国哪里"这个信息反而变弱了。
所以按标准地图惯例：主图只到海南岛，南海诸岛与十段线放进左下角的插图。
插图位置不是拍脑袋定的 —— `check_inset_clear()` 会断言插图的方框里
（留 10 单位余量）**不含任何主图陆地顶点**，右下角压着福建/台湾这种摆法会被直接拦下。

## 投影：兰伯特等角圆锥（国内标准地图常用）

标准纬线 25°N / 47°N、中央经线 105°E。与前端 `src/locmap.ts` 的实现必须逐字对应，
否则红点会相对省界整体偏移。

## 反向校验（本脚本的重点，不是可选步骤）

`src/data/locations.ts` 里四座山的省份是**人工按权威口径写的**。本脚本用点在多边形
独立算一遍，并断言两者相容：

  * `onBorder == false` ⇒ 多边形判定结果必须**等于**声明的省份（拦写错省的笔误）；
  * `onBorder == true`  ⇒ 必须实测「到最近他省界 < 2 km」（拦"拿省界当借口掩盖写错"）。

实测数字会全部打印出来。梅里雪山的取景中心离省界仅 0.86 km —— 怒山主脊本身就是滇藏
省界，多边形把它落在哪一侧只取决于公里级的数据误差，所以那一座采用权威口径（云南省）。

用法：
    python scripts/prepare_maps.py            # 生成 + 校验
    python scripts/prepare_maps.py --check    # 只校验，不回写文件
"""

import io
import json
import math
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_TS = os.path.join(ROOT, "src", "data", "china-map.ts")
CACHE = os.path.abspath(os.path.join(ROOT, "..", ".workbuddy", "tmp", "mapcache"))

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36"

CN_FULL = "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json"
CN_SINGLE = "https://geo.datav.aliyun.com/areas_v3/bound/100000.json"

# 中国图：兰伯特等角圆锥投影（与 landform-quiz 同一组参数，两游戏图形必须一致）
LCC = {"phi1": 25.0, "phi2": 47.0, "phi0": 0.0, "lam0": 105.0}

SCALE = 1000.0
PAD = 16.0

# 「主图 / 南海诸岛」的切分纬度。实测海南岛最南 18.144°、南海诸岛最北 17.120°，
# 中间有整整 1° 的空档，取 17.5 能把两者干净分开（边界不敏感，不是调出来的数）。
SPLIT_LAT = 17.5

# 抽稀容差。主图在右侧栏里只有 ~308 px 宽，viewBox 约 788 单位 ⇒ 约 2.5 单位/px，
# 所以下面这些数都远小于一个像素；插图另有一套（内容更小、缩得更狠）。
EPS_OUTLINE = 1.2
EPS_PROVINCE = 2.4
EPS_INSET = 0.6

# 主图的渲染比例：右侧栏内容宽约 308 px，viewBox 宽 788 单位。
UNITS_PER_PX = 2.5

# 「抽稀丢了看得见的环」的跨度门槛 ≈ 4 px。小于它的环消失是正常的（亚像素小岛被
# 抽稀吃掉），大于它的环消失就是几何事故，必须报错 —— 见 main() 里 losses 的说明。
MIN_EXTENT = 4.0 * UNITS_PER_PX

# 插图方框与主图陆地之间必须留出的最小间距（单位与 viewBox 同）。
# 让位计算与压盖断言**共用这一个常量** —— 见下面 extra_down 处的注释。
INSET_GUARD = 10.0


# ---------------------------------------------------------------- 取源


def fetch(url, cache_name):
    """优先读本地缓存（与 landform-quiz 共用 .workbuddy/tmp/mapcache）。"""
    os.makedirs(CACHE, exist_ok=True)
    cached = os.path.join(CACHE, cache_name)
    if os.path.exists(cached) and os.path.getsize(cached) > 1000:
        with io.open(cached, encoding="utf-8") as f:
            return json.load(f)
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url)
            req.add_header("User-Agent", UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                txt = r.read().decode("utf-8")
            io.open(cached, "w", encoding="utf-8", newline="").write(txt)
            return json.loads(txt)
        except Exception as exc:  # noqa: BLE001
            last = exc
            print("  拉取失败（第 %d 次）：%s" % (attempt + 1, exc))
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("无法获取 %s：%s" % (url, last))


# ---------------------------------------------------------------- 投影


def make_lcc(p):
    p1, p2 = math.radians(p["phi1"]), math.radians(p["phi2"])
    lam0, phi0 = math.radians(p["lam0"]), math.radians(p["phi0"])
    if abs(p1 - p2) < 1e-9:
        n = math.sin(p1)
    else:
        n = (math.log(math.cos(p1) / math.cos(p2))
             / math.log(math.tan(math.pi / 4 + p2 / 2) / math.tan(math.pi / 4 + p1 / 2)))
    F = math.cos(p1) * math.tan(math.pi / 4 + p1 / 2) ** n / n
    rho0 = F / math.tan(math.pi / 4 + phi0 / 2) ** n

    def proj(lon, lat):
        lam, phi = math.radians(lon), math.radians(lat)
        rho = F / math.tan(math.pi / 4 + phi / 2) ** n
        th = n * (lam - lam0)
        # 取负：圆锥投影 y 向北增大、屏幕 y 向南增大，不翻转中国图会南北颠倒。
        return rho * math.sin(th), rho * math.cos(th) - rho0

    return proj


# ---------------------------------------------------------------- 几何工具


def rings_of(geometry):
    t, c = geometry["type"], geometry["coordinates"]
    if t == "Polygon":
        return list(c)
    if t == "MultiPolygon":
        return [ring for poly in c for ring in poly]
    if t == "LineString":
        return [c]
    if t == "MultiLineString":
        return list(c)
    return []


def split_by_lat(rings, lat=SPLIT_LAT):
    """按「环的最高纬度」切分主图与南海诸岛。"""
    north = [r for r in rings if max(p[1] for p in r) >= lat]
    south = [r for r in rings if max(p[1] for p in r) < lat]
    return north, south


def to_xy(rings, proj):
    """经纬度环 → 投影后的点列，顺带去掉闭合重复点并丢掉退化环。"""
    out = []
    for ring in rings:
        pts = [(x * SCALE, y * SCALE) for x, y in (proj(lon, lat) for lon, lat in ring)]
        # GeoJSON 的环首尾点相同，必须先去掉尾点，否则 RDP 会因首尾重合退化成两点。
        # ⚠️ 必须**循环**去尾，不能只去一次：阿里云 DataV 的部分环在末尾把首点写了一到两遍
        #    （实测四川省主环 1168 点，末尾是 [… p0, p0]）。只去一次的话首尾仍然重合，
        #    RDP 的基准段长度变成 0，而「点到零长度线段的距离」恒为 0 ⇒ 整个环被判成一条
        #    直线丢光 —— **四川省的 path 直接变成空字符串**，高亮静默失效且看不出是数据问题。
        while (len(pts) > 1
               and abs(pts[0][0] - pts[-1][0]) < 1e-9
               and abs(pts[0][1] - pts[-1][1]) < 1e-9):
            pts = pts[:-1]
        if len(pts) >= 3:
            out.append(pts)
    return out


def rdp(pts, eps):
    """Ramer–Douglas–Peucker 抽稀。

    ⚠️ 基准段退化（a、b 两点重合 ⇒ 长度 0）时必须换判据：点到零长度线段的距离恒为 0，
    `best` 永远超不过 eps，整条折线只留首尾两点 —— 一个环就这样被**静默**丢光。
    所以退化时改用「到 pts[a] 的欧氏距离」挑最远点，首尾同点的环也能正常折半递归。
    这条与 `to_xy` 的循环去尾是两道独立防线：去尾拦已知数据毛病，这里拦整类退化。
    """
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        degenerate = norm < 1e-9
        best, best_i = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if degenerate:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if d > best:
                best, best_i = d, i
        if best_i >= 0 and best > eps:
            keep[best_i] = True
            stack.append((a, best_i))
            stack.append((best_i, b))
    return [p for p, k in zip(pts, keep) if k]


def farthest_pair(points):
    """环上相距最远的一对点。用于细窄条环被压平后，仍能沿它的**轴向**画出一条线段。

    注意不能拿「去重后的首尾两点」来代替：环是以重复首点闭合的，去重后首尾两点在原环上
    相邻，取它只会得到一小段 —— 方向完全不对。n 很小（实测这类环 ≤ 30 点），直接 O(n²)。
    """
    n = len(points)
    if n > 600:                      # 只可能出现在异常数据上，退化成按 x 取两端
        xs = sorted(range(n), key=lambda i: points[i][0])
        return points[xs[0]], points[xs[-1]]
    best, pa, pb = -1.0, points[0], points[-1]
    for i in range(n):
        xi, yi = points[i]
        for j in range(i + 1, n):
            xj, yj = points[j]
            d = (xi - xj) ** 2 + (yi - yj) ** 2
            if d > best:
                best, pa, pb = d, points[i], points[j]
    return pa, pb


def svg_path(polys, eps, audit_extent=None, audit_label="", notes=None, losses=None):
    """最终坐标的点列 → SVG path 的 d（整数，省字节）。

    传了 `audit_extent` 时负责处理「RDP 把环压成不到 3 点」的两种情形：
      * 环本身就小（跨度 < audit_extent）：亚像素，丢掉是对的；
      * 环跨度够大却近乎**共线**（十段线的每一段就是这种细窄条）：**必须保留**。
        丢掉它等于少画一段线 —— 实测旧产物就这样把十段线画成了八段线。
        这种环本来就要靠 stroke 才看得见（见 styles.css 里 .mz-lm-inset-nine 的注释），
        所以保留成「两点退化闭合路径」，描边照样画出那条线段。这类记进 notes（信息，不报错）。
    `losses` 只收真正的硬失败（连最远两点都重合，环彻底化为一点）。
    """
    parts = []
    for r in polys:
        pts = rdp(r, eps)
        if len(pts) >= 3:
            parts.append("M" + "L".join("%d %d" % (round(x), round(y)) for x, y in pts) + "Z")
            continue
        if audit_extent is None:
            continue
        xs = [p[0] for p in r]
        ys = [p[1] for p in r]
        ext = max(max(xs) - min(xs), max(ys) - min(ys))
        if ext < audit_extent:
            continue
        a, b = farthest_pair(r)
        ax, ay = round(a[0]), round(a[1])
        bx, by = round(b[0]), round(b[1])
        if (ax, ay) == (bx, by):
            if losses is not None:
                losses.append("%s：跨度 %.1f 单位的环被抽稀压成一点，彻底丢失" % (audit_label, ext))
            continue
        parts.append("M%d %dL%d %dZ" % (ax, ay, bx, by))
        if notes is not None:
            notes.append("%s：跨度 %.1f 单位（≈ %.1f px）的细窄条环被压平，"
                         "已按轴向保留为线段（源环 %d 点）"
                         % (audit_label, ext, ext / UNITS_PER_PX, len(r)))
    return "".join(parts)


def translate(polys, ox, oy):
    return [[(x - ox, y - oy) for x, y in r] for r in polys]


def bbox_of(polys):
    xs = [p[0] for r in polys for p in r]
    ys = [p[1] for r in polys for p in r]
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


def union_bbox(a, b):
    if a is None:
        return b
    if b is None:
        return a
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


# ---------------------------------------------------------------- 反查（点 / 距离）


def in_ring(x, y, ring):
    """射线法。ring 为 [[lon, lat], ...]。"""
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        if (y1 > y) != (y2 > y):
            xin = (x2 - x1) * (y - y1) / (y2 - y1) + x1
            if x < xin:
                inside = not inside
    return inside


def seg_dist(p, a, b):
    px, py = p
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


# ---------------------------------------------------------------- 读前端数据


def read_dem_meta():
    """从 src/data/dem-*.ts 读 tag / lat / lon（不重复维护一份坐标）。"""
    out = {}
    d = os.path.join(ROOT, "src", "data")
    for name in sorted(os.listdir(d)):
        if not (name.startswith("dem-") and name.endswith(".ts")):
            continue
        txt = io.open(os.path.join(d, name), encoding="utf-8").read()
        tag = re.search(r'tag:\s*"([^"]+)"', txt)
        lat = re.search(r"\blat:\s*(-?[\d.]+)", txt)
        lon = re.search(r"\blon:\s*(-?[\d.]+)", txt)
        if tag and lat and lon:
            out[tag.group(1)] = (float(lat.group(1)), float(lon.group(1)))
    return out


def read_locations():
    """从 src/data/locations.ts 解析人工声明的省份（对象块按出现顺序切）。"""
    txt = io.open(os.path.join(ROOT, "src", "data", "locations.ts"), encoding="utf-8").read()
    body = txt.split("MOUNTAIN_LOCATIONS", 1)[1]
    out = []
    for blk in re.findall(r"\{(.*?)\}", body, re.S):
        tag = re.search(r'tag:\s*"([^"]+)"', blk)
        prov = re.search(r'province:\s*"([^"]+)"', blk)
        ad = re.search(r'adcode:\s*"([^"]+)"', blk)
        border = re.search(r"onBorder:\s*(true|false)", blk)
        if tag and prov and ad and border:
            out.append({
                "tag": tag.group(1),
                "province": prov.group(1),
                "adcode": ad.group(1),
                "onBorder": border.group(1) == "true",
            })
    return out


# ---------------------------------------------------------------- 主流程

HEADER = '''/**
 * 中国地图矢量数据（位置图用）—— **由 scripts/prepare_maps.py 生成，请勿手改**。
 *
 * 数据来源：阿里云 DataV（高德地图底图数据）areas_v3/bound/100000_full.json 与 100000.json。
 * 含台湾省、香港特别行政区、澳门特别行政区及南海诸岛；断续线（现行官方口径的十段线）
 * 独立成层，并整体放进左下角的「南海诸岛」插图。不使用任何境外底图，也不依赖在线瓦片。
 *
 * 坐标为兰伯特等角圆锥投影（标准纬线 25°N/47°N、中央经线 105°E）后的整数 SVG path；
 * 投影参数见 meta，前端 src/locmap.ts 用同一组参数把经纬度换算成图上坐标。
 */

import type { ChinaMap } from "../locmap";

export const CHINA_MAP: ChinaMap = '''


def main():
    check_only = "--check" in sys.argv

    print("拉取中国国界与省界（阿里云 DataV / 高德地图底图数据）…")
    cn_full = fetch(CN_FULL, "cn_full.json")
    cn_single = fetch(CN_SINGLE, "cn_single.json")

    outline_all, nine_src = [], []
    province_src = {}   # adcode -> (name, rings)
    for f in cn_full["features"]:
        ad = str(f["properties"].get("adcode"))
        if ad == "100000_JD":
            # ⚠ 十段线整体进插图，**不按纬度切**：其中两段在台湾岛以东（最北 24.6°N），
            #   按纬度切会把它们留在主图里，那样断续线就被拆成两处、不成体系。
            nine_src += rings_of(f["geometry"])
        else:
            province_src[ad] = (f["properties"].get("name") or "", rings_of(f["geometry"]))
    for f in cn_single["features"]:
        outline_all += rings_of(f["geometry"])

    proj = make_lcc(LCC)

    # ---- 主图 / 南海诸岛 切分 ----
    outline_main_src, outline_south_src = split_by_lat(outline_all)
    prov_main = {}   # adcode -> 主图环
    for ad, (_, rs) in province_src.items():
        north, _south = split_by_lat(rs)
        prov_main[ad] = north

    outline_main = to_xy(outline_main_src, proj)
    prov_main_xy = {ad: to_xy(rs, proj) for ad, rs in prov_main.items()}

    # ---- 主图框 ----
    bb = bbox_of(outline_main)
    for v in prov_main_xy.values():
        bb = union_bbox(bb, bbox_of(v))
    ox, oy = bb[0] - PAD, bb[1] - PAD
    W = round(bb[2] - ox + PAD, 1)
    H = round(bb[3] - oy + PAD, 1)
    vb = [0, 0, W, H]

    province_names = {ad: nm for ad, (nm, _) in province_src.items()}

    # ---- 边抽稀边体检 ----
    # 真实事故：阿里云 DataV 的部分环末尾把首点写了一到两遍，而 `to_xy` 当时只去一次尾点
    # ⇒ 首尾仍重合 ⇒ RDP 的基准段长度退化为 0 ⇒ 整个环被判成一条直线**静默丢光**，
    # 四川省的 path 直接变成空字符串（位置图上高亮什么都不显示，也看不出是几何缺失）。
    # 同一处还有第二个受害者：十段线的每段都是细窄条，被压平后连段数都少了（十段变八段）。
    #
    # ⚠️ 判据**不能**写成「进多少环、出多少环」：小到亚像素的岛屿被抽稀吃掉是正常的
    #    （实测浙江 44 环进、3 环出，那 41 个都是这个比例尺下看不见的小岛）。
    #    所以只对跨度 ≥ MIN_EXTENT（看得见）的环较真，并且分两级：
    #    notes = 压平但保留成线段（信息）；losses = 彻底丢失（硬失败，必须报错）。
    notes, losses = [], []
    provinces = {
        ad: svg_path(translate(v, ox, oy), EPS_PROVINCE,
                     MIN_EXTENT, province_names.get(ad, ad), notes, losses)
        for ad, v in prov_main_xy.items()
    }
    outline_path = svg_path(translate(outline_main, ox, oy), EPS_OUTLINE,
                            MIN_EXTENT, "国界", notes, losses)

    # ---- 兜底 + 断言：**每个省级行政区都必须画出东西** ----
    # 澳门特别行政区小到亚像素（外环跨度约 2 单位 ≈ 0.7 px），会被抽稀按正常规则吃掉。
    # 但省界图上少一个省级行政区是错的 —— 更糟的是「高亮所在省」会静默失效
    # （四川那次就是这么暴露的），所以给它按轴向补一条退化线段，并把这件事立成断言。
    def ring_extent(r):
        xs = [p[0] for p in r]
        ys = [p[1] for p in r]
        return max(max(xs) - min(xs), max(ys) - min(ys))

    for ad, polys in prov_main_xy.items():
        if provinces[ad] or not polys:
            continue
        big = max(polys, key=ring_extent)
        a, b = farthest_pair(big)
        ax, ay = round(a[0]), round(a[1])
        bx, by = round(b[0]), round(b[1])
        if (ax, ay) == (bx, by):
            continue
        provinces[ad] = "M%d %dL%d %dZ" % (ax, ay, bx, by)
        notes.append("%s：最大环跨度仅 %.1f 单位（≈ %.1f px），按轴向保留为线段"
                     % (province_names.get(ad, ad), ring_extent(big),
                        ring_extent(big) / UNITS_PER_PX))

    empty = [province_names.get(ad, ad) for ad, d in provinces.items() if not d]
    if empty:
        print("❌ 这些省级行政区没有画出任何几何：%s" % "、".join(empty))
        raise SystemExit(1)

    # ---- 南海诸岛插图：独立缩放后放进左下角的空白海域 ----
    inset_xy = to_xy(outline_south_src, proj)
    nine_xy = to_xy(nine_src, proj)
    bbi = union_bbox(bbox_of(inset_xy), bbox_of(nine_xy))
    content_ar = (bbi[2] - bbi[0]) / (bbi[3] - bbi[1])   # 细高，实测约 0.53

    # ⚠️ 插图尺寸由**目标渲染像素**反推，不是随手给个比例。
    #    主图 788 单位宽在面板里画到约 308 px ⇒ 0.39 px/单位。
    #    若插图只有 99 单位宽（按 0.24×图高那种"看着差不多"的算法），渲染出来仅 39 px，
    #    十段线会细到 0.3 px、标签字只有 3 px —— 等于没有。所以先定宽度（150 单位 ≈ 59 px），
    #    再按内容宽高比反推高度。
    inset_pad = 7.0
    inset_w = 150.0
    inset_h = round((inset_w - inset_pad * 2) / content_ar + inset_pad * 2, 1)
    inset_x = 14.0
    inset_margin = 14.0

    # 图框要向下让出高度：插图必须落在「该 x 区间内陆地最低点」之下。
    # ⚠️ 让位量必须与自己那条断言用**同一个余量**（INSET_GUARD），否则会出现
    #    "算出来刚好压住 4 单位"这种自相矛盾的结果 —— 第一版就是拿 6 去对 10。
    # +2 是给闭区间留的：断言的判定是 `y0 <= yy`，若 inset_y 恰好等于
    # land_bottom_left + GUARD，那个最低点就正好落在边界上被判为压盖。
    land_bottom_left = max((y - oy for v in prov_main_xy.values() for r in v for x, y in r
                            if x - ox <= inset_x + inset_w + INSET_GUARD), default=0.0)
    extra_down = max(0.0, round(land_bottom_left + inset_h + inset_margin + INSET_GUARD + 2.0 - H, 1))
    H = round(H + extra_down, 1)
    vb = [0, 0, W, H]
    inset_y = round(H - inset_h - inset_margin, 1)

    # 内容等比铺满插图内框
    k = min((inset_w - inset_pad * 2) / (bbi[2] - bbi[0]),
            (inset_h - inset_pad * 2) / (bbi[3] - bbi[1]))
    tx = inset_x + inset_w / 2 - k * (bbi[0] + bbi[2]) / 2
    ty = inset_y + inset_h / 2 - k * (bbi[1] + bbi[3]) / 2

    def fit(polys):
        return [[(k * x + tx, k * y + ty) for x, y in r] for r in polys]

    inset_box = [inset_x, inset_y, inset_w, inset_h]
    inset = {
        "box": inset_box,
        "outline": svg_path(fit(inset_xy), EPS_INSET, MIN_EXTENT, "南海诸岛插图", notes, losses),
        "nineDash": svg_path(fit(nine_xy), EPS_INSET, MIN_EXTENT, "十段线", notes, losses),
    }

    # ---- 自查：插图框内不许有主图陆地（右下角压着福建/台湾那种摆法要拦下）----
    def check_inset_clear():
        guard = INSET_GUARD
        x0, y0, x1, y1 = (inset_x - guard, inset_y - guard,
                          inset_x + inset_w + guard, inset_y + inset_h + guard)
        hits = []
        for ad, v in prov_main_xy.items():
            for r in v:
                for x, y in r:
                    xx, yy = x - ox, y - oy
                    if x0 <= xx <= x1 and y0 <= yy <= y1:
                        hits.append(province_names.get(ad, ad))
        return sorted(set(hits))

    blocked = check_inset_clear()
    if blocked:
        print("❌ 插图框（含 10 单位余量）压住了陆地：%s" % "、".join(blocked))
        raise SystemExit(1)
    print("插图框 %s 内无主图陆地 ✔（含 10 单位余量）；图框向下让出 %.1f 单位"
          % ([round(v, 1) for v in inset_box], extra_down))

    # ---------------- 反向校验：四座山归属 ----------------
    dem = read_dem_meta()
    locs = read_locations()
    print("\n=== 位置反向校验（点在多边形 vs locations.ts 人工声明）===")
    probe = {}
    failures = []
    for loc in locs:
        tag = loc["tag"]
        if tag not in dem:
            failures.append("%s：src/data/dem-*.ts 里没有这个 tag" % tag)
            continue
        lat, lon = dem[tag]
        hits = [ad for ad, (_, rs) in province_src.items()
                if any(in_ring(lon, lat, r) for r in rs)]
        # 到最近**他省**边界的距离（度 → km）
        km_per_deg = 111.32
        other_km = 9e9
        for ad, (_, rs) in province_src.items():
            if ad in hits:
                continue
            for r in rs:
                for i in range(len(r) - 1):
                    d = seg_dist((lon, lat), r[i], r[i + 1]) * km_per_deg
                    if d < other_km:
                        other_km = d
        poly_name = "、".join(province_names.get(a, a) for a in hits) or "未命中任何省"
        declared_in_poly = loc["adcode"] in hits
        border_like = other_km < 2.0
        print("  %-8s %8.4fN %9.4fE  声明=%-10s 多边形=%-14s 到最近他省界 %7.2f km"
              % (tag, lat, lon, loc["province"], poly_name, other_km))
        if loc["onBorder"]:
            if not border_like:
                failures.append(
                    "%s：声明 onBorder=true 但实测到最近他省界 %.2f km（>2 km），"
                    "不能用省界解释归属差异" % (tag, other_km))
            elif declared_in_poly:
                print("            ↑ 声明与多边形一致，且确实贴省界（%.2f km）" % other_km)
            else:
                print("            ↑ 省界情形：多边形判为 %s，采用权威口径 %s"
                      % (poly_name, loc["province"]))
        else:
            if not declared_in_poly:
                failures.append(
                    "%s：声明 %s(%s) 但多边形判为 %s，且不贴省界 —— 归属写错了？"
                    % (tag, loc["province"], loc["adcode"], poly_name))
        x, y = proj(lon, lat)
        probe[tag] = [round(x * SCALE - ox, 2), round(y * SCALE - oy, 2)]
        if not (0 <= probe[tag][0] <= vb[2] and 0 <= probe[tag][1] <= vb[3]):
            failures.append("%s：投影后落在 viewBox 外 %s" % (tag, probe[tag]))

    print("  声明为省界情形的山：%d 座" % sum(1 for l in locs if l["onBorder"]))
    if failures:
        print("\n❌ 反向校验失败：")
        for f in failures:
            print("   -", f)
        raise SystemExit(1)
    print("✅ 反向校验通过")

    # ---- 统一裁判：抽稀有没有吞掉看得见的环 ----
    for msg in notes:
        print("· " + msg)
    if losses:
        print("❌ 抽稀吞掉了看得见的环（几何静默缺失）：")
        for msg in losses:
            print("   " + msg)
        raise SystemExit(1)

    # 断续线段数必须与源数据一致 —— 这条是给「十段线画成八段线」那道事故上的锁。
    # 源数据 100000_JD 每个环就是一段，段数对不上就是有段被吞了。
    n_dash_src = len(nine_src)
    n_dash_out = inset["nineDash"].count("M")
    if n_dash_out != n_dash_src:
        print("❌ 断续线段数不符：源 %d 段，产物 %d 段" % (n_dash_src, n_dash_out))
        raise SystemExit(1)
    print("抽稀体检 ✔ 未吞掉任何跨度 ≥ %.1f 单位的环；断续线 %d 段完整"
          "（国界 %d 环 / 省界 %d 省）"
          % (MIN_EXTENT, n_dash_out, len(outline_main), len(provinces)))

    data = {
        "meta": {
            "projection": "lambert-conic-conformal",
            "params": LCC,
            "scale": SCALE,
            "offset": [ox, oy],
            "viewBox": vb,
            "source": "阿里云 DataV（高德地图底图数据）areas_v3/bound/100000_full.json",
            "note": "主图含台湾省、香港特别行政区、澳门特别行政区；南海诸岛与十段线置于左下角插图。",
            "probe": probe,
        },
        "outline": outline_path,
        "provinces": provinces,
        "provinceNames": province_names,
        "inset": inset,
    }

    text = HEADER + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    kb = len(text.encode("utf-8")) / 1024

    if check_only:
        cur = io.open(OUT_TS, encoding="utf-8").read() if os.path.exists(OUT_TS) else ""
        same = cur.strip() == text.strip()
        print("\n[--check] 磁盘上的 china-map.ts 与重新生成的结果 %s" % ("一致 ✔" if same else "不一致 ✘"))
        if not same:
            raise SystemExit(1)
    else:
        io.open(OUT_TS, "w", encoding="utf-8", newline="\n").write(text)
        print("\n写出 %s  %.1f KB" % (os.path.relpath(OUT_TS, ROOT), kb))

    print("   主图 viewBox %s（宽高比 %.3f）；插图 %s"
          % (vb, vb[2] / vb[3], [round(v, 1) for v in inset_box]))
    print("   省数 %d；插图内容宽高比 %.3f；十段线 path %d 字符"
          % (len(provinces), content_ar, len(inset["nineDash"])))
    print("   probe（前端投影一致性交叉校验用）: %s" % probe)


if __name__ == "__main__":
    main()
