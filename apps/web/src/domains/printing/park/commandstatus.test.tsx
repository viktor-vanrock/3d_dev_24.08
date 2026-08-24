import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OverlayProvider } from "@platform/overlay";
import { CommandStatus, type CommandStatusState } from "./commandstatus.tsx";

afterEach(() => cleanup());

describe("CommandStatus — подтверждённый результат команды", () => {
  it.each([
    ["queued", "В очереди", "Команда принята порталом, но исполнение ещё не подтверждено."],
    ["leased", "Доставляется", "Relay получил команду и готовит доставку устройству."],
    ["delivered", "Доставлена", "Команда отправлена устройству. Получение ещё не подтверждено."],
    ["acknowledged", "Принята агентом", "Агент подтвердил получение команды. Выполнение ещё не подтверждено."],
    ["executed", "Выполнено", "Принтер подтвердил результат команды."],
    ["failed", "Не выполнена", "Драйвер принтера недоступен."],
    ["expired", "Истекла", "Срок доставки команды истёк."],
    ["offline", "Статус недоступен", "Не удалось получить итог команды. Повторите проверку."],
  ] as const)("показывает %s без подмены результатом очереди", (kind, label, message) => {
    render(
      <OverlayProvider>
        <CommandStatus
          command="Пауза"
          status={{
            kind,
            commandId: "command-1",
            correlationId: "correlation-1",
            message: kind === "failed" ? "Драйвер принтера недоступен." : kind === "expired" ? "Срок доставки команды истёк." : null,
          } as unknown as CommandStatusState}
        />
      </OverlayProvider>,
    );

    expect(screen.getByRole("status").textContent).toContain(label);
    expect(screen.getByRole("status").textContent).toContain(message);
    expect(screen.getByRole("link", { name: "Открыть результат команды" }).getAttribute("href")).toContain("command_id=command-1");
  });
});
