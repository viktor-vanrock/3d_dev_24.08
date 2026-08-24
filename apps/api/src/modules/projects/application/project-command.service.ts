import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { Inject, Injectable } from "@nestjs/common";
import type { ModelId, ProjectId, UserId } from "../../_kernel/brandedIds.ts";
import { putModelObjectStream } from "../../../storage/s3.ts";
import { craftForRole, DecompressionLimitError, detectAndValidateFormat, FormatMismatchError, UnsupportedFormatError } from "../../models/public/index.ts";
import { PROJECT_UPLOAD_MAX_BYTES, sha256Canonical, type ModelCreateInput, type ProjectMetadataInput, type ProjectPatchInput, type ProjectUpload } from "../domain/project.ts";
import { ProjectError } from "../domain/project.errors.ts";
import type { ProjectRepository, UploadedSource } from "../domain/project.repository.ts";
import { PostgresProjectRepository } from "../infrastructure/postgres-project.repository.ts";

const ACCEPTED_MIME = new Set([
  "application/octet-stream",
  "model/stl",
  "application/sla",
  "model/obj",
  "text/plain",
  "model/3mf",
  "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
  "model/step",
  "application/step",
  "image/vnd.dxf",
  "application/dxf",
  "image/svg+xml",
  "application/zip",
]);

function sourceBlobKey(ownerId: string, checksum: Buffer): string {
  return `protected/blobs/${ownerId}/${checksum.toString("hex")}`;
}

@Injectable()
export class ProjectCommandService {
  private readonly repository: ProjectRepository;

  constructor(@Inject(PostgresProjectRepository) repository: PostgresProjectRepository) {
    this.repository = repository;
  }

  createProject(actorId: UserId, input: ProjectMetadataInput, key: string) {
    return this.repository.createProject(actorId, input, key, sha256Canonical(input));
  }

  updateProject(actorId: UserId, projectId: ProjectId, version: number, patch: ProjectPatchInput) {
    return this.repository.updateProject(actorId, projectId, version, patch);
  }

  deleteProject(actorId: UserId, projectId: ProjectId, version: number) {
    return this.repository.deleteProject(actorId, projectId, version);
  }

  async createModel(actorId: UserId, projectId: ProjectId, version: number, input: ModelCreateInput, file: ProjectUpload, key: string) {
    const source = await this.acceptSource(actorId, file);
    const fingerprint = sha256Canonical({ input, checksum: source.checksum.toString("hex"), size: source.sizeBytes, format: source.sourceFormat });
    return this.repository.createModel(actorId, projectId, version, input, source, key, fingerprint);
  }

  async createRevision(actorId: UserId, projectId: ProjectId, modelId: ModelId, version: number, file: ProjectUpload, key: string) {
    const source = await this.acceptSource(actorId, file);
    const fingerprint = sha256Canonical({ checksum: source.checksum.toString("hex"), size: source.sizeBytes, format: source.sourceFormat });
    return this.repository.createRevision(actorId, projectId, modelId, version, source, key, fingerprint);
  }

  deleteModel(actorId: UserId, projectId: ProjectId, modelId: ModelId, version: number) {
    return this.repository.deleteModel(actorId, projectId, modelId, version);
  }

  setPrimary(actorId: UserId, projectId: ProjectId, modelId: ModelId, version: number) {
    return this.repository.setPrimary(actorId, projectId, modelId, version);
  }

  clearPrimary(actorId: UserId, projectId: ProjectId, version: number) {
    return this.repository.clearPrimary(actorId, projectId, version);
  }

  publish(actorId: UserId, projectId: ProjectId, version: number) {
    return this.repository.publish(actorId, projectId, version);
  }

  unpublish(actorId: UserId, projectId: ProjectId, version: number) {
    return this.repository.unpublish(actorId, projectId, version);
  }

  private async acceptSource(actorId: UserId, file: ProjectUpload | undefined): Promise<UploadedSource> {
    if (file === undefined) throw new ProjectError(400, "request.validation.v1", "Требуется файл");
    if (file.size > PROJECT_UPLOAD_MAX_BYTES || file.buffer.length > PROJECT_UPLOAD_MAX_BYTES) {
      throw new ProjectError(413, "request.payload_too_large.v1", "Файл превышает 100 МиБ");
    }
    if (!ACCEPTED_MIME.has(file.mimetype.toLowerCase())) {
      throw new ProjectError(415, "request.unsupported_media_type.v1", "MIME-тип файла не поддерживается");
    }
    let detected;
    try {
      detected = detectAndValidateFormat(file.originalname, file.buffer);
    } catch (error) {
      if (error instanceof UnsupportedFormatError) {
        throw new ProjectError(415, "request.unsupported_media_type.v1", "Формат файла не поддерживается");
      }
      if (error instanceof FormatMismatchError || error instanceof DecompressionLimitError) {
        throw new ProjectError(400, "project.file_format_mismatch.v1", "Содержимое файла не совпадает с форматом");
      }
      throw error;
    }
    const checksum = createHash("sha256").update(file.buffer).digest();
    const objectKey = sourceBlobKey(actorId, checksum);
    await putModelObjectStream(objectKey, Readable.from(file.buffer), file.mimetype);
    return {
      checksum,
      sizeBytes: file.size,
      filename: file.originalname,
      mimeType: file.mimetype,
      sourceFormat: detected.format,
      craft: craftForRole(detected.role),
      role: detected.role,
      objectKey,
    };
  }
}
