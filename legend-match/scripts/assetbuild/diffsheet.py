# -*- coding: utf-8 -*-
"""按**类目**分组，在真实卡片尺寸下并排看 —— 这是"能不能分辨"的决定性证据。

为什么不能只看单张：这个游戏的难度就来自"同类干扰"（同一类里放容易看混的几条），
所以判据不是"每条自己好不好看"，而是"同类的这几条并排时能不能分开"。
分组渲染 + 2 倍放大，就是为了让"虚线的划长/有没有点/颜色"这些差异能被人眼核对。
"""
import io, json, os, sys
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# 底卡几何**只能有一份**：用 cardmock 里那份（它自己从 styles.css 的 :root 解析）。
# 之前本文件另抄了一份 `bw, pad, sh = 3, 4, 4`，于是 CSS 把内边距改成 6px 之后，
# 这张"决定性证据图"还在按 4px 画 —— 图是旧的，结论就跟着旧。
from cardmock import card_width_for, CARD_ASPECT, TOK, image_box, draw_card, cjk_font

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
PUB = os.path.join(REPO, "legend-match", "public")
ZOOM = int(sys.argv[1]) if len(sys.argv) > 1 else 2
NW = int(sys.argv[2]) if len(sys.argv) > 2 else 24


def card(w, img):
    """直接复用 cardmock.draw_card —— 不再本地重画一遍底卡。"""
    return draw_card(w, img)


def main():
    lm = json.load(io.open(os.path.join(PUB, "data", "legends.json"), encoding="utf-8"))
    cat_names = {c["id"]: c["name"] for c in lm.get("categories", [])}
    by = {}
    for lg in lm["legends"]:
        by.setdefault(lg["category"], []).append(lg)
    W = int(round(card_width_for(NW)))
    _, box = image_box(W)
    print("按 %d 张牌的最挤情形渲染：卡宽 %d px，底卡 %s，成像区 %.0f，符号长边 ≈ %d px，放大 %dx"
          % (NW, W, json.dumps(TOK, ensure_ascii=False), box, round(box * 0.78), ZOOM))

    out = []
    for cid, items in by.items():
        if len(items) < 2:
            continue
        row = [card(W, Image.open(os.path.normpath(os.path.join(PUB, it["image"]))).convert("RGBA"))
               for it in items]
        cw = max(r.width for r in row) + 6
        F = cjk_font(16)
        # 放大后文字也跟着放大，所以先按 ZOOM 反向收一档，免得 2x 之后标题顶出画面
        sheet = Image.new("RGB", (cw * len(row) + 10, row[0].height + 26 + 22 * ZOOM),
                          (238, 235, 228))
        d = ImageDraw.Draw(sheet)
        d.text((8, 6), "%s  (%s) —— %d 条" % (cat_names.get(cid, cid), cid, len(items)),
               fill=(20, 20, 20), font=F)
        for i, (it, r) in enumerate(zip(items, row)):
            x = 6 + i * cw
            sheet.paste(r, (x, 22), r)
            d.text((x, 22 + r.height + 2), it["short"][:6], fill=(60, 60, 60), font=F)
        if ZOOM != 1:
            sheet = sheet.resize((sheet.width * ZOOM, sheet.height * ZOOM), Image.LANCZOS)
        fn = os.path.join(HERE, "shot_cat_%s.png" % cid)
        sheet.save(fn)
        out.append(fn)
    print("\n".join(out))


if __name__ == "__main__":
    main()
