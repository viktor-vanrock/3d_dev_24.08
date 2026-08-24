import { Inject, Injectable } from "@nestjs/common";
import type {
  RelayGatewaysRevalidateRequestDto,
  RelayGatewaysRevalidateResponseDto,
  RelaySessionAuthorizeRequestDto,
  RelaySessionAuthorizeResponseDto,
  RelaySessionCloseRequestDto,
  RelaySessionCloseResponseDto,
  RelaySessionHeartbeatRequestDto,
  RelaySessionHeartbeatResponseDto,
  RelayTransferMetadataResponseDto,
  RelayTransferProgressRequestDto,
  RelayTransferProgressResponseDto,
  RelayTransferResultRequestDto,
  RelayTransferResultResponseDto,
} from "@portal/contracts/http/relay-internal.v1.dto";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { PRINTER_RELAY_PORT, type PrinterRelayPort } from "../../printers/public/index.ts";

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 30_000;
const TRANSFER_CHUNK_SIZE_BYTES = 65_536;

type JsonRecord = Readonly<Record<string, unknown>>;

export type RelayControlRepositoryErrorCode =
  "gateway_forbidden" | "session_not_found" | "session_conflict" | "transfer_not_found" | "source_changed" | "idempotency_conflict" | "transfer_conflict";

export class RelayControlRepositoryError extends Error {
  constructor(readonly code: RelayControlRepositoryErrorCode) {
    super(code);
    this.name = "RelayControlRepositoryError";
  }
}

export interface RelayOperationIdentity {
  readonly operationId: string;
  readonly requestHash: string;
}

export interface AuthorizedCommandSession {
  readonly gatewayId: string;
  readonly ownerId: string;
  readonly authorizationRevision: number;
  readonly authorizedDeviceIds: readonly string[];
}

export interface RelayTransferSourceTuple {
  readonly objectKey: string;
  readonly objectVersion: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly contentType: RelayTransferMetadataResponseDto["content_type"];
  readonly metadata: RelayTransferMetadataResponseDto;
}

interface GatewayRow {
  readonly id: string;
  readonly owner_id: string;
  readonly authorization_revision: string;
}

interface SessionRow {
  readonly id: string;
  readonly gateway_id: string;
  readonly generation: string;
  readonly authorization_revision: string;
  readonly state: "active" | "closed";
  readonly closed_at: Date | null;
  readonly close_reason: string | null;
  readonly owner_id: string;
  readonly current_authorization_revision: string;
  readonly revoked_at: Date | null;
}

interface TransferRow {
  readonly id: string;
  readonly gateway_id: string;
  readonly device_id: string;
  readonly file_name: string;
  readonly kind: "gcode" | "printer_profile";
  readonly content_type: string;
  readonly size_bytes: string;
  readonly sha256: string | null;
  readonly object_key: string | null;
  readonly object_version: string | null;
  readonly source_ready_at: Date | null;
  readonly start_print: boolean;
  readonly status: "initiated" | "transferring" | "completed" | "failed" | "cancelled";
  readonly next_seq: string;
  readonly bytes_transferred: string;
  readonly error_code: string | null;
  readonly updated_at: Date;
  readonly session_generation: string;
  readonly session_id: string;
}

function assertRequestHash(requestHash: string): void {
  if (!/^[a-f0-9]{64}$/.test(requestHash)) throw new RelayControlRepositoryError("idempotency_conflict");
}

function toSafeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("relay_control_integer_out_of_range");
  return parsed;
}

function transferContentType(value: string): RelayTransferMetadataResponseDto["content_type"] {
  if (value === "application/octet-stream" || value === "text/plain" || value === "application/vnd.3mfmodel" || value === "model/gcode") return value;
  throw new RelayControlRepositoryError("transfer_conflict");
}

@Injectable()
export class RelayControlRepository {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(PRINTER_RELAY_PORT) private readonly printers: PrinterRelayPort,
  ) {}

  async authorizeSession(
    input: RelayOperationIdentity & { readonly connectionId: string; readonly request: RelaySessionAuthorizeRequestDto },
  ): Promise<RelaySessionAuthorizeResponseDto> {
    return this.transaction(async (client) =>
      this.withOperation(client, "session.authorize.v1", input, async () => {
        const gatewayResult = await client.query<GatewayRow>(
          `select id::text,owner_id::text,authorization_revision::text
             from agents
            where id::text=$1 and relay_certificate_fingerprint_sha256=$2 and revoked_at is null
            for update`,
          [input.request.gateway_identity, input.request.certificate_fingerprint_sha256],
        );
        const gateway = gatewayResult.rows[0];
        if (gateway === undefined) throw new RelayControlRepositoryError("gateway_forbidden");

        await client.query(
          `update relay_gateway_sessions
              set state='closed',closed_at=now(),close_reason='replaced'
            where gateway_id=$1 and state='active'`,
          [gateway.id],
        );
        const created = await client.query<{ id: string; generation: string }>(
          `insert into relay_gateway_sessions
             (gateway_id,connection_id,certificate_fingerprint_sha256,generation,authorization_revision)
           select $1,$2,$3,coalesce(max(generation),0)+1,$4
             from relay_gateway_sessions where gateway_id=$1
           returning id::text,generation::text`,
          [gateway.id, input.connectionId, input.request.certificate_fingerprint_sha256, gateway.authorization_revision],
        );
        await client.query(`update agents set version=$2,status='online',last_seen_at=now(),updated_at=now() where id=$1`, [gateway.id, input.request.agent_version]);
        const authorizedDevices = await this.authorizedDevices(client, gateway.id, toSafeInteger(gateway.authorization_revision));
        const pendingTransferIds = await this.pendingTransferIds(client, gateway.id);
        const session = created.rows[0]!;
        return {
          session_id: session.id,
          session_generation: toSafeInteger(session.generation),
          gateway_id: gateway.id,
          authorization_revision: toSafeInteger(gateway.authorization_revision),
          authorized_devices: authorizedDevices,
          pending_transfer_ids: pendingTransferIds,
          heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
          heartbeat_timeout_ms: HEARTBEAT_TIMEOUT_MS,
        };
      }),
    );
  }

  async heartbeatSession(
    input: RelayOperationIdentity & { readonly sessionId: string; readonly request: RelaySessionHeartbeatRequestDto },
  ): Promise<RelaySessionHeartbeatResponseDto> {
    return this.transaction(async (client) =>
      this.withOperation<RelaySessionHeartbeatResponseDto>(
        client,
        "session.heartbeat.v1",
        input,
        async () => {
          const session = await this.activeSession(client, input.sessionId, input.request.gateway_id, input.request.session_generation, true);
          const revision = toSafeInteger(session.current_authorization_revision);
          if (revision !== input.request.authorization_revision || toSafeInteger(session.authorization_revision) !== revision) {
            throw new RelayControlRepositoryError("session_conflict");
          }

          const requestedIds = input.request.devices.map((device) => device.device_id);
          const authorized = requestedIds.length === 0 ? [] : await this.authorizedDeviceIds(client, session.gateway_id, requestedIds);
          const accepted = new Set(authorized);
          const persistedDeviceIds: string[] = [];
          const persisted = await client.query<{ persisted_at: Date }>(
            `update relay_gateway_sessions set last_heartbeat_at=now()
              where id=$1 returning last_heartbeat_at as persisted_at`,
            [session.id],
          );
          await client.query(`update agents set status='online',last_seen_at=now(),updated_at=now() where id=$1`, [session.gateway_id]);

          for (const device of input.request.devices) {
            if (!accepted.has(device.device_id)) continue;
            const metrics = {
              ...(device.temperature_c === undefined ? {} : { temperature_c: device.temperature_c }),
              ...(device.bytes_available === undefined ? {} : { bytes_available: device.bytes_available }),
              ...(device.firmware_version === undefined ? {} : { firmware_version: device.firmware_version }),
              ...(device.model === undefined ? {} : { model: device.model }),
            };
            const stillAuthorized = await this.printers.recordDeviceHeartbeat(device.device_id, session.gateway_id, device.state, client);
            if (!stillAuthorized) continue;
            persistedDeviceIds.push(device.device_id);
            await client.query(
              `insert into device_state(device_id,status,progress,metrics,seq,updated_at)
               values($1::uuid,$2,$3,$4::jsonb,$5,now())
               on conflict(device_id) do update
                 set status=excluded.status,progress=excluded.progress,metrics=excluded.metrics,seq=excluded.seq,updated_at=now()
               where device_state.seq<=excluded.seq`,
              [device.device_id, device.state, device.progress_percent, JSON.stringify(metrics), device.sequence],
            );
            await client.query(
              `insert into device_telemetry(device_id,recorded_at,status,progress,metrics,seq)
               values($1::uuid,$2,$3,$4,$5::jsonb,$6)`,
              [device.device_id, input.request.observed_at, device.state, device.progress_percent, JSON.stringify(metrics), device.sequence],
            );
          }

          return {
            session_id: session.id,
            session_generation: input.request.session_generation,
            authorization_revision: revision,
            accepted_device_ids: persistedDeviceIds,
            pending_transfer_ids: await this.pendingTransferIds(client, session.gateway_id),
            persisted_at: persisted.rows[0]!.persisted_at.toISOString(),
            replayed: false,
          };
        },
        (response) => ({ ...response, replayed: true }),
      ),
    );
  }

  async closeSession(input: RelayOperationIdentity & { readonly sessionId: string; readonly request: RelaySessionCloseRequestDto }): Promise<RelaySessionCloseResponseDto> {
    return this.transaction(async (client) =>
      this.withOperation<RelaySessionCloseResponseDto>(
        client,
        "session.close.v1",
        input,
        async () => {
          const result = await client.query<SessionRow>(
            `select s.id::text,s.gateway_id::text,s.generation::text,s.authorization_revision::text,s.state,s.closed_at,s.close_reason,
                    a.owner_id::text,a.authorization_revision::text as current_authorization_revision,a.revoked_at
               from relay_gateway_sessions s join agents a on a.id=s.gateway_id
              where s.id::text=$1 and s.gateway_id::text=$2 for update of s`,
            [input.sessionId, input.request.gateway_id],
          );
          const session = result.rows[0];
          if (session === undefined) throw new RelayControlRepositoryError("session_not_found");
          if (toSafeInteger(session.generation) !== input.request.session_generation) throw new RelayControlRepositoryError("session_conflict");
          if (session.state === "closed") {
            if (session.close_reason !== input.request.reason || session.closed_at === null) throw new RelayControlRepositoryError("session_conflict");
            return {
              session_id: session.id,
              session_generation: input.request.session_generation,
              closed_at: session.closed_at.toISOString(),
              replayed: true,
            };
          }
          const closed = await client.query<{ closed_at: Date }>(
            `update relay_gateway_sessions
                set state='closed',closed_at=$2::timestamptz,close_reason=$3
              where id=$1 returning closed_at`,
            [session.id, input.request.closed_at, input.request.reason],
          );
          return {
            session_id: session.id,
            session_generation: input.request.session_generation,
            closed_at: closed.rows[0]!.closed_at.toISOString(),
            replayed: false,
          };
        },
        (response) => ({ ...response, replayed: true }),
      ),
    );
  }

  async revalidateGateways(request: RelayGatewaysRevalidateRequestDto): Promise<RelayGatewaysRevalidateResponseDto> {
    return this.transaction(async (client) => {
      const results: RelayGatewaysRevalidateResponseDto["results"][number][] = [];
      for (const item of request.gateways) {
        const found = await client.query<SessionRow>(
          `select s.id::text,s.gateway_id::text,s.generation::text,s.authorization_revision::text,s.state,s.closed_at,s.close_reason,
                  a.owner_id::text,a.authorization_revision::text as current_authorization_revision,a.revoked_at
             from relay_gateway_sessions s join agents a on a.id=s.gateway_id
            where s.id::text=$1 and s.gateway_id::text=$2`,
          [item.session_id, item.gateway_id],
        );
        const session = found.rows[0];
        const revision = session === undefined ? item.known_authorization_revision : toSafeInteger(session.current_authorization_revision);
        let state: RelayGatewaysRevalidateResponseDto["results"][number]["state"];
        if (session === undefined) state = "unknown";
        else if (session.revoked_at !== null) state = "revoked";
        else if (session.state !== "active" || toSafeInteger(session.generation) !== item.session_generation) state = "superseded";
        else state = "authorized";
        if (state === "authorized" && toSafeInteger(session!.authorization_revision) !== revision) {
          await client.query(`update relay_gateway_sessions set authorization_revision=$2 where id=$1`, [session!.id, revision]);
        }
        results.push({
          gateway_id: item.gateway_id,
          session_id: item.session_id,
          session_generation: item.session_generation,
          authorization_revision: revision,
          state,
          authorized_devices: state === "authorized" ? await this.authorizedDevices(client, item.gateway_id, revision) : [],
        });
      }
      const now = await client.query<{ validated_at: Date }>(`select now() as validated_at`);
      return { results, validated_at: now.rows[0]!.validated_at.toISOString() };
    });
  }

  async authorizeCommandSession(input: {
    readonly sessionId: string;
    readonly gatewayId: string;
    readonly sessionGeneration: number;
    readonly authorizationRevision: number;
  }): Promise<AuthorizedCommandSession> {
    return this.transaction(async (client) => {
      const session = await this.activeSession(client, input.sessionId, input.gatewayId, input.sessionGeneration, false);
      const revision = toSafeInteger(session.current_authorization_revision);
      if (revision !== input.authorizationRevision || toSafeInteger(session.authorization_revision) !== revision) throw new RelayControlRepositoryError("session_conflict");
      return {
        gatewayId: session.gateway_id,
        ownerId: session.owner_id,
        authorizationRevision: revision,
        authorizedDeviceIds: await this.authorizedDeviceIds(client, session.gateway_id),
      };
    });
  }

  async getTransferMetadata(input: { readonly transferId: string; readonly sessionId: string; readonly sessionGeneration: number }): Promise<RelayTransferMetadataResponseDto> {
    return this.transaction(async (client) => this.toTransferMetadata(await this.authorizedTransfer(client, input, false)));
  }

  async getTransferSourceTuple(input: {
    readonly transferId: string;
    readonly sessionId: string;
    readonly sessionGeneration: number;
    readonly objectVersion?: string;
    readonly sha256?: string;
    readonly sizeBytes?: number;
  }): Promise<RelayTransferSourceTuple> {
    return this.transaction(async (client) => {
      const transfer = await this.authorizedTransfer(client, input, false);
      if (
        (input.objectVersion !== undefined && input.objectVersion !== transfer.object_version) ||
        (input.sha256 !== undefined && input.sha256 !== transfer.sha256) ||
        (input.sizeBytes !== undefined && input.sizeBytes !== toSafeInteger(transfer.size_bytes))
      ) {
        throw new RelayControlRepositoryError("source_changed");
      }
      if (transfer.object_key === null || transfer.object_version === null || transfer.sha256 === null || transfer.source_ready_at === null) {
        throw new RelayControlRepositoryError("transfer_conflict");
      }
      return {
        objectKey: transfer.object_key,
        objectVersion: transfer.object_version,
        sha256: transfer.sha256,
        sizeBytes: toSafeInteger(transfer.size_bytes),
        contentType: transferContentType(transfer.content_type),
        metadata: this.toTransferMetadata(transfer),
      };
    });
  }

  async writeTransferProgress(
    input: RelayOperationIdentity & { readonly transferId: string; readonly request: RelayTransferProgressRequestDto },
  ): Promise<RelayTransferProgressResponseDto> {
    return this.transaction(async (client) =>
      this.withOperation<RelayTransferProgressResponseDto>(
        client,
        "transfer.progress.v1",
        input,
        async () => {
          const transfer = await this.authorizedTransfer(
            client,
            { transferId: input.transferId, sessionId: input.request.session_id, sessionGeneration: input.request.session_generation },
            true,
          );
          this.assertTransferVersionAndPosition(transfer, input.request.object_version, input.request.next_sequence, input.request.next_offset);
          const currentSequence = toSafeInteger(transfer.next_seq);
          const currentOffset = toSafeInteger(transfer.bytes_transferred);
          if (currentSequence === input.request.next_sequence && currentOffset === input.request.next_offset) {
            return {
              transfer_id: transfer.id,
              next_sequence: currentSequence,
              next_offset: currentOffset,
              persisted_at: transfer.updated_at.toISOString(),
              replayed: true,
            };
          }
          if (transfer.status !== "initiated" && transfer.status !== "transferring") throw new RelayControlRepositoryError("transfer_conflict");
          if (input.request.next_sequence <= currentSequence || input.request.next_offset <= currentOffset) throw new RelayControlRepositoryError("transfer_conflict");
          const updated = await client.query<{ updated_at: Date }>(
            `update device_transfers
                set status='transferring',next_seq=$2,bytes_transferred=$3,updated_at=now()
              where id=$1 returning updated_at`,
            [transfer.id, input.request.next_sequence, input.request.next_offset],
          );
          return {
            transfer_id: transfer.id,
            next_sequence: input.request.next_sequence,
            next_offset: input.request.next_offset,
            persisted_at: updated.rows[0]!.updated_at.toISOString(),
            replayed: false,
          };
        },
        (response) => ({ ...response, replayed: true }),
      ),
    );
  }

  async writeTransferResult(
    input: RelayOperationIdentity & { readonly transferId: string; readonly request: RelayTransferResultRequestDto },
  ): Promise<RelayTransferResultResponseDto> {
    return this.transaction(async (client) =>
      this.withOperation<RelayTransferResultResponseDto>(
        client,
        "transfer.result.v1",
        input,
        async () => {
          const transfer = await this.authorizedTransfer(
            client,
            { transferId: input.transferId, sessionId: input.request.session_id, sessionGeneration: input.request.session_generation },
            true,
          );
          this.assertTransferVersionAndPosition(transfer, input.request.object_version, input.request.next_sequence, input.request.next_offset);
          const currentSequence = toSafeInteger(transfer.next_seq);
          const currentOffset = toSafeInteger(transfer.bytes_transferred);
          if (transfer.status === "completed" || transfer.status === "failed") {
            if (
              transfer.status !== input.request.status ||
              currentSequence !== input.request.next_sequence ||
              currentOffset !== input.request.next_offset ||
              transfer.error_code !== (input.request.error_code ?? null)
            ) {
              throw new RelayControlRepositoryError("transfer_conflict");
            }
            return {
              transfer_id: transfer.id,
              status: transfer.status,
              next_sequence: currentSequence,
              next_offset: currentOffset,
              persisted_at: transfer.updated_at.toISOString(),
              replayed: true,
            };
          }
          if (transfer.status === "cancelled") throw new RelayControlRepositoryError("transfer_conflict");
          if (input.request.next_sequence < currentSequence || input.request.next_offset < currentOffset) throw new RelayControlRepositoryError("transfer_conflict");
          if (input.request.status === "completed" && input.request.next_offset !== toSafeInteger(transfer.size_bytes)) throw new RelayControlRepositoryError("transfer_conflict");
          if ((input.request.status === "failed") !== (input.request.error_code !== undefined)) throw new RelayControlRepositoryError("transfer_conflict");
          const updated = await client.query<{ updated_at: Date }>(
            `update device_transfers
                set status=$2,next_seq=$3,bytes_transferred=$4,error_code=$5,error_message=null,updated_at=now(),completed_at=now()
              where id=$1 returning updated_at`,
            [transfer.id, input.request.status, input.request.next_sequence, input.request.next_offset, input.request.error_code ?? null],
          );
          await client.query(
            `update device_print_requests
                set status=case when $2='completed' then 'awaiting_confirmation' else 'failed' end,
                    error_code=case when $2='failed' then $3 else null end,
                    error_message=null,updated_at=now()
              where id=$1 and status in ('slice_ready','delivered')`,
            [transfer.id, input.request.status, input.request.error_code ?? null],
          );
          return {
            transfer_id: transfer.id,
            status: input.request.status,
            next_sequence: input.request.next_sequence,
            next_offset: input.request.next_offset,
            persisted_at: updated.rows[0]!.updated_at.toISOString(),
            replayed: false,
          };
        },
        (response) => ({ ...response, replayed: true }),
      ),
    );
  }

  private async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await callback(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async withOperation<T extends JsonRecord>(
    client: PoolClient,
    operationType: string,
    identity: RelayOperationIdentity,
    mutate: () => Promise<T>,
    onReplay: (response: T) => T = (response) => response,
  ): Promise<T> {
    assertRequestHash(identity.requestHash);
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`, [`${operationType}:${identity.operationId}`]);
    const existing = await client.query<{ request_hash: string; response: T }>(
      `select request_hash,response from relay_internal_operations where operation_type=$1 and operation_id=$2`,
      [operationType, identity.operationId],
    );
    const replay = existing.rows[0];
    if (replay !== undefined) {
      if (replay.request_hash !== identity.requestHash) throw new RelayControlRepositoryError("idempotency_conflict");
      return onReplay(replay.response);
    }
    const response = await mutate();
    await client.query(
      `insert into relay_internal_operations(operation_type,operation_id,request_hash,response)
       values($1,$2,$3,$4::jsonb)`,
      [operationType, identity.operationId, identity.requestHash, JSON.stringify(response)],
    );
    return response;
  }

  private async activeSession(client: PoolClient, sessionId: string, gatewayId: string, generation: number, lock: boolean): Promise<SessionRow> {
    const result = await client.query<SessionRow>(
      `select s.id::text,s.gateway_id::text,s.generation::text,s.authorization_revision::text,s.state,s.closed_at,s.close_reason,
              a.owner_id::text,a.authorization_revision::text as current_authorization_revision,a.revoked_at
         from relay_gateway_sessions s join agents a on a.id=s.gateway_id
        where s.id::text=$1 and s.gateway_id::text=$2${lock ? " for update of s" : ""}`,
      [sessionId, gatewayId],
    );
    const session = result.rows[0];
    if (session === undefined) throw new RelayControlRepositoryError("session_not_found");
    if (session.state !== "active" || session.revoked_at !== null || toSafeInteger(session.generation) !== generation) {
      throw new RelayControlRepositoryError("session_conflict");
    }
    return session;
  }

  private async authorizedDevices(client: PoolClient, gatewayId: string, authorizationRevision: number): Promise<RelaySessionAuthorizeResponseDto["authorized_devices"]> {
    const ids = await this.authorizedDeviceIds(client, gatewayId);
    return ids.map((deviceId) => ({ device_id: deviceId, authorization_revision: authorizationRevision }));
  }

  private async authorizedDeviceIds(client: PoolClient, gatewayId: string, requestedIds?: readonly string[]): Promise<string[]> {
    return [...(await this.printers.authorizedDeviceIds(gatewayId, requestedIds, client))];
  }

  private async pendingTransferIds(client: PoolClient, gatewayId: string): Promise<string[]> {
    const authorizedDeviceIds = await this.printers.authorizedDeviceIds(gatewayId, undefined, client);
    if (authorizedDeviceIds.length === 0) return [];
    const result = await client.query<{ id: string }>(
      `select dt.id::text
         from device_transfers dt
        where dt.device_id=any($1::uuid[])
          and dt.source_ready_at is not null
          and dt.status in ('initiated','transferring')
        order by dt.updated_at,dt.id
        limit 100`,
      [authorizedDeviceIds],
    );
    return result.rows.map((row) => row.id);
  }

  private async authorizedTransfer(
    client: PoolClient,
    input: { readonly transferId: string; readonly sessionId: string; readonly sessionGeneration: number },
    lock: boolean,
  ): Promise<TransferRow> {
    const result = await client.query<TransferRow>(
      `select dt.id::text,s.gateway_id::text,dt.device_id::text,dt.file_name,dt.kind,dt.content_type,dt.size_bytes::text,dt.sha256,
              dt.object_key,dt.object_version,dt.source_ready_at,dt.start_print,dt.status,dt.next_seq::text,dt.bytes_transferred::text,
              dt.error_code,dt.updated_at,s.generation::text as session_generation,s.id::text as session_id
         from device_transfers dt
         join relay_gateway_sessions s on s.id::text=$2
         join agents a on a.id=s.gateway_id
        where dt.id::text=$1 and s.id::text=$2 and s.generation=$3 and s.state='active' and a.revoked_at is null${lock ? " for update of dt" : ""}`,
      [input.transferId, input.sessionId, input.sessionGeneration],
    );
    const transfer = result.rows[0];
    if (transfer === undefined) throw new RelayControlRepositoryError("transfer_not_found");
    if (!(await this.printers.isDeviceAuthorized(transfer.device_id, transfer.gateway_id, client))) {
      throw new RelayControlRepositoryError("transfer_not_found");
    }
    if (transfer.object_key === null || transfer.object_version === null || transfer.sha256 === null || transfer.source_ready_at === null) {
      throw new RelayControlRepositoryError("transfer_conflict");
    }
    return transfer;
  }

  private toTransferMetadata(transfer: TransferRow): RelayTransferMetadataResponseDto {
    if (transfer.object_version === null || transfer.sha256 === null) throw new RelayControlRepositoryError("transfer_conflict");
    if (transfer.status === "failed" || transfer.status === "cancelled") throw new RelayControlRepositoryError("transfer_conflict");
    return {
      transfer_id: transfer.id,
      session_id: transfer.session_id,
      session_generation: toSafeInteger(transfer.session_generation),
      gateway_id: transfer.gateway_id,
      device_id: transfer.device_id,
      file_name: transfer.file_name,
      kind: transfer.kind,
      content_type: transferContentType(transfer.content_type),
      size_bytes: toSafeInteger(transfer.size_bytes),
      sha256: transfer.sha256,
      object_version: transfer.object_version,
      chunk_size_bytes: TRANSFER_CHUNK_SIZE_BYTES,
      next_offset: toSafeInteger(transfer.bytes_transferred),
      next_sequence: toSafeInteger(transfer.next_seq),
      start_print: transfer.start_print,
    };
  }

  private assertTransferVersionAndPosition(transfer: TransferRow, objectVersion: string, nextSequence: number, nextOffset: number): void {
    if (transfer.object_version !== objectVersion) throw new RelayControlRepositoryError("source_changed");
    if (nextOffset > toSafeInteger(transfer.size_bytes) || nextSequence < 0 || nextOffset < 0) throw new RelayControlRepositoryError("transfer_conflict");
  }
}
