import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { AnalyticsPort } from "../../analytics/public/index.ts";
import type { ActivationRecord } from "../domain/activation.types.ts";
import type { ActivationRepository } from "../infrastructure/activation.repository.ts";
import type { ProfileDeviceOperationsPort } from "./profile-inventory.ports.ts";
import type { ProfileFilamentsService } from "./filaments.service.ts";
import { ProfileActivationService } from "./activation.service.ts";

const userId = UserId("00000000-0000-4000-8000-000000000001");
const activation: ActivationRecord = {
  user_id: userId,
  state: "first_run",
  has_printer: false,
  first_run_completed_at: null,
  primary_persona: null,
  persona_source: null,
  home_tier: "auto",
  sessions_seen: 5,
  activation_checklist: {},
  home_dismissed_prompts: {},
};

describe("ProfileActivationService", () => {
  it("transitions the fifth activation session and returns owner inventory", async () => {
    const repository = {
      loadAndCountSession: vi.fn().mockResolvedValue(activation),
      markReturning: vi.fn().mockResolvedValue({ ...activation, state: "returning" }),
    } as unknown as ActivationRepository;
    const filaments = { list: vi.fn().mockResolvedValue({ filaments: [{ id: "f" }] }) } as unknown as ProfileFilamentsService;
    const printers = { listPrinters: vi.fn().mockResolvedValue([{ id: "p" }]) } as unknown as ProfileDeviceOperationsPort;
    const analytics = {} as AnalyticsPort;
    const service = new ProfileActivationService(repository, filaments, printers, analytics);

    await expect(service.get(userId)).resolves.toMatchObject({ activation: { state: "returning" }, printers: [{ id: "p" }] });
    expect(repository.markReturning).toHaveBeenCalledWith(userId);
  });

  it("accepts only activation event names and delegates consent-gated emission", async () => {
    const repository = {} as ActivationRepository;
    const filaments = {} as ProfileFilamentsService;
    const printers = {} as ProfileDeviceOperationsPort;
    const emitEvent = vi.fn().mockResolvedValue(undefined);
    const service = new ProfileActivationService(repository, filaments, printers, { emitEvent } as unknown as AnalyticsPort);

    await expect(service.event(userId, "anon", "aha_reached", { step: 1 })).resolves.toEqual({ ok: true });
    expect(emitEvent).toHaveBeenCalledWith({ eventName: "aha_reached", anonId: "anon", userId, props: { step: 1 } });
    await expect(service.event(userId, null, "arbitrary", {})).rejects.toMatchObject({ status: 400 });
  });
});
