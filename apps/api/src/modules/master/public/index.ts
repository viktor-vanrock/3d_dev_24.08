import type { UserId } from "../../_kernel/brandedIds.ts";
import type { MasterProfile } from "../domain/master.ts";

export const MASTER_PORT = Symbol("MASTER_PORT");

export interface MasterPort {
  become(userId: UserId): Promise<{ readonly is_master: true; readonly master_profile: MasterProfile }>;
  me(userId: UserId): Promise<{ readonly is_master: boolean; readonly master_profile: MasterProfile }>;
  update(userId: UserId, body: Readonly<Record<string, unknown>>): Promise<{ readonly is_master: boolean; readonly master_profile: MasterProfile }>;
  publicProfile(userId: string): Promise<{
    readonly master: {
      readonly id: UserId;
      readonly username: string;
      readonly display_name: string | null;
      readonly avatar_url: string | null;
      readonly master_profile: MasterProfile;
    };
  }>;
}
