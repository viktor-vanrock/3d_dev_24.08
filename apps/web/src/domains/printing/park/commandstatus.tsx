import { Button, StatusPill } from "@shared/ui";
import { useInteractionSound } from "@platform/sound";
import { commandResultHref, type CommandFailureReason, type CommandResultState } from "./livecommands.ts";

export type CommandStatusState = CommandResultState | { kind: "read-only" } | { kind: "queue-failed"; reason: CommandFailureReason };

export function CommandStatus({
  command,
  status,
  canRetry = false,
  onRetry,
}: {
  command: string;
  status: CommandStatusState | null;
  canRetry?: boolean;
  onRetry?: () => void;
}) {
  const sound = useInteractionSound();
  if (!status) return null;

  if (status.kind === "read-only" || status.kind === "queue-failed") {
    const queueFailureCopy: Record<CommandFailureReason, string> = {
      not_available: "Этот принтер больше не доступен для команды.",
      rejected: "Портал отклонил команду. Проверьте доступ и подтверждённые возможности принтера.",
      server_error: "Портал временно не смог поставить команду в очередь.",
      network: "Нет связи с порталом: команда не поставлена в очередь.",
    };
    return (
      <div className="commandStatus" role="status" aria-live="polite" aria-atomic="true">
        <StatusPill tone={status.kind === "read-only" ? "dim" : "danger"}>{status.kind === "read-only" ? "Управление не подтверждено" : "Не поставлена"}</StatusPill>
        <span>{command}: {status.kind === "read-only" ? "Команда доступна только после подтверждения capability этого принтера." : queueFailureCopy[status.reason]}</span>
      </div>
    );
  }

  const presentation = {
    queued: { tone: "warn" as const, label: "В очереди", message: "Команда принята порталом, но исполнение ещё не подтверждено." },
    leased: { tone: "warn" as const, label: "Доставляется", message: "Relay получил команду и готовит доставку устройству." },
    delivered: { tone: "warn" as const, label: "Доставлена", message: "Команда отправлена устройству. Получение ещё не подтверждено." },
    acknowledged: { tone: "warn" as const, label: "Принята агентом", message: "Агент подтвердил получение команды. Выполнение ещё не подтверждено." },
    executed: { tone: "ok" as const, label: "Выполнено", message: "Принтер подтвердил результат команды." },
    failed: { tone: "danger" as const, label: "Не выполнена", message: status.message ?? "Команда не выполнена." },
    expired: { tone: "danger" as const, label: "Истекла", message: status.message ?? "Срок доставки команды истёк." },
    offline: { tone: "dim" as const, label: "Статус недоступен", message: "Не удалось получить итог команды. Повторите проверку." },
  }[status.kind];
  const shouldOfferRecovery = status.kind === "offline" || ((status.kind === "failed" || status.kind === "expired") && canRetry);

  return (
    <div className="commandStatus" role="status" aria-live="polite" aria-atomic="true">
      <StatusPill tone={presentation.tone}>{presentation.label}</StatusPill>
      <span>{command}: {presentation.message}</span>
      {status.correlationId ? <span>Связка: {status.correlationId}</span> : null}
      <a className="homeSkipLink pressable" href={commandResultHref(status.printerId, status.commandId)}>Открыть результат команды</a>
      {shouldOfferRecovery && onRetry ? (
        <Button className="commandStatusRetry" variant="ghost" icon={null} onPointerDown={sound.confirm} onClick={onRetry}>
          {status.kind === "offline" ? "Проверить статус" : `Повторить ${command.toLowerCase()}`}
        </Button>
      ) : null}
    </div>
  );
}
