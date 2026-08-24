import path from "node:path";
import type { CommitAuthor } from "./repo.ts";
import type { SessionUser } from "../modules/auth/public/session.ts";

// Резолвинг projectId → repoPath на диске (docs/architecture/git.module.md: «забота
// вызывающего кода», MF-518 инфра — /srv/git/repos на VDS). `models.repo_path` хранит
// имя каталога репо (сегодня всегда сам model_id, docs/infra/git-repos.md), не абсолютный
// путь — GIT_REPOS_DIR даёт базу, переопределима в тестах/окружениях без правки схемы.
function reposBaseDir(): string {
  return process.env.GIT_REPOS_DIR ?? "/srv/git/repos";
}

export function absoluteRepoPath(repoPath: string): string {
  return path.join(reposBaseDir(), repoPath);
}

// Данные (docs/epics/project.git.md §10.1): dirname на диске = models.id проекта, тот же
// UUID и есть значение колонки repo_path.
export function repoDirNameForModel(modelId: string): string {
  return modelId;
}

// Синтетический git-автор из сессии портала — юзер никогда не вводит git-креды (§3 эпика,
// "юзер работает через портал"), commit делает apps/api от его лица. users.email не
// собирается на всех методах входа (PlagID/SberID), поэтому используем стабильный
// noreply-адрес на username, как делают форжи (GitHub/GitLab noreply-паттерн).
export function gitAuthorForUser(user: SessionUser): CommitAuthor {
  return { name: user.username, email: `${user.username}@users.3mf.tech` };
}

// Папка репо по конвенции ремесла/роли (Data+Design, project.git.md §10.2). 'source'/'aux' —
// по craft проекта (для живого MVP craft всегда '3d_printing' → print/); остальные роли
// сами называют своё ремесло однозначно.
const CRAFT_FOLDER: Record<string, string> = {
  "3d_printing": "print",
  cnc: "cad",
  laser: "cad",
  electronics: "pcb",
  software: "code",
};

// Git-backed роли (docs/epics/project.git.md §10.2/§10.2.3) — единственный источник истины
// для «эта роль живёт в git». `description_image` НЕ входит (§10.2.2, вердикт Data закрыт
// навсегда): картинки описания остаются в S3 (CDN-offload, N файлов на fileId — git-путь
// "папка+оригинальное имя" коллизирует ровно на этой роли). Другой код (models/repository.ts
// fallback-дерево, models/repoBackfill.ts) обязан читать этот список, а не заводить свою копию —
// три независимых копии уже разъезжались (MF-1965).
export const GIT_BACKED_ROLES = ["source", "aux", "drawing", "cnc_program", "gerber", "code_archive", "project_doc"] as const;

export type RepoFileRole = (typeof GIT_BACKED_ROLES)[number];

export function repoFolderForRole(role: RepoFileRole, craft: string): string {
  switch (role) {
    // Крафт-нейтрально (§10.2.3): мета-документы проекта (LICENSE.md и т.п.) не зависят от
    // ремесла, путь фиксированный `docs/` для любого craft.
    case "project_doc":
      return "docs";
    case "cnc_program":
    case "drawing":
      return "cad";
    case "gerber":
      return "pcb";
    case "code_archive":
      return "code";
    case "source":
    case "aux":
      return CRAFT_FOLDER[craft] ?? "print";
  }
}

// Путь файла в дереве репо — папка ремесла/роли + исходное имя файла (§10.2: "исходное имя
// файла сохраняется как есть, не переименовываем в role.ext"). `path.basename` срезает любые
// каталоги из имени, которое прислал клиент — защита от path traversal тем же способом, что
// git/repo.ts::assertSafeRelativePath делает для абсолютных/`..`-путей.
export function repoFilePath(role: RepoFileRole, craft: string, originalFilename: string): string {
  const folder = repoFolderForRole(role, craft);
  const name = path.basename(originalFilename || "") || "file";
  return `${folder}/${name}`;
}
