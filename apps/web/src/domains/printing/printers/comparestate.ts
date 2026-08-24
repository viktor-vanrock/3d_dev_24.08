import { useEffect, useState } from "react";

// Набор сравнения (docs/design/printers.catalog.md §3/§6/§7: «доступен без auth», переживает
// переход каталог → карточка принтера) — localStorage, не React-контекст: попадание на
// `/printers/<slug>` напрямую (из поиска, из ссылки) должно видеть тот же набор, что и каталог,
// без общего провайдера в дереве приложения. `/printers/compare?ids=…` — отдельный явный URL
// (router.ts printerComparePath), этот стор только держит РАБОЧИЙ черновик набора при просмотре.

const STORAGE_KEY = "portal.printers.compare.v1";
const LIMIT = 4;

function readStored(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function useCompareSet(): {
  ids: string[];
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  full: boolean;
} {
  const [ids, setIds] = useState<string[]>(readStored);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      // приватный режим/квота — набор просто не переживёт перезагрузку
    }
  }, [ids]);

  return {
    ids,
    has: (id: string) => ids.includes(id),
    toggle: (id: string) =>
      setIds((current) => (current.includes(id) ? current.filter((v) => v !== id) : current.length >= LIMIT ? current : [...current, id])),
    remove: (id: string) => setIds((current) => current.filter((v) => v !== id)),
    full: ids.length >= LIMIT,
  };
}
