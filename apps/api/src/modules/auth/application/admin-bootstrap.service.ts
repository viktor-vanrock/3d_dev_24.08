import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { resolveAdminBootstrapConfig } from "../../../nest/config/runtime-config.ts";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { AuthRepository } from "../infrastructure/auth.repository.ts";
import { hashPassword } from "../infrastructure/password-hash.ts";

@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuthRepository) private readonly repository: AuthRepository,
    @Inject(RuntimeLogger) private readonly logger: RuntimeLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const admin = resolveAdminBootstrapConfig({
      NODE_ENV: this.config.get("NODE_ENV"),
      ADMIN_USERNAME: this.config.get("ADMIN_USERNAME"),
      ADMIN_PASSWORD: this.config.get("ADMIN_PASSWORD"),
      ADMIN_PASSWORD_UPDATE_ON_STARTUP: this.config.get("ADMIN_PASSWORD_UPDATE_ON_STARTUP"),
    });
    if (admin === null) return;

    const passwordHash = await hashPassword(admin.password);
    await this.repository.upsertBootstrapAdmin(admin.username, passwordHash, admin.updatePasswordOnStartup);
    this.logger.info(
      { event: "auth.admin_bootstrap", outcome: "success", reason: admin.updatePasswordOnStartup ? "password_refreshed" : "password_preserved" },
      "Bootstrap admin is ready",
    );
  }
}
