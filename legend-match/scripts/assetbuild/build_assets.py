# -*- coding: utf-8 -*-
"""把三类来源统一成同一规格的卡片素材（512x512 透明底 PNG）。

统一口径（这是"风格统一"真正落地的地方）：
  ① 先各自拿到 RGBA 位图；
  ② **按 alpha 紧裁到墨迹**，去掉各家不同的留白；
  ③ 再把最长边统一放到画布的 78%，居中 —— 不论来源是抠图、图标还是绘制，
     同一图例在卡片上占的比例完全一致。

来源：
  crop  教材图抠图（第 111 项产出，已做过 Otsu 重建）
  icon  开放授权图标库（maki CC0 / mdi Apache-2.0 / game-icons CC-BY-3.0）
  draw  按教材规范绘制的线状符号
  path  粗箭头 + 真实图标徽标
"""
import io, json, os, subprocess, sys
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from spec import SPEC, CAT_COLOR, CAT_OF, COLOR_OVERRIDE, icon_body          # noqa: E402
from drawings import DRAW, PATHY, PATH_ARROW                 # noqa: E402
from stroke_metric import measure_ink                        # noqa: E402
from area_fill import rebuild_to_target                      # noqa: E402

LM = r"E:\Self\workspace\eduplay-games\legend-match"
CROPS = os.path.join(HERE, "crops_out")
NODE = "C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
OUT_SIZE = 512
FILL = 0.78

# ---------------------------------------------------------------- 线条粗细重建
# 为什么要重建（这是 v1.1.0 里"粗糙"两个字的真正来源）：
#   源图是 1920×1080 的微信压缩图，整页 12 个面板，每个符号列只有 357 px 宽。实测
#   公路/国界/未定国界/省界/航海线 在源图里**连抗锯齿才 4~5 px 高**（裁片 119×5），
#   铁路/高速铁路/高速公路 6~7 px、洲界 10 px、水库 21 px。而这些符号在卡片上要放到
#   62~94 px 宽 ⇒ 按原样降采样后线条只剩 0.7~1.4 px，屏幕上就是一根近乎看不见的发丝
#   （实测：512 画布上厚度只有 5 px = 长边的 1.3%）。
# 统一口径：教材原图里线条占符号长度的 4.2%，本套「手绘线状符号」实测 6.3%
#   （= drawings.py 声明的 5.5% 画布线宽换到符号长边上的值）。于是把**线条型**抠图
#   统一重建到 6.3% —— 与手绘组同口径，也保证卡片上看得清。
LINE_TARGET = 0.063
# 点阵/齿状符号单列更低的目标：加太粗会把沙点连成网格、把垛口糊成一条粗带。
#   沙漠：沙点源图间距 ≈10 px，归一化后 ≈30 px；笔画超过 25 px 就开始连片。
#   长城：垛口齿距归一化后 ≈39 px，笔画超过 19 px 上下齿就并到一起。
TARGET_OVERRIDE = {"沙漠": 0.040, "长城": 0.040}
R_MAX = 24.0        # 重建半径上限，防止极端参数把符号糊掉

# 面状符号（湖泊 / 时令湖）走另一条路：形状取真实教材轮廓，线型与用色按教材规范重建。
# 为什么不能只靠抠图：这两条的源像素只有 26×26 上下，湖面是**浅蓝填充**（与纸底色距极小），
# Otsu 那步的调色板过滤会把浅蓝当成背景剔掉、剩下的灰调离得最近 ⇒ 湖面变成一片灰色麻点；
# 更要命的是它们的**唯一区分点**（教材用「实线轮廓 = 常年湖」「虚线轮廓 = 时令湖」）
# 在重采样里糊掉了，两条湖会变成"两个蓝斑"，在配对游戏里根本分不开。
# 值 = 虚线周期（虚段+实段 ≈ 多少 px）；None = 实线轮廓。
AREA_SYMBOL = {"湖泊": None, "时令湖": 62}


def _measure(im):
    """按 audit_style.py 同口径量 (厚度, 长边) —— 实现住在 stroke_metric.py，两边共用一份。"""
    t, L, _ = measure_ink(im, 128)
    return t, L


def _measure(im):
    """按 audit_style.py 同口径量 (厚度, 长边) —— 实现住在 stroke_metric.py，两边共用一份。"""
    t, L, _ = measure_ink(im, 128)
    return t, L


def _dilate(base, r):
    if r <= 0:
        return base
    al = base.getchannel("A").filter(ImageFilter.MaxFilter(int(2 * r) + 1))
    out = base.copy()
    out.putalpha(al)
    return out


def solidify(im, target_rel, size=OUT_SIZE):
    """把细到看不见的线条按目标粗细重建出来（只对 alpha 做膨胀，不动颜色）。

    为什么用「膨胀 alpha」而不是"调低阈值重算 alpha"：后者要重新估背景色，而这些裁片是
    **紧贴线条**裁的（119×5 里上下就是线的抗锯齿边），四角采不到纸底，背景一估错整张就废。
    膨胀只依赖已经定好的 alpha，改动面最小，也不会改变源图本身的用色。

    为什么半径要**二分**：厚度对半径单调递增，但两个地方是非线性的 ——
      ① 这些线条的 alpha 峰值普遍不到 255（源图压得发虚），>128 的有效宽度不按线性走；
      ② 膨胀后长边变长，normalize 会再缩回去，缩放比随半径变。
    一次性解析解会系统性偏细或偏粗（实测 水库 11 -> 35，过了 1.4 倍）。
    改成在整数半径上二分"能达到目标的最小半径"，判据与 audit_style.py 完全同口径。
    """
    base = normalize(im)
    if target_rel is None:
        return base, None
    T = target_rel * size * FILL
    t0, L0 = _measure(base)
    if t0 >= 0.95 * T:                       # 本来就够粗，不动
        return base, {"r": 0, "t0": t0, "t": t0, "L": L0, "T": T}
    r_hi = int(R_MAX)
    t_hi, L_hi = _measure(normalize(_dilate(base, r_hi)))
    if t_hi < 0.95 * T:                      # 上限也够不着：用最大半径，如实报告
        return normalize(_dilate(base, r_hi)), {"r": r_hi, "t0": t0, "t": t_hi, "L": L_hi, "T": T}
    lo, hi = 0, r_hi
    while hi - lo > 1:
        mid = (lo + hi) // 2
        t, L = _measure(normalize(_dilate(base, mid)))
        if t >= 0.95 * T:
            hi, t_hi, L_hi = mid, t, L
        else:
            lo = mid
    return normalize(_dilate(base, hi)), {"r": hi, "t0": t0, "t": t_hi, "L": L_hi, "T": T}


# ---------------------------------------------------------------- SVG 生成
def svg_for_icon(setname, iname, color):
    body, w, h = icon_body(setname, iname)
    body = body.replace('currentColor', color)
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s" width="%s" height="%s" '
            'fill="%s" color="%s"><g fill="%s" color="%s">%s</g></svg>'
            % (w, h, w, h, color, color, color, color, body))


def svg_for_marked(key, setname, iname, color):
    """粗箭头 + 图标徽标（台风/寒潮/沙尘暴 三个成一家）。"""
    body, w, h = icon_body(setname, iname)
    body = body.replace('currentColor', color)
    arrow_d = PATH_ARROW[key]
    # 徽标单独给一个 28x28 的小视窗，放在箭头右上角
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">'
            '<path d="%s" fill="none" stroke="%s" stroke-width="7" stroke-linecap="round"/>'
            '<g transform="translate(44 2) scale(0.62)">'
            '<svg x="0" y="0" width="%s" height="%s" viewBox="0 0 %s %s" '
            'fill="%s" color="%s">%s</svg></g>'
            '</svg>' % (arrow_d, color, w, h, w, h, color, color, body))


def svg_for_draw(key):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">'
            '%s</svg>' % DRAW[key])


# ---------------------------------------------------------------- 渲染
def rasterize_batch(items):
    """items: [(key, svg)] -> {key: PIL RGBA}"""
    if not items:
        return {}
    man = os.path.join(HERE, "_svg_manifest.json")
    json.dump([{"key": k, "svg": s} for k, s in items], io.open(man, "w", encoding="utf-8"))
    out_dir = os.path.join(HERE, "_svg_png")
    os.makedirs(out_dir, exist_ok=True)
    js = os.path.join(HERE, "_render.cjs")
    io.open(js, "w", encoding="utf-8").write("""
const fs=require('fs'),path=require('path');
const {Resvg}=require('@resvg/resvg-js');
const items=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const out=process.argv[3];
for(const it of items){
  const r=new Resvg(it.svg,{fitTo:{mode:'width',value:%d},background:'rgba(0,0,0,0)'});
  fs.writeFileSync(path.join(out,it.key+'.png'), r.render().asPng());
}
console.log('rendered '+items.length);
""" % OUT_SIZE)
    env = dict(os.environ)
    # @resvg/resvg-js 装在 .workbuddy/tmp/iconsets/node_modules 下；
    # 仓库里那份脚本原地跑时 HERE 不是它的祖先，靠 NODE_PATH 指过去。
    for up in ("", "..", "../..", "../../.."):
        c = os.path.abspath(os.path.join(HERE, *[x for x in up.split("/") if x]))
        for base in (c, os.path.join(c, ".workbuddy", "tmp", "iconsets")):
            if os.path.isdir(os.path.join(base, "node_modules", "@resvg")):
                env["NODE_PATH"] = os.path.join(base, "node_modules")
                break
        if "NODE_PATH" in env:
            break
    res = subprocess.run([NODE, js, man, out_dir], cwd=HERE, capture_output=True, text=True, env=env)
    if res.returncode != 0:
        raise RuntimeError(res.stderr[-2000:])
    out = {}
    for k, _ in items:
        p = os.path.join(out_dir, k + ".png")
        out[k] = Image.open(p).convert("RGBA")
    return out


# ---------------------------------------------------------------- 归一化
def normalize(im, size=OUT_SIZE, fill=FILL):
    a = np.asarray(im)[:, :, 3]
    ys, xs = np.where(a > 8)
    if len(ys) == 0:
        raise RuntimeError("空素材")
    im = im.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sc = size * fill / max(im.width, im.height)
    r = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)
    canvas.paste(r, ((size - r.width) // 2, (size - r.height) // 2), r)
    return canvas


def main():
    lm = json.load(io.open(os.path.join(LM, "public/data/legends.json"), encoding="utf-8"))
    legends = lm["legends"]
    by_name = {x["name"]: x for x in legends}

    # 1) 收集需要渲染的 SVG
    items, plan = [], []
    for name, src in SPEC.items():
        it = by_name[name]
        cat = CAT_OF[it["category"]]
        color = COLOR_OVERRIDE.get(name, CAT_COLOR[cat])
        kind = src.split(":", 1)[0]
        if kind == "crop":
            plan.append((name, it["id"], ("file", src.split(":", 1)[1]), cat)); continue
        key = "k%02d" % len(items)
        if kind == "icon":
            _, setn, iname = src.split(":", 2)
            items.append((key, svg_for_icon(setn, iname, color)))
        elif kind == "draw":
            items.append((key, svg_for_draw(src.split(":", 1)[1])))
        elif kind == "path":
            icon_id, pcolor = PATHY[src.split(":", 1)[1]]
            setn, iname = icon_id.split(":", 1)
            items.append((key, svg_for_marked(src.split(":", 1)[1], setn, iname, pcolor)))
        else:
            raise ValueError(src)
        plan.append((name, it["id"], ("svg", key), cat))

    rendered = rasterize_batch(items)

    # 2) 归一化输出
    out_dir = os.path.join(LM, "public/assets/legends")
    os.makedirs(out_dir, exist_ok=True)
    manifest = []
    rebuilt = []
    areas = []
    for name, lid, how, cat in plan:
        if how[0] == "file":
            im = Image.open(os.path.join(CROPS, how[1])).convert("RGBA")
            if name in AREA_SYMBOL:
                base = normalize(im)
                norm, info = rebuild_to_target(base, LINE_TARGET * OUT_SIZE * FILL, normalize,
                                               size=OUT_SIZE, fill_ratio=FILL,
                                               dashes=AREA_SYMBOL[name])
                areas.append((name, info))
            else:
                norm, hist = solidify(im, TARGET_OVERRIDE.get(name, LINE_TARGET))
                if hist is not None:
                    rebuilt.append((name, hist))
        else:
            norm = normalize(rendered[how[1]])
        fn = "%s.png" % lid
        norm.save(os.path.join(out_dir, fn))
        manifest.append({"name": name, "id": lid, "file": fn, "cat": cat})

    print("输出 %d 张 -> %s" % (len(manifest), out_dir))
    print()
    T = LINE_TARGET * OUT_SIZE * FILL
    print("线条粗细重建（目标 = 长边的 %.1f%% = %.1f px @512）"
          % (LINE_TARGET * 100, LINE_TARGET * OUT_SIZE * FILL))
    print("  %-16s %6s %6s %8s %6s  %s" % ("图例", "原厚", "半径", "重建后", "长边", "判据"))
    notouch = []
    for name, h in rebuilt:
        if h is None:
            continue
        if h["r"] == 0:
            notouch.append(name)
            continue
        ratio = h["t"] / max(h["L"], 1) * 100
        print("  %-16s %6d %6d %8d %6d  %s"
              % (name, h["t0"], h["r"], h["t"], h["L"],
                 "达标（%.1f%%）" % ratio if h["t"] >= 0.95 * h["T"] else "用最大半径，实得 %.1f%%" % ratio))
    print("  未重建（本来就够粗）：", ", ".join(notouch) or "无")
    print()
    print("面状符号重建（形状取教材轮廓，线型按教材规范：实线 / 虚线）：")
    for name, info in areas:
        print("  %-10s %s  轮廓宽 %.0f px（参数 width=%d）"
              % (name, "虚线轮廓，约 %d 段" % info["n"] if info.get("n") else "实线轮廓",
                 info["final_w"], info["w"]))
    json.dump(manifest, io.open(os.path.join(HERE, "assets_manifest.json"), "w"),
              ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
