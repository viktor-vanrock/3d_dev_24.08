-- migrate:up

WITH staff_grants(permission) AS (
  VALUES
    ('moderation.delete_content'),
    ('moderation.ban_user'),
    ('moderation.view_reports'),
    ('moderation.resolve_report'),
    ('moderation.manage_sanctions'),
    ('moderation.resolve_appeal'),
    ('moderation.manage_community_members'),
    ('billing.manage_payouts'),
    ('catalog.publish_any'),
    ('catalog.unpublish_any'),
    ('catalog.edit_any'),
    ('catalog.feature'),
    ('catalog.review_candidates'),
    ('catalog.review_vendor_claims'),
    ('catalog.review_printer_reports'),
    ('support.view_tickets'),
    ('support.manage_devices'),
    ('support.view_device_incidents'),
    ('support.resolve_device_incidents')
), inserted AS (
  INSERT INTO public.permission_grants (user_id, permission, scope, granted_by, reason, expires_at)
  SELECT u.id, sg.permission, '{}'::jsonb, u.id, 'initial migration from is_staff flag', NULL
  FROM public.users u
  CROSS JOIN staff_grants sg
  WHERE u.is_staff = true
    AND NOT EXISTS (
      SELECT 1
      FROM public.permission_grants pg
      WHERE pg.user_id = u.id
        AND pg.permission = sg.permission
        AND pg.scope = '{}'::jsonb
        AND pg.revoked_at IS NULL
    )
  RETURNING id, user_id, permission
)
INSERT INTO public.audit_log (actor_user_id, action, target_type, target_id, details)
SELECT
  i.user_id,
  'permission.granted',
  'permission_grant',
  i.id,
  jsonb_build_object(
    'user_id', i.user_id,
    'permission', i.permission,
    'reason', 'initial migration from is_staff flag'
  )
FROM inserted i;

-- migrate:down

DELETE FROM public.audit_log
WHERE action = 'permission.granted'
  AND target_type = 'permission_grant'
  AND details->>'reason' = 'initial migration from is_staff flag';

DELETE FROM public.permission_grants
WHERE reason = 'initial migration from is_staff flag';
