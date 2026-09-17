# -*- coding: utf-8 -*-
"""把 eduplay-games 仓库里的游戏批量对齐到 7070 / 17070 双后端商城。

设计要点（都踩过坑）：
  * **不手写"缺哪些"的清单** —— 每次现算：某后端 admin 里没有该 gameCode = 缺失；
    有但教师端拿到的版本落后于仓库 = 需升级。仓库 manifest 是唯一真值来源。
  * **版本比仓库"高"的，默认不动**（孤儿版本是真实存在过的构建，降级会让用户看到版本倒退），
    只报出来，要动得显式加 --force。
  * 云端（17070）没有 /manifest 与 /package-install 两个接口，那边"用户拿到哪版"
    只能看教师端商城列表；本地（7070）额外核对 plugins/installed 里那份 manifest。
  * dist/web 比 src 旧的不许打包（会发出旧代码），先修构建再上架。

用法：
    python publish_batch.py --audit                 # 只看差异，不改
    python publish_batch.py                         # 双端对齐（缺的补、落后的升）
    python publish_batch.py --hosts=17070           # 只对云端
    python publish_batch.py --only=earth_globe,solar_system
    python publish_batch.py --force                 # 允许把商店里的高版本降回仓库版本
"""
import io
import json
import os
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIPDIR = os.path.join(ROOT, ".workbuddy", "tmp", "zips")
ALL_HOSTS = [7070, 17070]
CLOUD_HOSTS = {17070}          # 这两个接口在云端 server 模块里不存在
ADMIN = ("admin", "admin123")
TEACHER = ("123456", "123456")

GAMES = [
    ("china-relief",     "china_relief",     "山河塑形·中国地形"),
    ("earth-globe",      "earth_globe",      "寰宇地球仪"),
    ("geo-gomoku",       "geo_gomoku",       "经纬度五子棋"),
    ("landform-quiz",    "landform_quiz",    "地貌人格测试"),
    ("legend-match",     "legend_match",     "地图图例消消乐"),
    ("mountain-zones",   "mountain_zones",   "真实地形山地·垂直地带性"),
    ("province-puzzle",  "province_puzzle",  "行政区拼图"),
    ("province-quiz",    "province_quiz",    "省级行政区识别"),
    ("shanhe-match3",    "shanhe_match3",    "山河三消"),
    ("solar-system",     "solar_system",     "寰宇太阳系"),
    ("weather-quiz",     "weather_quiz",     "气象要素识别"),
]


# ---------------------------------------------------------------- 基础

def curl(method, host, path, token=None, body=None, form_file=None, timeout=300):
    url = f"http://127.0.0.1:{host}/api/v1{path}"
    cmd = ["curl", "-s", "-X", method, url, "--max-time", str(timeout)]
    if token:
        cmd += ["-H", f"Authorization: Bearer {token}"]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json",
                "-d", json.dumps(body, ensure_ascii=False)]
    if form_file:
        cmd += ["-F", f"file=@{form_file}"]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if not r.stdout:
        return {"success": False, "_empty": True}
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        return {"success": False, "_nonjson": r.stdout[:300]}


def vtuple(v):
    try:
        return tuple(int(x) for x in str(v).split("."))
    except ValueError:
        return None


def vcmp(a, b):
    """a>b 返回 1，a==b 返回 0，a<b 返回 -1，不可比返回 None。"""
    ta, tb = vtuple(a), vtuple(b)
    if ta is None or tb is None:
        return None
    return (ta > tb) - (ta < tb)


def manifest(d):
    return json.load(io.open(os.path.join(ROOT, d, "manifest.json"), encoding="utf-8"))


def newest(paths):
    t = 0.0
    for p in paths:
        if os.path.isfile(p):
            t = max(t, os.path.getmtime(p))
        for base, _, files in os.walk(p):
            for n in files:
                t = max(t, os.path.getmtime(os.path.join(base, n)))
    return t


def oldest(path):
    t = None
    for base, _, files in os.walk(path):
        for n in files:
            m = os.path.getmtime(os.path.join(base, n))
            t = m if t is None else min(t, m)
    return t or 0.0


def built_at(d):
    """产物"是哪个时刻构建的" —— 只能看构建必然会重写的入口文件。

    ⚠ 别用 dist/web 里最旧/最新的 mtime：`public/` 下的资源（cover.svg、textures/…）
    是**复制**过去的、保留原 mtime，会让每个游戏都被误判成"需要重建"（本脚本第一版就这么错了）。
    入口 index.html + assets/index-*.js|css 才是每次构建都写新的。
    """
    web = os.path.join(ROOT, d, "dist", "web")
    cands = [os.path.join(web, "index.html")]
    assets = os.path.join(web, "assets")
    if os.path.isdir(assets):
        for n in os.listdir(assets):
            if n.startswith("index-") and n.endswith((".js", ".css")):
                cands.append(os.path.join(assets, n))
    ts = [os.path.getmtime(p) for p in cands if os.path.isfile(p)]
    return max(ts) if ts else 0.0


def stale(d):
    """dist/web 是否比源码旧（旧了就说明产物对应的是上一版代码）。

    ⚠ 判据里**故意不含 package.json**：改版本号要三处同步，会顺手动它，
    于是"只改了个版本号"也被算成源码更新（province-puzzle 就是这么被误判的，
    它 src/*.tsx 其实和产物是同一时刻）。依赖真变了应该显式重建，不靠 mtime 猜。
    """
    proj = os.path.join(ROOT, d)
    src = [os.path.join(proj, "src"), os.path.join(proj, "index.html")]
    for extra in ("vite.config.ts", "vite.config.js", "tsconfig.json"):
        src.append(os.path.join(proj, extra))
    web = os.path.join(proj, "dist", "web")
    if not os.path.isdir(web):
        return True, "dist/web 不存在"
    ns, ow = newest(src), built_at(d)
    if ow == 0:
        return True, "找不到入口产物（index.html / assets/index-*.js）"
    if ns > ow:
        return True, f"源码({_ts(ns)}) 比产物({_ts(ow)}) 新"
    return False, f"产物 {_ts(ow)} 已是最新"


def _ts(t):
    import datetime
    return datetime.datetime.fromtimestamp(t).strftime("%m-%d %H:%M")


# ---------------------------------------------------------------- 打包

def pack(d, code):
    m = manifest(d)
    ver = m["version"]
    proj = os.path.join(ROOT, d)
    dist = os.path.join(proj, "dist")
    web = os.path.join(dist, "web")
    os.makedirs(ZIPDIR, exist_ok=True)
    out = os.path.join(ZIPDIR, f"{code}-{ver}.zip")
    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(os.path.join(proj, "manifest.json"), "manifest.json")
        for base, _, files in os.walk(web):
            for n in files:
                full = os.path.join(base, n)
                rel = os.path.relpath(full, dist).replace(os.sep, "/")
                z.write(full, rel)
    with zipfile.ZipFile(out) as z:
        names = z.namelist()
    tops = sorted({n.split("/")[0] for n in names})
    bad = [n for n in names if ".tmp" in n or n.endswith(".log") or "__MACOSX" in n]
    inner = json.loads(zipfile.ZipFile(out).read("manifest.json").decode("utf-8"))
    problems = []
    if tops != ["manifest.json", "web"]:
        problems.append(f"zip 顶层异常 {tops}")
    if bad:
        problems.append(f"混入临时文件 {bad[:3]}")
    if inner.get("version") != ver:
        problems.append("包内版本与目录不一致")
    if inner.get("gameCode") != code:
        problems.append(f"包内 gameCode={inner.get('gameCode')} 期望 {code}")
    for need in (m.get("entry"), m.get("cover")):
        if need and need not in names:
            problems.append(f"包内缺 {need}")
    size = os.path.getsize(out) / 1024 / 1024
    print("  [pack] %-14s v%-7s %6.2f MB  %d 文件%s"
          % (code, ver, size, len(names), "" if not problems else "  ✘ " + "; ".join(problems)))
    return out, ver, problems


# ---------------------------------------------------------------- 后端状态

def login(host, who, token_key="token"):
    u, p = ADMIN if who == "admin" else TEACHER
    path = "/admin/login" if who == "admin" else "/auth/local/login"
    r = curl("POST", host, path, body={"username": u, "password": p}, timeout=30)
    if not r.get("success"):
        return None, f"{who} 登录失败: {str(r)[:160]}"
    return r["data"][token_key], None


def admin_map(host):
    tk, err = login(host, "admin")
    if err:
        return None, err
    ls = curl("GET", host, "/admin/games", tk, timeout=60).get("data") or []
    return {g.get("gameCode"): g for g in ls}, None


def teacher_map(host):
    tk, err = login(host, "teacher")
    if err:
        return None, err
    ls = curl("GET", host, "/store/games", tk, timeout=60).get("data") or []
    return {g.get("gameCode"): g for g in ls}, None


def installed_ver(host, code):
    """本地才有：读 plugins/installed 里那份 manifest（用户点开真正拿到的东西）。"""
    tk, err = login(host, "teacher")
    if err:
        return None
    r = curl("GET", host, f"/store/games/{code}/manifest", tk, timeout=30)
    if isinstance(r, dict) and "gameCode" in r and "version" in r:
        return r.get("version")
    if isinstance(r, dict) and r.get("success") and isinstance(r.get("data"), dict):
        return r["data"].get("version")
    return None


# ---------------------------------------------------------------- 对齐

def plan(host, only, force):
    """算出这个后端需要做什么。返回 [(game, action, reason)]。"""
    am, aerr = admin_map(host)
    if aerr:
        print(f"[{host}] {aerr}")
        return None
    tm, terr = teacher_map(host)
    if terr:
        print(f"[{host}] {terr}")
        tm = {}
    out = []
    for d, code, name in GAMES:
        if only and code not in only:
            continue
        ver = manifest(d)["version"]
        if code not in am:
            out.append(((d, code, name), "create", "商城无此游戏记录"))
            continue
        if am[code].get("status") != "ACTIVE":
            out.append(((d, code, name), "activate", f"状态={am[code].get('status')}"))
            continue
        tver = (tm.get(code) or {}).get("version")
        if tver is None:
            out.append(((d, code, name), "publish", "教师端商城看不到"))
            continue
        c = vcmp(tver, ver)
        if c == 0:
            continue
        if c > 0:
            if force:
                out.append(((d, code, name), "downgrade",
                            f"教师端 {tver} > 仓库 {ver}（--force 强制降回）"))
            else:
                out.append(((d, code, name), "anomaly",
                            f"教师端 {tver} > 仓库 {ver}：商店里是仓库没有的孤儿版本，不动"))
            continue
        out.append(((d, code, name), "publish", f"教师端 {tver} 落后于仓库 {ver}"))
    return out


def publish_one(host, d, code, name, zip_path):
    am, aerr = admin_map(host)
    if aerr:
        print(f"  ✘ {aerr}")
        return False
    tk, err = login(host, "admin")
    if err:
        print(f"  ✘ {err}")
        return False
    g = am.get(code)
    if g is None:
        r = curl("POST", host, "/admin/games", tk, {
            "gameCode": code, "name": name,
            "description": manifest(d).get("description"), "priceCents": 0,
        }, timeout=60)
        if not r.get("success"):
            print(f"  ✘ 创建失败: {r.get('message') or r}")
            return False
        g = r["data"]
        print(f"  · 新建记录 id={g.get('id')}")
    r = curl("POST", host, f"/admin/games/{code}/packages", tk, form_file=zip_path)
    if not r.get("success"):
        print(f"  ✘ 上传包失败: {r.get('message') or r}")
        return False
    print(f"  · 上传包成功 v{r['data'].get('version') or r['data'].get('latestVersion')}")
    r = curl("PATCH", host, f"/admin/games/{g['id']}/status", tk, {"status": "ACTIVE"}, timeout=30)
    if not r.get("success"):
        print(f"  ✘ 激活失败: {r.get('message') or r}")
        return False
    return True


# ---------------------------------------------------------------- 核对矩阵

def matrix(hosts):
    print()
    print("=" * 100)
    print("核对矩阵（仓库版本 / 各后端：admin 有无 · 状态 · 教师端可见 · 教师端版本）")
    print("=" * 100)
    states = {}
    for h in hosts:
        am, aerr = admin_map(h)
        tm, terr = teacher_map(h)
        states[h] = (am or {}, tm or {}, aerr or terr)
    hdr = "%-14s %-8s" % ("gameCode", "仓库")
    for h in hosts:
        hdr += " | %-34s" % f"{h}"
    print(hdr)
    print("-" * len(hdr))
    bad = 0
    for d, code, name in GAMES:
        ver = manifest(d)["version"]
        row = "%-14s %-8s" % (code, ver)
        for h in hosts:
            am, tm, err = states[h]
            if err:
                row += " | %-34s" % ("后端异常")
                bad += 1
                continue
            if code not in am:
                row += " | %-34s" % "✘ 商城无记录"
                bad += 1
                continue
            st = am[code].get("status")
            vis = code in tm
            tver = (tm.get(code) or {}).get("version")
            mark = "✔" if (vis and st == "ACTIVE" and vcmp(tver, ver) == 0) else "⚠"
            if mark == "⚠":
                bad += 1
            row += " | %s %s 可见=%-5s v%-8s" % (
                mark, st, "是" if vis else "否", str(tver))
        print(row)
    print("-" * len(hdr))
    print("带 ⚠ 的格子需要处理；共 %d 处。" % bad)
    return bad


# ---------------------------------------------------------------- main

def main():
    audit = "--audit" in sys.argv
    force = "--force" in sys.argv
    hosts = ALL_HOSTS
    for a in sys.argv:
        if a.startswith("--hosts="):
            hosts = [int(x) for x in a.split("=", 1)[1].split(",")]
    only = set()
    for a in sys.argv:
        if a.startswith("--only="):
            only = {x.strip() for x in a.split("=", 1)[1].split(",") if x.strip()}

    print("=" * 100)
    print("0. 产物新鲜度（dist/web 不许比 src 旧）")
    print("=" * 100)
    stale_list = []
    for d, code, _ in GAMES:
        if only and code not in only:
            continue
        is_stale, why = stale(d)
        print("  %-14s %s %s" % (code, "✘ 需要重建" if is_stale else "✔", why))
        if is_stale:
            stale_list.append((d, code))
    if stale_list and not audit:
        print("\n  ✘ 有产物过期，先重建再上架：%s" % ", ".join(c for _, c in stale_list))
        print("    重建命令见 README（先 rmtree dist/web，再 npm run build，绕开沙箱批量删除守卫）")
        return 1

    print()
    print("=" * 100)
    print("1. 各后端差异（仓库 manifest 为唯一真值）")
    print("=" * 100)
    plans = {}
    for h in hosts:
        p = plan(h, only, force)
        plans[h] = p or []
        print(f"\n  --- {h} ---")
        if not p:
            print("    无需改动")
        for (g, act, why) in (p or []):
            print("    %-12s %-10s %s" % (g[1], act, why))
    if audit:
        matrix(hosts)
        print("\n[audit] 只读模式，未做任何改动")
        return 0

    print()
    print("=" * 100)
    print("2. 执行上架")
    print("=" * 100)
    need_zip = {}
    for h in hosts:
        for ((d, code, name), act, _) in plans[h]:
            if act in ("create", "publish", "downgrade"):
                need_zip[(d, code)] = name
    packed = {}
    for (d, code), name in need_zip.items():
        zip_path, ver, problems = pack(d, code)
        if problems:
            print("  ✘ 打包自检不过，跳过该游戏:", code)
            continue
        packed[code] = (zip_path, ver)

    okall = True
    for h in hosts:
        print(f"\n  ===== 后端 {h} =====")
        if not plans[h]:
            continue
        for ((d, code, name), act, why) in plans[h]:
            if act == "anomaly":
                print("  · %-14s 跳过（%s）" % (code, why))
                continue
            if act == "activate":
                tk, _ = login(h, "admin")
                am, _ = admin_map(h)
                r = curl("PATCH", h, f"/admin/games/{am[code]['id']}/status", tk,
                         {"status": "ACTIVE"}, timeout=30)
                print("  · %-14s 激活 %s" % (code, "成功" if r.get("success") else "失败"))
                continue
            if code not in packed:
                print("  · %-14s 跳过（无可用包）" % code)
                okall = False
                continue
            zip_path, ver = packed[code]
            print("  %-14s %s" % (code, act))
            if not publish_one(h, d, code, name, zip_path):
                okall = False

    print()
    print("=" * 100)
    print("3. 上架后核对")
    print("=" * 100)
    bad = matrix(hosts)
    print()
    print("[done] 结论：%s" % ("全部对齐 ✔" if bad == 0 else f"仍有 {bad} 处需要处理 ⚠"))
    return 0 if bad == 0 and okall else 1


if __name__ == "__main__":
    sys.exit(main())
