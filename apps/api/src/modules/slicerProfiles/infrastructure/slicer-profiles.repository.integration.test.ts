import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import { MachineId, MaterialId, SlicerProfileId } from "../domain/slicer-profile.ts";
import { SlicerProfilesRepository } from "./slicer-profiles.repository.ts";

function isPortalTestDatabase(): boolean {
  const url = process.env.DATABASE_URL;
  if (url === undefined) return false;
  return new URL(url).pathname.slice(1) === "portal_test";
}

const describeDb = isPortalTestDatabase() ? describe : describe.skip;

describeDb("SlicerProfilesRepository (portal_test)", () => {
  it("writes and reads only the owned append-only calibration table", async () => {
    const suffix = randomUUID();
    const user = await pool.query<{ id: string }>(`insert into users (username) values ($1) returning id`, [`nest-slicer-${suffix}`]);
    const machine = await pool.query<{ id: string }>(`insert into machines (kind, model, status) values ('fdm_printer', $1, 'active') returning id`, [`Nest slicer ${suffix}`]);
    const vendor = await pool.query<{ id: string }>(`insert into vendors (slug, name) values ($1, $2) returning id`, [`nest-${suffix}`, "Nest"]);
    const type = await pool.query<{ id: string }>(`insert into material_types (slug, name) values ($1, 'PLA') returning id`, [`pla-${suffix}`]);
    const material = await pool.query<{ id: string }>(`insert into materials (vendor_id, material_type_id, slug, name, kind) values ($1, $2, $3, 'PLA', 'filament') returning id`, [
      vendor.rows[0]!.id,
      type.rows[0]!.id,
      `pla-${suffix}`,
    ]);
    const profile = await pool.query<{ id: string }>(
      `insert into slicer_profiles (profile_class, slicer, name, machine_id, material_id, params, source_name, license)
       values ('process', 'orcaslicer', $1, $2, $3, '{}', 'OrcaSlicer', 'AGPL-3.0-or-later') returning id`,
      [`Nest profile ${suffix}`, machine.rows[0]!.id, material.rows[0]!.id],
    );
    const repository = new SlicerProfilesRepository(pool);
    try {
      const created = await repository.createCalibration(SlicerProfileId(profile.rows[0]!.id), UserId(user.rows[0]!.id), {
        machineId: MachineId(machine.rows[0]!.id),
        materialId: MaterialId(material.rows[0]!.id),
        modelId: null,
        makeId: null,
        flowRatio: 0.97,
        pressureAdvance: 0.045,
        outcome: "success",
        defectType: null,
        photoS3Key: null,
        notes: "verified",
      });
      await expect(repository.listCalibrations(SlicerProfileId(profile.rows[0]!.id))).resolves.toMatchObject([
        { id: created.id, flow_ratio: "0.970", pressure_advance: "0.0450", notes: "verified" },
      ]);
    } finally {
      await pool.query(`delete from slicer_profile_calibrations where slicer_profile_id = $1`, [profile.rows[0]!.id]);
      await pool.query(`delete from slicer_profiles where id = $1`, [profile.rows[0]!.id]);
      await pool.query(`delete from materials where id = $1`, [material.rows[0]!.id]);
      await pool.query(`delete from material_types where id = $1`, [type.rows[0]!.id]);
      await pool.query(`delete from vendors where id = $1`, [vendor.rows[0]!.id]);
      await pool.query(`delete from machines where id = $1`, [machine.rows[0]!.id]);
      await pool.query(`delete from users where id = $1`, [user.rows[0]!.id]);
    }
  });
});
