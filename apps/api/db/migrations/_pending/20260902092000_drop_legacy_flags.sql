-- Применять только после подтверждения владельца
-- и успешного запуска bootstrap-admin-grants.ts
-- migrate:up

ALTER TABLE public.users DROP COLUMN is_master;

-- migrate:down

ALTER TABLE public.users ADD COLUMN is_master boolean NOT NULL DEFAULT false;
