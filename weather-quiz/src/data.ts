import { useEffect, useState } from "react";
import type { BankData, GalleryData } from "./types";

/**
 * 数据在运行时按需加载（public/data/*.json 会被 Vite 原样拷进 dist/web）。
 * 加载失败时必须给"重试"按钮 —— 平台 iframe 冷启动时脚本可能没拿到，
 * 让学生只能手动刷新是很差的体验。
 */
export function useJson<T>(file: string): {
  data: T | null;
  error: string | null;
  retry: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    fetch(file, { cache: "no-cache" })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((json) => {
        if (alive) {
          setData(json as T);
        }
      })
      .catch((err: unknown) => {
        if (alive) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      alive = false;
    };
  }, [file, tick]);

  return { data, error, retry: () => setTick((v) => v + 1) };
}

export function useBank() {
  return useJson<BankData>("data/questions.json");
}

export function useGallery() {
  return useJson<GalleryData>("data/elements.json");
}
