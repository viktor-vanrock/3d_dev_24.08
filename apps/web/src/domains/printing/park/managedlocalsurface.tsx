import { useState } from "react";
import { Button, Card, Heading, StatusPill, type StatusTone } from "@shared/ui";

export type ManagedLocalSurfaceState =
  | "ready-detail"
  | "lan-only"
  | "direct-error"
  | "helper-unavailable"
  | "permission-unknown"
  | "unknown"
  | "not-configured";

type SurfacePresentation = {
  heading: string;
  source: string;
  // Только `helper-unavailable` (MF-1842): подпись источника отдельно от LAN-границы, см.
  // suppressLanBadge ниже — здесь ничего не известно ни о принтере, ни о LAN.
  sourceCaption?: string;
  reason: string;
  tone: StatusTone;
  fact?: string;
  // «Только в вашей сети» и «Сервер не видит LAN-IP» доказывают LAN-границу; `helper-unavailable`
  // происходит ДО любого LAN-запроса, поэтому эти строки здесь не показываются (printer.surface-
  // states.md §5а: не путать с LAN-границей `LAN-only`).
  suppressLanBadge?: boolean;
  action?: "probe" | "setup" | "install-helper";
  actionLabel?: string;
  announcementRole: "status" | "alert";
};

const PRESENTATION: Record<ManagedLocalSurfaceState, SurfacePresentation> = {
  "ready-detail": {
    heading: "Только просмотр",
    source: "Источник: локальный запрос",
    reason: "Готов означает только успешный локальный запрос.",
    fact: "Готов",
    tone: "ok",
    announcementRole: "status",
  },
  "lan-only": {
    heading: "Только в вашей сети",
    source: "Источник: локальное подключение",
    reason: "Браузер подключается к принтеру напрямую.",
    tone: "dim",
    action: "probe",
    actionLabel: "Проверить связь",
    announcementRole: "status",
  },
  "direct-error": {
    heading: "Не удалось проверить локальный принтер",
    source: "Источник: ошибка локального запроса",
    reason: "Ошибка прямого запроса из браузера.",
    tone: "warn",
    action: "probe",
    actionLabel: "Повторить проверку",
    announcementRole: "alert",
  },
  "helper-unavailable": {
    heading: "Локальный helper не обнаружен",
    source: "Источник: локальный helper",
    sourceCaption: "Проверка ограничена этим устройством",
    reason: "Портал не смог подключиться к локальному helper на этом устройстве. Обычно это значит, что helper не установлен или не запущен; сама проверка принтера в LAN ещё не выполнялась.",
    tone: "dim",
    suppressLanBadge: true,
    action: "install-helper",
    actionLabel: "Установить локальный helper",
    announcementRole: "status",
  },
  "permission-unknown": {
    heading: "Права доступа не подтверждены",
    source: "Источник: права не подтверждены",
    reason: "Текущее состояние принтера не подтверждено.",
    tone: "warn",
    announcementRole: "status",
  },
  unknown: {
    heading: "Состояние неизвестно",
    source: "Источник состояния не подтверждён",
    reason: "Источник состояния не подтверждён.",
    tone: "dim",
    announcementRole: "status",
  },
  "not-configured": {
    heading: "Состояние неизвестно",
    source: "Источник: локальное подключение",
    reason: "Локальное подключение не настроено.",
    tone: "dim",
    action: "setup",
    actionLabel: "Настроить локальное подключение",
    announcementRole: "status",
  },
};

export function ManagedLocalSurface({
  state,
  printerName,
  setupHref,
  onProbe,
}: {
  state: ManagedLocalSurfaceState;
  printerName: string;
  setupHref: string;
  onProbe: () => void;
}) {
  const presentation = PRESENTATION[state];
  const reasonId = `managed-local-reason-${state}`;
  const [helperHintOpen, setHelperHintOpen] = useState(false);

  return (
    <section className="managedLocalSurface" aria-labelledby="managed-local-heading">
      <p className="managedLocalPrinterName">{printerName}</p>
      <Heading size="md"><span id="managed-local-heading">{presentation.heading}</span></Heading>

      <Card className="managedLocalCard">
        <div
          className="managedLocalAnnouncement"
          role={presentation.announcementRole}
          aria-live={presentation.announcementRole === "alert" ? "assertive" : "polite"}
          aria-atomic="true"
          tabIndex={-1}
        >
          {presentation.fact ? <StatusPill tone={presentation.tone}>{presentation.fact}</StatusPill> : null}
          {!presentation.suppressLanBadge ? <StatusPill tone="dim">Только в вашей сети</StatusPill> : null}
          <p className="managedLocalSource">{presentation.source}</p>
          {presentation.sourceCaption ? <p className="managedLocalSourceCaption">{presentation.sourceCaption}</p> : null}
          <p id={reasonId} className="managedLocalReason">{presentation.reason}</p>
          {!presentation.suppressLanBadge ? <p className="managedLocalBoundary">Сервер не видит LAN-IP принтера.</p> : null}
        </div>

        {presentation.action === "probe" ? (
          <Button variant="primary" onClick={onProbe} aria-describedby={reasonId}>
            {presentation.actionLabel}
          </Button>
        ) : presentation.action === "setup" ? (
          <Button variant="primary" href={setupHref} aria-describedby={reasonId}>
            {presentation.actionLabel}
          </Button>
        ) : presentation.action === "install-helper" ? (
          <>
            <Button
              variant="primary"
              onClick={() => setHelperHintOpen(true)}
              aria-describedby={reasonId}
              aria-expanded={helperHintOpen}
            >
              {presentation.actionLabel}
            </Button>
            {helperHintOpen ? (
              <p className="managedLocalHint" role="status">
                Инструкция по установке и запуску помогает подготовить устройство; переход сюда не
                устанавливает helper автоматически и не проверяет принтер сам по себе.
              </p>
            ) : null}
          </>
        ) : null}
      </Card>
    </section>
  );
}
