import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearGuestIntent, saveGuestIntent, takeGuestIntent } from "./guestintent.ts";

describe("guest intent cancellation", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it("clears a pending printer resume so a later login cannot replay a cancelled action", () => {
    saveGuestIntent({
      kind: "printer_connect",
      printerId: "prusa-mk4",
      level: "managed-local",
      ip: "192.168.1.42",
      returnTo: "/park/add",
    });

    clearGuestIntent();

    expect(takeGuestIntent()).toBeNull();
  });
});
