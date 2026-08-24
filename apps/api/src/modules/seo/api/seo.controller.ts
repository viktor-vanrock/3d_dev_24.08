import { Controller, Get, Headers, Inject, NotFoundException, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { SEO_PORT, type SeoPort } from "../public/index.ts";
import { SeoMetaQueryDto } from "./seo.dto.ts";
import { ApiSeoOperation } from "./openapi.ts";

@Controller()
export class SeoController {
  constructor(@Inject(SEO_PORT) private readonly seo: SeoPort) {}

  @Get("seo/meta")
  @ApiSeoOperation("Render crawler metadata for a storefront URL", "text/html")
  async meta(@Query() query: SeoMetaQueryDto, @Headers("x-original-uri") originalUri: string | undefined, @Res() response: Response): Promise<void> {
    const result = await this.seo.meta(query.path || originalUri || "/");
    if (result.status === 404) throw new NotFoundException();
    response.status(200).type("text/html; charset=utf-8").set("Cache-Control", "public, max-age=300").set("X-Robots-Tag", "index").send(result.html);
  }

  @Get("seo/models/:id/og.webp")
  @ApiSeoOperation("Read the public preview image for a published model", "image/webp")
  async image(@Param("id") id: string, @Res() response: Response): Promise<void> {
    const image = await this.seo.image(id);
    if (image === null) throw new NotFoundException();
    if (image.publicUrl !== null) {
      response.redirect(302, image.publicUrl);
      return;
    }
    if (image.object === null) throw new NotFoundException();
    response.type("image/webp").set("Cache-Control", "public, max-age=86400");
    if (image.object.etag !== undefined) response.set("ETag", image.object.etag);
    if (image.object.contentLength !== undefined) response.set("Content-Length", String(image.object.contentLength));
    image.object.body.on("error", () => response.destroy());
    image.object.body.pipe(response);
  }

  @Get("sitemap.xml")
  @ApiSeoOperation("Read the public storefront sitemap", "application/xml")
  async sitemap(@Res() response: Response): Promise<void> {
    response
      .type("application/xml; charset=utf-8")
      .set("Cache-Control", "public, max-age=600")
      .send(await this.seo.sitemap());
  }

  @Get("robots.txt")
  @ApiSeoOperation("Read the crawler policy", "text/plain")
  robots(@Res() response: Response): void {
    response.type("text/plain; charset=utf-8").set("Cache-Control", "public, max-age=3600").send(this.seo.robots());
  }
}
