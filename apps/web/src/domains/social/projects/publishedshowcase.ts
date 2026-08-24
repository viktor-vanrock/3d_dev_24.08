// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { demoModelFor, SOARM_PROJECT_ID, type MarketModel } from "@domains/commerce";
// Временный единый шов опубликованных code-first проектов.
//
// SO‑ARM100 уже является полноценным публичным релизом Author Studio, но до появления
// production-строки в models живёт вне обычного GET /models. И каталог проектов, и главная
// должны собирать витрину одинаково. Когда Backend начнёт возвращать релиз сам, дедупликация
// по id бесшовно уберёт локальную вставку.
export function mergePublishedShowcase(
  models: MarketModel[],
  query: { q: string; tags: string[] },
): MarketModel[] {
  const showcase = demoModelFor(SOARM_PROJECT_ID);
  if (!showcase) return models;

  const normalizedQuery = query.q.trim().toLocaleLowerCase("ru-RU");
  const haystack = [
    showcase.title,
    showcase.description,
    showcase.owner.username,
    showcase.owner.display_name,
    ...showcase.tags,
  ]
    .join(" ")
    .toLocaleLowerCase("ru-RU");
  if (normalizedQuery && !normalizedQuery.split(/\s+/).every((word) => haystack.includes(word))) return models;

  const normalizedTags = showcase.tags.map((tag) => tag.toLocaleLowerCase("ru-RU"));
  const matchesTags = query.tags.every((tag) => {
    const normalized = tag.toLocaleLowerCase("ru-RU");
    if (normalized === "без ams") return !showcase.requires_ams;
    if (normalized === "ams") return Boolean(showcase.requires_ams);
    if (normalized === "sla") return showcase.manufacturing_method === "sla";
    if (normalized === "чпу") return showcase.craft === "cnc";
    return normalizedTags.includes(normalized);
  });
  if (!matchesTags) return models;

  return [showcase, ...models.filter((model) => model.id !== showcase.id)];
}
