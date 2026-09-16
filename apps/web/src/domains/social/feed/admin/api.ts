import { apiFetch } from "@shared/api";

export type NewsAdminStatus = "draft" | "published" | "hidden";
export type NewsAdminSource = "manual" | "scout";
export interface NewsAdminItem {
  readonly id: string;
  readonly title: string;
  readonly body: string | null;
  readonly status: NewsAdminStatus;
  readonly source: NewsAdminSource;
  readonly source_url: string | null;
  readonly updated_at: string;
}

export type NewsAdminReadResult<T> =
  | { readonly kind: "success"; readonly value: T }
  | { readonly kind: "not_found" }
  | { readonly kind: "failure" };

function isNewsAdminItem(value: unknown): value is NewsAdminItem {
  if (typeof value !== "object" || value === null) return false;
  return "id" in value && typeof value.id === "string"
    && "title" in value && typeof value.title === "string"
    && "body" in value && (typeof value.body === "string" || value.body === null)
    && "status" in value && (value.status === "draft" || value.status === "published" || value.status === "hidden")
    && "source" in value && (value.source === "manual" || value.source === "scout")
    && "source_url" in value && (typeof value.source_url === "string" || value.source_url === null)
    && "updated_at" in value && typeof value.updated_at === "string";
}

function readItems(value: unknown): NewsAdminItem[] | null {
  if (typeof value !== "object" || value === null || !("items" in value) || !Array.isArray(value.items) || !value.items.every(isNewsAdminItem)) return null;
  return value.items;
}

function readItem(value: unknown): NewsAdminItem | null {
  if (typeof value !== "object" || value === null || !("item" in value) || !isNewsAdminItem(value.item)) return null;
  return value.item;
}

export async function listAdminNews(filters: { status?: NewsAdminStatus | "all"; source?: NewsAdminSource | "all" } = {}, signal?: AbortSignal): Promise<NewsAdminReadResult<readonly NewsAdminItem[]>> {
  const query = new URLSearchParams();
  if (filters.status && filters.status !== "all") query.set("status", filters.status);
  if (filters.source && filters.source !== "all") query.set("source", filters.source);
  const response = await apiFetch(`/data/news${query.size > 0 ? `?${query}` : ""}`, { credentials: "include", signal });
  if (!response.ok) return response.status === 404 ? { kind: "not_found" } : { kind: "failure" };
  const items = readItems(await response.json());
  return items === null ? { kind: "failure" } : { kind: "success", value: items };
}

export async function getAdminNews(id: string, signal?: AbortSignal): Promise<NewsAdminReadResult<NewsAdminItem>> {
  const response = await apiFetch(`/data/news/${encodeURIComponent(id)}`, { credentials: "include", signal });
  if (!response.ok) return response.status === 404 ? { kind: "not_found" } : { kind: "failure" };
  const item = readItem(await response.json());
  return item === null ? { kind: "failure" } : { kind: "success", value: item };
}

async function adminNewsMutation(path: string, method: "POST" | "PATCH", body?: { title: string; body?: string }): Promise<NewsAdminItem | null> {
  const response = await apiFetch(path, { method, credentials: "include", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) return null;
  return readItem(await response.json());
}

export function createAdminNews(input: { title: string; body?: string }) { return adminNewsMutation("/data/news", "POST", input); }
export function updateAdminNews(id: string, input: { title: string; body?: string }) { return adminNewsMutation(`/data/news/${encodeURIComponent(id)}`, "PATCH", input); }
export function publishAdminNews(id: string) { return adminNewsMutation(`/data/news/${encodeURIComponent(id)}/publish`, "POST"); }
export function hideAdminNews(id: string) { return adminNewsMutation(`/data/news/${encodeURIComponent(id)}/hide`, "POST"); }
