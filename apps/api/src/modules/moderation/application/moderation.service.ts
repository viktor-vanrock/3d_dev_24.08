import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { PROFILE_ADMIN_PORT, type ProfileAdminPort } from "../../profile/public/index.ts";
import type { ModerationPort } from "../public/index.ts";

@Injectable()
export class ModerationService implements ModerationPort {
  constructor(@Inject(PROFILE_ADMIN_PORT) private readonly profiles: ProfileAdminPort) {}

  async banUser(actorId: UserId, targetId: UserId): Promise<{ readonly id: UserId; readonly status: "banned" }> {
    if (!(await this.profiles.isStaff(actorId))) throw new ForbiddenException();
    if ((await this.profiles.banUser(targetId)) === "not_found") throw new NotFoundException();
    return { id: targetId, status: "banned" };
  }
}
