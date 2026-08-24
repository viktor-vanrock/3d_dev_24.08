import { useEffect, useMemo, useState } from "react";
import { Button, Eyebrow } from "@shared/ui";
import {
  createMake,
  ISSUE_TAG_LABELS,
  ISSUE_TAGS,
  listMachineOptions,
  listMaterialOptions,
  type FilterOption,
  type IssueTag,
} from "./makes.ts";
import "./createmake.css";

const MAX_PHOTOS = 6;

const ERROR_LABELS: Record<string, string> = {
  MACHINE_ID_REQUIRED: "Выберите принтер.",
  MATERIAL_IDS_REQUIRED: "Выберите хотя бы один материал.",
  PHOTO_REQUIRED: "Добавьте хотя бы одну фотографию.",
  PHOTO_PROCESSING_FAILED: "Фотографии не прошли обработку. Попробуйте другие файлы.",
  PHOTO_TOO_LARGE: "Одна из фотографий слишком большая.",
};

export function CreateMakeFlow({
  modelId,
  modelTitle,
  onClose,
  onCreated,
}: {
  modelId: string;
  modelTitle: string;
  onClose: () => void;
  onCreated: (makeId: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [photos, setPhotos] = useState<File[]>([]);
  const [machines, setMachines] = useState<FilterOption[]>([]);
  const [materials, setMaterials] = useState<FilterOption[]>([]);
  const [machineId, setMachineId] = useState(() => localStorage.getItem("make:last-machine") ?? "");
  const [materialIds, setMaterialIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("make:last-materials") ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const [rating, setRating] = useState<number | null>(null);
  const [geometryQualityRating, setGeometryQualityRating] = useState<number | null>(null);
  const [surfaceQualityRating, setSurfaceQualityRating] = useState<number | null>(null);
  const [caption, setCaption] = useState("");
  const [notes, setNotes] = useState("");
  const [slicer, setSlicer] = useState("");
  const [nozzle, setNozzle] = useState("");
  const [layerHeight, setLayerHeight] = useState("");
  const [printMinutes, setPrintMinutes] = useState("");
  const [weightGrams, setWeightGrams] = useState("");
  const [issues, setIssues] = useState<IssueTag[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void Promise.all([listMachineOptions(), listMaterialOptions()]).then(([nextMachines, nextMaterials]) => {
      setMachines(nextMachines);
      setMaterials(nextMaterials);
    });
  }, []);

  const previews = useMemo(() => photos.map((photo) => ({ photo, url: URL.createObjectURL(photo) })), [photos]);
  useEffect(
    () => () => {
      for (const preview of previews) URL.revokeObjectURL(preview.url);
    },
    [previews],
  );

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const next = [...photos, ...Array.from(files).filter((file) => file.type.startsWith("image/"))].slice(0, MAX_PHOTOS);
    setPhotos(next);
    setError("");
  }

  function next() {
    if (step === 0 && photos.length === 0) {
      setError("Добавьте фотографию готовой работы.");
      return;
    }
    if (step === 1 && (!machineId || materialIds.length === 0)) {
      setError("Укажите принтер и хотя бы один материал.");
      return;
    }
    setError("");
    setStep((current) => Math.min(2, current + 1));
  }

  async function submit() {
    if (submitting || !machineId || materialIds.length === 0 || photos.length === 0) return;
    setSubmitting(true);
    setError("");
    const result = await createMake({
      modelId,
      machineId,
      materialIds,
      photos,
      caption,
      notes,
      printabilityRating: rating ?? undefined,
      geometryQualityRating: geometryQualityRating ?? undefined,
      surfaceQualityRating: surfaceQualityRating ?? undefined,
      issueTags: issues,
      printSettings: {
        ...(slicer.trim() ? { slicer: slicer.trim() } : {}),
        ...(nozzle ? { nozzle_mm: Number(nozzle) } : {}),
        ...(layerHeight ? { layer_height_mm: Number(layerHeight) } : {}),
        ...(printMinutes ? { print_time_minutes: Number(printMinutes) } : {}),
        ...(weightGrams ? { weight_grams: Number(weightGrams) } : {}),
      },
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(ERROR_LABELS[result.error] ?? "Не удалось опубликовать печать. Попробуйте ещё раз.");
      return;
    }
    localStorage.setItem("make:last-machine", machineId);
    localStorage.setItem("make:last-materials", JSON.stringify(materialIds));
    onCreated(result.make.id);
  }

  return (
    <div className="createMakeFlow">
      <header className="createMakeHead">
        <div>
          <Eyebrow>Результат проекта</Eyebrow>
          <h2>Покажите, как получилось</h2>
          <p>{modelTitle}</p>
        </div>
        <button type="button" className="createMakeClose pressable" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
      </header>

      <ol className="createMakeProgress" aria-label="Шаги публикации">
        {["Фото", "Принтер и материал", "Оценка"].map((label, index) => (
          <li key={label} data-active={index === step || undefined} data-complete={index < step || undefined}>
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <section className="createMakeStep">
          <div className="createMakeStepTitle">
            <h3>Живые фотографии результата</h3>
            <span>{photos.length}/{MAX_PHOTOS}</span>
          </div>
          <label
            className="createMakeDrop"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              addPhotos(event.dataTransfer.files);
            }}
          >
            <input type="file" accept="image/*" multiple onChange={(event) => addPhotos(event.target.files)} />
            <strong>Перетащите или выберите фотографии</strong>
            <span>До 6 кадров: общий вид, детали поверхности и проблемные места.</span>
          </label>
          {previews.length > 0 ? (
            <div className="createMakePreviews">
              {previews.map(({ photo, url }, index) => (
                <div key={`${photo.name}-${photo.lastModified}`}>
                  <img src={url} alt="" />
                  <button
                    type="button"
                    className="pressable"
                    aria-label={`Удалить фотографию ${index + 1}`}
                    onClick={() => setPhotos((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {step === 1 ? (
        <section className="createMakeStep">
          <div className="createMakeStepTitle">
            <h3>На чём и из чего печатали</h3>
            <span>Для AMS выберите несколько материалов</span>
          </div>
          <label className="createMakeField">
            <span>Принтер</span>
            <select value={machineId} onChange={(event) => setMachineId(event.target.value)}>
              <option value="">Выберите свой принтер</option>
              {machines.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="createMakeMaterials">
            <legend>Материалы</legend>
            <div>
              {materials.map((material) => {
                const selected = materialIds.includes(material.id);
                return (
                  <label key={material.id} data-selected={selected || undefined}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() =>
                        setMaterialIds((current) =>
                          current.includes(material.id)
                            ? current.filter((id) => id !== material.id)
                            : [...current, material.id],
                        )
                      }
                    />
                    {material.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="createMakeStep">
          <div className="createMakeStepTitle">
            <h3>Оцените опыт, а не только красивый кадр</h3>
            <span>Можно пропустить</span>
          </div>
          {/* MF-1962: три независимых вопроса — печатаемость проекта, геометрия/стыки самой
              модели и качество поверхности именно этого отпечатка. Не сворачивать в одно число. */}
          <fieldset className="createMakeRating">
            <legend>Насколько легко проект печатается?</legend>
            <div>
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className="pressable"
                  data-selected={rating === value || undefined}
                  onClick={() => setRating(value)}
                  aria-label={`${value} из 5 — печатаемость проекта`}
                >
                  {value}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="createMakeRating">
            <legend>Насколько корректна геометрия и стыки модели?</legend>
            <div>
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className="pressable"
                  data-selected={geometryQualityRating === value || undefined}
                  onClick={() => setGeometryQualityRating(value)}
                  aria-label={`${value} из 5 — геометрия и стыки модели`}
                >
                  {value}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="createMakeRating">
            <legend>Каково качество поверхности у вашего отпечатка?</legend>
            <div>
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className="pressable"
                  data-selected={surfaceQualityRating === value || undefined}
                  onClick={() => setSurfaceQualityRating(value)}
                  aria-label={`${value} из 5 — качество поверхности отпечатка`}
                >
                  {value}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="createMakeField">
            <span>Коротко о результате</span>
            <textarea value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Что получилось хорошо?" />
          </label>
          <div className="createMakeSettings" aria-label="Настройки печати">
            <label className="createMakeField">
              <span>Слайсер</span>
              <input value={slicer} onChange={(event) => setSlicer(event.target.value)} placeholder="OrcaSlicer" />
            </label>
            <label className="createMakeField">
              <span>Сопло, мм</span>
              <input type="number" inputMode="decimal" value={nozzle} onChange={(event) => setNozzle(event.target.value)} placeholder="0.4" />
            </label>
            <label className="createMakeField">
              <span>Слой, мм</span>
              <input
                type="number"
                inputMode="decimal"
                value={layerHeight}
                onChange={(event) => setLayerHeight(event.target.value)}
                placeholder="0.2"
              />
            </label>
            <label className="createMakeField">
              <span>Время, мин</span>
              <input type="number" value={printMinutes} onChange={(event) => setPrintMinutes(event.target.value)} placeholder="180" />
            </label>
            <label className="createMakeField">
              <span>Вес, г</span>
              <input type="number" value={weightGrams} onChange={(event) => setWeightGrams(event.target.value)} placeholder="86" />
            </label>
          </div>
          <fieldset className="createMakeIssues">
            <legend>Что пошло не так</legend>
            <div>
              {ISSUE_TAGS.map((issue) => (
                <label key={issue} data-selected={issues.includes(issue) || undefined}>
                  <input
                    type="checkbox"
                    checked={issues.includes(issue)}
                    onChange={() =>
                      setIssues((current) => (current.includes(issue) ? current.filter((item) => item !== issue) : [...current, issue]))
                    }
                  />
                  {ISSUE_TAG_LABELS[issue]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="createMakeField">
            <span>Настройки и заметки</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Слой, сопло, поддержки, время…" />
          </label>
        </section>
      ) : null}

      {error ? <p className="createMakeError" role="alert">{error}</p> : null}

      <footer className="createMakeActions">
        <Button variant="ghost" onClick={step === 0 ? onClose : () => setStep((current) => Math.max(0, current - 1))}>
          {step === 0 ? "Отмена" : "Назад"}
        </Button>
        {step < 2 ? (
          <Button onClick={next}>Дальше</Button>
        ) : (
          <Button loading={submitting} onClick={() => void submit()}>
            Опубликовать результат
          </Button>
        )}
      </footer>
    </div>
  );
}
