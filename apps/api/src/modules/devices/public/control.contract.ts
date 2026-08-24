export const MAX_DEVICE_TRANSFER_SIZE_BYTES = 1024 * 1024 * 1024;

export const DEVICE_TRANSFER_STATUSES = ["initiated", "transferring", "completed", "failed", "cancelled"] as const;
export type DeviceTransferStatus = (typeof DEVICE_TRANSFER_STATUSES)[number];

// gcode -> Moonraker root=gcodes (может стартовать печать); printer_profile -> root=config,
// никогда не печатает (MF-1942, best-effort отправка слайсер-профиля).
export const DEVICE_TRANSFER_KINDS = ["gcode", "printer_profile"] as const;
export type DeviceTransferKind = (typeof DEVICE_TRANSFER_KINDS)[number];

/** Metadata contract shared by the session API and the relay data-plane. */
export interface DeviceTransferMetadata {
  transfer_id: string;
  device_id: string;
  file_name: string;
  size_bytes: number;
  sha256: string | null;
  start_print: boolean;
  kind: DeviceTransferKind;
  status: DeviceTransferStatus;
  next_seq: number;
  bytes_transferred: number;
  error_code: string | null;
  error_message: string | null;
  updated_at: string;
}

export interface DeviceTransferDataPlane {
  protocol: "relay.file.v1";
  transfer_id: string;
  file_name: string;
  size_bytes: number;
  sha256: string | null;
  start_print: boolean;
  next_seq: number;
}
