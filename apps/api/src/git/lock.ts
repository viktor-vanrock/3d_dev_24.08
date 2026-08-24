import { open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

// Стратегия конкурентных записей (критерий приёмки MF-515 п.3): коммит в bare-репо строится
// через plumbing (см. repo.ts) поверх ВРЕМЕННОГО index-файла внутри самого репо — этот файл
// разделяемое мутируемое состояние, и два одновременных коммита в один репозиторий гонялись бы
// за ним. Лок — эксклюзивный файл `portal.lock` в каталоге репо, создаётся через open(..., "wx")
// (атомарный O_CREAT|O_EXCL — POSIX-гарантия, а не наша логика). Живёт на той же файловой
// системе, что и репозитории, поэтому работает и при нескольких процессах API на одном диске
// (v1 — один writer, apps/api, но это на будущее без переделки).
//
// Stale-lock recovery (MF-1965, закрывает открытый вопрос спайка выше): лок-файл несёт
// `{pid, acquiredAt}` JSON. Если держатель — process.pid этого же узла, который больше не жив
// (`process.kill(pid, 0)` кидает ESRCH), или лок просто старше TTL (другой хост/PID-переиспользование,
// где локальная PID-проверка ничего не докажет) — считаем его зависшим от упавшего процесса и
// крадём (unlink + повторная попытка), вместо вечного ожидания deadline.

const LOCK_FILENAME = "portal.lock";
const RETRY_DELAY_MS = 25;
const STALE_LOCK_TTL_MS = 60_000;

export class RepoLockTimeoutError extends Error {
  constructor(repoPath: string, timeoutMs: number) {
    super(`не удалось получить лок репозитория ${repoPath} за ${timeoutMs}мс`);
  }
}

interface LockContent {
  pid: number;
  acquiredAt: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

// Зависший лок — либо PID того же хоста, что уже не существует, либо просто старше TTL
// (другой хост в будущем multi-writer сценарии, где process.kill ничего не значит). Битый/
// пустой файл (гонка с чужим unlink, обрезанная запись) тоже считаем зависшим — безопаснее
// украсть, чем ждать deadline на файле, который никто не допишет.
async function isStale(lockPath: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }

  let content: LockContent;
  try {
    content = JSON.parse(raw) as LockContent;
    if (typeof content.pid !== "number" || typeof content.acquiredAt !== "number") throw new Error("malformed");
  } catch {
    return true;
  }

  if (Date.now() - content.acquiredAt > STALE_LOCK_TTL_MS) return true;
  if (content.pid === process.pid) return false;
  return !pidIsAlive(content.pid);
}

async function tryAcquire(lockPath: string): Promise<boolean> {
  const content: LockContent = { pid: process.pid, acquiredAt: Date.now() };
  try {
    const handle = await open(lockPath, "wx");
    try {
      await handle.writeFile(JSON.stringify(content));
    } finally {
      await handle.close();
    }
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }

  if (await isStale(lockPath)) {
    await unlink(lockPath).catch(() => {});
    return false; // следующая итерация цикла заберёт свежий слот немедленно (без ожидания RETRY_DELAY_MS не гарантируем — цикл сам решает)
  }
  return false;
}

// Сериализует все операции записи над одним репозиторием. `repoPath` — абсолютный путь до
// bare-репо на диске; лок-файл живёт прямо внутри него, поэтому его путь однозначно определяет
// репозиторий-владелец.
export async function withRepoLock<T>(repoPath: string, fn: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
  const lockPath = path.join(repoPath, LOCK_FILENAME);
  const deadline = Date.now() + timeoutMs;

  while (!(await tryAcquire(lockPath))) {
    if (Date.now() >= deadline) throw new RepoLockTimeoutError(repoPath, timeoutMs);
    await sleep(RETRY_DELAY_MS);
  }

  try {
    return await fn();
  } finally {
    await unlink(lockPath).catch(() => {});
  }
}
