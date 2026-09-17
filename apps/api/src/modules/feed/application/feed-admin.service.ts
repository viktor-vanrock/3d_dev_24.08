import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { FeedPostId, UserId } from "../../_kernel/brandedIds.ts";
import type { FeedPostRecord } from "../domain/feed.ts";
import { FeedRepository } from "../infrastructure/feed.repository.ts";
import type { FeedAdminEnvelope, FeedAdminItem, FeedAdminListResponse, FeedAdminPort, FeedAdminSource, FeedAdminStatus } from "../public/index.ts";

function requiredTitle(value: string | undefined): string {
  const title = value?.trim() ?? "";
  if (title === "" || title.length > 300) throw new UnprocessableEntityException();
  return title;
}

function item(row: FeedPostRecord): FeedAdminItem {
  const status: FeedAdminStatus = row.status === "visible" ? "published" : row.status === "hidden" ? "hidden" : "draft";
  const source: FeedAdminSource = row.source_fingerprint === null ? "manual" : "scout";
  const updated = row.edited_at ?? row.created_at;
  return {
    id: row.id, title: row.title, body: row.body, status, source, source_url: row.source_url,
    source_fingerprint: row.source_fingerprint, ingest_provider: row.ingest_provider, ingest_model: row.ingest_model,
    ingest_prompt_version: row.ingest_prompt_version, community_id: row.community_id, updated_at: updated.toISOString(),
  };
}

@Injectable()
export class FeedAdminService implements FeedAdminPort {
  constructor(@Inject(FeedRepository) private readonly repository: Pick<FeedRepository, "listAdmin" | "find" | "createAdmin" | "updateAdmin" | "transitionAdminStatus">) {}

  async list(query: { readonly status?: FeedAdminStatus | "all"; readonly source?: FeedAdminSource | "all" }): Promise<FeedAdminListResponse> {
    return { items: (await this.repository.listAdmin(query)).map(item) };
  }
  async detail(postId: FeedPostId): Promise<FeedAdminEnvelope> {
    const row = await this.repository.find(postId);
    if (row === null || row.status === "deleted") throw new NotFoundException();
    return { item: item(row) };
  }
  async create(actorId: UserId, input: { readonly title?: string; readonly body?: string; readonly community_id?: string | null }): Promise<FeedAdminEnvelope> {
    const row = await this.repository.createAdmin(actorId, { communityId: input.community_id ?? null, title: requiredTitle(input.title), body: input.body?.trim() || null });
    return { item: item(row) };
  }
  async update(actorId: UserId, postId: FeedPostId, input: { readonly title?: string; readonly body?: string; readonly community_id?: string | null }): Promise<FeedAdminEnvelope> {
    if (input.title === undefined && input.body === undefined && input.community_id === undefined) throw new UnprocessableEntityException();
    const row = await this.repository.updateAdmin(actorId, postId, { title: input.title === undefined ? undefined : requiredTitle(input.title), body: input.body, communityId: input.community_id });
    if (row === null) throw new NotFoundException();
    return { item: item(row) };
  }
  async publish(actorId: UserId, postId: FeedPostId): Promise<FeedAdminEnvelope> {
    const row = await this.repository.transitionAdminStatus(actorId, postId, "visible", ["draft", "visible", "hidden"]);
    if (row === null) throw new NotFoundException();
    return { item: item(row) };
  }
  async hide(actorId: UserId, postId: FeedPostId): Promise<FeedAdminEnvelope> {
    const row = await this.repository.transitionAdminStatus(actorId, postId, "hidden", ["draft", "visible", "hidden"]);
    if (row === null) throw new NotFoundException();
    return { item: item(row) };
  }
}
