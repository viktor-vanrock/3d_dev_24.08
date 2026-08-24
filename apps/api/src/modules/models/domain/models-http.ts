export const MODEL_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

export const MODEL_AS_IS_DOWNLOAD_ROLES = new Set(["cnc_program", "drawing", "gerber", "code_archive", "aux"]);

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function asciiDownloadFilename(title: string): string {
  const ascii = title.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return ascii.length > 0 ? ascii.slice(0, 100) : "model";
}
