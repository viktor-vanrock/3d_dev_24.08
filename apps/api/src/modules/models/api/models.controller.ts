import { Controller, Get, Inject, NotFoundException, Param, Req } from "@nestjs/common";
import type { Request } from "express";
import { ProjectId, UserId } from "../../_kernel/brandedIds.ts";
import { PROJECT_QUERY_SERVICE, type ProjectReadPort } from "../../projects/public/index.ts";
import { Internal } from "../../permissions/public/index.ts";
import { SessionVerifier } from "../../../nest/auth/session-verifier.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller("models")
export class ModelsController {
  constructor(
    @Inject(PROJECT_QUERY_SERVICE) private readonly projects: ProjectReadPort,
    @Inject(SessionVerifier) private readonly sessions: SessionVerifier,
  ) {}

  // TODO: временный endpoint для совместимости с legacy фронтом.
  // Будет заменён переходом на /projects API.
  @Get(":id")
  @Internal()
  async getModel(@Param("id") rawId: string, @Req() request: Request) {
    if (!UUID.test(rawId)) throw new NotFoundException();
    const projectId = ProjectId(rawId);
    const session = await this.sessions.readSession(request);

    let project = null;
    if (session !== null) {
      project = await this.projects.getDraft(projectId, UserId(session.id));
    }
    if (project === null) project = await this.projects.getPublished(projectId);
    if (project === null) throw new NotFoundException();

    return {
      model: {
        id: project.id,
        title: project.title,
        description: project.description,
        status: "ready",
        source_format: "stl",
        craft: "3d_printing",
        manufacturing_method: null,
        requires_ams: false,
        created_at: project.created_at,
        updated_at: project.updated_at,
        tags: [...project.tags],
        thumb_url: null,
        owner: {
          ...project.owner,
          trusted_uploader: false,
        },
        project_summary: { file_count: 0, build_steps_count: 0 },
        votes_up: 0,
        votes_down: 0,
        downloads_count: 0,
        publish_status: project.publication_state,
        bbox: null,
        size_bytes: null,
        my_vote: 0,
        make_stats: {
          makes_count: 0,
          machines_count: 0,
          materials_count: 0,
          avg_printability_rating: null,
          avg_geometry_quality_rating: null,
          avg_surface_quality_rating: null,
        },
        top_combos: [],
        preview_url: project.preview_url,
        preview_mobile_url: null,
        download_url: null,
        files: [],
        repo_url: project.repo_url ?? null,
        recommended_material: null,
      },
    };
  }
}
