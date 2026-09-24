/**
 * 口袋地形（原「真实地形山地」）主界面。
 *
 * 布局：
 *   ┌────────┬──────────────────────────────┐
 *   │        │   三维视图（three.js）        │
 *   │ 参数栏 ├──────────────────────────────┤
 *   │        │   等高线栏（三页签，横跨底部）│
 *   └────────┴──────────────────────────────┘
 *
 * 所有派生数据都从 `Engine` 拿，本组件不自己算地理量 ——
 * 这样回归脚本用 `window.__mountainDebug` 驱动引擎时，
 * 测到的是与界面完全相同的一份逻辑。
 *
 * ## v2.4.0：入口分两档
 *
 * 清单拆成 `TEMPLATE_SOURCES`（模板地形，示意、入门）与 `REAL_SOURCES`
 * （真实 DEM，进阶），选择器分两组、**模板在前** —— 默认进游戏看到的是模板山地。
 * 两档的区别不止是排序，界面上有三处必须跟着分流：
 *
 * 1. 「地理位置」栏：模板不画中国地图，改画说明卡（模板没有真实经纬度）；
 * 2. 页脚数据来源：模板不是 AWS Terrain Tiles 来的；
 * 3. 图鉴卡片：加一个「模板」角标。
 *
 * ⚠️ 最容易漏的是第 1 条，而且**漏了不报错**：`locationByTag()` 查不到模板的 tag
 * 时会回退到第一个真实样本（贡嘎山 / 四川省），占位坐标 30°N/105°E 又落在国界内，
 * 于是模板山地会顶着一张「四川省 · 大雪山」的标签、画着一个看着很正常的红点。
 * 这条静默回退由 `scripts/locmap.test.cjs` 第 6 节钉住。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createEngine, MAX_PROFILE_SEGMENTS, type Engine, type Params, type Pt, type Snapshot
} from "./engine";
import { REAL_SOURCES, TEMPLATE_SOURCES, sourceByTag } from "./data";
import { LANDFORMS, type LandformEntry } from "./data/landforms";
import { CHINA_MAP } from "./data/china-map";
import { locationByTag } from "./data/locations";
import LocationMap from "./LocationMap";
import { drawPlanMap, drawProfile, drawProfileCompare, PART_COLORS, PROFILE_COLORS } from "./panels";
import { CONTOUR_INTERVAL_STEPS, RIDGE_TPI, type ContourLevel } from "./contour";
import { exagToSlider, sliderToExag, EXAGGERATION_SLIDER_STEPS } from "./dem";
import { channelSegments } from "./runoff";
import { compassLabel } from "./profile";
import {
  LAND_PARTS, LAND_TYPES, LAND_PART_CAP, landPartDef, landTypeDef, isCappedPart,
  type LandPartId, type LandTypeId
} from "./landform";
import {
  BELTS, SEASON_LABEL, SEASONS, beltColor, beltDef, type SeasonId
} from "./zonation";

type Tab = "plan" | "list" | "profile" | "dex";
/** 图鉴筛选：某类型 / 某部位 / 全部 */
type DexFilter<T extends string> = T | "all";

/**
 * 这一类部位在**当前样本**上画不画得出来。
 *
 * 灰化判据刻意不是"检出数 > 0"：川中丘陵检出 1 处山脊、2 处山谷，
 * 但那几格是彼此孤立的点，骨架化之后**一条线都没有** ——
 * 按钮亮着却什么也画不出来，学生只会以为功能坏了。
 * 所以判据取"有没有可画的东西"：
 *   峰/鞍/崖 = 有点位；脊/谷 = 有折线。
 * 图鉴里显示的仍是**原始检出数**（那是检测的产物，不该被显示层改写）。
 */
function partDrawable(snap: Snapshot, id: LandPartId): boolean {
  const lf = snap.landform;
  switch (id) {
    case "peak":
      return lf.peaks.length > 0;
    case "saddle":
      return lf.saddles.length > 0;
    case "cliff":
      return lf.cliffs.length > 0;
    case "ridge":
      return lf.ridgeLines.length > 0;
    case "valley":
      return lf.valleyLines.length > 0;
  }
}

export interface PlayerInfo {
  studentId: number;
  studentName: string;
  className?: string | null;
  studentNo?: string;
}

const WEATHER_LABEL: Record<Params["weather"], string> = {
  clear: "晴",
  light: "小雨",
  heavy: "大雨"
};
const WEATHER_ORDER: Array<Params["weather"]> = ["clear", "light", "heavy"];
/**
 * 垂直夸张的快捷档。
 *
 * v2.4.1 换了区间（上限 2 → 20）之后档位也重排：
 * 低段仍是"手动微调"要用的值（1 / 1.5 / 2），高段是各样本自动推荐值附近
 * 的档（5 / 10 / 20）—— 高原要 ×6、平原要 ×20，以前那套 0.5~2 的档
 * 根本表示不了它们。
 */
const EXAGGERATION_STEPS = [1, 1.5, 2, 5, 10, 20];

/**
 * 「点击画点」还是「拖动转视角」的判据。
 *
 * 三维视图里指针按下必然同时意味着两件事之一：要么学生想在地形上点一个点，
 * 要么他想拖着转个角度看背面。OrbitControls 自己不管这个 —— 它只要收到
 * pointerdown + move 就转。所以必须由我们判定，判据有两条，**都要满足**才算点击：
 *   位移 < 4 px（手指/鼠标的生理抖动约 1~2 px）
 *   时长 < 500 ms（想画点的人不会按住半秒）
 * 只判位移不够：学生按着不动先想一下再移开，松手时位移可能很小，
 * 但视角已经被转走了一点，那次点击就不再是他"看到的位置"了。
 */
const CLICK_MOVE_PX = 4;
const CLICK_MS = 500;
/** 端点命中半径（屏幕像素）。太小点不中，太大两个端点会互相抢 */
const ENDPOINT_HIT_PX = 14;

/**
 * 快照里的剖面段 → 图纸要的「网格坐标 + 颜色」。
 *
 * 颜色只由序号决定（`PROFILE_COLORS`），不存进 `Params` —— 颜色是呈现层的事，
 * 存进参数里会让"同一段在三维、平面图、投影图纸、剖面对比图"四处必须同步改，
 * 而它们本来就该永远是同一色。四处都从这一个函数取，撞不了色。
 */
function segmentsOf(s: Snapshot): Array<{ a: [number, number]; b: [number, number]; color: string }> {
  return s.segments.map((x, k) => ({
    a: [x.a[0], x.a[1]],
    b: [x.b[0], x.b[1]],
    color: PROFILE_COLORS[k % PROFILE_COLORS.length]
  }));
}

declare global {
  interface Window {
    __mountainDebug?: Record<string, unknown>;
  }
}

export default function MountainZones({ roster = [] }: { roster?: PlayerInfo[] }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState<Tab>("plan");
  const [errors, setErrors] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /** 是否处于「在地形上画剖面」模式（关掉时点选不生效，避免误触） */
  const [pickMode, setPickMode] = useState(false);
  /** 已点下、还没配上终点的起点 */
  const [pending, setPending] = useState<{ p: Pt; alt: number } | null>(null);
  /** 上一次被拒的原因（太短 / 超过 4 段），照实念给学生听 */
  const [notice, setNotice] = useState<string | null>(null);
  /** 图鉴筛选：按地形类型 / 按地形部位，两者可叠加 */
  const [dexType, setDexType] = useState<DexFilter<LandTypeId>>("all");
  const [dexPart, setDexPart] = useState<DexFilter<LandPartId>>("all");

  // ---------- 引擎初始化（只跑一次） ----------
  useEffect(() => {
    const host = hostRef.current;
    if (!host || engineRef.current) {
      return;
    }
    let engine: Engine | null = null;
    try {
      engine = createEngine();
      engine.mount(host);
    } catch (e) {
      setErrors(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      return;
    }
    engineRef.current = engine;
    setSnap(engine.snapshot());
    setReady(true);

    const onResize = () => {
      engineRef.current?.view?.resize();
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      engine?.dispose();
      engineRef.current = null;
    };
  }, []);

  // ---------- 参数应用 ----------
  const apply = useCallback((patch: Partial<Params>) => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    try {
      const next = engine.apply(patch);
      setSnap(next);
    } catch (e) {
      setErrors(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  }, []);

  /**
   * 开关一类地形部位的标注。
   *
   * 顺序按 `LAND_PARTS` 归位（不是按点击顺序追加）——
   * 这样快照里的 `showParts` 永远是一个稳定序列，回归断言可以直接比数组，
   * 也免得"先点山谷再点山峰"和反过来产生两份不同的状态。
   */
  const togglePart = useCallback(
    (id: LandPartId) => {
      const cur = engineRef.current?.params.showParts ?? [];
      const set = new Set(cur);
      if (set.has(id)) {
        set.delete(id);
      } else {
        set.add(id);
      }
      apply({ showParts: LAND_PARTS.map((p) => p.id).filter((x) => set.has(x)) });
    },
    [apply]
  );

  // ---------- 画剖面模式开关 ----------  // ⚠ 位置有讲究：它必须定义在「调试钩子」之前。调试钩子的依赖数组是在**渲染时**
  //   求值的，若 togglePickMode 声明在后面，那时它还在 TDZ 里，直接抛 ReferenceError。
  /** 开关画剖面模式；关掉时把没配对的起点一并丢掉 */
  const togglePickMode = useCallback(() => {
    setPickMode((on) => {
      if (on) {
        setPending(null);
      }
      return !on;
    });
    setNotice(null);
  }, []);

  // ---------- 调试钩子（回归脚本用） ----------
  useEffect(() => {
    if (!ready) {
      return;
    }
    window.__mountainDebug = {
      readState: () => engineRef.current?.snapshot() ?? null,
      getParams: () => engineRef.current?.params ?? null,
      setParams: (p: Partial<Params>) => {
        apply(p);
        return engineRef.current?.snapshot() ?? null;
      },
      setMountain: (tag: string) => apply({ mountainTag: tag }),
      setSeason: (s: SeasonId) => apply({ season: s }),
      setLat: (v: number) => apply({ lat: v }),
      setWeather: (w: Params["weather"]) => apply({ weather: w }),
      setMode: (m: Params["mode"]) => apply({ mode: m }),
      setContourInterval: (v: number) => apply({ contourInterval: v }),
      setShowContours: (v: boolean) => apply({ showContours: v }),
      setShowBands: (v: boolean) => apply({ showBands: v }),
      setHighlight: (v: number | null) => apply({ highlightLevel: v }),
      setVerticalExaggeration: (v: number) => apply({ verticalExaggeration: v }),
      setElevationOffset: (v: number) => apply({ elevationOffset: v }),
      setShowProjection: (v: boolean) => apply({ showProjection: v }),
      setShowTerrain: (v: boolean) => apply({ showTerrain: v }),
      setPickMode: (v: boolean) => {
        if (v !== pickMode) {
          togglePickMode();
        }
        return engineRef.current?.snapshot() ?? null;
      },
      /* ---- 剖面段：走的是与界面点击**完全相同**的引擎入口 ---- */
      // ⚠ 每个改动段落的入口都必须顺手 `setSnap(engine.snapshot())`。
      // 光调引擎的话，三维画面会变（rAF 直接读引擎），而侧栏列表 / 剖面页
      // 读的是 React 的 `snap` —— 于是**回归脚本读到"有 4 段"、界面上是 0 段**，
      // 脚本和界面对不上，而且这种不一致完全不会报错。
      segments: () => engineRef.current?.snapshot().segments ?? [],
      addSegment: (ax: number, ay: number, bx: number, by: number) => {
        const engine = engineRef.current;
        if (!engine) {
          return { ok: false, reason: "引擎未就绪" };
        }
        const r = engine.addSegment([ax, ay], [bx, by]);
        setSnap(engine.snapshot());
        return r;
      },
      moveSegmentEnd: (index: number, which: 0 | 1, x: number, y: number) => {
        const engine = engineRef.current;
        if (!engine) {
          return [];
        }
        engine.moveSegmentEnd(index, which, [x, y]);
        setSnap(engine.snapshot());
        return engine.snapshot().segments;
      },
      removeSegment: (index: number) => {
        const engine = engineRef.current;
        if (!engine) {
          return [];
        }
        engine.removeSegment(index);
        setSnap(engine.snapshot());
        return engine.snapshot().segments;
      },
      clearSegments: () => {
        const engine = engineRef.current;
        if (!engine) {
          return [];
        }
        engine.clearSegments();
        setSnap(engine.snapshot());
        return engine.snapshot().segments;
      },
      /** 每条剖面的抽样序列与统计量（不含 DOM，可直接断言） */
      profileSeries: () => engineRef.current?.snapshot().profileSeries ?? [],
      /** 五类地形部位的检测结果 + 被物理闸门剔除的异常格数 */
      landformParts: () => engineRef.current?.snapshot().landform ?? null,
      /** 网格坐标 → 屏幕像素（端点命中判定用，与界面同一条路径） */
      project: (gx: number, gy: number) => engineRef.current?.view?.project(gx, gy) ?? null,
      /** 引擎字段直读（验证脚本核对地形数据是否与源一致） */
      terrainInfo: () => {
        const f = engineRef.current?.field;
        if (!f) {
          return null;
        }
        let maxIdx = 0;
        for (let k = 1; k < f.alt.length; k++) {
          if (f.alt[k] > f.alt[maxIdx]) {
            maxIdx = k;
          }
        }
        return {
          tag: f.source.tag,
          grid: f.grid,
          spanM: f.spanM,
          rawMin: f.source.demMin,
          rawMax: f.source.demMax,
          altMin: f.minH,
          altMax: f.maxH,
          peakI: f.peakI,
          peakJ: f.peakJ,
          peakIdxScan: maxIdx,
          len: f.alt.length,
          exaggeration: f.verticalExaggeration,
          offset: f.elevationOffset
        };
      },
      /** 逐点取样：给回归脚本核对「海拔 = raw + offset」 */
      sampleAt: (i: number, j: number) => {
        const f = engineRef.current?.field;
        if (!f) {
          return null;
        }
        const k = j * f.grid + i;
        return { raw: f.raw[k], alt: f.alt[k] };
      },
      contourLevels: () => engineRef.current?.contours.map((c) => c.level) ?? [],
      contourStats: () =>
        engineRef.current?.contours.map((c) => ({
          level: c.level,
          polylines: c.polylines.length,
          segCount: c.segCount,
          totalLen: c.totalLen
        })) ?? [],
      runoffInfo: () => {
        const r = engineRef.current?.runoff;
        return r
          ? {
              rain: r.rain,
              maxAcc: r.maxAcc,
              channels: r.channels.length,
              channelLengthKm: r.channelLengthM / 1000,
              trunkKm: r.trunkLengthM / 1000,
              totalProduced: r.totalProduced
            }
          : null;
      },
      route: () => engineRef.current?.view?.route() ?? [],
      viewInfo: () => engineRef.current?.view?.debug() ?? null,
      /**
       * 把相机钉在指定位姿（回归取证专用）。
       *
       * 切"二维/三维"开关会触发重新取景 ⇒ 两张截图机位不同 ⇒ 同机位差集失效。
       * 有了它就能"先切状态、再摆回原处再拍"。传 `null` 解除。
       */
      lockCamera: (
        eye: [number, number, number] | null,
        target?: [number, number, number]
      ) => {
        engineRef.current?.view?.lockCamera(eye, target);
        return engineRef.current?.view?.debug() ?? null;
      },
      /**
       * 山脊/山谷点数**与骨架线数**。
       *
       * v2.4.1 起直接读引擎的检出结果，不再在调试钩子里重跑一遍 `ridgeValley`
       * —— 同一份数据算两遍是"两边都可能对、也可能不一样"的来源，
       * 而回归脚本真正要断言的是**界面用的那份**。`tpi` 仍报出来，方便脚本
       * 确认阈值没被改过。
       */
      ridges: () => {
        const engine = engineRef.current;
        const f = engine?.field;
        const s = engine?.snapshot();
        if (!f || !s) {
          return null;
        }
        // scanned：TPI 只扫内部 (n-2R)² 格（默认 R=3），
        // 占比必须拿它当分母 —— 用 n² 当分母会系统性低估约 5%。
        const scanned = (f.grid - 6) * (f.grid - 6);
        return {
          ridge: s.landform.counts.ridge,
          valley: s.landform.counts.valley,
          ridgeLines: s.landform.ridgeLines.length,
          valleyLines: s.landform.valleyLines.length,
          ridgeSkeletonCells: s.landform.ridgeSkeleton.skeletonCells,
          valleySkeletonCells: s.landform.valleySkeleton.skeletonCells,
          scanned,
          grid: f.grid,
          tpi: RIDGE_TPI
        };
      },
      /** 一键开关部位标注（回归脚本用，与界面按钮走同一条 `apply` 路径） */
      setShowParts: (ids: LandPartId[]) => {
        apply({ showParts: ids });
        return engineRef.current?.view?.debug() ?? null;
      },
      /** 三维视图的调试读数（含标注层的实际对象数） */
      viewDebug: () => engineRef.current?.view?.debug() ?? null,
      setTab: (t: Tab) => setTab(t),
      dispose: () => {
        engineRef.current?.dispose();
        engineRef.current = null;
      }
    };
    return () => {
      delete window.__mountainDebug;
    };
  }, [ready, apply, pickMode, togglePickMode]);

  // ---------- 指针：悬停拾取 + 手画剖面 ----------
  const pendRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef(0);
  /** 指针按下时的状态；用来判定这一下是「点击」还是「拖着转视角」 */
  const downRef = useRef<{ x: number; y: number; t: number } | null>(null);
  /** 正在拖动的端点（null = 没在拖） */
  const dragRef = useRef<{ index: number; which: 0 | 1 } | null>(null);

  /**
   * 指针下方最近的剖面端点（屏幕距离判定）。
   *
   * 必须把端点投影到屏幕上再比距离，**不能比网格距离** ——
   * 同样 4 格的差距，在山脚（离相机近、屏幕大）和山那边（远、屏幕小）
   * 对应的像素差了好几倍，而学生瞄的是屏幕。
   */
  const hitEndpoint = useCallback(
    (clientX: number, clientY: number): { index: number; which: 0 | 1 } | null => {
      const view = engineRef.current?.view;
      const segs = engineRef.current?.params.segments;
      if (!view || !segs) {
        return null;
      }
      let bestIndex = -1;
      let bestWhich: 0 | 1 = 0;
      let bestD = ENDPOINT_HIT_PX;
      for (let k = 0; k < segs.length; k++) {
        const ends: Array<[0 | 1, Pt]> = [[0, segs[k].a], [1, segs[k].b]];
        for (const [which, g] of ends) {
          const sc = view.project(g[0], g[1]);
          if (!sc) {
            continue;
          }
          const d = Math.hypot(sc.x - clientX, sc.y - clientY);
          if (d <= bestD) {
            bestD = d;
            bestIndex = k;
            bestWhich = which;
          }
        }
      }
      return bestIndex >= 0 ? { index: bestIndex, which: bestWhich } : null;
    },
    []
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!pickMode) {
        return;
      }
      downRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
      const hit = hitEndpoint(e.clientX, e.clientY);
      dragRef.current = hit;
      if (hit) {
        // 抓住端点后把指针事件锁到这个元素：否则手一滑出画布，拖动就断了。
        // 顺带一个好处 —— 事件被捕获后 OrbitControls 收不到，拖端点时视角不会跟着转。
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setNotice(null);
      }
    },
    [pickMode, hitEndpoint]
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    pendRef.current = { x: e.clientX, y: e.clientY };
    if (rafRef.current) {
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const p = pendRef.current;
      const engine = engineRef.current;
      if (!p || !engine) {
        return;
      }
      const d = dragRef.current;
      if (d) {
        const hit = engine.pickOnly(p.x, p.y);
        if (hit) {
          engine.moveSegmentEnd(d.index, d.which, [hit.gx, hit.gy]);
          setSnap(engine.snapshot());
        }
        return;
      }
      engine.hoverAt(p.x, p.y);
      setSnap((prev) => (prev ? { ...prev, hover: engine.snapshot().hover } : prev));
    });
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const down = downRef.current;
      downRef.current = null;
      if (dragRef.current) {
        dragRef.current = null;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        return;
      }
      if (!pickMode || !down) {
        return;
      }
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved > CLICK_MOVE_PX || performance.now() - down.t > CLICK_MS) {
        return; // 是拖着转视角，不是点选
      }
      const engine = engineRef.current;
      const hit = engine?.pickOnly(e.clientX, e.clientY);
      if (!engine || !hit) {
        return;
      }
      const p: Pt = [hit.gx, hit.gy];
      if (!pending) {
        setPending({ p, alt: hit.alt });
        setNotice(null);
        return;
      }
      const res = engine.addSegment(pending.p, p);
      if (res.ok) {
        setPending(null);
        setNotice(null);
        // ⚠ 这一句必须有。引擎的 segments 变了，**但 React 不会自己知道** ——
        // 少了它，学生点完两个点的症状是：三维里线画出来了、操作条却还写着
        // 「0/4 段」、侧栏没有这一段、剖面页还停在「参考剖面」。
        // 三维之所以看起来是对的，是因为 rAF 每帧直接从引擎读状态，
        // 而侧栏/剖面页读的是 React 的 snap。
        // （拖动端点、单行删除、清空三处本来就都有这句，只有这条点选路径漏了 ——
        //   所以只点一次的学生会以为功能坏了，拖一下又"好了"，最难归因。）
        setSnap(engine.snapshot());
      } else {
        // 拒绝理由照实念出来；起点**保留**，学生往前再点一下就能成段
        setNotice(res.reason ?? "这段画不了");
      }
    },
    [pickMode, pending]
  );

  /**
   * 当前样本推荐的垂直夸张（坡度取向）。`null` = 快照还没来。
   *
   * 单独取出来是因为下面三处都要用同一个数：滑块旁的「自动」小标、
   * 「自动 ×N」档的高亮、以及「还原真实 DEM」要还原到哪个倍数。
   */
  const rec = snap ? snap.recommendedExaggeration : null;

  /**
   * **有效选中** = 被选中 ∩ 在本样本上画得出来。
   *
   * 为什么要多这一层：`showParts` 是**用户的意图**，它跨样本保留 ——
   * 在模板山地上勾了「陡崖」，切到模板丘陵（一处陡崖都检不出）之后，
   * 那个 id 还留在数组里，于是显示层出现三处自相矛盾：
   *   · 图例列着「陡崖 0」——图例说标了，图上一个记号都没有；
   *   · 按钮灰掉却还是选中态（灰 + 选中本身就说不通）；
   *   · 组标题写「5/5 类」，实际只画出来 4 类。
   * 显示层统一以「有效选中」为准即可，**刻意不改 `showParts`** ——
   * 用户切回模板山地时陡崖应当自己回来，而不是被悄悄丢掉。
   * 图上真正画什么仍由引擎的 `annotationOf()` 过滤，这里只管显示口径一致。
   */
  const shownParts = snap ? snap.showParts.filter((id) => partDrawable(snap, id)) : [];

  // ---------- 平面图数据（水系） ----------  //
  // ⚠ 这里**不再**重算 TPI 求脊点（v2.4.1 删掉的那一段）。
  // 早先的写法是每次 `snap` 变化就在 React 层跑一遍 `ridgeValley(…, RIDGE_TPI)`
  // （~40 ms），算出来的东西与引擎 `marks.ridges` 是同一份 —— 白算一遍，
  // 而且"点一下部位按钮 → snap 变了 → 又重算一遍 TPI"纯属浪费。
  // 现在脊格与骨架线一律从快照拿（`snap.landform`），引擎算一次、三处共用。
  const planData = useMemo(() => {
    const engine = engineRef.current;
    if (!engine) {
      return null;
    }
    const f = engine.field;
    return { channels: channelSegments(engine.runoff, f.grid) };
  }, [snap]);

  // ---------- 图鉴筛选 ----------
  //
  // 标签的"可选项"不写死，全部由 `LANDFORMS` 现算 —— 所以不会出现
  // 「点了某个部位标签却一条都筛不出来」这种死标签：数量为 0 的直接灰掉。
  // 这一点很要紧：图鉴的部位标签筛的是**实测检出**，不是人工勾选，
  // 加了一个新样本之后标签数量会自动跟着变，不需要另外维护一份配置。
  const dexList = useMemo(
    () =>
      LANDFORMS.filter(
        (e) =>
          (dexType === "all" || e.landType === dexType) &&
          (dexPart === "all" || e.parts.includes(dexPart))
      ),
    [dexType, dexPart]
  );
  const dexTypeCount = useMemo(() => {
    const m = new Map<LandTypeId, number>();
    for (const t of LAND_TYPES) {
      m.set(t.id, LANDFORMS.filter((e) => e.landType === t.id).length);
    }
    return m;
  }, []);
  const dexPartCount = useMemo(() => {
    const m = new Map<LandPartId, number>();
    const base = LANDFORMS.filter((e) => dexType === "all" || e.landType === dexType);
    for (const p of LAND_PARTS) {
      m.set(p.id, base.filter((e) => e.parts.includes(p.id)).length);
    }
    return m;
  }, [dexType]);

  // ---------- 底部栏绘制 ----------
  const planRef = useRef<HTMLCanvasElement | null>(null);
  const profileRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = planRef.current;
    const engine = engineRef.current;
    if (tab !== "plan" || !c || !engine || !snap) {
      return;
    }
    const contours: ContourLevel[] = engine.contours;
    drawPlanMap(c, {
      field: engine.field,
      contours,
      lat: snap.lat,
      season: snap.season,
      interval: snap.contourInterval,
      majorEvery: 5,
      channels: planData?.channels,
      ridges: snap.landform.ridgeCells,
      showBands: snap.showBands,
      peakName: snap.peakName,
      segments: segmentsOf(snap),
      annotations: snap.annotation ?? undefined
    });
  }, [tab, snap, planData]);

  useEffect(() => {
    const c = profileRef.current;
    const engine = engineRef.current;
    if (tab !== "profile" || !c || !engine || !snap) {
      return;
    }
    if (snap.profileSeries.length > 0) {
      // 有手画剖面 → 多段对比图（最多 4 段，四色叠加，共用同一套坐标轴）
      drawProfileCompare(c, {
        field: engine.field,
        series: snap.profileSeries,
        interval: snap.contourInterval,
        snowlineNow: snap.snowlineNow,
        treeline: snap.treeline
      });
      return;
    }
    // 还没画 → 退回「山麓→峰顶巡游路径」那条参考剖面，别留一块空白
    drawProfile(c, {
      field: engine.field,
      route: engine.view?.route() ?? [],
      lat: snap.lat,
      season: snap.season,
      interval: snap.contourInterval,
      bands: snap.bands,
      snowlineNow: snap.snowlineNow,
      treeline: snap.treeline,
      cursorT: null
    });
  }, [tab, snap]);

  // 切页签时 canvas 是刚挂上的，尺寸还没量到 —— 用一个微任务补画一次
  useEffect(() => {
    if (tab !== "plan" && tab !== "profile") {
      return;
    }
    const id = requestAnimationFrame(() => setSnap((p) => (p ? { ...p } : p)));
    return () => cancelAnimationFrame(id);
  }, [tab]);

  const contoured = snap?.showContours ?? true;

  return (
    <div className="mz-root">
      {/* ============ 三维视图 ============ */}
      <div
        className={`mz-stage${pickMode ? " is-picking" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          downRef.current = null;
          dragRef.current = null;
        }}
        onPointerLeave={() => {
          if (dragRef.current) {
            return; // 拖动中指针滑出画布不算"离开"
          }
          engineRef.current?.clearHover();
          setSnap((prev) => (prev ? { ...prev, hover: null } : prev));
        }}
      >
        <div className="mz-canvas-host" ref={hostRef} />

        {/* ⚠ 这里**故意**不放任何文字标注（v2.4.3 撤掉）。
            五类地形部位在三维地形上本来就各有一套**彩色记号**（脊线/谷线是贴地折线，
            山峰/鞍部/陡崖是立体 ▲◆▼），由 `view3d.ts` 画在三维场景里；
            右下角的「部位标注」图例负责说明"哪种颜色是哪一类"。
            文字标签（v2.4.1 贴在锚点上、v2.4.2 用引线甩出去）看着是把
            "哪个峰多高"讲清楚了，代价却是**盖住地形本身** —— 而看清地形
            正是这个游戏唯一要做的事。要读数就看右下的「地貌图鉴」与「等高线清单」。 */}

        {errors ? (
          <div className="mz-error">
            <b>三维视图初始化失败</b>
            <div>{errors}</div>
          </div>
        ) : null}

        {snap ? (
          <>
            <div className="mz-stage-tag">
              <span className="mz-stage-name">{snap.name}</span>
              <span className="mz-stage-sub">
                {snap.lat.toFixed(1)}°N · 跨度 {snap.spanKm} km · 网格 {snap.grid}×{snap.grid}
              </span>
              <span className="mz-stage-sub">
                {/* ⚠ 这里**必须**分模板/真实两档。写死「真实 DEM」时，模板山地的舞台角标
                    会印着「真实 DEM 753–4200 m」，而同一个屏幕上侧栏的徽标写着「示意地形」、
                    页脚写着「解析函数生成」—— 三处自相矛盾，且**完全不会报错**。
                    v2.4.0 起模板就是默认样本，所以这是第一眼就会看到的矛盾。 */}
                {snap.isTemplate ? "解析生成" : "真实 DEM"} {snap.demMin}–{snap.demMax} m
              </span>
            </div>

            {pickMode ? (
              <div className="mz-pickbar">
                <b>画剖面</b>
                <span>
                  {pending
                    ? `起点已定（${Math.round(pending.alt)} m）· 再点一下定终点`
                    : "在地形上点一下 = 起点，再点一下 = 终点"}
                </span>
                <span className="mz-pickbar-count">
                  {snap.segments.length}/{MAX_PROFILE_SEGMENTS} 段
                </span>
                <button type="button" className="mz-pickbar-x" onClick={togglePickMode}>
                  退出
                </button>
              </div>
            ) : null}

            <div className="mz-legend">
              <div className="mz-legend-title">自然带（山麓→山顶）</div>
              {[...BELTS.map((b) => b.id), "snow" as const].map((id) => {
                const onMountain = snap.bands.some((b) => b.belt === id);
                return (
                  <div key={id} className={`mz-legend-row${onMountain ? "" : " is-absent"}`}>
                    <span
                      className="mz-legend-swatch"
                      style={{ background: beltColor(id, snap.season) }}
                    />
                    <span className="mz-legend-label">{beltDef(id).short}</span>
                  </div>
                );
              })}
            </div>

            {shownParts.length ? (
              <div className="mz-legend is-parts">
                <div className="mz-legend-title">部位标注</div>
                {LAND_PARTS.filter((p) => shownParts.includes(p.id)).map((p) => (
                  <div key={p.id} className="mz-legend-row">
                    <span className="mz-legend-swatch" style={{ background: PART_COLORS[p.id] }} />
                    <span className="mz-legend-label">
                      {p.name}
                      <em className="mz-legend-count">{snap.landform.counts[p.id]}</em>
                    </span>
                  </div>
                ))}
                <div className="mz-legend-note">
                  脊 / 谷线为骨架化结果（
                  {snap.landform.ridgeLines.length} 段脊 · {snap.landform.valleyLines.length} 段谷）
                </div>
              </div>
            ) : null}

            {snap.hover ? (
              <div className="mz-hovercard">
                <div className="mz-hovercard-alt">{Math.round(snap.hover.alt)} m</div>
                <div className="mz-hovercard-belt">{snap.hover.beltName}</div>
                <div className="mz-hovercard-line">
                  年均温 {snap.hover.tempAnnual.toFixed(1)} ℃ · 当季{" "}
                  {snap.hover.tempSeason.toFixed(1)} ℃
                </div>
                <div className="mz-hovercard-line">
                  植被覆盖 {(snap.hover.density * 100).toFixed(0)}%
                </div>
                {snap.hover.seasonalSnow ? (
                  <div className="mz-hovercard-line is-seasonal">
                    冬季季节性积雪（≠ 积雪冰川带：这一条带本身没变）
                  </div>
                ) : null}
                {snap.hover.aboveTreeline && snap.hover.belt !== "snow" ? (
                  <div className="mz-hovercard-line is-treeline">已在林线以上</div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {/* ============ 底部等高线栏 ============ */}
      <section className="mz-bottom">
        <header className="mz-bottom-head">
          <h2>等高线栏</h2>
          <div className="mz-tabs">
            <button
              type="button"
              className={`mz-tab${tab === "plan" ? " is-on" : ""}`}
              onClick={() => setTab("plan")}
            >
              平面等高线图
            </button>
            <button
              type="button"
              className={`mz-tab${tab === "list" ? " is-on" : ""}`}
              onClick={() => setTab("list")}
            >
              等高线清单
            </button>
            <button
              type="button"
              className={`mz-tab${tab === "profile" ? " is-on" : ""}`}
              onClick={() => setTab("profile")}
            >
              垂直剖面图
            </button>
            <button
              type="button"
              className={`mz-tab${tab === "dex" ? " is-on" : ""}`}
              onClick={() => setTab("dex")}
            >
              地貌图鉴
            </button>
          </div>
          <div className="mz-bottom-meta">
            {snap ? (
              <>
                等高距 <b>{snap.contourInterval} m</b> · 共 <b>{snap.contourCount}</b> 条
                {snap.highlightLevel != null ? (
                  <>
                    {" "}
                    · 高亮 <b className="mz-hot">{Math.round(snap.highlightLevel)} m</b>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </header>

        <div className="mz-bottom-body">
          {tab === "plan" ? (
            <canvas className="mz-canvas-plan" ref={planRef} />
          ) : null}

          {tab === "dex" ? (
            <div className="mz-dexwrap">
              <div className="mz-dexfilter">
                <div className="mz-dexfilter-row">
                  <span className="mz-dexfilter-label">地形类型</span>
                  <button
                    type="button"
                    className={`mz-chip is-small${dexType === "all" ? " is-on" : ""}`}
                    onClick={() => setDexType("all")}
                  >
                    全部 {LANDFORMS.length}
                  </button>
                  {LAND_TYPES.map((t) => {
                    const n = dexTypeCount.get(t.id) ?? 0;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={`mz-chip is-small${dexType === t.id ? " is-on" : ""}`}
                        title={t.rule}
                        disabled={n === 0}
                        onClick={() => setDexType(dexType === t.id ? "all" : t.id)}
                      >
                        {t.name} {n}
                      </button>
                    );
                  })}
                </div>
                <div className="mz-dexfilter-row">
                  <span className="mz-dexfilter-label">地形部位</span>
                  <button
                    type="button"
                    className={`mz-chip is-small${dexPart === "all" ? " is-on" : ""}`}
                    onClick={() => setDexPart("all")}
                  >
                    全部
                  </button>
                  {LAND_PARTS.map((p) => {
                    const n = dexPartCount.get(p.id) ?? 0;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`mz-chip is-small${dexPart === p.id ? " is-on" : ""}`}
                        title={`${p.form}（${p.rule}）`}
                        disabled={n === 0}
                        onClick={() => setDexPart(dexPart === p.id ? "all" : p.id)}
                      >
                        {p.name} {n}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mz-dexgrid">
                {dexList.map((e) => {
                  const typeDef = landTypeDef(e.landType);
                  const onThis = snap?.mountainTag === e.tag;
                  return (
                    <button
                      key={e.tag}
                      type="button"
                      className={`mz-dexcard${onThis ? " is-on" : ""}`}
                      onClick={() => apply({ mountainTag: e.tag })}
                    >
                      <div className="mz-dexcard-head">
                        <span className="mz-dexcard-name">{e.name}</span>
                        {/* 模板角标：不标的话「模板山地」和「贡嘎山」在同一排卡片上
                            长得一模一样，学生会当成也是某座真实的山。 */}
                        {e.isTemplate ? <span className="mz-dexcard-tpl">模板</span> : null}
                        <span className="mz-dexcard-type">{typeDef.name}</span>
                      </div>
                      <div className="mz-dexcard-alt">
                        {e.isTemplate ? "示意地形 · " : ""}
                        {e.min}–{e.max} m · 起伏 {e.relief} m
                      </div>
                      <div className="mz-dexcard-parts">
                        {e.parts.length ? (
                          e.parts.map((p) => (
                            <span key={p} className="mz-dexpart">
                              {landPartDef(p).name}
                              <b>
                                {isCappedPart(p, e.counts[p])
                                  ? `${LAND_PART_CAP[p]}+`
                                  : e.counts[p]}
                              </b>
                            </span>
                          ))
                        ) : (
                          <span className="mz-dexpart is-none">未检出地形部位</span>
                        )}
                      </div>
                      <div className="mz-dexcard-rule">{typeDef.rule}</div>
                      {e.detected !== e.landType ? (
                        <div className="mz-dexcard-bad">
                          ⚠ 判据算出来是「{landTypeDef(e.detected).name}」，与声明不符
                        </div>
                      ) : null}
                      {e.suspect > 0 ? (
                        <div className="mz-dexcard-warn">
                          该图有 {e.suspect} 格被陡崖闸门剔除（DEM 空洞填充）
                        </div>
                      ) : null}
                    </button>
                  );
                })}
                {dexList.length === 0 ? (
                  <div className="mz-hint">
                    这个「类型 + 部位」组合下没有样本 —— 换个标签看看
                  </div>
                ) : null}
              </div>

              <div className="mz-profile-cap">
                类型为教材口径（人工写定）· 部位标签与计数来自 landform.ts 的实测检出
                · 计数带「+」表示已到检出上限（山峰 6 / 陡崖 16），实际不止这么多
              </div>
            </div>
          ) : null}

          {tab === "list" ? (
            <div className="mz-list">
              {snap?.contourLevels.map((lv) => {
                const contour = engineRef.current?.contours.find((c) => c.level === lv);
                const isHot = snap.highlightLevel === lv;
                const isSnow = snap.snowlineAnnual != null && lv >= snap.snowlineAnnual;
                return (
                  <button
                    key={lv}
                    type="button"
                    className={`mz-list-item${isHot ? " is-hot" : ""}`}
                    onClick={() =>
                      apply({ highlightLevel: snap.highlightLevel === lv ? null : lv })
                    }
                  >
                    <span className="mz-list-level">{Math.round(lv)} m</span>
                    <span className="mz-list-meta">
                      {contour ? `${contour.polylines.length} 圈 · ${(contour.totalLen * (snap.spanKm * 1000 / (snap.grid - 1)) / 1000).toFixed(1)} km` : "—"}
                    </span>
                    {isSnow ? <span className="mz-list-tag">雪线以上</span> : null}
                  </button>
                );
              })}
              {snap && snap.contourLevels.length === 0 ? (
                <div className="mz-list-empty">当前等高距下没有可显示的等高线</div>
              ) : null}
            </div>
          ) : null}

          {tab === "profile" ? (
            <>
              <canvas className="mz-canvas-profile" ref={profileRef} />
              <div className="mz-profile-cap">
                {snap && snap.profileSeries.length
                  ? `${snap.profileSeries.length} 条剖面对比 · 共用同一套坐标轴（换山体会清空剖面）`
                  : "参考剖面：山麓→峰顶巡游路径 · 用「在地形上画剖面」换自己的"}
              </div>
            </>
          ) : null}
        </div>
      </section>

      {/* ============ 参数栏 ============ */}
      <aside className="mz-panel">
        <h1 className="mz-title">
          <span>口袋地形</span>
          <em>垂直自然带</em>
        </h1>

        {/* 第一档：模板地形（示意）。课前几分钟先看它 —— 一处部位对应一个术语 */}
        <div className="mz-group">
          <div className="mz-group-title">
            模板地形 · 示意
            {snap?.isTemplate ? (
              <b className="mz-num">{landTypeDef(snap.landType).name}</b>
            ) : null}
          </div>
          <div className="mz-pickgroup">
            <span className="mz-pickgroup-label" title="解析生成的示意地形，形状按判据反解，不对应任何真实地点">
              入门
            </span>
            <div className="mz-btn-row">
              {TEMPLATE_SOURCES.map((s) => (
                <button
                  key={s.tag}
                  type="button"
                  className={`mz-chip${snap?.mountainTag === s.tag ? " is-on" : ""}`}
                  onClick={() => apply({ mountainTag: s.tag })}
                  title={`${landTypeDef(s.landType).name} · 示意地形 · 无真实经纬度 · ${s.spanKm} km 见方`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
          <div className="mz-hint">
            不是真实地点，是照着课本示意图做的「干净地形」：一处部位对应一个术语。
          </div>
        </div>

        {/* 第二档：真实地形（DEM）。按五种地形类型分组 */}
        <div className="mz-group">
          <div className="mz-group-title">
            真实地形（DEM）
            {snap && !snap.isTemplate ? (
              <b className="mz-num">{landTypeDef(snap.landType).name}</b>
            ) : null}
          </div>
          {LAND_TYPES.map((t) => {
            const list = REAL_SOURCES.filter((s) => s.landType === t.id);
            if (!list.length) {
              return null;
            }
            return (
              <div key={t.id} className="mz-pickgroup">
                <span className="mz-pickgroup-label" title={t.rule}>
                  {t.name}
                </span>
                <div className="mz-btn-row">
                  {list.map((s) => (
                    <button
                      key={s.tag}
                      type="button"
                      className={`mz-chip${snap?.mountainTag === s.tag ? " is-on" : ""}`}
                      onClick={() => apply({ mountainTag: s.tag })}
                      title={`${t.name} · ${s.peakName} ${s.peakAltitude} m · 取景 ${s.spanKm} km 见方`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {snap && !snap.isTemplate ? (
            <div className="mz-hint">
              {snap.peakName} {snap.peakAltitude} m · 取景 {snap.spanKm} km 见方 · 网格{" "}
              {snap.grid}×{snap.grid}
            </div>
          ) : null}
        </div>

        {/* 第三档：地形部位标注（v2.4.1）。
            紧跟在「选地形」后面 —— 学生的动作顺序就是"先挑一座山，再问它哪里有峰/脊/谷" */}
        {snap ? (
          <div className="mz-group">
            <div className="mz-group-title">
              地形部位标注
              <b className="mz-num">
                {shownParts.length ? `${shownParts.length}/5 类` : "未标注"}
              </b>
            </div>
            <div className="mz-btn-row">
              {LAND_PARTS.map((p) => {
                /* 灰化判据 = "这一类在这个样本上**画得出来**"，不是"检出数 > 0"：
                   川中丘陵检出 1 处山脊，但那 1 格是孤立点，骨架化之后一条线都没有
                   —— 按钮亮着却什么都画不出来，比灰掉更让人困惑。 */
                const drawable = partDrawable(snap, p.id);
                // ⚠ `on` 必须是「有效选中」：灰掉的按钮还显示成选中态是自相矛盾的
                //   （点了没反应、图上也没有，学生只会以为坏了）
                const on = drawable && snap.showParts.includes(p.id);
                const n = snap.landform.counts[p.id];
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!drawable}
                    className={`mz-chip is-part${on ? " is-on" : ""}`}
                    /* 选中时用该部位的颜色描个下边线 —— 与三块画面上的记号同色，
                       学生才能把"这个按钮"和"图上那条线"对上。 */
                    style={on ? { boxShadow: `inset 0 -3px 0 ${PART_COLORS[p.id]}` } : undefined}
                    title={
                      drawable
                        ? `${p.name}：${p.rule}（本样本检出 ${n} 处${isCappedPart(p.id, n) ? "+" : ""}）`
                        : `${p.name}：本样本检不出可连成线的位置（检出 ${n} 处，太零散）`
                    }
                    onClick={() => togglePart(p.id)}
                  >
                    <span className="mz-chip-dot" style={{ background: PART_COLORS[p.id] }} />
                    {p.name}
                    <em className="mz-chip-n">
                      {n > 0 ? `${n}${isCappedPart(p.id, n) ? "+" : ""}` : "—"}
                    </em>
                  </button>
                );
              })}
            </div>
            <div className="mz-quick">
              <button
                type="button"
                className="mz-chip is-small"
                onClick={() =>
                  apply({
                    showParts: LAND_PARTS.filter((p) => partDrawable(snap, p.id)).map((p) => p.id)
                  })
                }
              >
                全部标注
              </button>
              <button
                type="button"
                className="mz-chip is-small"
                disabled={!shownParts.length}
                onClick={() => apply({ showParts: [] })}
              >
                清空
              </button>
            </div>
            <div className="mz-hint">
              点上面的按钮，把地形部位标到<b>三维沙盘、投影图纸、平面等高线图</b>上
              （三处同步）。
              <br />
              记号：▲山峰 ◆鞍部 ▼陡崖；山脊 / 山谷是<b>线</b>。
              <br />
              ⚠ 脊线与谷线是<b>骨架化</b>的结果 —— 由检测出的格子（
              {snap.landform.counts.ridge} 个脊格 / {snap.landform.counts.valley} 个谷格）
              细化成线，不是人工画的分水线；所以它表示「检测到的脊 / 谷在哪一段」，
              不等于严格的流域分界。
            </div>
          </div>
        ) : null}

        {snap ? (
          <div className="mz-group">
            <div className="mz-group-title">
              地理位置
              <b className="mz-num">
                {snap.isTemplate ? "示意地形" : locationByTag(snap.mountainTag).province}
              </b>
            </div>
            {snap.isTemplate ? (
              /* 模板地形没有真实经纬度 ⇒ 不画中国地图，改画这张说明卡。
                 ⚠️ 绝对不要在这里"顺手调一下 locationByTag 兜底"：它查不到模板的
                 tag 会回退到第一个真实样本（贡嘎山 / 四川省），而模板的占位坐标
                 30°N/105°E 又正好落在国界内 —— 于是模板山地会安静地顶着
                 「四川省 · 大雪山（横断山系）」这张标签，画一个看着很正常的红点。
                 既不报错也不越界，肉眼查不出来。这条静默回退由
                 `scripts/locmap.test.cjs` 第 6 节专门钉住。 */
              <div className="mz-tplcard">
                <p className="mz-tplcard-lead">
                  这不是某个真实地点，是照课本地形示意图反解出来的一张「干净地形」。
                </p>
                <ul className="mz-tplcard-list">
                  <li>没有经纬度，所以没有地理位置图</li>
                  <li>形状按术语反解：该出现的部位，各摆一处、互不干扰</li>
                  <li>想看真实地点，切到上面的「真实地形（DEM）」</li>
                </ul>
                <div className="mz-tplcard-note">
                  <span>类型判据</span>
                  {snap.landTypeReason}
                </div>
              </div>
            ) : (
              <LocationMap
                map={CHINA_MAP}
                location={locationByTag(snap.mountainTag)}
                mountainName={snap.name}
                /* ⚠️ 坐标必须取 DemSource 的真实经纬度，**不能用 snap.lat** ——
                   snap.lat 是下面那根「纬度」滑杆的值，用它红点会跟着滑杆南北平移。 */
                realLat={sourceByTag(snap.mountainTag).lat}
                realLon={sourceByTag(snap.mountainTag).lon}
              />
            )}
          </div>
        ) : null}

        <div className="mz-group">
          <div className="mz-group-title">
            纬度
            <b className="mz-num">{snap ? `${snap.lat.toFixed(1)}°N` : "—"}</b>
          </div>
          <input
            className="mz-range"
            type="range"
            min={0}
            max={75}
            step={0.5}
            value={snap?.lat ?? 30}
            onChange={(e) => apply({ lat: Number(e.target.value) })}
          />
          <div className="mz-hint">
            {snap?.isTemplate
              ? "模板地形没有真实纬度，默认 30°N（中纬度）· 仍可手动滑动来演示「把这片地形搬到赤道 / 极圈」"
              : "切山时自动跳到该山真实纬度，仍可手动滑动来演示「把这座山搬到赤道 / 极圈」"}
          </div>
        </div>

        <div className="mz-group">
          <div className="mz-group-title">季节</div>
          <div className="mz-btn-row">
            {SEASONS.map((s) => (
              <button
                key={s}
                type="button"
                className={`mz-chip${snap?.season === s ? " is-on" : ""}`}
                onClick={() => apply({ season: s })}
              >
                {SEASON_LABEL[s]}
              </button>
            ))}
          </div>
          <div className="mz-hint">
            季节只改雪线高低与地表覆盖，**不改带谱本身** —— 带谱是多年气候稳定下来的
          </div>
        </div>

        <div className="mz-group">
          <div className="mz-group-title">
            高程塑造
            {snap?.modified ? <span className="mz-badge">已偏离真实 DEM</span> : null}
          </div>
          <label className="mz-slider">
            <span>
              高程偏移 <b className="mz-num">{(snap?.elevationOffset ?? 0) > 0 ? "+" : ""}{Math.round(snap?.elevationOffset ?? 0)} m</b>
            </span>
            <input
              className="mz-range"
              type="range"
              min={-2000}
              max={2000}
              step={50}
              value={snap?.elevationOffset ?? 0}
              onChange={(e) => apply({ elevationOffset: Number(e.target.value) })}
            />
          </label>
          <div className="mz-hint">
            <b>真的在改海拔</b>：整座山抬高/下切，山顶读数、等高线注记、带谱边界全都跟着变。
            演示「地壳抬升 → 雪线上移 → 整条带谱上移」。
          </div>

          <label className="mz-slider">
            <span>
              垂直夸张 <b className="mz-num">×{(snap?.verticalExaggeration ?? 1).toFixed(2)}</b>
              {rec !== null && Math.abs((snap?.verticalExaggeration ?? 1) - rec) < 1e-6 ? (
                <em className="mz-auto-tag">自动</em>
              ) : null}
            </span>
            {/* 对数刻度：见 `dem.ts` 的 `exagToSlider` —— 线性刻度下 0.5→2 只占 7.7% 行程 */}
            <input
              className="mz-range"
              type="range"
              min={0}
              max={EXAGGERATION_SLIDER_STEPS}
              step={1}
              value={exagToSlider(snap?.verticalExaggeration ?? 1)}
              onChange={(e) => apply({ verticalExaggeration: sliderToExag(Number(e.target.value)) })}
            />
          </label>
          <div className="mz-quick">
            {rec !== null ? (
              <button
                type="button"
                className={`mz-chip is-small${Math.abs((snap?.verticalExaggeration ?? 1) - rec) < 1e-6 ? " is-on" : ""}`}
                onClick={() => apply({ verticalExaggeration: rec })}
                title="按这个样本的坡度自动推荐（陡的地形不抬、平的地形才抬）"
              >
                自动 ×{rec}
              </button>
            ) : null}
            {EXAGGERATION_STEPS.map((v) => (
              <button
                key={v}
                type="button"
                className={`mz-chip is-small${Math.abs((snap?.verticalExaggeration ?? 1) - v) < 1e-6 ? " is-on" : ""}`}
                onClick={() => apply({ verticalExaggeration: v })}
              >
                ×{v}
              </button>
            ))}
          </div>
          <div className="mz-hint">
            <b>只改视觉纵轴</b>，不改变「这座山有多高」—— 所以它不影响任何读数。
            <br />
            换样本时自动按<b>坡度</b>推荐：本来就有 25° 以上坡面的地形给 ×1（不抬），
            太平的地形才抬起来（平原最高到 ×20）。目的是让「山地陡、丘陵缓、平原几乎平」
            这条对比在屏幕上还看得出来 —— 否则丘陵按 ×1 画出来就是一块缓板。
          </div>

          <button
            type="button"
            className="mz-reset"
            disabled={!snap?.modified}
            onClick={() =>
              apply({
                verticalExaggeration: snap?.recommendedExaggeration ?? 1,
                elevationOffset: 0
              })
            }
          >
            还原真实 DEM
          </button>
        </div>

        <div className="mz-group">
          <div className="mz-group-title">
            等高线
            <b className="mz-num">{snap ? `${snap.contourCount} 条` : "—"}</b>
          </div>
          <div className="mz-btn-row">
            <button
              type="button"
              className={`mz-chip${contoured ? " is-on" : ""}`}
              onClick={() => apply({ showContours: !contoured })}
            >
              地表等高线
            </button>
            <button
              type="button"
              className={`mz-chip${snap?.showBands ? " is-on" : ""}`}
              onClick={() => apply({ showBands: !snap?.showBands })}
            >
              自然带配色
            </button>
          </div>
          <div className="mz-group-subtitle">等高距</div>
          <div className="mz-btn-row">
            {CONTOUR_INTERVAL_STEPS.map((s) => (
              <button
                key={s}
                type="button"
                className={`mz-chip is-small${snap?.contourInterval === s ? " is-on" : ""}`}
                onClick={() => apply({ contourInterval: s })}
              >
                {s} m
              </button>
            ))}
          </div>
          <div className="mz-hint">
            换地形时自动落到能出线的档位 —— 山峰那档（200 m）用在平原上会一条线都画不出来。
            平原样本请用 20~50 m。
          </div>
        </div>

        <div className="mz-group">
          <div className="mz-group-title">
            降雨
            <b className="mz-num">{snap ? `${(snap.runoff.rain * 100).toFixed(0)}%` : "—"}</b>
          </div>
          <div className="mz-btn-row">
            {WEATHER_ORDER.map((w) => (
              <button
                key={w}
                type="button"
                className={`mz-chip${snap?.weather === w ? " is-on" : ""}`}
                onClick={() => apply({ weather: w })}
              >
                {WEATHER_LABEL[w]}
              </button>
            ))}
          </div>
          {snap ? <div className="mz-hint">{snap.runoff.text}</div> : null}
        </div>

        <div className="mz-group">
          <div className="mz-group-title">视角</div>
          <div className="mz-btn-row">
            <button
              type="button"
              className={`mz-chip${snap?.mode === "observe" ? " is-on" : ""}`}
              onClick={() => apply({ mode: "observe" })}
            >
              绕山观察
            </button>
            <button
              type="button"
              className={`mz-chip${snap?.mode === "roam" ? " is-on" : ""}`}
              onClick={() => apply({ mode: "roam" })}
            >
              山麓→峰顶巡游
            </button>
          </div>
          <div className="mz-hint">
            巡游沿「最陡上升路径」从山麓走到峰顶，跟着看海拔与带谱如何变化
          </div>
        </div>

        <div className="mz-group">
          <div className="mz-group-title">
            地形剖面
            <b className="mz-num">
              {snap ? `${snap.segments.length}/${MAX_PROFILE_SEGMENTS} 段` : "—"}
            </b>
          </div>
          <div className="mz-btn-row">
            <button
              type="button"
              className={`mz-chip${snap?.showTerrain ? " is-on" : ""}`}
              onClick={() => apply({ showTerrain: !snap?.showTerrain })}
              title="收起三维沙盘，单看下方那张平面图"
            >
              三维地形
            </button>
            <button
              type="button"
              className={`mz-chip${snap?.showProjection ? " is-on" : ""}`}
              onClick={() => apply({ showProjection: !snap?.showProjection })}
              title="显示 / 隐藏沙盘正下方的等高线图纸"
            >
              二维投影图纸
            </button>
          </div>
          <div className="mz-btn-row">
            <button
              type="button"
              className={`mz-chip${pickMode ? " is-on" : ""}`}
              onClick={togglePickMode}
            >
              {pickMode
                ? "正在画剖面"
                : snap && !snap.showTerrain
                  ? "在平面图上画剖面"
                  : "在地形上画剖面"}
            </button>
          </div>
          <div className="mz-hint">
            点一下定起点、再点一下定终点，最多 4 段四色叠加；已画的端点小球可以在三维里直接拖动微调。
            同一条线同时画在<b>三维地表</b>、<b>投影图纸</b>与<b>平面等高线图</b>上，三处坐标严格一致。
          </div>
          <div className="mz-hint">
            {snap && !snap.showTerrain ? (
              <>
                现在只在<b>平面图</b>上工作：沙盘已收起，鼠标落在纸面上读海拔，
                也能直接<b>在图上画剖面</b>。想看回立体地形，把上面的「三维地形」再点亮。
              </>
            ) : (
              <>
                「三维地形」与「二维投影图纸」<b>两个开关互相独立</b>：都开是沙盘悬在图纸上方，
                只开一个就是纯立体 / 纯平面。收掉沙盘后，取样点会从地表换到纸面上。
              </>
            )}
          </div>

          {notice ? <div className="mz-notice">{notice}</div> : null}

          {pending ? (
            <div className="mz-pending">
              <span>
                起点：{Math.round(pending.alt)} m（网格 {pending.p[0].toFixed(0)},
                {pending.p[1].toFixed(0)}）
              </span>
              <button type="button" className="mz-linkbtn" onClick={() => setPending(null)}>
                取消起点
              </button>
            </div>
          ) : null}

          {snap && snap.profileSeries.length ? (
            <div className="mz-seglist">
              {snap.profileSeries.map((s, k) => (
                <div key={s.index} className="mz-segrow">
                  <span className="mz-segdot" style={{ background: s.color }}>
                    {s.index}
                  </span>
                  <span className="mz-segmeta">
                    {compassLabel(s.bearing)} · {(s.stats.lengthM / 1000).toFixed(1)} km
                  </span>
                  <span className="mz-segmeta">
                    落差 {Math.round(s.stats.relief)} m
                  </span>
                  <span className="mz-segmeta">
                    最陡 {s.stats.steepestDeg.toFixed(0)}°
                  </span>
                  <button
                    type="button"
                    className="mz-segdel"
                    title="删掉这一段，序号会重新排"
                    onClick={() => {
                      const engine = engineRef.current;
                      if (engine) {
                        engine.removeSegment(k);
                        setSnap(engine.snapshot());
                      }
                    }}
                  >
                    删
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="mz-reset"
                onClick={() => {
                  const engine = engineRef.current;
                  if (engine) {
                    engine.clearSegments();
                    setSnap(engine.snapshot());
                  }
                }}
              >
                清空全部剖面
              </button>
            </div>
          ) : (
            <div className="mz-hint">
              还没画剖面 —— 下方「垂直剖面图」页签现在显示的是山麓→峰顶巡游路径那条参考剖面。
            </div>
          )}
        </div>

        <div className="mz-group">
          <div className="mz-group-title">自然带图鉴</div>
          <div className="mz-dex">
            {snap?.bands.map((b) => {
              const def = beltDef(b.belt);
              return (
                <div key={b.belt} className="mz-dex-card">
                  <div className="mz-dex-head">
                    <span className="mz-legend-swatch" style={{ background: beltColor(b.belt, snap.season) }} />
                    <span className="mz-dex-name">{def.name}</span>
                  </div>
                  <div className="mz-dex-range">
                    {Math.round(b.from)}–{Math.round(b.to)} m
                  </div>
                  <div className="mz-dex-typical">{def.typical}</div>
                </div>
              );
            })}
            {snap && snap.bands.length === 0 ? (
              <div className="mz-hint">当前山顶低于基带下限，山体没有形成分异</div>
            ) : null}
          </div>
        </div>

        <div className="mz-group mz-readout">
          <div className="mz-group-title">读数</div>
          {snap ? (
            <dl>
              <dt>山麓基带</dt>
              <dd>{snap.baseBeltName}</dd>
              <dt>当前山顶</dt>
              <dd>{Math.round(snap.currentPeak)} m</dd>
              <dt>年均雪线</dt>
              <dd>{Math.round(snap.snowlineAnnual)} m</dd>
              <dt>当季雪线</dt>
              <dd>{Math.round(snap.snowlineNow)} m</dd>
              <dt>林线</dt>
              <dd>{Math.round(snap.treeline)} m</dd>
              <dt>最高点位置</dt>
              <dd>
                {snap.peakName}（网格 {engineRef.current?.field.peakI},{engineRef.current?.field.peakJ}）
              </dd>
            </dl>
          ) : null}
        </div>

        <div className="mz-foot">
          {roster.length > 0 ? <div>本次课堂 {roster.length} 人</div> : null}
          {snap?.isTemplate
            ? "地形数据：解析函数生成（示意地形，无随机数、可逐字节复现）· 不对应任何真实地点"
            : "地形数据：AWS Terrain Tiles（Terrarium，公有领域）· 按真实 DEM 网格渲染"}
        </div>
      </aside>
    </div>
  );
}
