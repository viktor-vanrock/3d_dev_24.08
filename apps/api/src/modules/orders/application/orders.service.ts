import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { ModelId, OrderId, UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { isOrderStatus, isValidOrderTransition, ORDER_TIMEOUT_COLUMN, type OrderStatus } from "../domain/orders.ts";
import { OrdersRepository } from "../infrastructure/orders.repository.ts";
import {
  ORDERS_NOTIFICATION_PORT,
  ORDERS_PAYMENT_PORT,
  ORDERS_PROFILE_PORT,
  type OrderRecord,
  type OrdersNotificationPort,
  type OrdersPaymentPort,
  type OrdersPort,
  type OrdersProfilePort,
} from "../public/index.ts";

@Injectable()
export class OrdersService implements OrdersPort {
  constructor(
    @Inject(OrdersRepository) private readonly repository: OrdersRepository,
    @Inject(ORDERS_PROFILE_PORT) private readonly profiles: OrdersProfilePort,
    @Inject(ORDERS_NOTIFICATION_PORT)
    private readonly notifications: OrdersNotificationPort,
    @Inject(ORDERS_PAYMENT_PORT) private readonly payment: OrdersPaymentPort,
  ) {}

  async create(userId: UserIdType, body: { readonly masterId?: unknown; readonly modelId?: unknown }): Promise<OrderRecord> {
    if (typeof body.masterId !== "string" || body.masterId.length === 0) {
      throw new BadRequestException();
    }
    const masterId = UserId(body.masterId);
    if (masterId === userId) throw new UnprocessableEntityException();

    // Legacy intentionally checks only existence, not the master's role. The missing role gate is
    // migration parity and remains a separately tracked product defect.
    if (!(await this.profiles.exists(masterId))) throw new NotFoundException();
    const modelId = typeof body.modelId === "string" ? ModelId(body.modelId) : null;
    return this.repository.create({ masterId, clientId: userId, modelId });
  }

  async get(userId: UserIdType, rawId: string): Promise<OrderRecord> {
    const order = await this.maybeExpire(OrderId(rawId));
    if (order === null) throw new NotFoundException();
    if (order.master_id !== userId && order.client_id !== userId) {
      throw new ForbiddenException();
    }
    return order;
  }

  async transition(userId: UserIdType, rawId: string, body: { readonly status?: unknown; readonly note?: unknown }): Promise<OrderRecord> {
    if (!isOrderStatus(body.status)) throw new BadRequestException();
    const orderId = OrderId(rawId);
    const participants = await this.repository.participants(orderId);
    if (participants === null) throw new NotFoundException();
    if (participants.masterId !== userId && participants.clientId !== userId) {
      throw new ForbiddenException();
    }
    return this.applyTransition(orderId, body.status, userId, body.note);
  }

  private async maybeExpire(orderId: ReturnType<typeof OrderId>) {
    const order = await this.repository.find(orderId);
    if (order === null) return null;
    const column = ORDER_TIMEOUT_COLUMN[order.status];
    if (column === undefined) return order;
    const deadline = order[column];
    if (deadline === null || deadline.getTime() > Date.now()) return order;
    return this.applyTransition(orderId, "expired", null, "timeout");
  }

  private async applyTransition(orderId: ReturnType<typeof OrderId>, to: OrderStatus, actorId: UserIdType | null, note: unknown): Promise<OrderRecord> {
    const before = await this.repository.find(orderId);
    if (before === null) throw new NotFoundException();
    if (!isValidOrderTransition(before.status, to)) {
      throw new ConflictException();
    }
    const after = await this.repository.updateStatus(orderId, before.status, to);
    if (after === null) {
      await this.repository.find(orderId);
      throw new ConflictException();
    }

    await this.repository.appendEvent({
      orderId,
      from: before.status,
      to,
      actorId,
      note,
    });
    if (to === "paid") await this.payment.paid(after);
    const notifyUser = actorId === after.master_id ? after.client_id : after.master_id;
    await this.notifications.statusChanged(notifyUser, after.id, to);
    return after;
  }
}
