import { Global, Inject, Injectable, Module } from "@nestjs/common";
import { getPaymentHook } from "../../modules/orders/public/index.ts";
import { ProfileModule } from "../../modules/profile/profile.module.ts";
import { PushModule } from "../../modules/push/push.module.ts";
import { PUSH_PORT, type PushPort } from "../../modules/push/public/index.ts";
import { PROFILE_READ_PORT, type ProfileReadPort } from "../../modules/profile/public/index.ts";
import {
  ORDERS_NOTIFICATION_PORT,
  ORDERS_PAYMENT_PORT,
  ORDERS_PROFILE_PORT,
  type OrdersNotificationPort,
  type OrdersPaymentPort,
  type OrdersProfilePort,
} from "../../modules/orders/public/index.ts";

@Injectable()
export class OrdersProfileAdapter implements OrdersProfilePort {
  constructor(@Inject(PROFILE_READ_PORT) private readonly profiles: ProfileReadPort) {}
  async exists(userId: Parameters<OrdersProfilePort["exists"]>[0]) {
    return (await this.profiles.findById(userId)) !== null;
  }
}

@Injectable()
export class OrdersNotificationAdapter implements OrdersNotificationPort {
  constructor(@Inject(PUSH_PORT) private readonly push: PushPort) {}

  async statusChanged(
    userId: Parameters<OrdersNotificationPort["statusChanged"]>[0],
    orderId: Parameters<OrdersNotificationPort["statusChanged"]>[1],
    status: Parameters<OrdersNotificationPort["statusChanged"]>[2],
  ) {
    await this.push.send(userId, "new_order", {
      title: "Статус заказа изменён",
      body: `Заказ перешёл в статус «${status}»`,
      deepLink: `/orders/${orderId}`,
    });
  }
}

@Injectable()
export class OrdersPaymentAdapter implements OrdersPaymentPort {
  async paid(order: Parameters<OrdersPaymentPort["paid"]>[0]) {
    await getPaymentHook().onOrderPaid({
      id: order.id,
      masterId: order.master_id,
      clientId: order.client_id,
      quoteAmountMinor: order.quote_amount_minor === null ? null : Number(order.quote_amount_minor),
      currency: order.currency,
    });
  }
}

@Global()
@Module({
  imports: [ProfileModule, PushModule],
  providers: [
    OrdersProfileAdapter,
    OrdersNotificationAdapter,
    OrdersPaymentAdapter,
    { provide: ORDERS_PROFILE_PORT, useExisting: OrdersProfileAdapter },
    {
      provide: ORDERS_NOTIFICATION_PORT,
      useExisting: OrdersNotificationAdapter,
    },
    { provide: ORDERS_PAYMENT_PORT, useExisting: OrdersPaymentAdapter },
  ],
  exports: [ORDERS_PROFILE_PORT, ORDERS_NOTIFICATION_PORT, ORDERS_PAYMENT_PORT],
})
export class OrdersIntegrationModule {}
