import { Global, Inject, Injectable, Module } from "@nestjs/common";
import { checkRateLimit } from "../../modules/security/public/index.ts";
import { ProfileModule } from "../../modules/profile/profile.module.ts";
import { PROFILE_READ_PORT, type ProfileReadPort } from "../../modules/profile/public/index.ts";
import {
  PRINT_REQUESTS_PROFILE_PORT,
  PRINT_REQUESTS_RATE_LIMIT_PORT,
  type PrintRequestsProfilePort,
  type PrintRequestsRateLimitPort,
} from "../../modules/printRequests/public/index.ts";

@Injectable()
export class PrintRequestsProfileAdapter implements PrintRequestsProfilePort {
  constructor(@Inject(PROFILE_READ_PORT) private readonly profiles: ProfileReadPort) {}
  async exists(userId: Parameters<PrintRequestsProfilePort["exists"]>[0]) {
    return (await this.profiles.findById(userId)) !== null;
  }
}

@Injectable()
export class PrintRequestsRateLimitAdapter implements PrintRequestsRateLimitPort {
  async checkCreate(identity: Parameters<PrintRequestsRateLimitPort["checkCreate"]>[0], userId: Parameters<PrintRequestsRateLimitPort["checkCreate"]>[1]) {
    const outcome = checkRateLimit(identity, "print_request_create", userId);
    if (!outcome.limited && outcome.slowdownMs !== undefined && outcome.slowdownMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, outcome.slowdownMs));
    }
    return {
      limited: outcome.limited,
      retryAfterSeconds: outcome.retryAfterSeconds,
      limit: outcome.limit,
      remaining: outcome.remaining,
      reset: outcome.reset,
    };
  }
}

@Global()
@Module({
  imports: [ProfileModule],
  providers: [
    PrintRequestsProfileAdapter,
    PrintRequestsRateLimitAdapter,
    {
      provide: PRINT_REQUESTS_PROFILE_PORT,
      useExisting: PrintRequestsProfileAdapter,
    },
    {
      provide: PRINT_REQUESTS_RATE_LIMIT_PORT,
      useExisting: PrintRequestsRateLimitAdapter,
    },
  ],
  exports: [PRINT_REQUESTS_PROFILE_PORT, PRINT_REQUESTS_RATE_LIMIT_PORT],
})
export class PrintRequestsIntegrationModule {}
