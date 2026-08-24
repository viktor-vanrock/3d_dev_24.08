import type { UserId } from "../../_kernel/brandedIds.ts";
import type { MakePageResponse } from "../../makes/public/index.ts";
import type { MakerProcess, MakerProfileRecord, MakerServiceMode } from "../domain/maker-profile.ts";

export const MAKER_FOLLOW_READ_PORT = Symbol("MAKER_FOLLOW_READ_PORT");
export const MAKERS_PORT = Symbol("MAKERS_PORT");

export interface MakerFollowStats {
  readonly followersCount: number;
  readonly followingCount: number;
  readonly isFollowing: boolean;
}

export interface MakerFollowReadPort {
  stats(userId: UserId, viewerId: UserId | null): Promise<MakerFollowStats>;
}

export interface MakersPort {
  feed(userId: UserId, query: { readonly cursor?: string; readonly limit?: string }): Promise<MakePageResponse>;
  follow(userId: UserId, username: string): Promise<void>;
  unfollow(userId: UserId, username: string): Promise<void>;
  profile(userId: UserId): Promise<{ readonly maker_profile: Omit<MakerProfileRecord, "user_id"> }>;
  updateProfile(userId: UserId, body: MakerProfileInput): Promise<{ readonly maker_profile: Omit<MakerProfileRecord, "user_id"> }>;
  nearby(query: MakersNearbyQuery): Promise<{ readonly makers: readonly NearbyMaker[] }>;
}

export interface MakerProfileInput {
  readonly active?: boolean;
  readonly service_mode: MakerServiceMode;
  readonly lat?: number | null;
  readonly lng?: number | null;
  readonly radius_km?: number | null;
  readonly service_cities?: readonly string[];
  readonly region_label: string;
  readonly processes?: readonly MakerProcess[];
  readonly material_type_ids?: readonly string[];
  readonly max_build_volume_mm?: { readonly x: number; readonly y: number; readonly z: number } | null;
  readonly min_layer_height_mm?: number | null;
  readonly capacity_per_week?: number | null;
  readonly sla_days?: number | null;
}
export interface MakersNearbyQuery {
  readonly lat: string;
  readonly lng: string;
  readonly radius_km: string;
  readonly process?: string;
  readonly material_type_id?: string;
  readonly limit?: string;
}
export interface NearbyMaker {
  readonly user_id: string;
  readonly username: string;
  readonly display_name: string | null;
  readonly region_label: string;
  readonly service_mode: MakerServiceMode;
  readonly processes: readonly MakerProcess[];
  readonly sla_days: number | null;
  readonly capacity_per_week: number | null;
  readonly distance_km: number | null;
}
