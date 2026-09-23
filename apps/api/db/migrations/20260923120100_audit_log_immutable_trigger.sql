-- migrate:up
CREATE OR REPLACE FUNCTION public.audit_log_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF current_setting('app.audit_legal_hold_write', true) = 'on'
       AND OLD.legal_hold = false AND NEW.legal_hold = true
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id
       AND NEW.action IS NOT DISTINCT FROM OLD.action
       AND NEW.target_type IS NOT DISTINCT FROM OLD.target_type
       AND NEW.target_id IS NOT DISTINCT FROM OLD.target_id
       AND NEW.details IS NOT DISTINCT FROM OLD.details
       AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
       AND NEW.schema_version IS NOT DISTINCT FROM OLD.schema_version
       AND NEW.actor_type IS NOT DISTINCT FROM OLD.actor_type
       AND NEW.before_state IS NOT DISTINCT FROM OLD.before_state
       AND NEW.after_state IS NOT DISTINCT FROM OLD.after_state
       AND NEW.reason IS NOT DISTINCT FROM OLD.reason
       AND NEW.correlation_id IS NOT DISTINCT FROM OLD.correlation_id
       AND NEW.causation_id IS NOT DISTINCT FROM OLD.causation_id
       AND NEW.idempotency_key IS NOT DISTINCT FROM OLD.idempotency_key THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'audit_log: записи нельзя изменять';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.legal_hold THEN
      RAISE EXCEPTION 'audit_log: запись под legal hold нельзя удалять';
    END IF;
    IF OLD.created_at >= now() - INTERVAL '3 months' THEN
      RAISE EXCEPTION 'audit_log: запись можно удалить только после истечения срока хранения';
    END IF;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_immutable_trigger
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_immutable();

CREATE OR REPLACE FUNCTION public.audit_log_set_legal_hold(p_id uuid)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.audit_legal_hold_write', 'on', true);
  UPDATE public.audit_log SET legal_hold = true WHERE id = p_id AND legal_hold = false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- migrate:down
DROP FUNCTION IF EXISTS public.audit_log_set_legal_hold(uuid);
DROP TRIGGER IF EXISTS audit_log_immutable_trigger ON public.audit_log;
DROP FUNCTION IF EXISTS public.audit_log_immutable();
