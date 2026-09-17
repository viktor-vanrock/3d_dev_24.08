import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

@Injectable()
export class UploadConcurrencyService {
  private readonly logger = new Logger(UploadConcurrencyService.name);
  private readonly maxConcurrent = 10;
  private active = 0;

  acquire(): void {
    if (this.active >= this.maxConcurrent) {
      this.logger.warn(`Upload concurrency limit reached: ${this.active}/${this.maxConcurrent}`);
      throw new ServiceUnavailableException({ code: "upload.too_many_concurrent.v1", message: "Слишком много одновременных загрузок, повторите позже" });
    }
    this.active += 1;
  }

  release(): void {
    this.active -= 1;
  }

  getActive(): number {
    return this.active;
  }
}
