import { Injectable } from "@nestjs/common";
import { Readable } from "node:stream";
import {
  avatarObjectKey,
  avatarSnapshotObjectKey,
  deleteModelObject,
  getModelObjectStream,
  isModelsStorageConfigured,
  modelPublicUrl,
  putModelObjectStream,
  type ModelObjectStream,
} from "../../../storage/s3.ts";
import type { AvatarSnapshotSide } from "../domain/profile.ts";

@Injectable()
export class ProfileStorageAdapter {
  configured(): boolean {
    return isModelsStorageConfigured();
  }

  avatarKey(userId: string, fileId: string, ext: string): string {
    return avatarObjectKey(userId, fileId, ext);
  }

  snapshotKey(userId: string, revision: number, side: AvatarSnapshotSide, sha256: string, fileId: string): string {
    return avatarSnapshotObjectKey(userId, revision, side, sha256, fileId, "png");
  }

  async put(key: string, body: Buffer, contentType: string, cacheControl?: string): Promise<void> {
    await putModelObjectStream(key, Readable.from(body), contentType, cacheControl);
  }

  async delete(key: string): Promise<void> {
    await deleteModelObject(key);
  }

  publicUrl(key: string): string | null {
    return modelPublicUrl(key);
  }

  async object(key: string): Promise<ModelObjectStream | null> {
    return getModelObjectStream(key);
  }
}
