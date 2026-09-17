#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
山河塑形·中国地形 —— 实景照片采集
------------------------------------------------
给 11 个地形区 + 27 条山脉各抓一张实景照片，存到 public/assets/photos/<id>.jpg
（id 与 regions.ts 完全一致，App 里就是按 `./assets/photos/${id}.jpg` 取的）。

用法：
    python scripts/fetch_photos.py                 # 补齐缺的
    python scripts/fetch_photos.py --force         # 全部重取
    python scripts/fetch_photos.py --only=taihang,qinling
    python scripts/fetch_photos.py --sheet         # 出拼版缩略图（人工逐格复核）
    python scripts/fetch_photos.py --avoid=url片段 # 复核发现某图不对，拉黑后重取

复核纪律（照 landform-quiz 那份来，别省）：
`--sheet` 出的拼版必须逐格目视确认。山脉这种题材最容易搜到
"景区牌坊""游客合影""地图示意""AI 概念图"，只看"下载成功"就发出去，
学生点开看到的可能是一张带水印的广告图。

图源（2026-09-17 换代，照 skill eduplay-game-publish §8.6 来）：
  1. **Wikimedia Commons 官方 API —— 现役首选**（分类/标题直取，真实照片、许可明确，
     没有水印图库和"景区攻略"噪声）；
  2. 百度图片 —— 兜底，其 ObjURL 常是原始站点大图；
  3. `search_images_360` **已失效**（2026-09 实测 image.so.com 接口整体不通，
     调用被 try/except 吞掉、静默返回空）。但 `REFERER = "https://image.so.com/"` 仍被
     Commons 的下载沿用，**别顺手删掉**。

先下载到 .tmp，全部校验通过后再原子替换 —— 失败时不会把半成品留在打包目录里。
"""

import html
import http.cookiejar
import io
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# Pillow 只在真正处理图片时才需要。做成"用时才报错"，这样
# `scripts/photo_rules.test.py`（只测 URL 判定规则）在裸 python 下也能跑 ——
# 否则一 import 就 ModuleNotFoundError，规则自测直接跑不起来。
try:
    from PIL import Image, ImageDraw
except ImportError:  # noqa: BLE001
    Image = None
    ImageDraw = None

PIL_HINT = ("需要 Pillow。本机装在托管的 venv 里，用这个解释器跑：\n"
            "  C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe\n"
            "（裸 python 是 3.13.12，里面没有 PIL）")


def _need_pil():
    if Image is None:
        raise RuntimeError(PIL_HINT)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUTDIR = os.path.join(ROOT, "public", "assets", "photos")
# 复用 landform-quiz 里已经过目视复核的现成照片
REUSE_DIR = os.path.abspath(os.path.join(ROOT, "..", "landform-quiz", "public", "assets", "landforms"))
SHEET_PATH = os.path.abspath(os.path.join(ROOT, "..", ".workbuddy", "tmp", "crverify", "montage-photos.jpg"))

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")

TARGET_W = 900
TARGET_RATIO = 16 / 10
MIN_ACCEPT_W = 700
REFERER = "https://image.so.com/"

# ---------------------------------------------------------------- 素材清单
# reuse: 直接从 landform-quiz 拷贝（那张图主题确实对得上才写）
# query: 检索词；kw: 标题里必须命中其中之一（拦广告图/表情包/无关内容）
ITEMS = [
    # ---- 四大高原 ----
    {"id": "qingzang", "name": "青藏高原", "group": "四大高原",
     "reuse": "qinghai_tibet.jpg", "query": "青藏高原 风光 草原 雪山",
     "kw": ["青藏", "高原", "西藏"]},
    {"id": "neimenggu", "commons": ["Inner Mongolia grassland", "Xilingol", "Hulunbuir"], "name": "内蒙古高原", "group": "四大高原",
     "query": "内蒙古高原 草原 风光 航拍", "kw": ["内蒙古", "高原", "草原"]},
    {"id": "huangtu", "name": "黄土高原", "group": "四大高原",
     "reuse": "loess_plateau.jpg", "query": "黄土高原 地貌 沟壑 千沟万壑",
     "kw": ["黄土", "沟壑", "窑洞"]},
    {"id": "yungui", "name": "云贵高原", "group": "四大高原",
     "reuse": "yunnan_stone_forest.jpg", "query": "云贵高原 喀斯特 峰林 梯田",
     "kw": ["云贵", "喀斯特", "石林", "峰林"]},
    # ---- 四大盆地 ----
    {"id": "talimu", "name": "塔里木盆地", "group": "四大盆地",
     "reuse": "taklamakan.jpg", "query": "塔里木盆地 塔克拉玛干 沙漠 胡杨",
     "kw": ["塔里木", "塔克拉玛干", "沙漠"]},
    {"id": "zhungeer", "commons": ["Junggar Basin", "Dzungarian Basin", "Gurbantunggut Desert"], "name": "准噶尔盆地", "group": "四大盆地",
     "query": "准噶尔盆地 戈壁 草原 新疆 风光", "kw": ["准噶尔", "盆地", "戈壁", "草原"]},
    {"id": "chaidamu", "name": "柴达木盆地", "group": "四大盆地",
     "reuse": "chaka_salt.jpg", "query": "柴达木盆地 戈壁 盐湖 青海",
     "kw": ["柴达木", "盐湖", "戈壁"]},
    {"id": "sichuan", "commons": ["Sichuan Basin", "Chengdu Plain"], "name": "四川盆地", "group": "四大盆地",
     "query": "四川盆地 丘陵 田园 航拍 成都平原", "kw": ["四川盆地", "盆地", "成都平原", "丘陵"]},
    # ---- 三大平原 ----
    {"id": "dongbei", "commons": ["Northeast China Plain", "Songnen Plain", "Sanjiang Plain"], "name": "东北平原", "group": "三大平原",
     "query": "东北平原 黑土地 农田 航拍 松嫩平原", "kw": ["东北平原", "黑土地", "农田", "松嫩", "三江平原"]},
    {"id": "huabei", "commons": ["North China Plain", "Yellow River plain"], "name": "华北平原", "group": "三大平原",
     "query": "华北平原 麦田 一望无际 航拍", "kw": ["华北平原", "麦田", "平原"]},
    {"id": "changjiang", "commons": ["Yangtze River Delta", "Poyang Lake", "Taihu", "Middle Yangtze"], "name": "长江中下游平原", "group": "三大平原",
     "query": "长江中下游平原 水乡 稻田 河网 航拍", "kw": ["长江中下游", "平原", "水乡", "稻田"]},
    # ---- 山脉 ----
    {"id": "altai", "commons": ["Altai Mountains", "Kanas Lake"], "name": "阿尔泰山脉",
     "query": "新疆 阿尔泰山 喀纳斯 雪山 秋色", "kw": ["阿尔泰", "喀纳斯", "新疆"]},
    {"id": "tianshan", "name": "天山山脉",
     "reuse": "tianshan.jpg", "query": "天山山脉 雪山 天池 新疆 风光",
     "kw": ["天山", "雪峰", "天池"]},
    {"id": "aerjin", "commons": ["Altyn-Tagh", "Altun Mountains"], "name": "阿尔金山脉",
     "query": "阿尔金山 自然保护区 高原 荒漠 青海", "kw": ["阿尔金", "高原", "荒漠"]},
    {"id": "qilian", "commons": ["Qilian Mountains"], "name": "祁连山脉",
     "query": "祁连山 雪山 草原 甘肃 风光", "kw": ["祁连", "雪山", "草原"]},
    {"id": "kunlun", "commons": ["Kunlun Mountains", "Kunlun"], "name": "昆仑山脉",
     "query": "昆仑山脉 雪山 高原 风光", "kw": ["昆仑", "雪山", "高原"]},
    {"id": "kalakunlun", "commons": ["Karakoram", "K2"], "name": "喀喇昆仑山脉",
     "query": "喀喇昆仑山 雪山 冰川 乔戈里峰", "kw": ["喀喇昆仑", "冰川", "雪山"]},
    {"id": "tangula", "commons": ["Tanggula Mountains", "Tanggula Pass", "Tanggula"], "name": "唐古拉山脉",
     "query": "唐古拉山 雪山 青藏公路 高原", "kw": ["唐古拉", "雪山", "高原"]},
    {"id": "ximalaya", "name": "喜马拉雅山脉",
     "reuse": "everest.jpg", "query": "喜马拉雅山脉 珠穆朗玛峰 雪山",
     "kw": ["喜马拉雅", "珠穆朗玛", "珠峰"]},
    {"id": "bayan", "commons": ["Bayan Har Mountains", "Bayan Har"], "name": "巴颜喀拉山脉",
     "query": "巴颜喀拉山 黄河源 雪山 青海", "kw": ["巴颜喀拉", "黄河源", "雪山"]},
    {"id": "gangdise", "commons": ["Gangdise", "Mount Kailash", "Transhimalaya"], "name": "冈底斯山脉",
     "query": "冈底斯山 雪山 阿里 西藏 风光", "kw": ["冈底斯", "雪山", "阿里"]},
    {"id": "hengduan", "commons": ["Hengduan Mountains", "Three Parallel Rivers"], "name": "横断山脉",
     "query": "横断山脉 峡谷 雪山 三江并流 风光", "kw": ["横断", "峡谷", "三江并流", "雪山"]},
    {"id": "yinshan", "commons": ["Yinshan Mountains", "Yin Mountains", "Yinshan"], "name": "阴山山脉",
     "query": "阴山山脉 内蒙古 草原 山脉 风光", "kw": ["阴山", "内蒙古", "草原"]},
    {"id": "helanshan", "commons": ["Helan Mountains", "Helan Shan"], "name": "贺兰山",
     "query": "贺兰山 宁夏 山脉 风光", "kw": ["贺兰山", "宁夏"]},
    {"id": "liupanshan", "commons": ["Liupan Mountains", "Liupan Shan"], "name": "六盘山",
     "query": "六盘山 宁夏 森林 风光", "kw": ["六盘山", "宁夏", "森林"]},
    {"id": "taihang", "commons": ["Taihang Mountains", "Taihang Shan"], "name": "太行山脉",
     "query": "太行山 大峡谷 断崖 峭壁 风光", "kw": ["太行", "峡谷", "断崖"]},
    {"id": "qinling", "commons": ["Qinling", "Qinling Mountains"], "name": "秦岭",
     "query": "秦岭 山脉 云海 风光 主峰", "kw": ["秦岭", "云海", "山脉"]},
    {"id": "daba", "commons": ["Daba Mountains", "Daba Shan"], "name": "大巴山脉",
     "query": "大巴山 山脉 陕西 四川 风光", "kw": ["大巴山", "山脉"]},
    {"id": "wushan", "commons": ["Wushan", "Wu Gorge", "Wu Mountains"], "name": "巫山",
     "query": "巫山 三峡 神女峰 长江 风光", "kw": ["巫山", "三峡", "神女峰"]},
    {"id": "xuefeng", "commons": ["Xuefeng Mountains", "Xuefeng Shan"], "name": "雪峰山",
     "query": "雪峰山 湖南 山脉 云海 风光", "kw": ["雪峰山", "湖南", "云海"]},
    {"id": "nanling", "commons": ["Nanling Mountains", "Nanling"], "name": "南岭",
     "query": "南岭 山脉 广东 湖南 风光", "kw": ["南岭", "山脉", "广东", "湖南"]},
    {"id": "wuyi", "name": "武夷山脉",
     "reuse": "wuyi_mountains.jpg", "query": "武夷山 九曲溪 丹霞 风光",
     "kw": ["武夷", "九曲溪", "丹霞"]},
    {"id": "taiwan", "commons": ["Central Mountain Range", "Yu Shan", "Jade Mountain"], "name": "台湾山脉",
     "query": "台湾 中央山脉 玉山 高山 风光", "kw": ["中央山脉", "玉山", "台湾"]},
    {"id": "dabie", "commons": ["Dabie Mountains"], "name": "大别山",
     "query": "大别山 山脉 安徽 湖北 风光", "kw": ["大别山", "安徽", "湖北"]},
    {"id": "yanshan", "commons": ["Yanshan Mountains", "Yan Mountains"], "name": "燕山",
     "query": "燕山山脉 长城 河北 风光", "kw": ["燕山", "长城", "河北"]},
    {"id": "daxinganling", "commons": ["Greater Khingan", "Da Hinggan Ling"], "name": "大兴安岭",
     "query": "大兴安岭 森林 林海 秋色 风光", "kw": ["大兴安岭", "林海", "森林"]},
    {"id": "xiaoxinganling", "commons": ["Lesser Khingan", "Xiao Hinggan Ling"], "name": "小兴安岭",
     "query": "小兴安岭 森林 林海 风光", "kw": ["小兴安岭", "林海", "森林"]},
    {"id": "changbai", "name": "长白山脉",
     "reuse": "changbai_tianchi.jpg", "query": "长白山 天池 火山 风光",
     "kw": ["长白山", "天池"]},
]

# ⚠️ 这些是**完整路径段**，不是任意子串 —— 正则要求片段后面紧跟分隔符或到结尾。
# 两代误杀都出在这里：
#   ① 直接拿整条 URL 做子串匹配 → 文件名里的 "Banner" 中招。
#      而 Banner（旗）是内蒙古县级区名的正式英译（Heshigten Banner = 克什克腾旗），
#      于是 Commons 上所有关于内蒙古"旗"的照片都抓不到，
#      且 `rank_candidates` 会静默跳过它们，日志上一点痕迹没有。
#   ② 只要求片段以 `/` 开头 → `.../1/1a/Iconic_Mountain.jpg` 也会中招
#      （第二个 `/` 后面就是 `icon`）。所以要卡边界。
BAD_PATH_RE = re.compile(
    r"/(?:logo|icon|banner|ads|adv|sprites)(?=[./?&#=]|$)"
    r"|/ad_\d+x\d+"
)
AIGC_HOST_HINTS = ("aigc", "bcebos.com/miaobi", "ai-image", "aicg")
AIGC_TITLE_HINTS = ("ai生成", "ai绘画", "ai作图", "ai绘制", "ai创作", "人工智能生成")

# 标题里带这些词的往往是"比大小/拼图/排行"类凑数图，或者带水印的商业图库图。
# 山脉题材额外拦"地图/示意/路线/门票/门票/景区导游图"—— 那些不是实景。
TITLE_REJECT_HINTS = (
    "对比图", "排行榜", "排名", "哪个更", "vs", "地形图", "地图", "示意图", "路线图",
    "门票", "导游图", "攻略", "简笔画", "插画", "卡通", "壁纸合集",
    "图虫", "视觉中国", "摄图", "千图", "包图", "昵图", "全景视觉", "全景网",
    "veer", "gettyimages", "东方ic", "123rf", "depositphotos", "站酷", "汇图",
)

WM_HOST_HINTS = (
    "copyright.bdstatic.com", "vcg", "veer", "gettyimages", "699pic.com",
    "photophoto.cn", "tuchong.com", "shutterstock", "dreamstime", "58pic.com",
    "zhituad.com", "qiantucdn", "ooopic", "hdslb.com",
    "icweiliimg", "hellorfimg",
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


# ---------------------------------------------------------------- Wikimedia Commons
# 主源。为什么首选它（而不是继续修 360 / 百度）：
#   * 2026-09 实测 `image.so.com` 的接口已经整体不通（SSL UNEXPECTED_EOF），主源直接没了；
#   * 百度接口把返回的 **60/60 条** 结果全打上 `isAigcEdit: true` —— 这个字段已经
#     不再有区分度，照旧当成一票否决，整个候选池会被清空（正是这次 25 张全灭的原因）；
#   * Commons 是官方 API，返回的是**真实照片**且有明确许可，标题就是山名/地貌名，
#     没有水印图库、没有 AI 概念图，也没有"景区门票攻略"这类噪声。
#     教学产品要分发到学校，图片来源干净这件事本身就是交付质量的一部分。
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
# Commons 要求带可识别的 User-Agent
COMMONS_UA = "EduPlayChinaRelief/0.0.1 (K-12 geography teaching game; python-urllib)"

# 标题里出现这些词的多半是地图/示意图/卫星图/老照片，不是"实景照片"
COMMONS_TITLE_REJECT = (
    # 地图 / 示意图 / 图表
    "map", "maps", "location", "locator", "diagram", "chart", "svg", "logo",
    "coat of arms", "flag", "topograph", "physiograph", "relief", "elevation",
    "schematic", "sketch", "drawing", "painting", "plan of", "profile",
    # 卫星 / 太空 / 夜光 —— 实测这几类在"平原""盆地"条目里特别多
    "satellite", "landsat", "modis", "aster", "srtm", "from space",
    "iss0", "iss_", "city lights", "at night", "night view", "nightview",
    # 人文建筑：搜"巫山""燕山"很容撞到同名的寺/庙/景区建筑
    "temple", "monastery", "pagoda", "shrine", "museum", "station", "airport",
    "railway", "bridge", "street", "square", "building", "hotel", "gate",
    # 年代久远的插画/书页/邮票
    "stamp", "poster", "engraving", "lithograph", "1900", "1899", "1870",
)


def _commons_get(params, tries=6):
    """带重试的 Commons 调用。

    要认两种失败，它们的性质完全不同：

    * **连接被掐断**（URLError / IncompleteRead）：连发十几个请求就会出现。
      不重试的话表现成"这个条目在 Commons 上没有图"—— 一多半条目会莫名其妙地空掉，
      而 API 本身是好的。
    * **HTTP 429 Too Many Requests**：退避要长得多。曾用 1~5 秒的短退避，
      批量取图时三条挑定图连着 429 失败 —— 而当时的代码会**静默退回关键词检索**，
      于是本来挑好的图被一张更差的图顶掉，从日志上一眼看不出问题。
    """
    last = None
    for attempt in range(tries):
        try:
            url = COMMONS_API + "?" + urllib.parse.urlencode(params)
            req = urllib.request.Request(url)
            req.add_header("User-Agent", COMMONS_UA)
            req.add_header("Accept", "application/json")
            with urllib.request.urlopen(req, timeout=35) as resp:
                return json.loads(resp.read().decode("utf-8", "ignore"))
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code == 429:
                after = exc.headers.get("Retry-After") if exc.headers else None
                wait = float(after) if (after or "").isdigit() else 6.0 * (attempt + 1)
                time.sleep(min(wait, 60))
            else:
                time.sleep(1.5 * (attempt + 1))
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1.2 * (attempt + 1))
    raise last


# ---------------------------------------------------------------- 缩略图
# ⚠️ 不要在代码里自己拼缩略图 URL。Wikimedia 只允许一组**标准宽度**：
#     20 / 40 / 60 / 120 / 250 / 330 / 500 / 960 / 1280 / 1920 / 3840
#   走 imageinfo API 的请求会被**向上取整**到标准尺寸，而**直接热链一个非标准
#   宽度会被拒**（实测 `1200px-` 拿到 HTTP 400 "Use thumbnail sizes listed on ..."）。
#   mediawiki.org 的 Common thumbnail sizes 页 FAQ 把话说明白了：
#   "Alternatively use the imageinfo api instead of directly constructing the image's url."
#   所以这里只做一件事：**用 API 给的 thumburl**，把 `utm_*` 查询参数去掉。
#
# 为什么必须去掉查询参数、以及为什么要有 THUMB_W：
#   `iiurlwidth` 只是个**上限** —— 当原图本身就比它窄时，API 直接把原图地址给你
#   （挂几个 `utm_*`）。于是 hover 和 obj 变成同一个地址，两个候选一起失败，
#   表现成"这张挑好的图取不下来"，而从参数上看不出任何异常。
#   取 960（标准尺寸之一）既让 API 走缩略图分支，也远超落地所需的 900 px。
THUMB_W = 960


def _canon_url(url):
    """去掉 utm_* 之类的查询参数（它们会让每次请求都像是新资源，绕过缓存、加重限流）。"""
    return (url or "").split("?")[0]


def _commons_files(pages, apply_reject=True):
    """从 imageinfo 结果里挑出能用的图（只收 JPEG）。

    `apply_reject=False` 用于人工挑定的图：那张是看过的，不该再被关键词拦住。
    """
    out = []
    for page in pages:
        title = page.get("title") or ""
        infos = page.get("imageinfo") or []
        if not infos:
            continue
        info = infos[0]
        low = title.lower()
        if apply_reject and any(bad in low for bad in COMMONS_TITLE_REJECT):
            continue
        # 只收 JPEG。Commons 上的**地图、卫星拼接图、地形渲染图几乎都是 PNG**
        # （矢量导出或带 alpha 的合成图），而实景照片几乎都是 JPEG ——
        # 这一条比任何标题关键词都管用：复核时看到"四川盆地"抓到一张英文地形图、
        # "台湾山脉"抓到一张分层设色高度图，两张都是 PNG。
        if (info.get("mime") or "") != "image/jpeg":
            continue
        obj = _canon_url(info.get("url") or "")
        out.append({
            "title": title.replace("File:", ""),
            "obj": obj,
            "hover": _canon_url(info.get("thumburl") or "") or obj,
            "w": int(info.get("width") or 0),
            "h": int(info.get("height") or 0),
            "host": "commons.wikimedia.org",
            "referer": "https://commons.wikimedia.org/",
            # 先试缩略图：落地只有 900 px，960 px 足够；下载量小、命中率高
            "order": ("hover", "obj"),
            "aigc": False,
        })
    return out


_COMMONS_INFO = {"prop": "imageinfo", "iiprop": "url|size|mime", "iiurlwidth": str(THUMB_W)}

# ---------------------------------------------------------------- 人工挑定的图
# 复核拼版之后逐张敲定的 Commons 文件名，优先于检索结果。
# 检索的排序只能保证"标题里有这个地名"，保证不了"这张图适合当教材"：
# 「巫山」抓到巫山寺、「燕山」抓到燕山寺、「阴山」抓到 Yinshan Mausoleum（陵墓）、
# 「祁连山脉」抓到 ISS 太空照 —— 标题里都含地名。所以留一个能写死文件名的口子。
COMMONS_PICK = {
    "changjiang": ["Zhouzhuang water town.jpg"],
    "sichuan": ["Sichuanese countryside 004.jpg"],
    "bayan": ["Pasture Area in Qinghai.jpg"],
    # 阴山 = 大青山。石拐区（包头）那批 panoramio 里挑的：裸露岩脊、成排峰线，
    # 一眼读得出"山脉"。原先是「呼和浩特北面的大青山」，画面九成是城市楼群，
    # 大青山只当背景 —— 当地理教材不合格。
    "yinshan": ["大青山一景 - panoramio.jpg"],
    # 原来的「卢峰山的雪松林」画面九成是树干树皮，读不出"山"。换云海。
    # 这张原图只有 700×467（正好卡 MIN_ACCEPT_W），但照片框最宽 300 多 px，够用。
    "xuefeng": ["雪峰山雾海 - panoramio.jpg"],
    # 小兴安岭的英文正名是 Lesser Khingan，而该分类下 4 个文件有 3 个在俄罗斯，
    # 老老实实按关键词检索必然串到俄远东 —— 所以这张必须钉死。
    # 五营国家森林公园在伊春，小兴安岭腹地的红松原始林。
    "xiaoxinganling": ["Xiangshui Creek, Wuying National Forest Park, Heilongjiang, China (6 September 2016).jpg"],
    # 原先是 `Hulun Buir.jpg` —— 落盘时按 16:10 裁完画面八成是天空，读不出"高原"。
    # 换成克什克腾旗（赤峰）的草原丘陵：起伏和缓、地面坦荡，是内蒙古高原的样子。
    "neimenggu": ["Grasslands in Heshigten Banner.jpg"],
    "huabei": ["20230602 Reaper gathering wheat in Weishi County.jpg"],
    "qilian": ["Qilian in Qilian Qinghai.jpg"],
    "tangula": ["24- Snow at Tanggu-la (5180 m).jpg"],
    "hengduan": ["小贡嘎峰 Chiburongi Konka.jpg"],
    "wushan": ["Wu Gorge 2016 6.jpg"],
    "taiwan": ["Taiwan 2009 HuaLien Taroko Gorge FRD 5435 Pano Extracted.jpg"],
    "yanshan": ["Yan Mountain in Qinhuangdao.jpg"],
    # 乌尔禾魔鬼城在准噶尔盆地内。标题里写明"景观"，避开同条目的路边饭店照片 ——
    # 而且**只给一个文件名**：`titles=` 的结果按 pageid 排序，多给时谁先下不可控。
    "zhungeer": ["新疆乌尔禾魔鬼城景观.jpg"],
    "liupanshan": ["Liupan Mountains from the observation deck (20260201152712).jpg"],
    "dongbei": ["三江平原 - panoramio - zhanyoun.jpg", "Tongjiang - aerial - P1040677.JPG"],
}


def commons_by_title(titles):
    """按确切文件名取图（人工挑定的走这条，不再过关键词过滤）。"""
    params = dict(_COMMONS_INFO)
    params.update({"action": "query", "format": "json", "formatversion": "2",
                   "titles": "|".join("File:" + t for t in titles)})
    data = _commons_get(params)
    pages = [p for p in (data.get("query", {}).get("pages") or []) if p.get("pageid", -1) != -1]
    return _commons_files(pages, apply_reject=False)





def search_commons(terms):
    """给一组候选写法，**先试分类成员、再退到自由文本搜索**。

    为什么分类成员优先：搜 "Lesser Khingan"（小兴安岭）时自由文本会把俄远东
    panoramio 的照片排到前面（那边也有个"兴安岭"），而 `Category:Lesser Khingan`
    里的图是有人按主题归过类的，不会跑偏。
    为什么要多个写法：Commons 上同一条山脉常有 Dzungarian / Junggar 两种拼法，
    分类名也未必和条目名一致，多试几个才找得到。
    """
    got = []
    for term in terms:
        params = dict(_COMMONS_INFO)
        params.update({"action": "query", "format": "json", "formatversion": "2",
                       "generator": "categorymembers", "gcmtitle": "Category:" + term,
                       "gcmtype": "file", "gcmlimit": "60"})
        try:
            got += _commons_files(_commons_get(params).get("query", {}).get("pages") or [])
        except Exception:  # noqa: BLE001
            pass
        if len(got) >= 4:
            break
        params = dict(_COMMONS_INFO)
        params.update({"action": "query", "format": "json", "formatversion": "2",
                       "generator": "search",
                       "gsrsearch": "filemime:jpeg filetype:bitmap " + term,
                       "gsrnamespace": "6", "gsrlimit": "40"})
        try:
            got += _commons_files(_commons_get(params).get("query", {}).get("pages") or [])
        except Exception:  # noqa: BLE001
            pass
        if len(got) >= 4:
            break
    # 同一个文件可能被分类和搜索各带出来一次
    seen, uniq = set(), []
    for r in got:
        if r["obj"] in seen:
            continue
        seen.add(r["obj"])
        uniq.append(r)
    return uniq


def rank_commons(results, terms):
    """排序：标题真的含地名 > 构图接近 16:10 > 大尺寸。

    构图这一项是有要求的，不是锦上添花：Commons 上"盆地/平原"类条目很容易撞到
    几千像素宽、7:1 的横幅图（`Sichuan Basin Banner.jpg` 就是这样）。
    那种图裁成 16:10 只剩中间一条细缝，学生看到的是模糊的地平线。
    所以把 1.3~2.2 的横构图排在最前，过扁过高的一律降档。
    """
    toks = [w.lower() for t in terms for w in t.split() if len(w) > 3]
    pool = []
    for r in results:
        low = r["title"].lower()
        hit = 1 if any(t in low for t in toks) else 0
        a = (r["w"] / r["h"]) if r["h"] else 0
        band = 2 if 1.3 <= a <= 2.2 else (1 if 1.1 <= a < 3.0 else 0)
        big = 1 if r["w"] >= 1400 else 0
        pool.append((hit, band, big, r["w"], r))
    pool.sort(key=lambda p: (p[0], p[1], p[2], p[3]), reverse=True)
    return [p[4] for p in pool]


def _dl_get(url, referer=None, tries=3):
    """下图片也要重试。

    日志里普遍是 `tries=2`：候选的第一个地址（`upload.wikimedia.org` 的原图）经常
    直接失败，退到 `thumb.wikimedia.org` 才通 —— 原图动辄几千像素、又和 API 共用
    限流，撞 429 的概率高得多。所以下载这一步和调 API 一样需要重试。
    """
    last = None
    for attempt in range(tries):
        try:
            return http_get(url, referer=referer)
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code == 429:
                after = exc.headers.get("Retry-After") if exc.headers else None
                wait = float(after) if (after or "").isdigit() else 20.0 * (attempt + 1)
                time.sleep(min(wait, 120))
            else:
                time.sleep(1.0 * (attempt + 1))
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1.0 * (attempt + 1))
    raise last


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
            out.append({"obj": obj, "hover": hover,
                        "title": it.get("title") or it.get("ename") or "",
                        "w": int(it.get("width") or 0), "h": int(it.get("height") or 0),
                        "host": "", "order": ("obj", "hover"), "aigc": False})
        time.sleep(0.2)
    return out


def search_images_baidu(query, pages=2):
    op = _baidu_opener()
    q = urllib.parse.quote(query)
    try:
        op.open("https://image.baidu.com/search/index?tn=baiduimage&word=" + q, timeout=20).read()
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
            out.append({"obj": obj, "hover": hover,
                        "title": _strip_tags(it.get("fromPageTitle", "")),
                        "w": int(it.get("width") or 0), "h": int(it.get("height") or 0),
                        "host": it.get("fromURLHost", ""), "order": ("obj", "hover"),
                        # ⚠️ 只作信息记录，**绝不可当过滤条件**：百度把返回的 60/60 条
                        # 结果全标 isAigcEdit=true（连自家 CDN 和知乎的实拍也标），已无区分度。
                        # 曾把它当一票否决 → 候选池被清空、25 张一张没抓到，而日志只说"没有图"。
                        "aigc": bool(it.get("isAigcEdit"))})
        time.sleep(0.2)
    return out


def search_images(query):
    out = []
    try:
        out += search_images_360(query, pages=2)
    except Exception:  # noqa: BLE001
        pass
    try:
        out += search_images_baidu(query, pages=2)
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
    """裁成 16:10 并压到 TARGET_W 宽，返回 (宽, 高)。"""
    _need_pil()
    im = Image.open(io.BytesIO(data)).convert("RGB")
    w, h = im.size
    want_h = w / TARGET_RATIO
    if h >= want_h:      # 太高 / 竖图：裁掉上下（偏上取，保住天际线）
        top = max(0, int((h - want_h) * 0.32))
        im = im.crop((0, top, w, top + int(want_h)))
    else:                # 太宽 / 全景：裁掉左右
        want_w = h * TARGET_RATIO
        left = max(0, int((w - want_w) / 2))
        im = im.crop((left, 0, left + int(want_w), h))
    if im.width > TARGET_W:
        im = im.resize((TARGET_W, int(TARGET_W / TARGET_RATIO)), Image.LANCZOS)
    im.save(dest, "JPEG", quality=78, optimize=True, progressive=True)
    return im.size


def _is_bad_url(u):
    """明显的坏图源：图标、广告位、带水印的商业图库、AI 生成图。

    ⚠️ 广告位那组（`BAD_PATH_RE`）匹配的是**路径段**（要求以 `/` 开头），
    不是任意子串 —— 详见该常量上的注释：拿子串匹配会把文件名里带 "Banner"
    （内蒙古的"旗"）的照片全部误杀。

    ⚠️ 这里**故意不看**百度接口的 `isAigcEdit` 字段。2026-09 实测它把返回的
    60/60 条结果全标成 `isAigcEdit: true`（连知乎、百度自家 CDN 的真实照片
    也标），这个字段已经没有区分度；当初把它当一票否决，结果 38 张里 25 张
    候选池被清空、一张都没抓到。真正能认出 AI 图的是它落在哪个 CDN 上
    （`miaobi` / `ai-image` 这些），AIGC_HOST_HINTS 那条已经拦得住。
    """
    if not u or not u.startswith("http"):
        return True
    low = u.lower()
    if BAD_PATH_RE.search(low):
        return True
    if any(h in low for h in WM_HOST_HINTS) or any(h in low for h in WM_URL_HINTS):
        return True
    if any(h in low for h in EXTRA_BAD_HOSTS):
        return True
    if any(h in low for h in AIGC_HOST_HINTS):
        return True
    return False


def rank_candidates(results, kws):
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
        if r["obj"] and any(h in r["obj"].lower() for h in WM_HOST_HINTS):
            continue
        if _is_bad_url(r["obj"]) and _is_bad_url(r["hover"]):
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


def reuse_one(item, dest, force=False):
    """从 landform-quiz 的库里拷一张过来（那张图主题确实对得上才在清单里写了 reuse）。"""
    src = os.path.join(REUSE_DIR, item["reuse"])
    if not os.path.exists(src):
        return ("reuse-missing", src, 0, 0)
    if os.path.exists(dest) and not force:
        return ("skip", src, os.path.getsize(dest), 0)
    tmp = dest + ".tmp"
    size = normalize(open(src, "rb").read(), tmp)
    os.replace(tmp, dest)
    _clean_tmp(dest)
    return ("reuse", src, os.path.getsize(dest), 0)


def _download_best(pool, dest, tag):
    """按顺序试候选，挑第一张够大的落地。返回 (status, src, tried) 或 None。

    `dest` 一律先写 `.tmp` 再原子替换：中途失败不会把半成品留在打包目录里。
    """
    tried = 0
    backup = None
    tmp = dest + ".tmp"
    for r in pool:
        if tried >= 14:
            break
        ref = r.get("referer") or REFERER
        order = r.get("order") or ("obj", "hover")
        for key in order:
            cand = r.get(key) or ""
            if not cand or not cand.startswith("http") or cand in USED_SOURCES:
                continue
            if _is_bad_url(cand):
                continue
            tried += 1
            try:
                data = _dl_get(cand, referer=ref)
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
                return (tag, cand, tried)
            if not backup or size[0] > backup[0]:
                backup = (size[0], tmp, cand)
                tmp = dest + ".tmp2" if tmp.endswith(".tmp") else dest + ".tmp"
            break
    if backup:
        os.replace(backup[1], dest)
        _clean_tmp(dest)
        USED_SOURCES.add(backup[2])
        return ("ok-small", backup[2], tried)
    return None


def fetch_one(item, force=False):
    dest = os.path.join(OUTDIR, item["id"] + ".jpg")
    size_of = lambda: os.path.getsize(dest) if os.path.exists(dest) else 0
    if item.get("reuse"):
        return reuse_one(item, dest, force=force)
    if os.path.exists(dest) and not force:
        return ("skip", "", os.path.getsize(dest), 0)

    # 主源：Wikimedia Commons。核过尺寸与许可再落地。
    # 人工挑定的图**绝对优先**，且不参与排序。
    # 不能把挑定结果塞进检索结果里一起排：排序的第一关键字是"标题含地名"，
    # 而挑定的中文标题往往不含英文地名 —— 实测「阴山」挑的
    # 「大青山一景」会被检索到的 `Yinshanosaurus`（恐龙插图，
    # 标题里恰好有 yinshan）挤下去。
    picked = COMMONS_PICK.get(item["id"])
    if picked:
        for attempt in range(3):
            try:
                got = _download_best(commons_by_title(picked), dest, "commons-pick")
                break
            except Exception:  # noqa: BLE001
                got = None
                time.sleep(5 * (attempt + 1))
        if got:
            return (got[0], got[1], size_of(), got[2])
        # ⚠️ 挑定失败**不许**退回检索。退回的后果是"本来挑好的图被一张更差的图顶掉"，
        # 而日志上只会看到一次成功的抓取 —— 曾经因为 429 就这样静默换过三张图。
        # 这里直接报缺失，让"缺失/小图"那行把它显出来，下次跑再补。
        _clean_tmp(dest)
        return ("pick-fail", "", 0, 0)

    if item.get("commons"):
        try:
            raw = search_commons(item["commons"])
        except Exception:  # noqa: BLE001
            raw = []
        if raw:
            got = _download_best(rank_commons(raw, item["commons"]), dest, "commons")
            if got:
                return (got[0], got[1], size_of(), got[2])

    # 备源：百度图片。Commons 没有覆盖到的（国内一些小山脉）走这条。
    try:
        results = search_images(item["query"])
    except Exception as exc:  # noqa: BLE001
        return ("search-fail", str(exc), 0, 0)
    if not results:
        return ("no-candidate", "", 0, 0)
    pool, relaxed = rank_candidates(results, item["kw"])
    got = _download_best(pool, dest, "ok-relaxed" if relaxed else "ok")
    if got:
        return (got[0], got[1], size_of(), got[2])
    _clean_tmp(dest)
    return ("all-fail", "", 0, 0)


def build_sheet(path):
    _need_pil()
    cols, cell_w, cell_h, label_h = 7, 236, 148, 20
    rows = (len(ITEMS) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell_w, rows * (cell_h + label_h)), (18, 20, 28))
    draw = ImageDraw.Draw(sheet)
    for i, it in enumerate(ITEMS):
        p = os.path.join(OUTDIR, it["id"] + ".jpg")
        r, c = divmod(i, cols)
        x, y = c * cell_w, r * (cell_h + label_h)
        if os.path.exists(p):
            im = Image.open(p).convert("RGB")
            im.thumbnail((cell_w - 6, cell_h - 6), Image.LANCZOS)
            sheet.paste(im, (x + 3, y + 3))
        draw.text((x + 4, y + cell_h + 3), it["id"][:30], fill=(230, 210, 160))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sheet.save(path, "JPEG", quality=84)
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
    todo = [it for it in ITEMS if (only is None or it["id"] in only)]
    stat = {}
    sources = {}
    for n, it in enumerate(todo, 1):
        status, src, size, tried = fetch_one(it, force=force)
        stat[status] = stat.get(status, 0) + 1
        # 收录条件按事实判断，不按状态白名单 —— 白名单漏过 commons / commons-pick，
        # 而那正是人工挑定项的来源，也是最需要留痕的一批。
        dest_p = os.path.join(OUTDIR, it["id"] + ".jpg")
        if src and (src.startswith("http") or os.path.isabs(src)) and os.path.exists(dest_p):
            sources[it["id"]] = src
        print("[%2d/%d] %-18s %-12s tries=%-3d %8d  %s"
              % (n, len(todo), it["id"], status, tried, size, src[:60]))
        sys.stdout.flush()
        if status not in ("skip", "reuse"):
            # 1.5 s 看着慢，但 Wikimedia 的 CDN 对连续取图很敏感，
            # 一旦被打到 429，退避要按分钟算，反而更慢。
            time.sleep(1.5)

    print("\n统计:", stat)
    bad = []
    for it in ITEMS:
        p = os.path.join(OUTDIR, it["id"] + ".jpg")
        if not os.path.exists(p):
            bad.append(it["id"] + "(缺)")
        elif Image.open(p).width < MIN_ACCEPT_W:
            bad.append(it["id"] + "(小图)")
    print("缺失/小图:", bad or "无")
    if do_sheet:
        print("拼版缩略图:", build_sheet(SHEET_PATH), SHEET_PATH)
    # 图源记在 scripts/ 下，不放进 public/ —— 那是要随游戏分发的目录，
    # 没必要把一堆外链地址一起发给学生。
    # ⚠️ 必须**合并**而不是覆盖：`--only=` 的局部重取只会填 `sources` 里那几条，
    # 直接写回等于把其余条目的图源记录一并抹掉（实测被这么抹过，只剩 13 条）。
    sp = os.path.join(HERE, "_photo_sources.json")
    old_sources = {}
    if os.path.exists(sp):
        try:
            old_sources = json.load(io.open(sp, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            old_sources = {}
    old_sources.update(sources)
    if old_sources:
        io.open(sp, "w", encoding="utf-8", newline="\n").write(
            json.dumps(old_sources, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
        print("图源记录: %s （本次新增/更新 %d 条，共 %d 条）"
              % (sp, len(sources), len(old_sources)))


if __name__ == "__main__":
    main()
