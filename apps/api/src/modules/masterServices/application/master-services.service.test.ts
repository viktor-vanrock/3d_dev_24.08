import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { CatalogReadRepository } from "../../catalog/infrastructure/catalog-read.repository.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import { MasterServicesRepository } from "../infrastructure/master-services.repository.ts";
import { MasterServicesService } from "./master-services.service.ts";

async function user(label: string): Promise<string> {
  return (await pool.query<{ id: string }>("insert into users(username) values($1) returning id", [`master-services-nest-${label}-${randomUUID()}`])).rows[0]!.id;
}
async function material() {
  const vendor = (await pool.query<{ id: string }>("insert into vendors(slug,name) values($1,$2) returning id", [`ms-vendor-${randomUUID()}`, "Vendor"])).rows[0]!.id;
  const type = (await pool.query<{ id: string }>("insert into material_types(slug,name) values($1,$2) returning id", [`ms-type-${randomUUID()}`, "PLA"])).rows[0]!.id;
  const id = (
    await pool.query<{ id: string }>("insert into materials(kind,vendor_id,material_type_id,slug,name) values('filament',$1,$2,$3,$4) returning id", [
      vendor,
      type,
      `ms-material-${randomUUID()}`,
      "PLA",
    ])
  ).rows[0]!.id;
  return { id, vendor, type };
}

describe("MasterServicesService", () => {
  const users: string[] = [];
  const services: string[] = [];
  let mat: Awaited<ReturnType<typeof material>>;
  let api: MasterServicesService;
  beforeAll(async () => {
    api = new MasterServicesService(new MasterServicesRepository(pool), new CatalogReadRepository(pool));
    mat = await material();
  });
  afterAll(async () => {
    if (services.length > 0) await pool.query("delete from master_services where id=any($1::uuid[])", [services]);
    if (users.length > 0) await pool.query("delete from users where id=any($1::uuid[])", [users]);
    await pool.query("delete from materials where id=$1", [mat.id]);
    await pool.query("delete from material_types where id=$1", [mat.type]);
    await pool.query("delete from vendors where id=$1", [mat.vendor]);
  });

  it("preserves validation, ownership, material replacement, partial ranges and pagination", async () => {
    const owner = await user("owner");
    const stranger = await user("stranger");
    users.push(owner, stranger);
    await expect(api.create(UserId(owner), { title: "x", technology: "fdm", priceMinMinor: 20, priceMaxMinor: 10 })).rejects.toMatchObject({ status: 400 });
    const created = (await api.create(UserId(owner), {
      title: " FDM ",
      technology: "fdm",
      priceMinMinor: 1000,
      priceMaxMinor: 2000,
      leadTimeDaysMin: 1,
      leadTimeDaysMax: 3,
      materialIds: [mat.id],
    })) as { id: string; material_ids: readonly string[] };
    services.push(created.id);
    expect(created.material_ids).toEqual([mat.id]);
    await expect(api.update(UserId(stranger), created.id, { title: "hijack" })).rejects.toMatchObject({ status: 403 });
    const updated = (await api.update(UserId(owner), created.id, { priceMaxMinor: 5000, materialIds: [] })) as { price_max_minor: number; material_ids: readonly string[] };
    expect(updated.price_max_minor).toBe(5000);
    expect(updated.material_ids).toEqual([]);
    const list = (await api.list(owner, { limit: "1", offset: "0" })) as { services: unknown[]; limit: number; offset: number; has_more: boolean };
    expect(list).toMatchObject({ limit: 1, offset: 0, has_more: false });
    expect(list.services).toHaveLength(1);
    await expect(api.update(UserId(owner), created.id, { priceMinMinor: 6000 })).rejects.toMatchObject({ status: 400 });
    await expect(api.detail("not-a-uuid")).rejects.toMatchObject({ status: 404 });
    await expect(api.create(UserId(owner), { title: "x", technology: "fdm", materialIds: [randomUUID()] })).rejects.toMatchObject({ status: 422 });
    await expect(api.delete(UserId(owner), created.id)).resolves.toEqual({ ok: true });
    await expect(api.detail(created.id)).rejects.toMatchObject({ status: 404 });
  });
});
