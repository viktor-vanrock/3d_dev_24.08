import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import type { RequestMethod } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import routeManifest from "../../../characterization/routes.manifest.json" with { type: "json" };
import { UserId } from "../../_kernel/brandedIds.ts";
import type { RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { SESSION_USER } from "../../../nest/auth/session-verifier.ts";
import type { SecurityPort } from "../public/index.ts";
import { SecurityController } from "./security.controller.ts";

function route(): string {
  const handler = SecurityController.prototype.honeypot;
  const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
  const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
  return `${["GET", "POST", "PUT", "DELETE", "PATCH", "ALL", "OPTIONS", "HEAD"][method]} /${path}`;
}

describe("Nest security route migration", () => {
  it("implements the authoritative security route", () => {
    const expected = routeManifest.filter((entry) => entry.domain === "security").map((entry) => `${entry.method} ${entry.path}`);
    expect(expected).toEqual(["GET /models/_index/scan"]);
    expect(route()).toBe("GET /internal/project-index/scan");
  });

  it("passes the authenticated identity to the bot-signal service", () => {
    const hitHoneypot = vi.fn((): never => {
      throw new Error("sentinel");
    });
    const controller = new SecurityController({ hitHoneypot } satisfies SecurityPort);
    const request = {
      ip: "203.0.113.10",
      socket: {},
      headers: { "user-agent": "crawler" },
      [SESSION_USER]: { id: UserId("00000000-0000-4000-8000-000000000001"), username: "bot" },
    } as unknown as RequestWithSession;
    expect(() => controller.honeypot(request)).toThrow("sentinel");
    expect(hitHoneypot).toHaveBeenCalledWith({ ip: "203.0.113.10", headers: { "user-agent": "crawler" } }, UserId("00000000-0000-4000-8000-000000000001"));
  });
});
