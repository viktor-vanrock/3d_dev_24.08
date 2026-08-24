// Типы данных Маркетплейса (MF-911: вынесены из models.ts, чтобы файл клиента не разрастался).
// API-вызовы/утилиты остаются в models.ts и ре-экспортируют эти типы — импорты по всему
// market/ не меняются.

import type { AvatarConfig, AvatarSnapshots } from "@shared/avatar";
import type { CompatReason } from "./compat.ts";

export type ModelStatus = "uploaded" | "pending" | "processing" | "ready" | "failed";

export interface ModelOwner {
  id: string;
  username: string;
}

// Нормализованные форматы (apps/api/src/models/formats.ts EXTENSION_TO_FORMAT) — расширился
// мультиформатом MF-501: конвейерные stl/obj/3mf + «как есть» step/dxf/svg/gcode/gerber/zip.
export type SourceFormat = "stl" | "obj" | "3mf" | "step" | "dxf" | "svg" | "gcode" | "gerber" | "zip";

// Способ изготовления (MF-1961, apps/api/src/models/manufacturing.ts) — типизированный факт,
// НЕ тег: отдельно от craft (craft группирует ремесло, этот факт различает технологию ВНУТРИ
// печатного ремесла — FDM vs SLA, оба печатают STL/OBJ/3MF). null — не проставлено автором, не
// то же самое, что "не подходит ни один способ".
export type ManufacturingMethod = "fdm" | "sla" | "cnc" | "laser";

// project_summary (MF-1961) — краткая сводка карточки каталога без похода в /models/:id: сколько
// файлов у проекта и есть ли (и насколько подробный) гайд сборки.
export interface ProjectSummary {
  file_count: number;
  build_steps_count: number;
}

export interface MarketModel {
  id: string;
  title: string;
  description: string | null;
  status: ModelStatus;
  source_format: SourceFormat;
  // Slug ремесла (docs/epics/domain.model.md § Ремёсла). На MVP всё '3d_printing';
  // craft-бейдж/фильтр «зажигаются» от данных при появлении второго ремесла (projects.md §2.1).
  craft: string;
  manufacturing_method: ManufacturingMethod | null;
  requires_ams: boolean;
  created_at: string;
  votes_up: number;
  votes_down: number;
  downloads_count: number;
  price_minor?: number;
  currency?: string;
  tags: string[];
  thumb_url: string | null;
  owner: ModelOwner;
  project_summary: ProjectSummary;
  // Только при ?compatibility=mine (MF-1961) — какой принтер парка юзера подошёл и почему
  // (permissive-«примечания», не строгий вердикт compat/check.ts — см. GET /models list.ts).
  // null — фильтр активен, но подходящий принтер для этой строки не восстановлен (не должно
  // случаться при честном ответе сервера, но контракт держит поле опциональным по типу).
  compat?: { printer_id: string; reasons: CompatReason[] } | null;
}

// Скачиваемый артефакт проекта (docs/design/projects.md §3): роль + формат + размер.
// Контракт задан API (MF-501, GET /models/:id): `format` — расширение из S3-ключа
// (stl/3mf/nc/…), `null` если ключ без расширения. preview/thumbnail сюда не входят
// (ассеты презентации, не артефакты). Это тот же `files[]`, что потребляют MF-502/503.
export interface ProjectFile {
  id: string;
  role: string;
  format: string | null;
  size_bytes: number;
  // Оригинальное имя файла (git-backed роли, §10.2/§10.3) — нужно для отображения списка
  // доп-файлов и адресации DELETE /models/:id/files/:fileId. null для legacy-строк без него.
  original_filename: string | null;
}

// Обратная агрегация Make (MF-395 п.3/MF-779): «печатается на N станках / M филаментах»,
// средняя printability_rating — из view model_make_stats (apps/api/src/makes/stats.ts),
// не кэшируется, свежий Make виден сразу. Нулевые счётчики/null-рейтинг — не 404, модель без
// Make отдаёт их так же честно.
//
// MF-1962: avg_geometry_quality_rating (корректность геометрии/стыков МОДЕЛИ) и
// avg_surface_quality_rating (качество поверхности КОНКРЕТНЫХ отпечатков) — два независимых
// средних рядом с avg_printability_rating. UI не сворачивает их в одно число (model.stats.tsx) —
// это разные вопросы («хорош ли проект» vs «как вышло на конкретном станке/филаменте»).
export interface ModelMakeStats {
  makes_count: number;
  machines_count: number;
  materials_count: number;
  avg_printability_rating: number | null;
  avg_geometry_quality_rating: number | null;
  avg_surface_quality_rating: number | null;
}

export interface ModelComboStat {
  machine: { id: string; model: string };
  material: { id: string; name: string };
  combo_count: number;
}

// Рекомендованный филамент (MF-404 § модель↔рекомендованный филамент, MF-10) — точка связи
// каталога филамента (MF-624) и карточки проекта. null — рекомендация не задана, либо
// материал был удалён/архивирован из каталога (graceful: recommended_material_id уходит на
// null в БД, apps/api/src/models/detail.ts).
export interface RecommendedMaterial {
  id: string;
  slug: string;
  name: string;
  vendor: { id: string; slug: string; name: string };
}

// Публикация автора (MF-340), разведена с конвейерным `status`: `draft` — черновик, виден
// только владельцу (гейт — apps/api/src/models/visibility.ts); `published` — виден всем при
// status='ready'. Дефолт при создании — 'published' (upload.ts) — публикация по умолчанию,
// unpublish — опт-аут (решение Lead, MF-340).
export type PublishStatus = "draft" | "published";

export interface ModelDetail extends Omit<MarketModel, "owner"> {
  purchased?: boolean;
  publish_status: PublishStatus;
  bbox: unknown;
  size_bytes: number | null;
  my_vote: -1 | 0 | 1;
  make_stats: ModelMakeStats;
  top_combos: ModelComboStat[];
  preview_url: string | null;
  // Облегчённый GLB мобильного профиля (MF-433). Опционально: API это поле пока не отдаёт
  // (заявка Back — apps/mesh уже льёт `preview.mobile.glb` в S3, роль в схеме не расширена),
  // `?? undefined` в JSON-ответе читается как `undefined`, ModelViewer падает на `preview_url`.
  preview_mobile_url?: string | null;
  // Ссылка на скачивание канонического 3MF (MF-338, API-прокси — не presigned, apiAssetUrl()
  // перед использованием). null, пока модель не сконвертирована (нет role='canonical_3mf').
  download_url: string | null;
  files: ProjectFile[];
  // Блок «Код» (projects.md §4, дельта §4.2): фундамент-ссылка на репозиторий, задаётся в
  // редакторе. null — строки «Код» для репо-ссылки нет (но блок может быть виден по code_archive).
  repo_url: string | null;
  recommended_material: RecommendedMaterial | null;
  owner: ModelOwner & {
    display_name: string | null;
    avatar_url: string | null;
    avatar_config?: AvatarConfig | null;
    avatar_snapshots?: AvatarSnapshots | null;
    trusted_uploader: boolean;
  };
  // Вкладка «Статистика» владельца (docs/design/model.card.visual.md §4) — GAP-API: колонка
  // `models.comments_count` уже есть (marketplace_social_layer.sql), но GET /models/:id пока не
  // выбирает и не отдаёт её (apps/api/src/models/detail.ts) — заявка Back, однострочная правка.
  // `views_count` не существует вовсе — открытый вопрос Data (MF-826, marketplace.v2.md §4),
  // ждёт решения «нужны ли просмотры вообще». Оба опциональны: пока API их не отдаёт, тайл
  // рендерится приглушённым «—» вместо лжи нулём (см. ModelSocialTabs::StatValue в model.stats.tsx).
  comments_count?: number;
  views_count?: number;
}

// Дерево файлов репо (docs/epics/project.git.md §10.2, GET /models/:id/tree — MF-519):
// список путей исходников юзера (README.md и derived-роли туда не попадают, см. Back
// repository.ts). `source: 'fallback'` — модель ещё не мигрирована на git (MF-521, стейдж 3
// эпика) — те же данные, что и раньше, без реальных путей репо.
export interface RepoTreeEntry {
  path: string;
  size_bytes: number | null;
}

export interface RepoTreeResult {
  source: "git" | "fallback";
  entries: RepoTreeEntry[];
}

// История проекта (docs/design/projects.page.md §11.3, GET /models/:id/history — MF-519):
// сырые коммиты git-модуля (`subject` — raw commit message, не переведённый человеческий
// текст — API ещё не формирует словарь событий, см. apps/api/src/models/repository.ts).
// Front переводит `subject` в человеческую строку сам (repohistory.tsx::commitEventLabel).
export interface RepoHistoryCommit {
  sha: string;
  author_name: string;
  author_email: string;
  authored_at: string;
  subject: string;
}

export interface RepoHistoryResult {
  source: "git" | "fallback";
  commits: RepoHistoryCommit[];
}

// Обсуждение модели (docs/design/model.card.visual.md §3, v3 §4): роут на уже разрешённой
// полиморфной `comments` (subject_type in ('model','feed_post'), marketplace_social_layer.sql +
// feed_foundation.sql) — GAP-API, GET/POST/DELETE /models/:id/comments ещё не задеплоены Back'ом
// (нет в apps/api/src, только /feed/posts/:id/comments — другой subject_type). Контракт собран
// по образцу feed/comments.ts + v3 §4.4 (soft-delete с честным «кем удалено»); заявка — карточка
// MF-859-коммент Back. Вызовы уже готовы по контракту — заработают без правок Front, как только
// эндпоинты появятся на проде (тот же приём, что forkModel в models.ts).
export interface ModelCommentAuthor {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_config?: AvatarConfig | null;
  avatar_snapshots?: AvatarSnapshots | null;
}

export interface ModelComment {
  id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  // null — не удалён. deleted_by_owner различает два текста плейсхолдера (v3 §4.4): обычное
  // удаление автором vs удаление владельцем модели чужого комментария под своей моделью.
  deleted_at: string | null;
  deleted_by_owner: boolean;
  author: ModelCommentAuthor;
}

export interface ModelCommentsResult {
  items: ModelComment[];
}

// Фасеты каталога (MF-1961) — какие значения craft/source_format/manufacturing_method вообще
// встречаются ПРИ ТЕКУЩИХ остальных активных фильтрах (presence, не количество — счётчик моделей
// на значение отдал бы точный агрегат объёма каталога, запрещённый политикой антиэнумерации,
// docs/epics/ids.policy.md §5; см. apps/api/src/models/list.ts::facetPresentValues). Только вне
// ?featured=1 (hero не комбинируется с фасетами).
export interface CatalogFacets {
  craft: string[];
  source_format: SourceFormat[];
  manufacturing_method: ManufacturingMethod[];
  ams: { required: boolean; not_required: boolean };
}

export interface ListModelsResult {
  models: MarketModel[];
  has_more: boolean;
  // Opaque keyset-пагинация (MF-603, аудит опаковых ID): передать as-is в следующий listModels({cursor}),
  // не декодировать/не сравнивать. null — страниц больше нет.
  next_cursor: string | null;
  facets?: CatalogFacets;
}

export type ModelSort = "new" | "popular";

// Контакт из ЛК (MF-357, Фаза 1 эпика MF-15) — произвольная подпись+ссылка (мессенджер,
// соцсеть, магазин), не типизированный набор каналов.
export interface ProfileContact {
  label: string;
  url: string;
}

// Бейджи мастера (MF-993) — те же значения, что makers/contract.ts::MAKER_BADGES на бэкенде.
export type MakerBadge = "verified" | "top_farm" | "popular";

export interface UserProfile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_config?: AvatarConfig | null;
  avatar_snapshots?: AvatarSnapshots | null;
  bio: string | null;
  website_url: string | null;
  contacts: ProfileContact[];
  models_count: number;
  project_views_count: number;
  project_downloads_count: number;
  posts_count: number;
  post_views_count: number;
  post_score: number;
  post_comments_count: number;
  followers_count: number;
  following_count: number;
  is_following: boolean;
  badges: MakerBadge[];
  reputation_score: number;
  trust_level: number;
}

// Коды из таксономии § 6 docs/epics/formats.policy.md v0.2 (MF-501 привёл ответ
// upload-валидатора в соответствие с ней — раньше были lower_snake_case-строки).
export type UploadErrorCode =
  | "UNSUPPORTED_FORMAT"
  | "FORMAT_MISMATCH"
  | "FILE_TOO_LARGE"
  | "DECOMPRESSION_LIMIT"
  | "INVALID_REPO_URL"
  | "storage_not_configured"
  | "unauthorized"
  | "network"
  | "unknown";

// Картинка описания (роль description_image, MF-9/MF-656, docs/design/projects.multiformat.md
// §3.2): POST /models/:id/description-images, коды ошибок — apps/api models/descriptionimage.ts.
export interface DescriptionImage {
  id: string;
  url: string;
}

export type DescriptionImageErrorCode =
  | "DESCRIPTION_TOO_MANY_IMAGES"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_IMAGE_FORMAT"
  | "storage_not_configured"
  | "unauthorized"
  | "network"
  | "unknown";

// Доп-файлы (роль aux, MF-339 шаг 2, docs/epics/project.git.md §10.2): git-backed апload/удаление
// к УЖЕ существующей модели — POST/DELETE /models/:id/files (apps/api/src/models/files.ts).
// Не путать с description_image (uploadDescriptionImage выше) — разные роли, разные эндпоинты.
export interface AuxFile {
  id: string;
  role: "aux";
  original_filename: string;
  mime_type: string | null;
  size_bytes: number;
}

export type AuxFileErrorCode =
  | "FILENAME_REQUIRED"
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "FILENAME_CONFLICT"
  | "REPO_NOT_READY"
  | "REPO_TOO_LARGE"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "network"
  | "unknown";
