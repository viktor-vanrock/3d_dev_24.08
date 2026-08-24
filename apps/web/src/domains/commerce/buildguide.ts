// Публичный build guide проекта (MF-366): проект может быть как одним файлом для печати,
// так и полноценной сборкой с деталями, инструментами, фотографиями и привязкой шага к mesh.
// API уже живёт в apps/api/src/models/buildGuide.route.ts; здесь только читающий контракт.

import { demoBuildGuideFor } from "./demoproject.ts";

import { apiFetch } from "@shared/api";

export interface ProjectBuildPhoto {
  id: string;
  url: string;
  position: number;
  size_bytes: number | null;
  mime_type: string | null;
}

export type ProjectBuildPhase = "print" | "assembly" | "flash" | "solder" | "check";

export interface ProjectBuildArtifact {
  id: string;
  label: string;
  path: string;
  url: string;
  format: "stl" | "gltf" | "image" | "source";
  role: "calibration" | "print" | "assembly" | "software";
  quantity?: string;
  note?: string;
}

export interface ProjectBuildCommand {
  label: string;
  code: string;
  note?: string;
}

export interface ProjectBuildSource {
  label: string;
  url: string;
  locator?: string;
}

export interface ProjectBuildStep {
  id: string;
  position: number;
  title: string;
  body: string | null;
  mesh_id: string | null;
  mesh_object_ref: unknown;
  parts: unknown;
  tools: unknown;
  photos: ProjectBuildPhoto[];
  /** Расширение code-first сценария. Старый API может не присылать эти поля. */
  phase?: ProjectBuildPhase;
  artifacts?: ProjectBuildArtifact[];
  commands?: ProjectBuildCommand[];
  checklist?: string[];
  warnings?: string[];
  source?: ProjectBuildSource;
}

export interface ProjectBuildGuide {
  id: string;
  version: number;
  steps: ProjectBuildStep[];
}

export async function getProjectBuildGuide(modelId: string): Promise<ProjectBuildGuide | null> {
  const demo = demoBuildGuideFor(modelId);
  if (demo) return demo;
  const response = await apiFetch(`/models/${encodeURIComponent(modelId)}/build-guide`, {
    credentials: "include",
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { guide?: ProjectBuildGuide | null };
  return body.guide ?? null;
}
