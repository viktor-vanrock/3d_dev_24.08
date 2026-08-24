import { afterEach, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { extractModelIds, resolvedModelsForPosts } from "./modelrefs.ts";

describe("extractModelIds", () => {
  it("finds a single /project/:id link", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect(extractModelIds(`смотри модель /project/${id} тут`)).toEqual([id]);
  });

  it("finds an absolute-URL link and dedupes repeats", () => {
    const id = "22222222-2222-2222-2222-222222222222";
    const content = `https://3mf.tech/project/${id} и ещё раз /project/${id}`;
    expect(extractModelIds(content)).toEqual([id]);
  });

  it("returns an empty array when there is no model link", () => {
    expect(extractModelIds("просто текст без ссылок")).toEqual([]);
  });

  it("lowercases uppercase uuids", () => {
    const id = "33333333-3333-3333-3333-333333333333";
    expect(extractModelIds(`/project/${id.toUpperCase()}`)).toEqual([id]);
  });
});

describe("resolvedModelsForPosts", () => {
  const projectIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    while (projectIds.length) {
      const projectId = projectIds.pop();
      await pool.query(`update projects set published_revision_id = null where id = $1`, [projectId]);
      await pool.query(`delete from project_revisions where project_id = $1`, [projectId]);
      await pool.query(`delete from projects where id = $1`, [projectId]);
    }
    while (userIds.length) {
      await pool.query(`delete from users where id = $1`, [userIds.pop()]);
    }
  });

  async function makeUser(prefix: string): Promise<string> {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await pool.query<{ id: string }>(`insert into users (username) values ($1) returning id`, [`${prefix}-${suffix}`]);
    return result.rows[0]!.id;
  }

  async function makeProjectModel(input: {
    ownerId: string;
    title: string;
    status: "pending" | "ready";
    publishStatus: "draft" | "published";
  }): Promise<{ projectId: string; childId: string }> {
    const result = await pool.query<{ project_id: string; child_id: string }>(
      `with ids as (
         select gen_random_uuid() as project_id, gen_random_uuid() as child_id,
                gen_random_uuid() as model_revision_id, gen_random_uuid() as project_revision_id
       ), p as (
         insert into projects (id, owner_id, title, primary_model_id, published_revision_id)
         select project_id, $1, $2, child_id,
                case when $3 = 'ready' and $4 = 'published' then project_revision_id else null end
           from ids returning id
       ), m as (
         insert into models (id, project_id, name, position, latest_revision_id, active_revision_id)
         select child_id, project_id, $2, 0, model_revision_id,
                case when $3 = 'ready' then model_revision_id else null end
           from ids returning id, project_id
       ), r as (
         insert into model_revisions
           (id, model_id, source_format, status, source_checksum, source_size_bytes, ready_at)
         select model_revision_id, child_id, 'stl', $3, decode(repeat('00', 32), 'hex'), 0,
                case when $3 = 'ready' then now() else null end from ids
       ), pr as (
         insert into project_revisions (id, project_id, content_hash, primary_model_id, metadata_snapshot)
         select project_revision_id, project_id, decode(repeat('01', 32), 'hex'), child_id,
                jsonb_build_object('schema', 'project-publication.v1', 'title', $2, 'description', null, 'tags', '[]'::jsonb, 'repo_url', null, 'owner_id', $1)
           from ids where $3 = 'ready' and $4 = 'published'
       ), prm as (
         insert into project_revision_models (project_revision_id, project_id, model_id, model_revision_id, position)
         select project_revision_id, project_id, child_id, model_revision_id, 0
           from ids where $3 = 'ready' and $4 = 'published'
       )
       select project_id, id as child_id from m`,
      [input.ownerId, input.title, input.status, input.publishStatus],
    );
    return {
      projectId: result.rows[0]!.project_id,
      childId: result.rows[0]!.child_id,
    };
  }

  it("resolves a ready model linked from a post's content", async () => {
    const ownerId = await makeUser("modelref-owner");
    userIds.push(ownerId);
    const { projectId, childId } = await makeProjectModel({
      ownerId,
      title: "Дракон",
      status: "ready",
      publishStatus: "published",
    });
    projectIds.push(projectId);

    expect(childId).not.toBe(projectId);
    const posts = [{ id: "post-a", content: `гляньте /project/${projectId}` }];
    const resolved = await resolvedModelsForPosts(posts);
    expect(resolved.get("post-a")).toEqual([{ id: projectId, title: "Дракон", thumbnail_url: null }]);
  });

  it("does not resolve a non-ready (pending) model — no leaking a draft via link", async () => {
    const ownerId = await makeUser("modelref-draft-owner");
    userIds.push(ownerId);
    const { projectId, childId } = await makeProjectModel({
      ownerId,
      title: "Черновик",
      status: "pending",
      publishStatus: "published",
    });
    projectIds.push(projectId);

    expect(childId).not.toBe(projectId);
    const posts = [{ id: "post-b", content: `гляньте /project/${projectId}` }];
    const resolved = await resolvedModelsForPosts(posts);
    expect(resolved.has("post-b")).toBe(false);
  });

  it("returns an empty map when no post references a model", async () => {
    const resolved = await resolvedModelsForPosts([{ id: "post-c", content: "просто текст" }]);
    expect(resolved.size).toBe(0);
  });
});
