#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成「双色底图」素材 public/textures/earth_base.png。

用途（v1.5.0 需求①）：
  球面上增加一种**只分大洲与海洋**的底图 —— 海洋浅蓝、大洲深灰，两色即可，
  比卫星影像更干净，学生一眼能认出陆地轮廓。

为什么不用卫星影像抠图：
  earth.jpg 里有云（实测亮度可到 255、饱和度 0），云在海面上会被判成陆地、
  云在陆地上会把轮廓切碎；两极冰盖又是亮的。用照片做阈值分类必然要配一套
  云修补，结果仍不确定。改用**真实海陆矢量**栅格化：海岸线干净、无云、
  且**不涉及任何政治边界**（合规：只画自然地理海陆，不画国界）。

数据来源：world-atlas@2.0.2 的 land-10m.json（Natural Earth 1:10m 陆地多边形，
  TopoJSON 量化格式）。经 jsdelivr npm CDN 取回（本机 GitHub raw 不通）。
  sha256 与 jsdelivr 声明的哈希对账，对不上直接失败。

输出：2048×1024 的等距圆柱（equirectangular）RGB 图，与 earth.jpg / earth_night.jpg
  同投影同尺寸 ⇒ 三者共用同一套 UV，可直接互换。

⚠ 本图**刻意不含国界线**。地图上任何"边界"的画法都必须符合国家测绘标准，
  把台湾岛、南海诸岛、藏南等画成独立色块或缺口都属于违规。做自然地理海陆掩膜
  从根上避开这一类问题：陆地只有一种颜色，岛屿与大陆同色，不表达任何归属关系。
  自检里因此专门探了台湾岛、海南岛、南海海域几个点，确认台湾按陆地着色。

用法：python scripts/make_basemap.py [--check]
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
import urllib.request

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
OUT = os.path.join(GAME, "public", "textures", "earth_base.png")
CACHE = os.path.join(GAME, ".workbuddy", "tmp", "globe-assets", "land-10m.json")

URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-10m.json"
# jsdelivr 的 /packages 接口给出的 sha256（base64），用于下载对账
EXPECT_SHA256_B64 = "m59YRwnBGdY/ut9ITOQlJgSXaXtxZr56L+Ng6MCxcag="

W, H = 2048, 1024

# 需求①指定的两种颜色
OCEAN = (168, 216, 240)   # #A8D8F0 浅蓝
LAND = (80, 85, 92)       # #50555C 深灰

# 自检探针：(名称, 经度, 纬度, 期望)
PROBES = [
    ("北京", 116.4, 39.9, "land"),
    ("珠峰", 86.9, 27.99, "land"),
    ("台湾岛", 121.0, 23.7, "land"),
    ("海南岛", 109.7, 19.2, "land"),
    ("南极大陆", 0.0, -80.0, "land"),
    ("格陵兰", -42.0, 72.0, "land"),
    ("撒哈拉", 10.0, 20.0, "land"),
    ("亚马逊", -60.0, -5.0, "land"),
    ("太平洋中部", -160.0, 0.0, "ocean"),
    ("大西洋中部", -40.0, 30.0, "ocean"),
    ("北冰洋", 0.0, 85.0, "ocean"),
    ("南海", 115.0, 15.0, "ocean"),
    ("印度洋", 75.0, -20.0, "ocean"),
]


def fetch() -> bytes:
    if os.path.exists(CACHE):
        with open(CACHE, "rb") as fh:
            return fh.read()
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with urllib.request.urlopen(URL, timeout=180) as resp:
        blob = resp.read()
    with open(CACHE, "wb") as fh:
        fh.write(blob)
    return blob


def check_hash(blob: bytes) -> str:
    got = base64.b64encode(hashlib.sha256(blob).digest()).decode()
    if got != EXPECT_SHA256_B64:
        raise SystemExit(
            f"sha256 对账失败：期望 {EXPECT_SHA256_B64}，实得 {got}（数据可能已变更）"
        )
    return got


def decode_arcs(topo: dict):
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]

    def dec(arc):
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        return pts

    return [dec(a) for a in topo["arcs"]]


def ring_pts(ring, arcs):
    pts: list[tuple[float, float]] = []
    for idx in ring:
        seg = arcs[idx] if idx >= 0 else arcs[~idx][::-1]
        pts.extend(seg[1:] if pts else seg)
    return pts


def unwrap(pts):
    """经度解绕：让相邻点的经度差永远不超过 180°。

    为什么要这一步：**骑在 180° 经线上的岛屿**（实测弗兰格尔岛 ~71°N、斐济一带
    ~16.5°S）在数据里一边是 +179.x、另一边是 −179.x。不解绕直接栅格化，PIL 会从
    +180 连一条直线回到 −180 —— 于是整张图上多出一条**横贯全图的灰线**。
    解绕后这些岛在图上变成跨 179°→181° 的连续形状，配合下面三档偏移绘制即可闭合。
    """
    out = [pts[0]]
    for lon, lat in pts[1:]:
        prev = out[-1][0]
        while lon - prev > 180.0:
            lon -= 360.0
        while lon - prev < -180.0:
            lon += 360.0
        out.append((lon, lat))
    return out


def to_px(pts, shift=0.0):
    return [
        ((lon + shift + 180.0) / 360.0 * W, (90.0 - lat) / 180.0 * H) for lon, lat in pts
    ]


def build() -> Image.Image:
    blob = fetch()
    digest = check_hash(blob)
    topo = json.loads(blob)
    arcs = decode_arcs(topo)
    geom = topo["objects"]["land"]
    if geom["type"] == "GeometryCollection":
        polys = [p for g in geom["geometries"] if g["type"] == "MultiPolygon" for p in g["arcs"]]
    else:
        polys = geom["arcs"]
    print(f"land-10m sha256(b64)={digest[:16]}… 多边形组数={len(polys)} 弧段数={len(arcs)}")

    mask = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(mask)
    n_wrapped = 0
    n_polar = 0
    for poly in polys:
        # 第 0 环是外环，其余是**洞**（里海、咸海这类大湖）：先填陆地再挖掉
        for i, ring in enumerate(poly):
            raw = ring_pts(ring, arcs)
            if len(raw) < 3:
                continue
            pts = unwrap(raw)
            # 经线接缝：跨 180° 的环在解绕后首尾经度差仍接近 360°。
            # 此时若**两端都落在极区**，说明这条环是绕极点的闭合线（南极大陆就是
            # 这样：实测数据只画到 −84.2°S，再往回直线连回起点 ⇒ 85°S 以南整片空着）。
            # 正确做法是让它**经由极点闭合**：补两个 ±90° 的点再连回去。
            span = abs(pts[-1][0] - pts[0][0])
            if span > 180.0:
                if pts[0][1] < -60.0 and pts[-1][1] < -60.0:
                    pts = pts + [(pts[-1][0], -90.0), (pts[0][0], -90.0)]
                    n_polar += 1
                elif pts[0][1] > 60.0 and pts[-1][1] > 60.0:
                    pts = pts + [(pts[-1][0], 90.0), (pts[0][0], 90.0)]
                    n_polar += 1
                else:
                    n_wrapped += 1
            fill = 0 if i else 255
            # 三档偏移：解绕后越过 ±180 的部分，靠 ±360 平移的那一份补到另一侧边缘
            for shift in (-360.0, 0.0, 360.0):
                px = to_px(pts, shift)
                if max(p[0] for p in px) < 0 or min(p[0] for p in px) > W:
                    continue
                draw.polygon(px, fill=fill)
    print(f"经极点闭合的环 ={n_polar}   其余跨接缝环 ={n_wrapped}")

    out = Image.new("RGB", (W, H), OCEAN)
    out.paste(Image.new("RGB", (W, H), LAND), mask=mask)
    return out


def band_frac(img: Image.Image, lat: float) -> float:
    """某一纬度整行上"陆地"占的比例 —— 用来验收极区闭合有没有真的生效。"""
    px = img.load()
    y = min(max(int((90.0 - lat) / 180.0 * H), 0), H - 1)
    n = 0
    for x in range(0, W, 2):
        r, g, b = px[x, y]
        if abs(r - LAND[0]) < 12 and abs(b - LAND[2]) < 12:
            n += 1
    return n / (W / 2)


def verify(img: Image.Image, lands_frac: float) -> int:
    bad = 0
    for name, lon, lat, want in PROBES:
        x = int((lon + 180.0) / 360.0 * W)
        y = int((90.0 - lat) / 180.0 * H)
        x = min(max(x, 0), W - 1)
        y = min(max(y, 0), H - 1)
        r, g, b = img.getpixel((x, y))
        kind = "land" if abs(r - LAND[0]) < 12 and abs(b - LAND[2]) < 12 else "ocean"
        flag = "OK " if kind == want else "RED"
        if kind != want:
            bad += 1
        print(f"  [{flag}] {name:<10} ({lon:>7.1f},{lat:>6.1f}) → {kind}  期望 {want}")
    print(f"陆地图元占比 = {lands_frac * 100:.2f}%")

    # 极区验收：源头数据南极只画到 −84.2°S，若不补极点闭合，85°S 以南会整片空出来
    print("极区闭合验收（该纬度整行的陆地占比）：")
    for lat, least in ((-80.0, 0.60), (-85.0, 0.55), (-88.0, 0.55), (-89.9, 0.98)):
        got = band_frac(img, lat)
        ok = got >= least
        if not ok:
            bad += 1
        print(f"  [{'OK ' if ok else 'RED'}] lat {lat:>6.1f} → {got * 100:5.1f}%  下限 {least * 100:.0f}%")
    # 北极是北冰洋，不该被误填成陆地
    got = band_frac(img, 88.0)
    if got > 0.02:
        bad += 1
    print(f"  [{'OK ' if got <= 0.02 else 'RED'}] lat   88.0 → {got * 100:5.1f}%  期望 ≤2%（北冰洋）")
    return bad


def main() -> int:
    img = build()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT, optimize=True)
    size = os.path.getsize(OUT)

    # 陆地占比：直接在成品图上统计，与写出的是同一份数据
    nland = 0
    px = img.load()
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            r, g, b = px[x, y]
            if abs(r - LAND[0]) < 12 and abs(b - LAND[2]) < 12:
                nland += 1
    frac = nland / ((W // 2) * (H // 2))

    print(f"写出 {OUT}  {img.size[0]}x{img.size[1]}  {size / 1024:.1f} KB")
    bad = verify(img, frac)
    if bad:
        print(f"!!! {bad} 个探针未通过")
        return 1
    print("全部探针通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
