import { useEffect, useState } from "react";
import { useActivation, type ActivationState } from "@shared/lib";
import type { SessionUser } from "@shared/types";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 8): printing→access takePrinterResume (гостевое возобновление привязки принтера), развязка отложена до pages/DI. См. MIGRATION.md.
import { takePrinterResume } from "@domains/access";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 4.2): printing→onboarding PrinterPicker (мастер добавления принтера переиспользует пикер онбординга), развязка отложена до pages/DI. См. MIGRATION.md.
import { PrinterPicker } from "@domains/onboarding";
import { useOverlay } from "@platform/overlay";
import { navigate, parkPath, parseParkAddPrefill, printerCommunityFirmwarePath, printerDiyPath, printerPath } from "../../../router.ts";
import { useInteractionSound } from "@platform/sound";
import { AuroraBackground, Card, Eyebrow, Heading, StatusPill } from "@shared/ui";
import { apiFetch } from "@shared/api";
import type { LevelId } from "./gating.ts";
import { LevelTiles } from "./leveltiles.tsx";
import { findPrinterCanon, type PrinterCanonMatch } from "./printercanon.ts";
import "./park.css";

// Мастер «добавить принтер» (MF-903, docs/design/printer.wizard.md). Роут `/park/add`, не оверлей
// (§0 — диплинк/шара/«назад» обязаны работать). Прогресс остаётся локальным для формы, а внешняя
// оболочка и возврат используют общий HomeHeader — так маршрут не меняет геометрию сайта.

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M16.5 3.5l4 4L7 21l-4.5 1L4 17.5 16.5 3.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface SelectedMachine {
  brand: string;
  model: string;
}

export function ParkAddScreen({
  user,
  section,
  onSectionChange,
}: {
  user: SessionUser | null;
  section: Section;
  onSectionChange: (section: Section) => void;
}) {
  const activation = useActivation();
  const overlay = useOverlay();
  const sound = useInteractionSound();
  // Префилл с карточки модели (§2, «У меня такой», MF-892 — ещё не собрана, но контракт URL уже
  // канонический, тот же приём, что issueNewPath/feedNewPath в router.ts) — при наличии brand/model
  // шаг 1 пропускается, мастер открывается сразу на шаге 2.
  const [prefill, setPrefill] = useState(() => parseParkAddPrefill(window.location.search));
  const [invalidPrefill, setInvalidPrefill] = useState(false);

  const [step, setStep] = useState<1 | 2>(prefill ? 2 : 1);
  const [machine, setMachine] = useState<SelectedMachine | null>(prefill ? { brand: prefill.brand, model: prefill.model } : null);
  // Префилл заходит сразу на шаг 2 БЕЗ прохода через PrinterPicker — значит addPrinter(list) ещё
  // не вызывался (в обычном потоке его вызывает сам PrinterPicker при тапе на шаге 1). Ловим это
  // ровно один раз, когда юзер выбирает "list" на шаге 2.
  const [addedViaPrefill, setAddedViaPrefill] = useState(false);
  const [canon, setCanon] = useState<PrinterCanonMatch | null>(null);
  const [canonLoading, setCanonLoading] = useState(false);
  const [done, setDone] = useState<LevelId | null>(null);
  const [createdPrinterId, setCreatedPrinterId] = useState<string | null>(null);
  const [resume] = useState(() => takePrinterResume());

  // Re-check opaque catalog ids after a deep-link/refresh. Deleted ids must fall back to
  // ordinary model selection instead of silently binding a stale prefill.
  useEffect(() => {
    if (!prefill?.machineId) return;
    let cancelled = false;
    apiFetch(`/printers/${encodeURIComponent(prefill.machineId)}`).then((response) => {
      if (cancelled || response.ok) return;
      setPrefill(undefined);
      setInvalidPrefill(true);
      setStep(1);
      setMachine(null);
    }).catch(() => {
      if (!cancelled) {
        setPrefill(undefined);
        setInvalidPrefill(true);
        setStep(1);
        setMachine(null);
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!machine) {
      setCanon(null);
      return;
    }
    let cancelled = false;
    setCanonLoading(true);
    findPrinterCanon(machine.brand, machine.model).then((info) => {
      if (cancelled) return;
      setCanon(info);
      setCanonLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [machine]);

  // Шаг 1 переиспользуется «визуально как есть» (MF-437) — своё поведение onLinked/addPrinter не
  // меняем, только оборачиваем addPrinter, чтобы поймать brand/model выбранной машины: PrinterPicker
  // сам их не отдаёт наружу, только вызывает addPrinter(...) и затем onLinked() без аргументов.
  const handlePrinterAdded: ActivationState["addPrinter"] = async (printer) => {
    setMachine({ brand: printer.brand, model: printer.model });
    return activation.addPrinter(printer);
  };

  function goBack() {
    if (step === 2 && !prefill) {
      setStep(1);
      setMachine(null);
      return;
    }
    navigate(prefill?.returnTo ?? parkPath(), "back");
  }

  async function handleLevelDone(level: LevelId, lanEndpoint?: string) {
    if (prefill && !addedViaPrefill && level === "list" && machine) {
      const printer = await activation.addPrinter({ brand: machine.brand, model: machine.model, link_source: "search" });
      if (!printer) {
        sound.error();
        return;
      }
      setAddedViaPrefill(true);
    }
    if (level === "managed-local" && machine && lanEndpoint) {
      const printer = await activation.addPrinter({ brand: machine.brand, model: machine.model, link_source: "ip", lan_endpoint: lanEndpoint });
      if (!printer) {
        sound.error();
        return;
      }
      setCreatedPrinterId(printer.id);
    }
    sound.success();
    setDone(level);
  }

  const exitPrinterId = canon?.slug ?? (machine ? `${machine.brand}-${machine.model}` : "");
  const header = <HomeHeader user={user} printers={activation.printers} section={section} onSectionChange={onSectionChange} onBack={done ? () => navigate(parkPath()) : goBack} mode="mixed" />;

  if (done) {
    return (
      <div className="home">
        <AuroraBackground />
        {header}
        <main className="parkScreen">
          <Card className="parkCard">
            <div className="parkSuccess reveal">
              <StatusPill tone="ok" done>
                Принтер в парке
              </StatusPill>
              <Heading size="md">Готово</Heading>
              <p className="parkSuccessText">
                {done === "list"
                  ? "Принтер добавлен для сравнения и сообщества."
                  : "Принтер добавлен — управление откроется, как только подключение подтвердится."}
              </p>
              <button type="button" className="uiButton pressable" data-variant="primary" onPointerDown={sound.tick} onClick={() => navigate(createdPrinterId ? printerPath(createdPrinterId) : parkPath())}>
                <span>{createdPrinterId ? "Открыть принтер" : "Готово"}</span>
              </button>
            </div>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="home">
      <AuroraBackground />
      {header}
      <main className="parkScreen">
        <Card className="parkCard">
          <div className="parkProgress">
            <div className="uiChecklistBar parkWizardProgressTrack" role="progressbar" aria-valuemin={1} aria-valuemax={2} aria-valuenow={step} aria-label="Прогресс добавления принтера">
              <div className="uiChecklistBarFill parkWizardProgressFill" style={{ width: step === 1 ? "50%" : "100%" }} />
            </div>
            <Eyebrow>Шаг {step} из 2</Eyebrow>
          </div>

          {step === 1 ? (
            <>
              {invalidPrefill ? <p role="status" className="parkWizardNotice">Модель из ссылки больше недоступна. Выберите принтер из каталога.</p> : null}
              <PrinterPicker
                persona={null}
                addPrinter={handlePrinterAdded}
                onLinked={() => setStep(2)}
                headingLevel={1}
                searchInputClassName="parkWizardSearch"
              />
            </>
          ) : (
            <div className="parkStep2 reveal">
              <Heading size="md">Что вы хотите делать с принтером?</Heading>
              {machine ? (
                <div className="parkMachineChip">
                  <span>
                    {machine.brand} {machine.model}
                  </span>
                  {!prefill ? (
                    <button
                      type="button"
                      className="parkEditChip pressable"
                      onClick={() => {
                        setStep(1);
                        setMachine(null);
                      }}
                      aria-label="Изменить модель"
                    >
                      <PencilIcon />
                    </button>
                  ) : null}
                </div>
              ) : null}
              <LevelTiles
                brand={machine?.brand ?? ""}
                model={machine?.model ?? ""}
                canon={canon}
                canonLoading={canonLoading}
                overlay={overlay}
                user={user}
                initialLevel={resume?.level ?? null}
                initialIp={resume?.ip ?? ""}
                onDiy={() => navigate(printerDiyPath(exitPrinterId))}
                onCommunityFirmware={() => navigate(printerCommunityFirmwarePath(exitPrinterId))}
                onDone={handleLevelDone}
              />
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
