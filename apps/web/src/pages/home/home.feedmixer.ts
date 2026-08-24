import { useLayoutEffect, useState } from "react";

type FeedSource = "model" | "concept";

export interface FeedTileKey {
  source: FeedSource;
  id: string;
}

interface FeedItem {
  id: string;
}

// Четыре разных ряда дают живой редакторский ритм, но сохраняют баланс 2×2:
// ни проекты, ни концепты не слипаются в отдельный визуальный раздел.
const FEED_SOURCE_PATTERN: readonly FeedSource[] = [
  "model", "concept", "model", "concept",
  "concept", "model", "model", "concept",
  "model", "concept", "concept", "model",
  "concept", "model", "concept", "model",
];

export function appendStableFeedKeys(
  current: FeedTileKey[],
  models: readonly FeedItem[],
  concepts: readonly FeedItem[],
): FeedTileKey[] {
  const knownModels = new Set(
    current.filter((item) => item.source === "model").map((item) => item.id),
  );
  const knownConcepts = new Set(
    current.filter((item) => item.source === "concept").map((item) => item.id),
  );
  const newModelIds = models.map((model) => model.id).filter((id) => !knownModels.has(id));
  const newConceptIds = concepts.map((concept) => concept.id).filter((id) => !knownConcepts.has(id));
  if (newModelIds.length === 0 && newConceptIds.length === 0) return current;

  const appended: FeedTileKey[] = [];
  let modelIndex = 0;
  let conceptIndex = 0;
  let patternIndex = current.length % FEED_SOURCE_PATTERN.length;
  while (modelIndex < newModelIds.length || conceptIndex < newConceptIds.length) {
    const preferred = FEED_SOURCE_PATTERN[patternIndex];
    const canTakeModel = modelIndex < newModelIds.length;
    const canTakeConcept = conceptIndex < newConceptIds.length;
    if (preferred === "model" ? canTakeModel : !canTakeConcept && canTakeModel) {
      appended.push({ source: "model", id: newModelIds[modelIndex++]! });
    } else {
      appended.push({ source: "concept", id: newConceptIds[conceptIndex++]! });
    }
    patternIndex = (patternIndex + 1) % FEED_SOURCE_PATTERN.length;
  }
  return [...current, ...appended];
}

export function useStableFeedKeys(
  models: readonly FeedItem[],
  concepts: readonly FeedItem[],
  sourcesSettling: boolean,
): FeedTileKey[] {
  const [keys, setKeys] = useState<FeedTileKey[]>([]);

  // Пока одна половина страницы ещё едет по сети, держим предыдущую композицию.
  // После завершения обоих запросов добавляем только новые ключи: уже видимые
  // карточки никогда не телепортируются из ячейки в ячейку.
  useLayoutEffect(() => {
    if (sourcesSettling) return;
    setKeys((current) => appendStableFeedKeys(current, models, concepts));
  }, [concepts, models, sourcesSettling]);

  return keys;
}
