import { describe, expect, it } from "vitest";
import { pool } from "../../../../db/client.ts";
import { runEntityResolution } from "./run.ts";

interface TestFixture {
  vendorSlug: string;
  machineIds: string[];
  candidateIds: string[];
}

async function cleanup(fixture: TestFixture): Promise<void> {
  if (fixture.candidateIds.length > 0) {
    await pool.query(`delete from machine_candidates where id = any($1)`, [fixture.candidateIds]);
  }
  if (fixture.machineIds.length > 0) {
    // MF-2039: runEntityResolution теперь заводит machine-саб как побочный эффект — без этой
    // строки прогон тестов копил бы сиротские communities-ряды в БД (нет FK на subject_id, ничего
    // не упадёт, но и не почистится само).
    await pool.query(`delete from communities where kind = 'machine' and subject_id = any($1)`, [fixture.machineIds]);
    await pool.query(`delete from machines where id = any($1)`, [fixture.machineIds]);
  }
  await pool.query(`delete from communities where kind = 'vendor' and subject_id = (select id from vendors where slug = $1)`, [fixture.vendorSlug]);
  await pool.query(`delete from vendors where slug = $1`, [fixture.vendorSlug]);
}

async function insertVendor(name: string): Promise<{ id: string; slug: string }> {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const res = await pool.query<{ id: string }>(`insert into vendors (slug, name) values ($1, $2) returning id`, [slug, name]);
  return { id: res.rows[0]!.id, slug };
}

async function insertCandidate(source: string, sourceUrl: string | null, raw: unknown, confidence: number | null): Promise<string> {
  const externalRef = `ref-${Math.random().toString(36).slice(2)}`;
  const res = await pool.query<{ id: string }>(
    `insert into machine_candidates (source, source_url, external_ref, raw, status, confidence)
     values ($1, $2, $3, $4::jsonb, 'pending', $5) returning id`,
    [source, sourceUrl, externalRef, JSON.stringify(raw), confidence],
  );
  return res.rows[0]!.id;
}

describe("runEntityResolution", () => {
  it("merges a candidate under a known RU alias into the existing canonical machine (dedup scenario)", async () => {
    const vendor = await insertVendor(`Test Vendor Alias ${Date.now()}`);
    const fixture: TestFixture = { vendorSlug: vendor.slug, machineIds: [], candidateIds: [] };
    try {
      const machine = await pool.query<{ id: string }>(
        `insert into machines (craft, kind, vendor_id, model, aliases, specs, field_provenance, status)
         values ('3d_printing', 'fdm_printer', $1, 'SV06 Plus', array['СВ06 Плюс'], '{}'::jsonb, '{}'::jsonb, 'active')
         returning id`,
        [vendor.id],
      );
      fixture.machineIds.push(machine.rows[0]!.id);

      const candidateId = await insertCandidate(
        "sovol3d-store",
        "https://www.sovol3d.com/products/sv06-plus",
        { vendor: vendor.slug, model: "СВ06 Плюс", specs: { kinematics: "corexy" } },
        0.9,
      );
      fixture.candidateIds.push(candidateId);

      const result = await runEntityResolution({ ids: [candidateId] });
      expect(result).toMatchObject({ processed: 1, mergedClean: 1, createdMachines: 0 });

      const updatedMachine = await pool.query<{ specs: { kinematics?: string }; status: string }>(`select specs, status from machines where id = $1`, [machine.rows[0]!.id]);
      expect(updatedMachine.rows[0]!.specs.kinematics).toBe("corexy");
      expect(updatedMachine.rows[0]!.status).toBe("active");

      const updatedCandidate = await pool.query<{ status: string; matched_machine_id: string }>(`select status, matched_machine_id from machine_candidates where id = $1`, [
        candidateId,
      ]);
      expect(updatedCandidate.rows[0]).toEqual({ status: "merged", matched_machine_id: machine.rows[0]!.id });
    } finally {
      await cleanup(fixture);
    }
  });

  it("creates a new canonical machine when no existing machine matches and specs are plausible", async () => {
    const vendor = await insertVendor(`Test Vendor New ${Date.now()}`);
    const fixture: TestFixture = { vendorSlug: vendor.slug, machineIds: [], candidateIds: [] };
    try {
      const candidateId = await insertCandidate(
        "sovol3d-store",
        "https://www.sovol3d.com/products/brand-new",
        { vendor: vendor.slug, model: "Brand New Printer", specs: { build_volume: { x: 220, y: 220, z: 250 } } },
        0.8,
      );
      fixture.candidateIds.push(candidateId);

      const result = await runEntityResolution({ ids: [candidateId] });
      expect(result).toMatchObject({ processed: 1, createdMachines: 1 });

      const created = await pool.query<{ id: string; model: string; status: string }>(`select id, model, status from machines where vendor_id = $1`, [vendor.id]);
      expect(created.rows).toHaveLength(1);
      expect(created.rows[0]!.model).toBe("Brand New Printer");
      expect(created.rows[0]!.status).toBe("active");
      fixture.machineIds.push(created.rows[0]!.id);

      // MF-2039: "лениво создаются системой" реализовано впервые — вендор и станок из ЛЮБОГО
      // источника (не только курируемого сида) должны автоматически получить свой саб.
      const vendorCommunity = await pool.query(`select id, kind from communities where subject_id = $1`, [vendor.id]);
      expect(vendorCommunity.rows).toMatchObject([{ kind: "vendor" }]);
      const machineCommunity = await pool.query(`select id, kind from communities where subject_id = $1`, [created.rows[0]!.id]);
      expect(machineCommunity.rows).toMatchObject([{ kind: "machine" }]);
    } finally {
      await cleanup(fixture);
    }
  });

  it("quarantines an implausible new candidate instead of creating a canonical machine", async () => {
    const vendor = await insertVendor(`Test Vendor Implausible ${Date.now()}`);
    const fixture: TestFixture = { vendorSlug: vendor.slug, machineIds: [], candidateIds: [] };
    try {
      const candidateId = await insertCandidate(
        "sovol3d-store",
        null,
        { vendor: vendor.slug, model: "Absurd Printer", specs: { build_volume: { x: 220, y: 220, z: 25000 } } },
        0.8,
      );
      fixture.candidateIds.push(candidateId);

      const result = await runEntityResolution({ ids: [candidateId] });
      expect(result).toMatchObject({ processed: 1, quarantinedCandidates: 1, createdMachines: 0 });

      const created = await pool.query(`select id from machines where vendor_id = $1`, [vendor.id]);
      expect(created.rows).toHaveLength(0);

      const updatedCandidate = await pool.query<{ status: string; confidence: string }>(`select status, confidence from machine_candidates where id = $1`, [candidateId]);
      expect(updatedCandidate.rows[0]!.status).toBe("quarantined");
    } finally {
      await cleanup(fixture);
    }
  });

  it("does not silently overwrite a higher-priority field value on conflict — candidate stays pending for review", async () => {
    const vendor = await insertVendor(`Test Vendor Conflict ${Date.now()}`);
    const fixture: TestFixture = { vendorSlug: vendor.slug, machineIds: [], candidateIds: [] };
    try {
      const machine = await pool.query<{ id: string }>(
        `insert into machines (craft, kind, vendor_id, model, specs, field_provenance, status)
         values ('3d_printing', 'fdm_printer', $1, 'Conflict Printer',
           '{"max_nozzle_temp_c": 300}'::jsonb,
           '{"max_nozzle_temp_c": {"source": "sovol3d-store", "source_url": null, "ts": "2020-01-01T00:00:00.000Z", "confidence": 0.9}}'::jsonb,
           'active')
         returning id`,
        [vendor.id],
      );
      fixture.machineIds.push(machine.rows[0]!.id);

      // Lower-priority source (catalog-tier by default classification) proposes a conflicting value.
      const candidateId = await insertCandidate("some-catalog-aggregator", null, { vendor: vendor.slug, model: "Conflict Printer", specs: { max_nozzle_temp_c: 260 } }, 0.7);
      fixture.candidateIds.push(candidateId);

      const result = await runEntityResolution({ ids: [candidateId] });
      expect(result).toMatchObject({ processed: 1, mergedWithConflicts: 1 });

      const updatedMachine = await pool.query<{ specs: { max_nozzle_temp_c: number } }>(`select specs from machines where id = $1`, [machine.rows[0]!.id]);
      expect(updatedMachine.rows[0]!.specs.max_nozzle_temp_c).toBe(300); // не перезатёрто

      const updatedCandidate = await pool.query<{ status: string }>(`select status from machine_candidates where id = $1`, [candidateId]);
      expect(updatedCandidate.rows[0]!.status).toBe("pending"); // осталось в очереди ревью, не 'merged'
    } finally {
      await cleanup(fixture);
    }
  });

  it("leaves an ambiguous match pending with the match score as confidence, without merging", async () => {
    const vendor = await insertVendor(`Test Vendor Ambiguous ${Date.now()}`);
    const fixture: TestFixture = { vendorSlug: vendor.slug, machineIds: [], candidateIds: [] };
    try {
      const machine = await pool.query<{ id: string }>(
        `insert into machines (craft, kind, vendor_id, model, specs, field_provenance, status)
         values ('3d_printing', 'fdm_printer', $1, 'Ender 3 V2', '{}'::jsonb, '{}'::jsonb, 'active')
         returning id`,
        [vendor.id],
      );
      fixture.machineIds.push(machine.rows[0]!.id);

      const candidateId = await insertCandidate("some-catalog-aggregator", null, { vendor: vendor.slug, model: "Ender 3 V3" }, null);
      fixture.candidateIds.push(candidateId);

      const result = await runEntityResolution({ ids: [candidateId] });
      expect(result).toMatchObject({ processed: 1, ambiguousMatches: 1, mergedClean: 0, createdMachines: 0 });

      const updatedCandidate = await pool.query<{ status: string; matched_machine_id: string }>(`select status, matched_machine_id from machine_candidates where id = $1`, [
        candidateId,
      ]);
      expect(updatedCandidate.rows[0]!.status).toBe("pending");
      expect(updatedCandidate.rows[0]!.matched_machine_id).toBe(machine.rows[0]!.id);
    } finally {
      await cleanup(fixture);
    }
  });

  it("rejects a candidate whose raw payload has no usable vendor/model", async () => {
    const candidateId = await insertCandidate("sovol3d-store", null, { specs: {} }, null);
    try {
      const result = await runEntityResolution({ ids: [candidateId] });
      expect(result).toMatchObject({ processed: 1, invalidCandidates: 1 });

      const updated = await pool.query<{ status: string }>(`select status from machine_candidates where id = $1`, [candidateId]);
      expect(updated.rows[0]!.status).toBe("rejected");
    } finally {
      await pool.query(`delete from machine_candidates where id = $1`, [candidateId]);
    }
  });

  it("full-queue run (no ids) leaves candidates from unknown sources (e.g. apps/scout) untouched", async () => {
    // apps/scout (MF-623/627/720) — независимый пайплайн, тоже пишет в machine_candidates,
    // но своим raw-словарём (vendor_slug/model_name), который parseRaw здесь не понимает. Без
    // фильтра по KNOWN_SOURCES штатный (полноочередной, scripts/resolve-run.ts) режим забрал бы
    // и его 'pending'-строки, и отклонил как invalid — тихая порча чужой очереди.
    const scoutCandidateId = await insertCandidate("vendor_whitelist", null, { vendor_slug: "acme", model_name: "Some Scout Model" }, null);
    try {
      // Не проверяем result.processed — параллельно могут лежать чужие pending-кандидаты
      // известных источников (другие тесты/dev-данные); единственное, что важно здесь —
      // этот конкретный scout-кандидат full-queue режим не тронул.
      await runEntityResolution({ limit: 10_000 });

      const scoutAfter = await pool.query<{ status: string }>(`select status from machine_candidates where id = $1`, [scoutCandidateId]);
      expect(scoutAfter.rows[0]!.status).toBe("pending");
    } finally {
      await pool.query(`delete from machine_candidates where id = $1`, [scoutCandidateId]);
    }
  });
});
