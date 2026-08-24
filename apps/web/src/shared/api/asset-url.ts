import { API_URL } from "./http.ts";

// preview_url/thumb_url приходят от API как пути прокси-стриминга (MF-470), не абсолютные
// URL — веб и API живут на разных поддоменах (3mf.tech / api.3mf.tech), поэтому перед
// использованием в <img>/GLTFLoader их нужно достроить тем же API_URL, что и остальные запросы.
export function apiAssetUrl(path: string): string {
  if (/^(?:https?:|data:|blob:)/i.test(path)) return path;
  return `${API_URL}${path}`;
}
