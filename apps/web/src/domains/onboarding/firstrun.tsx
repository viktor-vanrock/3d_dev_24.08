import { useState, type ReactNode } from "react";
import type { SessionUser } from "@shared/types";
import { marketPath, navigate } from "../../router.ts";
import { useInteractionSound } from "@platform/sound";
import { Button, Card, PrinterIcon, SelectionTile } from "@shared/ui";
import { trackActivation, type Activation, type ActivationState, type Persona } from "@shared/lib";
import { ActivationChecklist } from "./checklist.tsx";
import { FilamentStep } from "./filamentstep.tsx";
import { PrinterPicker } from "./printerpicker.tsx";

// Компактная карточка персоны (first_run) — НЕ опросник-экран, а мягкий блок
// ПОСЛЕ поиска и галереи (фидбек Валерия 2026-07-04): главная встречает делом,
// онбординг — ниже и пропускаем. Тап пишет primary_persona (source=declared).

const PERSONA_TILES: { id: Persona; icon: ReactNode; title: string; sub: string }[] = [
  { id: "novice", icon: <PrinterIcon size={22} />, title: "У меня есть принтер", sub: "Хочу печатать" },
  { id: "author", icon: <PenIcon />, title: "Выкладываю модели", sub: "Я автор" },
  { id: "builder", icon: <WrenchIcon />, title: "Собираю принтер", sub: "DIY / Voron" },
  { id: "pro", icon: <FactoryIcon />, title: "Печатаю на заказ", sub: "Мастер / ферма" },
];

export function PersonaCard({ activation }: { activation: ActivationState }) {
  const selected = activation.activation?.primary_persona ?? null;
  const sound = useInteractionSound();

  return (
    <Card style={{ padding: "clamp(18px, 3.5vw, 28px)", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 17 }}>Что вас сюда привело? Настроим портал под вас</div>
        <button
          type="button"
          className="homeSkipLink pressable"
          style={{ alignSelf: "auto", padding: 0 }}
          onPointerDown={sound.tick}
          onClick={() => {
            activation.patch({ first_run_completed: true });
            trackActivation("first_run_completed", { trigger: "persona_skip" });
          }}
        >
          Пропустить
        </button>
      </div>
      <div className="homePersonaGrid">
        {PERSONA_TILES.map((tile) => (
          <SelectionTile
            key={tile.id}
            className="homePersonaTile"
            selected={selected === tile.id}
            onPress={sound.toggle}
            onClick={() => {
              activation.patch({ primary_persona: tile.id, persona_source: "declared" });
              trackActivation("persona_declared", { persona: tile.id });
            }}
          >
            <span className="homePersonaIcon">{tile.icon}</span>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 14 }}>{tile.title}</span>
            <span style={{ fontSize: 12, opacity: 0.66 }}>{tile.sub}</span>
          </SelectionTile>
        ))}
      </div>
    </Card>
  );
}

// Шаг-развилка «есть ли принтер?» (паттерн Twilio one-branch, MF-437): три тапа, ничего
// не блокирует. Ответ (включая «Пропустить») сразу пишем в home_dismissed_prompts —
// иначе при перезагрузке страницы вопрос вернётся на КАЖДЫЙ заход (критерий приёмки).
export function PrinterQuestionCard({ activation }: { activation: ActivationState }) {
  const sound = useInteractionSound();

  function answer(value: "yes" | "no" | "skip") {
    activation.patch({
      home_dismissed_prompts: { ...activation.activation?.home_dismissed_prompts, printer_answer: value },
    });
    trackActivation("printer_question_answered", { answer: value });
  }

  return (
    <Card style={{ padding: "clamp(18px, 3.5vw, 28px)", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 17 }}>У вас уже есть 3D-принтер?</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button variant="secondary" icon={null} onPointerDown={sound.tick} onClick={() => answer("yes")}>
          Да
        </Button>
        <Button variant="secondary" icon={null} onPointerDown={sound.tick} onClick={() => answer("no")}>
          Пока нет
        </Button>
        <button
          type="button"
          className="homeSkipLink pressable"
          style={{ alignSelf: "center", padding: "0 12px" }}
          onPointerDown={sound.tick}
          onClick={() => answer("skip")}
        >
          Пропустить
        </button>
      </div>
    </Card>
  );
}

// Soft-track «нет принтера» — три двери, НИ ОДНА не пустой экран (критерий приёмки MF-437):
// витрина Make (MF-27/38 пока нет — временно каталог MF-11), подбор первого принтера
// (открытый вопрос эпика: квиз-лайт vs заглушка-витрина — по решению владельца эпика
// 2026-07-09 берём picker как живую заглушку-витрину, НЕ квиз-лайт), гостевой дом (просто
// продолжить — поиск/лента уже живые).
export function SoftTrackDoors({ activation }: { activation: ActivationState }) {
  const sound = useInteractionSound();

  function done() {
    activation.patch({
      home_dismissed_prompts: { ...activation.activation?.home_dismissed_prompts, soft_track: true },
    });
  }
  const [door, setDoor] = useState<"choose" | "pick_printer">("choose");

  if (door === "pick_printer") {
    return (
      <PrinterPicker
        persona={activation.activation?.primary_persona ?? null}
        addPrinter={activation.addPrinter}
        onLinked={done}
        onSkip={done}
      />
    );
  }

  return (
    <Card style={{ padding: "clamp(18px, 3.5vw, 28px)", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 17 }}>Ничего страшного — вот с чего можно начать</div>
      <div className="homePersonaGrid">
        {/* Тут SelectionTile без persisted-selection (нет selected) — это тап-действие/навигация,
            не переключатель состояния, поэтому tick, а не toggle (в отличие от PersonaCard). */}
        <SelectionTile
          className="homePersonaTile"
          onPress={sound.tick}
          onClick={() => {
            trackActivation("soft_track_chosen", { track: "showcase" });
            done();
            navigate(marketPath());
          }}
        >
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 14 }}>Посмотреть, что печатают</span>
          <span style={{ fontSize: 12, opacity: 0.66 }}>Витрина популярных моделей</span>
        </SelectionTile>
        <SelectionTile
          className="homePersonaTile"
          onPress={sound.tick}
          onClick={() => {
            trackActivation("soft_track_chosen", { track: "pick_printer" });
            setDoor("pick_printer");
          }}
        >
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 14 }}>Подобрать первый принтер</span>
          <span style={{ fontSize: 12, opacity: 0.66 }}>Каталог MF-32</span>
        </SelectionTile>
        <SelectionTile
          className="homePersonaTile"
          onPress={sound.tick}
          onClick={() => {
            trackActivation("soft_track_chosen", { track: "guest" });
            done();
          }}
        >
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 14 }}>Продолжить без принтера</span>
          <span style={{ fontSize: 12, opacity: 0.66 }}>Поиск и лента уже доступны</span>
        </SelectionTile>
      </div>
    </Card>
  );
}

export type FirstRunStep = "persona" | "printer_question" | "picker" | "filament" | "soft_track" | "checklist";

// Единственный источник истины для «на каком шаге first-run флоу сейчас юзер» (MF-437):
// чистая функция от персистентного activation — переживает reload (критерий «не спрашиваем
// на каждый вход»), никакого отдельного клиентского стейт-машины стейта.
export function computeFirstRunStep(activation: Activation): FirstRunStep {
  const dismissed = activation.home_dismissed_prompts;
  if (!activation.primary_persona) return "persona";

  const answer = dismissed.printer_answer as "yes" | "no" | "skip" | undefined;
  if (!answer) return "printer_question";

  if (answer === "yes") {
    if (!activation.has_printer && !dismissed.picker) return "picker";
    if (!dismissed.filament) return "filament";
    return "checklist";
  }
  // answer === "no" | "skip"
  if (!dismissed.soft_track) return "soft_track";
  return "checklist";
}

function dismiss(activation: ActivationState, key: string): void {
  activation.patch({
    home_dismissed_prompts: { ...activation.activation?.home_dismissed_prompts, [key]: true },
  });
}

// Оркестратор first-run флоу (эпик MF-437: персона → принтер → филамент/soft-track →
// чек-лист). Рендерит РОВНО один шаг за раз (бюджет анти-перегруза MF-435 §
// «Обучающий слой»), домом всегда переиспользуется этот же компонент — HomeScreen его не
// ветвит вручную.
export function FirstRunFlow({ user, activation }: { user: SessionUser; activation: ActivationState }) {
  if (!activation.activation) return null;
  const step = computeFirstRunStep(activation.activation);

  switch (step) {
    case "persona":
      return <PersonaCard activation={activation} />;
    case "printer_question":
      return <PrinterQuestionCard activation={activation} />;
    case "picker":
      return (
        <PrinterPicker
          persona={activation.activation.primary_persona}
          addPrinter={activation.addPrinter}
          onLinked={() => dismiss(activation, "picker")}
          onSkip={() => dismiss(activation, "picker")}
        />
      );
    case "filament":
      return <FilamentStep addFilament={activation.addFilament} onDone={() => dismiss(activation, "filament")} />;
    case "soft_track":
      return <SoftTrackDoors activation={activation} />;
    case "checklist":
      return <ActivationChecklist user={user} activation={activation} />;
  }
}

function PenIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m4 20 1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1Z"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 7a4 4 0 0 1 5.5-3.7L16.8 6l1.2 1.2 2.7-2.7A4 4 0 0 1 15 10L7 18a2 2 0 0 1-3-3l8-8a4 4 0 0 1 2-0Z"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function FactoryIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 20V9l5 3V9l5 3V4h5l1 16H3Z"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}
