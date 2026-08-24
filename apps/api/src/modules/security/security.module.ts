import { Module } from "@nestjs/common";
import { SecurityController } from "./api/security.controller.ts";
import { SecurityService } from "./application/security.service.ts";
import { SECURITY_PORT } from "./public/index.ts";

@Module({
  controllers: [SecurityController],
  providers: [SecurityService, { provide: SECURITY_PORT, useExisting: SecurityService }],
  exports: [SECURITY_PORT],
})
export class SecurityModule {}
