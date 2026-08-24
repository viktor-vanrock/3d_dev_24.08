import { Inject, Injectable } from "@nestjs/common";
import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import type { Response } from "express";
import { defer, type Observable } from "rxjs";
import { RequestContext } from "./request-context.ts";
import { REQUEST_ID, resolveRequestId, type RequestWithId } from "./request-id.ts";

@Injectable()
export class CorrelationInterceptor implements NestInterceptor {
  constructor(@Inject(RequestContext) private readonly requestContext: RequestContext) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const requestId = resolveRequestId(request.header("x-request-id"));

    request[REQUEST_ID] = requestId;
    response.setHeader("x-request-id", requestId);

    return defer(() => this.requestContext.run({ requestId }, () => next.handle()));
  }
}
