import { MarkdownBody, Eyebrow } from "@shared/ui";
import { modelPath, navigate } from "../../../router.ts";
import {
  parseFeedBlocks,
  parseFeedEmbed,
  serializeFeedBlocks,
  stripEditorialClaimMarkers,
  type FeedBlock,
} from "./blockcodec.ts";
import { MermaidDiagram } from "./mermaiddiagram.tsx";
import { GitverseCardBody } from "./gitversecard.tsx";

function portalAssetUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value, window.location.origin);
    const allowed =
      parsed.origin === window.location.origin ||
      parsed.hostname === "3mf.tech" ||
      parsed.hostname.endsWith(".3mf.tech");
    return allowed ? parsed.toString() : null;
  } catch {
    return null;
  }
}

// Agent-written news may embed the verified og:image from an official vendor host. Keep arbitrary
// third-party pixels blocked (posts are user-authored too), but let the same bounded set of official
// sources that Scout validates reach the browser. Subdomains are intentional: vendors commonly keep
// editorial media on a dedicated CDN such as compress-file.creality.com.
const EDITORIAL_IMAGE_HOSTS = [
  "bambulab.com",
  "ultimaker.com",
  "prusa3d.com",
  "raise3d.com",
  "anycubic.com",
  "prnewswire.com",
  "creality.com",
  "snapmaker.com",
  "qidi3d.com",
];

function richImageUrl(value: string | undefined): string | null {
  const portalUrl = portalAssetUrl(value);
  if (portalUrl) return portalUrl;
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    const hostname = parsed.hostname.toLowerCase();
    const trusted = EDITORIAL_IMAGE_HOSTS.some(
      (root) => hostname === root || hostname.endsWith(`.${root}`),
    );
    return trusted ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function gitverseUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === "gitverse.ru" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

// Домен для подписи карточки-источника + иконка через публичный favicon-сервис Google (без
// ключа/аккаунта — сам favicon.ico источника недоступен напрямую из браузера, CORS/произвольный
// путь, это тот же приём, что везде используют для "покажи фавикон чужого сайта").
function sourceDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  } catch {
    return null;
  }
}

function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`;
}

function SourcesRow({ items }: { items: { url: string; title?: string }[] }) {
  const valid = items.filter((item) => sourceDomain(item.url));
  if (!valid.length) return null;
  return (
    <div className="feedRichSources">
      <span className="feedRichSourcesLabel">Источники</span>
      <div className="feedRichSourcesList">
        {valid.map((item, index) => {
          const domain = sourceDomain(item.url)!;
          return (
            <a
              key={`${domain}-${index}`}
              className="feedRichSourceChip"
              href={item.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              title={item.title || domain}
              onClick={(event) => event.stopPropagation()}
            >
              <img src={faviconUrl(domain)} alt="" width={16} height={16} loading="lazy" />
              <span>{domain}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function RichEmbed({ block }: { block: FeedBlock }) {
  const data = parseFeedEmbed(block.content);
  if (!data) return null;

  if (data.kind === "image") {
    const src = richImageUrl(data.url);
    if (!src) return null;
    return (
      <figure className="feedRichImage">
        <img src={src} alt={data.title || ""} />
        {data.title ? <figcaption>{data.title}</figcaption> : null}
      </figure>
    );
  }

  if (data.kind === "model" || data.kind === "project") {
    if (!data.id) return null;
    const isModel = data.kind === "model";
    return (
      <button type="button" className="feedRichProject pressable" onClick={() => navigate(modelPath(data.id!))}>
        <span className="feedRichProjectPreview">
          {portalAssetUrl(data.thumbUrl ?? undefined) ? <img src={portalAssetUrl(data.thumbUrl ?? undefined)!} alt="" /> : <span aria-hidden="true">◇</span>}
        </span>
        <span className="feedRichProjectCopy">
          <Eyebrow>{isModel ? "3D-модель" : "Проект"}</Eyebrow>
          <strong>{data.title || (isModel ? "Открыть модель" : "Открыть проект")}</strong>
          <small>{isModel ? "Покрутить в 3D и скачать файлы" : "Файлы, версии и история работы"}</small>
        </span>
        <span className="feedRichProjectArrow" aria-hidden="true">↗</span>
      </button>
    );
  }

  if (data.kind === "sources") {
    return <SourcesRow items={data.items ?? []} />;
  }

  const url = gitverseUrl(data.url);
  if (!url) return null;
  return (
    <div className="feedRichGitverse">
      <GitverseCardBody url={url} repo={null} />
    </div>
  );
}

export function FeedRichBody({ source }: { source: string }) {
  const blocks = parseFeedBlocks(stripEditorialClaimMarkers(source));
  if (!blocks.some((block) => block.content.trim())) return null;
  return (
    <div className="feedRichBody">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (["image", "model", "project", "gitverse", "sources"].includes(block.type)) {
          return <RichEmbed key={key} block={block} />;
        }
        if (block.type === "diagram") {
          return <MermaidDiagram key={key} source={block.content} />;
        }
        return <MarkdownBody key={key} source={serializeFeedBlocks([block])} />;
      })}
    </div>
  );
}
