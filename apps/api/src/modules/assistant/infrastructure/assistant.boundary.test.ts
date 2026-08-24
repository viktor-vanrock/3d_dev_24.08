import { describe, expect, it } from "vitest";
import { assistantTables } from "./assistant.tables.ts";

describe("assistant table ownership", () => {
  it("declares only assistant-owned tables", () => {
    expect([...assistantTables.owns].sort()).toEqual(["assistant_messages", "assistant_run_events", "assistant_runs", "assistant_threads"]);
  });
});
