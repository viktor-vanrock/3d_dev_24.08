export const MAKER_PROCESSES = ["fdm", "resin-lcd", "resin-dlp", "resin-sla"] as const;
export type MakerProcess = (typeof MAKER_PROCESSES)[number];

export const MAKER_SERVICE_MODES = ["radius", "cities", "mail_ru"] as const;
export type MakerServiceMode = (typeof MAKER_SERVICE_MODES)[number];

export interface MakerProfileRecord {
  readonly user_id: string;
  readonly active: boolean;
  readonly service_mode: MakerServiceMode;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly radius_km: number | null;
  readonly service_cities: readonly string[];
  readonly region_label: string;
  readonly processes: readonly MakerProcess[];
  readonly material_type_ids: readonly string[];
  readonly max_build_volume_mm: { readonly x: number; readonly y: number; readonly z: number } | null;
  readonly min_layer_height_mm: number | null;
  readonly capacity_per_week: number | null;
  readonly sla_days: number | null;
  readonly updated_at: string;
}

export interface ParsedMakerProfile {
  readonly active: boolean;
  readonly serviceMode: MakerServiceMode;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly radiusKm: number | null;
  readonly serviceCities: readonly string[];
  readonly regionLabel: string;
  readonly processes: readonly MakerProcess[];
  readonly materialTypeIds: readonly string[];
  readonly maxBuildVolumeMm: { readonly x: number; readonly y: number; readonly z: number } | null;
  readonly minLayerHeightMm: number | null;
  readonly capacityPerWeek: number | null;
  readonly slaDays: number | null;
}
