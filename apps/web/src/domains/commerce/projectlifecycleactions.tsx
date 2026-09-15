import { useState } from "react";
import { Button } from "@shared/ui";
import type { ProjectAction, ProjectStatus } from "./project-lifecycle.ts";
import { getActionLabel, STATUS_META } from "./project-lifecycle.ts";
import "./projectlifecycle.css";

export function ProjectLifecycleActions({ status, onAction, disabled = false }: {
  readonly status: ProjectStatus;
  readonly onAction: (action: ProjectAction) => Promise<void>;
  readonly disabled?: boolean;
}) {
  const [loading, setLoading] = useState<ProjectAction | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const { allowedActions, hint } = STATUS_META[status];

  if (allowedActions.length === 0) return <p className="projectLifecycleHint">{hint}</p>;

  const run = async (action: ProjectAction) => {
    if (action === "publish") {
      setShowConfirm(true);
      return;
    }
    setLoading(action);
    try {
      await onAction(action);
    } finally {
      setLoading(null);
    }
  };

  const confirmPublish = async () => {
    setShowConfirm(false);
    setLoading("publish");
    try {
      await onAction("publish");
    } finally {
      setLoading(null);
    }
  };

  return (
    <>
      <div className="projectLifecycleActions">
        {allowedActions.map((action) => (
          <Button key={action} variant={action === "publish" ? "primary" : action === "archive" ? "danger" : "secondary"} loading={loading === action} disabled={disabled || loading !== null} onClick={() => void run(action)}>
            {getActionLabel(action)}
          </Button>
        ))}
      </div>
      {showConfirm ? <PublishConfirmDialog onConfirm={() => void confirmPublish()} onCancel={() => setShowConfirm(false)} /> : null}
    </>
  );
}

function PublishConfirmDialog({ onConfirm, onCancel }: { readonly onConfirm: () => void; readonly onCancel: () => void }) {
  return (
    <div className="projectLifecycleBackdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="projectLifecycleDialog" role="dialog" aria-modal="true" aria-labelledby="projectPublishTitle">
        <h2 id="projectPublishTitle">Опубликовать проект?</h2>
        <ul>
          <li>Проект появится в каталоге и поиске.</li>
          <li>Вы сможете снять его с публикации в любой момент.</li>
          <li>История публикации сохранится.</li>
        </ul>
        <div className="projectLifecycleActions">
          <Button variant="secondary" onClick={onCancel}>Отмена</Button>
          <Button variant="primary" autoFocus onClick={onConfirm}>Да, опубликовать</Button>
        </div>
      </section>
    </div>
  );
}
