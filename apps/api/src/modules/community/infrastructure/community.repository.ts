import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { CommunityRole, PostKind, ThreadType } from "../domain/community.ts";
import type { CommunityFeedReadPort } from "../public/index.ts";

interface CommunityRecord {
  id: string;
  slug: string;
  name: string;
  kind: string;
  subject_type: string | null;
  subject_id: string | null;
  description: string | null;
  cover_image_s3_key: string | null;
  visibility: string;
  status: string;
  created_by: string | null;
  created_at: Date;
  member_count: string;
  thread_count: string;
  website: string | null;
}
interface ThreadRecord {
  id: string;
  community_id: string;
  author_id: string;
  type: ThreadType;
  title: string;
  content: string;
  status: string;
  pinned: boolean;
  accepted_post_id: string | null;
  votes_up: number;
  votes_down: number;
  created_at: Date;
  updated_at: Date;
  post_count: string;
}
interface PostRecord {
  id: string;
  thread_id: string;
  author_id: string;
  parent_post_id: string | null;
  kind: PostKind;
  content: string;
  status: string;
  votes_up: number;
  votes_down: number;
  created_at: Date;
  updated_at: Date;
}
interface AttachmentRecord {
  id: string;
  post_id: string;
  kind: "photo" | "model_3mf";
  s3_key: string;
  size_bytes: number;
  created_at: Date;
}
interface CommunityListInput {
  kind?: string;
  q?: string;
  member?: string;
  cursor?: string;
  limit: number;
  userId: UserId;
}
interface ThreadListInput {
  communityId: string;
  type?: ThreadType;
  cursor?: string;
  limit: number;
}

@Injectable()
export class CommunityRepository implements CommunityFeedReadPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}
  private fields() {
    return `c.id,c.slug,c.name,c.kind,c.subject_type,c.subject_id,c.description,c.cover_image_s3_key,c.visibility,c.status,c.created_by,c.created_at,(select count(*) from community_members cm where cm.community_id=c.id) member_count,(select count(*) from threads t where t.community_id=c.id) thread_count,null::text website`;
  }
  async uniqueSlug(base: string): Promise<string> {
    let slug = base,
      s = 1;
    while ((await this.pool.query(`select 1 from communities where slug=$1`, [slug])).rowCount) {
      slug = `${base}-${++s}`;
    }
    return slug;
  }
  async create(input: { name: string; slug: string; description: string | null; visibility: string; tagIds: readonly string[]; userId: UserId }): Promise<CommunityRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const tags = await client.query(`select id from tags where id=any($1::uuid[])`, [input.tagIds]);
      if (tags.rowCount !== input.tagIds.length) throw Object.assign(new Error("invalid tags"), { code: "INVALID_TAG_IDS" });
      const r = await client.query<CommunityRecord>(
        `insert into communities(slug,name,kind,description,visibility,created_by) values($1,$2,'custom',$3,$4,$5) returning id,slug,name,kind,subject_type,subject_id,description,cover_image_s3_key,visibility,status,created_by,created_at,'1' member_count,'0' thread_count,null::text website`,
        [input.slug, input.name, input.description, input.visibility, input.userId],
      );
      await client.query(`insert into community_members(community_id,user_id,role,source) values($1,$2,'owner','manual')`, [r.rows[0]!.id, input.userId]);
      if (input.tagIds.length) await client.query(`insert into taggings(tag_id,subject_type,subject_id) select unnest($2::uuid[]),'community',$1`, [r.rows[0]!.id, input.tagIds]);
      await client.query("commit");
      return r.rows[0]!;
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }
  async list(input: CommunityListInput): Promise<CommunityRecord[]> {
    const p: unknown[] = [];
    const w = [`c.status='active'`];
    if (input.kind) {
      p.push(input.kind);
      w.push(`c.kind=$${p.length}`);
    }
    if (input.q?.trim()) {
      p.push(`%${input.q.trim().toLowerCase()}%`);
      w.push(`lower(c.name) like $${p.length}`);
    }
    if (input.member === "me") {
      p.push(input.userId);
      w.push(`exists(select 1 from community_members cm where cm.community_id=c.id and cm.user_id=$${p.length})`);
    }
    if (input.cursor) {
      p.push(input.cursor);
      w.push(`c.created_at<$${p.length}::timestamptz`);
    }
    return (await this.pool.query<CommunityRecord>(`select ${this.fields()} from communities c where ${w.join(" and ")} order by c.created_at desc limit ${input.limit + 1}`, p))
      .rows;
  }
  async community(id: string): Promise<CommunityRecord | null> {
    return (await this.pool.query<CommunityRecord>(`select ${this.fields()} from communities c where ${/^[0-9a-f-]{36}$/i.test(id) ? "c.id" : "c.slug"}=$1`, [id])).rows[0] ?? null;
  }
  async role(id: string, userId: UserId): Promise<CommunityRole | null> {
    return (await this.pool.query<{ role: CommunityRole }>(`select role from community_members where community_id=$1 and user_id=$2`, [id, userId])).rows[0]?.role ?? null;
  }
  async join(id: string, userId: UserId): Promise<CommunityRole | null> {
    if (!(await this.pool.query(`select 1 from communities where id=$1 and status='active'`, [id])).rowCount) return null;
    return (
      await this.pool.query<{ role: CommunityRole }>(
        `insert into community_members(community_id,user_id,role,source) values($1,$2,'member','manual') on conflict(community_id,user_id) do update set role=community_members.role returning role`,
        [id, userId],
      )
    ).rows[0]!.role;
  }
  async leave(id: string, userId: UserId): Promise<"left" | "not_found" | "last_owner"> {
    const role = await this.role(id, userId);
    if (!role) return "not_found";
    if (role === "owner" && !(await this.pool.query(`select 1 from community_members where community_id=$1 and role='owner' and user_id<>$2`, [id, userId])).rowCount)
      return "last_owner";
    await this.pool.query(`delete from community_members where community_id=$1 and user_id=$2`, [id, userId]);
    return "left";
  }
  async kind(id: string): Promise<string | null> {
    return (await this.pool.query<{ kind: string }>(`select kind from communities where id=$1`, [id])).rows[0]?.kind ?? null;
  }
  async activeCatalogSubject(id: string): Promise<{ kind: string; subjectType: string | null; subjectId: string | null } | null> {
    const row = (
      await this.pool.query<{ kind: string; subject_type: string | null; subject_id: string | null }>(
        `select kind,subject_type,subject_id from communities where id=$1 and status='active'`,
        [id],
      )
    ).rows[0];
    return row === undefined ? null : { kind: row.kind, subjectType: row.subject_type, subjectId: row.subject_id };
  }
  async currentOwner(id: string): Promise<UserId | null> {
    return (await this.pool.query<{ user_id: UserId }>(`select user_id from community_members where community_id=$1 and role='owner' limit 1`, [id])).rows[0]?.user_id ?? null;
  }
  async grantVendorClaimOwner(id: string, userId: UserId): Promise<"owner"> {
    await this.pool.query(
      `insert into community_members(community_id,user_id,role,source) values($1,$2,'owner','vendor_claim') on conflict(community_id,user_id) do update set role='owner',source='vendor_claim'`,
      [id, userId],
    );
    return "owner";
  }
  async revokeVendorClaimMemberships(transaction: unknown, userId: UserId, vendorId: string, machineIds: readonly string[]): Promise<void> {
    const client = transaction as { query(text: string, values?: unknown[]): Promise<unknown> };
    if (typeof client?.query !== "function") throw new TypeError("Community transaction is invalid");
    await client.query(
      `delete from community_members cm using communities c where cm.community_id=c.id and cm.user_id=$1 and cm.source='vendor_claim' and ((c.subject_type='vendor' and c.subject_id=$2) or (c.subject_type='machine' and c.subject_id=any($3::uuid[])))`,
      [userId, vendorId, machineIds],
    );
  }
  async relatedCatalogCommunities(
    currentCommunityId: string,
    vendorId: string,
    machineIds: readonly string[],
  ): Promise<readonly { id: string; slug: string; name: string; kind: string }[]> {
    return (
      await this.pool.query<{ id: string; slug: string; name: string; kind: string }>(
        `select id,slug,name,kind from communities where id<>$1 and status='active' and ((kind='vendor' and subject_id=$2) or (kind='machine' and subject_id=any($3::uuid[]))) order by (kind='vendor') desc,name asc`,
        [currentCommunityId, vendorId, machineIds],
      )
    ).rows;
  }
  async findActive(communityId: string): Promise<{ id: string; kind: string } | null> {
    return (await this.pool.query<{ id: string; kind: string }>(`select id,kind from communities where id=$1 and status='active'`, [communityId])).rows[0] ?? null;
  }
  async isMember(communityId: string, userId: UserId): Promise<boolean> {
    return (await this.pool.query(`select 1 from community_members where community_id=$1 and user_id=$2`, [communityId, userId])).rowCount !== 0;
  }
  async subscribedCommunityIds(userId: UserId): Promise<readonly string[]> {
    return (await this.pool.query<{ community_id: string }>(`select community_id from community_members where user_id=$1`, [userId])).rows.map((row) => row.community_id);
  }
  async canIngest(communityId: string, userId: UserId): Promise<boolean> {
    return (await this.pool.query(`select 1 from community_members where community_id=$1 and user_id=$2 and role in ('owner','moderator')`, [communityId, userId])).rowCount !== 0;
  }
  async gateState(communityId: string): Promise<{ createdAt: Date; kind: string } | null> {
    const row = (await this.pool.query<{ created_at: Date; kind: string }>(`select created_at,kind from communities where id=$1`, [communityId])).rows[0];
    return row === undefined ? null : { createdAt: row.created_at, kind: row.kind };
  }
  async communityIdsWithAnyTags(communityIds: readonly string[], tagIds: readonly string[]): Promise<ReadonlySet<string>> {
    if (!communityIds.length || !tagIds.length) return new Set();
    const rows = (
      await this.pool.query<{ subject_id: string }>(
        `select distinct subject_id from taggings where subject_type='community' and subject_id=any($1::uuid[]) and tag_id=any($2::uuid[])`,
        [communityIds, tagIds],
      )
    ).rows;
    return new Set(rows.map((row) => row.subject_id));
  }
  async findTagIdByName(name: string): Promise<string | null> {
    return (await this.pool.query<{ id: string }>(`select id from tags where name=$1`, [name])).rows[0]?.id ?? null;
  }
  async setRole(id: string, target: UserId, actor: UserId, role: CommunityRole): Promise<"ok" | "owner_only" | "not_found" | "last_owner"> {
    if ((await this.role(id, actor)) !== "owner") return "owner_only";
    const old = await this.role(id, target);
    if (!old) return "not_found";
    if (
      old === "owner" &&
      role !== "owner" &&
      target === actor &&
      !(await this.pool.query(`select 1 from community_members where community_id=$1 and role='owner' and user_id<>$2`, [id, target])).rowCount
    )
      return "last_owner";
    await this.pool.query(`update community_members set role=$3 where community_id=$1 and user_id=$2`, [id, target, role]);
    return "ok";
  }
  async bootstrap(id: string, target: UserId): Promise<"ok" | "not_found" | "not_catalog" | "owner_exists"> {
    const k = await this.kind(id);
    if (!k) return "not_found";
    if (k !== "machine" && k !== "vendor") return "not_catalog";
    const owner = (await this.pool.query<{ user_id: string }>(`select user_id from community_members where community_id=$1 and role='owner' limit 1`, [id])).rows[0]?.user_id;
    if (owner && owner !== target) return "owner_exists";
    await this.pool.query(
      `insert into community_members(community_id,user_id,role,source) values($1,$2,'owner','manual') on conflict(community_id,user_id) do update set role='owner'`,
      [id, target],
    );
    return "ok";
  }
  private threadFields() {
    return `t.id,t.community_id,t.author_id,t.type,t.title,t.content,t.status,t.pinned,t.accepted_post_id,t.votes_up,t.votes_down,t.created_at,t.updated_at,(select count(*) from posts p where p.thread_id=t.id and p.status='visible') post_count`;
  }
  async createThread(communityId: string, userId: UserId, type: ThreadType, title: string, content: string, tags: string[]): Promise<ThreadRecord> {
    const r = await this.pool.query<ThreadRecord>(
      `insert into threads(community_id,author_id,type,title,content) values($1,$2,$3,$4,$5) returning id,community_id,author_id,type,title,content,status,pinned,accepted_post_id,votes_up,votes_down,created_at,updated_at,'0' post_count`,
      [communityId, userId, type, title, content],
    );
    await this.syncTags(r.rows[0]!.id, tags);
    return r.rows[0]!;
  }
  async threads(input: ThreadListInput): Promise<ThreadRecord[]> {
    const p: unknown[] = [input.communityId],
      w = [`t.community_id=$1`];
    if (input.type) {
      p.push(input.type);
      w.push(`t.type=$${p.length}`);
    }
    if (input.cursor) {
      p.push(input.cursor);
      w.push(`t.created_at<$${p.length}::timestamptz`);
    }
    return (
      await this.pool.query<ThreadRecord>(
        `select ${this.threadFields()} from threads t where ${w.join(" and ")} order by t.pinned desc,t.created_at desc limit ${input.limit + 1}`,
        p,
      )
    ).rows;
  }
  async thread(id: string): Promise<ThreadRecord | null> {
    return (await this.pool.query<ThreadRecord>(`select ${this.threadFields()} from threads t where t.id=$1`, [id])).rows[0] ?? null;
  }
  async posts(id: string, question: boolean): Promise<PostRecord[]> {
    return (
      await this.pool.query<PostRecord>(
        `select p.id,p.thread_id,p.author_id,p.parent_post_id,p.kind,p.content,p.status,p.votes_up,p.votes_down,p.created_at,p.updated_at from posts p join threads t on t.id=p.thread_id where p.thread_id=$1 and p.status='visible' order by ${question ? `case when p.id=t.accepted_post_id then 0 else 1 end,(p.votes_up-p.votes_down) desc,p.created_at asc` : `p.created_at asc`}`,
        [id],
      )
    ).rows;
  }
  async createPost(threadId: string, userId: UserId, parent: string | null, kind: PostKind, content: string): Promise<PostRecord> {
    const r = await this.pool.query<PostRecord>(
      `insert into posts(thread_id,author_id,parent_post_id,kind,content) values($1,$2,$3,$4,$5) returning id,thread_id,author_id,parent_post_id,kind,content,status,votes_up,votes_down,created_at,updated_at`,
      [threadId, userId, parent, kind, content],
    );
    await this.pool.query(`update threads set updated_at=now() where id=$1`, [threadId]);
    return r.rows[0]!;
  }
  async post(id: string): Promise<PostRecord | null> {
    return (
      (await this.pool.query<PostRecord>(`select id,thread_id,author_id,parent_post_id,kind,content,status,votes_up,votes_down,created_at,updated_at from posts where id=$1`, [id]))
        .rows[0] ?? null
    );
  }
  async tags(ids: string[]): Promise<Map<string, string[]>> {
    const m = new Map<string, string[]>();
    if (!ids.length) return m;
    const r = await this.pool.query<{ subject_id: string; name: string }>(
      `select tg.subject_id,t.name from taggings tg join tags t on t.id=tg.tag_id where tg.subject_type='thread' and tg.subject_id=any($1::uuid[]) order by t.name`,
      [ids],
    );
    for (const x of r.rows) m.set(x.subject_id, [...(m.get(x.subject_id) ?? []), x.name]);
    return m;
  }
  private async syncTags(id: string, names: string[]) {
    if (!names.length) return;
    const r = await this.pool.query<{ id: string }>(`insert into tags(name) select unnest($1::text[]) on conflict(name) do update set name=excluded.name returning id`, [names]);
    await this.pool.query(`insert into taggings(tag_id,subject_type,subject_id) select unnest($2::uuid[]),'thread',$1 on conflict do nothing`, [id, r.rows.map((x) => x.id)]);
  }
  async vote(type: "thread" | "post", id: string, userId: UserId, value: 1 | -1 | 0): Promise<{ up: number; down: number; isNew: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const old = await client.query<{ value: number }>(`select value from votes where subject_type=$1 and subject_id=$2 and user_id=$3 for update`, [type, id, userId]);
      let isNew = false;
      if (value === 0) await client.query(`delete from votes where subject_type=$1 and subject_id=$2 and user_id=$3`, [type, id, userId]);
      else if (!old.rowCount) {
        await client.query(`insert into votes(subject_type,subject_id,user_id,value) values($1,$2,$3,$4)`, [type, id, userId, value]);
        isNew = true;
      } else await client.query(`update votes set value=$4 where subject_type=$1 and subject_id=$2 and user_id=$3`, [type, id, userId, value]);
      const c = await client.query<{ up: number; down: number }>(
        `select count(*) filter(where value=1)::int up,count(*) filter(where value=-1)::int down from votes where subject_type=$1 and subject_id=$2`,
        [type, id],
      );
      await client.query(`update ${type === "post" ? "posts" : "threads"} set votes_up=$2,votes_down=$3 where id=$1`, [id, c.rows[0]!.up, c.rows[0]!.down]);
      await client.query("commit");
      return { ...c.rows[0]!, isNew };
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }
  async attachmentRows(ids: string[]): Promise<Map<string, AttachmentRecord[]>> {
    const m = new Map<string, AttachmentRecord[]>();
    if (!ids.length) return m;
    const r = await this.pool.query<AttachmentRecord>(
      `select id,post_id,kind,s3_key,size_bytes,created_at from post_attachments where post_id=any($1::uuid[]) order by created_at`,
      [ids],
    );
    for (const x of r.rows) m.set(x.post_id, [...(m.get(x.post_id) ?? []), x]);
    return m;
  }
  async addAttachment(postId: string, userId: UserId, kind: "photo" | "model_3mf", key: string, size: number, name: string, mime: string): Promise<AttachmentRecord> {
    return (
      await this.pool.query<AttachmentRecord>(
        `insert into post_attachments(post_id,owner_id,kind,s3_key,size_bytes,original_filename,mime_type) values($1,$2,$3,$4,$5,$6,$7) returning id,post_id,kind,s3_key,size_bytes,created_at`,
        [postId, userId, kind, key, size, name, mime],
      )
    ).rows[0]!;
  }
  async attachment(postId: string, id: string) {
    return (await this.pool.query<{ kind: string; s3_key: string }>(`select kind,s3_key from post_attachments where id=$1 and post_id=$2`, [id, postId])).rows[0] ?? null;
  }
  async attachmentCount(id: string) {
    return Number((await this.pool.query<{ count: string }>(`select count(*) count from post_attachments where post_id=$1`, [id])).rows[0]?.count ?? 0);
  }
  async socialVote(type: string, id: string, userId: UserId, value: 1 | -1 | 0): Promise<{ up: number; down: number; isNew: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const old = await client.query<{ value: number }>(`select value from votes where subject_type=$1 and subject_id=$2 and user_id=$3 for update`, [type, id, userId]);
      let isNew = false;
      if (value === 0) await client.query(`delete from votes where subject_type=$1 and subject_id=$2 and user_id=$3`, [type, id, userId]);
      else if (!old.rowCount) {
        await client.query(`insert into votes(subject_type,subject_id,user_id,value) values($1,$2,$3,$4)`, [type, id, userId, value]);
        isNew = true;
      } else if (old.rows[0]!.value !== value) await client.query(`update votes set value=$4 where subject_type=$1 and subject_id=$2 and user_id=$3`, [type, id, userId, value]);
      const c = await client.query<{ up: number; down: number }>(
        `select count(*) filter(where value=1)::int up,count(*) filter(where value=-1)::int down from votes where subject_type=$1 and subject_id=$2`,
        [type, id],
      );
      await client.query("commit");
      return { ...c.rows[0]!, isNew };
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }
  async applyWeightedVote(
    type: string,
    id: string,
    userId: UserId,
    value: 1 | -1 | 0,
    trustSnapshot: number,
  ): Promise<{ up: number; down: number; upWeighted: number; downWeighted: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const old = await client.query<{ value: number }>(`select value from votes where subject_type=$1 and subject_id=$2 and user_id=$3 for update`, [type, id, userId]);
      if (value === 0) {
        if (old.rowCount) await client.query(`delete from votes where subject_type=$1 and subject_id=$2 and user_id=$3`, [type, id, userId]);
      } else if (!old.rowCount)
        await client.query(`insert into votes(subject_type,subject_id,user_id,value,trust_snapshot) values($1,$2,$3,$4,$5)`, [type, id, userId, value, trustSnapshot]);
      else if (old.rows[0]!.value !== value)
        await client.query(`update votes set value=$4,trust_snapshot=$5 where subject_type=$1 and subject_id=$2 and user_id=$3`, [type, id, userId, value, trustSnapshot]);
      const row = (
        await client.query<{ up: number; down: number; up_weighted: string; down_weighted: string }>(
          `select count(*) filter(where value=1)::int up,count(*) filter(where value=-1)::int down,coalesce(sum(trust_snapshot) filter(where value=1),0)::text up_weighted,coalesce(sum(trust_snapshot) filter(where value=-1),0)::text down_weighted from votes where subject_type=$1 and subject_id=$2`,
          [type, id],
        )
      ).rows[0]!;
      await client.query("commit");
      return { up: row.up, down: row.down, upWeighted: Number(row.up_weighted), downWeighted: Number(row.down_weighted) };
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }
  async togglePositiveVote(type: string, id: string, userId: UserId): Promise<{ liked: boolean; likesCount: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const existing = await client.query(`select 1 from votes where subject_type=$1 and subject_id=$2 and user_id=$3 for update`, [type, id, userId]);
      const liked = existing.rowCount === 0;
      if (liked) await client.query(`insert into votes(subject_type,subject_id,user_id,value) values($1,$2,$3,1)`, [type, id, userId]);
      else await client.query(`delete from votes where subject_type=$1 and subject_id=$2 and user_id=$3`, [type, id, userId]);
      const likesCount = Number(
        (await client.query<{ count: number }>(`select count(*)::int count from votes where subject_type=$1 and subject_id=$2 and value=1`, [type, id])).rows[0]?.count ?? 0,
      );
      await client.query("commit");
      return { liked, likesCount };
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }
  async accept(threadId: string, postId: string | null) {
    await this.pool.query(`update threads set accepted_post_id=$2 where id=$1`, [threadId, postId]);
  }
}
