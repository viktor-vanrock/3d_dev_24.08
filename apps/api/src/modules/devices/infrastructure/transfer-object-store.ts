import { createHash } from "node:crypto";
import { deviceTransferObjectKey, putDeviceTransferObject } from "../../../storage/s3.ts";
import type { DeviceTransferKind } from "../public/control.contract.ts";

export interface StageDeviceTransferInput {
  readonly ownerId: string;
  readonly deviceId: string;
  readonly transferId: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly kind: DeviceTransferKind;
  readonly data: Buffer;
}

export type StageDeviceTransferResult =
  | { readonly ok: true; readonly objectKey: string; readonly objectVersion: string; readonly contentType: "model/gcode" | "text/plain" }
  | { readonly ok: false; readonly status: number; readonly error: string };

export async function stageDeviceTransfer(input: StageDeviceTransferInput): Promise<StageDeviceTransferResult> {
  if (input.data.length !== input.sizeBytes || createHash("sha256").update(input.data).digest("hex") !== input.sha256) {
    return { ok: false, status: 409, error: "transfer_source_mismatch" };
  }
  const contentType = input.kind === "gcode" ? "model/gcode" : "text/plain";
  const objectKey = deviceTransferObjectKey(input.ownerId, input.transferId, input.fileName);
  try {
    const stored = await putDeviceTransferObject(objectKey, input.data, contentType);
    if (stored === null) return { ok: false, status: 503, error: "transfer_storage_not_configured" };
    return { ok: true, objectKey, objectVersion: stored.objectVersion, contentType };
  } catch {
    return { ok: false, status: 503, error: "transfer_storage_unavailable" };
  }
}
