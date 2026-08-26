-- migrate:up

CREATE OR REPLACE VIEW public.identity_read_v1 AS
 SELECT id AS user_id,
    username,
    display_name,
    avatar_url,
    avatar_s3_key,
    status,
    trust_level,
    reputation_score,
    maker_verified,
    is_master,
    created_at
   FROM public.users u
  WHERE status = 'active'
    AND id <> '00000000-0000-0000-0000-000000000001'::uuid;

CREATE VIEW public.identity_read_all_v1 AS
 SELECT id AS user_id,
    username,
    display_name,
    avatar_url,
    avatar_s3_key,
    status,
    trust_level,
    reputation_score,
    maker_verified,
    is_master,
    created_at
   FROM public.users u;

COMMENT ON VIEW public.identity_read_all_v1 IS 'Versioned staff/audit read-view (contract v1) over the users god-table. Includes inactive and technical identities; do not use in public content paths.';

-- migrate:down

DROP VIEW public.identity_read_all_v1;

CREATE OR REPLACE VIEW public.identity_read_v1 AS
 SELECT id AS user_id,
    username,
    display_name,
    avatar_url,
    avatar_s3_key,
    status,
    trust_level,
    reputation_score,
    maker_verified,
    is_master,
    created_at
   FROM public.users u;
