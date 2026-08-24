import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { ModelId, type UserId } from "../../_kernel/brandedIds.ts";
import { CATALOG_READ_PORT, type CatalogReadPort } from "../../catalog/public/index.ts";
import { MAKES_READ_PORT, type MakesReadPort } from "../../makes/public/index.ts";
import { MODEL_READ_PORT, type ModelReadPort } from "../../models/public/index.ts";
import {
  type BaselineProfile,
  type FilamentInput,
  type ListedProfile,
  type MachineId,
  type MaterialId,
  type PrinterInput,
  type ProfileClass,
  type RecommendationInputs,
  type SlicerProfileId,
} from "../domain/slicer-profile.ts";
import type { DeviceCompatibilityFilament, SlicerProfileLookupPort } from "../public/index.ts";

interface ProfileRow {
  readonly id: string;
  readonly profile_class: ProfileClass;
  readonly slicer: "orcaslicer" | "prusaslicer" | "cura";
  readonly name: string;
  readonly inherits_id: string | null;
  readonly machine_id: string | null;
  readonly material_id: string | null;
  readonly params: unknown;
  readonly source_name: string;
  readonly source_url: string | null;
  readonly source_ref: string | null;
  readonly license: string;
  readonly confidence: string | number;
  readonly extrapolated_from_id: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberAt(value: unknown, paths: readonly (readonly string[])[]): number | null {
  for (const path of paths) {
    let current = value;
    for (const segment of path) {
      if (!isRecord(current)) {
        current = null;
        break;
      }
      current = current[segment];
    }
    if (typeof current === "number" && Number.isFinite(current)) return current;
  }
  return null;
}

function stringAt(value: unknown, paths: readonly (readonly string[])[]): string | null {
  for (const path of paths) {
    let current = value;
    for (const segment of path) {
      if (!isRecord(current)) {
        current = null;
        break;
      }
      current = current[segment];
    }
    if (typeof current === "string" && current.trim() !== "") return current.trim();
  }
  return null;
}

function printer(id: string, specs: unknown): PrinterInput {
  return {
    id,
    nozzleDiameterMm: numberAt(specs, [["nozzle_diameter_mm"], ["filament_dia_mm"]]),
    kinematics: stringAt(specs, [["kinematics"]]),
    buildVolumeMm: {
      x: numberAt(specs, [["build_volume_mm", "x"], ["build_volume", "x"], ["build_volume_x_mm"]]),
      y: numberAt(specs, [["build_volume_mm", "y"], ["build_volume", "y"], ["build_volume_y_mm"]]),
      z: numberAt(specs, [["build_volume_mm", "z"], ["build_volume", "z"], ["build_volume_z_mm"]]),
    },
    maxNozzleTempC: numberAt(specs, [["max_nozzle_temp_c"], ["max_hotend_temp_c"], ["hotend", "max_temp_c"]]),
    maxBedTempC: numberAt(specs, [["max_bed_temp_c"], ["bed", "max_temp_c"]]),
    maxPrintSpeedMmS: numberAt(specs, [["max_print_speed_mm_s"], ["max_speed_mm_s"], ["speed", "max_mm_s"]]),
  };
}

function profile(row: ProfileRow): BaselineProfile {
  return {
    id: row.id,
    profileClass: row.profile_class,
    slicer: row.slicer,
    name: row.name,
    machineId: row.machine_id,
    materialId: row.material_id,
    inheritsId: row.inherits_id,
    params: isRecord(row.params) ? row.params : {},
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    sourceRef: row.source_ref,
    license: row.license,
    confidence: Number(row.confidence),
    extrapolatedFromId: row.extrapolated_from_id,
  };
}

@Injectable()
export class SlicerProfileLookupAdapter implements SlicerProfileLookupPort {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(CATALOG_READ_PORT) private readonly catalog: CatalogReadPort,
    @Inject(MODEL_READ_PORT) private readonly models: ModelReadPort,
    @Inject(MAKES_READ_PORT) private readonly makes: MakesReadPort,
  ) {}

  async listActive(profileClass: ProfileClass): Promise<readonly ListedProfile[]> {
    const result = await this.pool.query<ListedProfile>(
      `select id, name, source_name, machine_id, material_id, slicer
         from slicer_profiles
        where status = 'active' and profile_class = $1
        order by name`,
      [profileClass],
    );
    return result.rows;
  }

  async recommendationInputs(printerId: MachineId, filamentId: MaterialId): Promise<RecommendationInputs | null> {
    const [machine, filament, profiles] = await Promise.all([
      this.catalog.machineForSlicer(printerId),
      this.catalog.filamentForSlicer(filamentId),
      this.pool.query<ProfileRow>(
        `select id, profile_class, slicer, name, inherits_id, machine_id, material_id, params,
                source_name, source_url, source_ref, license, confidence, extrapolated_from_id
           from slicer_profiles
          where status = 'active' and profile_class in ('machine', 'process', 'filament')
          order by id`,
      ),
    ]);
    if (machine === null || filament === null) return null;
    const filamentInput: FilamentInput = {
      id: filament.id,
      materialClass: stringAt(filament.specs, [["material_class"], ["material_type"]]) ?? filament.materialClass,
      diameterMm: numberAt(filament.specs, [["diameter_mm"], ["filament_diameter_mm"]]),
    };
    return {
      printer: printer(machine.id, machine.specs),
      filament: filamentInput,
      profiles: profiles.rows.map(profile),
    };
  }

  async profileExists(profileId: SlicerProfileId): Promise<boolean> {
    return (await this.pool.query(`select 1 from slicer_profiles where id = $1`, [profileId])).rowCount !== 0;
  }

  async activeProfileName(profileId: SlicerProfileId): Promise<string | null> {
    return (await this.pool.query<{ name: string }>(`select name from slicer_profiles where id=$1 and status='active'`, [profileId])).rows[0]?.name ?? null;
  }

  async compatibilityFilament(profileId: SlicerProfileId): Promise<DeviceCompatibilityFilament | null> {
    const materialId = (await this.pool.query<{ material_id: string | null }>(`select material_id from slicer_profiles where id=$1`, [profileId])).rows[0]?.material_id;
    if (materialId === undefined || materialId === null) return null;
    const material = await this.catalog.compatibilityMaterial(materialId);
    if (material === null) return null;
    const fillType = typeof material.specs.fill_type === "string" ? material.specs.fill_type : undefined;
    const normalizedFillType =
      fillType === "carbon_fiber"
        ? "carbon"
        : fillType === "glass_fiber"
          ? "glass"
          : fillType === "metal_filled"
            ? "metal"
            : fillType === "wood_filled"
              ? "wood"
              : fillType === "carbon" || fillType === "glass" || fillType === "wood" || fillType === "metal" || fillType === "glitter" || fillType === "ceramic"
                ? fillType
                : undefined;
    return {
      materialFamily: material.materialType,
      ...(normalizedFillType === undefined ? {} : { fillType: normalizedFillType }),
      needsChamber: material.requiresChamber,
      needsDirectDrive: material.requiresDirectDrive,
      needsDrying: material.requiresDrying,
      ...(material.defaultExtruderTempC === null ? {} : { extruderTempMaxC: material.defaultExtruderTempC }),
    };
  }

  machineExists(machineId: MachineId): Promise<boolean> {
    return this.catalog.machineExists(machineId);
  }

  filamentExists(materialId: MaterialId): Promise<boolean> {
    return this.catalog.filamentExists(materialId);
  }

  modelExists(modelId: string): Promise<boolean> {
    return this.models.exists(ModelId(modelId));
  }

  makeOwnedBy(makeId: string, userId: UserId): Promise<boolean> {
    return this.makes.isOwned(makeId, userId);
  }
}
