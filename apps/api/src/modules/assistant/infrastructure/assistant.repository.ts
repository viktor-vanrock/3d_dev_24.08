import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import {
  assistantMessageQuotaDaily,
  assistantMessageQuotaHourly,
  assistantRunEtaSecondsPerJob,
  assistantRunStaleTimeoutMinutes,
  deriveErrorCode,
  deriveResultKind,
  sanitizeRunResult,
  type AssistantMessageRow,
  type AssistantRunEventRow,
  type AssistantRunRow,
  type AssistantThreadRow,
  type RunQueueInfo,
} from "../domain/assistant.ts";
import type { AssistantIncidentPort, AssistantQueryExecutor } from "../public/index.ts";

const THREAD_COLUMNS = "id, owner_id, title, kind, device_id, severity, incident_status, read_at, created_at, updated_at";
const MESSAGE_COLUMNS = "id, thread_id, role, content, client_request_id, run_id, created_at";
const RUN_COLUMNS = "id, thread_id, triggering_message_id, user_id, message, status, result_type, result, error_code, confirmed_generation_id, created_at, updated_at";
const EVENT_COLUMNS = "id, run_id, seq, event_type, payload, created_at";
const MESSAGE_QUOTA_LOCK_NAMESPACE = 0x4d46_1997;
const RUN_EVENTS_LOCK_NAMESPACE = 0x4d46_1996;
const GENERATION_CONFIRM_LOCK_NAMESPACE = 0x4d46_1998;

export type MessageCreateResult =
  | { readonly kind: "created" | "replayed"; readonly message: AssistantMessageRow; readonly run: AssistantRunRow | null }
  | { readonly kind: "idempotency_conflict" }
  | { readonly kind: "hourly_limit" | "daily_limit"; readonly limit: number };

export interface GenerationOffer {
  readonly branch: unknown;
  readonly prompt: unknown;
  readonly params: unknown;
}

export type GenerationConfirmResult =
  | { readonly kind: "missing" }
  | { readonly kind: "already"; readonly generationId: string }
  | { readonly kind: "not_ready"; readonly status: string }
  | { readonly kind: "not_offer" }
  | { readonly kind: "offer"; readonly row: AssistantRunRow; readonly offer: GenerationOffer; readonly finish: (generationId: string) => Promise<void> };

@Injectable()
export class AssistantRepository implements AssistantIncidentPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async createThread(ownerId: UserId, title: string | null): Promise<AssistantThreadRow> {
    const row = (await this.pool.query<AssistantThreadRow>(`insert into assistant_threads (owner_id, title) values ($1, $2) returning ${THREAD_COLUMNS}`, [ownerId, title]))
      .rows[0];
    if (row === undefined) throw new Error("assistant thread insert returned no row");
    return row;
  }

  async listThreads(ownerId: UserId, cursor: string | null, limit: number): Promise<readonly AssistantThreadRow[]> {
    const values: unknown[] = [ownerId];
    const cursorSql = cursor === null ? "" : ` and created_at < $${values.push(cursor)}::timestamptz`;
    return (
      await this.pool.query<AssistantThreadRow>(
        `select ${THREAD_COLUMNS} from assistant_threads where owner_id = $1${cursorSql} order by created_at desc limit ${limit + 1}`,
        values,
      )
    ).rows;
  }

  async ownedThread(threadId: string, ownerId: UserId): Promise<AssistantThreadRow | null> {
    const row = (await this.pool.query<AssistantThreadRow>(`select ${THREAD_COLUMNS} from assistant_threads where id = $1`, [threadId])).rows[0];
    return row?.owner_id === ownerId ? row : null;
  }

  async markRead(threadId: string): Promise<AssistantThreadRow> {
    const row = (await this.pool.query<AssistantThreadRow>(`update assistant_threads set read_at = coalesce(read_at, now()) where id = $1 returning ${THREAD_COLUMNS}`, [threadId]))
      .rows[0];
    if (row === undefined) throw new Error("assistant thread read update returned no row");
    return row;
  }

  async transitionIncidentThread(executor: AssistantQueryExecutor, input: { readonly threadId: string; readonly status: "acknowledged" | "resolved" }): Promise<void> {
    await executor.query(`update assistant_threads set incident_status=$2,updated_at=now() where id=$1`, [input.threadId, input.status]);
  }

  async listMessages(threadId: string, cursor: string | null, limit: number): Promise<readonly AssistantMessageRow[]> {
    const values: unknown[] = [threadId];
    const cursorSql = cursor === null ? "" : ` and created_at < $${values.push(cursor)}::timestamptz`;
    return (
      await this.pool.query<AssistantMessageRow>(
        `select ${MESSAGE_COLUMNS} from assistant_messages where thread_id = $1${cursorSql} order by created_at desc, id desc limit ${limit + 1}`,
        values,
      )
    ).rows;
  }

  async createMessage(thread: AssistantThreadRow, content: string, clientRequestId: string): Promise<MessageCreateResult> {
    return this.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock($1, hashtext($2))", [MESSAGE_QUOTA_LOCK_NAMESPACE, thread.owner_id]);
      const existing = (
        await client.query<AssistantMessageRow>(`select ${MESSAGE_COLUMNS} from assistant_messages where thread_id = $1 and client_request_id = $2`, [thread.id, clientRequestId])
      ).rows[0];
      if (existing !== undefined) {
        if (existing.content !== content) return { kind: "idempotency_conflict" };
        const run = (await client.query<AssistantRunRow>(`select ${RUN_COLUMNS} from assistant_runs where triggering_message_id = $1`, [existing.id])).rows[0] ?? null;
        return { kind: "replayed", message: existing, run };
      }
      const usage = (
        await client.query<{ hourly: string; daily: string }>(
          `select count(*) filter (where m.created_at > now() - interval '1 hour') as hourly, count(*) filter (where m.created_at > now() - interval '1 day') as daily from assistant_messages m join assistant_threads t on t.id = m.thread_id where t.owner_id = $1 and m.role = 'user' and m.created_at > now() - interval '1 day'`,
          [thread.owner_id],
        )
      ).rows[0];
      const hourlyLimit = assistantMessageQuotaHourly();
      const dailyLimit = assistantMessageQuotaDaily();
      if (Number(usage?.hourly ?? 0) >= hourlyLimit) return { kind: "hourly_limit", limit: hourlyLimit };
      if (Number(usage?.daily ?? 0) >= dailyLimit) return { kind: "daily_limit", limit: dailyLimit };
      const message = (
        await client.query<AssistantMessageRow>(
          `insert into assistant_messages (thread_id, role, content, client_request_id) values ($1, 'user', $2, $3) returning ${MESSAGE_COLUMNS}`,
          [thread.id, content, clientRequestId],
        )
      ).rows[0];
      if (message === undefined) throw new Error("assistant message insert returned no row");
      const run = (
        await client.query<AssistantRunRow>(`insert into assistant_runs (thread_id, triggering_message_id, user_id, message) values ($1, $2, $3, $4) returning ${RUN_COLUMNS}`, [
          thread.id,
          message.id,
          thread.owner_id,
          content,
        ])
      ).rows[0];
      if (run === undefined) throw new Error("assistant run insert returned no row");
      await client.query("update assistant_threads set updated_at = now() where id = $1", [thread.id]);
      return { kind: "created", message, run };
    });
  }

  async runInThread(runId: string, threadId: string): Promise<AssistantRunRow | null> {
    return (await this.pool.query<AssistantRunRow>(`select ${RUN_COLUMNS} from assistant_runs where id = $1 and thread_id = $2`, [runId, threadId])).rows[0] ?? null;
  }

  async ownedRun(runId: string, ownerId: UserId): Promise<AssistantRunRow | null> {
    return (
      (
        await this.pool.query<AssistantRunRow>(
          `select r.id, r.thread_id, r.triggering_message_id, r.user_id, r.message, r.status, r.result_type, r.result, r.error_code, r.confirmed_generation_id, r.created_at, r.updated_at from assistant_runs r join assistant_threads t on t.id = r.thread_id where r.id = $1 and t.owner_id = $2`,
          [runId, ownerId],
        )
      ).rows[0] ?? null
    );
  }

  async resolveStale(row: AssistantRunRow): Promise<AssistantRunRow> {
    if (row.status !== "queued" && row.status !== "running") return row;
    const cutoff = new Date(Date.now() - assistantRunStaleTimeoutMinutes() * 60_000);
    if (row.updated_at > cutoff) return row;
    return (
      (
        await this.pool.query<AssistantRunRow>(
          `update assistant_runs set status = 'error', result_type = 'error', error_code = 'timeout', updated_at = now() where id = $1 and status in ('queued', 'running') and updated_at < $2 returning ${RUN_COLUMNS}`,
          [row.id, cutoff],
        )
      ).rows[0] ?? row
    );
  }

  async queueInfo(row: AssistantRunRow): Promise<RunQueueInfo | null> {
    if (row.status !== "queued") return null;
    const ahead =
      (await this.pool.query<{ ahead: string }>("select count(*) as ahead from assistant_runs where status = 'queued' and created_at < $1", [row.created_at])).rows[0]?.ahead ??
      "0";
    const position = Number(ahead) + 1;
    return { position, eta_seconds: position * assistantRunEtaSecondsPerJob() };
  }

  async freshRun(runId: string): Promise<AssistantRunRow | null> {
    return (await this.pool.query<AssistantRunRow>(`select ${RUN_COLUMNS} from assistant_runs where id = $1`, [runId])).rows[0] ?? null;
  }

  async ensureRunEvents(run: AssistantRunRow): Promise<readonly AssistantRunEventRow[]> {
    if (run.status !== "done" && run.status !== "error") return this.loadRunEvents(run.id);
    return this.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock($1, hashtext($2))", [RUN_EVENTS_LOCK_NAMESPACE, run.id]);
      const existing = (await client.query<AssistantRunEventRow>(`select ${EVENT_COLUMNS} from assistant_run_events where run_id = $1 order by seq asc`, [run.id])).rows;
      if (existing.some((event) => event.event_type === "assistant.completed" || event.event_type === "assistant.error")) return existing;
      let nextSeq = (existing.at(-1)?.seq ?? 0) + 1;
      const rows = [...existing];
      if (run.status === "done") {
        const delta = (
          await client.query<AssistantRunEventRow>(
            `insert into assistant_run_events (run_id, seq, event_type, payload) values ($1, $2, 'assistant.delta', $3) returning ${EVENT_COLUMNS}`,
            [run.id, nextSeq, JSON.stringify(sanitizeRunResult(run.result, deriveResultKind(run), run.id))],
          )
        ).rows[0];
        if (delta === undefined) throw new Error("assistant delta insert returned no row");
        rows.push(delta);
        nextSeq += 1;
        const completed = (
          await client.query<AssistantRunEventRow>(
            `insert into assistant_run_events (run_id, seq, event_type, payload) values ($1, $2, 'assistant.completed', $3) returning ${EVENT_COLUMNS}`,
            [run.id, nextSeq, JSON.stringify({ status: "done" })],
          )
        ).rows[0];
        if (completed === undefined) throw new Error("assistant completed insert returned no row");
        rows.push(completed);
      } else {
        const error = (
          await client.query<AssistantRunEventRow>(
            `insert into assistant_run_events (run_id, seq, event_type, payload) values ($1, $2, 'assistant.error', $3) returning ${EVENT_COLUMNS}`,
            [run.id, nextSeq, JSON.stringify({ error_code: deriveErrorCode(run) })],
          )
        ).rows[0];
        if (error === undefined) throw new Error("assistant error event insert returned no row");
        rows.push(error);
      }
      return rows;
    });
  }

  async beginGenerationConfirm(threadId: string, runId: string): Promise<{ readonly result: GenerationConfirmResult; readonly release: (commit: boolean) => Promise<void> }> {
    const client = await this.pool.connect();
    let finished = false;
    const release = async (commit: boolean) => {
      if (finished) return;
      finished = true;
      try {
        await client.query(commit ? "commit" : "rollback");
      } finally {
        client.release();
      }
    };
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock($1, hashtext($2))", [GENERATION_CONFIRM_LOCK_NAMESPACE, runId]);
      const row = (await client.query<AssistantRunRow>(`select ${RUN_COLUMNS} from assistant_runs where id = $1 and thread_id = $2 for update`, [runId, threadId])).rows[0];
      if (row === undefined) return { result: { kind: "missing" }, release };
      if (row.confirmed_generation_id !== null) return { result: { kind: "already", generationId: row.confirmed_generation_id }, release };
      if (row.status !== "done") return { result: { kind: "not_ready", status: row.status }, release };
      if (deriveResultKind(row) !== "generation_offer") return { result: { kind: "not_offer" }, release };
      const offer = row.result as { readonly branch?: unknown; readonly prompt_summary?: unknown; readonly prompt?: unknown; readonly params?: unknown };
      return {
        result: {
          kind: "offer",
          row,
          offer: { branch: offer.branch, prompt: typeof offer.prompt_summary === "string" ? offer.prompt_summary : offer.prompt, params: offer.params },
          finish: async (generationId: string) => {
            await client.query("update assistant_runs set confirmed_generation_id = $2, updated_at = now() where id = $1", [row.id, generationId]);
          },
        },
        release,
      };
    } catch (error) {
      await release(false).catch(() => undefined);
      throw error;
    }
  }

  private async loadRunEvents(runId: string): Promise<readonly AssistantRunEventRow[]> {
    return (await this.pool.query<AssistantRunEventRow>(`select ${EVENT_COLUMNS} from assistant_run_events where run_id = $1 order by seq asc`, [runId])).rows;
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
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
}
