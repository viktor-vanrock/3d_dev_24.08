import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { DeviceId, UserId } from "../../_kernel/brandedIds.ts";
import { DevicesRepository } from "./devices.repository.ts";

const canRun = Boolean(process.env.DATABASE_URL);
const repository = new DevicesRepository(pool, {} as never);
let userId: ReturnType<typeof UserId>;
let deviceId: ReturnType<typeof DeviceId>;

describe.skipIf(!canRun)("DevicesRepository idempotent command queue", () => {
  beforeEach(async () => {
    userId = UserId(randomUUID());
    deviceId = DeviceId(randomUUID());
    await pool.query(`insert into users(id,username) values($1,$2)`, [userId, `command-race-${randomUUID()}`]);
    await pool.query(`insert into user_printers(id,user_id,brand,model,link_source) values($1,$2,'Test','Race','manual')`, [deviceId, userId]);
  });

  afterEach(async () => {
    await pool.query(`delete from users where id=$1`, [userId]);
  });

  it("сводит два параллельных одинаковых запроса к одной команде", async () => {
    const input = {
      deviceId,
      actorId: userId,
      idempotencyKey: "parallel-key",
      command: "pause",
      payload: {},
      requestId: "parallel-request",
    } as const;

    const [first, second] = await Promise.all([repository.queueIdempotentCommand(input), repository.queueIdempotentCommand(input)]);

    expect(first.conflict).toBe(false);
    expect(second.conflict).toBe(false);
    expect(first.row.id).toBe(second.row.id);
    const stored = await pool.query<{ count: string }>(`select count(*) from device_commands where device_id=$1 and actor_scope=$2 and idempotency_key=$3`, [
      deviceId,
      userId,
      input.idempotencyKey,
    ]);
    expect(Number(stored.rows[0]?.count)).toBe(1);
  });

  it("возвращает конфликт для того же ключа с другим payload", async () => {
    const base = {
      deviceId,
      actorId: userId,
      idempotencyKey: "conflict-key",
      command: "start",
      requestId: "conflict-request",
    } as const;
    const first = await repository.queueIdempotentCommand({ ...base, payload: { file_name: "first.gcode" } });
    const repeated = await repository.queueIdempotentCommand({ ...base, payload: { file_name: "second.gcode" } });

    expect(first.conflict).toBe(false);
    expect(repeated.conflict).toBe(true);
    expect(repeated.row.id).toBe(first.row.id);
  });
});
