import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { IdeaId, UserId } from "../../_kernel/brandedIds.ts";
import type { IdeasRepository } from "../infrastructure/ideas.repository.ts";
import type { IdeasEnrichmentPort, IdeasPushPort, IdeasRateLimitPort, IdeasStaffPort, IdeasVerifiedIdentityPort } from "../public/index.ts";
import { IdeasService } from "./ideas.service.ts";

function service(input: { readonly staff?: boolean; readonly verified?: boolean }) {
  const repository = {
    toggleVote: vi.fn(),
    changeStatus: vi.fn(),
    moderate: vi.fn(),
  } as unknown as IdeasRepository;
  const staff = { isStaff: vi.fn(() => Promise.resolve(input.staff ?? false)) } satisfies IdeasStaffPort;
  const identities = {
    hasVerifiedIdentity: vi.fn(() => Promise.resolve(input.verified ?? false)),
  } satisfies IdeasVerifiedIdentityPort;
  const push = { commentCreated: vi.fn(() => Promise.resolve()) } satisfies IdeasPushPort;
  const enrichment = { enrich: vi.fn(() => Promise.resolve({ ok: false as const })) } satisfies IdeasEnrichmentPort;
  const rateLimit = { isLimited: vi.fn(() => Promise.resolve(false)) } satisfies IdeasRateLimitPort;
  return { value: new IdeasService(repository, staff, identities, push, enrichment, rateLimit), repository };
}

describe("IdeasService access-order parity", () => {
  it("checks verified identity before revealing whether a vote target id is valid", async () => {
    const { value, repository } = service({ verified: false });
    await expect(value.toggleVote(UserId("22222222-2222-4222-8222-222222222222"), IdeaId("not-a-uuid"))).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.toggleVote).not.toHaveBeenCalled();
  });

  it("checks staff before revealing whether status/moderation target ids are valid", async () => {
    const { value, repository } = service({ staff: false });
    const actor = UserId("22222222-2222-4222-8222-222222222222");
    await expect(value.changeStatus(actor, IdeaId("not-a-uuid"), { status: "planned" })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(value.moderate(actor, IdeaId("not-a-uuid"), { action: "hide" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.changeStatus).not.toHaveBeenCalled();
    expect(repository.moderate).not.toHaveBeenCalled();
  });
});
