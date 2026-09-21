import { useEffect, useState } from "react";
import type { SessionUser } from "@shared/types";
import { HomeHeader, type Section } from "@platform/nav";
import { apiFetch } from "@shared/api";
import { AuroraBackground, Card, EmptyState, Heading, StatusPill, type StatusTone } from "@shared/ui";
import { navigate, printerDevicePath } from "../../../router.ts";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- shared home chrome for printing park screens.
import "../../../pages/home/home.css";
import "./park.css";

type PrintRequest = {
  readonly id: string;
  readonly status: string;
  readonly result_outcome: "succeeded" | "failed" | null;
  readonly result_reported_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly slice_job_id: string;
};

function tone(status: string, outcome: PrintRequest["result_outcome"]): StatusTone {
  if (outcome === "failed" || status === "failed" || status === "rejected") return "danger";
  if (outcome === "succeeded" || status === "completed") return "ok";
  if (status === "printing") return "ok";
  return "warn";
}

function label(status: string): string {
  return ({
    slice_ready: "Подготавливается", delivered: "Доставлен", awaiting_confirmation: "Ожидает подтверждения",
    accepted: "Принят", printing: "Печатается", completed: "Завершён", failed: "Ошибка", rejected: "Отклонён",
  } as Record<string, string>)[status] ?? status;
}

export function PrintHistoryScreen({ user, section, onSectionChange, id }: { readonly user: SessionUser; readonly section: Section; readonly onSectionChange: (section: Section) => void; readonly id: string }) {
  const [requests, setRequests] = useState<readonly PrintRequest[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch(`/me/devices/${encodeURIComponent(id)}/print-requests?limit=50`, { credentials: "include" })
      .then(async (response) => response.ok ? await response.json() as { requests?: PrintRequest[] } : null)
      .then((data) => { if (!cancelled) setRequests(data?.requests ?? []); })
      .catch(() => { if (!cancelled) setRequests([]); });
    return () => { cancelled = true; };
  }, [id]);

  return <div className="home">
    <AuroraBackground />
    <HomeHeader user={user} printers={[]} section={section} onSectionChange={onSectionChange} onBack={() => navigate(printerDevicePath(id))} />
    <main className="homeContent"><div className="printerLivePage">
      <Heading size="md">История печати</Heading>
      {requests === null ? <Card>Загружаем историю…</Card> : requests.length === 0 ? <EmptyState icon={<span aria-hidden="true">○</span>} title="Печати пока не запускались" sub="Здесь появятся запросы и результаты печати." /> : (
        <div style={{ display: "grid", gap: 10 }}>
          {requests.map((request) => <Card key={request.id} className="printerLiveCard">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div><strong>G-code из slice {request.slice_job_id.slice(0, 8)}</strong><br /><small>{new Date(request.created_at).toLocaleString()}</small></div>
              <StatusPill tone={tone(request.status, request.result_outcome)}>{request.result_outcome === "succeeded" ? "Успешно" : request.result_outcome === "failed" ? "Печать не удалась" : label(request.status)}</StatusPill>
            </div>
            <a href={`${printerDevicePath(id)}?print_request=${encodeURIComponent(request.id)}`}>Открыть детали</a>
          </Card>)}
        </div>
      )}
    </div></main>
  </div>;
}
