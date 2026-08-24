import { pool } from "../../../db/client.ts";
import type { SlicerProfileId } from "../domain/slicer-profile.ts";

export async function activeSlicerProfileName(profileId: SlicerProfileId): Promise<string | null> {
  return (await pool.query<{ name: string }>(`select name from slicer_profiles where id = $1 and status = 'active'`, [profileId])).rows[0]?.name ?? null;
}
