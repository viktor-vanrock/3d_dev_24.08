import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res, HttpException, HttpStatus, UnauthorizedException } from "@nestjs/common";
import type { Response } from "express";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { PRINT_REQUESTS_PORT, PRINT_REQUESTS_RATE_LIMIT_PORT, type PrintRequestsPort, type PrintRequestsRateLimitPort } from "../public/index.ts";
import { CreatePrintRequestDto, PrintRequestListQueryDto, TransitionPrintRequestDto } from "./print-requests.dto.ts";
import { ApiPrintRequestsOperation } from "./openapi.ts";

function user(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

function identity(request: RequestWithSession) {
  return {
    ip: request.ip || request.socket.remoteAddress || "unknown",
    headers: request.headers,
  };
}

@Controller("print-requests")
export class PrintRequestsController {
  constructor(
    @Inject(PRINT_REQUESTS_PORT)
    private readonly printRequests: PrintRequestsPort,
    @Inject(PRINT_REQUESTS_RATE_LIMIT_PORT)
    private readonly rateLimit: PrintRequestsRateLimitPort,
  ) {}

  @Post()
  @ApiPrintRequestsOperation("Create a print request", { created: true })
  create(@Req() request: RequestWithSession, @Body() body: CreatePrintRequestDto, @Res({ passthrough: true }) response: Response) {
    return this.createAfterRateLimit(request, response, body);
  }

  private async createAfterRateLimit(request: RequestWithSession, response: Response, body: CreatePrintRequestDto) {
    const userId = user(request);
    const outcome = await this.rateLimit.checkCreate(identity(request), userId);
    response.setHeader("X-RateLimit-Limit", String(outcome.limit));
    response.setHeader("X-RateLimit-Remaining", String(outcome.remaining));
    response.setHeader("X-RateLimit-Reset", String(outcome.reset));
    if (outcome.limited) {
      response.setHeader("Retry-After", String(outcome.retryAfterSeconds ?? 60));
      throw new HttpException("", HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.printRequests.create(userId, body);
  }

  @Get("incoming")
  @ApiPrintRequestsOperation("List incoming print requests", { list: true })
  incoming(@Req() request: RequestWithSession, @Query() query: PrintRequestListQueryDto) {
    return this.printRequests.incoming(user(request), query.view);
  }

  @Get("mine")
  @ApiPrintRequestsOperation("List own print requests", { list: true })
  mine(@Req() request: RequestWithSession, @Query() query: PrintRequestListQueryDto) {
    return this.printRequests.mine(user(request), query.view);
  }

  @Get(":id")
  @ApiPrintRequestsOperation("Read a print request")
  get(@Req() request: RequestWithSession, @Param("id") id: string) {
    return this.printRequests.get(user(request), id);
  }

  @Patch(":id/status")
  @ApiPrintRequestsOperation("Transition a print request")
  transition(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: TransitionPrintRequestDto) {
    return this.printRequests.transition(user(request), id, body.status);
  }
}
