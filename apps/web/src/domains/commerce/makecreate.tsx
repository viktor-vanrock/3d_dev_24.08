import { useEffect, useState } from "react";
import {
  createMakeFromForm,
  ISSUE_TAG_LABELS,
  listMachineOptions,
  listMaterialOptions,
  suggestMachine,
  suggestMaterial,
  type FilterOption,
  type IssueTag,
} from "./makes.ts";
import "./makeflow.css";

const ISSUE_TAGS = Object.keys(ISSUE_TAG_LABELS) as IssueTag[];
const MAX_PHOTOS = 6;

export function MakeCreateWizard({
  modelId,
  modelTitle,
  onClose,
  onCreated,
}: {
  modelId: string;
  modelTitle: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [step, setStep] = useState(1);
  const [photos, setPhotos] = useState<File[]>([]);
  const [machines, setMachines] = useState<FilterOption[]>([]);
  const [materials, setMaterials] = useState<FilterOption[]>([]);
  const [machineId, setMachineId] = useState(() => localStorage.getItem("make:last-machine") ?? "");
  const [materialIds, setMaterialIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("make:last-materials") ?? "[]") as string[]; } catch { return []; }
  });
  const [rating, setRating] = useState("");
  const [geometryQualityRating, setGeometryQualityRating] = useState("");
  const [surfaceQualityRating, setSurfaceQualityRating] = useState("");
  const [nozzle, setNozzle] = useState("");
  const [layer, setLayer] = useState("");
  const [slicer, setSlicer] = useState("");
  const [timeMinutes, setTimeMinutes] = useState("");
  const [weightGrams, setWeightGrams] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState<IssueTag[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void Promise.all([listMachineOptions(), listMaterialOptions()]).then(([nextMachines, nextMaterials]) => {
      setMachines(nextMachines);
      setMaterials(nextMaterials);
    });
  }, []);

  function next() {
    if (step === 1 && photos.length === 0) {
      setError("Добавьте хотя бы одно фото печати.");
      return;
    }
    if (step === 2 && (!machineId || materialIds.length === 0)) {
      setError("Выберите принтер и хотя бы один филамент.");
      return;
    }
    setError("");
    setStep((current) => Math.min(3, current + 1));
  }

  async function submit() {
    if (!photos.length || !machineId || !materialIds.length || submitting) return;
    const settings: Record<string, string | number> = {};
    if (nozzle) settings.nozzle_mm = Number(nozzle);
    if (layer) settings.layer_height_mm = Number(layer);
    if (slicer) settings.slicer = slicer;
    if (timeMinutes) settings.print_time_minutes = Number(timeMinutes);
    if (weightGrams) settings.weight_grams = Number(weightGrams);
    const body = new FormData();
    body.set("model_id", modelId);
    body.set("machine_id", machineId);
    body.set("material_ids", materialIds.join(","));
    body.set("print_settings", JSON.stringify(settings));
    if (rating) body.set("printability_rating", rating);
    if (geometryQualityRating) body.set("geometry_quality_rating", geometryQualityRating);
    if (surfaceQualityRating) body.set("surface_quality_rating", surfaceQualityRating);
    if (notes) body.set("notes", notes);
    if (tags.length) body.set("issue_tags", tags.join(","));
    photos.forEach((photo) => body.append("photos", photo));
    setSubmitting(true);
    const id = await createMakeFromForm(body);
    setSubmitting(false);
    if (!id) {
      setError("Не удалось опубликовать печать. Проверьте поля и попробуйте снова.");
      return;
    }
    localStorage.setItem("make:last-machine", machineId);
    localStorage.setItem("make:last-materials", JSON.stringify(materialIds));
    onCreated(id);
  }

  async function propose(kind: "machine" | "material") {
    const vendor = window.prompt("Производитель");
    if (!vendor) return;
    const name = window.prompt(kind === "machine" ? "Модель принтера" : "Название филамента");
    if (!name) return;
    const ok = kind === "machine" ? await suggestMachine({ vendor, model: name }) : await suggestMaterial({ vendor, name });
    setError(ok ? "Предложение отправлено на модерацию." : "Не удалось отправить предложение.");
  }

  return (
    <div className="makeWizard">
      <div className="makeWizardHead">
        <div>
          <span className="makeEyebrow">Я напечатал · шаг {step} из 3</span>
          <h2>{modelTitle}</h2>
        </div>
        <button type="button" className="makeIconBtn" onClick={onClose} aria-label="Закрыть">×</button>
      </div>

      {step === 1 ? (
        <section aria-labelledby="make-photo-step">
          <h3 id="make-photo-step">Покажите результат</h3>
          <label
            className="makeDrop"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              setPhotos(Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/")).slice(0, MAX_PHOTOS));
            }}
          >
            <span>Перетащите фото сюда или выберите файлы</span>
            <small>До {MAX_PHOTOS} фото, первое станет обложкой</small>
            <input
              type="file"
              accept="image/*"
              multiple
              aria-label="Фото печати"
              onChange={(event) => setPhotos(Array.from(event.target.files ?? []).slice(0, MAX_PHOTOS))}
            />
          </label>
          {photos.length ? <p>{photos.length} фото выбрано</p> : null}
        </section>
      ) : null}

      {step === 2 ? (
        <section aria-labelledby="make-hardware-step">
          <h3 id="make-hardware-step">На чём и чем печатали</h3>
          <label>Принтер
            <select value={machineId} onChange={(event) => setMachineId(event.target.value)} aria-label="Принтер">
              <option value="">Выберите принтер</option>
              {machines.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <fieldset><legend>Филаменты</legend>
            <div className="makeMaterialChoices">
              {materials.map((item) => <label key={item.id}>
                <input
                  type="checkbox"
                  checked={materialIds.includes(item.id)}
                  onChange={() => setMaterialIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}
                />
                {item.label}
              </label>)}
            </div>
          </fieldset>
          <div className="makeInlineActions">
            <button type="button" onClick={() => void propose("machine")}>Предложить принтер</button>
            <button type="button" onClick={() => void propose("material")}>Предложить филамент</button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section aria-labelledby="make-details-step">
          <h3 id="make-details-step">Детали печати <small>необязательно</small></h3>
          <div className="makeFields">
            <label>Слайсер<input value={slicer} onChange={(event) => setSlicer(event.target.value)} /></label>
            <label>Сопло, мм<input type="number" inputMode="decimal" value={nozzle} onChange={(event) => setNozzle(event.target.value)} /></label>
            <label>Слой, мм<input type="number" inputMode="decimal" value={layer} onChange={(event) => setLayer(event.target.value)} /></label>
            <label>Время, минут<input type="number" value={timeMinutes} onChange={(event) => setTimeMinutes(event.target.value)} /></label>
            <label>Вес, г<input type="number" value={weightGrams} onChange={(event) => setWeightGrams(event.target.value)} /></label>
          </div>
          {/* MF-1962: три независимых вопроса, не одна общая «оценка» — печатаемость проекта
              (воспроизводим ли он вообще), геометрия/стыки самой модели и качество поверхности
              именно этого отпечатка на этом станке/филаменте. Не сворачивать в одно число. */}
          <fieldset className="makeRating"><legend>Печатаемость проекта</legend>
            {[1, 2, 3, 4, 5].map((value) => <label key={value}><input type="radio" name="rating" value={value} checked={rating === String(value)} onChange={() => setRating(String(value))} aria-label={`${value} звёзд — печатаемость проекта`} />{value} звёзд</label>)}
          </fieldset>
          <fieldset className="makeRating"><legend>Геометрия и стыки модели</legend>
            {[1, 2, 3, 4, 5].map((value) => <label key={value}><input type="radio" name="geometryQualityRating" value={value} checked={geometryQualityRating === String(value)} onChange={() => setGeometryQualityRating(String(value))} aria-label={`${value} звёзд — геометрия и стыки модели`} />{value} звёзд</label>)}
          </fieldset>
          <fieldset className="makeRating"><legend>Качество поверхности отпечатка</legend>
            {[1, 2, 3, 4, 5].map((value) => <label key={value}><input type="radio" name="surfaceQualityRating" value={value} checked={surfaceQualityRating === String(value)} onChange={() => setSurfaceQualityRating(String(value))} aria-label={`${value} звёзд — качество поверхности отпечатка`} />{value} звёзд</label>)}
          </fieldset>
          <fieldset><legend>Проблемы</legend>
            <div className="makeTags">{ISSUE_TAGS.map((tag) => <label key={tag}><input type="checkbox" checked={tags.includes(tag)} onChange={() => setTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])} />{ISSUE_TAG_LABELS[tag]}</label>)}</div>
          </fieldset>
          <label>Заметки<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} /></label>
        </section>
      ) : null}

      {error ? <p className="makeMessage" role="alert">{error}</p> : null}
      <div className="makeWizardActions">
        {step > 1 ? <button type="button" onClick={() => setStep((current) => current - 1)}>Назад</button> : null}
        {step < 3
          ? <button type="button" className="makePrimary" onClick={next}>Продолжить</button>
          : <button type="button" className="makePrimary" disabled={submitting} onClick={() => void submit()}>{submitting ? "Публикуем…" : "Опубликовать печать"}</button>}
      </div>
    </div>
  );
}
