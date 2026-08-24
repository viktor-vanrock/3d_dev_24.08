import { BadRequestException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { MAKES_PORT, type MakesPort as MakesDomainPort } from "../../makes/public/index.ts";
import { PROFILE_READ_PORT, type ProfileReadPort } from "../../profile/public/index.ts";
import { encodeGeohash } from "../domain/geohash.ts";
import { MAKER_PROCESSES, MAKER_SERVICE_MODES, type MakerProcess, type MakerProfileRecord, type ParsedMakerProfile } from "../domain/maker-profile.ts";
import { MakersRepository } from "../infrastructure/makers.repository.ts";
import type { MakerProfileInput, MakersNearbyQuery, MakersPort as MakersDomainPort, NearbyMaker } from "../public/index.ts";
import type { MakePageResponse } from "../../makes/public/index.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REGION_LABEL_MAX = 120;
const SERVICE_CITIES_MAX = 30;
const CITY_MAX = 80;
const MAX_RADIUS_KM = 3000;
const MAX_SLA_DAYS = 365;
const MAX_CAPACITY_PER_WEEK = 100000;

function number(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function parseProfile(body: MakerProfileInput): ParsedMakerProfile | null {
  const active = body.active === undefined ? true : body.active;
  if (typeof active !== "boolean") return null;
  if (typeof body.service_mode !== "string" || !(MAKER_SERVICE_MODES as readonly string[]).includes(body.service_mode)) return null;
  const serviceMode = body.service_mode;
  if (body.lat !== undefined && body.lat !== null && !finite(body.lat)) return null;
  if (body.lng !== undefined && body.lng !== null && !finite(body.lng)) return null;
  const lat = finite(body.lat) ? body.lat : null;
  const lng = finite(body.lng) ? body.lng : null;
  if ((lat === null) !== (lng === null) || (lat !== null && (lat < -90 || lat > 90)) || (lng !== null && (lng < -180 || lng > 180))) return null;
  if (serviceMode !== "mail_ru" && lat === null) return null;
  let radiusKm: number | null = null;
  if (body.radius_km !== undefined && body.radius_km !== null) {
    if (!finite(body.radius_km) || body.radius_km <= 0 || body.radius_km > MAX_RADIUS_KM) return null;
    radiusKm = body.radius_km;
  }
  if (serviceMode === "radius" && radiusKm === null) return null;
  const serviceCities: string[] = [];
  if (body.service_cities !== undefined) {
    if (!Array.isArray(body.service_cities) || body.service_cities.length > SERVICE_CITIES_MAX) return null;
    for (const city of body.service_cities) {
      if (typeof city !== "string" || city.trim() === "") return null;
      serviceCities.push(city.trim().slice(0, CITY_MAX));
    }
  }
  if (serviceMode === "cities" && serviceCities.length === 0) return null;
  if (typeof body.region_label !== "string" || body.region_label.trim() === "") return null;
  const processes: MakerProcess[] = [];
  if (body.processes !== undefined) {
    if (!Array.isArray(body.processes)) return null;
    for (const process of body.processes) {
      if (typeof process !== "string" || !(MAKER_PROCESSES as readonly string[]).includes(process)) return null;
      processes.push(process as MakerProcess);
    }
  }
  const materialTypeIds: string[] = [];
  if (body.material_type_ids !== undefined) {
    if (!Array.isArray(body.material_type_ids)) return null;
    for (const id of body.material_type_ids) {
      if (typeof id !== "string" || !UUID_RE.test(id)) return null;
      materialTypeIds.push(id);
    }
  }
  let volume: ParsedMakerProfile["maxBuildVolumeMm"] = null;
  if (body.max_build_volume_mm !== undefined && body.max_build_volume_mm !== null) {
    if (typeof body.max_build_volume_mm !== "object" || Array.isArray(body.max_build_volume_mm)) return null;
    const value = body.max_build_volume_mm as Record<string, unknown>;
    if (!finite(value.x) || !finite(value.y) || !finite(value.z) || value.x <= 0 || value.y <= 0 || value.z <= 0) return null;
    volume = { x: value.x, y: value.y, z: value.z };
  }
  const layer = body.min_layer_height_mm;
  if (layer !== undefined && layer !== null && (!finite(layer) || layer <= 0)) return null;
  const capacity = body.capacity_per_week;
  if (capacity !== undefined && capacity !== null && (!integer(capacity) || capacity < 0 || capacity > MAX_CAPACITY_PER_WEEK)) return null;
  const sla = body.sla_days;
  if (sla !== undefined && sla !== null && (!integer(sla) || sla < 0 || sla > MAX_SLA_DAYS)) return null;
  return {
    active,
    serviceMode,
    lat,
    lng,
    radiusKm,
    serviceCities: [...new Set(serviceCities)],
    regionLabel: body.region_label.trim().slice(0, REGION_LABEL_MAX),
    processes: [...new Set(processes)],
    materialTypeIds: [...new Set(materialTypeIds)],
    maxBuildVolumeMm: volume,
    minLayerHeightMm: finite(layer) ? layer : null,
    capacityPerWeek: integer(capacity) ? capacity : null,
    slaDays: integer(sla) ? sla : null,
  };
}

function profileResponse(profile: MakerProfileRecord): Omit<MakerProfileRecord, "user_id"> {
  return {
    active: profile.active,
    service_mode: profile.service_mode,
    lat: profile.lat,
    lng: profile.lng,
    radius_km: profile.radius_km,
    service_cities: profile.service_cities,
    region_label: profile.region_label,
    processes: profile.processes,
    material_type_ids: profile.material_type_ids,
    max_build_volume_mm: profile.max_build_volume_mm,
    min_layer_height_mm: profile.min_layer_height_mm,
    capacity_per_week: profile.capacity_per_week,
    sla_days: profile.sla_days,
    updated_at: profile.updated_at,
  };
}

@Injectable()
export class MakersService implements MakersDomainPort {
  constructor(
    @Inject(MakersRepository) private readonly repository: MakersRepository,
    @Inject(MAKES_PORT) private readonly makes: MakesDomainPort,
    @Inject(PROFILE_READ_PORT) private readonly profiles: ProfileReadPort,
  ) {}

  async feed(userId: UserId, query: { readonly cursor?: string; readonly limit?: string }): Promise<MakePageResponse> {
    return this.makes.followedFeed(await this.repository.followeeIds(userId), query);
  }

  async follow(userId: UserId, username: string): Promise<void> {
    const target = await this.profiles.findActiveByUsername(username);
    if (target === null) throw new NotFoundException();
    if (target.id === userId) throw new UnprocessableEntityException();
    await this.repository.follow(userId, target.id);
  }

  async unfollow(userId: UserId, username: string): Promise<void> {
    const target = await this.profiles.findByUsername(username);
    if (target === null) throw new NotFoundException();
    await this.repository.unfollow(userId, target.id);
  }

  async profile(userId: UserId): Promise<{ readonly maker_profile: Omit<MakerProfileRecord, "user_id"> }> {
    const profile = await this.repository.profile(userId);
    if (profile === null) throw new NotFoundException();
    return { maker_profile: profileResponse(profile) };
  }

  async updateProfile(userId: UserId, body: MakerProfileInput): Promise<{ readonly maker_profile: Omit<MakerProfileRecord, "user_id"> }> {
    const parsed = parseProfile(body);
    if (parsed === null) throw new BadRequestException();
    const geohash = parsed.lat === null || parsed.lng === null ? null : encodeGeohash(parsed.lat, parsed.lng);
    return { maker_profile: profileResponse(await this.repository.upsert(userId, parsed, geohash)) };
  }

  async nearby(query: MakersNearbyQuery): Promise<{ readonly makers: readonly NearbyMaker[] }> {
    const lat = number(query.lat);
    const lng = number(query.lng);
    const radiusKm = number(query.radius_km);
    if (lat === null || lat < -90 || lat > 90) throw new BadRequestException();
    if (lng === null || lng < -180 || lng > 180) throw new BadRequestException();
    if (radiusKm === null || radiusKm <= 0 || radiusKm > MAX_RADIUS_KM) throw new BadRequestException();
    const process = query.process;
    if (process !== undefined && (typeof process !== "string" || !(MAKER_PROCESSES as readonly string[]).includes(process))) throw new BadRequestException();
    const materialTypeId = query.material_type_id;
    if (materialTypeId !== undefined && (typeof materialTypeId !== "string" || !UUID_RE.test(materialTypeId))) throw new BadRequestException();
    let limit = 50;
    if (query.limit !== undefined) {
      const parsed = number(query.limit);
      if (parsed === null || !Number.isInteger(parsed) || parsed <= 0 || parsed > 100) throw new BadRequestException();
      limit = parsed;
    }
    const rows = await this.repository.nearby({
      lat,
      lng,
      radiusKm,
      process: typeof process === "string" ? (process as MakerProcess) : null,
      materialTypeId: typeof materialTypeId === "string" ? materialTypeId : null,
      limit,
    });
    const profiles = await this.profiles.findActiveByIds(rows.map((row) => row.user_id as UserId));
    return {
      makers: rows.flatMap((row) => {
        const profile = profiles.get(row.user_id as UserId);
        return profile === undefined
          ? []
          : [
              {
                user_id: row.user_id,
                username: profile.username,
                display_name: profile.displayName,
                region_label: row.region_label,
                service_mode: row.service_mode,
                processes: row.processes,
                sla_days: row.sla_days,
                capacity_per_week: row.capacity_per_week,
                distance_km: row.distance_km,
              },
            ];
      }),
    };
  }
}
