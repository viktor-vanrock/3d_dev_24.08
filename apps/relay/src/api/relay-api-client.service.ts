import { Inject, Injectable } from "@nestjs/common";
import { RelayInternalV1Client } from "@portal/contracts/http/relay-internal.v1.client";
import { RELAY_CONFIG, type RelayConfig } from "../config/relay-config.ts";
import { CorrelationContext } from "../observability/correlation-context.ts";
import { RelayLogger } from "../observability/relay-logger.ts";
import { RelayMetrics } from "../observability/metrics.service.ts";
import { createBoundedFetch } from "./bounded-fetch.ts";

@Injectable()
export class RelayApiClient {
  readonly v1: RelayInternalV1Client;
  readonly revalidationV1: RelayInternalV1Client;

  constructor(
    @Inject(RELAY_CONFIG) config: RelayConfig,
    @Inject(RelayLogger) logger: RelayLogger,
    @Inject(RelayMetrics) metrics: RelayMetrics,
    @Inject(CorrelationContext) correlation: CorrelationContext,
  ) {
    this.v1 = new RelayInternalV1Client(
      config.api.baseUrl,
      config.api.serviceToken,
      createBoundedFetch({ config: config.api, logger, metrics, correlation }),
    );
    this.revalidationV1 = new RelayInternalV1Client(
      config.api.baseUrl,
      config.api.serviceToken,
      createBoundedFetch({
        config: { ...config.api, timeoutMs: config.gateway.revalidationTimeoutMs, retryAttempts: 0 },
        logger,
        metrics,
        correlation,
      }),
    );
  }
}
