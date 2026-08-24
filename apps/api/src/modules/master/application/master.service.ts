import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { PROFILE_MASTER_PORT, type ProfileMasterPort } from "../../profile/public/index.ts";
import { MASTER_PROFILE_LIMITS, masterProfile, sanitizeMasterField, type MasterProfile } from "../domain/master.ts";
import type { MasterPort } from "../public/index.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class MasterService implements MasterPort {
  constructor(@Inject(PROFILE_MASTER_PORT) private readonly profiles: ProfileMasterPort) {}

  async become(userId: UserIdType) {
    const row = await this.profiles.becomeMaster(userId);
    if (row === null) throw new NotFoundException();
    return { is_master: true as const, master_profile: masterProfile(row.masterProfile) };
  }

  async me(userId: UserIdType) {
    const row = await this.profiles.findMasterState(userId);
    if (row === null) throw new NotFoundException();
    return { is_master: row.isMaster, master_profile: masterProfile(row.masterProfile) };
  }

  async update(userId: UserIdType, body: Readonly<Record<string, unknown>>) {
    const current = await this.profiles.findMasterState(userId);
    if (current === null || !current.isMaster) throw new ForbiddenException();
    const patch: { -readonly [K in keyof MasterProfile]?: MasterProfile[K] } = {};
    for (const name of Object.keys(MASTER_PROFILE_LIMITS) as Array<keyof MasterProfile>) {
      if (body[name] === undefined) continue;
      const value = sanitizeMasterField(body[name], MASTER_PROFILE_LIMITS[name]);
      if (value === undefined) throw new BadRequestException();
      patch[name] = value;
    }
    const merged = { ...masterProfile(current.masterProfile), ...patch };
    const row = await this.profiles.updateMasterProfile(userId, merged);
    if (row === null) throw new NotFoundException();
    return { is_master: row.isMaster, master_profile: masterProfile(row.masterProfile) };
  }

  async publicProfile(rawUserId: string) {
    if (!UUID_RE.test(rawUserId)) throw new NotFoundException();
    const row = await this.profiles.findActiveMaster(UserId(rawUserId));
    if (row === null) throw new NotFoundException();
    return {
      master: {
        id: row.id,
        username: row.username,
        display_name: row.displayName,
        avatar_url: row.avatarUrl,
        master_profile: masterProfile(row.masterProfile),
      },
    };
  }
}
