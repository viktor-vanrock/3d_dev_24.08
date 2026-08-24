import type { UserId } from "../../_kernel/brandedIds.ts";
import type { PrintRequestStatus } from "../domain/print-requests.ts";

export const PRINT_REQUESTS_PORT = Symbol("PRINT_REQUESTS_PORT");
export const PRINT_REQUESTS_PROFILE_PORT = Symbol("PRINT_REQUESTS_PROFILE_PORT");
export const PRINT_REQUESTS_RATE_LIMIT_PORT = Symbol("PRINT_REQUESTS_RATE_LIMIT_PORT");

export interface PrintRequestRecord {
  readonly id: string;
  readonly master_id: UserId;
  readonly client_id: UserId;
  readonly model_id: string | null;
  readonly model_file_id: string | null;
  readonly material_id: string | null;
  readonly material_variant_id: string | null;
  readonly quantity: number;
  readonly due_date: string | null;
  readonly client_note: string | null;
  readonly master_note: string | null;
  readonly status: PrintRequestStatus;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface PrintRequestsProfilePort {
  exists(userId: UserId): Promise<boolean>;
}

export interface PrintRequestIdentity {
  readonly ip: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

export interface PrintRequestsRateLimitPort {
  checkCreate(
    identity: PrintRequestIdentity,
    userId: UserId,
  ): Promise<{
    readonly limited: boolean;
    readonly retryAfterSeconds?: number;
    readonly limit: number;
    readonly remaining: number;
    readonly reset: number;
  }>;
}

export interface CreatePrintRequestInput {
  readonly masterId?: unknown;
  readonly modelId?: unknown;
  readonly modelFileId?: unknown;
  readonly materialId?: unknown;
  readonly materialVariantId?: unknown;
  readonly quantity?: unknown;
  readonly dueDate?: unknown;
  readonly clientNote?: unknown;
}

export interface PrintRequestsPort {
  create(userId: UserId, body: CreatePrintRequestInput): Promise<PrintRequestRecord>;
  incoming(userId: UserId, view: unknown): Promise<readonly PrintRequestRecord[]>;
  mine(userId: UserId, view: unknown): Promise<readonly PrintRequestRecord[]>;
  get(userId: UserId, rawId: string): Promise<PrintRequestRecord>;
  transition(userId: UserId, rawId: string, status: unknown): Promise<PrintRequestRecord>;
}

export type { PrintRequestStatus } from "../domain/print-requests.ts";
