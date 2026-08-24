import { afterEach, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import {
  NoActiveChallengeError,
  NotFoundError,
  confirmChallenge,
  importOwnershipStatusForModel,
  listConnectionsWithBindings,
  markConnectionVerifiedByAuth,
  requestChallenge,
} from "./import-ownership.repository.ts";

const userIds: string[] = [];

async function createUser(): Promise<string> {
  const result = await pool.query<{ id: string }>(`insert into users (username) values ($1) returning id`, [`ownership-test-${Date.now()}-${Math.random().toString(36).slice(2)}`]);
  const userId = result.rows[0]!.id;
  userIds.push(userId);
  return userId;
}

async function createConnection(userId: string, overrides?: { challengeToken?: string }): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into import_connections (user_id, source_platform, credential_enc, challenge_token)
     values ($1, 'cults3d', $2, $3) returning id`,
    [userId, Buffer.from("fake-encrypted"), overrides?.challengeToken ?? null],
  );
  return result.rows[0]!.id;
}

async function createProjectModel(userId: string): Promise<{ projectId: string; childModelId: string }> {
  const result = await pool.query<{ project_id: string; child_model_id: string }>(
    `with ids as (
       select gen_random_uuid() as project_id, gen_random_uuid() as child_id, gen_random_uuid() as revision_id
     ), p as (
       insert into projects (id, owner_id, title, primary_model_id)
       select project_id, $1, 'imported', child_id from ids returning id
     ), m as (
       insert into models (id, project_id, name, position, latest_revision_id, active_revision_id)
       select child_id, project_id, 'imported', 0, revision_id, revision_id from ids returning id, project_id
     ), r as (
       insert into model_revisions (id, model_id, source_format, status, source_checksum, source_size_bytes, ready_at)
       select revision_id, child_id, 'stl', 'ready', decode(repeat('00', 32), 'hex'), 0, now() from ids
     )
     select project_id, id as child_model_id from m`,
    [userId],
  );
  return {
    projectId: result.rows[0]!.project_id,
    childModelId: result.rows[0]!.child_model_id,
  };
}

async function createBoundModel(userId: string, connectionId: string, externalIdSeed: string): Promise<{ projectId: string; childModelId: string }> {
  const model = await createProjectModel(userId);
  const externalId = `${externalIdSeed}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await pool.query(
    `insert into import_bindings (model_id, connection_id, user_id, source_platform, external_id, original_url)
     values ($1, $2, $3, 'cults3d', $4, 'https://cults3d.com/x')`,
    [model.childModelId, connectionId, userId, externalId],
  );
  return model;
}

afterEach(async () => {
  if (userIds.length === 0) return;
  await pool.query(`delete from projects where owner_id = any($1::uuid[])`, [userIds]);
  await pool.query(`delete from users where id = any($1::uuid[])`, [userIds.splice(0)]);
});

// Режим 1 (API-ключевые коннекторы, эпик MF-37 § 6): сам факт валидной авторизации доказывает
// владение — коннектор зовёт markConnectionVerifiedByAuth() после первого успешного запроса.
describe("markConnectionVerifiedByAuth", () => {
  it("verifies the connection and denormalizes ownership_status onto its bindings", async () => {
    const userId = await createUser();
    const connectionId = await createConnection(userId);
    const { childModelId } = await createBoundModel(userId, connectionId, "ext-auth-1");

    await markConnectionVerifiedByAuth(connectionId);

    const connection = await pool.query<{ ownership_status: string; verified_at: Date | null }>(`select ownership_status, verified_at from import_connections where id = $1`, [
      connectionId,
    ]);
    expect(connection.rows[0]!.ownership_status).toBe("verified");
    expect(connection.rows[0]!.verified_at).not.toBeNull();

    const binding = await pool.query<{ ownership_status: string }>(`select ownership_status from import_bindings where model_id = $1`, [childModelId]);
    expect(binding.rows[0]!.ownership_status).toBe("verified");
  });
});

// Режим 2: challenge-строка для источников без API-ключа.
describe("requestChallenge / confirmChallenge", () => {
  it("generates a token, moves the connection to pending, and rejects requests for someone else's connection", async () => {
    const userId = await createUser();
    const otherUserId = await createUser();
    const connectionId = await createConnection(userId);

    const { token } = await requestChallenge(userId, connectionId, "bio");
    expect(token).toMatch(/^3mf-verify-/);

    const connection = await pool.query<{ ownership_status: string; challenge_token: string | null }>(
      `select ownership_status, challenge_token from import_connections where id = $1`,
      [connectionId],
    );
    expect(connection.rows[0]!.ownership_status).toBe("pending");
    expect(connection.rows[0]!.challenge_token).toBe(token);

    await expect(requestChallenge(otherUserId, connectionId, "bio")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("verifies ownership when the observed text contains the challenge token and clears it after", async () => {
    const userId = await createUser();
    const connectionId = await createConnection(userId);
    const { projectId } = await createBoundModel(userId, connectionId, "ext-challenge-1");

    const { token } = await requestChallenge(userId, connectionId, "bio");
    const status = await confirmChallenge(userId, connectionId, `my bio says ${token} right here`);
    expect(status).toBe("verified");

    const connection = await pool.query<{ ownership_status: string; challenge_token: string | null }>(
      `select ownership_status, challenge_token from import_connections where id = $1`,
      [connectionId],
    );
    expect(connection.rows[0]!.ownership_status).toBe("verified");
    expect(connection.rows[0]!.challenge_token).toBeNull();

    expect(await importOwnershipStatusForModel(projectId)).toBe("verified");
  });

  it("rejects ownership when the observed text does not contain the challenge token", async () => {
    const userId = await createUser();
    const connectionId = await createConnection(userId);
    await createBoundModel(userId, connectionId, "ext-challenge-2");

    await requestChallenge(userId, connectionId, "bio");
    const status = await confirmChallenge(userId, connectionId, "unrelated bio text");
    expect(status).toBe("rejected");

    const connection = await pool.query<{ ownership_status: string }>(`select ownership_status from import_connections where id = $1`, [connectionId]);
    expect(connection.rows[0]!.ownership_status).toBe("rejected");
  });

  it("throws NoActiveChallengeError when no challenge was requested", async () => {
    const userId = await createUser();
    const connectionId = await createConnection(userId);
    await expect(confirmChallenge(userId, connectionId, "anything")).rejects.toBeInstanceOf(NoActiveChallengeError);
  });
});

describe("importOwnershipStatusForModel", () => {
  it("returns null for a model without an import binding", async () => {
    const userId = await createUser();
    const { projectId } = await createProjectModel(userId);
    expect(await importOwnershipStatusForModel(projectId)).toBeNull();
  });
});

describe("listConnectionsWithBindings", () => {
  it("returns only the requesting user's connections and bindings", async () => {
    const userId = await createUser();
    const otherUserId = await createUser();
    const connectionId = await createConnection(userId);
    await createConnection(otherUserId);
    const { childModelId } = await createBoundModel(userId, connectionId, "ext-list-1");

    const { connections, bindings } = await listConnectionsWithBindings(userId);
    expect(connections).toHaveLength(1);
    expect(connections[0]!.id).toBe(connectionId);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.model_id).toBe(childModelId);
  });
});
