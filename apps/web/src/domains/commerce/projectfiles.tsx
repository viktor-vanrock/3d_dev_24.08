// Блок «Файлы проекта» (docs/design/projects.md §3–4, MF-483): скачиваемые артефакты,
// сгруппированные по семантической роли. Ядро «проектности» витрины.
//
// Контракт данных — `files[]` из GET /models/:id (MF-501): `{ role, format, size_bytes }`,
// без preview/thumbnail. Блок опинионированно берёт из него ТОЛЬКО артефакт-роли ремёсел
// (реестр ниже) — служебные роли вроде aux/description_image в блок не тянем, даже если API
// их отдаёт: это витрина артефактов проекта, а не файловый дамп.
//
// Инвариант §3.2 (дремлет при одной роль-группе): типичная печатная модель (source [+ canonical_3mf])
// показывается как в v2 — primary «Скачать 3MF» + мета «Формат», отдельный блок НЕ рисуем. Блок
// «зажигается» только у мульти-артефактного проекта — когда есть роль вне печатной базы
// (ЧПУ/чертёж/плата/код). Всё от данных, без ручных флагов.
//
// Честность (§3.2/§4): не-печатные артефакты хранятся и скачиваются «как есть» — только «Скачать»,
// без «Открыть во вьюере»/«На станок»/конвертации, которых на MVP нет. Никаких упоминаний GitVerse
// в блоке «Код» (§4.1) — для пользователя это просто «файлы кода к проекту».
import { useMemo, useState } from "react";
import type { ProjectFile, RepoTreeEntry } from "./models.ts";
import { Eyebrow } from "@shared/ui";
import "./projectfiles.css";

// Печатная база: source + готовый 3MF — «одна содержательная роль-группа» (§3.2). Пока артефакты
// не выходят за неё, блок дремлет.
const PRINT_BASELINE = new Set<string>(["source", "canonical_3mf"]);

interface RoleMeta {
  label: string;
  order: number;
  Glyph: () => React.JSX.Element;
}

// Реестр ролей (§3.1): role → метка группы / порядок «по полезности потребителю» / глиф.
// Порядок: сначала «Готово к печати» (качают чаще), потом «Исходник», ремесло-специфичные,
// «Код» — последним (§3.2/§4). Ключи реестра = artifact-роли, которые блок показывает.
export const FILE_ROLE_REGISTRY: Record<string, RoleMeta> = {
  canonical_3mf: { label: "Готово к печати (3MF)", order: 1, Glyph: CubeGlyph },
  source: { label: "Исходник", order: 2, Glyph: FileGlyph },
  cnc_program: { label: "Программа ЧПУ", order: 3, Glyph: FileGlyph },
  drawing: { label: "Чертёж / раскрой", order: 4, Glyph: FileGlyph },
  gerber: { label: "Плата (Gerber)", order: 5, Glyph: FileGlyph },
  code_archive: { label: "Код", order: 6, Glyph: CodeGlyph },
};

function isArtifactRole(role: string): boolean {
  return role in FILE_ROLE_REGISTRY;
}

function roleMeta(role: string): RoleMeta {
  return FILE_ROLE_REGISTRY[role] ?? { label: role, order: 99, Glyph: FileGlyph };
}

// Строка файла: имени в контракте нет (API отдаёт role+format), поэтому идентификатор строки —
// формат в верхнем регистре (STL/NC/…); при отсутствии — метка роли.
function fileFormatLabel(file: ProjectFile): string {
  return file.format ? file.format.toUpperCase() : roleMeta(file.role).label;
}

// §3.2: блок появляется, когда у проекта есть артефакт вне печатной базы (source/canonical_3mf) —
// т.е. проект реально мульти-артефактный (печать + ЧПУ / + код и т.п.). Служебные роли API
// (aux/description_image/…) не учитываются — их в блоке нет. repo_url (дельта §4.2) сюда
// намеренно не входит — это отдельный, независимый триггер именно группы «Код» (см. ProjectFiles
// ниже), а не всей роль-разбивки: печатная модель с одним лишь repo_url не должна «просыпаться»
// как мульти-артефактная (осталась бы одна печатная роль-группа — инвариант §3.2 не про это).
export function shouldShowProjectFiles(files: ProjectFile[]): boolean {
  return files.some((f) => isArtifactRole(f.role) && !PRINT_BASELINE.has(f.role));
}

export interface FileRoleGroup {
  role: string;
  label: string;
  files: ProjectFile[];
}

// Группировка по роли + сортировка групп по «полезности» (§3.2). Только artifact-роли реестра.
export function groupFilesByRole(files: ProjectFile[]): FileRoleGroup[] {
  const byRole = new Map<string, ProjectFile[]>();
  for (const file of files) {
    if (!isArtifactRole(file.role)) continue;
    const list = byRole.get(file.role);
    if (list) list.push(file);
    else byRole.set(file.role, [file]);
  }
  return [...byRole.entries()]
    .map(([role, groupFiles]) => ({ role, label: roleMeta(role).label, files: groupFiles }))
    .sort((a, b) => roleMeta(a.role).order - roleMeta(b.role).order);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

// Строка-источник «репозиторий» (дельта §4.2 projects.multiformat.md, GAP-27): та же анатомия,
// что и файл-строка (глиф + имя + действие), но действие — переход, не скачивание. Человекочитаемое
// имя — host/path без схемы; длинный путь усекается до последних двух сегментов (user/repo).
export function humanizeRepoUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const path = segments.length > 2 ? segments.slice(-2).join("/") : segments.join("/");
    return path ? `${parsed.hostname}/${path}` : parsed.hostname;
  } catch {
    return url;
  }
}

function RepoRow({ url }: { url: string }) {
  return (
    <div className="projectFileRow">
      <span className="projectFileGlyph" aria-hidden="true">
        <RepoGlyph />
      </span>
      <span className="projectFileName">{humanizeRepoUrl(url)}</span>
      <a
        className="modelGlassBtn pressable projectFileBtn"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
      >
        Открыть
      </a>
    </div>
  );
}

// Дельта эпика «Проект = git» (docs/design/projects.page.md §11.2, MF-522): дерево репо и
// роль-группы — «одна проекция, не два конкурирующих UI». Верхний уровень дерева = ровно те же
// craft-папки, что и роль-группы выше (print/pcb/cad/code/docs) — регистр меток здесь короче
// (заголовок группы в дереве), чем FILE_ROLE_REGISTRY (там метки различают роли ВНУТРИ папки,
// например «Готово к печати (3MF)» vs «Исходник» — в дереве это одна папка `print/`).
const FOLDER_REGISTRY: Record<string, { label: string; order: number }> = {
  catalog: { label: "Каталог компонентов", order: 1 },
  print: { label: "Печать", order: 2 },
  bom: { label: "Комплектующие", order: 3 },
  cad: { label: "Чертежи", order: 4 },
  pcb: { label: "Плата", order: 5 },
  code: { label: "Код", order: 6 },
  software: { label: "Программы", order: 6 },
  docs: { label: "Документация", order: 7 },
};

// Маппинг role → craft-папка (Data, docs/epics/project.git.md §10.2, финал `cad/` §10.2.1).
// derived-роли (canonical_3mf/preview/thumbnail) сюда не попадают — их нет в git/дереве
// (repository.ts::REPO_BACKED_ROLES), маппинг им не нужен.
const ROLE_TO_FOLDER: Record<string, string> = {
  source: "print",
  aux: "print", // §10.2: «для живого MVP всегда print/» — единственное живое ремесло v1
  cnc_program: "cad",
  drawing: "cad",
  gerber: "pcb",
  code_archive: "code",
};

interface RepoTreeFile {
  name: string;
  path: string;
  sizeBytes: number | null;
  // Роль нужна только для действия «Скачать» (эндпоинт download.ts адресует файл по роли,
  // не по пути — GET /tree путей по ролям не отдаёт). null — роль не разрешилась однозначно
  // (см. resolveFileRole ниже), тогда строка рендерится без кнопки «Скачать» (честно, не
  // мёртвая ссылка), а не гадаем.
  role: string | null;
}

interface RepoTreeFolder {
  name: string;
  path: string;
  label?: string;
  order: number;
  folders: RepoTreeFolder[];
  files: RepoTreeFile[];
}

function groupProjectFilesByFolder(files: ProjectFile[]): Map<string, ProjectFile[]> {
  const byFolder = new Map<string, ProjectFile[]>();
  for (const file of files) {
    const folder = ROLE_TO_FOLDER[file.role];
    if (!folder) continue;
    const list = byFolder.get(folder);
    if (list) list.push(file);
    else byFolder.set(folder, [file]);
  }
  return byFolder;
}

// В v1 на роль почти всегда приходится один файл (Data, §10.2: «на роль в v1 — один файл»,
// N-файлов-на-роль — задел). Один кандидат в папке → роль однозначна; несколько — различаем
// по точному size_bytes (детерминированно: два разных файла с одинаковым байт-размером в одной
// папке — статистическая случайность, не системная коллизия). Не разрешилось — null, честно
// без действия «Скачать», а не наугад.
function resolveFileRole(entry: RepoTreeEntry, candidates: ProjectFile[]): string | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!.role;
  const bySize = candidates.filter((f) => f.size_bytes === entry.size_bytes);
  return bySize.length === 1 ? bySize[0]!.role : null;
}

function sortFolder(folder: RepoTreeFolder): void {
  folder.folders.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ru"));
  folder.files.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  folder.folders.forEach(sortFolder);
}

// Дерево репо = проекция путей GET /tree (docs/design/projects.page.md §11.2): верхний
// уровень — craft-папки (метка + путь-хинт), вложенность — рекурсивные узлы (не хардкод на
// два уровня). README.md в корне физически есть в дереве, но строкой-артефактом не рисуется
// (§10.3 — он уже показан как описание вверху страницы).
function buildRepoTree(entries: RepoTreeEntry[], files: ProjectFile[]): RepoTreeFolder[] {
  const filesByFolder = groupProjectFilesByFolder(files);
  const root: RepoTreeFolder = { name: "", path: "", order: 0, folders: [], files: [] };

  for (const entry of entries) {
    if (entry.path === "README.md") continue;
    const segments = entry.path.split("/");
    let node = root;
    for (let depth = 0; depth < segments.length - 1; depth++) {
      const name = segments[depth]!;
      const path = segments.slice(0, depth + 1).join("/");
      let child = node.folders.find((f) => f.name === name);
      if (!child) {
        const meta = depth === 0 ? FOLDER_REGISTRY[name] : undefined;
        child = { name, path, label: meta?.label, order: meta?.order ?? 50, folders: [], files: [] };
        node.folders.push(child);
      }
      node = child;
    }
    const filename = segments[segments.length - 1]!;
    const topFolder = segments[0]!;
    node.files.push({
      name: filename,
      path: entry.path,
      sizeBytes: entry.size_bytes,
      role: resolveFileRole(entry, filesByFolder.get(topFolder) ?? []),
    });
  }

  sortFolder(root);
  return root.folders;
}

function DisclosureChevron({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="repoTreeChevron" data-open={open || undefined}>
      <path d="m8 5 8 7-8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Строка-папка — disclosure (§11.2: «тап по папке разворачивает/сворачивает», ≥48px тач-таргет).
// Заголовок группы = ремесло-метка (глазами мейкера), путь — приглушённый вторичный хинт
// (глазами git-грамотного юзера) — для вложенных папок метки нет, только сегмент имени.
function RepoTreeFolderRow({
  folder,
  expanded,
  onToggle,
  onDownload,
}: {
  folder: RepoTreeFolder;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onDownload: (role: string) => void;
}) {
  const isOpen = expanded.has(folder.path);
  const Glyph = folder.name === "code" ? CodeGlyph : FileGlyph;
  return (
    <div className="repoTreeGroup">
      <button
        type="button"
        className="repoTreeFolderRow pressable"
        aria-expanded={isOpen}
        onClick={() => onToggle(folder.path)}
      >
        <DisclosureChevron open={isOpen} />
        <span className="repoTreeFolderLabel">{folder.label ?? folder.name}</span>
        <span className="repoTreeFolderPath">{folder.path}/</span>
      </button>
      {isOpen ? (
        <div className="repoTreeFolderBody">
          {folder.folders.map((child) => (
            <RepoTreeFolderRow key={child.path} folder={child} expanded={expanded} onToggle={onToggle} onDownload={onDownload} />
          ))}
          {folder.files.map((file) => (
            <div className="projectFileRow" key={file.path}>
              <span className="projectFileGlyph" aria-hidden="true">
                <Glyph />
              </span>
              <span className="projectFileName">{file.name}</span>
              <span className="projectFileSize">{file.sizeBytes != null ? formatFileSize(file.sizeBytes) : ""}</span>
              {file.role ? (
                <button
                  type="button"
                  className="modelGlassBtn pressable projectFileBtn"
                  onClick={() => onDownload(file.role!)}
                >
                  Скачать
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Дерево файлов репо (docs/design/projects.page.md §11.2, GET /models/:id/tree — MF-519/522):
// верхний уровень раскрыт по умолчанию, вложенные папки свёрнуты (§11.2).
function RepoTree({
  entries,
  files,
  repoUrl,
  onDownload,
}: {
  entries: RepoTreeEntry[];
  files: ProjectFile[];
  repoUrl: string;
  onDownload: (role: string) => void;
}) {
  const folders = useMemo(() => buildRepoTree(entries, files), [entries, files]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(folders.map((f) => f.path)));

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  if (folders.length === 0) return null;

  return (
    <div className="repoTree">
      <div className="repoTreeTopbar">
        <span className="repoTreeBranch">
          <RepoGlyph />
          main
        </span>
        <span>{entries.length} объектов</span>
        <a href={repoUrl} target="_blank" rel="noopener noreferrer" className="pressable">
          Открыть GitHub
        </a>
      </div>
      {folders.map((folder) => (
        <RepoTreeFolderRow key={folder.path} folder={folder} expanded={expanded} onToggle={toggle} onDownload={onDownload} />
      ))}
    </div>
  );
}

// Блок «Файлы проекта» + группа «Код» (docs/design/projects.md §4, дельта §4.2, §11 git-эпика).
// Один зелёный primary на кадр — у страницы модели он уже наверху («Скачать 3MF», §3.4 v2); все
// строки блока — нейтральное стекло (инвариант §6.6). Группа «Код» — независимый триггер:
// repo_url «зажигает» её даже у чисто печатного проекта без вложения code_archive (§4.2).
//
// `tree` (§11.2): когда проект уже смигрирован на git (`source: 'git'`) — рендерим реальное
// дерево репо (пути/имена файлов, вложенные папки) вместо плоских роль-групп; немигрированный
// проект (`fallback`/отсутствующий tree) — старое role-based представление без изменений.
export function ProjectFiles({
  files,
  repoUrl,
  tree,
  onDownload,
  onDownloadByRole,
  onDownloadAll,
}: {
  files: ProjectFile[];
  repoUrl?: string | null;
  tree?: { source: "git" | "fallback"; entries: RepoTreeEntry[] } | null;
  onDownload: (file: ProjectFile) => void;
  // Действие «Скачать» из дерева репо адресует файл по роли (как и role-based рендер выше) —
  // тот же контракт, что onDownload(file), просто без остальных полей ProjectFile под рукой.
  onDownloadByRole?: (role: string) => void;
  onDownloadAll?: () => void;
}) {
  const showFileGroups = shouldShowProjectFiles(files);
  const groups = showFileGroups ? groupFilesByRole(files) : [];
  const hasCodeGroup = groups.some((group) => group.role === "code_archive");
  const showRepoRow = !!repoUrl;
  const showRepoTree = showFileGroups && tree?.source === "git" && tree.entries.length > 0;
  if (!showFileGroups && !showRepoRow) return null;

  return (
    <section className="projectFiles" aria-label="Файлы проекта">
      <div className="projectFilesHead">
        <Eyebrow>Файлы проекта</Eyebrow>
        {onDownloadAll ? (
          <button type="button" className="modelGlassBtn pressable projectFilesDownloadAll" onClick={onDownloadAll}>
            Скачать весь проект
          </button>
        ) : null}
      </div>
      <div className="projectFilesGroups">
        {showRepoTree ? (
          <RepoTree
            entries={tree.entries}
            files={files}
            repoUrl={repoUrl!}
            onDownload={onDownloadByRole ?? (() => {})}
          />
        ) : (
          groups.map((group) => {
            const Glyph = roleMeta(group.role).Glyph;
            return (
              <div className="projectFilesGroup" key={group.role}>
                <div className="projectFilesGroupLabel">{group.label}</div>
                {group.role === "code_archive" && showRepoRow ? <RepoRow url={repoUrl!} /> : null}
                {group.files.map((file, index) => (
                  <div className="projectFileRow" key={`${file.role}-${file.format ?? "x"}-${index}`}>
                    <span className="projectFileGlyph" aria-hidden="true">
                      <Glyph />
                    </span>
                    <span className="projectFileName">{fileFormatLabel(file)}</span>
                    <span className="projectFileSize">{formatFileSize(file.size_bytes)}</span>
                    <button type="button" className="modelGlassBtn pressable projectFileBtn" onClick={() => onDownload(file)}>
                      Скачать
                    </button>
                  </div>
                ))}
              </div>
            );
          })
        )}
        {showRepoRow && !hasCodeGroup ? (
          <div className="projectFilesGroup" key="code_repo_only">
            <div className="projectFilesGroupLabel">Код</div>
            <RepoRow url={repoUrl!} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function RepoGlyph() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="7" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="7" cy="18" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 8.2V15.8M8.9 10.5C10.6 9 13.3 9 15 10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 3h8l4 4v14H6zM14 3v4h4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function CubeGlyph() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m0 9v-9m0 0L4 7.5M12 12l8-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function CodeGlyph() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m9 8-4 4 4 4m6-8 4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
