# Device-agent asymmetric-trust migration and canary

## Compatibility matrix

| Backend issuance | Relay | Agent | Enrollment | Remote commands |
| --- | --- | --- | --- | --- |
| Legacy HS256 only | protocol v1 | legacy agent | legacy identity | legacy migration surface only |
| Ed25519 available, legacy retained | protocol v1 with current revalidation | legacy agent | legacy identity | disabled for the new-agent rollout cohort |
| Ed25519 available | protocol v1 with revoke propagation | new agent with asymmetric verifier | successful CSR re-enrollment | enabled after capability and identity gates pass |
| Ed25519 only | protocol v1 with revoke propagation | fully migrated new agent | individual identity | enabled |

The remote-command gate requires both the asymmetric-verifier capability and successful CSR re-enrollment for the current gateway identity. Version alone is insufficient. If either fact is absent, the backend does not issue/deliver a command to that device. The new agent never accepts HS256, including during rollback.

Legacy backend issuance may remain temporarily for devices outside the selected migration cohort. It is removed only after deployment evidence confirms fleet migration; repository-local tests cannot satisfy that rollout gate.

## Canary plan

Start with the smallest operationally useful group: one internal gateway per supported connector and no more than 1% of the future fleet, whichever is smaller. Exclude gateways running safety-critical or unattended long prints. Use an observation window of at least 24 hours and include one planned reconnect, command-key overlap/retirement, revoke/recovery, resumable transfer, and application rollback drill.

Track, per gateway and version:

- `health.v1` status/reason/revision and time to `hello_ack`;
- reconnect count, backoff exhaustion, stale-generation events, and revoke propagation latency;
- rejected token reasons, especially unknown `kid`, gateway mismatch, replay, expiry, and algorithm downgrade;
- transfer resume offset, quarantine/reconciliation counts, duplicate frames, and upload/start-print side-effect count;
- artifact checksum/signature, active and previous release, and rollback outcome.

Stop the canary on any accepted cross-gateway or HS256 token, remote admission before authorization, revoke outside the declared bound, corrupted/lost spool, repeated upload/start-print, unsafe downgrade, signature bypass, or rollback that deletes state. Also stop on a sustained health/reconnect regression beyond the predeclared baseline.

Rollback disables remote commands for the affected cohort, then atomically switches to the last spool-compatible asymmetric-verifier release. It does not restore `COMMAND_TOKEN_SECRET`. If no compatible safe release exists, keep remote operations disabled and preserve local printing plus diagnostic state until a fixed signed release is available.

Expansion requires a completed observation window with no stop criterion, reviewed evidence, and an explicit environment/fleet decision. This repository-local change does not perform that expansion.

