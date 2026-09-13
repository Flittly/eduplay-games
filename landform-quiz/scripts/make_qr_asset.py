"""把用户提供的小红书二维码卡片裁成干净的二维码方图（保留静默区）。

输入：卡片图（二维码 + 下方文字），987x1347
输出：public/assets/brand/qr.png —— 仅二维码本体 + 静默区，
      供页面页脚与「导出结果长图」共用。

定位思路：
1. 逐行统计暗像素数量，取出「有内容」的行块（cnt > 60）。
2. 二维码是点阵图，点与点之间会有几像素的空行 —— 所以不能把每个行块当独立对象，
   要按「相邻行块间隔 <= 60px 就归为同一组」合并。
3. 第一组就是二维码；其后的长间隔（这里 ~116px）之后才是文字。
4. 在该组的行范围内取暗像素的横向范围，得到二维码本体的正方形边界。
"""
import sys
from pathlib import Path
from PIL import Image

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    r"D:\Users\Administrator\Documents\Tencent Files\Tencent Files\2605948957"
    r"\nt_qq\nt_data\Pic\2026-09\Ori\a45bad73ff1434ed3eaeddb92394a2f7.jpg"
)
OUT = Path(__file__).resolve().parent.parent / "public" / "assets" / "brand" / "qr.png"
OUT.parent.mkdir(parents=True, exist_ok=True)

THRESH = 190          # 暗像素阈值
MIN_ROW_DARK = 60     # 一行至少有这么多暗像素才算"有内容"
MERGE_GAP = 60        # 相邻行块间隔小于此值 → 同属一个对象
TARGET = 540          # 输出边长（页面页脚约 110px、长图约 200px 显示，540 足够且仍可扫）
QUIET_RATIO = 0.08    # 静默区 = 边长 * 该比例
PALETTE = 16          # 量化色数：二维码是灰阶 + 蓝色地球，16 色足够，体积从 231KB 降到 ~56KB

im = Image.open(SRC).convert("RGB")
W, H = im.size
print(f"源图: {W}x{H}")

g = im.convert("L")
px = g.load()
dark_cols = [[x for x in range(W) if px[x, y] < THRESH] for y in range(H)]

runs, cur = [], None
for y in range(H):
    if len(dark_cols[y]) > MIN_ROW_DARK:
        if cur is None:
            cur = y
    elif cur is not None:
        runs.append((cur, y - 1))
        cur = None
if cur is not None:
    runs.append((cur, H - 1))

groups, g0, g1 = [], runs[0][0], runs[0][1]
for a, b in runs[1:]:
    if a - g1 - 1 <= MERGE_GAP:
        g1 = b
    else:
        groups.append((g0, g1))
        g0, g1 = a, b
groups.append((g0, g1))

print(f"内容分组: {[(a, b, b - a + 1) for a, b in groups]}")
y0, y1 = groups[0]

xs = [x for y in range(y0, y1 + 1) for x in dark_cols[y]]
x0, x1 = min(xs), max(xs)
print(f"二维码本体: x {x0}-{x1} ({x1 - x0 + 1}px)  y {y0}-{y1} ({y1 - y0 + 1}px)")

side = max(x1 - x0 + 1, y1 - y0 + 1)
pad = int(side * QUIET_RATIO)
half = side // 2 + pad
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
box = (max(0, cx - half), max(0, cy - half), min(W, cx + half), min(H, cy + half))
crop = im.crop(box)
print(f"裁剪区: {box}  →  {crop.size[0]}x{crop.size[1]}（静默区 {pad}px）")

if crop.size[0] != crop.size[1]:
    side2 = min(crop.size)
    l = (crop.size[0] - side2) // 2
    t = (crop.size[1] - side2) // 2
    crop = crop.crop((l, t, l + side2, t + side2))

if crop.size[0] > TARGET:
    crop = crop.resize((TARGET, TARGET), Image.LANCZOS)

# 量化成调色板 PNG：保留锐利边缘（JPEG 的块效应会伤二维码可扫性），同时把体积压下来
out = crop.quantize(colors=PALETTE, method=Image.MEDIANCUT, dither=Image.NONE)
out.save(OUT, "PNG", optimize=True)
print(f"输出: {OUT}  {out.size[0]}x{out.size[1]}  {OUT.stat().st_size / 1024:.1f} KB（{PALETTE} 色）")
