#!/usr/bin/env python3
"""把行政区划 Shapefile 转成游戏可用的紧凑 GeoJSON 数据。

用法:
  python prepare_data.py --level province --inspect
  python prepare_data.py --level province --emit
"""

import argparse
import json
import math
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

# 简化容差（度）。越大越精简，但边界越粗糙。
SIMPLIFY_TOLERANCE = 0.05
# 投影后的地图宽度（视图单位）。
PROJECT_WIDTH = 1200
# 南海诸岛等远离主岛的碎岛，纬度低于该值则剔除（保留海南主岛）。
MIN_ISLAND_LAT = 18.0
MIN_ISLAND_AREA = 0.0002


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


def project_coords(geometry, lon0, lat_max, xscale, yscale):
    """把 WGS84 坐标投影成 SVG 视图坐标（整数）。"""
    out = []
    for poly in geometry.geoms if isinstance(geometry, MultiPolygon) else [geometry]:
        poly_rings = []
        rings = [poly.exterior] + list(poly.interiors)
        for ring in rings:
            coords = []
            for x, y in ring.coords:
                px = round((x - lon0) * xscale)
                py = round((lat_max - y) * yscale)
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
        simplified = cleaned.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)
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

    # 计算投影参数。
    all_bounds = [f["geom"].bounds for f in features]
    lon_min = min(b[0] for b in all_bounds)
    lon_max = max(b[2] for b in all_bounds)
    lat_min = min(b[1] for b in all_bounds)
    lat_max = max(b[3] for b in all_bounds)

    mid_lat = math.radians((lat_min + lat_max) / 2)
    cos_lat = math.cos(mid_lat)
    lon_span = max(lon_max - lon_min, 1e-9)
    lat_span = max(lat_max - lat_min, 1e-9)
    scale = PROJECT_WIDTH / (lon_span * cos_lat)
    xscale = cos_lat * scale
    yscale = scale
    height = round(lat_span * yscale)

    out_features = []
    for f in features:
        geom = f["geom"]
        rings = project_coords(geom, lon_min, lat_max, xscale, yscale)
        path = rings_to_path(rings)
        centroid = geom.centroid
        cx = round((centroid.x - lon_min) * xscale)
        cy = round((lat_max - centroid.y) * yscale)
        bbox = geom.bounds
        out_features.append(
            {
                "id": f["id"],
                "name": f["name"],
                "centroid": [cx, cy],
                "bbox": [
                    round((bbox[0] - lon_min) * xscale),
                    round((lat_max - bbox[3]) * yscale),
                    round((bbox[2] - lon_min) * xscale),
                    round((lat_max - bbox[1]) * yscale),
                ],
                "d": path,
            }
        )

    payload = {
        "version": "0.2.0",
        "level": level,
        "viewBox": [0, 0, PROJECT_WIDTH, height],
        "features": out_features,
    }

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
