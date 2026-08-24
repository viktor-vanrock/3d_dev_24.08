import { Button } from "@shared/ui";
import { problemInfo, type PrinterProblem, severityFromPrinter } from "@platform/overlay";

function AlertGlyph() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 8.5v5M12 16.8v.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

// Сцена (d) — ошибка/алерт (printer.face.md §2.3.d): полноэкранный баннер поверх текущей
// сцены, ровно словарь severity/причин портала (reasons.ts/severity-from-printer.ts) — тот же
// цвет/формулировка на морде и в веб-портале (§3 «готово когда»).
export function AlertScene({
  problem,
  since,
  onPause,
  onStop,
  onDetails,
}: {
  problem: PrinterProblem;
  since: number;
  onPause: () => void;
  onStop: () => void;
  onDetails: () => void;
}) {
  const info = problemInfo(problem);
  const severity = severityFromPrinter(problem, Date.now() - since);

  return (
    <div className="faceAlertScene modal-in-out" data-visible="true" data-severity={severity} role="alert">
      <div className="faceAlertGlyph">
        <AlertGlyph />
      </div>
      <div className="faceAlertWhat">{info.what}</div>
      <div className="faceAlertWhy">{info.why}</div>
      <div className="faceAlertActions">
        <Button variant="secondary" icon={null} onClick={onPause}>
          Пауза
        </Button>
        <Button variant="danger" icon={null} onClick={onStop}>
          Стоп
        </Button>
        <Button variant="secondary" icon={null} onClick={onDetails}>
          Разобраться
        </Button>
      </div>
    </div>
  );
}
