import type { FeedGitverseRef } from "./api.ts";

export function GitverseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3 4 8.2v7.6L12 21l8-5.2V8.2L12 3Zm0 4.2 4.2 2.7v5.4L12 17.8l-4.2-2.5v-5.4L12 7.2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 1.2k-нотация звёзд GitVerse-репо (feed.md §2.2 пример «⭐ 1.2k»).
export function formatStars(stars: number): string {
  if (stars < 1000) return String(stars);
  const rounded = Math.round(stars / 100) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}k`;
}

// Тело `gitverse` переиспользуется карточкой ленты и rich-body. Оно вынесено из postcard,
// чтобы rich-body можно было безопасно использовать внутри самой карточки без циклического
// импорта postcard -> richbody -> postcard.
export function GitverseCardBody({ url, repo }: { url: string | null; repo: FeedGitverseRef | null }) {
  if (!repo) {
    return (
      <a
        href={url ?? undefined}
        target="_blank"
        rel="noreferrer"
        className="feedPostCardGitverseBare"
        onClick={(event) => event.stopPropagation()}
      >
        <GitverseIcon />
        {url}
      </a>
    );
  }
  return (
    <div className="feedPostCardModel feedPostCardGitverse">
      <a
        className="feedGitversePreview"
        aria-label={`Открыть репозиторий ${repo.owner}/${repo.name} на GitVerse`}
        href={url ?? undefined}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
      >
        {repo.avatar_url ? <img src={repo.avatar_url} alt="" /> : <GitverseIcon />}
      </a>
      <div className="feedGitverseCopy">
        <div className="feedGitverseName">
          {repo.owner}/{repo.name}
        </div>
        {repo.description ? <div className="feedGitverseDescription">{repo.description}</div> : null}
        <span className="feedGitverseBadge">
          ⭐ {formatStars(repo.stars)} · {repo.language ?? "—"}
        </span>
      </div>
    </div>
  );
}
