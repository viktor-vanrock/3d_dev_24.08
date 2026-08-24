import { Global, Injectable, Module } from "@nestjs/common";
import { flagBotSignal } from "../../modules/security/public/index.ts";
import { SECURITY_BOT_SIGNAL_PORT, type SecurityBotSignalPort, type SecurityRequestIdentity } from "../../modules/security/public/index.ts";
import type { UserId } from "../../modules/_kernel/brandedIds.ts";

@Injectable()
export class SecurityBotSignalAdapter implements SecurityBotSignalPort {
  flag(identity: SecurityRequestIdentity, userId: UserId, reason: "honeypot_click"): void {
    flagBotSignal(identity, userId, reason);
  }
}

@Global()
@Module({
  providers: [SecurityBotSignalAdapter, { provide: SECURITY_BOT_SIGNAL_PORT, useExisting: SecurityBotSignalAdapter }],
  exports: [SECURITY_BOT_SIGNAL_PORT],
})
export class SecurityIntegrationModule {}
