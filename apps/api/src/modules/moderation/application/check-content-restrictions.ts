import { ForbiddenException } from "@nestjs/common";
import type { ContentRestrictionsPort } from "../domain/moderation.ports.ts";
import type { ModerationSubjectType } from "../domain/moderation.types.ts";

export async function checkContentRestrictions(
  port: ContentRestrictionsPort,
  subjectType: ModerationSubjectType,
  subjectId: string,
): Promise<void> {
  const restrictions = await port.findActiveBySubject(subjectType, subjectId);

  for (const restriction of restrictions) {
    if (restriction.restrictionType === "deleted") throw new ForbiddenException("content_restricted:deleted");
    if (restriction.restrictionType === "locked") throw new ForbiddenException("content_restricted:locked");
  }
}
