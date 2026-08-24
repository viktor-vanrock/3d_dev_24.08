import { useActivation, type FilamentPatch, type PrinterPatch, type UserFilament, type UserPrinter } from "@shared/lib";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 4.2): commerce→onboarding MaterialPicker/PrinterPicker (редактор профиля переиспользует пикеры онбординга), развязка отложена до pages/DI. См. MIGRATION.md.
import { FilamentEditForm, MaterialPicker, materialLabel, PrinterEditForm, PrinterPicker, printerLabel } from "@domains/onboarding";
import { useOverlay } from "@platform/overlay";
import { Button, EmptyState, Eyebrow, IconButton, PrinterIcon } from "@shared/ui";

// «Мои принтеры»/«Мои филаменты» в ЛК (Фаза 3 MF-359, эпик MF-15 § «Навигация ЛК и пустые
// состояния»; вынесено из profile.tsx MF-911): облегчённые строки по образцу «Мои идеи»/«Мои
// печати» — то же место (свой профиль), тот же .ideaRow/.ideaList/EmptyState словарь. Данные и
// мутации — тот же useActivation()/PrinterPicker/DELETE-эндпоинты, что уже возит onboarding-
// чек-лист MF-436/437 (POST уже был, здесь первый клиент читает список постоянно и умеет
// удалять). Экспортирована и тестируется отдельно от остального профиля — тот же приём, что
// PushSettingsSection (profile.push.tsx).
export function MyCatalogsSection() {
  const overlay = useOverlay();
  const {
    loading,
    printers,
    filaments,
    addPrinter,
    addFilament,
    updatePrinter,
    updateFilament,
    removePrinter,
    removeFilament,
  } = useActivation();

  function openAddPrinter() {
    const handle = overlay.modal({
      title: "Добавить принтер",
      size: "form",
      content: <PrinterPicker persona={null} addPrinter={addPrinter} onLinked={() => handle.close()} onSkip={() => handle.close()} surface="overlay" />,
    });
  }

  // Тап по строке принтера (кроме корзины) — редактирование (MF-939 §2): та же модалка-обёртка,
  // что «Добавить принтер», форма отдельная (переиспользует поля ManualPrinterForm).
  function openEditPrinter(printer: UserPrinter) {
    const handle = overlay.modal({
      title: "Изменить принтер",
      size: "form",
      content: (
        <PrinterEditForm
          printer={printer}
          onSave={async (patch: PrinterPatch) => {
            const ok = await updatePrinter(printer.id, patch);
            if (ok) handle.close();
            else overlay.toast({ severity: "warn", title: "Не удалось сохранить" });
          }}
          onMakePrimary={
            printer.is_primary
              ? undefined
              : async () => {
                  const ok = await updatePrinter(printer.id, { is_primary: true });
                  if (ok) handle.close();
                  else overlay.toast({ severity: "warn", title: "Не удалось сделать основным" });
                }
          }
        />
      ),
    });
  }

  // Тап по строке филамента (кроме корзины) — редактирование (MF-951/MF-939 §3): та же
  // модалка-обёртка, что «Добавить филамент», форма отдельная (FilamentEditForm).
  function openEditFilament(filament: UserFilament) {
    const handle = overlay.modal({
      title: "Изменить филамент",
      size: "form",
      content: (
        <FilamentEditForm
          filament={filament}
          onSave={async (patch: FilamentPatch, variantMeta) => {
            const ok = await updateFilament(filament.id, patch, variantMeta);
            if (ok) handle.close();
            else overlay.toast({ severity: "warn", title: "Не удалось сохранить" });
          }}
        />
      ),
    });
  }

  function openAddFilament() {
    const handle = overlay.modal({
      title: "Добавить филамент",
      size: "form",
      content: (
        <MaterialPicker
          addFilament={addFilament}
          existingMaterialIds={filaments.map((filament) => filament.material_id)}
          onDone={() => handle.close()}
          surface="overlay"
        />
      ),
    });
  }

  async function handleRemovePrinter(printer: UserPrinter) {
    const confirmed = await overlay.confirm({
      title: "Убрать принтер?",
      message: `${printerLabel(printer)} исчезнет из «Моих принтеров».`,
      confirmLabel: "Убрать",
      cancelLabel: "Отмена",
      destructive: true,
    });
    if (!confirmed) return;
    const ok = await removePrinter(printer.id);
    if (!ok) overlay.toast({ severity: "warn", title: "Не удалось убрать принтер" });
  }

  async function handleRemoveFilament(filament: UserFilament) {
    const confirmed = await overlay.confirm({
      title: "Убрать филамент?",
      message: `${materialLabel(filament)} исчезнет из «Моих филаментов».`,
      confirmLabel: "Убрать",
      cancelLabel: "Отмена",
      destructive: true,
    });
    if (!confirmed) return;
    const ok = await removeFilament(filament.id);
    if (!ok) overlay.toast({ severity: "warn", title: "Не удалось убрать филамент" });
  }

  return (
    <>
      <div className="ideasSection">
        <Eyebrow>Мои принтеры{!loading ? ` · ${printers.length}` : ""}</Eyebrow>
        {loading ? (
          <div className="ideaList">
            <div className="ideaRowSkeleton" />
          </div>
        ) : printers.length === 0 ? (
          <EmptyState
            icon={<PrinterIcon size={20} />}
            title="Здесь появятся ваши принтеры"
            sub="Добавьте первый принтер — пригодится для рекомендаций и совместимости."
            action={
              <Button variant="secondary" icon={null} onClick={openAddPrinter}>
                Добавить принтер
              </Button>
            }
          />
        ) : (
          <>
            <div className="ideaList">
              {printers.map((printer) => (
                <div
                  key={printer.id}
                  className="ideaRow pressable"
                  role="button"
                  tabIndex={0}
                  aria-label={`Изменить «${printerLabel(printer)}»`}
                  onClick={() => openEditPrinter(printer)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") openEditPrinter(printer);
                  }}
                >
                  <div className="ideaRowMain">
                    <div className="ideaRowTitle">{printerLabel(printer)}</div>
                    <div className="ideaRowMeta">
                      {printer.is_primary ? <span>Основной</span> : null}
                      {printer.verified ? (
                        <>
                          {printer.is_primary ? <span className="ideaRowDot">·</span> : null}
                          <span>Из каталога</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div onClick={(event) => event.stopPropagation()}>
                    <IconButton label={`Убрать ${printerLabel(printer)}`} onClick={() => void handleRemovePrinter(printer)}>
                      <TrashIcon />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="marketShowMore pressable" onClick={openAddPrinter}>
              Добавить ещё принтер
            </button>
          </>
        )}
      </div>

      <div className="ideasSection">
        <Eyebrow>Мои филаменты{!loading ? ` · ${filaments.length}` : ""}</Eyebrow>
        {loading ? (
          <div className="ideaList">
            <div className="ideaRowSkeleton" />
          </div>
        ) : filaments.length === 0 ? (
          <EmptyState
            icon={<SpoolIcon />}
            title="Здесь появятся ваши филаменты"
            sub="Добавьте первый филамент, которым печатаете."
            action={
              <Button variant="secondary" icon={null} onClick={openAddFilament}>
                Добавить филамент
              </Button>
            }
          />
        ) : (
          <>
            <div className="ideaList">
              {filaments.map((filament) => (
                <div
                  key={filament.id}
                  className="ideaRow pressable"
                  role="button"
                  tabIndex={0}
                  aria-label={`Изменить «${materialLabel(filament)}»`}
                  onClick={() => openEditFilament(filament)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") openEditFilament(filament);
                  }}
                >
                  <div className="ideaRowMain">
                    <div className="ideaRowTitle">{materialLabel(filament)}</div>
                    <div className="ideaRowMeta">
                      <span>{filament.material_type.toUpperCase()}</span>
                      {filament.color_name ? (
                        <>
                          <span className="ideaRowDot">·</span>
                          <span>{filament.color_name}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div onClick={(event) => event.stopPropagation()}>
                    <IconButton
                      label={`Убрать ${materialLabel(filament)}`}
                      onClick={() => void handleRemoveFilament(filament)}
                    >
                      <TrashIcon />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="marketShowMore pressable" onClick={openAddFilament}>
              Добавить ещё филамент
            </button>
          </>
        )}
      </div>
    </>
  );
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpoolIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 4h10v16H7V4Zm0 0a3 5 0 1 0 0 10m0-10a3 5 0 1 1 0 10m10-10a3 5 0 1 1 0 10m0-10a3 5 0 1 0 0 10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
