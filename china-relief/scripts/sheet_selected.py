#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
拼「指定文件名」的候选图，专供复核钉进 COMMONS_PICK 的那几个文件。

为什么需要：`pick_photos.py` 拼的是**检索结果**，而复核回路的后半段是
「把文件名钉进 COMMONS_PICK → --force 重取 → 再看一眼」。这一步没有工具 ——
钉进去之后只能靠"跑完整回归、再从截图里找"，而截图里那张往往只有 300 px 宽。
这个脚本补的就是后半段：把钉死的文件名原样拼成一张大图，和检索结果分开复核。

用法：
    python scripts/sheet_selected.py --files=yinshan="大青山一景 - panoramio.jpg"
    python scripts/sheet_selected.py --files='yinshan=a.jpg|b.jpg;xuefeng=c.jpg'
        （文件名之间用 `|`，条目之间用 `;` —— 文件名本身带逗号，不能用逗号分隔）
    python scripts/sheet_selected.py --pinned            # 直接复核 COMMONS_PICK 里全部钉定项

输出：
    .workbuddy/tmp/crverify/sel-<name>.jpg  每格标 "id #序号 宽x高 许可"
"""
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_photos as F
from PIL import Image, ImageDraw

OUTDIR_SHEET = os.path.abspath(os.path.join(F.ROOT, "..", ".workbuddy", "tmp", "crverify"))
API = "https://commons.wikimedia.org/w/api.php"
COLS, CW, CH, LH = 4, 440, 300, 26


def parse_args(argv):
    groups, name = {}, None
    pinned = "--pinned" in argv
    for a in argv:
        if a.startswith("--files="):
            for chunk in a.split("=", 1)[1].split(";"):
                if not chunk:
                    continue
                iid, _, words = chunk.partition("=")
                # `|` 而不是 `,` —— Commons 的文件名本身常带逗号
                groups[iid.strip()] = [w.strip() for w in words.split("|") if w.strip()]
        elif a.startswith("--name="):
            name = a.split("=", 1)[1]
    if pinned:
        for iid, files in F.COMMONS_PICK.items():
            if isinstance(files, str):
                files = [files]
            groups.setdefault(iid, list(files))
    return groups, name, pinned


def info_for(names):
    """一次问 20 个文件。要 `thumburl` 而**不是**自己拼缩略图 URL ——
    官方明确禁止手拼（非标准宽度会被 400/429 拒），且原图比请求宽度窄时
    API 会直接回原图地址。"""
    out = {}
    for i in range(0, len(names), 20):
        chunk = names[i:i + 20]
        q = urllib.parse.urlencode({
            "action": "query", "format": "json", "prop": "imageinfo",
            "titles": "|".join("File:" + n for n in chunk),
            "iiprop": "url|size|mime|extmetadata",
            "iiextmetadatafilter": "LicenseShortName|GPSLatitude|GPSLongitude|ImageDescription",
            "iiurlwidth": "1280",
        })
        d = None
        for attempt in range(4):
            try:
                req = urllib.request.Request(API + "?" + q)
                req.add_header("User-Agent", F.COMMONS_UA)
                with urllib.request.urlopen(req, timeout=45) as resp:
                    d = json.load(resp)
                break
            except urllib.error.HTTPError as exc:
                # 429 要按 Retry-After 退避，比断连长得多。跑 fetch_photos 的同时
                # 复核拼版是很容易撞上的（两边打同一个 API）。
                if exc.code == 429:
                    wait = int(exc.headers.get("Retry-After") or 0) or 6 * (attempt + 1)
                    print("  429，等 %ds 重试" % wait)
                    time.sleep(wait)
                    continue
                print("  批量查询失败 %r" % (exc,))
                break
            except Exception as exc:  # noqa: BLE001
                print("  批量查询失败 %r" % (exc,))
                break
        if d is None:
            continue
        for _pid, p in d.get("query", {}).get("pages", {}).items():
            ii = (p.get("imageinfo") or [{}])[0]
            em = ii.get("extmetadata") or {}
            out[p.get("title", "")] = {
                "thumb": ii.get("thumburl") or ii.get("url"),
                "w": ii.get("width"), "h": ii.get("height"),
                "mime": ii.get("mime"),
                "lic": (em.get("LicenseShortName") or {}).get("value") or "?",
                "lat": (em.get("GPSLatitude") or {}).get("value"),
                "lon": (em.get("GPSLongitude") or {}).get("value"),
                "desc": (em.get("ImageDescription") or {}).get("value", "")[:70],
            }
    return out


def main():
    groups, name, pinned = parse_args(sys.argv[1:])
    if not groups:
        sys.exit(__doc__)
    if name is None:
        name = "pinned" if pinned else "_".join(sorted(groups))

    flat = []
    for iid in groups:
        for f in groups[iid]:
            flat.append((iid, f))
    info = info_for([f for _i, f in flat])

    rows = (len(flat) + COLS - 1) // COLS
    sheet = Image.new("RGB", (COLS * CW, rows * (CH + LH)), (18, 20, 28))
    draw = ImageDraw.Draw(sheet)

    for k, (iid, fname) in enumerate(flat):
        r, c = divmod(k, COLS)
        x0, y0 = c * CW, r * (CH + LH)
        meta = info.get("File:" + fname)
        draw.text((x0 + 8, y0 + 7), "%s  #%d" % (iid, k), fill=(255, 230, 120))
        if not meta or not meta.get("thumb"):
            draw.text((x0 + 8, y0 + LH + 8), "MISSING  %s" % fname[:40], fill=(255, 90, 90))
            draw.text((x0 + 8, y0 + CH + 6), fname[:60], fill=(180, 230, 255))
            continue
        # 非 JPEG 直接标红：地图 / 卫星拼接图 / 地形渲染图几乎都是 PNG，那不是实景照片
        if meta["mime"] != "image/jpeg":
            draw.text((x0 + 8, y0 + LH + 8), "非 JPEG: %s" % meta["mime"], fill=(255, 90, 90))
        try:
            req = urllib.request.Request(meta["thumb"])
            req.add_header("User-Agent", F.COMMONS_UA)
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
            im = Image.open(io.BytesIO(raw)).convert("RGB")
            im.thumbnail((CW - 16, CH - 34), Image.LANCZOS)
            sheet.paste(im, (x0 + 8, y0 + LH + 4))
        except Exception as exc:  # noqa: BLE001
            draw.text((x0 + 8, y0 + LH + 40), "ERR %r" % (exc,), fill=(255, 90, 90))
        draw.text((x0 + 8, y0 + LH + CH - 20),
                  "%sx%s %s" % (meta["w"], meta["h"], meta["lic"]), fill=(255, 220, 120))
        if meta.get("lat"):
            draw.text((x0 + 8, y0 + LH + CH - 10),
                      "%s,%s" % (meta["lat"], meta["lon"]), fill=(150, 230, 170))
        draw.text((x0 + 8, y0 + CH + 6), fname[:60], fill=(180, 230, 255))

    os.makedirs(OUTDIR_SHEET, exist_ok=True)
    out = os.path.join(OUTDIR_SHEET, "sel-%s.jpg" % name)
    sheet.save(out, "JPEG", quality=90)
    print("拼版: %s %s" % (out, sheet.size))
    for k, (iid, fname) in enumerate(flat):
        m = info.get("File:" + fname) or {}
        # 区分「没查到」和「格式不对」：前者多半是被限流，重跑即可；
        # 后者是这张图根本不能当实景照片用（地图/卫星图几乎都是 PNG）。
        if not m.get("w"):
            flag = "  ⚠ 没查到（文件名写错，或批量查询被限流，重跑一次）"
        elif m.get("mime") == "image/jpeg":
            flag = ""
        else:
            flag = "  ⚠ 非 JPEG：%s（地图/卫星图几乎都是 PNG，不能当实景照片）" % m.get("mime")
        print("  #%d %-14s %-52s %sx%s%s" % (k, iid, fname[:52], m.get("w"), m.get("h"), flag))
    print("逐格目视确认：内容是不是真的对得上这个地名（标题对、内容不对是最常见的坑）。")


if __name__ == "__main__":
    main()
