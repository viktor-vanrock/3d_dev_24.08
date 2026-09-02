import { Body, Controller, Get, Headers, HttpCode, HttpException, Inject, Param, Post, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { MAX_SCAN_PHOTO_BYTES } from "../domain/generations.ts";
import { GENERATIONS_PORT, type AssetResult, type GenerationsPort } from "../public/index.ts";
import { GenerationLooseBodyDto } from "./generations.dto.ts";
import { ApiGenerationsOperation } from "./openapi.ts";
import { Public } from "../../permissions/decorators/public.decorator.ts";
import { User } from "../../permissions/decorators/user.decorator.ts";

interface UploadedScanFile {
  readonly buffer: Buffer;
  readonly truncated?: boolean;
}
function user(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new Error("authenticated session missing");
  return UserId(session.id);
}
function stream(response: Response, asset: AssetResult): void {
  response.type(asset.contentType).set("Cache-Control", asset.cacheControl);
  if (asset.object.etag !== undefined) response.set("ETag", asset.object.etag);
  if (asset.object.contentLength !== undefined) response.set("Content-Length", String(asset.object.contentLength));
  asset.object.body.on("error", () => response.destroy());
  asset.object.body.pipe(response);
}

@Controller()
@User()
export class GenerationsController {
  constructor(@Inject(GENERATIONS_PORT) private readonly generations: GenerationsPort) {}

  @Get("generations/health") @Public() @ApiGenerationsOperation("Generation branch availability", { response: "health" }) health() {
    return this.generations.health();
  }
  @Post("scans") @ApiGenerationsOperation("Create scan", { status: 201, response: "scan" }) createScan(@Req() request: RequestWithSession) {
    return this.generations.createScan(user(request));
  }
  @Post("scans/:id/photos")
  @HttpCode(201)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_SCAN_PHOTO_BYTES, files: 1 } }))
  @ApiGenerationsOperation("Upload scan photo", { status: 201, multipart: true, response: "photos" })
  uploadPhoto(@Req() request: RequestWithSession, @Param("id") id: string, @UploadedFile() file: UploadedScanFile | undefined) {
    if (file === undefined) return this.missingFile();
    return this.generations.uploadScanPhoto(user(request), id, file);
  }
  @Post("scans/:id/manifest") @HttpCode(201) @ApiGenerationsOperation("Upload scan camera manifest", { status: 201, body: true, response: "photos" }) uploadManifest(
    @Req() request: RequestWithSession,
    @Param("id") id: string,
    @Body() body: GenerationLooseBodyDto,
  ) {
    return this.generations.uploadScanManifest(user(request), id, { ...body });
  }
  @Post("scans/:id/start") @ApiGenerationsOperation("Start scan generation", { status: 201, body: true, response: "generation", replay: true }) async startScan(
    @Req() request: RequestWithSession,
    @Param("id") id: string,
    @Body() body: GenerationLooseBodyDto,
    @Res() response: Response,
  ) {
    const result = await this.generations.startScan(user(request), id, body.mode);
    response.status(result.status).json(result.body);
  }
  @Get("generations/:id") @ApiGenerationsOperation("Generation detail", { response: "generation" }) detail(@Req() request: RequestWithSession, @Param("id") id: string) {
    return this.generations.detail(user(request), id);
  }
  @Get("concepts") @Public() @ApiGenerationsOperation("Browse generated concepts", { session: false, response: "concepts" }) concepts(
    @Query() query: { q?: string; limit?: string; cursor?: string },
  ) {
    return this.generations.listConcepts(query);
  }
  @Get("concepts/:id/preview") @Public() @ApiGenerationsOperation("Stream concept preview", { session: false, binary: true }) async conceptPreview(
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    stream(response, await this.generations.conceptPreview(id));
  }
  @Post("generations/concepts")
  @ApiGenerationsOperation("Create concept generation", { status: 201, body: true, response: "concept-generation", replay: true, accepted: true })
  async createConcept(@Req() request: RequestWithSession, @Body() body: GenerationLooseBodyDto, @Headers("idempotency-key") key: unknown, @Res() response: Response) {
    const result = await this.generations.createConcept(user(request), { ...body }, key);
    response.status(result.status).json(result.body);
  }
  @Get("generations") @ApiGenerationsOperation("List generation history", { response: "generations" }) list(@Req() request: RequestWithSession) {
    return this.generations.list(user(request));
  }
  @Post("generations/:id/catalog-draft") @ApiGenerationsOperation("Save generation as catalog draft", { status: 201, response: "catalog-draft", replay: true }) async catalogDraft(
    @Req() request: RequestWithSession,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    const result = await this.generations.catalogDraft(user(request), id);
    response.status(result.status).json(result.body);
  }
  @Get("generations/:id/preview") @ApiGenerationsOperation("Stream generation preview", { binary: true }) preview(
    @Req() request: RequestWithSession,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    return this.generationAsset(request, response, id, "preview");
  }
  @Get("generations/:id/artifact") @ApiGenerationsOperation("Stream generation artifact", { binary: true }) artifact(
    @Req() request: RequestWithSession,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    return this.generationAsset(request, response, id, "artifact");
  }
  @Get("generations/:id/preview/:angle") @ApiGenerationsOperation("Stream concept angle preview", { binary: true }) angle(
    @Req() request: RequestWithSession,
    @Param("id") id: string,
    @Param("angle") angle: string,
    @Res() response: Response,
  ) {
    return this.generationAsset(request, response, id, "preview_shot", angle);
  }
  @Post("generations") @ApiGenerationsOperation("Create generation", { status: 201, body: true, response: "generation" }) async create(
    @Req() request: RequestWithSession,
    @Body() body: GenerationLooseBodyDto,
    @Headers("idempotency-key") key: unknown,
    @Res() response: Response,
  ) {
    const result = await this.generations.create(user(request), { ...body }, key);
    response.status(result.status).json(result.body);
  }

  private async generationAsset(request: RequestWithSession, response: Response, id: string, kind: "preview" | "artifact" | "preview_shot", angle?: string): Promise<void> {
    stream(response, await this.generations.generationAsset(user(request), id, kind, angle, request));
  }
  private missingFile(): never {
    throw new HttpException({}, 422);
  }
}
