import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { PRINTER_COMMAND_POLICY_ERRORS } from "./command-policy.ts";

const contract = readFileSync(new URL("../../../../../../packages/contracts/printer-api/openapi.yaml", import.meta.url), "utf8");
const parsedContract = parseYaml(contract) as {
  info?: { description?: string };
  paths?: Record<string, { post?: { responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> } }>;
  components?: { schemas?: { PrinterCommandError?: { properties?: { error?: { enum?: string[] } } } } };
};

const printerCommandErrorRef = "#/components/schemas/PrinterCommandError";

function responseSchemaRef(path: string, status: string): string | undefined {
  return parsedContract.paths?.[path]?.post?.responses?.[status]?.content?.["application/json"]?.schema?.$ref;
}

describe("printer command API contract", () => {
  it("publishes the same stable policy errors for UI and bearer API", () => {
    expect(PRINTER_COMMAND_POLICY_ERRORS).toEqual(["LAN_FORBIDDEN", "DEVICE_OFFLINE", "CAPABILITY_UNSUPPORTED"]);
    for (const path of ["/v0/printers/{id}/commands", "/me/printers/{id}/commands"]) {
      expect(responseSchemaRef(path, "403"), `${path} 403`).toBe(printerCommandErrorRef);
      expect(responseSchemaRef(path, "409"), `${path} 409`).toBe(printerCommandErrorRef);
    }
    expect(parsedContract.components?.schemas?.PrinterCommandError?.properties?.error?.enum).toEqual(expect.arrayContaining([...PRINTER_COMMAND_POLICY_ERRORS]));
  });

  it("declares browser-only LAN handling and no server-side fetch requirement", () => {
    expect(parsedContract.info?.description).toContain("browser-to-Moonraker");
    expect(parsedContract.info?.description).toContain("API не устанавливает исходящие");
  });

  it("keeps Nest command handlers and adapters free of outbound LAN clients", () => {
    const commandSources = [
      "../../../modules/profile/api/profile-inventory.controller.ts",
      "../../../modules/publicapi/api/publicapi.controller.ts",
      "../../../modules/devices/api/devices.controller.ts",
      "../../../modules/devices/application/devices.service.ts",
      "../../../nest/integration/profile-printers.adapters.ts",
      "../../../nest/integration/publicapi.adapters.ts",
      "../../../nest/integration/devices.adapters.ts",
    ]
      .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
      .join("\n");

    expect(commandSources).not.toMatch(/\b(?:fetch|axios|http\.(?:get|request)|https\.(?:get|request)|net\.(?:connect|createConnection)|tls\.connect)\s*\(/);
    expect(commandSources).not.toMatch(/from\s+["'](?:node:)?(?:http|https|net|tls|dgram)["']/);
  });
});
