#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""图源规则的自测：广告位关键词**不能**误杀正常文件名。

用法：python scripts/photo_rules.test.py
（要用带 Pillow 的解释器，因为它会 import fetch_photos）

## 为什么单独写这个

`_is_bad_url()` 里那组"广告位"关键词已经误杀过两次，而且**两次都不报错**：

1. 直接拿整条 URL 做子串匹配时，`BAD_HOST_HINTS` 里的 `"banner"` 命中了
   `Grasslands in Heshigten Banner.jpg` —— 而 **Banner（旗）是内蒙古县级区名的
   正式英译**（Heshigten Banner = 克什克腾旗）。后果是 Commons 上所有关于
   内蒙古"旗"的照片都抓不下来。表现只是 `pick-fail`，
   而 `fetch_one` 的挑定分支用 `except Exception: got = None` 把原因吞了，
   看着像"网络不好"。更隐蔽的是 `rank_candidates()` 也用它，
   自动检索时这些候选是**静默被跳过**的。
2. 改成"片段要以 `/` 开头"之后仍不够：`.../1/1a/Iconic_Mountain.jpg` 里
   第二个 `/` 后面就是 `icon`，照样中招。所以要卡边界（片段后必须是分隔符或结尾）。

结论：这类规则必须**双向**测 —— 既要拦住真广告位，也要放行正常文件名。
只测前者的话，把规则收紧到"什么都不放行"也能全绿。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_photos as F  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")

# (URL, 期望是否判为坏图源, 说明)
CASES = [
    # ---- 必须放行：地名 / 正常文件名里恰好含这些词 ----
    ("https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7f/"
     "Grasslands_in_Heshigten_Banner.jpg/960px-Grasslands_in_Heshigten_Banner.jpg",
     False, "内蒙古的旗（Banner = 旗，克什克腾旗）"),
    ("https://upload.wikimedia.org/wikipedia/commons/7/7f/"
     "Grasslands_in_Heshigten_Banner.jpg",
     False, "同上，原图地址"),
    ("https://upload.wikimedia.org/wikipedia/commons/1/1a/Iconic_Mountain.jpg",
     False, "Iconic 不是 icon"),
    ("https://upload.wikimedia.org/wikipedia/commons/2/2b/Banners_of_Mongolia.jpg",
     False, "地名里的 Banners"),
    ("https://upload.wikimedia.org/wikipedia/commons/3/3c/Logo_Rock.jpg",
     False, "Logo Rock 是个地名"),
    # ---- 必须拦住：真的是图标 / 广告位 ----
    ("https://cdn.example.com/banner/promo.jpg", True, "banner 目录"),
    ("https://cdn.example.com/logo.png", True, "根级 logo"),
    ("https://static.example.com/icon/play.png", True, "icon 目录"),
    ("https://img.example.com/ad_300x250.jpg", True, "ad_ 像素位"),
    ("https://x.com/ads/a.jpg", True, "ads 目录"),
    ("https://x.com/sprites/s.png", True, "雪碧图目录"),
    ("https://x.com/adv/a.jpg", True, "adv 目录"),
    # ---- 其他既有规则不能因为这次改动而失效 ----
    ("https://copyright.bdstatic.com/x.jpg", True, "版权图库 CDN"),
    ("https://x.com/a.jpg?@wm_watermark", True, "带水印参数"),
    ("", True, "空地址"),
    ("not-a-url", True, "不是 URL"),
]


def main():
    bad = []
    for url, expect, why in CASES:
        got = bool(F._is_bad_url(url))
        ok = got == expect
        if not ok:
            bad.append((url, expect, got, why))
        print("%s  判=%-5s 期望=%-5s  %s"
              % ("✔" if ok else "✘", got, expect, why))
    print()
    if bad:
        print("FAILED ✘  断言 %d 项，失败 %d 项" % (len(CASES), len(bad)))
        for url, e, g, why in bad:
            print("  ✘ %s（期望 %s，实得 %s）：%s" % (url[:70], e, g, why))
        return 1
    print("PHOTO RULES PASSED ✔  断言 %d 项，失败 0 项" % len(CASES))
    return 0


if __name__ == "__main__":
    sys.exit(main())
