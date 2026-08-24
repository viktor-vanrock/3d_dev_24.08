// Хелперы картинок markdown-описания, роль description_image (MF-9, GAP-33
// docs/design/projects.multiformat.md §3.2, MF-656). Route мигрирован в Nest
// (modules/models + nest/integration); здесь остаются только разделяемые хелперы, которые
// Nest-адаптеры импортируют как единый источник: лимит размера, определение формата по
// magic-байтам, таблица форматов и построение относительного URL.
//
// Формат определяется по magic-байтам файла (тот же принцип, что models/formats.ts) —
// расширение/mimetype клиента не участвуют в выборе content-type на отдаче.

export const MAX_DESCRIPTION_IMAGE_BYTES = 10 * 1024 * 1024; // 10 МБ — картинка описания, не модель (MAX_UPLOAD_BYTES=100МБ там, upload.ts)

export type ImageFormat = "png" | "jpeg" | "gif" | "webp";

export const IMAGE_FORMATS: Record<ImageFormat, { ext: string; contentType: string }> = {
  png: { ext: "png", contentType: "image/png" },
  jpeg: { ext: "jpg", contentType: "image/jpeg" },
  gif: { ext: "gif", contentType: "image/gif" },
  webp: { ext: "webp", contentType: "image/webp" },
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const GIF87_MAGIC = Buffer.from("GIF87a", "ascii");
const GIF89_MAGIC = Buffer.from("GIF89a", "ascii");
const RIFF_MAGIC = Buffer.from("RIFF", "ascii");
const WEBP_MAGIC = Buffer.from("WEBP", "ascii");

export function detectImageFormat(buffer: Buffer): ImageFormat | null {
  if (buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return "png";
  if (buffer.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) return "jpeg";
  if (buffer.subarray(0, 6).equals(GIF87_MAGIC) || buffer.subarray(0, 6).equals(GIF89_MAGIC)) return "gif";
  if (buffer.subarray(0, 4).equals(RIFF_MAGIC) && buffer.subarray(8, 12).equals(WEBP_MAGIC)) return "webp";
  return null;
}

// Относительный путь — API и веб живут на разных поддоменах (models.ts::apiAssetUrl), Front
// достраивает абсолютный URL перед вставкой в markdown; markdown.tsx::stripForeignImages уже
// признаёт такие пути "своими" (src.startsWith("/")).
export function descriptionImageUrl(modelId: string, fileId: string): string {
  return `/models/${modelId}/description-images/${fileId}`;
}
