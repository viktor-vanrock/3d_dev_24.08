import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { canonicalRequestHash } from "../../_kernel/canonical-request-hash.ts";
import { PrintersRepository } from "../../printers/infrastructure/printers.repository.ts";
import { RelayControlRepository } from "./relay-control.repository.ts";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.RELAY_CONTROL_INTEGRATION_TEST === "1";

describe("RelayControlRepository integration", () => {
  it.skipIf(!DATABASE_URL || !ENABLED)("persists retry-safe session, revalidation and immutable transfer lifecycle", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const databaseName = (await pool.query<{ name: string }>("select current_database() as name")).rows[0]?.name ?? "";
    if (["portal", "portal_dev", "postgres"].includes(databaseName) || !/(?:^test_|^sandbox_|_test$|_sandbox$)/.test(databaseName)) {
      await pool.end();
      throw new Error(`refusing relay control integration test against non-disposable database '${databaseName}'`);
    }

    const repository = new RelayControlRepository(pool, new PrintersRepository(pool));
    const ownerId = randomUUID();
    const gatewayId = randomUUID();
    const deviceId = randomUUID();
    const transferId = randomUUID();
    const fingerprint = "a".repeat(64);
    const objectVersion = "etag:immutable";
    const now = new Date().toISOString();
    try {
      await pool.query(`insert into users(id,username) values($1,$2)`, [ownerId, `relay-owner-${ownerId}`]);
      await pool.query(`insert into agents(id,owner_id,relay_certificate_fingerprint_sha256) values($1,$2,$3)`, [gatewayId, ownerId, fingerprint]);
      await pool.query(`insert into user_printers(id,user_id,brand,model,link_source,agent_id,connection_mode) values($1,$2,'Test','Relay','agent',$3,'managed-bridge')`, [
        deviceId,
        ownerId,
        gatewayId,
      ]);
      await pool.query(
        `insert into device_transfers(id,device_id,actor_user_id,file_name,size_bytes,sha256,kind,object_key,object_version,content_type,source_ready_at)
         values($1,$2,$3,'part.gcode',2048,$4,'gcode',$5,$6,'model/gcode',now())`,
        [transferId, deviceId, ownerId, "b".repeat(64), `protected/device-transfers/${ownerId}/${transferId}/part.gcode`, objectVersion],
      );

      const authorizeRequest = {
        gateway_identity: gatewayId,
        certificate_fingerprint_sha256: fingerprint,
        protocol_version: "v1" as const,
        agent_version: "1.0.0",
        capabilities: ["heartbeat.v1" as const, "files.v1" as const],
      };
      const authorized = await repository.authorizeSession({
        operationId: randomUUID(),
        requestHash: canonicalRequestHash(authorizeRequest),
        connectionId: randomUUID(),
        request: authorizeRequest,
      });
      expect(authorized.authorized_devices).toEqual([{ device_id: deviceId, authorization_revision: 1 }]);
      expect(authorized.pending_transfer_ids).toEqual([transferId]);

      const metadata = await repository.getTransferMetadata({
        transferId,
        sessionId: authorized.session_id,
        sessionGeneration: authorized.session_generation,
      });
      expect(metadata).toMatchObject({ transfer_id: transferId, device_id: deviceId, kind: "gcode", object_version: objectVersion, next_offset: 0, next_sequence: 0 });

      const progressRequest = {
        session_id: authorized.session_id,
        session_generation: authorized.session_generation,
        object_version: objectVersion,
        next_offset: 1024,
        next_sequence: 1,
        observed_at: now,
      };
      const progressOperation = randomUUID();
      const progressHash = canonicalRequestHash(progressRequest);
      expect(await repository.writeTransferProgress({ operationId: progressOperation, requestHash: progressHash, transferId, request: progressRequest })).toMatchObject({
        next_offset: 1024,
        next_sequence: 1,
        replayed: false,
      });
      expect(await repository.writeTransferProgress({ operationId: progressOperation, requestHash: progressHash, transferId, request: progressRequest })).toMatchObject({
        replayed: true,
      });

      const resultRequest = {
        session_id: authorized.session_id,
        session_generation: authorized.session_generation,
        object_version: objectVersion,
        status: "completed" as const,
        next_offset: 2048,
        next_sequence: 2,
        observed_at: now,
      };
      const terminal = await repository.writeTransferResult({
        operationId: randomUUID(),
        requestHash: canonicalRequestHash(resultRequest),
        transferId,
        request: resultRequest,
      });
      expect(terminal).toMatchObject({ status: "completed", next_offset: 2048, replayed: false });
      await expect(
        repository.writeTransferResult({
          operationId: randomUUID(),
          requestHash: canonicalRequestHash({ ...resultRequest, status: "failed", error_code: "upload_failed" }),
          transferId,
          request: { ...resultRequest, status: "failed", error_code: "upload_failed" },
        }),
      ).rejects.toMatchObject({ code: "transfer_conflict" });

      await pool.query(`update agents set revoked_at=now(),revoked_reason='integration-test' where id=$1`, [gatewayId]);
      const revalidated = await repository.revalidateGateways({
        gateways: [
          {
            gateway_id: gatewayId,
            session_id: authorized.session_id,
            session_generation: authorized.session_generation,
            known_authorization_revision: authorized.authorization_revision,
          },
        ],
      });
      expect(revalidated.results).toEqual([expect.objectContaining({ gateway_id: gatewayId, state: "revoked", authorization_revision: 2, authorized_devices: [] })]);
    } finally {
      await pool.end();
    }
  });
});
