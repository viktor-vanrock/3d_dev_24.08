// Черновик редактора /feed/new (docs/design/feed.post.editor.md §2.8): один черновик в
// localStorage, не менеджер черновиков. Файлы медиа-вложения не сериализуются (Blob не переживает
// JSON.stringify/localStorage) — сохраняем только имя файла как напоминание "было прикреплено",
// автор перевыбирает файл заново после восстановления (единственная деградация черновика).

export const DRAFT_STORAGE_KEY = "portal.feed.draft.v1";

export interface DraftAttachment {
  kind: "model" | "media-placeholder" | "gitverse";
  modelId?: string;
  title?: string;
  thumbUrl?: string | null;
  fileName?: string;
  // Ссылка вложения GitVerse (MF-1051) — превью не сериализуется, перепарсивается при
  // восстановлении черновика (тот же приём, что "перевыбери файл заново" для media).
  url?: string;
}

export interface FeedDraft {
  communityId: string | null;
  title: string;
  body: string;
  attachment: DraftAttachment | null;
}

export const EMPTY_DRAFT: FeedDraft = { communityId: null, title: "", body: "", attachment: null };

export function isDraftEmpty(draft: FeedDraft): boolean {
  return !draft.title.trim() && !draft.body.trim() && !draft.attachment;
}

export function saveDraft(draft: FeedDraft): void {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Приватный режим/квота — черновик просто не переживёт перезагрузку, не критично для формы.
  }
}

export function loadDraft(): FeedDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FeedDraft>;
    if (typeof parsed !== "object" || parsed === null) return null;
    const draft: FeedDraft = {
      communityId: typeof parsed.communityId === "string" ? parsed.communityId : null,
      title: typeof parsed.title === "string" ? parsed.title : "",
      body: typeof parsed.body === "string" ? parsed.body : "",
      attachment: parsed.attachment ?? null,
    };
    return isDraftEmpty(draft) ? null : draft;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // см. saveDraft
  }
}
