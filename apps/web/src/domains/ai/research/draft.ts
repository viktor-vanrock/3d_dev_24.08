// Автосейв черновика формы /research/<slug> (§2.8, тот же паттерн, что feed/draft.ts §2.8
// feed.post.editor.md): один слот черновика, не менеджер черновиков — ровно как в ленте.
// Черновик хранит СВОЙ slug (посчитанный на момент сохранения) — восстанавливаем баннер, только
// когда он относится к экрану, на который зашли (иначе черновик другой карточки протёк бы сюда).

import { currentSlug, emptyFormState, type FormState } from "./formstate.ts";

export const DRAFT_STORAGE_KEY = "portal.research.draft.v1";

interface StoredDraft {
  slug: string;
  state: FormState;
}

export function isFormEmpty(state: FormState): boolean {
  return !state.brand.trim() && !state.model.trim();
}

export function saveResearchDraft(state: FormState): void {
  if (isFormEmpty(state)) return;
  try {
    const payload: StoredDraft = { slug: currentSlug(state), state };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // квота/приватный режим — черновик просто не переживёт перезагрузку
  }
}

// targetSlug — slug экрана, на который зашли ("" для /research/new до ввода brand/model).
// Черновик отдаётся, только если относится к тому же слугу (или к ещё-безымянному новому).
export function loadResearchDraft(targetSlug: string): FormState | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (!parsed || typeof parsed.slug !== "string" || !parsed.state) return null;
    if (targetSlug && parsed.slug !== targetSlug) return null;
    const state = { ...emptyFormState(), ...parsed.state };
    return isFormEmpty(state) ? null : state;
  } catch {
    return null;
  }
}

export function clearResearchDraft(): void {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // см. saveResearchDraft
  }
}
