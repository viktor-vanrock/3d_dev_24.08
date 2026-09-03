import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Put, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { SESSION_USER } from "../../../nest/auth/session-verifier.ts";
import { PUSH_PORT, type PushPort } from "../public/index.ts";
import { ApiPushOperation } from "./openapi.ts";
import {
  PushOkResponseDto,
  PushPreferenceResponseDto,
  PushPreferencesResponseDto,
  SetPushPreferenceDto,
  SubscribePushDto,
  UnsubscribePushDto,
  VapidPublicKeyResponseDto,
} from "./push.dto.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { Public, User } from "../../permissions/public/index.ts";

function userId(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

@Controller("push")
@User()
export class PushController {
  constructor(@Inject(PUSH_PORT) private readonly push: PushPort) {}

  @Get("vapid-public-key")
  @Public()
  @ApiPushOperation("Read the configured public VAPID key", VapidPublicKeyResponseDto)
  publicKey(): { public_key: string | null } {
    return { public_key: this.push.publicKey() };
  }

  @Post("subscriptions")
  @HttpCode(201)
  @ApiPushOperation("Create or refresh a browser push subscription", PushOkResponseDto, 201)
  async subscribe(@Req() request: RequestWithSession, @Body() body: SubscribePushDto): Promise<{ ok: true }> {
    const rawUserAgent = request.headers["user-agent"];
    await this.push.subscribe(userId(request), {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: typeof rawUserAgent === "string" ? rawUserAgent : null,
    });
    return { ok: true };
  }

  @Delete("subscriptions")
  @ApiPushOperation("Remove a browser push subscription", PushOkResponseDto)
  async unsubscribe(@Req() request: RequestWithSession, @Body() body: UnsubscribePushDto): Promise<{ ok: true }> {
    await this.push.unsubscribe(userId(request), body.endpoint);
    return { ok: true };
  }

  @Get("preferences")
  @ApiPushOperation("Read all push notification preferences", PushPreferencesResponseDto)
  async preferences(@Req() request: RequestWithSession): Promise<{ preferences: Awaited<ReturnType<PushPort["preferences"]>> }> {
    return { preferences: await this.push.preferences(userId(request)) };
  }

  @Put("preferences")
  @ApiPushOperation("Set one push notification preference", PushPreferenceResponseDto)
  async setPreference(@Req() request: RequestWithSession, @Body() body: SetPushPreferenceDto) {
    return this.push.setPreference(userId(request), body.type, body.enabled);
  }
}
