import { Inject, Injectable } from "@nestjs/common";
import { ModelId } from "../../_kernel/brandedIds.ts";
import { MODEL_READ_PORT, type ModelReadPort } from "../../models/public/index.ts";
import { PROFILE_READ_PORT, type ProfileReadPort } from "../../profile/public/index.ts";
import {
  buildSitemapXml,
  markdownToPlain,
  normalizeDescription,
  parseSeoPath,
  pluralProjects,
  renderMetaHtml,
  sitemapDate,
  type MetaTags,
  type SeoMetaResponse,
  type SitemapEntry,
} from "../domain/seo.ts";
import { SeoStorageAdapter } from "../infrastructure/seo-storage.adapter.ts";
import type { SeoImage, SeoPort } from "../public/index.ts";

const HOME_TITLE = "3mf.tech — портал мейкеров";
const HOME_DESCRIPTION = "Портал мейкеров: каталог проектов, превью и шаринг.";
const CATALOG_DESCRIPTION = "Открытый каталог проектов мейкеров: 3D-печать, ЧПУ, платы, код. Смотрите превью, скачивайте, публикуйте своё.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function webBaseUrl(): string {
  return (process.env.WEB_APP_URL ?? "https://3mf.tech").replace(/\/+$/, "");
}

function apiBaseUrl(): string {
  return (process.env.API_PUBLIC_URL ?? "https://api.3mf.tech").replace(/\/+$/, "");
}

function catalogPath(tag?: string): string {
  return tag === undefined ? "/project" : `/project?tag=${encodeURIComponent(tag)}`;
}

function modelPath(id: string): string {
  return `/project/${encodeURIComponent(id)}`;
}

function profilePath(username: string): string {
  return `/u/${encodeURIComponent(username)}`;
}

function notFoundMeta(): MetaTags {
  return {
    title: "Страница не найдена — 3mf.tech",
    description: HOME_DESCRIPTION,
    canonical: `${webBaseUrl()}/`,
    index: false,
    ogType: "website",
  };
}

@Injectable()
export class SeoService implements SeoPort {
  constructor(
    @Inject(MODEL_READ_PORT) private readonly models: ModelReadPort,
    @Inject(PROFILE_READ_PORT) private readonly profiles: ProfileReadPort,
    @Inject(SeoStorageAdapter) private readonly storage: SeoStorageAdapter,
  ) {}

  async meta(rawPath: string): Promise<SeoMetaResponse> {
    const route = parseSeoPath(rawPath);
    let status: 200 | 404 = 200;
    let meta: MetaTags;
    switch (route.kind) {
      case "home":
        meta = {
          title: HOME_TITLE,
          description: HOME_DESCRIPTION,
          canonical: `${webBaseUrl()}/`,
          index: true,
          ogType: "website",
        };
        break;
      case "catalog":
        meta = {
          title: "Проекты — 3mf.tech",
          description: CATALOG_DESCRIPTION,
          canonical: webBaseUrl() + catalogPath(route.tag),
          index: true,
          ogType: "website",
        };
        break;
      case "model": {
        if (!UUID_RE.test(route.id)) {
          status = 404;
          meta = notFoundMeta();
          break;
        }
        const model = await this.models.findReadySeo(ModelId(route.id));
        if (model === null) {
          status = 404;
          meta = notFoundMeta();
          break;
        }
        const owner = await this.profiles.findById(model.ownerId);
        const author = owner?.displayName?.trim() || (owner === null ? "" : `@${owner.username}`);
        const plain = markdownToPlain(model.description ?? "")
          .replace(/\s+/g, " ")
          .trim();
        meta = {
          title: `${model.title} — 3mf.tech`,
          description: plain ? normalizeDescription(`${author} · ${plain}`, "", 160) : "Проект на 3mf.tech",
          canonical: webBaseUrl() + modelPath(model.id),
          index: true,
          ogType: "website",
          ogImage: model.hasThumbnail ? `${apiBaseUrl()}/seo/models/${encodeURIComponent(model.id)}/og.webp` : `${webBaseUrl()}/icons/icon-512.png`,
          ogImageAlt: model.title,
        };
        break;
      }
      case "profile": {
        const profile = await this.profiles.findActiveByUsername(route.username);
        if (profile === null) {
          status = 404;
          meta = notFoundMeta();
          break;
        }
        const name = profile.displayName?.trim() || `@${profile.username}`;
        const count = await this.models.countReadyByOwner(profile.id);
        meta = {
          title: `${name} — 3mf.tech`,
          description: `${name} на 3mf.tech: ${count} ${pluralProjects(count)} в каталоге.`,
          canonical: webBaseUrl() + profilePath(profile.username),
          index: true,
          ogType: "profile",
        };
        break;
      }
      default:
        status = 404;
        meta = notFoundMeta();
    }
    return { status, meta, html: renderMetaHtml(meta) };
  }

  robots(): string {
    return ["User-agent: *", "Allow: /", "Disallow: /auth/", "Disallow: /seo/", "Disallow: /models/_index/scan", "", `Sitemap: ${webBaseUrl()}/sitemap.xml`, ""].join("\n");
  }

  async sitemap(): Promise<string> {
    const entries: SitemapEntry[] = [{ loc: webBaseUrl() + catalogPath() }];
    const models = await this.models.readySitemapModels();
    for (const model of models) {
      entries.push({ loc: webBaseUrl() + modelPath(model.id), lastmod: sitemapDate(model.updatedAt) });
    }
    const owners = await this.models.readySitemapOwners();
    const profiles = await this.profiles.findActiveByIds(owners.map(({ ownerId }) => ownerId));
    for (const activity of owners) {
      const profile = profiles.get(activity.ownerId);
      if (profile !== undefined) {
        entries.push({
          loc: webBaseUrl() + profilePath(profile.username),
          lastmod: sitemapDate(activity.lastUpdatedAt),
        });
      }
    }
    return buildSitemapXml(entries);
  }

  async image(rawModelId: string): Promise<SeoImage | null> {
    if (!UUID_RE.test(rawModelId)) return null;
    const key = await this.models.readyThumbnailKey(ModelId(rawModelId));
    if (key === null) return null;
    const publicUrl = this.storage.publicUrl(key);
    if (publicUrl !== null) return { publicUrl, object: null };
    return { publicUrl: null, object: await this.storage.object(key) };
  }
}
