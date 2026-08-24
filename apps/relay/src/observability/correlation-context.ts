import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";

interface CorrelationState {
  readonly correlationId: string;
}

const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

@Injectable()
export class CorrelationContext {
  private readonly storage = new AsyncLocalStorage<CorrelationState>();

  run<T>(correlationId: string | undefined, callback: () => T): T {
    const acceptedId = correlationId?.trim();
    const safeId = acceptedId && SAFE_CORRELATION_ID.test(acceptedId) ? acceptedId : randomUUID();
    return this.storage.run({ correlationId: safeId }, callback);
  }

  get currentId(): string | undefined {
    return this.storage.getStore()?.correlationId;
  }

  currentOrCreate(): string {
    return this.currentId ?? randomUUID();
  }
}
