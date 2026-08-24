import { useState } from "react";
import "./research.css";
import { KINEMATICS_OPTIONS, PRINTER_TYPE_OPTIONS, STATUS_OPTIONS, deriveSlug } from "./schema.ts";
import { useInteractionSound } from "@platform/sound";

// Секция «Идентичность» (§2.3): brand/model обязательные, slug авто-генерируется вживую (превью
// свёрнут по умолчанию, карандаш открывает как редактируемое поле), aliases — тег-инпут,
// status — тайлы S, released_at — дата. Мягкий дедуп на blur brand+model — инлайн-плашка `dim`.

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20l1-4L16 5l3 3L8 19l-4 1Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export interface IdentitySectionProps {
  brand: string;
  model: string;
  slugOverride: string | null;
  // Слуг — часть уникального ключа апсерта на бэке (research.route.ts ищет по slug); правка
  // slug у УЖЕ существующей карточки создала бы дубль-строку, а не переименование. Пенсил
  // редактирования показываем только на /research/new, до первого «Сохранить».
  slugLocked: boolean;
  aliases: string[];
  status: string;
  releasedAt: string;
  kinematics: string;
  printerType: string;
  enclosed: string;
  onBrand: (v: string) => void;
  onModel: (v: string) => void;
  onSlugOverride: (v: string | null) => void;
  onAliases: (v: string[]) => void;
  onStatus: (v: string) => void;
  onReleasedAt: (v: string) => void;
  onKinematics: (v: string) => void;
  onPrinterType: (v: string) => void;
  onEnclosed: (v: string) => void;
  duplicateHint: { slug: string; brand: string; model: string } | null;
  onCheckDuplicate: () => void;
  onOpenDuplicate: (slug: string) => void;
}

export function IdentitySection(props: IdentitySectionProps) {
  const sound = useInteractionSound();
  const [slugEditing, setSlugEditing] = useState(false);
  const [aliasDraft, setAliasDraft] = useState("");
  const slugPreview = props.slugOverride ?? deriveSlug(props.brand, props.model);

  function commitAlias() {
    const value = aliasDraft.trim();
    if (!value || props.aliases.includes(value)) return;
    props.onAliases([...props.aliases, value]);
    setAliasDraft("");
  }

  return (
    <div className="rsIdentity">
      <div className="rsIdentityRow">
        <div className="rsPlainField">
          <label className="rsPlainLabel" htmlFor="rsBrand">Бренд</label>
          <input id="rsBrand" className="rsInput" value={props.brand} onChange={(e) => props.onBrand(e.target.value)} onBlur={props.onCheckDuplicate} placeholder="Creality" />
        </div>
        <div className="rsPlainField">
          <label className="rsPlainLabel" htmlFor="rsModel">Модель</label>
          <input id="rsModel" className="rsInput" value={props.model} onChange={(e) => props.onModel(e.target.value)} onBlur={props.onCheckDuplicate} placeholder="K1 Max" />
        </div>
      </div>

      {props.duplicateHint ? (
        <p className="rsDuplicateHint">
          Похоже на существующую: {props.duplicateHint.brand} {props.duplicateHint.model} —{" "}
          <button type="button" className="rsDuplicateOpen pressable" onClick={() => props.onOpenDuplicate(props.duplicateHint!.slug)}>
            открыть?
          </button>
        </p>
      ) : null}

      <div className="rsSlugPreview">
        {slugEditing && !props.slugLocked ? (
          <input
            className="rsInput rsSlugInput"
            autoFocus
            value={props.slugOverride ?? slugPreview}
            onChange={(e) => props.onSlugOverride(e.target.value)}
            onBlur={() => setSlugEditing(false)}
          />
        ) : (
          <>
            <span className="rsSlugText">→ {slugPreview}</span>
            {props.slugLocked ? null : (
              <button type="button" className="rsSlugEdit pressable" aria-label="Изменить slug" onClick={() => setSlugEditing(true)}>
                <PencilIcon />
              </button>
            )}
          </>
        )}
      </div>

      <div className="rsPlainField">
        <label className="rsPlainLabel">Другие названия</label>
        <div className="rsTagInput">
          <div className="rsTagList">
            {props.aliases.map((tag) => (
              <span key={tag} className="rsTagChip">
                {tag}
                <button type="button" className="pressable" aria-label={`Убрать «${tag}»`} onClick={() => props.onAliases(props.aliases.filter((t) => t !== tag))}>
                  ✕
                </button>
              </span>
            ))}
            <input
              className="rsTagInputField"
              value={aliasDraft}
              placeholder={props.aliases.length === 0 ? "Добавьте и нажмите Enter…" : ""}
              onChange={(e) => setAliasDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitAlias();
                }
              }}
            />
          </div>
        </div>
      </div>

      <div className="rsPlainField">
        <span className="rsPlainLabel">Статус</span>
        <div className="rsTileRow" role="radiogroup" aria-label="Статус">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={props.status === opt.value}
              className="rsTile pressable"
              data-selected={props.status === opt.value || undefined}
              onPointerDown={sound.toggle}
              onClick={() => props.onStatus(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rsIdentityRow">
        <div className="rsPlainField">
          <label className="rsPlainLabel" htmlFor="rsReleasedAt">Дата анонса/выхода</label>
          <input
            id="rsReleasedAt"
            className="rsInput"
            type="date"
            value={props.releasedAt}
            onChange={(e) => props.onReleasedAt(e.target.value)}
            placeholder="если неизвестно — оставьте пустым"
          />
        </div>
        <div className="rsPlainField">
          <label className="rsPlainLabel" htmlFor="rsKinematics">Кинематика</label>
          <select id="rsKinematics" className="rsSelect" value={props.kinematics} onChange={(e) => props.onKinematics(e.target.value)}>
            <option value="">—</option>
            {KINEMATICS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="rsIdentityRow">
        <div className="rsPlainField">
          <label className="rsPlainLabel" htmlFor="rsType">Технология печати</label>
          <select id="rsType" className="rsSelect" value={props.printerType} onChange={(e) => props.onPrinterType(e.target.value)}>
            <option value="">—</option>
            {PRINTER_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="rsPlainField">
          <span className="rsPlainLabel">Закрытая камера</span>
          <div className="rsBoolChoice">
            <button type="button" className="rsBoolOption pressable" data-selected={props.enclosed === "true" || undefined} onClick={() => props.onEnclosed(props.enclosed === "true" ? "" : "true")}>Да</button>
            <button type="button" className="rsBoolOption pressable" data-selected={props.enclosed === "false" || undefined} onClick={() => props.onEnclosed(props.enclosed === "false" ? "" : "false")}>Нет</button>
          </div>
        </div>
      </div>
    </div>
  );
}
