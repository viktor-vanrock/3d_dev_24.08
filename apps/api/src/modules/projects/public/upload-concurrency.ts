export const UPLOAD_CONCURRENCY_PORT = Symbol("UPLOAD_CONCURRENCY_PORT");

export interface UploadConcurrencyPort {
  acquire(): void;
  release(): void;
  getActive(): number;
}
