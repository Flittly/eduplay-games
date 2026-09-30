#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
fish-master 世界底图数据生成（合规数据源）
==========================================

输出 `public/assets/world-land.json`：一张**全球陆地轮廓**的矢量数据，
供 CurrentMap.tsx 在两处使用：

  ① 离线回退底图 —— 天地图影像取不到时（没网 / 没填密钥）画它，
     保证游戏**离线可玩**；
  ② 影像底图之上的**国界强调层** —— 影像图上看不清国界，叠一层轮廓。

## 数据来源（合规）

  * 世界陆地掩膜：Natural Earth 110m land（**公有领域**，只有海陆之分、
    **不含任何国界**）
  * 中国边界（含台湾、南海诸岛）：阿里云 DataV（高德地图底图数据）

世界图上**不使用任何境外底图的国界**：陆地用 Natural Earth（无国界），
国界单独用 DataV 的中国边界叠加。这是 landform-quiz 已确立的口径，
保持一致。

## 投影

等距圆柱，**纬度范围取满 −90~90**（与 proj.ts 的 MAP_W/MAP_H 对应）。
不需要裁剪到 −58~84（那是 landform-quiz 的中国聚焦取景，我们全球图要南极）。

## 为什么在服务端就把 GeoJSON 抽稀成 path

运行时只保留「经纬度点列」，投影换算在前端用同一套 proj.ts 公式做。
好处：① 数据文件小（抽稀后 ~40KB，不抽稀 138KB）；
② 前端不用解析 GeoJSON；③ 投影口径只有 proj.ts 一处。

用法：python fish-master/scripts/prepare_world.py
"""

import io
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public", "assets", "world-land.json")
CACHE = os.path.abspath(os.path.join(ROOT, "..", ".workbuddy", "tmp", "mapcache"))

# 抽稀容差（度）。110m 数据本身已经很粗（约 1:110,000,000），
# 0.6° 容差下海岸线仍然看得出形状，点数砍掉一半以上。
# 实测：小于 0.4° 省不下多少、大于 1.0° 就开始把大岛屿（日本、新西兰）磨平。
TOL = 0.6

# 微小的环（小于这个面积平方根的环）直接丢掉 —— 多数是礁石、小岛
MIN_RING_SPAN = 0.8


def load_land():
    """读 Natural Earth 110m 陆地（优先本地缓存）。"""
    cached = os.path.join(CACHE, "ne_110m_land.geojson")
    if not os.path.exists(cached):
        raise RuntimeError(
            "找不到 %s。请先跑 landform-quiz 的 prepare_maps.py 生成缓存，"
            "或手动下载 ne_110m_land.geojson 放到该目录。" % cached
        )
    with io.open(cached, encoding="utf-8") as f:
        return json.load(f)


def ring_span(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return max(max(xs) - min(xs), max(ys) - min(ys))


def rdp(points, tol):
    """Ramer–Douglas–Peucker 抽稀（迭代版，避免深递归）。"""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i0, i1 = stack.pop()
        if i1 <= i0 + 1:
            continue
        x0, y0 = points[i0]
        x1, y1 = points[i1]
        dx = x1 - x0
        dy = y1 - y0
        seg = (dx * dx + dy * dy) ** 0.5
        best = -1.0
        best_i = -1
        for i in range(i0 + 1, i1):
            px, py = points[i]
            if seg == 0:
                d = ((px - x0) ** 2 + (py - y0) ** 2) ** 0.5
            else:
                d = abs(dy * px - dx * py + x1 * y0 - y1 * x0) / seg
            if d > best:
                best = d
                best_i = i
        if best > tol:
            keep[best_i] = True
            stack.append((i0, best_i))
            stack.append((best_i, i1))
    return [p for p, k in zip(points, keep) if k]


def main():
    geo = load_land()
    rings_out = []
    n_in = 0
    n_out = 0

    for feat in geo["features"]:
        geom = feat["geometry"]
        gtype = geom["type"]
        polys = geom["coordinates"]
        if gtype == "Polygon":
            polys = [polys]
        for poly in polys:
            for ring in poly:
                n_in += 1
                if ring_span(ring) < MIN_RING_SPAN:
                    continue
                simp = rdp([(float(p[0]), float(p[1])) for p in ring], TOL)
                if len(simp) < 4:
                    continue
                # 保留 3 位小数（0.001° ≈ 110m，够 110m 数据用），去重相邻重复点
                pts = []
                for lon, lat in simp:
                    q = (round(lon, 3), round(lat, 3))
                    if not pts or pts[-1] != q:
                        pts.append(q)
                if len(pts) < 4:
                    continue
                n_out += 1
                rings_out.append(pts)

    # 按点数从大到小排（大块先画，小岛后画盖在上面）
    rings_out.sort(key=len, reverse=True)

    data = {
        "meta": {
            "projection": "equirectangular",
            "lonRange": [-180, 180],
            "latRange": [-90, 90],
            "source": "陆地掩膜 Natural Earth 110m land（公有领域，仅海陆、无国界）",
            "simplifyTol": TOL,
            "note": "坐标 [lon, lat]，东经北纬为正。投影换算见 src/proj.ts"
        },
        "rings": [
            [[round(lon, 3), round(lat, 3)] for lon, lat in r] for r in rings_out
        ]
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    txt = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    io.open(OUT, "w", encoding="utf-8", newline="").write(txt)

    total_pts = sum(len(r) for r in rings_out)
    print("输入环：%d  输出环：%d" % (n_in, n_out))
    print("总点数：%d" % total_pts)
    print("输出：%s  (%.1f KB)" % (OUT, os.path.getsize(OUT) / 1024.0))


if __name__ == "__main__":
    main()
