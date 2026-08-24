import { useState } from "react";
import { Button } from "@shared/ui";
import {
  createModerationFlag,
  MODERATION_REASONS,
  type ModerationApiError,
  type ModerationReasonCode,
  type ModerationTargetType,
} from "./moderation.ts";
import "./moderation.css";

function flagErrorMessage(error: unknown): string {
  const apiError = error as ModerationApiError;
  if (apiError.status === 401) return "Войдите, чтобы пожаловаться на материал.";
  if (apiError.code === "FLAG_ALREADY_EXISTS") return "Вы уже пожаловались на этот материал.";
  if (apiError.status === 429) return "Сейчас нельзя отправить ещё одну жалобу. Попробуйте позже.";
  return "Не удалось отправить жалобу. Материал не был скрыт с вашей стороны.";
}

export function FlagDialog({
  target,
  onClose,
  onHidden,
}: {
  target: { type: ModerationTargetType; id: string };
  onClose: () => void;
  onHidden: () => void;
}) {
  const [reason, setReason] = useState<ModerationReasonCode | "">("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const needsDetails = reason === "other";
  const canSubmit = reason !== "" && (!needsDetails || details.trim().length > 0) && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await createModerationFlag({ target, reason_code: reason as ModerationReasonCode, details: details.trim() || undefined });
      if (result.target.visibility === "hidden") {
        onHidden();
        setMessage("Жалоба отправлена. Материал временно скрыт на время проверки.");
      } else {
        setMessage("Жалоба отправлена. Мы рассмотрим её.");
      }
    } catch (error) {
      setMessage(flagErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="moderationDialogBackdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="moderationDialog" role="dialog" aria-modal="true" aria-labelledby="flag-title">
        <div className="moderationDialogHead">
          <h2 id="flag-title">Пожаловаться на материал</h2>
          <Button variant="ghost" icon={null} type="button" className="moderationClose pressable" aria-label="Закрыть" onClick={onClose}>×</Button>
        </div>
        <p className="moderationTargetType">Тип материала: {target.type === "post" ? "пост" : "тред"}</p>
        <p>Выберите причину. Жалоба попадёт в очередь модерации после подтверждения сервера.</p>
        <fieldset className="moderationReasonGroup" disabled={busy}>
          <legend>Причина жалобы</legend>
          {MODERATION_REASONS.map((item) => (
            <label key={item.code} className="moderationRadio">
              <input type="radio" name="flag-reason" value={item.code} checked={reason === item.code} onChange={() => setReason(item.code)} />
              <span>{item.label}</span>
            </label>
          ))}
        </fieldset>
        <label className="moderationLabel" htmlFor="flag-details">Поясните, что произошло{needsDetails ? " (обязательно)" : " (необязательно)"}</label>
        <textarea id="flag-details" className="uiInput moderationTextarea" value={details} onChange={(event) => setDetails(event.target.value)} disabled={busy} />
        {message ? <div className="moderationFlagMessage" role={message.startsWith("Не удалось") || message.startsWith("Войдите") ? "alert" : undefined} aria-live="polite">{message}</div> : null}
        <div className="moderationDialogActions">
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
          <Button variant="ghost" icon={null} loading={busy} disabled={!canSubmit} onClick={() => void submit()}>Отправить жалобу</Button>
        </div>
      </section>
    </div>
  );
}
