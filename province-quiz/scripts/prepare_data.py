"""生成省级识别游戏数据：从行政区拼图插件复制省界，去掉南海小地图字段。"""
import json
import pathlib

SOURCE = (
    pathlib.Path(__file__).resolve().parent.parent.parent
    / "province-puzzle"
    / "src"
    / "data"
    / "province.json"
)
OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "src" / "data"
OUT_PATH = OUT_DIR / "provinces.json"


def main():
    payload = json.loads(SOURCE.read_text(encoding="utf-8"))
    payload.pop("inset", None)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"wrote {OUT_PATH}")
    print(f"features: {len(payload['features'])}")
    print(f"size: {OUT_PATH.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
