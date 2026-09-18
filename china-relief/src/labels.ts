/**
 * 地名标注的候选表（v1.4.0）。
 *
 * 单独成一个模块、而不是写在 App.tsx 的 useMemo 里，是为了**能被 node 测试覆盖**。
 * 这里的每条规则都是踩过坑才定下来的，而它们坏掉的样子极其隐蔽：
 * 名字少了一个、顺序变了导致避让结果抖动、图鉴里一个名字都没有 ——
 * 光看截图看不出来（少一个名字的画面"看起来也很正常"）。
 * App.tsx 里只做一次映射，规则全在这儿。
 */

import type { LabelDef } from "./terrain";

export interface LabelSource {
  id: string;
  name: string;
  /** 卡片锚点；没有锚点的条目直接跳过（没有位置可画） */
  anchor: [number, number] | null;
  /** 字号系数：山脉细长，用小一号的字，免得脉体被字整个压住 */
  scale: number;
}

/**
 * 挑出该标注的地名。**输出顺序就是避让优先级** ——
 * `terrain.ts` 的 `drawLabels` 按这个顺序画，被已画过的包围盒压住的直接跳过。
 *
 * @param all        全部条目（按数据顺序）
 * @param isSettled  判"这条已经在图上了吗"。调用方传 `isSettled(session, id)`，
 *                   **不要传 `isPlaced`** —— 图鉴与分类专练里大量条目是预置的，
 *                   按 isPlaced 过滤会让图鉴一个名字都没有（真实踩过的坑）。
 * @param priorityId 提到最前的那一条（刚放对 / 刚点开）。不在场上就自动忽略。
 */
export function pickLabels(
  all: LabelSource[],
  isSettled: (id: string) => boolean,
  priorityId: string | null
): LabelDef[] {
  const out: LabelDef[] = [];
  const seen = new Set<string>();

  // 去重、跳过无锚点 —— 两件事都在这里收口，
  // 免得调用方各自记得"要不要判重"（漏一处就会出现两个同名标签互相压）
  const take = (src: LabelSource | undefined) => {
    if (!src || seen.has(src.id) || !src.anchor) {
      return;
    }
    seen.add(src.id);
    out.push({ text: src.name, lon: src.anchor[0], lat: src.anchor[1], scale: src.scale });
  };

  // 优先级那一条也要判 isSettled：它可能刚被放对（在场上），
  // 也可能是一条已经在图上的条目被点了讲解 —— 两种都该排第一。
  if (priorityId) {
    take(all.find((s) => s.id === priorityId && isSettled(s.id)));
  }

  for (const s of all) {
    if (isSettled(s.id)) {
      take(s);
    }
  }
  return out;
}
