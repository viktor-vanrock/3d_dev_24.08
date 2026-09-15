export type ProjectStatus = "draft" | "uploading" | "reviewing" | "ready" | "published" | "unpublished" | "archived";
export type ProjectAction = "start_upload" | "submit_for_review" | "publish" | "unpublish" | "archive" | "restore";

type StatusMeta = {
  readonly label: string;
  readonly hint: string;
  readonly color: "gray" | "blue" | "yellow" | "green" | "orange" | "slate";
  readonly allowedActions: readonly ProjectAction[];
};

export const STATUS_META: Record<ProjectStatus, StatusMeta> = {
  draft: { label: "Черновик", hint: "Виден только вам", color: "gray", allowedActions: ["start_upload", "submit_for_review", "archive"] },
  uploading: { label: "Загрузка…", hint: "Дождитесь завершения загрузки", color: "blue", allowedActions: [] },
  reviewing: { label: "На проверке", hint: "Ожидайте результата проверки", color: "yellow", allowedActions: [] },
  ready: { label: "Готов к публикации", hint: "Можно опубликовать", color: "green", allowedActions: ["publish", "start_upload", "archive"] },
  published: { label: "Опубликован", hint: "Доступен всем", color: "green", allowedActions: ["unpublish", "archive"] },
  unpublished: { label: "Снят с публикации", hint: "Скрыт из поиска", color: "orange", allowedActions: ["publish", "archive"] },
  archived: { label: "В архиве", hint: "Можно восстановить", color: "slate", allowedActions: ["restore"] },
};

const ACTION_LABEL: Record<ProjectAction, string> = {
  start_upload: "Загрузить файл",
  submit_for_review: "Отправить на проверку",
  publish: "Опубликовать",
  unpublish: "Снять с публикации",
  archive: "Архивировать",
  restore: "Восстановить",
};

export function getActionLabel(action: ProjectAction): string {
  return ACTION_LABEL[action];
}
