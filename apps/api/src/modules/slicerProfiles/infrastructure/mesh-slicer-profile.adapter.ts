import { Injectable } from "@nestjs/common";
import type { SlicerProfileId } from "../domain/slicer-profile.ts";
import type { PrusaIniResult } from "../public/index.ts";
import { meshBaseUrl } from "../../makes/public/index.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

@Injectable()
export class MeshSlicerProfileAdapter {
  async resolvePrusaIni(profileId: SlicerProfileId): Promise<PrusaIniResult> {
    const baseUrl = process.env.MESH_HTTP_URL ?? "http://127.0.0.1:3101";
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/slicer-profiles/${encodeURIComponent(profileId)}/prusa-ini`);
    } catch {
      return { ok: false, status: 503, error: "mesh_unreachable" };
    }

    const body: unknown = await response.json().catch(() => null);
    if (response.status === 200 && isRecord(body) && typeof body.ini === "string" && isRecord(body.params)) {
      return { ok: true, ini: body.ini, params: body.params };
    }
    if (isRecord(body) && isRecord(body.detail) && "error" in body.detail) {
      return { ok: false, status: response.status, error: String(body.detail.error) };
    }
    return { ok: false, status: response.status, error: `mesh_error_${response.status}` };
  }
}

/** Compatibility function for device relay callers that need the raw mesh payload. */
export async function resolvePrusaIniViaMesh(profileId: string): Promise<PrusaIniResult> {
  let response: Response;
  try {
    response = await fetch(`${meshBaseUrl()}/slicer-profiles/${encodeURIComponent(profileId)}/prusa-ini`);
  } catch {
    return { ok: false, status: 503, error: "mesh_unreachable" };
  }
  if (response.status === 200) {
    const body = (await response.json()) as { ini: string; params: Record<string, unknown> };
    return { ok: true, ini: body.ini, params: body.params };
  }
  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
  const detail = body?.detail;
  if (typeof detail === "object" && detail !== null && "error" in detail) {
    return { ok: false, status: response.status, error: String(detail.error) };
  }
  return { ok: false, status: response.status, error: `mesh_error_${response.status}` };
}
