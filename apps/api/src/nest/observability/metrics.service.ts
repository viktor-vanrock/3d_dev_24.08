import { Injectable } from "@nestjs/common";
import { Counter, Registry } from "prom-client";

export const REVOKED_CREDENTIAL_TYPES = ["session", "public_api_key_v0", "research_key", "feed_ingest_key", "agent_content_key"] as const;
export type RevokedCredentialType = (typeof REVOKED_CREDENTIAL_TYPES)[number];

export const REVOKED_CREDENTIAL_REASONS = ["revoked", "expired", "user_blocked", "version_mismatch", "unknown", "invalid_token"] as const;
export type RevokedCredentialReason = (typeof REVOKED_CREDENTIAL_REASONS)[number];

export const REVOCATION_CREDENTIAL_TYPES = ["session", "public_api_key_v0", "user_api_key", "agent_content_key", "device_agent"] as const;
export type RevocationCredentialType = (typeof REVOCATION_CREDENTIAL_TYPES)[number];

export const CREDENTIAL_REVOCATION_TRIGGERS = ["user_action", "admin_ban", "admin_delete", "rotate", "logout_all", "cascade_ban"] as const;
export type CredentialRevocationTrigger = (typeof CREDENTIAL_REVOCATION_TRIGGERS)[number];

export const RELAY_PUSH_CLOSE_OUTCOMES = ["sent", "failed", "agent_not_connected"] as const;
export type RelayPushCloseOutcome = (typeof RELAY_PUSH_CLOSE_OUTCOMES)[number];

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly revokedCredentialUse = new Counter({
    name: "revoked_credential_use_total",
    help: "Rejected credential uses by credential type and reason.",
    labelNames: ["credential_type", "reason"] as const,
    registers: [this.registry],
  });
  private readonly credentialRevocations = new Counter({
    name: "credential_revocations_total",
    help: "Credential state transitions to revoked by credential type and trigger.",
    labelNames: ["credential_type", "trigger"] as const,
    registers: [this.registry],
  });
  private readonly relayPushClose = new Counter({
    name: "relay_push_close_total",
    help: "Relay session close push outcomes.",
    labelNames: ["outcome"] as const,
    registers: [this.registry],
  });

  incRevokedCredentialUse(credentialType: RevokedCredentialType, reason: RevokedCredentialReason): void {
    this.revokedCredentialUse.inc({ credential_type: credentialType, reason });
  }

  incCredentialRevocation(credentialType: RevocationCredentialType, trigger: CredentialRevocationTrigger): void {
    this.credentialRevocations.inc({ credential_type: credentialType, trigger });
  }

  incRelayPushClose(outcome: RelayPushCloseOutcome): void {
    this.relayPushClose.inc({ outcome });
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }
}
