// Парсер метаданных GitVerse-репо (MF-1927 п.5, contract MF-1925: `GET /feed/gitverse/parse`
// + снапшот на публикации в `feed/create.ts`). GitVerse — Gitea-совместимый REST (`GET
// /api/v1/repos/{owner}/{name}`, тот же контракт, что апстрим Gitea/Forgejo) — свой клиент, не
// переиспользуем models/repo-url.ts (тот только валидирует https, сюда не ходит за метой).
//
// Деградация — контракт, не побочный эффект (feed.page.md §10 п.8, editor.tsx уже свёрстан на
// `repo === null` → голая ссылка, не блокирует публикацию): таймаут/сеть/404/приватный репо/
// неожиданный формат ответа — везде `null`, никогда не бросает и не 500-ит вызывающего.
// AbortSignal.timeout — тот же приём, что ideas/gigaClient.ts (кнопка обязана деградировать
// быстрее, чем автор заскучает, не ждать полный сетевой таймаут).
import { parseGitverseUrl } from "./gitverse-url.ts";
import type { FeedGitverseRef } from "../domain/feed.ts";

const PARSE_TIMEOUT_MS = 4_000;
const USER_AGENT = "portal-ru-feed (+https://3mf.tech)";

interface GiteaRepoResponse {
  name?: unknown;
  description?: unknown;
  stars_count?: unknown;
  language?: unknown;
  owner?: { login?: unknown; avatar_url?: unknown };
}

export async function fetchGitverseRepoMeta(url: string, fetchImpl: typeof fetch = fetch): Promise<FeedGitverseRef | null> {
  let locator;
  try {
    locator = parseGitverseUrl(url).repo;
  } catch {
    return null;
  }

  let response: Response;
  try {
    response = await fetchImpl(`https://gitverse.ru/api/v1/repos/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.name)}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(PARSE_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let data: GiteaRepoResponse;
  try {
    data = (await response.json()) as GiteaRepoResponse;
  } catch {
    return null;
  }

  return {
    owner: typeof data.owner?.login === "string" ? data.owner.login : locator.owner,
    name: typeof data.name === "string" ? data.name : locator.name,
    avatar_url: typeof data.owner?.avatar_url === "string" ? data.owner.avatar_url : null,
    description: typeof data.description === "string" ? data.description : null,
    stars: typeof data.stars_count === "number" ? data.stars_count : 0,
    language: typeof data.language === "string" ? data.language : null,
  };
}
