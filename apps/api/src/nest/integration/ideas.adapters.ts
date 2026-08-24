import { Global, Inject, Injectable, Module } from "@nestjs/common";
import { enrichIdeaDraft } from "../../modules/ideas/public/index.ts";
import { checkRateLimit } from "../../modules/security/public/index.ts";
import { AUTH_IDENTITY_READ_PORT, type AuthIdentityReadPort } from "../../modules/auth/public/index.ts";
import { PROFILE_ADMIN_PORT, type ProfileAdminPort } from "../../modules/profile/public/index.ts";
import type {
  IdeasEnrichmentPort,
  IdeasPushPort,
  IdeasRateLimitIdentity,
  IdeasRateLimitPort,
  IdeasRateLimitScope,
  IdeasStaffPort,
  IdeasVerifiedIdentityPort,
} from "../../modules/ideas/public/index.ts";
import type { IdeaId, UserId } from "../../modules/_kernel/brandedIds.ts";
import { AuthModule } from "../../modules/auth/auth.module.ts";
import { ProfileModule } from "../../modules/profile/profile.module.ts";
import { PushModule } from "../../modules/push/push.module.ts";
import { PUSH_PORT, type PushPort } from "../../modules/push/public/index.ts";
import { IDEAS_ENRICHMENT_PORT, IDEAS_PUSH_PORT, IDEAS_RATE_LIMIT_PORT, IDEAS_STAFF_PORT, IDEAS_VERIFIED_IDENTITY_PORT } from "../../modules/ideas/public/index.ts";

@Injectable()
export class IdeasStaffAdapter implements IdeasStaffPort {
  constructor(@Inject(PROFILE_ADMIN_PORT) private readonly profiles: ProfileAdminPort) {}
  isStaff(userId: UserId): Promise<boolean> {
    return this.profiles.isStaff(userId);
  }
}

@Injectable()
export class IdeasVerifiedIdentityAdapter implements IdeasVerifiedIdentityPort {
  constructor(@Inject(AUTH_IDENTITY_READ_PORT) private readonly identities: AuthIdentityReadPort) {}
  hasVerifiedIdentity(userId: UserId): Promise<boolean> {
    return this.identities.hasVerifiedIdentity(userId);
  }
}

@Injectable()
export class IdeasPushAdapter implements IdeasPushPort {
  constructor(@Inject(PUSH_PORT) private readonly push: PushPort) {}

  async commentCreated(input: { readonly recipientId: UserId; readonly ideaId: IdeaId; readonly ideaTitle: string }): Promise<void> {
    await this.push.send(input.recipientId, "comment", {
      title: "Новый комментарий к идее",
      body: input.ideaTitle,
      deepLink: `/ideas/${input.ideaId}`,
    });
  }
}

@Injectable()
export class IdeasEnrichmentAdapter implements IdeasEnrichmentPort {
  enrich(freeText: string): ReturnType<typeof enrichIdeaDraft> {
    return enrichIdeaDraft(freeText);
  }
}

@Injectable()
export class IdeasRateLimitAdapter implements IdeasRateLimitPort {
  async isLimited(scope: IdeasRateLimitScope, identity: IdeasRateLimitIdentity): Promise<boolean> {
    const outcome = checkRateLimit(
      {
        ip: identity.ip ?? "unknown",
        headers: { "user-agent": identity.userAgent ?? undefined },
      },
      scope,
      identity.userId,
    );
    if (!outcome.limited && outcome.slowdownMs !== undefined && outcome.slowdownMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, outcome.slowdownMs));
    }
    return outcome.limited;
  }
}

@Global()
@Module({
  imports: [AuthModule, ProfileModule, PushModule],
  providers: [
    IdeasStaffAdapter,
    IdeasVerifiedIdentityAdapter,
    IdeasPushAdapter,
    IdeasEnrichmentAdapter,
    IdeasRateLimitAdapter,
    { provide: IDEAS_STAFF_PORT, useExisting: IdeasStaffAdapter },
    { provide: IDEAS_VERIFIED_IDENTITY_PORT, useExisting: IdeasVerifiedIdentityAdapter },
    { provide: IDEAS_PUSH_PORT, useExisting: IdeasPushAdapter },
    { provide: IDEAS_ENRICHMENT_PORT, useExisting: IdeasEnrichmentAdapter },
    { provide: IDEAS_RATE_LIMIT_PORT, useExisting: IdeasRateLimitAdapter },
  ],
  exports: [IDEAS_STAFF_PORT, IDEAS_VERIFIED_IDENTITY_PORT, IDEAS_PUSH_PORT, IDEAS_ENRICHMENT_PORT, IDEAS_RATE_LIMIT_PORT],
})
export class IdeasIntegrationModule {}
