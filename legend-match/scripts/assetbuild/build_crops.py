# -*- coding: utf-8 -*-
"""批量生成 22 个图例素材（教材图抠图 + Otsu 增强），并出核对网格。"""
import os, sys, json, io
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from enhance import enhance, detect_boxes, SRC

HERE = os.path.dirname(os.path.abspath(__file__))

# 按 (列, 行序) 给 detect_boxes 的结果命名 —— 顺序由面板布局唯一确定
NAMES = [
    "居民点", "公路",            # 面板1 符号列
    "铁路", "高速铁路", "高速公路",  # 面板2
    "山峰", "火山",              # 面板3
    "洲界",                     # 面板4
    "长城", "关隘",              # 面板5
    "水库", "水电站",            # 面板6
    "国界", "未定国界",           # 面板7
    "机场",                     # 面板8
    "沙漠", "时令河、湖",         # 面板9
    "中国省、自治区、直辖市界",    # 面板10
    "港口", "航海线",            # 面板11
    "瀑布", "常年河、湖",         # 面板12
]



BOX_OVERRIDE = {
    # 自动检测在这里把"线"与"湖面"之间的空隙当成符号结束，只截到线的一半、丢掉湖面。
    # 这两个框由**源图像素实测**得到（蓝色像素列的连续段：时令行 1442..1587、
    # 常年行 1437..1591），不是目测。注意右边界必须给足：给到 1565 会把湖的右侧切掉，
    # 症状是湖面出现一条**竖直的直边**。
    "时令河、湖": (1436, 636, 1594, 700),
    "常年河、湖": (1434, 852, 1596, 916),
}

def tighten(im, box, thr=42):
    a = np.asarray(im.crop(box).convert("RGB")).astype(np.int16)
    ink = np.abs(255 - a).max(axis=2) > thr
    ys, xs = np.where(ink)
    if len(ys) == 0:
        return box
    x0, y0, x1, y1 = box
    p = 1
    return (x0 + max(0, xs.min() - p), y0 + max(0, ys.min() - p),
            x0 + min(x1 - x0, xs.max() + 1 + p), y0 + min(y1 - y0, ys.max() + 1 + p))


def main():
    src = Image.open(SRC).convert("RGB")
    boxes = detect_boxes()
    assert len(boxes) == len(NAMES), "框数 %d != 命名数 %d" % (len(boxes), len(NAMES))

    out_dir = os.path.join(HERE, "crops_out")
    os.makedirs(out_dir, exist_ok=True)
    CELL, PAD, LBL, COLS = 118, 10, 96, 6
    rows = (len(NAMES) + COLS - 1) // COLS
    W = LBL + COLS * (CELL * 2 + PAD) + PAD
    H = 30 + rows * (CELL + PAD + 16) + PAD
    sheet = Image.new("RGB", (W, H), (252, 251, 248))
    d = ImageDraw.Draw(sheet)
    d.text((10, 8), "教材图抠图（左＝直接放大，右＝Otsu 增强）", fill=(30, 30, 30))

    meta = []
    for i, (name, box) in enumerate(zip(NAMES, boxes)):
        tb = tighten(src, BOX_OVERRIDE.get(name, box))
        crop = src.crop(tb)
        en = enhance(crop)
        # 存 PNG（保持原比例，正方形底板由前端 CSS 处理）
        safe = name.replace("、", "_").replace("，", "_")
        fn = "crop_%02d.png" % (i + 1)
        place(en, tb).save(os.path.join(out_dir, fn))
        meta.append({"name": name, "file": fn, "box": [int(v) for v in tb],
                     "native": [int(tb[2] - tb[0]), int(tb[3] - tb[1])]})
        r, c = divmod(i, COLS)
        x = LBL + PAD + c * (CELL * 2 + PAD)
        y = 30 + r * (CELL + PAD + 16)
        d.text((8, y + CELL // 2 - 6), name, fill=(40, 40, 40))
        d.text((8, y + CELL // 2 + 10), "%dx%d" % (tb[2] - tb[0], tb[3] - tb[1]), fill=(165, 165, 165))
        a = fit(src.crop(tb).convert("RGBA"), CELL)
        b = fit(en, CELL)
        sheet.paste(a, (x, y)); sheet.paste(b, (x + CELL, y))
        d.rectangle([x, y, x + CELL * 2 - 1, y + CELL], outline=(214, 214, 214))
        d.line([(x + CELL - 1, y), (x + CELL - 1, y + CELL)], fill=(214, 214, 214))

    sheet.save(os.path.join(HERE, "shot_crops_all.png"))
    json.dump(meta, io.open(os.path.join(HERE, "crops_meta.json"), "w"), ensure_ascii=False, indent=1)
    print("shot_crops_all.png", sheet.size)


def fit(im, size, pad=0.10):
    c = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    sc = size * (1 - pad * 2) / max(im.width, im.height)
    r = im.resize((max(1, int(im.width * sc)), max(1, int(im.height * sc))), Image.LANCZOS)
    c.paste(r, ((size - r.width) // 2, (size - r.height) // 2), r if r.mode == "RGBA" else None)
    return c.convert("RGB") if r.mode != "RGBA" else c


def place(en, box):
    """存成正方形 PNG（透明底），边长 320。"""
    return fit(en, 320, pad=0.08)


if __name__ == "__main__":
    main()
