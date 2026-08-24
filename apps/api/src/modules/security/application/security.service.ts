import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { SECURITY_BOT_SIGNAL_PORT, type SecurityBotSignalPort, type SecurityPort, type SecurityRequestIdentity } from "../public/index.ts";

@Injectable()
export class SecurityService implements SecurityPort {
  private readonly logger = new Logger(SecurityService.name);

  constructor(@Inject(SECURITY_BOT_SIGNAL_PORT) private readonly botSignals: SecurityBotSignalPort) {}

  hitHoneypot(identity: SecurityRequestIdentity, userId: UserId): never {
    this.botSignals.flag(identity, userId, "honeypot_click");
    this.logger.warn("honeypot hit");
    throw new NotFoundException();
  }
}
