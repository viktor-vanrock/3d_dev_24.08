import { useEffect, useState } from "react";
import "./research.css";
import type { SaveConflict } from "./api.ts";

// Четыре исхода сохранения (§2.8) — inline-callout над кнопкой, НЕ тост (форма должна остаться
// читаемой, пока ресёрчер решает следующий шаг). Конфликт — отдельная секция, нейтральный тон,
// НЕ коралл (§8.4: конфликт — норма, не ошибка).

// Та же галочка-иконка (stroke-draw), что overlay/toaster.tsx SuccessCheckIcon — переиспользуем
// словарь моушена (.ovlToastIcon/.ovlToastCheck, motion.md §4), не заводим новый трек (§4 спеки).
function CheckIcon({ visible }: { visible: boolean }) {
  return (
    <span className="ovlToastIcon" aria-hidden="true" data-visible={visible || undefined}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path className="ovlToastCheck" d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export type SaveOutcome =
  | { kind: "published" }
  | { kind: "draft-no-source" }
  | { kind: "validation-error"; count: number }
  | { kind: "network-error" };

export function SaveCallout({ outcome, onOpenSources, onRetry }: { outcome: SaveOutcome; onOpenSources: () => void; onRetry: () => void }) {
  // Триггер появления — setTimeout, не rAF (motion.md: rAF на паузе в фоне → элемент застрянет
  // opacity:0), тот же приём, что overlay/toaster.tsx ToastCard.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setEntered(true), 10);
    return () => clearTimeout(timer);
  }, []);

  if (outcome.kind === "published") {
    return (
      <div className="rsCallout" data-tone="success">
        <CheckIcon visible={entered} />
        <span>Сохранено · опубликовано</span>
      </div>
    );
  }
  if (outcome.kind === "draft-no-source") {
    return (
      <button type="button" className="rsCallout rsCalloutButton" data-tone="warn" onClick={onOpenSources}>
        Сохранено. Чтобы опубликовать, добавьте хотя бы один источник →
      </button>
    );
  }
  if (outcome.kind === "validation-error") {
    return (
      <div className="rsCallout" data-tone="danger">
        <span>{outcome.count} {outcome.count === 1 ? "поле не принято" : "поля не приняты"}</span>
      </div>
    );
  }
  return (
    <div className="rsCallout" data-tone="danger">
      <span>Не сохранилось, черновик цел</span>
      <button type="button" className="rsRetryButton pressable" onClick={onRetry}>
        Повторить
      </button>
    </div>
  );
}

// ВАЖНО про имена полей SaveConflict (research.route.ts): `ours`/`theirs` там — с точки зрения
// СЕРВЕРА (`ours` = то, что уже в БД и осталось; `theirs` = то, что ПРИСЛАЛ этот же запрос и
// не применилось из-за конфликта) — то есть `theirs` из API это как раз «моё» с точки зрения
// текущего ресёрчера, а `ours` — значение, которое кто-то ДРУГОЙ сохранил, пока эта форма была
// открыта. Компонент переворачивает подписи в понятную пользователю сторону, саму структуру не трогая.
export function ConflictSection({
  conflicts,
  resolutions,
  onResolve,
}: {
  conflicts: SaveConflict[];
  resolutions: Record<string, "mine" | "theirs">;
  onResolve: (field: string, choice: "mine" | "theirs") => void;
}) {
  if (conflicts.length === 0) return null;
  return (
    <div className="rsConflict reveal">
      <p className="rsConflictTitle">Пока вы редактировали, карточку обновили — {conflicts.length} {conflicts.length === 1 ? "поле разошлось" : "поля разошлись"}</p>
      {conflicts.map((c) => (
        <div key={c.field} className="rsConflictRow">
          <span className="rsConflictField">{c.field}</span>
          <div className="rsConflictValues">
            <span>моё: {String(c.theirs)}</span>
            <span>их: {String(c.ours)}</span>
          </div>
          <div className="rsTileRow">
            <button
              type="button"
              className="rsTile pressable"
              data-selected={resolutions[c.field] === "mine" || undefined}
              onClick={() => onResolve(c.field, "mine")}
            >
              оставить моё
            </button>
            <button
              type="button"
              className="rsTile pressable"
              data-selected={resolutions[c.field] === "theirs" || undefined}
              onClick={() => onResolve(c.field, "theirs")}
            >
              взять их
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
