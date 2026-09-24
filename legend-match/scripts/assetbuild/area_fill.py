# -*- coding: utf-8 -*-
"""面状符号重建：把"实心/虚线轮廓 + 净色填充"的面符号从糊掉的裁片里救回来。

为什么必须有这一步（实测的失败长什么样）：
  湖泊 / 时令湖 这两个裁片的源像素只有 26×26 上下。湖面是**浅蓝填充**，与纸底的色距很小，
  Otsu 那步的调色板过滤会把浅蓝当成背景剔掉，剩下的候选色里离得最近的是灰调
  ⇒ **湖面变成一片灰色麻点**（不是"颜色淡"，是"颜色错了"）。
  更要命的是这两条的**唯一区分点**——教材用「实线轮廓 = 常年湖」与「虚线轮廓 = 时令湖」
  把它们分开——在重采样里糊掉了，两条湖变成"两个蓝斑"，配对游戏里直接分不开。

做法（保留"来自真实教材图"的性质，只把线型规范补回去）：
  形状仍取自**真实教材图的轮廓**（binary_fill_holes 得到闭合面），
  线宽、实线/虚线、用色按 drawings.py 里同一套教材规范重建。
"""
import numpy as np
from scipy import ndimage

# 水域色系（与 drawings.py 的 WATER 同源）
WATER = (0x2f, 0x9f, 0xd8)
PALE = (0xc2, 0xe2, 0xf3)          # 水域蓝与白按 3:7 淡化的湖面色


def rebuild(im, line_rgb=WATER, fill_rgb=PALE, width=None, dashes=None,
            size=512, fill_ratio=0.78):
    """返回 (重建后的 RGBA, 说明)。dashes=None 表示实线轮廓。"""
    a = np.asarray(im)[:, :, 3]
    sil = ndimage.binary_fill_holes(a > 128)
    if not sil.any():
        return im, "空"
    if width is None:
        width = int(round(0.063 * size * fill_ratio))    # 与线条族同口径 = 25 px
    h = max(1, width // 2)
    # 轮廓带要**跨在轮廓线上**（外半圈 + 内半圈），所以 alpha 取外扩后的整块；
    # 只取 sil 当 alpha 会把外半圈切掉 ⇒ 轮廓只剩一半宽（实测 25 px 变 12 px）。
    solid_area = ndimage.binary_dilation(sil, iterations=h)
    ring = solid_area & ~ndimage.binary_erosion(sil, iterations=h)
    info = {"w": width}
    if dashes:
        # 按"绕形心的极角"分扇区打虚线 —— 面状符号基本星形凸，这个方法对任意形状都成立，
        # 而且天然沿周长等分，不需要做弧长参数化。
        yy, xx = np.mgrid[0:sil.shape[0], 0:sil.shape[1]]
        cy, cx = ndimage.center_of_mass(sil)
        ang = np.arctan2(yy - cy, xx - cx)
        perim = max(ring.sum() / max(width, 1), 1.0)
        n = int(min(40, max(8, round(perim / float(dashes)))))
        n += n % 2                                   # 取偶，保证虚实段各半
        seg = (((ang + np.pi) / (2 * np.pi) * n).astype(int)) % n
        ring = ring & (seg % 2 == 0)
        info["n"] = n // 2
    # 先整块铺"湖面色"，再把轮廓带盖上去。
    # 不能只给 fill/ring 两处上色：虚线的**空隙**既不属于 fill 也不属于 ring，会留着初始化
    # 的黑色 0,0,0 —— 症状是"虚线一半黑一半蓝"（实测踩过）。
    rgb = np.zeros(sil.shape + (3,), np.float32)
    rgb[solid_area] = fill_rgb
    rgb[ring] = line_rgb
    from PIL import Image
    out = np.concatenate([rgb, (solid_area * 255)[..., None]], axis=2).astype(np.uint8)
    return Image.fromarray(out, "RGBA"), info


def outline_width(rgba, line_rgb=WATER, tol=20, rays=360):
    """量"轮廓带"有多宽 —— 面符号的 alpha 是整块的，只能按**颜色**量。

    为什么用**从形心向外的射线**而不是横竖扫描线：轮廓是闭合环，扫描线在环的顶部
    是**切向**穿过，量出来的"墨迹段"会长得离谱（远大于线宽）；而虚线环还会让扫描线
    正好落在空隙里，量到 0（实测：一旦量到 0/1，闭环修正会把线宽参数放大到 44 万倍）。
    沿射线从外向内找到第一段轮廓色、数它的长度，对切向、对虚线都稳，取所有射线的**中位**。
    """
    a = np.asarray(rgba)
    is_line = ((np.abs(a[:, :, :3].astype(int) - np.array(line_rgb)).sum(axis=2) < tol)
               & (a[:, :, 3] > 128))
    ys, xs = np.where(a[:, :, 3] > 128)
    if len(ys) == 0:
        return 0
    cy, cx = float(ys.mean()), float(xs.mean())
    rmax = int(np.hypot(max(cy - ys.min(), ys.max() - cy),
                        max(cx - xs.min(), xs.max() - cx))) + 2
    runs = []
    for i in range(rays):
        th = 2 * np.pi * i / rays
        dy, dx = np.sin(th), np.cos(th)
        rs, rs_out = np.arange(rmax, 0, -1), None
        yy = np.clip((cy + dy * rs).astype(int), 0, is_line.shape[0] - 1)
        xx = np.clip((cx + dx * rs).astype(int), 0, is_line.shape[1] - 1)
        m = is_line[yy, xx]
        if not m.any():
            continue
        first = int(np.argmax(m))                 # 从外向内遇到的第一个轮廓色像素
        k = first
        while k < len(m) and m[k]:
            k += 1
        runs.append(k - first)                    # 这段连续轮廓色的长度
    return int(np.median(runs)) if runs else 0


def rebuild_to_target(base, target, normalize, size=512, fill_ratio=0.78, **kw):
    """把轮廓宽**闭环**调到 target。

    为什么需要闭环：轮廓带是"跨在轮廓线上"的，外扩会让墨迹包围盒变大，随后的 normalize
    又把它缩回 78% ⇒ 轮廓宽会被缩放比吃掉一截（解析值 25 落到 22 左右）。
    这里从解析值起步，**按颜色实测宽度**修正，最多 4 轮。

    normalize 由调用方传入而不是在本模块复制一份 —— 归一化口径只能有一处。
    """
    w = float(target) * (size * fill_ratio) / (size * fill_ratio - 2.0 * target)
    norm, info, got = base, {}, 0
    for _ in range(4):
        out, info = rebuild(base, width=int(round(max(w, 3))), size=size, fill_ratio=fill_ratio, **kw)
        norm = normalize(out)
        got = outline_width(norm, kw.get("line_rgb", WATER))
        if abs(got - target) <= 2:
            break
        w *= target / max(got, 1)
    info["final_w"] = got
    return norm, info


def _selftest():
    """自证 —— 注意：面符号的 alpha 是**整块**的，不能用 alpha 腐蚀去量线宽。

    所以这里量的是**颜色**：过心的水平扫描线上，最外侧那条"轮廓色"像素带有多宽；
    虚线则数轮廓色像素分成了几个连通块。
    """
    from PIL import Image
    S = 512
    yy, xx = np.mgrid[0:S, 0:S]
    blob = ((xx - 256) ** 2 / 150.0 ** 2 + (yy - 256) ** 2 / 120.0 ** 2) < 1
    src = Image.fromarray(np.concatenate(
        [np.full((S, S, 3), 47, np.uint8), (blob * 255)[..., None]], axis=2).astype(np.uint8), "RGBA")

    def outline_runs(rgba, row=256):
        a = np.asarray(rgba)[row]
        is_line = ((np.abs(a[:, :3].astype(int) - np.array(WATER)).sum(axis=1) < 20)
                   & (a[:, 3] > 128))
        runs, s = [], None
        for i, v in enumerate(is_line):
            if v and s is None:
                s = i
            elif not v and s is not None:
                runs.append(i - s); s = None
        return runs

    solid, _ = rebuild(src, width=25)
    runs = outline_runs(solid)
    w1 = min(runs) if runs else 0
    ok1 = abs(w1 - 25) <= 2
    print("  实线轮廓：要求 25 px -> 扫描线实测 %d  %s" % (w1, "OK" if ok1 else "**不符**"))

    dash, info = rebuild(src, width=25, dashes=62)
    a = np.asarray(dash)
    is_line = ((np.abs(a[:, :, :3].astype(int) - np.array(WATER)).sum(axis=2) < 20)
               & (a[:, :, 3] > 128))
    lab, n = ndimage.label(is_line)
    ok2 = n >= max(4, info["n"] - 1)   # 虚线段数应与切段数吻合
    print("  虚线轮廓：绕形心切 %d 段（应为 %d 段）-> 轮廓色分成 %d 个连通块  %s"
          % (info.get("n", 0) * 2, info.get("n", 0), n, "OK" if ok2 else "**不符**"))
    return ok1 and ok2


if __name__ == "__main__":
    print("area_fill 自检：", "通过" if _selftest() else "**失败**")
