import type { QueryResult, QueryResultRow } from "pg";

export interface PrinterOwnerQuery {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

export async function countOwnedUserPrinters(query: PrinterOwnerQuery, userId: string): Promise<number> {
  const result = await query.query<{ count: string }>(`select count(*) as count from user_printers where user_id = $1`, [userId]);
  return Number(result.rows[0]?.count ?? 0);
}

export interface CreateOwnedUserPrinterInput {
  readonly userId: string;
  readonly printerId: string | null;
  readonly catalogPrinterId: string | null;
  readonly brand: string;
  readonly model: string;
  readonly buildVolume: unknown;
  readonly nozzleMm: number | null;
  readonly kinematics: string | null;
  readonly linkSource: string;
  readonly verified: boolean;
  readonly lanEndpoint: string | null;
  readonly connectionMode: string;
}

export async function createOwnedUserPrinter<T extends QueryResultRow = QueryResultRow>(query: PrinterOwnerQuery, input: CreateOwnedUserPrinterInput): Promise<T> {
  const isPrimary = (await countOwnedUserPrinters(query, input.userId)) === 0;
  const result = await query.query<T>(
    `insert into user_printers
       (user_id, printer_id, brand, model, build_volume, nozzle_mm, kinematics, link_source,
        verified, is_primary, lan_endpoint, connection_mode, catalog_printer_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     returning *`,
    [
      input.userId,
      input.printerId,
      input.brand,
      input.model,
      input.buildVolume,
      input.nozzleMm,
      input.kinematics,
      input.linkSource,
      input.verified,
      isPrimary,
      input.lanEndpoint,
      input.connectionMode,
      input.catalogPrinterId,
    ],
  );
  return result.rows[0]!;
}

const MUTABLE_COLUMNS = new Set(["brand", "model", "nozzle_mm", "build_volume", "kinematics"]);

export async function updateOwnedUserPrinter<T extends QueryResultRow = QueryResultRow>(
  query: PrinterOwnerQuery,
  printerId: string,
  userId: string,
  values: Readonly<Record<string, unknown>>,
): Promise<T | null> {
  const sets: string[] = [];
  const parameters: unknown[] = [printerId];
  for (const [column, value] of Object.entries(values)) {
    if (!MUTABLE_COLUMNS.has(column)) continue;
    parameters.push(value);
    sets.push(`${column} = $${parameters.length}`);
  }
  if (values.is_primary === true) {
    await query.query(`update user_printers set is_primary = false where user_id = $1`, [userId]);
    parameters.push(true);
    sets.push(`is_primary = $${parameters.length}`);
  }
  if (sets.length === 0) return null;
  const result = await query.query<T>(`update user_printers set ${sets.join(", ")} where id = $1 and user_id = $${parameters.length + 1} returning *`, [...parameters, userId]);
  return result.rows[0] ?? null;
}

export async function deleteOwnedUserPrinter(query: PrinterOwnerQuery, printerId: string, userId: string): Promise<number> {
  await query.query(`delete from user_printers where id = $1 and user_id = $2`, [printerId, userId]);
  return countOwnedUserPrinters(query, userId);
}

export interface EnrollOwnedPrinterInput {
  readonly userId: string;
  readonly brand: string;
  readonly model: string;
  readonly firmwareClass: string | null;
  readonly agentId: string;
}

export async function enrollOwnedPrinter(query: PrinterOwnerQuery, input: EnrollOwnedPrinterInput): Promise<string> {
  const isPrimary = (await countOwnedUserPrinters(query, input.userId)) === 0;
  const result = await query.query<{ id: string }>(
    `insert into user_printers
       (user_id, brand, model, link_source, verified, is_primary, firmware_class, agent_id, last_seen_at, connection_mode)
     values ($1, $2, $3, 'agent', true, $4, $5, $6, now(), 'managed-bridge') returning id`,
    [input.userId, input.brand, input.model, isPrimary, input.firmwareClass, input.agentId],
  );
  return result.rows[0]!.id;
}

export async function recoverOwnedPrinterAgent(query: PrinterOwnerQuery, printerId: string, agentId: string): Promise<void> {
  await query.query(`update user_printers set agent_id = $2, last_seen_at = now(), connection_mode = 'managed-bridge' where id = $1`, [printerId, agentId]);
}

export async function setOwnedPrinterFingerprintIfEmpty(query: PrinterOwnerQuery, printerId: string, agentId: string, fingerprint: string): Promise<void> {
  await query.query(
    `update user_printers
       set config_fingerprint = $2, config_fingerprint_source = 'agent', config_fingerprint_updated_at = now()
     where id = $1 and config_fingerprint is null and agent_id = $3`,
    [printerId, fingerprint, agentId],
  );
}

export interface OwnedPrinterSliceContext {
  readonly id: string;
  readonly user_id: string;
  readonly agent_id: string | null;
  readonly config_fingerprint: string | null;
  readonly build_volume: unknown;
}

export async function findOwnedPrinterSliceContext(query: PrinterOwnerQuery, printerId: string): Promise<OwnedPrinterSliceContext | null> {
  return (
    (await query.query<OwnedPrinterSliceContext>(`select id, user_id, agent_id, config_fingerprint, build_volume from user_printers where id = $1`, [printerId])).rows[0] ?? null
  );
}

export interface UpsertConnectorPrinterInput {
  readonly userId: string;
  readonly printerId: string | null;
  readonly model: string;
  readonly isPrimary: boolean;
  readonly connectionId: string;
  readonly externalRef: string;
  readonly status: string;
}

export async function upsertOwnedConnectorPrinter(query: PrinterOwnerQuery, input: UpsertConnectorPrinterInput): Promise<void> {
  await query.query(
    `insert into user_printers
       (user_id, printer_id, brand, model, link_source, verified, is_primary, connection_id, external_ref, status)
     values ($1, $2, 'Prusa', $3, 'connector', true, $4, $5, $6, $7)
     on conflict (connection_id, external_ref) where connection_id is not null do update set
       printer_id = excluded.printer_id, brand = excluded.brand, model = excluded.model,
       status = excluded.status, verified = true`,
    [input.userId, input.printerId, input.model, input.isPrimary, input.connectionId, input.externalRef, input.status],
  );
}
