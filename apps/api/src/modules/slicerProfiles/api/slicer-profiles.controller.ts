import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, Res, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import type { Request, Response } from "express";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import {
  MachineId,
  MachineNotFoundError,
  MakeNotFoundError,
  MaterialId,
  MaterialNotFoundError,
  ModelNotFoundError,
  SlicerProfileId,
  SlicerProfileNotFoundError,
} from "../domain/slicer-profile.ts";
import { SLICER_PROFILES_PORT, type RateLimitDecision, type RateLimitIdentity, type SlicerProfilesPort } from "../public/index.ts";
import { ApiSlicerProfilesOperation } from "./openapi.ts";
import {
  CalibrationListResponseDto,
  CalibrationResponseDto,
  CreateCalibrationDto,
  ListSlicerProfilesQueryDto,
  ProfileRecommendationResponseDto,
  RecommendSlicerProfileQueryDto,
  SlicerProfileListResponseDto,
} from "./slicer-profiles.dto.ts";
import { Public, User } from "../../permissions/public/index.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sessionUserId(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

function header(request: Request, name: string): string {
  const value = request.headers[name];
  if (typeof value === "string") return value;
  return Array.isArray(value) ? value.join(",") : "";
}

function rateLimitIdentity(request: Request, userId: UserIdType): RateLimitIdentity {
  return {
    userId,
    ip: request.ip ?? request.socket.remoteAddress ?? "",
    userAgent: header(request, "user-agent"),
    acceptLanguage: header(request, "accept-language"),
    acceptEncoding: header(request, "accept-encoding"),
  };
}

function applyRateLimitHeaders(response: Response, decision: RateLimitDecision): void {
  response.setHeader("X-RateLimit-Limit", String(decision.limit));
  response.setHeader("X-RateLimit-Remaining", String(decision.remaining));
  response.setHeader("X-RateLimit-Reset", String(decision.reset));
}

function mapDomainError(error: unknown): never {
  if (error instanceof SlicerProfileNotFoundError) throw new NotFoundException();
  if (error instanceof MachineNotFoundError) throw new UnprocessableEntityException({ error: "MACHINE_NOT_FOUND" });
  if (error instanceof MaterialNotFoundError) throw new UnprocessableEntityException({ error: "MATERIAL_NOT_FOUND" });
  if (error instanceof ModelNotFoundError) throw new UnprocessableEntityException({ error: "MODEL_NOT_FOUND" });
  if (error instanceof MakeNotFoundError) throw new UnprocessableEntityException({ error: "MAKE_NOT_FOUND" });
  throw error;
}

@Controller("slicer-profiles")
@User()
export class SlicerProfilesController {
  constructor(@Inject(SLICER_PROFILES_PORT) private readonly slicerProfiles: SlicerProfilesPort) {}

  @Get()
  @Public()
  @ApiSlicerProfilesOperation("List active slicer profiles selectable by the current user", { responseType: SlicerProfileListResponseDto })
  list(@Query() query: ListSlicerProfilesQueryDto) {
    return this.slicerProfiles.list(query.class);
  }

  @Post(":id/calibrations")
  @HttpCode(201)
  @ApiSlicerProfilesOperation("Record an append-only slicer profile calibration", { created: true, rateLimited: true, notFound: true, responseType: CalibrationResponseDto })
  async createCalibration(
    @Req() request: RequestWithSession,
    @Res({ passthrough: true }) response: Response,
    @Param("id") rawProfileId: string,
    @Body() body: CreateCalibrationDto,
  ) {
    if (!UUID_RE.test(rawProfileId)) throw new NotFoundException();
    if (body.defect_type !== undefined && body.outcome !== "defect") throw new UnprocessableEntityException();
    const userId = sessionUserId(request);
    try {
      const result = await this.slicerProfiles.createCalibration(userId, rateLimitIdentity(request, userId), SlicerProfileId(rawProfileId), {
        machineId: MachineId(body.machine_id),
        materialId: MaterialId(body.material_id),
        modelId: body.model_id ?? null,
        makeId: body.make_id ?? null,
        flowRatio: body.flow_ratio ?? null,
        pressureAdvance: body.pressure_advance ?? null,
        outcome: body.outcome,
        defectType: body.defect_type ?? null,
        photoS3Key: body.photo_s3_key ? body.photo_s3_key : null,
        notes: body.notes ?? null,
      });
      applyRateLimitHeaders(response, result.rateLimit);
      if (result.limited) {
        response.setHeader("Retry-After", String(result.rateLimit.retryAfterSeconds));
        response.status(429);
        return { error: "RATE_LIMITED", scope: "calibration_create", retry_after_seconds: result.rateLimit.retryAfterSeconds };
      }
      return result.value;
    } catch (error) {
      return mapDomainError(error);
    }
  }

  @Get(":id/calibrations")
  @Public()
  @ApiSlicerProfilesOperation("List the latest calibrations for a slicer profile", { notFound: true, responseType: CalibrationListResponseDto })
  async calibrations(@Param("id") rawProfileId: string) {
    if (!UUID_RE.test(rawProfileId)) throw new NotFoundException();
    try {
      return await this.slicerProfiles.calibrations(SlicerProfileId(rawProfileId));
    } catch (error) {
      return mapDomainError(error);
    }
  }

  @Get(":printerId/:filamentId")
  @ApiSlicerProfilesOperation("Recommend a deterministic slicer profile for a printer and filament", {
    rateLimited: true,
    notFound: true,
    responseType: ProfileRecommendationResponseDto,
  })
  async recommend(
    @Req() request: RequestWithSession,
    @Res({ passthrough: true }) response: Response,
    @Param("printerId") rawPrinterId: string,
    @Param("filamentId") rawFilamentId: string,
    @Query() query: RecommendSlicerProfileQueryDto,
  ) {
    if (!UUID_RE.test(rawPrinterId) || !UUID_RE.test(rawFilamentId)) throw new NotFoundException();
    const userId = sessionUserId(request);
    try {
      const result = await this.slicerProfiles.recommend(
        userId,
        rateLimitIdentity(request, userId),
        MachineId(rawPrinterId),
        MaterialId(rawFilamentId),
        query.intent ?? "appearance",
      );
      applyRateLimitHeaders(response, result.rateLimit);
      if (result.limited) {
        response.setHeader("Retry-After", String(result.rateLimit.retryAfterSeconds));
        response.status(429);
        return { error: "RATE_LIMITED", scope: "profile_recommendation", retry_after_seconds: result.rateLimit.retryAfterSeconds };
      }
      return result.value;
    } catch (error) {
      return mapDomainError(error);
    }
  }
}
