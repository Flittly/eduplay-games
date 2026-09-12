#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
微缩地图数据生成脚本（合规数据源）
------------------------------------------------
输出两个文件到 public/assets/maps/：
  china.json —— 中国地图：国界轮廓 + 省界（淡）+ 南海断续线（九段线）
  world.json —— 世界地图：陆地掩膜 + 按国家标准绘制的中国边界（含台湾、南海诸岛）

数据来源（均在合规白名单内的中国境内服务）：
  * 中国边界 / 省界 / 南海断续线：阿里云 DataV（高德地图底图数据）
      https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json
  * 世界陆地：Natural Earth 110m 陆地掩膜（公有领域，只有海陆之分、不含任何国界）
      世界图上的国界一律以 DataV 中国边界为准叠加绘制，不使用境外底图的边界。

坐标一律转成 SVG path 字符串并在服务端完成抽稀，运行时不再解析 GeoJSON，
只保留「投影参数 + path」，前端用同样的投影公式把经纬度换算成红点位置。

用法：python scripts/prepare_maps.py
"""

import io
import json
import math
import os
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUTDIR = os.path.join(ROOT, "public", "assets", "maps")
CACHE = os.path.abspath(os.path.join(ROOT, "..", ".workbuddy", "tmp", "mapcache"))

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36"

CN_FULL = "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json"
CN_SINGLE = "https://geo.datav.aliyun.com/areas_v3/bound/100000.json"
NE_LAND = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
           "master/geojson/ne_110m_land.geojson")

# 中国图：兰伯特等角圆锥投影（国内标准地图常用），标准纬线 25°N / 47°N、中央经线 105°E
LCC = {"phi1": 25.0, "phi2": 47.0, "phi0": 0.0, "lam0": 105.0}
# 世界图：等距圆柱投影，纬度裁剪到 [-58, 84]（不含南极洲）
EQ = {"latMin": -58.0, "latMax": 84.0}

SCALE = 1000.0
PAD = 16.0


def fetch(url, cache_name):
    """优先读本地缓存（用 curl 预下载更稳）；没有则带重试地拉取。"""
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


# ---------------- 投影 ----------------

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
        # 注意取负：圆锥投影的 y 向北增大，而屏幕坐标 y 向南增大，必须翻转一次，
        # 否则中国图会南北颠倒。
        return rho * math.sin(th), rho * math.cos(th) - rho0

    return proj


def make_eq(p):
    lat_min, lat_max = p["latMin"], p["latMax"]

    def proj(lon, lat):
        return math.radians(lon), -math.radians(min(max(lat, lat_min), lat_max))

    return proj


# ---------------- 抽稀与出图 ----------------

def rdp(pts, eps):
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
        norm = math.hypot(dx, dy) or 1e-12
        best, best_i = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if d > best:
                best, best_i = d, i
        if best > eps:
            keep[best_i] = True
            stack.append((a, best_i))
            stack.append((best_i, b))
    return [p for p, k in zip(pts, keep) if k]


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


def project_rings(rings, proj):
    """投影 + 抽稀前的预处理：去掉闭合重复点，短环丢弃。"""
    out = []
    for ring in rings:
        pts = []
        for lon, lat in ring:
            x, y = proj(lon, lat)
            pts.append((x * SCALE, y * SCALE))
        # GeoJSON 的环是闭合的（首尾点相同），必须先去掉尾点，
        # 否则道格拉斯-普克会因首尾重合而退化、只保留两个点。
        if len(pts) > 1 and abs(pts[0][0] - pts[-1][0]) < 1e-9 and abs(pts[0][1] - pts[-1][1]) < 1e-9:
            pts = pts[:-1]
        if len(pts) >= 3:
            out.append(pts)
    return out


def bbox_of(rings):
    xs = [p[0] for r in rings for p in r]
    ys = [p[1] for r in rings for p in r]
    if not xs:
        return None
    return (min(xs), min(ys), max(xs), max(ys))


def make_path(rings, eps, ox, oy):
    parts = []
    for r in rings:
        pts = rdp(r, eps)
        if len(pts) < 3:
            continue
        parts.append("M" + "L".join(
            "%d %d" % (round(x - ox), round(y - oy)) for x, y in pts) + "Z")
    return "".join(parts)


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    print("拉取中国边界（阿里云 DataV / 高德底图数据）…")
    cn_full = fetch(CN_FULL, "cn_full.json")
    cn_single = fetch(CN_SINGLE, "cn_single.json")
    print("拉取世界陆地（Natural Earth 110m，仅有海陆掩膜、无国界）…")
    ne = fetch(NE_LAND, "ne_110m_land.geojson")

    outline_src, province_src, nine_src = [], [], []
    for f in cn_full["features"]:
        if f["properties"].get("adcode") == "100000_JD":
            nine_src += rings_of(f["geometry"])
        else:
            province_src += rings_of(f["geometry"])
    for f in cn_single["features"]:
        outline_src += rings_of(f["geometry"])

    # ---------- 中国图 ----------
    proj_cn = make_lcc(LCC)
    outline = project_rings(outline_src, proj_cn)
    nine = project_rings(nine_src, proj_cn)
    province = project_rings(province_src, proj_cn)

    bb = bbox_of(outline) or bbox_of(province)
    bb2 = bbox_of(nine)
    if bb2:
        bb = (min(bb[0], bb2[0]), min(bb[1], bb2[1]), max(bb[2], bb2[2]), max(bb[3], bb2[3]))
    ox, oy = bb[0] - PAD, bb[1] - PAD
    vb = [0, 0, round(bb[2] - ox + PAD, 1), round(bb[3] - oy + PAD, 1)]

    china = {
        "meta": {
            "projection": "lambert-conic-conformal",
            "params": LCC,
            "scale": SCALE,
            "offset": [ox, oy],
            "viewBox": vb,
            "source": "阿里云 DataV（高德地图底图数据）areas_v3/bound/100000_full.json",
            "note": "含台湾省、香港特别行政区、澳门特别行政区及南海诸岛；南海断续线单独成层。"
        },
        "outline": make_path(outline, 0.8, ox, oy),
        "provinces": make_path(province, 2.4, ox, oy),
        "nineDash": make_path(nine, 0.4, ox, oy)
    }
    p1 = os.path.join(OUTDIR, "china.json")
    io.open(p1, "w", encoding="utf-8", newline="\n").write(
        json.dumps(china, ensure_ascii=False, separators=(",", ":")))

    # ---------- 世界图 ----------
    proj_w = make_eq(EQ)
    land = project_rings([r for f in ne["features"] for r in rings_of(f["geometry"])], proj_w)
    cn_on_world = project_rings(outline_src, proj_w)

    bbw = bbox_of(land)
    bbw2 = bbox_of(cn_on_world)
    if bbw2:
        bbw = (min(bbw[0], bbw2[0]), min(bbw[1], bbw2[1]), max(bbw[2], bbw2[2]), max(bbw[3], bbw2[3]))
    ox2, oy2 = bbw[0] - PAD, bbw[1] - PAD
    vb2 = [0, 0, round(bbw[2] - ox2 + PAD, 1), round(bbw[3] - oy2 + PAD, 1)]

    world = {
        "meta": {
            "projection": "equirectangular",
            "params": EQ,
            "scale": SCALE,
            "offset": [ox2, oy2],
            "viewBox": vb2,
            "source": "陆地掩膜 Natural Earth 110m land（公有领域，仅海陆、无国界）；中国边界为阿里云 DataV（高德）标准边界",
            "note": "中国疆域（含台湾省、南海诸岛）按国家标准边界单独叠加绘制；不含南极洲。"
        },
        "land": make_path(land, 1.6, ox2, oy2),
        "china": make_path(cn_on_world, 1.2, ox2, oy2)
    }
    p2 = os.path.join(OUTDIR, "world.json")
    io.open(p2, "w", encoding="utf-8", newline="\n").write(
        json.dumps(world, ensure_ascii=False, separators=(",", ":")))

    for p in (p1, p2):
        print("写出 %s  %d KB" % (os.path.basename(p), os.path.getsize(p) // 1024))
    print("china viewBox", china["meta"]["viewBox"])
    print("world viewBox", world["meta"]["viewBox"])

    # ---------- 自检：40 个地貌点是否都落在各自 viewBox 内 ----------
    lf = json.load(io.open(os.path.join(ROOT, "public", "data", "landforms.json"), encoding="utf-8"))
    bad = []
    for it in lf["landforms"]:
        if it["category"] == "domestic":
            m, pr = china["meta"], proj_cn
        else:
            m, pr = world["meta"], proj_w
        x, y = pr(it["lon"], it["lat"])
        x = x * m["scale"] - m["offset"][0]
        y = y * m["scale"] - m["offset"][1]
        if not (0 <= x <= m["viewBox"][2] and 0 <= y <= m["viewBox"][3]):
            bad.append((it["id"], round(x, 1), round(y, 1)))
    print("落在图外的地貌点:", bad or "无")


if __name__ == "__main__":
    main()
