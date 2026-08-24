import { useEffect, useState } from "react";
import { AvatarBubble, deterministicAvatarConfig } from "@shared/avatar";
import { getMake, makePhotoUrl, type MakeDetail, type MakeSummary } from "./makes.ts";
import { makePath, modelPath, navigate, profilePath } from "../../router.ts";
import "./makeflow.css";

const SETTING_LABELS: Record<string, string> = {
  nozzle_mm: "Сопло, мм",
  layer_height_mm: "Слой, мм",
  slicer: "Слайсер",
  print_time_minutes: "Время, минут",
  weight_grams: "Вес, г",
};

function Related({ title, items }: { title: string; items: MakeSummary[] }) {
  if (!items.length) return null;
  return <section className="makeRelated" aria-labelledby={`related-${title}`}>
    <h2 id={`related-${title}`}>{title}</h2>
    <div className="makeRelatedGrid">{items.map((item) => <button type="button" key={item.id} onClick={() => navigate(makePath(item.id))}>
      <strong>{item.caption || item.model_title || "Печать сообщества"}</strong>
      <span>@{item.author.username}</span>
    </button>)}</div>
  </section>;
}

export function MakeDetailScreen({ id }: { id: string }) {
  const [make, setMake] = useState<MakeDetail | null | undefined>(undefined);
  const [activePhoto, setActivePhoto] = useState<number | null>(null);
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => { setMake(undefined); void getMake(id).then(setMake); }, [id]);
  if (make === undefined) return <main className="makeDetail"><p>Загружаем печать…</p></main>;
  if (make === null) return <main className="makeDetail"><h1>Печать не найдена</h1></main>;
  const photos = [...make.photos].sort((a, b) => a.position - b.position);
  return <main className="makeDetail">
    <button type="button" className="makeBack" onClick={() => history.back()}>← Назад</button>
    <header className="makeDetailHead">
      <div><span className="makeEyebrow">Печать сообщества</span><h1>{make.model_title || make.caption || "Работа мастера"}</h1></div>
      <button type="button" className="makeAuthorButton" onClick={() => navigate(profilePath(make.author.username))}>
        <AvatarBubble
          config={make.author.avatar_config ?? deterministicAvatarConfig(make.author.username || make.author.id)}
          snapshots={make.author.avatar_config ? make.author.avatar_snapshots : null}
          size={34}
          facing="front"
        />
        <span>{make.author.display_name || `@${make.author.username}`}</span>
      </button>
    </header>
    <div className="makePhotoGrid">
      {photos.map((photo, index) => <button key={photo.id} type="button" onClick={() => setActivePhoto(index)} aria-label={`Открыть фото ${index + 1}`}>
        <img src={makePhotoUrl(make.id, photo.id)} alt={`Фото печати ${index + 1}`} />
      </button>)}
    </div>
    <div className="makeSpecLayout">
      <section><h2>Спецификация</h2><dl className="makeSpecs">
        {make.machine_model ? <><dt>Принтер</dt><dd>{make.machine_model}</dd></> : null}
        <dt>Филаменты</dt><dd>{make.materials.map((material) => material.name).join(", ")}</dd>
        {Object.entries(make.print_settings).map(([key, value]) => <span className="makeSpecPair" key={key}><dt>{SETTING_LABELS[key] ?? key}</dt><dd>{String(value)}</dd></span>)}
        {/* MF-1962: три независимых смысла — не сворачиваем в одну «Оценку» (печатаемость
            проекта, геометрия/стыки модели, качество поверхности именно этого отпечатка). */}
        {make.printability_rating ? <><dt>Печатаемость проекта</dt><dd>{"★".repeat(make.printability_rating)}</dd></> : null}
        {make.geometry_quality_rating ? <><dt>Геометрия и стыки модели</dt><dd>{"★".repeat(make.geometry_quality_rating)}</dd></> : null}
        {make.surface_quality_rating ? <><dt>Качество поверхности отпечатка</dt><dd>{"★".repeat(make.surface_quality_rating)}</dd></> : null}
      </dl></section>
      <section><h2>Заметки</h2><p>{make.notes || "Автор не добавил заметки."}</p>
        {make.model_id ? <button type="button" onClick={() => navigate(modelPath(make.model_id!))}>Открыть проект</button> : null}
      </section>
    </div>
    <Related title="Ещё печати этой модели" items={make.more_prints_of_model} />
    <Related title="Этим же филаментом печатали" items={make.same_material_prints} />
    {activePhoto !== null ? <div className="makeLightbox" role="dialog" aria-modal="true" aria-label={`Фото печати ${activePhoto + 1}`}>
      <button type="button" className="makeLightboxClose" onClick={() => { setActivePhoto(null); setZoomed(false); }} aria-label="Закрыть">×</button>
      <button type="button" className="makeLightboxImage" onClick={() => setZoomed((current) => !current)} aria-label={zoomed ? "Уменьшить фото" : "Увеличить фото"}>
        <img data-zoomed={zoomed} src={makePhotoUrl(make.id, photos[activePhoto]!.id)} alt={`Фото печати ${activePhoto + 1}, увеличенное`} />
      </button>
      <div><button type="button" disabled={activePhoto === 0} onClick={() => setActivePhoto((current) => Math.max(0, (current ?? 0) - 1))}>←</button>
        <span>{activePhoto + 1} / {photos.length}</span>
        <button type="button" disabled={activePhoto === photos.length - 1} onClick={() => setActivePhoto((current) => Math.min(photos.length - 1, (current ?? 0) + 1))}>→</button></div>
    </div> : null}
  </main>;
}
