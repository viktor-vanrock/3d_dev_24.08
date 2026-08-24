# Device-agent identity, recovery, and transfer operations

This runbook covers the repository-local operating contract for an individual device-agent. It never requires copying a private key to the API or Relay. Raw enrollment/recovery credentials, private keys, tokens, and certificate contents must not be written to tickets, shell history, logs, or evidence files.

## Initial enrollment

1. Verify the gateway ID and owner in the portal and issue one short-lived enrollment credential for that gateway.
2. Run the installed bundle as the service account: `sudo -u 3mf-agent env MULTICA_API_URL=... MULTICA_ENROLL_CODE=... MULTICA_AGENT_HOME=/var/lib/3mf-device-agent node /opt/3mf-device-agent/current/.release-dist/main.js --enroll`. The command generates `gateway-key.pending.pem` locally and submits only the CSR and one-time credential.
3. Verify that the activated files `agent-identity.json`, `gateway-key.pem`, certificate/CA files and `command-verification-keys.json` are mode `0600`; the release directory must not contain credentials. Verify that the returned certificate SAN is exactly `urn:portal:gateway:<gateway-id>` and the command verification set contains only bounded Ed25519 public keys.
4. Start the agent and verify `health.v1`. Remote admission must remain closed until Moonraker is ready and the current Relay generation has received `hello_ack`.
5. Record only gateway ID, agent version, certificate fingerprint, health revision, and timestamp. Never record the raw bootstrap credential or private key.

An expired or consumed credential is not retried. Issue a new credential after diagnosing the failed attempt.

## Certificate and command-key rotation

For certificate rotation, generate a new local private key and CSR, use a one-time recovery credential, and atomically install the returned certificate/key files. Confirm a successful connection with the new fingerprint before removing the old local material. The backend invalidates the old fingerprint as part of recovery; it is not retained as a fallback identity.

For command verification-key rotation, distribute the new public key with a distinct `kid` while the previous public key remains inside the bounded overlap window. Verify commands signed by both active key IDs, then retire the old key and confirm that tokens using its `kid` are rejected. Never restore HS256 or a fleet-wide signing secret as a rollback mechanism.

## Revoke and recovery

Revoke the gateway in the portal, then confirm within the configured revalidation bound that the active Relay session closes and health reports `revoked` with HTTP 503. New remote commands and file operations must be rejected without reaching the printer. Revocation alone must not issue pause, cancel, or stop to a locally running print.

Recovery requires a new one-time recovery credential and `--recover`, which creates a new pending private key and CSR without overwriting the active key before a valid response. After recovery, confirm the new fingerprint and a new Relay session generation. The old fingerprint and any old recovery credential must remain unusable.

## Quarantine inspection and explicit reset

Do not edit spool JSON or partial data in place. Stop the agent, copy the quarantined transfer directory to protected diagnostic storage, and record only transfer ID, schema version, state checksum result, committed offset, data length, phase, and reason code. Do not attach printable content unless a separate data-handling decision authorizes it.

Reset is explicit and scoped to one transfer ID:

1. Confirm no active Relay delivery or Moonraker upload/start operation exists for that transfer.
2. Preserve the quarantine evidence.
3. Use the agent reset operation for the exact transfer ID; never recursively delete the whole state directory.
4. Restart the transfer from a newly authorized source/version and verify offset zero.

Unknown spool schemas, state-ahead-of-data, checksum mismatch, and uncertain upload/start-print results are never automatically repaired. An uncertain external side effect remains `reconciliation_required` until Moonraker state proves the result or an operator resolves it.

## Safe application rollback

Rollback switches only the versioned release symlink. Configuration, individual credentials, spool, and terminal ledgers remain outside the release directory. The installer must block a downgrade whose manifest cannot read the on-disk spool schema. After rollback, verify artifact signature/checksum, health, active version/commit, and that no remote command was admitted before authorization. Rollback must not restore a shared signing secret or delete quarantined state.
