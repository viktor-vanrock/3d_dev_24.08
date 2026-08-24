import { describe, expect, it } from "vitest";
import openapi from "./openapi.v1.json" with { type: "json" };

type Schema = {
  readonly enum?: readonly string[];
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, Schema>>;
};

const document = openapi as unknown as {
  readonly components: { readonly schemas: Readonly<Record<string, Schema>> };
  readonly paths: Readonly<
    Record<
      string,
      Readonly<
        Record<
          string,
          { readonly responses?: Readonly<Record<string, unknown>> }
        >
      >
    >
  >;
};

describe("printer command enqueue receipts", () => {
  it.each([
    ["/me/printers/{id}/commands", "PrinterCommandResponseDto"],
    ["/v0/printers/{id}/commands", "PublicQueuedCommandDto"],
  ] as const)(
    "фиксирует POST %s как HTTP 202 с queued receipt",
    (path, schemaName) => {
      expect(
        Object.keys(document.paths[path]?.post?.responses ?? {}),
      ).toContain("202");
      const schema = document.components.schemas[schemaName];
      expect(schema?.required).toContain("status");
      expect(schema?.properties?.status?.enum).toEqual(["queued"]);
    },
  );

  it("фиксирует canonical lifecycle status GET-команды", () => {
    expect(
      document.components.schemas.PublicCommandStatusDto?.properties?.status
        ?.enum,
    ).toEqual(["queued", "leased", "delivered", "acknowledged", "executed", "failed", "expired"]);
  });
});
