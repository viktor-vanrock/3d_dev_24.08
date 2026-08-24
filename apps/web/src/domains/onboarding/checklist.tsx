import { useEffect } from "react";
import type { SessionUser } from "@shared/types";
import { useOverlay } from "@platform/overlay";
import { addModelPath, marketPath, navigate, profilePath } from "../../router.ts";
import { Checklist } from "@shared/ui";
import { trackActivation, type ActivationState, type Persona } from "@shared/lib";
import { FilamentStep } from "./filamentstep.tsx";
import { PrinterPicker } from "./printerpicker.tsx";

// Чек-лист активации под персону (MF-437 § «Чек-лист активации под персону») — виджет MF-40
// (Checklist), только шаги+навигация наши. Границы намеренно уже, чем в описании эпика: шаги
// «выложи Make» (MF-27), «сравни принтеры» отдельной страницей, «привяжи выплаты» (MF-17) не
// включены — их разделов ещё нет в web (см. коммент на карточке MF-437), чтобы не давать шаг,
// ведущий в никуда. Как только эти разделы появятся, сюда добавляется шаг с реальной ссылкой.

type StepId = "account" | "printer" | "catalog" | "filament" | "upload" | "profile";

interface StepDef {
  id: StepId;
  title: string;
  done: boolean;
  action: () => void;
}

// Прогресс стартует не с 0, а с ~20% — эффект Зейгарник (MF-40/MF-427 § «Чек-лист
// активации»): первый пункт «Аккаунт создан» всегда уже выполнен, не кликабелен.
const ACCOUNT_STEP: StepDef = { id: "account", title: "Аккаунт создан", done: true, action: () => {} };

function markVisited(activation: ActivationState, key: string): void {
  activation.patch({
    activation_checklist: { ...activation.activation?.activation_checklist, [key]: true },
  });
  trackActivation("checklist_step_done", { step: key });
}

export function ActivationChecklist({
  user,
  activation,
  onVisibleChange,
}: {
  user: SessionUser;
  activation: ActivationState;
  // Фаза 3 (MF-438): дом должен знать, занят ли слот «обучающий элемент» чек-листом,
  // чтобы не показать одновременно ещё и коачмарк (инвариант «≤1 за раз», coachmarks.ts).
  // Сообщаем свою видимость наружу — не дублируем "allDone/dismissed" логику в home.tsx.
  onVisibleChange?: (visible: boolean) => void;
}) {
  const overlay = useOverlay();
  const checklist = activation.activation?.activation_checklist ?? {};
  const persona: Persona | null = activation.activation?.primary_persona ?? null;
  const dismissed = !!activation.activation?.home_dismissed_prompts?.checklist;

  function openPrinterPicker() {
    const handle = overlay.modal({
      title: "Привяжите принтер",
      content: (
        <PrinterPicker
          persona={persona}
          addPrinter={activation.addPrinter}
          onLinked={() => handle.close()}
          onSkip={() => handle.close()}
        />
      ),
    });
  }

  function openFilamentStep() {
    const handle = overlay.modal({
      title: "Ваш пластик",
      content: <FilamentStep addFilament={activation.addFilament} onDone={() => handle.close()} />,
    });
  }

  function openUpload() {
    markVisited(activation, "model_uploaded");
    navigate(addModelPath());
  }

  function openCatalog() {
    markVisited(activation, "catalog_visited");
    navigate(marketPath());
  }

  function openProfile() {
    markVisited(activation, "profile_visited");
    navigate(profilePath(user.username));
  }

  const steps: StepDef[] =
    persona === "author"
      ? [
          ACCOUNT_STEP,
          { id: "upload", title: "Загрузите первую модель", done: !!checklist.model_uploaded, action: openUpload },
          { id: "profile", title: "Заполните профиль", done: !!checklist.profile_visited, action: openProfile },
          { id: "catalog", title: "Найдите вдохновение в каталоге", done: !!checklist.catalog_visited, action: openCatalog },
        ]
      : [
          ACCOUNT_STEP,
          {
            id: "printer",
            title: persona === "builder" ? "Привяжите вашу сборку" : "Привяжите принтер",
            done: !!activation.activation?.has_printer,
            action: openPrinterPicker,
          },
          {
            id: "catalog",
            title: persona === "builder" ? "Сравните станки в каталоге" : "Откройте модель для печати",
            done: !!checklist.catalog_visited,
            action: openCatalog,
          },
          { id: "filament", title: "Укажите филамент", done: activation.filaments.length > 0, action: openFilamentStep },
        ];

  const allDone = steps.every((step) => step.done);
  const state = activation.activation?.state;
  const visible = !dismissed && !allDone;

  // Завершение всех шагов чек-листа — один из трёх триггеров first_run → returning
  // (наравне с N-сессиями из Фазы 1 и «просто посмотреть»), критерий приёмки MF-437.
  useEffect(() => {
    if (allDone && state === "first_run") {
      activation.patch({ first_run_completed: true });
      trackActivation("first_run_completed", { trigger: "checklist_all_done" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone, state]);

  useEffect(() => {
    onVisibleChange?.(visible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  function onStep(id: string) {
    steps.find((step) => step.id === id)?.action();
  }

  function onDismiss() {
    activation.patch({
      home_dismissed_prompts: { ...activation.activation?.home_dismissed_prompts, checklist: true },
    });
  }

  return <Checklist title="Первые шаги" steps={steps} onStep={onStep} onDismiss={onDismiss} />;
}
