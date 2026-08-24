import type { CommandResult, DriverCapabilities, PrinterDriver } from "../driver/printerDriver.ts";
import { verifyCommandToken, type CommandTokenVerifier } from "./commandToken.ts";
import type { CommandFrame, CommandTerminalFrame } from "./protocol.ts";
import type { AgentHealthStatus } from "../recovery.ts";
import { InMemoryCommandTerminalLedger, type CommandTerminalLedger, type CommandTerminalResult } from "./commandTerminalLedger.ts";

// Исполняет подписанные команды pause/resume/cancel (MF-844, эпик MF-26 Ф2 §«команды портал→
// relay→агент») и start (MF-1975, очередь печати Snapmaker U1 — «Moonraker upload и start, две
// отдельные команды»: upload уже случился раньше через file-ingress/kind=gcode, start печатает
// уже лежащий на диске принтера файл). Живёт на стороне агента (Bridge — «Агент-на-устройстве»,
// CLAUDE.md), driver.* уже реализован и покрыт тестами против эмулированного Moonraker (MF-391
// шаг 1) — этот модуль только: проверяет подпись/срок/адресата токена, сверяет роль с белым
// списком, сверяет команду с DriverCapabilities.supportedCommands ЭТОЙ прошивки/конфига, дедупит
// повторное исполнение (idempotency) и отбивает replay старого/уже виденного seq (anti-replay),
// затем реально зовёт driver.pause()/resume()/cancel()/startPrint(fileName) и формирует
// terminal command_result; transport command_ack отправляет RelayClient до исполнения.
//
// Роли, которым разрешено слать команды — owner/operator (device_shares.role, api уже
// фильтрует на выпуске токена; здесь ВТОРОЙ независимый слой — не доверяем токену слепо, та же
// defense-in-depth, что и у relay OwnsDevice: агент — недоверенная среда, но сам он тоже не
// должен доверять единственной проверке выше по цепочке).
const ALLOWED_ROLES = new Set(["owner", "operator"]);
type CommandFailureCode = Extract<CommandTerminalResult, { outcome: "failed" }>["error_code"];

// "start" маппится тоже (симметрия таблицы), но вызывается ОТДЕЛЬНОЙ веткой в handle() ниже —
// startPrint(fileName), в отличие от pause/resume/cancel, требует аргумент, под общий
// `method.call(this.driver)` без параметров не подходит.
const COMMAND_TO_DRIVER: Record<CommandFrame["command"], keyof PrinterDriver> = {
  pause: "pause",
  resume: "resume",
  cancel: "cancel",
  start: "startPrint",
};

export class CommandHandler {
  private accepting = true;
  private readonly inFlight = new Map<
    string,
    {
      deviceId: string;
      sequence: number;
      result: Promise<CommandTerminalFrame>;
    }
  >();

  constructor(
    private readonly driver: PrinterDriver,
    private readonly deviceId: string,
    private readonly health: () => AgentHealthStatus = () => "healthy",
    private readonly log: (message: string, ...args: unknown[]) => void = console.warn,
    private readonly ledger: CommandTerminalLedger = new InMemoryCommandTerminalLedger(),
    private readonly tokenVerifier: CommandTokenVerifier = verifyCommandToken,
    private readonly gatewayId: string = deviceId,
  ) {}

  handle(frame: CommandFrame): Promise<CommandTerminalFrame> {
    if (!this.accepting) return Promise.resolve(this.error(frame, "device_unavailable"));
    const cached = this.ledger.lookup(frame.device_id, frame.command_id, frame.command_seq);
    if (cached.status === "match") return Promise.resolve(cached.result);
    if (cached.status === "conflict") return Promise.resolve(this.error(frame, "replay_rejected"));

    const active = this.inFlight.get(frame.command_id);
    if (active) {
      if (active.deviceId === frame.device_id && active.sequence === frame.command_seq) return active.result;
      return Promise.resolve(this.error(frame, "replay_rejected"));
    }

    const result = this.execute(frame).finally(() => this.inFlight.delete(frame.command_id));
    this.inFlight.set(frame.command_id, {
      deviceId: frame.device_id,
      sequence: frame.command_seq,
      result,
    });
    return result;
  }

  async shutdown(deadlineMs: number): Promise<boolean> {
    this.accepting = false;
    const deadline = Date.now() + Math.max(0, deadlineMs);
    while (this.inFlight.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return this.inFlight.size === 0;
  }

  private async execute(frame: CommandFrame): Promise<CommandTerminalFrame> {
    if (frame.device_id !== this.deviceId) {
      return this.error(frame, "device_not_authorized");
    }
    if (this.health() !== "healthy") return this.error(frame, "device_unavailable");

    const lastSeq = this.ledger.lastSequence(frame.device_id) ?? -1;
    if (frame.command_seq <= lastSeq) {
      // Anti-replay: seq строго монотонный на устройство. Ниже/равно уже виденному — либо
      // повтор с ДРУГИМ commandId (настоящий replay атакующего/протухший ретрай), либо баг
      // отправителя — в обоих случаях НЕ исполняем и не кэшируем под новым commandId (не
      // легитимизируем replay идемпотентностью).
      return this.error(frame, "replay_rejected");
    }

    const verified = await this.tokenVerifier(frame.command_token, frame.device_id, frame.command, frame.command_id, this.gatewayId);
    if (!verified) {
      return this.error(frame, "invalid_command_token");
    }
    if (!ALLOWED_ROLES.has(verified.role)) {
      return this.error(frame, "role_not_allowed");
    }
    if (this.health() !== "healthy") return this.error(frame, "device_unavailable");

    // Persist the accepted sequence before touching the printer. If the process dies after the
    // hardware call but before recording its result, a restarted agent fails closed instead of
    // executing the same sequence a second time.
    this.ledger.acceptSequence(frame.device_id, frame.command_seq);

    let capabilities: DriverCapabilities;
    try {
      capabilities = await this.driver.capabilities();
    } catch (err) {
      this.log("device-agent: capabilities() failed при обработке команды", err);
      return this.remember(frame, this.error(frame, "device_unavailable"));
    }
    if (!capabilities.supportedCommands.includes(frame.command)) {
      return this.remember(frame, this.error(frame, "command_not_supported"));
    }
    let result: CommandResult;
    try {
      if (frame.command === "start") {
        result = await this.driver.startPrint(frame.payload.file_name);
      } else {
        const method = this.driver[COMMAND_TO_DRIVER[frame.command]] as () => Promise<CommandResult>;
        result = await method.call(this.driver);
      }
    } catch (err) {
      this.log("device-agent: команда упала", frame.command, err);
      return this.remember(frame, this.error(frame, "command_failed", err instanceof Error ? err.message : String(err)));
    }

    if (!result.ok) {
      return this.remember(frame, this.error(frame, "command_failed", result.error));
    }
    return this.remember(frame, {
      type: "command_result",
      device_id: frame.device_id,
      command_id: frame.command_id,
      command_seq: frame.command_seq,
      outcome: "executed",
    });
  }

  private error(frame: CommandFrame, code: CommandFailureCode, message?: string): CommandTerminalResult {
    return {
      type: "command_result",
      device_id: frame.device_id,
      command_id: frame.command_id,
      command_seq: frame.command_seq,
      outcome: "failed",
      error_code: code,
      ...(message === undefined ? {} : { message: message.slice(0, 256) }),
    };
  }

  private remember(frame: CommandFrame, result: CommandTerminalResult): CommandTerminalResult {
    this.ledger.record({
      deviceId: frame.device_id,
      commandId: frame.command_id,
      sequence: frame.command_seq,
      result,
    });
    return result;
  }
}
