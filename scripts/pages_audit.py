# -*- coding: utf-8 -*-
"""实测「游戏商城」(云端) 与「游戏中心」(本地) 两个页面各能看到几款游戏。

商城页 = cloudListStoreGames() → /cloud-api/api/v1/store/games → 7070 代理 → 17070 MySQL
游戏中心 = listInstalledGames() → /api/v1/me/games            → 7070 → H2

串行请求，避免并发触发后端限流。
"""
import io
import json
import sys
import urllib.error
import urllib.request

LOCAL = "http://127.0.0.1:7070/api/v1"
PROXY = "http://127.0.0.1:7070/cloud-api/api/v1"
CLOUD = "http://127.0.0.1:17070/api/v1"


def http(method, url, token=None, body=None, timeout=20):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            return r.status, raw
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return -1, repr(e)


def login(base, path="/auth/local/login"):
    st, raw = http("POST", base + path, body={"username": "123456", "password": "123456"})
    if st != 200:
        return None, f"HTTP {st}: {raw[:160]}"
    try:
        obj = json.loads(raw)
    except Exception:  # noqa: BLE001
        return None, f"非 JSON: {raw[:160]}"
    d = obj.get("data", obj)
    tok = d.get("token") or d.get("accessToken")
    return tok, ("ok" if tok else f"无 token 字段，响应键={list(d)[:8]}")


def unwrap(raw):
    try:
        obj = json.loads(raw)
    except Exception:  # noqa: BLE001
        return None
    return obj.get("data", obj)


def codes(rows):
    out = []
    for g in rows or []:
        if not isinstance(g, dict):
            continue
        c = g.get("gameCode") or g.get("code")
        v = g.get("version")
        out.append((c, v))
    return out


def main():
    local_tok, msg1 = login(LOCAL)
    cloud_tok, msg2 = login(CLOUD)
    print(f"本地 7070 登录: {msg1}")
    print(f"云端 17070 登录: {msg2}")
    print()

    print("=" * 78)
    print("① 侧边栏「游戏商城」页看到的内容（前端实际调这个）")
    print("   cloudListStoreGames() → /cloud-api/api/v1/store/games → 7070 转发 → 17070 MySQL")
    st, raw = http("GET", PROXY + "/store/games", token=cloud_tok or local_tok)
    rows = unwrap(raw)
    if isinstance(rows, list):
        cs = codes(rows)
        print(f"   HTTP {st}  共 {len(cs)} 款：")
        for c, v in sorted(cs):
            print(f"      - {c}  v{v}")
    else:
        print(f"   HTTP {st}  响应异常: {raw[:200]}")

    print()
    print("=" * 78)
    print("② 侧边栏「游戏中心」页看到的内容")
    print("   listInstalledGames() → /api/v1/me/games → 7070 → H2 user_game_install")
    st, raw = http("GET", LOCAL + "/me/games", token=local_tok)
    rows = unwrap(raw)
    if isinstance(rows, list):
        cs = codes(rows)
        print(f"   HTTP {st}  共 {len(cs)} 款：")
        for c, v in sorted(cs):
            print(f"      - {c}  v{v}")
    else:
        print(f"   HTTP {st}  响应异常: {raw[:200]}")

    print()
    print("=" * 78)
    print("③ 参考：本地后端的 /store/games（前端商城页已不用它）")
    st, raw = http("GET", LOCAL + "/store/games", token=local_tok)
    rows = unwrap(raw)
    if isinstance(rows, list):
        print(f"   HTTP {st}  共 {len(rows)} 款")
    else:
        print(f"   HTTP {st}  响应异常: {raw[:200]}")


if __name__ == "__main__":
    sys.exit(main())
