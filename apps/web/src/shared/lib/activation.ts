import { useCallback, useEffect, useState } from "react";

// Клиент профиля активации (MF-435/MF-436): дом читает и пишет состояние ТОЛЬКО
// через этот API (apps/api /me/activation), никакого localStorage-состояния флоу.

import { apiFetch } from "@shared/api";
import type { components } from "../../api/generated/openapi";

export type Persona = "novice" | "maker" | "author" | "builder" | "pro";
export type HomeTier = "auto" | "home" | "farm" | "business";

export interface Activation {
  state: "first_run" | "returning";
  has_printer: boolean;
  primary_persona: Persona | null;
  // "declared" — тап по плитке (MF-437); "inferred" — достроена по поведению (Фаза 3,
  // inferpersona.ts). null у строк, созданных до этого поля (лениво проставляется API).
  persona_source?: "declared" | "inferred" | null;
  home_tier: HomeTier;
  // string | boolean: схема допускает строковые значения (напр. printer_answer: "yes"|"no"|"skip")
  activation_checklist: Record<string, boolean | string>;
  // boolean для гейта повторного показа шага (picker/filament/soft_track/checklist) +
  // printer_answer: "yes"|"no"|"skip" — какой ответ дали на «есть ли принтер?» (MF-437),
  // нужен при возврате на страницу, чтобы знать, в какую ветку продолжать, а не только
  // «спросили или нет».
  home_dismissed_prompts: Record<string, boolean | string>;
}

export interface UserPrinter {
  id: string;
  printer_id?: string | null;
  brand: string;
  model: string;
  build_volume?: { x: number; y: number; z: number } | null;
  nozzle_mm?: number | null;
  kinematics?: string | null;
  is_primary: boolean;
  verified: boolean;
  // Уже в ответе API (activation.ts), не было типизировано — нужны списку парка (MF-1077,
  // park.md §1.1/§2.1): link_source → под-уровень (bindingLabel, park/livesource.ts),
  // created_at → сортировка «по времени добавления» (§1.2). Опциональны — существующие
  // тестовые фикстуры (compat.test.ts/inferpersona.test.ts) их не задают.
  link_source?: string;
  lan_endpoint?: string | null;
  created_at?: string;
}

// PATCH /me/printers/:id (MF-939 §2) — только поля, реально принимаемые бэкендом
// (apps/api/src/profile/activation.ts). is_primary — эксклюзивное действие «Сделать
// основным», не часть обычного сабмита формы (см. profile.catalogs.tsx).
export interface PrinterPatch {
  brand?: string;
  model?: string;
  build_volume?: { x: number; y: number; z: number };
  nozzle_mm?: number;
  kinematics?: string;
  is_primary?: true;
}

export interface UserFilament {
  id: string;
  material_id: string;
  name: string;
  brand: string;
  material_type: string;
  // variant_id/note/color_* — MF-951 §3 (PATCH /me/filaments/:id), join material_variants.
  variant_id?: string | null;
  note?: string | null;
  color_name?: string | null;
  color_hex?: string | null;
}

// PATCH /me/filaments/:id (MF-951 §3) — тот же shape, что PATCH /me/materials/:id.
export interface FilamentPatch {
  variant_id?: string | null;
  note?: string;
}

export interface ActivationState {
  loading: boolean;
  activation: Activation | null;
  printers: UserPrinter[];
  filaments: UserFilament[];
  patch: (fields: Record<string, unknown>) => Promise<void>;
  addPrinter: (printer: {
    brand: string;
    model: string;
    link_source: "connector" | "popular" | "search" | "manual" | "ip";
    lan_endpoint?: string;
    printer_id?: string;
    build_volume?: { x: number; y: number; z: number };
    nozzle_mm?: number;
    kinematics?: string;
  }) => Promise<UserPrinter | null>;
  addFilament: (material: { id: string; name: string; brand: string; materialType: string }) => Promise<void>;
  updatePrinter: (id: string, patch: PrinterPatch) => Promise<boolean>;
  updateFilament: (
    id: string,
    patch: FilamentPatch,
    variantMeta?: { color_name: string | null; color_hex: string | null },
  ) => Promise<boolean>;
  removePrinter: (id: string) => Promise<boolean>;
  removeFilament: (id: string) => Promise<boolean>;
}

// Разрешение тира auto → фактический (правило MF-435: 0–2 принтера=дом, 3–30=ферма;
// бизнес к v1 только ручным выбором — заказов/выплат ещё нет).
export function resolveTier(activation: Activation | null, printers: UserPrinter[]): "home" | "farm" | "business" {
  if (activation && activation.home_tier !== "auto") return activation.home_tier;
  return printers.length >= 3 ? "farm" : "home";
}

export function useActivation(enabled = true): ActivationState {
  const [loading, setLoading] = useState(true);
  const [activation, setActivation] = useState<Activation | null>(null);
  const [printers, setPrinters] = useState<UserPrinter[]>([]);
  const [filaments, setFilaments] = useState<UserFilament[]>([]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    apiFetch(`/me/activation`, { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: components["schemas"]["ActivationResponseDto"] | null) => {
        if (cancelled) return;
        if (data) {
          setActivation(data.activation as Activation);
          // Spread: ActivationResponseDto.printers/filaments are readonly in generated schema;
          // useState holds mutable arrays.
          setPrinters([...data.printers] as UserPrinter[]);
          setFilaments([...data.filaments] as UserFilament[]);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const patch = useCallback(async (fields: Record<string, unknown>) => {
    const response = await apiFetch(`/me/activation`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (response.ok) {
      const data = (await response.json()) as components["schemas"]["ActivationResponseDto"];
      setActivation(data.activation as Activation);
    }
  }, []);

  const addPrinter = useCallback(async (printer: Record<string, unknown>) => {
    const response = await apiFetch(`/me/printers`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(printer),
    });
    if (response.ok) {
      const data = (await response.json()) as components["schemas"]["ProfilePrinterResponseDto"];
      setPrinters((current) => [...current, data.printer as UserPrinter]);
      setActivation((current) => (current ? { ...current, has_printer: true } : current));
      return data.printer as UserPrinter;
    }
    return null;
  }, []) as ActivationState["addPrinter"];

  const addFilament = useCallback(async (material: { id: string; name: string; brand: string; materialType: string }) => {
    const response = await apiFetch(`/me/filaments`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ material_id: material.id }),
    });
    if (response.ok) {
      const data = (await response.json()) as { filament: { id: string; material_id: string } };
      setFilaments((current) => [
        ...current.filter((f) => f.material_id !== material.id),
        {
          id: data.filament.id,
          material_id: material.id,
          name: material.name,
          brand: material.brand,
          material_type: material.materialType,
        },
      ]);
    }
  }, []);

  // Правка каталожной записи (MF-939 §2): тот же PATCH /me/printers/:id, что уже отдаёт
  // apps/api/src/profile/activation.ts. Ответ PATCH — источник истины для строки (спека §4,
  // «не отдельный refetch»); пересортировка по is_primary — то же правило, что уже держит
  // ORDER BY на GET (is_primary desc), чтобы «Сделать основным» сразу показал строку первой.
  const updatePrinter = useCallback(async (id: string, patch: PrinterPatch) => {
    const response = await apiFetch(`/me/printers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as components["schemas"]["ProfilePrinterResponseDto"];
    setPrinters((current) =>
      current
        // Сервер снимает is_primary со всех остальных строк при `is_primary: true` (та же
        // эксклюзивность, что уже держит POST на первой записи) — зеркалим локально, иначе
        // старый основной принтер до рефетча продолжит показывать «Основной».
        .map((printer) => {
          if (printer.id === id) return data.printer as UserPrinter;
          return data.printer.is_primary ? { ...printer, is_primary: false } : printer;
        })
        .sort((a, b) => Number(b.is_primary) - Number(a.is_primary)),
    );
    return true;
  }, []);

  // Правка филамента (MF-951 §3): PATCH /me/filaments/:id возвращает только `variant_id`/`note`
  // (не joined color_name/color_hex, activation.ts FILAMENTS_QUERY делает этот join только на
  // GET) — `variantMeta` передаётся вызывающей стороной из того же списка `variants[]`
  // (GET /materials/:id), откуда взят выбранный чип, чтобы строка сразу показала цвет без
  // отдельного рефетча (спека §4 «не отдельный refetch»).
  const updateFilament = useCallback(
    async (id: string, patch: FilamentPatch, variantMeta?: { color_name: string | null; color_hex: string | null }) => {
      const response = await apiFetch(`/me/filaments/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { filament: { id: string; variant_id: string | null; note: string | null } };
      setFilaments((current) =>
        current.map((filament) =>
          filament.id === id
            ? {
                ...filament,
                variant_id: data.filament.variant_id,
                note: data.filament.note,
                ...(data.filament.variant_id && variantMeta ? variantMeta : { color_name: null, color_hex: null }),
              }
            : filament,
        ),
      );
      return true;
    },
    [],
  ) as ActivationState["updateFilament"];

  // Удаление из ЛК (MF-359): DELETE-ручки уже были у MF-436/MF-437 (первый-запуск чек-лист их
  // не звал — там только добавление), здесь первый клиент, которому нужно снять запись.
  // Оптимистично не убираем строку — короткий список, ответ быстрый, а откат на 404/сеть
  // сложнее эфемерного пропадания-и-возврата строки.
  const removePrinter = useCallback(async (id: string) => {
    const response = await apiFetch(`/me/printers/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (response.ok) setPrinters((current) => current.filter((printer) => printer.id !== id));
    return response.ok;
  }, []);

  const removeFilament = useCallback(async (id: string) => {
    const response = await apiFetch(`/me/filaments/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (response.ok) setFilaments((current) => current.filter((filament) => filament.id !== id));
    return response.ok;
  }, []);

  return {
    loading,
    activation,
    printers,
    filaments,
    patch,
    addPrinter,
    addFilament,
    updatePrinter,
    updateFilament,
    removePrinter,
    removeFilament,
  };
}