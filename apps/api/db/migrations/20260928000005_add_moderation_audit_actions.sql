-- migrate:up
COMMENT ON COLUMN public.audit_log.action IS 'Moderation actions: flag.submitted, flag.claimed, flag.claim_released, flag.claim_expired, flag.decided, flag.decision_reversed, flag.overdue, content.restricted, content.restriction_lifted';
-- migrate:down
COMMENT ON COLUMN public.audit_log.action IS NULL;
