import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UnauthorizedException } from "@nestjs/common";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { ORDERS_PORT, type OrdersPort } from "../public/index.ts";
import { CreateOrderDto, TransitionOrderDto } from "./orders.dto.ts";
import { ApiOrdersOperation } from "./openapi.ts";
import { User } from "../../permissions/decorators/user.decorator.ts";

function user(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

@Controller("orders")
@User()
export class OrdersController {
  constructor(@Inject(ORDERS_PORT) private readonly orders: OrdersPort) {}

  @Post()
  @ApiOrdersOperation("Create an order", { created: true })
  create(@Req() request: RequestWithSession, @Body() body: CreateOrderDto) {
    return this.orders.create(user(request), body);
  }

  @Get(":id")
  @ApiOrdersOperation("Read an order")
  get(@Req() request: RequestWithSession, @Param("id") id: string) {
    return this.orders.get(user(request), id);
  }

  @Patch(":id/status")
  @ApiOrdersOperation("Transition an order")
  transition(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: TransitionOrderDto) {
    return this.orders.transition(user(request), id, body);
  }
}
