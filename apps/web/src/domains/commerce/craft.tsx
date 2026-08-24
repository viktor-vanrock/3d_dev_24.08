// Craft-бейджи: маркировка ремесла на карточке каталога и странице модели
// (docs/design/projects.md §2, MF-483). Инвариант §2.1: бейдж скрыт, пока ремесло одно —
// на MVP всё '3d_printing', различать нечего, бейдж возвращает null. Появление второго
// craft «зажигает» бейджи по всей витрине от данных, без перевёрстки.
//
// Тон — приглушённый (dim) для всех: craft — классификация, не статус срочности; различитель
// = глиф + метка, а не цвет (§2.2, «яркость=важность»). Реестр slug→метка/глиф — единый словарь,
// slugs строго из docs/epics/domain.model.md § Ремёсла; неизвестный slug деградирует в
// нейтральную точку + сам slug (сигнал «завести метку», не падаем и не прячем молча).
import "./craft.css";

export const DEFAULT_CRAFT = "3d_printing";

interface CraftMeta {
  label: string;
  Glyph: () => React.JSX.Element;
}

export const CRAFT_REGISTRY: Record<string, CraftMeta> = {
  "3d_printing": { label: "Печать", Glyph: CubeGlyph },
  cnc: { label: "ЧПУ", Glyph: MillGlyph },
  laser: { label: "Лазер", Glyph: BeamGlyph },
  electronics: { label: "Электроника", Glyph: ChipGlyph },
  software: { label: "Код", Glyph: CodeGlyph },
  woodworking: { label: "Дерево", Glyph: PlankGlyph },
  metalworking: { label: "Металл", Glyph: LatheGlyph },
};

export function craftMeta(craft: string): CraftMeta {
  return CRAFT_REGISTRY[craft] ?? { label: craft || "Другое", Glyph: DotGlyph };
}

// §2.1: бейдж рендерится тогда и только тогда, когда craft !== '3d_printing' (моно-ремесло дремлет).
// Пустой/неизвестно-отсутствующий craft тоже прячем — нечего различать.
export function isCraftBadgeVisible(craft: string | null | undefined): boolean {
  return !!craft && craft !== DEFAULT_CRAFT;
}

// Полный режим (глиф + метка, страница модели) и компактный (глиф-only, плитка каталога).
export function CraftBadge({ craft, compact = false }: { craft: string | null | undefined; compact?: boolean }) {
  if (!isCraftBadgeVisible(craft)) return null;
  const meta = craftMeta(craft as string);
  const Glyph = meta.Glyph;
  return (
    <span className="craftBadge" data-compact={compact || undefined} title={meta.label} aria-label={`Ремесло: ${meta.label}`}>
      <span className="craftBadgeGlyph" aria-hidden="true">
        <Glyph />
      </span>
      {compact ? null : <span className="craftBadgeLabel">{meta.label}</span>}
    </span>
  );
}

function CubeGlyph() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m0 9v-9m0 0L4 7.5M12 12l8-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function MillGlyph() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v8m0 0-3 8h6l-3-8Zm-4 3h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BeamGlyph() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2v9m0 0 6 9m-6-9-6 9M9 8h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChipGlyph() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 3v3m4-3v3m-4 15v-3m4 3v-3M3 10h3m-3 4h3m15-4h3m-3 4h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CodeGlyph() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m9 8-4 4 4 4m6-8 4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlankGlyph() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="8" width="18" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 8v8m4-8v8m4-8v8" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function LatheGlyph() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 9h12v6H4zM16 12h4m-9-3v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DotGlyph() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </svg>
  );
}
