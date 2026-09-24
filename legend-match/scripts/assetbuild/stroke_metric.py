# -*- coding: utf-8 -*-
"""「墨迹厚度」的唯一度量实现 —— build_assets.py（生成）与 audit_style.py（审计）共用。

为什么必须共用一份：这两边一个负责"把线条补到目标粗细"，一个负责"证明真的补到了"。
各写一份就等于把判据和被执行的东西分开，改了一处没改另一处会**静默**地让审计永远通过
（或永远不通过）—— 这一类"两处口径"是最难发现的假绿。

度量定义（像素级、可复现）：
  厚度 = 3×3 全格（8 邻域）腐蚀到空所需的次数 k，厚度 ≈ 2k+1
  为什么必须是**全格**而不是十字：十字核会把方形孔的四个角"顶住"，让带孔/带角的
  图形多活好几步。实测同一份数据：宽 28 的直条用十字测得 27（对），
  而宽 28 的方框用十字测得 37（错了 10 px，36%）。图例里带孔带角的符号很多
  （等高线是同心环、铁路是色带、管道有法兰），用错核会把"其实已经够粗"的判成"太细"，
  然后继续加粗 —— 所以这个坑是必须堵的。
  偶数宽度会低估 1 px（29 与 28 都返回 27），生成与审计同口径，不影响结论。
"""
import numpy as np

CAP = 400


def erode(m):
    """3×3 全格腐蚀（8 邻域）。"""
    o = m.copy()
    o[1:, :] &= m[:-1, :]
    o[:-1, :] &= m[1:, :]
    o[:, 1:] &= m[:, :-1]
    o[:, :-1] &= m[:, 1:]
    o[1:, 1:] &= m[:-1, :-1]
    o[1:, :-1] &= m[:-1, 1:]
    o[:-1, 1:] &= m[1:, :-1]
    o[:-1, :-1] &= m[1:, 1:]
    o[0, :] = False
    o[-1, :] = False
    o[:, 0] = False
    o[:, -1] = False
    return o


def thickness(mask, cap=CAP):
    m = mask
    k = 0
    while k < cap:
        m = erode(m)
        if not m.any():
            break
        k += 1
    return 2 * k + 1


def measure_ink(rgba, thr=128):
    """返回 (厚度, 长边, 包围盒)。thr 是判定"墨"的 alpha 阈值。"""
    a = np.asarray(rgba)[:, :, 3]
    mask = a > thr
    ys, xs = np.where(mask)
    if len(ys) == 0:
        return 0, 1, (0, 0, 0, 0)
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
    m = mask[y0:y1, x0:x1]
    return thickness(m), max(m.shape), (x0, y0, x1, y1)


def _selftest():
    """自证：已知宽度的图形必须量出已知厚度（判据本身也要先被证明）。

    真宽不由"我打算画多少"给出，而是**从过心扫描线数出来** —— 光栅化会把 25 变成 24，
    拿标称值当真值就会把正确的度量判成错的。
    """
    S = 512
    yy, xx = np.mgrid[0:S, 0:S]
    r = np.hypot(xx - 256.0, yy - 256.0)
    cases = []
    for w in (28, 40, 25, 5):
        half = int(round(w / 2.0))
        bar = np.zeros((S, S), bool)
        bar[256 - half:256 + half, 60:452] = True
        cases.append(("直条 w=%d" % w, bar))
        cases.append(("圆环 w=%d" % w, (r > 200) & (r < 200 + w)))
    ok = True
    for name, m in cases:
        # 横扫线量不出竖着的宽度 ⇒ 横竖两条扫描线都取，最短的一段就是线条宽度
        lines = [m[S // 2, :], m[:, S // 2]]
        runs = []
        for line in lines:
            s = None
            for i, v in enumerate(line):
                if v and s is None:
                    s = i
                elif not v and s is not None:
                    runs.append(i - s); s = None
        real = min(runs)
        t = thickness(m)
        good = abs(t - real) <= 1
        ok &= good
        print("  %-12s 扫描线真宽 %3d -> 实测 %3d  %s" % (name, real, t, "OK" if good else "**不符**"))
    print("  自检：", "通过" if ok else "**失败**")
    return ok


if __name__ == "__main__":
    _selftest()
