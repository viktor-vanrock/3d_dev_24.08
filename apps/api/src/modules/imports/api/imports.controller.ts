import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { IMPORTS_PORT, type ImportsPort } from "../public/index.ts";
import { CreateImportJobDto, ImportJobCreatedResponseDto, ImportJobDetailResponseDto, ImportJobsResponseDto } from "./imports.dto.ts";
import { ApiImportsOperation } from "./openapi.ts";
import { User } from "../../permissions/public/index.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function user(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

@Controller("me/imports/jobs")
@User()
export class ImportsController {
  constructor(@Inject(IMPORTS_PORT) private readonly imports: ImportsPort) {}

  @Post()
  @ApiImportsOperation("Enqueue an import job", ImportJobCreatedResponseDto, { created: true, badRequest: true, notFound: true })
  enqueue(@Req() request: RequestWithSession, @Body() body: CreateImportJobDto): Promise<ImportJobCreatedResponseDto> {
    return this.imports.enqueue(user(request), { connectionId: body.connection_id, sourcePlatform: body.source_platform, externalIds: body.external_ids });
  }

  @Get()
  @ApiImportsOperation("List own import jobs", ImportJobsResponseDto)
  list(@Req() request: RequestWithSession): Promise<ImportJobsResponseDto> {
    return this.imports.list(user(request));
  }

  @Get(":id")
  @HttpCode(200)
  @ApiImportsOperation("Read own import job", ImportJobDetailResponseDto, { idParam: true, notFound: true })
  detail(@Req() request: RequestWithSession, @Param("id") id: string): Promise<ImportJobDetailResponseDto> {
    if (!UUID_RE.test(id)) throw new NotFoundException();
    return this.imports.detail(user(request), id);
  }
}
