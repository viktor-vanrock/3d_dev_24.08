import { useEffect, useState } from "react";
import { DataShell, type Section } from "@platform/nav";
import type { SessionUser } from "@shared/types";
import { Button, EmptyState, Eyebrow, Heading } from "@shared/ui";
import { useOverlay } from "@platform/overlay";
import { apiAssetUrl } from "@shared/api";
import { feedPostPath, navigate } from "../../../../router.ts";
import { uploadFeedMedia } from "../api.ts";
import { FeedBlockEditor } from "../blockeditor.tsx";
import { createAdminNews, getAdminNews, hideAdminNews, publishAdminNews, updateAdminNews, type NewsAdminItem } from "./api.ts";
import "./newsadmin.css";

const NEWS_ICON = <span aria-hidden="true">📰</span>;
type DetailState = { readonly kind: "loading" } | { readonly kind: "not_found" } | { readonly kind: "failure" } | { readonly kind: "ready" };

export function NewsAdminEditor({ user, section, onSectionChange, id }: { user: SessionUser; section: Section; onSectionChange: (section: Section) => void; id?: string }) {
  const allowed = user.capabilities?.includes("data.news.manage") === true;
  const overlay = useOverlay();
  const [item, setItem] = useState<NewsAdminItem | null>(null);
  const [detailState, setDetailState] = useState<DetailState>(id === undefined ? { kind: "ready" } : { kind: "loading" });
  const [requestVersion, setRequestVersion] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!allowed || id === undefined) return;
    const controller = new AbortController();
    setDetailState({ kind: "loading" });
    void getAdminNews(id, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.kind !== "success") { setDetailState({ kind: result.kind }); return; }
      setItem(result.value);
      setTitle(result.value.title);
      setBody(result.value.body ?? "");
      setDetailState({ kind: "ready" });
    }).catch(() => {
      if (!controller.signal.aborted) setDetailState({ kind: "failure" });
    });
    return () => controller.abort();
  }, [allowed, id, requestVersion]);

  async function save() {
    if (!title.trim() || pending) return;
    setPending(true);
    try {
      const saved = id === undefined ? await createAdminNews({ title: title.trim(), body }) : await updateAdminNews(id, { title: title.trim(), body });
      if (!saved) { overlay.toast({ severity: "critical", title: "Не удалось сохранить" }); return; }
      setItem(saved); overlay.toast({ severity: "success", title: "Черновик сохранён" });
      if (id === undefined) navigate(`/data/news/${encodeURIComponent(saved.id)}`);
    } catch {
      overlay.toast({ severity: "critical", title: "Не удалось сохранить" });
    } finally {
      setPending(false);
    }
  }
  async function transition(kind: "publish" | "hide") {
    if (!id || pending) return;
    if (!title.trim()) return;
    setPending(true);
    try {
      const saved = await updateAdminNews(id, { title: title.trim(), body });
      const result = saved === null ? null : kind === "publish" ? await publishAdminNews(id) : await hideAdminNews(id);
      if (!result) { overlay.toast({ severity: "critical", title: "Не удалось изменить статус" }); return; }
      setItem(result); overlay.toast({ severity: "success", title: kind === "publish" ? "Новость опубликована" : "Новость скрыта" });
      if (kind === "publish") navigate(feedPostPath(result.id));
    } catch {
      overlay.toast({ severity: "critical", title: "Не удалось изменить статус" });
    } finally {
      setPending(false);
    }
  }
  return <DataShell user={user} section={section} onSectionChange={onSectionChange} active="news" trail={id ? title || "Редактирование" : "Новая новость"}>
    {!allowed ? <EmptyState icon={NEWS_ICON} title="Недостаточно прав" sub="Нужно разрешение на управление новостями." /> : detailState.kind === "loading" ? <p>Загрузка…</p> : detailState.kind === "not_found" ? <EmptyState icon={NEWS_ICON} title="Новость не найдена" /> : detailState.kind === "failure" ? <EmptyState icon={NEWS_ICON} title="Не удалось загрузить новость" action={<Button onClick={() => setRequestVersion((value) => value + 1)}>Повторить</Button>} /> : <div className="feedEditorPage newsAdminEditor">
      <div className="newsAdminHeader"><div><Eyebrow>{item?.source === "scout" ? "Scout draft" : "Ручная новость"}</Eyebrow><Heading size="md">{id ? "Редактирование" : "Новая новость"}</Heading></div>{item ? <span>{item.status === "published" ? "Опубликовано" : item.status === "hidden" ? "Скрыто" : "Черновик"}</span> : null}</div>
      {item?.source_url ? <a href={item.source_url} target="_blank" rel="noreferrer">Исходный источник ↗</a> : null}
      <label className="marketField"><span className="marketFieldLabel">Заголовок</span><input className="marketInput" value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} /></label>
      <FeedBlockEditor id="news-admin-body" value={body} user={user} overlay={overlay} uploadImage={async (file) => { const uploaded = await uploadFeedMedia(file); if (!uploaded) throw new Error("upload"); return { url: apiAssetUrl(uploaded.url) }; }} onChange={setBody} />
      <div className="newsAdminBadges"><Button variant="primary" disabled={pending || !title.trim()} onClick={() => void save()}>{pending ? "Сохраняем…" : "Сохранить"}</Button>{id && item?.status !== "published" ? <Button variant="secondary" disabled={pending} onClick={() => void transition("publish")}>Опубликовать</Button> : null}{id && item?.status !== "hidden" ? <Button variant="secondary" disabled={pending} onClick={() => void transition("hide")}>Скрыть</Button> : null}</div>
    </div>}
  </DataShell>;
}
