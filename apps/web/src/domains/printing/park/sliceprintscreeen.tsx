import { useEffect, useState } from "react";
import type { SessionUser } from "@shared/types";
import { useActivation, type UserPrinter } from "@shared/lib";
import { HomeHeader, type Section } from "@platform/nav";
import { navigate, parkAddPath, parkPath, slicePrintPath } from "../../../router.ts";
import { Button, Card, EmptyState, Heading, PrinterIcon, StatusPill } from "@shared/ui";
import { fetchCommandResult, queuedCommandResult, rememberCommandResult, queueCommand, type CommandResultState, isTerminalCommandResult } from "./livecommands.ts";
import { CommandStatus } from "./commandstatus.tsx";

type Level = "LAN" | "Агент";
const params = () => new URLSearchParams(window.location.search);

function levelFor(printer: UserPrinter): Level {
  return printer.link_source === "ip" || printer.link_source === "managed-local" ? "LAN" : "Агент";
}

export function SlicePrintScreen({ user, section, onSectionChange, sliceId }: { user: SessionUser; section: Section; onSectionChange: (section: Section) => void; sliceId: string }) {
  const { loading, printers } = useActivation();
  const query = params();
  const [selected, setSelected] = useState<string | null>(() => query.get("printer_id"));
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [commandId, setCommandId] = useState<string | null>(() => query.get("command_id"));
  const [commandStatus, setCommandStatus] = useState<CommandResultState | null>(null);
  const filename = query.get("filename") || "готовый.gcode";
  const profile = query.get("profile") || "Профиль не указан";
  const fingerprint = query.get("config_fingerprint") || "";
  const compatible = printers.filter((printer) => printer.verified || printer.printer_id);
  const printer = compatible.find((item) => item.id === selected) ?? null;
  const printerId = printer?.id;

  async function refreshCommandResult() {
    if (!printerId || !commandId) return;
    const result = await fetchCommandResult(printerId, commandId);
    setCommandStatus(result);
    return result;
  }

  useEffect(() => {
    if (!printerId || !commandId) return;
    let cancelled = false;
    let retry: number | undefined;
    const poll = async () => {
      const result = await fetchCommandResult(printerId, commandId);
      if (cancelled) return;
      setCommandStatus(result);
      if (!isTerminalCommandResult(result) && result.kind !== "offline") retry = window.setTimeout(() => void poll(), 2_000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (retry !== undefined) window.clearTimeout(retry);
    };
  }, [commandId, printerId]);

  async function submit() {
    if (!printer || sending) return;
    setSending(true); setMessage(null);
    const result = await queueCommand(printer.id, "gcode", { slice_id: sliceId, filename, config_fingerprint: fingerprint, profile, config: query.get("config") || undefined });
    setSending(false);
    if (result.ok) {
      rememberCommandResult(printer.id, result.commandId);
      setCommandId(result.commandId);
      setCommandStatus(queuedCommandResult(printer.id, result.commandId, "gcode"));
      return;
    }
    setMessage(result.reason === "not_available" ? "Принтер сейчас недоступен" : "Не удалось отправить команду");
  }

  return <div className="home"><HomeHeader user={user} printers={printers} section={section} onSectionChange={onSectionChange} onBack={() => navigate(parkPath())} />
    <main className="homeContent"><Card style={{ maxWidth: 680, margin: "24px auto", padding: 24, display: "grid", gap: 16 }}>
      <div><StatusPill tone="ok">Слайс готов</StatusPill><Heading size="md">Отправить модель в печать</Heading></div>
      <div><strong>{filename}</strong><br />Профиль: {profile}<br />Результат: готовый G-code</div>
      {loading ? <div>Загружаем парк…</div> : compatible.length === 0 ? <EmptyState icon={<PrinterIcon />} title="Совместимых принтеров нет" sub="Добавьте принтер в парк, чтобы продолжить." action={<Button onClick={() => navigate(parkAddPath())}>Добавить принтер</Button>} /> : <>
        <div style={{ display: "grid", gap: 8 }}>{compatible.map((item) => <button key={item.id} type="button" onClick={() => setSelected(item.id)} aria-pressed={selected === item.id} style={{ textAlign: "left", padding: 14, border: selected === item.id ? "2px solid var(--accent, #7c5cff)" : "1px solid var(--line, #ccc)", borderRadius: 12, background: "transparent" }}><strong>{item.brand} {item.model}</strong><br /><small>{levelFor(item)}{levelFor(item) === "LAN" ? " — только в вашей сети" : " — через агент"}</small></button>)}</div>
        <Button disabled={!printer || sending} onClick={() => void submit()}>{sending ? "Отправляем…" : "Отправить в печать"}</Button>
        {commandStatus ? <CommandStatus command="Печать" status={commandStatus} canRetry={Boolean(printer)} onRetry={() => {
          if (commandStatus.kind === "offline") void refreshCommandResult();
          else void submit();
        }} /> : null}
        {message ? <div role="status">{message}</div> : null}
      </>}
      <button type="button" className="homeSkipLink pressable" onClick={() => navigate(slicePrintPath(sliceId, Object.fromEntries(query.entries())))}>Назад к готовому слайсу</button>
    </Card></main></div>;
}
