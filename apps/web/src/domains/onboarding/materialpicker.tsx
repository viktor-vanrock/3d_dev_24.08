import { useEffect, useRef, useState } from "react";
import {
  fetchMaterialVariants,
  fetchPopularMaterials,
  searchMaterials,
  type CatalogMaterial,
  type MaterialVariant,
  type ActivationState,
  type FilamentPatch,
  type UserFilament,
} from "@shared/lib";
import { Button, Card, Chip, Eyebrow, Input } from "@shared/ui";

// Picker филамента для «Мои филаменты» в ЛК (MF-359, эпик MF-15): тот же поисковый паттерн, что
// PrinterPicker (printerpicker.tsx) и RecommendedMaterialField (market/addmodel.tsx) — популярные
// чипы + дебаунс-поиск по каталогу (GET /materials, MF-624). Без «ручного добавления» — филамент
// в ЛК всегда каталожная привязка (тот же контракт, что onboarding-шаг FilamentStep, activation.ts
// § POST /me/filaments), каталог MF-31 без своего импортёра ещё не гарантирует полноту, но
// свободный текст размывает нормализацию справочника (Фаза 3 MF-359 § «нормализация справочников»).

const SEARCH_DEBOUNCE_MS = 250;

// Экспортирована — тот же дедуп нужен строкам «Мои филаменты» в ЛК (market/profile.tsx,
// MF-359): `user_filaments` отдаёт ту же пару name/brand, что CatalogMaterial.
export function materialLabel(material: { brand: string; name: string }): string {
  if (material.brand && material.name.toLowerCase().includes(material.brand.toLowerCase())) return material.name;
  return `${material.brand} ${material.name}`.trim();
}

export function MaterialPicker({
  addFilament,
  onDone,
  existingMaterialIds,
  surface = "card",
}: {
  addFilament: ActivationState["addFilament"];
  onDone: () => void;
  existingMaterialIds: readonly string[];
  // В overlay не создаём вторую декоративную поверхность поверх канонической панели.
  surface?: "card" | "overlay";
}) {
  const [popular, setPopular] = useState<CatalogMaterial[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogMaterial[]>([]);
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchPopularMaterials().then(setPopular);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      searchMaterials(query).then(setResults);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function pick(material: CatalogMaterial) {
    if (busy || existingMaterialIds.includes(material.id)) return;
    setBusy(true);
    await addFilament(material);
    setBusy(false);
    onDone();
  }

  const shown = query.trim() ? results : popular;

  const content = (
    <>
      <div style={{ fontSize: 17 }}>Каким пластиком печатаете?</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Найти материал или бренд"
          aria-label="Поиск филамента"
        />
        {!query.trim() && shown.length > 0 ? <Eyebrow>Популярные</Eyebrow> : null}
        {shown.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {shown.map((material) => (
              <Chip
                key={material.id}
                onClick={() => pick(material)}
                selected={existingMaterialIds.includes(material.id)}
              >
                {materialLabel(material)}
              </Chip>
            ))}
          </div>
        ) : query.trim() ? (
          <div style={{ fontSize: 13, color: "var(--text-dim)" }}>Ничего не нашли — попробуйте другой запрос.</div>
        ) : null}
      </div>
    </>
  );

  return surface === "overlay" ? <div className="ovlModalContent">{content}</div> : <Card style={{ padding: "clamp(18px, 3.5vw, 28px)", display: "flex", flexDirection: "column", gap: 14 }}>{content}</Card>;
}

const NOTE_MAX = 500;

// Модалка «Изменить филамент» (MF-951/MF-939 §3): название материала статично, ниже — чипы
// вариантов ТОГО ЖЕ material_id (GET /materials/:id → variants[], не поиск по каталогу) и
// заметка. Блока чипов нет вовсе, если у материала нет вариантов (спека §3, «не пустой ряд»).
// Успех/ошибка — на вызывающей стороне (profile.catalogs.tsx), тот же приём, что PrinterEditForm.
export function FilamentEditForm({
  filament,
  onSave,
}: {
  filament: UserFilament;
  onSave: (patch: FilamentPatch, variantMeta?: { color_name: string | null; color_hex: string | null }) => Promise<void>;
}) {
  const [variants, setVariants] = useState<MaterialVariant[]>([]);
  const [variantId, setVariantId] = useState<string | null>(filament.variant_id ?? null);
  const [note, setNote] = useState(filament.note ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchMaterialVariants(filament.material_id).then(setVariants);
  }, [filament.material_id]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    const patch: FilamentPatch = { variant_id: variantId, note: note.trim().slice(0, NOTE_MAX) };
    const selected = variants.find((variant) => variant.id === variantId);
    await onSave(patch, selected ? { color_name: selected.color_name, color_hex: selected.color_hex } : undefined);
    setBusy(false);
  }

  return (
    <Card style={{ padding: "clamp(18px, 3.5vw, 28px)", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 17 }}>{materialLabel(filament)}</div>

      {variants.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>Цвет/вариант</Eyebrow>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {variants.map((variant) => (
              <Chip
                key={variant.id}
                selected={variantId === variant.id}
                onClick={() => setVariantId(variant.id === variantId ? null : variant.id)}
              >
                {variant.color_name ?? "Без цвета"}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Eyebrow>Заметка</Eyebrow>
        <textarea
          className="uiInput"
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, NOTE_MAX))}
          placeholder="Партия, состояние катушки…"
          rows={3}
          aria-label="Заметка о филаменте"
        />
      </div>

      <Button variant="primary" icon={null} disabled={busy} onClick={submit}>
        Сохранить
      </Button>
    </Card>
  );
}
