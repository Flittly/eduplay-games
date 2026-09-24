# -*- coding: utf-8 -*-
"""把 73 张图例按**真实卡片尺寸**渲染出来，用来判断"看得清吗 / 粗细统一吗"。

为什么必须按真实尺寸看：素材是 512×512，放大看都好看；但卡片上符号长边只有
60~90 px，线状符号会**降到 1 px 以下**而"消失"。只看 512 的核对图会得出完全错误的
结论 —— 这个脚本就是为了消除这个视差。

## 底卡几何**从 styles.css 里读**，不许在本脚本里另抄一份

v1.1.0 踩过的坑：脚本里写死 `pad=4`（其实那是 gameData.ts 的**布局抖动**常量，
不是 CSS 内边距），又把边框/内边距按 `w/115` 等比缩放；而真机 CSS 是
「固定 3px 边框 + 固定 6px 内边距」，并且早期版本还是 `clamp(3px, 4%, 8px)`
（实测缩略图 4.64px、其余 8px 两拨值）。于是出了图"看着没问题"、真机却是另一回事。
⇒ 现在所有取值都从 `src/styles.css` 的 `:root` 里解析，读不到就直接退出。

## 成像模型（和 `.lcard img { object-fit: contain }` 对齐）

    内容盒 = (w − 2·边框 − 2·内边距, h − 2·边框 − 2·内边距)
    成像区 = min(内容盒宽, 内容盒高) 的正方形（1:1 的素材塞进非方形内容盒）
    符号长边 = 成像区 × 0.78      ← 0.78 是素材管线里的 FILL（符号占画布比例）

牌面尺寸照抄 gameData.ts 的 `layoutCards`：
    卡宽 = min(格宽, 格高×1.3, 168) 且不小于 56

## 关键结论（为什么只有牌面会出问题）

`.lcard` 的宽高比是 1.3 ⇒ 内容盒"宽而矮"，正方形素材被**高**卡住；
图鉴缩略/详情/放大卡都是 `aspect-ratio: 1/1` 的正方盒，不受影响。
所以"方/高的符号在牌面上显小"是几何必然，不是 bug；
而"图盒比内容盒高、被 overflow:hidden 平切"才是 bug（v1.1.0 已修）。
"""
import io, json, math, os, re, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
LM = os.path.join(REPO, "legend-match")
PUB = os.path.join(LM, "public")
CSS = os.path.join(LM, "src", "styles.css")


def cjk_font(size=14):
    """系统中文字体。PIL 默认位图字体没有汉字，标签会全变成方框 ——
    这几张对照图是给人看的，标签必须是能读的中文。"""
    for p in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf",
              r"C:\Windows\Fonts\simsun.ttc"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()

CARD_ASPECT, CARD_MAX_W, CARD_MIN_W = 1.3, 168, 56
MAX_ROT = 7.0
FILL = 0.78                     # 素材管线里符号占画布的比例（build_assets.py 的 FILL）

# 真机实测的牌面容器（Electron 离屏窗口 1280×820，见 .workbuddy/tmp/lm11verify/）
BOARD_W, BOARD_H = 1252, 694


def read_css_tokens():
    """:root 里的底卡取值。以 styles.css 为准 —— 唯一真相来源。"""
    src = io.open(CSS, encoding="utf-8").read()
    root = src.split(":root", 1)
    if len(root) < 2:
        raise SystemExit("styles.css 里找不到 :root")
    block = root[1].split("}", 1)[0]
    want = {
        "ground": r"--card-ground:\s*(#[0-9a-fA-F]{3,8})",
        "bw": r"--card-bw:\s*([0-9.]+)px",
        "pad": r"--card-pad:\s*([0-9.]+)px",
        "drop": r"--card-drop:\s*([0-9.]+)px",
    }
    got = {}
    for k, pat in want.items():
        m = re.search(pat, block)
        if not m:
            # --card-pad 写成百分比 / clamp 就会落到这里：那正是会产生"两拨值"的写法
            raise SystemExit(
                "styles.css 的 --card-%s 不是固定 px 值（读不到 %s）。\n"
                "底卡内边距必须是定值：百分比 padding 按**各自的包含块**解析，"
                "牌面那处的包含块是整块牌面 → 一处变两拨值。" % (k, pat))
        got[k] = m.group(1)
    for k in ("bw", "pad", "drop"):
        got[k] = float(got[k])
    return got


TOK = read_css_tokens()


def hex_rgb(s):
    s = s.lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


GROUND = hex_rgb(TOK["ground"]) + (255,)
INK = (26, 26, 26, 255)


def card_width_for(ncards, board_w=BOARD_W, board_h=BOARD_H):
    cols = max(1, math.ceil(math.sqrt(ncards * (board_w / board_h))))
    rows = max(1, math.ceil(ncards / cols))
    cw, ch = board_w / cols, board_h / rows
    s = math.cos(math.radians(MAX_ROT)) + math.sin(math.radians(MAX_ROT))
    maxW = (cw / s) * 0.92
    maxH = (ch / s) * 0.92
    w = min(maxW, maxH * CARD_ASPECT, CARD_MAX_W)
    w = max(w, min(CARD_MIN_W, maxW))
    return w


def image_box(w):
    """按 `.lcard img { object-fit: contain }` 算成像区（正方形，受内容盒的短板限制）。"""
    h = w / CARD_ASPECT
    cw = w - 2 * TOK["bw"] - 2 * TOK["pad"]
    ch = h - 2 * TOK["bw"] - 2 * TOK["pad"]
    return h, max(0.0, min(cw, ch))


def draw_card(w, img512):
    """返回一张画好的卡片（含硬投影）。取值全部来自 TOK。"""
    h, box = image_box(w)
    bw, pad, sh = TOK["bw"], TOK["pad"], TOK["drop"]
    tile = Image.new("RGBA", (int(w + sh + bw * 2 + 2), int(h + sh + bw * 2 + 2)),
                     (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    x1, y1 = w + bw * 2, h + bw * 2
    d.rectangle([sh, sh, x1 + sh, y1 + sh], fill=INK)          # 硬投影
    d.rectangle([0, 0, x1, y1], fill=INK)                      # 边框
    d.rectangle([bw, bw, x1 - bw, y1 - bw], fill=GROUND)       # 底卡
    if box <= 0:
        return tile
    n = int(round(box))
    sym = img512.resize((n, n), Image.LANCZOS)
    cw = w - 2 * bw - 2 * pad
    ch = h - 2 * bw - 2 * pad
    tile.alpha_composite(sym, (int(bw + pad + (cw - n) / 2),
                               int(bw + pad + (ch - n) / 2)))
    return tile


def main():
    lm = json.load(io.open(os.path.join(PUB, "data", "legends.json"), encoding="utf-8"))
    legends = lm["legends"]
    print("读到的底卡取值：%s" % json.dumps(TOK, ensure_ascii=False))
    if TOK["pad"] not in (6.0, 5.0, 4.0) or TOK["bw"] != 3.0:
        print("⚠ 底卡取值和 v1.1.0 真机实测（bw=3, pad=6）不一致，下面的出图只能当近似。")

    # 实测锚点：与 .workbuddy/tmp/lm11verify 的真机报告交叉核对，任何一侧变了都会对不上
    anchors = [(8, 169, 130, 151, 112, 87), (28, 133, 102, 115, 84, 66)]
    print("\n%-6s %-12s %-14s %-12s %s" % ("牌数", "预测卡宽", "实测内容盒",
                                          "预测成像区", "预测符号长边/实测"))
    for n, mw, mh, mcw, mch, mink in anchors:
        w = card_width_for(n)
        _, box = image_box(w)
        print("%-6d %-12.1f %-14s %-12.1f %d / %d" % (
            n, w, "%dx%d" % (mcw, mch), box, round(box * FILL), mink))
        # 反证：模型必须预测"成像区 = 内容盒短板"，且不得大于实测内容盒
        if box > min(mcw, mch) + 2:
            raise SystemExit("成像区 %.1f 超过实测内容盒短板 %d ⇒ 模型与真机不符"
                             % (box, min(mcw, mch)))

    sizes = [(8, card_width_for(8), "8 张牌（最松）"),
             (20, card_width_for(20), "20 张牌"),
             (28, card_width_for(28), "28 张牌（初中组末关）"),
             (32, card_width_for(32), "32 张牌（高级组末关·最挤）")]
    print("\n真实卡宽：", ", ".join("%s → %.0f px" % (t, w) for _, w, t in sizes))
    # 28 与 32 张在 1252×694 上算出来是同一个卡宽（都是 8×4 格）⇒ 按牌数命名，别让文件互相覆盖
    print("注：%d 张与 %d 张的卡宽相同（格子数都是 %d×%d），两者是同一档"
          % (28, 32, 8, 4))

    gap = 8
    for ncards, w, tag in sizes:
        w = int(round(w))
        tiles = []
        for lg in legends:
            p = os.path.normpath(os.path.join(PUB, lg["image"]))
            tiles.append((lg["name"], draw_card(w, Image.open(p).convert("RGBA"))))
        cw = max(t.width for _, t in tiles) + gap
        chh = max(t.height for _, t in tiles) + 26
        cols = max(1, 1500 // cw)
        rows = (len(tiles) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * cw + gap, rows * chh + 34), (238, 235, 228))
        d = ImageDraw.Draw(sheet)
        F = cjk_font(15)
        _, box = image_box(w)
        d.text((8, 8), "%d 张牌 / 卡宽 %d px / 内容盒 %.0fx%.0f / 成像区 %.0f（=短板）"
                       " / 符号长边 ≈ %d px —— 共 %d 个图例"
               % (ncards, w, w - 2 * TOK["bw"] - 2 * TOK["pad"],
                  w / CARD_ASPECT - 2 * TOK["bw"] - 2 * TOK["pad"],
                  box, round(box * FILL), len(tiles)), fill=(30, 30, 30), font=F)
        for i, (name, t) in enumerate(tiles):
            r, c = divmod(i, cols)
            x, y = gap + c * cw, 32 + r * chh
            sheet.paste(t, (x, y), t)
            d.text((x, y + t.height + 4), name, fill=(60, 60, 60), font=F)
        fn = os.path.join(HERE, "shot_cardsize_%02dcards.png" % ncards)
        sheet.save(fn)
        print(fn, sheet.size)


if __name__ == "__main__":
    main()
