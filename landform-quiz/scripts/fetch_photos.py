#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
地貌真实照片采集脚本（百度图片版）
------------------------------------------------
对 landforms.json 里的每个地貌，用百度图片接口抓取真实照片，下载后统一裁切压缩，
存到 public/assets/landforms/<id>.jpg，并把来源 URL 回写到 landforms.json 的 photoSource 字段。

用法：
    python scripts/fetch_photos.py                 # 补齐所有缺失的照片
    python scripts/fetch_photos.py --force         # 全部重取
    python scripts/fetch_photos.py --only=id1,id2  # 只重取指定地貌
    python scripts/fetch_photos.py --sheet         # 顺便生成拼版缩略图 montage.jpg（人工复核用）

为什么用 360 / 百度，而不是必应（踩坑记录）：
  * 必应图片结果页在反复抓取后会返回反爬干扰页 / 无关明星图，命中率骤降，已弃用。
  * 百度图片的「异步 JSON 接口」`image.baidu.com/search/acjson` 结构清晰，但直接请求会被
    风控拦成 {"antiFlag":1,"message":"Forbid spider access"} —— 必须先带 cookie 预热
    （访问 image.baidu.com 首页 + 结果页拿到 BAIDUID）再带 X-Requested-With 调接口。
  * 因此主源换成 360 图片接口 `image.so.com/j`：无需 cookie、一页 30~60 条、
    字段干净（img 原图 / thumb 缩略图 / width / height / title），最省事也最稳。
  * 百度接口作为备源保留：当 360 候选太少时补一轮。
  * 排除规则：AI 生成图（isAigcEdit / aigc 域名）、商业图库水印图（视觉中国/699pic/千图等）。
  * 先下载到临时文件，全部校验通过后再原子替换，避免失败时把半成品留在目标目录。
  * 全局记录已用过的图源 URL，避免不同地貌撞到同一张图。
  * 最终统一裁成 16:10 并压到 900px 宽，整包控制在 3MB 左右。
"""

import html
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
DATA = os.path.join(ROOT, "public", "data", "landforms.json")
OUTDIR = os.path.join(ROOT, "public", "assets", "landforms")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")

TARGET_W = 900
TARGET_RATIO = 16 / 10
MIN_ACCEPT_W = 700
REFERER = "https://image.so.com/"

# 检索词：默认用「名称 + 实景」，这里对容易搜歪的地貌做更精确的限定
QUERY_OVERRIDE = {
    "qinghai_tibet": "青藏高原 风光 风景",
    "tianshan": "天山天池 雪山 新疆 风光",
    "loess_plateau": "黄土高原 地貌 沟壑",
    "mingsha_crescent": "敦煌 鸣沙山 月牙泉",
    "zhangye_danxia": "张掖 七彩丹霞 地貌",
    "guilin_karst": "桂林 漓江 喀斯特 山水",
    "yunnan_stone_forest": "云南石林 喀斯特 石柱",
    "zhangjiajie": "张家界 石英砂岩 峰林",
    "hukou_waterfall": "黄河 壶口瀑布",
    "huangguoshu": "贵州 黄果树瀑布",
    "huanglong": "黄龙 五彩池 钙华",
    "jiuzhaigou": "九寨沟 五花海 海子",
    "yarlung_tsangpo": "雅鲁藏布大峡谷 大拐弯",
    "changbai_tianchi": "长白山 天池",
    "hulunbuir": "呼伦贝尔大草原",
    "qiantang_tide": "钱塘江大潮 交叉潮 涌潮 航拍",
    "sanya_coral": "三亚 亚龙湾 海岸 珊瑚礁",
    "wudalianchi": "五大连池 火山口 熔岩台地 风光",
    "everest": "珠穆朗玛峰 雪山",
    "taklamakan": "塔克拉玛干沙漠 沙丘",
    "amazon": "亚马孙热带雨林 河流 航拍",
    "grand_canyon": "科罗拉多大峡谷",
    "great_barrier_reef": "大堡礁 珊瑚礁 航拍",
    "uyuni": "乌尤尼盐沼 天空之镜",
    "vatnajokull": "瓦特纳冰原 冰川 冰岛",
    "dead_sea": "死海 盐湖 航拍 以色列",
    "nile": "尼罗河 埃及 河流",
    "sognefjord": "挪威 松恩峡湾",
    "mount_fuji": "富士山 雪 风景",
    "matterhorn": "马特洪峰 雪山",
    "giants_causeway": "巨人堤道 玄武岩石柱",
    "cappadocia": "卡帕多西亚 仙人烟囱 热气球",
    "east_african_rift": "东非大裂谷",
    "uluru": "乌鲁鲁巨岩 澳大利亚 世界遗产",
    "grand_prismatic": "黄石公园 大棱镜温泉",
    "atacama": "阿塔卡马沙漠 智利",
    "milford_sound": "米尔福德峡湾 新西兰",
    "lake_baikal": "贝加尔湖 蓝冰 冬季",
    "kilimanjaro": "乞力马扎罗山",
    "sahara": "撒哈拉沙漠 沙丘",
}

# 标题必须命中其中之一（任一命中即算相关），用于剔除广告图、表情包、无关内容
KEYWORDS = {
    "qinghai_tibet": ["青藏", "高原", "西藏"],
    "everest": ["珠穆朗玛", "珠峰", "喜马拉雅"],
    "tianshan": ["天山", "雪山"],
    "loess_plateau": ["黄土高原", "黄土", "窑洞", "沟壑"],
    "taklamakan": ["塔克拉玛干", "沙漠", "沙丘"],
    "mingsha_crescent": ["鸣沙山", "月牙泉", "敦煌"],
    "zhangye_danxia": ["丹霞", "张掖", "七彩"],
    "guilin_karst": ["桂林", "漓江", "喀斯特"],
    "yunnan_stone_forest": ["石林", "喀斯特", "云南"],
    "zhangjiajie": ["张家界", "峰林", "石英砂岩"],
    "hukou_waterfall": ["壶口", "瀑布", "黄河"],
    "huangguoshu": ["黄果树", "瀑布", "贵州"],
    "huanglong": ["黄龙", "五彩池", "钙华"],
    "jiuzhaigou": ["九寨沟", "五花海", "海子"],
    "yarlung_tsangpo": ["雅鲁藏布", "大峡谷", "大拐弯"],
    "changbai_tianchi": ["长白山", "天池"],
    "hulunbuir": ["呼伦贝尔", "草原"],
    "qiantang_tide": ["钱塘江", "大潮", "涌潮"],
    "sanya_coral": ["三亚", "亚龙湾", "珊瑚"],
    "wudalianchi": ["五大连池", "火山", "熔岩"],
    "sahara": ["撒哈拉", "沙漠"],
    "amazon": ["亚马孙", "亚马逊", "雨林"],
    "grand_canyon": ["科罗拉多", "大峡谷"],
    "great_barrier_reef": ["大堡礁", "珊瑚"],
    "uyuni": ["乌尤尼", "盐沼", "天空之镜"],
    "vatnajokull": ["瓦特纳", "冰川", "冰原", "冰岛"],
    "dead_sea": ["死海"],
    "nile": ["尼罗河", "三角洲"],
    "sognefjord": ["峡湾", "挪威", "松恩"],
    "mount_fuji": ["富士山", "富士"],
    "matterhorn": ["马特洪峰", "阿尔卑斯", "雪山"],
    "giants_causeway": ["巨人堤", "玄武岩", "石柱"],
    "cappadocia": ["卡帕多", "仙人烟囱", "土耳其"],
    "east_african_rift": ["东非", "裂谷"],
    "uluru": ["乌鲁鲁", "艾尔斯岩"],
    "grand_prismatic": ["大棱镜", "黄石", "温泉"],
    "atacama": ["阿塔卡马", "智利", "沙漠"],
    "milford_sound": ["米尔福德", "峡湾"],
    "lake_baikal": ["贝加尔湖", "贝加尔"],
    "kilimanjaro": ["乞力马扎罗"],
}

BAD_HOST_HINTS = (
    "logo", "icon", "banner", "ad_", "/ads/", "sprites",
)

# AI 生成图特征（域名 / 标题），必须排除，避免"假照片"
AIGC_HOST_HINTS = ("aigc", "bcebos.com/miaobi", "ai-image", "aicg")
AIGC_TITLE_HINTS = ("ai生成", "ai绘画", "ai作图", "ai绘制", "ai创作", "人工智能生成")

# 标题里带这些词的往往是"比大小/拼图/排行"类凑数图，与地貌实景无关
TITLE_REJECT_HINTS = ("寿光", "静山", "对比图", "排行榜", "排名", "哪个更", "vs")

# 带水印的图库图特征（商业图库，压着"视觉中国"之类水印，不适合当教材实景照）
WM_HOST_HINTS = (
    "copyright.bdstatic.com", "vcg", "veer", "gettyimages", "699pic.com",
    "photophoto.cn", "tuchong.com", "shutterstock", "dreamstime", "58pic.com",
    "zhituad.com", "qiantucdn", "ooopic",
)
WM_URL_HINTS = ("@wm_", "watermark")

USED_SOURCES = set()


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
    """百度接口需要先带上 BAIDUID 等 cookie 才不会被判定为爬虫。"""
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
    """360 图片接口（主源）：无需 cookie，一页 30~60 条，字段干净。"""
    out = []
    for p in range(pages):
        sn = p * 30
        url = ("https://image.so.com/j?q=" + urllib.parse.quote(query)
               + "&src=srp&correct=" + urllib.parse.quote(query) + "&sn=%d&pn=30" % sn)
        try:
            raw = http_get(url, referer="https://image.so.com/").decode("utf-8", "ignore")
            data = json.loads(raw)
        except Exception:  # noqa: BLE001
            continue
        for it in (data.get("list") or []):
            if not isinstance(it, dict):
                continue
            obj = it.get("img") or it.get("imgurl") or ""
            hover = it.get("thumb") or ""
            if not obj and not hover:
                continue
            out.append({
                "obj": obj,
                "hover": hover,
                "title": it.get("title") or it.get("ename") or "",
                "w": int(it.get("width") or 0),
                "h": int(it.get("height") or 0),
                "host": "",
                "aigc": False,
            })
        time.sleep(0.2)
    return out


def search_images_baidu(query, pages=2):
    """百度图片异步接口（备源）：需 cookie 预热，ObjURL 多为原始大图。"""
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
               "&isAsync=&pn=%d&rn=%d&gsm=%x" % (pn, 30, pn + 30))
        req = urllib.request.Request(url)
        req.add_header("X-Requested-With", "XMLHttpRequest")
        req.add_header("Accept", "application/json, text/plain, */*")
        req.add_header("Referer", "https://image.baidu.com/search/index?tn=baiduimage&word=" + q)
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
            out.append({
                "obj": obj,
                "hover": hover,
                "title": _strip_tags(it.get("fromPageTitle", "")),
                "w": int(it.get("width") or 0),
                "h": int(it.get("height") or 0),
                "host": it.get("fromURLHost", ""),
                "aigc": bool(it.get("isAigcEdit")),
            })
        time.sleep(0.2)
    return out


def search_images(query):
    """先 360，候选太少再补百度。返回合并后的候选列表。"""
    out = []
    try:
        out += search_images_360(query, pages=2)
    except Exception:  # noqa: BLE001
        pass
    if len(out) < 6:
        try:
            out += search_images_baidu(query, pages=2)
        except Exception:  # noqa: BLE001
            pass
    return out


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
    """裁成 16:10 并压到 TARGET_W 宽，返回 (宽, 高)"""
    im = Image.open(io.BytesIO(data)).convert("RGB")
    w, h = im.size
    want_h = w / TARGET_RATIO
    if h >= want_h:  # 太高 / 竖图：先按比例裁掉上下
        top = max(0, int((h - want_h) * 0.32))
        im = im.crop((0, top, w, top + int(want_h)))
    else:  # 太宽 / 全景：裁掉左右
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
    if aigc or any(h in low for h in AIGC_HOST_HINTS):
        return True
    return False


def rank_candidates(results, kws):
    """过滤 + 排序：关键词命中 > 横构图 > 大尺寸"""
    pool = []
    for r in results:
        title = r["title"]
        hit = any(k in title for k in kws)
        if any(a in title.lower() for a in AIGC_TITLE_HINTS):
            continue
        if any(a in title for a in TITLE_REJECT_HINTS):
            continue
        if r["host"] and any(h in r["host"] for h in WM_HOST_HINTS):
            continue
        if _is_bad_url(r["obj"], r["aigc"]) and _is_bad_url(r["hover"], r["aigc"]):
            continue
        w, h = r["w"], r["h"]
        aspect = (w / h) if h else 0
        landscape = 1 if aspect >= 1.25 else 0
        big = 1 if w >= 1000 else 0
        pool.append((hit, landscape, big, w, r))
    matched = [p for p in pool if p[0]]
    relaxed = not matched
    pool = matched or pool
    pool.sort(key=lambda p: (p[1], p[2], p[3]), reverse=True)
    return [p[4] for p in pool], relaxed


def _clean_tmp(dest):
    """清掉 .tmp / .tmp2 临时文件，避免半成品混进打包目录"""
    for extra in (dest + ".tmp", dest + ".tmp2"):
        if os.path.exists(extra):
            os.remove(extra)


def fetch_one(item, force=False):
    dest = os.path.join(OUTDIR, item["id"] + ".jpg")
    if os.path.exists(dest) and not force:
        return ("skip", item.get("photoSource", ""), os.path.getsize(dest), 0)

    kws = KEYWORDS.get(item["id"], [item["name"]])
    query = QUERY_OVERRIDE.get(item["id"]) or (item["name"] + " 实景 高清")
    try:
        results = search_images(query)
    except Exception as exc:  # noqa: BLE001
        return ("search-fail", str(exc), 0, 0)
    if not results:
        return ("no-candidate", "", 0, 0)

    pool, relaxed = rank_candidates(results, kws)
    tried = 0
    backup = None  # (width, tmpfile, src)
    tmp = dest + ".tmp"
    for r in pool:
        if tried >= 14:
            break
        for cand, ref in ((r["obj"], REFERER), (r["hover"], REFERER)):
            if not cand or not cand.startswith("http") or cand in USED_SOURCES:
                continue
            if _is_bad_url(cand, r["aigc"]):
                continue
            tried += 1
            try:
                data = http_get(cand, referer=ref)
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


def build_sheet(items, path):
    cols, cell_w, cell_h, label_h = 8, 210, 132, 20
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell_w, rows * (cell_h + label_h)), (18, 20, 28))
    draw = ImageDraw.Draw(sheet)
    for i, it in enumerate(items):
        p = os.path.join(OUTDIR, it["id"] + ".jpg")
        r, c = divmod(i, cols)
        x, y = c * cell_w, r * (cell_h + label_h)
        if os.path.exists(p):
            im = Image.open(p).convert("RGB")
            im.thumbnail((cell_w - 4, cell_h - 4), Image.LANCZOS)
            sheet.paste(im, (x + 2, y + 2))
        draw.text((x + 3, y + cell_h + 3), it["id"][:26], fill=(230, 210, 160))
    sheet.save(path, "JPEG", quality=80)
    return sheet.size


def main():
    args = sys.argv[1:]
    force = "--force" in args
    do_sheet = "--sheet" in args
    only = None
    for a in args:
        if a.startswith("--only="):
            only = set(a.split("=", 1)[1].split(","))

    data = json.load(io.open(DATA, encoding="utf-8"))
    items = data["landforms"]
    os.makedirs(OUTDIR, exist_ok=True)

    todo = [it for it in items if (only is None or it["id"] in only)]
    stat = {}
    for n, it in enumerate(todo, 1):
        status, src, size, tried = fetch_one(it, force=force)
        stat[status] = stat.get(status, 0) + 1
        if status in ("ok", "ok-small", "ok-relaxed"):
            it["photoSource"] = src
        print("[%2d/%d] %-24s %-10s tries=%-3d %8d  %s"
              % (n, len(todo), it["id"], status, tried, size, src[:66]))
        sys.stdout.flush()
        if status != "skip":
            time.sleep(0.5)

    io.open(DATA, "w", encoding="utf-8", newline="\n").write(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n")

    print("\n统计:", stat)
    bad = []
    for it in items:
        p = os.path.join(OUTDIR, it["id"] + ".jpg")
        if not os.path.exists(p):
            bad.append(it["id"] + "(缺)")
        elif Image.open(p).width < MIN_ACCEPT_W:
            bad.append(it["id"])
    print("小图/缺失:", bad or "无")
    if do_sheet:
        print("拼版缩略图:", build_sheet(items, os.path.join(ROOT, "montage.jpg")))


if __name__ == "__main__":
    main()
