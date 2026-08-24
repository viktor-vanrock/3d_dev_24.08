import { rm } from "node:fs/promises";
import path from "node:path";
import { GitCommandError, runGit } from "./gitcli.ts";
import { assertFileSizeAllowed, assertRepoSizeAllowed } from "./limits.ts";
import { withRepoLock } from "./lock.ts";

// Контракт git-модуля apps/api (MF-515, docs/epics/project.git.md §3/§6 стейдж 1).
// Прод-реализация — стейдж 2 (MF-516): этот модуль — доказанный прототип операций, на
// которых стоят все следующие фазы (Data-маппинг, Front GET-контракты). Дерево файлов
// репо — user-facing анатомия проекта (README + папки), не git-протокол наружу: пользователь
// никогда не видит `git`, только коммиты, которые API делает от его лица.
//
// Каждая функция принимает `repoPath` — абсолютный путь до bare-репо на диске. Резолвинг
// `projectId → repoPath` (корень каталога, имя папки) — забота вызывающего кода/Data-маппинга
// (`models.repo_path`), не этого модуля.

const DEFAULT_BRANCH = "main";
const INDEX_FILENAME = "portal-index";

export interface CommitAuthor {
  name: string;
  email: string;
}

export interface CommitFileInput {
  /** Путь файла внутри репо, posix, без ведущего `/`, без `..` (docs/epics/project.git.md §3 п.3). */
  filePath: string;
  content: Buffer;
  message: string;
  author: CommitAuthor;
  branch?: string;
  /** CAS-проверка (MF-1965): падать с GitPathConflictError, если filePath уже есть в дереве
   * родительского коммита. Атомарна относительно withRepoLock — в отличие от вызывающего кода,
   * который сначала читает readTree, а потом отдельным вызовом коммитит (TOCTOU: два конкурентных
   * запроса могут оба пройти проверку "путь свободен" до того, как любой из них закоммитит). */
  ifAbsent?: boolean;
}

export class GitPathConflictError extends Error {
  constructor(public readonly filePath: string) {
    super(`путь ${filePath} уже занят в текущем дереве репозитория`);
  }
}

export interface TreeEntry {
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  path: string;
  sizeBytes: number | null;
}

export interface LogEntry {
  sha: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
}

// git всегда пишет фиксированное число полей в наших форматах вывода — расхождение здесь
// значит баг в парсинге/формате команды, не во входных данных пользователя. Перегрузки дают
// вызывающему коду точно типизированный кортеж вместо string[] с возможным undefined.
function splitFields(line: string, separator: string | RegExp, count: 2): [string, string];
function splitFields(line: string, separator: string | RegExp, count: 4): [string, string, string, string];
function splitFields(line: string, separator: string | RegExp, count: 5): [string, string, string, string, string];
function splitFields(line: string, separator: string | RegExp, count: number): string[] {
  const fields = line.split(separator);
  if (fields.length !== count) {
    throw new Error(`неожиданный формат вывода git: ожидалось ${count} полей, получено ${fields.length}: ${line}`);
  }
  return fields;
}

function assertSafeRelativePath(filePath: string): void {
  if (!filePath || filePath.startsWith("/") || filePath.split("/").includes("..")) {
    throw new Error(`недопустимый путь файла в репо: ${filePath}`);
  }
}

function gitDirEnv(repoPath: string, indexPath?: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_DIR: repoPath,
    ...(indexPath ? { GIT_INDEX_FILE: indexPath } : {}),
  };
}

async function resolveRef(repoPath: string, ref: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(["rev-parse", "--verify", ref], { env: gitDirEnv(repoPath) });
    return stdout.toString("utf8").trim();
  } catch (err) {
    if (err instanceof GitCommandError) return null;
    throw err;
  }
}

// `git init --bare` (§3, вариант А) — единственный способ завести проект-репо в v1.
export async function initBareRepo(repoPath: string): Promise<void> {
  await runGit(["init", "--bare", `--initial-branch=${DEFAULT_BRANCH}`, repoPath]);
}

// Коммит одного файла через plumbing (hash-object → update-index → write-tree → commit-tree →
// update-ref), поверх временного index-файла внутри самого репо. Это единственная операция
// записи в модуле — используется и для исходников, и для README.md (commitReadme — тонкая
// обёртка над ней). Лок на весь репозиторий (см. lock.ts) — две параллельных записи не должны
// гонять один и тот же index-файл.
export async function commitFile(repoPath: string, input: CommitFileInput): Promise<string> {
  assertSafeRelativePath(input.filePath);
  assertFileSizeAllowed(input.content.length);
  const branch = input.branch ?? DEFAULT_BRANCH;

  return withRepoLock(repoPath, async () => {
    await assertRepoSizeAllowed(repoPath);

    const indexPath = path.join(repoPath, INDEX_FILENAME);
    await rm(indexPath, { force: true });

    try {
      const parentSha = await resolveRef(repoPath, `refs/heads/${branch}`);
      const env = gitDirEnv(repoPath, indexPath);

      if (parentSha) {
        await runGit(["read-tree", parentSha], { env });
      }

      if (input.ifAbsent && parentSha) {
        const { stdout: existingOut } = await runGit(["ls-files", "--", input.filePath], { env });
        if (existingOut.toString("utf8").trim().length > 0) {
          throw new GitPathConflictError(input.filePath);
        }
      }

      const { stdout: blobShaOut } = await runGit(["hash-object", "-w", "--stdin"], {
        env,
        input: input.content,
      });
      const blobSha = blobShaOut.toString("utf8").trim();

      await runGit(["update-index", "--add", "--cacheinfo", `100644,${blobSha},${input.filePath}`], { env });

      const { stdout: treeShaOut } = await runGit(["write-tree"], { env });
      const treeSha = treeShaOut.toString("utf8").trim();

      const commitArgs = ["commit-tree", treeSha, "-m", input.message];
      if (parentSha) commitArgs.push("-p", parentSha);
      const commitEnv = {
        ...env,
        GIT_AUTHOR_NAME: input.author.name,
        GIT_AUTHOR_EMAIL: input.author.email,
        GIT_COMMITTER_NAME: input.author.name,
        GIT_COMMITTER_EMAIL: input.author.email,
      };
      const { stdout: commitShaOut } = await runGit(commitArgs, { env: commitEnv });
      const commitSha = commitShaOut.toString("utf8").trim();

      const updateRefArgs = ["update-ref", `refs/heads/${branch}`, commitSha];
      if (parentSha) updateRefArgs.push(parentSha);
      await runGit(updateRefArgs, { env: gitDirEnv(repoPath) });

      return commitSha;
    } finally {
      await rm(indexPath, { force: true });
    }
  });
}

export interface RemoveFileInput {
  /** Тот же контракт пути, что CommitFileInput.filePath (posix, без ведущего `/`, без `..`). */
  filePath: string;
  message: string;
  author: CommitAuthor;
  branch?: string;
}

// Удаление одного файла коммитом (MF-339 шаг 2, DELETE /models/:id/files/:fileId) — тот же
// plumbing-приём, что commitFile, но update-index --force-remove вместо hash-object+--add.
// `--force-remove` требует настроенный work tree даже на bare-репо (иначе "this operation
// must be run in a work tree") — сам файл на диске ему не нужен, GIT_WORK_TREE=repoPath просто
// удовлетворяет проверке, ничего туда не пишется. null, если удалять нечего: ветка ещё не
// родилась (пустой репо) или путь уже не в дереве (двойной DELETE/гонка) — сравниваем итоговое
// дерево с деревом родителя вместо парсинга текста ошибки git (force-remove молча не падает на
// отсутствующем в индексе пути, дерево в этом случае просто не меняется).
export async function removeFile(repoPath: string, input: RemoveFileInput): Promise<string | null> {
  assertSafeRelativePath(input.filePath);
  const branch = input.branch ?? DEFAULT_BRANCH;

  return withRepoLock(repoPath, async () => {
    const indexPath = path.join(repoPath, INDEX_FILENAME);
    await rm(indexPath, { force: true });

    try {
      const parentSha = await resolveRef(repoPath, `refs/heads/${branch}`);
      if (!parentSha) return null;

      const env = gitDirEnv(repoPath, indexPath);
      await runGit(["read-tree", parentSha], { env });

      const { stdout: parentTreeOut } = await runGit(["rev-parse", `${parentSha}^{tree}`], { env });
      const parentTreeSha = parentTreeOut.toString("utf8").trim();

      await runGit(["update-index", "--force-remove", input.filePath], { env: { ...env, GIT_WORK_TREE: repoPath } });

      const { stdout: treeShaOut } = await runGit(["write-tree"], { env });
      const treeSha = treeShaOut.toString("utf8").trim();
      if (treeSha === parentTreeSha) return null;

      const commitEnv = {
        ...env,
        GIT_AUTHOR_NAME: input.author.name,
        GIT_AUTHOR_EMAIL: input.author.email,
        GIT_COMMITTER_NAME: input.author.name,
        GIT_COMMITTER_EMAIL: input.author.email,
      };
      const { stdout: commitShaOut } = await runGit(["commit-tree", treeSha, "-m", input.message, "-p", parentSha], { env: commitEnv });
      const commitSha = commitShaOut.toString("utf8").trim();

      await runGit(["update-ref", `refs/heads/${branch}`, commitSha, parentSha], { env: gitDirEnv(repoPath) });

      return commitSha;
    } finally {
      await rm(indexPath, { force: true });
    }
  });
}

// README.md = описание проекта (docs/epics/project.git.md §3 п.1) — тонкая обёртка над
// commitFile, чтобы вызывающий код (upload/mutate) не собирал CommitFileInput вручную.
export async function commitReadme(repoPath: string, description: string, author: CommitAuthor, branch?: string): Promise<string> {
  return commitFile(repoPath, {
    filePath: "README.md",
    content: Buffer.from(description, "utf8"),
    message: "docs: update README",
    author,
    branch,
  });
}

// Плоский рекурсивный листинг дерева файлов (`git ls-tree -r -l`) — «дерево файлов» из
// критериев приёмки. Пустой репозиторий (ветка ещё не родилась) — пустой список, не ошибка.
export async function readTree(repoPath: string, ref: string = DEFAULT_BRANCH): Promise<TreeEntry[]> {
  const resolved = await resolveRef(repoPath, ref);
  if (!resolved) return [];

  const { stdout } = await runGit(["ls-tree", "-r", "-l", resolved], { env: gitDirEnv(repoPath) });
  const lines = stdout.toString("utf8").split("\n").filter(Boolean);

  return lines.map((line) => {
    const [meta, entryPath] = splitFields(line, "\t", 2);
    const [mode, type, sha, sizeRaw] = splitFields(meta.trim(), /\s+/, 4);
    return {
      mode,
      type: type as TreeEntry["type"],
      sha,
      path: entryPath,
      sizeBytes: sizeRaw === "-" ? null : Number(sizeRaw),
    };
  });
}

// История коммитов (`git log`) — поля разделены нетипичными байтами (\x1f/\x1e), чтобы не
// ломаться на сообщениях коммитов с пробелами/табами/переносами строк.
export async function log(repoPath: string, ref: string = DEFAULT_BRANCH, limit?: number): Promise<LogEntry[]> {
  const resolved = await resolveRef(repoPath, ref);
  if (!resolved) return [];

  const args = ["log", resolved, "--pretty=format:%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e"];
  if (limit) args.push(`--max-count=${limit}`);

  const { stdout } = await runGit(args, { env: gitDirEnv(repoPath) });
  const records = stdout
    .toString("utf8")
    .split("\x1e")
    .filter((r) => r.trim().length > 0);

  return records.map((record) => {
    const [sha, authorName, authorEmail, authoredAt, subject] = splitFields(record.replace(/^\n/, ""), "\x1f", 5);
    return { sha, authorName, authorEmail, authoredAt, subject };
  });
}

// Server-side clone бare→bare — базовый форк (§3 п.4): копия-репо нового владельца,
// `forked_from` на карточке — забота вызывающего кода (models.forked_from), не этого модуля.
// Лок на исходный репозиторий — форк не должен читать репо в процессе конкурентной записи в него.
export async function forkRepo(sourceRepoPath: string, targetRepoPath: string): Promise<void> {
  await withRepoLock(sourceRepoPath, async () => {
    await runGit(["clone", "--bare", sourceRepoPath, targetRepoPath]);
  });
}

// Коммит-метка без изменения дерева (например «Форк проекта X» — §11.3 design-словарь событий,
// MF-522: клон копирует историю источника как есть, форк как событие копии нужно зафиксировать
// отдельной записью). Тот же plumbing-приём, что commitFile/removeFile, но дерево = дерево
// родителя без изменений — новый коммит несёт только сообщение и нового автора/владельца.
export async function commitMarker(repoPath: string, message: string, author: CommitAuthor, branch: string = DEFAULT_BRANCH): Promise<string> {
  return withRepoLock(repoPath, async () => {
    const parentSha = await resolveRef(repoPath, `refs/heads/${branch}`);
    if (!parentSha) {
      throw new Error(`commitMarker: репозиторий ${repoPath} пуст, не на что ставить метку`);
    }

    const env = gitDirEnv(repoPath);
    const { stdout: parentTreeOut } = await runGit(["rev-parse", `${parentSha}^{tree}`], { env });
    const parentTreeSha = parentTreeOut.toString("utf8").trim();

    const commitEnv = {
      ...env,
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
    };
    const { stdout: commitShaOut } = await runGit(["commit-tree", parentTreeSha, "-m", message, "-p", parentSha], {
      env: commitEnv,
    });
    const commitSha = commitShaOut.toString("utf8").trim();

    await runGit(["update-ref", `refs/heads/${branch}`, commitSha, parentSha], { env: gitDirEnv(repoPath) });

    return commitSha;
  });
}

// Содержимое одного файла на ref (стейдж 2, GET README из репо — не входило в контракт
// спайка MF-515, там был только `readTree`, дающий метаданные без байт содержимого). `git
// show <ref>:<path>` — та же plumbing-стилистика, что и остальной модуль. null для
// отсутствующего файла/ветки (тот же принцип "пусто — не ошибка", что readTree/log).
export async function readFileContent(repoPath: string, filePath: string, ref: string = DEFAULT_BRANCH): Promise<Buffer | null> {
  assertSafeRelativePath(filePath);
  const resolved = await resolveRef(repoPath, ref);
  if (!resolved) return null;

  try {
    const { stdout } = await runGit(["show", `${resolved}:${filePath}`], { env: gitDirEnv(repoPath) });
    return stdout;
  } catch (err) {
    if (err instanceof GitCommandError) return null;
    throw err;
  }
}

// Удаление bare-репо целиком — используется при откате неудачной операции (например, upload
// падает после initBareRepo, но до конца транзакции модели). Best-effort по духу с остальным
// откатом upload.ts (deleteModelRow тоже .catch(() => {})).
export async function removeRepo(repoPath: string): Promise<void> {
  await rm(repoPath, { recursive: true, force: true });
}
