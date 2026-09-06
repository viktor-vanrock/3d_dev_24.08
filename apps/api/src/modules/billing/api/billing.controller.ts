import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req, UnauthorizedException } from "@nestjs/common";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { BILLING_PORT, type BillingPort } from "../public/index.ts";
import { BillingLooseBodyDto } from "./billing.dto.ts";
import { ApiBillingOperation } from "./openapi.ts";
import { Internal, Permission, Permissions, User } from "../../permissions/public/index.ts";
function user(request: RequestWithSession): UserIdType {
  const value = request[SESSION_USER];
  if (value === undefined) throw new UnauthorizedException();
  return UserId(value.id);
}
@Controller()
@User()
export class BillingController {
  constructor(@Inject(BILLING_PORT) private readonly billing: BillingPort) {}
  @Post("purchases")
  @ApiBillingOperation("Create purchase", { auth: true, created: true, response: "purchase-created" })
  purchaseCreate(@Req() r: RequestWithSession, @Body() b: BillingLooseBodyDto) {
    return this.billing.createPurchase(user(r), b.modelId);
  }
  @Post("billing/webhooks/yookassa")
  @Internal()
  @HttpCode(200)
  @ApiBillingOperation("Process YooKassa webhook", { response: "webhook" })
  webhook(@Body() b: BillingLooseBodyDto) {
    return this.billing.webhook(b);
  }
  @Get("purchases")
  @ApiBillingOperation("List own purchases", { auth: true, response: "purchases" })
  purchases(@Req() r: RequestWithSession) {
    return this.billing.purchases(user(r));
  }
  @Get("purchases/:id")
  @ApiBillingOperation("Read own purchase", { auth: true, response: "purchase" })
  purchase(@Req() r: RequestWithSession, @Param("id") id: string) {
    return this.billing.purchase(user(r), id);
  }
  @Get("sales") @ApiBillingOperation("List own sales", { auth: true, response: "sales" }) sales(@Req() r: RequestWithSession) {
    return this.billing.sales(user(r));
  }
  @Get("me/balance")
  @ApiBillingOperation("Read own balance", { auth: true, response: "balance" })
  balance(@Req() r: RequestWithSession) {
    return this.billing.balance(user(r));
  }
  @Post("payouts")
  @ApiBillingOperation("Request payout", { auth: true, created: true, response: "payout" })
  payoutCreate(@Req() r: RequestWithSession, @Body() b: BillingLooseBodyDto) {
    return this.billing.createPayout(user(r), b);
  }
  @Get("payouts")
  @ApiBillingOperation("List own payouts", { auth: true, response: "payouts" })
  payouts(@Req() r: RequestWithSession) {
    return this.billing.payouts(user(r));
  }
  @Patch("payouts/:id")
  @Permission(Permissions.BILLING_MANAGE_PAYOUTS)
  @ApiBillingOperation("Transition payout", { auth: true, response: "payout-transition" })
  payoutTransition(@Req() r: RequestWithSession, @Param("id") id: string, @Body() b: BillingLooseBodyDto) {
    return this.billing.transitionPayout(user(r), id, b.status);
  }
}
