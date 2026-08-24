import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { OrdersController } from "./api/orders.controller.ts";
import { OrdersService } from "./application/orders.service.ts";
import { OrdersRepository } from "./infrastructure/orders.repository.ts";
import { ORDERS_PORT } from "./public/index.ts";

@Module({
  imports: [DatabaseModule],
  controllers: [OrdersController],
  providers: [OrdersRepository, OrdersService, { provide: ORDERS_PORT, useExisting: OrdersService }],
  exports: [ORDERS_PORT],
})
export class OrdersModule {}
