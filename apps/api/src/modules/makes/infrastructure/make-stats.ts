import { pool } from "../../../db/client.ts";
import { catalogComboLabels } from "../../catalog/public/index.ts";

// Реверс-агрегация Make → карточка модели (MF-10)/станка/филамента (MF-11), MF-395 п.3 / MF-779.
// Источник — четыре view без материализации из
// db/migrations/20260710270000_make_compat_aggregates.sql (EXPLAIN на 20k синтетических makes —
// карточка MF-395/9bdb3122). View читаются напрямую (не кэшируются) — агрегаты видны сразу на
// новый Make, тот же вердикт, что и у остальных read-view каталога (catalog/metrics.ts).

export interface ModelMakeStats {
  makes_count: number;
  machines_count: number;
  materials_count: number;
  avg_printability_rating: number | null;
  // MF-1962: две независимые средние рядом с avg_printability_rating — geometry_quality оценивает
  // сам проект (модель), surface_quality оценивает конкретные отпечатки. Не сворачиваются в общее
  // среднее (карточка прямо требует не смешивать качество проекта с качеством конкретной печати).
  avg_geometry_quality_rating: number | null;
  avg_surface_quality_rating: number | null;
}

const EMPTY_MODEL_STATS: ModelMakeStats = {
  makes_count: 0,
  machines_count: 0,
  materials_count: 0,
  avg_printability_rating: null,
  avg_geometry_quality_rating: null,
  avg_surface_quality_rating: null,
};

interface ModelMakeStatsRow {
  makes_count: string;
  machines_count: string;
  materials_count: string;
  avg_printability_rating: string | null;
  avg_geometry_quality_rating: string | null;
  avg_surface_quality_rating: string | null;
}

// model_make_stats не содержит строки для моделей без опубликованных Make — 0/null, не 404.
export async function getModelMakeStats(modelId: string): Promise<ModelMakeStats> {
  const result = await pool.query<ModelMakeStatsRow>(
    `select makes_count, machines_count, materials_count, avg_printability_rating,
            avg_geometry_quality_rating, avg_surface_quality_rating
     from model_make_stats where model_id = $1`,
    [modelId],
  );
  const row = result.rows[0];
  if (!row) return EMPTY_MODEL_STATS;
  return {
    makes_count: Number(row.makes_count),
    machines_count: Number(row.machines_count),
    materials_count: Number(row.materials_count),
    avg_printability_rating: row.avg_printability_rating === null ? null : Number(row.avg_printability_rating),
    avg_geometry_quality_rating: row.avg_geometry_quality_rating === null ? null : Number(row.avg_geometry_quality_rating),
    avg_surface_quality_rating: row.avg_surface_quality_rating === null ? null : Number(row.avg_surface_quality_rating),
  };
}

export interface MakeReverseStats {
  make_count: number;
  model_count: number;
}

const EMPTY_REVERSE_STATS: MakeReverseStats = { make_count: 0, model_count: 0 };

interface ReverseStatsRow {
  make_count: string;
  model_count: string;
}

// Реверс: карточка станка — «печати на этом железе» (machine_make_stats).
export async function getMachineMakeStats(machineId: string): Promise<MakeReverseStats> {
  const result = await pool.query<ReverseStatsRow>(`select make_count, model_count from machine_make_stats where machine_id = $1`, [machineId]);
  const row = result.rows[0];
  if (!row) return EMPTY_REVERSE_STATS;
  return { make_count: Number(row.make_count), model_count: Number(row.model_count) };
}

// Реверс: карточка филамента — «печати этим филаментом» (material_make_stats).
export async function getMaterialMakeStats(materialId: string): Promise<MakeReverseStats> {
  const result = await pool.query<ReverseStatsRow>(`select make_count, model_count from material_make_stats where material_id = $1`, [materialId]);
  const row = result.rows[0];
  if (!row) return EMPTY_REVERSE_STATS;
  return { make_count: Number(row.make_count), model_count: Number(row.model_count) };
}

export interface MakeSummary {
  id: string;
  created_at: Date;
  caption: string | null;
  printability_rating: number | null;
  // MF-991: работа мастера может не ссылаться на каталожную модель (nullable).
  model: { id: string; title: string } | null;
  user: { id: string; username: string; display_name: string | null; avatar_url: string | null };
}

interface MakeSummaryRow {
  id: string;
  created_at: Date;
  caption: string | null;
  printability_rating: number | null;
  model_id: string | null;
  model_title: string | null;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

function makeSummaryJson(row: MakeSummaryRow): MakeSummary {
  return {
    id: row.id,
    created_at: row.created_at,
    caption: row.caption,
    printability_rating: row.printability_rating,
    model: row.model_id ? { id: row.model_id, title: row.model_title! } : null,
    user: { id: row.user_id, username: row.username, display_name: row.display_name, avatar_url: row.avatar_url },
  };
}

// Листинг «печати на этом станке» — index scan по makes_machine_published_idx (комментарий в
// самой миграции задаёт эту ровно форму запроса), тот же limit+1-приём has_more, что
// catalog/materials.ts. photo_s3_key намеренно не отдаём: presigned/прокси-раздача фото Make —
// отдельный storage-скоуп (MF-393), вне этой карточки.
export async function listMakesByMachine(machineId: string, limit: number, offset: number): Promise<{ makes: MakeSummary[]; has_more: boolean }> {
  const result = await pool.query<MakeSummaryRow>(
    `select mk.id, mk.created_at, mk.caption, mk.printability_rating,
            p.id as model_id, pr.metadata_snapshot ->> 'title' as model_title,
            u.user_id, u.username, u.display_name, u.avatar_url
     from makes mk
     left join projects p on p.id = mk.model_id and p.deleted_at is null
     left join project_revisions pr on pr.id = p.published_revision_id and pr.project_id = p.id
     join identity_read_v1 u on u.user_id = mk.user_id
     where mk.machine_id = $1 and mk.status = 'published'
     order by mk.created_at desc
     limit $2 offset $3`,
    [machineId, limit + 1, offset],
  );
  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
  return { makes: rows.map(makeSummaryJson), has_more: hasMore };
}

// Листинг «печати этим филаментом» — join make_materials (make_materials_material_idx).
export async function listMakesByMaterial(materialId: string, limit: number, offset: number): Promise<{ makes: MakeSummary[]; has_more: boolean }> {
  const result = await pool.query<MakeSummaryRow>(
    `select mk.id, mk.created_at, mk.caption, mk.printability_rating,
            p.id as model_id, pr.metadata_snapshot ->> 'title' as model_title,
            u.user_id, u.username, u.display_name, u.avatar_url
     from make_materials mm
     join makes mk on mk.id = mm.make_id
     left join projects p on p.id = mk.model_id and p.deleted_at is null
     left join project_revisions pr on pr.id = p.published_revision_id and pr.project_id = p.id
     join identity_read_v1 u on u.user_id = mk.user_id
     where mm.material_id = $1 and mk.status = 'published'
     order by mk.created_at desc
     limit $2 offset $3`,
    [materialId, limit + 1, offset],
  );
  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
  return { makes: rows.map(makeSummaryJson), has_more: hasMore };
}

export interface ComboStat {
  machine: { id: string; model: string };
  material: { id: string; name: string };
  combo_count: number;
}

interface ComboStatRow {
  machine_id: string;
  machine_model: string;
  material_id: string;
  material_name: string;
  combo_count: string;
}

// Топ связок станок×филамент по модели (MF-395 п.3 «топ-совместимые связки») — сортировку/LIMIT
// делает этот запрос, view отдаёт только сгруппированные счётчики (комментарий в миграции).
export async function topCombosForModel(modelId: string, limit: number): Promise<ComboStat[]> {
  const result = await pool.query<Omit<ComboStatRow, "machine_model" | "material_name">>(
    `select c.machine_id, c.material_id, c.combo_count
     from model_printer_material_combo_stats c
     where c.model_id = $1
     order by c.combo_count desc`,
    [modelId],
  );
  const labels = await catalogComboLabels(
    result.rows.map((row) => row.machine_id),
    result.rows.map((row) => row.material_id),
  );
  return result.rows
    .map((row) => ({
      machine: { id: row.machine_id, model: labels.machines.get(row.machine_id) ?? "" },
      material: { id: row.material_id, name: labels.materials.get(row.material_id) ?? "" },
      combo_count: Number(row.combo_count),
    }))
    .sort((left, right) => right.combo_count - left.combo_count || left.machine.model.localeCompare(right.machine.model) || left.material.name.localeCompare(right.material.name))
    .slice(0, limit);
}
