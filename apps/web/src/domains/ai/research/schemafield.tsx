import { useState } from "react";
import "./research.css";
import type { FieldOption, FieldType } from "./schema.ts";
import type { LeafField } from "./formstate.ts";

// `SchemaField` (docs/design/research.workbench.md §2.5, §5 — новый переиспользуемый примитив,
// зафиксировать в components.md при мерже) — единственное место, где решается, как выглядит поле
// схемы карточки принтера: заполнено / «искали, нет данных» / не трогали, плюс состояние `error`.
// Значение и notFound ВЗАИМОИСКЛЮЧАЮЩИ (§2.5): тап в поле снимает галку без диалога-подтверждения,
// галка снимает/очищает значение — это делает вызывающий редьюсер (researchform.tsx), сам примитив
// только сообщает наверх новое намерение через onChange(next).

function NotFoundCheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface SchemaFieldProps {
  label: string;
  type: FieldType;
  options?: FieldOption[];
  placeholder?: string;
  field: LeafField;
  onChange: (next: LeafField) => void;
  onFocusValue?: () => void; // «эта секция — активный источник», см. sourcespanel.tsx автоцепление
  sourceLabel?: string | null; // "[2] example.com" — резолвится вызывающей формой из sourceIndex
  sources?: string[]; // для ручной смены атрибуции конкретного поля (§2.6, компактный Select)
  onSetSourceIndex?: (index: number | null) => void;
  error?: string;
}

export function SchemaField({ label, type, options, placeholder, field, onChange, onFocusValue, sourceLabel, sources, onSetSourceIndex, error }: SchemaFieldProps) {
  const filled = !field.notFound && field.value !== "";
  const untouched = !field.notFound && field.value === "";
  const [pickingSource, setPickingSource] = useState(false);

  function toggleNotFound() {
    if (field.notFound) {
      onChange({ ...field, notFound: false });
    } else {
      onChange({ value: "", notFound: true, sourceIndex: null });
    }
  }

  function setValue(value: string) {
    onFocusValue?.();
    onChange({ ...field, value, notFound: false });
  }

  const inputId = `sf-${label.replace(/\s+/g, "-")}-${type}`;

  return (
    <div className="rsField" data-state={field.notFound ? "not-found" : filled ? "filled" : "untouched"} data-error={Boolean(error) || undefined}>
      <div className="rsFieldRow">
        <button
          type="button"
          className="rsNotFoundCheck pressable"
          role="checkbox"
          aria-checked={field.notFound}
          aria-label={`«${label}» — не нашёл`}
          data-checked={field.notFound || undefined}
          onClick={toggleNotFound}
        >
          {field.notFound ? <NotFoundCheckIcon /> : null}
        </button>

        <label className="rsFieldBody" htmlFor={inputId}>
          <span className="rsFieldLabel">{label}</span>
          {type === "boolean" ? (
            <div className="rsBoolChoice">
              <button
                type="button"
                className="rsBoolOption pressable"
                data-selected={!field.notFound && field.value === "true" || undefined}
                disabled={field.notFound}
                onClick={() => setValue(field.value === "true" ? "" : "true")}
              >
                Да
              </button>
              <button
                type="button"
                className="rsBoolOption pressable"
                data-selected={!field.notFound && field.value === "false" || undefined}
                disabled={field.notFound}
                onClick={() => setValue(field.value === "false" ? "" : "false")}
              >
                Нет
              </button>
            </div>
          ) : type === "select" ? (
            <select
              id={inputId}
              className="rsSelect"
              disabled={field.notFound}
              value={field.notFound ? "" : field.value}
              onFocus={() => onFocusValue?.()}
              onChange={(event) => setValue(event.target.value)}
            >
              <option value="">{placeholder ?? "—"}</option>
              {options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={inputId}
              className="rsInput"
              type={type === "number" ? "number" : "text"}
              disabled={field.notFound}
              value={field.notFound ? "" : field.value}
              placeholder={field.notFound ? "не нашёл" : placeholder ?? label}
              onFocus={() => onFocusValue?.()}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
          {untouched ? null : filled && sourceLabel ? (
            pickingSource && sources ? (
              <select
                className="rsFootnoteSelect"
                autoFocus
                value={field.sourceIndex ?? ""}
                onBlur={() => setPickingSource(false)}
                onChange={(event) => {
                  onSetSourceIndex?.(event.target.value === "" ? null : Number(event.target.value));
                  setPickingSource(false);
                }}
              >
                <option value="">последний активный</option>
                {sources.map((url, index) => (
                  <option key={`${url}-${index}`} value={index}>
                    [{index + 1}] {url}
                  </option>
                ))}
              </select>
            ) : (
              <button type="button" className="rsSourceFootnote pressable" onClick={() => setPickingSource(true)}>
                {sourceLabel}
              </button>
            )
          ) : null}
          {error ? <span className="rsFieldError">{error}</span> : null}
        </label>
      </div>
    </div>
  );
}
