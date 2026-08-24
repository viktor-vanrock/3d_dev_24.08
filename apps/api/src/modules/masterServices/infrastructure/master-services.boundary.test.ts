import { describe, expect, it } from "vitest";
import { masterServicesTables } from "./master-services.tables.ts";

describe("master services table ownership", () => {
  it("declares only master-services-owned tables", () => {
    expect([...masterServicesTables.owns].sort()).toEqual(["master_service_materials", "master_services"]);
  });
});
