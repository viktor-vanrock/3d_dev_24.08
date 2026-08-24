import type { ModelObjectStream } from "../../../storage/s3.ts";
import type { SeoMetaResponse } from "../domain/seo.ts";

export const SEO_PORT = Symbol("SEO_PORT");

export interface SeoImage {
  readonly publicUrl: string | null;
  readonly object: ModelObjectStream | null;
}

export interface SeoPort {
  meta(rawPath: string): Promise<SeoMetaResponse>;
  robots(): string;
  sitemap(): Promise<string>;
  image(rawModelId: string): Promise<SeoImage | null>;
}
export { apiBaseUrl } from "../domain/urls.ts";
