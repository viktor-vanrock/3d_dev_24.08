import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@shared/types";
import { AuroraBackground, Button } from "@shared/ui";
import { HomeHeader, type Section as NavSection } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import { headerModeFor, navigate, researchFormPath, researchPath } from "../../../router.ts";
import { useInteractionSound } from "@platform/sound";
import { fetchPrinterBySlug, savePrinterCard, type SaveConflict } from "./api.ts";
import { clearResearchDraft, loadResearchDraft, saveResearchDraft } from "./draft.ts";
import { currentSlug, emptyFormState, formStateFromPrinter, type FormState, type LeafField, type PhotoItem } from "./formstate.ts";
import { IdentitySection } from "./identitysection.tsx";
import { PhotoSection } from "./photosection.tsx";
import { StringListField, ToolheadExtrasField } from "./listsection.tsx";
import { MetaSection } from "./metasection.tsx";
import { ResearcherRoleGate } from "./researchgate.tsx";
import { Section } from "./section.tsx";
import { SchemaField } from "./schemafield.tsx";
import { LIST_SECTIONS, SPEC_SECTIONS, sectionFieldPaths } from "./schema.ts";
import { SourcesPanel } from "./sourcespanel.tsx";
import { ConflictSection, SaveCallout, type SaveOutcome } from "./savecallout.tsx";
import "./research.css";

const AUTOSAVE_DEBOUNCE_MS = 2000;
const IDENTITY_TOTAL = 4;

function relativeUpdatedAt(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH} ч назад`;
  return `${Math.round(diffH / 24)} дн назад`;
}

function setLeaf(state: FormState, path: string, patch: LeafField): FormState {
  return { ...state, fields: { ...state.fields, [path]: patch } };
}

type LoadState = { kind: "loading" } | { kind: "not-found" } | { kind: "error" } | { kind: "ready" };

// Заменяет заглушку MF-916 п.6 (см. коммит a6c5cb2) целиком — тот же приём, что PrintersScreen/
// FeedScreen для ещё не собранных экранов. `slug`/`draft` — как в маршруте (router.ts):
// `/research/new(?draft=<ввод>)` → slug не задан, draft — предзаполнение из строки поиска (§1.3);
// `/research/:slug` → форма существующей (черновой или опубликованной) карточки.
export function ResearchFormScreen({
  user,
  slug,
  draft,
  section,
  onSectionChange,
}: {
  user: SessionUser;
  slug?: string;
  draft?: string;
  section: NavSection;
  onSectionChange: (section: NavSection) => void;
}) {
  return (
    <div className="home">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader
          user={user}
          printers={[]}
          section={section}
          onSectionChange={onSectionChange}
          mode={headerModeFor("research-form")}
          onBack={() => navigate(researchPath())}
          backLabel="К очереди"
        />
      </div>
      <main className="homeContent rsBody">
        <ResearcherRoleGate user={user}>
          <ResearchFormInner user={user} slug={slug} draft={draft} />
        </ResearcherRoleGate>
      </main>
    </div>
  );
}

function ResearchFormInner({ user, slug, draft: draftPrefill }: { user: SessionUser; slug?: string; draft?: string }) {
  const sound = useInteractionSound();
  const [load, setLoad] = useState<LoadState>(slug ? { kind: "loading" } : { kind: "ready" });
  const [state, setState] = useState<FormState>(emptyFormState());
  const [restoredBanner, setRestoredBanner] = useState(false);
  const [duplicateHint, setDuplicateHint] = useState<{ slug: string; brand: string; model: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<SaveConflict[]>([]);
  const [conflictChoices, setConflictChoices] = useState<Record<string, "mine" | "theirs">>({});
  const [mobileSourcesOpen, setMobileSourcesOpen] = useState(false);
  const sourcesRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const loadedOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (slug) {
        const result = await fetchPrinterBySlug(slug);
        if (cancelled) return;
        if (result.kind === "ok") {
          const fromServer = formStateFromPrinter(result.printer);
          const draft = loadResearchDraft(slug);
          if (draft) {
            setState(draft);
            setRestoredBanner(true);
          } else {
            setState(fromServer);
          }
          setLoad({ kind: "ready" });
        } else if (result.kind === "not_found") {
          setLoad({ kind: "not-found" });
        } else {
          setLoad({ kind: "error" });
        }
      } else {
        const savedDraft = loadResearchDraft("");
        if (savedDraft) {
          setState(savedDraft);
          setRestoredBanner(true);
        } else if (draftPrefill) {
          // Предзаполнение из строки поиска-создания (§1.3): «+ Создать карточку "<ввод>"» несёт
          // сюда то, что искали и не нашли — кладём в `model` (обычно самая специфичная часть
          // строки поиска), `brand` ресёрчер поправит сам, если ввод был «бренд модель».
          setState((s) => ({ ...s, model: draftPrefill }));
        }
        setLoad({ kind: "ready" });
      }
      loadedOnce.current = true;
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [slug, draftPrefill]);

  // Автосейв (§2.8) — тихий, ~2с дебаунс, тот же приём, что feed/draft.ts.
  useEffect(() => {
    if (!loadedOnce.current) return;
    const timer = setTimeout(() => saveResearchDraft(state), AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const slugNow = currentSlug(state);

  function update(patch: Partial<FormState>) {
    setState((s) => ({ ...s, ...patch }));
  }

  function markActiveSource(index: number) {
    setState((s) => ({ ...s, activeSourceIndex: index }));
  }

  function addSource(url: string) {
    setState((s) => ({ ...s, sources: [...s.sources, url], activeSourceIndex: s.sources.length }));
  }

  function removeSource(index: number) {
    setState((s) => ({ ...s, sources: s.sources.filter((_, i) => i !== index), activeSourceIndex: s.activeSourceIndex === index ? null : s.activeSourceIndex }));
  }

  function handleFocusValue(path: string) {
    setState((s) => {
      const existing = s.fields[path];
      if (existing?.sourceIndex != null) return s;
      if (s.activeSourceIndex == null) return s;
      return setLeaf(s, path, { ...(existing ?? { value: "", notFound: false, sourceIndex: null }), sourceIndex: s.activeSourceIndex });
    });
  }

  function handleSetSourceIndex(path: string, index: number | null) {
    setState((s) => {
      const existing = s.fields[path] ?? { value: "", notFound: false, sourceIndex: null };
      const next = setLeaf(s, path, { ...existing, sourceIndex: index });
      return index != null ? { ...next, activeSourceIndex: index } : next;
    });
  }

  async function checkDuplicate() {
    if (slug) return; // редактируем существующую — self-match ожидаем, не предупреждаем
    if (!state.brand.trim() || !state.model.trim()) return;
    const candidate = slugNow;
    const result = await fetchPrinterBySlug(candidate);
    if (result.kind === "ok") {
      setDuplicateHint({ slug: candidate, brand: result.printer.brand, model: result.printer.model });
    } else {
      setDuplicateHint(null);
    }
  }

  function sourceLabelFor(path: string): string | null {
    const field = state.fields[path];
    const idx = field?.sourceIndex ?? null;
    if (idx == null || !state.sources[idx]) return null;
    try {
      return `[${idx + 1}] ${new URL(state.sources[idx]!).hostname.replace(/^www\./, "")}`;
    } catch {
      return `[${idx + 1}] ${state.sources[idx]}`;
    }
  }

  function buildPayload(resolveConflictPaths: string[], baseUpdatedAt: string | null, fieldsOverride?: Record<string, LeafField>): Record<string, unknown> {
    const fields = fieldsOverride ?? state.fields;
    const body: Record<string, unknown> = { brand: state.brand.trim(), model: state.model.trim() };
    if (slug || state.slugOverride) body.slug = slug ?? state.slugOverride;
    if (state.aliases.length) body.aliases = state.aliases;
    if (state.status) body.status = state.status;
    if (state.releasedAt) body.released_at = state.releasedAt;
    if (state.kinematics) body.kinematics = state.kinematics;
    if (state.printerType) body.type = state.printerType;
    if (state.enclosed) body.enclosed = state.enclosed === "true";

    const fieldSources: Record<string, number> = {};
    const gaps = new Set(state.existingGaps);

    for (const section of SPEC_SECTIONS) {
      const leafPaths = sectionFieldPaths(section);
      const touched = leafPaths.filter((p) => fields[p] && (fields[p]!.value !== "" || fields[p]!.notFound));
      if (touched.length === 0) continue;
      const sectionObj: Record<string, unknown> = {};
      for (const path of touched) {
        const leafKey = path.slice(section.key.length + 1);
        const field = fields[path]!;
        const fieldDef = section.fields.find((f) => f.key === leafKey)!;
        if (field.notFound) {
          sectionObj[leafKey] = null;
          gaps.add(path);
        } else {
          gaps.delete(path);
          sectionObj[leafKey] =
            fieldDef.type === "number" ? (field.value.trim() === "" ? null : Number(field.value)) : fieldDef.type === "boolean" ? field.value === "true" : field.value;
          if (field.sourceIndex != null) fieldSources[path] = field.sourceIndex;
        }
      }
      body[section.key] = sectionObj;
    }

    if (state.materialsSupported.length) {
      body.materials_supported = state.materialsSupported;
      if (state.activeSourceIndex != null) fieldSources.materials_supported = state.activeSourceIndex;
    }
    if (state.uniqueFeatures.length) {
      body.unique_features = state.uniqueFeatures;
      if (state.activeSourceIndex != null) fieldSources.unique_features = state.activeSourceIndex;
    }
    if (state.toolheadExtras.length) body.toolhead_extras = state.toolheadExtras.filter((r) => r.kind);

    if (state.sources.length) body.sources = state.sources;
    if (fieldSources && Object.keys(fieldSources).length) body.field_sources = fieldSources;

    const doneKeys = new Set(state.photos.filter((p) => p.status === "done").map((p) => p.key));
    if (doneKeys.size || state.heroKey) {
      body.media = { hero: state.heroKey, gallery: Array.from(doneKeys) };
    }

    body._meta = {
      filled_by: user.username,
      confidence: state.confidence || "low",
      gaps: Array.from(gaps),
      ...(baseUpdatedAt ? { base_updated_at: baseUpdatedAt } : {}),
    };
    if (resolveConflictPaths.length) body.resolve_conflicts = resolveConflictPaths;
    return body;
  }

  async function doSave(resolveConflictPaths: string[] = [], baseOverride?: string | null, fieldsOverride?: Record<string, LeafField>) {
    setSaving(true);
    setFieldErrors({});
    const payload = buildPayload(resolveConflictPaths, baseOverride !== undefined ? baseOverride : state.baseUpdatedAt, fieldsOverride);
    const result = await savePrinterCard(payload);
    setSaving(false);
    if (result.kind === "ok") {
      update({ baseUpdatedAt: result.printer._meta.updated_at, slugOverride: result.printer.slug, existingGaps: result.printer._meta.gaps });
      if (result.conflicts.length > 0) {
        setConflicts(result.conflicts);
        setConflictChoices({});
        setOutcome(null);
      } else {
        setConflicts([]);
        clearResearchDraft();
        setOutcome(result.draft ? { kind: "draft-no-source" } : { kind: "published" });
        if (!slug) navigate(researchFormPath(result.printer.slug));
      }
    } else if (result.kind === "validation_error") {
      const errs: Record<string, string> = {};
      for (const f of result.fields) errs[f.field] = f.message;
      setFieldErrors(errs);
      setOutcome({ kind: "validation-error", count: result.fields.length });
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      setOutcome({ kind: "network-error" });
    }
  }

  function resolveConflictsAndRetry() {
    // conflicts[].ours/theirs — с точки зрения СЕРВЕРА (см. комментарий в savecallout.tsx):
    // `ours` — значение, которое кто-то ДРУГОЙ уже сохранил (то, что покажем как «их» в UI);
    // `theirs` — то, что только что пыталась сохранить ЭТА форма (наше «моё»). Считаем разрешённые
    // поля СИНХРОННО (не через setState) — doSave/buildPayload читают их немедленно в этом же
    // тике, а setState с устаревшим замыканием state.fields до ре-рендера их бы не увидел.
    const minePaths: string[] = [];
    let resolvedFields = state.fields;
    for (const c of conflicts) {
      if (conflictChoices[c.field] === "theirs") {
        resolvedFields = {
          ...resolvedFields,
          [c.field]: { value: c.ours === null ? "" : String(c.ours), notFound: c.ours === null, sourceIndex: resolvedFields[c.field]?.sourceIndex ?? null },
        };
      } else {
        minePaths.push(c.field);
      }
    }
    setState((s) => ({ ...s, fields: resolvedFields }));
    void doSave(minePaths, state.baseUpdatedAt, resolvedFields);
  }

  const allConflictsResolved = conflicts.length > 0 && conflicts.every((c) => conflictChoices[c.field]);

  const identityFilled = [state.brand, state.model, state.aliases.length ? "x" : "", state.releasedAt].filter((v) => v && v.length > 0).length;
  const photosCount = state.photos.filter((p) => p.status === "done").length;

  if (load.kind === "loading") return <p className="rsStatusLine">Загрузка…</p>;
  if (load.kind === "not-found") return <p className="rsStatusLine">Карточка не найдена. <a href={researchPath()} onClick={(e) => { e.preventDefault(); navigate(researchPath()); }}>← К очереди</a></p>;
  if (load.kind === "error") return <p className="rsStatusLine">Не удалось загрузить карточку. <button type="button" className="rsRetryButton pressable" onClick={() => window.location.reload()}>Обновить</button></p>;

  return (
    <div className="rsLayout" ref={formRef}>
      <div className="rsMain">
        <div className="rsFormHead">
          <h1 className="rsTitle">{state.brand || state.model ? `${state.brand} ${state.model}`.trim() : "Новая карточка"}</h1>
          <p className="rsEyebrow">заполнено {identityFilled} из {IDENTITY_TOTAL}</p>
        </div>

        {restoredBanner ? (
          <div className="rsDraftBanner reveal">
            <span>Восстановлен черновик</span>
            <button
              type="button"
              className="rsDraftRestart pressable"
              onClick={() => {
                clearResearchDraft();
                setRestoredBanner(false);
                setState(emptyFormState());
              }}
            >
              Начать заново
            </button>
          </div>
        ) : null}

        <div className="rsSourcesAccordion">
          <button type="button" className="rsSourcesAccordionHeader pressable" aria-expanded={mobileSourcesOpen} onClick={() => setMobileSourcesOpen((v) => !v)}>
            Источники ({state.sources.length}) {mobileSourcesOpen ? "▴" : "▾"}
          </button>
          {mobileSourcesOpen ? (
            <SourcesPanel
              sources={state.sources}
              activeSourceIndex={state.activeSourceIndex}
              onAdd={addSource}
              onRemove={removeSource}
              onSetActive={markActiveSource}
            />
          ) : null}
        </div>

        <Section title="Идентичность" filledCount={identityFilled} totalCount={IDENTITY_TOTAL} defaultOpen={true}>
          <IdentitySection
            brand={state.brand}
            model={state.model}
            slugOverride={state.slugOverride}
            slugLocked={Boolean(slug)}
            aliases={state.aliases}
            status={state.status}
            releasedAt={state.releasedAt}
            kinematics={state.kinematics}
            printerType={state.printerType}
            enclosed={state.enclosed}
            onBrand={(v) => update({ brand: v })}
            onModel={(v) => update({ model: v })}
            onSlugOverride={(v) => update({ slugOverride: v })}
            onAliases={(v) => update({ aliases: v })}
            onStatus={(v) => update({ status: v })}
            onReleasedAt={(v) => update({ releasedAt: v })}
            onKinematics={(v) => update({ kinematics: v })}
            onPrinterType={(v) => update({ printerType: v })}
            onEnclosed={(v) => update({ enclosed: v })}
            duplicateHint={duplicateHint}
            onCheckDuplicate={() => void checkDuplicate()}
            onOpenDuplicate={(dupSlug) => navigate(researchFormPath(dupSlug))}
          />
        </Section>

        <Section title="Фото" filledCount={photosCount} totalCount={8} defaultOpen={photosCount > 0}>
          <PhotoSection
            slug={slugNow}
            photos={state.photos}
            heroKey={state.heroKey}
            onPhotosChange={(update2) => setState((s) => ({ ...s, photos: typeof update2 === "function" ? (update2 as (p: PhotoItem[]) => PhotoItem[])(s.photos) : update2 }))}
            onHeroChange={(update2) => setState((s) => ({ ...s, heroKey: typeof update2 === "function" ? (update2 as (p: string | null) => string | null)(s.heroKey) : update2 }))}
          />
        </Section>

        {SPEC_SECTIONS.map((section) => {
          const paths = sectionFieldPaths(section);
          const filled = paths.filter((p) => state.fields[p]?.value || state.fields[p]?.notFound).length;
          return (
            <Section key={section.key} title={section.label} filledCount={filled} totalCount={paths.length} defaultOpen={filled > 0}>
              {section.fields.map((fieldDef) => {
                const path = `${section.key}.${fieldDef.key}`;
                const field = state.fields[path] ?? { value: "", notFound: false, sourceIndex: null };
                return (
                  <SchemaField
                    key={path}
                    label={fieldDef.label}
                    type={fieldDef.type}
                    options={fieldDef.options}
                    placeholder={fieldDef.placeholder}
                    field={field}
                    sources={state.sources}
                    sourceLabel={sourceLabelFor(path)}
                    error={fieldErrors[path]}
                    onFocusValue={() => handleFocusValue(path)}
                    onSetSourceIndex={(index) => handleSetSourceIndex(path, index)}
                    onChange={(next) => setState((s) => setLeaf(s, path, next))}
                  />
                );
              })}
            </Section>
          );
        })}

        <Section title="Материалы и особенности" filledCount={(state.materialsSupported.length ? 1 : 0) + (state.uniqueFeatures.length ? 1 : 0) + (state.toolheadExtras.length ? 1 : 0)} totalCount={3} defaultOpen={state.materialsSupported.length + state.uniqueFeatures.length + state.toolheadExtras.length > 0}>
          {LIST_SECTIONS.map((ls) => (
            <StringListField
              key={ls.key}
              label={ls.label}
              placeholder={ls.placeholder}
              values={ls.key === "materials_supported" ? state.materialsSupported : state.uniqueFeatures}
              onChange={(v) => update(ls.key === "materials_supported" ? { materialsSupported: v } : { uniqueFeatures: v })}
            />
          ))}
          <ToolheadExtrasField rows={state.toolheadExtras} onChange={(rows) => update({ toolheadExtras: rows })} />
        </Section>

        <Section title="_meta" filledCount={state.confidence ? 1 : 0} totalCount={1} defaultOpen={Boolean(state.confidence)}>
          <MetaSection
            confidence={state.confidence}
            onConfidence={(v) => update({ confidence: v })}
            filledBy={state.filledBy}
            updatedAtLabel={state.baseUpdatedAt ? relativeUpdatedAt(state.baseUpdatedAt) : "только что"}
          />
        </Section>

        <ConflictSection conflicts={conflicts} resolutions={conflictChoices} onResolve={(field, choice) => setConflictChoices((c) => ({ ...c, [field]: choice }))} />
        {conflicts.length > 0 ? (
          <Button variant="secondary" icon={null} disabled={!allConflictsResolved} onClick={resolveConflictsAndRetry}>
            Досохранить
          </Button>
        ) : null}

        <div className="rsSaveBar">
          {outcome ? (
            <SaveCallout
              outcome={outcome}
              onOpenSources={() => {
                setMobileSourcesOpen(true);
                sourcesRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              onRetry={() => void doSave()}
            />
          ) : null}
          <Button
            variant="primary"
            icon={null}
            disabled={saving}
            onPointerDown={sound.cta}
            onClick={() => void doSave()}
          >
            {saving ? "Сохраняем…" : "Сохранить"}
          </Button>
        </div>
      </div>

      <aside className="rsSidebar" ref={sourcesRef}>
        <SourcesPanel
          sources={state.sources}
          activeSourceIndex={state.activeSourceIndex}
          onAdd={(url) => setState((s) => ({ ...s, sources: [...s.sources, url], activeSourceIndex: s.sources.length }))}
          onRemove={(index) => setState((s) => ({ ...s, sources: s.sources.filter((_, i) => i !== index), activeSourceIndex: s.activeSourceIndex === index ? null : s.activeSourceIndex }))}
          onSetActive={markActiveSource}
        />
      </aside>
    </div>
  );
}
