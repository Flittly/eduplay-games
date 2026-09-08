import provincesJson from "./data/provinces.json";

export type TileKind = "shape" | "abbr" | "capital";

export const TILE_KINDS: TileKind[] = ["shape", "abbr", "capital"];

export interface ProvinceInfo {
  id: string;
  name: string;
  abbr: string;
  capital: string;
  bbox: [number, number, number, number];
  d: string;
}

export const PROVINCES: ProvinceInfo[] = provincesJson.features.map((f) => ({
  ...f,
  bbox: f.bbox as [number, number, number, number]
}));

const byId = new Map(PROVINCES.map((p) => [p.id, p]));

export function getProvince(id: string): ProvinceInfo {
  const found = byId.get(id);
  if (!found) {
    throw new Error(`unknown province ${id}`);
  }
  return found;
}

export function pickByAbbrs(abbrs: string[]): string[] {
  const wanted = new Set(abbrs);
  return PROVINCES.filter((p) => wanted.has(p.abbr)).map((p) => p.id);
}

export interface LevelDef {
  id: number;
  name: string;
  subtitle: string;
  hint: string;
  provinceIds: string[];
  maxLayers: number;
  cols: number;
  rows: number;
}

const LEVEL1_ABBS = ["黑", "吉", "辽", "鲁", "粤", "川", "苏", "浙"];
const LEVEL2_EXTRA = ["陕", "甘", "晋", "冀", "豫", "皖", "闽", "湘", "鄂", "赣"];

export const LEVELS: LevelDef[] = [
  {
    id: 1,
    name: "第一关 · 入门基础",
    subtitle: "课前热身",
    hint: "8 个高频省区 · 2-3 层堆叠",
    provinceIds: pickByAbbrs(LEVEL1_ABBS),
    maxLayers: 3,
    cols: 9,
    rows: 7
  },
  {
    id: 2,
    name: "第二关 · 进阶巩固",
    subtitle: "课中练习",
    hint: "18 个常见省区（含易混淆）· 3-4 层堆叠",
    provinceIds: pickByAbbrs([...LEVEL1_ABBS, ...LEVEL2_EXTRA]),
    maxLayers: 4,
    cols: 10,
    rows: 9
  },
  {
    id: 3,
    name: "第三关 · 会考挑战",
    subtitle: "课后复习",
    hint: "全部 34 个省级行政区 · 4-5 层堆叠",
    provinceIds: PROVINCES.map((p) => p.id),
    maxLayers: 5,
    cols: 14,
    rows: 10
  }
];

export interface Tile {
  uid: number;
  provinceId: string;
  kind: TileKind;
  c: number;
  r: number;
  layer: number;
}

function shuffle<T>(items: T[]): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function overlaps(a: { c: number; r: number }, b: { c: number; r: number }): boolean {
  return Math.abs(a.c - b.c) < 2 && Math.abs(a.r - b.r) < 2;
}

/**
 * 贪心模拟：永远优先拾取能让卡槽进度最大的可点牌。
 * 通过 = 用「合理策略」也能通关（不用提示/撤回）。供生成器优选与测试脚本复用。
 */
export function greedySolvable(tiles: Tile[]): boolean {
  let board = tiles.slice();
  const tray: Tile[] = [];
  let guard = tiles.length + 10;

  while (board.length > 0) {
    if (guard-- <= 0) {
      return false;
    }
    const covered = computeCovered(board);
    const free = board.filter((tile) => !covered.has(tile.uid));
    if (free.length === 0) {
      return false;
    }
    const inTray = (provinceId: string) =>
      tray.filter((tile) => tile.provinceId === provinceId).length;

    let bestTile = free[0];
    let bestKey = -1;
    for (const tile of free) {
      const key = inTray(tile.provinceId);
      if (key > bestKey) {
        bestKey = key;
        bestTile = tile;
      }
    }

    board = board.filter((tile) => tile.uid !== bestTile.uid);
    tray.push(bestTile);
    const kinds = new Set(
      tray
        .filter((tile) => tile.provinceId === bestTile.provinceId)
        .map((tile) => tile.kind)
    );
    if (TILE_KINDS.every((kind) => kinds.has(kind))) {
      for (let i = tray.length - 1; i >= 0; i -= 1) {
        if (tray[i].provinceId === bestTile.provinceId) {
          tray.splice(i, 1);
        }
      }
    }
    if (tray.length >= 6) {
      return false;
    }
  }
  return tray.length === 0;
}

/**
 * 参考顺序可解性验证：按构造时的取牌顺序逐步模拟，
 * 每一步要求该牌此刻无遮挡，且卡槽峰值不超过 5 格。
 * 生成器以此运行时实测「本局必然有通关路径」。
 */
export function referenceSolvable(order: Tile[]): boolean {
  const remaining = new Set(order.map((tile) => tile.uid));
  const tray: Tile[] = [];
  for (const tile of order) {
    for (const other of order) {
      if (
        other.uid !== tile.uid &&
        remaining.has(other.uid) &&
        other.layer > tile.layer &&
        overlaps(other, tile)
      ) {
        return false;
      }
    }
    remaining.delete(tile.uid);
    tray.push(tile);
    const kinds = new Set(
      tray
        .filter((item) => item.provinceId === tile.provinceId)
        .map((item) => item.kind)
    );
    if (TILE_KINDS.every((kind) => kinds.has(kind))) {
      for (let i = tray.length - 1; i >= 0; i -= 1) {
        if (tray[i].provinceId === tile.provinceId) {
          tray.splice(i, 1);
        }
      }
    }
    if (tray.length >= 6) {
      return false;
    }
  }
  return tray.length === 0;
}

/**
 * 生成保证可通关的堆叠布局（对外入口）：
 * 1. 构造式算法给出一条参考取牌路径，并用 referenceSolvable 逐步实测；
 * 2. 在通过实测的布局里，优先挑选「贪心策略也能通关」的布局（最多重试 40 次）；
 * 3. 兜底返回实测有解的布局（深关卡本就需要策略与提示/撤回配合）。
 */
export function generateLayout(level: LevelDef): Tile[] {
  let fallback: Tile[] | null = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { tiles, order } = buildLayout(level);
    if (!referenceSolvable(order)) {
      continue;
    }
    if (fallback === null) {
      fallback = tiles;
    }
    if (greedySolvable(tiles)) {
      return tiles;
    }
  }
  if (fallback !== null) {
    return fallback;
  }
  // 理论上不会走到这里：构造式布局必然通过参考顺序验证
  const { tiles, order } = buildLayout(level);
  if (!referenceSolvable(order)) {
    throw new Error("generateLayout: failed to build a solvable layout");
  }
  return tiles;
}

/** 供测试脚本复用的布局构造（含参考取牌顺序） */
export function buildLayout(
  level: LevelDef
): { tiles: Tile[]; order: Tile[] } {
  const kindOf = (index: number): TileKind => TILE_KINDS[index % TILE_KINDS.length];

  const perProvince = new Map<string, Tile[]>();
  let uid = 0;
  for (const provinceId of level.provinceIds) {
    const list: Tile[] = [];
    for (let i = 0; i < TILE_KINDS.length; i += 1) {
      list.push({ uid: uid++, provinceId, kind: kindOf(i), c: 0, r: 0, layer: 0 });
    }
    perProvince.set(provinceId, shuffle(list));
  }

  // 参考取牌顺序：每两个省份一组交错抽牌，卡槽占用峰值 <= 5。
  // 采用「三明治」模板：每省一对牌在构建时相邻（纵向上易成链），
  // 一张牌打散（保留匹配挑战），兼顾可玩性与贪心可解性。
  const pickOrder: Tile[] = [];
  const provinceLists = shuffle([...perProvince.values()]);
  for (let i = 0; i < provinceLists.length; i += 2) {
    const first = provinceLists[i];
    const second = provinceLists[i + 1];
    if (!second) {
      pickOrder.push(...first);
      break;
    }
    const pairs = Math.random() < 0.5 ? [first, second] : [second, first];
    const [pa, pb] = pairs;
    const sa = shuffle(pa);
    const sb = shuffle(pb);
    // 模板（pa 位置 0,3,4；pb 位置 1,2,5）：pa, pb, pb, pa, pa, pb
    pickOrder.push(sa[0], sb[0], sb[1], sa[1], sa[2], sb[2]);
  }

  // 逆序放置：参考顺序中越晚取的牌越靠下
  const cells: Array<{ c: number; r: number }> = [];
  for (let c = 0; c + 2 <= level.cols; c += 1) {
    for (let r = 0; r + 2 <= level.rows; r += 1) {
      cells.push({ c, r });
    }
  }

  const placed: Tile[] = [];
  for (let i = pickOrder.length - 1; i >= 0; i -= 1) {
    const tile = pickOrder[i];
    const candidates: Array<{
      c: number;
      r: number;
      layer: number;
      chain: boolean;
    }> = [];
    for (const cell of shuffle(cells)) {
      let maxLayer = -1;
      let chain = false;
      for (const other of placed) {
        if (overlaps(other, cell)) {
          if (other.layer > maxLayer) {
            maxLayer = other.layer;
          }
          if (other.provinceId === tile.provinceId) {
            chain = true;
          }
        }
      }
      candidates.push({ c: cell.c, r: cell.r, layer: maxLayer + 1, chain });
    }
    // 选择策略：
    // 1) 优先与同省已放置的牌成链（允许多压一层），让同省牌纵向相邻；
    // 2) 其次选层最低的位置，控制整体堆叠深度。
    const scored = candidates
      .filter((item) => item.layer <= level.maxLayers)
      .sort(
        (a, b) =>
          (b.chain ? 1000 : 0) - b.layer - ((a.chain ? 1000 : 0) - a.layer)
      );
    const pool = scored.length > 0 ? scored : candidates;
    const topScore =
      (pool[0].chain ? 1000 : 0) - pool[0].layer;
    const best = pool.filter(
      (item) => (item.chain ? 1000 : 0) - item.layer === topScore
    );
    const chosen = best[Math.floor(Math.random() * best.length)];
    tile.c = chosen.c;
    tile.r = chosen.r;
    tile.layer = chosen.layer;
    placed.push(tile);
  }

  return { tiles: placed, order: pickOrder };
}

/** 返回当前被上层压住、不可点击的牌 */
export function computeCovered(tiles: Tile[]): Set<number> {
  const covered = new Set<number>();
  for (const tile of tiles) {
    for (const other of tiles) {
      if (
        other.uid !== tile.uid &&
        other.layer > tile.layer &&
        overlaps(other, tile)
      ) {
        covered.add(tile.uid);
        break;
      }
    }
  }
  return covered;
}

export interface HintGroup {
  provinceId: string;
  tileUids: number[];
  ready: boolean;
}

/**
 * 寻找一组提示：优先返回「剩余牌全部在卡槽或已可点击」的省份，
 * 否则返回可点击牌数最多的省份作为引导。
 */
export function findHintGroup(
  boardTiles: Tile[],
  trayTiles: Tile[]
): HintGroup | null {
  const covered = computeCovered(boardTiles);
  const involved = new Map<number, { tile: Tile; inTray: boolean }>();
  for (const tile of boardTiles) {
    involved.set(tile.uid, { tile, inTray: false });
  }
  for (const tile of trayTiles) {
    involved.set(tile.uid, { tile, inTray: true });
  }

  const byProvince = new Map<string, Array<{ tile: Tile; inTray: boolean }>>();
  for (const entry of involved.values()) {
    const list = byProvince.get(entry.tile.provinceId) ?? [];
    list.push(entry);
    byProvince.set(entry.tile.provinceId, list);
  }

  let best: HintGroup | null = null;
  let bestScore = -1;
  for (const [provinceId, list] of byProvince) {
    const tileUids = list.map((item) => item.tile.uid);
    const accessible = list.filter(
      (item) => item.inTray || !covered.has(item.tile.uid)
    );
    const ready = accessible.length === list.length;
    const score = (ready ? 100 : 0) + accessible.length;
    if (score > bestScore) {
      bestScore = score;
      best = { provinceId, tileUids, ready };
    }
  }
  return best;
}
