import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { decodeJwt } from "jose";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { DeviceId, UserId, type DeviceId as DeviceIdType, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { PRINTER_OWNER_PORT, type OwnedUserPrinter, type PrinterOwnerPort } from "../../printers/public/index.ts";
import type { DeviceCommandResult, DeviceExternalPort, DeviceMetrics, DeviceOperatingStateInput, DeviceRole, DeviceSanctionsPort, DeviceShareResponse } from "../public/index.ts";
import type { DeviceIncidentEvent, DeviceIncidentEventReadPort, DeviceIncidentEventWritePort, DeviceQueryExecutor } from "../public/index.ts";
import type { DeviceControlCommand, DeviceShareRole, FirmwareClass } from "../domain/devices.ts";

const ENROLL_TTL_MS = 15 * 60 * 1000;
const FIRMWARE_BRAND: Record<FirmwareClass, string> = { klipper: "Klipper", octoprint: "OctoPrint", bambu: "Bambu Lab", prusa: "Prusa", creality: "Creality" };
const INCIDENT_COLUMNS =
  "id, device_id, owner_id, thread_id, event_type, dedupe_key, severity, status, occurrence_count, first_seen_at, last_seen_at, acknowledged_at, resolved_at, created_at, updated_at";

function hashCode(code: string): Buffer {
  return createHash("sha256").update(code).digest();
}

export interface AccessRow {
  readonly ownerId: UserIdType;
  readonly role: DeviceRole;
}
export interface CommandContext {
  readonly connectionMode: unknown;
  readonly linkSource: unknown;
  readonly agentId: string | null;
  readonly agentCertificateFingerprint: string | null;
  readonly deviceLastSeenAt: Date | string | null;
  readonly capabilities: unknown;
  readonly agentStatus: unknown;
  readonly agentRevokedAt: Date | string | null;
  readonly agentLastSeenAt: Date | string | null;
  readonly deviceStatus: unknown;
  readonly configFingerprint: string | null;
  readonly printerId: string | null;
  readonly buildVolume: unknown;
}
export interface CommandRow {
  id: string;
  correlation_id: string;
  device_id: string;
  command: DeviceControlCommand;
  command_seq: number;
  status: string;
  result: DeviceCommandResult | null;
  created_at: Date;
  acked_at: Date | null;
  actor_role: "owner" | "operator";
}
export interface TransferRow {
  id: string;
  device_id: string;
  file_name: string;
  size_bytes: number;
  sha256: string | null;
  start_print: boolean;
  kind: "gcode" | "printer_profile";
  status: string;
  next_seq: number;
  bytes_transferred: number;
  error_code: string | null;
  error_message: string | null;
  updated_at: Date;
}
export interface IncidentRow {
  id: string;
  device_id: string;
  owner_id: string;
  thread_id: string;
  event_type: string;
  dedupe_key: string;
  severity: string;
  status: string;
  occurrence_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
  acknowledged_at: Date | null;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
export interface PrintRequestRow {
  id: string;
  device_id: string;
  requested_by: string;
  slice_job_id: string;
  copies: number;
  idempotency_key: string;
  status: string;
  gcode_sha256: string | null;
  start_command_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}
export interface ProfileCommandRow {
  id: string;
  correlation_id: string;
  device_id: string;
  command: string;
  payload: Record<string, unknown>;
  status: string;
  result: DeviceCommandResult | null;
  created_at: Date;
  acked_at: Date | null;
}
export interface PublicDeviceStateRow {
  status: string | null;
  progress: string | null;
  job_id: string | null;
  metrics: DeviceMetrics | null;
  updated_at: Date | null;
}
export interface PublicTelemetryRow {
  recorded_at: Date;
  status: string | null;
  progress: string | null;
  metrics: DeviceMetrics | null;
}
export interface DeviceOperatingRow extends DeviceOperatingStateInput {
  readonly progress: string | null;
  readonly job_id: string | null;
  readonly metrics: DeviceMetrics;
  readonly seq: number;
  readonly last_seen_at: Date | null;
}

@Injectable()
export class DevicesRepository implements DeviceIncidentEventReadPort, DeviceIncidentEventWritePort, DeviceSanctionsPort {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(PRINTER_OWNER_PORT) private readonly printers: PrinterOwnerPort,
    @Optional() @Inject(RuntimeLogger) private readonly logger?: RuntimeLogger,
  ) {}

  async access(deviceId: DeviceIdType, userId: UserIdType): Promise<AccessRow | null> {
    const ownerId = await this.printers.findOwner(deviceId);
    if (ownerId === null) return null;
    if (ownerId === userId) return { ownerId, role: "owner" };
    const share = await this.pool.query<{ role: DeviceRole }>(`select role from device_shares where device_id = $1 and user_id = $2`, [deviceId, userId]);
    return share.rows[0] === undefined ? null : { ownerId, role: share.rows[0].role };
  }

  async createEnrollCode(
    ownerId: UserIdType,
    input: { firmwareClass: FirmwareClass | null; label: string | null; deviceId: DeviceIdType | null },
  ): Promise<{ id: string; code: string; expiresAt: Date }> {
    if (input.deviceId !== null) {
      const target = await this.printers.findById(input.deviceId);
      const share = await this.pool.query<{ role: string }>(`select role from device_shares where device_id = $1 and user_id = $2`, [input.deviceId, ownerId]);
      if (target === null || target.user_id !== ownerId || share.rows[0]?.role !== "owner" || target.agent_id === null || target.agent_id === undefined) throw new Error("recovery_target_not_found");
    }
    const code = randomBytes(20).toString("base64url");
    const expiresAt = new Date(Date.now() + ENROLL_TTL_MS);
    const result = await this.pool.query<{ id: string }>(
      `with created as (
         insert into device_enroll_codes (owner_id,code_hash,firmware_class,label,expires_at,device_id,credential_kind)
         values ($1,$2,$3,$4,$5,$6,case when $6::uuid is null then 'enrollment' else 'recovery' end) returning id,credential_kind
       ), audited as (
         insert into device_enrollment_audit(credential_id,owner_id,device_id,event_type,meta)
         select id,$1,$6,'credential.created',jsonb_build_object('credential_kind',credential_kind) from created
       ) select id from created`,
      [ownerId, hashCode(code), input.firmwareClass, input.label, expiresAt, input.deviceId],
    );
    return { id: result.rows[0]!.id, code, expiresAt };
  }

  async revokeEnrollCode(ownerId: UserIdType, id: string): Promise<boolean> {
    const result = await this.pool.query(`with revoked as (
      update device_enroll_codes set revoked_at=now() where id=$1 and owner_id=$2 and used_at is null and revoked_at is null returning id,device_id
    ), audited as (
      insert into device_enrollment_audit(credential_id,owner_id,device_id,event_type) select id,$2,device_id,'credential.revoked' from revoked
    ) select id from revoked`, [
      id,
      ownerId,
    ]);
    return result.rowCount === 1;
  }

  async redeemEnrollCode(
    code: string,
    version: string | undefined,
    requestId: string,
    external: Pick<DeviceExternalPort, "issueAgentCredential" | "issueGatewayCertificate">,
    csrPem?: string,
    credentialKind: "enrollment" | "recovery" = "enrollment",
  ): Promise<{
    agentId: string; deviceId: DeviceIdType; ownerId: UserIdType; credential?: string; expiresAt: string | null;
    certificate?: ReturnType<DeviceExternalPort["issueGatewayCertificate"]>;
  }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const claimed = await client.query<{ id: string; owner_id: string; firmware_class: FirmwareClass | null; label: string | null; device_id: string | null }>(
        `update device_enroll_codes set used_at=now() where code_hash=$1 and credential_kind=$2 and used_at is null and revoked_at is null and expires_at>now() returning id,owner_id,firmware_class,label,device_id`,
        [hashCode(code), credentialKind],
      );
      const enroll = claimed.rows[0];
      if (enroll === undefined) {
        const expired = await client.query(`select 1 from device_enroll_codes where code_hash=$1 and credential_kind=$2 and used_at is null and revoked_at is null and expires_at<=now()`, [
          hashCode(code), credentialKind,
        ]);
        throw new Error(expired.rowCount ? "enroll_code_expired" : "invalid_or_expired_code");
      }
      const ownerId = UserId(enroll.owner_id);
      const agent = await client.query<{ id: string }>(`insert into agents (owner_id,version,status,last_seen_at) values ($1,$2,'online',now()) returning id`, [
        ownerId,
        version ?? null,
      ]);
      const agentId = agent.rows[0]!.id;
      const certificate = csrPem === undefined ? undefined : external.issueGatewayCertificate(csrPem, agentId);
      if (certificate !== undefined) {
        await client.query(`update agents set relay_certificate_fingerprint_sha256=$2 where id=$1`, [agentId, certificate.fingerprintSha256]);
      }
      let existing = enroll.device_id === null ? null : await this.printers.findById(enroll.device_id, client);
      if (existing !== null) {
        if (existing.user_id !== ownerId || existing.agent_id === null || existing.agent_id === undefined) existing = null;
      }
      if (enroll.device_id !== null && existing === null) throw new Error("invalid_or_expired_code");
      if (existing?.agent_id !== null && existing?.agent_id !== undefined) {
        await client.query(`update agents set revoked_at=coalesce(revoked_at,now()),revoked_reason=coalesce(revoked_reason,'identity_rotated'),updated_at=now() where id=$1`, [existing.agent_id]);
      }
      const brand = existing?.brand ?? (enroll.firmware_class === null ? "Agent" : FIRMWARE_BRAND[enroll.firmware_class]);
      const model = existing?.model ?? enroll.label ?? "Agent printer";
      const enrolled = await this.printers.enroll(client, {
        userId: ownerId,
        ...(enroll.device_id === null ? {} : { printerId: enroll.device_id }),
        brand,
        model,
        agentId,
        firmwareClass: enroll.firmware_class,
        verified: true,
      });
      const deviceId = DeviceId(enrolled.id);
      await client.query(`insert into device_shares (device_id,user_id,role) values ($1,$2,'owner') on conflict (device_id,user_id) do update set role='owner',updated_at=now()`, [
        deviceId,
        ownerId,
      ]);
      await client.query(`insert into device_state (device_id,status) values ($1,'offline') on conflict (device_id) do update set status='offline',updated_at=now()`, [deviceId]);
      await client.query(`insert into device_audit_log (device_id,actor_user_id,action,meta) values ($1,$2,$3,$4)`, [
        deviceId,
        ownerId,
        enroll.device_id === null ? "device.enrolled" : "device.recovered",
        JSON.stringify({ agent_id: agentId, firmware_class: enroll.firmware_class, request_id: requestId, identity: certificate === undefined ? "legacy_bearer" : "csr_mtls" }),
      ]);
      await client.query(`update device_enroll_codes set device_id=$1,agent_id=$2 where id=$3`, [deviceId, agentId, enroll.id]);
      await client.query(`insert into device_enrollment_audit(credential_id,owner_id,device_id,event_type,meta) values($1,$2,$3,'credential.consumed',$4),($1,$2,$3,'identity.issued',$4)`, [
        enroll.id, ownerId, deviceId, JSON.stringify({ agent_id: agentId, identity: certificate === undefined ? "legacy_bearer" : "csr_mtls", request_id: requestId }),
      ]);
      const credential = certificate === undefined ? await external.issueAgentCredential({ agentId, ownerId, deviceId }) : undefined;
      await client.query("commit");
      const exp = credential === undefined ? undefined : decodeJwt(credential).exp;
      return {
        agentId, deviceId, ownerId,
        ...(credential === undefined ? {} : { credential }),
        expiresAt: certificate?.expiresAt ?? (exp === undefined ? null : new Date(exp * 1000).toISOString()),
        ...(certificate === undefined ? {} : { certificate }),
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeDevice(deviceId: DeviceIdType, actorId: UserIdType, reason: string | null, requestId: string): Promise<{ readonly kind: "ok"; readonly agentId: string } | "not_owner" | "no_agent" | "already_revoked"> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const share = await client.query<{ role: string }>(`select role from device_shares where device_id=$1 and user_id=$2`, [deviceId, actorId]);
      if (share.rows[0]?.role !== "owner") {
        await client.query("rollback");
        return "not_owner";
      }
      const printer = await this.printers.findById(deviceId, client);
      if (printer?.agent_id === null || printer?.agent_id === undefined) {
        await client.query("rollback");
        return "no_agent";
      }
      const revoked = await client.query(`update agents set revoked_at=now(),revoked_reason=$2,updated_at=now() where id=$1 and revoked_at is null`, [printer.agent_id, reason]);
      if (revoked.rowCount === 0) {
        await client.query("rollback");
        return "already_revoked";
      }
      await client.query(
        `insert into device_state(device_id,status,updated_at) values($1,'offline',now()) on conflict(device_id) do update set status='offline',updated_at=now()`,
        [deviceId],
      );
      await client.query(`insert into device_audit_log(device_id,actor_user_id,action,meta) values($1,$2,'device.revoked',$3)`, [
        deviceId,
        actorId,
        JSON.stringify({ agent_id: printer.agent_id, reason, request_id: requestId }),
      ]);
      await client.query("commit");
      return { kind: "ok", agentId: printer.agent_id };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeAllActiveByOwner(ownerId: UserIdType, reason: string, actorId: UserIdType): Promise<readonly string[]> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const revoked = await client.query<{ id: string }>(
        `update agents set revoked_at=now(),revoked_reason=$2,updated_at=now() where owner_id=$1 and revoked_at is null returning id::text as id`,
        [ownerId, reason],
      );
      await client.query("commit");
      this.logger?.info({ event: "device.admin_revoke_batch", ownerId, actorId, reason, count: revoked.rows.length }, "device agents revoked for owner");
      return revoked.rows.map((row) => row.id);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeCredentialsForSanction(
    tx: PoolClient,
    input: { readonly ownerId: UserIdType; readonly actorId: UserIdType },
  ): Promise<{ readonly agentIds: readonly string[]; readonly agentsRevoked: number; readonly enrollCodesRevoked: number }> {
    const agents = await tx.query<{ id: string }>(
      `update agents set revoked_at = now(), revoked_reason = 'owner_sanctioned', updated_at = now()
       where owner_id = $1 and revoked_at is null returning id::text as id`,
      [input.ownerId],
    );
    const codes = await tx.query<{ id: string }>(
      `with revoked as (
         update device_enroll_codes set revoked_at = now()
          where owner_id = $1 and used_at is null and revoked_at is null and expires_at > now()
          returning id, device_id
       ), audited as (
         insert into device_enrollment_audit(credential_id, owner_id, device_id, event_type, meta)
         select id, $1, device_id, 'credential.revoked', jsonb_build_object('reason', 'owner_sanctioned', 'actor_id', $2::uuid)
           from revoked
       ) select id::text as id from revoked`,
      [input.ownerId, input.actorId],
    );
    return { agentIds: agents.rows.map((row) => row.id), agentsRevoked: agents.rowCount ?? 0, enrollCodesRevoked: codes.rowCount ?? 0 };
  }

  async upsertShare(deviceId: DeviceIdType, userId: UserIdType, role: DeviceShareRole): Promise<{ created: boolean; row: DeviceShareResponse }> {
    const existing = await this.pool.query(`select id from device_shares where device_id=$1 and user_id=$2`, [deviceId, userId]);
    const row = await this.pool.query<DeviceShareResponse>(
      `insert into device_shares(device_id,user_id,role) values($1,$2,$3) on conflict(device_id,user_id) do update set role=excluded.role,updated_at=now() returning id,device_id,user_id,role,created_at,updated_at`,
      [deviceId, userId, role],
    );
    return { created: existing.rowCount === 0, row: row.rows[0]! };
  }
  async deleteShare(deviceId: DeviceIdType, userId: UserIdType): Promise<void> {
    await this.pool.query(`delete from device_shares where device_id=$1 and user_id=$2`, [deviceId, userId]);
  }

  async commandContext(deviceId: DeviceIdType): Promise<CommandContext | null> {
    const printer = await this.printers.findById(deviceId);
    if (printer === null) return null;
    const result = await this.pool.query<{ agentStatus: unknown; agentRevokedAt: Date | null; agentLastSeenAt: Date | null; agentCertificateFingerprint: string | null; deviceStatus: unknown }>(
      `select a.status as "agentStatus",a.revoked_at as "agentRevokedAt",a.last_seen_at as "agentLastSeenAt",a.relay_certificate_fingerprint_sha256 as "agentCertificateFingerprint",ds.status as "deviceStatus" from agents a full join device_state ds on ds.device_id=$1 where a.id=$2`,
      [deviceId, printer.agent_id],
    );
    const own = result.rows[0];
    return {
      connectionMode: printer.connection_mode,
      linkSource: printer.link_source,
      agentId: printer.agent_id ?? null,
      agentCertificateFingerprint: own?.agentCertificateFingerprint ?? null,
      deviceLastSeenAt: printer.last_seen_at ?? null,
      capabilities: printer.capabilities,
      agentStatus: own?.agentStatus,
      agentRevokedAt: own?.agentRevokedAt ?? null,
      agentLastSeenAt: own?.agentLastSeenAt ?? null,
      deviceStatus: own?.deviceStatus,
      configFingerprint: printer.config_fingerprint ?? null,
      printerId: printer.printer_id,
      buildVolume: printer.build_volume,
    };
  }

  async operatingRow(deviceId: DeviceIdType): Promise<DeviceOperatingRow | null> {
    const printer = await this.printers.findById(deviceId);
    if (printer === null) return null;
    const row = (
      await this.pool.query<{
        state_status: string | null;
        state_updated_at: Date | null;
        progress: string | null;
        job_id: string | null;
        metrics: DeviceMetrics | null;
        seq: number | null;
        agent_revoked_at: Date | null;
      }>(
        `select ds.status as state_status,ds.updated_at as state_updated_at,ds.progress,ds.job_id,ds.metrics,ds.seq,a.revoked_at as agent_revoked_at from device_state ds full join agents a on a.id=$2 where ds.device_id=$1`,
        [deviceId, printer.agent_id],
      )
    ).rows[0];
    return {
      connection_mode: printer.connection_mode,
      link_source: printer.link_source,
      agent_id: printer.agent_id ?? null,
      agent_revoked_at: row?.agent_revoked_at ?? null,
      state_status: row?.state_status ?? null,
      state_updated_at: row?.state_updated_at ?? null,
      capabilities: printer.capabilities,
      progress: row?.progress ?? null,
      job_id: row?.job_id ?? null,
      metrics: row?.metrics ?? {},
      seq: Number(row?.seq ?? 0),
      last_seen_at: printer.last_seen_at ?? null,
    };
  }

  async findProfileCommand(deviceId: DeviceIdType, actorId: UserIdType, key: string): Promise<ProfileCommandRow | null> {
    const row = await this.pool.query<ProfileCommandRow>(
      `select id,correlation_id,device_id,command,payload,status,result,created_at,acked_at from device_commands where device_id=$1 and actor_scope=$2 and idempotency_key=$3`,
      [deviceId, actorId, key],
    );
    return row.rows[0] ?? null;
  }
  async findProfileCommandById(deviceId: DeviceIdType, commandId: string): Promise<ProfileCommandRow | null> {
    const row = await this.pool.query<ProfileCommandRow>(
      `select id,correlation_id,device_id,command,payload,status,result,created_at,acked_at from device_commands where id=$1 and device_id=$2`,
      [commandId, deviceId],
    );
    return row.rows[0] ?? null;
  }

  async createCommand(input: {
    deviceId: DeviceIdType;
    actorId: UserIdType;
    role: "owner" | "operator";
    command: DeviceControlCommand;
    idempotencyKey: string | null;
    requestId: string;
  }): Promise<{ row: CommandRow; conflict: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`insert into device_command_counters(device_id,next_seq) values($1,0) on conflict(device_id) do nothing`, [input.deviceId]);
      await client.query(`select next_seq from device_command_counters where device_id=$1 for update`, [input.deviceId]);
      if (input.idempotencyKey !== null) {
        const prior = await client.query<CommandRow>(
          `select id,correlation_id,device_id,command,command_seq,status,result,created_at,acked_at,actor_role from device_commands where device_id=$1 and actor_scope=$2 and idempotency_key=$3`,
          [input.deviceId, input.actorId, input.idempotencyKey],
        );
        const row = prior.rows[0];
        if (row !== undefined) {
          await client.query("commit");
          return { row, conflict: row.command !== input.command || row.actor_role !== input.role };
        }
      }
      const seqRow = await client.query<{ next_seq: number }>(`update device_command_counters set next_seq=next_seq+1 where device_id=$1 returning next_seq`, [input.deviceId]);
      const seq = Number(seqRow.rows[0]!.next_seq);
      const inserted = await client.query<CommandRow>(
        `insert into device_commands(device_id,device_scope,actor_scope,idempotency_key,actor_role,command_seq,command,payload) values($1,$1,$2,$3,$4,$5,$6,'{}'::jsonb) returning id,correlation_id,device_id,command,command_seq,status,result,created_at,acked_at,actor_role`,
        [input.deviceId, input.actorId, input.idempotencyKey, input.role, seq, input.command],
      );
      const row = inserted.rows[0]!;
      await client.query(`insert into device_audit_log(device_id,actor_user_id,action,meta) values($1,$2,'command.queued',$3)`, [
        input.deviceId,
        input.actorId,
        JSON.stringify({ command: input.command, command_id: row.id, correlation_id: row.correlation_id, seq, request_id: input.requestId }),
      ]);
      await client.query("commit");
      return { row, conflict: false };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async findCommand(deviceId: DeviceIdType, commandId: string): Promise<CommandRow | null> {
    const result = await this.pool.query<CommandRow>(
      `select id,correlation_id,device_id,command,command_seq,status,result,created_at,acked_at,actor_role from device_commands where id=$1 and device_id=$2`,
      [commandId, deviceId],
    );
    return result.rows[0] ?? null;
  }

  async createTransfer(input: {
    transferId: string | null;
    deviceId: DeviceIdType;
    actorId: UserIdType;
    fileName: string;
    sizeBytes: number;
    sha256: string | null;
    startPrint: boolean;
    requestId: string;
  }): Promise<{ row: TransferRow; resumed: boolean; conflict: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const inserted = await client.query<TransferRow>(
        `insert into device_transfers(id,device_id,actor_user_id,file_name,size_bytes,sha256,start_print) values(coalesce($1::uuid,gen_random_uuid()),$2,$3,$4,$5,$6,$7) on conflict(id) do nothing returning id,device_id,file_name,size_bytes,sha256,start_print,kind,status,next_seq,bytes_transferred,error_code,error_message,updated_at`,
        [input.transferId, input.deviceId, input.actorId, input.fileName, input.sizeBytes, input.sha256, input.startPrint],
      );
      let row = inserted.rows[0];
      let resumed = false;
      if (row === undefined && input.transferId !== null) {
        const owned = await client.query<TransferRow>(
          `select id,device_id,file_name,size_bytes,sha256,start_print,kind,status,next_seq,bytes_transferred,error_code,error_message,updated_at from device_transfers where id=$1 and device_id=$2 and actor_user_id=$3 for update`,
          [input.transferId, input.deviceId, input.actorId],
        );
        row = owned.rows[0];
        resumed = true;
      }
      if (row === undefined) throw new Error("transfer_insert_failed");
      const conflict =
        resumed && (row.file_name !== input.fileName || Number(row.size_bytes) !== input.sizeBytes || row.sha256 !== input.sha256 || row.start_print !== input.startPrint);
      if (!resumed)
        await client.query(`insert into device_audit_log(device_id,actor_user_id,action,meta) values($1,$2,'transfer.created',$3)`, [
          input.deviceId,
          input.actorId,
          JSON.stringify({ transfer_id: row.id, size_bytes: input.sizeBytes, file_name: input.fileName, request_id: input.requestId }),
        ]);
      await client.query("commit");
      return { row, resumed, conflict };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async findTransfer(deviceId: DeviceIdType, transferId: string): Promise<TransferRow | null> {
    const result = await this.pool.query<TransferRow>(
      `select id,device_id,file_name,size_bytes,sha256,start_print,kind,status,next_seq,bytes_transferred,error_code,error_message,updated_at from device_transfers where id=$1 and device_id=$2`,
      [transferId, deviceId],
    );
    return result.rows[0] ?? null;
  }
  async createProfileTransfer(input: {
    transferId: string;
    deviceId: DeviceIdType;
    actorId: UserIdType;
    fileName: string;
    sizeBytes: number;
    sha256: string;
    profileId: string;
    requestId: string;
  }): Promise<void> {
    await this.pool.query(
      `insert into device_transfers(id,device_id,actor_user_id,file_name,size_bytes,sha256,start_print,kind) values($1,$2,$3,$4,$5,$6,false,'printer_profile')`,
      [input.transferId, input.deviceId, input.actorId, input.fileName, input.sizeBytes, input.sha256],
    );
    await this.audit(input.deviceId, input.actorId, "transfer.created", {
      transfer_id: input.transferId,
      size_bytes: input.sizeBytes,
      file_name: input.fileName,
      kind: "printer_profile",
      profile_id: input.profileId,
      request_id: input.requestId,
    });
  }
  async markTransferSourceReady(input: { transferId: string; objectKey: string; objectVersion: string; contentType: "model/gcode" | "text/plain" }): Promise<void> {
    const updated = await this.pool.query(
      `update device_transfers
          set object_key=$2,object_version=$3,content_type=$4,source_ready_at=coalesce(source_ready_at,now()),updated_at=now()
        where id=$1 and status='initiated'
          and (object_key is null or (object_key=$2 and object_version=$3 and content_type=$4))
        returning id`,
      [input.transferId, input.objectKey, input.objectVersion, input.contentType],
    );
    if (updated.rowCount !== 1) throw new Error("transfer_source_conflict");
  }
  async finishTransfer(transferId: string, input: { error: string; message: string | null }, deviceId: DeviceIdType, actorId: UserIdType, requestId: string): Promise<void> {
    await this.pool.query(`update device_transfers set status='failed',error_code=$2,error_message=$3,updated_at=now(),completed_at=now() where id=$1`, [
      transferId,
      input.error,
      input.message,
    ]);
    await this.audit(deviceId, actorId, "transfer.failed", { transfer_id: transferId, error_code: input.error, request_id: requestId });
  }

  async listIncidents(deviceId: DeviceIdType): Promise<IncidentRow[]> {
    return (await this.pool.query<IncidentRow>(`select ${INCIDENT_COLUMNS} from device_incidents where device_id=$1 order by last_seen_at desc`, [deviceId])).rows;
  }
  async loadThreadEventsAfter(threadId: string, afterSeq: number): Promise<readonly DeviceIncidentEvent[]> {
    return (
      await this.pool.query<DeviceIncidentEvent>(`select seq,event_type,payload from assistant_thread_events where thread_id=$1 and seq>$2 order by seq asc`, [threadId, afterSeq])
    ).rows;
  }
  async appendIncidentThreadEvent(
    executor: DeviceQueryExecutor,
    input: { readonly threadId: string; readonly incidentId: string; readonly status: "acknowledged" | "resolved" },
  ): Promise<void> {
    await executor.query(
      `insert into assistant_thread_events(thread_id,seq,event_type,payload)
       select $1,coalesce((select max(seq) from assistant_thread_events where thread_id=$1),0)+1,$2,$3`,
      [input.threadId, `incident.${input.status}`, JSON.stringify({ incident_id: input.incidentId, status: input.status })],
    );
  }
  async transitionIncident(
    deviceId: DeviceIdType,
    incidentId: string,
    actorId: UserIdType,
    next: "acknowledged" | "resolved",
    external: DeviceExternalPort,
  ): Promise<{ kind: "ok"; row: IncidentRow } | { kind: "not_found" | "already_resolved" }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const found = await client.query<IncidentRow>(`select ${INCIDENT_COLUMNS} from device_incidents where id=$1 and device_id=$2 for update`, [incidentId, deviceId]);
      const row = found.rows[0];
      if (row === undefined) {
        await client.query("rollback");
        return { kind: "not_found" };
      }
      if (row.status === next) {
        await client.query("commit");
        return { kind: "ok", row };
      }
      if (row.status === "resolved") {
        await client.query("rollback");
        return { kind: "already_resolved" };
      }
      const column = next === "acknowledged" ? "acknowledged_at" : "resolved_at";
      const updated = await client.query<IncidentRow>(`update device_incidents set status=$2,${column}=now(),updated_at=now() where id=$1 returning ${INCIDENT_COLUMNS}`, [
        incidentId,
        next,
      ]);
      await external.transitionIncidentThread(client, { threadId: row.thread_id, incidentId, status: next });
      await client.query(`insert into device_audit_log(device_id,actor_user_id,action,meta) values($1,$2,$3,$4)`, [
        deviceId,
        actorId,
        `incident.${next}`,
        JSON.stringify({ incident_id: incidentId }),
      ]);
      await client.query("commit");
      return { kind: "ok", row: updated.rows[0]! };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async findPrintRequest(deviceId: DeviceIdType, actorId: UserIdType | null, idOrKey: { id: string } | { key: string }): Promise<PrintRequestRow | null> {
    const values: unknown[] = [deviceId];
    let where = "device_id=$1";
    if ("id" in idOrKey) {
      values.push(idOrKey.id);
      where += " and id=$2";
    } else {
      values.push(actorId, idOrKey.key);
      where += " and requested_by=$2 and idempotency_key=$3";
    }
    const row = await this.pool.query<PrintRequestRow>(`select * from device_print_requests where ${where}`, values);
    return row.rows[0] ?? null;
  }
  async insertPrintRequest(input: { deviceId: DeviceIdType; actorId: UserIdType; sliceJobId: string; copies: number; key: string }): Promise<PrintRequestRow | null> {
    const row = await this.pool.query<PrintRequestRow>(
      `insert into device_print_requests(device_id,requested_by,slice_job_id,copies,idempotency_key,status) values($1,$2,$3,$4,$5,'slice_ready') on conflict(device_id,requested_by,idempotency_key) do nothing returning *`,
      [input.deviceId, input.actorId, input.sliceJobId, input.copies, input.key],
    );
    return row.rows[0] ?? null;
  }
  async updatePrintRequest(
    id: string,
    values: { status: string; sha?: string | null; error?: string | null; message?: string | null; commandId?: string | null },
  ): Promise<PrintRequestRow> {
    const row = await this.pool.query<PrintRequestRow>(
      `update device_print_requests set status=$2,gcode_sha256=coalesce($3,gcode_sha256),error_code=$4,error_message=$5,start_command_id=coalesce($6,start_command_id),updated_at=now() where id=$1 returning *`,
      [id, values.status, values.sha ?? null, values.error ?? null, values.message ?? null, values.commandId ?? null],
    );
    return row.rows[0]!;
  }
  async confirmPrint(input: { row: PrintRequestRow; deviceId: DeviceIdType; actorId: UserIdType; role: "owner" | "operator" }): Promise<{ id: string; command_seq: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`insert into device_command_counters(device_id,next_seq) values($1,0) on conflict(device_id) do nothing`, [input.deviceId]);
      await client.query(`select next_seq from device_command_counters where device_id=$1 for update`, [input.deviceId]);
      const key = `print-request:${input.row.id}`;
      let command = (
        await client.query<{ id: string; command_seq: number }>(`select id,command_seq from device_commands where device_id=$1 and actor_scope=$2 and idempotency_key=$3`, [
          input.deviceId,
          input.actorId,
          key,
        ])
      ).rows[0];
      if (command === undefined) {
        const seq = Number(
          (await client.query<{ next_seq: number }>(`update device_command_counters set next_seq=next_seq+1 where device_id=$1 returning next_seq`, [input.deviceId])).rows[0]!
            .next_seq,
        );
        command = (
          await client.query<{ id: string; command_seq: number }>(
            `insert into device_commands(device_id,device_scope,actor_scope,idempotency_key,actor_role,command_seq,command,payload) values($1,$1,$2,$3,$4,$5,'start',$6) returning id,command_seq`,
            [input.deviceId, input.actorId, key, input.role, seq, JSON.stringify({ file_name: `${input.row.id}.gcode` })],
          )
        ).rows[0]!;
      }
      await client.query(`update device_print_requests set status='accepted',start_command_id=$2,updated_at=now() where id=$1`, [input.row.id, command.id]);
      await client.query("commit");
      return command;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async publicPrinters(ownerId: UserIdType): Promise<readonly { readonly printer: OwnedUserPrinter; readonly state: PublicDeviceStateRow | null }[]> {
    const owned = await this.printers.listOwned(ownerId);
    const shared = await this.pool.query<{ device_id: string }>(`select device_id from device_shares where user_id=$1`, [ownerId]);
    const byId = new Map(owned.map((printer) => [printer.id, printer]));
    for (const row of shared.rows) {
      if (byId.has(row.device_id)) continue;
      const printer = await this.printers.findById(row.device_id);
      if (printer !== null) byId.set(printer.id, printer);
    }
    const result = [];
    for (const printer of byId.values()) result.push({ printer, state: await this.publicDeviceState(DeviceId(printer.id)) });
    return result;
  }

  async publicDeviceState(deviceId: DeviceIdType): Promise<PublicDeviceStateRow | null> {
    return (await this.pool.query<PublicDeviceStateRow>(`select status,progress,job_id,metrics,updated_at from device_state where device_id=$1`, [deviceId])).rows[0] ?? null;
  }

  async publicPrinter(deviceId: DeviceIdType): Promise<{ readonly printer: OwnedUserPrinter; readonly state: PublicDeviceStateRow | null } | null> {
    const printer = await this.printers.findById(deviceId);
    return printer === null ? null : { printer, state: await this.publicDeviceState(deviceId) };
  }

  async publicTelemetry(deviceId: DeviceIdType, since: string | null, limit: number): Promise<readonly PublicTelemetryRow[]> {
    return (
      await this.pool.query<PublicTelemetryRow>(
        `select recorded_at,status,progress,metrics from device_telemetry
       where device_id=$1 and ($2::timestamptz is null or recorded_at>$2)
       order by recorded_at desc limit $3`,
        [deviceId, since, limit],
      )
    ).rows;
  }

  async queueIdempotentCommand(input: {
    readonly deviceId: DeviceIdType;
    readonly actorId: UserIdType;
    readonly idempotencyKey: string;
    readonly command: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly requestId: string;
  }): Promise<{ readonly row: ProfileCommandRow; readonly conflict: boolean }> {
    const inserted = await this.pool.query<ProfileCommandRow>(
      `insert into device_commands(device_id,device_scope,actor_scope,idempotency_key,api_key_id,command,payload)
       values($1,$1,$2,$3,null,$4,$5) on conflict do nothing
       returning id,correlation_id,device_id,command,payload,status,result,created_at,acked_at`,
      [input.deviceId, input.actorId, input.idempotencyKey, input.command, JSON.stringify(input.payload)],
    );
    let row = inserted.rows[0];
    if (row === undefined) {
      row = (
        await this.pool.query<ProfileCommandRow>(
          `select id,correlation_id,device_id,command,payload,status,result,created_at,acked_at
         from device_commands where device_id=$1 and actor_scope=$2 and idempotency_key=$3`,
          [input.deviceId, input.actorId, input.idempotencyKey],
        )
      ).rows[0];
      if (row === undefined) throw new Error("public command conflict row missing");
      return { row, conflict: row.command !== input.command || JSON.stringify(row.payload) !== JSON.stringify(input.payload) };
    }
    await this.audit(input.deviceId, input.actorId, "command.queued", {
      command: input.command,
      command_id: row.id,
      correlation_id: row.correlation_id,
      request_id: input.requestId,
    });
    return { row, conflict: false };
  }
  async audit(deviceId: DeviceIdType, actorId: UserIdType | null, action: string, meta: Record<string, unknown>): Promise<void> {
    await this.pool.query(`insert into device_audit_log(device_id,actor_user_id,action,meta) values($1,$2,$3,$4)`, [deviceId, actorId, action, JSON.stringify(meta)]);
  }
}
