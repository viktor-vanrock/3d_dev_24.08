import { spawn } from "node:child_process";
import { MAX_FILE_BYTES } from "./limits.ts";

// Тонкая обёртка над git CLI (docs/epics/project.git.md §3, вариант А — «нулевые новые
// сервисы»): весь модуль говорит с диском только через `git`-бинарь, без библиотек типа
// isomorphic-git/nodegit. stdin — Buffer (нужно для бинарных blob'ов моделей), stdout тоже
// собирается как Buffer — вызывающий код сам решает, парсить как текст или как бинарь.

// Hardening (MF-1965): голый `spawn` без таймаута/потолка вывода — завис/раздутый git-процесс
// (повреждённый репо, патологический `ls-tree`/`log`, DoS через огромный stdin) держал бы
// event loop и память процесса apps/api неограниченно. Оба лимита — защита процесса, не
// бизнес-правило; конкретные файлы по-прежнему ограничены limits.ts::MAX_FILE_BYTES выше по
// стеку (repo.ts/commitFile), таймаут/потолок здесь — второй, независимый рубеж.
const DEFAULT_TIMEOUT_MS = 30_000;
// `git show ref:path` (readFileContent) отдаёт байты файла целиком через stdout — потолок
// обязан быть выше MAX_FILE_BYTES (иначе легитимное чтение самого большого разрешённого
// файла само наткнулось бы на лимит), запас — под git-обвязку вывода (не голые байты blob'а).
const DEFAULT_MAX_OUTPUT_BYTES = MAX_FILE_BYTES + 16 * 1024 * 1024;

export interface GitResult {
  stdout: Buffer;
  stderr: string;
}

export class GitCommandError extends Error {
  constructor(
    public readonly args: string[],
    public readonly code: number | null,
    public readonly stderr: string,
  ) {
    super(`git ${args.join(" ")} failed (code ${code}): ${stderr.trim()}`);
  }
}

export class GitTimeoutError extends Error {
  constructor(
    public readonly args: string[],
    public readonly timeoutMs: number,
  ) {
    super(`git ${args.join(" ")} превысил таймаут ${timeoutMs}мс`);
  }
}

export class GitOutputTooLargeError extends Error {
  constructor(
    public readonly args: string[],
    public readonly maxOutputBytes: number,
  ) {
    super(`git ${args.join(" ")} превысил потолок вывода ${maxOutputBytes} байт`);
  }
}

export interface RunGitOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: Buffer;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export function runGit(args: string[], options: RunGitOptions = {}): Promise<GitResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new GitTimeoutError(args, timeoutMs));
    }, timeoutMs);

    function killForOverflow(): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(new GitOutputTooLargeError(args, maxOutputBytes));
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) return killForOverflow();
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxOutputBytes) return killForOverflow();
      stderrChunks.push(chunk);
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code !== 0) {
        reject(new GitCommandError(args, code, stderr));
        return;
      }
      resolve({ stdout: Buffer.concat(stdoutChunks), stderr });
    });

    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}
