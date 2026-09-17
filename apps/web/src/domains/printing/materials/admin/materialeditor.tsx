import { useEffect, useState, type FormEvent } from "react";
import type { SessionUser } from "@shared/types";
import { DataShell, type Section } from "@platform/nav";
import { Button, EmptyState, Eyebrow, Heading, Input } from "@shared/ui";
import { archiveAdminMaterial, createAdminMaterial, getAdminMaterial, getAdminMaterialOptions, publishAdminMaterial, restoreAdminMaterial, updateAdminMaterial, type AdminMaterialKind, type AdminMaterialOption, type AdminMaterialStatus } from "./api.ts";

function materialKind(value: string): AdminMaterialKind {
  if (value === "resin" || value === "plywood" || value === "aluminum") return value;
  return "filament";
}

export function DataMaterialEditor({ user, section, onSectionChange, id }: { user: SessionUser; section: Section; onSectionChange: (section: Section) => void; id?: string }) {
  const allowed = user.capabilities?.includes("data.materials.manage") === true;
  const [kind, setKind] = useState<AdminMaterialKind>("filament");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [materialTypeId, setMaterialTypeId] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(id === undefined ? 1 : null);
  const [status, setStatus] = useState<AdminMaterialStatus>("draft");
  const [vendors, setVendors] = useState<readonly AdminMaterialOption[]>([]);
  const [materialTypes, setMaterialTypes] = useState<readonly AdminMaterialOption[]>([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    void getAdminMaterialOptions()
      .then((options) => {
        if (cancelled) return;
        setVendors(options.vendors);
        setMaterialTypes(options.material_types);
        setOptionsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setMessage("Не удалось загрузить производителей и типы материалов");
        setOptionsLoaded(true);
      });
    return () => { cancelled = true; };
  }, [allowed]);

  useEffect(() => {
    if (!allowed || id === undefined) return;
    let cancelled = false;
    void getAdminMaterial(id).then((material) => {
      if (cancelled) return;
      setKind(material.kind);
      setName(material.name);
      setSlug(material.slug);
      setVendorId(material.vendor_id);
      setMaterialTypeId(material.material_type_id);
      setVersion(material.version);
      setStatus(material.status);
    }).catch(() => { if (!cancelled) setMessage("Не удалось загрузить материал"); });
    return () => { cancelled = true; };
  }, [allowed, id]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || version === null) return;
    setPending(true);
    setMessage(null);
    try {
      if (id === undefined) {
        await createAdminMaterial({ kind, name, slug, vendor_id: vendorId, material_type_id: materialTypeId, specs: {} });
        window.location.assign("/data/materials");
      } else {
        const updated = await updateAdminMaterial(id, { version, kind, name, vendor_id: vendorId, material_type_id: materialTypeId });
        setVersion(updated.version);
        setMessage("Изменения сохранены");
        setPending(false);
      }
    } catch {
      setMessage("Не удалось сохранить материал");
      setPending(false);
    }
  }

  async function publish() {
    if (id === undefined || version === null || pending) return;
    setPending(true);
    try {
      const updated = await publishAdminMaterial(id, version);
      setVersion(updated.version);
      setStatus("published");
      setMessage("Материал опубликован");
    } catch { setMessage("Не удалось опубликовать материал"); }
    setPending(false);
  }

  async function archive() {
    if (id === undefined || version === null || pending) return;
    setPending(true);
    try {
      await archiveAdminMaterial(id, version);
      window.location.assign("/data/materials");
    } catch { setMessage("Не удалось архивировать материал"); setPending(false); }
  }

  async function restore() {
    if (id === undefined || version === null || pending) return;
    setPending(true);
    setMessage(null);
    try {
      const updated = await restoreAdminMaterial(id, version);
      setVersion(updated.version);
      setStatus("draft");
      setMessage("Материал восстановлен как черновик");
    } catch {
      setMessage("Не удалось восстановить материал: карточка могла измениться, обновите страницу");
    } finally {
      setPending(false);
    }
  }

  return (
    <DataShell user={user} section={section} onSectionChange={onSectionChange} active="materials" trail={id ? name || "Редактирование" : "Новый материал"}>
      <section className="materialAdminContent">
        {!allowed ? <EmptyState icon={null} title="Недостаточно прав" /> : (
          <>
            <div><Eyebrow>ДАННЫЕ · МАТЕРИАЛЫ</Eyebrow><Heading size="md">{id ? "Редактирование материала" : "Новый материал"}</Heading></div>
            {version === null ? <p>Загрузка карточки материала…</p> : (
              <form className="materialAdminForm" onSubmit={(event) => void submit(event)}>
                <label>Вид материала<select disabled={status === "archived"} value={kind} onChange={(event) => setKind(materialKind(event.target.value))}><option value="filament">Филамент</option><option value="resin">Смола</option><option value="plywood">Фанера</option><option value="aluminum">Алюминий</option></select></label>
                <label>Название<Input required disabled={status === "archived"} value={name} onChange={(event) => setName(event.target.value)} /></label>
                <label>Slug<Input required disabled={id !== undefined} pattern="[a-z0-9]+([.-][a-z0-9]+)*" value={slug} onChange={(event) => setSlug(event.target.value)} /></label>
                <label>Производитель<select required value={vendorId} disabled={!optionsLoaded || status === "archived"} onChange={(event) => setVendorId(event.target.value)}><option value="">Выберите производителя</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label>
                <label>Тип материала<select required value={materialTypeId} disabled={!optionsLoaded || status === "archived"} onChange={(event) => setMaterialTypeId(event.target.value)}><option value="">Выберите тип</option>{materialTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
                {id === undefined ? <p className="materialAdminLifecycle">Новый материал сохраняется как черновик и не виден в публичном каталоге. После проверки откройте карточку и опубликуйте её.</p> : null}
                {message ? <p role="alert">{message}</p> : null}
                <div className="materialAdminActions">
                  <Button type="submit" disabled={pending || status === "archived" || !optionsLoaded || vendorId === "" || materialTypeId === ""}>{pending ? "Сохранение…" : id ? "Сохранить изменения" : "Сохранить черновик"}</Button>
                  {id && status === "archived" ? <Button type="button" variant="secondary" disabled={pending} onClick={() => void restore()}>Восстановить</Button> : null}
                  {id && status !== "published" ? <Button type="button" variant="secondary" disabled={pending} onClick={() => void publish()}>Опубликовать</Button> : null}
                  {id ? <Button type="button" variant="ghost" disabled={pending} onClick={() => void archive()}>Архивировать</Button> : null}
                </div>
              </form>
            )}
          </>
        )}
      </section>
    </DataShell>
  );
}
