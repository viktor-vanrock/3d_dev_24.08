// Валидатор мультиформата (MF-501, стадия 2 эпика MF-497): детект по magic-байтам вместо
// доверия расширению (долг §7 docs/epics/formats.policy.md v0.2). Та же логика, что спайк
// Mesh (`apps/mesh/tests/format_detect_spike.py`, карточка MF-500) — портирована на
// TypeScript, не переизобретена: сигнатуры/эвристики/пороги совпадают с policy-таблицей §1.

import { inflateRawSync } from "node:zlib";

export const SOURCE_FORMATS = ["stl", "obj", "3mf", "step", "dxf", "svg", "gcode", "gerber", "zip"] as const;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];
export type FormatClass = "pipeline" | "as_is";
export type FileRole = "source" | "aux" | "drawing" | "cnc_program" | "gerber" | "code_archive";

// Роли model_files, которые показываются пользователю как «файлы проекта» (docs/design/
// projects.md §3, apps/web ROLE_DOWNLOAD_ROLES + aux/project_doc) — считаются в GET /models
// project_summary.file_count (list.ts). Дериватив-роли (canonical_3mf/preview/thumbnail/
// mobile_preview/stl_derivative) и description_image сюда сознательно не входят — это не файлы,
// которые автор «положил в проект», а служебные ассеты конвейера/презентации.
export const PROJECT_FILE_ROLES = ["source", "aux", "drawing", "cnc_program", "gerber", "code_archive", "project_doc"] as const;

export class UnsupportedFormatError extends Error {
  constructor(message = "file extension is outside the whitelist") {
    super(message);
    this.name = "UnsupportedFormatError";
  }
}

export class FormatMismatchError extends Error {
  constructor(message = "file content does not match its extension") {
    super(message);
    this.name = "FormatMismatchError";
  }
}

export class DecompressionLimitError extends Error {
  constructor(public readonly reason: string) {
    super(`zip container exceeds safety limit: ${reason}`);
    this.name = "DecompressionLimitError";
  }
}

// Таксономия ошибок upload (docs/epics/formats.policy.md §6, MF-377 Фаза 3 п.3 «Готово
// когда»): единственное место, где строки `UNSUPPORTED_FORMAT`/`FORMAT_MISMATCH`/
// `FILE_TOO_LARGE`/`DECOMPRESSION_LIMIT` объявлены как значения — до этого модуля они
// были литералами, независимо повторёнными в upload.ts/attachments.ts/files.ts/
// descriptionimage.ts (риск разъехаться опечаткой без подсказки тайпчекера). CORRUPT/
// TESSELLATION_FAILED — уровень конвейера apps/mesh (ошибка конвертации, не приёма),
// вне этого контракта (policy §6), сюда не входят.
export const FORMAT_ERROR_CODE = {
  UNSUPPORTED_FORMAT: "UNSUPPORTED_FORMAT",
  FORMAT_MISMATCH: "FORMAT_MISMATCH",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  DECOMPRESSION_LIMIT: "DECOMPRESSION_LIMIT",
} as const;

export type FormatErrorCode = (typeof FORMAT_ERROR_CODE)[keyof typeof FORMAT_ERROR_CODE];

// Человекочитаемый текст с подсказкой «экспортируй в STL/3MF» (policy §6/MF-377 п.3) —
// каноническая формулировка на репо. Экспортирован для будущего использования в теле
// ответа/фронте; сегодня HTTP-эндпоинты ниже продолжают отдавать только `{error: <code>}`
// (менять форму ответа — отдельный шаг, синхронизированный с apps/web/src/market/models.ts,
// где эти коды уже маппятся на свой текст на клиенте) — здесь фиксируется единственный
// источник правды для текста, не дублирующий формулировку по каждому call-сайту.
export const FORMAT_ERROR_MESSAGE: Record<FormatErrorCode, string> = {
  UNSUPPORTED_FORMAT: "Формат файла не поддерживается платформой. Экспортируйте модель в STL или 3MF и попробуйте снова.",
  FORMAT_MISMATCH: "Содержимое файла не совпадает с его расширением. Экспортируйте модель в STL или 3MF и попробуйте снова.",
  FILE_TOO_LARGE: "Файл превышает допустимый размер.",
  DECOMPRESSION_LIMIT: "Архив превышает допустимые лимиты распаковки — слишком много файлов или слишком высокая степень сжатия.",
};

// Расширение → формат (§1.1 policy v0.2). 'zip' покрывает и Gerber-набор, и архив кода —
// гетерогенный контейнер, роль выбирает слот загрузки (design projects.multiformat.md §2.4),
// не сами байты (см. resolveZipRole ниже).
const EXTENSION_TO_FORMAT: Record<string, SourceFormat> = {
  stl: "stl",
  obj: "obj",
  "3mf": "3mf",
  step: "step",
  stp: "step",
  dxf: "dxf",
  svg: "svg",
  gcode: "gcode",
  g: "gcode",
  nc: "gcode",
  tap: "gcode",
  cnc: "gcode",
  gbr: "gerber",
  gtl: "gerber",
  gbl: "gerber",
  gto: "gerber",
  gbo: "gerber",
  gts: "gerber",
  gbs: "gerber",
  gko: "gerber",
  drl: "gerber",
  ger: "gerber",
  zip: "zip",
};

export const FORMAT_CLASS: Record<SourceFormat, FormatClass> = {
  stl: "pipeline",
  obj: "pipeline",
  "3mf": "pipeline",
  step: "as_is",
  dxf: "as_is",
  svg: "as_is",
  gcode: "as_is",
  gerber: "as_is",
  zip: "as_is",
};

// Роль `model_files` (§1.1/§1.4 policy v0.2, вердикт Data MF-499): 'zip' сознательно
// исключён — см. resolveZipRole.
const FORMAT_ROLE: Record<Exclude<SourceFormat, "zip">, FileRole> = {
  stl: "source",
  obj: "source",
  "3mf": "source",
  step: "aux",
  dxf: "drawing",
  svg: "drawing",
  gcode: "cnc_program",
  gerber: "gerber",
};

export function formatFromFilename(filename: string | undefined | null): SourceFormat | null {
  const ext = (filename ?? "").toLowerCase().split(".").pop();
  if (!ext) return null;
  return EXTENSION_TO_FORMAT[ext] ?? null;
}

// zip-загрузка — либо Gerber-набор, либо архив кода (байты одинаковы, § 1.7 policy);
// слот загрузки говорит, какая это роль. Без явного указания — архив кода (более общий
// случай); Front пришлёт явный role, когда появится селектор (design §2.4).
export function resolveZipRole(roleHint: string | undefined | null): FileRole {
  return roleHint === "gerber" ? "gerber" : "code_archive";
}

export function roleForFormat(format: SourceFormat, zipRoleHint?: string | null): FileRole {
  if (format === "zip") return resolveZipRole(zipRoleHint);
  return FORMAT_ROLE[format];
}

// `models.craft` — slug справочника docs/epics/domain.model.md § Ремёсла (MF-504, гэп
// приёмки QA MF-497 §6.6: craft-бейдж был технически готов на Data/Back/Front, но
// недостижим — write-путь нигде его не выставлял). Design (projects.multiformat.md §2.4):
// «его класс определяет craft — печатный STL или, например, ЧПУ-программа» — craft
// присваивает сервер по роли первого файла, не пользователь. Мапим только роли с
// однозначным ремеслом (сама роль уже называет его): cnc_program/gerber/code_archive.
// 'aux' (STEP) и 'drawing' (DXF/SVG) реально используются в нескольких ремёслах (ЧПУ,
// лазер, дерево, металл) без единственно верного маппинга — оставляем дефолт '3d_printing',
// не изобретаем неподтверждённую таксономию (см. CLAUDE.md «Архитектуру не изобретаешь»).
export const DEFAULT_CRAFT = "3d_printing";

const ROLE_CRAFT: Partial<Record<FileRole, string>> = {
  cnc_program: "cnc",
  gerber: "electronics",
  code_archive: "software",
};

export function craftForRole(role: FileRole): string {
  return ROLE_CRAFT[role] ?? DEFAULT_CRAFT;
}

// --- Текстовые эвристики (§1.5-1.7 policy v0.2) -----------------------------------------

function significantLines(text: string, limit: number): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    lines.push(line);
    if (lines.length >= limit) break;
  }
  return lines;
}

const DXF_SECTION_NAMES = new Set(["SECTION", "HEADER", "CLASSES", "TABLES", "BLOCKS", "ENTITIES", "OBJECTS", "THUMBNAILIMAGE", "ACDSDATA"]);

const STEP_MAGIC = Buffer.from("ISO-10303-21;", "ascii");
const DXF_BINARY_MAGIC = Buffer.from("AutoCAD Binary DXF\r\n\x1a\x00", "latin1");
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

// ASCII-заголовок ISO-10303-21; допускаем ведущий BOM/пробелы (§1.4 policy).
export function detectStep(buffer: Buffer): boolean {
  let start = 0;
  while (start < buffer.length && [0x20, 0x09, 0x0d, 0x0a].includes(buffer[start]!)) start++;
  if (buffer.subarray(start, start + UTF8_BOM.length).equals(UTF8_BOM)) start += UTF8_BOM.length;
  return buffer.subarray(start, start + STEP_MAGIC.length).equals(STEP_MAGIC);
}

export function detectDxfBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, DXF_BINARY_MAGIC.length).equals(DXF_BINARY_MAGIC);
}

// Пара группа-код "0" + имя секции в первых строках — протокол пар DXF, которого нет
// у G-code/Gerber/SVG (§1.5 policy).
export function detectDxfAscii(text: string): boolean {
  const lines = significantLines(text, 60);
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i] === "0" && DXF_SECTION_NAMES.has(lines[i + 1]!)) return true;
  }
  return false;
}

const SVG_ROOT_RE = /^\s*(<\?xml[^>]*\?>\s*)?(<!doctype[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i;

export function detectSvg(text: string): boolean {
  return SVG_ROOT_RE.test(text.slice(0, 4096));
}

const GMT_CODE_RE = /^[GMT]\d+/i;

// Доля «значимых» строк, начинающихся с G/M/T + число ≥60% (§1.6 policy). Комментарии
// (`;...`, `(...)`) и голые `%`-разделители Fanuc-стиля не считаются — иначе они искажают
// долю и путают percent-delimited G-code с Gerber-обрамлением.
export function detectGcode(text: string): boolean {
  const lines = significantLines(text, 200);
  let considered = 0;
  let matched = 0;
  for (const line of lines) {
    if (line.startsWith(";") || line.startsWith("(")) continue;
    if (line === "%") continue;
    considered++;
    if (GMT_CODE_RE.test(line)) matched++;
  }
  if (considered === 0) return false;
  return matched / considered >= 0.6;
}

// RS-274X: хотя бы одна реальная расширенная команда `%...*%` (не голый `%`) + ≥80% строк
// оканчиваются на `*`/`*%` (§1.7 policy) — то, чего не бывает у G-code даже в Fanuc-стиле.
export function detectGerber(text: string): boolean {
  const lines = significantLines(text, 200);
  if (lines.length === 0) return false;
  const hasExtendedCommand = lines.slice(0, 30).some((l) => l.startsWith("%") && l.endsWith("%") && l !== "%");
  if (!hasExtendedCommand) return false;
  const considered = lines.filter((l) => l !== "%");
  if (considered.length === 0) return false;
  const terminated = considered.filter((l) => l.endsWith("*") || l.endsWith("*%")).length;
  return terminated / considered.length >= 0.8;
}

const OBJ_TOKEN_RE = /^(v |vn |vt |f |o |g |mtllib|#)/;

export function detectObj(text: string): boolean {
  const firstLine =
    text
      .trimStart()
      .split(/\r\n|\r|\n/)[0]
      ?.trim() ?? "";
  return OBJ_TOKEN_RE.test(firstLine);
}

// Бинарный STL: 80-байтный заголовок + uint32 (кол-во треугольников) + count*50 байт, без
// поля единиц (§4.1 policy). ASCII STL: "solid " + обязательные facet normal/endsolid —
// расширение `.stl` c байтами, начинающимися на "solid", но без facet/endsolid — не ASCII,
// проверяем как бинарный по формуле размера (§1.2 policy, историческая ловушка парсеров).
export function detectStl(buffer: Buffer): boolean {
  const looksAsciiPrefix = /^\s*solid\b/i.test(buffer.subarray(0, 6).toString("latin1"));
  if (looksAsciiPrefix) {
    const text = buffer.toString("latin1");
    if (/facet\s+normal/i.test(text) && /endsolid/i.test(text)) return true;
  }
  if (buffer.length >= 84) {
    const count = buffer.readUInt32LE(80);
    return 80 + 4 + count * 50 === buffer.length;
  }
  return false;
}

// --- ZIP: central-directory разбор без внешней зависимости --------------------------------
// 3MF/Gerber-набор/архив кода — все ZIP-контейнеры; парсим только central directory (без
// полной распаковки), тот же подход, что `zipfile` в спайке Mesh.

const ZIP_LOCAL_HEADER_SIG = 0x04034b50;
const ZIP_CENTRAL_DIR_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;
const EOCD_FIXED_SIZE = 22;
const MAX_EOCD_COMMENT = 65535;

export interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  externalAttr: number;
  /** Метод сжатия (0 = store, 8 = deflate) — нужен только extractZipEntry, не safety-проверкам. */
  compressionMethod: number;
  /** Смещение local file header этой записи от начала архива — нужен только extractZipEntry. */
  localHeaderOffset: number;
}

function isEmptyZip(buffer: Buffer): boolean {
  return buffer.length === EOCD_FIXED_SIZE && buffer.readUInt32LE(0) === ZIP_EOCD_SIG;
}

export function looksLikeZip(buffer: Buffer): boolean {
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === ZIP_LOCAL_HEADER_SIG) return true;
  return isEmptyZip(buffer);
}

function findEocd(buffer: Buffer): number {
  const searchFloor = Math.max(0, buffer.length - EOCD_FIXED_SIZE - MAX_EOCD_COMMENT);
  for (let i = buffer.length - EOCD_FIXED_SIZE; i >= searchFloor; i--) {
    if (buffer.readUInt32LE(i) === ZIP_EOCD_SIG) return i;
  }
  return -1;
}

export function parseZipEntries(buffer: Buffer): ZipEntry[] {
  if (isEmptyZip(buffer)) return [];

  const eocdOffset = findEocd(buffer);
  if (eocdOffset === -1) throw new FormatMismatchError("not a valid zip container (no end-of-central-directory record)");

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (centralDirOffset === 0xffffffff || centralDirSize === 0xffffffff) {
    // zip64 — вне охвата MVP: лимит upload'а 100 МБ не требует zip64-контейнеров.
    throw new FormatMismatchError("zip64 containers are not supported");
  }

  const entries: ZipEntry[] = [];
  let offset = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > buffer.length) throw new FormatMismatchError("truncated zip central directory");
    if (buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIR_SIG) {
      throw new FormatMismatchError("malformed zip central directory entry");
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const fileCommentLength = buffer.readUInt16LE(offset + 32);
    const externalAttr = buffer.readUInt32LE(offset + 38);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const name = buffer.toString("utf8", nameStart, nameStart + fileNameLength);
    entries.push({ name, compressedSize, uncompressedSize, externalAttr, compressionMethod, localHeaderOffset });
    offset = nameStart + fileNameLength + extraFieldLength + fileCommentLength;
  }
  return entries;
}

const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;

// Извлечение байт одной записи ZIP без полной распаковки архива (MF-1967 — импорт составного
// 3MF читает по имени, например portal.project.yaml или отдельный артефакт, не весь контейнер
// разом). Central directory (parseZipEntries) даёт истинные compressedSize/uncompressedSize —
// используются как есть, не пересчитываются из local header (тот же принцип, что checkZipContainerSafety:
// central directory — источник правды по размерам, local header нужен только чтобы найти
// смещение начала данных, т.к. длина имени/extra-field в нём может отличаться от central-записи).
export function extractZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const { localHeaderOffset: off } = entry;
  if (off + 30 > buffer.length || buffer.readUInt32LE(off) !== ZIP_LOCAL_HEADER_SIG) {
    throw new FormatMismatchError(`malformed zip local header at offset ${off}`);
  }
  const nameLength = buffer.readUInt16LE(off + 26);
  const extraLength = buffer.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) throw new FormatMismatchError(`truncated zip entry data: ${entry.name}`);
  const compressed = buffer.subarray(dataStart, dataEnd);

  if (entry.compressionMethod === ZIP_METHOD_STORE) return Buffer.from(compressed);
  if (entry.compressionMethod === ZIP_METHOD_DEFLATE) {
    // maxOutputLength — та же decompression-bomb защита, что checkZipContainerSafety даёт на
    // уровне суммы архива, применённая на уровне одной записи (защита не полагается только на
    // то, что вызывающий код уже прогнал checkZipContainerSafety раньше).
    return inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize });
  }
  throw new FormatMismatchError(`unsupported zip compression method ${entry.compressionMethod}: ${entry.name}`);
}

// Найти и извлечь запись по точному имени (posix-путь внутри архива) — null, если её нет
// (тот же принцип "пусто — не ошибка", что git/repo.ts::readFileContent).
export function readZipEntryByName(buffer: Buffer, name: string): Buffer | null {
  const entry = parseZipEntries(buffer).find((e) => e.name === name);
  if (!entry) return null;
  return extractZipEntry(buffer, entry);
}

// 3MF — ZIP-сигнатура недостаточна (любой zip); обязательна проверка central directory на
// наличие [Content_Types].xml и 3D/3dmodel.model (§1.2 policy) — иначе замаскированный
// произвольный zip пройдёт как «валидный 3MF».
export function has3mfManifest(buffer: Buffer): boolean {
  try {
    const names = new Set(parseZipEntries(buffer).map((e) => e.name));
    return names.has("[Content_Types].xml") && names.has("3D/3dmodel.model");
  } catch {
    return false;
  }
}

export interface ZipViolation {
  reason: "too_many_entries" | "path_traversal" | "symlink_entry" | "compression_ratio" | "total_uncompressed";
  entry?: string;
}

const S_IFMT = 0xf000;
const S_IFLNK = 0xa000;

function isSymlinkEntry(externalAttr: number): boolean {
  // Верхние 16 бит external_attr — unix-режим, только когда архив создан на unix (иначе 0,
  // не совпадает с S_IFLNK — без ложных срабатываний на Windows-зипах, § 1.8 policy).
  const mode = externalAttr >>> 16;
  if (mode === 0) return false;
  return (mode & S_IFMT) === S_IFLNK;
}

// Decompression-limit/zip-slip/symlink защита для непрозрачных ZIP-артефактов (§1.8 policy):
// число записей, суммарный распакованный размер, коэффициент сжатия на запись, путь записи,
// симлинки. Пороги — те же, что спайк Mesh (format_detect_spike.py::check_zip_container_safety).
export function checkZipContainerSafety(buffer: Buffer, opts: { maxEntries?: number; maxTotalUncompressed?: number; maxRatio?: number } = {}): ZipViolation | null {
  const maxEntries = opts.maxEntries ?? 10_000;
  const maxTotalUncompressed = opts.maxTotalUncompressed ?? 500 * 1024 * 1024;
  const maxRatio = opts.maxRatio ?? 100;

  const entries = parseZipEntries(buffer);
  if (entries.length > maxEntries) return { reason: "too_many_entries" };

  let totalUncompressed = 0;
  for (const entry of entries) {
    const normalized = entry.name.replace(/\\/g, "/");
    const isAbsolute = entry.name.startsWith("/") || entry.name.startsWith("\\");
    if (isAbsolute || normalized.split("/").includes("..")) {
      return { reason: "path_traversal", entry: entry.name };
    }
    if (isSymlinkEntry(entry.externalAttr)) {
      return { reason: "symlink_entry", entry: entry.name };
    }
    if (entry.name.endsWith("/")) continue; // directory entry — не несёт распакованного веса
    totalUncompressed += entry.uncompressedSize;
    if (entry.compressedSize > 0) {
      const ratio = entry.uncompressedSize / entry.compressedSize;
      if (ratio > maxRatio) return { reason: "compression_ratio", entry: entry.name };
    }
  }
  if (totalUncompressed > maxTotalUncompressed) return { reason: "total_uncompressed" };
  return null;
}

// path_traversal/symlink — структурно небезопасный zip, тот же код, что подмена содержимого
// (FORMAT_MISMATCH, §6 policy); остальные нарушения — DECOMPRESSION_LIMIT.
function assertZipSafe(buffer: Buffer): void {
  const violation = checkZipContainerSafety(buffer);
  if (!violation) return;
  if (violation.reason === "path_traversal" || violation.reason === "symlink_entry") {
    throw new FormatMismatchError(`unsafe zip entry (${violation.reason})`);
  }
  throw new DecompressionLimitError(violation.reason);
}

export interface FormatDetectionResult {
  format: SourceFormat;
  formatClass: FormatClass;
  role: FileRole;
}

// Проверка сигнатуры для уже известного формата (расширение проверяется отдельно и раньше —
// upload.ts фейлит на UNSUPPORTED_FORMAT до буферизации всего файла в память). Решение — по
// факту байтов (§1.2 policy, «расширению не доверяем»). Бросает FormatMismatchError или
// DecompressionLimitError — вызывающий код мапит на HTTP/таксономию §6.
export function validateFormatSignature(format: SourceFormat, buffer: Buffer, zipRoleHint?: string | null): FormatDetectionResult {
  switch (format) {
    case "stl":
      if (!detectStl(buffer)) throw new FormatMismatchError();
      break;
    case "obj":
      if (!detectObj(buffer.toString("utf8", 0, Math.min(buffer.length, 4096)))) throw new FormatMismatchError();
      break;
    case "3mf":
      if (!looksLikeZip(buffer) || !has3mfManifest(buffer)) throw new FormatMismatchError();
      assertZipSafe(buffer);
      break;
    case "step":
      if (!detectStep(buffer)) throw new FormatMismatchError();
      break;
    case "dxf":
      if (!detectDxfBinary(buffer) && !detectDxfAscii(buffer.toString("utf8", 0, Math.min(buffer.length, 65536)))) {
        throw new FormatMismatchError();
      }
      break;
    case "svg":
      if (!detectSvg(buffer.toString("utf8", 0, Math.min(buffer.length, 8192)))) throw new FormatMismatchError();
      break;
    case "gcode":
      if (!detectGcode(buffer.toString("utf8", 0, Math.min(buffer.length, 65536)))) throw new FormatMismatchError();
      break;
    case "gerber":
      if (!detectGerber(buffer.toString("utf8", 0, Math.min(buffer.length, 65536)))) throw new FormatMismatchError();
      break;
    case "zip":
      if (!looksLikeZip(buffer)) throw new FormatMismatchError();
      assertZipSafe(buffer);
      break;
  }

  return { format, formatClass: FORMAT_CLASS[format], role: roleForFormat(format, zipRoleHint) };
}

// Удобная обёртка, объединяющая выбор формата по расширению + проверку сигнатуры — для
// вызывающих, которым не нужен ранний UNSUPPORTED_FORMAT до буферизации файла (тесты и т.п.).
export function detectAndValidateFormat(filename: string | undefined | null, buffer: Buffer, zipRoleHint?: string | null): FormatDetectionResult {
  const format = formatFromFilename(filename);
  if (!format) throw new UnsupportedFormatError();
  return validateFormatSignature(format, buffer, zipRoleHint);
}
