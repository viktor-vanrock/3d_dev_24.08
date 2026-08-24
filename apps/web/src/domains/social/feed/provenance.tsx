import type { FeedPost, FeedPostProvenance } from "./api.ts";

interface ResolvedFeedProvenance extends FeedPostProvenance {
  automated: boolean;
  reviewed: boolean;
}

function safeSourceDomain(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function providerLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("grok")) return "Grok";
  if (normalized.includes("gigachat") || normalized.includes("giga")) return "ГигаЧат";
  if (normalized.includes("qwen")) return "Qwen";
  if (normalized.includes("gemma")) return "Gemma";
  if (normalized === "local" || normalized === "hyperpc") return "локальная модель";
  return value.trim();
}

export function resolveFeedPostProvenance(post: FeedPost): ResolvedFeedProvenance | null {
  if (post.provenance) {
    return {
      ...post.provenance,
      automated: true,
      reviewed: Boolean(post.reviewed_by_user_id),
    };
  }

  const automated = post.source_type === "agent" || post.source_type === "import";
  const sourceUrl = post.source_url?.trim() ?? "";
  if (!automated && !sourceUrl) return null;

  return {
    source_url: sourceUrl,
    source_fingerprint: "",
    provider: post.source_provider?.trim() ?? "",
    model: post.source_model?.trim() ?? "",
    prompt_version: "",
    automated,
    reviewed: Boolean(post.reviewed_by_user_id),
  };
}

function SourceIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function FeedProvenance({ post, variant = "compact" }: { post: FeedPost; variant?: "compact" | "detail" }) {
  const provenance = resolveFeedPostProvenance(post);
  if (!provenance) return null;

  const domain = provenance.source_url ? safeSourceDomain(provenance.source_url) : null;
  const engine = [provenance.provider ? providerLabel(provenance.provider) : "", provenance.model]
    .filter(Boolean)
    .join(" · ");
  const title = [
    engine,
    provenance.prompt_version ? `версия промпта ${provenance.prompt_version}` : "",
  ].filter(Boolean).join(" · ") || undefined;

  return (
    <div
      className={`feedProvenance feedProvenance--${variant}`}
      aria-label="Происхождение публикации"
      onClick={(event) => event.stopPropagation()}
    >
      {provenance.automated ? (
        <span className="feedProvenanceAgent" title={title}>
          <span className="feedProvenancePulse" aria-hidden="true" />
          <span>
            <strong>{provenance.reviewed ? "Проверено человеком" : "Подготовлено агентом"}</strong>
            {engine ? <small>{engine}</small> : null}
          </span>
        </span>
      ) : null}
      {domain ? (
        <a
          className="feedProvenanceSource"
          href={provenance.source_url}
          target="_blank"
          rel="noreferrer noopener"
          title="Открыть первоисточник"
        >
          <SourceIcon />
          <span>{domain}</span>
          <span aria-hidden="true">↗</span>
        </a>
      ) : null}
    </div>
  );
}
