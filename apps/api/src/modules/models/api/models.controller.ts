import { Controller, Get, Inject, NotFoundException, Param, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ProjectId, UserId } from "../../_kernel/brandedIds.ts";
import { ProjectQueryService } from "../../projects/application/project-query.service.ts";
import { ProjectError } from "../../projects/domain/project.errors.ts";
import type { ProjectView } from "../../projects/domain/project.repository.ts";
import { Internal } from "../../permissions/public/index.ts";
import { PermissionGuard } from "../../permissions/guards/permission.guard.ts";
import { SessionVerifier } from "../../../nest/auth/session-verifier.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller("models")
@UseGuards(PermissionGuard)
export class ModelsController {
  constructor(
    @Inject(ProjectQueryService) private readonly projects: ProjectQueryService,
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

    let project: ProjectView | null = null;
    if (session !== null) {
      try {
        project = await this.projects.draft(UserId(session.id), projectId);
      } catch (error) {
        if (!(error instanceof ProjectError) || error.status !== 404) throw error;
      }
    }
    if (project === null) {
      try {
        project = await this.projects.published(projectId);
      } catch (error) {
        if (error instanceof ProjectError && error.status === 404) throw new NotFoundException();
        throw error;
      }
    }

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
        publish_status: project.published_revision_id === null ? "draft" : "published",
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
        preview_url: null,
        preview_mobile_url: null,
        download_url: null,
        files: [],
        repo_url: project.repo_url ?? null,
        recommended_material: null,
      },
    };
  }
}
