export const UPLOAD_STATUS = {
  PENDING: "pending",
  VALIDATING: "validating",
  READY: "ready",
  FAILED: "failed",
  ABANDONED: "abandoned",
} as const;

export type UploadStatus = (typeof UPLOAD_STATUS)[keyof typeof UPLOAD_STATUS];

export const FILE_ROLE = {
  SOURCE: "source",
  PREVIEW: "preview",
  PHOTO: "photo",
  MEDIA: "media",
  AVATAR: "avatar",
} as const;

export type FileRole = (typeof FILE_ROLE)[keyof typeof FILE_ROLE];

export const UPLOAD_LIMITS = {
  source: 100 * 1024 * 1024,
  preview: 10 * 1024 * 1024,
  photo: 12 * 1024 * 1024,
  media: 200 * 1024 * 1024,
  avatar: 5 * 1024 * 1024,
} as const satisfies Record<FileRole, number>;

export const ALLOWED_MIME: Record<FileRole, ReadonlySet<string>> = {
  source: new Set([
    "model/stl",
    "application/sla",
    "model/3mf",
    "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
    "model/obj",
    "application/octet-stream",
    "application/step",
    "model/step",
    "image/svg+xml",
    "text/x-gcode",
    "text/plain",
    "application/x-gerber",
    "application/zip",
    "image/vnd.dxf",
    "application/dxf",
  ]),
  preview: new Set(["image/jpeg", "image/png", "image/webp"]),
  photo: new Set(["image/jpeg", "image/png", "image/webp", "model/3mf", "application/zip"]),
  media: new Set(["image/jpeg", "image/png", "video/mp4"]),
  avatar: new Set(["image/jpeg", "image/png", "image/webp"]),
};

export class UploadError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const UploadErrors = {
  tooLarge: (role: FileRole) => new UploadError(413, "upload.too_large.v1", `Файл превышает допустимый размер для роли ${role}`),
  unsupportedMime: (mime: string) => new UploadError(415, "upload.unsupported_mime.v1", `MIME-тип не поддерживается: ${mime}`),
  formatMismatch: () => new UploadError(400, "upload.format_mismatch.v1", "Содержимое файла не совпадает с форматом"),
  signatureFailed: () => new UploadError(400, "upload.signature_failed.v1", "Файл не прошёл проверку сигнатуры"),
  uploadNotFound: () => new UploadError(404, "upload.not_found.v1", "Загрузка не найдена или истёк срок"),
  notReady: () => new UploadError(409, "upload.not_ready.v1", "Файл ещё не прошёл проверку"),
} as const;

export function tempObjectKey(uploadId: string): string {
  return `temp/uploads/${uploadId}`;
}

export function quarantineObjectKey(uploadId: string): string {
  return `temp/quarantine/${uploadId}`;
}
