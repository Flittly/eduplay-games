#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
气象现象真实照片采集（360 图片 + 百度图片双源）
============================================================
用法：
    python scripts/fetch_photos.py                 # 补齐缺失
    python scripts/fetch_photos.py --force         # 全部重取
    python scripts/fetch_photos.py --only=lightning,halo
    python scripts/fetch_photos.py --sheet         # 生成拼版缩略图 montage.jpg 供人工复核
    python scripts/fetch_photos.py --avoid=子串 --avoid-host=域名

复用 landform-quiz/scripts/fetch_photos.py 的整套过滤纪律（2026-09 反复踩坑后固化）：
  * 主源 360 `image.so.com/j`（无需 cookie）；备源百度 `acjson`（需 cookie 预热）。
  * 剔除 AI 生成图、商业图库水印图；**命中水印域名的候选整条丢弃，绝不回退到它的缩略图**。
  * 标题必须命中该现象的关键词，否则标记 ok-relaxed 供复核。
  * 成功/失败都要清 .tmp，避免半成品被打进 zip。
  * 必须看 montage.jpg 逐格目视复核——"下载成功"不等于"内容对"。
"""

import http.cookiejar
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUTDIR = os.path.join(ROOT, "public", "assets", "weather")
SOURCES = os.path.join(HERE, "photo_sources.json")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
TARGET_W = 900
TARGET_RATIO = 16 / 10
MIN_ACCEPT_W = 700
REFERER = "https://image.so.com/"

# id -> (检索词, 标题必须命中的关键词)
SPEC = {
    "lightning":   ("雷暴 闪电 夜空 高清", ["闪电", "雷电", "雷暴", "雷雨"]),
    "rainbow":     ("彩虹 天空 雨后 实拍", ["彩虹"]),
    "fog":         ("大雾 天气 能见度 实拍", ["雾"]),
    "frost":       ("霜 白霜 结霜 草地 实拍", ["霜"]),
    "dew":         ("露珠 露水 草地 清晨 微距", ["露"]),
    "hail":        ("冰雹 地面 冰雹天气 实拍", ["冰雹", "雹"]),
    "sandstorm":   ("沙尘暴 来袭 昏黄 天空 实拍", ["沙尘暴", "沙尘"]),
    "rime":        ("雾凇 吉林 树挂 实拍", ["雾凇", "树挂"]),
    "halo":        ("日晕 太阳 光环 实拍", ["日晕", "光晕", "晕"]),
    "sunset_cloud": ("火烧云 晚霞 天空 实拍", ["火烧云", "晚霞", "霞"]),
    "typhoon_sat": ("台风 卫星云图 螺旋云系", ["台风", "云图", "热带气旋"]),
    "urban_flood": ("城市 暴雨 街道 积水 内涝 实拍", ["内涝", "积水", "暴雨"]),
    "snow_cover":  ("积雪 雪后 村庄 雪景 实拍", ["积雪", "雪后", "雪景", "大雪"]),
    "cloud_sea":   ("云海 山顶 日出 实拍", ["云海"]),
    "drought":     ("干旱 土地 龟裂 水库 干涸", ["干旱", "龟裂", "干涸", "旱"]),
    "glaze_ice":   ("雨凇 电线 覆冰 冻雨 实拍", ["雨凇", "覆冰", "冻雨", "结冰"]),
    "downpour":    ("暴雨 倾盆大雨 雨丝 撑伞 街道 实拍 高清", ["暴雨", "大雨"]),
    "tornado":     ("龙卷风 漏斗云 实拍", ["龙卷风", "龙卷", "漏斗云"]),
    "ice_flower":  ("窗花 冰花 玻璃 结冰 实拍", ["窗花", "冰花", "结冰"]),
    "dust_haze":   ("浮尘 沙尘天气 天空 昏黄", ["浮尘", "沙尘", "扬沙", "霾"]),
}

BAD_HOST_HINTS = ("logo", "icon", "banner", "ad_", "/ads/", "sprites")
AIGC_HOST_HINTS = ("aigc", "bcebos.com/miaobi", "ai-image", "aicg")
AIGC_TITLE_HINTS = ("ai生成", "ai绘画", "ai作图", "ai绘制", "ai创作", "人工智能生成")
TITLE_REJECT_HINTS = (
    "图虫", "视觉中国", "摄图", "千图", "包图", "昵图", "全景视觉", "全景网",
    "veer", "gettyimages", "东方ic", "123rf", "depositphotos", "站酷", "汇图",
    "素材网", "矢量图", "简笔画", "手抄报", "ppt", "模板", "课件", "题库",
)
WM_HOST_HINTS = (
    "copyright.bdstatic.com", "vcg", "veer", "gettyimages", "699pic.com",
    "photophoto.cn", "tuchong.com", "shutterstock", "dreamstime", "58pic.com",
    "zhituad.com", "qiantucdn", "ooopic", "hdslb.com", "icweiliimg", "hellorfimg",
)
WM_URL_HINTS = ("@wm_", "watermark")

USED_SOURCES = set()
AVOID = []
EXTRA_BAD_HOSTS = []


def http_get(url, referer=None, timeout=25):
    req = urllib.request.Request(url)
    req.add_header("User-Agent", UA)
    req.add_header("Accept", "image/avif,image/webp,image/*,*/*;q=0.8")
    req.add_header("Accept-Language", "zh-CN,zh;q=0.9")
    if referer:
        req.add_header("Referer", referer)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _strip_tags(s):
    return re.sub(r"<[^>]+>", "", s or "")


_BAIDU_OPENER = None


def _baidu_opener():
    global _BAIDU_OPENER
    if _BAIDU_OPENER is None:
        cj = http.cookiejar.CookieJar()
        op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
        op.addheaders = [("User-Agent", UA), ("Accept-Language", "zh-CN,zh;q=0.9")]
        try:
            op.open("https://image.baidu.com/", timeout=20).read()
        except Exception:  # noqa: BLE001
            pass
        _BAIDU_OPENER = op
    return _BAIDU_OPENER


def search_images_360(query, pages=2):
    out = []
    for p in range(pages):
        url = ("https://image.so.com/j?q=" + urllib.parse.quote(query)
               + "&src=srp&correct=" + urllib.parse.quote(query)
               + "&sn=%d&pn=30" % (p * 30))
        try:
            data = json.loads(http_get(url, referer=REFERER).decode("utf-8", "ignore"))
        except Exception:  # noqa: BLE001
            continue
        for it in (data.get("list") or []):
            if not isinstance(it, dict):
                continue
            obj, hover = it.get("img") or "", it.get("thumb") or ""
            if not obj and not hover:
                continue
            out.append({"obj": obj, "hover": hover,
                        "title": it.get("title") or "", "w": int(it.get("width") or 0),
                        "h": int(it.get("height") or 0), "host": "", "aigc": False})
        time.sleep(0.2)
    return out


def search_images_baidu(query, pages=2):
    op = _baidu_opener()
    q = urllib.parse.quote(query)
    try:
        op.open("https://image.baidu.com/search/index?tn=baiduimage&word=" + q,
                timeout=20).read()
    except Exception:  # noqa: BLE001
        pass
    out = []
    for p in range(pages):
        pn = p * 30
        url = ("https://image.baidu.com/search/acjson?tn=resultjson_com&logid=1&ipn=rj"
               "&ct=201326592&is=&fp=result&word=" + q + "&queryWord=" + q
               + "&cl=2&lm=-1&ie=utf-8&oe=utf-8&st=-1&z=&ic=&hd=&latest=&copyright="
               "&s=&se=&tab=&width=&height=&face=0&istype=2&qc=&nc=1&expermode=&nojc="
               "&isAsync=&pn=%d&rn=30&gsm=%x" % (pn, pn + 30))
        req = urllib.request.Request(url)
        req.add_header("X-Requested-With", "XMLHttpRequest")
        req.add_header("Accept", "application/json, text/plain, */*")
        req.add_header("Referer",
                       "https://image.baidu.com/search/index?tn=baiduimage&word=" + q)
        try:
            data = json.loads(op.open(req, timeout=25).read().decode("utf-8", "ignore"))
        except Exception:  # noqa: BLE001
            continue
        for it in data.get("data", []):
            if not isinstance(it, dict):
                continue
            hover = it.get("hoverURL") or it.get("middleURL") or it.get("thumbURL") or ""
            obj = ""
            for ru in (it.get("replaceUrl") or []):
                if isinstance(ru, dict) and ru.get("ObjURL"):
                    obj = ru["ObjURL"]
                    break
            if not hover and not obj:
                continue
            out.append({"obj": obj, "hover": hover,
                        "title": _strip_tags(it.get("fromPageTitle", "")),
                        "w": int(it.get("width") or 0), "h": int(it.get("height") or 0),
                        "host": it.get("fromURLHost", ""),
                        "aigc": bool(it.get("isAigcEdit"))})
        time.sleep(0.2)
    return out


def search_images(query):
    out = []
    for fn in (search_images_360, search_images_baidu):
        try:
            out += fn(query, pages=2)
        except Exception:  # noqa: BLE001
            pass
    seen, uniq = set(), []
    for r in out:
        k = (r.get("obj") or r.get("hover") or "").split("?")[0]
        if not k or k in seen:
            continue
        seen.add(k)
        uniq.append(r)
    return uniq


def looks_like_image(data):
    if len(data) < 12000:
        return False
    if data[:2] == b"\xff\xd8":
        return True
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return True
    return False


def normalize(data, dest):
    im = Image.open(io.BytesIO(data)).convert("RGB")
    w, h = im.size
    want_h = w / TARGET_RATIO
    if h >= want_h:
        top = max(0, int((h - want_h) * 0.32))
        im = im.crop((0, top, w, top + int(want_h)))
    else:
        want_w = h * TARGET_RATIO
        left = max(0, int((w - want_w) / 2))
        im = im.crop((left, 0, left + int(want_w), h))
    if im.width > TARGET_W:
        im = im.resize((TARGET_W, int(TARGET_W / TARGET_RATIO)), Image.LANCZOS)
    im.save(dest, "JPEG", quality=78, optimize=True, progressive=True)
    return im.size


def _is_bad_url(u, aigc):
    if not u or not u.startswith("http"):
        return True
    low = u.lower()
    if any(b in low for b in BAD_HOST_HINTS):
        return True
    if any(h in low for h in WM_HOST_HINTS) or any(h in low for h in WM_URL_HINTS):
        return True
    if any(h in low for h in EXTRA_BAD_HOSTS):
        return True
    if aigc or any(h in low for h in AIGC_HOST_HINTS):
        return True
    return False


def rank_candidates(results, kws):
    pool = []
    for r in results:
        title = r["title"]
        hit = any(k in title for k in kws)
        if any(a in title.lower() for a in AIGC_TITLE_HINTS):
            continue
        if any(a in title.lower() for a in TITLE_REJECT_HINTS):
            continue
        if r["host"] and any(h in r["host"] for h in WM_HOST_HINTS):
            continue
        if r["obj"] and any(h in r["obj"].lower() for h in WM_HOST_HINTS):
            continue
        if _is_bad_url(r["obj"], r["aigc"]) and _is_bad_url(r["hover"], r["aigc"]):
            continue
        w, h = r["w"], r["h"]
        aspect = (w / h) if h else 0
        pool.append((hit, 1 if aspect >= 1.25 else 0, 1 if w >= 1000 else 0, w, r))
    matched = [p for p in pool if p[0]]
    relaxed = not matched
    pool = matched or pool
    pool.sort(key=lambda p: (p[1], p[2], p[3]), reverse=True)
    out = []
    for p in pool:
        r = p[4]
        blob = r.get("obj", "") + "\n" + r.get("hover", "") + "\n" + r.get("title", "")
        if AVOID and any(a and a in blob for a in AVOID):
            continue
        out.append(r)
    return out, relaxed


def _clean_tmp(dest):
    for extra in (dest + ".tmp", dest + ".tmp2"):
        if os.path.exists(extra):
            os.remove(extra)


def fetch_one(pid, force=False):
    query, kws = SPEC[pid]
    dest = os.path.join(OUTDIR, "photo_%s.jpg" % pid)
    if os.path.exists(dest) and not force:
        return ("skip", _source_of(pid), os.path.getsize(dest), 0)
    try:
        results = search_images(query)
    except Exception as exc:  # noqa: BLE001
        return ("search-fail", str(exc), 0, 0)
    if not results:
        return ("no-candidate", "", 0, 0)
    pool, relaxed = rank_candidates(results, kws)
    tried = 0
    backup = None
    tmp = dest + ".tmp"
    for r in pool:
        if tried >= 14:
            break
        for cand in (r["obj"], r["hover"]):
            if not cand or not cand.startswith("http") or cand in USED_SOURCES:
                continue
            if _is_bad_url(cand, r["aigc"]):
                continue
            tried += 1
            try:
                data = http_get(cand, referer=REFERER)
            except Exception:  # noqa: BLE001
                continue
            if not looks_like_image(data):
                continue
            try:
                size = normalize(data, tmp)
            except Exception:  # noqa: BLE001
                continue
            if size[0] >= MIN_ACCEPT_W:
                os.replace(tmp, dest)
                _clean_tmp(dest)
                USED_SOURCES.add(cand)
                return ("ok-relaxed" if relaxed else "ok", cand, os.path.getsize(dest), tried)
            if not backup or size[0] > backup[0]:
                backup = (size[0], tmp, cand)
                tmp = dest + ".tmp2" if tmp.endswith(".tmp") else dest + ".tmp"
            break
    if backup:
        os.replace(backup[1], dest)
        _clean_tmp(dest)
        USED_SOURCES.add(backup[2])
        return ("ok-small", backup[2], os.path.getsize(dest), tried)
    _clean_tmp(dest)
    return ("all-fail", "", 0, tried)


_SRC_CACHE = {}


def _source_of(pid):
    if not _SRC_CACHE and os.path.exists(SOURCES):
        _SRC_CACHE.update(json.load(io.open(SOURCES, encoding="utf-8")))
    return _SRC_CACHE.get(pid, "")


def build_sheet(path, cols=5, cell_w=340, cell_h=212, label_h=24):
    ids = list(SPEC.keys())
    rows = (len(ids) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell_w, rows * (cell_h + label_h)), (18, 20, 28))
    draw = ImageDraw.Draw(sheet)
    for i, pid in enumerate(ids):
        p = os.path.join(OUTDIR, "photo_%s.jpg" % pid)
        r, c = divmod(i, cols)
        x, y = c * cell_w, r * (cell_h + label_h)
        if os.path.exists(p):
            im = Image.open(p).convert("RGB")
            im.thumbnail((cell_w - 6, cell_h - 6), Image.LANCZOS)
            sheet.paste(im, (x + 3, y + 3))
        draw.text((x + 4, y + cell_h + 5), pid, fill=(235, 215, 160))
    sheet.save(path, "JPEG", quality=82)
    return sheet.size


def main():
    args = sys.argv[1:]
    force = "--force" in args
    do_sheet = "--sheet" in args
    only = None
    for a in args:
        if a.startswith("--only="):
            only = set(a.split("=", 1)[1].split(","))
        elif a.startswith("--avoid="):
            AVOID.extend(x for x in a.split("=", 1)[1].split(",") if x)
        elif a.startswith("--avoid-host="):
            EXTRA_BAD_HOSTS.extend(x for x in a.split("=", 1)[1].split(",") if x)
    if AVOID:
        print("拉黑图源片段 %d 条" % len(AVOID))
    if EXTRA_BAD_HOSTS:
        print("拉黑 CDN 域名 %d 条" % len(EXTRA_BAD_HOSTS))

    os.makedirs(OUTDIR, exist_ok=True)
    if os.path.exists(SOURCES):
        _SRC_CACHE.update(json.load(io.open(SOURCES, encoding="utf-8")))

    todo = [p for p in SPEC if (only is None or p in only)]
    stat = {}
    for n, pid in enumerate(todo, 1):
        status, src, size, tried = fetch_one(pid, force=force)
        stat[status] = stat.get(status, 0) + 1
        if status in ("ok", "ok-small", "ok-relaxed"):
            _SRC_CACHE[pid] = src
        print("[%2d/%d] %-14s %-11s tries=%-3d %8d  %s"
              % (n, len(todo), pid, status, tried, size, src[:62]))
        sys.stdout.flush()
        if status not in ("skip",):
            time.sleep(0.5)

    io.open(SOURCES, "w", encoding="utf-8", newline="\n").write(
        json.dumps(_SRC_CACHE, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    print("\n统计:", stat)
    small = []
    for pid in SPEC:
        p = os.path.join(OUTDIR, "photo_%s.jpg" % pid)
        if not os.path.exists(p):
            small.append(pid + "(缺)")
        elif Image.open(p).width < MIN_ACCEPT_W:
            small.append(pid)
    print("小图/缺失:", small or "无")
    if do_sheet:
        print("拼版:", build_sheet(os.path.join(ROOT, "montage-photos.jpg")))


if __name__ == "__main__":
    main()
