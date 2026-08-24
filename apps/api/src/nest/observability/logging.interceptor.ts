import { Inject, Injectable } from "@nestjs/common";
import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import type { Response } from "express";
import { tap, type Observable } from "rxjs";
import { getRequestId, type RequestWithId } from "./request-id.ts";
import { RuntimeLogger } from "./runtime-logger.ts";

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(@Inject(RuntimeLogger) private readonly logger: RuntimeLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startedAt = performance.now();
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();

    return next.handle().pipe(
      tap(() => {
        this.logger.info(
          {
            event: "api.request.completed",
            request_id: getRequestId(request),
            method: request.method,
            status_code: response.statusCode,
            latency_ms: Math.round(performance.now() - startedAt),
          },
          "api request completed",
        );
      }),
    );
  }
}
