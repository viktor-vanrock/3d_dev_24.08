-- migrate:up

CREATE TABLE public.permission_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  permission text NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  granted_by uuid NOT NULL REFERENCES public.users(id),
  reason text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.users(id),
  revoke_reason text,
  CONSTRAINT permission_grants_permission_check CHECK (permission IN (
    'user.view_any', 'user.edit_any', 'user.deactivate', 'user.grant_permission', 'user.revoke_permission',
    'moderation.delete_content', 'moderation.ban_user', 'moderation.view_reports', 'moderation.resolve_report',
    'moderation.manage_sanctions', 'moderation.resolve_appeal', 'moderation.manage_community_members',
    'analytics.view_platform', 'analytics.export', 'analytics.view_health',
    'billing.manage_payouts',
    'audit.view_log',
    'catalog.publish_any', 'catalog.unpublish_any', 'catalog.edit_any', 'catalog.feature', 'catalog.review_candidates',
    'catalog.review_vendor_claims', 'catalog.review_printer_reports',
    'research.access', 'research.manage', 'research.manage_printers',
    'support.view_tickets', 'support.manage_devices', 'support.view_device_incidents', 'support.resolve_device_incidents'
  )),
  CONSTRAINT permission_grants_scope_object_check CHECK (jsonb_typeof(scope) = 'object'),
  CONSTRAINT permission_grants_reason_nonempty_check CHECK (btrim(reason) <> ''),
  CONSTRAINT permission_grants_expiry_after_grant_check CHECK (expires_at IS NULL OR expires_at > granted_at),
  CONSTRAINT permission_grants_revocation_after_grant_check CHECK (revoked_at IS NULL OR revoked_at >= granted_at),
  CONSTRAINT permission_grants_revocation_fields_check CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL AND btrim(revoke_reason) <> '')
  )
);

CREATE INDEX permission_grants_user_permission_idx ON public.permission_grants (user_id, permission);
CREATE INDEX permission_grants_expires_at_idx ON public.permission_grants (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX permission_grants_granted_by_idx ON public.permission_grants (granted_by);

CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES public.users(id),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_action_nonempty_check CHECK (btrim(action) <> ''),
  CONSTRAINT audit_log_target_type_nonempty_check CHECK (btrim(target_type) <> ''),
  CONSTRAINT audit_log_details_object_check CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX audit_log_actor_created_idx ON public.audit_log (actor_user_id, created_at DESC);
CREATE INDEX audit_log_target_idx ON public.audit_log (target_type, target_id, created_at DESC);

-- migrate:down

DROP TABLE public.audit_log;
DROP TABLE public.permission_grants;
