// Адаптер источника (MF-406, декомпозиция MF-648): вендор-сайт по шаблону Shopify —
// публичный /products.json (см. sovol3d.com/robots.txt: «Public product ... is crawlable»,
// Allow: /) отдаёт каталог структурированным JSON, без HTML-парсинга страниц. Технических
// характеристик (объём печати/кинематика/темп.) в products.json нет — только в body_html как
// маркетинговый список <li>Key: Value</li> одного шаблона на всех карточках принтеров этого
// магазина; парсим регэкспами по этому шаблону (структурно, не LLM) — чего нет в тексте, не
// заполняем, не гадаем. currency захардкожен в USD (в /products.json валюты нет вовсе; USD
// подтверждён вручную — Shopify.currency.active на карточке товара).
//
// Тот же шаблон products.json одинаков у любой Shopify-витрины — адаптер переиспользуем для
// другого вендора сменой SHOP_DOMAIN/PRINTER_PRODUCT_TYPE, если он тоже держит витрину на Shopify.
import type { RawCandidate, SourceAdapter } from "../types.ts";
import { fetchWithRetry } from "../http.ts";

const SHOP_DOMAIN = "www.sovol3d.com";
const PRINTER_PRODUCT_TYPE = "3D Printers";
const CURRENCY = "USD";
const USER_AGENT = "portal-ru-ingest (+https://3mf.tech)";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;
// Партия б/у-техники под несколькими SKU сразу, не отдельная модель — нет собственных
// характеристик для карточки кандидата, пропускаем явно вместо мусора в очереди.
const SKIP_TITLE_RE = /\b(used|refurbished)\b/i;

const BUILD_VOLUME_RE = /(\d+(?:\.\d+)?)\s*(?:mm)?\s*[×x*]\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*[×x*]\s*(\d+(?:\.\d+)?)\s*mm/i;
const NOZZLE_TEMP_RE = /nozzle temperature[^\d]*(\d+(?:\.\d+)?)\s*[℃°]/i;
const BED_TEMP_RE = /(?:hot\s*)?bed temperature[^\d]*(\d+(?:\.\d+)?)\s*[℃°]/i;
const KINEMATICS_PATTERNS: Array<[string, RegExp]> = [
  ["corexy", /core[\s-]?xy/i],
  ["delta", /\bdelta\b/i],
  ["bedslinger", /bed[\s-]?slinger/i],
  ["i3", /\bi3\b/i],
];

interface ShopifyImage {
  src: string;
}
interface ShopifyVariant {
  price: string;
}
interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  vendor: string;
  product_type: string;
  body_html: string;
  images: ShopifyImage[];
  variants: ShopifyVariant[];
}
interface ShopifyProductsResponse {
  products: ShopifyProduct[];
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSpecs(bodyHtml: string): Record<string, unknown> {
  const text = stripTags(bodyHtml);
  const specs: Record<string, unknown> = {};

  const volume = BUILD_VOLUME_RE.exec(text);
  if (volume) {
    specs.build_volume = {
      x: Number(volume[1]),
      y: Number(volume[2]),
      z: Number(volume[3]),
      shape: "rectangular",
    };
  }
  const nozzleTemp = NOZZLE_TEMP_RE.exec(text);
  if (nozzleTemp) specs.max_nozzle_temp_c = Number(nozzleTemp[1]);
  const bedTemp = BED_TEMP_RE.exec(text);
  if (bedTemp) specs.max_bed_temp_c = Number(bedTemp[1]);

  for (const [name, pattern] of KINEMATICS_PATTERNS) {
    if (pattern.test(text)) {
      specs.kinematics = name;
      break;
    }
  }
  return specs;
}

export interface Sovol3dStoreAdapterOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

export class Sovol3dStoreAdapter implements SourceAdapter {
  id = "sovol3d-store";
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: Sovol3dStoreAdapterOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetch(): Promise<RawCandidate[]> {
    const products = await this.fetchAllProducts();
    return products.filter((p) => p.product_type === PRINTER_PRODUCT_TYPE && !SKIP_TITLE_RE.test(p.title)).map(toCandidate);
  }

  private async fetchAllProducts(): Promise<ShopifyProduct[]> {
    // Каталог одного вендора — десятки принтеров, одной страницы (limit=250, максимум
    // Shopify для этого эндпоинта) достаточно, пагинация не нужна.
    const res = await fetchWithRetry(
      `https://${SHOP_DOMAIN}/products.json?limit=250`,
      { headers: { "User-Agent": USER_AGENT } },
      { fetchImpl: this.fetchImpl, timeoutMs: this.timeoutMs, retries: this.retries, retryDelayMs: this.retryDelayMs },
    );
    if (!res.ok) throw new Error(`${SHOP_DOMAIN} products.json ${res.status}`);
    const data = (await res.json()) as ShopifyProductsResponse;
    return data.products;
  }
}

function toCandidate(product: ShopifyProduct): RawCandidate {
  const prices = product.variants.map((v) => Number(v.price)).filter((p) => Number.isFinite(p));
  const minPrice = prices.length > 0 ? Math.min(...prices) : undefined;

  return {
    externalRef: String(product.id),
    sourceUrl: `https://${SHOP_DOMAIN}/products/${product.handle}`,
    raw: {
      vendor: product.vendor,
      model: product.title,
      specs: extractSpecs(product.body_html),
      images: product.images.map((i) => i.src),
      ...(minPrice !== undefined ? { price: { amount: minPrice, currency: CURRENCY } } : {}),
    },
  };
}
