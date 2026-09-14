#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
题库自检：questions.json 的结构、维度覆盖与归一化可达性。

用途：每次增删/改题后跑一遍，确保
  1) JSON 结构合法，delta 键都在 dimensions 内、数值在 -2~2；
  2) 五个维度覆盖均衡（每题 2 个维度 ⇒ 每维出现 = 题数×2/5 次）；
  3) 每个维度「各题最大正值之和」与「最大负值绝对值之和」相当 ——
     这两者决定「极端回答能不能跑到 100 或 0」。前端 buildVector 用
     t = clamp(raw / (ceil * 0.62)) 把 raw 归一到 0-100，所以只要
     max正之和 ≥ 0.62 * ceil，正向就能打满；负向同理。
  4) 模拟三种极端作答（每题都选第 1/2/3 项），打印各维得分，肉眼确认
     不会所有人都挤在 50 附近。

用法：
  python scripts/check_questions.py                    # 检查 public/data/questions.json
  python scripts/check_questions.py path/to/questions.json
"""
import json
import sys
from pathlib import Path

DISCOUNT = 0.62  # 与 src/logic.ts 的 buildVector 保持一致


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    qpath = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "public" / "data" / "questions.json"
    lpath = root / "public" / "data" / "landforms.json"

    questions = json.loads(qpath.read_text(encoding="utf-8"))["questions"]
    dims = json.loads(lpath.read_text(encoding="utf-8"))["dimensions"]
    dim_keys = [d["key"] for d in dims]
    dim_name = {d["key"]: d["name"] for d in dims}

    errors: list[str] = []
    print(f"题库：{qpath}")
    print(f"题数：{len(questions)}，维度：{'、'.join(dim_keys)}\n")

    # ---- 1. 结构校验 ----
    for q in questions:
        if not q.get("id") or not q.get("text"):
            errors.append(f"{q.get('id', '?')}: 缺 id 或 text")
        if len(q.get("options", [])) < 2:
            errors.append(f"{q['id']}: 选项少于 2 个")
        for o in q.get("options", []):
            for k, v in o["delta"].items():
                if k not in dim_keys:
                    errors.append(f"{q['id']}: 未知维度键 {k}")
                if not isinstance(v, int) or abs(v) > 2 or v == 0:
                    errors.append(f"{q['id']}: delta 值 {v} 不在 -2~2 且非 0")

    # ---- 2. 覆盖统计 ----
    appear = {k: 0 for k in dim_keys}
    max_pos = {k: 0 for k in dim_keys}
    max_neg = {k: 0 for k in dim_keys}
    ceil = {k: 0 for k in dim_keys}
    for q in questions:
        for k in dim_keys:
            vals = [(o["delta"].get(k, 0)) for o in q["options"]]
            if any(v != 0 for v in vals):
                appear[k] += 1
            max_pos[k] += max(vals)
            max_neg[k] += -min(vals)
            ceil[k] += max(abs(v) for v in vals)

    target = len(questions) * 2 // len(dim_keys)
    print("维度覆盖")
    print(f"{'维度':<10}{'出现':>6}{'目标':>6}{'正极和':>8}{'负极和':>8}{'ceil':>6}{'正可达':>8}{'负可达':>8}")
    for k in dim_keys:
        pos_ok = max_pos[k] >= DISCOUNT * ceil[k]
        neg_ok = max_neg[k] >= DISCOUNT * ceil[k]
        print(
            f"{dim_name[k]:<10}{appear[k]:>6}{target:>6}{max_pos[k]:>8}{max_neg[k]:>8}"
            f"{ceil[k]:>6}{'OK' if pos_ok else 'FAIL':>8}{'OK' if neg_ok else 'FAIL':>8}"
        )
        if appear[k] != target:
            errors.append(f"{dim_name[k]}: 出现 {appear[k]} 次，应为 {target} 次")
        if not pos_ok:
            errors.append(f"{dim_name[k]}: 正向够不到 100（max正和 {max_pos[k]} < {DISCOUNT * ceil[k]:.2f}）")
        if not neg_ok:
            errors.append(f"{dim_name[k]}: 负向够不到 0（max负和 {max_neg[k]} < {DISCOUNT * ceil[k]:.2f}）")

    # ---- 3. 归一化模拟 ----
    print("\n极端作答模拟（每题都选第 N 项）")
    width = max(len(dim_name[k]) for k in dim_keys)
    for idx in range(max(len(q["options"]) for q in questions)):
        raw = {k: 0 for k in dim_keys}
        used = 0
        for q in questions:
            opts = q["options"]
            if idx >= len(opts):
                continue
            used += 1
            for k in dim_keys:
                raw[k] += opts[idx]["delta"].get(k, 0)
        vec = {k: round(50 + 50 * clamp(raw[k] / (ceil[k] * DISCOUNT), -1, 1)) for k in dim_keys}
        line = "  ".join(f"{dim_name[k]:<{width}} {vec[k]:>3}" for k in dim_keys)
        print(f"  全选第 {idx + 1} 项（{used}/{len(questions)} 题）: {line}")

    print()
    if errors:
        print(f"发现 {len(errors)} 个问题：")
        for e in errors:
            print("  ✗ " + e)
        return 1
    print("全部通过 ✓")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
