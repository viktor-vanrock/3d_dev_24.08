import type { Pool, PoolClient, QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import { MaterialAdminPgRepository } from "./material-admin.repository.ts";

const actorId = UserId("00000000-0000-4000-8000-000000000001");

function result(rows: readonly Readonly<Record<string, unknown>>[] = []): QueryResult<never> {
  return { rows, rowCount: rows.length } as QueryResult<never>;
}

function setup(...responses: readonly QueryResult<never>[]) {
  const query = vi.fn().mockResolvedValue(result());
  for (const response of responses) query.mockResolvedValueOnce(response);
  const client = { query, release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValue(client) };
  return { repository: new MaterialAdminPgRepository(pool as unknown as Pool), client: client as unknown as PoolClient, query };
}

describe("MaterialAdminPgRepository lifecycle", () => {
  it("не включает specs в metadata update, если поле не передано", async () => {
    const { repository, query } = setup(result(), result([{ id: "material-1", version: 4 }]), result());
    await expect(repository.update(actorId, "material-1", { version: 3, name: "Updated" })).resolves.toMatchObject({ kind: "updated" });
    const update = query.mock.calls.find(([sql]) => String(sql).startsWith("update materials"));
    expect(String(update?.[0])).not.toContain("specs=");
    expect(String(update?.[0])).not.toContain("status=");
    expect(String(update?.[0])).not.toContain("archived_at=");
    expect(update?.[1]).toEqual(["material-1", 3, "Updated"]);
  });

  it("откатывает material mutation, если audit не записался", async () => {
    const auditFailure = new Error("audit unavailable");
    const { repository, query } = setup(result(), result([{ id: "material-1", version: 4 }]));
    query.mockRejectedValueOnce(auditFailure).mockResolvedValueOnce(result());
    await expect(repository.publish(actorId, "material-1", 3)).rejects.toBe(auditFailure);
    expect(query.mock.calls.at(-1)?.[0]).toBe("rollback");
    expect(query.mock.calls.some(([sql]) => sql === "commit")).toBe(false);
  });

  it("публикует с синхронным сбросом archived_at и аудитом", async () => {
    const { repository, query } = setup(result(), result([{ id: "material-1", version: 4 }]), result());
    await expect(repository.publish(actorId, "material-1", 3)).resolves.toEqual({ kind: "updated", id: "material-1", version: 4 });
    expect(String(query.mock.calls[1]?.[0])).toContain("status='published',archived_at=null");
    expect(String(query.mock.calls[2]?.[0])).toContain("audit_log");
    expect(query.mock.calls.at(-1)?.[0]).toBe("commit");
  });

  it("архивирует с archived_at и различает повторный переход", async () => {
    const { repository, query } = setup(result(), result(), result([{ version: 3, status: "archived" }]), result());
    await expect(repository.archive(actorId, "material-1", 3)).resolves.toEqual({ kind: "invalid_transition" });
    expect(String(query.mock.calls[1]?.[0])).toContain("archived_at=now()");
    expect(query.mock.calls.at(-1)?.[0]).toBe("rollback");
  });

  it("восстанавливает архивный материал в draft и очищает archived_at", async () => {
    const { repository, query } = setup(result(), result([{ id: "material-1", version: 4 }]), result());
    await expect(repository.restore(actorId, "material-1", 3)).resolves.toEqual({ kind: "updated", id: "material-1", version: 4 });
    expect(String(query.mock.calls[1]?.[0])).toContain("status='draft',archived_at=null");
    expect(query.mock.calls[2]?.[1]?.[1]).toBe("material.restored");
    expect(query.mock.calls.at(-1)?.[0]).toBe("commit");
  });

  it("различает stale version и отсутствующую запись", async () => {
    const stale = setup(result(), result(), result([{ version: 5, status: "draft" }]), result());
    await expect(stale.repository.publish(actorId, "material-1", 3)).resolves.toEqual({ kind: "conflict" });
    const missing = setup(result(), result(), result(), result());
    await expect(missing.repository.publish(actorId, "missing", 3)).resolves.toEqual({ kind: "not_found" });
  });
});
