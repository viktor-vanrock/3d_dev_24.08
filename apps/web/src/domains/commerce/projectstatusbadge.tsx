import type { ProjectStatus } from "./project-lifecycle.ts";
import { STATUS_META } from "./project-lifecycle.ts";
import "./projectlifecycle.css";

export function ProjectStatusBadge({ status, showHint = false }: { readonly status: ProjectStatus; readonly showHint?: boolean }) {
  const { label, hint, color } = STATUS_META[status];
  return (
    <span className="projectLifecycleStatus" data-color={color}>
      <span className="projectLifecycleStatusBadge">{label}</span>
      {showHint ? <span className="projectLifecycleStatusHint">{hint}</span> : null}
    </span>
  );
}
