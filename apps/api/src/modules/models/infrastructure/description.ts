// Лимиты описания-markdown (MF-501, Р3 эпика MF-497, design/projects.multiformat.md §3.1/§3.2):
// сырец ≤ 50 КБ, ≤ 20 картинок-ссылок. Хранение — сырой markdown как есть в models.description
// (санитизация/рендер — на клиенте, эпик §3.4), здесь только серверные лимиты приёма.

export const MAX_DESCRIPTION_BYTES = 50 * 1024;
export const MAX_DESCRIPTION_IMAGES = 20;

export class DescriptionTooLongError extends Error {
  constructor() {
    super(`description exceeds ${MAX_DESCRIPTION_BYTES} bytes`);
    this.name = "DescriptionTooLongError";
  }
}

export class TooManyDescriptionImagesError extends Error {
  constructor() {
    super(`description references more than ${MAX_DESCRIPTION_IMAGES} images`);
    this.name = "TooManyDescriptionImagesError";
  }
}

// Markdown-синтаксис картинки: ![alt](url). Считаем ссылки в сыром тексте — рендер/санитайзер
// (что реально становится <img>) остаётся на клиенте (эпик §3.4), здесь только грубый лимит
// приёма, чтобы не сохранить в БД описание с сотнями встроенных картинок.
const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;

export function validateDescription(description: string): void {
  if (Buffer.byteLength(description, "utf8") > MAX_DESCRIPTION_BYTES) {
    throw new DescriptionTooLongError();
  }
  const imageCount = description.match(MARKDOWN_IMAGE_RE)?.length ?? 0;
  if (imageCount > MAX_DESCRIPTION_IMAGES) {
    throw new TooManyDescriptionImagesError();
  }
}
