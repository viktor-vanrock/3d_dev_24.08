const PARK_ADD_RESUME_KEY = "portal.parkAdd.resume";

export interface ParkAddResume {
  readonly path: "/park/add";
  readonly params: Readonly<Record<string, string>>;
}

export function saveParkAddResume(search: string): void {
  try {
    const params = Object.fromEntries(new URLSearchParams(search));
    sessionStorage.setItem(PARK_ADD_RESUME_KEY, JSON.stringify({ path: "/park/add", params } satisfies ParkAddResume));
  } catch {
    // Private mode/quota: the URL-based return path remains the fallback.
  }
}

export function takeParkAddResume(): ParkAddResume | null {
  try {
    const raw = sessionStorage.getItem(PARK_ADD_RESUME_KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(PARK_ADD_RESUME_KEY);
    const value = JSON.parse(raw) as Partial<ParkAddResume>;
    if (value.path !== "/park/add" || value.params === null || typeof value.params !== "object" || Array.isArray(value.params)) return null;
    const params = Object.fromEntries(Object.entries(value.params).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    return { path: "/park/add", params };
  } catch {
    return null;
  }
}

export function parkAddResumePath(resume: ParkAddResume): string {
  const search = new URLSearchParams(resume.params).toString();
  return `${resume.path}${search ? `?${search}` : ""}`;
}
