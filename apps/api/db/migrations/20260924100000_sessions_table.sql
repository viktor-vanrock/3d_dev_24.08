CREATE TABLE public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_active_at timestamp with time zone NOT NULL DEFAULT now(),
  session_token_hash text NOT NULL
);

CREATE INDEX sessions_user_id_idx ON public.sessions(user_id);
