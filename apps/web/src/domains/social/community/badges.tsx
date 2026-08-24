import type { CommunityKind, CommunityRole } from "./api.ts";
import "./badges.css";

// Три новых бейджа форума (docs/design/community.md §7.1–§7.3): тот же приём реестра
// slug→{метка,глиф}, что CraftBadge (market/craft.tsx) — нейтральный тон, различитель = глиф+метка
// (kind/role) или чистый текст (тип треда), не цвет. Ничего нового в палитре не вводим.

interface KindMeta {
  label: string;
  Glyph: () => React.JSX.Element;
}

// vendor изначально проектировался под филамент-бренды (label "Филамент") — на практике каждый
// vendor-саб сегодня заводится ТОЛЬКО через machine-related пути (ensureCatalogCommunity,
// MF-2039), т.е. это всегда принтер-экосистема (Creality/Bambu Lab/...), не узкий филамент-
// поставщик. Метка поправлена под реальное использование 2026-07-21.
const KIND_REGISTRY: Record<Exclude<CommunityKind, "custom">, KindMeta> = {
  machine: { label: "Принтер", Glyph: PrinterGlyph },
  vendor: { label: "Экосистема", Glyph: SpoolGlyph },
  craft: { label: "Ремесло", Glyph: ToolGlyph },
};

// §7.1: `custom` (пользовательские клубы) — бейдж скрыт, у них нет «типа» отдельно от самих себя.
export function CommunityKindBadge({ kind, compact = false }: { kind: CommunityKind; compact?: boolean }) {
  if (kind === "custom") return null;
  const meta = KIND_REGISTRY[kind];
  const Glyph = meta.Glyph;
  return (
    <span className="cmtyKindBadge" data-compact={compact || undefined} title={meta.label} aria-label={`Тип сообщества: ${meta.label}`}>
      <span className="cmtyKindBadgeGlyph" aria-hidden="true">
        <Glyph />
      </span>
      {compact ? null : <span className="cmtyKindBadgeLabel">{meta.label}</span>}
    </span>
  );
}

const ROLE_LABEL: Record<CommunityRole, string> = {
  owner: "Владелец",
  moderator: "Модератор",
  member: "Участник",
};

// §7.2: только собственная роль зрителя — нет API-списка участников, значит нет и чужих ролей.
export function RoleBadge({ role }: { role: CommunityRole | null }) {
  if (!role) return null;
  return <span className="cmtyRoleBadge">{ROLE_LABEL[role]}</span>;
}

// MF-1756: тип — категория контента, а «решён» — отдельный статус. Разные элементы не дают
// скринридеру и визуальному чтению смешать две независимые сущности в «Вопрос ✓ решён».
export function ThreadTypeBadge({ type, solved = false }: { type: "discussion" | "question"; solved?: boolean }) {
  const typeLabel = type === "question" ? "Вопрос" : "Обсуждение";
  return (
    <>
      <span className="cmtyThreadTypeBadge" aria-label={`Тип треда: ${typeLabel}`}>
        {typeLabel}
      </span>
      {solved ? (
        <span className="cmtyThreadStatusBadge" role="status" aria-label="Статус треда: решён">
          <span aria-hidden="true">✓</span> Решён
        </span>
      ) : null}
    </>
  );
}

function PrinterGlyph() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 9V4h12v5M6 18H4.5A1.5 1.5 0 0 1 3 16.5v-5A1.5 1.5 0 0 1 4.5 10h15A1.5 1.5 0 0 1 21 11.5v5a1.5 1.5 0 0 1-1.5 1.5H18M6 18v3h12v-3M6 18h12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpoolGlyph() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function ToolGlyph() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14.7 6.3a3.5 3.5 0 0 0-4.6 4.2L4 16.6V20h3.4l6.1-6.1a3.5 3.5 0 0 0 4.2-4.6l-2.6 2.6-2-2 2.6-2.6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
