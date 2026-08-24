import { describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { matchPrusaModel } from "./prusa-connect-match.ts";

// matchPrusaModel фиксирован на vendors.slug = 'prusa-research' (реальный слаг из
// scripts/import-machines-bootstrap.ts). Тест использует этот же вендор (заводит его, если
// в окружении пусто — CI/свежая БД) и добавляет СВОИ machines-строки с заведомо уникальным
// именем модели, чтобы не зависеть от состава реального каталога и не задеть прод-данные.
describe("matchPrusaModel", () => {
  it("matches Prusa Connect model strings against catalog aliases", async () => {
    const vendor = await pool.query<{ id: string }>(
      `insert into vendors (slug, name) values ('prusa-research', 'Prusa Research')
       on conflict (slug) do update set slug = excluded.slug
       returning id`,
    );
    const vendorId = vendor.rows[0]!.id;
    const suffix = Date.now();
    const modelA = `Prusa ZZZTEST${suffix}A`;
    const modelB = `Prusa ZZZTEST${suffix}B`;

    const inserted = await pool.query<{ id: string }>(
      `insert into machines (craft, kind, vendor_id, model, aliases, status)
       values ('3d_printing', 'fdm_printer', $1, $2, '{}', 'active'),
              ('3d_printing', 'fdm_printer', $1, $3, '{}', 'active')
       returning id`,
      [vendorId, modelA, modelB],
    );
    const [idA, idB] = inserted.rows.map((r) => r.id);

    try {
      const matchedA = await matchPrusaModel(`ZZZTEST${suffix}A`);
      const matchedB = await matchPrusaModel(`ZZZTEST${suffix}B+`); // "+" в стиле "MINI+"
      const unmatched = await matchPrusaModel(`NoSuchModel${suffix}`);

      expect(matchedA).toEqual(idA);
      expect(matchedB).toEqual(idB);
      expect(unmatched).toBeNull();
    } finally {
      await pool.query(`delete from machines where id = any($1::uuid[])`, [[idA, idB]]);
    }
  });
});
