import { useEffect, useState } from "react";
import { DataShell, type Section } from "@platform/nav";
import type { SessionUser } from "@shared/types";
import { Button, EmptyState, Eyebrow, Heading } from "@shared/ui";
import { navigate } from "../../../../router.ts";
import { listAdminNews, type NewsAdminItem, type NewsAdminSource, type NewsAdminStatus } from "./api.ts";
import "./newsadmin.css";

const NEWS_ICON = <span aria-hidden="true">📰</span>;
type ListState = { readonly kind: "loading" } | { readonly kind: "failure" } | { readonly kind: "ready"; readonly items: readonly NewsAdminItem[] };

export function NewsAdminScreen({ user, section, onSectionChange }: { user: SessionUser; section: Section; onSectionChange: (section: Section) => void }) {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [requestVersion, setRequestVersion] = useState(0);
  const [status, setStatus] = useState<NewsAdminStatus | "all">("all");
  const [source, setSource] = useState<NewsAdminSource | "all">("all");
  const allowed = user.capabilities?.includes("data.news.manage") === true;
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setState({ kind: "loading" });
    void listAdminNews({ status, source }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setState(result.kind === "success" ? { kind: "ready", items: result.value } : { kind: "failure" });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ kind: "failure" });
    });
    return () => controller.abort();
  }, [allowed, status, source, requestVersion]);
  return <DataShell user={user} section={section} onSectionChange={onSectionChange} active="news">
    {!allowed ? <EmptyState icon={NEWS_ICON} title="Недостаточно прав" sub="Нужно разрешение на управление новостями." /> : <>
      <div className="newsAdminHeader"><div><Eyebrow>Новости</Eyebrow><Heading size="md">Редакционная очередь</Heading></div><Button variant="primary" onClick={() => navigate("/data/news/new")}>Новая новость</Button></div>
      <div className="newsAdminFilters">
        <label>Статус<select value={status} onChange={(event) => setStatus(event.target.value === "draft" || event.target.value === "published" || event.target.value === "hidden" ? event.target.value : "all")}><option value="all">Все</option><option value="draft">Черновики</option><option value="published">Опубликованные</option><option value="hidden">Скрытые</option></select></label>
        <label>Источник<select value={source} onChange={(event) => setSource(event.target.value === "manual" || event.target.value === "scout" ? event.target.value : "all")}><option value="all">Все</option><option value="manual">Ручные</option><option value="scout">Scout</option></select></label>
      </div>
      {state.kind === "loading" ? <p>Загрузка…</p> : state.kind === "failure" ? <EmptyState icon={NEWS_ICON} title="Не удалось загрузить новости" action={<Button onClick={() => setRequestVersion((value) => value + 1)}>Повторить</Button>} /> : state.items.length === 0 ? <EmptyState icon={NEWS_ICON} title="Новостей нет" sub="Создайте ручной черновик или дождитесь Scout." /> : <div className="newsAdminList">{state.items.map((item) => <button type="button" className="newsAdminRow" key={item.id} onClick={() => navigate(`/data/news/${encodeURIComponent(item.id)}`)}><span><strong>{item.title}</strong><small>{new Date(item.updated_at).toLocaleString("ru-RU")}</small></span><span className="newsAdminBadges"><span>{item.source === "scout" ? "Scout" : "Вручную"}</span><span>{item.status === "published" ? "Опубликовано" : item.status === "hidden" ? "Скрыто" : "Черновик"}</span></span></button>)}</div>}
    </>}
  </DataShell>;
}
