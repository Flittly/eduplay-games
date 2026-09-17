/**
 * 应用核心：把「参数」变成「一屏能看的东西」。
 *
 * React 组件只管 UI 与状态，所有派生计算都在这里 ——
 * 这样回归脚本可以用 `window.__mountainDebug` 直接驱动核心，
 * 不必去点 DOM，测的也就是真实逻辑而不是「测试脚本自己造的假状态」。
 *
 * ## 重算代价的分配（很关键）
 *
 * 不同参数影响的链路长度差很多，全部重算会让拖动滑块卡顿：
 *
 * | 参数              | 影响的派生数据                        | 代价         |
 * |-------------------|---------------------------------------|--------------|
 * | 山体              | 全部                                  | 重建 field   |
 * | 高程偏移 / 夸张   | 海拔 → 带谱 + 等高线 + 径流 + 顶点色  | 中（~百 ms） |
 * | 纬度 / 季节       | 带谱 + 径流 + 顶点色（**不含等高线**）| 小           |
 * | 等高距 / 开关     | 只重算等高线                          | 小           |
 *
 * 季节**不影响等高线**（海拔没变），所以切季节时跳过等高线提取 ——
 * 这正是「带谱随季节不变、只有雪线与地表覆盖会变」那条结论在工程上的体现。
 */

import { applyElevation, altitudeAtWorld, createField, heightFn, sampleGrid, worldToGrid } from "./dem";
import type { DemField } from "./data/types";
import { DEM_SOURCES, sourceByTag } from "./data";
import { createView3d, type HoverHit, type View3dHandle, type ViewMode } from "./view3d";
import { extractAll, levelsFor, type ContourLevel } from "./contour";
import { buildRunoff, runoffSummary, type RunoffNetwork } from "./runoff";
import {
  bandsFor, baseBelt, beltAt, beltColor, beltDef, densityAt, snowline, snowlineAnnual,
  tempAt, tempAtSeason, treeline, type Band, type BeltId, type SeasonId
} from "./zonation";

export type { ViewMode } from "./view3d";

export type WeatherMode = "clear" | "light" | "heavy";
export const WEATHER_RAIN: Record<WeatherMode, number> = { clear: 0, light: 0.45, heavy: 1 };

export interface Params {
  mountainTag: string;
  /** 山体纬度（切山时跳到真实纬度，仍可手滑） */
  lat: number;
  season: SeasonId;
  /** 等高距（米） */
  contourInterval: number;
  showContours: boolean;
  /** 是否按自然带着色（关掉就是裸地形） */
  showBands: boolean;
  /** 清单里点选要高亮的那条等高线（米）；null = 不高亮 */
  highlightLevel: number | null;
  weather: WeatherMode;
  mode: ViewMode;
  /** 垂直夸张（纯视觉，不改海拔） */
  verticalExaggeration: number;
  /** 高程偏移（米，真改海拔） */
  elevationOffset: number;
}

export interface HoverReadout {
  gx: number;
  gy: number;
  alt: number;
  belt: BeltId;
  beltName: string;
  /** 年均温（℃）—— 带谱的依据 */
  tempAnnual: number;
  /** 当下季节的气温（℃） */
  tempSeason: number;
  density: number;
  /** 季节性积雪（雪线已降到这个海拔，但带谱本身没变） */
  seasonalSnow: boolean;
  aboveTreeline: boolean;
  aboveSnowline: boolean;
}

export interface Snapshot {
  mountainTag: string;
  name: string;
  peakName: string;
  peakAltitude: number;
  lat: number;
  lon: number;
  spanKm: number;
  grid: number;
  /** 真实 DEM 的范围（不受滑块影响） */
  demMin: number;
  demMax: number;
  /** 当前海拔范围 */
  minH: number;
  maxH: number;
  /** 当前最高点海拔（= 拖偏移后山顶的实际高度） */
  currentPeak: number;
  verticalExaggeration: number;
  elevationOffset: number;
  modified: boolean;
  baseBelt: BeltId;
  baseBeltName: string;
  bands: Band[];
  treeline: number;
  snowlineAnnual: number;
  snowlineNow: number;
  contourLevels: number[];
  contourCount: number;
  runoff: {
    rain: number;
    channelLengthKm: number;
    trunkKm: number;
    channels: number;
    totalProduced: number;
    text: string;
  };
  mode: ViewMode;
  season: SeasonId;
  weather: WeatherMode;
  showContours: boolean;
  showBands: boolean;
  contourInterval: number;
  /** 清单里点选要高亮的那条等高线（米） */
  highlightLevel: number | null;
  hover: HoverReadout | null;
}

export interface Engine {
  readonly field: DemField;
  readonly params: Params;
  readonly contours: ContourLevel[];
  readonly runoff: RunoffNetwork;
  readonly view: View3dHandle | null;
  mount(container: HTMLElement): void;
  /** 应用参数（可只给部分）并返回新快照 */
  apply(patch?: Partial<Params>): Snapshot;
  snapshot(): Snapshot;
  /** 鼠标拾取（client 坐标），更新 hover 读数 */
  hoverAt(clientX: number, clientY: number): HoverReadout | null;
  clearHover(): void;
  dispose(): void;
}

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** 裸地形色（关掉自然带配色时用）：暖灰岩土，随海拔略微变亮 */
function rockColor(alt: number, minH: number, maxH: number): [number, number, number] {
  const t = (alt - minH) / Math.max(1, maxH - minH);
  const base = 0.40 + 0.30 * t;
  return [base * 1.06, base * 0.97, base * 0.86];
}

export function createEngine(initial: Partial<Params> = {}): Engine {
  let params: Params = {
    mountainTag: DEM_SOURCES[0].tag,
    lat: DEM_SOURCES[0].lat,
    season: "summer",
    contourInterval: 200,
    showContours: true,
    showBands: true,
    highlightLevel: null,
    weather: "clear",
    mode: "observe",
    verticalExaggeration: 1,
    elevationOffset: 0,
    ...initial
  };

  let field: DemField = createField(sourceByTag(params.mountainTag));
  let contours: ContourLevel[] = [];
  let runoff: RunoffNetwork = buildRunoff(field, params.lat, params.season, WEATHER_RAIN[params.weather]);
  let hover: HoverReadout | null = null;
  let view: View3dHandle | null = null;

  /** 顶点色：按自然带（或裸地形） */
  function colorOf(alt: number): [number, number, number] {
    if (!params.showBands) {
      return rockColor(alt, field.minH, field.maxH);
    }
    return hexToRgb(beltColor(beltAt(params.lat, alt, params.season), params.season));
  }

  function recomputeContours(): void {
    const levels = levelsFor(field.minH, field.maxH, params.contourInterval, 0);
    // 上限保护：等高距太小时线会多到没意义（也让提取变慢）
    const capped = levels.length > 80
      ? levels.filter((_, i) => i % Math.ceil(levels.length / 80) === 0)
      : levels;
    contours = extractAll(heightFn(field), field.grid, capped);
  }

  function recomputeRunoff(): void {
    runoff = buildRunoff(field, params.lat, params.season, WEATHER_RAIN[params.weather]);
  }

  function apply(patch: Partial<Params> = {}): Snapshot {
    const prev = params;
    params = { ...params, ...patch };

    const mountainChanged = params.mountainTag !== prev.mountainTag;
    if (mountainChanged) {
      field = createField(sourceByTag(params.mountainTag));
      // 切山时纬度跳到该山的真实纬度（除非调用方显式指定了纬度）
      if (patch.lat === undefined) {
        params.lat = field.source.lat;
      }
      applyElevation(field, params.verticalExaggeration, params.elevationOffset);
      recomputeContours();
      recomputeRunoff();
      view?.refresh(field, colorOf);
      view?.setSun(params.season);
      return snapshot();
    }

    const elevationChanged =
      params.verticalExaggeration !== prev.verticalExaggeration ||
      params.elevationOffset !== prev.elevationOffset;
    const climateChanged = params.lat !== prev.lat || params.season !== prev.season;
    const contourSpecChanged =
      params.contourInterval !== prev.contourInterval ||
      params.showContours !== prev.showContours;
    const bandChanged = params.showBands !== prev.showBands;
    const weatherChanged = params.weather !== prev.weather;
    const highlightChanged = params.highlightLevel !== prev.highlightLevel;

    if (elevationChanged) {
      applyElevation(field, params.verticalExaggeration, params.elevationOffset);
      recomputeContours();
      recomputeRunoff();
    } else if (climateChanged || weatherChanged) {
      // 季节/纬度/雨势都不改海拔，所以等高线**不用重算** —— 它们本来就是同一条线
      recomputeRunoff();
    } else if (contourSpecChanged) {
      recomputeContours();
    }

    if (elevationChanged || climateChanged || bandChanged) {
      view?.refresh(field, colorOf);
    }
    if (climateChanged) {
      view?.setSun(params.season);
    }
    if (contourSpecChanged || elevationChanged || highlightChanged) {
      view?.setContours({
        enabled: params.showContours,
        interval: params.contourInterval,
        majorEvery: 5,
        opacity: 0.5,
        highlight: params.highlightLevel
      });
    }
    if (params.mode !== prev.mode) {
      view?.setMode(params.mode);
    }
    return snapshot();
  }

  function readHover(hit: HoverHit): HoverReadout {
    const alt = hit.alt;
    const belt = beltAt(params.lat, alt, params.season);
    const snowAnnual = snowlineAnnual(params.lat);
    const snowNow = snowline(params.lat, params.season);
    return {
      gx: hit.gx,
      gy: hit.gy,
      alt,
      belt,
      beltName: beltDef(belt).name,
      tempAnnual: tempAt(params.lat, alt),
      tempSeason: tempAtSeason(params.lat, alt, params.season),
      density: densityAt(params.lat, alt, params.season, field.maxH),
      seasonalSnow: belt !== "snow" && alt >= snowNow && alt < snowAnnual,
      aboveTreeline: alt > treeline(params.lat, params.season),
      aboveSnowline: belt === "snow"
    };
  }

  function snapshot(): Snapshot {
    const base = baseBelt(params.lat, params.season);
    const bands = bandsFor(params.lat, params.season, field.maxH);
    return {
      mountainTag: field.source.tag,
      name: field.source.name,
      peakName: field.source.peakName,
      peakAltitude: field.source.peakAltitude,
      lat: params.lat,
      lon: field.source.lon,
      spanKm: field.source.spanKm,
      grid: field.grid,
      demMin: field.source.demMin,
      demMax: field.source.demMax,
      minH: field.minH,
      maxH: field.maxH,
      currentPeak: field.maxH,
      verticalExaggeration: field.verticalExaggeration,
      elevationOffset: field.elevationOffset,
      modified: Math.abs(field.verticalExaggeration - 1) > 1e-6 || Math.abs(field.elevationOffset) > 1e-6,
      baseBelt: base,
      baseBeltName: beltDef(base).name,
      bands,
      treeline: treeline(params.lat, params.season),
      snowlineAnnual: snowlineAnnual(params.lat),
      snowlineNow: snowline(params.lat, params.season),
      contourLevels: contours.map((c) => c.level),
      contourCount: contours.length,
      runoff: {
        rain: runoff.rain,
        channelLengthKm: runoff.channelLengthM / 1000,
        trunkKm: runoff.trunkLengthM / 1000,
        channels: runoff.channels.length,
        totalProduced: runoff.totalProduced,
        text: runoffSummary(runoff)
      },
      mode: params.mode,
      season: params.season,
      weather: params.weather,
      showContours: params.showContours,
      showBands: params.showBands,
      contourInterval: params.contourInterval,
      highlightLevel: params.highlightLevel,
      hover
    };
  }

  const engine: Engine = {
    get field() {
      return field;
    },
    get params() {
      return params;
    },
    get contours() {
      return contours;
    },
    get runoff() {
      return runoff;
    },
    get view() {
      return view;
    },
    mount(container: HTMLElement) {
      view = createView3d(container);
      view.refresh(field, colorOf);
      view.setSun(params.season);
      view.setMode(params.mode);
      view.setContours({
        enabled: params.showContours,
        interval: params.contourInterval,
        majorEvery: 5,
        opacity: 0.5,
        highlight: params.highlightLevel
      });
      if (contours.length === 0) {
        recomputeContours();
      }
    },
    apply,
    snapshot,
    hoverAt(clientX: number, clientY: number) {
      if (!view) {
        return null;
      }
      const hit = view.pick(clientX, clientY);
      hover = hit ? readHover(hit) : null;
      return hover;
    },
    clearHover() {
      hover = null;
    },
    dispose() {
      view?.dispose();
      view = null;
    }
  };

  // 初始就给一份完整的派生数据，避免首帧空窗
  recomputeContours();
  recomputeRunoff();

  return engine;
}

/** 供 UI 与调试共用的辅助：某海拔属于哪个带 */
export function beltAtAltitude(lat: number, alt: number, season: SeasonId): BeltId {
  return beltAt(lat, alt, season);
}

export { altitudeAtWorld, sampleGrid, worldToGrid };
