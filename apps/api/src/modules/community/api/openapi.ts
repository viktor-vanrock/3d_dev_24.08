import { applyDecorators, type Type } from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import {
  AcceptedResponseDto,
  AttachmentEnvelopeDto,
  BootstrapOwnerResponseDto,
  CommunityDetailDto,
  CommunityFeedPageDto,
  CommunityLeftResponseDto,
  CommunityPageDto,
  CommunityRoleResponseDto,
  CommunityViewDto,
  PostViewDto,
  ThreadDetailDto,
  ThreadPageDto,
  ThreadViewDto,
  VoteResponseDto,
} from "./community.dto.ts";
const response = (summary: string): Type | undefined =>
  ({
    "Create community": CommunityViewDto,
    "List communities": CommunityPageDto,
    "Community detail": CommunityDetailDto,
    "Join community": CommunityRoleResponseDto,
    "Leave community": CommunityLeftResponseDto,
    Subscribe: CommunityRoleResponseDto,
    Unsubscribe: CommunityLeftResponseDto,
    "Set member role": CommunityRoleResponseDto,
    "Bootstrap owner": BootstrapOwnerResponseDto,
    "Community feed": CommunityFeedPageDto,
    "Create thread": ThreadViewDto,
    "List threads": ThreadPageDto,
    "Thread detail": ThreadDetailDto,
    "Create post": PostViewDto,
    "Vote thread": VoteResponseDto,
    "Vote post": VoteResponseDto,
    "Upload attachment": AttachmentEnvelopeDto,
    "Accept answer": AcceptedResponseDto,
  })[summary];
export const ApiCommunityOperation = (summary: string, status = 200, responseType: Type | undefined = response(summary)) =>
  applyDecorators(
    ApiOperation({ summary }),
    ApiSessionProtected(),
    ...(summary === "Download attachment"
      ? [
          ApiResponse({
            status: 200,
            content: { "model/3mf": { schema: { type: "string", format: "binary" } }, "application/octet-stream": { schema: { type: "string", format: "binary" } } },
          }),
          ApiResponse({ status: 302, description: "Redirect to public photo URL", headers: { Location: { schema: { type: "string", format: "uri" } } } }),
        ]
      : [ApiResponse({ status, description: "Characterized community response", ...(responseType === undefined ? {} : { type: responseType }) })]),
  );
