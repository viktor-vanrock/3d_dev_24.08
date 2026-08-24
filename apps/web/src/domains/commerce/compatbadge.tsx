import { useEffect, useState } from "react";
import type { UserPrinter } from "@shared/lib";
import { navigate, parkPath } from "../../router.ts";
import { StatusPill } from "@shared/ui";
import { getPrinterCompat, type CompatVerdict } from "./compat.ts";

// Бейдж совместимости на карточке модели (MF-410, Фаза 3 эпика MF-33): по вердикту
// compat.check(принтер, модель) на КАЖДЫЙ принтер из парка ЛК (MF-15) текущего зрителя —
// не владельца модели, у каждого зрителя свой парк. Без camera/материала — только
// геометрия+железо станка, рекомендованный филамент модели уже показан отдельной строкой
// в modelSpecs (model.recommended_material). Эмодзи в интерфейсных иконках — нет
// (docs/design/components.md), различитель tone/текст StatusPill, как и везде в UI.
// Best-effort формулировки (docs/epics/domain.model.md § риски эпика MF-33) — не гарантия.

const VERDICT_TONE: Record<CompatVerdict, "ok" | "warn" | "danger"> = {
  ok: "ok",
  warn: "warn",
  blocked: "danger",
};

// Короткие метки под пилюлю — зеркало кодов причин apps/api/src/compat/check.ts (единственный
// писатель вердикта); полный текст причины остаётся в title/aria-label пилюли.
const REASON_SHORT_LABEL: Record<string, string> = {
  geometry_exceeds_build_volume: "не влезет",
  abrasive_nozzle_unknown: "уточните сопло",
  abrasive_requires_hardened_nozzle: "нужно закалённое сопло",
  chamber_recommended: "нужна камера",
  direct_drive_recommended: "нужен директ-драйв",
  drying_recommended: "нужна просушка",
  hotend_max_temp_exceeded: "не прогреет хотэнд",
  filament_diameter_mismatch: "не тот диаметр прутка",
};

function printerLabel(printer: UserPrinter): string {
  return `${printer.brand} ${printer.model}`.trim();
}

function badgeText(printer: UserPrinter, verdict: CompatVerdict, reasonCode: string | null): string {
  const name = printerLabel(printer);
  if (verdict === "ok") return `Печатается на «${name}»`;
  const short = reasonCode ? REASON_SHORT_LABEL[reasonCode] : undefined;
  return `${name}: ${short ?? (verdict === "blocked" ? "не подойдёт" : "есть нюансы")}`;
}

interface PrinterVerdict {
  verdict: CompatVerdict;
  code: string | null;
  message: string | null;
}

export function ModelCompatBadges({ modelId, printers }: { modelId: string; printers: UserPrinter[] }) {
  const [results, setResults] = useState<Record<string, PrinterVerdict>>({});

  useEffect(() => {
    setResults({});
    if (printers.length === 0) return;
    let cancelled = false;
    for (const printer of printers) {
      void getPrinterCompat(printer.id, { modelId }).then((result) => {
        if (cancelled || !result) return;
        setResults((current) => ({
          ...current,
          [printer.id]: {
            verdict: result.verdict,
            code: result.reasons[0]?.code ?? null,
            message: result.reasons[0]?.message ?? null,
          },
        }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [modelId, printers]);

  // Парк в ЛК пуст → нейтральная деградация без ошибки (критерий приёмки MF-410), CTA туда,
  // где парк заводится, а не молчание/пустое место.
  if (printers.length === 0) {
    return (
      <div className="modelCompatRow" data-empty>
        <StatusPill tone="dim">Привяжите принтер — покажем, влезет ли модель</StatusPill>
        <button type="button" className="modelCompatLink pressable" onClick={() => navigate(parkPath())}>
          Открыть парк →
        </button>
      </div>
    );
  }

  return (
    <div className="modelCompatRow">
      {printers.map((printer) => {
        const result = results[printer.id];
        if (!result) {
          return (
            <StatusPill key={printer.id} tone="dim" pulse>
              {printerLabel(printer)} — проверяем…
            </StatusPill>
          );
        }
        const reasonText = result.message ?? "Совместимо по нашим данным (best-effort, не гарантия).";
        return (
          <span key={printer.id} title={reasonText} aria-label={`${printerLabel(printer)}: ${reasonText}`}>
            <StatusPill tone={VERDICT_TONE[result.verdict]}>{badgeText(printer, result.verdict, result.code)}</StatusPill>
          </span>
        );
      })}
    </div>
  );
}
