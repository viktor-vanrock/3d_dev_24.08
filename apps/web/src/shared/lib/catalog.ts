// Клиент каталогов станков/филамента (MF-437 § «picker принтера MF-32», «шаг «ваш пластик»
// MF-31») — тонкие обёртки над РЕАЛЬНЫМИ read-эндпоинтами каталога (apps/api/src/catalog/
// machines.ts «GET /machines» — MF-32 W2/MF-619; apps/api/src/catalog/materials.ts
// «GET /materials» — MF-624). Picker и шаг филамента читают ТОЛЬКО через них — никакого
// мокового списка на клиенте, никакой собственной read-ручки (тот же каталог, что и общий
// GET /machines?q=/GET /materials?type= — не дублируем API, которое уже есть у MF-32/MF-31).

import type { components } from "src/api/generated/openapi";
import { apiFetch } from "@shared/api";

export interface CatalogMachine {
  id: string;
  brand: string;
  model: string;
}

export interface CatalogMaterial {
  id: string;
  name: string;
  brand: string;
  materialType: string;
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await apiFetch(`${path}`, { credentials: "include" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function toCatalogMachine(row: components["schemas"]["CatalogMachineDto"]): CatalogMachine {
  return { id: row.id, brand: row.vendor?.name ?? "", model: row.model };
}

// Курированные паттерны популярных принтеров для чипов первого экрана (эпик MF-437: «чипсы
// 6-8 популярных (A1/A1 mini/P1S/X1C/Ender-3 V3/MK4/PICASO)»). НЕ отдельный API-параметр —
// GET /machines (MF-32 W2) не знает понятия «популярности», поэтому каждый чип ищем отдельным
// точечным запросом и берём первое совпадение. `q` в GET /machines матчит только model/aliases
// (НЕ имя вендора — apps/api/src/catalog/machines.ts), поэтому паттерны — названия моделей без
// бренда. PICASO (RU-бренд) сюда не входит: это имя вендора, а не модели, точечным q-поиском
// по модели найти конкретную «модель Picaso» без каталога брендов нельзя; источник bootstrap-
// импорта (MF-405) в основном западный, скорее всего Picaso там и не появится. Если модели нет
// в каталоге — просто не будет чипа, чипов может быть меньше 6-8, это ожидаемо (граница
// каталога, не баг).
const POPULAR_PRINTER_QUERIES = ["A1 mini", "A1", "P1S", "X1C", "Ender-3 V3", "MK4"];

export async function fetchPopularMachines(): Promise<CatalogMachine[]> {
  const results = await Promise.all(
    POPULAR_PRINTER_QUERIES.map((q) =>
      getJson<components["schemas"]["CatalogMachinesDto"]>(
        `/machines?kind=fdm_printer&q=${encodeURIComponent(q)}&limit=1`,
      ),
    ),
  );
  // Отличаем пустой каталог от недоступного API: picker должен честно показать
  // ошибку и дать повторить запрос, а не маскировать сетевой сбой пустым экраном.
  if (results.every((data) => data === null)) throw new Error("popular machines unavailable");
  const seen = new Set<string>();
  const machines: CatalogMachine[] = [];
  for (const data of results) {
    const row = data?.machines?.[0];
    if (row && !seen.has(row.id)) {
      seen.add(row.id);
      machines.push(toCatalogMachine(row));
    }
  }
  return machines;
}

export async function searchMachines(q: string): Promise<CatalogMachine[]> {
  if (!q.trim()) return [];
  const data = await getJson<components["schemas"]["CatalogMachinesDto"]>(
    `/machines?kind=fdm_printer&q=${encodeURIComponent(q)}&limit=8`,
  );
  return (data?.machines ?? []).map(toCatalogMachine);
}

function toCatalogMaterial(row: components["schemas"]["CatalogMaterialDto"]): CatalogMaterial {
  return { id: row.id, name: row.name, brand: row.vendor.name, materialType: row.material_type.slug };
}

// «1-2 чипа частых (PLA/PETG + RU-бренд)» (MF-437) — по одному представителю на тип
// материала, самый свежий (`GET /materials` сортирует по имени; берём первую страницу —
// каталог филамента маленький на этой фазе, MF-624 W2 без собственного импортёра).
const POPULAR_FILAMENT_TYPES = ["pla", "petg"];

export async function fetchPopularMaterials(): Promise<CatalogMaterial[]> {
  const results = await Promise.all(
    POPULAR_FILAMENT_TYPES.map((type) =>
      getJson<components["schemas"]["CatalogMaterialsDto"]>(`/materials?kind=filament&type=${type}&limit=1`),
    ),
  );
  const materials: CatalogMaterial[] = [];
  for (const data of results) {
    const row = data?.materials?.[0];
    if (row) materials.push(toCatalogMaterial(row));
  }
  return materials;
}

// Поиск филамента для пикера «Рекомендованный филамент» в карточке проекта (MF-404 § MF-10) —
// тот же приём, что searchMachines выше, поверх `q` на GET /materials (MF-624 W2 доработка).
export async function searchMaterials(q: string): Promise<CatalogMaterial[]> {
  if (!q.trim()) return [];
  const data = await getJson<components["schemas"]["CatalogMaterialsDto"]>(
    `/materials?kind=filament&q=${encodeURIComponent(q)}&limit=8`,
  );
  return (data?.materials ?? []).map(toCatalogMaterial);
}

export interface MaterialVariant {
  id: string;
  color_name: string | null;
  color_hex: string | null;
  diameter_mm: number | null;
}

// Чипы «Цвет/вариант» модалки редактирования филамента (MF-951/MF-939 §3) — GET /materials/:id
// уже отдаёт `variants[]`, доп-бэкенда не нужно (apps/api/src/catalog/materials.ts).
export async function fetchMaterialVariants(materialId: string): Promise<MaterialVariant[]> {
  const data = await getJson<{ material: { variants: readonly components["schemas"]["CatalogVariantDto"][] } }>(
    `/materials/${encodeURIComponent(materialId)}`,
  );
  return data ? [...data.material.variants] : [];
}