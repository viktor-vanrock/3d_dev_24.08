// repo_url: задел GitVerse (MF-499/MF-501, Р4 эпика MF-497). Нейтрально к хостингу —
// принимаем любой https-URL, GitVerse — первый класс на уровне UI (design §4), не схемы/API.

export class InvalidRepoUrlError extends Error {
  constructor() {
    super("repo_url must be an https URL");
    this.name = "InvalidRepoUrlError";
  }
}

export function validateRepoUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InvalidRepoUrlError();
  }
  if (parsed.protocol !== "https:") throw new InvalidRepoUrlError();
  return parsed.toString();
}
