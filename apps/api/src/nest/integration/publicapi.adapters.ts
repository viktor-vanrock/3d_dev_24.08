import { Global, HttpException, Inject, Injectable, Module } from "@nestjs/common";
import type { Request } from "express";
import { checkRateLimit, serializeRateLimitMetadata } from "../../modules/security/public/index.ts";
import { DevicesModule } from "../../modules/devices/devices.module.ts";
import { DEVICE_PUBLIC_API_OPERATIONS_PORT, type DevicePublicApiOperationsPort } from "../../modules/devices/public/index.ts";
import { PUBLICAPI_DEVICES_PORT, PUBLICAPI_EXTERNAL_PORT, type PublicApiDevicesPort, type PublicApiExternalPort } from "../../modules/publicapi/public/index.ts";
import { getRequestId, type RequestWithId } from "../observability/request-id.ts";
@Injectable()
export class PublicApiExternalAdapter implements PublicApiExternalPort {
  async assertRateLimit(request: Request, principalId: string) {
    const outcome = checkRateLimit({ ip: request.ip ?? request.socket.remoteAddress ?? "unknown", headers: request.headers }, "public_api", principalId);
    const response = request.res;
    for (const [name, value] of Object.entries(serializeRateLimitMetadata(outcome, getRequestId(request as RequestWithId)))) response?.setHeader(name, value);
    if (outcome.limited) {
      response?.setHeader("Retry-After", String(outcome.retryAfterSeconds ?? 60));
      throw new HttpException({}, 429);
    }
    if (outcome.slowdownMs && outcome.slowdownMs > 0) await new Promise((resolve) => setTimeout(resolve, outcome.slowdownMs));
  }
}
@Injectable()
export class PublicApiDevicesAdapter implements PublicApiDevicesPort {
  constructor(@Inject(DEVICE_PUBLIC_API_OPERATIONS_PORT) private readonly devices: DevicePublicApiOperationsPort) {}
  listPrinters(ownerId: Parameters<PublicApiDevicesPort["listPrinters"]>[0]) {
    return this.devices.publicListPrinters(ownerId);
  }
  printer(...args: Parameters<PublicApiDevicesPort["printer"]>) {
    return this.devices.publicPrinter(...args);
  }
  telemetry(...args: Parameters<PublicApiDevicesPort["telemetry"]>) {
    return this.devices.publicTelemetry(...args);
  }
  testJobCommand(...args: Parameters<PublicApiDevicesPort["testJobCommand"]>) {
    return this.devices.publicTestJobCommand(...args);
  }
  command(...args: Parameters<PublicApiDevicesPort["command"]>) {
    return this.devices.publicCommand(...args);
  }
  commandStatus(...args: Parameters<PublicApiDevicesPort["commandStatus"]>) {
    return this.devices.publicCommandStatus(...args);
  }
}
@Global()
@Module({
  imports: [DevicesModule],
  providers: [
    PublicApiExternalAdapter,
    PublicApiDevicesAdapter,
    { provide: PUBLICAPI_EXTERNAL_PORT, useExisting: PublicApiExternalAdapter },
    { provide: PUBLICAPI_DEVICES_PORT, useExisting: PublicApiDevicesAdapter },
  ],
  exports: [PUBLICAPI_EXTERNAL_PORT, PUBLICAPI_DEVICES_PORT],
})
export class PublicApiIntegrationModule {}
