import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../storage/s3.ts", () => ({
  deviceTransferObjectKey: vi.fn((ownerId: string, transferId: string, fileName: string) => `protected/device-transfers/${ownerId}/${transferId}/${fileName}`),
  putDeviceTransferObject: vi.fn(async () => ({ objectVersion: "etag:immutable" })),
}));

import { putDeviceTransferObject } from "../../../storage/s3.ts";
import { stageDeviceTransfer } from "./transfer-object-store.ts";

const data = Buffer.from("hello");
const sha256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const input = {
  ownerId: "owner-1",
  deviceId: "device-1",
  transferId: "transfer-1",
  fileName: "profile.ini",
  sizeBytes: data.length,
  sha256,
  kind: "printer_profile" as const,
  data,
};

afterEach(() => vi.clearAllMocks());

describe("stageDeviceTransfer", () => {
  it("stores one immutable private object without calling relay or encoding base64", async () => {
    await expect(stageDeviceTransfer(input)).resolves.toEqual({
      ok: true,
      objectKey: "protected/device-transfers/owner-1/transfer-1/profile.ini",
      objectVersion: "etag:immutable",
      contentType: "text/plain",
    });
    expect(putDeviceTransferObject).toHaveBeenCalledWith(expect.stringContaining("transfer-1"), data, "text/plain");
  });

  it("rejects bytes that do not match immutable metadata", async () => {
    await expect(stageDeviceTransfer({ ...input, sizeBytes: data.length + 1 })).resolves.toEqual({ ok: false, status: 409, error: "transfer_source_mismatch" });
    expect(putDeviceTransferObject).not.toHaveBeenCalled();
  });

  it("fails closed when object storage is unavailable", async () => {
    vi.mocked(putDeviceTransferObject).mockResolvedValueOnce(null);
    await expect(stageDeviceTransfer(input)).resolves.toEqual({ ok: false, status: 503, error: "transfer_storage_not_configured" });
  });
});
