import { readdir, stat } from "node:fs/promises";
import path from "node:path";

// Лимиты §3.6 эпика (docs/epics/project.git.md): файл ≤100 МБ (тот же дефолт, что
// MAX_UPLOAD_BYTES в models/upload.ts — не совпадение, один физический лимит на исходник),
// репо ≤1 ГБ. Проверка — на API-слое, не в git; Git LFS в v1 не вводим.
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_REPO_BYTES = 1024 * 1024 * 1024;

export class FileTooLargeError extends Error {
  constructor(public readonly sizeBytes: number) {
    super(`файл ${sizeBytes} байт превышает лимит ${MAX_FILE_BYTES} байт`);
  }
}

export class RepoTooLargeError extends Error {
  constructor(public readonly sizeBytes: number) {
    super(`репозиторий ${sizeBytes} байт превышает лимит ${MAX_REPO_BYTES} байт`);
  }
}

export function assertFileSizeAllowed(sizeBytes: number): void {
  if (sizeBytes > MAX_FILE_BYTES) throw new FileTooLargeError(sizeBytes);
}

export function assertRepoSizeBytesAllowed(sizeBytes: number): void {
  if (sizeBytes > MAX_REPO_BYTES) throw new RepoTooLargeError(sizeBytes);
}

// Рекурсивный обход каталога bare-репо на диске (объекты, рефы, packfiles — всё, что реально
// занимает место). Для спайка — достаточно; при росте флота репозиториев это станет узким
// местом (обход диска на каждый коммит) — стейдж 2 может закэшировать/считать инкрементально.
export async function repoSizeBytes(repoPath: string): Promise<number> {
  let total = 0;
  const entries = await readdir(repoPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(repoPath, entry.name);
    if (entry.isDirectory()) {
      total += await repoSizeBytes(entryPath);
    } else if (entry.isFile()) {
      total += (await stat(entryPath)).size;
    }
  }
  return total;
}

export async function assertRepoSizeAllowed(repoPath: string): Promise<void> {
  assertRepoSizeBytesAllowed(await repoSizeBytes(repoPath));
}
