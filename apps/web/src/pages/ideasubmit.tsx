import { useEffect, useRef, useState } from "react";
import { useGuestLogin, type SessionUser } from "@domains/access";
import { TypeSelect, type IssueType, IDEA_STATUS_META, listMyIdeas, type IdeaStatus, MarkdownEditor } from "@domains/commerce";
import { useOverlay } from "@platform/overlay";
import { issuePath, navigate, parseIssueNewContext, type IssueRef } from "../router.ts";
import { useInteractionSound } from "@platform/sound";
import { AuroraBackground, Button, Chip, Eyebrow, Heading, IconButton, Tooltip, Vote } from "@shared/ui";
import "./ideasubmit.css";

// Форма подачи идеи (MF-947, docs/design/ideas.md §4). Роут `/issue/new` — стандалон-экран
// (тот же тир, что park/addwizard.tsx): своя мини-шапка «← Назад», без HomeHeader/BottomTabBar
// (app.tsx рендерит его до BottomTabBar, тем же приёмом, что park-add). Голосовалка (§5, Vote)
// и категория-тайлы (SelectionTile) уже собраны раньше (MF-943/MF-40) — здесь только форма.
//
// Контекст-предзаполнение (MF-694, docs/design/feedback.entrypoints.md §3/§4) — двери входа
// приносят `title`/`category`/`type`/`ref` через query (parseIssueNewContext), эта форма их
// читает: TypeSelect переключает идея/проблема (дефолт из контекста), а привязанный источник
// (ref) сохраняется в payload без дублирующей плашки в форме. `ref.type` → `origin.source` (apps/api контракт,
// enum `model|search|catalog|error|forum`) мапится точечно — известные значения дверей сегодня:
// "model" (карточка модели, 1:1) и "broken_link" ("Проект не найден" → error, семантически то
// же самое: сломанная ссылка на объект). Двери без ref (market/profile) origin не шлют — их
// категории (`catalog`/`account`) не входят в источник, это раздельные оси контракта.
function refToOriginSource(refType: string): "model" | "error" | null {
  if (refType === "model") return "model";
  if (refType === "broken_link") return "error";
  return null;
}

import type { components } from "src/api/generated/openapi";
import { apiFetch } from "@shared/api";
const TITLE_MAX = 120;
const SIMILAR_DEBOUNCE_MS = 250;
const DAILY_LIMIT = 3;
// Зеркалит apps/api/src/ideas/contract.ts IDEA_ENRICH_FREE_TEXT_MAX_LENGTH (MF-565) — capим
// textarea maxLength тем же числом, чтобы 413 FREE_TEXT_TOO_LONG вообще не наступал с клиента.
const AI_FREE_TEXT_MAX = 4_000;

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "catalog", label: "Каталог" },
  { value: "projects", label: "Проекты" },
  { value: "forum", label: "Форум" },
  { value: "account", label: "ЛК" },
  { value: "other", label: "Другое" },
];

// IdeaSimilarItemDto (схема) содержит только id+title; здесь нужны также vote_count и status
// для голосовалки и бейджа статуса — оставляем локальный интерфейс до расширения схемы.
interface SimilarItem {
  id: string;
  title: string;
  vote_count: number;
  status: string;
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"
        fill="currentColor"
      />
    </svg>
  );
}

// Остаток суточного лимита (§4.5) — нет отдельной ручки квоты, считаем по `GET /ideas/mine`
// (уже существует, MF-695): она отдаёт created_at desc, поэтому свежие идеи всегда в первой
// странице — 20 достаточно с запасом над дневным лимитом в 3.
function countUsedToday(items: { created_at: string }[]): number {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return items.filter((item) => new Date(item.created_at).getTime() > dayAgo).length;
}

// `user` не используется внутри — сессия и авторизация идут через cookie (credentials:"include")
// на каждом fetch, экран как park-add/DiyScreen получает protectedUser только чтобы соответствовать
// общему контракту стандалон-экранов app.tsx (не гость, MF-947 не входит в GUEST_ALLOWED_SCREENS).
export function IdeaSubmitScreen({ user: _user }: { user: SessionUser }) {
  const overlay = useOverlay();
  const sound = useInteractionSound();
  const promptGuestLogin = useGuestLogin();
  const [prefillContext] = useState(() => parseIssueNewContext(window.location.search));

  const [title, setTitle] = useState(prefillContext.title ?? "");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<string | null>(prefillContext.category ?? null);
  const [issueType, setIssueType] = useState<IssueType>(prefillContext.type ?? "idea");
  const ref: IssueRef | undefined = prefillContext.ref;
  const [submitting, setSubmitting] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  // AI-обогащение подачи (MF-565/MF-1862, docs/epics/ideas.page.md § «2.1»): свободный текст →
  // POST /ideas/enrich → черновик title/body/category в уже существующие поля формы. Кнопка сама
  // идею не публикует — автор правит черновик и жмёт «Опубликовать» как обычно. `usedAiDraft` —
  // происхождение черновика (эпик), не «без правок»: остаётся true, даже если поля потом изменили.
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiFreeText, setAiFreeText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // 503/502 (giga недоступен/ответил не по контракту) — деградация держится до конца сессии формы,
  // кнопка дизейблится (эпик п. «Деградация, обязательна»), форма продолжает работать как в v1.
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [usedAiDraft, setUsedAiDraft] = useState(false);

  // Живой дедуп (§4.2) — debounce 250мс, ≤5 похожих, панель не рисуем на пустой выдаче.
  const [similar, setSimilar] = useState<SimilarItem[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarVoted, setSimilarVoted] = useState<Record<string, boolean>>({});
  const [similarSuccess, setSimilarSuccess] = useState<{ id: string; title: string } | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Лимит 3/сутки, показан ДО отправки (§4.5) — считаем по /ideas/mine, а не по постфактум-ошибке.
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMyIdeas({ limit: 20 }).then((result) => {
      if (cancelled || !result) return;
      const used = countUsedToday([...result.items]);
      setRemaining(Math.max(0, DAILY_LIMIT - Math.min(used, DAILY_LIMIT)));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const query = title.trim();
    if (query.length < 2) {
      setSimilar([]);
      setSimilarLoading(false);
      return;
    }
    setSimilarLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const response = await apiFetch(`/ideas/similar?q=${encodeURIComponent(query)}`, { credentials: "include" });
        if (!response.ok) {
          setSimilar([]);
          return;
        }
        // IdeaSimilarResponseDto схема не содержит vote_count/status — используем локальный тип.
        const data = (await response.json()) as { items: SimilarItem[] };
        setSimilar(data.items ?? []);
      } catch {
        setSimilar([]);
      } finally {
        setSimilarLoading(false);
      }
    }, SIMILAR_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [title]);

  const isDraftDirty = title.trim().length > 0 || body.trim().length > 0;

  async function handleCancel() {
    if (isDraftDirty) {
      const confirmed = await overlay.confirm({
        title: "Удалить черновик?",
        message: "Введённый текст идеи будет потерян.",
        confirmLabel: "Удалить",
        cancelLabel: "Отмена",
        destructive: true,
      });
      if (!confirmed) return;
    }
    navigate("/", "back");
  }

  async function handleSimilarVote(item: SimilarItem) {
    try {
      const response = await apiFetch(`/ideas/${item.id}/vote`, { method: "POST", credentials: "include" });
      if (response.status === 401) {
        promptGuestLogin();
        return false;
      }
      if (!response.ok) return false;
      const data = (await response.json()) as { vote_count: number; viewer_has_voted: boolean };
      setSimilarVoted((prev) => ({ ...prev, [item.id]: data.viewer_has_voted }));
      if (data.viewer_has_voted) setSimilarSuccess({ id: item.id, title: item.title });
      return true;
    } catch {
      return false;
    }
  }

  function handleOpenAiPanel() {
    setAiError(null);
    // Использует уже введённый body как отправную точку черновика (эпик, на усмотрение Front) —
    // автору не нужно пересказывать то, что уже написал, панель просто открывается поверх.
    if (!aiFreeText.trim() && body.trim()) setAiFreeText(body);
    setAiPanelOpen(true);
  }

  function handleCloseAiPanel() {
    setAiPanelOpen(false);
    setAiError(null);
  }

  async function handleEnrich() {
    const freeText = aiFreeText.trim();
    if (!freeText || aiLoading) return;
    setAiError(null);
    setAiLoading(true);
    try {
      const response = await apiFetch(`/ideas/enrich`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ free_text: freeText }),
      });
      if (response.status === 401) {
        promptGuestLogin();
        return;
      }
      if (response.status === 429) {
        overlay.toast({ severity: "warn", title: "Лимит обогащений на сегодня исчерпан" });
        return;
      }
      if (response.status === 503 || response.status === 502) {
        setAiUnavailable(true);
        setAiPanelOpen(false);
        return;
      }
      if (!response.ok) {
        setAiError("Не удалось составить черновик. Попробуйте ещё раз");
        return;
      }
      const draft = (await response.json()) as components["schemas"]["IdeaEnrichmentResponseDto"];
      // Пустой title — штатный исход (giga не разобралась в тексте), не подставляем (§ контракта).
      if (draft.title) setTitle(draft.title);
      if (draft.body) setBody(draft.body);
      if (draft.category) setCategory(draft.category);
      setUsedAiDraft(true);
      setAiPanelOpen(false);
      setAiFreeText("");
    } catch {
      setAiError("Не удалось составить черновик. Попробуйте ещё раз");
    } finally {
      setAiLoading(false);
    }
  }

  function validate(): boolean {
    let ok = true;
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setTitleError("Введите заголовок идеи");
      ok = false;
    } else if (trimmed.length > TITLE_MAX) {
      setTitleError("Заголовок — до 120 символов");
      ok = false;
    } else {
      setTitleError(null);
    }
    if (!category) {
      setCategoryError("Выберите категорию");
      ok = false;
    } else {
      setCategoryError(null);
    }
    return ok;
  }

  async function handleSubmit() {
    if (remaining === 0) return;
    if (!validate()) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const originSource = ref ? refToOriginSource(ref.type) : null;
      const response = await apiFetch(`/ideas`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          body,
          category,
          type: issueType,
          origin: originSource ? { source: originSource, ref_id: ref?.id } : undefined,
          ai_assisted: usedAiDraft,
        }),
      });
      if (response.status === 401) {
        promptGuestLogin();
        return;
      }
      if (response.status === 429) {
        overlay.toast({ severity: "warn", title: "Лимит 3 идеи в сутки исчерпан" });
        setRemaining(0);
        return;
      }
      if (!response.ok) {
        // Сеть/500 (§4.7) и известный контракт-гэп BODY_REQUIRED (create.ts 422 при пустом body,
        // хотя §4.3 объявляет описание необязательным) — оба падают в тот же путь: черновик
        // сохранён, поля не сброшены, показываем общий текст, а не техническую причину.
        setSubmitError("Не удалось опубликовать. Попробуйте ещё раз");
        return;
      }
      const data = (await response.json()) as components["schemas"]["IdeaCreateResponseDto"];
      sound.cta();
      setSuccessId(data.id);
    } catch {
      setSubmitError("Не удалось опубликовать. Попробуйте ещё раз");
    } finally {
      setSubmitting(false);
    }
  }

  if (successId) {
    return (
      <main className="ideaSubmitScreen">
        <AuroraBackground />
        <div className="ideaSubmitHero reveal">
          <div className="ideaSubmitHeroCircle">
            <CheckCircleIcon />
          </div>
          <Heading size="md">Идея опубликована</Heading>
          <div className="ideaSubmitHeroActions">
            <Button variant="primary" onClick={() => navigate(issuePath(successId))}>
              Открыть идею
            </Button>
            <Button variant="secondary" onClick={() => navigate("/", "back")}>
              В ленту
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (similarSuccess) {
    return (
      <main className="ideaSubmitScreen">
        <AuroraBackground />
        <div className="ideaSubmitHero reveal">
          <div className="ideaSubmitHeroCircle">
            <CheckCircleIcon />
          </div>
          <Heading size="md">Голос учтён</Heading>
          <div className="ideaSubmitHeroActions">
            <Button variant="primary" onClick={() => navigate(issuePath(similarSuccess.id))}>
              Открыть идею
            </Button>
            <Button variant="secondary" onClick={() => navigate("/", "back")}>
              В ленту
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const limitExhausted = remaining === 0;
  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && trimmedTitle.length <= TITLE_MAX && !!category && !limitExhausted && !submitting;
  const showCounter = title.length > 90;

  return (
    <main className="ideaSubmitScreen" data-dim={limitExhausted || undefined}>
      <AuroraBackground />
      <div className="ideaSubmitTopbar">
        <IconButton label="Назад" onClick={() => void handleCancel()} onPress={sound.tick}>
          <BackIcon />
        </IconButton>
        {remaining !== null ? (
          <div className="ideaSubmitQuota" data-exhausted={limitExhausted || undefined}>
            {limitExhausted ? "Лимит на сегодня исчерпан — вернитесь завтра" : `Осталось идей сегодня: ${remaining} из ${DAILY_LIMIT}`}
          </div>
        ) : null}
      </div>

      <div className="ideaSubmitBody">
        <Eyebrow>Новое обращение</Eyebrow>

        <TypeSelect value={issueType} onChange={setIssueType} />

        <div className="ideaSubmitTitleWrap">
          <input
            className="ideaSubmitGhostInput"
            value={title}
            maxLength={240}
            onChange={(event) => {
              setTitle(event.target.value);
              if (titleError) setTitleError(null);
            }}
            placeholder="О чём ваша идея?"
            aria-label="Заголовок идеи"
            disabled={limitExhausted}
          />
          {showCounter ? (
            <div className="ideaSubmitCounter" data-over={title.length > TITLE_MAX || undefined}>
              {title.length}/{TITLE_MAX}
            </div>
          ) : null}
        </div>
        {titleError ? (
          <div className="ideaSubmitFieldError" data-tone="warn">
            {titleError}
          </div>
        ) : null}

        {similarLoading ? <div className="ideaSubmitSkeleton" /> : null}
        {!similarLoading && similar.length > 0 ? (
          <div className="ideaSubmitSimilar">
            <div className="ideaSubmitSimilarTitle">Похоже, это уже предлагали</div>
            {similar.map((item) => {
              const meta = IDEA_STATUS_META[item.status as IdeaStatus];
              return (
                <div key={item.id} className="ideaSubmitSimilarRow">
                  <button type="button" className="ideaSubmitSimilarLink pressable" onClick={() => navigate(issuePath(item.id))}>
                    {item.title}
                    {meta && meta.tone !== "dim" ? <span className="ideaSubmitSimilarStatus">{meta.label}</span> : null}
                  </button>
                  <Vote
                    variant="inline"
                    voteCount={item.vote_count}
                    hasVoted={similarVoted[item.id] ?? false}
                    onToggle={() => handleSimilarVote(item)}
                  />
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="ideaSubmitAi">
          <Tooltip content="Свободный текст → черновик заголовка, описания и категории">
            <Button
              type="button"
              variant="secondary"
              icon={<SparkleIcon />}
              className="ideaSubmitAiButton"
              loading={aiLoading}
              disabled={aiUnavailable || limitExhausted}
              onClick={() => (aiPanelOpen ? handleCloseAiPanel() : handleOpenAiPanel())}
            >
              Оформить с ИИ
            </Button>
          </Tooltip>
          {aiUnavailable ? <span className="ideaSubmitAiHint">Сейчас недоступно — заполните вручную</span> : null}

          {aiPanelOpen ? (
            <div className="ideaSubmitAiPanel">
              <label className="ideaSubmitAiLabel" htmlFor="ideaSubmitAiFreeText">
                Опишите свободно, чего не хватает
              </label>
              <textarea
                id="ideaSubmitAiFreeText"
                className="ideaSubmitAiTextarea"
                value={aiFreeText}
                maxLength={AI_FREE_TEXT_MAX}
                onChange={(event) => setAiFreeText(event.target.value)}
                placeholder="Например: не хватает фильтра по совместимым принтерам в каталоге"
                disabled={aiLoading}
              />
              {aiError ? (
                <div className="ideaSubmitFieldError" data-tone="warn">
                  {aiError}
                </div>
              ) : null}
              <div className="ideaSubmitAiActions">
                <Button type="button" variant="secondary" onClick={handleCloseAiPanel} disabled={aiLoading}>
                  Отмена
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  loading={aiLoading}
                  disabled={!aiFreeText.trim()}
                  onClick={() => void handleEnrich()}
                >
                  Заполнить с ИИ
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <MarkdownEditor
          id="ideaSubmitDescription"
          value={body}
          onChange={setBody}
          disabled={limitExhausted}
          placeholder="Опишите подробнее: что и зачем"
          fieldLabel="Описание (необязательно)"
          showPreview={false}
          showByteCounter={false}
          helperText="Описание — до 50 КБ. Картинки к обращению пока нельзя прикрепить."
          imageDisabledHint="Картинки к обращению пока нельзя прикрепить"
        />

        <fieldset className="ideaSubmitCategory">
          <legend className="ideaSubmitCategoryLabel">Категория</legend>
          <div className="ideaSubmitCategoryChips">
            {CATEGORY_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                selected={category === option.value}
                onClick={() => {
                  setCategory(option.value);
                  if (categoryError) setCategoryError(null);
                }}
                onPress={sound.tick}
                disabled={limitExhausted}
              >
                {option.label}
              </Chip>
            ))}
          </div>
          {categoryError ? (
            <div className="ideaSubmitFieldError" data-tone="warn">
              {categoryError}
            </div>
          ) : null}
        </fieldset>

        {submitError ? (
          <div className="ideaSubmitFieldError" data-tone="warn" role="status">
            {submitError}
          </div>
        ) : null}

        <div className="ideaSubmitActions">
          <Button variant="secondary" onClick={() => void handleCancel()}>
            Отмена
          </Button>
          {limitExhausted ? (
            <div className="ideaSubmitLimitNote">Лимит на сегодня исчерпан — вернитесь завтра</div>
          ) : (
            <Button variant="primary" disabled={!canSubmit} onClick={() => void handleSubmit()}>
              Опубликовать идею
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}