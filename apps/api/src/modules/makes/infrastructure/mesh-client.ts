// Внутренний клиент HTTP-поверхности apps/mesh (MF-842) — приём фото Make (MF-27 Ф2, MF-1793).
// mesh слушает ТОЛЬКО 127.0.0.1:3101 (docs/infra/readme.md, apps/mesh/deploy/portal.mesh-http.service:
// порт 3100 на этом VDS уже занят docker-proxy multica-frontend — использовать 3101, не 3100 из
// старых заметок в описании этой самой карточки), без публичного домена и без auth — тот же
// приватный контур, что models-конвейер (apps/mesh/worker), только синхронный HTTP вместо очереди
// БД (make_photos.py: ресайз — операция на десятки-сотни мс, отдельная асинхронная очередь ради
// неё избыточна). MESH_HTTP_URL — точка расширения на случай другого порта/хоста (тот же приём,
// что остальной repo: process.env читается на каждый вызов, без кэша модуля).

export interface MeshMakePhoto {
  id: string;
  make_id: string;
  s3_key: string;
  position: number;
  is_cover: boolean;
  moderation_status: string;
}

export type MeshUploadResult = { ok: true; photo: MeshMakePhoto } | { ok: false; status: number; error: string; existingMakeId?: string };

export function meshBaseUrl(): string {
  return process.env.MESH_HTTP_URL ?? "http://127.0.0.1:3101";
}

interface MeshErrorDetail {
  error?: string;
  message?: string;
  existing_make_id?: string;
}

// POST /make-photos (apps/mesh/src/mesh/main.py): multipart make_id+file → EXIF/GPS-стрип, три
// webp-варианта, перцептивный анти-дуп-хэш, авто-премодерация (approved|pending, никогда
// rejected автоматически — см. photo.py) → строка make_photos пишется mesh'ем напрямую (свой
// psycopg-коннект к той же БД, не через apps/api). Здесь — только перенос байтов и разбор ответа.
export async function uploadMakePhoto(makeId: string, file: Buffer, filename: string, contentType: string): Promise<MeshUploadResult> {
  const form = new FormData();
  form.set("make_id", makeId);
  form.set("file", new Blob([file], { type: contentType || "application/octet-stream" }), filename || "photo");

  let response: Response;
  try {
    response = await fetch(`${meshBaseUrl()}/make-photos`, { method: "POST", body: form });
  } catch {
    return { ok: false, status: 503, error: "mesh_unreachable" };
  }

  if (response.status === 201) {
    const photo = (await response.json()) as MeshMakePhoto;
    return { ok: true, photo };
  }

  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
  const detail = body?.detail;
  if (typeof detail === "object" && detail !== null) {
    const d = detail as MeshErrorDetail;
    return { ok: false, status: response.status, error: d.error ?? `mesh_error_${response.status}`, existingMakeId: d.existing_make_id };
  }
  return { ok: false, status: response.status, error: typeof detail === "string" ? detail : `mesh_error_${response.status}` };
}
