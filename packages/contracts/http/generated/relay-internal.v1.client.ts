/**
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
  "relaySessionAuthorize": { method: "POST", path: "/internal/relay/v1/sessions/authorize" },
  "relaySessionHeartbeat": { method: "POST", path: "/internal/relay/v1/sessions/{sessionId}/heartbeat" },
  "relaySessionClose": { method: "POST", path: "/internal/relay/v1/sessions/{sessionId}/close" },
  "relayGatewaysRevalidate": { method: "POST", path: "/internal/relay/v1/gateways/revalidate" },
  "relayCommandsClaim": { method: "POST", path: "/internal/relay/v1/commands/claim" },
  "relayCommandLeaseHeartbeat": { method: "POST", path: "/internal/relay/v1/commands/{commandId}/lease-heartbeat" },
  "relayCommandResult": { method: "PUT", path: "/internal/relay/v1/commands/{commandId}/result" },
  "relayTransferMetadata": { method: "GET", path: "/internal/relay/v1/transfers/{transferId}/metadata" },
  "relayTransferSourceUrl": { method: "POST", path: "/internal/relay/v1/transfers/{transferId}/source-url" },
  "relayTransferProgress": { method: "PUT", path: "/internal/relay/v1/transfers/{transferId}/progress" },
  "relayTransferResult": { method: "PUT", path: "/internal/relay/v1/transfers/{transferId}/result" },
} as const;

export class RelayInternalApiError extends Error {
  readonly status: number;
  readonly body: JsonValue;

  constructor(status: number, body: JsonValue) {
    super(`relay internal API returned HTTP ${status}`);
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
    for (const [name, value] of Object.entries(runtime.path ?? {})) path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
    const url = new URL(path, this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
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

  relaySessionAuthorize(input: RelayClientInput<"relaySessionAuthorize">): Promise<RelayClientSuccess<"relaySessionAuthorize">> {
    return this.request("relaySessionAuthorize", input);
  }

  relaySessionHeartbeat(input: RelayClientInput<"relaySessionHeartbeat">): Promise<RelayClientSuccess<"relaySessionHeartbeat">> {
    return this.request("relaySessionHeartbeat", input);
  }

  relaySessionClose(input: RelayClientInput<"relaySessionClose">): Promise<RelayClientSuccess<"relaySessionClose">> {
    return this.request("relaySessionClose", input);
  }

  relayGatewaysRevalidate(input: RelayClientInput<"relayGatewaysRevalidate">): Promise<RelayClientSuccess<"relayGatewaysRevalidate">> {
    return this.request("relayGatewaysRevalidate", input);
  }

  relayCommandsClaim(input: RelayClientInput<"relayCommandsClaim">): Promise<RelayClientSuccess<"relayCommandsClaim">> {
    return this.request("relayCommandsClaim", input);
  }

  relayCommandLeaseHeartbeat(input: RelayClientInput<"relayCommandLeaseHeartbeat">): Promise<RelayClientSuccess<"relayCommandLeaseHeartbeat">> {
    return this.request("relayCommandLeaseHeartbeat", input);
  }

  relayCommandResult(input: RelayClientInput<"relayCommandResult">): Promise<RelayClientSuccess<"relayCommandResult">> {
    return this.request("relayCommandResult", input);
  }

  relayTransferMetadata(input: RelayClientInput<"relayTransferMetadata">): Promise<RelayClientSuccess<"relayTransferMetadata">> {
    return this.request("relayTransferMetadata", input);
  }

  relayTransferSourceUrl(input: RelayClientInput<"relayTransferSourceUrl">): Promise<RelayClientSuccess<"relayTransferSourceUrl">> {
    return this.request("relayTransferSourceUrl", input);
  }

  relayTransferProgress(input: RelayClientInput<"relayTransferProgress">): Promise<RelayClientSuccess<"relayTransferProgress">> {
    return this.request("relayTransferProgress", input);
  }

  relayTransferResult(input: RelayClientInput<"relayTransferResult">): Promise<RelayClientSuccess<"relayTransferResult">> {
    return this.request("relayTransferResult", input);
  }
}
