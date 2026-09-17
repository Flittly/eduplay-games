#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""binlog 取证：正面回答「数据到底有没有被删过 / 删过什么」。

背景：eduplay 有本地 H2 与云端 MySQL 两套存储，"商城里的游戏少了"这类症状
既可能是数据被删，也可能只是看错了端。本脚本用 MySQL 的 binlog 给出物证。

用法（在仓库根执行）：
    python scripts/binlog_audit.py                  # 全流程：取 binlog → 解码 → 汇总报告
    python scripts/binlog_audit.py --danger-only    # 只列 DROP / TRUNCATE / DELETE
    python scripts/binlog_audit.py --table game_product   # 只看某张表的时间线
    python scripts/binlog_audit.py --keep           # 保留解码后的 .sql（默认保留，便于复查）

输出三部分：
    ① 每个 binlog 的起止时间（能看出"某段时间完全没被写过"）
    ② 所有「库.表」上的 INSERT / UPDATE / DELETE 次数与首末时间
    ③ 危险语句清单（DROP TABLE / DROP DATABASE / TRUNCATE / DELETE FROM）

⚠ 两个必须知道的坑（本脚本已处理，改代码时别退化）：
  1. `### INSERT INTO` / `### UPDATE` / `### DELETE FROM` 这些 ROW 事件行
     **也以 `#` 开头**。若按"跳过所有 `#` 开头的行"来滤注释，会把全部 DML 扔掉、
     只剩下 DDL，于是得出"这库只有建表没有数据变更"的错误结论。
     正确做法：只跳过 `#` 开头**但不是** `###` 开头的行。
  2. 不带库名前缀的 DDL 作用于"最近一次 `use` 的库"，必须跟踪 `use` 才能判对归属。
     否则会把临时库的 `drop database` 误读成云端库的事故。
"""
import argparse
import glob
import io
import os
import re
import shutil
import subprocess
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, ".workbuddy", "tmp", "binlog")

MYSQL_EXE = r"C:/Program Files/MySQL/MySQL Server 8.0/bin/mysql.exe"
MYSQLBINLOG = r"C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqlbinlog.exe"
DB_HOST, DB_PORT, DB_USER, DB_PASS = "127.0.0.1", "3306", "root", "123456"

TS = re.compile(r"^#(\d{2})(\d{2})(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})")
USE = re.compile(r"^use\s+`([^`]+)`")
ROWOP = re.compile(r"^###\s+(INSERT INTO|UPDATE|DELETE FROM)\s+`([^`]+)`\.`([^`]+)`")
STATEMENT = re.compile(
    r"^(use\s+`|create\s+database|drop\s+database|CREATE\s+TABLE|DROP\s+TABLE|"
    r"ALTER\s+TABLE|TRUNCATE|DELETE\s+FROM)", re.I)
DANGER = re.compile(r"drop\s+(table|database)|truncate|^delete\s+from", re.I)


def _mysql(sql):
    out = subprocess.run(
        [MYSQL_EXE, f"-h{DB_HOST}", f"-P{DB_PORT}", f"-u{DB_USER}", f"-p{DB_PASS}",
         "-N", "-B", "-e", sql],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    if out.returncode != 0:
        sys.exit(f"mysql 查询失败：{out.stderr.strip()}")
    return [ln for ln in out.stdout.strip().splitlines() if ln]


def fetch_binlogs():
    """把 datadir 下的 binlog 复制到工作区 —— 直接读 C:\\ProgramData 可能被拦截。"""
    datadir = _mysql("SELECT @@datadir;")[0].strip().replace("\\", "/")
    while "//" in datadir:
        datadir = datadir.replace("//", "/")
    datadir = datadir.rstrip("/")
    names = [ln.split("\t")[0] for ln in _mysql("SHOW BINARY LOGS;")]
    if not names:
        sys.exit("binlog 未开启（SHOW BINARY LOGS 为空），本方法不适用")
    os.makedirs(WORK, exist_ok=True)
    copied = []
    for n in names:
        src = f"{datadir}/{n}"
        dst = os.path.join(WORK, n)
        try:
            shutil.copyfile(src, dst)
            copied.append(dst)
        except OSError as exc:
            print(f"  !! 复制失败 {n}: {exc}")
    print(f"datadir = {datadir}")
    print(f"已复制 {len(copied)}/{len(names)} 个 binlog 到 {os.path.relpath(WORK, ROOT)}")
    return copied


def decode(paths):
    outdir = os.path.join(WORK, "decoded")
    os.makedirs(outdir, exist_ok=True)
    decoded = []
    for p in paths:
        dst = os.path.join(outdir, os.path.basename(p) + ".sql")
        with open(dst, "w", encoding="utf-8", errors="replace") as fh:
            subprocess.run([MYSQLBINLOG, "--base64-output=DECODE-ROWS", "-v", p],
                           stdout=fh, stderr=subprocess.DEVNULL)
        decoded.append(dst)
    return decoded


def analyze(paths, table_filter=None):
    ops = defaultdict(Counter)
    first_seen, last_seen = {}, {}
    danger = []
    timeline = []
    spans = []

    for path in sorted(paths):
        cur = None
        ts = None
        first_ts = last_ts = None
        with io.open(path, encoding="utf-8", errors="replace") as fh:
            for raw in fh:
                line = raw.rstrip("\n")
                m = TS.match(line)
                if m:
                    y, mo, d, h, mi, s = m.groups()
                    ts = f"20{y}-{mo}-{d} {int(h):02d}:{mi}:{s}"
                    first_ts = first_ts or ts
                    last_ts = ts
                    continue
                # 只跳过纯注释；`### ...` 是 ROW 事件，必须保留（见文件头坑 1）
                if (line.startswith("#") and not line.startswith("###")) \
                        or line.startswith("/*") or not line.strip():
                    continue
                mu = USE.match(line)
                if mu:
                    cur = mu.group(1)
                    continue
                mo_ = ROWOP.match(line)
                if mo_:
                    op, db, tbl = mo_.groups()
                    ops[(db, tbl)][op] += 1
                    first_seen.setdefault((db, tbl), ts)
                    last_seen[(db, tbl)] = ts
                    if table_filter and tbl == table_filter:
                        timeline.append((ts, op, db, tbl))
                    continue
                probe = line[4:] if line.startswith("### ") else line
                if STATEMENT.match(probe) and DANGER.search(probe):
                    danger.append((ts, cur, probe[:150]))
        spans.append((os.path.basename(path)[:-4], first_ts, last_ts))

    return ops, first_seen, last_seen, danger, timeline, spans


def main():
    ap = argparse.ArgumentParser(description="binlog 取证")
    ap.add_argument("--danger-only", action="store_true", help="只列危险语句")
    ap.add_argument("--table", help="额外输出该表的完整事件时间线")
    ap.add_argument("--no-fetch", action="store_true", help="跳过复制，直接用已有 binlog")
    args = ap.parse_args()

    if args.no_fetch:
        paths = sorted(glob.glob(os.path.join(WORK, "*-bin.0*")))
        if not paths:
            sys.exit(f"{WORK} 下没有 binlog，请先不带 --no-fetch 跑一次")
    else:
        paths = fetch_binlogs()
    decoded = decode(paths)

    ops, first_seen, last_seen, danger, timeline, spans = analyze(decoded, args.table)

    print()
    print("=" * 96)
    print("① 各 binlog 文件的时间跨度")
    print("=" * 96)
    for name, a, b in spans:
        size = os.path.getsize(os.path.join(WORK, name))
        flag = "   ← 空文件（该时段无任何写入）" if size < 1024 else ""
        print(f"  {name:<34} {a or '(无事件)':<20} → {b or '-':<20}{flag}")

    if not args.danger_only:
        print()
        print("=" * 96)
        print("② 所有「库.表」的写入事件统计")
        print("=" * 96)
        if not ops:
            print("  (binlog 里没有任何 DML/DDL 事件)")
        for (db, tbl), c in sorted(ops.items()):
            detail = "  ".join(f"{k}={v}" for k, v in sorted(c.items()))
            print(f"  {db}.{tbl:<26} {detail:<44} {first_seen[(db, tbl)]} → {last_seen[(db, tbl)]}")

    print()
    print("=" * 96)
    print("③ 危险语句（DROP TABLE / DROP DATABASE / TRUNCATE / DELETE FROM）")
    print("=" * 96)
    if not danger:
        print("  （无）")
    for t, db, s in danger:
        print(f"  [{t}] 库={db}\n      {s}")

    if args.table:
        print()
        print("=" * 96)
        print(f"④ {args.table} 的事件时间线（共 {len(timeline)} 条）")
        print("=" * 96)
        for t, op, db, tbl in timeline:
            print(f"  [{t}] {op:<14} {db}.{tbl}")

    print()
    print(f"解码后的 sql 保留在 {os.path.relpath(os.path.join(WORK, 'decoded'), ROOT)}，可自行复查。")


if __name__ == "__main__":
    main()
