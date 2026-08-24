import { Injectable } from "@nestjs/common";
import { getModelObjectStream, modelPublicUrl, type ModelObjectStream } from "../../../storage/s3.ts";

@Injectable()
export class SeoStorageAdapter {
  publicUrl(key: string): string | null {
    return modelPublicUrl(key);
  }

  async object(key: string): Promise<ModelObjectStream | null> {
    return getModelObjectStream(key);
  }
}
