import { Module } from "@nestjs/common";
import { SeoController } from "./api/seo.controller.ts";
import { SeoService } from "./application/seo.service.ts";
import { SeoStorageAdapter } from "./infrastructure/seo-storage.adapter.ts";
import { SEO_PORT } from "./public/index.ts";

@Module({
  controllers: [SeoController],
  providers: [SeoStorageAdapter, SeoService, { provide: SEO_PORT, useExisting: SeoService }],
  exports: [SEO_PORT],
})
export class SeoModule {}
