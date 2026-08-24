import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import openapiTS, { astToString } from "openapi-typescript";

const directory = fileURLToPath(new URL(".", import.meta.url));
const sourcePath = `${directory}/relay-internal.v1.openapi.json`;
const outputPath = `${directory}/generated/relay-internal.v1.ts`;
const clientPath = `${directory}/generated/relay-internal.v1.client.ts`;
const documentationPath = `${directory}/generated/relay-internal.v1.md`;
const check = process.argv.includes("--check");

const document = JSON.parse(await readFile(sourcePath, "utf8"));
const nodes = await openapiTS(document, { alphabetize: true, immutable: true });
const generated = astToString(nodes)
  .replace(/^\s*readonly \[name: string\]: unknown;\n/gm, "")
  .replace(/^\s*\[name: string\]: unknown;\n/gm, "");

const operations = Object.entries(document.paths).flatMap(([path, pathItem]) =>
  Object.entries(pathItem)
    .filter(([method]) => ["get", "post", "put"].includes(method))
    .map(([method, operation]) => ({ method: method.toUpperCase(), operationId: operation.operationId, path })),
);

const operationMap = operations
  .map(({ method, operationId, path }) => `  ${JSON.stringify(operationId)}: { method: ${JSON.stringify(method)}, path: ${JSON.stringify(path)} },`)
  .join("\n");
const convenienceMethods = operations
  .map(
    ({ operationId }) => `  ${operationId}(input: RelayClientInput<${JSON.stringify(operationId)}>): Promise<RelayClientSuccess<${JSON.stringify(operationId)}>> {
    return this.request(${JSON.stringify(operationId)}, input);
  }`,
  )
  .join("\n\n");
const client = `/**
 * Generated from relay-internal.v1.openapi.json. Do not edit directly.
 */
import type { operations } from "./relay-internal.v1.ts";

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
type OperationId = keyof operations;
type Parameters<K extends OperationId> = operations[K]["parameters"];
type HeaderInput<K extends OperationId> = Omit<Parameters<K>["header"], "x-relay-service-token">;
type PathInput<K extends OperationId> = Parameters<K> extends { readonly path: infer P } ? P : never;
type QueryInput<K extends OperationId> = Parameters<K> extends { readonly query: infer Q } ? Q : never;
type BodyInput<K extends OperationId> = operations[K] extends { readonly requestBody: { readonly content: { readonly "application/json": infer B } } } ? B : never;
export type RelayClientSuccess<K extends OperationId> = operations[K]["responses"][200]["content"]["application/json"];
export type RelayClientInput<K extends OperationId> = {
  readonly headers: HeaderInput<K>;
} & (PathInput<K> extends never ? Record<never, never> : { readonly path: PathInput<K> })
  & (QueryInput<K> extends never ? Record<never, never> : { readonly query: QueryInput<K> })
  & (BodyInput<K> extends never ? Record<never, never> : { readonly body: BodyInput<K> });

interface RuntimeInput {
  readonly headers: Readonly<Record<string, string>>;
  readonly path?: Readonly<Record<string, string | number>>;
  readonly query?: Readonly<Record<string, string | number>>;
  readonly body?: JsonValue;
}

const OPERATIONS = {
${operationMap}
} as const;

export class RelayInternalApiError extends Error {
  readonly status: number;
  readonly body: JsonValue;

  constructor(status: number, body: JsonValue) {
    super(\`relay internal API returned HTTP \${status}\`);
    this.status = status;
    this.body = body;
  }
}

export class RelayInternalV1Client {
  private readonly baseUrl: string;
  private readonly serviceToken: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(
    baseUrl: string,
    serviceToken: string,
    fetchImplementation: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl;
    this.serviceToken = serviceToken;
    this.fetchImplementation = fetchImplementation;
  }

  async request<K extends OperationId>(operationId: K, input: RelayClientInput<K>): Promise<RelayClientSuccess<K>> {
    const definition = OPERATIONS[operationId];
    const runtime = input as RuntimeInput;
    let path: string = definition.path;
    for (const [name, value] of Object.entries(runtime.path ?? {})) path = path.replace(\`{\${name}}\`, encodeURIComponent(String(value)));
    const url = new URL(path, this.baseUrl.endsWith("/") ? this.baseUrl : \`\${this.baseUrl}/\`);
    for (const [name, value] of Object.entries(runtime.query ?? {})) url.searchParams.set(name, String(value));
    const response = await this.fetchImplementation(url, {
      method: definition.method,
      headers: { ...runtime.headers, "x-relay-service-token": this.serviceToken, ...(runtime.body === undefined ? {} : { "content-type": "application/json" }) },
      ...(runtime.body === undefined ? {} : { body: JSON.stringify(runtime.body) }),
    });
    const payload = (await response.json()) as JsonValue;
    if (!response.ok) throw new RelayInternalApiError(response.status, payload);
    return payload as RelayClientSuccess<K>;
  }

${convenienceMethods}
}
`;

const documentationRows = operations
  .map(({ method, operationId, path }) => {
    const retry = method === "GET" ? "read" : operationId === "relayGatewaysRevalidate" ? "idempotent" : "operation identity";
    return `| \`${operationId}\` | \`${method}\` | \`${path}\` | ${retry} |`;
  })
  .join("\n");
const documentation = `# Portal Relay Internal API v1

Generated from \`relay-internal.v1.openapi.json\`. Do not edit directly.

All operations require the relay-only \`x-relay-service-token\` api-key credential and \`x-correlation-id\`. Mutations marked “operation identity” also require \`x-operation-id\`; the same identity and request fingerprint replay the accepted result, while a contradictory payload is a conflict. Gateway credentials are not valid service credentials.

| Operation | Method | Path | Retry |
| --- | --- | --- | --- |
${documentationRows}

Every success response and every safe error response has a named closed schema. Transfer source URLs are HTTPS, range-capable, immutable-version scoped, no-store and expire within five minutes.
`;

if (/(?:\:\s*(?:any|unknown)\b|\bas\s+(?:any|unknown)\b)/.test(generated)) {
  throw new Error("generated relay transport types contain a permissive type");
}

if (/(?:\:\s*(?:any|unknown)\b|\bas\s+(?:any|unknown)\b)/.test(client)) {
  throw new Error("generated relay client contains a permissive type");
}

if (check) {
  const [existing, existingClient, existingDocumentation] = await Promise.all([
    readFile(outputPath, "utf8").catch(() => ""),
    readFile(clientPath, "utf8").catch(() => ""),
    readFile(documentationPath, "utf8").catch(() => ""),
  ]);
  if (existing !== generated || existingClient !== client || existingDocumentation !== documentation) {
    throw new Error("relay internal generated types are stale; run relay-internal:generate");
  }
} else {
  await Promise.all([writeFile(outputPath, generated), writeFile(clientPath, client), writeFile(documentationPath, documentation)]);
}
