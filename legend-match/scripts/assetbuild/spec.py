# -*- coding: utf-8 -*-
"""图例 → 素材来源的映射表 + 存在性/碰撞自检。

来源三类：
  crop:<文件>   从教材图抠出的素材（第 111 项任务产出）
  icon:<set>:<name>  从开放授权图标库取（maki CC0 / mdi Apache-2.0）
  draw:<key>    教材图上没有对应物、图标库也没有的**线状/抽象符号**，
                按教材图实测出的规范（线宽比例、颜色、端点）绘制
"""
import io, json, os, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
def _find_nm():
    """找 @iconify-json 所在目录。

    版本库里不放 node_modules（图标库体积大、可由 npm 重装），所以仓库里那份脚本
    在原位跑不到依赖 —— 工作时是把脚本复制到 .workbuddy/tmp/iconsets/ 下跑的。
    这里两级回退：先看本目录，再找 .workbuddy/tmp/iconsets/。
    """
    cand = os.path.join(HERE, "node_modules", "@iconify-json")
    if os.path.isdir(cand):
        return cand
    for up in ("..", "../..", "../../.."):
        r = os.path.abspath(os.path.join(HERE, *_up_split(up)))
        c = os.path.join(r, ".workbuddy", "tmp", "iconsets", "node_modules", "@iconify-json")
        if os.path.isdir(c):
            return c
    raise SystemExit("找不到 @iconify-json：请在本目录 npm i，或在 .workbuddy/tmp/iconsets 下运行")


def _up_split(up):
    return [x for x in up.split("/") if x]


NM = _find_nm()
CACHE = {}


def icon_body(setname, name):
    if setname not in CACHE:
        CACHE[setname] = json.load(io.open(os.path.join(NM, setname, "icons.json"), encoding="utf-8"))
    d = CACHE[setname]
    ic = d["icons"].get(name)
    if ic is None:
        al = (d.get("aliases") or {}).get(name)
        if al is None:
            return None
        ic = d["icons"].get(al["parent"]) if "parent" in al else al
        if ic is None:
            return None
    w = ic.get("width", d.get("width", 24))
    h = ic.get("height", d.get("height", 24))
    return ic["body"], w, h


# ---------------------------------------------------------------- 类目色板
# 取自教材图实测到的用色（国界=墨黑、河流=湖蓝、洲界=品红、公路=品红、高速公路=橙、
# 水电站=翠绿），再按类目归并成一套，保证"图标库素材"和"教材抠图"是同一套颜色语言。
CAT_COLOR = {
    "city":      "#221f1c",   # 居民点与城市 —— 教材用墨黑
    "boundary":  "#c2185b",   # 行政区划与界线 —— 教材「洲界」用品红
    "terrain":   "#3a3129",   # 地形与地貌 —— 教材「山峰」用墨黑偏棕
    "water":     "#2f9fd8",   # 河流与水域 —— 教材河流用湖蓝
    "transport": "#e8a33d",   # 交通与航线 —— 教材「高速公路」用橙
    "resource":  "#3f9b5a",   # 资源与能源 —— 教材「水电站」用翠绿
    "heritage":  "#8d6e63",   # 人文景观
    "mapbase":   "#3f51b5",   # 地图基础
    "climate":   "#00838f",   # 气候图线
}

CAT_OF = {c: c for c in CAT_COLOR}   # 类目 id 与色板键同名，直接用


# 单条覆盖：类目色在语义上不对的（教材惯例里矿产符号是**黑色**，冰是**冰蓝**）。
# 只覆盖确实需要的那几条，其余仍走类目色 —— 类目色是"一眼分组"的依据，不能乱动。
COLOR_OVERRIDE = {
    "煤矿": "#3a3129", "铁矿": "#3a3129", "有色金属矿": "#3a3129",
    "石油": "#3a3129", "天然气": "#3a3129",
    "冰川": "#6fb0d8", "常年积雪": "#8fc3e0", "珊瑚礁": "#dd6f8c",
    "沼泽": "#6b8e4e", "渔场": "#2f9fd8", "火电站": "#a45a2a", "盐场": "#7fa8c0",
}

# ---------------------------------------------------------------- 映射表
# 键 = legends.json 里的图例名
SPEC = {
    # —— 教材图抠图（24 个）——
    "居民点": "crop:crop_01.png",
    "公路": "crop:crop_02.png",
    "铁路": "crop:crop_03.png",
    "高速铁路": "crop:crop_04.png",
    "高速公路": "crop:crop_05.png",
    "山峰": "crop:crop_06.png",
    "火山": "crop:crop_07.png",
    "洲界": "crop:crop_08.png",
    "长城": "crop:crop_09.png",
    "关隘": "crop:crop_10.png",
    "水库": "crop:crop_11.png",
    "水电站": "crop:crop_12.png",
    "国界": "crop:crop_13.png",
    "未定国界": "crop:crop_14.png",
    "机场": "crop:crop_15.png",
    "沙漠": "crop:crop_16.png",
    "时令河": "crop:crop_17.png",
    "时令湖": "crop:crop_17b.png",
    "中国省、自治区、直辖市界": "crop:crop_18.png",
    "港口": "crop:crop_19.png",
    "航海线": "crop:crop_20.png",
    "瀑布": "crop:crop_21.png",
    "常年河": "crop:crop_22.png",
    "湖泊": "crop:crop_22b.png",

    # —— 图标库（开放授权真实素材）——
    "首都": "icon:mdi:star",
    "省级行政中心": "icon:mdi:circle-double",
    "一般城市": "icon:mdi:circle-outline",
    "外国首都": "icon:mdi:star-outline",
    "沼泽": "icon:maki:wetland",
    "冰川": "icon:game-icons:iceberg",
    "常年积雪": "icon:mdi:snowflake-variant",
    "珊瑚礁": "icon:game-icons:coral",
    "三角洲": "icon:mdi:delta",
    "泉": "icon:maki:hot-spring",
    "海峡": "icon:mdi:waves-arrow-right",
    "隧道": "icon:mdi:tunnel-outline",
    "桥梁": "icon:mdi:bridge",
    "煤矿": "icon:mdi:pickaxe",
    "铁矿": "icon:mdi:anvil",
    "石油": "icon:mdi:oil",
    "天然气": "icon:mdi:fire",
    "有色金属矿": "icon:mdi:diamond-stone",
    "火电站": "icon:mdi:factory",
    "核电站": "icon:mdi:radioactive",
    "渔场": "icon:mdi:fish",
    "盐场": "icon:mdi:cube-outline",
    "名胜古迹": "icon:mdi:bank",
    "自然保护区": "icon:mdi:pine-tree",
    "指向标": "draw:north_arrow",
    "台风路径": "path:typhoon",

    # —— 绘制（教材图与图标库都没有的线状/抽象符号）——
    "地区界": "draw:boundary_region",
    "特别行政区界": "draw:boundary_sar",
    "等高线": "draw:contour",
    "等深线": "draw:isobath",
    "海岸线": "draw:coastline",
    "海沟": "draw:trench",
    "板块界线": "draw:plate",
    "运河": "draw:canal",
    "引水路线": "draw:water_diversion",
    "复线铁路": "draw:rail_double",
    "管道": "draw:pipeline",
    "航空线": "draw:air_route",
    "输电线路": "draw:powerline",
    "比例尺": "draw:scalebar",
    "经线": "draw:meridian",
    "纬线": "draw:parallel",
    "赤道": "draw:equator",
    "南北回归线": "draw:tropic",
    "南北极圈": "draw:polar",
    "等温线": "draw:isotherm",
    "等降水量线": "draw:isohyet",
    "寒潮路径": "path:coldwave",
    "沙尘暴路径": "path:sandstorm",
}


def main():
    lm = json.load(io.open(r"E:\Self\workspace\eduplay-games\legend-match\public\data\legends.json",
                           encoding="utf-8"))
    names = [x["name"] for x in lm["legends"]]
    print("legends.json 图例数:", len(names))
    miss = [n for n in names if n not in SPEC]
    extra = [n for n in SPEC if n not in names]
    print("映射表缺失:", miss or "无")
    print("映射表多余:", extra or "无")

    # 图标存在性
    bad = []
    for n, s in SPEC.items():
        if s.startswith("icon:"):
            _, setname, iname = s.split(":", 2)
            if icon_body(setname, iname) is None:
                bad.append((n, s))
    print("图标不存在:", bad or "无")

    # 碰撞：同一条 icon 不能给两个图例
    used = defaultdict(list)
    for n, s in SPEC.items():
        if s.startswith("icon:"):
            used[s].append(n)
    dup = {k: v for k, v in used.items() if len(v) > 1}
    print("图标碰撞:", dup or "无")

    # 抠图文件是否存在
    missing_files = []
    for n, s in SPEC.items():
        if s.startswith("crop:"):
            p = os.path.join(HERE, "crops_out", s.split(":", 1)[1])
            if not os.path.isfile(p):
                missing_files.append((n, s))
    print("抠图文件缺失:", missing_files or "无")

    from collections import Counter
    print("来源分布:", Counter(s.split(":")[0] for s in SPEC.values()))


if __name__ == "__main__":
    main()
