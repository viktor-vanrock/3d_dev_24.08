const UUID_PATH_SEGMENT = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const PUBLIC_GET_PATH_PATTERNS = [
  /^\/projects(\?.*)?$/,
  new RegExp(`^/projects/${UUID_PATH_SEGMENT}(\\?.*)?$`, "i"),
  new RegExp(`^/projects/${UUID_PATH_SEGMENT}/models/${UUID_PATH_SEGMENT}/revisions/${UUID_PATH_SEGMENT}/preview\\.glb(\\?.*)?$`, "i"),
  /^\/feed(\?.*)?$/,
  /^\/feed\/posts\/[^/?]+(\?.*)?$/,
  /^\/feed\/posts\/[^/?]+\/media(\?.*)?$/,
  /^\/feed\/posts\/[^/?]+\/poster(\?.*)?$/,
  /^\/feed\/posts\/[^/?]+\/images\/[^/?]+(\?.*)?$/,
  new RegExp(`^/avatars/${UUID_PATH_SEGMENT}/snapshots/(left|right|front)(\\?.*)?$`, "i"),
  new RegExp(`^/avatars/${UUID_PATH_SEGMENT}/snapshots/[1-9][0-9]*/(left|right|front)/[0-9a-f]{64}\\.png(\\?.*)?$`, "i"),
  /^\/printers(\?.*)?$/,
  // `/printers/reports` is a literal authenticated review queue, not a printer slug.
  /^\/printers\/(?!reports(?:\?|$))[^/?]+(\?.*)?$/,
  /^\/community-firmware(\?.*)?$/,
  /^\/vendors(\?.*)?$/,
  /^\/machines(\?.*)?$/,
  /^\/machines\/[^/?]+(\?.*)?$/,
  /^\/releases(\?.*)?$/,
  /^\/materials(\?.*)?$/,
  /^\/materials\/[^/?]+(\?.*)?$/,
  /^\/concepts(\?.*)?$/,
  new RegExp(`^/concepts/${UUID_PATH_SEGMENT}/preview(\\?.*)?$`, "i"),
  /^\/master-services\/[^/?]+(\?.*)?$/,
  /^\/masters\/[^/?]+\/services(\?.*)?$/,
  /^\/masters\/[^/?]+\/equipment(\?.*)?$/,
  /^\/masters\/[^/?]+(\?.*)?$/,
  /^\/ideas(\?.*)?$/,
  new RegExp(`^/ideas/${UUID_PATH_SEGMENT}(\\?.*)?$`, "i"),
  new RegExp(`^/ideas/${UUID_PATH_SEGMENT}/comments(\\?.*)?$`, "i"),
];

const ALWAYS_OPEN_GET_PATH_PATTERNS = [
  /^\/metrics(\?.*)?$/,
  /^\/printers(\?.*)?$/,
  /^\/printers\/(?!reports(?:\?|$))[^/?]+(\?.*)?$/,
  /^\/concepts(\?.*)?$/,
  new RegExp(`^/concepts/${UUID_PATH_SEGMENT}/preview(\\?.*)?$`, "i"),
];

const OPEN_EXACT_POST_PATH_PATTERNS = [/^\/feed\/ingest(\?.*)?$/, /^\/feed\/posts(\?.*)?$/, /^\/feed\/media(\?.*)?$/];
const AUTHENTICATED_EXACT_POST_PATH_PATTERNS = [/^\/auth\/logout-all(\?.*)?$/];

const CLOSED_OPEN_PATH_PREFIXES = ["/health", "/auth/", "/devices/agent/", "/internal/relay/", "/research/", "/v0/", "/billing/webhooks/"];

const PUBLIC_OPEN_PATH_PREFIXES = [
  "/health",
  "/auth/",
  "/seo/",
  "/sitemap.xml",
  "/robots.txt",
  "/consent",
  "/devices/agent/",
  "/internal/relay/",
  "/research/",
  "/v0/",
  "/billing/webhooks/",
];

export interface AuthMatrixInput {
  readonly method: string;
  readonly url: string;
  readonly closedDev: boolean;
}

export function isClosedDev(environment: Readonly<Record<string, string | undefined>>): boolean {
  return environment.CLOSED_DEV === "1" || environment.PORTAL_PUBLIC === "false";
}

export function requiresSession({ method, url, closedDev }: AuthMatrixInput): boolean {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === "POST" && AUTHENTICATED_EXACT_POST_PATH_PATTERNS.some((pattern) => pattern.test(url))) return true;

  const openPrefixes = closedDev ? CLOSED_OPEN_PATH_PREFIXES : PUBLIC_OPEN_PATH_PREFIXES;
  if (openPrefixes.some((prefix) => url.startsWith(prefix))) return false;

  if (
    normalizedMethod === "GET" &&
    (ALWAYS_OPEN_GET_PATH_PATTERNS.some((pattern) => pattern.test(url)) || (!closedDev && PUBLIC_GET_PATH_PATTERNS.some((pattern) => pattern.test(url))))
  ) {
    return false;
  }
  if (normalizedMethod === "POST" && OPEN_EXACT_POST_PATH_PATTERNS.some((pattern) => pattern.test(url))) {
    return false;
  }
  return true;
}
