export interface UserInventoryRecord {
  readonly id: string;
  readonly material_id: string;
  readonly variant_id: string | null;
  readonly note: string | null;
  readonly created_at: Date;
}

export interface UserPrinterRecord {
  readonly id: string;
  readonly printer_id: string | null;
  readonly catalog_printer_id: string | null;
  readonly brand: string;
  readonly model: string;
  readonly build_volume: { readonly x?: number; readonly y?: number; readonly z?: number } | null;
  readonly nozzle_mm: string | null;
  readonly kinematics: string | null;
  readonly link_source: string;
  readonly lan_endpoint: string | null;
  readonly verified: boolean;
  readonly is_primary: boolean;
  readonly created_at: Date;
}

export interface InventoryMaterialDescription {
  readonly name: string;
  readonly brand: string;
  readonly material_type: string;
  readonly color_name: string | null;
  readonly color_hex: string | null;
}

interface PrinterOperatingBaseProjection {
  readonly state: string | null;
  readonly progress: number | null;
  readonly job_id: string | null;
  readonly metrics: Readonly<Record<string, string | number | boolean | null>>;
  readonly seq: number;
  readonly connection_mode: "list" | "managed-local" | "managed-bridge";
  readonly live_availability_reason: "available" | "no_telemetry_channel" | "offline" | "stale" | "permission_denied" | "server_error";
  readonly last_confirmed_at: string | null;
  readonly command_capabilities: Readonly<Record<string, boolean>>;
}

export interface PrinterOperatingProjection extends PrinterOperatingBaseProjection {
  readonly last_seen_at: Date | null;
}

export interface PrinterLiveProjection extends PrinterOperatingBaseProjection {
  readonly live: boolean;
  readonly state_updated_at: string | null;
  readonly last_seen_at: string | null;
}

export interface PrinterCompatibilityProjection {
  readonly printer_id: string;
  readonly material_id: string | null;
  readonly model_id: string | null;
  readonly verdict: "ok" | "warn" | "blocked";
  readonly reasons: readonly Readonly<{ code: string; severity: "warn" | "blocked"; message: string }>[];
}

export interface PrinterQueuedCommandProjection {
  readonly id: string;
  readonly correlation_id: string;
  readonly device_id: string;
  readonly command: string;
  readonly status: "queued";
  readonly created_at: string;
}

export interface PrinterCommandStatusProjection {
  readonly command_id: string;
  readonly correlation_id: string;
  readonly device_id: string;
  readonly command: string;
  readonly status: "queued" | "leased" | "delivered" | "acknowledged" | "executed" | "failed" | "expired";
  readonly raw_status: string;
  readonly code: string | null;
  readonly message: string | null;
  readonly timestamp: string;
  readonly created_at: string;
  readonly acked_at: string | null;
}
