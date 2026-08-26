import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { SanctionAlreadyActiveError, SanctionIdempotencyConflictError, SanctionNotActiveError } from "../domain/sanction.errors.ts";
import { DevicesRepository } from "../../devices/infrastructure/devices.repository.ts";
import { ProfileRepository } from "../../profile/infrastructure/profile.repository.ts";
import { ProjectsOutboxRepository } from "../../projects/infrastructure/outbox.repository.ts";
import { PublicApiRepository } from "../../publicapi/infrastructure/publicapi.repository.ts";
import { SanctionsRepository } from "../infrastructure/sanctions.repository.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import { SanctionsService } from "./sanctions.service.ts";

const users: string[] = [];
const sanctions: string[] = [];
function service(config: Record<string, string> = {}): SanctionsService {
  const profiles = new ProfileRepository(pool);
  return new SanctionsService(
    pool, new ConfigService(config), new SanctionsRepository(pool), profiles,
    new DevicesRepository(pool, {} as never), new PublicApiRepository(pool, profiles), new ProjectsOutboxRepository(pool),
  );
}
async function user(input: { staff?: boolean; status?: "active" | "restricted" | "banned" | "deleted"; username?: string } = {}): Promise<ReturnType<typeof UserId>> {
  const row = await pool.query<{ id: string }>(
    `insert into users(username, is_staff, status) values($1,$2,$3) returning id`,
    [input.username ?? `sanctions-service-${randomUUID()}`, input.staff ?? false, input.status ?? "active"],
  );
  users.push(row.rows[0]!.id);
  return UserId(row.rows[0]!.id);
}
const command = (actorId: ReturnType<typeof UserId>, targetId: ReturnType<typeof UserId>, idempotencyKey = randomUUID()) => ({
  actorId, targetId, type: "ban" as const, reasonCode: "fraud" as const, reasonNote: "fixture", evidenceUrl: null, endsAt: null, idempotencyKey,
});

afterAll(async () => {
  if (sanctions.length > 0) await pool.query(`delete from outbox_events where aggregate_type='Sanction' and aggregate_id = any($1::uuid[])`, [sanctions]);
  if (sanctions.length > 0) await pool.query(`delete from sanctions where id = any($1::uuid[])`, [sanctions]);
  if (users.length > 0) await pool.query(`delete from users where id = any($1::uuid[])`, [users]);
});

describe("SanctionsService", () => {
  it("creates an atomic cascade without changing PII, and matching retries do not cascade again", async () => {
    const actor = await user({ staff: true }); const target = await user(); const key = randomUUID();
    await pool.query(`update users set display_name='PII fixture', bio='private' where id=$1`, [target]);
    const first = await service().create(command(actor, target, key)); sanctions.push(first.sanction.id);
    expect(first).toMatchObject({ reused: false, sanction: { state: "active" }, cascade: { sessionVersion: 2 } });
    await expect(pool.query(`select status, session_version, display_name, bio from users where id=$1`, [target])).resolves.toMatchObject({ rows: [{ status: "restricted", session_version: 2, display_name: "PII fixture", bio: "private" }] });
    await expect(pool.query(`select event_type from outbox_events where aggregate_id=$1`, [first.sanction.id])).resolves.toMatchObject({ rows: [{ event_type: "sanction.relay_close.v1" }] });
    await expect(service().create(command(actor, target, key))).resolves.toMatchObject({ reused: true, cascade: null, sanction: { id: first.sanction.id } });
    await expect(pool.query(`select session_version from users where id=$1`, [target])).resolves.toMatchObject({ rows: [{ session_version: 2 }] });
  });

  it("rejects conflicting idempotency payloads and a second active sanction", async () => {
    const actor = await user({ staff: true }); const target = await user(); const key = randomUUID(); const created = await service().create(command(actor, target, key)); sanctions.push(created.sanction.id);
    await expect(service().create({ ...command(actor, target, key), reasonCode: "abuse" })).rejects.toBeInstanceOf(SanctionIdempotencyConflictError);
    await expect(service().create(command(actor, target))).rejects.toBeInstanceOf(SanctionAlreadyActiveError);
  });

  it("cancels without restoring credentials or bumping the session version", async () => {
    const actor = await user({ staff: true }); const target = await user(); const created = await service().create(command(actor, target)); sanctions.push(created.sanction.id);
    await expect(service().cancel({ actorId: actor, sanctionId: created.sanction.id, cancelReason: "reviewed" })).resolves.toMatchObject({ state: "cancelled", cancelReason: "reviewed" });
    await expect(pool.query(`select status, session_version from users where id=$1`, [target])).resolves.toMatchObject({ rows: [{ status: "active", session_version: 2 }] });
    await expect(service().cancel({ actorId: actor, sanctionId: created.sanction.id, cancelReason: "again" })).rejects.toBeInstanceOf(SanctionNotActiveError);
  });
});
