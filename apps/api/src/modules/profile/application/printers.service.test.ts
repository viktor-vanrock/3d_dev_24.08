import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { ActivationRepository } from "../infrastructure/activation.repository.ts";
import type { ProfileDeviceOperationsPort, ProfileInventoryCatalogPort } from "./profile-inventory.ports.ts";
import { ProfilePrintersService } from "./printers.service.ts";

const userId = UserId("00000000-0000-4000-8000-000000000001");

describe("ProfilePrintersService", () => {
  it("keeps user_printers access behind the printers-owned port", async () => {
    const createPrinter = vi.fn().mockResolvedValue({ id: "printer" });
    const devices = { createPrinter } as unknown as ProfileDeviceOperationsPort;
    const activation = { setHasPrinter: vi.fn().mockResolvedValue(undefined) } as unknown as ActivationRepository;
    const service = new ProfilePrintersService(devices, {} as ProfileInventoryCatalogPort, activation);

    await expect(service.create(userId, { brand: " Prusa ", model: " MK4 ", link_source: "manual" })).resolves.toEqual({ printer: { id: "printer" } });
    expect(createPrinter).toHaveBeenCalledWith(userId, expect.objectContaining({ brand: "Prusa", model: "MK4", verified: false }));
    expect(activation.setHasPrinter).toHaveBeenCalledWith(userId, true);
  });

  it("conceals a foreign printer on the live route", async () => {
    const devices = { printerOwner: vi.fn().mockResolvedValue(UserId("00000000-0000-4000-8000-000000000002")) } as unknown as ProfileDeviceOperationsPort;
    const service = new ProfilePrintersService(devices, {} as ProfileInventoryCatalogPort, {} as ActivationRepository);
    await expect(service.live(userId, "00000000-0000-4000-8000-000000000003")).rejects.toMatchObject({ status: 404 });
  });
});
