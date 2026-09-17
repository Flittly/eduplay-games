#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
候选拼版：给指定条目拉一批 Commons 候选、拼成带编号的缩略图，供人工挑图。

为什么需要"看图挑"这一步：Commons 的排序只能保证"标题里有这个地名"，
保证不了"这张图适合当教材"。复核时看到过：「巫山」抓到巫山寺、「燕山」抓到燕山寺、
「阴山」抓到 Yinshanosaurus（一种恐龙，命名也来自阴山）、「祁连山脉」抓到 ISS 太空照 ——
标题里都老老实实含地名。所以流程是：**先看拼版 → 挑出编号 → 把确切文件名写进
`fetch_photos.COMMONS_PICK` → 再 --force 重取**。

用法：
    python scripts/pick_photos.py                       # 全部 38 条
    python scripts/pick_photos.py --only=yinshan,xuefeng
    python scripts/pick_photos.py --terms=yinshan="Daqing Mountains,Yinshan"

输出：
    .workbuddy/tmp/crverify/cands-<name>.jpg   带 "id  #编号  宽x高" 标注的拼版
    scripts/_cands.json                        (id, 编号) → {title, url, w, h}
"""
import io
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_photos as F
from PIL import Image, ImageDraw

OUTDIR_SHEET = os.path.abspath(os.path.join(F.ROOT, "..", ".workbuddy", "tmp", "crverify"))
DUMP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_cands.json")

PER_ID = 6
COLS, CW, CH, LH = 6, 300, 210, 22

# 覆盖用检索词：默认用 ITEMS 里的，只有某些条目还需要更细的词时才写在这里。
# 也可以命令行 `--terms=id="词1,词2"` 临时覆盖，不必改文件。
TERMS = {
    "bayan": ["Bayan Har", "Ngoring Lake", "Gyaring Lake", "Hoh Xil"],
    "huabei": ["wheat field Henan", "wheat harvest China", "Henan countryside"],
    "neimenggu": ["Hulun Buir", "Xilin Gol", "Inner Mongolia steppe"],
    "xuefeng": ["Xuefeng Mountain", "雪峰山", "Hunan highlands"],
    "yinshan": ["Daqing Mountains", "Yinshan", "Hohhot"],
}


def parse_args(argv):
    only = None
    name = "all"
    for a in argv:
        if a.startswith("--only="):
            only = set(a.split("=", 1)[1].split(","))
            name = "_".join(sorted(only))
        elif a.startswith("--terms="):
            for chunk in a.split("=", 1)[1].split(";"):
                if not chunk:
                    continue
                iid, _, words = chunk.partition("=")
                TERMS[iid.strip()] = [w.strip() for w in words.split(",") if w.strip()]
    return only, name


def terms_for(item):
    return TERMS.get(item["id"]) or item.get("commons") or [item["name"]]


def main():
    only, name = parse_args(sys.argv[1:])
    todo = [it for it in F.ITEMS if only is None or it["id"] in only]
    if not todo:
        sys.exit("没有匹配的条目")

    pool, dump = {}, {}
    for it in todo:
        terms = terms_for(it)
        seen, cands = set(), []
        for t in terms:
            try:
                got = F.search_commons([t])
            except Exception as exc:  # noqa: BLE001
                print("  %s / %s 失败 %r" % (it["id"], t, exc))
                continue
            for r in F.rank_commons(got, terms):
                if r["obj"] in seen:
                    continue
                seen.add(r["obj"])
                cands.append(r)
            if len(cands) >= PER_ID * 2:
                break
        pool[it["id"]] = cands[:PER_ID]
        print("%-14s 候选 %d 张  (%s)" % (it["id"], len(pool[it["id"]]), ", ".join(terms)))
        sys.stdout.flush()

    ids = [it["id"] for it in todo]
    sheet = Image.new("RGB", (COLS * CW, len(ids) * (CH + LH)), (18, 20, 28))
    draw = ImageDraw.Draw(sheet)
    for row, iid in enumerate(ids):
        y0 = row * (CH + LH)
        draw.text((8, y0 + 5), iid, fill=(255, 230, 120))
        for k, cand in enumerate(pool[iid]):
            x0 = k * CW
            try:
                req = urllib.request.Request(cand["hover"] or cand["obj"])
                req.add_header("User-Agent", F.COMMONS_UA)
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = resp.read()
                im = Image.open(io.BytesIO(data)).convert("RGB")
                im.thumbnail((CW - 20, CH - 30), Image.LANCZOS)
                sheet.paste(im, (x0 + 8, y0 + LH + 4))
            except Exception:  # noqa: BLE001
                continue
            draw.text((x0 + 10, y0 + LH + 5),
                      "  #%d  %dx%d" % (k, cand["w"], cand["h"]), fill=(255, 120, 120))
            dump["%s#%d" % (iid, k)] = {"title": cand["title"], "url": cand["obj"],
                                        "w": cand["w"], "h": cand["h"]}

    os.makedirs(OUTDIR_SHEET, exist_ok=True)
    sheet_path = os.path.join(OUTDIR_SHEET, "cands-%s.jpg" % name)
    sheet.save(sheet_path, "JPEG", quality=88)
    io.open(DUMP, "w", encoding="utf-8", newline="\n").write(
        json.dumps(dump, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    print("拼版:", sheet_path, sheet.size)
    print("清单:", DUMP, len(dump), "条")
    print("挑好后把文件名写进 fetch_photos.py 的 COMMONS_PICK，再 --force 重取。")


if __name__ == "__main__":
    main()
