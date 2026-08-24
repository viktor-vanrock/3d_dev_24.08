import type { KeyboardEvent } from "react";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 8): printing→access useGuestLogin, развязка отложена до pages/DI. См. MIGRATION.md.
import { useGuestLogin } from "@domains/access";
import type { SessionUser } from "@shared/types";
import { navigate, printerPath } from "../../../router.ts";
import { useInteractionSound } from "@platform/sound";
import { Chip, StatusPill } from "@shared/ui";
import { RELEASE_STATUS_LABEL, RELEASE_STATUS_LEVEL, RELEASE_STATUS_TONE } from "./labels.ts";
import "./printers.css";
import type { PrinterRelease } from "./releasefixtures.ts";
import { useReleaseSubs } from "./releasesubs.ts";

// `PrinterReleaseCard` — новый переиспользуемый примитив (docs/design/printers.md §1): одна
// карточка = одно событие каталога, не пресс-релиз (без баннеров/цены «от»/кнопки «купить»). Тот
// же каркас в двух композициях — рельс `/feed` (`compact`, §1 п.1) и лента `/printers/releases`
// (`full`, §1 п.2) — не два похожих компонента.

export interface PrinterReleaseCardProps {
  release: PrinterRelease;
  composition: "compact" | "full";
  user: SessionUser | null;
  index?: number;
}

export function PrinterReleaseCard({ release, composition, user, index = 0 }: PrinterReleaseCardProps) {
  const sound = useInteractionSound();
  const promptGuestLogin = useGuestLogin();
  const subs = useReleaseSubs();
  const subscribed = subs.isSubscribed(release.vendor);
  const hasLink = release.machineId !== null;

  function openLink() {
    if (release.machineId) navigate(printerPath(release.machineId));
  }

  function notify() {
    if (!user) {
      promptGuestLogin();
      return;
    }
    if (subscribed) return;
    sound.success();
    subs.subscribe(release.vendor);
  }

  // ТВ/пульт (printers.md §«ТВ / пульт») — одна D-pad-цель на карточку: `ОК` уводит по ссылке,
  // если она есть, иначе активирует Chip подписки напрямую — второй фокус-стоп внутри строки не
  // заводим (нет второго смыслового действия, если ссылки нет).
  function onRowKeyDown(event: KeyboardEvent) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (hasLink) openLink();
    else notify();
  }

  const dateLabel = formatReleaseDate(release.date);

  return (
    <div
      className="prnReleaseCard pressable"
      data-composition={composition}
      data-linked={hasLink || undefined}
      style={{ ["--i" as string]: index }}
      role={hasLink ? "link" : "group"}
      tabIndex={0}
      onPointerDown={sound.tick}
      onClick={hasLink ? openLink : undefined}
      onKeyDown={onRowKeyDown}
    >
      <div className="prnReleaseMeta">
        <span className="prnReleaseDate">{dateLabel}</span>
        <StatusPill tone={RELEASE_STATUS_TONE[release.status]} level={RELEASE_STATUS_LEVEL[release.status]}>
          {RELEASE_STATUS_LABEL[release.status]}
        </StatusPill>
      </div>

      {hasLink ? (
        <div className="prnReleaseTitle">
          {release.vendor} {release.model}
        </div>
      ) : (
        <div className="prnReleaseTitle" data-muted="true">
          {release.vendor} {release.model}
          <span className="prnReleaseNoCard">пока без карточки</span>
        </div>
      )}

      {/* Свой тап-зона внутри строки, не дублирует тап по карточке (§4, тот же приём, что
          `+`-кнопка сравнения у `PrinterTile`) — стоп propagation, чтобы клик по Chip не уводил
          по ссылке карточки. */}
      <div className="prnReleaseAction" onClick={(event) => event.stopPropagation()}>
        <Chip selected={subscribed} onClick={notify}>
          {subscribed ? "Уведомления включены" : "Уведомить о выходе"}
        </Chip>
      </div>
    </div>
  );
}

// Дата — приглушённый моноширинный столбец, «день · месяц сокращённо» (§1), тот же ритм, что
// временные метки ленты (feed.md §2).
function formatReleaseDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
}
