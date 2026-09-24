ALTER TABLE public.email_otp
  ADD COLUMN IF NOT EXISTS block_until timestamp with time zone;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS birth_year integer;

UPDATE public.users SET display_name = '' WHERE display_name IS NULL;
ALTER TABLE public.users
  ALTER COLUMN display_name SET DEFAULT '',
  ALTER COLUMN display_name SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.auth_pending_registrations (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
