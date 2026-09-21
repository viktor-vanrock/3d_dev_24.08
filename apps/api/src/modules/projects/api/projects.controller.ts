import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, Res } from "@nestjs/common";
import Busboy from "busboy";
import type { Request, Response } from "express";
import { SESSION_USER, SessionVerifier, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { ModelId, ModelRevisionId, ProjectId, UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { ProjectCommandService } from "../application/project-command.service.ts";
import { ProjectLifecycleService } from "../application/project-lifecycle.service.ts";
import { ProjectQueryService } from "../application/project-query.service.ts";
import { UploadService } from "../application/upload.service.ts";
import { UploadConcurrencyService } from "../application/upload-concurrency.service.ts";
import { PROJECT_CONTRACT_VERSION } from "../domain/project.ts";
import { UPLOAD_LIMITS } from "../domain/upload.ts";
import { parseIdempotencyKey, parseIfMatch, projectEtag, ProjectError } from "../domain/project.errors.ts";
import { CreateModelDto, CreateProjectDto, ProjectPageQueryDto, PublishProjectDto, SetPrimaryModelDto, UpdateProjectDto } from "./projects.dto.ts";
import { ApiProjectOperation } from "./projects.openapi.ts";
import {
  ModelListResponseDto,
  ModelResponseDto,
  ModelRevisionListResponseDto,
  ModelRevisionResponseDto,
  ProjectDraftResponseDto,
  ProjectListResponseDto,
  ProjectLifecycleResponseDto,
  PublicationResponseDto,
  PublishedProjectResponseDto,
} from "./projects.response.dto.ts";
import { Public, User } from "../../permissions/public/index.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredUser(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new ProjectError(401, "auth.unauthenticated.v1", "Требуется авторизация");
  return UserId(session.id);
}

function id(raw: string): string {
  if (!UUID.test(raw)) throw new ProjectError(400, "request.validation.v1", "Некорректный UUID");
  return raw;
}

function projectBody(project: unknown) {
  return { contract_version: PROJECT_CONTRACT_VERSION, project };
}
function modelBody(model: unknown) {
  return { contract_version: PROJECT_CONTRACT_VERSION, model };
}
function revisionBody(revision: unknown) {
  return { contract_version: PROJECT_CONTRACT_VERSION, revision };
}
function pageBody(page: { items: readonly unknown[]; next_cursor: string | null }) {
  return { contract_version: PROJECT_CONTRACT_VERSION, ...page };
}

@Controller("projects")
@User()
export class ProjectsController {
  constructor(
    @Inject(ProjectCommandService) private readonly commands: ProjectCommandService,
    @Inject(ProjectQueryService) private readonly queries: ProjectQueryService,
    @Inject(ProjectLifecycleService) private readonly lifecycle: ProjectLifecycleService,
    @Inject(UploadService) private readonly uploads: UploadService,
    @Inject(UploadConcurrencyService) private readonly concurrency: UploadConcurrencyService,
    @Inject(SessionVerifier) private readonly sessions: SessionVerifier,
  ) {}

  @Post()
  @ApiProjectOperation({
    operationId: "projectsCreate",
    summary: "Create an empty Project",
    success: 201,
    response: ProjectDraftResponseDto,
    security: "protected",
    idempotency: true,
    location: true,
    etag: true,
    errors: { 400: ["request.validation.v1"], 409: ["project.idempotency_conflict.v1", "project.request_in_progress.v1"] },
  })
  async create(@Req() request: RequestWithSession, @Body() body: CreateProjectDto, @Headers("idempotency-key") key: string | string[] | undefined, @Res() response: Response) {
    const result = await this.commands.createProject(requiredUser(request), body, parseIdempotencyKey(key));
    response.set("Location", `/projects/${result.value.id}/draft`).set("ETag", projectEtag(result.version)).status(201).json(projectBody(result.value));
  }

  @Get()
  @Public()
  @ApiProjectOperation({
    operationId: "projectsListPublished",
    summary: "List published Projects",
    success: 200,
    response: ProjectListResponseDto,
    security: "public",
    errors: { 400: ["request.validation.v1"] },
  })
  async listPublished(@Query() query: ProjectPageQueryDto) {
    return pageBody(await this.queries.listPublished(query));
  }

  @Get("owned")
  @ApiProjectOperation({
    operationId: "projectsListOwned",
    summary: "List owned Projects",
    success: 200,
    response: ProjectListResponseDto,
    security: "protected",
    errors: { 400: ["request.validation.v1"] },
  })
  async listOwned(@Req() request: RequestWithSession, @Query() query: ProjectPageQueryDto) {
    return pageBody(await this.queries.listOwned(requiredUser(request), query));
  }

  @Get(":projectId/readiness")
  @ApiProjectOperation({
    operationId: "projectReadiness",
    summary: "Check whether a Project is ready to publish",
    success: 200,
    security: "protected",
    projectParam: true,
    errors: { 400: ["request.validation.v1"], 404: ["project.not_found.v1"] },
  })
  getReadiness(@Req() request: RequestWithSession, @Param("projectId") rawProjectId: string) {
    return this.queries.getReadiness(requiredUser(request), ProjectId(id(rawProjectId)));
  }

  @Get(":projectId/forks")
  @Public()
  @ApiProjectOperation({
    operationId: "projectForksList",
    summary: "List Projects forked from a Project",
    success: 200,
    security: "optional",
    projectParam: true,
    errors: { 400: ["request.validation.v1"] },
  })
  async forks(@Req() request: RequestWithSession, @Param("projectId") rawProjectId: string) {
    const session = await this.sessions.readSession(request);
    return this.queries.getForkedProjects(session === null ? null : UserId(session.id), ProjectId(id(rawProjectId)));
  }

  @Get(":projectId")
  @Public()
  @ApiProjectOperation({
    operationId: "projectsGetPublished",
    summary: "Read a published Project snapshot",
    success: 200,
    response: PublishedProjectResponseDto,
    security: "public",
    projectParam: true,
    errors: { 400: ["request.validation.v1"], 404: ["project.not_found.v1"] },
  })
  async published(@Param("projectId") rawProjectId: string) {
    return projectBody(await this.queries.published(ProjectId(id(rawProjectId))));
  }

  @Get(":projectId/draft")
  @ApiProjectOperation({
    operationId: "projectsGetDraft",
    summary: "Read current Project draft",
    success: 200,
    response: ProjectDraftResponseDto,
    security: "protected",
    projectParam: true,
    errors: { 400: ["request.validation.v1"], 404: ["project.not_found.v1"] },
  })
  async draft(@Req() request: RequestWithSession, @Param("projectId") rawProjectId: string) {
    return projectBody(await this.queries.draft(requiredUser(request), ProjectId(id(rawProjectId))));
  }

  @Patch(":projectId")
  @ApiProjectOperation({
    operationId: "projectsUpdate",
    summary: "Update Project draft metadata",
    success: 200,
    response: ProjectDraftResponseDto,
    security: "protected",
    projectParam: true,
    ifMatch: true,
    etag: true,
    errors: { 400: ["request.validation.v1"], 404: ["project.not_found.v1"], 409: ["project.version_conflict.v1"] },
  })
  async update(
    @Req() request: RequestWithSession,
    @Param("projectId") rawProjectId: string,
    @Headers("if-match") match: string | string[] | undefined,
    @Body() body: UpdateProjectDto,
    @Res() response: Response,
  ) {
    if (body.title === undefined && body.description === undefined && body.tags === undefined && body.repo_url === undefined) {
      throw new ProjectError(400, "request.validation.v1", "PATCH должен менять хотя бы одно поле");
    }
    const result = await this.commands.updateProject(requiredUser(request), ProjectId(id(rawProjectId)), parseIfMatch(match), body);
    response.set("ETag", projectEtag(result.version)).status(200).json(projectBody(result.value));
  }

  @Delete(":projectId")
  @HttpCode(204)
  @ApiProjectOperation({
    operationId: "projectsDelete",
    summary: "Soft-delete a Project",
    success: 204,
    security: "protected",
    projectParam: true,
    ifMatch: true,
    errors: { 400: ["request.validation.v1"], 404: ["project.not_found.v1"], 409: ["project.version_conflict.v1"] },
  })
  async remove(@Req() request: RequestWithSession, @Param("projectId") rawProjectId: string, @Headers("if-match") match: string | string[] | undefined) {
    await this.commands.deleteProject(requiredUser(request), ProjectId(id(rawProjectId)), parseIfMatch(match));
  }

  @Post(":projectId/models")
  @ApiProjectOperation({
    operationId: "projectModelsCreate",
    summary: "Create a Model with its seed revision",
    success: 201,
    response: ModelResponseDto,
    security: "protected",
    projectParam: true,
    ifMatch: true,
    idempotency: true,
    multipart: "model",
    location: true,
    etag: true,
    errors: {
      400: ["request.validation.v1", "project.file_format_mismatch.v1"],
      404: ["project.not_found.v1"],
      409: ["project.version_conflict.v1", "project.idempotency_conflict.v1", "project.request_in_progress.v1"],
      413: ["request.payload_too_large.v1"],
      415: ["request.unsupported_media_type.v1"],
    },
  })
  async createModel(
    @Req() request: RequestWithSession,
    @Param("projectId") rawProjectId: string,
    @Headers("if-match") match: string | string[] | undefined,
    @Headers("idempotency-key") key: string | string[] | undefined,
    @Res() response: Response,
  ) {
    const multipart = this.parseUploadStream(request, UPLOAD_LIMITS.source);
    const file = await multipart.file;
    this.concurrency.acquire();
    const sourcePromise = this.uploads.acceptSource({
      ownerId: requiredUser(request),
      inputStream: file.stream,
      mimeType: file.mime,
      originalName: file.filename,
    }).finally(() => this.concurrency.release());
    await multipart.completed;
    const body = this.createModelBody(multipart.fields);
    const source = await sourcePromise;
    const projectId = ProjectId(id(rawProjectId));
    const result = await this.commands.createModel(requiredUser(request), projectId, parseIfMatch(match), body, source, parseIdempotencyKey(key));
    response.set("Location", `/projects/${projectId}/models/${result.value.id}`).set("ETag", projectEtag(result.version)).status(201).json(modelBody(result.value));
  }

  @Get(":projectId/models")
  @ApiProjectOperation({
    operationId: "projectModelsList",
    summary: "List Project Models",
    success: 200,
    response: ModelListResponseDto,
    security: "protected",
    projectParam: true,
    errors: { 400: ["request.validation.v1"], 404: ["project.not_found.v1"] },
  })
  async models(@Req() request: RequestWithSession, @Param("projectId") rawProjectId: string, @Query() query: ProjectPageQueryDto) {
    return pageBody(await this.queries.models(requiredUser(request), ProjectId(id(rawProjectId)), query));
  }

  @Get(":projectId/models/:modelId")
  @ApiProjectOperation({
    operationId: "projectModelsGet",
    summary: "Read a Project Model",
    success: 200,
    response: ModelResponseDto,
    security: "protected",
    projectParam: true,
    modelParam: true,
    errors: { 400: ["request.validation.v1"], 404: ["project.not_found.v1", "project.model_not_found.v1"] },
  })
  async model(@Req() request: RequestWithSession, @Param("projectId") rawProjectId: string, @Param("modelId") rawModelId: string) {
    return modelBody(await this.queries.model(requiredUser(request), ProjectId(id(rawProjectId)), ModelId(id(rawModelId))));
  }

  @Delete(":projectId/models/:modelId")
  @HttpCode(204)
  @ApiProjectOperation({
    operationId: "projectModelsDelete",
    summary: "Soft-delete a Project Model",
    success: 204,
    security: "protected",
    projectParam: true,
    modelParam: true,
    ifMatch: true,
    errors: { 400: ["request.validation.v1"], 404: ["project.not_found.v1", "project.model_not_found.v1"], 409: ["project.version_conflict.v1", "project.model_published.v1"] },
  })
  async removeModel(
    @Req() request: RequestWithSession,
    @Param("projectId") rawProjectId: string,
    @Param("modelId") rawModelId: string,
    @Headers("if-match") match: string | string[] | undefined,
    @Res() response: Response,
  ) {
    const version = await this.commands.deleteModel(requiredUser(request), ProjectId(id(rawProjectId)), ModelId(id(rawModelId)), parseIfMatch(match));
    response.set("ETag", projectEtag(version)).status(204).end();
  }

  @Post(":projectId/models/:modelId/revisions")
  @ApiProjectOperation({
    operationId: "projectModelRevisionsCreate",
    summary: "Upload a new Model revision",
    success: 201,
    response: ModelRevisionResponseDto,
    security: "protected",
    projectParam: true,
    modelParam: true,
    ifMatch: true,
    idempotency: true,
    multipart: "revision",
    location: true,
    etag: true,
    errors: {
      400: ["request.validation.v1", "project.file_format_mismatch.v1"],
      404: ["project.not_found.v1", "project.model_not_found.v1"],
      409: ["project.version_conflict.v1", "project.idempotency_conflict.v1", "project.request_in_progress.v1"],
      413: ["request.payload_too_large.v1"],
      415: ["request.unsupported_media_type.v1"],
    },
  })
  async createRevision(
    @Req() request: RequestWithSession,
    @Param("projectId") rawProjectId: string,
    @Param("modelId") rawModelId: string,
    @Headers("if-match") match: string | string[] | undefined,
    @Headers("idempotency-key") key: string | string[] | undefined,
    @Res() response: Response,
  ) {
    const multipart = this.parseUploadStream(request, UPLOAD_LIMITS.source);
    const file = await multipart.file;
    this.concurrency.acquire();
    const sourcePromise = this.uploads.acceptSource({
      ownerId: requiredUser(request),
      inputStream: file.stream,
      mimeType: file.mime,
      originalName: file.filename,
    }).finally(() => this.concurrency.release());
    await multipart.completed;
    const source = await sourcePromise;
    const projectId = ProjectId(id(rawProjectId));
    const modelId = ModelId(id(rawModelId));
    const result = await this.commands.createRevision(requiredUser(request), projectId, modelId, parseIfMatch(match), source, parseIdempotencyKey(key));
    response
      .set("Location", `/projects/${projectId}/models/${modelId}/revisions/${result.value.id}`)
      .set("ETag", projectEtag(result.version))
      .status(201)
      .json(revisionBody(result.value));
  }

  private parseUploadStream(request: Request, maxBytes: number): {
    readonly file: Promise<{ readonly stream: NodeJS.ReadableStream; readonly mime: string; readonly filename: string }>;
    readonly completed: Promise<void>;
    readonly fields: Record<string, string>;
  } {
    const fields: Record<string, string> = {};
    let resolveFile: ((file: { readonly stream: NodeJS.ReadableStream; readonly mime: string; readonly filename: string }) => void) | undefined;
    let rejectFile: ((error: Error) => void) | undefined;
    const file = new Promise<{ readonly stream: NodeJS.ReadableStream; readonly mime: string; readonly filename: string }>((resolve, reject) => {
      resolveFile = resolve;
      rejectFile = reject;
    });
    let resolveCompleted: (() => void) | undefined;
    let rejectCompleted: ((error: Error) => void) | undefined;
    const completed = new Promise<void>((resolve, reject) => {
      resolveCompleted = resolve;
      rejectCompleted = reject;
    });
    const fail = (error: Error) => {
      rejectFile?.(error);
      rejectCompleted?.(error);
    };
    const parser = Busboy({ headers: request.headers, limits: { fileSize: maxBytes, files: 1, fields: 8 } });
    let seenFile = false;
    parser.on("field", (name, value) => {
      if (Object.hasOwn(fields, name)) {
        fail(new BadRequestException(`Повторное поле ${name}`));
        return;
      }
      fields[name] = value;
    });
    parser.on("file", (field, stream, info) => {
      if (field !== "file" || seenFile) {
        stream.resume();
        fail(new BadRequestException("Допустим только один файл в поле file"));
        return;
      }
      seenFile = true;
      stream.once("limit", () => stream.destroy(new Error(`TOO_LARGE:${maxBytes}`)));
      resolveFile?.({ stream, mime: info.mimeType || "application/octet-stream", filename: info.filename || "file" });
    });
    parser.once("filesLimit", () => fail(new BadRequestException("Допустим только один файл")));
    parser.once("fieldsLimit", () => fail(new BadRequestException("Слишком много полей multipart")));
    parser.once("error", fail);
    parser.once("finish", () => {
      if (!seenFile) {
        fail(new BadRequestException("Требуется файл"));
        return;
      }
      resolveCompleted?.();
    });
    request.pipe(parser);
    return { file, completed, fields };
  }

  private createModelBody(fields: Record<string, string>): CreateModelDto {
    const keys = Object.keys(fields);
    if (keys.some((key) => !["name", "manufacturing_method", "requires_ams"].includes(key))) throw new BadRequestException("Неизвестное поле multipart");
    const name = fields.name;
    if (name === undefined || name.trim().length === 0 || name.length > 120) throw new BadRequestException("Некорректное name");
    const manufacturingMethod = fields.manufacturing_method;
    if (manufacturingMethod !== undefined && !["fdm", "sla", "cnc", "laser"].includes(manufacturingMethod)) throw new BadRequestException("Некорректное manufacturing_method");
    const requiresAms = fields.requires_ams;
    if (requiresAms !== undefined && requiresAms !== "true" && requiresAms !== "false") throw new BadRequestException("Некорректное requires_ams");
    return {
      name,
      ...(manufacturingMethod === undefined ? {} : { manufacturing_method: manufacturingMethod as CreateModelDto["manufacturing_method"] }),
      ...(requiresAms === undefined ? {} : { requires_ams: requiresAms === "true" }),
    };
  }

  @Get(":projectId/models/:modelId/revisions")
  @ApiProjectOperation({
    operationId: "projectModelRevisionsList",
    summary: "List Model revisions",
    success: 200,
    response: ModelRevisionListResponseDto,
    security: "protected",
    projectParam: true,
    modelParam: true,
    errors: { 400: ["request.validation.v1"], 404: ["project.not_found.v1", "project.model_not_found.v1"] },
  })
  async revisions(@Req() request: RequestWithSession, @Param("projectId") rawProjectId: string, @Param("modelId") rawModelId: string, @Query() query: ProjectPageQueryDto) {
    return pageBody(await this.queries.revisions(requiredUser(request), ProjectId(id(rawProjectId)), ModelId(id(rawModelId)), query));
  }

  @Get(":projectId/models/:modelId/revisions/:revisionId")
  @ApiProjectOperation({
    operationId: "projectModelRevisionsGet",
    summary: "Read a Model revision",
    success: 200,
    response: ModelRevisionResponseDto,
    security: "protected",
    projectParam: true,
    modelParam: true,
    revisionParam: true,
    errors: { 400: ["request.validation.v1"], 404: ["project.not_found.v1", "project.model_not_found.v1", "project.revision_not_found.v1"] },
  })
  async revision(@Req() request: RequestWithSession, @Param("projectId") rawProjectId: string, @Param("modelId") rawModelId: string, @Param("revisionId") rawRevisionId: string) {
    return revisionBody(await this.queries.revision(requiredUser(request), ProjectId(id(rawProjectId)), ModelId(id(rawModelId)), ModelRevisionId(id(rawRevisionId))));
  }

  @Get(":projectId/models/:modelId/revisions/:revisionId/source")
  @ApiProjectOperation({
    operationId: "projectModelRevisionSourceGet",
    summary: "Redirect to a revision source",
    success: 302,
    security: "protected",
    projectParam: true,
    modelParam: true,
    revisionParam: true,
    location: true,
    errors: { 400: ["request.validation.v1"], 404: ["project.not_found.v1", "project.model_not_found.v1", "project.revision_not_found.v1", "project.asset_not_found.v1"] },
  })
  async source(
    @Req() request: RequestWithSession,
    @Param("projectId") rawProjectId: string,
    @Param("modelId") rawModelId: string,
    @Param("revisionId") rawRevisionId: string,
    @Res() response: Response,
  ) {
    const url = await this.queries.asset(requiredUser(request), ProjectId(id(rawProjectId)), ModelId(id(rawModelId)), ModelRevisionId(id(rawRevisionId)), "source");
    response.status(302).set("Location", url).end();
  }

  @Get(":projectId/models/:modelId/revisions/:revisionId/preview.glb")
  @ApiProjectOperation({
    operationId: "projectModelRevisionPreviewGet",
    summary: "Redirect to a published or owned revision preview",
    success: 302,
    security: "optional",
    projectParam: true,
    modelParam: true,
    revisionParam: true,
    location: true,
    errors: { 400: ["request.validation.v1"], 404: ["project.not_found.v1", "project.model_not_found.v1", "project.revision_not_found.v1", "project.asset_not_found.v1"] },
  })
  async preview(
    @Req() request: RequestWithSession,
    @Param("projectId") rawProjectId: string,
    @Param("modelId") rawModelId: string,
    @Param("revisionId") rawRevisionId: string,
    @Res() response: Response,
  ) {
    const session = await this.sessions.readSession(request);
    const url = await this.queries.asset(
      session === null ? null : UserId(session.id),
      ProjectId(id(rawProjectId)),
      ModelId(id(rawModelId)),
      ModelRevisionId(id(rawRevisionId)),
      "preview",
    );
    response.status(302).set("Location", url).end();
  }

  @Put(":projectId/primary-model")
  @ApiProjectOperation({
    operationId: "projectPrimaryModelSet",
    summary: "Set the Project primary Model",
    success: 200,
    response: ProjectDraftResponseDto,
    security: "protected",
    projectParam: true,
    ifMatch: true,
    etag: true,
    errors: {
      400: ["request.validation.v1"],
      404: ["project.not_found.v1", "project.model_not_found.v1"],
      409: ["project.version_conflict.v1", "project.ready_primary_required.v1"],
    },
  })
  async setPrimary(
    @Req() request: RequestWithSession,
    @Param("projectId") rawProjectId: string,
    @Headers("if-match") match: string | string[] | undefined,
    @Body() body: SetPrimaryModelDto,
    @Res() response: Response,
  ) {
    const result = await this.commands.setPrimary(requiredUser(request), ProjectId(id(rawProjectId)), ModelId(id(body.model_id)), parseIfMatch(match));
    response.set("ETag", projectEtag(result.version)).status(200).json(projectBody(result.value));
  }

  @Delete(":projectId/primary-model")
  @HttpCode(204)
  @ApiProjectOperation({
    operationId: "projectPrimaryModelClear",
    summary: "Clear the Project primary Model",
    success: 204,
    security: "protected",
    projectParam: true,
    ifMatch: true,
    errors: { 400: ["request.validation.v1"], 404: ["project.not_found.v1"], 409: ["project.version_conflict.v1", "project.primary_model_published.v1"] },
  })
  async clearPrimary(
    @Req() request: RequestWithSession,
    @Param("projectId") rawProjectId: string,
    @Headers("if-match") match: string | string[] | undefined,
    @Res() response: Response,
  ) {
    const version = await this.commands.clearPrimary(requiredUser(request), ProjectId(id(rawProjectId)), parseIfMatch(match));
    response.set("ETag", projectEtag(version)).status(204).end();
  }

  @Put(":projectId/publication")
  @ApiProjectOperation({
    operationId: "projectPublicationSet",
    summary: "Publish an immutable Project snapshot",
    success: 200,
    response: PublicationResponseDto,
    security: "protected",
    projectParam: true,
    ifMatch: true,
    etag: true,
    errors: {
      400: ["request.validation.v1"],
      404: ["project.not_found.v1"],
      409: ["project.version_conflict.v1", "project.primary_model_required.v1", "project.ready_primary_required.v1", "project.publication_conflict.v1"],
    },
  })
  async publish(
    @Req() request: RequestWithSession,
    @Param("projectId") rawProjectId: string,
    @Headers("if-match") match: string | string[] | undefined,
    @Body() body: PublishProjectDto,
    @Res() response: Response,
  ) {
    if (body.confirmed !== true) throw new ProjectError(400, "request.validation.v1", "Подтвердите публикацию");
    const result = await this.lifecycle.publish(requiredUser(request), ProjectId(id(rawProjectId)), parseIfMatch(match), body);
    response.set("ETag", projectEtag(result.version)).status(200).json({ contract_version: PROJECT_CONTRACT_VERSION, publication: result.value });
  }

  @Delete(":projectId/publication")
  @HttpCode(204)
  @ApiProjectOperation({
    operationId: "projectPublicationClear",
    summary: "Unpublish a Project",
    success: 204,
    security: "protected",
    projectParam: true,
    ifMatch: true,
    errors: { 400: ["request.validation.v1"], 404: ["project.not_found.v1"], 409: ["project.version_conflict.v1"] },
  })
  async unpublish(
    @Req() request: RequestWithSession,
    @Param("projectId") rawProjectId: string,
    @Headers("if-match") match: string | string[] | undefined,
    @Res() response: Response,
  ) {
    const version = await this.lifecycle.unpublish(requiredUser(request), ProjectId(id(rawProjectId)), parseIfMatch(match));
    response.set("ETag", projectEtag(version)).status(204).end();
  }

  @Post(":projectId/archive")
  @ApiProjectOperation({
    operationId: "projectArchive",
    summary: "Archive a Project",
    success: 200,
    response: ProjectLifecycleResponseDto,
    security: "protected",
    projectParam: true,
    ifMatch: true,
    etag: true,
    errors: { 400: ["request.validation.v1", "project.invalid_transition.v1"], 404: ["project.not_found.v1"], 409: ["project.version_conflict.v1"] },
  })
  async archive(
    @Req() request: RequestWithSession,
    @Param("projectId") rawProjectId: string,
    @Headers("if-match") match: string | string[] | undefined,
    @Res() response: Response,
  ) {
    const result = await this.lifecycle.archive(requiredUser(request), ProjectId(id(rawProjectId)), parseIfMatch(match));
    response.set("ETag", projectEtag(result.version)).status(200).json({ contract_version: PROJECT_CONTRACT_VERSION });
  }

  @Post(":projectId/restore")
  @ApiProjectOperation({
    operationId: "projectRestore",
    summary: "Restore an archived Project",
    success: 200,
    response: ProjectLifecycleResponseDto,
    security: "protected",
    projectParam: true,
    ifMatch: true,
    etag: true,
    errors: { 400: ["request.validation.v1", "project.invalid_transition.v1"], 404: ["project.not_found.v1"], 409: ["project.version_conflict.v1"] },
  })
  async restore(
    @Req() request: RequestWithSession,
    @Param("projectId") rawProjectId: string,
    @Headers("if-match") match: string | string[] | undefined,
    @Res() response: Response,
  ) {
    const result = await this.lifecycle.restore(requiredUser(request), ProjectId(id(rawProjectId)), parseIfMatch(match));
    response.set("ETag", projectEtag(result.version)).status(200).json({ contract_version: PROJECT_CONTRACT_VERSION });
  }
}
