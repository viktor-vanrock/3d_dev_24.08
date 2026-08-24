import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { MakerProcess, MakerProfileRecord, MakerServiceMode, ParsedMakerProfile } from "../domain/maker-profile.ts";

interface MakerProfileRow {
  readonly user_id: string;
  readonly active: boolean;
  readonly service_mode: MakerServiceMode;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly radius_km: string | null;
  readonly service_cities: string[];
  readonly region_label: string;
  readonly processes: MakerProcess[];
  readonly material_type_ids: string[];
  readonly max_build_volume_mm: { x: number; y: number; z: number } | null;
  readonly min_layer_height_mm: string | null;
  readonly capacity_per_week: number | null;
  readonly sla_days: number | null;
  readonly updated_at: string;
}

function record(row: MakerProfileRow): MakerProfileRecord {
  return {
    ...row,
    radius_km: row.radius_km === null ? null : Number(row.radius_km),
    min_layer_height_mm: row.min_layer_height_mm === null ? null : Number(row.min_layer_height_mm),
  };
}

const PROFILE_FIELDS = `user_id, active, service_mode,
  ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng,
  radius_km, service_cities, region_label, processes, material_type_ids,
  max_build_volume_mm, min_layer_height_mm, capacity_per_week, sla_days, updated_at`;

@Injectable()
export class MakersRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async followeeIds(userId: UserId): Promise<readonly UserId[]> {
    const result = await this.pool.query<{ followee_id: UserId }>(`select followee_id from user_follows where follower_id = $1`, [userId]);
    return result.rows.map((row) => row.followee_id);
  }

  async follow(userId: UserId, targetId: UserId): Promise<void> {
    await this.pool.query(
      `insert into user_follows (follower_id, followee_id) values ($1, $2)
       on conflict (follower_id, followee_id) do nothing`,
      [userId, targetId],
    );
  }

  async unfollow(userId: UserId, targetId: UserId): Promise<void> {
    await this.pool.query(`delete from user_follows where follower_id = $1 and followee_id = $2`, [userId, targetId]);
  }

  async profile(userId: UserId): Promise<MakerProfileRecord | null> {
    const row = (await this.pool.query<MakerProfileRow>(`select ${PROFILE_FIELDS} from maker_profiles where user_id = $1`, [userId])).rows[0];
    return row === undefined ? null : record(row);
  }

  async upsert(userId: UserId, input: ParsedMakerProfile, geohash: string | null): Promise<MakerProfileRecord> {
    const result = await this.pool.query<MakerProfileRow>(
      `insert into maker_profiles (
         user_id, active, service_mode, location, location_geohash, radius_km, service_cities,
         region_label, processes, material_type_ids, max_build_volume_mm, min_layer_height_mm,
         capacity_per_week, sla_days
       ) values (
         $1, $2, $3,
         case when $4::double precision is null then null else ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography end,
         $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
       )
       on conflict (user_id) do update set
         active = excluded.active, service_mode = excluded.service_mode, location = excluded.location,
         location_geohash = excluded.location_geohash, radius_km = excluded.radius_km,
         service_cities = excluded.service_cities, region_label = excluded.region_label,
         processes = excluded.processes, material_type_ids = excluded.material_type_ids,
         max_build_volume_mm = excluded.max_build_volume_mm,
         min_layer_height_mm = excluded.min_layer_height_mm,
         capacity_per_week = excluded.capacity_per_week, sla_days = excluded.sla_days, updated_at = now()
       returning ${PROFILE_FIELDS}`,
      [
        userId,
        input.active,
        input.serviceMode,
        input.lng,
        input.lat,
        geohash,
        input.radiusKm,
        input.serviceCities,
        input.regionLabel,
        input.processes,
        input.materialTypeIds,
        input.maxBuildVolumeMm === null ? null : JSON.stringify(input.maxBuildVolumeMm),
        input.minLayerHeightMm,
        input.capacityPerWeek,
        input.slaDays,
      ],
    );
    return record(result.rows[0]!);
  }

  async nearby(input: {
    readonly lat: number;
    readonly lng: number;
    readonly radiusKm: number;
    readonly process: MakerProcess | null;
    readonly materialTypeId: string | null;
    readonly limit: number;
  }): Promise<readonly (MakerProfileRecord & { readonly distance_km: number | null })[]> {
    const result = await this.pool.query<MakerProfileRow & { distance_km: string | null }>(
      `with candidates as (
         select mp.* from maker_profiles mp
         where mp.active and mp.service_mode = 'mail_ru'
           and ($4::text is null or $4 = any(mp.processes))
           and ($5::uuid is null or $5::uuid = any(mp.material_type_ids))
         union all
         select mp.* from maker_profiles mp
         where mp.active and mp.service_mode <> 'mail_ru'
           and ST_DWithin(mp.location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3 * 1000)
           and ($4::text is null or $4 = any(mp.processes))
           and ($5::uuid is null or $5::uuid = any(mp.material_type_ids))
       )
       select ${PROFILE_FIELDS},
         case when location is not null then
           round((ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) / 1000.0)::numeric, 1)
         else null end as distance_km
       from candidates order by distance_km asc nulls last limit $6`,
      [input.lat, input.lng, input.radiusKm, input.process, input.materialTypeId, input.limit],
    );
    return result.rows.map((row) => ({ ...record(row), distance_km: row.distance_km === null ? null : Number(row.distance_km) }));
  }
}
