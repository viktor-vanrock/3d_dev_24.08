import { ConflictException, ForbiddenException, UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { OrderId, UserId } from "../../_kernel/brandedIds.ts";
import type { OrdersRepository } from "../infrastructure/orders.repository.ts";
import type { OrderRecord, OrdersNotificationPort, OrdersPaymentPort, OrdersProfilePort } from "../public/index.ts";
import { OrdersService } from "./orders.service.ts";

const masterId = UserId("11111111-1111-4111-8111-111111111111");
const clientId = UserId("22222222-2222-4222-8222-222222222222");
const strangerId = UserId("33333333-3333-4333-8333-333333333333");
const orderId = OrderId("44444444-4444-4444-8444-444444444444");

function row(status: OrderRecord["status"] = "draft"): OrderRecord {
  return {
    id: orderId,
    master_id: masterId,
    client_id: clientId,
    model_id: null,
    status,
    quote_amount_minor: null,
    currency: "RUB",
    quote_expires_at: null,
    accept_expires_at: null,
    created_at: new Date("2026-08-05T00:00:00Z"),
    updated_at: new Date("2026-08-05T00:00:00Z"),
  };
}

function setup(overrides: Partial<OrdersRepository> = {}) {
  const repository = {
    create: vi.fn().mockResolvedValue(row()),
    find: vi.fn().mockResolvedValue(row()),
    participants: vi.fn().mockResolvedValue({ masterId, clientId }),
    updateStatus: vi.fn().mockResolvedValue(row("quote_requested")),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as OrdersRepository;
  const profiles: OrdersProfilePort = {
    exists: vi.fn().mockResolvedValue(true),
  };
  const notifications: OrdersNotificationPort = {
    statusChanged: vi.fn().mockResolvedValue(undefined),
  };
  const payment: OrdersPaymentPort = {
    paid: vi.fn().mockResolvedValue(undefined),
  };
  return {
    repository,
    profiles,
    notifications,
    payment,
    service: new OrdersService(repository, profiles, notifications, payment),
  };
}

describe("OrdersService legacy behavior", () => {
  it("preserves the intentional missing master-role gate", async () => {
    const { service, profiles, repository } = setup();
    await expect(service.create(clientId, { masterId })).resolves.toEqual(row());
    expect(profiles.exists).toHaveBeenCalledWith(masterId);
    expect(repository.create).toHaveBeenCalledWith({
      masterId,
      clientId,
      modelId: null,
    });
  });

  it("rejects self-ordering with 422", async () => {
    const { service } = setup();
    await expect(service.create(clientId, { masterId: clientId })).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("returns 403 for an existing order owned by other participants", async () => {
    const { service } = setup();
    await expect(service.get(strangerId, orderId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("keeps optimistic transition, event, payment, then notification ordering", async () => {
    const calls: string[] = [];
    const accepted = row("accepted");
    const paid = row("paid");
    const { repository } = setup({
      find: vi.fn().mockImplementation(() => {
        calls.push("find");
        return Promise.resolve(accepted);
      }),
      updateStatus: vi.fn().mockImplementation(() => {
        calls.push("update");
        return Promise.resolve(paid);
      }),
      appendEvent: vi.fn().mockImplementation(() => {
        calls.push("event");
        return Promise.resolve();
      }),
    });
    const instance = setup();
    const payment: OrdersPaymentPort = {
      paid: vi.fn().mockImplementation(() => {
        calls.push("payment");
        return Promise.resolve();
      }),
    };
    const notifications: OrdersNotificationPort = {
      statusChanged: vi.fn().mockImplementation(() => {
        calls.push("push");
        return Promise.resolve();
      }),
    };
    const serviceWithEffects = new OrdersService(repository, instance.profiles, notifications, payment);

    await expect(serviceWithEffects.transition(clientId, orderId, { status: "paid" })).resolves.toEqual(paid);
    expect(calls).toEqual(["find", "update", "event", "payment", "push"]);
  });

  it("reports a raced conditional update as 409", async () => {
    const { service } = setup({
      updateStatus: vi.fn().mockResolvedValue(null),
    });
    await expect(service.transition(clientId, orderId, { status: "quote_requested" })).rejects.toBeInstanceOf(ConflictException);
  });
});
