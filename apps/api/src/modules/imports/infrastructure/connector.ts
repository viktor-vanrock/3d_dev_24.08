// Единый интерфейс коннектора импорта (MF-37/MF-417, стадия 1 — эта карточка) поверх схемы
// import_connections/import_bindings (db/migrations/20260710010000_import_pipeline_foundation.sql,
// docs/epics/domain.model.md § «Импорт моделей с внешних площадок»). Реализация под конкретный
// источник (Cults3D — GraphQL-клиент) — отдельная карточка стадии 2, зависящая от этой; здесь
// только контракт + normalize(), который сама реализация обязана использовать.

export type SourcePlatform = "cults3d";

// auth — то, чем коннектор авторизуется к источнику (для Cults3D — Basic base64(username:api_key),
// расшифрованный из import_connections.credential_enc вызывающим кодом; сам коннектор секрет не
// хранит и не логирует).
export interface ImportAuth {
  username: string;
  apiKey: string;
}

// Сводка по модели из listOwnModels — минимум для UI выбора «что импортировать», без похода
// за полными метаданными/файлами (те — отдельные resolveMeta/fetchFiles/fetchImages, дороже).
export interface ExternalModelSummary {
  externalId: string;
  title: string;
  originalUrl: string;
  thumbnailUrl?: string;
}

// Попытка при этом источнике не описывает финальную схему — meta.raw хранит источник как есть
// (на случай, если normalize() позже понадобится поле, которое сейчас не замаплено).
export interface ExternalModelMeta {
  externalId: string;
  originalUrl: string;
  title: string;
  description?: string;
  license: string;
  tags: string[];
  category?: string;
  popularity: Record<string, number>;
  raw?: unknown;
}

export interface ExternalFile {
  filename: string;
  downloadUrl: string;
  sizeBytes?: number;
}

export interface ExternalImage {
  url: string;
  isPrimary?: boolean;
}

// Черновик модели, который normalize() возвращает из ЧИСТЫХ метаданных (не трогает файлы —
// fetchFiles/fetchImages идут отдельным вызовом в коде стадии 2, который комбинирует этот
// драфт с реальным списком файлов; source_format определяется по факту байтов через
// detectAndValidateFormat из ../models/formats.ts, не угадывается здесь). Код коннектора
// (стадия 2) пишет draft в models (+model_files роль 'source', +import_bindings). license/
// category — в терминах НАШЕЙ таксономии (см. normalize.ts LICENSE_MAP); sourceLicense/
// sourcePopularity ниже — исходные значения источника как есть, без потери, идут в
// import_bindings.source_license/source_popularity.
export interface ModelDraft {
  title: string;
  description?: string;
  license: string;
  tags: string[];
  category?: string;
  sourceLicense: string;
  sourcePopularity: Record<string, number>;
}

// Сигнатура — как зафиксировано в карточке MF-739: listOwnModels принимает auth явно (первый
// вызов джоба, до того как что-либо известно про источник); resolveMeta/fetchFiles/fetchImages
// берут только externalId — коннектор уже привязан к одному auth-контексту на всё время жизни
// инстанса (стадия 2 создаёт его фабрикой вида createCults3dConnector(auth): ImportConnector,
// одна на джоб/аккаунт-источник, не на вызов).
export interface ImportConnector {
  listOwnModels(auth: ImportAuth): Promise<ExternalModelSummary[]>;
  resolveMeta(externalId: string): Promise<ExternalModelMeta>;
  fetchFiles(externalId: string): Promise<ExternalFile[]>;
  fetchImages(externalId: string): Promise<ExternalImage[]>;
}
