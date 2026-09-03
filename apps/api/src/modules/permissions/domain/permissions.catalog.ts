// Единый закрытый каталог платформенных разрешений. Строковые литералы прав вне
// этого файла запрещены: это исключает опечатки и неявные новые привилегии.
export enum Permissions {
  USER_VIEW_ANY = "user.view_any",
  USER_EDIT_ANY = "user.edit_any",
  USER_DEACTIVATE = "user.deactivate",
  USER_GRANT_PERMISSION = "user.grant_permission",
  USER_REVOKE_PERMISSION = "user.revoke_permission",

  MODERATION_DELETE_CONTENT = "moderation.delete_content",
  MODERATION_BAN_USER = "moderation.ban_user",
  MODERATION_VIEW_REPORTS = "moderation.view_reports",
  MODERATION_RESOLVE_REPORT = "moderation.resolve_report",
  MODERATION_MANAGE_SANCTIONS = "moderation.manage_sanctions",
  MODERATION_RESOLVE_APPEAL = "moderation.resolve_appeal",
  MODERATION_MANAGE_COMMUNITY_MEMBERS = "moderation.manage_community_members",

  ANALYTICS_VIEW_PLATFORM = "analytics.view_platform",
  ANALYTICS_EXPORT = "analytics.export",
  ANALYTICS_VIEW_HEALTH = "analytics.view_health",

  BILLING_MANAGE_PAYOUTS = "billing.manage_payouts",

  AUDIT_VIEW_LOG = "audit.view_log",

  CATALOG_PUBLISH_ANY = "catalog.publish_any",
  CATALOG_UNPUBLISH_ANY = "catalog.unpublish_any",
  CATALOG_EDIT_ANY = "catalog.edit_any",
  CATALOG_FEATURE = "catalog.feature",
  CATALOG_REVIEW_CANDIDATES = "catalog.review_candidates",
  CATALOG_REVIEW_VENDOR_CLAIMS = "catalog.review_vendor_claims",
  CATALOG_REVIEW_PRINTER_REPORTS = "catalog.review_printer_reports",

  RESEARCH_ACCESS = "research.access",
  RESEARCH_MANAGE = "research.manage",
  RESEARCH_MANAGE_PRINTERS = "research.manage_printers",

  SUPPORT_VIEW_TICKETS = "support.view_tickets",
  SUPPORT_MANAGE_DEVICES = "support.manage_devices",
  SUPPORT_VIEW_DEVICE_INCIDENTS = "support.view_device_incidents",
  SUPPORT_RESOLVE_DEVICE_INCIDENTS = "support.resolve_device_incidents",
}

export const ALL_PERMISSIONS = Object.freeze(Object.values(Permissions));
