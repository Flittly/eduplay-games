# -*- coding: utf-8 -*-
"""审计 73 张图例素材的「视觉重量」是否统一。

为什么需要这个：v1.1.0 的素材来自三类完全不同的源头 ——
  ① 教材图压缩 JPEG 抠出来的位图（原生 13×21 ~ 143×34 px）
  ② 图标库矢量渲染（mdi 24 单位网格、stroke=2）
  ③ 按教材规范手绘的线状符号
三者在同一张卡上并排出现时，「风格统一」的实质就是 **笔画粗细落在同一个区间**。
凭眼睛看 73 张容易漏，这里把它量出来。

量什么：
  thickness  —— 用 3×3 全格腐蚀反复作用于 alpha>128 的二值图，
                笔画宽 w 的图形腐蚀 k 次后消失，w ≈ 2k+1。这是**像素级实测**，
                不是按图片尺寸猜的。
  rel        —— thickness / 符号长边（归一化后长边恒为 512×0.78≈399 px）
                所以 rel 直接就是「线条相对自身长度有多粗」，可跨素材比较。
  coverage   —— bbox 内墨迹占多少，用来区分「线状符号」和「实心记号」。

输出：按来源分组打印 thickness 的 min/中位/max/σ，并给出线条类素材的离群清单。
"""
import io, json, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from spec import SPEC  # noqa: E402
from stroke_metric import thickness, measure_ink  # noqa: E402

# 本脚本在仓库里住在 legend-match/scripts/assetbuild/，工作时也有一份在 .workbuddy/tmp/iconsets/，
# 两种深度都找得到素材目录。
for _up in ("..", "../..", "../../.."):
    ROOT = os.path.abspath(os.path.join(HERE, *_up.split("/")))
    if os.path.isfile(os.path.join(ROOT, "legend-match", "public", "data", "legends.json")):
        break
else:
    raise SystemExit("找不到 repo 根目录")
PUB = os.path.join(ROOT, "legend-match", "public")
ASSETS = os.path.join(PUB, "assets", "legends")
LEGENDS = os.path.join(PUB, "data", "legends.json")

FILL = 0.78          # build_assets.normalize 的填充比
CANVAS = 512
LONG = CANVAS * FILL  # 399.36

# 面状符号：alpha 是**整块**的（轮廓 + 湖面都算墨），"腐蚀厚度"量到的是整个面块的粗细，
# 跟线条类的笔画宽不是一回事，混进统计里会变成假离群值（实测 时令湖 139）。单列出来。
AREA_SYMBOL = {"湖泊", "时令湖"}


def measure(path):
    """量一张素材。厚度与包围盒都走 **stroke_metric.py 的共享实现**，
    与 build_assets.py 决定"还要不要加粗"时用的是同一份代码。

    为什么不在这里留一份本地副本：生成侧用它决定加粗多少，审计侧用它证明已经够粗。
    两份代码一旦不同步，审计会**静默**地永远通过 —— 历史上就踩过（本地那份用了十字核
    而不是全格核，于是"宽 28 的方框"被量成 37，生成侧就会对着一个已经合格的符号继续加粗）。
    """
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im)[:, :, 3]
    t, long_edge, (x0, y0, x1, y1) = measure_ink(im, 128)
    if t == 0:
        return None
    bw, bh = x1 - x0, y1 - y0
    ink = int((a[y0:y1, x0:x1] > 128).sum())
    soft = float(((a > 8) & (a < 248)).sum()) / max(int((a > 8).sum()), 1)
    return {
        "w": bw, "h": bh, "long": long_edge, "short": min(bw, bh),
        "aspect": long_edge / max(min(bw, bh), 1),
        "cov": ink / float(bw * bh),
        "t": t, "rel": t / LONG, "soft": soft,
    }


def stats(vals):
    v = np.asarray(vals, dtype=float)
    return (v.min(), float(np.median(v)), v.max(), float(v.std()))


def main():
    lm = json.load(io.open(LEGENDS, encoding="utf-8"))
    by_name = {x["name"]: x for x in lm["legends"]}
    rows = []
    for name, src in SPEC.items():
        lg = by_name.get(name)
        if lg is None:
            print("[跳过] legends.json 里没有:", name)
            continue
        p = os.path.join(ASSETS, lg["id"] + ".png")
        if not os.path.isfile(p):
            print("[缺文件]", name, p)
            continue
        m = measure(p)
        m.update(name=name, kind=src.split(":")[0], id=lg["id"])
        rows.append(m)

    print("素材数:", len(rows), " 归一化符号长边:", round(LONG, 1), "px")
    print()
    print("=" * 96)
    print("一、按来源分组：笔画宽度 thickness（512 画布上的像素）")
    print("=" * 96)
    print("%-10s %4s  %-28s %-28s" % ("来源", "n", "thickness min/中位/max/σ", "rel(%) min/中位/max/σ"))
    for kind in ("crop", "icon", "draw", "path"):
        sub = [r for r in rows if r["kind"] == kind and r["name"] not in AREA_SYMBOL]
        if not sub:
            continue
        ts = stats([r["t"] for r in sub])
        rs = stats([r["rel"] * 100 for r in sub])
        print("%-10s %4d  %6.0f %6.0f %6.0f %6.1f    %6.1f %6.1f %6.1f %6.1f" %
              (kind, len(sub), ts[0], ts[1], ts[2], ts[3], rs[0], rs[1], rs[2], rs[3]))

    print()
    print("=" * 96)
    print("二、只看「线条型」素材（rel < 35%，即由笔画而非实心块构成）")
    print("=" * 96)
    lines = [r for r in rows if r["rel"] < 0.35 and r["name"] not in AREA_SYMBOL]
    ts = stats([r["t"] for r in lines])
    print("n = %d   thickness  min %.0f / 中位 %.0f / max %.0f / σ %.1f" % (len(lines), *ts))
    for kind in ("crop", "icon", "draw", "path"):
        sub = [r for r in lines if r["kind"] == kind]
        if sub:
            s = stats([r["t"] for r in sub])
            print("   %-8s n=%2d   min %4.0f / 中位 %4.0f / max %4.0f / σ %4.1f" % (kind, len(sub), *s))
    med = np.median([r["t"] for r in lines])
    out = sorted(lines, key=lambda r: -abs(r["t"] - med))
    print()
    print("偏离中位最多的 10 条（中位=%.0f px）：" % med)
    for r in out[:10]:
        print("   %-14s %-6s t=%3d (%+3.0f)  rel=%4.1f%%  长边 %3d px  cov %4.1f%%  %s" %
              (r["name"], r["kind"], r["t"], r["t"] - med, r["rel"] * 100,
               r["long"], r["cov"] * 100, r["id"]))

    print()
    print("=" * 96)
    print("三、实心记号型（rel ≥ 35%）——本来就不该和线条比粗细，单独列出免得误判")
    print("=" * 96)
    for r in sorted([x for x in rows if x["rel"] >= 0.35], key=lambda x: x["rel"]):
        print("   %-14s %-6s t=%3d  rel=%5.1f%%  cov %5.1f%%  %s" %
              (r["name"], r["kind"], r["t"], r["rel"] * 100, r["cov"] * 100, r["id"]))

    print()
    print("=" * 96)
    print("四、归一化是否真的生效：符号长边应恒为 %d px" % round(LONG))
    print("=" * 96)
    ls = [r["long"] for r in rows]
    print("长边 min %d / 中位 %d / max %d   （差异来自 alpha 阈值边缘 1~2 px，属正常）"
          % (min(ls), int(np.median(ls)), max(ls)))

    print()
    print("=" * 96)
    print("六、逐条清单（按 rel 升序）—— 用 cov 区分「线条/轮廓型」与「实心型」")
    print("    线条型判据：墨迹只占 bbox 的 < 35%，说明是笔画而非实心块，其 thickness 即笔画宽")
    print("=" * 96)
    print("%-14s %-6s %4s %4s %7s %7s %7s  %s" %
          ("图例", "来源", "长边", "厚", "rel%", "cov%", "soft", "判定"))
    for r in sorted(rows, key=lambda x: x["rel"]):
        tag = "面状（整块 alpha）" if r["name"] in AREA_SYMBOL else ("线条型" if r["cov"] < 0.35 else "实心型")
        print("%-14s %-6s %4d %4d %7.1f %7.1f %7.2f  %s" %
              (r["name"], r["kind"], r["long"], r["t"], r["rel"] * 100,
               r["cov"] * 100, r["soft"], tag))

    print()
    print("=" * 96)
    print("七、按 cov 分类后的笔画宽分布（这才是可比的同类项）")
    print("=" * 96)
    for tag, pred in (("线条/轮廓型 cov<35%", lambda r: r["cov"] < 0.35),
                      ("实心型 cov>=35%", lambda r: r["cov"] >= 0.35)):
        sub = [r for r in rows if pred(r) and r["name"] not in AREA_SYMBOL]
        if not sub:
            continue
        rs = stats([r["rel"] * 100 for r in sub])
        ts = stats([r["t"] for r in sub])
        print("%-20s n=%2d  thickness %4.0f/%4.0f/%4.0f  rel%% %5.1f/%5.1f/%5.1f" %
              (tag, len(sub), ts[0], ts[1], ts[2], rs[0], rs[1], rs[2]))
        for kind in ("crop", "icon", "draw", "path"):
            s2 = [r for r in sub if r["kind"] == kind]
            if s2:
                v = stats([r["rel"] * 100 for r in s2])
                t2 = stats([r["t"] for r in s2])
                print("      %-6s n=%2d  thickness %4.0f/%4.0f/%4.0f  rel%% %5.1f/%5.1f/%5.1f" %
                      (kind, len(s2), t2[0], t2[1], t2[2], v[0], v[1], v[2]))

    print()
    print("五、边缘柔和度 soft（0=硬边，1=全灰阶过渡）：")
    for kind in ("crop", "icon", "draw", "path"):
        sub = [r["soft"] for r in rows if r["kind"] == kind]
        if sub:
            s = stats(sub)
            print("   %-8s  min %.3f / 中位 %.3f / max %.3f / σ %.3f" % (kind, *s))

    return rows


if __name__ == "__main__":
    main()
