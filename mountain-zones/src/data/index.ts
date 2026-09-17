/**
 * 内置山体清单。
 *
 * 四座山按「垂直带谱的完整程度」挑选，覆盖三种典型情形：
 *  - 贡嘎山：低纬（29.6°N）+ 极大高差（2200→7400 m），5 条带谱齐全，最标准的教科书案例
 *  - 珠穆朗玛峰：低纬 + 最高，但北坡山脚已在青藏高原面 3900 m 以上，只有上部 2~3 条带
 *  - 梅里雪山：低纬 + 高差大，与贡嘎同为横断山区，可作对照
 *  - 太白山：中纬（34.0°N）+ 中低山（830→3740 m），看「纬度升高后同海拔带谱整体下移」
 */
import { dem as gongga } from "./dem-gongga";
import { dem as everest } from "./dem-everest";
import { dem as meili } from "./dem-meili";
import { dem as taibai } from "./dem-taibai";
import type { DemSource } from "./types";

export type { DemSource, DemField } from "./types";

/** 面板里的切换顺序：按纬度从低到高 */
export const DEM_SOURCES: DemSource[] = [gongga, everest, meili, taibai];

export function sourceByTag(tag: string): DemSource {
  const hit = DEM_SOURCES.find((s) => s.tag === tag);
  return hit ?? DEM_SOURCES[0];
}
