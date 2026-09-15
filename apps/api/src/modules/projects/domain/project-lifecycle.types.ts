export const PROJECT_STATUS = {
  DRAFT: "draft",
  UPLOADING: "uploading",
  REVIEWING: "reviewing",
  READY: "ready",
  PUBLISHED: "published",
  UNPUBLISHED: "unpublished",
  ARCHIVED: "archived",
} as const;

export type ProjectStatus = (typeof PROJECT_STATUS)[keyof typeof PROJECT_STATUS];

export const PROJECT_EVENT = {
  START_UPLOAD: "start_upload",
  UPLOAD_COMPLETE: "upload_complete",
  UPLOAD_FAILED: "upload_failed",
  SUBMIT_FOR_REVIEW: "submit_for_review",
  REVIEW_PASSED: "review_passed",
  REVIEW_FAILED: "review_failed",
  PUBLISH: "publish",
  UNPUBLISH: "unpublish",
  ARCHIVE: "archive",
  RESTORE: "restore",
} as const;

export type ProjectEvent = (typeof PROJECT_EVENT)[keyof typeof PROJECT_EVENT];

export type TransitionResult = {
  readonly toStatus: ProjectStatus;
  readonly setPublishedAt: "now" | "keep" | "null";
  readonly requiresConfirm: boolean;
};

export type TransitionTable = {
  [S in ProjectStatus]: Partial<Record<ProjectEvent, TransitionResult>>;
};

export const TRANSITION_TABLE = {
  draft: {
    start_upload: { toStatus: "uploading", setPublishedAt: "keep", requiresConfirm: false },
    submit_for_review: { toStatus: "reviewing", setPublishedAt: "keep", requiresConfirm: false },
    archive: { toStatus: "archived", setPublishedAt: "null", requiresConfirm: false },
  },
  uploading: {
    upload_complete: { toStatus: "ready", setPublishedAt: "keep", requiresConfirm: false },
    upload_failed: { toStatus: "draft", setPublishedAt: "keep", requiresConfirm: false },
  },
  reviewing: {
    review_passed: { toStatus: "ready", setPublishedAt: "keep", requiresConfirm: false },
    review_failed: { toStatus: "draft", setPublishedAt: "keep", requiresConfirm: false },
  },
  ready: {
    publish: { toStatus: "published", setPublishedAt: "now", requiresConfirm: true },
    start_upload: { toStatus: "uploading", setPublishedAt: "keep", requiresConfirm: false },
    archive: { toStatus: "archived", setPublishedAt: "null", requiresConfirm: false },
  },
  published: {
    unpublish: { toStatus: "unpublished", setPublishedAt: "keep", requiresConfirm: false },
    archive: { toStatus: "archived", setPublishedAt: "keep", requiresConfirm: false },
  },
  unpublished: {
    publish: { toStatus: "published", setPublishedAt: "now", requiresConfirm: true },
    archive: { toStatus: "archived", setPublishedAt: "keep", requiresConfirm: false },
  },
  archived: {
    restore: { toStatus: "draft", setPublishedAt: "null", requiresConfirm: false },
  },
} satisfies TransitionTable;

export function getTransition(from: ProjectStatus, event: ProjectEvent): TransitionResult | null {
  return (TRANSITION_TABLE[from] as Partial<Record<ProjectEvent, TransitionResult>>)[event] ?? null;
}

export function getAllowedEvents(status: ProjectStatus): ProjectEvent[] {
  const internalEvents = new Set<ProjectEvent>([
    PROJECT_EVENT.UPLOAD_COMPLETE,
    PROJECT_EVENT.UPLOAD_FAILED,
    PROJECT_EVENT.REVIEW_PASSED,
    PROJECT_EVENT.REVIEW_FAILED,
  ]);
  return (Object.keys(TRANSITION_TABLE[status]) as ProjectEvent[]).filter((event) => !internalEvents.has(event));
}

export function canTransition(from: ProjectStatus, event: ProjectEvent): boolean {
  return getTransition(from, event) !== null;
}
