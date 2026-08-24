import { BadRequestException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { MakesPort } from "../../makes/public/index.ts";
import type { ProfileReadPort } from "../../profile/public/index.ts";
import type { MakersRepository } from "../infrastructure/makers.repository.ts";
import { MakersService } from "./makers.service.ts";

const viewer = UserId("11111111-1111-4111-8111-111111111111");
const target = UserId("22222222-2222-4222-8222-222222222222");

function setup() {
  const repository = {
    followeeIds: vi.fn().mockResolvedValue([target]),
    follow: vi.fn().mockResolvedValue(undefined),
    unfollow: vi.fn().mockResolvedValue(undefined),
    profile: vi.fn().mockResolvedValue(null),
    upsert: vi.fn(),
    nearby: vi.fn().mockResolvedValue([]),
  } as unknown as MakersRepository;
  const makes = {
    followedFeed: vi.fn().mockResolvedValue({ items: [], next_cursor: null }),
  } as unknown as MakesPort;
  const profiles = {
    findActiveByUsername: vi.fn().mockResolvedValue({ id: target, username: "target", displayName: null }),
    findByUsername: vi.fn().mockResolvedValue({ id: target, username: "target", displayName: null }),
    findActiveByIds: vi.fn().mockResolvedValue(new Map()),
  } as unknown as ProfileReadPort;
  return { repository, makes, profiles, service: new MakersService(repository, makes, profiles) };
}

describe("MakersService legacy decisions", () => {
  it("delegates the followed author set to the Makes owner", async () => {
    const { service, makes } = setup();
    await expect(service.feed(viewer, { limit: "12" })).resolves.toEqual({ items: [], next_cursor: null });
    expect(makes.followedFeed).toHaveBeenCalledWith([target], { limit: "12" });
  });

  it("keeps self-follow at 422 and unknown target at 404", async () => {
    const self = setup();
    vi.mocked(self.profiles.findActiveByUsername).mockResolvedValue({ id: viewer, username: "self", displayName: null });
    await expect(self.service.follow(viewer, "self")).rejects.toBeInstanceOf(UnprocessableEntityException);
    vi.mocked(self.profiles.findActiveByUsername).mockResolvedValue(null);
    await expect(self.service.follow(viewer, "missing")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("keeps nearby validation at 400", async () => {
    const { service } = setup();
    await expect(service.nearby({ lat: "999", lng: "37", radius_km: "10" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.nearby({ lat: "55", lng: "37", radius_km: "10", process: "sla" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("conceals a missing current maker profile with 404", async () => {
    const { service } = setup();
    await expect(service.profile(viewer)).rejects.toBeInstanceOf(NotFoundException);
  });
});
