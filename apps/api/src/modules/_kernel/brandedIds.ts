// Layer 3 — branded domain identifiers (design.md §7.2, spec domain-boundaries →
// «Типобезопасность доменных идентификаторов»).
//
// A branded id is a `string` at runtime but a distinct type at compile time, so the compiler rejects
// passing a UserId where a ProjectId is expected — a class of boundary violation that imports and SQL
// scans cannot see. Repositories return these types; controllers/use-cases thread them through.
//
// Zero runtime cost: the brand is a phantom type. `brand<T>(raw)` is an identity function typed to
// return the branded form; `unbrand` widens back to string only where a raw string is genuinely
// required (e.g. building a SQL parameter array).

declare const __brand: unique symbol;

/** A nominal string subtype tagged by `B`. Structurally incompatible with other brands and with raw string in argument position. */
export type Branded<B extends string> = string & { readonly [__brand]: B };

/** Attach a brand to a raw string. Use at trust boundaries (DTO validation, repository row mapping). */
export function brand<T extends Branded<string>>(raw: string): T {
  return raw as T;
}

/** Drop the brand back to a plain string. Use only where a raw string is required (SQL params, URLs). */
export function unbrand(id: Branded<string>): string {
  return id;
}

// ── Domain id types ────────────────────────────────────────────────────────────────────────────
// One per aggregate root / entity whose id crosses a boundary. Add here as domains migrate; keep the
// brand string equal to the type name so error messages are legible.

export type UserId = Branded<"UserId">;
export type ProjectId = Branded<"ProjectId">;
export type ModelId = Branded<"ModelId">;
export type ModelRevisionId = Branded<"ModelRevisionId">;
export type ProjectRevisionId = Branded<"ProjectRevisionId">;
export type DeviceId = Branded<"DeviceId">;
export type PrinterId = Branded<"PrinterId">;
export type FeedPostId = Branded<"FeedPostId">;
export type CommentId = Branded<"CommentId">;
export type MakeId = Branded<"MakeId">;
export type IdeaId = Branded<"IdeaId">;
export type OrganizationId = Branded<"OrganizationId">;
export type GenerationId = Branded<"GenerationId">;
export type ImportBindingId = Branded<"ImportBindingId">;
export type ApiKeyId = Branded<"ApiKeyId">;
export type OrderId = Branded<"OrderId">;
export type SanctionId = Branded<"SanctionId">;
export type SanctionAppealId = Branded<"SanctionAppealId">;

/**
 * Migration-owned technical actor for historical sanctions. It has no password credentials and is
 * never a public identity; regular registration cannot create its reserved `__system__` username.
 */
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001" as UserId;

// Convenience constructors — self-documenting call sites at trust boundaries.
export const UserId = (raw: string): UserId => brand<UserId>(raw);
export const ProjectId = (raw: string): ProjectId => brand<ProjectId>(raw);
export const ModelId = (raw: string): ModelId => brand<ModelId>(raw);
export const ModelRevisionId = (raw: string): ModelRevisionId => brand<ModelRevisionId>(raw);
export const ProjectRevisionId = (raw: string): ProjectRevisionId => brand<ProjectRevisionId>(raw);
export const DeviceId = (raw: string): DeviceId => brand<DeviceId>(raw);
export const PrinterId = (raw: string): PrinterId => brand<PrinterId>(raw);
export const FeedPostId = (raw: string): FeedPostId => brand<FeedPostId>(raw);
export const CommentId = (raw: string): CommentId => brand<CommentId>(raw);
export const MakeId = (raw: string): MakeId => brand<MakeId>(raw);
export const IdeaId = (raw: string): IdeaId => brand<IdeaId>(raw);
export const OrganizationId = (raw: string): OrganizationId => brand<OrganizationId>(raw);
export const GenerationId = (raw: string): GenerationId => brand<GenerationId>(raw);
export const ImportBindingId = (raw: string): ImportBindingId => brand<ImportBindingId>(raw);
export const ApiKeyId = (raw: string): ApiKeyId => brand<ApiKeyId>(raw);
export const OrderId = (raw: string): OrderId => brand<OrderId>(raw);
export const SanctionId = (raw: string): SanctionId => brand<SanctionId>(raw);
export const SanctionAppealId = (raw: string): SanctionAppealId => brand<SanctionAppealId>(raw);
