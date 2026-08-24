// Адаптер источника (MF-406, декомпозиция MF-648): апстрим Ultimaker/Cura
// (github.com/Ultimaker/Cura, resources/definitions/*.def.json) — отдельный источник от
// scripts/import-machines-bootstrap.ts (тот читает SimplyPrint/slicer-profiles-db —
// агрегатор нескольких слайсеров с уже резолвнутыми inherits-цепочками). Здесь читаем апстрим
// Cura напрямую: файл может задавать свои machine_width/machine_depth/machine_height прямо в
// overrides (override всегда побеждает унаследованное значение — читать его без резолва
// цепочки inherits безопасно), либо наследовать их без собственного override — тогда цепочку
// резолвить не пытаемся и файл пропускаем (та же логика, что у cura-ветки в bootstrap-скрипте:
// «профиль остаётся частичным», не гадаем через inherits).
//
// Список файлов — один вызов Git Trees API (api.github.com, без лимита анонимного
// raw.githubusercontent.com), дальше каждый файл — отдельный raw-запрос. Пауза между
// raw-запросами обязательна: анонимный лимит raw.githubusercontent.com жёстче, чем у
// api.github.com — без паузы 429 уже на ~20-м запросе подряд (проверено вручную).
import type { RawCandidate, SourceAdapter } from "../types.ts";
import { fetchWithRetry } from "../http.ts";

const REPO = "Ultimaker/Cura";
const REF = "main";
const DEFINITIONS_PATH = "resources/definitions/";
const USER_AGENT = "portal-ru-ingest (+https://3mf.tech)";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;

interface CuraOverrideValue {
  default_value?: unknown;
}
interface CuraDefinition {
  name?: string;
  metadata?: { manufacturer?: string; author?: string };
  overrides?: Record<string, CuraOverrideValue>;
}

function numberOverride(overrides: Record<string, CuraOverrideValue> | undefined, key: string): number | undefined {
  const value = overrides?.[key]?.default_value;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export interface CuraDefinitionsAdapterOptions {
  /** Ограничить число прочитанных файлов (ручная проверка/быстрые прогоны) — по умолчанию весь апстрим. */
  limit?: number;
  /** Пауза между raw-запросами, мс (см. комментарий выше про анонимный лимит). */
  delayMs?: number;
  /** Таймаут одного HTTP-запроса. */
  timeoutMs?: number;
  /** Число повторов для сетевых ошибок, 408/425/429 и 5xx. */
  retries?: number;
  /** Пауза между повторами, мс. */
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

export class CuraDefinitionsAdapter implements SourceAdapter {
  id = "cura-definitions";
  private readonly limit: number | undefined;
  private readonly delayMs: number;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CuraDefinitionsAdapterOptions = {}) {
    this.limit = options.limit;
    this.delayMs = options.delayMs ?? 200;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetch(): Promise<RawCandidate[]> {
    const paths = await this.listDefinitionPaths();
    const files = this.limit !== undefined ? paths.slice(0, this.limit) : paths;

    const candidates: RawCandidate[] = [];
    for (const path of files) {
      const def = await this.fetchDefinition(path);
      const candidate = def ? toCandidate(path, def) : null;
      if (candidate) candidates.push(candidate);
      if (this.delayMs > 0) await sleep(this.delayMs);
    }
    return candidates;
  }

  private async listDefinitionPaths(): Promise<string[]> {
    const res = await this.request(`https://api.github.com/repos/${REPO}/git/trees/${REF}?recursive=1`);
    if (!res.ok) throw new Error(`GitHub trees API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { tree: Array<{ path: string; type: string }> };
    return data.tree.filter((t) => t.type === "blob" && t.path.startsWith(DEFINITIONS_PATH) && t.path.endsWith(".def.json")).map((t) => t.path);
  }

  private async fetchDefinition(path: string): Promise<CuraDefinition | null> {
    let res: Response;
    try {
      res = await this.request(`https://raw.githubusercontent.com/${REPO}/${REF}/${path}`);
    } catch {
      return null; // исчерпанные повторы одного файла не обрывают остальные определения
    }
    if (!res.ok) return null; // единичный сбой файла не должен ронять весь прогон источника
    try {
      return (await res.json()) as CuraDefinition;
    } catch {
      return null;
    }
  }

  private request(url: string): Promise<Response> {
    return fetchWithRetry(
      url,
      { headers: { "User-Agent": USER_AGENT } },
      {
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
        retries: this.retries,
        retryDelayMs: this.retryDelayMs,
      },
    );
  }
}

function toCandidate(path: string, def: CuraDefinition): RawCandidate | null {
  const vendor = def.metadata?.manufacturer ?? def.metadata?.author;
  const model = def.name;
  if (!vendor || !model) return null; // нет своего вендора/модели — не резолвим inherits, не кандидат

  const x = numberOverride(def.overrides, "machine_width");
  const y = numberOverride(def.overrides, "machine_depth");
  const z = numberOverride(def.overrides, "machine_height");
  if (x === undefined || y === undefined || z === undefined) return null; // требует резолва inherits — пропуск

  const nozzle = numberOverride(def.overrides, "machine_nozzle_size");

  return {
    externalRef: path,
    sourceUrl: `https://github.com/${REPO}/blob/${REF}/${path}`,
    raw: {
      vendor,
      model,
      specs: {
        build_volume: { x, y, z, shape: "rectangular" },
        ...(nozzle !== undefined ? { nozzle_diameters: [nozzle] } : {}),
      },
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
