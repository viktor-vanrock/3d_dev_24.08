import { extensionOf, isAcceptedExtension } from "./formats.ts";

export type ProjectSourceLevel = "simple" | "kit" | "smart" | "prepared";

export interface ProjectSourceSignal {
  id: string;
  label: string;
}

export interface ProjectSourceAnalysis {
  files: File[];
  primary: File | null;
  readme: File | null;
  title: string;
  level: ProjectSourceLevel;
  heading: string;
  summary: string;
  signals: ProjectSourceSignal[];
  paths: string[];
  folderName: string | null;
  hasPortalManifest: boolean;
  hasMakeReadme: boolean;
  shouldArchive: boolean;
}

const PRINT_EXTENSIONS = new Set(["stl", "3mf", "obj"]);
const CAD_EXTENSIONS = new Set(["step", "stp", "dxf", "svg"]);
const ELECTRONICS_EXTENSIONS = new Set(["kicad_pcb", "kicad_sch", "gbr", "gtl", "gbl", "drl", "ger"]);
const CODE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "ino",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "rs",
  "go",
  "java",
  "sh",
  "yaml",
  "yml",
  "json",
  "toml",
]);
const DOC_EXTENSIONS = new Set(["md", "mdx", "pdf", "txt"]);
const MEDIA_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm"]);

const PRIMARY_PRIORITY: Record<string, number> = {
  "3mf": 0,
  stl: 1,
  obj: 2,
  step: 3,
  stp: 3,
  dxf: 4,
  svg: 4,
  gcode: 5,
  nc: 5,
  gbr: 6,
  zip: 7,
};

function pathForFile(file: File): string {
  return (file.webkitRelativePath || file.name).replaceAll("\\", "/").replace(/^\/+/, "");
}

function isIgnoredPath(path: string): boolean {
  const lower = path.toLowerCase();
  const segments = lower.split("/");
  return (
    segments.includes(".git") ||
    segments.includes("__macosx") ||
    segments.some((segment) => segment === ".ds_store" || segment === "thumbs.db")
  );
}

function rootRelativePath(path: string, folderName: string | null): string {
  if (!folderName) return path;
  return path.startsWith(`${folderName}/`) ? path.slice(folderName.length + 1) : path;
}

function fileCountLabel(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} ${many}`;
  if (mod10 === 1) return `${count} ${one}`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} ${few}`;
  return `${count} ${many}`;
}

function titleFromSource(folderName: string | null, primary: File | null): string {
  const raw = folderName || primary?.name.replace(/\.[^.]+$/, "") || "Новый проект";
  return raw.replaceAll(/[-_]+/g, " ").trim().slice(0, 200);
}

export function analyzeProjectSource(source: FileList | File[]): ProjectSourceAnalysis {
  const incoming = Array.from(source);
  const files = incoming.filter((file) => !isIgnoredPath(pathForFile(file)));
  const firstPath = files[0] ? pathForFile(files[0]) : "";
  const folderName = firstPath.includes("/") ? firstPath.split("/")[0] ?? null : null;
  const entries = files.map((file) => {
    const path = pathForFile(file);
    return {
      file,
      path,
      relativePath: rootRelativePath(path, folderName),
      extension: extensionOf(file.name),
    };
  });

  const primary =
    entries
      .filter(({ file }) => isAcceptedExtension(file.name))
      .sort(
        (a, b) =>
          (PRIMARY_PRIORITY[a.extension] ?? Number.MAX_SAFE_INTEGER) -
            (PRIMARY_PRIORITY[b.extension] ?? Number.MAX_SAFE_INTEGER) ||
          a.relativePath.localeCompare(b.relativePath),
      )[0]?.file ?? null;

  const makeReadme =
    entries.find(({ relativePath }) => relativePath.toLowerCase() === "make/readme.md")?.file ?? null;
  const rootReadme = entries.find(({ relativePath }) => relativePath.toLowerCase() === "readme.md")?.file ?? null;
  const hasPortalManifest = entries.some(({ relativePath }) =>
    /^portal\.project\.ya?ml$/i.test(relativePath),
  );
  const hasMakeReadme = Boolean(makeReadme);
  const printCount = entries.filter(({ extension }) => PRINT_EXTENSIONS.has(extension)).length;
  const cadCount = entries.filter(({ extension }) => CAD_EXTENSIONS.has(extension)).length;
  const electronicsCount = entries.filter(
    ({ extension, relativePath }) =>
      ELECTRONICS_EXTENSIONS.has(extension) || relativePath.toLowerCase().startsWith("pcb/"),
  ).length;
  const codeCount = entries.filter(
    ({ extension, relativePath }) =>
      CODE_EXTENSIONS.has(extension) ||
      relativePath.toLowerCase().startsWith("code/") ||
      relativePath.toLowerCase().startsWith("firmware/"),
  ).length;
  const docsCount = entries.filter(({ extension }) => DOC_EXTENSIONS.has(extension)).length;
  const mediaCount = entries.filter(({ extension }) => MEDIA_EXTENSIONS.has(extension)).length;

  let level: ProjectSourceLevel = "simple";
  if (hasPortalManifest || hasMakeReadme) level = "prepared";
  else if (codeCount > 0 || electronicsCount > 0) level = "smart";
  else if (printCount > 1 || cadCount > 0 || docsCount > 0 || files.length > 1) level = "kit";

  const levelCopy: Record<ProjectSourceLevel, { heading: string; summary: string }> = {
    simple: {
      heading: "Простая печать",
      summary: "Нашли одну основу. Создадим лёгкую карточку без лишних настроек.",
    },
    kit: {
      heading: "Набор деталей",
      summary: "Нашли несколько исходников. После создания можно собрать из них комплект и инструкцию.",
    },
    smart: {
      heading: "Проект с кодом и электроникой",
      summary: "Нашли изготовление и цифровую часть. Portal предложит фазы печати, сборки и настройки.",
    },
    prepared: {
      heading: "Подготовлено для Portal",
      summary: "Нашли описание для витрины или машинный манифест. Используем их как основу проекта.",
    },
  };

  const signals: ProjectSourceSignal[] = [];
  if (printCount > 0) signals.push({ id: "print", label: fileCountLabel(printCount, "модель", "модели", "моделей") });
  if (cadCount > 0) signals.push({ id: "cad", label: fileCountLabel(cadCount, "чертёж", "чертежа", "чертежей") });
  if (electronicsCount > 0) signals.push({ id: "pcb", label: "электроника" });
  if (codeCount > 0) signals.push({ id: "code", label: "код" });
  if (mediaCount > 0) signals.push({ id: "media", label: fileCountLabel(mediaCount, "медиафайл", "медиафайла", "медиафайлов") });
  if (hasMakeReadme) signals.push({ id: "make-readme", label: "make/README" });
  if (hasPortalManifest) signals.push({ id: "manifest", label: "манифест Portal" });
  if (files.length > 1) signals.push({ id: "files", label: fileCountLabel(files.length, "файл", "файла", "файлов") });

  return {
    files,
    primary,
    readme: makeReadme ?? rootReadme,
    title: titleFromSource(folderName, primary),
    level,
    heading: levelCopy[level].heading,
    summary: levelCopy[level].summary,
    signals,
    paths: entries.slice(0, 4).map(({ relativePath }) => relativePath),
    folderName,
    hasPortalManifest,
    hasMakeReadme,
    shouldArchive: files.length > 1 && extensionOf(primary?.name ?? "") !== "zip",
  };
}
