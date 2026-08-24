import { useEffect, useRef, useState, type DragEvent } from "react";
import type { OverlayApi } from "@platform/overlay";
import { fetchPopularMaterials, searchMaterials, type CatalogMaterial } from "@shared/lib";
import { ACCEPT_EXTENSIONS, CLASS_META, classForFilename, FORMATS_HINT, isAcceptedExtension } from "./formats.ts";
import { MarkdownEditor } from "./markdown.tsx";
import { analyzeProjectSource, type ProjectSourceAnalysis } from "./projectsource.ts";
import {
  AuxFileError,
  deleteAuxFile,
  listTags,
  updateModel,
  uploadAuxFile,
  UploadError,
  uploadModel,
  type AuxFile,
  type AuxFileErrorCode,
} from "./models.ts";
import { StatusPill } from "@shared/ui";

// Модалка добавления/редактирования проекта (docs/design/marketplace.v2.md §3, §11; дельта
// мультиформата — docs/design/projects.multiformat.md §2.2/§4.1): create → дропзона (два класса
// приёма) → поля → прогресс → шаг «Публикация» (превью полей + репо-ссылка, Опубликовать/Позже) →
// закрытие + редирект на страницу проекта. edit → те же поля без дропзоны, «Сохранить» → PATCH.

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_TAGS = 8;

const ERROR_UNSUPPORTED = "Формат не поддерживается. Принимаем STL, 3MF, STEP, DXF/SVG, G-code, Gerber, ZIP-архив.";
const ERROR_MISMATCH = "Содержимое файла не совпадает с расширением. Загрузите настоящий файл этого формата.";
const ERROR_TOO_LARGE = "Файл больше 100 МБ. Уменьшите файл или сожмите.";
const ERROR_ARCHIVE = "Не удалось прочитать архив. Проверьте, что это корректный ZIP.";
const ERROR_EMPTY_TITLE = "Введите название проекта.";
const ERROR_NETWORK = "Не удалось загрузить. Проверьте связь и попробуйте снова.";
const ERROR_REPO_URL = "Нужна ссылка вида https://…";

function isAllowedFile(file: File): boolean {
  return isAcceptedExtension(file.name);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function isValidRepoUrl(value: string): boolean {
  if (!value) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

// Чип-инпут тегов: Enter/запятая коммитит тег, клик по подсказке — тоже; до MAX_TAGS штук.
function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function commit(raw: string) {
    const cleaned = raw.trim().toLowerCase().slice(0, 40);
    if (!cleaned || tags.includes(cleaned) || tags.length >= MAX_TAGS) return;
    onChange([...tags, cleaned]);
    setValue("");
    setSuggestions([]);
  }

  function remove(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function onInputChange(raw: string) {
    if (raw.endsWith(",")) {
      commit(raw.slice(0, -1));
      return;
    }
    setValue(raw);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!raw.trim()) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void listTags(raw.trim()).then((result) => setSuggestions(result.filter((t) => !tags.includes(t))));
    }, 200);
  }

  return (
    <div className="marketTagInput">
      <div className="marketTagInputFieldWrap">
        {tags.length < MAX_TAGS ? (
          <input
            className="marketTagInputField"
            value={value}
            placeholder={tags.length === 0 ? "Начните вводить тег" : "Ещё тег"}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit(value);
              }
              if (event.key === "Backspace" && !value && tags.length > 0) {
                remove(tags[tags.length - 1]!);
              }
            }}
          />
        ) : null}
        {suggestions.length > 0 ? (
          <div className="marketTagSuggestions">
            {suggestions.map((tag) => (
              <button key={tag} type="button" className="marketTagSuggestion pressable" onClick={() => commit(tag)}>
                {tag}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {tags.length > 0 ? (
        <div className="marketTagList" aria-label="Выбранные теги">
          {tags.map((tag) => (
            <span key={tag} className="marketTagChip">
              {tag}
              <button type="button" className="pressable" onClick={() => remove(tag)} aria-label={`Убрать тег ${tag}`}>
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Поле «Репозиторий» (§4.1) — https-URL, необязательное, инвариантно к режиму create/edit.
function RepoUrlField({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [touched, setTouched] = useState(false);
  const invalid = touched && !isValidRepoUrl(value.trim());
  return (
    <div className="marketField">
      <label className="marketFieldLabel" htmlFor="marketRepoUrlInput">
        Репозиторий (необязательно)
      </label>
      <input
        id="marketRepoUrlInput"
        className="marketInput"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setTouched(true)}
        placeholder="https://gitverse.ru/user/repo"
        disabled={disabled}
      />
      {invalid ? (
        <div className="marketFieldError" data-tone="warn">
          {ERROR_REPO_URL}
        </div>
      ) : (
        <div className="marketFieldHint">Ссылка на репозиторий проекта. Откроется в новой вкладке — без синхронизации.</div>
      )}
    </div>
  );
}

const MATERIAL_SEARCH_DEBOUNCE_MS = 250;

// Тот же приём дедупа бренда, что printerpicker.tsx::printerLabel — каталог филамента (MF-624)
// тоже часто несёт бренд внутри name (напр. name="REC PLA" при vendor.name="REC").
function materialLabel(material: CatalogMaterial): string {
  if (material.brand && material.name.toLowerCase().includes(material.brand.toLowerCase())) return material.name;
  return `${material.brand} ${material.name}`.trim();
}

// Пикер «Рекомендованный филамент» (MF-404 § модель↔рекомендованный филамент, MF-10) — тот же
// поисковый паттерн, что PrinterPicker (home/printerpicker.tsx): популярные чипы + дебаунс-поиск
// по каталогу (MF-624), но проще — без «ручного добавления» (рекомендация не обязана существовать
// вне каталога, в отличие от «мой принтер»). Только в режиме edit, как и RepoUrlField.
function RecommendedMaterialField({
  value,
  onChange,
  disabled,
}: {
  value: CatalogMaterial | null;
  onChange: (material: CatalogMaterial | null) => void;
  disabled?: boolean;
}) {
  const [popular, setPopular] = useState<CatalogMaterial[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogMaterial[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchPopularMaterials().then(setPopular);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      searchMaterials(query).then(setResults);
    }, MATERIAL_SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const shown = query.trim() ? results : popular;

  return (
    <div className="marketField">
      <span className="marketFieldLabel">Рекомендованный филамент (необязательно)</span>
      {value ? (
        <div className="marketCompactChoiceRow">
          <button type="button" className="marketCompactChip pressable" data-selected="true" disabled={disabled}>
            {materialLabel(value)}
          </button>
          <button
            type="button"
            className="marketCompactRemove pressable"
            onClick={() => onChange(null)}
            disabled={disabled}
            aria-label="Убрать рекомендованный филамент"
          >
            ✕
          </button>
        </div>
      ) : (
        <>
          <input
            className="marketInput"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти филамент по названию"
            disabled={disabled}
          />
          {shown.length > 0 ? (
            <div className="marketCompactChipGrid">
              {shown.map((material) => (
                <button
                  key={material.id}
                  type="button"
                  className="marketCompactChip pressable"
                  onClick={() => {
                    onChange(material);
                    setQuery("");
                    setResults([]);
                  }}
                >
                  {materialLabel(material)}
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
      <div className="marketFieldHint">Подсказка на карточке: каким филаментом лучше печатать эту модель.</div>
    </div>
  );
}

const AUX_ERROR_MESSAGES: Record<AuxFileErrorCode, string> = {
  FILENAME_REQUIRED: "Не удалось прочитать имя файла.",
  EMPTY_FILE: "Файл пустой.",
  FILE_TOO_LARGE: "Файл больше 100 МБ, уменьшите файл.",
  FILENAME_CONFLICT: "Файл с таким именем уже есть в проекте.",
  REPO_NOT_READY: "Проект ещё готовится — попробуйте через минуту.",
  REPO_TOO_LARGE: "Проект превысил допустимый размер репозитория.",
  unauthorized: "Сессия истекла — обновите страницу.",
  forbidden: "Нет доступа к этому проекту.",
  not_found: "Проект не найден.",
  network: "Не удалось загрузить. Проверьте связь и попробуйте снова.",
  unknown: "Не удалось загрузить файл.",
};

// Доп-файлы проекта (роль aux, MF-339 шаг 2 / MF-341, docs/epics/project.git.md §10.2):
// любой формат «как есть» (чертежи, инструкции, доп-модели) — git-контракт, не картинки
// описания (те — MarkdownEditor выше, отдельная роль description_image). Только режим edit:
// грузить некуда, пока модели не существует (repo_path проставляется сразу после POST /models,
// см. upload.ts, но id карточки появляется только на шаге «Публикация»/после сохранения).
function AuxFilesField({
  modelId,
  files,
  onChange,
  disabled,
}: {
  modelId: string;
  files: AuxFile[];
  onChange: (files: AuxFile[]) => void;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handlePicked(fileList: FileList | null) {
    const picked = fileList?.[0] ?? null;
    if (inputRef.current) inputRef.current.value = "";
    if (!picked || uploading) return;
    setError(null);
    setUploading(true);
    try {
      const uploaded = await uploadAuxFile(modelId, picked);
      // Повторная загрузка того же имени обновляет существующую строку на месте (files.ts) —
      // зеркалим на фронте, чтобы список не задваивался.
      onChange([...files.filter((f) => f.id !== uploaded.id), uploaded]);
    } catch (err) {
      const code = err instanceof AuxFileError ? err.code : "unknown";
      setError(AUX_ERROR_MESSAGES[code]);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(fileId: string) {
    if (deletingId) return;
    setError(null);
    setDeletingId(fileId);
    const ok = await deleteAuxFile(modelId, fileId);
    setDeletingId(null);
    if (!ok) {
      setError("Не удалось удалить файл.");
      return;
    }
    onChange(files.filter((f) => f.id !== fileId));
  }

  return (
    <div className="marketField">
      <span className="marketFieldLabel">Доп. файлы (необязательно)</span>
      {files.map((f) => (
        <div key={f.id} className="marketFileRow">
          <span className="marketFileRowName">{f.original_filename}</span>
          <span className="marketFileRowSize">{formatBytes(f.size_bytes)}</span>
          <button
            type="button"
            className="pressable"
            onClick={() => void handleDelete(f.id)}
            disabled={disabled || deletingId === f.id}
            aria-label={`Удалить ${f.original_filename}`}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="marketTagSuggestion pressable"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading}
      >
        {uploading ? "Загрузка…" : "+ Добавить файл"}
      </button>
      <input
        ref={inputRef}
        type="file"
        data-testid="auxFileInput"
        style={{ display: "none" }}
        onChange={(event) => void handlePicked(event.target.files)}
      />
      {error ? <div className="marketFieldError">{error}</div> : null}
      <div className="marketFieldHint">Чертежи, инструкции, доп-модели — любой формат, до 100 МБ.</div>
    </div>
  );
}

export interface EditableModel {
  id: string;
  title: string;
  description: string | null;
  tags: string[];
  repo_url: string | null;
  recommended_material: { id: string; name: string; brand: string } | null;
  auxFiles: AuxFile[];
}

export function AddModelFlow({
  overlay,
  mode = "create",
  model,
  onClose,
  onUploaded,
  onSaved,
  onRepoImport,
}: {
  overlay: OverlayApi;
  mode?: "create" | "edit";
  model?: EditableModel;
  onClose: () => void;
  onUploaded?: (modelId: string) => void;
  onSaved?: () => void;
  onRepoImport?: (repoUrl: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [sourceAnalysis, setSourceAnalysis] = useState<ProjectSourceAnalysis | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [title, setTitle] = useState(model?.title ?? "");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [description, setDescription] = useState(model?.description ?? "");
  const [tags, setTags] = useState<string[]>(model?.tags ?? []);
  const [repoUrl, setRepoUrl] = useState(model?.repo_url ?? "");
  const [recommendedMaterial, setRecommendedMaterial] = useState<CatalogMaterial | null>(
    model?.recommended_material
      ? { id: model.recommended_material.id, name: model.recommended_material.name, brand: model.recommended_material.brand, materialType: "" }
      : null,
  );
  const [auxFiles, setAuxFiles] = useState<AuxFile[]>(model?.auxFiles ?? []);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploading = progress !== null;
  const fileClass = file ? classForFilename(file.name) : null;

  function resetSource() {
    if (uploading) return;
    setFile(null);
    setSourceFiles([]);
    setSourceAnalysis(null);
    setFileError(null);
    if (inputRef.current) inputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  }

  function pickFiles(candidates: FileList | File[] | null | undefined) {
    if (!candidates || candidates.length === 0 || uploading) return;
    const analysis = analyzeProjectSource(candidates);
    setSourceFiles(analysis.files);
    setSourceAnalysis(analysis);
    setFile(analysis.primary);
    setTitle((current) => current || analysis.title);

    if (!analysis.primary) {
      setFileError("Мы разобрали папку, но не нашли основу. Добавьте STL, 3MF, STEP или ZIP-архив.");
      return;
    }
    if (!isAllowedFile(analysis.primary)) {
      setFileError(ERROR_UNSUPPORTED);
      return;
    }
    if (analysis.primary.size > MAX_BYTES) {
      setFileError(ERROR_TOO_LARGE);
      return;
    }
    setFileError(null);

    if (analysis.readme && analysis.readme.size <= 256 * 1024) {
      void analysis.readme.text().then((readme) => {
        setDescription((current) => current || readme.slice(0, 50_000));
      });
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    pickFiles(event.dataTransfer.files);
  }

  async function handleUpload() {
    if (!file || uploading) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleError(ERROR_EMPTY_TITLE);
      return;
    }
    setTitleError(null);
    setProgress(0);
    // Прогресс-тост (MF-9/443, docs/epics/overlay.system.md §6) — .update() по тикам,
    // рядом с инлайн-баром формы: полезен, если юзер свернёт/уйдёт со шага загрузки.
    const progressToast = overlay.toast({ severity: "info", title: `Загрузка «${trimmedTitle}»`, message: "0%", duration: "sticky" });
    try {
      const uploaded = await uploadModel(
        file,
        { title: trimmedTitle, description: description.trim(), tags, repo_url: repoUrl.trim() || undefined },
        (fraction) => {
          setProgress(fraction);
          progressToast.update({ message: `${Math.round(fraction * 100)}%` });
        },
      );
      progressToast.dismiss();
      const cls = classForFilename(file.name);
      overlay.toast({ severity: "success", title: cls ? CLASS_META[cls].uploadedToast : "Проект загружен" });
      setCreatedId(uploaded.id);
    } catch (err) {
      progressToast.dismiss();
      setProgress(null);
      if (err instanceof UploadError && (err.code === "UNSUPPORTED_FORMAT" || err.code === "FORMAT_MISMATCH")) {
        setFileError(err.code === "FORMAT_MISMATCH" ? ERROR_MISMATCH : ERROR_UNSUPPORTED);
        return;
      }
      if (err instanceof UploadError && err.code === "FILE_TOO_LARGE") {
        setFileError(ERROR_TOO_LARGE);
        return;
      }
      if (err instanceof UploadError && err.code === "DECOMPRESSION_LIMIT") {
        setFileError(ERROR_ARCHIVE);
        return;
      }
      overlay.toast({
        severity: "critical",
        title: "Не удалось загрузить",
        message: ERROR_NETWORK,
        duration: "sticky",
        action: { label: "Повторить", onAction: () => void handleUpload() },
      });
    }
  }

  async function handleSave() {
    if (!model || saving) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleError(ERROR_EMPTY_TITLE);
      return;
    }
    const trimmedRepo = repoUrl.trim();
    if (!isValidRepoUrl(trimmedRepo)) return;
    setSaving(true);
    const ok = await updateModel(model.id, {
      title: trimmedTitle,
      description: description.trim(),
      tags,
      repo_url: trimmedRepo || null,
      recommended_material_id: recommendedMaterial?.id ?? null,
    });
    setSaving(false);
    if (!ok) {
      overlay.toast({ severity: "critical", title: "Не удалось сохранить", message: ERROR_NETWORK });
      return;
    }
    onSaved?.();
  }

  async function handlePublish(redirect: boolean) {
    if (!createdId || saving) return;
    const trimmedRepo = repoUrl.trim();
    if (!isValidRepoUrl(trimmedRepo)) return;
    setSaving(true);
    await updateModel(createdId, { title: title.trim(), description: description.trim(), tags, repo_url: trimmedRepo || null });
    setSaving(false);
    if (redirect) onUploaded?.(createdId);
    else onClose();
  }

  // Шаг «Публикация» — после успешной загрузки: превью полей + Опубликовать/Позже.
  if (createdId) {
    return (
      <div className="marketAddFlow">
        <div className="marketPublishIntro">Проект загружен. Проверьте карточку перед публикацией.</div>

        <div className="marketField">
          <label className="marketFieldLabel" htmlFor="marketPublishTitle">
            Название
          </label>
          <input
            id="marketPublishTitle"
            className="marketInput"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
          />
        </div>

        <MarkdownEditor id="marketPublishDescription" value={description} onChange={setDescription} modelId={createdId ?? undefined} />

        <RepoUrlField value={repoUrl} onChange={setRepoUrl} />

        <div className="marketField">
          <span className="marketFieldLabel">Теги</span>
          <TagInput tags={tags} onChange={setTags} />
        </div>

        <div className="ovlModalActions">
          <button type="button" className="ovlModalCancel pressable" onClick={() => void handlePublish(false)} disabled={saving}>
            Позже
          </button>
          <button type="button" className="ovlModalConfirm pressable" onClick={() => void handlePublish(true)} disabled={saving}>
            Опубликовать
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="marketAddFlow">
      {mode === "create" ? (
        !sourceAnalysis ? (
          <div
            className="marketDropzone"
            data-drag={dragOver || undefined}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <strong>Добавьте то, что уже есть</strong>
            <span>Один файл, несколько исходников или целая папка — разберём состав здесь, на устройстве.</span>
            <div className="marketSourceActions">
              <button type="button" className="ovlModalConfirm pressable" onClick={() => inputRef.current?.click()}>
                Выбрать файлы
              </button>
              <button type="button" className="ovlModalCancel pressable" onClick={() => folderInputRef.current?.click()}>
                Проверить папку
              </button>
            </div>
            <span className="marketDropzoneHint">{FORMATS_HINT}</span>
          </div>
        ) : (
          <div className="marketSourceResult" data-level={sourceAnalysis.level}>
            <div className="marketSourceResultTop">
              <div>
                <span>Portal распознал</span>
                <strong>{sourceAnalysis.heading}</strong>
              </div>
              {!uploading ? (
                <button type="button" className="marketSourceReset pressable" onClick={resetSource}>
                  Заменить
                </button>
              ) : null}
            </div>
            <p>{sourceAnalysis.summary}</p>
            {sourceAnalysis.signals.length > 0 ? (
              <div className="marketSourceSignals" aria-label="Что найдено">
                {sourceAnalysis.signals.map((signal) => (
                  <span key={signal.id}>{signal.label}</span>
                ))}
              </div>
            ) : null}
            {sourceAnalysis.paths.length > 0 ? (
              <div className="marketSourcePaths">
                {sourceAnalysis.paths.map((path) => (
                  <code key={path}>{path}</code>
                ))}
                {sourceFiles.length > sourceAnalysis.paths.length ? (
                  <small>и ещё {sourceFiles.length - sourceAnalysis.paths.length}</small>
                ) : null}
              </div>
            ) : null}
            {file ? (
              <div className="marketFileRow">
                <span className="marketFileRowName">{file.name}</span>
                <span className="marketFileRowSize">{formatBytes(file.size)}</span>
                {fileClass ? <StatusPill tone="dim">{CLASS_META[fileClass].chip}</StatusPill> : null}
              </div>
            ) : null}
            {sourceAnalysis.shouldArchive ? (
              <div className="marketSourceNotice">
                Сейчас основой станет «{file?.name ?? "выбранный файл"}». Чтобы сохранить дерево папок без потерь,
                загрузите ZIP или привяжите Git-репозиторий.
              </div>
            ) : null}
          </div>
        )
      ) : null}
      {mode === "create" && file && fileClass === "as_is" ? (
        <div className="marketFieldHint">{CLASS_META.as_is.hint}</div>
      ) : null}
      {mode === "create" ? (
        <input
          ref={inputRef}
          type="file"
          data-testid="projectSourceInput"
          accept={ACCEPT_EXTENSIONS}
          multiple
          style={{ display: "none" }}
          onChange={(event) => pickFiles(event.target.files)}
        />
      ) : null}
      {mode === "create" ? (
        <input
          ref={(node) => {
            folderInputRef.current = node;
            if (node) node.setAttribute("webkitdirectory", "");
          }}
          type="file"
          data-testid="projectFolderInput"
          multiple
          style={{ display: "none" }}
          onChange={(event) => pickFiles(event.target.files)}
        />
      ) : null}
      {fileError ? <div className="marketFieldError">{fileError}</div> : null}

      {mode === "create" && !sourceAnalysis ? (
        <details className="marketSourceGit" open>
          <summary>Проект уже лежит в Git?</summary>
          <RepoUrlField value={repoUrl} onChange={setRepoUrl} disabled={saving} />
          <p>Portal прочитает структуру, ветки и файлы, а затем предложит варианты сборки. Ничего не публикуется автоматически.</p>
          <button
            type="button"
            className="ovlModalConfirm pressable marketRepoImport"
            disabled={!repoUrl.trim() || !isValidRepoUrl(repoUrl.trim()) || saving}
            onClick={() => onRepoImport?.(repoUrl.trim())}
          >
            Разобрать репозиторий
          </button>
          <button
            type="button"
            className="marketRepoExample pressable"
            onClick={() => setRepoUrl("https://github.com/TheRobotStudio/SO-ARM100")}
          >
            Подставить тестовый SO‑ARM100
          </button>
        </details>
      ) : null}

      {mode === "edit" || sourceAnalysis ? (
        <>
          <div className="marketField">
            <label className="marketFieldLabel" htmlFor="marketTitleInput">
              Название
            </label>
            <input
              id="marketTitleInput"
              className="marketInput"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (titleError) setTitleError(null);
              }}
              maxLength={200}
              disabled={uploading || saving}
            />
            {titleError ? (
              <div className="marketFieldError" data-tone="warn">
                {titleError}
              </div>
            ) : null}
          </div>

          {mode === "create" ? (
            <details className="marketSourceMore" open={sourceAnalysis?.level !== "simple"}>
              <summary>
                <span>Дополнить карточку</span>
                <small>{description ? "Описание уже найдено" : "Можно сделать позже"}</small>
              </summary>
              <div className="marketSourceMoreBody">
                <MarkdownEditor
                  id="marketDescriptionInput"
                  value={description}
                  onChange={setDescription}
                  disabled={uploading || saving}
                />
                <RepoUrlField value={repoUrl} onChange={setRepoUrl} disabled={saving} />
                <div className="marketField">
                  <span className="marketFieldLabel">Теги</span>
                  <TagInput tags={tags} onChange={setTags} />
                </div>
              </div>
            </details>
          ) : (
            <MarkdownEditor
              id="marketDescriptionInput"
              value={description}
              onChange={setDescription}
              disabled={uploading || saving}
              modelId={model?.id}
            />
          )}
        </>
      ) : null}

      {mode === "edit" ? <RepoUrlField value={repoUrl} onChange={setRepoUrl} disabled={saving} /> : null}
      {mode === "edit" ? (
        <RecommendedMaterialField value={recommendedMaterial} onChange={setRecommendedMaterial} disabled={saving} />
      ) : null}
      {mode === "edit" && model ? (
        <AuxFilesField modelId={model.id} files={auxFiles} onChange={setAuxFiles} disabled={saving} />
      ) : null}

      {mode === "edit" ? (
        <div className="marketField">
          <span className="marketFieldLabel">Теги</span>
          <TagInput tags={tags} onChange={setTags} />
        </div>
      ) : null}

      {uploading ? (
        <div className="marketProgress">
          <div className="uiChecklistBar">
            <div className="uiChecklistBarFill" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
          </div>
          <div className="marketProgressLine">
            {file?.name} · {Math.round((progress ?? 0) * 100)}% · загрузка
          </div>
        </div>
      ) : null}

      <div className="ovlModalActions">
        <button type="button" className="ovlModalCancel pressable" onClick={onClose} disabled={uploading || saving}>
          Отмена
        </button>
        {mode === "create" ? (
          <button
            type="button"
            className="ovlModalConfirm pressable"
            onClick={() => void handleUpload()}
            disabled={!file || uploading}
          >
            Создать черновик
          </button>
        ) : (
          <button type="button" className="ovlModalConfirm pressable" onClick={() => void handleSave()} disabled={saving}>
            Сохранить
          </button>
        )}
      </div>
    </div>
  );
}
