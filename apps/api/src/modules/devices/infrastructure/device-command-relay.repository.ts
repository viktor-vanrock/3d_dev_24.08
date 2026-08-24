import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";

import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type {
  DeviceCommandRelayPort,
  RelayCommandClaimRow,
  RelayCommandDeliveryState,
  RelayCommandLeaseRow,
  RelayCommandResultWrite,
  RelayCommandTerminalRow,
  RelayCommandTerminalState,
} from "../public/index.ts";

interface ClaimDatabaseRow {
  readonly id: string;
  readonly device_id: string;
  readonly command_seq: string;
  readonly command: RelayCommandClaimRow["command"];
  readonly payload: { readonly file_name?: string };
  readonly actor_scope: string;
  readonly actor_role: "owner" | "operator";
  readonly claim_owner: string;
  readonly claim_token: string;
  readonly generation: string;
  readonly attempt_count: number;
  readonly max_attempts: number;
  readonly lease_expires_at: Date;
  readonly expires_at: Date;
}

interface TerminalDatabaseRow {
  readonly id: string;
  readonly command_seq: string;
  readonly status: RelayCommandTerminalState;
  readonly generation: string;
  readonly terminal_error_code: string | null;
  readonly completed_at: Date;
}

interface StoredClaimRow {
  readonly commandId: string;
  readonly deviceId: string;
  readonly commandSeq: number;
  readonly command: RelayCommandClaimRow["command"];
  readonly fileName: string | null;
  readonly actorId: string;
  readonly actorRole: "owner" | "operator";
  readonly claimOwner: string;
  readonly claimToken: string;
  readonly generation: number;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly leaseExpiresAt: string;
  readonly expiresAt: string;
}

interface StoredClaimOperationRow {
  readonly request_hash: string;
  readonly response: { readonly commands: readonly StoredClaimRow[] };
}

const ACTIVE_STATES = ["leased", "delivered", "acknowledged"] as const;
const TARGET_COMMANDS = ["start", "pause", "resume", "cancel"] as const;

function toClaimRow(row: ClaimDatabaseRow): RelayCommandClaimRow {
  return {
    commandId: row.id,
    deviceId: row.device_id,
    commandSeq: Number(row.command_seq),
    command: row.command,
    fileName: row.command === "start" ? (row.payload.file_name ?? null) : null,
    actorId: row.actor_scope,
    actorRole: row.actor_role,
    claimOwner: row.claim_owner,
    claimToken: row.claim_token,
    generation: Number(row.generation),
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    leaseExpiresAt: row.lease_expires_at,
    expiresAt: row.expires_at,
  };
}

function toTerminalRow(row: TerminalDatabaseRow): RelayCommandTerminalRow {
  return {
    commandId: row.id,
    commandSeq: Number(row.command_seq),
    status: row.status,
    generation: Number(row.generation),
    terminalErrorCode: row.terminal_error_code,
    completedAt: row.completed_at,
  };
}

function storeClaimRow(row: RelayCommandClaimRow): StoredClaimRow {
  return { ...row, leaseExpiresAt: row.leaseExpiresAt.toISOString(), expiresAt: row.expiresAt.toISOString() };
}

function restoreClaimRow(row: StoredClaimRow): RelayCommandClaimRow {
  return { ...row, leaseExpiresAt: new Date(row.leaseExpiresAt), expiresAt: new Date(row.expiresAt) };
}

export class RelayCommandOperationConflictError extends Error {
  readonly code = "idempotency_conflict";
}

@Injectable()
export class DeviceCommandRelayRepository implements DeviceCommandRelayPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async claim(input: {
    readonly claimOwner: string;
    readonly authorizedDeviceIds: readonly string[];
    readonly limit: number;
    readonly operationId?: string;
    readonly requestHash?: string;
  }): Promise<{ readonly commands: readonly RelayCommandClaimRow[]; readonly replayed: boolean }> {
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit)));
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      if (input.operationId !== undefined && input.requestHash !== undefined) {
        await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`relayCommandsClaim:${input.operationId}`]);
        const prior = await client.query<StoredClaimOperationRow>(
          "select request_hash,response from relay_internal_operations where operation_type='relayCommandsClaim' and operation_id=$1 and expires_at>now()",
          [input.operationId],
        );
        const replay = prior.rows[0];
        if (replay !== undefined) {
          if (replay.request_hash !== input.requestHash) throw new RelayCommandOperationConflictError("operation identity was reused with another claim request");
          await client.query("commit");
          return { commands: replay.response.commands.map(restoreClaimRow), replayed: true };
        }
      }
      await this.expireOrRequeue(client, input.authorizedDeviceIds);
      const claimed = await client.query<ClaimDatabaseRow>(
        `with candidate as (
           select picked.id
             from unnest($2::uuid[]) as authorized(device_id)
             cross join lateral (
               select command.id,command.command_seq,command.created_at
                 from device_commands command
                where command.device_id=authorized.device_id
                  and command.status='queued'
                  and command.command=any($4::text[])
                  and command.actor_scope is not null
                  and command.expires_at>now()
                  and command.attempt_count<command.max_attempts
                  and not exists (
                    select 1 from device_commands earlier
                     where earlier.device_id=command.device_id
                       and earlier.command_seq<command.command_seq
                       and earlier.status not in ('executed','failed','expired')
                  )
                  and not exists (
                    select 1 from device_commands active
                     where active.device_id=command.device_id
                       and active.status=any($5::text[])
                  )
                order by command.command_seq,command.created_at,command.id
                for update skip locked
                limit 1
             ) picked
            order by picked.command_seq,picked.created_at,picked.id
            limit $3
         )
         update device_commands command
            set status='leased',
                claim_owner=$1,
                claim_token=replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''),
                generation=command.generation+1,
                attempt_count=command.attempt_count+1,
                lease_expires_at=now() + make_interval(secs => command.lease_timeout_seconds),
                leased_at=now(),
                delivered_at=null,
                acknowledged_at=null
           from candidate
          where command.id=candidate.id
        returning command.id,command.device_id,command.command_seq::text,command.command,command.payload,command.actor_scope,command.actor_role,
                  command.claim_owner,command.claim_token,command.generation::text,command.attempt_count,
                  command.max_attempts,command.lease_expires_at,command.expires_at`,
        [input.claimOwner, [...new Set(input.authorizedDeviceIds)], limit, TARGET_COMMANDS, ACTIVE_STATES],
      );
      const rows = claimed.rows.map(toClaimRow);
      if (input.operationId !== undefined && input.requestHash !== undefined) {
        await client.query(
          `insert into relay_internal_operations(operation_type,operation_id,request_hash,response)
           values('relayCommandsClaim',$1,$2,$3)`,
          [input.operationId, input.requestHash, { commands: rows.map(storeClaimRow) }],
        );
      }
      await client.query("commit");
      return { commands: rows, replayed: false };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async heartbeat(input: {
    readonly commandId: string;
    readonly claimOwner: string;
    readonly claimToken: string;
    readonly generation: number;
    readonly deliveryState: RelayCommandDeliveryState;
  }): Promise<RelayCommandLeaseRow | null> {
    const updated = await this.pool.query<{ id: string; status: RelayCommandDeliveryState; generation: string; lease_expires_at: Date }>(
      `update device_commands
          set status=$5,
              lease_expires_at=now() + make_interval(secs => lease_timeout_seconds),
              delivered_at=case when $5 in ('delivered','acknowledged') then coalesce(delivered_at,now()) else delivered_at end,
              acknowledged_at=case when $5='acknowledged' then coalesce(acknowledged_at,now()) else acknowledged_at end
        where id=$1 and claim_owner=$2 and claim_token=$3 and generation=$4
          and status=any($6::text[]) and lease_expires_at>now() and expires_at>now()
          and case status
            when 'leased' then $5 in ('leased','delivered','acknowledged')
            when 'delivered' then $5 in ('delivered','acknowledged')
            when 'acknowledged' then $5='acknowledged'
            else false
          end
      returning id,status,generation::text,lease_expires_at`,
      [input.commandId, input.claimOwner, input.claimToken, input.generation, input.deliveryState, ACTIVE_STATES],
    );
    const row = updated.rows[0];
    return row === undefined ? null : { commandId: row.id, status: row.status, generation: Number(row.generation), leaseExpiresAt: row.lease_expires_at };
  }

  async writeResult(input: {
    readonly commandId: string;
    readonly commandSeq: number;
    readonly claimOwner: string;
    readonly claimToken: string;
    readonly generation: number;
    readonly status: RelayCommandTerminalState;
    readonly errorCode: string | null;
  }): Promise<RelayCommandResultWrite> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const existing = await client.query<TerminalDatabaseRow & { claim_owner: string | null; claim_token: string | null }>(
        `select id,command_seq::text,status,generation::text,terminal_error_code,
                coalesce(executed_at,failed_at) as completed_at,claim_owner,claim_token
           from device_commands where id=$1 for update`,
        [input.commandId],
      );
      const current = existing.rows[0];
      if (
        current === undefined ||
        current.claim_owner !== input.claimOwner ||
        current.claim_token !== input.claimToken ||
        Number(current.generation) !== input.generation ||
        Number(current.command_seq) !== input.commandSeq
      ) {
        await client.query("commit");
        return { kind: "fence_rejected" };
      }
      if (current.status === "executed" || current.status === "failed") {
        const same = current.status === input.status && current.terminal_error_code === input.errorCode;
        await client.query("commit");
        return same ? { kind: "replayed", row: toTerminalRow(current) } : { kind: "conflict" };
      }
      const updated = await client.query<TerminalDatabaseRow>(
        `update device_commands
            set status=$6,
                terminal_error_code=$7,
                executed_at=case when $6='executed' then now() else executed_at end,
                failed_at=case when $6='failed' then now() else failed_at end,
                lease_expires_at=null
          where id=$1 and claim_owner=$2 and claim_token=$3 and generation=$4 and command_seq=$5
            and status=any($8::text[])
        returning id,command_seq::text,status,generation::text,terminal_error_code,
                  coalesce(executed_at,failed_at) as completed_at`,
        [input.commandId, input.claimOwner, input.claimToken, input.generation, input.commandSeq, input.status, input.errorCode, ACTIVE_STATES],
      );
      const row = updated.rows[0];
      await client.query("commit");
      return row === undefined ? { kind: "conflict" } : { kind: "accepted", row: toTerminalRow(row) };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async expireOrRequeue(client: PoolClient, authorizedDeviceIds: readonly string[]): Promise<void> {
    await client.query(
      `update device_commands
          set status=case
                when expires_at<=now() then 'expired'
                when attempt_count>=max_attempts then 'failed'
                else 'queued'
              end,
              terminal_error_code=case
                when expires_at<=now() then 'command_expired'
                when attempt_count>=max_attempts then 'attempts_exhausted'
                else null
              end,
              expired_at=case when expires_at<=now() then coalesce(expired_at,now()) else expired_at end,
              failed_at=case when expires_at>now() and attempt_count>=max_attempts then coalesce(failed_at,now()) else failed_at end,
              claim_owner=case when expires_at>now() and attempt_count<max_attempts then null else claim_owner end,
              claim_token=case when expires_at>now() and attempt_count<max_attempts then null else claim_token end,
              lease_expires_at=null
        where device_id=any($1::uuid[])
          and status=any($2::text[])
          and lease_expires_at<=now()`,
      [authorizedDeviceIds, ACTIVE_STATES],
    );
    await client.query(
      `update device_commands
          set status=case when expires_at<=now() then 'expired' else 'failed' end,
              terminal_error_code=case when expires_at<=now() then 'command_expired' else 'attempts_exhausted' end,
              expired_at=case when expires_at<=now() then coalesce(expired_at,now()) else expired_at end,
              failed_at=case when expires_at>now() then coalesce(failed_at,now()) else failed_at end
        where device_id=any($1::uuid[]) and status='queued'
          and (expires_at<=now() or attempt_count>=max_attempts)`,
      [authorizedDeviceIds],
    );
  }
}
