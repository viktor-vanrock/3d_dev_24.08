import { navigate, printerComparePath } from "../../../router.ts";
import { useInteractionSound } from "@platform/sound";
import { Button, PrinterIcon } from "@shared/ui";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 9): printing→ai PrinterRecord, развязка отложена до pages/DI. См. MIGRATION.md.
import type { PrinterRecord } from "@domains/ai";
import "./printers.css";

// `ComparePanel` — новый переиспользуемый примитив (docs/design/printers.catalog.md §3/§6/§9):
// липкий низ 2–4 выбранных объектов на десктопе, коллапс в чип над bottom-tab на мобиле. Контракт
// независим от предметной области — набор id живёт в URL (см. `useCompareSet` в printersscreen.tsx),
// эта панель только рендерит уже выбранные карточки. Мобильный чип ведёт СРАЗУ на
// `/printers/compare?ids=…` (§6: второй bottom-sheet поверх первого запрещён), десктопный бар даёт
// снять элемент на месте до перехода.

export interface ComparePanelProps {
  selected: PrinterRecord[];
  onRemove: (id: string) => void;
}

export function ComparePanel({ selected, onRemove }: ComparePanelProps) {
  const sound = useInteractionSound();
  if (selected.length === 0) return null;
  const canCompare = selected.length >= 2;

  function openCompare() {
    if (!canCompare) return;
    sound.cta();
    navigate(printerComparePath(selected.map((p) => p.id)));
  }

  return (
    <>
      <div className="prnComparePanel modal-in-out" data-visible="true" role="region" aria-label="Сравнение принтеров">
        <div className="prnComparePanelItems">
          {selected.map((printer) => (
            <div key={printer.id} className="prnComparePanelItem">
              {printer.media.hero ? (
                <img className="prnComparePanelPhoto" src={printer.media.hero} alt="" />
              ) : (
                <span className="prnComparePanelPhotoFallback">
                  <PrinterIcon size={16} />
                </span>
              )}
              <span className="prnComparePanelName">
                {printer.brand} {printer.model}
              </span>
              <Button variant="ghost" icon={null} className="prnComparePanelRemove" aria-label={`Убрать ${printer.brand} ${printer.model} из сравнения`} onClick={() => onRemove(printer.id)}>
                ✕
              </Button>
            </div>
          ))}
        </div>
        <Button className="prnComparePanelCta" icon={null} disabled={!canCompare} onClick={openCompare}>
          {canCompare ? "Сравнить" : "Выберите ещё один"}
        </Button>
      </div>
      <Button variant="secondary" icon={null} className="prnCompareChip modal-in-out" data-visible="true" onClick={openCompare} disabled={!canCompare}>
        Сравнить ({selected.length})
      </Button>
    </>
  );
}
