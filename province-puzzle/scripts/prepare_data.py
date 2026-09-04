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

# 投影后简化容差（米）。越大越精简，但边界越粗糙。
SIMPLIFY_TOLERANCE_METERS = 3800.0
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
    """把投影坐标系几何转成 SVG 视图坐标。"""
    out = []
    for poly in geometry.geoms if isinstance(geometry, MultiPolygon) else [geometry]:
        poly_rings = []
        rings = [poly.exterior] + list(poly.interiors)
        for ring in rings:
            coords = []
            for x, y in ring.coords:
                px = round((x - x_min) * x_scale)
                py = round((y_max - y) * y_scale)
                coords.append((px, py))
            poly_rings.append(coords)
        out.append(poly_rings)
    return out


def rings_to_path(polygons):
    parts = []
    for poly_rings in polygons:
        for ring in poly_rings:
            if not ring:
                continue
            d = "M" + "L".join(f"{x},{y}" for x, y in ring) + "Z"
            parts.append(d)
    return "".join(parts)


def filter_geometry(geom):
    """保留主岛，剔除远海碎岛。"""
    if isinstance(geom, Polygon):
        geom = MultiPolygon([geom])
    keep = []
    for poly in geom.geoms:
        if poly.is_empty:
            continue
        if poly.area < MIN_ISLAND_AREA:
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

        cleaned = filter_geometry(geom)
        if cleaned is None:
            continue
        projected = reproject(cleaned, gdf.crs, ALBERS_CRS)
        simplified = projected.simplify(
            SIMPLIFY_TOLERANCE_METERS, preserve_topology=True
        )
        if simplified.is_empty:
            continue
        features.append(
            {
                "id": code,
                "code": code,
                "name": name,
                "geom": simplified,
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
        rings = project_coords(geom, x_min, y_max, scale, scale)
        path = rings_to_path(rings)
        centroid = geom.centroid
        cx = round((centroid.x - x_min) * scale)
        cy = round((y_max - centroid.y) * scale)
        bbox = geom.bounds
        out_features.append(
            {
                "id": f["id"],
                "name": f["name"],
                "centroid": [cx, cy],
                "bbox": [
                    round((bbox[0] - x_min) * scale),
                    round((y_max - bbox[3]) * scale),
                    round((bbox[2] - x_min) * scale),
                    round((y_max - bbox[1]) * scale),
                ],
                "d": path,
            }
        )

    payload = {
        "version": "0.3.3",
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
