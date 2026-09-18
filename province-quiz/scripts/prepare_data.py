#!/usr/bin/env python3
"""生成省级识别游戏（province_quiz）的省界数据。

数据来源：`province-puzzle/src/data/province.json`（同源、同投影、同尺度），
本游戏只需要去掉右下角南海小地图（`inset`）字段。

⚠️ 这个脚本以前只是个 29 行的「拷贝器」，没有自检 —— 于是 province-puzzle
   在 v1.0.0 把港澳修成细粒度之后，**这里一直没重跑**，用户看到的还是
   "港澳是两个实心方块"。同源数据的派生副本必须能被一条命令重新生成 + 自我校验，
   否则它会静默地停留在旧版本上（见 skill `geo-boundary-fidelity` §1.1）。

用法:
  python prepare_data.py            # 生成 + 自检
  python prepare_data.py --check    # 只读：比对现有产物是否与源一致、几何是否达标
"""

import argparse
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
GAME_DIR = HERE.parent
REPO = GAME_DIR.parent

SOURCE = REPO / "province-puzzle" / "src" / "data" / "province.json"
OUT_DIR = GAME_DIR / "src" / "data"
OUT_PATH = OUT_DIR / "provinces.json"

# 写进产物里的 `version` 字段，取自本游戏的 package.json —— **单一真源，不手工同步**。
# 它不代表数据内容、只标"这份数据是哪一版游戏生成的"；数值与构建产物里的 `version:`
# 一致，所以打包自检可以拿它一条断言同时守住"数据新鲜"与"构建新鲜"。
#
# 反面教材：province-puzzle 那条注释里记着的 `"version": "0.1.0"` 从 0.1.0 一路滞后到
# 0.3.7 都没人发现 —— 出处标记一旦说假话就比没有更糟。
GAME_VERSION = json.loads((GAME_DIR / "package.json").read_text(encoding="utf-8"))["version"]

# 港澳的几何下限（同源数据在 province-puzzle 侧已经达标，这里只是**防止回退**）。
#
# 判据用「环里有几个**不同**坐标」而不是「形状好不好看」：
# 旧产物里澳门的 d 是 `M727,740L727,740L727,740L727,740Z` —— 8 个顶点只有 2 个不同
# 坐标、路径长度 0，整个行政区塌成一个点。这个量能把"该调容差"和"该放精度"分开。
FINE_GEOM_MIN = {
    "810000": {"rings": 30, "verts": 600, "uniq": 200},  # 香港特别行政区
    "820000": {"rings": 3, "verts": 60, "uniq": 20},     # 澳门特别行政区
}

# 真机画布（province-quiz/src/styles.css）—— 用来打印像素账，只读不参与计算。
#   .silhouette-wrap width:min(540px,100%) padding:10px border:4px ⇒ svg 可用宽 512
#   .silhouette width:100%; max-height:300px
CANVAS_W, CANVAS_H = 512.0, 300.0
BASE_STROKE = 2.0  # .silhouette-path 的 stroke-width（viewBox 单位）


def path_geom(d: str) -> dict:
    """尺度无关的几何量：环数 / 顶点数 / 最大环的不同坐标数 / 退化环数。"""
    rings = [r for r in str(d).split("M") if r.strip()]
    verts = 0
    max_uniq = 0
    degenerate = 0
    for ring in rings:
        pts = [s.strip() for s in ring.replace("Z", "").replace("z", "").split("L") if s.strip()]
        verts += len(pts)
        uniq = len(set(pts))
        max_uniq = max(max_uniq, uniq)
        if uniq <= 1:
            degenerate += 1
    return {"rings": len(rings), "verts": verts, "uniq": max_uniq, "degenerate": degenerate}


def self_check(payload: dict, verbose: bool = True) -> list:
    """返回失败信息列表；空列表 = 全过。"""
    fails = []
    feats = {f["id"]: f for f in payload["features"]}

    if len(feats) != 34:
        fails.append(f"行政区数量应为 34，实际 {len(feats)}")

    # 与源逐字节比对 —— 「几何必须一致」是这层派生关系的唯一契约
    src = json.loads(SOURCE.read_text(encoding="utf-8"))
    src_feats = {f["id"]: f for f in src["features"]}
    same = [i for i in src_feats if i in feats and feats[i]["d"] == src_feats[i]["d"]]
    diff = [i for i in src_feats if i in feats and feats[i]["d"] != src_feats[i]["d"]]
    if diff:
        fails.append(f"与 {SOURCE.name} 的 d 不一致：{[(i, feats[i]['name']) for i in diff]}")
    if verbose:
        print(f"  与 province-puzzle 的 d 逐字节相同：{len(same)} / {len(src_feats)}"
              + (f" —— 不同：{diff}" if diff else " ✔"))

    for pid, need in FINE_GEOM_MIN.items():
        f = feats.get(pid)
        if f is None:
            fails.append(f"{pid} 缺失")
            continue
        g = path_geom(f["d"])
        short = []
        if g["rings"] < need["rings"]:
            short.append(f"环 {g['rings']}<{need['rings']}")
        if g["verts"] < need["verts"]:
            short.append(f"顶点 {g['verts']}<{need['verts']}")
        if g["uniq"] < need["uniq"]:
            short.append(f"最大环不同坐标 {g['uniq']}<{need['uniq']}")
        if g["degenerate"]:
            short.append(f"退化环 {g['degenerate']} 个")
        if short:
            fails.append(f"{f['name']} 几何回退：{'，'.join(short)}")
        elif verbose:
            print(f"  {f['name']}：环={g['rings']} 顶点={g['verts']} "
                  f"最大环不同坐标={g['uniq']} 退化环=0 ✔")

    # 取景与描边的像素账：让"小要素的描边相对形状过粗"这件事有数字可看
    #
    # ⚠ 这里算的是**旧渲染公式**（+12 常数边距 + 随缩放走的单位描边），仅作"修之前长什么样"
    #   的对照。修复后的数字（含 non-scaling-stroke）归 `npm run test:data` 里的
    #   `scripts/tiny.test.cjs` 断言负责 —— 两处各算一遍必然会漂，所以这里只保留旧公式。
    if verbose:
        print("  真机像素账【旧渲染公式，仅作对照】：")
        for pid in ("820000", "810000", "310000", "110000"):
            f = feats.get(pid)
            if not f:
                continue
            x0, y0, x1, y1 = f["bbox"]
            w0, h0 = x1 - x0, y1 - y0
            pad = max(w0, h0) * 0.08 + 12
            k = min(CANVAS_W / (w0 + pad * 2), CANVAS_H / (h0 + pad * 2))
            print(f"    {f['name']:12s} bbox {w0:6.2f}×{h0:6.2f} 取景 {w0 + pad * 2:6.2f}×{h0 + pad * 2:6.2f} "
                  f"⇒ 形状 {w0 * k:5.1f}×{h0 * k:5.1f} px，描边 {BASE_STROKE * k:5.1f} px "
                  f"= 形状短边的 {BASE_STROKE * k / min(w0 * k, h0 * k) * 100:5.1f}%")
    return fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只读校验，不写文件")
    args = ap.parse_args()

    payload = json.loads(SOURCE.read_text(encoding="utf-8"))
    payload.pop("inset", None)
    payload["version"] = GAME_VERSION

    if args.check:
        current = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        ok = current == payload
        print(f"  {OUT_PATH.name} 与重新生成的结果一致：{'✔' if ok else '✘ 需要重新生成'}")
        # ⚠ 校验对象是**磁盘上那份**（current），不是刚构造出来的 payload。
        # 拿 payload 去跟源比恒等于 34/34，等于什么都没查 —— 这个脚本存在的意义
        # 恰恰是发现"派生副本停留在了旧版本上"。
        fails = self_check(current)
        if fails or not ok:
            print("  ✘ 失败：")
            for m in fails:
                print(f"     - {m}")
            sys.exit(1)
        print("  ALL PASSED ✔")
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"wrote {OUT_PATH}")
    print(f"  features: {len(payload['features'])}   version: {GAME_VERSION}   "
          f"size: {OUT_PATH.stat().st_size / 1024:.1f} KB")
    fails = self_check(payload)
    if fails:
        print("  ✘ 自检失败：")
        for m in fails:
            print(f"     - {m}")
        sys.exit(1)
    print("  自检通过 ✔")


if __name__ == "__main__":
    main()
