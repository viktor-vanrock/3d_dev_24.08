import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { RuntimeLogger } from "../../nest/observability/runtime-logger.ts";
import { AuthController } from "./api/auth.controller.ts";
import { AuthService } from "./application/auth.service.ts";
import { AdminBootstrapService } from "./application/admin-bootstrap.service.ts";
import { AuthSessionService } from "./application/session.service.ts";
import { AuthRepository } from "./infrastructure/auth.repository.ts";
import { OtpEmailAdapter } from "./infrastructure/email.adapter.ts";
import { IdentityStorageAdapter } from "./infrastructure/identity-storage.adapter.ts";
import { AUTH_IDENTITY_READ_PORT } from "./public/index.ts";

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    RuntimeLogger,
    AuthRepository,
    OtpEmailAdapter,
    IdentityStorageAdapter,
    AuthService,
    AdminBootstrapService,
    AuthSessionService,
    { provide: AUTH_IDENTITY_READ_PORT, useExisting: AuthRepository },
  ],
  exports: [AUTH_IDENTITY_READ_PORT],
})
export class AuthModule {}
