import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { PROFILE_ADMIN_PORT, type ProfileAdminPort } from "../../profile/public/index.ts";
import { DEVICE_ADMIN_PORT, DEVICE_RELAY_PUSH_PORT, type DeviceAdminPort, type DeviceRelayPushPort } from "../../devices/public/index.ts";
import type { ModerationPort } from "../public/index.ts";
import { MetricsService } from "../../../nest/observability/metrics.service.ts";

@Injectable()
export class ModerationService implements ModerationPort {
  constructor(
    @Inject(PROFILE_ADMIN_PORT) private readonly profiles: ProfileAdminPort,
    @Inject(DEVICE_ADMIN_PORT) private readonly devices: DeviceAdminPort,
    @Inject(DEVICE_RELAY_PUSH_PORT) private readonly relayControl: DeviceRelayPushPort,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  async banUser(actorId: UserId, targetId: UserId): Promise<{ readonly id: UserId; readonly status: "banned" }> {
    if (!(await this.profiles.isStaff(actorId))) throw new ForbiddenException();
    const ban = await this.profiles.banUser(targetId);
    if (ban === "not_found") throw new NotFoundException();
    if (ban.transitioned) this.metrics.incCredentialRevocation("session", "admin_ban");
    const revokedIds = await this.devices.revokeAllActiveByOwner(targetId, "owner_blocked", actorId);
    for (const _agentId of revokedIds) this.metrics.incCredentialRevocation("device_agent", "cascade_ban");
    void this.relayControl.closeAgentSessions(revokedIds, "owner_blocked").catch(() => undefined);
    return { id: targetId, status: "banned" };
  }
}
