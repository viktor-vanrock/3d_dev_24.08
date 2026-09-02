import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { Request } from "express";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import { SECURITY_PORT, type SecurityPort, type SecurityRequestIdentity } from "../public/index.ts";
import { ApiHoneypotOperation } from "./openapi.ts";
import { User } from "../../permissions/decorators/user.decorator.ts";

function requestIdentity(request: Request): SecurityRequestIdentity {
  const headers: Record<string, string | readonly string[] | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) headers[name] = value;
  return { ip: request.ip || request.socket.remoteAddress || "unknown", headers };
}

@Controller()
@User()
export class SecurityController {
  constructor(@Inject(SECURITY_PORT) private readonly security: SecurityPort) {}

  @Get("internal/project-index/scan")
  @ApiHoneypotOperation()
  honeypot(@Req() request: RequestWithSession): never {
    const session = request[SESSION_USER];
    if (session === undefined) throw new Error("authenticated session missing");
    return this.security.hitHoneypot(requestIdentity(request), UserId(session.id));
  }
}
