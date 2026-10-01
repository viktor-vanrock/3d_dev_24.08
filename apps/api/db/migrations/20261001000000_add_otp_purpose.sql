-- migrate:up
ALTER TABLE public.email_otp
  ADD COLUMN purpose text NOT NULL DEFAULT 'login';

ALTER TABLE public.email_otp
  ADD CONSTRAINT email_otp_purpose_check
  CHECK (purpose IN ('login', 'registration', 'recovery'));

ALTER TABLE public.auth_pending_registrations
  ALTER COLUMN password_hash DROP NOT NULL;

UPDATE public.auth_pending_registrations
SET password_hash = NULL;

-- migrate:down
ALTER TABLE public.auth_pending_registrations
  ALTER COLUMN password_hash DROP NOT NULL;

DELETE FROM public.auth_pending_registrations WHERE password_hash IS NULL;

ALTER TABLE public.auth_pending_registrations
  ALTER COLUMN password_hash SET NOT NULL;

ALTER TABLE public.email_otp
  DROP CONSTRAINT email_otp_purpose_check;

ALTER TABLE public.email_otp
  DROP COLUMN purpose;
