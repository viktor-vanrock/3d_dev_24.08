import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Inject, Injectable } from "@nestjs/common";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";

@Injectable()
export class IdentityStorageAdapter {
  private client: S3Client | null | undefined;

  constructor(@Inject(RuntimeLogger) private readonly logger: RuntimeLogger) {}

  private getClient(): S3Client | null {
    if (this.client !== undefined) return this.client;
    const { S3_ENDPOINT: endpoint, S3_ACCESS_KEY: accessKeyId, S3_SECRET_KEY: secretAccessKey } = process.env;
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      this.client = null;
      return null;
    }
    this.client = new S3Client({
      endpoint,
      region: process.env.S3_REGION ?? "ru-central-1",
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
    return this.client;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const client = this.getClient();
    if (client === null) {
      this.logger.info({ event: "auth.identity.storage.skipped", reason: "s3_not_configured" }, "Identity audit skipped");
      return;
    }
    try {
      await client.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET_AUTH ?? "auth", Key: key, Body: body }));
    } catch {
      this.logger.error({ event: "auth.identity.storage.failed" }, "Identity audit write failed");
    }
  }
}
