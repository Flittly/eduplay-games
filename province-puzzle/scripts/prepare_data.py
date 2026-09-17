#!/usr/bin/env python3
"""把行政区划 Shapefile 转成游戏可用的紧凑 GeoJSON 数据。

用法:
  python prepare_data.py --level province --inspect
  python prepare_data.py --level province --emit
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
    "prefecture": ("2022地级", "2022市矢量.shp"),
    "county": ("2022县级", "2022县矢量.shp"),
}

OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "src" / "data"

# 写进产物里的 `version` 字段，取自 package.json —— **单一真源，不再手工同步**。
#
# 它不代表游戏版本、也没有任何代码读它（`grep` 过 src/），纯粹是"这份数据是哪一版生成的"
# 的出处标记，方便日后 diff `province.json` 时知道该配哪个 commit。
# 之前它是手写的常量，结果从 0.3.3 一路滞后到游戏 0.3.7 都没人发现 —— 出处标记一旦
# 说假话就比没有更糟。改成读 package.json 后，只要发版时改 package.json 它就自动跟上。
GAME_VERSION = json.loads(
    (pathlib.Path(__file__).resolve().parent.parent / "package.json").read_text(
        encoding="utf-8"
    )
)["version"]

# 投影后简化容差（米）。越大越精简，但边界越粗糙。
#
# ⚠ 这是个**统一的绝对长度**，而省级行政区的面积差着四个数量级：
# 新疆 166 万 km²、香港 1110 km²、澳门 33 km²。按"省的平均规模"定的 3800 m
# 落到澳门身上就是灾难 —— 它整个只有 12 km 宽，3800 m 容差会把外环压成三角形、
# 内环压成 4 个**完全重合的点**（`M727,740L727,740L727,740L727,740Z`），
# 界面上一个像素都画不出来。香港也只剩 68 个顶点、12 个 5 点小环。
# 小面积行政区走 SMALL_AREA_OVERRIDES 单独配置。
SIMPLIFY_TOLERANCE_METERS = 3800.0

# 「小面积行政区」的专属参数（2026-09-17 新增，v1.0.0）。
#
# 两条判据都用「它在这个游戏里占几个像素」来定，而不是拍脑袋：
#
#   1) 简化容差 —— 取"卡片上一个像素的几分之一"。
#      卡片 svg 固定高 37 px，香港 bbox 跨约 62 km ⇒ 约 0.9 km/px；
#      澳门 bbox 跨约 12 km、卡片有效约 0.3 km/px。
#      取 120 m / 50 m，都远低于各自的一个像素 ⇒ 画面上看不出被简化过。
#      上限也不必贪：地图本体只有 1 单位 ≈ 5.3 km，香港在图上就 11 px 宽，
#      比卡片还粗一个数量级 —— 数据再细，地图上也表现不出来。
#
#   2) 最小岛面积 —— 原来的 0.0002°² ≈ 2.3 km²，是照"值得在大图上出现的岛"定的。
#      香港 34 个多边形按这个阈值只活下来 12 个（丢掉的是 0.4~2.0 km² 的岛），
#      澳门 4 个只剩 2 个。但**卡片是单独缩放显示的**，小岛在卡片上照样看得见，
#      所以这两个行政区降到 0.00001°² ≈ 0.11 km²，全部保留。
#
#   3) 坐标精度 —— 这一条最隐蔽，但它是**真正的瓶颈**。
#      输出坐标原来是 `round()` 成整数的，而整张地图只有 1200 单位宽（1 单位 ≈ 5.3 km）。
#      澳门真实跨度 7.1 × 11.9 km = 1.34 × 2.25 单位，取整之后最多剩 2 × 3 个不同位置：
#      实测外环 47 个顶点只落在 **4 个不同点**上，整个澳门变成一个 1×1 的小方块。
#      也就是说**再细的源数据都会在这一步被抹平** —— 香港 34 个岛里 27 个、
#      澳门 4 个里 3 个都是这么塌掉的。
#      但托盘卡片是拿同一个 `d` 自己缩放渲染的（`viewBox` 用该要素的 bbox），
#      所以只要 `d` 里留着小数位，卡片就能把细节放大出来；
#      地图本体那边仍按真实比例画成一个小点，本来就是对的。
#      0.01 单位 = 53 m，与上面 50~120 m 的容差同一量级，不浪费字节。
#
# 面积可信度（与官方口径对照，这一条决定了"用源数据还是上网另找"）：
#   香港 源数据 1110 km² vs 官方 1114.57 km²（2024 香港年报）⇒ 偏差 -0.4%
#   澳门 源数据   35 km² vs 官方   33.3 km²（2024 统计暨普查局）⇒ 偏差 +5.1%
#        （澳门面积逐年在涨，源数据是"2022 年初"口径，且含已填海未纳入统计的地块，
#          5% 的偏差对这种量级是可接受的；关键是下面 DataV 那组差了 59%）
# 对照：阿里云 DataV（高德数据）香港 1288 km²（+15.6%）、澳门 53 km²（+59%），
# 且澳门只有 84 个顶点（比源数据的 203 还粗）—— 所以这一版**没有换数据源**，
# 修的是"把好数据用坏"的简化参数与坐标量化。
SMALL_AREA_OVERRIDES = {
    # code: (简化容差 m, 最小岛面积 °², 坐标小数位)
    "810000": (120.0, 0.00001, 2),  # 香港特别行政区
    "820000": (50.0, 0.00001, 2),   # 澳门特别行政区
}

# 画布总宽度（视图单位）。
PROJECT_WIDTH = 1200
# 主图省界实际占用宽度；右侧留白给南海小地图。
MAIN_MAP_WIDTH = 1000
# 右下角南海小地图的视图宽度（单位）。
INSET_WIDTH = 300
# 小地图在整张 SVG 中的放置区域 [x, y, width, height]。
INSET_BOX = [1002, 665, 196, 330]
# 小地图内容与边框之间保留的边距比例（相对数据范围）。
INSET_PADDING_RATIO = 0.06
# 南海诸岛等远离主岛的碎岛，纬度低于该值则剔除（保留海南主岛）。
MIN_ISLAND_LAT = 18.0
MIN_ISLAND_AREA = 0.0002

# 中国地图常用 Albers 等积圆锥投影：
# 中央经线 105°E，两条标准纬线 25°N / 47°N，椭球体使用 WGS84。
ALBERS_PROJ = (
    "+proj=aea +lat_1=25 +lat_2=47 +lat_0=0 +lon_0=105 "
    "+x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs"
)
ALBERS_CRS = "EPSG:102025"

# pyproj 数据库不一定内置 EPSG:102025（部分版本是 ESRI 专有码），
# 因此优先用自定义 proj4，避免依赖本地数据库。
from pyproj import CRS

try:
    ALBERS_CRS = CRS.from_epsg(102025)
except Exception:
    ALBERS_CRS = CRS.from_proj4(ALBERS_PROJ)

NINE_DASH_FILE = BASE / "九段线" / "九段线.shp"


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
        rings = []
        rings.append(list(poly.exterior.coords))
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
    total_vertices = 0
    for idx, geom in enumerate(gdf.geometry):
        ring_count = 0
        verts = 0
        for rings in rings_of(geom):
            ring_count += len(rings)
            for ring in rings:
                verts += len(ring)
        total_vertices += verts
        bbox = geom.bounds
        rec = records[idx] if idx < len(records) else {}
        print(
            f"  [{idx}] polys={ring_count} verts={verts} "
            f"bbox=({bbox[0]:.2f},{bbox[1]:.2f},{bbox[2]:.2f},{bbox[3]:.2f}) "
            f"rec={json.dumps(rec, ensure_ascii=False)}"
        )
    print(f"\ntotal vertices: {total_vertices}")


def project_coords(geometry, x_min, y_max, x_scale, y_scale):
    """把投影坐标系几何转成 SVG 视图坐标（float，不取整 —— 由 rings_to_path 决定精度）。"""
    out = []
    for poly in geometry.geoms if isinstance(geometry, MultiPolygon) else [geometry]:
        poly_rings = []
        rings = [poly.exterior] + list(poly.interiors)
        for ring in rings:
            coords = []
            for x, y in ring.coords:
                px = (x - x_min) * x_scale
                py = (y_max - y) * y_scale
                coords.append((px, py))
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
    走 SMALL_AREA_OVERRIDES 传更小的值 —— 大图上"不值得画"的小岛，
    在单独缩放的卡片上照样看得见，不该一起砍掉。
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
    """把 shapely 几何转换到目标 CRS。"""
    return gpd.GeoSeries([geom], crs=source_crs).to_crs(target_crs)[0]


def build_inset(province_gdf):
    """生成右下角「南海诸岛」小地图：九段线 + 岛礁点。"""
    nine_path = NINE_DASH_FILE
    if not nine_path.exists():
        return None

    nine_df = gpd.read_file(nine_path)
    province_geom = province_gdf.loc[
        province_gdf["FIRST_GID"].astype(str) == "460000", "geometry"
    ].iloc[0]
    if isinstance(province_geom, MultiPolygon):
        all_parts = list(province_geom.geoms)
    elif isinstance(province_geom, Polygon):
        all_parts = [province_geom]
    else:
        all_parts = []

    # 只取海南省里代表点低于 18°N 的南海岛礁，海南主岛仍保留在大图。
    islands_4326 = [
        part
        for part in all_parts
        if part.representative_point().y < MIN_ISLAND_LAT
    ]

    nine_proj = nine_df.geometry.apply(
        lambda geom: reproject(geom, nine_df.crs, ALBERS_CRS)
    )
    islands_proj = [
        reproject(geom, province_gdf.crs, ALBERS_CRS) for geom in islands_4326
    ]

    all_bounds = [tuple(nine_proj.total_bounds)]
    all_bounds.extend(geom.bounds for geom in islands_proj)
    x_min = min(b[0] for b in all_bounds)
    y_min = min(b[1] for b in all_bounds)
    x_max = max(b[2] for b in all_bounds)
    y_max = max(b[3] for b in all_bounds)

    x_span = max(x_max - x_min, 1e-9)
    y_span = max(y_max - y_min, 1e-9)
    pad_x = x_span * INSET_PADDING_RATIO
    pad_y = y_span * INSET_PADDING_RATIO
    x_min -= pad_x
    x_max += pad_x
    y_min -= pad_y
    y_max += pad_y
    x_span = x_max - x_min
    y_span = y_max - y_min
    scale = INSET_WIDTH / x_span
    inset_height = round(y_span * scale)

    dash_parts = []
    for line in nine_proj:
        coords = []
        for x, y in line.coords:
            px = round((x - x_min) * scale)
            py = round((y_max - y) * scale)
            coords.append(f"{px},{py}")
        if coords:
            dash_parts.append("M" + "L".join(coords))

    island_parts = []
    for geom in islands_proj:
        rings = project_coords(geom, x_min, y_max, scale, scale)
        island_parts.append(rings_to_path(rings))

    return {
        "projection": {"name": "albers", "proj4": ALBERS_PROJ.strip()},
        "box": INSET_BOX,
        "viewBox": [0, 0, INSET_WIDTH, inset_height],
        "dashD": "".join(dash_parts),
        "islandsD": "".join(island_parts),
    }


def emit(level: str):
    folder, shp = LEVELS[level]
    shp_path = BASE / folder / shp
    dbf_path = shp_path.with_suffix(".dbf")

    fields, records = read_dbf(dbf_path)
    gdf = gpd.read_file(shp_path)

    # 字段名是 UTF-8 中文；首字段为名称，FIRST_GID 为行政代码。
    name_field = fields[0][0]

    features = []
    for idx, geom in enumerate(gdf.geometry):
        rec = records[idx]
        name = rec.get(name_field, "").strip()
        code = rec.get("FIRST_GID", str(idx)).strip()
        if not name:
            name = rec.get("ENG_NAME", code)

        # 小面积行政区（港澳）用专属参数，其余仍走全局默认。
        # 两条路径产出的几何**除了这两个 code 之外必须逐字节相同** ——
        # 复核脚本会拿新旧 JSON 逐 feature 比对 `d` / `centroid` / `bbox`。
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
                "code": code,
                "name": name,
                "geom": simplified,
                "decimals": decimals,
            }
        )

    # 计算 Albers 投影坐标系下的总范围。
    all_bounds = [f["geom"].bounds for f in features]
    x_min = min(b[0] for b in all_bounds)
    y_min = min(b[1] for b in all_bounds)
    x_max = max(b[2] for b in all_bounds)
    y_max = max(b[3] for b in all_bounds)

    x_span = max(x_max - x_min, 1e-9)
    y_span = max(y_max - y_min, 1e-9)
    scale = MAIN_MAP_WIDTH / x_span
    # 画布仍按原来的全宽比例定高，主图位于左上方，右下留出海域。
    height = round(y_span * (PROJECT_WIDTH / x_span))

    out_features = []
    for f in features:
        geom = f["geom"]
        dec = f["decimals"]
        rings = project_coords(geom, x_min, y_max, scale, scale)
        path = rings_to_path(rings, dec)
        centroid = geom.centroid
        bbox = geom.bounds
        # centroid / bbox 必须与 `d` 用**同一个精度**：托盘卡片是拿 bbox 当 viewBox 的，
        # bbox 取整而 `d` 不取整，小要素就会偏出卡片取景框（澳门偏半格就够露馅）。
        pt = lambda v: round(v, dec) if dec > 0 else round(v)  # noqa: E731
        cx = pt((centroid.x - x_min) * scale)
        cy = pt((y_max - centroid.y) * scale)
        out_features.append(
            {
                "id": f["id"],
                "name": f["name"],
                "centroid": [cx, cy],
                "bbox": [
                    pt((bbox[0] - x_min) * scale),
                    pt((y_max - bbox[3]) * scale),
                    pt((bbox[2] - x_min) * scale),
                    pt((y_max - bbox[1]) * scale),
                ],
                "d": path,
            }
        )

    # ── 自检：小面积行政区不许再被"坐标取整"塌成方块 ─────────────────────────
    # 这是 v1.0.0 踩过的真坑：澳门改前 8 个顶点全重合、改后（仅调容差）外环 47 个顶点
    # 只落在 4 个不同位置上，界面上就是一个 1×1 的小方块。
    # 判据直接量"最大的那个环有多少个不同坐标"，低于 8 就说明精度又被抹平了。
    for f in features:
        if f["id"] not in SMALL_AREA_OVERRIDES:
            continue
        rings = rings_to_path(
            project_coords(f["geom"], x_min, y_max, scale, scale), f["decimals"]
        ).split("M")
        best = 0
        for seg in rings:
            pts = {p for p in seg.rstrip("Z").split("L") if p}
            best = max(best, len(pts))
        verts = sum(len(s.rstrip("Z").split("L")) for s in rings if s)
        status = "✔" if best >= 8 else "✘ 精度被抹平"
        print(f"  [小面积] {f['id']} {f['name']}: 顶点={verts} "
              f"最大环不同坐标={best} 容差={SMALL_AREA_OVERRIDES[f['id']][0]}m "
              f"小数位={f['decimals']} {status}")
        assert best >= 8, (
            f"{f['id']} 的几何在输出精度下塌陷了（最大环只有 {best} 个不同坐标）。"
            f" 检查 SMALL_AREA_OVERRIDES 里的坐标小数位是否被改回 0。"
        )

    payload = {
        "version": GAME_VERSION,
        "level": level,
        "projection": {
            "name": "albers",
            "proj4": ALBERS_PROJ.strip(),
        },
        "viewBox": [0, 0, PROJECT_WIDTH, height],
        "features": out_features,
    }

    if level == "province":
        inset = build_inset(gdf)
        if inset:
            payload["inset"] = inset

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{level}.json"
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    size_kb = out_path.stat().st_size / 1024
    print(f"wrote {out_path}")
    print(f"features: {len(out_features)}")
    print(f"viewBox: {payload['viewBox']}")
    if "inset" in payload:
        inset = payload["inset"]
        print(
            f"inset: viewBox={inset['viewBox']} "
            f"dashParts={inset['dashD'].count('M')} "
            f"islandRings={inset['islandsD'].count('M')}"
        )
    print(f"size: {size_kb:.1f} KB")


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
