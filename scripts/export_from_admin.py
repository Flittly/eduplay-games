#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从**管理端**导出一个已上架游戏的插件包（`-tagged.zip`），用于发给同事 / 异地安装。

为什么要有这个脚本
------------------
管理端（admin-frontend）里的「导出 zip」走的是
`GET /api/v1/admin/games/{gameCode}/package/export`：服务端读**入库包里
`ORDER BY version DESC` 选出的那一个**，把商品的标签（`game_product_tag`）写进
`manifest.json` 的 `tags` 字段，再以 `{gameCode}-{版本}-tagged.zip` 的名字下发。

它和本地 `npm run build` 出来的 zip **不是同一份字节**：条目集合一样，
只有 `manifest.json` 不同（多了 `tags`）。所以：

- 要"给学生/同事的那个包" → 用本脚本从管理端导出；
- 要"上架用的那个包" → 用 `.workbuddy/tmp/publish_<name>.py`。

用法
----
    python scripts/export_from_admin.py geo_gomoku
    python scripts/export_from_admin.py geo_gomoku --host 7070
    python scripts/export_from_admin.py geo_gomoku earth_globe --out E:/tmp/exports
    python scripts/export_from_admin.py geo_gomoku --local .workbuddy/tmp/zips/geo_gomoku-1.2.1.zip

`--local` 会拿本地入库包逐条对账，**断言"除了 manifest.json 之外全部逐字节相同"**
—— 这是"云端/管理端那份没被改过"最直接的证据。

⚠ 两个坑（2026-09-28 实测）
1. `Authorization` 头必须是 `Bearer <token>`，**少前缀后端不报鉴权错、直接 400**。
2. 管理端前端（admin-frontend）的 vite proxy 指向 **17070**（admin-backend / MySQL），
   不是本地 7070（backend / H2）。要哪一端就显式 `--host`。

⚠ **导出包的字节每次都不一样**（条目时间戳 = 导出那一刻；间隔 3 秒导两次 sha256 就不同，
但包内每个条目的内容逐字节相同）⇒ **别拿导出包的 sha256 当"这一版"的指纹**。
要对账就对**条目内容**（`--local` 就是干这个的），或者对入库包的 sha256。
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import zipfile

DEFAULT_HOST = "17070"          # admin-frontend 的 proxy target
ADMIN_USER = "admin"
ADMIN_PASS = "admin123"


def _request(method: str, url: str, token: str | None = None, body=None):
    """返回 (响应体 bytes, 响应头 dict)。

    ⚠ 不要把 `urlopen` 的响应对象 return 出去 —— 它是在 `with` 里打开的，
    出了 with 就被关掉，外面再 `.read()` 会报 `I/O operation on closed file`。
    """
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        # ⚠ 必须带 "Bearer " 前缀，否则 400（不是 401）
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read(), dict(resp.headers)


def admin_login(base: str) -> str:
    raw, _ = _request("POST", f"{base}/admin/login",
                      body={"username": ADMIN_USER, "password": ADMIN_PASS})
    payload = json.loads(raw)
    if not payload.get("success", True) or not (payload.get("data") or {}).get("token"):
        raise SystemExit(f"管理端登录失败: {payload}")
    return payload["data"]["token"]


def find_game(base: str, token: str, code: str) -> dict:
    raw, _ = _request("GET", f"{base}/admin/games", token)
    listing = json.loads(raw).get("data") or []
    hit = next((g for g in listing if g.get("gameCode") == code), None)
    if hit is None:
        raise SystemExit(f"管理端没有这个游戏: {code}（先上架再来导出）")
    return hit


def export_package(base: str, token: str, code: str, out_dir: str) -> str:
    os.makedirs(out_dir, exist_ok=True)
    blob, headers = _request("GET", f"{base}/admin/games/{code}/package/export", token)
    disp = headers.get("Content-Disposition", "")
    m = re.search(r"filename\*?=(?:UTF-8''|)?\"?([^\";]+)", disp)
    name = urllib.parse.unquote(m.group(1)) if m else f"{code}-tagged.zip"
    path = os.path.join(out_dir, name)
    with open(path, "wb") as f:
        f.write(blob)
    return path


def reconcile(exported: str, local: str) -> None:
    """断言导出包与本地入库包【只有 manifest.json 不同】。"""
    with zipfile.ZipFile(exported) as ze, zipfile.ZipFile(local) as zl:
        le, ll = ze.namelist(), zl.namelist()
        only_e = [n for n in le if n not in ll]
        only_l = [n for n in ll if n not in le]
        assert not only_e and not only_l, (
            f"条目集合不一致：仅管理端有 {only_e}，仅本地有 {only_l}")
        diff = [n for n in le if ze.read(n) != zl.read(n)]
        assert diff == ["manifest.json"], (
            f"除了 manifest.json 之外还有差异: {diff} —— 管理端那份被改过？")
    print(f"    对账 OK：{len(le) - 1} 个文件逐字节相同，只有 manifest.json 多了 tags")


def main() -> int:
    ap = argparse.ArgumentParser(description="从管理端导出已上架游戏的插件包")
    ap.add_argument("codes", nargs="+", help="gameCode，可给多个")
    ap.add_argument("--host", default=DEFAULT_HOST, help=f"后端端口（默认 {DEFAULT_HOST}）")
    ap.add_argument("--out", default=None, help="输出目录（默认 .workbuddy/tmp/exports）")
    ap.add_argument("--local", default=None, help="本地入库包路径，给了就逐字节对账")
    args = ap.parse_args()

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = args.out or os.path.join(root, ".workbuddy", "tmp", "exports")
    base = f"http://127.0.0.1:{args.host}/api/v1"

    token = admin_login(base)
    print(f"[管理端 {args.host}] 登录 OK")

    rc = 0
    for code in args.codes:
        try:
            game = find_game(base, token, code)
            print(f"\n=== {code} ===")
            print(f"    id={game.get('id')} name={game.get('name')} "
                  f"version={game.get('version')} status={game.get('status')}")

            path = export_package(base, token, code, out_dir)
            raw = open(path, "rb").read()
            print(f"    已下载 → {path}")
            print(f"    {len(raw)} 字节  sha256={hashlib.sha256(raw).hexdigest()}")

            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                bad = z.testzip()
                assert bad is None, f"zip 损坏于 {bad}"
                man = json.loads(z.read("manifest.json"))
                print(f"    条目 {len(z.namelist())} 个；manifest.version={man.get('version')} "
                      f"requiresRoster={man.get('requiresRoster')} tags={man.get('tags')}")
                assert man.get("version"), "manifest 里没有 version"

            if args.local:
                reconcile(path, args.local)
        except AssertionError as e:
            rc = 1
            print(f"    ✗ 对账失败: {e}")
        except Exception as e:                       # noqa: BLE001
            rc = 1
            print(f"    ✗ {type(e).__name__}: {e}")

    return rc


if __name__ == "__main__":
    sys.exit(main())
