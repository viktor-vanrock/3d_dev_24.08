// URL-гейт GitVerse-вложения (MF-1927, contract MF-1925 п.5): allowlist ровно ОДНОГО хоста —
// `gitverse.ru`, не "любой https" (models/repo-url.ts#validateRepoUrl нейтрален к хостингу
// намеренно, это другая карточка/другое поле — repo_url модели остаётся как есть). Здесь allowlist
// вдвойне обязателен: normalized-URL этой функции идёт прямо в исходящий fetch
// (feed/gitverseClient.ts), непроверенный хост — открытый SSRF на внутреннюю сеть/произвольный
// адрес по ссылке, которую вводит анонимный автор поста.

export class InvalidGitverseUrlError extends Error {
  constructor() {
    super("gitverse_url must be an https://gitverse.ru/<owner>/<repo> URL");
    this.name = "InvalidGitverseUrlError";
  }
}

export interface GitverseRepoLocator {
  owner: string;
  name: string;
}

const GITVERSE_HOST = "gitverse.ru";

// owner/name — первые два сегмента пути, `.git`-суффикс отбрасывается (та же ссылка, что клонится
// git'ом). Нормализованная форма отбрасывает query/hash/лишние сегменты — снапшот
// (gitverse_meta) адресует репозиторий целиком, не файл/ветку внутри него.
export function parseGitverseUrl(raw: string): { normalized: string; repo: GitverseRepoLocator } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InvalidGitverseUrlError();
  }
  if (parsed.protocol !== "https:") throw new InvalidGitverseUrlError();
  if (parsed.hostname.toLowerCase() !== GITVERSE_HOST) throw new InvalidGitverseUrlError();

  const segments = parsed.pathname.split("/").filter(Boolean);
  const owner = segments[0];
  const nameSegment = segments[1];
  if (!owner || !nameSegment) throw new InvalidGitverseUrlError();
  const name = nameSegment.replace(/\.git$/i, "");
  if (!name) throw new InvalidGitverseUrlError();

  return { normalized: `https://${GITVERSE_HOST}/${owner}/${name}`, repo: { owner, name } };
}
