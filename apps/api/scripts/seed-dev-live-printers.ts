import type { Pool } from "pg";

// MF-1952: до этой карточки на dev.3mf.tech не было ни одного user_printers, воспроизводимо
// покрывающего весь контракт `GET /me/printers/:id/live` (apps/api/src/profile/activation.ts,
// live_availability_reason из apps/api/src/profile/contract.ts::resolveOperatingState) —
// служебная webcheck-сессия (`autofab-agent`, docs/infra/dev.md § «Как зайти») либо получала
// 404 на несуществующий id, либо натыкалась на органически накопленные тестовые принтеры без
// задокументированных id/состояний. Здесь — 7 детерминированных id под её же учёткой.
//
// Владение фикстурой — accepted-владелец = устройства/контракт (Back), фикстура data-only:
// команды не шлём, удалённое управление не заводим (device_commands/agents-протокол не трогаем).
export const DEV_LIVE_PRINTER_OWNER_USERNAME = "autofab-agent";

// "available" (printing/paused/error) — честная деградация: device_state.updated_at ставится в
// now() каждым прогоном upsertDevLivePrinterFixtures(), а DEVICE_STATE_STALE_AFTER_MS (45с,
// contract.ts) неумолимо переводит их в "stale" после — как и настоящая телеметрия. Освежить
// без полного seed:dev — `pnpm --filter @portal/api seed:dev:live-printers` (touch-dev-live-printers.ts).
const HEALTHY_AGENT_ID = "10000000-1952-4000-8000-000000000001";
const REVOKED_AGENT_ID = "10000000-1952-4000-8000-000000000002";

export type DevLivePrinterFixtureKey = "no_telemetry_channel" | "printing" | "paused" | "error" | "offline" | "stale" | "permission_denied";

interface DevLivePrinterDeviceState {
  status: "printing" | "paused" | "error" | "offline" | "ready";
  progress: number | null;
  /** "now" — свежо (available-путь), "stale" — искусственно состарено (>45с). */
  freshness: "now" | "stale";
}

export interface DevLivePrinterFixture {
  key: DevLivePrinterFixtureKey;
  id: string;
  brand: string;
  model: string;
  linkSource: "manual" | "agent";
  connectionMode: "list" | "managed-bridge";
  agentId: string | null;
  deviceState: DevLivePrinterDeviceState | null;
  /** Ожидаемый live_availability_reason — задокументированный контракт, сверяется тестом. */
  expectedLiveAvailabilityReason: string;
}

export const DEV_LIVE_PRINTER_FIXTURES: readonly DevLivePrinterFixture[] = [
  {
    key: "no_telemetry_channel",
    id: "20000000-1952-4000-8000-000000000001",
    brand: "MF-1952 Fixture",
    model: "no_telemetry_channel",
    linkSource: "manual",
    connectionMode: "list",
    agentId: null,
    deviceState: null,
    expectedLiveAvailabilityReason: "no_telemetry_channel",
  },
  {
    key: "printing",
    id: "20000000-1952-4000-8000-000000000002",
    brand: "MF-1952 Fixture",
    model: "printing (available)",
    linkSource: "agent",
    connectionMode: "managed-bridge",
    agentId: HEALTHY_AGENT_ID,
    deviceState: { status: "printing", progress: 63.5, freshness: "now" },
    expectedLiveAvailabilityReason: "available",
  },
  {
    key: "paused",
    id: "20000000-1952-4000-8000-000000000003",
    brand: "MF-1952 Fixture",
    model: "paused (available)",
    linkSource: "agent",
    connectionMode: "managed-bridge",
    agentId: HEALTHY_AGENT_ID,
    deviceState: { status: "paused", progress: 30, freshness: "now" },
    expectedLiveAvailabilityReason: "available",
  },
  {
    key: "error",
    id: "20000000-1952-4000-8000-000000000004",
    brand: "MF-1952 Fixture",
    model: "error (available)",
    linkSource: "agent",
    connectionMode: "managed-bridge",
    agentId: HEALTHY_AGENT_ID,
    deviceState: { status: "error", progress: null, freshness: "now" },
    expectedLiveAvailabilityReason: "available",
  },
  {
    key: "offline",
    id: "20000000-1952-4000-8000-000000000005",
    brand: "MF-1952 Fixture",
    model: "offline",
    linkSource: "agent",
    connectionMode: "managed-bridge",
    agentId: HEALTHY_AGENT_ID,
    deviceState: { status: "offline", progress: null, freshness: "now" },
    expectedLiveAvailabilityReason: "offline",
  },
  {
    key: "stale",
    id: "20000000-1952-4000-8000-000000000006",
    brand: "MF-1952 Fixture",
    model: "stale",
    linkSource: "agent",
    connectionMode: "managed-bridge",
    agentId: HEALTHY_AGENT_ID,
    deviceState: { status: "ready", progress: 12, freshness: "stale" },
    expectedLiveAvailabilityReason: "stale",
  },
  {
    key: "permission_denied",
    id: "20000000-1952-4000-8000-000000000007",
    brand: "MF-1952 Fixture",
    model: "permission_denied",
    linkSource: "agent",
    connectionMode: "managed-bridge",
    agentId: REVOKED_AGENT_ID,
    deviceState: { status: "offline", progress: null, freshness: "now" },
    expectedLiveAvailabilityReason: "permission_denied",
  },
] as const;

export interface DevLivePrinterUpsertResult {
  ownerUserId: string;
  printerIds: Record<DevLivePrinterFixtureKey, string>;
}

async function resolveOwnerUserId(db: Pool): Promise<string> {
  // ON CONFLICT (username) DO UPDATE только updated_at — на dev эта строка уже существует
  // (заведена Ops для webcheck, docs/infra/dev.md), трогать её display_name/role нельзя;
  // в тестовой/пустой БД insert сам заводит минимальную строку.
  const { rows } = await db.query<{ id: string }>(
    `insert into users (username, status, handle_confirmed)
     values ($1, 'active', true)
     on conflict (username) do update set updated_at = now()
     returning id`,
    [DEV_LIVE_PRINTER_OWNER_USERNAME],
  );
  return rows[0]!.id;
}

/**
 * Идемпотентно публикует 7 фикстур user_printers под autofab-agent, покрывающих весь
 * live_availability_reason-контракт GET /me/printers/:id/live (MF-1952). Безопасно перезапускать
 * (upsert по фиксированным id) — вызывается и из seed-dev.ts, и отдельно из
 * touch-dev-live-printers.ts (только освежить updated_at "available"-строк).
 */
export async function upsertDevLivePrinterFixtures(db: Pool): Promise<DevLivePrinterUpsertResult> {
  const ownerUserId = await resolveOwnerUserId(db);

  await db.query(
    `insert into agents (id, owner_id, status, revoked_at)
     values ($1, $2, 'online', null)
     on conflict (id) do update set owner_id = excluded.owner_id, status = 'online', revoked_at = null`,
    [HEALTHY_AGENT_ID, ownerUserId],
  );
  await db.query(
    `insert into agents (id, owner_id, status, revoked_at, revoked_reason)
     values ($1, $2, 'offline', now(), 'MF-1952 fixture: демонстрация permission_denied')
     on conflict (id) do update set
       owner_id = excluded.owner_id, status = 'offline', revoked_at = now(), revoked_reason = excluded.revoked_reason`,
    [REVOKED_AGENT_ID, ownerUserId],
  );

  const printerIds = {} as Record<DevLivePrinterFixtureKey, string>;
  for (const fixture of DEV_LIVE_PRINTER_FIXTURES) {
    await db.query(
      `insert into user_printers (id, user_id, brand, model, link_source, connection_mode, agent_id, verified, is_primary)
       values ($1, $2, $3, $4, $5, $6, $7, $8, false)
       on conflict (id) do update set
         user_id = excluded.user_id, brand = excluded.brand, model = excluded.model,
         link_source = excluded.link_source, connection_mode = excluded.connection_mode,
         agent_id = excluded.agent_id, verified = excluded.verified, is_primary = false`,
      [fixture.id, ownerUserId, fixture.brand, fixture.model, fixture.linkSource, fixture.connectionMode, fixture.agentId, fixture.linkSource !== "manual"],
    );

    if (fixture.deviceState) {
      const updatedAtExpr = fixture.deviceState.freshness === "stale" ? "now() - interval '2 minutes'" : "now()";
      await db.query(
        `insert into device_state (device_id, status, progress, updated_at)
         values ($1, $2, $3, ${updatedAtExpr})
         on conflict (device_id) do update set status = excluded.status, progress = excluded.progress, updated_at = ${updatedAtExpr}`,
        [fixture.id, fixture.deviceState.status, fixture.deviceState.progress],
      );
    } else {
      // no_telemetry_channel демонстрируется как "агент никогда не отчитывался" — та же форма,
      // что тест "404s when the printer has no device_state row" в activation.test.ts.
      await db.query(`delete from device_state where device_id = $1`, [fixture.id]);
    }

    printerIds[fixture.key] = fixture.id;
  }

  return { ownerUserId, printerIds };
}
