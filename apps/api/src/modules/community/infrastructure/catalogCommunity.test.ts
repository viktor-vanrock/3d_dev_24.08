import { afterEach, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { ensureCatalogCommunity } from "./catalogCommunity.ts";

const vendorIds: string[] = [];
const communityIds: string[] = [];

afterEach(async () => {
  if (communityIds.length) await pool.query(`delete from communities where id = any($1::uuid[])`, [communityIds]);
  communityIds.length = 0;
  if (vendorIds.length) await pool.query(`delete from vendors where id = any($1::uuid[])`, [vendorIds]);
  vendorIds.length = 0;
});

async function makeVendor(name: string): Promise<string> {
  const slug = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await pool.query<{ id: string }>(`insert into vendors (slug, name) values ($1, $2) returning id`, [slug, name]);
  const id = res.rows[0]!.id;
  vendorIds.push(id);
  return id;
}

describe("ensureCatalogCommunity (MF-2039)", () => {
  it("создаёт саб с kind/subject, соответствующим каталожной записи", async () => {
    const vendorId = await makeVendor(`Ensure Test Vendor ${Date.now()}`);
    const communityId = await ensureCatalogCommunity("vendor", vendorId, "Ensure Test Vendor");
    communityIds.push(communityId);

    const row = await pool.query(`select kind, subject_type, subject_id from communities where id = $1`, [communityId]);
    expect(row.rows[0]).toEqual({ kind: "vendor", subject_type: "vendor", subject_id: vendorId });
  });

  it("идемпотентна — повторный вызов на тот же subject возвращает тот же id, не плодит дубли", async () => {
    const vendorId = await makeVendor(`Ensure Idempotent Vendor ${Date.now()}`);
    const first = await ensureCatalogCommunity("vendor", vendorId, "Ensure Idempotent Vendor");
    communityIds.push(first);
    const second = await ensureCatalogCommunity("vendor", vendorId, "Ensure Idempotent Vendor");

    expect(second).toBe(first);
    const rows = await pool.query(`select id from communities where subject_id = $1`, [vendorId]);
    expect(rows.rows).toHaveLength(1);
  });

  it("не переименовывает существующий саб при повторном вызове с другим именем", async () => {
    const vendorId = await makeVendor(`Ensure Rename Guard ${Date.now()}`);
    const first = await ensureCatalogCommunity("vendor", vendorId, "Original Name");
    communityIds.push(first);
    await ensureCatalogCommunity("vendor", vendorId, "Different Name Later");

    const row = await pool.query<{ name: string }>(`select name from communities where id = $1`, [first]);
    expect(row.rows[0]!.name).toBe("Original Name");
  });
});
