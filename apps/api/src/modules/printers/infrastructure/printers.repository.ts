import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import type {
  CreateOwnedPrinterInput,
  EnrollOwnedPrinterInput,
  OwnedUserPrinter,
  PrinterDeviceContext,
  PrinterEnrollmentTarget,
  PrinterOwnerPort,
  PrinterProfileReadPort,
  PrinterQueryExecutor,
  PrinterRelayPort,
  ProfilePrinterSummary,
  PrusaPrinterProjection,
  PrinterJsonValue,
} from "../public/index.ts";
import type { PrinterRow } from "./serialize.ts";

export interface CommunityFirmwareRow {
  readonly id: string;
  readonly printer_id: string | null;
  readonly model: string;
  readonly author: string;
  readonly git_url: string;
  readonly verified: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface PrinterReportRow {
  readonly id: string;
  readonly printer_id: string;
  readonly field: string;
  readonly note: string | null;
  readonly proposed_value: PrinterJsonValue;
  readonly reporters: string[];
  readonly votes: number;
  readonly status: "pending" | "approved" | "rejected";
  readonly source: string;
  readonly confidence: string;
  readonly resolved_by: string | null;
  readonly resolved_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PrusaConnectionRow {
  readonly id: string;
  readonly api_key_enc: Buffer;
  readonly status: string;
  readonly last_synced_at: string | null;
  readonly last_error: string | null;
}

const USER_PRINTER_COLUMNS = `id, user_id, printer_id, catalog_printer_id, brand, model, build_volume,
  nozzle_mm, kinematics, link_source, lan_endpoint, verified, is_primary, connection_mode,
  connection_id, external_ref, status, agent_id, firmware_class, last_seen_at, capabilities,
  config_fingerprint, created_at`;

function executor(pool: Pool, override?: PrinterQueryExecutor): PrinterQueryExecutor {
  return override ?? pool;
}

@Injectable()
export class PrintersRepository implements PrinterOwnerPort, PrinterProfileReadPort, PrinterRelayPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  query<R extends QueryResultRow>(text: string, values: readonly unknown[] = [], tx?: PrinterQueryExecutor) {
    return executor(this.pool, tx).query<R>(text, values);
  }

  async countByUser(userId: UserIdType): Promise<number> {
    const result = await this.pool.query<{ count: string }>(`select count(*) as count from user_printers where user_id = $1`, [userId]);
    return Number(result.rows[0]!.count);
  }

  async listByUser(userId: UserIdType): Promise<readonly ProfilePrinterSummary[]> {
    const result = await this.pool.query<ProfilePrinterSummary>(
      `select id, printer_id, catalog_printer_id, brand, model, build_volume, nozzle_mm,
              kinematics, link_source, lan_endpoint, verified, is_primary, created_at
       from user_printers where user_id = $1 order by is_primary desc, created_at`,
      [userId],
    );
    return result.rows;
  }

  async listOwned(userId: UserIdType, tx?: PrinterQueryExecutor): Promise<readonly OwnedUserPrinter[]> {
    const result = await this.query<OwnedUserPrinter>(`select ${USER_PRINTER_COLUMNS} from user_printers where user_id = $1 order by created_at desc`, [userId], tx);
    return result.rows;
  }

  async authorizedDeviceIds(agentId: string, requestedDeviceIds: readonly string[] | undefined, tx: PrinterQueryExecutor): Promise<readonly string[]> {
    const result = await tx.query<{ id: string }>(
      `select id::text from user_printers
       where agent_id=$1${requestedDeviceIds === undefined ? "" : " and id::text=any($2::text[])"}
       order by id`,
      requestedDeviceIds === undefined ? [agentId] : [agentId, requestedDeviceIds],
    );
    return result.rows.map((row) => row.id);
  }

  async isDeviceAuthorized(deviceId: string, agentId: string, tx: PrinterQueryExecutor): Promise<boolean> {
    const result = await tx.query(`select 1 from user_printers where id::text=$1 and agent_id=$2`, [deviceId, agentId]);
    return result.rowCount === 1;
  }

  async recordDeviceHeartbeat(deviceId: string, agentId: string, status: string, tx: PrinterQueryExecutor): Promise<boolean> {
    const result = await tx.query(`update user_printers set last_seen_at=now(),status=$3 where id::text=$1 and agent_id=$2`, [deviceId, agentId, status]);
    return result.rowCount === 1;
  }

  async catalogPrinterExists(printerId: string, tx?: PrinterQueryExecutor): Promise<boolean> {
    const result = await this.query(`select 1 from printers where id = $1`, [printerId], tx);
    return result.rowCount === 1;
  }

  async findById(printerId: string, tx?: PrinterQueryExecutor): Promise<OwnedUserPrinter | null> {
    const result = await this.query<OwnedUserPrinter>(`select ${USER_PRINTER_COLUMNS} from user_printers where id = $1`, [printerId], tx);
    return result.rows[0] ?? null;
  }

  async findOwner(printerId: string, tx?: PrinterQueryExecutor): Promise<UserIdType | null> {
    const result = await this.query<{ user_id: string }>(`select user_id from user_printers where id = $1`, [printerId], tx);
    return result.rows[0] === undefined ? null : UserId(result.rows[0].user_id);
  }

  getDeviceOwner(deviceId: string, tx?: PrinterQueryExecutor): Promise<UserIdType | null> {
    return this.findOwner(deviceId, tx);
  }

  async create(userId: UserIdType, input: CreateOwnedPrinterInput, tx?: PrinterQueryExecutor): Promise<OwnedUserPrinter> {
    const target = executor(this.pool, tx);
    const isPrimary = input.isPrimary ?? (await target.query<{ count: string }>(`select count(*) as count from user_printers where user_id = $1`, [userId])).rows[0]?.count === "0";
    const result = await this.query<OwnedUserPrinter>(
      `insert into user_printers
         (user_id, printer_id, catalog_printer_id, brand, model, build_volume, nozzle_mm, kinematics,
          link_source, verified, is_primary, lan_endpoint, connection_mode, connection_id, external_ref,
          status, agent_id, firmware_class, last_seen_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               case when $17::uuid is null then null else now() end)
       returning ${USER_PRINTER_COLUMNS}`,
      [
        userId,
        input.printerId,
        input.catalogPrinterId,
        input.brand,
        input.model,
        input.buildVolume === null ? null : JSON.stringify(input.buildVolume),
        input.nozzleMm,
        input.kinematics,
        input.linkSource,
        input.verified,
        isPrimary,
        input.lanEndpoint,
        input.connectionMode,
        input.connectionId ?? null,
        input.externalRef ?? null,
        input.status ?? null,
        input.agentId ?? null,
        input.firmwareClass ?? null,
      ],
      tx,
    );
    return result.rows[0]!;
  }

  async update(printerId: string, userId: UserIdType, values: Readonly<Record<string, unknown>>, tx?: PrinterQueryExecutor): Promise<OwnedUserPrinter | null> {
    const allowed = new Set([
      "brand",
      "model",
      "nozzle_mm",
      "build_volume",
      "kinematics",
      "is_primary",
      "lan_endpoint",
      "connection_mode",
      "capabilities",
      "config_fingerprint",
      "status",
    ]);
    const entries = Object.entries(values).filter(([key]) => allowed.has(key));
    if (entries.length === 0) return this.findById(printerId, tx);
    const run = async (client: PrinterQueryExecutor): Promise<OwnedUserPrinter | null> => {
      if (values.is_primary === true) await client.query(`update user_printers set is_primary = false where user_id = $1`, [userId]);
      const params: unknown[] = [printerId, userId];
      const sets = entries.map(([key, value]) => {
        params.push(key === "build_volume" || key === "capabilities" ? JSON.stringify(value) : value);
        return `${key} = $${params.length}`;
      });
      const result = await client.query<OwnedUserPrinter>(`update user_printers set ${sets.join(", ")} where id = $1 and user_id = $2 returning ${USER_PRINTER_COLUMNS}`, params);
      return result.rows[0] ?? null;
    };
    if (tx !== undefined) return run(tx);
    return this.transaction(run);
  }

  async delete(printerId: string, userId: UserIdType, tx?: PrinterQueryExecutor): Promise<boolean> {
    const target = executor(this.pool, tx);
    const removed = await target.query(`delete from user_printers where id = $1 and user_id = $2`, [printerId, userId]);
    const remaining = await target.query(`select 1 from user_printers where user_id = $1 limit 1`, [userId]);
    return (removed.rowCount ?? 0) > 0 && (remaining.rowCount ?? 0) > 0;
  }

  async compareAndSetAgent(printerId: string, expectedAgentId: string | null, nextAgentId: string | null, tx?: PrinterQueryExecutor): Promise<OwnedUserPrinter | null> {
    const result = await this.query<OwnedUserPrinter>(
      `update user_printers set agent_id = $3, last_seen_at = case when $3::uuid is null then last_seen_at else now() end,
         connection_mode = case when $3::uuid is null then connection_mode else 'managed-bridge' end
       where id = $1 and agent_id is not distinct from $2::uuid returning ${USER_PRINTER_COLUMNS}`,
      [printerId, expectedAgentId, nextAgentId],
      tx,
    );
    return result.rows[0] ?? null;
  }

  async enroll(tx: PrinterQueryExecutor, input: EnrollOwnedPrinterInput): Promise<OwnedUserPrinter> {
    const isPrimary = (await tx.query<{ count: string }>(`select count(*) as count from user_printers where user_id = $1`, [input.userId])).rows[0]?.count === "0";
    if (input.printerId !== undefined) {
      const linked = await this.query<OwnedUserPrinter>(
        `update user_printers set agent_id = $3, last_seen_at = now(), connection_mode = 'managed-bridge'
         where id = $1 and user_id = $2 returning ${USER_PRINTER_COLUMNS}`,
        [input.printerId, input.userId, input.agentId],
        tx,
      );
      if (linked.rows[0] !== undefined) return linked.rows[0];
    }
    return this.create(
      input.userId,
      {
        printerId: null,
        catalogPrinterId: null,
        brand: input.brand,
        model: input.model,
        buildVolume: null,
        nozzleMm: null,
        kinematics: null,
        linkSource: "agent",
        verified: input.verified ?? true,
        isPrimary,
        lanEndpoint: null,
        connectionMode: "managed-bridge",
        agentId: input.agentId,
        firmwareClass: input.firmwareClass,
      },
      tx,
    );
  }

  createManagedDevice(tx: PrinterQueryExecutor, input: EnrollOwnedPrinterInput): Promise<OwnedUserPrinter> {
    return this.enroll(tx, input);
  }

  async linkAgent(tx: PrinterQueryExecutor, deviceId: string, agentId: string): Promise<OwnedUserPrinter | null> {
    const result = await this.query<OwnedUserPrinter>(
      `update user_printers set agent_id = $2, last_seen_at = now(), connection_mode = 'managed-bridge'
       where id = $1 returning ${USER_PRINTER_COLUMNS}`,
      [deviceId, agentId],
      tx,
    );
    return result.rows[0] ?? null;
  }

  async touchByAgent(printerId: string, agentId: string, tx?: PrinterQueryExecutor): Promise<UserIdType | null> {
    const result = await this.query<{ user_id: string }>(
      `update user_printers set last_seen_at = now() where id = $1 and agent_id = $2 returning user_id`,
      [printerId, agentId],
      tx,
    );
    return result.rows[0] === undefined ? null : UserId(result.rows[0].user_id);
  }

  async getDeviceCommandContext(deviceId: string, tx?: PrinterQueryExecutor): Promise<PrinterDeviceContext | null> {
    const result = await this.query<PrinterDeviceContext>(
      `select connection_mode as "connectionMode", link_source as "linkSource", agent_id as "agentId",
              last_seen_at as "deviceLastSeenAt", capabilities, config_fingerprint as "configFingerprint",
              printer_id as "printerId", build_volume as "buildVolume"
       from user_printers where id = $1`,
      [deviceId],
      tx,
    );
    return result.rows[0] ?? null;
  }

  getDevicePrintContext(deviceId: string, tx?: PrinterQueryExecutor): Promise<PrinterDeviceContext | null> {
    return this.getDeviceCommandContext(deviceId, tx);
  }

  async getEnrollmentTarget(ownerId: UserIdType, deviceId: string, tx?: PrinterQueryExecutor): Promise<PrinterEnrollmentTarget | null> {
    const result = await this.query<PrinterEnrollmentTarget>(
      `select id, brand, model, firmware_class as "firmwareClass", agent_id as "agentId"
       from user_printers where id = $1 and user_id = $2`,
      [deviceId, ownerId],
      tx,
    );
    return result.rows[0] ?? null;
  }

  async getAgentIdForOwnedDevice(deviceId: string, ownerId: UserIdType, tx?: PrinterQueryExecutor): Promise<string | null> {
    return (await this.getEnrollmentTarget(ownerId, deviceId, tx))?.agentId ?? null;
  }

  async setConfigFingerprintIfEmpty(printerId: string, agentId: string, fingerprint: string, tx?: PrinterQueryExecutor): Promise<boolean> {
    const result = await this.query(
      `update user_printers set config_fingerprint = $2, config_fingerprint_source = 'agent', config_fingerprint_updated_at = now()
       where id = $1 and config_fingerprint is null and agent_id = $3`,
      [printerId, fingerprint, agentId],
      tx,
    );
    return (result.rowCount ?? 0) > 0;
  }

  communityFirmware(where: string, values: readonly unknown[]) {
    return this.pool.query<CommunityFirmwareRow>(
      `select id, printer_id, model, author, git_url, verified, created_at, updated_at
       from community_firmware ${where} order by created_at desc limit $${values.length - 1} offset $${values.length}`,
      values as unknown[],
    );
  }

  createCommunityFirmware(values: readonly unknown[]) {
    return this.pool.query<CommunityFirmwareRow>(
      `insert into community_firmware (printer_id, model, author, git_url) values ($1,$2,$3,$4)
       on conflict (git_url) do nothing returning id, printer_id, model, author, git_url, verified, created_at, updated_at`,
      values as unknown[],
    );
  }

  updateCommunityFirmware(id: string, sets: readonly string[], values: readonly unknown[]) {
    return this.pool.query<CommunityFirmwareRow>(
      `update community_firmware set ${sets.join(", ")}, updated_at = now() where id = $${values.length + 1}
       returning id, printer_id, model, author, git_url, verified, created_at, updated_at`,
      [...values, id],
    );
  }

  deleteCommunityFirmware(id: string) {
    return this.pool.query(`delete from community_firmware where id = $1 returning id`, [id]);
  }

  catalogPrinters() {
    return this.pool.query<{
      id: string;
      slug: string;
      brand: string;
      model: string;
      aliases: string[];
      kinematics: string | null;
      build_volume_x: string | null;
      build_volume_y: string | null;
      build_volume_z: string | null;
      moonraker: boolean | null;
      lan_mode: boolean | null;
      status: string | null;
    }>(`select id, slug, brand, model, coalesce(aliases, '{}') as aliases, kinematics,
              build_volume_x, build_volume_y, build_volume_z, moonraker, lan_mode, status
       from printers order by brand, model`);
  }

  findPrinter(slugOrId: string, tx?: PrinterQueryExecutor, lock = false) {
    return this.query<PrinterRow>(`select * from printers where id::text = $1 or slug = $1${lock ? " for update" : ""}`, [slugOrId], tx);
  }

  findPrinterBySlug(slug: string) {
    return this.pool.query<PrinterRow>(`select * from printers where slug = $1`, [slug]);
  }

  prusaConnection(userId: UserIdType) {
    return this.pool.query<PrusaConnectionRow>(
      `select id, api_key_enc, status, last_synced_at, last_error
       from printer_connections where user_id = $1 and provider = 'prusa_connect'`,
      [userId],
    );
  }

  upsertPrusaConnection(userId: UserIdType, encrypted: Buffer) {
    return this.pool.query<{ id: string }>(
      `insert into printer_connections (user_id, provider, api_key_enc, status, last_synced_at)
       values ($1, 'prusa_connect', $2, 'active', now())
       on conflict (user_id, provider) do update set api_key_enc=excluded.api_key_enc,status='active',last_error=null,last_synced_at=now(),updated_at=now()
       returning id`,
      [userId, encrypted],
    );
  }

  updatePrusaConnection(id: string, status: "active" | "error", lastError: string | null) {
    return this.pool.query(
      `update printer_connections set status=$2,last_error=$3,last_synced_at=case when $2='active' then now() else last_synced_at end,updated_at=now() where id=$1`,
      [id, status, lastError],
    );
  }

  disconnectPrusa(userId: UserIdType) {
    return this.pool.query(`delete from printer_connections where user_id=$1 and provider='prusa_connect'`, [userId]);
  }

  async applyPrusaPrinters(
    userId: UserIdType,
    connectionId: string,
    printers: readonly PrusaPrinterProjection[],
    matches: readonly (string | null)[],
    provided?: PrinterQueryExecutor,
  ): Promise<number> {
    const apply = async (tx: PrinterQueryExecutor) => {
      const current = await tx.query<{ count: string }>(`select count(*) as count from user_printers where user_id=$1`, [userId]);
      let hasAny = current.rows[0]?.count !== "0";
      let matched = 0;
      for (const [index, printer] of printers.entries()) {
        const printerId = matches[index] ?? null;
        if (printerId !== null) matched += 1;
        await tx.query(
          `insert into user_printers (user_id,printer_id,brand,model,link_source,verified,is_primary,connection_id,external_ref,status)
           values ($1,$2,'Prusa',$3,'connector',true,$4,$5,$6,$7)
           on conflict (connection_id,external_ref) where connection_id is not null do update set
             printer_id=excluded.printer_id,brand=excluded.brand,model=excluded.model,status=excluded.status,verified=true`,
          [userId, printerId, printer.modelName || printer.name || "Unknown", !hasAny, connectionId, printer.externalRef, printer.state],
        );
        hasAny = true;
      }
      return matched;
    };
    return provided === undefined ? this.transaction(apply) : apply(provided);
  }

  reportCount(userId: UserIdType) {
    return this.pool.query<{ count: string }>(`select count(*) from printer_reports where $1 = any(reporters) and created_at > now() - interval '24 hours'`, [userId]);
  }

  upsertReport(printerId: string, field: string, note: string | null, proposedValue: unknown, userId: UserIdType) {
    return this.pool.query<PrinterReportRow>(
      `insert into printer_reports (printer_id,field,note,proposed_value,reporters,votes)
       values ($1,$2,$3,$4,array[$5]::uuid[],1)
       on conflict (printer_id,field) where status='pending' do update set
         votes=printer_reports.votes+case when $5=any(printer_reports.reporters) then 0 else 1 end,
         reporters=case when $5=any(printer_reports.reporters) then printer_reports.reporters else printer_reports.reporters||$5::uuid end,
         note=coalesce(excluded.note,printer_reports.note),proposed_value=coalesce(excluded.proposed_value,printer_reports.proposed_value),updated_at=now()
       returning *`,
      [printerId, field, note, proposedValue === null ? null : JSON.stringify(proposedValue), userId],
    );
  }

  listReports(status: string) {
    return this.pool.query<PrinterReportRow & { slug: string; brand: string; model: string }>(
      `select r.*,p.slug,p.brand,p.model from printer_reports r join printers p on p.id=r.printer_id
       where r.status=$1 order by r.votes desc,r.created_at asc`,
      [status],
    );
  }

  resolveReport(reportId: string, userId: UserIdType, status: "approved" | "rejected", tx?: PrinterQueryExecutor) {
    return this.query<PrinterReportRow>(
      `update printer_reports set status=$3,resolved_by=$2,resolved_at=now(),updated_at=now()
       where id=$1 and status='pending' returning *`,
      [reportId, userId, status],
      tx,
    );
  }

  lockReport(reportId: string, tx: PrinterQueryExecutor) {
    return this.query<PrinterReportRow>(`select * from printer_reports where id=$1 and status='pending' for update`, [reportId], tx);
  }
}
