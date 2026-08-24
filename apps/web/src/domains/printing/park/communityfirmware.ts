// Клиент реестра прошивок сообщества (printer.wizard.md §5.2). Эндпоинт `GET /community-firmware`
// — контракт MF-889 (Back, todo на момент MF-903): таблица `community_firmware` уже в схеме
// (миграция 20260710440000), CRUD-ручки над ней — ещё нет (см. apps/api/src/devices|catalog — нет
// файла-регистратора). Читаем defensively, как и остальной каталог (home/catalog.ts getJson):
// сегодня любой запрос получит 404 → пустой список → честный EmptyState «никто не публиковал»,
// что СЕЙЧАС фактически верно (таблица только что создана, пуста для любой модели). Как только
// Back поднимет ручку по этому же пути, список начнёт наполняться без правок здесь.

import { apiFetch } from "@shared/api";
import type { components } from "src/api/generated/openapi";

export interface CommunityFirmwareEntry {
  id: string;
  model: string;
  author: string;
  gitUrl: string;
  verified: boolean;
}

export async function fetchCommunityFirmware(model: string): Promise<CommunityFirmwareEntry[]> {
  try {
    const response = await apiFetch(`/community-firmware?model=${encodeURIComponent(model)}`);
    if (!response.ok) return [];
    const data = (await response.json()) as components["schemas"]["CommunityFirmwarePageDto"];
    return (data.entries ?? []).map((row) => ({
      id: row.id,
      model: row.model,
      author: row.author,
      gitUrl: row.git_url,
      verified: row.verified,
    }));
  } catch {
    return [];
  }
}
