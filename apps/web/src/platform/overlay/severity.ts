/*
  Ядро системы всплывашек (эпик MF-440, docs/epics/overlay.system.md §2): единая ось
  Severity, по которой решается цвет/пульс/звук/роль a11y/приоритет очереди —
  общий контракт MF-441/442/443, не трогать без правки спеки.
*/

export type Severity = "info" | "success" | "warn" | "critical";

export interface SeverityConfig {
  /** CSS-переменная токена цвета (theme/tokens.css) */
  colorVar: string;
  /** Пульс — только для «требует внимания» (docs/design/status-alerts.md) */
  pulse: boolean;
  /** Звук по умолчанию (заводится в MF-443, здесь — только контракт) */
  sound: "success" | "warn" | "critical" | null;
  /** Роль для скринридера */
  role: "status" | "alert";
  /** Приоритет очереди: выше — раньше показывается/не вытесняется */
  priority: number;
}

export const SEVERITY_CONFIG: Record<Severity, SeverityConfig> = {
  info: { colorVar: "--text-dim", pulse: false, sound: null, role: "status", priority: 0 },
  success: { colorVar: "--accent", pulse: false, sound: "success", role: "status", priority: 1 },
  warn: { colorVar: "--accent-warn", pulse: false, sound: "warn", role: "status", priority: 2 },
  critical: { colorVar: "--accent-danger", pulse: true, sound: "critical", role: "alert", priority: 3 },
};

export function severityConfig(severity: Severity): SeverityConfig {
  return SEVERITY_CONFIG[severity];
}
