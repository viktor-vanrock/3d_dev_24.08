import { apiFetch } from "@shared/api";
import type { ProjectAction } from "./project-lifecycle.ts";

export async function executeProjectAction(projectId: string, action: ProjectAction, etag: string): Promise<{ readonly etag: string }> {
  const routes: Partial<Record<ProjectAction, { readonly method: string; readonly path: string; readonly body?: object }>> = {
    publish: { method: "PUT", path: "publication", body: { confirmed: true } },
    unpublish: { method: "DELETE", path: "publication" },
    archive: { method: "POST", path: "archive" },
    restore: { method: "POST", path: "restore" },
  };
  const route = routes[action];
  if (route === undefined) throw new Error(`Действие '${action}' не поддерживается напрямую`);
  const response = await apiFetch(`/projects/${encodeURIComponent(projectId)}/${route.path}`, {
    method: route.method,
    credentials: "include",
    headers: { "Content-Type": "application/json", "If-Match": etag },
    body: route.body === undefined ? undefined : JSON.stringify(route.body),
  });
  if (!response.ok) {
    const body = await response.json().catch((): { readonly message?: string } => ({}));
    throw new Error(body.message ?? `Ошибка ${response.status}`);
  }
  return { etag: response.headers.get("ETag") ?? etag };
}
