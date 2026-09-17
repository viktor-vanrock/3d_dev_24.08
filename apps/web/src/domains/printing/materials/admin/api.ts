import { apiFetch } from "@shared/api";

export type AdminMaterialKind = "filament" | "resin" | "plywood" | "aluminum";
export type AdminMaterialStatus = "draft" | "published" | "archived";

export interface AdminMaterial {
  readonly id: string;
  readonly kind: AdminMaterialKind;
  readonly slug: string;
  readonly name: string;
  readonly vendor_id: string;
  readonly vendor_name: string;
  readonly material_type_id: string;
  readonly material_type_name: string;
  readonly specs: Readonly<Record<string, string | number | boolean>>;
  readonly status: AdminMaterialStatus;
  readonly version: number;
  readonly updated_at: string;
}

export interface AdminMaterialPage {
  readonly items: readonly AdminMaterial[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly has_more: boolean;
}

export interface AdminMaterialOption {
  readonly id: string;
  readonly name: string;
}

export interface AdminMaterialOptions {
  readonly vendors: readonly AdminMaterialOption[];
  readonly material_types: readonly AdminMaterialOption[];
}

export async function getAdminMaterialOptions(): Promise<AdminMaterialOptions> {
  const response = await apiFetch("/data/materials/options", { credentials: "include" });
  if (!response.ok) throw new Error(`material options request failed: ${response.status}`);
  return response.json();
}

export interface AdminMaterialCreate {
  readonly kind: AdminMaterialKind;
  readonly slug: string;
  readonly name: string;
  readonly vendor_id: string;
  readonly material_type_id: string;
  readonly specs: Readonly<Record<string, string | number | boolean>>;
}

export async function listAdminMaterials(input: { readonly q?: string; readonly kind?: AdminMaterialKind; readonly status?: AdminMaterialStatus }, signal?: AbortSignal): Promise<AdminMaterialPage> {
  const query = new URLSearchParams({ limit: "30" });
  if (input.q) query.set("q", input.q);
  if (input.kind) query.set("kind", input.kind);
  if (input.status) query.set("status", input.status);
  const response = await apiFetch(`/data/materials?${query}`, { credentials: "include", signal });
  if (!response.ok) throw new Error(`managed materials request failed: ${response.status}`);
  return response.json();
}

export async function createAdminMaterial(input: AdminMaterialCreate): Promise<{ readonly id: string; readonly version: number }> {
  const response = await apiFetch("/data/materials", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`material create failed: ${response.status}`);
  return response.json();
}

export async function getAdminMaterial(id: string): Promise<AdminMaterial> {
  const response = await apiFetch(`/data/materials/${encodeURIComponent(id)}`, { credentials: "include" });
  if (!response.ok) throw new Error(`material read failed: ${response.status}`);
  return response.json();
}

export async function updateAdminMaterial(id: string, input: Readonly<Record<string, unknown>>): Promise<{ readonly id: string; readonly version: number }> {
  const response = await apiFetch(`/data/materials/${encodeURIComponent(id)}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error(`material update failed: ${response.status}`);
  return response.json();
}

export async function publishAdminMaterial(id: string, version: number): Promise<{ readonly id: string; readonly version: number }> {
  const response = await apiFetch(`/data/materials/${encodeURIComponent(id)}/publish`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version }) });
  if (!response.ok) throw new Error(`material publish failed: ${response.status}`);
  return response.json() as Promise<{ readonly id: string; readonly version: number }>;
}

export async function restoreAdminMaterial(id: string, version: number): Promise<{ readonly id: string; readonly version: number }> {
  const response = await apiFetch(`/data/materials/${encodeURIComponent(id)}/restore`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version }) });
  if (!response.ok) throw new Error(`material restore failed: ${response.status}`);
  return response.json();
}

export async function archiveAdminMaterial(id: string, version: number): Promise<{ readonly id: string; readonly version: number }> {
  const response = await apiFetch(`/data/materials/${encodeURIComponent(id)}/archive`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version }) });
  if (!response.ok) throw new Error(`material archive failed: ${response.status}`);
  return response.json();
}
