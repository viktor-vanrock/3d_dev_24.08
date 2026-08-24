import { describe, expect, it } from "vitest";
import fixture from "./fixtures/project-api.v1.json" with { type: "json" };
import openapi from "./openapi.v1.json" with { type: "json" };
import {
  PROJECT_API_CONTRACT_VERSION,
  PROJECT_CRAFTS,
  PROJECT_MANUFACTURING_METHODS,
  PROJECT_REVISION_STATUSES,
  PROJECT_SOURCE_FORMATS,
  type ProjectDraftResponse,
} from "./projects.ts";

const OPERATIONS = {
  projectsCreate: ["post", "/projects", 201],
  projectsListPublished: ["get", "/projects", 200],
  projectsListOwned: ["get", "/projects/owned", 200],
  projectsGetPublished: ["get", "/projects/{projectId}", 200],
  projectsGetDraft: ["get", "/projects/{projectId}/draft", 200],
  projectsUpdate: ["patch", "/projects/{projectId}", 200],
  projectsDelete: ["delete", "/projects/{projectId}", 204],
  projectModelsCreate: ["post", "/projects/{projectId}/models", 201],
  projectModelsList: ["get", "/projects/{projectId}/models", 200],
  projectModelsGet: ["get", "/projects/{projectId}/models/{modelId}", 200],
  projectModelsDelete: ["delete", "/projects/{projectId}/models/{modelId}", 204],
  projectModelRevisionsCreate: ["post", "/projects/{projectId}/models/{modelId}/revisions", 201],
  projectModelRevisionsList: ["get", "/projects/{projectId}/models/{modelId}/revisions", 200],
  projectModelRevisionsGet: ["get", "/projects/{projectId}/models/{modelId}/revisions/{revisionId}", 200],
  projectModelRevisionSourceGet: ["get", "/projects/{projectId}/models/{modelId}/revisions/{revisionId}/source", 302],
  projectModelRevisionPreviewGet: ["get", "/projects/{projectId}/models/{modelId}/revisions/{revisionId}/preview.glb", 302],
  projectPrimaryModelSet: ["put", "/projects/{projectId}/primary-model", 200],
  projectPrimaryModelClear: ["delete", "/projects/{projectId}/primary-model", 204],
  projectPublicationSet: ["put", "/projects/{projectId}/publication", 200],
  projectPublicationClear: ["delete", "/projects/{projectId}/publication", 204],
} as const;

type Operation = {
  operationId?: string;
  security?: Array<Record<string, string[]>>;
  parameters?: Array<{ name?: string; in?: string; required?: boolean; schema?: { format?: string } }>;
  responses?: Record<string, { headers?: Record<string, unknown>; content?: Record<string, unknown> }>;
  requestBody?: { content?: Record<string, { schema?: { $ref?: string; type?: string; additionalProperties?: boolean } }> };
};

const document = openapi as unknown as {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, { additionalProperties?: boolean; minProperties?: number; properties?: Record<string, { enum?: string[]; nullable?: boolean }> }> };
};

function operation(method: string, path: string): Operation {
  const value = document.paths[path]?.[method];
  if (value === undefined) throw new Error(`missing ${method.toUpperCase()} ${path}`);
  return value;
}

describe("Project API v1 producer contract", () => {
  it("keeps the versioned fixture and closed enums stable", () => {
    const draft = fixture.project_draft_response as ProjectDraftResponse;
    expect(draft.contract_version).toBe(PROJECT_API_CONTRACT_VERSION);
    expect(draft.project.models_count).toBe(0);
    expect(PROJECT_SOURCE_FORMATS).toEqual(["stl", "obj", "3mf", "step", "dxf", "svg", "gcode", "gerber", "zip"]);
    expect(PROJECT_CRAFTS).toEqual(["3d_printing", "cnc", "electronics", "software"]);
    expect(PROJECT_MANUFACTURING_METHODS).toEqual(["fdm", "sla", "cnc", "laser"]);
    expect(PROJECT_REVISION_STATUSES).toEqual(["uploaded", "pending", "processing", "ready", "failed"]);
  });

  it("exposes exactly the accepted operation inventory and no /models path", () => {
    expect(Object.keys(document.paths).filter((path) => path.startsWith("/models"))).toEqual([]);
    const projectOperationIds: string[] = [];
    for (const [path, methods] of Object.entries(document.paths)) {
      if (!path.startsWith("/projects")) continue;
      for (const value of Object.values(methods)) if (value.operationId !== undefined) projectOperationIds.push(value.operationId);
    }
    expect(projectOperationIds.sort()).toEqual(Object.keys(OPERATIONS).sort());
    for (const [operationId, [method, path, status]] of Object.entries(OPERATIONS)) {
      const value = operation(method, path);
      expect(value.operationId).toBe(operationId);
      expect(value.responses?.[String(status)]).toBeDefined();
    }
  });

  it("keeps request schemas closed and PATCH null/optional semantics exact", () => {
    for (const name of ["CreateProjectDto", "UpdateProjectDto", "SetPrimaryModelDto"]) {
      expect(document.components.schemas[name]?.additionalProperties, name).toBe(false);
    }
    const update = document.components.schemas.UpdateProjectDto!;
    expect(update.minProperties).toBe(1);
    expect(update.properties?.title?.nullable).toBe(false);
    expect(update.properties?.description?.nullable).toBe(true);
    expect(update.properties?.repo_url?.nullable).toBe(true);
  });

  it("declares UUID path params, version/idempotency headers, and bodyless 204/302", () => {
    for (const [, [method, path, status]] of Object.entries(OPERATIONS)) {
      const value = operation(method, path);
      for (const name of [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!)) {
        const parameter = value.parameters?.find((candidate) => candidate.name === name && candidate.in === "path");
        expect(parameter?.required, `${method} ${path} ${name}`).toBe(true);
        expect(parameter?.schema?.format, `${method} ${path} ${name}`).toBe("uuid");
      }
      const response = value.responses?.[String(status)]!;
      if (status === 204 || status === 302) expect(response.content).toBeUndefined();
      if (status === 302) expect(response.headers?.Location).toBeDefined();
      if (status === 201) {
        expect(response.headers?.Location).toBeDefined();
        expect(response.headers?.ETag).toBeDefined();
      }
    }
    expect(operation("post", "/projects").parameters?.some((parameter) => parameter.name === "Idempotency-Key" && parameter.required)).toBe(true);
    expect(operation("patch", "/projects/{projectId}").parameters?.some((parameter) => parameter.name === "If-Match" && parameter.required)).toBe(true);
  });

  it("separates public, protected, and optional-auth security", () => {
    expect(operation("get", "/projects").security).toEqual([]);
    expect(operation("get", "/projects/{projectId}").security).toEqual([]);
    expect(operation("get", "/projects/owned").security).toEqual([{ portal_session: [] }, { bearer: [] }]);
    expect(operation("get", "/projects/{projectId}/models/{modelId}/revisions/{revisionId}/preview.glb").security)
      .toEqual([{}, { portal_session: [] }, { bearer: [] }]);
  });

  it("narrows publication conflicts to the accepted domain codes", () => {
    const response = operation("put", "/projects/{projectId}/publication").responses?.["409"] as {
      content?: { "application/json"?: { schema?: { allOf?: Array<{ properties?: { error?: { properties?: { code?: { enum?: string[] } } } } }> } } };
    };
    const codes = response.content?.["application/json"]?.schema?.allOf?.[1]?.properties?.error?.properties?.code?.enum;
    expect(codes).toEqual([
      "project.version_conflict.v1",
      "project.primary_model_required.v1",
      "project.ready_primary_required.v1",
      "project.publication_conflict.v1",
    ]);
  });
});
