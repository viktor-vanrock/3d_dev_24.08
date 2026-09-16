import { useEffect, useState } from "react";
import type { SessionUser } from "@shared/types";
import { DataShell, type Section } from "@platform/nav";
import { Button, EmptyState, Eyebrow, Heading, Input } from "@shared/ui";
import { listAdminMaterials, type AdminMaterial, type AdminMaterialKind } from "./api.ts";
import "./materialadmin.css";

const KINDS: readonly { readonly value: AdminMaterialKind | ""; readonly label: string }[] = [
  { value: "", label: "Все" },
  { value: "filament", label: "Филамент" },
  { value: "resin", label: "Смола" },
  { value: "plywood", label: "Фанера" },
  { value: "aluminum", label: "Алюминий" },
];

export function DataMaterialsScreen({ user, section, onSectionChange }: { user: SessionUser; section: Section; onSectionChange: (section: Section) => void }) {
  const allowed = user.capabilities?.includes("data.materials.manage") === true;
  const [kind, setKind] = useState<AdminMaterialKind | "">("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<readonly AdminMaterial[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setFailed(false);
      void listAdminMaterials({ q: query.trim() || undefined, kind: kind || undefined }, controller.signal)
        .then((page) => setItems(page.items))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setFailed(true);
        });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [allowed, kind, query]);

  return (
    <DataShell user={user} section={section} onSectionChange={onSectionChange} active="materials">
      <section className="materialAdminContent">
        {!allowed ? <EmptyState icon={null} title="Недостаточно прав" /> : (
          <>
            <header className="materialAdminHeader">
              <div><Eyebrow>ДАННЫЕ · КАТАЛОГ</Eyebrow><Heading size="md">Материалы</Heading></div>
              <Button href="/data/materials/new">Добавить материал</Button>
            </header>
            <div className="materialAdminToolbar">
              <label className="materialAdminSearch">Поиск<Input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
              <div className="materialAdminKinds" aria-label="Вид материала">
                {KINDS.map((option) => <button key={option.value || "all"} type="button" aria-pressed={kind === option.value} onClick={() => setKind(option.value)}>{option.label}</button>)}
              </div>
            </div>
            {failed ? <EmptyState icon={null} title="Не удалось загрузить материалы" /> : items === null ? <p>Загрузка…</p> : items.length === 0 ? <EmptyState icon={null} title="Материалов пока нет" /> : (
              <div className="materialAdminTable" role="list">
                {items.map((material) => <a key={material.id} href={`/data/materials/${encodeURIComponent(material.id)}`} role="listitem"><strong>{material.name}</strong><span>{material.vendor_name} · {material.material_type_name}</span><span>{material.status}</span></a>)}
              </div>
            )}
          </>
        )}
      </section>
    </DataShell>
  );
}
