import { useState } from "react";
import "./research.css";
import { TOOLHEAD_KIND_OPTIONS } from "./schema.ts";
import type { ToolheadExtraRow } from "./formstate.ts";

// Секции-списки строк (materials_supported/unique_features, §2.5 «переиспользуется во всех
// секциях спек» — здесь массив, не скаляр, поэтому свой редактор рядом с generic SchemaField,
// не через него) — тот же тег-инпут паттерн, что aliases в identitysection.tsx.
export function StringListField({ label, placeholder, values, onChange }: { label: string; placeholder: string; values: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  function commit() {
    const value = draft.trim();
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
    setDraft("");
  }
  return (
    <div className="rsPlainField">
      <span className="rsPlainLabel">{label}</span>
      <div className="rsTagInput">
        <div className="rsTagList">
          {values.map((tag) => (
            <span key={tag} className="rsTagChip">
              {tag}
              <button type="button" className="pressable" aria-label={`Убрать «${tag}»`} onClick={() => onChange(values.filter((t) => t !== tag))}>
                ✕
              </button>
            </span>
          ))}
          <input
            className="rsTagInputField"
            value={draft}
            placeholder={values.length === 0 ? placeholder : ""}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}

// toolhead_extras — массив объектов {kind, spec}: лазер/ЧПУ/каттер и т.п. (§2.5 «уникальные фичи
// головы»). Атрибуция источника — на уровне всей секции, не построчно (упрощение реализуемости,
// см. итоговый комментарий MF-917 — потребует сверки с Design при заметном объёме этих карточек).
export function ToolheadExtrasField({ rows, onChange }: { rows: ToolheadExtraRow[]; onChange: (rows: ToolheadExtraRow[]) => void }) {
  function update(index: number, patch: Partial<ToolheadExtraRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function remove(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }
  return (
    <div className="rsPlainField">
      <span className="rsPlainLabel">Доп. модули головы (лазер, ЧПУ, каттер…)</span>
      {rows.map((row, index) => (
        <div key={index} className="rsToolheadRow">
          <select className="rsSelect" value={row.kind} onChange={(e) => update(index, { kind: e.target.value })}>
            <option value="">—</option>
            {TOOLHEAD_KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <input className="rsInput" value={row.spec} placeholder="напр. 10Вт диодный лазер" onChange={(e) => update(index, { spec: e.target.value })} />
          <button type="button" className="rsTagChip pressable" aria-label="Удалить строку" onClick={() => remove(index)}>✕</button>
        </div>
      ))}
      <button type="button" className="rsAddRow pressable" onClick={() => onChange([...rows, { kind: "", spec: "" }])}>
        + добавить модуль
      </button>
    </div>
  );
}
