#!/usr/bin/env python3
"""把行政区划 Shapefile 转成「山河三消」用的紧凑数据（src/data/provinces.json）。

用法:
  python prepare_data.py --inspect
  python prepare_data.py --emit

与 province-puzzle/scripts/prepare_data.py **同源、同投影、同尺度**，差别只在输出 schema：
本游戏没有 `centroid`，且 `bbox` 直接按 SVG viewBox 的 `[x, y, w, h]` 写法输出。

⚠️ 两个游戏的轮廓数据必须能对得上：`d` 字段除港澳外应当**逐字节相同**。
   改动这里的投影或尺度参数前，先想清楚会不会把两边拆散
   （回归脚本 .workbuddy/tmp/smdata/verify_data.py 会拿 province-puzzle 的产物交叉比对）。
"""

import argparse
import json
import pathlib
import struct

import geopandas as gpd
from shapely.geometry import MultiPolygon, Polygon


BASE = pathlib.Path(
    r"E:\Self\资源\中国省市县2022年初行政区划数据\中国省市县2022年初行政区划数据"
)

LEVELS = {
    "province": ("2022省级", "2022省矢量.shp"),
}

OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "src" / "data"

# 写进产物里的 `version` 字段，取自 package.json —— **单一真源，不再手工同步**。
#
# 这个文件原来的版本标记是手写的 `"0.1.0"`，从游戏 0.1.0 一路滞后到 1.0.1 都没人发现
# —— 出处标记一旦说假话就比没有更糟。改成读 package.json 后，发版时改一处就自动跟上。
GAME_VERSION = json.loads(
    (pathlib.Path(__file__).resolve().parent.parent / "package.json").read_text(
        encoding="utf-8"
    )
)["version"]

# 投影后简化容差（米）。越大越精简，但边界越粗糙。
#
# ⚠ 这是个**统一的绝对长度**，而省级行政区的面积差着五个数量级：
# 新疆 166 万 km²、香港 1110 km²、澳门 33 km²。按"省的平均规模"定的 3800 m
# 落到澳门身上就是灾难 —— 它整个只有 12 km 宽，3800 m 容差会把外环压成三角形、
# 内环压成 4 个**完全重合的点**（`M727,740L727,740L727,740L727,740Z`），
# 界面上一个像素都画不出来。香港也只剩 68 个顶点、12 个 5 点小环。
# 小面积行政区走 SMALL_AREA_OVERRIDES 单独配置。
SIMPLIFY_TOLERANCE_METERS = 3800.0

# 「小面积行政区」的专属参数。
#
# 与 province-puzzle v1.0.0 用的是**同一组值**，理由也一样（那边已实测验证过）：
#
#   1) 简化容差 —— 取"牌面一个像素的几分之一"。
#      牌面 svg 约 68 × 67 px，香港 bbox 跨约 62 km ⇒ 约 0.9 km/px；
#      澳门 bbox 跨约 12 km、牌面有效约 0.3 km/px。
#      取 120 m / 50 m，都远低于各自的一个像素 ⇒ 画面上看不出被简化过。
#
#   2) 最小岛面积 —— 原来的 0.0002°² ≈ 2.3 km²，是照"值得在全国图上出现的岛"定的。
#      香港 34 个多边形按这个阈值只活下来 12 个（丢掉的是 0.4~2.0 km² 的岛），
#      澳门 4 个只剩 2 个。但**牌面是单独缩放显示的**（viewBox 用该要素自己的 bbox），
#      小岛在牌面上照样看得见，所以这两个行政区降到 0.00001°² ≈ 0.11 km²，全部保留。
#
#   3) 坐标精度 —— 这一条最隐蔽，也**正是用户说的"粗"的真身**。
#      输出坐标原来是 `round()` 成整数的，而整张数据只有 1200 单位宽（1 单位 ≈ 5.3 km）。
#      澳门真实跨度 7.1 × 11.9 km = 1.34 × 2.25 单位，取整之后最多剩 2 × 3 个不同位置：
#      实测外环 47 个顶点只落在 **4 个不同点**上，整个澳门变成一个 1×1 的小方块。
#      也就是说**再细的源数据都会在这一步被抹平** —— 香港 34 个岛里 27 个、
#      澳门 4 个里 3 个都是这么塌掉的。
#      但牌面是拿同一个 `d` 自己缩放渲染的，所以只要 `d` 里留着小数位，
#      牌面就能把细节放大出来；地图本体那边仍按真实比例画成一个小点，本来就是对的。
#      0.01 单位 = 53 m，与上面 50~120 m 的容差同一量级，不浪费字节。
#
# 面积可信度（与官方口径对照，这一条决定了"该不该上网另找数据"）：
#   香港 源数据 1110 km² vs 官方 1114.57 km²（2024 香港年报）⇒ 偏差 -0.4%
#   澳门 源数据   35 km² vs 官方   33.3 km²（2024 统计暨普查局）⇒ 偏差 +5.1%
# 对照：阿里云 DataV（高德数据）香港 1288 km²（+15.6%）、澳门 53 km²（+59%），
# 且澳门只有 84 个顶点（比源数据的 203 还粗）—— 所以这一版**没有换数据源**，
# 修的是"把好数据用坏"的简化参数与坐标量化。
SMALL_AREA_OVERRIDES = {
    # code: (简化容差 m, 最小岛面积 °², 坐标小数位)
    "810000": (120.0, 0.00001, 2),  # 香港特别行政区
    "820000": (50.0, 0.00001, 2),   # 澳门特别行政区
}

# 画布总宽度（视图单位）。下面两个数与 province-puzzle 保持一致，否则两边的 `d` 对不上。
PROJECT_WIDTH = 1200
MAIN_MAP_WIDTH = 1000
# 南海诸岛等远离主岛的碎岛，纬度低于该值则剔除（保留海南主岛）。
MIN_ISLAND_LAT = 18.0
MIN_ISLAND_AREA = 0.0002

# 三要素里「简称」「行政省会」不是矢量数据里的字段，是**人工编写的教学口径**。
# 它们不随几何重算而变，所以单独放在这里当单一真源。
# （名称走 DBF，不在这里重复。）
PROVINCE_META = {
    "110000": ("京", "北京"),
    "120000": ("津", "天津"),
    "130000": ("冀", "石家庄"),
    "140000": ("晋", "太原"),
    "150000": ("内蒙古", "呼和浩特"),
    "210000": ("辽", "沈阳"),
    "220000": ("吉", "长春"),
    "230000": ("黑", "哈尔滨"),
    "310000": ("沪", "上海"),
    "320000": ("苏", "南京"),
    "330000": ("浙", "杭州"),
    "340000": ("皖", "合肥"),
    "350000": ("闽", "福州"),
    "360000": ("赣", "南昌"),
    "370000": ("鲁", "济南"),
    "410000": ("豫", "郑州"),
    "420000": ("鄂", "武汉"),
    "430000": ("湘", "长沙"),
    "440000": ("粤", "广州"),
    "450000": ("桂", "南宁"),
    "460000": ("琼", "海口"),
    "500000": ("渝", "重庆"),
    "510000": ("川", "成都"),
    "520000": ("贵", "贵阳"),
    "530000": ("云", "昆明"),
    "540000": ("藏", "拉萨"),
    "610000": ("陕", "西安"),
    "620000": ("甘", "兰州"),
    "630000": ("青", "西宁"),
    "640000": ("宁", "银川"),
    "650000": ("新", "乌鲁木齐"),
    "710000": ("台", "台北"),
    "810000": ("港", "香港"),
    "820000": ("澳", "澳门"),
}

# 中国地图常用 Albers 等积圆锥投影：
# 中央经线 105°E，两条标准纬线 25°N / 47°N，椭球体使用 WGS84。
ALBERS_PROJ = (
    "+proj=aea +lat_1=25 +lat_2=47 +lat_0=0 +lon_0=105 "
    "+x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs"
)

# pyproj 数据库不一定内置 EPSG:102025（部分版本是 ESRI 专有码），
# 因此优先用自定义 proj4，避免依赖本地数据库。
from pyproj import CRS

try:
    ALBERS_CRS = CRS.from_epsg(102025)
except Exception:
    ALBERS_CRS = CRS.from_proj4(ALBERS_PROJ)


def read_dbf(path: pathlib.Path, encoding: str = "utf-8"):
    """最小 DBF 读取器，用于绕过错误的 .cpg 编码声明。"""
    b = path.read_bytes()
    nrec = struct.unpack("<I", b[4:8])[0]
    hdr = struct.unpack("<H", b[8:10])[0]
    recsize = struct.unpack("<H", b[10:12])[0]

    fields = []
    i = 32
    while i < hdr and b[i] != 0x0D:
        name = b[i : i + 11].split(b"\0")[0].decode(encoding, "replace")
        typ = chr(b[i + 11])
        flen = b[i + 16]
        dec = b[i + 17]
        fields.append((name, typ, flen, dec))
        i += 32

    records = []
    for r in range(nrec):
        off = hdr + r * recsize
        pos = off + 1
        row = {}
        for name, typ, flen, dec in fields:
            raw = b[pos : pos + flen]
            pos += flen
            if typ in ("C", "M"):
                val = raw.decode(encoding, "replace").strip("\x00").strip()
            else:
                val = raw.decode("ascii", "replace").strip("\x00").strip()
            row[name] = val
        records.append(row)
    return fields, records


def rings_of(geom):
    """返回 [外环, 孔, ...] 的坐标列表。"""
    polys = []
    if isinstance(geom, Polygon):
        polys = [geom]
    elif isinstance(geom, MultiPolygon):
        polys = list(geom.geoms)
    else:
        polys = [geom]

    result = []
    for poly in polys:
        rings = [list(poly.exterior.coords)]
        for interior in poly.interiors:
            rings.append(list(interior.coords))
        result.append(rings)
    return result


def inspect(level: str):
    folder, shp = LEVELS[level]
    shp_path = BASE / folder / shp
    dbf_path = shp_path.with_suffix(".dbf")

    fields, records = read_dbf(dbf_path)
    gdf = gpd.read_file(shp_path)

    print("=== fields ===")
    for name, typ, flen, dec in fields:
        print(f"  {name!r} type={typ} len={flen} dec={dec}")

    print(f"\n=== geometry: {len(gdf)} rows, crs={gdf.crs} ===")
    for idx, geom in enumerate(gdf.geometry):
        verts = sum(len(ring) for rings in rings_of(geom) for ring in rings)
        bbox = geom.bounds
        rec = records[idx] if idx < len(records) else {}
        print(
            f"  [{idx}] verts={verts} "
            f"bbox=({bbox[0]:.2f},{bbox[1]:.2f},{bbox[2]:.2f},{bbox[3]:.2f}) "
            f"rec={json.dumps(rec, ensure_ascii=False)}"
        )


def project_coords(geometry, x_min, y_max, scale):
    """把投影坐标系几何转成 SVG 视图坐标（float，不取整 —— 由 rings_to_path 决定精度）。"""
    out = []
    for poly in geometry.geoms if isinstance(geometry, MultiPolygon) else [geometry]:
        poly_rings = []
        rings = [poly.exterior] + list(poly.interiors)
        for ring in rings:
            coords = []
            for x, y in ring.coords:
                coords.append(((x - x_min) * scale, (y_max - y) * scale))
            poly_rings.append(coords)
        out.append(poly_rings)
    return out


def fmt_coord(value, decimals):
    """按指定小数位格式化一个坐标分量。

    `decimals <= 0` 走整数分支，**与历史输出逐字节一致**（`round()` 是银行家舍入，
    f-string 取 0 位小数也是 —— 但不能想当然，所以两条分支分开写）。
    """
    if decimals <= 0:
        return str(round(value))
    text = f"{value:.{decimals}f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def rings_to_path(polygons, decimals=0):
    parts = []
    for poly_rings in polygons:
        for ring in poly_rings:
            if not ring:
                continue
            d = "M" + "L".join(
                f"{fmt_coord(x, decimals)},{fmt_coord(y, decimals)}" for x, y in ring
            ) + "Z"
            parts.append(d)
    return "".join(parts)


def filter_geometry(geom, min_area=MIN_ISLAND_AREA):
    """保留主岛，剔除远海碎岛。

    `min_area` 是**投影前**（经纬度）的面积阈值，单位是度²。小面积行政区
    走 SMALL_AREA_OVERRIDES 传更小的值 —— 全国图上"不值得画"的小岛，
    在单独缩放的牌面上照样看得见，不该一起砍掉。
    """
    if isinstance(geom, Polygon):
        geom = MultiPolygon([geom])
    keep = []
    for poly in geom.geoms:
        if poly.is_empty:
            continue
        if poly.area < min_area:
            continue
        if poly.representative_point().y < MIN_ISLAND_LAT:
            continue
        keep.append(poly)
    if not keep:
        return None
    if len(keep) == 1:
        return keep[0]
    return MultiPolygon(keep)


def reproject(geom, source_crs, target_crs):
    return gpd.GeoSeries([geom], crs=source_crs).to_crs(target_crs)[0]


def emit(level: str):
    folder, shp = LEVELS[level]
    shp_path = BASE / folder / shp
    dbf_path = shp_path.with_suffix(".dbf")

    fields, records = read_dbf(dbf_path)
    gdf = gpd.read_file(shp_path)

    name_field = fields[0][0]

    features = []
    for idx, geom in enumerate(gdf.geometry):
        rec = records[idx]
        name = rec.get(name_field, "").strip()
        code = rec.get("FIRST_GID", str(idx)).strip()
        if not name:
            name = rec.get("ENG_NAME", code)
        if code not in PROVINCE_META:
            raise SystemExit(f"{code} {name} 不在 PROVINCE_META 里，先补简称/省会")

        # 小面积行政区（港澳）用专属参数，其余仍走全局默认。
        # 两条路径产出的几何**除了这两个 code 之外必须逐字节相同** ——
        # 复核脚本会拿新旧 JSON 逐 feature 比对 `d` / `bbox`。
        tol, min_area, decimals = SMALL_AREA_OVERRIDES.get(
            code, (SIMPLIFY_TOLERANCE_METERS, MIN_ISLAND_AREA, 0)
        )

        cleaned = filter_geometry(geom, min_area)
        if cleaned is None:
            continue
        projected = reproject(cleaned, gdf.crs, ALBERS_CRS)
        simplified = projected.simplify(tol, preserve_topology=True)
        if simplified.is_empty:
            continue
        features.append(
            {
                "id": code,
                "name": name,
                "geom": simplified,
                "decimals": decimals,
            }
        )

    all_bounds = [f["geom"].bounds for f in features]
    x_min = min(b[0] for b in all_bounds)
    y_min = min(b[1] for b in all_bounds)
    x_max = max(b[2] for b in all_bounds)
    y_max = max(b[3] for b in all_bounds)

    x_span = max(x_max - x_min, 1e-9)
    y_span = max(y_max - y_min, 1e-9)
    scale = MAIN_MAP_WIDTH / x_span
    height = round(y_span * (PROJECT_WIDTH / x_span))

    out_features = []
    for f in features:
        geom = f["geom"]
        dec = f["decimals"]
        abbr, capital = PROVINCE_META[f["id"]]
        path = rings_to_path(project_coords(geom, x_min, y_max, scale), dec)
        bbox = geom.bounds
        # bbox 必须与 `d` 用**同一个精度**：牌面是拿 bbox 当 viewBox 单独缩放显示的，
        # bbox 取整而 `d` 不取整，小要素就会偏出取景框（澳门偏半格就够露馅）。
        pt = lambda v: round(v, dec) if dec > 0 else round(v)  # noqa: E731
        x0 = pt((bbox[0] - x_min) * scale)
        y0 = pt((y_max - bbox[3]) * scale)
        x1 = pt((bbox[2] - x_min) * scale)
        y1 = pt((y_max - bbox[1]) * scale)
        # 本游戏的 bbox 是 SVG viewBox 的 [x, y, w, h] 写法；宽度也要按同一精度收敛，
        # 否则 745.54-733.35 会带出 12.189999999999998 这种浮点尾巴。
        if dec > 0:
            w = round(x1 - x0, dec)
            h = round(y1 - y0, dec)
        else:
            w = x1 - x0
            h = y1 - y0
        out_features.append(
            {
                "id": f["id"],
                "name": f["name"],
                "abbr": abbr,
                "capital": capital,
                "bbox": [x0, y0, w, h],
                "d": path,
            }
        )

    # ── 自检：小面积行政区不许再被"坐标取整"塌成方块 ─────────────────────────
    # 判据是"最大的那个环有多少个不同坐标"，低于 20 就说明精度又被抹平了。
    # 特意**不写"面积不退化"**：澳门改前的主岛在图上本来就 <1 单位²，
    # 取整之后围合面积算出来是 0.00，那是退化，不是不退化。
    for f in out_features:
        if f["id"] not in SMALL_AREA_OVERRIDES:
            continue
        segs = f["d"].split("M")[1:]
        best = 0
        verts = 0
        for seg in segs:
            pts = [p for p in seg.rstrip("Z").split("L") if p]
            verts += len(pts)
            best = max(best, len(set(pts)))
        status = "✔" if best >= 20 else "✘ 精度被抹平"
        print(
            f"  [小面积] {f['id']} {f['name']}: 环={len(segs)} 顶点={verts} "
            f"最大环不同坐标={best} 容差={SMALL_AREA_OVERRIDES[f['id']][0]}m "
            f"小数位={SMALL_AREA_OVERRIDES[f['id']][2]} {status}"
        )
        assert best >= 20, (
            f"{f['id']} 的几何在输出精度下塌陷了（最大环只有 {best} 个不同坐标）。"
            f" 检查 SMALL_AREA_OVERRIDES 里的坐标小数位是否被改回 0。"
        )
        # 牌面像素账：viewBox 就是 bbox，`preserveAspectRatio="meet"` 缩放到牌面区。
        # 牌面 74 × 88，去掉顶部标签行与内边距后约 68 × 67 px。
        k = min(68 / max(f["bbox"][2], 1e-9), 67 / max(f["bbox"][3], 1e-9))
        print(
            f"           bbox={f['bbox']} ⇒ 牌面缩放 {k:.2f} px/单位；"
            f"旧描边 2 单位 = {2 * k:.1f} 屏幕像素"
        )

    payload = {
        "version": GAME_VERSION,
        "projection": {"name": "albers", "proj4": ALBERS_PROJ.strip()},
        "viewBox": [0, 0, PROJECT_WIDTH, height],
        "features": out_features,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "provinces.json"
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(f"wrote {out_path}")
    print(f"features: {len(out_features)}")
    print(f"viewBox: {payload['viewBox']}")
    print(f"size: {out_path.stat().st_size / 1024:.1f} KB")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--level", choices=list(LEVELS), default="province")
    parser.add_argument("--inspect", action="store_true")
    parser.add_argument("--emit", action="store_true")
    args = parser.parse_args()

    if args.inspect:
        inspect(args.level)
        return
    if not args.emit:
        parser.print_help()
        return
    emit(args.level)


if __name__ == "__main__":
    main()
