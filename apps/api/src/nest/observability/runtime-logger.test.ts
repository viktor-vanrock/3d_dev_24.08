import { readdirSync, readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { allowlistedLogRecord, createRuntimeLogger, type SafeLogRecord } from "./runtime-logger.ts";

function runtimeSourceFiles(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return runtimeSourceFiles(url);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [url] : [];
  });
}

describe("runtime logger redaction", () => {
  it("redacts secrets, PII, and request/response bodies before writing structured logs", () => {
    const destination = new PassThrough();
    let output = "";
    destination.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    const logger = createRuntimeLogger(destination);

    logger.info({
      password: "raw-password",
      passwordHash: "raw-password-hash",
      otp: "raw-otp",
      sessionToken: "raw-session-token",
      apiKey: "raw-api-key",
      gatewayPrivateKey: "raw-private-key",
      providerSecret: "raw-provider-secret",
      authorization: "Bearer raw-authorization",
      prompt: "raw-prompt",
      image: "raw-image",
      searchQuery: "raw-search-query",
      payoutRequisites: "raw-payout-requisites",
      email: "person@example.test",
      phone: "+79990000000",
      username: "private-user",
      fullName: "Private Person",
      req: { body: { messageBody: "raw-request-body" } },
      res: { body: { token: "raw-response-body" } },
      error: { message: "raw-error-message", stack: "raw-error-stack" },
    });

    expect(output).not.toMatch(/raw-|person@example\.test|\+79990000000|private-user|Private Person|Bearer raw-authorization/);
    expect(output).toContain("[REDACTED]");
  });

  it("drops every non-allowlisted field before RuntimeLogger reaches pino", () => {
    const unsafe = {
      event: "api.request.completed",
      request_id: "request-id",
      method: "POST",
      status_code: 200,
      latency_ms: 3,
      email: "person@example.test",
      request: { body: "raw-request-body" },
      response: { body: "raw-response-body" },
    } as unknown as SafeLogRecord;

    expect(allowlistedLogRecord(unsafe)).toEqual({
      event: "api.request.completed",
      request_id: "request-id",
      method: "POST",
      status_code: 200,
      latency_ms: 3,
    });
  });

  it("forbids structured or dynamic logging that bypasses the runtime allowlist", () => {
    for (const sourceUrl of runtimeSourceFiles(new URL("../../", import.meta.url))) {
      const source = readFileSync(sourceUrl, "utf8");
      if (source.includes("new Logger(")) {
        expect(source, `${sourceUrl.pathname} passes dynamic metadata to Nest Logger`).not.toMatch(/\b(?:this\.)?logger\.(?:log|warn|error|debug|verbose)\(\s*(?!["'])/);
      }
      expect(source, `${sourceUrl.pathname} passes a raw value to console logging`).not.toMatch(/\bconsole\.(?:log|info|warn|error|debug)\(\s*(?!["'])/);
    }
  });
});
