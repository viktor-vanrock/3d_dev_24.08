import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { CalibrationInput, CalibrationRow, SlicerProfileId } from "../domain/slicer-profile.ts";

@Injectable()
export class SlicerProfilesRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async createCalibration(profileId: SlicerProfileId, userId: UserId, input: CalibrationInput): Promise<CalibrationRow> {
    const result = await this.pool.query<CalibrationRow>(
      `insert into slicer_profile_calibrations
         (slicer_profile_id, machine_id, material_id, model_id, make_id, user_id,
          flow_ratio, pressure_advance, outcome, defect_type, photo_s3_key, notes)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning id, slicer_profile_id, machine_id, material_id, model_id, make_id, user_id,
                 flow_ratio, pressure_advance, outcome, defect_type, photo_s3_key, notes,
                 source, created_at`,
      [
        profileId,
        input.machineId,
        input.materialId,
        input.modelId,
        input.makeId,
        userId,
        input.flowRatio,
        input.pressureAdvance,
        input.outcome,
        input.defectType,
        input.photoS3Key,
        input.notes,
      ],
    );
    return result.rows[0]!;
  }

  async listCalibrations(profileId: SlicerProfileId): Promise<readonly CalibrationRow[]> {
    const result = await this.pool.query<CalibrationRow>(
      `select id, slicer_profile_id, machine_id, material_id, model_id, make_id, user_id,
              flow_ratio, pressure_advance, outcome, defect_type, photo_s3_key, notes,
              source, created_at
         from slicer_profile_calibrations
        where slicer_profile_id = $1
        order by created_at desc
        limit 50`,
      [profileId],
    );
    return result.rows;
  }
}
