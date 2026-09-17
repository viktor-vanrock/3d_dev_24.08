import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { getModelObjectRange, getModelObjectStream, deleteObject, moveObject, putStreamingObject } from "../../../storage/s3.ts";
import { craftForRole, DecompressionLimitError, detectAndValidateFormat, FormatMismatchError, UnsupportedFormatError } from "../../models/public/index.ts";
import type { UploadedSource } from "../domain/project.repository.ts";
import { ALLOWED_MIME, FILE_ROLE, type FileRole, tempObjectKey, UPLOAD_LIMITS, UploadError, UploadErrors } from "../domain/upload.ts";
import { UploadSessionRepository } from "../infrastructure/upload-session.repository.ts";

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private static readonly TTL_MS = 2 * 60 * 60 * 1000;

  constructor(private readonly sessions: UploadSessionRepository) {}

  async acceptSource(params: { readonly ownerId: string; readonly inputStream: NodeJS.ReadableStream; readonly mimeType: string; readonly originalName: string }): Promise<UploadedSource> {
    const accepted = await this.acceptStream({ ...params, role: FILE_ROLE.SOURCE });
    return accepted.source;
  }

  async acceptStream(params: { readonly ownerId: string; readonly role: FileRole; readonly inputStream: NodeJS.ReadableStream; readonly mimeType: string; readonly originalName: string }): Promise<{ readonly uploadId: string; readonly finalKey: string; readonly checksum: Buffer; readonly sizeBytes: number; readonly source: UploadedSource }> {
    const mimeType = params.mimeType.toLowerCase();
    if (!ALLOWED_MIME[params.role].has(mimeType)) throw UploadErrors.unsupportedMime(params.mimeType);

    const uploadId = randomUUID();
    const tempKey = tempObjectKey(uploadId);
    await this.sessions.create({
      id: uploadId,
      ownerId: params.ownerId,
      role: params.role,
      objectKey: tempKey,
      expiresAt: new Date(Date.now() + UploadService.TTL_MS),
    });

    let checksum: Buffer;
    let sizeBytes: number;
    try {
      ({ checksum, sizeBytes } = await putStreamingObject(tempKey, params.inputStream, mimeType, UPLOAD_LIMITS[params.role]));
      await this.sessions.markValidating(uploadId, params.ownerId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.sessions.markFailed({
        id: uploadId,
        ownerId: params.ownerId,
        errorCode: message.startsWith("TOO_LARGE:") ? "upload.too_large.v1" : "upload.stream_error.v1",
        errorMessage: message,
      });
      if (message.startsWith("TOO_LARGE:")) throw UploadErrors.tooLarge(params.role);
      throw error;
    }

    let detection: ReturnType<typeof detectAndValidateFormat> | null = null;
    try {
      if (params.role === FILE_ROLE.SOURCE) detection = await this.validateSourceInS3(tempKey, params.originalName);
      else await this.validateImageSignature(tempKey, params.role);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.sessions.markFailed({ id: uploadId, ownerId: params.ownerId, errorCode: error instanceof UploadError ? error.code : "upload.format_mismatch.v1", errorMessage: message });
      await deleteObject(tempKey).catch(() => undefined);
      if (error instanceof UnsupportedFormatError) throw UploadErrors.unsupportedMime(mimeType);
      if (error instanceof FormatMismatchError || error instanceof DecompressionLimitError) throw UploadErrors.formatMismatch();
      throw error;
    }

    const finalKey = `protected/blobs/${params.ownerId}/${checksum.toString("hex")}`;
    try {
      await moveObject(tempKey, finalKey);
      const updated = await this.sessions.markReady({
        id: uploadId,
        ownerId: params.ownerId,
        finalKey,
        mimeType,
        sizeBytes,
        checksum,
        name: params.originalName,
      });
      if (updated === null) throw new Error("upload session was not ready to finalize");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.sessions.markFailed({ id: uploadId, ownerId: params.ownerId, errorCode: "upload.finalize_error.v1", errorMessage: message });
      throw error;
    }

    this.logger.log(`Upload accepted uploadId=${uploadId} role=${params.role} size=${sizeBytes}`);
    return {
      uploadId,
      finalKey,
      checksum,
      sizeBytes,
      source: {
        checksum,
        sizeBytes,
        filename: params.originalName,
        mimeType,
        sourceFormat: detection?.format ?? "stl",
        craft: craftForRole(detection?.role ?? "source"),
        role: detection?.role ?? "source",
        objectKey: finalKey,
      },
    };
  }

  async claimUpload(uploadId: string, ownerId: string) {
    const session = await this.sessions.findReadyOwned(uploadId, ownerId);
    if (session === null) throw UploadErrors.uploadNotFound();
    return session;
  }

  private async validateSourceInS3(tempKey: string, originalName: string): Promise<ReturnType<typeof detectAndValidateFormat>> {
    const object = await getModelObjectStream(tempKey);
    if (object === null) throw new Error("temporary upload object was not found");
    const chunks: Buffer<ArrayBufferLike>[] = [];
    for await (const chunk of object.body) chunks.push(Buffer.from(chunk));
    return detectAndValidateFormat(originalName, Buffer.concat(chunks));
  }

  private async validateImageSignature(tempKey: string, role: Exclude<FileRole, "source">): Promise<void> {
    const stream = await getModelObjectRange(tempKey, "bytes=0-11");
    if (stream === null) throw new Error("temporary upload object was not found");
    const head = Buffer.alloc(12);
    let offset = 0;
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes.copy(head, offset, 0, Math.min(bytes.length, head.length - offset));
      offset += bytes.length;
      if (offset >= head.length) break;
    }
    const png = head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    const webp = head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP";
    const mp4 = head.subarray(4, 8).toString("ascii") === "ftyp";
    const valid = role === FILE_ROLE.MEDIA ? png || jpeg || mp4 : png || jpeg || webp;
    if (!valid) throw UploadErrors.signatureFailed();
  }
}
