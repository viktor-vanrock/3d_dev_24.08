import type { QueryResult, QueryResultRow } from "pg";
import type { CatalogPublicMaterial } from "../public/catalog-public.ts";

export interface CatalogPublicQuery {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>>;
}

export async function catalogMaterialExists(query: CatalogPublicQuery, id: string): Promise<boolean> {
  return (await query.query(`select 1 from materials where id = $1`, [id])).rowCount !== 0;
}

export async function catalogPublicMaterial(query: CatalogPublicQuery, id: string): Promise<CatalogPublicMaterial | null> {
  const row = (
    await query.query<{
      id: string;
      slug: string;
      name: string;
      vendor_id: string;
      vendor_slug: string;
      vendor_name: string;
    }>(
      `select m.id, m.slug, m.name, v.id as vendor_id, v.slug as vendor_slug, v.name as vendor_name
       from materials m join vendors v on v.id = m.vendor_id where m.id = $1`,
      [id],
    )
  ).rows[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        slug: row.slug,
        name: row.name,
        vendor: { id: row.vendor_id, slug: row.vendor_slug, name: row.vendor_name },
      };
}
