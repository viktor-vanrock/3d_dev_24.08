import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Response } from "express";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { ASSISTANT_PORT, type AssistantPort } from "../public/index.ts";
import { AssistantListQueryDto, AssistantLooseBodyDto } from "./assistant.dto.ts";
import { ApiAssistantOperation } from "./openapi.ts";
import { User } from "../../permissions/decorators/user.decorator.ts";

function user(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

async function stream(response: Response, source: AsyncIterable<string>): Promise<void> {
  response.status(200);
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders();
  try {
    for await (const frame of source) {
      if (response.destroyed) break;
      response.write(frame);
    }
  } finally {
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}

@Controller()
@User()
export class AssistantController {
  constructor(@Inject(ASSISTANT_PORT) private readonly assistant: AssistantPort) {}

  @Post("assistant/threads")
  @ApiAssistantOperation("Create assistant thread", { status: 201, body: true, response: "thread" })
  createThread(@Req() request: RequestWithSession, @Body() body: AssistantLooseBodyDto | undefined) {
    return this.assistant.createThread(user(request), body?.title);
  }

  @Get("assistant/threads")
  @ApiAssistantOperation("List own assistant threads", { response: "threads" })
  listThreads(@Req() request: RequestWithSession, @Query() query: AssistantListQueryDto) {
    return this.assistant.listThreads(user(request), { ...query });
  }

  @Get("assistant/threads/:id")
  @ApiAssistantOperation("Read own assistant thread")
  thread(@Req() request: RequestWithSession, @Param("id") id: string) {
    return this.assistant.threadDetail(user(request), id);
  }

  @Post("assistant/threads/:id/read")
  @HttpCode(200)
  @ApiAssistantOperation("Mark assistant thread read")
  read(@Req() request: RequestWithSession, @Param("id") id: string) {
    return this.assistant.markThreadRead(user(request), id);
  }

  @Get("assistant/threads/:id/events")
  @ApiAssistantOperation("Stream assistant thread events", { sse: "thread" })
  async threadEvents(@Req() request: RequestWithSession, @Res() response: Response, @Param("id") id: string, @Headers("last-event-id") lastEventId: unknown) {
    const abort = new AbortController();
    response.on("close", () => abort.abort());
    const source = await this.assistant.openThreadEvents(user(request), id, lastEventId, abort.signal);
    await stream(response, source.frames);
  }

  @Get("assistant/threads/:id/messages")
  @ApiAssistantOperation("List assistant thread messages", { response: "messages" })
  messages(@Req() request: RequestWithSession, @Param("id") id: string, @Query() query: AssistantListQueryDto) {
    return this.assistant.listMessages(user(request), id, { ...query });
  }

  @Post("assistant/threads/:id/messages")
  @ApiAssistantOperation("Create assistant message and queue run", { status: 201, body: true, response: "message", replay: true })
  async createMessage(
    @Req() request: RequestWithSession,
    @Res({ passthrough: true }) response: Response,
    @Param("id") id: string,
    @Body() body: AssistantLooseBodyDto | undefined,
  ) {
    const result = await this.assistant.createMessage(user(request), id, { ...(body ?? {}) });
    response.status(result.status);
    return result.body;
  }

  @Get("assistant/threads/:id/runs/:runId")
  @ApiAssistantOperation("Read assistant run state", { response: "run" })
  run(@Req() request: RequestWithSession, @Param("id") id: string, @Param("runId") runId: string) {
    return this.assistant.runDetail(user(request), id, runId);
  }

  @Get("assistant/runs/:id/events")
  @ApiAssistantOperation("Stream assistant run events", { sse: "run" })
  async runEvents(@Req() request: RequestWithSession, @Res() response: Response, @Param("id") id: string, @Headers("last-event-id") lastEventId: unknown) {
    const abort = new AbortController();
    response.on("close", () => abort.abort());
    const source = await this.assistant.openRunEvents(user(request), id, lastEventId, abort.signal);
    await stream(response, source.frames);
  }

  @Post("assistant/threads/:id/generations")
  @ApiAssistantOperation("Confirm generation offer", { status: 201, body: true, response: "generation", replay: true })
  async generation(@Req() request: RequestWithSession, @Res({ passthrough: true }) response: Response, @Param("id") id: string, @Body() body: AssistantLooseBodyDto | undefined) {
    const result = await this.assistant.confirmGeneration(user(request), id, body?.run_id);
    response.status(result.status);
    return result.body;
  }

  @Post("assistant/prompt-variants")
  @HttpCode(200)
  @ApiAssistantOperation("Generate prompt variants", { body: true, response: "prompt-variants" })
  promptVariants(@Req() request: RequestWithSession, @Body() body: AssistantLooseBodyDto | undefined) {
    return this.assistant.promptVariants(user(request), { ...(body ?? {}) }, request);
  }
}
