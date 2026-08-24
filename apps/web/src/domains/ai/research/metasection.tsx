import "./research.css";
import { CONFIDENCE_OPTIONS } from "./schema.ts";
import { useInteractionSound } from "@platform/sound";

// Секция `_meta` (§2.7): confidence — три радио-тайла текстом (смысл важнее пиктограммы),
// filled_by/gaps/updated_at — служебная строка, не поля ввода.
export interface MetaSectionProps {
  confidence: "high" | "medium" | "low" | "";
  onConfidence: (v: "high" | "medium" | "low") => void;
  filledBy: string | null;
  updatedAtLabel: string;
}

export function MetaSection({ confidence, onConfidence, filledBy, updatedAtLabel }: MetaSectionProps) {
  const sound = useInteractionSound();
  return (
    <div className="rsMeta">
      <div className="rsTileRow rsTileRowStack" role="radiogroup" aria-label="Уверенность">
        {CONFIDENCE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={confidence === opt.value}
            className="rsTile pressable"
            data-selected={confidence === opt.value || undefined}
            onPointerDown={sound.toggle}
            onClick={() => onConfidence(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="rsMetaLine">
        Заполняет: {filledBy ?? "вы"} · обновлено {updatedAtLabel}
      </p>
    </div>
  );
}
