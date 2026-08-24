import { useEffect, useState } from "react";
import {
  approveMaterialCandidate,
  getMaterial,
  listMaterialCandidates,
  rejectMaterialCandidate,
} from "@domains/commerce";
import type { components } from "src/api/generated/openapi";
import { useOverlay } from "@platform/overlay";
import { AuroraBackground, Button, EmptyState, Eyebrow, Heading, StatusPill, type StatusTone } from "@shared/ui";
import "./materialcandidates.css";

// Апрув-UI staging-очереди филамента (MF-848, эпик MF-31/Ф3) — потребляет
// `GET/POST /material-candidates*` (MF-846). Внутренний инструмент за session-гейтом
// (`/internal/material-candidates`), тот же приём, что `/internal/catalog-metrics`
// (pages/catalogmetrics.tsx): вне табов IA, без BottomTabBar, доступ по прямой ссылке —
// отдельной роли куратора каталога филамента в проекте ещё нет (см. комментарий в
// apps/api/src/catalog/material-candidates.ts), гейт — просто активная сессия.
//
// Diff против каталога (§ карточки «если matched_material_id уже проставлен») — резолвер для
// филамента ещё не написан (MF-846 § «не твоя зона»), matched_material_id почти всегда null на
// этой фазе. Когда он есть, показываем текущую запись каталога рядом с raw — куратор решает на
// глаз (тот же принцип, что у raw-снапшота, см. комментарий approve-ручки на бэкенде), без
// вычисленного per-field diff.

type MaterialCandidateRow = components["schemas"]["CandidateDto"];
type MaterialDetailValue = components["schemas"]["CatalogMaterialDetailValueDto"];

type QueueState =
  | { status: "loading" }
  | { status: "ready"; items: readonly MaterialCandidateRow[] }
  | { status: "error" };

function confidenceTone(confidence: number | null): StatusTone {
  if (confidence === null) return "dim";
  if (confidence >= 0.8) return "ok";
  if (confidence >= 0.5) return "warn";
  return "danger";
}

export function MaterialCandidatesPage() {
  const overlay = useOverlay();
  const [queue, setQueue] = useState<QueueState>({ status: "loading" });
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setQueue({ status: "loading" });
    void listMaterialCandidates("pending").then((result) => {
      if (cancelled) return;
      setQueue(result.kind === "ok" ? { status: "ready", items: result.candidates } : { status: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function removeCandidate(id: string): void {
    setQueue((prev) => (prev.status === "ready" ? { status: "ready", items: prev.items.filter((c) => c.id !== id) } : prev));
  }

  function setBusy(id: string, busy: boolean): void {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleApprove(candidate: MaterialCandidateRow): Promise<void> {
    setBusy(candidate.id, true);
    const result = await approveMaterialCandidate(candidate.id);
    setBusy(candidate.id, false);
    if (result.kind === "ok") {
      overlay.toast({ severity: "success", title: "Апрувнуто", message: "Кандидат смёржен в каталог." });
      removeCandidate(candidate.id);
      return;
    }
    if (result.kind === "not_pending") {
      overlay.toast({ severity: "info", title: "Уже обработано", message: `Статус: ${result.status}` });
      removeCandidate(candidate.id);
      return;
    }
    if (result.kind === "unmergeable_raw") {
      overlay.toast({ severity: "critical", title: "Не удалось смёржить", message: `Источник «${candidate.source}» не поддержан парсером.` });
      return;
    }
    overlay.toast({ severity: "critical", title: "Ошибка", message: "Не удалось апрувнуть кандидата. Попробуйте ещё раз." });
  }

  async function handleReject(candidate: MaterialCandidateRow): Promise<void> {
    const confirmed = await overlay.confirm({
      severity: "critical",
      title: "Отклонить кандидата?",
      message: "Запись останется в staging помеченной как отклонённая, в каталог не попадёт.",
      confirmLabel: "Отклонить кандидата",
      cancelLabel: "Отмена",
      destructive: true,
    });
    if (!confirmed) return;

    setBusy(candidate.id, true);
    const result = await rejectMaterialCandidate(candidate.id);
    setBusy(candidate.id, false);
    if (result.kind === "ok") {
      overlay.toast({ severity: "info", title: "Отклонено" });
      removeCandidate(candidate.id);
      return;
    }
    if (result.kind === "not_pending") {
      overlay.toast({ severity: "info", title: "Уже обработано", message: `Статус: ${result.status}` });
      removeCandidate(candidate.id);
      return;
    }
    overlay.toast({ severity: "critical", title: "Ошибка", message: "Не удалось отклонить кандидата. Попробуйте ещё раз." });
  }

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 900, margin: "0 auto", padding: "24px 16px 80px" }}>
        <Eyebrow>Апрув филамента</Eyebrow>
        <Heading size="md">Кандидаты на ревью</Heading>

        {queue.status === "loading" ? (
          <div style={{ color: "var(--text-dim)", marginTop: 24 }}>Загрузка…</div>
        ) : queue.status === "error" ? (
          <div style={{ color: "var(--text-dim)", marginTop: 24 }}>Не удалось загрузить очередь. Обновите страницу.</div>
        ) : queue.items.length === 0 ? (
          <div style={{ marginTop: 24 }}>
            <EmptyState icon={<QueueIcon />} title="Очередь пуста" sub="Новые кандидаты появятся после прогона парсер-агента." />
          </div>
        ) : (
          <div className="mtcList">
            {queue.items.map((candidate) => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                busy={busyIds.has(candidate.id)}
                onApprove={() => void handleApprove(candidate)}
                onReject={() => void handleReject(candidate)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CandidateRow({
  candidate,
  busy,
  onApprove,
  onReject,
}: {
  candidate: MaterialCandidateRow;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [matched, setMatched] = useState<MaterialDetailValue | null | undefined>(
    candidate.matched_material_id ? undefined : null,
  );

  useEffect(() => {
    if (!candidate.matched_material_id) return;
    let cancelled = false;
    void getMaterial(candidate.matched_material_id).then((material) => {
      if (!cancelled) setMatched(material);
    });
    return () => {
      cancelled = true;
    };
  }, [candidate.matched_material_id]);

  return (
    <div className="mtcRow">
      <div className="mtcRowHead">
        <div>
          <div className="mtcSource">{candidate.source}</div>
          <div className="mtcMeta">
            {candidate.external_ref} · {new Date(candidate.created_at).toLocaleDateString("ru-RU")}
          </div>
        </div>
        <StatusPill tone={confidenceTone(candidate.confidence)}>
          {candidate.confidence === null ? "уверенность —" : `уверенность ${Math.round(candidate.confidence * 100)}%`}
        </StatusPill>
      </div>

      <pre className="mtcRaw">{JSON.stringify(candidate.raw, null, 2)}</pre>

      {candidate.matched_material_id ? (
        <div className="mtcMatch">
          <div className="mtcMatchLabel">Текущая запись в каталоге</div>
          {matched === undefined ? (
            <div className="mtcMeta">Загрузка…</div>
          ) : matched === null ? (
            <div className="mtcMeta">Не найдена (возможно, удалена).</div>
          ) : (
            <div className="mtcMeta">
              {matched.vendor.name} · {matched.material_type.name} · {matched.name} ·{" "}
              {matched.variants.map((v: components["schemas"]["CatalogVariantDto"]) => v.color_name).join(", ") || "без вариантов"}
            </div>
          )}
        </div>
      ) : null}

      <div className="mtcActions">
        <Button variant="secondary" onClick={onReject} disabled={busy}>
          Отклонить
        </Button>
        <Button variant="primary" onClick={onApprove} disabled={busy}>
          Апрув
        </Button>
      </div>
    </div>
  );
}

function QueueIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}