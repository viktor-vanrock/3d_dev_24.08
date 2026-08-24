export const API_URL = import.meta.env.VITE_API_URL ?? "";

// Тонкая обёртка над fetch — достраивает API_URL перед путём, остальное (credentials,
// method, headers, body) остаётся на вызывающей стороне без изменений.
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, init);
}
