import { useEffect, useState, type ReactNode } from "react";
import type { SessionUser } from "@domains/access";
import type { OverlayApi } from "@platform/overlay";
import { listModels, type MarketModel } from "@domains/commerce";
import { addModelPath, generatePath, marketPath, modelPath, navigate, profilePath } from "../../router.ts";
import { useInteractionSound } from "@platform/sound";
import { ActionCard, Button, Eyebrow, EmptyState } from "@shared/ui";
import { trackActivation, isCompatible, type ActivationState, type Persona, type UserPrinter } from "@shared/lib";
import { FilamentStep, PrinterPicker } from "@domains/onboarding";
import { openMicroLesson } from "./help.tsx";
import { ModelTileGrid } from "./modeltile.tsx";

// Персонализированный дом возвращающегося (Фаза 3, MF-438 § «Персонализированный дом
// возвращающегося»): 5 раскладок CTA (макс 3 + всегда-видимый поиск NeuroSearch, который
// живёт отдельно в home.tsx), «продолжи с того же места», контекст печати, модуль
// совместимости. Часть целевых разделов эпика (MF-16 ассистент, MF-38 лента, MF-26 парк,
// MF-29 заказы) в web ещё не существует — тот же приём подмены, что уже применён в Фазе 2
// (firstrun.tsx комментарий «MF-27/38 пока нет — временно каталог MF-11»): ведём на ближайший
// реальный раздел, для двух пунктов без вообще никакого аналога (парк/заказы мастера) честно
// показываем «скоро» тостом, а не мёртвую ссылку.

interface PersonaCta {
  id: string;
  title: string;
  sub: string;
  icon: ReactNode;
  onClick: (ctx: CtaContext) => void;
}

interface CtaContext {
  overlay: OverlayApi;
  activation: ActivationState;
  user: SessionUser;
}

function comingSoon(overlay: OverlayApi, what: string) {
  overlay.toast({ severity: "info", title: "Скоро", message: `${what} — раздел ещё не собран` });
}

const PERSONA_CTAS: Record<Persona, PersonaCta[]> = {
  novice: [
    {
      id: "find_first_print",
      title: "Что напечатать первым",
      sub: "Подборка моделей для начала",
      icon: <SearchGlyph />,
      onClick: () => navigate(marketPath()),
    },
    {
      id: "assistant",
      title: "Спросить ассистента",
      sub: "Подскажет, с чего начать",
      icon: <GenerateGlyph />,
      onClick: () => navigate(generatePath()),
    },
    {
      id: "how_it_works",
      title: "Как это работает",
      sub: "Короткий урок за 4 шага",
      icon: <InfoGlyph />,
      onClick: ({ overlay }) => openMicroLesson(overlay, "start-printing"),
    },
  ],
  maker: [
    {
      id: "find_for_task",
      title: "Найти под задачу",
      sub: "Поиск в каталоге",
      icon: <SearchGlyph />,
      onClick: () => navigate(marketPath()),
    },
    {
      id: "compat_fleet",
      title: "Совместимо с парком",
      sub: "Модели под ваш принтер",
      icon: <CompatGlyph />,
      onClick: () => document.getElementById("homeCompatModule")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    },
    {
      id: "generate",
      title: "Сгенерировать",
      sub: "Нейросеть по описанию",
      icon: <GenerateGlyph />,
      onClick: () => navigate(generatePath()),
    },
  ],
  author: [
    {
      id: "upload_model",
      title: "Загрузить модель",
      sub: "Опубликовать новый проект",
      icon: <UploadGlyph />,
      onClick: () => navigate(addModelPath()),
    },
    {
      id: "my_projects",
      title: "Мои проекты и аналитика",
      sub: "Статистика по вашим моделям",
      icon: <StatsGlyph />,
      onClick: ({ user }) => navigate(profilePath(user.username)),
    },
    {
      id: "feed",
      title: "Лента",
      sub: "Свежее по подпискам",
      icon: <FeedGlyph />,
      onClick: () => navigate(marketPath()),
    },
  ],
  builder: [
    {
      id: "build_profile",
      title: "Профиль сборки",
      sub: "Привяжите свою сборку",
      icon: <FleetGlyph />,
      onClick: ({ overlay, activation }) => {
        const handle = overlay.modal({
          title: "Ваша сборка",
          content: (
            <PrinterPicker
              persona="builder"
              addPrinter={activation.addPrinter}
              onLinked={() => handle.close()}
              onSkip={() => handle.close()}
            />
          ),
        });
      },
    },
    {
      id: "communities",
      title: "Сообщества",
      sub: "Сборки других билдеров",
      icon: <FeedGlyph />,
      onClick: () => navigate(marketPath()),
    },
    {
      id: "catalog_upgrades",
      title: "Каталог / апгрейды",
      sub: "Станки и комплектующие",
      icon: <SearchGlyph />,
      onClick: () => navigate(marketPath()),
    },
  ],
  pro: [
    {
      id: "fleet_orders",
      title: "Мой парк и заказы",
      sub: "Обзор печатной фермы",
      icon: <FleetGlyph />,
      onClick: ({ overlay }) => comingSoon(overlay, "Парк/заказы"),
    },
    {
      id: "order_queue",
      title: "Поток заказов",
      sub: "Очередь печати на заказ",
      icon: <OrdersGlyph />,
      onClick: ({ overlay }) => comingSoon(overlay, "Поток заказов"),
    },
    {
      id: "bulk_filament",
      title: "Филаменты оптом",
      sub: "Материалы для фермы",
      icon: <FilamentGlyph />,
      onClick: ({ overlay, activation }) => {
        const handle = overlay.modal({
          title: "Филаменты",
          content: <FilamentStep addFilament={activation.addFilament} onDone={() => handle.close()} />,
        });
      },
    },
  ],
};

export function PersonaCtaRow({
  persona,
  user,
  activation,
  overlay,
}: {
  persona: Persona;
  user: SessionUser;
  activation: ActivationState;
  overlay: OverlayApi;
}) {
  const sound = useInteractionSound();
  const ctas = PERSONA_CTAS[persona];

  return (
    <section className="homeCtaRow" aria-label="Быстрые действия">
      {ctas.map((cta) => (
        <ActionCard
          key={cta.id}
          title={cta.title}
          sub={cta.sub}
          icon={cta.icon}
          onPress={sound.tick}
          onClick={() => {
            trackActivation("home_cta_click", { cta: cta.id, persona });
            cta.onClick({ overlay, activation, user });
          }}
        />
      ))}
    </section>
  );
}

// «Продолжи с того же места» — последний собственный проект автора (реальные данные MF-11,
// не выдуманная история просмотров). Нет своих моделей → модуль просто не рендерится (это не
// «белый экран» дома в целом — рядом всегда есть поиск/галерея/CTA), критерий эпика требует
// отсутствия пустых ЭКРАНОВ, не обязательности каждого опционального модуля.
export function ContinueCard({ user }: { user: SessionUser }) {
  const [model, setModel] = useState<MarketModel | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    listModels({ owner: user.username, sort: "new", limit: 1 }).then((result) => {
      if (!cancelled) setModel(result?.models[0] ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [user.username]);

  if (!model) return null;
  return (
    <ActionCard
      title="Продолжить с того же места"
      sub={model.title}
      icon={<StatsGlyph />}
      variant="secondary"
      onClick={() => navigate(modelPath(model.id))}
    />
  );
}

// Модуль «совместимо с вашим {принтер}» (MF-33) — в DOM ТОЛЬКО при привязанном принтере
// (критерий приёмки). isCompatible — заглушка (compat.ts), см. её комментарий: реального
// движка MF-33 ещё нет, сейчас пропускает все 3D-печатные модели каталога.
export function CompatModule({ printers, overlay, activation }: { printers: UserPrinter[]; overlay: OverlayApi; activation: ActivationState }) {
  const [models, setModels] = useState<MarketModel[] | null>(null);
  const printer = printers[0] ?? null;

  useEffect(() => {
    if (!printer) return;
    listModels({ sort: "popular", limit: 12 }).then((result) => setModels(result?.models ?? []));
  }, [printer]);

  if (!printer) {
    // Нет привязки → CTA-привязка вместо белого экрана (критерий приёмки эпика).
    return (
      <section id="homeCompatModule">
        <Eyebrow>Топ первых принтов для новичка</Eyebrow>
        <EmptyState
          icon={<CompatGlyph />}
          title="Привяжите принтер — покажем, что печатается прямо на нём"
          sub="Пока — то, с чего обычно начинают: Benchy, калибровочный куб, подставка для телефона"
          action={
            <Button
              variant="secondary"
              icon={null}
              onClick={() => {
                const handle = overlay.modal({
                  title: "Привяжите принтер",
                  content: (
                    <PrinterPicker
                      persona={activation.activation?.primary_persona ?? null}
                      addPrinter={activation.addPrinter}
                      onLinked={() => handle.close()}
                      onSkip={() => handle.close()}
                    />
                  ),
                });
              }}
            >
              Привязать принтер
            </Button>
          }
        />
      </section>
    );
  }

  const compatible = (models ?? []).filter((model) => isCompatible(model, printer));
  const printerLabel = `${printer.brand} ${printer.model}`.trim();

  return (
    <section id="homeCompatModule">
      <Eyebrow>Совместимо с вашим {printerLabel}</Eyebrow>
      {models === null ? null : compatible.length === 0 ? (
        <EmptyState
          icon={<CompatGlyph />}
          title="Пока нет отмеченных моделей"
          sub="Загляните в каталог — новое добавляется каждый день"
          action={
            <Button variant="secondary" icon={null} onClick={() => navigate(marketPath())}>
              Открыть каталог
            </Button>
          }
        />
      ) : (
        <ModelTileGridWithAha models={compatible.slice(0, 8)} activation={activation} />
      )}
    </section>
  );
}

// «Ага»-момент гипотезы эпика: привязал принтер + открыл первую совместимую модель — фиксируем
// один раз за аккаунт (гейт home_dismissed_prompts, тот же bag, что и у coachmarks.ts).
function ModelTileGridWithAha({ models, activation }: { models: MarketModel[]; activation: ActivationState }) {
  function onFirstOpen() {
    if (activation.activation?.home_dismissed_prompts?.aha_reached) return;
    trackActivation("aha_reached");
    activation.patch({
      home_dismissed_prompts: { ...activation.activation?.home_dismissed_prompts, aha_reached: true },
    });
  }
  return <ModelTileGrid models={models} onOpen={onFirstOpen} />;
}

function SearchGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m20 20-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function GenerateGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
function InfoGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 11v6M12 7.5h.01" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
function CompatGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 8V4h10v4M5 8h14a1.5 1.5 0 0 1 1.5 1.5V16H17m-10 0H3.5V9.5A1.5 1.5 0 0 1 5 8Zm0 0v-.5M7 13h10v7H7v-7Z"
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      />
      <path d="m9.5 16.5 1.5 1.5 3-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function UploadGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 16V4m0 0 4 4m-4-4-4 4M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function StatsGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 19V10M12 19V5m7 14v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function FeedGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 5c8 0 14 6 14 14M5 5v14h14M5 12c4 0 7 3 7 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function FleetGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3" y="15" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13" y="15" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
function OrdersGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function FilamentGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
