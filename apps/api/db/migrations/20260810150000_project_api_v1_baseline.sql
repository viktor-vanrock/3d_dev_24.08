-- migrate:up
--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14 (Debian 16.14-1.pgdg12+1)
-- Dumped by pg_dump version 16.14 (Debian 16.14-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: ensure_ready_storage_blob(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_ready_storage_blob() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.blob_id is not null and not exists (
    select 1 from storage_blobs where id = new.blob_id and state = 'ready'
  ) then
    raise exception 'model_files.blob_id must reference a ready storage blob'
      using errcode = '23514';
  end if;
  return new;
end;
$$;


--
-- Name: forbid_correlation_id_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.forbid_correlation_id_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.correlation_id is distinct from old.correlation_id then
    raise exception 'correlation_id is immutable';
  end if;
  return new;
end;
$$;


--
-- Name: machine_candidates_set_ownership(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.machine_candidates_set_ownership() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  -- Source IDs are the legacy source-family identifiers. Keeping this mapping
  -- here lets old producers omit the new columns without making their rows
  -- accidentally claimable by the other resolver.
  if new.source in ('cura-definitions', 'sovol3d-store', 'giga-free-html') then
    new.owner := 'catalog';
    new.source_family := new.source;
  elsif new.source in ('vendor_whitelist', 'slicer_profile', 'ru_machine_spec') then
    new.owner := 'scout';
    new.source_family := new.source;
  end if;
  return new;
end;
$$;


--
-- Name: moderation_actions_guard_lifecycle(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.moderation_actions_guard_lifecycle() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '42501',
      message = 'moderation_actions is append-only';
  end if;

  if old.status <> 'applied' or new.status <> 'reversed' then
    raise exception using
      errcode = '40001',
      message = 'moderation_actions allows only applied to reversed';
  end if;

  if not (
    new.id is not distinct from old.id
    and new.scope is not distinct from old.scope
    and new.actor_role is not distinct from old.actor_role
    and new.actor_user_id is not distinct from old.actor_user_id
    and new.action is not distinct from old.action
    and new.target_type is not distinct from old.target_type
    and new.target_id is not distinct from old.target_id
    and new.reason_code is not distinct from old.reason_code
    and new.reason is not distinct from old.reason
    and new.reverses_action_id is not distinct from old.reverses_action_id
    and new.metadata is not distinct from old.metadata
    and new.created_at is not distinct from old.created_at
  ) then
    raise exception using
      errcode = '42501',
      message = 'moderation_actions evidence fields are immutable';
  end if;

  if new.reversed_at is null or new.reversed_by is null or btrim(new.reversal_reason) = '' then
    raise exception using
      errcode = '23514',
      message = 'reversal fields are required for reversed action';
  end if;

  return new;
end;
$$;


--
-- Name: moderation_actions_require_reversed_source(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.moderation_actions_require_reversed_source() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  source_status text;
begin
  if new.reverses_action_id is not null then
    select status into source_status
      from moderation_actions
     where id = new.reverses_action_id;

    if source_status is distinct from 'reversed' then
      raise exception using
        errcode = '23514',
        message = 'reversal source must be reversed';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: reject_project_publication_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_project_publication_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  raise exception using errcode = '55000', message = 'project_publication_snapshot_is_immutable';
end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: achievements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.achievements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    version text,
    channel text DEFAULT 'stable'::text NOT NULL,
    status text DEFAULT 'offline'::text NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_reason text,
    CONSTRAINT agents_channel_check CHECK ((channel = ANY (ARRAY['stable'::text, 'beta'::text]))),
    CONSTRAINT agents_status_check CHECK ((status = ANY (ARRAY['online'::text, 'offline'::text])))
);


--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    key_prefix text NOT NULL,
    key_hash bytea NOT NULL,
    scopes text[] DEFAULT ARRAY['read'::text] NOT NULL,
    revoked_at timestamp with time zone,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT api_keys_expires_after_created_check CHECK (((expires_at IS NULL) OR (expires_at > created_at))),
    CONSTRAINT api_keys_revoked_after_created_check CHECK (((revoked_at IS NULL) OR (revoked_at >= created_at))),
    CONSTRAINT api_keys_scopes_check CHECK (((scopes <@ ARRAY['read'::text, 'control'::text]) AND (COALESCE(array_length(scopes, 1), 0) > 0)))
);


--
-- Name: TABLE api_keys; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.api_keys IS 'Ключи публичного API v0 (MF-888) — авторизация сторонних интеграций юзера, отдельная от сессии и agent-credential.';


--
-- Name: artifact_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artifact_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    source_blob_id uuid NOT NULL,
    role text NOT NULL,
    canonical_profile_id text NOT NULL,
    parameters_fingerprint bytea NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    blob_id uuid,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_checksum bytea NOT NULL,
    config_fingerprint text NOT NULL,
    CONSTRAINT artifact_cache_config_fingerprint_nonempty_check CHECK ((btrim(config_fingerprint) <> ''::text)),
    CONSTRAINT artifact_cache_profile_nonempty_check CHECK ((btrim(canonical_profile_id) <> ''::text)),
    CONSTRAINT artifact_cache_role_nonempty_check CHECK ((btrim(role) <> ''::text)),
    CONSTRAINT artifact_cache_source_checksum_shape_check CHECK ((octet_length(source_checksum) = 32)),
    CONSTRAINT artifact_cache_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'processing'::text, 'ready'::text, 'failed'::text])))
);


--
-- Name: assistant_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    client_request_id text,
    run_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assistant_messages_client_request_id_role_check CHECK (((role = 'user'::text) OR (client_request_id IS NULL))),
    CONSTRAINT assistant_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text]))),
    CONSTRAINT assistant_messages_run_id_role_check CHECK (((role = 'assistant'::text) OR (run_id IS NULL)))
);


--
-- Name: assistant_run_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_run_events (
    id bigint NOT NULL,
    run_id uuid NOT NULL,
    seq integer NOT NULL,
    event_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assistant_run_events_event_type_check CHECK ((event_type = ANY (ARRAY['assistant.delta'::text, 'assistant.completed'::text, 'assistant.error'::text])))
);


--
-- Name: TABLE assistant_run_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.assistant_run_events IS 'Append-only лог SSE-событий одного run''а (MF-1997). События сегодня синтезируются лениво
   API-слоем из assistant_runs.result/status при первом наблюдении терминального статуса (см.
   apps/api/src/assistant/events.ts::ensureRunEvents) — воркер (MF-2000) сейчас пишет результат
   одним атомарным mark_done, не стримит токены построчно; когда/если воркер начнёт стримить
   инкрементально, он сможет писать сюда напрямую (тот же формат seq/event_type/payload), контракт
   для читателей (SSE-ручка, клиент) не меняется.';


--
-- Name: assistant_run_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.assistant_run_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.assistant_run_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: assistant_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    triggering_message_id uuid NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    result_type text,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_code text,
    confirmed_generation_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid NOT NULL,
    message text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    lease_expires_at timestamp with time zone,
    error text,
    CONSTRAINT assistant_runs_result_type_check CHECK ((result_type = ANY (ARRAY['answer'::text, 'clarification'::text, 'generation_offer'::text, 'error'::text]))),
    CONSTRAINT assistant_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'error'::text])))
);


--
-- Name: TABLE assistant_runs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.assistant_runs IS 'Одна LLM-генерация ответа на assistant_messages.role=user (MF-1997/MF-2000). result_type/result — RAG answer|clarification|generation_offer из jobs/giga.ts assistant-run.v1 (владелец контракта MF-1999); generation_offer подтверждается POST /assistant/threads/:id/generations, который переиспользует очередь generations (apps/api/src/generations), не заводит вторую.';


--
-- Name: COLUMN assistant_runs.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.assistant_runs.user_id IS 'Денормализованная копия assistant_threads.owner_id — источник истины остаётся thread, но
   giga-воркер (MF-2000, уже смёржен) читает эту колонку напрямую в своих SQL (claim_queued), без
   джойна. Поддерживается на insert в apps/api/src/assistant/messages.ts.';


--
-- Name: COLUMN assistant_runs.message; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.assistant_runs.message IS 'Денормализованная копия content триггернувшего assistant_messages — та же причина, что
   user_id: giga-воркер читает run.message напрямую.';


--
-- Name: assistant_thread_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_thread_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    seq integer NOT NULL,
    event_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assistant_thread_events_event_type_check CHECK ((length(event_type) > 0)),
    CONSTRAINT assistant_thread_events_seq_check CHECK ((seq > 0))
);


--
-- Name: assistant_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    title text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'chat'::text NOT NULL,
    device_id uuid,
    severity text,
    incident_status text,
    read_at timestamp with time zone,
    CONSTRAINT assistant_threads_incident_fields_check CHECK ((((kind = 'device_incident'::text) AND (device_id IS NOT NULL) AND (severity IS NOT NULL) AND (incident_status IS NOT NULL)) OR ((kind = 'chat'::text) AND (device_id IS NULL) AND (severity IS NULL) AND (incident_status IS NULL)))),
    CONSTRAINT assistant_threads_incident_status_check CHECK ((incident_status = ANY (ARRAY['open'::text, 'acknowledged'::text, 'resolved'::text]))),
    CONSTRAINT assistant_threads_kind_check CHECK ((kind = ANY (ARRAY['chat'::text, 'device_incident'::text]))),
    CONSTRAINT assistant_threads_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text])))
);


--
-- Name: TABLE assistant_threads; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.assistant_threads IS 'Приватный чат-тред AI-ассистента (MF-1997), один owner. Не путать с threads (community, MF-35) — та сущность публичная и многопользовательская; эта не имеет отдельной таблицы участников.';


--
-- Name: COLUMN assistant_threads.kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.assistant_threads.kind IS 'chat — обычный приватный тред (MF-1997); device_incident — материализован из device event (MF-2047), доп. поля device_id/severity/incident_status обязательны только для него.';


--
-- Name: build_guides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.build_guides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE build_guides; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.build_guides IS 'Гайд сборки проекта (MF-366/MF-18 Фаза 1), один на models-строку. version — счётчик ревизий под будущий optimistic-concurrency и историю версий (MF-19).';


--
-- Name: build_session_revision_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.build_session_revision_migrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    model_id uuid NOT NULL,
    from_commit_sha text NOT NULL,
    from_configuration_id text NOT NULL,
    from_configuration_digest bytea NOT NULL,
    to_commit_sha text NOT NULL,
    to_configuration_id text NOT NULL,
    to_configuration_digest bytea NOT NULL,
    status text DEFAULT 'proposed'::text NOT NULL,
    step_diff jsonb DEFAULT '{}'::jsonb NOT NULL,
    compatibility_conflict text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    CONSTRAINT build_session_revision_migratio_from_configuration_digest_check CHECK ((octet_length(from_configuration_digest) = 32)),
    CONSTRAINT build_session_revision_migrations_conflict_shape_check CHECK ((((status = 'rejected'::text) AND (compatibility_conflict IS NOT NULL)) OR ((status <> 'rejected'::text) AND (compatibility_conflict IS NULL)))),
    CONSTRAINT build_session_revision_migrations_distinct_target_check CHECK (((from_commit_sha <> to_commit_sha) OR (from_configuration_digest <> to_configuration_digest))),
    CONSTRAINT build_session_revision_migrations_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'confirmed'::text, 'rejected'::text]))),
    CONSTRAINT build_session_revision_migrations_to_configuration_digest_check CHECK ((octet_length(to_configuration_digest) = 32))
);


--
-- Name: TABLE build_session_revision_migrations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.build_session_revision_migrations IS 'Явный, аудируемый переход build session на новую ревизию манифеста (объём MF-1968 п.3). confirmed применяет from_*->to_* к build_sessions на API-слое; rejected обязан нести compatibility_conflict — конфликт версий не проходит молча.';


--
-- Name: build_session_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.build_session_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    phase_id text NOT NULL,
    step_id text NOT NULL,
    state text DEFAULT 'not_started'::text NOT NULL,
    blocked_reason text,
    note text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT build_session_steps_blocked_reason_check CHECK (((state <> 'blocked'::text) OR (blocked_reason IS NOT NULL))),
    CONSTRAINT build_session_steps_state_check CHECK ((state = ANY (ARRAY['not_started'::text, 'ready'::text, 'in_progress'::text, 'blocked'::text, 'done'::text, 'skipped'::text, 'failed'::text])))
);


--
-- Name: TABLE build_session_steps; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.build_session_steps IS 'Состояние шагов build session (не авторская инструкция — та в резолвленном project_revisions.workflow). Одна истина прогресса (projects.md §4 п.5): процент/статус фазы вычисляются из этих строк на API-слое, вторым счётчиком не хранятся. version — optimistic concurrency на изменение шага (объём MF-1968 п.4).';


--
-- Name: build_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.build_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    model_id uuid NOT NULL,
    manifest_commit_sha text NOT NULL,
    configuration_id text NOT NULL,
    configuration_digest bytea NOT NULL,
    status text DEFAULT 'in_progress'::text NOT NULL,
    create_idempotency_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT build_sessions_configuration_digest_check CHECK ((octet_length(configuration_digest) = 32)),
    CONSTRAINT build_sessions_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'paused'::text, 'done'::text, 'abandoned'::text])))
);


--
-- Name: TABLE build_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.build_sessions IS 'Приватная build session пользователя (MF-1968, projects.md §2), пиненная на commit SHA + configuration digest через composite FK на project_revisions. Новый commit в репозитории не меняет существующую строку — переход на новую ревизию только через build_session_revision_migrations (явное действие пользователя, не автообновление).';


--
-- Name: build_step_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.build_step_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    step_id uuid NOT NULL,
    s3_key text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    size_bytes bigint,
    checksum bytea,
    original_filename text,
    mime_type text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE build_step_photos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.build_step_photos IS 'Фото шага гайда сборки в S3 (бакет 3mf, ключ models/{model_id}/build/{step_id}/...), паттерн model_files.';


--
-- Name: build_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.build_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    guide_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    title text NOT NULL,
    body text,
    mesh_id uuid,
    mesh_object_ref jsonb,
    parts jsonb DEFAULT '[]'::jsonb NOT NULL,
    tools jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE build_steps; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.build_steps IS 'Шаги гайда сборки, упорядочены position. mesh_id — опциональная ссылка на деталь (model_meshes); mesh_object_ref — опциональный указатель на объект внутри мультипарт-3MF (MF-8/MF-22), не констрейнится в БД.';


--
-- Name: comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    user_id uuid NOT NULL,
    parent_id uuid,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    votes_up integer DEFAULT 0 NOT NULL,
    votes_down integer DEFAULT 0 NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by_owner boolean,
    votes_up_weighted numeric(10,3) DEFAULT 0 NOT NULL,
    votes_down_weighted numeric(10,3) DEFAULT 0 NOT NULL,
    CONSTRAINT comments_body_check CHECK (((length(TRIM(BOTH FROM body)) > 0) AND (length(body) <= 4000))),
    CONSTRAINT comments_subject_type_check CHECK ((subject_type = ANY (ARRAY['model'::text, 'feed_post'::text, 'make'::text])))
);


--
-- Name: communities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'custom'::text NOT NULL,
    subject_type text,
    subject_id uuid,
    description text,
    cover_image_s3_key text,
    visibility text DEFAULT 'public'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT communities_check CHECK ((((kind = 'custom'::text) AND (subject_type IS NULL) AND (subject_id IS NULL)) OR ((kind <> 'custom'::text) AND (subject_type IS NOT NULL) AND (subject_id IS NOT NULL)))),
    CONSTRAINT communities_kind_check CHECK ((kind = ANY (ARRAY['machine'::text, 'vendor'::text, 'craft'::text, 'custom'::text]))),
    CONSTRAINT communities_slug_check CHECK (((slug = lower(slug)) AND (length(slug) > 0))),
    CONSTRAINT communities_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text]))),
    CONSTRAINT communities_subject_type_check CHECK ((subject_type = ANY (ARRAY['machine'::text, 'vendor'::text]))),
    CONSTRAINT communities_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'unlisted'::text])))
);


--
-- Name: community_firmware; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_firmware (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    printer_id uuid,
    model text NOT NULL,
    author text NOT NULL,
    git_url text NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE community_firmware; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.community_firmware IS 'Реестр прошивок/адаптаций от сообщества (не наша custom-прошивка): ссылки на GitVerse-репо. verified=false по умолчанию — «не проверено нами» (MF-879).';


--
-- Name: community_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_members (
    community_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT community_members_role_check CHECK ((role = ANY (ARRAY['member'::text, 'moderator'::text, 'owner'::text]))),
    CONSTRAINT community_members_source_check CHECK ((source = ANY (ARRAY['machine_prompt'::text, 'manual'::text, 'vendor_claim'::text])))
);


--
-- Name: consent_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    anon_id text,
    user_id uuid,
    consent_type text NOT NULL,
    version text NOT NULL,
    action text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT consent_records_action_check CHECK ((action = ANY (ARRAY['granted'::text, 'revoked'::text]))),
    CONSTRAINT consent_records_check CHECK (((anon_id IS NOT NULL) OR (user_id IS NOT NULL))),
    CONSTRAINT consent_records_consent_type_check CHECK ((consent_type = 'behavioral_analytics'::text))
);


--
-- Name: content_agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_agents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    name text NOT NULL,
    avatar_s3_key text,
    bio text,
    runtime_label text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT content_agents_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT content_agents_revoked_after_created_check CHECK (((revoked_at IS NULL) OR (revoked_at >= created_at))),
    CONSTRAINT content_agents_status_check CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text])))
);


--
-- Name: device_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    actor_user_id uuid,
    action text NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    correlation_id uuid,
    CONSTRAINT device_audit_log_action_check CHECK ((length(action) > 0))
);


--
-- Name: device_command_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_command_counters (
    device_id uuid NOT NULL,
    next_seq bigint DEFAULT 0 NOT NULL,
    CONSTRAINT device_command_counters_next_seq_check CHECK ((next_seq >= 0))
);


--
-- Name: device_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_commands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    api_key_id uuid,
    command text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    acked_at timestamp with time zone,
    correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_scope uuid,
    actor_scope uuid,
    idempotency_key text,
    actor_role text DEFAULT 'owner'::text NOT NULL,
    command_seq bigint DEFAULT 0 NOT NULL,
    CONSTRAINT device_commands_actor_role_check CHECK ((actor_role = ANY (ARRAY['owner'::text, 'operator'::text]))),
    CONSTRAINT device_commands_command_check CHECK ((command = ANY (ARRAY['gcode'::text, 'start'::text, 'pause'::text, 'resume'::text, 'stop'::text, 'cancel'::text]))),
    CONSTRAINT device_commands_command_seq_check CHECK ((command_seq >= 0)),
    CONSTRAINT device_commands_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'delivered'::text, 'acked'::text, 'rejected'::text])))
);


--
-- Name: TABLE device_commands; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_commands IS 'Очередь команд публичного API. queued=принята порталом; доставка на устройство — отдельная инфра agent-relay (MF-886/887), в v0 ещё не подключена.';


--
-- Name: device_enroll_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_enroll_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    code_hash bytea NOT NULL,
    firmware_class text,
    label text,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    device_id uuid,
    agent_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT device_enroll_codes_firmware_class_check CHECK ((firmware_class = ANY (ARRAY['klipper'::text, 'octoprint'::text, 'bambu'::text, 'prusa'::text, 'creality'::text])))
);


--
-- Name: device_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_incidents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    event_type text NOT NULL,
    dedupe_key text NOT NULL,
    severity text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    occurrence_count integer DEFAULT 1 NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    acknowledged_at timestamp with time zone,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_incidents_dedupe_key_check CHECK ((length(dedupe_key) > 0)),
    CONSTRAINT device_incidents_event_type_check CHECK ((length(event_type) > 0)),
    CONSTRAINT device_incidents_occurrence_count_check CHECK ((occurrence_count > 0)),
    CONSTRAINT device_incidents_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text]))),
    CONSTRAINT device_incidents_status_check CHECK ((status = ANY (ARRAY['open'::text, 'acknowledged'::text, 'resolved'::text])))
);


--
-- Name: TABLE device_incidents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_incidents IS 'MF-2047: дедуп device event -> assistant incident thread. status=resolved не удаляет thread/messages — новое срабатывание того же dedupe_key открывает отдельный новый инцидент/тред.';


--
-- Name: device_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    model_id uuid,
    file_name text,
    status text DEFAULT 'queued'::text NOT NULL,
    progress numeric(5,2),
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_jobs_progress_check CHECK (((progress IS NULL) OR ((progress >= (0)::numeric) AND (progress <= (100)::numeric)))),
    CONSTRAINT device_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'printing'::text, 'paused'::text, 'completed'::text, 'cancelled'::text, 'failed'::text])))
);


--
-- Name: device_print_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_print_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    requested_by uuid NOT NULL,
    slice_job_id uuid NOT NULL,
    copies integer DEFAULT 1 NOT NULL,
    idempotency_key text NOT NULL,
    status text DEFAULT 'slice_ready'::text NOT NULL,
    gcode_sha256 text,
    transfer_id uuid,
    start_command_id uuid,
    error_code text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_print_requests_copies_check CHECK ((copies = 1)),
    CONSTRAINT device_print_requests_gcode_sha256_check CHECK (((gcode_sha256 IS NULL) OR (gcode_sha256 ~ '^[0-9a-fA-F]{64}$'::text))),
    CONSTRAINT device_print_requests_idempotency_key_check CHECK (((length(idempotency_key) >= 1) AND (length(idempotency_key) <= 128))),
    CONSTRAINT device_print_requests_status_check CHECK ((status = ANY (ARRAY['slice_ready'::text, 'delivered'::text, 'awaiting_confirmation'::text, 'accepted'::text, 'printing'::text, 'failed'::text, 'rejected'::text])))
);


--
-- Name: TABLE device_print_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_print_requests IS 'MF-1975: идемпотентная связка verified slice_jobs -> доставка G-code через MF-26 relay -> отдельно подтверждённый старт печати. Секреты/IP не хранятся — только id/hash/статусы.';


--
-- Name: device_print_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_print_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    agent_id uuid,
    job_id uuid,
    model_id uuid,
    outcome text NOT NULL,
    client_result_id text NOT NULL,
    reported_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_print_results_client_result_id_check CHECK (((length(client_result_id) >= 1) AND (length(client_result_id) <= 128))),
    CONSTRAINT device_print_results_outcome_check CHECK ((outcome = ANY (ARRAY['succeeded'::text, 'failed'::text])))
);


--
-- Name: device_reputation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_reputation (
    device_id uuid NOT NULL,
    successful_prints bigint DEFAULT 0 NOT NULL,
    failed_prints bigint DEFAULT 0 NOT NULL,
    last_outcome text,
    last_result_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_reputation_failed_prints_check CHECK ((failed_prints >= 0)),
    CONSTRAINT device_reputation_last_outcome_check CHECK ((last_outcome = ANY (ARRAY['succeeded'::text, 'failed'::text]))),
    CONSTRAINT device_reputation_successful_prints_check CHECK ((successful_prints >= 0))
);


--
-- Name: device_shares; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_shares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_shares_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'operator'::text, 'viewer'::text, 'guest'::text])))
);


--
-- Name: device_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_state (
    device_id uuid NOT NULL,
    status text DEFAULT 'offline'::text NOT NULL,
    progress numeric(5,2),
    job_id uuid,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    seq bigint DEFAULT 0 NOT NULL,
    CONSTRAINT device_state_progress_check CHECK (((progress IS NULL) OR ((progress >= (0)::numeric) AND (progress <= (100)::numeric)))),
    CONSTRAINT device_state_seq_check CHECK ((seq >= 0)),
    CONSTRAINT device_state_status_check CHECK ((status = ANY (ARRAY['printing'::text, 'ready'::text, 'idle'::text, 'paused'::text, 'error'::text, 'offline'::text])))
);


--
-- Name: device_telemetry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_telemetry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    status text,
    progress numeric(5,2),
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    seq bigint DEFAULT 0 NOT NULL,
    CONSTRAINT device_telemetry_progress_check CHECK (((progress IS NULL) OR ((progress >= (0)::numeric) AND (progress <= (100)::numeric)))),
    CONSTRAINT device_telemetry_seq_check CHECK ((seq >= 0))
);


--
-- Name: device_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_transfers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    file_name text NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 text,
    start_print boolean DEFAULT false NOT NULL,
    status text DEFAULT 'initiated'::text NOT NULL,
    next_seq bigint DEFAULT 0 NOT NULL,
    bytes_transferred bigint DEFAULT 0 NOT NULL,
    error_code text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    kind text DEFAULT 'gcode'::text NOT NULL,
    CONSTRAINT device_transfers_bytes_transferred_check CHECK ((bytes_transferred >= 0)),
    CONSTRAINT device_transfers_file_name_check CHECK (((length(TRIM(BOTH FROM file_name)) >= 1) AND (length(TRIM(BOTH FROM file_name)) <= 256))),
    CONSTRAINT device_transfers_kind_check CHECK ((kind = ANY (ARRAY['gcode'::text, 'printer_profile'::text]))),
    CONSTRAINT device_transfers_next_seq_check CHECK ((next_seq >= 0)),
    CONSTRAINT device_transfers_profile_kind_no_print CHECK (((kind <> 'printer_profile'::text) OR (start_print = false))),
    CONSTRAINT device_transfers_sha256_check CHECK (((sha256 IS NULL) OR (sha256 ~ '^[0-9a-fA-F]{64}$'::text))),
    CONSTRAINT device_transfers_size_bytes_check CHECK (((size_bytes > 0) AND (size_bytes <= 1073741824))),
    CONSTRAINT device_transfers_status_check CHECK ((status = ANY (ARRAY['initiated'::text, 'transferring'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: TABLE device_transfers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_transfers IS 'Resumable G-code metadata/progress. File bytes stay in relay/data-plane and are never buffered by API.';


--
-- Name: COLUMN device_transfers.kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.device_transfers.kind IS 'Куда агент кладёт файл на устройстве: gcode -> Moonraker root=gcodes (может стартовать печать), printer_profile -> root=config (never start_print, best-effort MF-1942).';


--
-- Name: email_otp; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_otp (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email_hash bytea NOT NULL,
    otp_hash bytea NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_name text NOT NULL,
    anon_id text,
    user_id uuid,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT events_check CHECK (((anon_id IS NOT NULL) OR (user_id IS NOT NULL))),
    CONSTRAINT events_event_name_check CHECK ((event_name = ANY (ARRAY['signup'::text, 'first_search'::text, 'model_view'::text, 'model_download'::text, 'upload_publish'::text, 'make_posted'::text, 'purchase'::text, 'payout_requested'::text, 'feed_post'::text, 'feed_comment'::text, 'feed_vote'::text, 'feed_post_open'::text, 'feed_scope_change'::text, 'feed_post_draft_start'::text, 'community_subscribe'::text, 'first_run_start'::text, 'persona_declared'::text, 'printer_question_answered'::text, 'printer_picker_open'::text, 'printer_linked'::text, 'printer_not_found_manual'::text, 'soft_track_chosen'::text, 'checklist_step_done'::text, 'home_cta_click'::text, 'aha_reached'::text, 'first_run_completed'::text, 'state_changed'::text, 'printer_card_upserted'::text, 'home_view'::text, 'home_hint_chip_click'::text, 'home_hero_submit'::text, 'nav_item_click'::text, 'gallery_tile_click'::text, 'profile_view'::text, 'generation_outcome'::text, 'generation_start'::text, 'generation_download'::text, 'printer_catalog_view'::text, 'printer_facet_apply'::text, 'printer_card_view'::text, 'printer_card_click_through'::text, 'model_search_query'::text])))
);


--
-- Name: feed_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feed_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid,
    anon_id text,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT feed_events_check CHECK (((anon_id IS NOT NULL) OR (user_id IS NOT NULL))),
    CONSTRAINT feed_events_event_type_check CHECK ((event_type = ANY (ARRAY['view'::text, 'read_complete'::text, 'model_click'::text, 'download'::text, 'favorite'::text, 'time_on_post'::text, 'vote'::text, 'comment'::text, 'remix'::text])))
);


--
-- Name: feed_post_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feed_post_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    s3_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: feed_post_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feed_post_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    body text NOT NULL,
    edited_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: feed_post_saves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feed_post_saves (
    user_id uuid NOT NULL,
    post_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: feed_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feed_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    author_id uuid NOT NULL,
    community_id uuid,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    model_id uuid,
    media_s3_key text,
    status text DEFAULT 'visible'::text NOT NULL,
    votes_up integer DEFAULT 0 NOT NULL,
    votes_down integer DEFAULT 0 NOT NULL,
    comments_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    make_id uuid,
    body_html text,
    is_edited boolean DEFAULT false NOT NULL,
    edited_at timestamp with time zone,
    machine_id uuid,
    votes_up_weighted numeric(10,3) DEFAULT 0 NOT NULL,
    votes_down_weighted numeric(10,3) DEFAULT 0 NOT NULL,
    source_url text,
    source_fingerprint text,
    ingest_provider text,
    ingest_model text,
    ingest_prompt_version text,
    gitverse_url text,
    gitverse_meta jsonb,
    poster_s3_key text,
    co_author_agent_id uuid,
    CONSTRAINT feed_posts_check CHECK (((type <> 'model_link'::text) OR (model_id IS NOT NULL))),
    CONSTRAINT feed_posts_check1 CHECK (((type <> 'media'::text) OR (media_s3_key IS NOT NULL))),
    CONSTRAINT feed_posts_gitverse_url_required_check CHECK (((type <> 'gitverse'::text) OR (gitverse_url IS NOT NULL))),
    CONSTRAINT feed_posts_ingest_provenance_shape_check CHECK (((source_fingerprint IS NULL) OR ((source_url IS NOT NULL) AND (ingest_provider IS NOT NULL) AND (ingest_model IS NOT NULL) AND (ingest_prompt_version IS NOT NULL)))),
    CONSTRAINT feed_posts_make_id_required_check CHECK (((type <> 'make'::text) OR (make_id IS NOT NULL))),
    CONSTRAINT feed_posts_poster_only_media_check CHECK (((poster_s3_key IS NULL) OR (type = 'media'::text))),
    CONSTRAINT feed_posts_printer_announcement_machine_check CHECK (((type <> 'printer_announcement'::text) OR (machine_id IS NOT NULL))),
    CONSTRAINT feed_posts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'visible'::text, 'hidden'::text, 'deleted'::text]))),
    CONSTRAINT feed_posts_title_check CHECK (((length(title) > 0) AND (length(title) <= 300))),
    CONSTRAINT feed_posts_type_check CHECK ((type = ANY (ARRAY['model_link'::text, 'media'::text, 'text'::text, 'make'::text, 'printer_announcement'::text, 'gitverse'::text])))
);


--
-- Name: fleets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fleets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: generated_concepts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generated_concepts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    generation_id uuid NOT NULL,
    normalized_query text NOT NULL,
    label text NOT NULL,
    prompt text NOT NULL,
    motif text,
    cache_key text NOT NULL,
    embedding_2048 public.halfvec(2048),
    image_embedding_2048 public.halfvec(2048),
    reuse_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ready_at timestamp with time zone,
    CONSTRAINT generated_concepts_reuse_count_check CHECK ((reuse_count >= 0)),
    CONSTRAINT generated_concepts_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'ready'::text, 'failed'::text])))
);


--
-- Name: generations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    branch text NOT NULL,
    prompt text NOT NULL,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    artifact_url text,
    preview_url text,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    assistant_offer_id uuid,
    phase text,
    progress smallint,
    eta_seconds integer,
    estimate_updated_at timestamp with time zone,
    preview_shots jsonb,
    source_generation_id uuid,
    source_angles text[],
    CONSTRAINT generations_branch_check CHECK ((branch = ANY (ARRAY['openscad'::text, 'kzd'::text, 'hueforge'::text, 'trellis'::text, 'concepts'::text, 'scan'::text]))),
    CONSTRAINT generations_eta_seconds_check CHECK (((eta_seconds IS NULL) OR (eta_seconds >= 0))),
    CONSTRAINT generations_phase_check CHECK (((phase IS NULL) OR (phase = ANY (ARRAY['queued'::text, 'loading'::text, 'draft'::text, 'geometry'::text, 'validation'::text, 'export'::text])))),
    CONSTRAINT generations_preview_shots_shape_check CHECK (((preview_shots IS NULL) OR (jsonb_typeof(preview_shots) = 'array'::text))),
    CONSTRAINT generations_progress_check CHECK (((progress IS NULL) OR ((progress >= 0) AND (progress <= 100)))),
    CONSTRAINT generations_source_angles_shape_check CHECK (((source_angles IS NULL) OR (source_angles <@ ARRAY['front'::text, 'three_quarter'::text, 'back'::text]))),
    CONSTRAINT generations_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'error'::text, 'timed_out'::text])))
);


--
-- Name: COLUMN generations.assistant_offer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.generations.assistant_offer_id IS 'Аудит-связка offer→generation (MF-1999 §4, generation.v2): id run''а assistant_runs, чей generation_offer подтверждён этой строкой. NULL — генерация создана прямым POST /generations.';


--
-- Name: generations_idempotency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generations_idempotency (
    owner_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    request_fingerprint bytea NOT NULL,
    generation_id uuid,
    response_status integer,
    response_body jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT generations_idempotency_response_pair_check CHECK ((((response_status IS NULL) AND (response_body IS NULL)) OR ((response_status IS NOT NULL) AND (response_body IS NOT NULL))))
);


--
-- Name: guest_print_nonces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guest_print_nonces (
    nonce text NOT NULL,
    device_id uuid NOT NULL,
    used_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: guest_print_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guest_print_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    model_id uuid,
    material text,
    quantity integer DEFAULT 1 NOT NULL,
    guest_label text,
    status text DEFAULT 'pending'::text NOT NULL,
    decided_at timestamp with time zone,
    decided_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT guest_print_requests_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT guest_print_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text, 'expired'::text])))
);


--
-- Name: idea_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idea_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    idea_id uuid NOT NULL,
    user_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: idea_enrichments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idea_enrichments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: idea_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idea_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    idea_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text NOT NULL,
    title text NOT NULL,
    message text,
    deep_link text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone
);


--
-- Name: idea_vote_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idea_vote_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event text NOT NULL,
    user_id uuid NOT NULL,
    idea_id uuid NOT NULL,
    ip_hash bytea,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT idea_vote_log_event_check CHECK ((event = ANY (ARRAY['cast'::text, 'revoke'::text])))
);


--
-- Name: idea_votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idea_votes (
    idea_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ideas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ideas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    author_id uuid NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    category text NOT NULL,
    status text DEFAULT 'proposed'::text NOT NULL,
    canonical_id uuid,
    vote_count integer DEFAULT 0 NOT NULL,
    decline_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    type text DEFAULT 'idea'::text NOT NULL,
    origin jsonb,
    ai_assisted boolean DEFAULT false NOT NULL,
    CONSTRAINT ideas_canonical_link CHECK (((status = 'duplicate'::text) = (canonical_id IS NOT NULL))),
    CONSTRAINT ideas_canonical_not_self CHECK (((canonical_id IS NULL) OR (canonical_id <> id))),
    CONSTRAINT ideas_category_check CHECK ((category = ANY (ARRAY['catalog'::text, 'projects'::text, 'forum'::text, 'account'::text, 'other'::text]))),
    CONSTRAINT ideas_reason_required CHECK (((status <> ALL (ARRAY['declined'::text, 'duplicate'::text])) OR ((decline_reason IS NOT NULL) AND (length(decline_reason) > 0)))),
    CONSTRAINT ideas_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'under_review'::text, 'planned'::text, 'in_progress'::text, 'done'::text, 'declined'::text, 'duplicate'::text, 'archived'::text, 'hidden'::text, 'removed'::text]))),
    CONSTRAINT ideas_title_check CHECK (((length(title) > 0) AND (length(title) <= 120))),
    CONSTRAINT ideas_type_check CHECK ((type = ANY (ARRAY['idea'::text, 'problem'::text])))
);


--
-- Name: idempotency_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_records (
    actor_id uuid NOT NULL,
    operation_scope text NOT NULL,
    idempotency_key text NOT NULL,
    request_fingerprint bytea NOT NULL,
    state text DEFAULT 'in_progress'::text NOT NULL,
    lease_expires_at timestamp with time zone NOT NULL,
    response_status integer,
    response_body jsonb,
    response_headers jsonb,
    resource_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT idempotency_records_expiry_check CHECK ((expires_at > created_at)),
    CONSTRAINT idempotency_records_fingerprint_check CHECK ((octet_length(request_fingerprint) = 32)),
    CONSTRAINT idempotency_records_headers_object_check CHECK (((response_headers IS NULL) OR (jsonb_typeof(response_headers) = 'object'::text))),
    CONSTRAINT idempotency_records_key_check CHECK ((((char_length(idempotency_key) >= 1) AND (char_length(idempotency_key) <= 128)) AND (idempotency_key !~ '[^ -~]'::text))),
    CONSTRAINT idempotency_records_response_check CHECK ((((state = 'in_progress'::text) AND (response_status IS NULL) AND (response_headers IS NULL)) OR ((state = 'completed'::text) AND ((response_status >= 100) AND (response_status <= 599)) AND (response_headers IS NOT NULL)))),
    CONSTRAINT idempotency_records_scope_check CHECK (((char_length(operation_scope) >= 1) AND (char_length(operation_scope) <= 300))),
    CONSTRAINT idempotency_records_state_check CHECK ((state = ANY (ARRAY['in_progress'::text, 'completed'::text])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username text NOT NULL,
    display_name text,
    avatar_url text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    handle_confirmed boolean DEFAULT true NOT NULL,
    is_staff boolean DEFAULT false NOT NULL,
    reputation_score integer DEFAULT 0 NOT NULL,
    trust_level smallint DEFAULT 0 NOT NULL,
    trust_level_manual boolean DEFAULT false NOT NULL,
    role text DEFAULT 'user'::text NOT NULL,
    bio text,
    website_url text,
    contacts jsonb DEFAULT '[]'::jsonb NOT NULL,
    avatar_s3_key text,
    maker_verified boolean DEFAULT false NOT NULL,
    is_master boolean DEFAULT false NOT NULL,
    master_profile jsonb,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['user'::text, 'researcher'::text]))),
    CONSTRAINT users_status_check CHECK ((status = ANY (ARRAY['active'::text, 'banned'::text, 'deleted'::text]))),
    CONSTRAINT users_trust_level_check CHECK (((trust_level >= 0) AND (trust_level <= 4)))
);


--
-- Name: COLUMN users.maker_verified; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.maker_verified IS 'Бейдж «Проверенный» (MF-993) — ручной флаг, авто-детект не реализован в этой карточке.';


--
-- Name: COLUMN users.is_master; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.is_master IS 'Роль «мастер» поверх аккаунта (MF-399/MF-20) — читается RBAC-проверкой isMaster(), не отдельный grant.';


--
-- Name: COLUMN users.master_profile; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.master_profile IS 'Шапка публичной витрины мастера (MF-399): {headline, description, city, slogan}, все поля опциональны до PUT /me/master-profile.';


--
-- Name: identity_read_v1; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.identity_read_v1 AS
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


--
-- Name: VIEW identity_read_v1; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.identity_read_v1 IS 'Versioned read-view (backend-nest-migration §7.1, contract v1) over the users god-table (R:16). Public identity projection only; auth/role/staff material is not exposed. Read seam only.';


--
-- Name: import_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_bindings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    connection_id uuid,
    user_id uuid NOT NULL,
    source_platform text NOT NULL,
    external_id text NOT NULL,
    original_url text NOT NULL,
    source_license text,
    source_popularity jsonb,
    ownership_status text DEFAULT 'unverified'::text NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT import_bindings_ownership_status_check CHECK ((ownership_status = ANY (ARRAY['unverified'::text, 'pending'::text, 'verified'::text, 'rejected'::text]))),
    CONSTRAINT import_bindings_source_platform_check CHECK ((source_platform = 'cults3d'::text))
);


--
-- Name: import_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    source_platform text NOT NULL,
    credential_enc bytea NOT NULL,
    external_username text,
    ownership_status text DEFAULT 'unverified'::text NOT NULL,
    challenge_token text,
    challenge_target text,
    verified_at timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    last_error text,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT import_connections_ownership_status_check CHECK ((ownership_status = ANY (ARRAY['unverified'::text, 'pending'::text, 'verified'::text, 'rejected'::text]))),
    CONSTRAINT import_connections_source_platform_check CHECK ((source_platform = 'cults3d'::text)),
    CONSTRAINT import_connections_status_check CHECK ((status = ANY (ARRAY['active'::text, 'error'::text])))
);


--
-- Name: import_job_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_job_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    external_id text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    retryable boolean DEFAULT false NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_retry_at timestamp with time zone,
    last_error text,
    binding_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT import_job_items_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'failed'::text])))
);


--
-- Name: import_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    connection_id uuid,
    source_platform text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    total_count integer DEFAULT 0 NOT NULL,
    done_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    CONSTRAINT import_jobs_source_platform_check CHECK ((source_platform = 'cults3d'::text)),
    CONSTRAINT import_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'failed'::text])))
);


--
-- Name: ingest_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingest_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone DEFAULT now() NOT NULL,
    found integer DEFAULT 0 NOT NULL,
    changed integer DEFAULT 0 NOT NULL,
    rejected integer DEFAULT 0 NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ledger_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ledger_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account text NOT NULL,
    user_id uuid,
    amount_minor bigint NOT NULL,
    currency text DEFAULT 'RUB'::text NOT NULL,
    reason text NOT NULL,
    purchase_id uuid,
    payout_id uuid,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ledger_entries_account_check CHECK ((account = ANY (ARRAY['seller_balance'::text, 'platform_revenue'::text]))),
    CONSTRAINT ledger_entries_account_user_check CHECK ((((account = 'seller_balance'::text) AND (user_id IS NOT NULL)) OR ((account = 'platform_revenue'::text) AND (user_id IS NULL)))),
    CONSTRAINT ledger_entries_amount_minor_check CHECK ((amount_minor <> 0)),
    CONSTRAINT ledger_entries_reason_check CHECK ((reason = ANY (ARRAY['purchase_credit'::text, 'platform_fee'::text, 'payout_debit'::text, 'refund_debit'::text, 'manual_adjustment'::text])))
);


--
-- Name: TABLE ledger_entries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ledger_entries IS 'Append-only леджер проводок биллинга (MF-363). Баланс автора = agg на чтении, не отдельное
   мутируемое поле. available_at реализует холд (доступно/в холде из тела карточки).';


--
-- Name: machine_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.machine_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    source_url text,
    external_ref text NOT NULL,
    raw jsonb NOT NULL,
    content_hash bytea,
    matched_machine_id uuid,
    confidence numeric(3,2),
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    owner text,
    source_family text,
    CONSTRAINT machine_candidates_owner_check CHECK (((owner IS NULL) OR (owner = ANY (ARRAY['catalog'::text, 'scout'::text])))),
    CONSTRAINT machine_candidates_ownership_matrix_check CHECK (((owner IS NULL) OR ((owner = 'catalog'::text) AND (source_family = ANY (ARRAY['cura-definitions'::text, 'sovol3d-store'::text, 'giga-free-html'::text]))) OR ((owner = 'scout'::text) AND (source_family = ANY (ARRAY['vendor_whitelist'::text, 'slicer_profile'::text, 'ru_machine_spec'::text]))))),
    CONSTRAINT machine_candidates_ownership_pair_check CHECK (((owner IS NULL) = (source_family IS NULL))),
    CONSTRAINT machine_candidates_source_family_check CHECK (((source_family IS NULL) OR (source_family = ANY (ARRAY['cura-definitions'::text, 'sovol3d-store'::text, 'giga-free-html'::text, 'vendor_whitelist'::text, 'slicer_profile'::text, 'ru_machine_spec'::text])))),
    CONSTRAINT machine_candidates_source_family_source_check CHECK (((source_family IS NULL) OR (source = source_family))),
    CONSTRAINT machine_candidates_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'matched'::text, 'merged'::text, 'rejected'::text, 'quarantined'::text])))
);


--
-- Name: makes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.makes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid,
    user_id uuid NOT NULL,
    photo_s3_key text,
    caption text,
    machine_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    printability_rating smallint,
    issue_tags text[] DEFAULT '{}'::text[] NOT NULL,
    notes text,
    print_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'published'::text NOT NULL,
    likes_count integer DEFAULT 0 NOT NULL,
    comments_count integer DEFAULT 0 NOT NULL,
    reposts_count integer DEFAULT 0 NOT NULL,
    views_count integer DEFAULT 0 NOT NULL,
    geometry_quality_rating smallint,
    surface_quality_rating smallint,
    CONSTRAINT makes_geometry_quality_rating_check CHECK (((geometry_quality_rating IS NULL) OR ((geometry_quality_rating >= 1) AND (geometry_quality_rating <= 5)))),
    CONSTRAINT makes_issue_tags_check CHECK ((issue_tags <@ ARRAY['warping'::text, 'stringing'::text, 'layer_shift'::text, 'adhesion'::text])),
    CONSTRAINT makes_printability_rating_check CHECK (((printability_rating IS NULL) OR ((printability_rating >= 1) AND (printability_rating <= 5)))),
    CONSTRAINT makes_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'published'::text, 'hidden'::text]))),
    CONSTRAINT makes_surface_quality_rating_check CHECK (((surface_quality_rating IS NULL) OR ((surface_quality_rating >= 1) AND (surface_quality_rating <= 5))))
);


--
-- Name: machine_make_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.machine_make_stats AS
 SELECT machine_id,
    count(*) AS make_count,
    count(DISTINCT model_id) AS model_count
   FROM public.makes mk
  WHERE ((status = 'published'::text) AND (machine_id IS NOT NULL))
  GROUP BY machine_id;


--
-- Name: machine_material_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.machine_material_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    machine_id uuid NOT NULL,
    nozzle_diameter_mm numeric(4,2),
    name text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    overrides jsonb DEFAULT '{}'::jsonb NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT machine_material_profiles_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'import'::text])))
);


--
-- Name: machines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.machines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    craft text DEFAULT '3d_printing'::text NOT NULL,
    kind text NOT NULL,
    vendor_id uuid,
    model text NOT NULL,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    year integer,
    discontinued boolean DEFAULT false NOT NULL,
    specs jsonb DEFAULT '{}'::jsonb NOT NULL,
    schema_version integer DEFAULT 1 NOT NULL,
    integration text DEFAULT 'none'::text NOT NULL,
    source text DEFAULT 'community'::text NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    field_provenance jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    content_hash bytea,
    CONSTRAINT machines_integration_check CHECK ((integration = ANY (ARRAY['live'::text, 'in_development'::text, 'none'::text]))),
    CONSTRAINT machines_kind_check CHECK ((kind = ANY (ARRAY['fdm_printer'::text, 'sla_printer'::text, 'cnc_router'::text, 'cnc_lathe'::text, 'laser_cutter'::text]))),
    CONSTRAINT machines_source_check CHECK ((source = ANY (ARRAY['official'::text, 'community'::text]))),
    CONSTRAINT machines_status_check CHECK ((status = ANY (ARRAY['active'::text, 'quarantined'::text, 'archived'::text])))
);


--
-- Name: make_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.make_materials (
    make_id uuid NOT NULL,
    material_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: make_photo_hashes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.make_photo_hashes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    make_id uuid NOT NULL,
    photo_id uuid NOT NULL,
    phash bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: make_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.make_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    make_id uuid NOT NULL,
    s3_key text NOT NULL,
    "position" smallint DEFAULT 0 NOT NULL,
    is_cover boolean DEFAULT false NOT NULL,
    moderation_status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT make_photos_moderation_status_check CHECK ((moderation_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: maker_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maker_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    active boolean DEFAULT true NOT NULL,
    service_mode text DEFAULT 'radius'::text NOT NULL,
    location public.geography(Point,4326),
    location_geohash text,
    radius_km numeric,
    service_cities text[] DEFAULT '{}'::text[] NOT NULL,
    region_label text DEFAULT ''::text NOT NULL,
    processes text[] DEFAULT '{}'::text[] NOT NULL,
    material_type_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    max_build_volume_mm jsonb,
    min_layer_height_mm numeric,
    capacity_per_week integer,
    sla_days integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT maker_profiles_capacity_per_week_check CHECK (((capacity_per_week IS NULL) OR (capacity_per_week >= 0))),
    CONSTRAINT maker_profiles_location_required_check CHECK (((service_mode = 'mail_ru'::text) OR (location IS NOT NULL))),
    CONSTRAINT maker_profiles_min_layer_height_mm_check CHECK (((min_layer_height_mm IS NULL) OR (min_layer_height_mm > (0)::numeric))),
    CONSTRAINT maker_profiles_processes_check CHECK ((processes <@ ARRAY['fdm'::text, 'resin-lcd'::text, 'resin-dlp'::text, 'resin-sla'::text])),
    CONSTRAINT maker_profiles_radius_km_check CHECK (((radius_km IS NULL) OR (radius_km > (0)::numeric))),
    CONSTRAINT maker_profiles_service_mode_check CHECK ((service_mode = ANY (ARRAY['radius'::text, 'cities'::text, 'mail_ru'::text]))),
    CONSTRAINT maker_profiles_sla_days_check CHECK (((sla_days IS NULL) OR (sla_days >= 0)))
);


--
-- Name: marketplace_gmv_take_rate; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.marketplace_gmv_take_rate AS
 WITH purchases AS (
         SELECT COALESCE(sum(((events.props ->> 'amount'::text))::numeric), (0)::numeric) AS gmv
           FROM public.events
          WHERE (events.event_name = 'purchase'::text)
        ), payouts AS (
         SELECT COALESCE(sum(((events.props ->> 'amount'::text))::numeric), (0)::numeric) AS payouts_total
           FROM public.events
          WHERE (events.event_name = 'payout_requested'::text)
        )
 SELECT purchases.gmv,
    payouts.payouts_total,
    (purchases.gmv - payouts.payouts_total) AS net_revenue,
    round(((purchases.gmv - payouts.payouts_total) / NULLIF(purchases.gmv, (0)::numeric)), 4) AS take_rate
   FROM purchases,
    payouts;


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    title text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    description text,
    votes_up integer DEFAULT 0 NOT NULL,
    votes_down integer DEFAULT 0 NOT NULL,
    downloads_count integer DEFAULT 0 NOT NULL,
    recommended_material_id uuid,
    repo_url text,
    featured_at timestamp with time zone,
    repo_path text,
    forked_from uuid,
    comments_count integer DEFAULT 0 NOT NULL,
    makes_count integer DEFAULT 0 NOT NULL,
    views_count integer DEFAULT 0 NOT NULL,
    price_minor bigint DEFAULT 0 NOT NULL,
    currency text DEFAULT 'RUB'::text NOT NULL,
    remixes_count integer DEFAULT 0 NOT NULL,
    primary_model_id uuid,
    published_revision_id uuid,
    version bigint DEFAULT 1 NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    CONSTRAINT models_price_minor_check CHECK ((price_minor >= 0)),
    CONSTRAINT projects_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 200))),
    CONSTRAINT projects_version_check CHECK ((version > 0))
);


--
-- Name: COLUMN projects.price_minor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.projects.price_minor IS 'Цена модели в минорных единицах RUB (копейки). 0 = бесплатная модель (MF-363).';


--
-- Name: marketplace_liquidity_30d; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.marketplace_liquidity_30d AS
 SELECT count(*) AS published_models_30d,
    count(*) FILTER (WHERE (downloads_count > 0)) AS published_models_30d_with_download,
    round(((count(*) FILTER (WHERE (downloads_count > 0)))::numeric / (NULLIF(count(*), 0))::numeric), 4) AS liquidity_rate
   FROM public.projects p
  WHERE ((published_revision_id IS NOT NULL) AND (deleted_at IS NULL) AND (created_at >= (now() - '30 days'::interval)));


--
-- Name: marketplace_search_match_rate_30d; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.marketplace_search_match_rate_30d AS
 WITH searches AS (
         SELECT events.id,
            events.created_at,
            COALESCE((events.user_id)::text, events.anon_id) AS subject
           FROM public.events
          WHERE ((events.event_name = 'first_search'::text) AND (events.created_at >= (now() - '30 days'::interval)))
        ), downloads AS (
         SELECT events.created_at,
            COALESCE((events.user_id)::text, events.anon_id) AS subject
           FROM public.events
          WHERE ((events.event_name = 'model_download'::text) AND (events.created_at >= (now() - '30 days'::interval)))
        )
 SELECT count(*) AS searches_30d,
    count(*) FILTER (WHERE (EXISTS ( SELECT 1
           FROM downloads d
          WHERE ((d.subject = s.subject) AND (d.created_at >= s.created_at) AND (d.created_at <= (s.created_at + '00:30:00'::interval)))))) AS searches_with_download_30d,
    round(((count(*) FILTER (WHERE (EXISTS ( SELECT 1
           FROM downloads d
          WHERE ((d.subject = s.subject) AND (d.created_at >= s.created_at) AND (d.created_at <= (s.created_at + '00:30:00'::interval)))))))::numeric / (NULLIF(count(*), 0))::numeric), 4) AS search_to_download_match_rate
   FROM searches s;


--
-- Name: model_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_tags (
    model_id uuid NOT NULL,
    tag_id uuid NOT NULL
);


--
-- Name: tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tags_name_check CHECK (((name = lower(name)) AND (length(name) > 0)))
);


--
-- Name: user_printers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_printers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    printer_id uuid,
    brand text NOT NULL,
    model text NOT NULL,
    build_volume jsonb,
    nozzle_mm numeric(4,2),
    kinematics text,
    link_source text NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    connection_id uuid,
    external_ref text,
    status text,
    agent_id uuid,
    firmware_class text,
    last_seen_at timestamp with time zone,
    capabilities jsonb DEFAULT '{}'::jsonb NOT NULL,
    fleet_id uuid,
    zone_id uuid,
    config_fingerprint text,
    config_fingerprint_source text,
    config_fingerprint_stock_declared boolean,
    config_fingerprint_updated_at timestamp with time zone,
    lan_endpoint text,
    connection_mode text,
    catalog_printer_id uuid,
    CONSTRAINT user_printers_config_fingerprint_source_check CHECK (((config_fingerprint_source IS NULL) OR (config_fingerprint_source = ANY (ARRAY['agent'::text, 'declared'::text])))),
    CONSTRAINT user_printers_connection_binding_check CHECK (((connection_mode IS NULL) OR ((connection_mode = 'managed-local'::text) AND (link_source = 'ip'::text) AND (agent_id IS NULL)) OR ((connection_mode = 'managed-bridge'::text) AND (link_source = 'agent'::text) AND (agent_id IS NOT NULL)) OR ((connection_mode = 'list'::text) AND (link_source <> 'ip'::text)))),
    CONSTRAINT user_printers_connection_mode_check CHECK (((connection_mode IS NULL) OR (connection_mode = ANY (ARRAY['list'::text, 'managed-local'::text, 'managed-bridge'::text])))),
    CONSTRAINT user_printers_firmware_class_check CHECK ((firmware_class = ANY (ARRAY['klipper'::text, 'octoprint'::text, 'bambu'::text, 'prusa'::text, 'creality'::text]))),
    CONSTRAINT user_printers_lan_endpoint_shape_check CHECK (((lan_endpoint IS NULL) OR (lan_endpoint ~ '^(\[[0-9A-Fa-f:]+\]|[A-Za-z0-9.-]+):[0-9]{1,5}$'::text))),
    CONSTRAINT user_printers_lan_endpoint_source_check CHECK (((lan_endpoint IS NULL) OR (link_source = 'ip'::text))),
    CONSTRAINT user_printers_link_source_check CHECK ((link_source = ANY (ARRAY['connector'::text, 'popular'::text, 'search'::text, 'manual'::text, 'agent'::text, 'ip'::text, 'catalog'::text])))
);


--
-- Name: marketplace_supply_demand_by_printer_tag; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.marketplace_supply_demand_by_printer_tag AS
 WITH model_supply AS (
         SELECT lower(t.name) AS printer_tag,
            count(DISTINCT mt.model_id) AS models_count
           FROM ((public.tags t
             JOIN public.model_tags mt ON ((mt.tag_id = t.id)))
             JOIN public.projects p ON ((p.id = mt.model_id)))
          WHERE ((p.published_revision_id IS NOT NULL) AND (p.deleted_at IS NULL))
          GROUP BY (lower(t.name))
        ), printer_demand AS (
         SELECT lower(user_printers.brand) AS printer_tag,
            count(*) AS printer_owners_count
           FROM public.user_printers
          GROUP BY (lower(user_printers.brand))
        )
 SELECT COALESCE(s.printer_tag, d.printer_tag) AS printer_tag,
    COALESCE(s.models_count, (0)::bigint) AS models_count,
    COALESCE(d.printer_owners_count, (0)::bigint) AS printer_owners_count,
    round(((COALESCE(s.models_count, (0)::bigint))::numeric / (NULLIF(d.printer_owners_count, 0))::numeric), 4) AS models_per_printer_owner
   FROM (model_supply s
     FULL JOIN printer_demand d ON ((d.printer_tag = s.printer_tag)))
  ORDER BY (round(((COALESCE(s.models_count, (0)::bigint))::numeric / (NULLIF(d.printer_owners_count, 0))::numeric), 4)) DESC NULLS LAST;


--
-- Name: marketplace_time_to_first_download_proxy; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.marketplace_time_to_first_download_proxy AS
 WITH first_publish AS (
         SELECT events.user_id AS author_id,
            min(events.created_at) AS first_publish_at
           FROM public.events
          WHERE ((events.event_name = 'upload_publish'::text) AND (events.user_id IS NOT NULL))
          GROUP BY events.user_id
        ), first_external_download AS (
         SELECT p.owner_id AS author_id,
            min(e.created_at) AS first_download_at
           FROM (public.events e
             JOIN public.projects p ON ((p.id = ((e.props ->> 'model_id'::text))::uuid)))
          WHERE ((e.event_name = 'model_download'::text) AND (p.owner_id IS NOT NULL) AND (e.user_id IS DISTINCT FROM p.owner_id))
          GROUP BY p.owner_id
        )
 SELECT count(*) AS authors_published_total,
    count(fd.author_id) AS authors_with_external_download,
    round(avg((EXTRACT(epoch FROM (fd.first_download_at - fp.first_publish_at)) / (86400)::numeric)), 2) AS avg_days_to_first_external_download
   FROM (first_publish fp
     LEFT JOIN first_external_download fd ON (((fd.author_id = fp.author_id) AND (fd.first_download_at >= fp.first_publish_at))));


--
-- Name: marketplace_time_to_first_sale; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.marketplace_time_to_first_sale AS
 WITH first_publish AS (
         SELECT events.user_id AS author_id,
            min(events.created_at) AS first_publish_at
           FROM public.events
          WHERE ((events.event_name = 'upload_publish'::text) AND (events.user_id IS NOT NULL))
          GROUP BY events.user_id
        ), first_sale AS (
         SELECT ((events.props ->> 'seller_id'::text))::uuid AS author_id,
            min(events.created_at) AS first_sale_at
           FROM public.events
          WHERE ((events.event_name = 'purchase'::text) AND (events.props ? 'seller_id'::text))
          GROUP BY ((events.props ->> 'seller_id'::text))::uuid
        )
 SELECT count(*) AS authors_published_total,
    count(fs.author_id) AS authors_with_sale,
    round(avg((EXTRACT(epoch FROM (fs.first_sale_at - fp.first_publish_at)) / (86400)::numeric)), 2) AS avg_days_to_first_sale
   FROM (first_publish fp
     LEFT JOIN first_sale fs ON (((fs.author_id = fp.author_id) AND (fs.first_sale_at >= fp.first_publish_at))));


--
-- Name: master_equipment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.master_equipment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    master_id uuid NOT NULL,
    machine_id uuid NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'unknown'::text NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT master_equipment_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT master_equipment_status_check CHECK ((status = ANY (ARRAY['unknown'::text, 'online'::text, 'busy'::text, 'offline'::text])))
);


--
-- Name: TABLE master_equipment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.master_equipment IS 'Парк оборудования витрины мастера (MF-399): станок/принтер — обязательный machine_id из
   каталога (MF-32), количество единиц — quantity, объём печати читается из machines.specs.';


--
-- Name: master_equipment_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.master_equipment_materials (
    master_equipment_id uuid NOT NULL,
    material_id uuid NOT NULL
);


--
-- Name: master_service_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.master_service_materials (
    master_service_id uuid NOT NULL,
    material_id uuid NOT NULL
);


--
-- Name: master_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.master_services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    master_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    technology text NOT NULL,
    machine_id uuid,
    price_mode text DEFAULT 'range'::text NOT NULL,
    price_min_minor bigint,
    price_max_minor bigint,
    currency text DEFAULT 'RUB'::text NOT NULL,
    min_order_qty integer DEFAULT 1 NOT NULL,
    min_order_amount_minor bigint,
    lead_time_days_min integer,
    lead_time_days_max integer,
    delivery_zone text,
    delivery_method text DEFAULT 'any'::text NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT master_services_delivery_method_check CHECK ((delivery_method = ANY (ARRAY['pickup'::text, 'courier'::text, 'post'::text, 'any'::text]))),
    CONSTRAINT master_services_lead_time_days_max_check CHECK (((lead_time_days_max IS NULL) OR (lead_time_days_max > 0))),
    CONSTRAINT master_services_lead_time_days_min_check CHECK (((lead_time_days_min IS NULL) OR (lead_time_days_min > 0))),
    CONSTRAINT master_services_lead_time_range CHECK (((lead_time_days_min IS NULL) OR (lead_time_days_max IS NULL) OR (lead_time_days_max >= lead_time_days_min))),
    CONSTRAINT master_services_min_order_amount_minor_check CHECK (((min_order_amount_minor IS NULL) OR (min_order_amount_minor >= 0))),
    CONSTRAINT master_services_min_order_qty_check CHECK ((min_order_qty > 0)),
    CONSTRAINT master_services_price_max_minor_check CHECK (((price_max_minor IS NULL) OR (price_max_minor >= 0))),
    CONSTRAINT master_services_price_min_minor_check CHECK (((price_min_minor IS NULL) OR (price_min_minor >= 0))),
    CONSTRAINT master_services_price_mode_check CHECK ((price_mode = ANY (ARRAY['fixed'::text, 'range'::text, 'per_gram'::text, 'per_cm3'::text, 'per_hour'::text]))),
    CONSTRAINT master_services_price_range CHECK (((price_min_minor IS NULL) OR (price_max_minor IS NULL) OR (price_max_minor >= price_min_minor))),
    CONSTRAINT master_services_technology_check CHECK ((technology = ANY (ARRAY['fdm'::text, 'sla'::text, 'sls'::text, 'laser'::text, 'cnc'::text]))),
    CONSTRAINT master_services_title_check CHECK (((length(title) >= 1) AND (length(title) <= 200)))
);


--
-- Name: TABLE master_services; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.master_services IS 'Каталог услуг мастера (MF-995): витринная карточка (цена/материал/срок) + задел под будущий
     инстант-квоут (MF-17/v3). Мастер = users-ряд с is_master (MF-399), отдельной таблицы masters нет.';


--
-- Name: material_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    source_url text,
    external_ref text NOT NULL,
    raw jsonb NOT NULL,
    content_hash bytea,
    matched_material_id uuid,
    confidence numeric(3,2),
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT material_candidates_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'matched'::text, 'merged'::text, 'rejected'::text, 'quarantined'::text])))
);


--
-- Name: material_make_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.material_make_stats AS
 SELECT mm.material_id,
    count(DISTINCT mk.id) AS make_count,
    count(DISTINCT mk.model_id) AS model_count
   FROM (public.make_materials mm
     JOIN public.makes mk ON ((mk.id = mm.make_id)))
  WHERE (mk.status = 'published'::text)
  GROUP BY mm.material_id;


--
-- Name: material_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    default_density_g_cm3 numeric(5,3),
    default_extruder_temp_min_c smallint,
    default_extruder_temp_max_c smallint,
    default_bed_temp_min_c smallint,
    default_bed_temp_max_c smallint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    default_extruder_temp_c smallint,
    default_bed_temp_c smallint,
    requires_chamber boolean DEFAULT false NOT NULL,
    requires_drying boolean DEFAULT false NOT NULL,
    requires_direct_drive boolean DEFAULT false NOT NULL,
    CONSTRAINT material_types_slug_check CHECK (((slug = lower(slug)) AND (length(slug) > 0)))
);


--
-- Name: material_variant_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_variant_offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_variant_id uuid NOT NULL,
    store_id text NOT NULL,
    price numeric(10,2),
    currency text DEFAULT 'RUB'::text NOT NULL,
    url text,
    in_stock boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: material_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    color_name text NOT NULL,
    color_hex text,
    diameter_mm numeric(4,2) NOT NULL,
    weight_g integer,
    spool_type text,
    sku text,
    specs jsonb DEFAULT '{}'::jsonb NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    confidence numeric(3,2),
    external_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT material_variants_color_hex_check CHECK ((color_hex ~ '^#[0-9a-f]{6}$'::text)),
    CONSTRAINT material_variants_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT material_variants_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'import'::text]))),
    CONSTRAINT material_variants_spool_type_check CHECK ((spool_type = ANY (ARRAY['plastic'::text, 'cardboard'::text, 'metal'::text, 'refillable'::text, 'none'::text])))
);


--
-- Name: materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    craft text DEFAULT '3d_printing'::text NOT NULL,
    kind text DEFAULT 'filament'::text NOT NULL,
    vendor_id uuid NOT NULL,
    material_type_id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    specs jsonb DEFAULT '{}'::jsonb NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT materials_kind_check CHECK ((kind = ANY (ARRAY['filament'::text, 'resin'::text, 'plywood'::text, 'aluminum'::text]))),
    CONSTRAINT materials_slug_check CHECK (((slug = lower(slug)) AND (length(slug) > 0))),
    CONSTRAINT materials_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'import'::text])))
);


--
-- Name: model_download_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_download_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    file_role text NOT NULL,
    user_id uuid NOT NULL,
    anon_id text,
    ip_hash bytea,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT model_download_log_file_role_check CHECK ((file_role = ANY (ARRAY['canonical_3mf'::text, 'cnc_program'::text, 'drawing'::text, 'gerber'::text, 'code_archive'::text, 'aux'::text, 'stl_derivative'::text])))
);


--
-- Name: model_embeddings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_embeddings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    embedding_model text NOT NULL,
    embedding_version text NOT NULL,
    dim smallint NOT NULL,
    embedding_1024 public.vector(1024),
    embedding_2048 public.halfvec(2048),
    text_sha256 bytea NOT NULL,
    index_status text DEFAULT 'ready'::text NOT NULL,
    source_generation bigint NOT NULL,
    indexed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT model_embeddings_dim_check CHECK ((dim = ANY (ARRAY[1024, 2048]))),
    CONSTRAINT model_embeddings_dim_column CHECK ((((dim = 1024) AND (embedding_1024 IS NOT NULL) AND (embedding_2048 IS NULL)) OR ((dim = 2048) AND (embedding_2048 IS NOT NULL) AND (embedding_1024 IS NULL)))),
    CONSTRAINT model_embeddings_index_status_check CHECK ((index_status = ANY (ARRAY['ready'::text, 'stale'::text])))
);


--
-- Name: model_make_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.model_make_stats AS
 SELECT mk.model_id,
    count(DISTINCT mk.id) AS makes_count,
    count(DISTINCT mk.machine_id) AS machines_count,
    count(DISTINCT mm.material_id) AS materials_count,
    avg(mk.printability_rating) AS avg_printability_rating,
    avg(mk.geometry_quality_rating) AS avg_geometry_quality_rating,
    avg(mk.surface_quality_rating) AS avg_surface_quality_rating
   FROM (public.makes mk
     LEFT JOIN public.make_materials mm ON ((mm.make_id = mk.id)))
  WHERE (mk.status = 'published'::text)
  GROUP BY mk.model_id;


--
-- Name: model_meshes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_meshes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    title text,
    source_format text NOT NULL,
    status text DEFAULT 'uploaded'::text NOT NULL,
    bbox jsonb,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT model_meshes_source_format_check CHECK ((source_format = ANY (ARRAY['stl'::text, 'step'::text, '3mf'::text, 'dxf'::text, 'svg'::text, 'obj'::text, 'gcode'::text, 'gerber'::text, 'zip'::text]))),
    CONSTRAINT model_meshes_status_check CHECK ((status = ANY (ARRAY['uploaded'::text, 'pending'::text, 'processing'::text, 'ready'::text, 'failed'::text])))
);


--
-- Name: model_printer_material_combo_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.model_printer_material_combo_stats AS
 SELECT mk.model_id,
    mk.machine_id,
    mm.material_id,
    count(*) AS combo_count
   FROM (public.makes mk
     JOIN public.make_materials mm ON ((mm.make_id = mk.id)))
  WHERE ((mk.status = 'published'::text) AND (mk.machine_id IS NOT NULL))
  GROUP BY mk.model_id, mk.machine_id, mm.material_id;


--
-- Name: model_revision_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_revision_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_revision_id uuid NOT NULL,
    role text NOT NULL,
    size_bytes bigint NOT NULL,
    checksum bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    original_filename text,
    mime_type text NOT NULL,
    blob_id uuid NOT NULL,
    is_source boolean NOT NULL,
    CONSTRAINT model_revision_files_checksum_check CHECK ((octet_length(checksum) = 32)),
    CONSTRAINT model_revision_files_role_check CHECK ((role = ANY (ARRAY['source'::text, 'canonical_3mf'::text, 'preview'::text, 'thumbnail'::text, 'cnc_program'::text, 'drawing'::text, 'gerber'::text, 'code_archive'::text, 'aux'::text, 'description_image'::text, 'mobile_preview'::text, 'project_doc'::text, 'stl_derivative'::text]))),
    CONSTRAINT model_revision_files_size_check CHECK ((size_bytes >= 0))
);


--
-- Name: model_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    source_format text NOT NULL,
    bbox jsonb,
    source_generation_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'uploaded'::text NOT NULL,
    craft text DEFAULT '3d_printing'::text NOT NULL,
    manufacturing_method text,
    requires_ams boolean DEFAULT false NOT NULL,
    source_checksum bytea NOT NULL,
    source_size_bytes bigint NOT NULL,
    failure_code text,
    failure_detail_safe text,
    processing_started_at timestamp with time zone,
    ready_at timestamp with time zone,
    failed_at timestamp with time zone,
    CONSTRAINT model_revisions_checksum_check CHECK ((octet_length(source_checksum) = 32)),
    CONSTRAINT model_revisions_craft_check CHECK ((craft = ANY (ARRAY['3d_printing'::text, 'cnc'::text, 'electronics'::text, 'software'::text]))),
    CONSTRAINT model_revisions_manufacturing_method_check CHECK (((manufacturing_method IS NULL) OR (manufacturing_method = ANY (ARRAY['fdm'::text, 'sla'::text, 'cnc'::text, 'laser'::text])))),
    CONSTRAINT model_revisions_size_check CHECK ((source_size_bytes >= 0)),
    CONSTRAINT model_revisions_status_check CHECK ((status = ANY (ARRAY['uploaded'::text, 'pending'::text, 'processing'::text, 'ready'::text, 'failed'::text]))),
    CONSTRAINT model_revisions_terminal_timestamps_check CHECK ((((status = 'ready'::text) AND (ready_at IS NOT NULL) AND (failed_at IS NULL)) OR ((status = 'failed'::text) AND (failed_at IS NOT NULL) AND (ready_at IS NULL)) OR ((status = ANY (ARRAY['uploaded'::text, 'pending'::text, 'processing'::text])) AND (ready_at IS NULL) AND (failed_at IS NULL))))
);


--
-- Name: TABLE model_revisions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.model_revisions IS 'Immutable Model source/processing revisions. Status belongs to the revision; Models hold latest/active pointers.';


--
-- Name: model_view_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_view_log (
    model_id uuid NOT NULL,
    user_id uuid NOT NULL,
    viewed_on date DEFAULT CURRENT_DATE NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: model_votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_votes (
    model_id uuid NOT NULL,
    user_id uuid NOT NULL,
    value smallint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT model_votes_value_check CHECK ((value = ANY (ARRAY['-1'::integer, 1])))
);


--
-- Name: models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.models (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    name text NOT NULL,
    "position" integer NOT NULL,
    latest_revision_id uuid NOT NULL,
    active_revision_id uuid,
    version bigint DEFAULT 1 NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT models_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120))),
    CONSTRAINT models_position_check CHECK (("position" >= 0)),
    CONSTRAINT models_version_check CHECK ((version > 0))
);


--
-- Name: TABLE models; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.models IS 'Child Model (geometry/processing) of a Project. Project/Model split task 6.2. One or more immutable model_revisions per model; project-level metadata lives on projects.';


--
-- Name: moderation_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moderation_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope text NOT NULL,
    actor_role text NOT NULL,
    actor_user_id uuid NOT NULL,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    reason_code text NOT NULL,
    reason text,
    reverses_action_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'applied'::text NOT NULL,
    reversed_at timestamp with time zone,
    reversed_by uuid,
    reversal_reason text,
    CONSTRAINT moderation_actions_action_check CHECK ((action = ANY (ARRAY['flag'::text, 'hide'::text, 'restore'::text, 'lock_thread'::text, 'dismiss_flag'::text, 'appeal'::text, 'resolve_appeal'::text]))),
    CONSTRAINT moderation_actions_actor_role_check CHECK ((actor_role = ANY (ARRAY['community'::text, 'moderator'::text, 'admin'::text]))),
    CONSTRAINT moderation_actions_check CHECK (((reverses_action_id IS NULL) OR (reverses_action_id <> id))),
    CONSTRAINT moderation_actions_check1 CHECK (((action = ANY (ARRAY['flag'::text, 'appeal'::text])) OR (reason IS NOT NULL))),
    CONSTRAINT moderation_actions_reason_code_check CHECK ((reason_code = ANY (ARRAY['illegal'::text, 'copyright'::text, 'spam'::text, 'harassment'::text, 'other'::text]))),
    CONSTRAINT moderation_actions_reversal_fields_check CHECK ((((status = 'applied'::text) AND (reversed_at IS NULL) AND (reversed_by IS NULL) AND (reversal_reason IS NULL)) OR ((status = 'reversed'::text) AND (reversed_at IS NOT NULL) AND (reversed_by IS NOT NULL) AND (btrim(reversal_reason) <> ''::text)))),
    CONSTRAINT moderation_actions_scope_check CHECK ((scope = ANY (ARRAY['community'::text, 'moderator'::text, 'admin'::text]))),
    CONSTRAINT moderation_actions_status_check CHECK ((status = ANY (ARRAY['applied'::text, 'reversed'::text]))),
    CONSTRAINT moderation_actions_target_type_check CHECK ((target_type = ANY (ARRAY['post'::text, 'thread'::text])))
);


--
-- Name: order_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    from_status text,
    to_status text NOT NULL,
    actor_id uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    master_id uuid NOT NULL,
    client_id uuid NOT NULL,
    model_id uuid,
    status text DEFAULT 'draft'::text NOT NULL,
    quote_amount_minor bigint,
    currency text DEFAULT 'RUB'::text NOT NULL,
    quote_expires_at timestamp with time zone,
    accept_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    lat double precision,
    lng double precision,
    CONSTRAINT orders_lat_lng_pair_check CHECK (((lat IS NULL) = (lng IS NULL))),
    CONSTRAINT orders_lat_range_check CHECK (((lat IS NULL) OR ((lat >= ('-90'::integer)::double precision) AND (lat <= (90)::double precision)))),
    CONSTRAINT orders_lng_range_check CHECK (((lng IS NULL) OR ((lng >= ('-180'::integer)::double precision) AND (lng <= (180)::double precision)))),
    CONSTRAINT orders_quote_amount_minor_check CHECK (((quote_amount_minor IS NULL) OR (quote_amount_minor >= 0))),
    CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'quote_requested'::text, 'quoted'::text, 'accepted'::text, 'paid'::text, 'in_production'::text, 'printed'::text, 'shipped'::text, 'ready_for_pickup'::text, 'completed'::text, 'rated'::text, 'cancelled'::text, 'disputed'::text, 'expired'::text])))
);


--
-- Name: organization_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_members (
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    added_by uuid,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_members_role_check CHECK ((role = ANY (ARRAY['head'::text, 'member'::text])))
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organizations_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT organizations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text])))
);


--
-- Name: outbox_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    event_type text NOT NULL,
    event_version integer NOT NULL,
    payload jsonb NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    completed_at timestamp with time zone,
    last_error_safe text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outbox_events_aggregate_type_check CHECK (((char_length(aggregate_type) >= 1) AND (char_length(aggregate_type) <= 100))),
    CONSTRAINT outbox_events_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT outbox_events_event_type_check CHECK (((char_length(event_type) >= 1) AND (char_length(event_type) <= 150))),
    CONSTRAINT outbox_events_event_version_check CHECK ((event_version > 0)),
    CONSTRAINT outbox_events_lock_pair_check CHECK (((locked_at IS NULL) = (locked_by IS NULL))),
    CONSTRAINT outbox_events_payload_object_check CHECK ((jsonb_typeof(payload) = 'object'::text))
);


--
-- Name: payment_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    event_id text NOT NULL,
    purchase_id uuid,
    event_type text,
    payload jsonb,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE payment_webhook_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payment_webhook_events IS 'Идемпотентность вебхуков провайдера оплаты (MF-1023). Уникальность (provider, event_id) —
   единственный источник дедупликации повторных доставок вебхука, обработчик обязан
   ON CONFLICT DO NOTHING перед изменением purchases/ledger_entries.';


--
-- Name: payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    amount_minor bigint NOT NULL,
    currency text DEFAULT 'RUB'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    requisites jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    CONSTRAINT payouts_amount_minor_check CHECK ((amount_minor > 0)),
    CONSTRAINT payouts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'paid'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: TABLE payouts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payouts IS 'Заявка/факт выплаты автору (MF-363). Реквизиты в requisites jsonb — не хранить незашифрованные
   платёжные данные без ревью SECURITY.md.';


--
-- Name: post_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    kind text NOT NULL,
    s3_key text NOT NULL,
    size_bytes bigint NOT NULL,
    checksum bytea NOT NULL,
    original_filename text,
    mime_type text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT post_attachments_kind_check CHECK ((kind = ANY (ARRAY['photo'::text, 'model_3mf'::text])))
);


--
-- Name: post_score; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_score (
    post_id uuid NOT NULL,
    hot double precision DEFAULT 0 NOT NULL,
    best double precision DEFAULT 0 NOT NULL,
    controversial double precision DEFAULT 0 NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    author_id uuid NOT NULL,
    parent_post_id uuid,
    kind text NOT NULL,
    content text NOT NULL,
    status text DEFAULT 'visible'::text NOT NULL,
    votes_up integer DEFAULT 0 NOT NULL,
    votes_down integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT posts_kind_check CHECK ((kind = ANY (ARRAY['answer'::text, 'reply'::text, 'comment'::text]))),
    CONSTRAINT posts_status_check CHECK ((status = ANY (ARRAY['visible'::text, 'hidden'::text, 'deleted'::text])))
);


--
-- Name: print_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.print_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    master_id uuid NOT NULL,
    client_id uuid NOT NULL,
    model_id uuid,
    model_file_id uuid,
    material_id uuid,
    material_variant_id uuid,
    quantity integer DEFAULT 1 NOT NULL,
    due_date date,
    client_note text,
    master_note text,
    status text DEFAULT 'new'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT print_requests_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT print_requests_status_check CHECK ((status = ANY (ARRAY['new'::text, 'discussion'::text, 'in_work'::text, 'done'::text, 'rejected'::text])))
);


--
-- Name: printer_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.printer_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    api_key_enc bytea NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    last_error text,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT printer_connections_provider_check CHECK ((provider = 'prusa_connect'::text)),
    CONSTRAINT printer_connections_status_check CHECK ((status = ANY (ARRAY['active'::text, 'error'::text])))
);


--
-- Name: printer_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.printer_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    printer_id uuid NOT NULL,
    field text NOT NULL,
    note text,
    proposed_value jsonb,
    reporters uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    votes integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    source text DEFAULT 'community'::text NOT NULL,
    confidence text DEFAULT 'low'::text NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT printer_reports_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: printers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.printers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    brand text NOT NULL,
    model text NOT NULL,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    released_at date,
    status text DEFAULT 'announced'::text NOT NULL,
    kinematics text,
    type text,
    enclosed boolean,
    build_volume_x numeric,
    build_volume_y numeric,
    build_volume_z numeric,
    hotend_max_temp_c numeric,
    hotend_max_flow_mm3s numeric,
    hotend_hardened boolean,
    bed_max_temp_c numeric,
    bed_auto_leveling text,
    multimaterial_supported boolean DEFAULT false NOT NULL,
    has_laser boolean DEFAULT false NOT NULL,
    has_cnc boolean DEFAULT false NOT NULL,
    nozzle_swappable boolean,
    moonraker boolean,
    lan_mode boolean,
    price_msrp_usd numeric,
    price_ru_rub numeric,
    price_ru_updated_at date,
    specs jsonb DEFAULT '{}'::jsonb NOT NULL,
    media jsonb DEFAULT '{}'::jsonb NOT NULL,
    sources text[] DEFAULT '{}'::text[] NOT NULL,
    field_provenance jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence text,
    filled_by text,
    reviewed_by text,
    gaps text[] DEFAULT '{}'::text[] NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    schema_version text DEFAULT '1.0'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    support_level text DEFAULT 'list'::text NOT NULL,
    firmware_ready boolean DEFAULT false NOT NULL,
    firmware_public boolean DEFAULT false NOT NULL,
    connector_type text,
    firmware_repo text,
    canonical_config_fingerprint text,
    pilot_status jsonb,
    CONSTRAINT printers_confidence_check CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT printers_connector_type_check CHECK ((connector_type = ANY (ARRAY['moonraker'::text, 'bambu-mqtt'::text, 'prusa-link'::text, 'octoprint'::text, 'vendor-cloud'::text, 'none'::text]))),
    CONSTRAINT printers_kinematics_check CHECK ((kinematics = ANY (ARRAY['cartesian'::text, 'corexy'::text, 'delta'::text, 'scara'::text, 'idex'::text, 'polar'::text, 'belt'::text]))),
    CONSTRAINT printers_status_check CHECK ((status = ANY (ARRAY['announced'::text, 'shipping'::text, 'eol'::text, 'rumored'::text]))),
    CONSTRAINT printers_support_level_check CHECK ((support_level = ANY (ARRAY['list'::text, 'managed'::text, 'custom'::text]))),
    CONSTRAINT printers_type_check CHECK ((type = ANY (ARRAY['fdm'::text, 'resin-lcd'::text, 'resin-dlp'::text, 'resin-sla'::text])))
);


--
-- Name: COLUMN printers.support_level; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.printers.support_level IS 'Уровень поддержки (printer.support.md): list — только каталог (дефолт); managed — управление без смены прошивки; custom — наша прошивка (флагман).';


--
-- Name: COLUMN printers.firmware_ready; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.printers.firmware_ready IS 'Оператор собрал и испытал кастом-образ на этой модели. До true плитка custom в мастере заблокирована «скоро», даже если support_level уже custom.';


--
-- Name: COLUMN printers.firmware_public; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.printers.firmware_public IS 'Публичный релиз прошивки (открытая скачка вместо «доступ по запросу»). Пока всегда false — на старте прошивка приватная (printer.support.md).';


--
-- Name: COLUMN printers.connector_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.printers.connector_type IS 'Протокол managed-подключения, гейтит плитки мастера. none — подтверждённо нет открытого локального/облачного API (напр. Marlin). null — ещё не классифицирован.';


--
-- Name: COLUMN printers.firmware_repo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.printers.firmware_repo IS 'GitVerse-URL репозитория образа/конфигов кастом-прошивки. Даёт ОПЕРАТОР вручную — агенты образ не собирают, карточка модели только ссылается (printer.support.md).';


--
-- Name: COLUMN printers.pilot_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.printers.pilot_status IS 'Обезличенный Fleet-факт firmware-pilot.v1 для точной модели; null означает отсутствие подтвержденных данных.';


--
-- Name: project_manifest_resolutions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_manifest_resolutions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    commit_sha text NOT NULL,
    configuration_id text NOT NULL,
    configuration_digest bytea NOT NULL,
    manifest_digest bytea NOT NULL,
    bom jsonb DEFAULT '[]'::jsonb NOT NULL,
    scenes jsonb DEFAULT '{}'::jsonb NOT NULL,
    connections jsonb DEFAULT '{}'::jsonb NOT NULL,
    workflow jsonb DEFAULT '{}'::jsonb NOT NULL,
    requirements jsonb DEFAULT '{}'::jsonb NOT NULL,
    resolved_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_manifest_resolutions_commit_sha_check CHECK (((commit_sha ~ '^[0-9a-f]{40}$'::text) OR (commit_sha ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT project_manifest_resolutions_configuration_digest_check CHECK ((octet_length(configuration_digest) = 32)),
    CONSTRAINT project_manifest_resolutions_configuration_id_check CHECK ((configuration_id ~ '^[a-z0-9][a-z0-9.-]{0,63}$'::text)),
    CONSTRAINT project_manifest_resolutions_manifest_digest_check CHECK ((octet_length(manifest_digest) = 32))
);


--
-- Name: TABLE project_manifest_resolutions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.project_manifest_resolutions IS 'Append-only Git manifest resolution cache. It is not a Project publication snapshot.';


--
-- Name: project_revision_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_revision_models (
    project_revision_id uuid NOT NULL,
    project_id uuid NOT NULL,
    model_id uuid NOT NULL,
    model_revision_id uuid NOT NULL,
    "position" integer NOT NULL,
    CONSTRAINT project_revision_models_position_check CHECK (("position" >= 0))
);


--
-- Name: project_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    content_hash bytea NOT NULL,
    primary_model_id uuid NOT NULL,
    metadata_snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_revisions_content_hash_check CHECK ((octet_length(content_hash) = 32)),
    CONSTRAINT project_revisions_metadata_object_check CHECK ((jsonb_typeof(metadata_snapshot) = 'object'::text))
);


--
-- Name: TABLE project_revisions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.project_revisions IS 'Immutable Project publication snapshots. Public reads resolve through projects.published_revision_id.';


--
-- Name: purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    buyer_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    price_minor bigint NOT NULL,
    platform_fee_minor bigint NOT NULL,
    seller_amount_minor bigint NOT NULL,
    currency text DEFAULT 'RUB'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone,
    provider text,
    provider_payment_id text,
    cancelled_at timestamp with time zone,
    failed_at timestamp with time zone,
    CONSTRAINT purchases_buyer_not_seller CHECK ((buyer_id <> seller_id)),
    CONSTRAINT purchases_platform_fee_minor_check CHECK ((platform_fee_minor >= 0)),
    CONSTRAINT purchases_price_minor_check CHECK ((price_minor > 0)),
    CONSTRAINT purchases_seller_amount_minor_check CHECK ((seller_amount_minor >= 0)),
    CONSTRAINT purchases_split_matches_price CHECK (((platform_fee_minor + seller_amount_minor) = price_minor)),
    CONSTRAINT purchases_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'refunded'::text, 'cancelled'::text])))
);


--
-- Name: TABLE purchases; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.purchases IS 'Покупка платной модели (MF-363). Один buyer×model может иметь много строк (failed/refunded
   ретраи), но не более одной status=paid — см. purchases_buyer_model_paid_uidx.';


--
-- Name: COLUMN purchases.provider; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchases.provider IS 'Платёжный провайдер, обработавший покупку (напр. yookassa). Null, пока платёж не создан у провайдера.';


--
-- Name: COLUMN purchases.provider_payment_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchases.provider_payment_id IS 'ID платежа/операции у провайдера — по нему вебхук находит purchase (MF-1023/MF-364).';


--
-- Name: push_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_preferences (
    user_id uuid NOT NULL,
    type text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT push_preferences_type_check CHECK ((type = ANY (ARRAY['remix'::text, 'like'::text, 'sale'::text, 'comment'::text, 'printer_status'::text, 'new_order'::text])))
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth_key text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL
);


--
-- Name: release_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.release_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    machine_id uuid,
    vendor_id uuid,
    model_name text NOT NULL,
    status text NOT NULL,
    announced_at date,
    preorder_at date,
    ship_at date,
    eol_at date,
    source_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT release_events_status_check CHECK ((status = ANY (ARRAY['announced'::text, 'preorder'::text, 'shipping'::text, 'eol'::text])))
);


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    reporter_id uuid NOT NULL,
    reason text,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    decision text,
    CONSTRAINT reports_decision_check CHECK ((decision = ANY (ARRAY['accepted'::text, 'rejected'::text]))),
    CONSTRAINT reports_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text]))),
    CONSTRAINT reports_subject_type_check CHECK ((subject_type = ANY (ARRAY['make'::text, 'model'::text])))
);


--
-- Name: reputation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reputation_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    points integer NOT NULL,
    reason text NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reputation_events_reason_check CHECK ((reason = ANY (ARRAY['post_upvoted'::text, 'question_upvoted'::text, 'post_downvoted'::text, 'answer_accepted'::text, 'daily_cap_reached'::text]))),
    CONSTRAINT reputation_events_subject_type_check CHECK ((subject_type = ANY (ARRAY['post'::text, 'thread'::text])))
);


--
-- Name: search_index_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.search_index_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    embedding_model text NOT NULL,
    embedding_version text NOT NULL,
    dim smallint NOT NULL,
    text_sha256 bytea NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    generation bigint DEFAULT 1 NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    leased_by text,
    leased_until timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    CONSTRAINT search_index_jobs_dim_check CHECK ((dim = ANY (ARRAY[1024, 2048]))),
    CONSTRAINT search_index_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'failed'::text])))
);


--
-- Name: COLUMN search_index_jobs.correlation_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.search_index_jobs.correlation_id IS 'Request/operation correlation propagated by the QueuePort producer; replaced only when a job is actually re-enqueued.';


--
-- Name: slice_cache_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slice_cache_entries (
    account_id uuid NOT NULL,
    slice_key bytea NOT NULL,
    gcode_s3_key text NOT NULL,
    size_bytes bigint NOT NULL,
    slicer_engine_version text NOT NULL,
    metrics jsonb,
    first_slice_job_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone DEFAULT now() NOT NULL,
    hit_count bigint DEFAULT 0 NOT NULL,
    slice_trust_material jsonb,
    slice_trust_contract_version text,
    slice_trust_key_id text,
    slice_trust_signature text
);


--
-- Name: slice_cache_hits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slice_cache_hits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    slice_key bytea NOT NULL,
    user_id uuid NOT NULL,
    model_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: slice_job_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slice_job_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slice_job_id uuid NOT NULL,
    attempt_number integer NOT NULL,
    status text NOT NULL,
    error text,
    error_code text,
    metrics jsonb,
    gcode_s3_key text,
    slice_trust_material jsonb,
    slice_trust_contract_version text,
    slice_trust_key_id text,
    slice_trust_signature text,
    preview_manifest_s3_key text,
    retryable boolean,
    attempted_at timestamp with time zone NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE slice_job_attempts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.slice_job_attempts IS 'Append-only архив прежних terminal (failed) состояний slice_jobs-строки, записанный атомарно ПЕРЕД тем, как безопасный retry (MF-1995) переочередит ту же строку под новую попытку с тем же account/slice_key/requested_by/model_id identity.';


--
-- Name: slice_job_plate_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slice_job_plate_instances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slice_job_id uuid NOT NULL,
    instance_id text NOT NULL,
    source_model_id uuid NOT NULL,
    source_revision text NOT NULL,
    source_configuration_id text NOT NULL,
    source_configuration_digest bytea NOT NULL,
    source_workflow_step_id text NOT NULL,
    source_artifact_id text NOT NULL,
    source_artifact_sha256 bytea NOT NULL,
    source_build_session_id uuid,
    staged_object_key text,
    x_mm numeric(10,3) NOT NULL,
    y_mm numeric(10,3) NOT NULL,
    rotation_z_deg numeric(6,2) DEFAULT 0 NOT NULL,
    scale numeric(10,6) DEFAULT 1.0 NOT NULL,
    preflight_ok boolean DEFAULT true NOT NULL,
    preflight_codes text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT slice_job_plate_instances_instance_id_check CHECK ((instance_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$'::text)),
    CONSTRAINT slice_job_plate_instances_scale_check CHECK ((scale > (0)::numeric)),
    CONSTRAINT slice_job_plate_instances_source_artifact_id_check CHECK ((source_artifact_id ~ '^[a-z0-9][a-z0-9.-]{0,63}$'::text)),
    CONSTRAINT slice_job_plate_instances_source_artifact_sha256_check CHECK ((octet_length(source_artifact_sha256) = 32)),
    CONSTRAINT slice_job_plate_instances_source_configuration_digest_check CHECK ((octet_length(source_configuration_digest) = 32)),
    CONSTRAINT slice_job_plate_instances_source_configuration_id_check CHECK ((source_configuration_id ~ '^[a-z0-9][a-z0-9.-]{0,63}$'::text)),
    CONSTRAINT slice_job_plate_instances_source_revision_check CHECK (((source_revision ~ '^[0-9a-f]{40}$'::text) OR (source_revision ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT slice_job_plate_instances_source_workflow_step_id_check CHECK ((source_workflow_step_id ~ '^[a-z0-9][a-z0-9.-]{0,63}$'::text))
);


--
-- Name: TABLE slice_job_plate_instances; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.slice_job_plate_instances IS 'Per-instance pinned project-as-code source + transform + preflight результат одной плиты (MF-1986, project-slice-request.v1). Одна строка на PlateInstance; g-code job считается по ВСЕМ строкам сразу (layout_digest), не по одной. staged_object_key — internal object storage ключ, который читает Mesh; client-URL сюда никогда не попадает.';


--
-- Name: slice_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slice_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    gcode_s3_key text,
    metrics jsonb,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    slice_key bytea,
    filament_profile_id uuid,
    scale numeric(10,6) DEFAULT 1.0 NOT NULL,
    requested_by uuid,
    slice_trust_material jsonb,
    slice_trust_key_id text,
    slice_trust_signature text,
    account_id uuid,
    device_id uuid,
    slice_trust_contract_version text,
    layout_snapshot_id text,
    layout jsonb,
    intent jsonb,
    preflight jsonb,
    error_code text,
    retryable boolean DEFAULT true NOT NULL,
    preview_manifest_s3_key text,
    attempt_count integer DEFAULT 1 NOT NULL,
    CONSTRAINT slice_jobs_layout_snapshot_id_check CHECK ((layout_snapshot_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$'::text)),
    CONSTRAINT slice_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'ready'::text, 'failed'::text]))),
    CONSTRAINT slice_jobs_trust_contract_version_check CHECK (((slice_trust_contract_version IS NULL) OR (slice_trust_contract_version = 'slice-trust.v1'::text)))
);


--
-- Name: slice_reputation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slice_reputation (
    user_id uuid NOT NULL,
    slice_key bytea NOT NULL,
    successful_prints bigint DEFAULT 0 NOT NULL,
    failed_prints bigint DEFAULT 0 NOT NULL,
    last_outcome text,
    last_result_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT slice_reputation_failed_prints_check CHECK ((failed_prints >= 0)),
    CONSTRAINT slice_reputation_last_outcome_check CHECK ((last_outcome = ANY (ARRAY['succeeded'::text, 'failed'::text]))),
    CONSTRAINT slice_reputation_successful_prints_check CHECK ((successful_prints >= 0))
);


--
-- Name: slicer_profile_calibrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slicer_profile_calibrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slicer_profile_id uuid NOT NULL,
    machine_id uuid NOT NULL,
    material_id uuid NOT NULL,
    model_id uuid,
    make_id uuid,
    user_id uuid NOT NULL,
    flow_ratio numeric(5,3),
    pressure_advance numeric(6,4),
    outcome text NOT NULL,
    defect_type text,
    photo_s3_key text,
    notes text,
    source text DEFAULT 'manual'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT slicer_profile_calibrations_defect_type_check CHECK (((defect_type IS NULL) OR (defect_type = ANY (ARRAY['warping'::text, 'stringing'::text, 'layer_shift'::text, 'adhesion'::text, 'under_extrusion'::text, 'over_extrusion'::text, 'other'::text])))),
    CONSTRAINT slicer_profile_calibrations_defect_type_requires_defect CHECK (((outcome = 'defect'::text) OR (defect_type IS NULL))),
    CONSTRAINT slicer_profile_calibrations_flow_ratio_check CHECK (((flow_ratio IS NULL) OR (flow_ratio > (0)::numeric))),
    CONSTRAINT slicer_profile_calibrations_outcome_check CHECK ((outcome = ANY (ARRAY['success'::text, 'defect'::text]))),
    CONSTRAINT slicer_profile_calibrations_pressure_advance_check CHECK (((pressure_advance IS NULL) OR (pressure_advance >= (0)::numeric))),
    CONSTRAINT slicer_profile_calibrations_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'telemetry'::text])))
);


--
-- Name: slicer_profile_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slicer_profile_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    source_url text,
    external_ref text NOT NULL,
    raw jsonb NOT NULL,
    content_hash bytea,
    matched_profile_id uuid,
    confidence numeric(3,2),
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT slicer_profile_candidates_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'matched'::text, 'merged'::text, 'rejected'::text, 'quarantined'::text])))
);


--
-- Name: slicer_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slicer_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_class text NOT NULL,
    slicer text NOT NULL,
    setting_id text,
    name text NOT NULL,
    inherits_id uuid,
    vendor_id uuid,
    machine_id uuid,
    material_id uuid,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_name text NOT NULL,
    source_url text,
    source_ref text,
    license text NOT NULL,
    confidence numeric(3,2) DEFAULT 1.0 NOT NULL,
    extrapolated_from_id uuid,
    extrapolation_reason text,
    schema_version integer DEFAULT 1 NOT NULL,
    content_hash bytea,
    bundle_s3_key text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT slicer_profiles_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT slicer_profiles_no_self_extrapolate CHECK (((extrapolated_from_id IS NULL) OR (extrapolated_from_id <> id))),
    CONSTRAINT slicer_profiles_no_self_inherit CHECK (((inherits_id IS NULL) OR (inherits_id <> id))),
    CONSTRAINT slicer_profiles_profile_class_check CHECK ((profile_class = ANY (ARRAY['machine'::text, 'process'::text, 'filament'::text]))),
    CONSTRAINT slicer_profiles_slicer_check CHECK ((slicer = ANY (ARRAY['orcaslicer'::text, 'prusaslicer'::text, 'cura'::text]))),
    CONSTRAINT slicer_profiles_status_check CHECK ((status = ANY (ARRAY['active'::text, 'quarantined'::text, 'archived'::text])))
);


--
-- Name: storage_blobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_blobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    checksum bytea NOT NULL,
    size_bytes bigint NOT NULL,
    s3_key text NOT NULL,
    state text DEFAULT 'uploading'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT storage_blobs_size_bytes_check CHECK ((size_bytes >= 0)),
    CONSTRAINT storage_blobs_state_check CHECK ((state = ANY (ARRAY['uploading'::text, 'ready'::text, 'failed'::text])))
);


--
-- Name: taggings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.taggings (
    tag_id uuid NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT taggings_subject_type_check CHECK ((subject_type = ANY (ARRAY['thread'::text, 'community'::text])))
);


--
-- Name: threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    community_id uuid NOT NULL,
    author_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    pinned boolean DEFAULT false NOT NULL,
    accepted_post_id uuid,
    votes_up integer DEFAULT 0 NOT NULL,
    votes_down integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT threads_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text, 'locked'::text]))),
    CONSTRAINT threads_type_check CHECK ((type = ANY (ARRAY['discussion'::text, 'question'::text])))
);


--
-- Name: uploader_reputation_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uploader_reputation_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    report_id uuid NOT NULL,
    staff_actor_id uuid NOT NULL,
    delta integer NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT uploader_reputation_ledger_delta_check CHECK ((delta <> 0))
);


--
-- Name: user_achievements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_achievements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    achievement_id uuid NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_activation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_activation (
    user_id uuid NOT NULL,
    state text DEFAULT 'first_run'::text NOT NULL,
    has_printer boolean DEFAULT false NOT NULL,
    first_run_completed_at timestamp with time zone,
    primary_persona text,
    persona_source text,
    home_tier text DEFAULT 'auto'::text NOT NULL,
    sessions_seen integer DEFAULT 0 NOT NULL,
    activation_checklist jsonb DEFAULT '{}'::jsonb NOT NULL,
    home_dismissed_prompts jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_activation_home_tier_check CHECK ((home_tier = ANY (ARRAY['auto'::text, 'home'::text, 'farm'::text, 'business'::text]))),
    CONSTRAINT user_activation_persona_source_check CHECK ((persona_source = ANY (ARRAY['declared'::text, 'inferred'::text]))),
    CONSTRAINT user_activation_primary_persona_check CHECK ((primary_persona = ANY (ARRAY['novice'::text, 'maker'::text, 'author'::text, 'builder'::text, 'pro'::text]))),
    CONSTRAINT user_activation_state_check CHECK ((state = ANY (ARRAY['first_run'::text, 'returning'::text])))
);


--
-- Name: user_api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    scope text NOT NULL,
    provider text,
    label text,
    key_prefix text NOT NULL,
    key_hash bytea,
    secret_enc bytea,
    status text DEFAULT 'active'::text NOT NULL,
    rate_limit_per_min integer,
    rotated_from_id uuid,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    scopes text[] DEFAULT ARRAY['read'::text] NOT NULL,
    expires_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_reason text,
    agent_id uuid,
    CONSTRAINT user_api_keys_agent_id_scope_check CHECK ((((scope = 'agent_content'::text) AND (agent_id IS NOT NULL)) OR ((scope <> 'agent_content'::text) AND (agent_id IS NULL)))),
    CONSTRAINT user_api_keys_expires_after_created_check CHECK (((expires_at IS NULL) OR (expires_at > created_at))),
    CONSTRAINT user_api_keys_key_prefix_check CHECK ((btrim(key_prefix) <> ''::text)),
    CONSTRAINT user_api_keys_provider_scope_check CHECK ((((scope = 'printer'::text) AND (provider IS NOT NULL)) OR ((scope = ANY (ARRAY['slicing'::text, 'public_api'::text, 'research'::text, 'feed_ingest'::text, 'agent_content'::text])) AND (provider IS NULL)))),
    CONSTRAINT user_api_keys_revoked_after_created_check CHECK (((revoked_at IS NULL) OR (revoked_at >= created_at))),
    CONSTRAINT user_api_keys_scope_check CHECK ((scope = ANY (ARRAY['slicing'::text, 'printer'::text, 'public_api'::text, 'research'::text, 'feed_ingest'::text, 'agent_content'::text]))),
    CONSTRAINT user_api_keys_scopes_check CHECK ((((scope = ANY (ARRAY['research'::text, 'feed_ingest'::text, 'agent_content'::text])) AND (scopes = ARRAY['write'::text])) OR ((scope <> ALL (ARRAY['research'::text, 'feed_ingest'::text, 'agent_content'::text])) AND (scopes <@ ARRAY['read'::text, 'control'::text]) AND (COALESCE(array_length(scopes, 1), 0) > 0)))),
    CONSTRAINT user_api_keys_secret_shape_check CHECK ((((scope = 'printer'::text) AND (secret_enc IS NOT NULL) AND (key_hash IS NULL)) OR ((scope = ANY (ARRAY['slicing'::text, 'public_api'::text, 'research'::text, 'feed_ingest'::text, 'agent_content'::text])) AND (key_hash IS NOT NULL) AND (secret_enc IS NULL)))),
    CONSTRAINT user_api_keys_status_check CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text])))
);


--
-- Name: COLUMN user_api_keys.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_api_keys.user_id IS 'Владелец ключа (owner); внешний API не раскрывает чужие ключи.';


--
-- Name: COLUMN user_api_keys.key_prefix; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_api_keys.key_prefix IS 'Публичный идентификатор ключа для списка; секретом не является.';


--
-- Name: COLUMN user_api_keys.key_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_api_keys.key_hash IS 'SHA-256 секрета; plaintext ключа сохраняется только в ответе на создание.';


--
-- Name: COLUMN user_api_keys.scopes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_api_keys.scopes IS 'Разрешения ключа: read/control для существующих API-контуров; write только для research/feed_ingest.';


--
-- Name: user_avatar; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_avatar (
    user_id uuid NOT NULL,
    config jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    snapshot_left_s3_key text,
    snapshot_right_s3_key text,
    snapshot_front_s3_key text,
    revision bigint DEFAULT 1 NOT NULL,
    snapshot_left_sha256 text,
    snapshot_right_sha256 text,
    snapshot_front_sha256 text,
    CONSTRAINT user_avatar_revision_positive_check CHECK ((revision > 0)),
    CONSTRAINT user_avatar_snapshot_front_sha256_check CHECK (((snapshot_front_sha256 IS NULL) OR (snapshot_front_sha256 ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT user_avatar_snapshot_left_sha256_check CHECK (((snapshot_left_sha256 IS NULL) OR (snapshot_left_sha256 ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT user_avatar_snapshot_right_sha256_check CHECK (((snapshot_right_sha256 IS NULL) OR (snapshot_right_sha256 ~ '^[0-9a-f]{64}$'::text)))
);


--
-- Name: user_filaments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_filaments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    material_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    variant_id uuid,
    note text
);


--
-- Name: user_follows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_follows (
    follower_id uuid NOT NULL,
    followee_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_follows_no_self_follow CHECK ((follower_id <> followee_id))
);


--
-- Name: TABLE user_follows; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_follows IS 'Подписки на мастера (follower-feed, MF-993): follower_id видит новые Make followee_id в своём фиде.';


--
-- Name: user_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    identifier_hash bytea NOT NULL,
    s3_key text NOT NULL,
    verified_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_identities_provider_check CHECK ((provider = ANY (ARRAY['email_corp'::text, 'plag_id'::text, 'giga_id'::text])))
);


--
-- Name: user_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    material_id uuid NOT NULL,
    variant_id uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_password_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_password_credentials (
    user_id uuid NOT NULL,
    password_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_password_credentials_hash_nonempty_check CHECK ((btrim(password_hash) <> ''::text))
);


--
-- Name: TABLE user_password_credentials; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_password_credentials IS 'Private local-password credentials. Bootstrap admin provisioning owns writes; password hashes are never exposed through identity_read_v1.';


--
-- Name: user_uploader_reputation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_uploader_reputation (
    user_id uuid NOT NULL,
    successful_contributions bigint DEFAULT 0 NOT NULL,
    failed_contributions bigint DEFAULT 0 NOT NULL,
    last_outcome text,
    last_model_id uuid,
    last_result_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_uploader_reputation_failed_contributions_check CHECK ((failed_contributions >= 0)),
    CONSTRAINT user_uploader_reputation_last_outcome_check CHECK ((last_outcome = ANY (ARRAY['succeeded'::text, 'failed'::text]))),
    CONSTRAINT user_uploader_reputation_successful_contributions_check CHECK ((successful_contributions >= 0))
);


--
-- Name: vendor_claim_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_claim_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    claim_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    action text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vendor_claim_events_action_check CHECK ((action = ANY (ARRAY['submitted'::text, 'verified'::text, 'revoked'::text])))
);


--
-- Name: vendor_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    claimant_user_id uuid NOT NULL,
    organization_name text NOT NULL,
    evidence_url text,
    evidence_note text,
    status text DEFAULT 'pending'::text NOT NULL,
    organization_id uuid,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    review_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vendor_claims_evidence_check CHECK ((((evidence_url IS NOT NULL) AND (length(TRIM(BOTH FROM evidence_url)) > 0)) OR ((evidence_note IS NOT NULL) AND (length(TRIM(BOTH FROM evidence_note)) > 0)))),
    CONSTRAINT vendor_claims_organization_id_check CHECK ((((status = 'pending'::text) AND (organization_id IS NULL)) OR (status <> 'pending'::text))),
    CONSTRAINT vendor_claims_organization_id_verified_check CHECK ((((status = 'verified'::text) AND (organization_id IS NOT NULL)) OR (status <> 'verified'::text))),
    CONSTRAINT vendor_claims_organization_name_check CHECK ((length(TRIM(BOTH FROM organization_name)) > 0)),
    CONSTRAINT vendor_claims_reviewed_consistency_check CHECK ((((status = 'pending'::text) AND (reviewed_by IS NULL) AND (reviewed_at IS NULL)) OR ((status <> 'pending'::text) AND (reviewed_by IS NOT NULL) AND (reviewed_at IS NOT NULL)))),
    CONSTRAINT vendor_claims_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'verified'::text, 'revoked'::text])))
);


--
-- Name: vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    website text,
    CONSTRAINT vendors_slug_check CHECK (((slug = lower(slug)) AND (length(slug) > 0)))
);


--
-- Name: votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.votes (
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    user_id uuid NOT NULL,
    value smallint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    trust_snapshot numeric(4,3),
    CONSTRAINT votes_subject_type_check CHECK ((subject_type = ANY (ARRAY['post'::text, 'thread'::text, 'feed_post'::text, 'feed_comment'::text, 'make'::text]))),
    CONSTRAINT votes_trust_snapshot_check CHECK (((trust_snapshot IS NULL) OR ((trust_snapshot >= (0)::numeric) AND (trust_snapshot <= (1)::numeric)))),
    CONSTRAINT votes_value_check CHECK ((value = ANY (ARRAY['-1'::integer, 1])))
);


--
-- Name: wardrobe_rewards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wardrobe_rewards (
    achievement_id uuid NOT NULL,
    layer text NOT NULL,
    option_id text NOT NULL
);


--
-- Name: zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fleet_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: achievements achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievements
    ADD CONSTRAINT achievements_pkey PRIMARY KEY (id);


--
-- Name: achievements achievements_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievements
    ADD CONSTRAINT achievements_slug_key UNIQUE (slug);


--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);


--
-- Name: api_keys api_keys_key_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);


--
-- Name: api_keys api_keys_key_prefix_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_key_prefix_key UNIQUE (key_prefix);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: artifact_cache artifact_cache_account_source_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artifact_cache
    ADD CONSTRAINT artifact_cache_account_source_key UNIQUE (owner_id, source_checksum, role, canonical_profile_id, config_fingerprint);


--
-- Name: artifact_cache artifact_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artifact_cache
    ADD CONSTRAINT artifact_cache_pkey PRIMARY KEY (id);


--
-- Name: assistant_messages assistant_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_messages
    ADD CONSTRAINT assistant_messages_pkey PRIMARY KEY (id);


--
-- Name: assistant_run_events assistant_run_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_run_events
    ADD CONSTRAINT assistant_run_events_pkey PRIMARY KEY (id);


--
-- Name: assistant_run_events assistant_run_events_run_seq_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_run_events
    ADD CONSTRAINT assistant_run_events_run_seq_unique UNIQUE (run_id, seq);


--
-- Name: assistant_runs assistant_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_runs
    ADD CONSTRAINT assistant_runs_pkey PRIMARY KEY (id);


--
-- Name: assistant_runs assistant_runs_triggering_message_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_runs
    ADD CONSTRAINT assistant_runs_triggering_message_unique UNIQUE (triggering_message_id);


--
-- Name: assistant_thread_events assistant_thread_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_thread_events
    ADD CONSTRAINT assistant_thread_events_pkey PRIMARY KEY (id);


--
-- Name: assistant_thread_events assistant_thread_events_thread_seq_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_thread_events
    ADD CONSTRAINT assistant_thread_events_thread_seq_unique UNIQUE (thread_id, seq);


--
-- Name: assistant_threads assistant_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_threads
    ADD CONSTRAINT assistant_threads_pkey PRIMARY KEY (id);


--
-- Name: build_guides build_guides_model_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_guides
    ADD CONSTRAINT build_guides_model_id_key UNIQUE (model_id);


--
-- Name: build_guides build_guides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_guides
    ADD CONSTRAINT build_guides_pkey PRIMARY KEY (id);


--
-- Name: build_session_revision_migrations build_session_revision_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_session_revision_migrations
    ADD CONSTRAINT build_session_revision_migrations_pkey PRIMARY KEY (id);


--
-- Name: build_session_revision_migrations build_session_revision_migrations_target_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_session_revision_migrations
    ADD CONSTRAINT build_session_revision_migrations_target_key UNIQUE (session_id, to_commit_sha, to_configuration_id, to_configuration_digest);


--
-- Name: build_session_steps build_session_steps_identity_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_session_steps
    ADD CONSTRAINT build_session_steps_identity_key UNIQUE (session_id, phase_id, step_id);


--
-- Name: build_session_steps build_session_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_session_steps
    ADD CONSTRAINT build_session_steps_pkey PRIMARY KEY (id);


--
-- Name: build_sessions build_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_sessions
    ADD CONSTRAINT build_sessions_pkey PRIMARY KEY (id);


--
-- Name: build_step_photos build_step_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_step_photos
    ADD CONSTRAINT build_step_photos_pkey PRIMARY KEY (id);


--
-- Name: build_step_photos build_step_photos_s3_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_step_photos
    ADD CONSTRAINT build_step_photos_s3_key_key UNIQUE (s3_key);


--
-- Name: build_steps build_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_steps
    ADD CONSTRAINT build_steps_pkey PRIMARY KEY (id);


--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);


--
-- Name: communities communities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communities
    ADD CONSTRAINT communities_pkey PRIMARY KEY (id);


--
-- Name: communities communities_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communities
    ADD CONSTRAINT communities_slug_key UNIQUE (slug);


--
-- Name: community_firmware community_firmware_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_firmware
    ADD CONSTRAINT community_firmware_pkey PRIMARY KEY (id);


--
-- Name: community_members community_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_members
    ADD CONSTRAINT community_members_pkey PRIMARY KEY (community_id, user_id);


--
-- Name: consent_records consent_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_pkey PRIMARY KEY (id);


--
-- Name: content_agents content_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_agents
    ADD CONSTRAINT content_agents_pkey PRIMARY KEY (id);


--
-- Name: device_audit_log device_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_audit_log
    ADD CONSTRAINT device_audit_log_pkey PRIMARY KEY (id);


--
-- Name: device_command_counters device_command_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_command_counters
    ADD CONSTRAINT device_command_counters_pkey PRIMARY KEY (device_id);


--
-- Name: device_commands device_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_commands
    ADD CONSTRAINT device_commands_pkey PRIMARY KEY (id);


--
-- Name: device_enroll_codes device_enroll_codes_code_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_enroll_codes
    ADD CONSTRAINT device_enroll_codes_code_hash_key UNIQUE (code_hash);


--
-- Name: device_enroll_codes device_enroll_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_enroll_codes
    ADD CONSTRAINT device_enroll_codes_pkey PRIMARY KEY (id);


--
-- Name: device_incidents device_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_incidents
    ADD CONSTRAINT device_incidents_pkey PRIMARY KEY (id);


--
-- Name: device_incidents device_incidents_thread_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_incidents
    ADD CONSTRAINT device_incidents_thread_unique UNIQUE (thread_id);


--
-- Name: device_jobs device_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_jobs
    ADD CONSTRAINT device_jobs_pkey PRIMARY KEY (id);


--
-- Name: device_print_requests device_print_requests_device_id_requested_by_idempotency_ke_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_print_requests
    ADD CONSTRAINT device_print_requests_device_id_requested_by_idempotency_ke_key UNIQUE (device_id, requested_by, idempotency_key);


--
-- Name: device_print_requests device_print_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_print_requests
    ADD CONSTRAINT device_print_requests_pkey PRIMARY KEY (id);


--
-- Name: device_print_results device_print_results_device_id_client_result_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_print_results
    ADD CONSTRAINT device_print_results_device_id_client_result_id_key UNIQUE (device_id, client_result_id);


--
-- Name: device_print_results device_print_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_print_results
    ADD CONSTRAINT device_print_results_pkey PRIMARY KEY (id);


--
-- Name: device_reputation device_reputation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_reputation
    ADD CONSTRAINT device_reputation_pkey PRIMARY KEY (device_id);


--
-- Name: device_shares device_shares_device_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_shares
    ADD CONSTRAINT device_shares_device_id_user_id_key UNIQUE (device_id, user_id);


--
-- Name: device_shares device_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_shares
    ADD CONSTRAINT device_shares_pkey PRIMARY KEY (id);


--
-- Name: device_state device_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_state
    ADD CONSTRAINT device_state_pkey PRIMARY KEY (device_id);


--
-- Name: device_telemetry device_telemetry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_telemetry
    ADD CONSTRAINT device_telemetry_pkey PRIMARY KEY (id);


--
-- Name: device_transfers device_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_transfers
    ADD CONSTRAINT device_transfers_pkey PRIMARY KEY (id);


--
-- Name: email_otp email_otp_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_otp
    ADD CONSTRAINT email_otp_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: feed_events feed_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_events
    ADD CONSTRAINT feed_events_pkey PRIMARY KEY (id);


--
-- Name: feed_post_images feed_post_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_post_images
    ADD CONSTRAINT feed_post_images_pkey PRIMARY KEY (id);


--
-- Name: feed_post_revisions feed_post_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_post_revisions
    ADD CONSTRAINT feed_post_revisions_pkey PRIMARY KEY (id);


--
-- Name: feed_post_saves feed_post_saves_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_post_saves
    ADD CONSTRAINT feed_post_saves_pkey PRIMARY KEY (user_id, post_id);


--
-- Name: feed_posts feed_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_posts
    ADD CONSTRAINT feed_posts_pkey PRIMARY KEY (id);


--
-- Name: fleets fleets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleets
    ADD CONSTRAINT fleets_pkey PRIMARY KEY (id);


--
-- Name: generated_concepts generated_concepts_cache_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_concepts
    ADD CONSTRAINT generated_concepts_cache_key_key UNIQUE (cache_key);


--
-- Name: generated_concepts generated_concepts_generation_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_concepts
    ADD CONSTRAINT generated_concepts_generation_id_key UNIQUE (generation_id);


--
-- Name: generated_concepts generated_concepts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_concepts
    ADD CONSTRAINT generated_concepts_pkey PRIMARY KEY (id);


--
-- Name: generations_idempotency generations_idempotency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generations_idempotency
    ADD CONSTRAINT generations_idempotency_pkey PRIMARY KEY (owner_id, idempotency_key);


--
-- Name: generations generations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generations
    ADD CONSTRAINT generations_pkey PRIMARY KEY (id);


--
-- Name: guest_print_nonces guest_print_nonces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_print_nonces
    ADD CONSTRAINT guest_print_nonces_pkey PRIMARY KEY (nonce);


--
-- Name: guest_print_requests guest_print_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_print_requests
    ADD CONSTRAINT guest_print_requests_pkey PRIMARY KEY (id);


--
-- Name: idea_comments idea_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idea_comments
    ADD CONSTRAINT idea_comments_pkey PRIMARY KEY (id);


--
-- Name: idea_enrichments idea_enrichments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idea_enrichments
    ADD CONSTRAINT idea_enrichments_pkey PRIMARY KEY (id);


--
-- Name: idea_notifications idea_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idea_notifications
    ADD CONSTRAINT idea_notifications_pkey PRIMARY KEY (id);


--
-- Name: idea_vote_log idea_vote_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idea_vote_log
    ADD CONSTRAINT idea_vote_log_pkey PRIMARY KEY (id);


--
-- Name: idea_votes idea_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idea_votes
    ADD CONSTRAINT idea_votes_pkey PRIMARY KEY (idea_id, user_id);


--
-- Name: ideas ideas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ideas
    ADD CONSTRAINT ideas_pkey PRIMARY KEY (id);


--
-- Name: idempotency_records idempotency_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_records
    ADD CONSTRAINT idempotency_records_pkey PRIMARY KEY (actor_id, operation_scope, idempotency_key);


--
-- Name: import_bindings import_bindings_model_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_bindings
    ADD CONSTRAINT import_bindings_model_id_key UNIQUE (model_id);


--
-- Name: import_bindings import_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_bindings
    ADD CONSTRAINT import_bindings_pkey PRIMARY KEY (id);


--
-- Name: import_bindings import_bindings_source_platform_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_bindings
    ADD CONSTRAINT import_bindings_source_platform_external_id_key UNIQUE (source_platform, external_id);


--
-- Name: import_connections import_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_connections
    ADD CONSTRAINT import_connections_pkey PRIMARY KEY (id);


--
-- Name: import_connections import_connections_user_id_source_platform_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_connections
    ADD CONSTRAINT import_connections_user_id_source_platform_key UNIQUE (user_id, source_platform);


--
-- Name: import_job_items import_job_items_job_id_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_job_items
    ADD CONSTRAINT import_job_items_job_id_external_id_key UNIQUE (job_id, external_id);


--
-- Name: import_job_items import_job_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_job_items
    ADD CONSTRAINT import_job_items_pkey PRIMARY KEY (id);


--
-- Name: import_jobs import_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT import_jobs_pkey PRIMARY KEY (id);


--
-- Name: ingest_runs ingest_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingest_runs
    ADD CONSTRAINT ingest_runs_pkey PRIMARY KEY (id);


--
-- Name: ledger_entries ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: machine_candidates machine_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_candidates
    ADD CONSTRAINT machine_candidates_pkey PRIMARY KEY (id);


--
-- Name: machine_candidates machine_candidates_source_external_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_candidates
    ADD CONSTRAINT machine_candidates_source_external_ref_key UNIQUE (source, external_ref);


--
-- Name: machine_material_profiles machine_material_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_material_profiles
    ADD CONSTRAINT machine_material_profiles_pkey PRIMARY KEY (id);


--
-- Name: machines machines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machines
    ADD CONSTRAINT machines_pkey PRIMARY KEY (id);


--
-- Name: make_materials make_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.make_materials
    ADD CONSTRAINT make_materials_pkey PRIMARY KEY (make_id, material_id);


--
-- Name: make_photo_hashes make_photo_hashes_photo_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.make_photo_hashes
    ADD CONSTRAINT make_photo_hashes_photo_id_key UNIQUE (photo_id);


--
-- Name: make_photo_hashes make_photo_hashes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.make_photo_hashes
    ADD CONSTRAINT make_photo_hashes_pkey PRIMARY KEY (id);


--
-- Name: make_photos make_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.make_photos
    ADD CONSTRAINT make_photos_pkey PRIMARY KEY (id);


--
-- Name: make_photos make_photos_s3_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.make_photos
    ADD CONSTRAINT make_photos_s3_key_key UNIQUE (s3_key);


--
-- Name: maker_profiles maker_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maker_profiles
    ADD CONSTRAINT maker_profiles_pkey PRIMARY KEY (id);


--
-- Name: maker_profiles maker_profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maker_profiles
    ADD CONSTRAINT maker_profiles_user_id_key UNIQUE (user_id);


--
-- Name: makes makes_photo_s3_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.makes
    ADD CONSTRAINT makes_photo_s3_key_key UNIQUE (photo_s3_key);


--
-- Name: makes makes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.makes
    ADD CONSTRAINT makes_pkey PRIMARY KEY (id);


--
-- Name: master_equipment_materials master_equipment_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_equipment_materials
    ADD CONSTRAINT master_equipment_materials_pkey PRIMARY KEY (master_equipment_id, material_id);


--
-- Name: master_equipment master_equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_equipment
    ADD CONSTRAINT master_equipment_pkey PRIMARY KEY (id);


--
-- Name: master_service_materials master_service_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_service_materials
    ADD CONSTRAINT master_service_materials_pkey PRIMARY KEY (master_service_id, material_id);


--
-- Name: master_services master_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_services
    ADD CONSTRAINT master_services_pkey PRIMARY KEY (id);


--
-- Name: material_candidates material_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_candidates
    ADD CONSTRAINT material_candidates_pkey PRIMARY KEY (id);


--
-- Name: material_candidates material_candidates_source_external_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_candidates
    ADD CONSTRAINT material_candidates_source_external_ref_key UNIQUE (source, external_ref);


--
-- Name: material_types material_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_types
    ADD CONSTRAINT material_types_pkey PRIMARY KEY (id);


--
-- Name: material_types material_types_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_types
    ADD CONSTRAINT material_types_slug_key UNIQUE (slug);


--
-- Name: material_variant_offers material_variant_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_variant_offers
    ADD CONSTRAINT material_variant_offers_pkey PRIMARY KEY (id);


--
-- Name: material_variants material_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_variants
    ADD CONSTRAINT material_variants_pkey PRIMARY KEY (id);


--
-- Name: materials materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_pkey PRIMARY KEY (id);


--
-- Name: materials materials_vendor_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_vendor_id_slug_key UNIQUE (vendor_id, slug);


--
-- Name: model_download_log model_download_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_download_log
    ADD CONSTRAINT model_download_log_pkey PRIMARY KEY (id);


--
-- Name: model_embeddings model_embeddings_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_embeddings
    ADD CONSTRAINT model_embeddings_identity UNIQUE (model_id, embedding_model, embedding_version);


--
-- Name: model_embeddings model_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_embeddings
    ADD CONSTRAINT model_embeddings_pkey PRIMARY KEY (id);


--
-- Name: model_meshes model_meshes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_meshes
    ADD CONSTRAINT model_meshes_pkey PRIMARY KEY (id);


--
-- Name: model_revision_files model_revision_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_revision_files
    ADD CONSTRAINT model_revision_files_pkey PRIMARY KEY (id);


--
-- Name: model_revisions model_revisions_model_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_revisions
    ADD CONSTRAINT model_revisions_model_id_id_key UNIQUE (model_id, id);


--
-- Name: model_revisions model_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_revisions
    ADD CONSTRAINT model_revisions_pkey PRIMARY KEY (id);


--
-- Name: model_tags model_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_tags
    ADD CONSTRAINT model_tags_pkey PRIMARY KEY (model_id, tag_id);


--
-- Name: model_view_log model_view_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_view_log
    ADD CONSTRAINT model_view_log_pkey PRIMARY KEY (model_id, user_id, viewed_on);


--
-- Name: model_votes model_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_votes
    ADD CONSTRAINT model_votes_pkey PRIMARY KEY (model_id, user_id);


--
-- Name: models models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.models
    ADD CONSTRAINT models_pkey PRIMARY KEY (id);


--
-- Name: models models_project_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.models
    ADD CONSTRAINT models_project_id_id_key UNIQUE (project_id, id);


--
-- Name: models models_project_position_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.models
    ADD CONSTRAINT models_project_position_key UNIQUE (project_id, "position");


--
-- Name: projects models_repo_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT models_repo_path_key UNIQUE (repo_path);


--
-- Name: moderation_actions moderation_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_pkey PRIMARY KEY (id);


--
-- Name: order_events order_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: organization_members organization_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_pkey PRIMARY KEY (organization_id, user_id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_vendor_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_vendor_id_unique UNIQUE (vendor_id);


--
-- Name: outbox_events outbox_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_pkey PRIMARY KEY (id);


--
-- Name: payment_webhook_events payment_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_webhook_events
    ADD CONSTRAINT payment_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: payment_webhook_events payment_webhook_events_provider_event_uidx; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_webhook_events
    ADD CONSTRAINT payment_webhook_events_provider_event_uidx UNIQUE (provider, event_id);


--
-- Name: payouts payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_pkey PRIMARY KEY (id);


--
-- Name: post_attachments post_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_attachments
    ADD CONSTRAINT post_attachments_pkey PRIMARY KEY (id);


--
-- Name: post_attachments post_attachments_s3_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_attachments
    ADD CONSTRAINT post_attachments_s3_key_key UNIQUE (s3_key);


--
-- Name: post_score post_score_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_score
    ADD CONSTRAINT post_score_pkey PRIMARY KEY (post_id);


--
-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);


--
-- Name: print_requests print_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_requests
    ADD CONSTRAINT print_requests_pkey PRIMARY KEY (id);


--
-- Name: printer_connections printer_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.printer_connections
    ADD CONSTRAINT printer_connections_pkey PRIMARY KEY (id);


--
-- Name: printer_connections printer_connections_user_id_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.printer_connections
    ADD CONSTRAINT printer_connections_user_id_provider_key UNIQUE (user_id, provider);


--
-- Name: printer_reports printer_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.printer_reports
    ADD CONSTRAINT printer_reports_pkey PRIMARY KEY (id);


--
-- Name: printers printers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.printers
    ADD CONSTRAINT printers_pkey PRIMARY KEY (id);


--
-- Name: project_manifest_resolutions project_manifest_resolutions_identity_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_manifest_resolutions
    ADD CONSTRAINT project_manifest_resolutions_identity_key UNIQUE (project_id, commit_sha, configuration_id, configuration_digest);


--
-- Name: project_manifest_resolutions project_manifest_resolutions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_manifest_resolutions
    ADD CONSTRAINT project_manifest_resolutions_pkey PRIMARY KEY (id);


--
-- Name: project_revision_models project_revision_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_revision_models
    ADD CONSTRAINT project_revision_models_pkey PRIMARY KEY (project_revision_id, model_id);


--
-- Name: project_revision_models project_revision_models_position_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_revision_models
    ADD CONSTRAINT project_revision_models_position_key UNIQUE (project_revision_id, "position");


--
-- Name: project_revisions project_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_revisions
    ADD CONSTRAINT project_revisions_pkey PRIMARY KEY (id);


--
-- Name: project_revisions project_revisions_project_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_revisions
    ADD CONSTRAINT project_revisions_project_hash_key UNIQUE (project_id, content_hash);


--
-- Name: project_revisions project_revisions_project_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_revisions
    ADD CONSTRAINT project_revisions_project_id_id_key UNIQUE (project_id, id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);


--
-- Name: push_preferences push_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_preferences
    ADD CONSTRAINT push_preferences_pkey PRIMARY KEY (user_id, type);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: release_events release_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_events
    ADD CONSTRAINT release_events_pkey PRIMARY KEY (id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: reports reports_subject_type_subject_id_reporter_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_subject_type_subject_id_reporter_id_key UNIQUE (subject_type, subject_id, reporter_id);


--
-- Name: reputation_events reputation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reputation_events
    ADD CONSTRAINT reputation_events_pkey PRIMARY KEY (id);


--
-- Name: search_index_jobs search_index_jobs_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_index_jobs
    ADD CONSTRAINT search_index_jobs_identity UNIQUE (model_id, embedding_model, embedding_version);


--
-- Name: search_index_jobs search_index_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_index_jobs
    ADD CONSTRAINT search_index_jobs_pkey PRIMARY KEY (id);


--
-- Name: slice_cache_entries slice_cache_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_cache_entries
    ADD CONSTRAINT slice_cache_entries_pkey PRIMARY KEY (account_id, slice_key);


--
-- Name: slice_cache_hits slice_cache_hits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_cache_hits
    ADD CONSTRAINT slice_cache_hits_pkey PRIMARY KEY (id);


--
-- Name: slice_job_attempts slice_job_attempts_identity_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_job_attempts
    ADD CONSTRAINT slice_job_attempts_identity_key UNIQUE (slice_job_id, attempt_number);


--
-- Name: slice_job_attempts slice_job_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_job_attempts
    ADD CONSTRAINT slice_job_attempts_pkey PRIMARY KEY (id);


--
-- Name: slice_job_plate_instances slice_job_plate_instances_identity_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_job_plate_instances
    ADD CONSTRAINT slice_job_plate_instances_identity_key UNIQUE (slice_job_id, instance_id);


--
-- Name: slice_job_plate_instances slice_job_plate_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_job_plate_instances
    ADD CONSTRAINT slice_job_plate_instances_pkey PRIMARY KEY (id);


--
-- Name: slice_jobs slice_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_jobs
    ADD CONSTRAINT slice_jobs_pkey PRIMARY KEY (id);


--
-- Name: slice_reputation slice_reputation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_reputation
    ADD CONSTRAINT slice_reputation_pkey PRIMARY KEY (user_id, slice_key);


--
-- Name: slicer_profile_calibrations slicer_profile_calibrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slicer_profile_calibrations
    ADD CONSTRAINT slicer_profile_calibrations_pkey PRIMARY KEY (id);


--
-- Name: slicer_profile_candidates slicer_profile_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slicer_profile_candidates
    ADD CONSTRAINT slicer_profile_candidates_pkey PRIMARY KEY (id);


--
-- Name: slicer_profile_candidates slicer_profile_candidates_source_external_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slicer_profile_candidates
    ADD CONSTRAINT slicer_profile_candidates_source_external_ref_key UNIQUE (source, external_ref);


--
-- Name: slicer_profiles slicer_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slicer_profiles
    ADD CONSTRAINT slicer_profiles_pkey PRIMARY KEY (id);


--
-- Name: storage_blobs storage_blobs_owner_checksum_size_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_blobs
    ADD CONSTRAINT storage_blobs_owner_checksum_size_key UNIQUE (owner_id, checksum, size_bytes);


--
-- Name: storage_blobs storage_blobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_blobs
    ADD CONSTRAINT storage_blobs_pkey PRIMARY KEY (id);


--
-- Name: taggings taggings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taggings
    ADD CONSTRAINT taggings_pkey PRIMARY KEY (subject_type, subject_id, tag_id);


--
-- Name: tags tags_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_name_key UNIQUE (name);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: threads threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_pkey PRIMARY KEY (id);


--
-- Name: uploader_reputation_ledger uploader_reputation_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploader_reputation_ledger
    ADD CONSTRAINT uploader_reputation_ledger_pkey PRIMARY KEY (id);


--
-- Name: user_achievements user_achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_achievements
    ADD CONSTRAINT user_achievements_pkey PRIMARY KEY (id);


--
-- Name: user_achievements user_achievements_user_id_achievement_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_achievements
    ADD CONSTRAINT user_achievements_user_id_achievement_id_key UNIQUE (user_id, achievement_id);


--
-- Name: user_activation user_activation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activation
    ADD CONSTRAINT user_activation_pkey PRIMARY KEY (user_id);


--
-- Name: user_api_keys user_api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_api_keys
    ADD CONSTRAINT user_api_keys_pkey PRIMARY KEY (id);


--
-- Name: user_avatar user_avatar_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_avatar
    ADD CONSTRAINT user_avatar_pkey PRIMARY KEY (user_id);


--
-- Name: user_filaments user_filaments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_filaments
    ADD CONSTRAINT user_filaments_pkey PRIMARY KEY (id);


--
-- Name: user_filaments user_filaments_user_id_material_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_filaments
    ADD CONSTRAINT user_filaments_user_id_material_id_key UNIQUE (user_id, material_id);


--
-- Name: user_follows user_follows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_follows
    ADD CONSTRAINT user_follows_pkey PRIMARY KEY (follower_id, followee_id);


--
-- Name: user_identities user_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_pkey PRIMARY KEY (id);


--
-- Name: user_identities user_identities_provider_identifier_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_provider_identifier_hash_key UNIQUE (provider, identifier_hash);


--
-- Name: user_materials user_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_materials
    ADD CONSTRAINT user_materials_pkey PRIMARY KEY (id);


--
-- Name: user_password_credentials user_password_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_password_credentials
    ADD CONSTRAINT user_password_credentials_pkey PRIMARY KEY (user_id);


--
-- Name: user_printers user_printers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_printers
    ADD CONSTRAINT user_printers_pkey PRIMARY KEY (id);


--
-- Name: user_uploader_reputation user_uploader_reputation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_uploader_reputation
    ADD CONSTRAINT user_uploader_reputation_pkey PRIMARY KEY (user_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: vendor_claim_events vendor_claim_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_claim_events
    ADD CONSTRAINT vendor_claim_events_pkey PRIMARY KEY (id);


--
-- Name: vendor_claims vendor_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_claims
    ADD CONSTRAINT vendor_claims_pkey PRIMARY KEY (id);


--
-- Name: vendors vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (id);


--
-- Name: vendors vendors_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_slug_key UNIQUE (slug);


--
-- Name: votes votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_pkey PRIMARY KEY (subject_type, subject_id, user_id);


--
-- Name: wardrobe_rewards wardrobe_rewards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wardrobe_rewards
    ADD CONSTRAINT wardrobe_rewards_pkey PRIMARY KEY (achievement_id);


--
-- Name: zones zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT zones_pkey PRIMARY KEY (id);


--
-- Name: agents_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agents_owner_idx ON public.agents USING btree (owner_id);


--
-- Name: api_keys_active_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX api_keys_active_lookup_idx ON public.api_keys USING btree (key_hash, expires_at) WHERE (revoked_at IS NULL);


--
-- Name: api_keys_owner_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX api_keys_owner_active_idx ON public.api_keys USING btree (owner_id, expires_at, created_at DESC) WHERE (revoked_at IS NULL);


--
-- Name: api_keys_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX api_keys_owner_idx ON public.api_keys USING btree (owner_id, created_at DESC);


--
-- Name: artifact_cache_ready_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artifact_cache_ready_lookup_idx ON public.artifact_cache USING btree (owner_id, source_checksum, role, canonical_profile_id, config_fingerprint) WHERE (state = 'ready'::text);


--
-- Name: assistant_messages_thread_client_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX assistant_messages_thread_client_request_idx ON public.assistant_messages USING btree (thread_id, client_request_id) WHERE (client_request_id IS NOT NULL);


--
-- Name: assistant_messages_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_messages_thread_idx ON public.assistant_messages USING btree (thread_id, created_at, id);


--
-- Name: assistant_run_events_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_run_events_run_idx ON public.assistant_run_events USING btree (run_id, seq);


--
-- Name: assistant_runs_status_queued_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_runs_status_queued_idx ON public.assistant_runs USING btree (status) WHERE (status = 'queued'::text);


--
-- Name: assistant_runs_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_runs_thread_idx ON public.assistant_runs USING btree (thread_id, created_at DESC);


--
-- Name: assistant_runs_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_runs_user_idx ON public.assistant_runs USING btree (user_id, created_at DESC);


--
-- Name: assistant_thread_events_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_thread_events_thread_idx ON public.assistant_thread_events USING btree (thread_id, seq);


--
-- Name: assistant_threads_device_incident_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_threads_device_incident_idx ON public.assistant_threads USING btree (device_id, incident_status) WHERE (kind = 'device_incident'::text);


--
-- Name: assistant_threads_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_threads_owner_idx ON public.assistant_threads USING btree (owner_id, created_at DESC);


--
-- Name: build_session_revision_migrations_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX build_session_revision_migrations_pending_idx ON public.build_session_revision_migrations USING btree (session_id) WHERE (status = 'proposed'::text);


--
-- Name: build_session_revision_migrations_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX build_session_revision_migrations_session_idx ON public.build_session_revision_migrations USING btree (session_id, created_at DESC);


--
-- Name: build_session_steps_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX build_session_steps_session_idx ON public.build_session_steps USING btree (session_id);


--
-- Name: build_sessions_active_owner_model_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX build_sessions_active_owner_model_idx ON public.build_sessions USING btree (owner_id, model_id) WHERE (status = ANY (ARRAY['in_progress'::text, 'paused'::text]));


--
-- Name: build_sessions_create_idem_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX build_sessions_create_idem_key ON public.build_sessions USING btree (owner_id, model_id, create_idempotency_key) WHERE (create_idempotency_key IS NOT NULL);


--
-- Name: build_sessions_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX build_sessions_owner_idx ON public.build_sessions USING btree (owner_id, created_at DESC);


--
-- Name: build_step_photos_step_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX build_step_photos_step_idx ON public.build_step_photos USING btree (step_id, "position");


--
-- Name: build_steps_guide_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX build_steps_guide_idx ON public.build_steps USING btree (guide_id, "position");


--
-- Name: build_steps_mesh_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX build_steps_mesh_idx ON public.build_steps USING btree (mesh_id) WHERE (mesh_id IS NOT NULL);


--
-- Name: comments_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comments_parent_idx ON public.comments USING btree (parent_id) WHERE (parent_id IS NOT NULL);


--
-- Name: comments_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comments_subject_idx ON public.comments USING btree (subject_type, subject_id, created_at);


--
-- Name: communities_subject_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX communities_subject_key ON public.communities USING btree (kind, subject_type, subject_id) WHERE (subject_id IS NOT NULL);


--
-- Name: community_firmware_git_url_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX community_firmware_git_url_idx ON public.community_firmware USING btree (git_url);


--
-- Name: community_firmware_model_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_firmware_model_idx ON public.community_firmware USING btree (model);


--
-- Name: community_firmware_printer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_firmware_printer_idx ON public.community_firmware USING btree (printer_id) WHERE (printer_id IS NOT NULL);


--
-- Name: community_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_members_user_idx ON public.community_members USING btree (user_id);


--
-- Name: consent_records_anon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_records_anon_idx ON public.consent_records USING btree (anon_id, consent_type, created_at DESC) WHERE (anon_id IS NOT NULL);


--
-- Name: consent_records_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_records_user_idx ON public.consent_records USING btree (user_id, consent_type, created_at DESC) WHERE (user_id IS NOT NULL);


--
-- Name: content_agents_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_agents_owner_idx ON public.content_agents USING btree (owner_user_id, created_at DESC);


--
-- Name: device_audit_log_correlation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_audit_log_correlation_idx ON public.device_audit_log USING btree (correlation_id);


--
-- Name: device_audit_log_device_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_audit_log_device_idx ON public.device_audit_log USING btree (device_id, created_at DESC);


--
-- Name: device_commands_correlation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX device_commands_correlation_idx ON public.device_commands USING btree (correlation_id);


--
-- Name: device_commands_device_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_commands_device_idx ON public.device_commands USING btree (device_id, created_at DESC);


--
-- Name: device_commands_idempotency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX device_commands_idempotency_idx ON public.device_commands USING btree (device_id, actor_scope, idempotency_key) WHERE ((actor_scope IS NOT NULL) AND (idempotency_key IS NOT NULL));


--
-- Name: device_enroll_codes_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_enroll_codes_owner_idx ON public.device_enroll_codes USING btree (owner_id, created_at DESC);


--
-- Name: device_incidents_open_dedupe_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX device_incidents_open_dedupe_idx ON public.device_incidents USING btree (device_id, dedupe_key) WHERE (status <> 'resolved'::text);


--
-- Name: device_incidents_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_incidents_owner_idx ON public.device_incidents USING btree (owner_id, created_at DESC);


--
-- Name: device_jobs_device_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_jobs_device_idx ON public.device_jobs USING btree (device_id, created_at DESC);


--
-- Name: device_print_requests_device_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_print_requests_device_idx ON public.device_print_requests USING btree (device_id, created_at DESC);


--
-- Name: device_print_results_device_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_print_results_device_idx ON public.device_print_results USING btree (device_id, created_at DESC);


--
-- Name: device_shares_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_shares_user_idx ON public.device_shares USING btree (user_id);


--
-- Name: device_telemetry_device_recorded_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_telemetry_device_recorded_idx ON public.device_telemetry USING btree (device_id, recorded_at DESC);


--
-- Name: device_transfers_device_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_transfers_device_idx ON public.device_transfers USING btree (device_id, created_at DESC);


--
-- Name: device_transfers_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_transfers_pending_idx ON public.device_transfers USING btree (device_id, status) WHERE (status = ANY (ARRAY['initiated'::text, 'transferring'::text]));


--
-- Name: email_otp_email_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_otp_email_hash_idx ON public.email_otp USING btree (email_hash, created_at DESC);


--
-- Name: events_anon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_anon_idx ON public.events USING btree (anon_id, created_at DESC) WHERE (anon_id IS NOT NULL);


--
-- Name: events_name_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_name_ts_idx ON public.events USING btree (event_name, created_at DESC);


--
-- Name: events_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_user_idx ON public.events USING btree (user_id, created_at DESC) WHERE (user_id IS NOT NULL);


--
-- Name: feed_events_post_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feed_events_post_idx ON public.feed_events USING btree (post_id, created_at DESC);


--
-- Name: feed_events_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feed_events_type_idx ON public.feed_events USING btree (event_type, created_at DESC);


--
-- Name: feed_events_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feed_events_user_idx ON public.feed_events USING btree (user_id, created_at DESC) WHERE (user_id IS NOT NULL);


--
-- Name: feed_post_images_post_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feed_post_images_post_idx ON public.feed_post_images USING btree (post_id);


--
-- Name: feed_post_revisions_post_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feed_post_revisions_post_idx ON public.feed_post_revisions USING btree (post_id, created_at DESC);


--
-- Name: feed_post_saves_post_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feed_post_saves_post_idx ON public.feed_post_saves USING btree (post_id);


--
-- Name: feed_posts_author_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feed_posts_author_idx ON public.feed_posts USING btree (author_id, created_at DESC);


--
-- Name: feed_posts_community_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feed_posts_community_idx ON public.feed_posts USING btree (community_id, created_at DESC);


--
-- Name: feed_posts_ingest_idempotency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX feed_posts_ingest_idempotency_idx ON public.feed_posts USING btree (community_id, source_fingerprint) WHERE (source_fingerprint IS NOT NULL);


--
-- Name: feed_posts_make_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feed_posts_make_idx ON public.feed_posts USING btree (make_id) WHERE (make_id IS NOT NULL);


--
-- Name: feed_posts_model_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feed_posts_model_idx ON public.feed_posts USING btree (model_id) WHERE (model_id IS NOT NULL);


--
-- Name: feed_posts_visible_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feed_posts_visible_created_idx ON public.feed_posts USING btree (created_at DESC) WHERE (status = 'visible'::text);


--
-- Name: generated_concepts_lexical_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generated_concepts_lexical_trgm_idx ON public.generated_concepts USING gin (lower(((((normalized_query || ' '::text) || label) || ' '::text) || prompt)) public.gin_trgm_ops) WHERE (status = 'ready'::text);


--
-- Name: generated_concepts_ready_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generated_concepts_ready_hnsw_idx ON public.generated_concepts USING hnsw (embedding_2048 public.halfvec_cosine_ops) WHERE ((status = 'ready'::text) AND (embedding_2048 IS NOT NULL));


--
-- Name: generated_concepts_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generated_concepts_status_created_idx ON public.generated_concepts USING btree (status, created_at DESC);


--
-- Name: generations_assistant_offer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generations_assistant_offer_idx ON public.generations USING btree (assistant_offer_id) WHERE (assistant_offer_id IS NOT NULL);


--
-- Name: generations_idempotency_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generations_idempotency_created_idx ON public.generations_idempotency USING btree (created_at);


--
-- Name: generations_source_generation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generations_source_generation_idx ON public.generations USING btree (source_generation_id) WHERE (source_generation_id IS NOT NULL);


--
-- Name: generations_status_queued_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generations_status_queued_idx ON public.generations USING btree (status) WHERE (status = 'queued'::text);


--
-- Name: generations_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generations_user_idx ON public.generations USING btree (user_id, created_at DESC);


--
-- Name: guest_print_nonces_used_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX guest_print_nonces_used_at_idx ON public.guest_print_nonces USING btree (used_at);


--
-- Name: guest_print_requests_owner_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX guest_print_requests_owner_pending_idx ON public.guest_print_requests USING btree (owner_id, status);


--
-- Name: idea_comments_idea_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idea_comments_idea_idx ON public.idea_comments USING btree (idea_id, created_at);


--
-- Name: idea_enrichments_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idea_enrichments_user_created_idx ON public.idea_enrichments USING btree (user_id, created_at DESC);


--
-- Name: idea_notifications_undelivered_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idea_notifications_undelivered_idx ON public.idea_notifications USING btree (user_id) WHERE (delivered_at IS NULL);


--
-- Name: idea_notifications_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idea_notifications_user_idx ON public.idea_notifications USING btree (user_id, created_at DESC);


--
-- Name: idea_vote_log_ip_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idea_vote_log_ip_idx ON public.idea_vote_log USING btree (ip_hash, created_at) WHERE (ip_hash IS NOT NULL);


--
-- Name: idea_vote_log_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idea_vote_log_user_idx ON public.idea_vote_log USING btree (user_id, created_at);


--
-- Name: ideas_archive_scan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ideas_archive_scan_idx ON public.ideas USING btree (last_activity_at) WHERE (status <> 'archived'::text);


--
-- Name: ideas_author_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ideas_author_created_idx ON public.ideas USING btree (author_id, created_at);


--
-- Name: ideas_canonical_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ideas_canonical_idx ON public.ideas USING btree (canonical_id) WHERE (canonical_id IS NOT NULL);


--
-- Name: ideas_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ideas_created_at_idx ON public.ideas USING btree (created_at DESC);


--
-- Name: ideas_filter_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ideas_filter_idx ON public.ideas USING btree (category, status, vote_count DESC);


--
-- Name: ideas_popular_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ideas_popular_idx ON public.ideas USING btree (vote_count DESC, created_at DESC) WHERE (status <> ALL (ARRAY['archived'::text, 'duplicate'::text]));


--
-- Name: ideas_title_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ideas_title_trgm_idx ON public.ideas USING gin (title public.gin_trgm_ops);


--
-- Name: ideas_type_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ideas_type_status_idx ON public.ideas USING btree (type, status, created_at DESC);


--
-- Name: idempotency_records_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idempotency_records_expiry_idx ON public.idempotency_records USING btree (expires_at);


--
-- Name: import_bindings_connection_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX import_bindings_connection_idx ON public.import_bindings USING btree (connection_id) WHERE (connection_id IS NOT NULL);


--
-- Name: import_bindings_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX import_bindings_user_idx ON public.import_bindings USING btree (user_id, created_at DESC);


--
-- Name: import_job_items_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX import_job_items_job_idx ON public.import_job_items USING btree (job_id);


--
-- Name: import_job_items_retry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX import_job_items_retry_idx ON public.import_job_items USING btree (next_retry_at) WHERE ((status = 'failed'::text) AND (retryable = true));


--
-- Name: import_jobs_queued_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX import_jobs_queued_idx ON public.import_jobs USING btree (created_at) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));


--
-- Name: import_jobs_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX import_jobs_user_idx ON public.import_jobs USING btree (user_id, created_at DESC);


--
-- Name: ingest_runs_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ingest_runs_source_idx ON public.ingest_runs USING btree (source, started_at DESC);


--
-- Name: ledger_entries_payout_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ledger_entries_payout_idx ON public.ledger_entries USING btree (payout_id) WHERE (payout_id IS NOT NULL);


--
-- Name: ledger_entries_purchase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ledger_entries_purchase_idx ON public.ledger_entries USING btree (purchase_id) WHERE (purchase_id IS NOT NULL);


--
-- Name: ledger_entries_user_available_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ledger_entries_user_available_idx ON public.ledger_entries USING btree (user_id, available_at) WHERE (account = 'seller_balance'::text);


--
-- Name: machine_candidates_ownership_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX machine_candidates_ownership_status_idx ON public.machine_candidates USING btree (owner, source_family, status, created_at, id) WHERE (status = 'pending'::text);


--
-- Name: machine_candidates_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX machine_candidates_status_idx ON public.machine_candidates USING btree (status, created_at);


--
-- Name: machine_material_profiles_machine_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX machine_material_profiles_machine_idx ON public.machine_material_profiles USING btree (machine_id);


--
-- Name: machine_material_profiles_material_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX machine_material_profiles_material_idx ON public.machine_material_profiles USING btree (material_id);


--
-- Name: machines_aliases_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX machines_aliases_gin_idx ON public.machines USING gin (aliases);


--
-- Name: machines_content_hash_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX machines_content_hash_uidx ON public.machines USING btree (content_hash) WHERE (content_hash IS NOT NULL);


--
-- Name: machines_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX machines_kind_idx ON public.machines USING btree (craft, kind);


--
-- Name: machines_specs_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX machines_specs_gin_idx ON public.machines USING gin (specs jsonb_path_ops);


--
-- Name: machines_status_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX machines_status_review_idx ON public.machines USING btree (status) WHERE (status = 'quarantined'::text);


--
-- Name: machines_vendor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX machines_vendor_idx ON public.machines USING btree (vendor_id);


--
-- Name: make_materials_material_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX make_materials_material_idx ON public.make_materials USING btree (material_id);


--
-- Name: make_photo_hashes_make_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX make_photo_hashes_make_idx ON public.make_photo_hashes USING btree (make_id);


--
-- Name: make_photo_hashes_phash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX make_photo_hashes_phash_idx ON public.make_photo_hashes USING btree (phash);


--
-- Name: make_photos_cover_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX make_photos_cover_uidx ON public.make_photos USING btree (make_id) WHERE is_cover;


--
-- Name: make_photos_make_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX make_photos_make_idx ON public.make_photos USING btree (make_id, "position");


--
-- Name: maker_profiles_geohash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX maker_profiles_geohash_idx ON public.maker_profiles USING btree (location_geohash);


--
-- Name: maker_profiles_location_gist_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX maker_profiles_location_gist_idx ON public.maker_profiles USING gist (location);


--
-- Name: maker_profiles_mail_ru_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX maker_profiles_mail_ru_idx ON public.maker_profiles USING btree (id) WHERE (service_mode = 'mail_ru'::text);


--
-- Name: makes_machine_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX makes_machine_idx ON public.makes USING btree (machine_id) WHERE (machine_id IS NOT NULL);


--
-- Name: makes_machine_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX makes_machine_published_idx ON public.makes USING btree (machine_id, created_at DESC) WHERE ((status = 'published'::text) AND (machine_id IS NOT NULL));


--
-- Name: makes_model_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX makes_model_idx ON public.makes USING btree (model_id, created_at DESC);


--
-- Name: makes_model_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX makes_model_published_idx ON public.makes USING btree (model_id) WHERE (status = 'published'::text);


--
-- Name: makes_popularity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX makes_popularity_idx ON public.makes USING btree (likes_count DESC, created_at DESC) WHERE (status = 'published'::text);


--
-- Name: makes_published_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX makes_published_created_idx ON public.makes USING btree (created_at DESC) WHERE (status = 'published'::text);


--
-- Name: makes_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX makes_user_idx ON public.makes USING btree (user_id, created_at DESC);


--
-- Name: master_equipment_master_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX master_equipment_master_idx ON public.master_equipment USING btree (master_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: master_equipment_master_machine_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX master_equipment_master_machine_uniq ON public.master_equipment USING btree (master_id, machine_id) WHERE (deleted_at IS NULL);


--
-- Name: master_equipment_materials_material_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX master_equipment_materials_material_idx ON public.master_equipment_materials USING btree (material_id);


--
-- Name: master_service_materials_material_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX master_service_materials_material_idx ON public.master_service_materials USING btree (material_id);


--
-- Name: master_services_master_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX master_services_master_idx ON public.master_services USING btree (master_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: master_services_technology_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX master_services_technology_idx ON public.master_services USING btree (technology) WHERE (deleted_at IS NULL);


--
-- Name: material_candidates_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX material_candidates_status_idx ON public.material_candidates USING btree (status, created_at);


--
-- Name: material_variant_offers_variant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX material_variant_offers_variant_idx ON public.material_variant_offers USING btree (material_variant_id);


--
-- Name: material_variants_color_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX material_variants_color_idx ON public.material_variants USING btree (color_name);


--
-- Name: material_variants_dedup_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX material_variants_dedup_uidx ON public.material_variants USING btree (material_id, color_name, diameter_mm);


--
-- Name: material_variants_diameter_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX material_variants_diameter_idx ON public.material_variants USING btree (diameter_mm);


--
-- Name: material_variants_material_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX material_variants_material_idx ON public.material_variants USING btree (material_id);


--
-- Name: materials_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX materials_kind_idx ON public.materials USING btree (kind);


--
-- Name: materials_material_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX materials_material_type_idx ON public.materials USING btree (material_type_id);


--
-- Name: materials_specs_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX materials_specs_gin_idx ON public.materials USING gin (specs jsonb_path_ops);


--
-- Name: materials_vendor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX materials_vendor_idx ON public.materials USING btree (vendor_id);


--
-- Name: model_download_log_ip_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_download_log_ip_idx ON public.model_download_log USING btree (ip_hash, created_at DESC) WHERE (ip_hash IS NOT NULL);


--
-- Name: model_download_log_model_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_download_log_model_idx ON public.model_download_log USING btree (model_id, created_at DESC);


--
-- Name: model_download_log_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_download_log_user_idx ON public.model_download_log USING btree (user_id, created_at DESC);


--
-- Name: model_embeddings_1024_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_embeddings_1024_hnsw_idx ON public.model_embeddings USING hnsw (embedding_1024 public.vector_cosine_ops) WHERE (embedding_1024 IS NOT NULL);


--
-- Name: model_embeddings_2048_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_embeddings_2048_hnsw_idx ON public.model_embeddings USING hnsw (embedding_2048 public.halfvec_cosine_ops) WHERE (embedding_2048 IS NOT NULL);


--
-- Name: model_embeddings_model_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_embeddings_model_idx ON public.model_embeddings USING btree (model_id);


--
-- Name: model_embeddings_profile_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_embeddings_profile_idx ON public.model_embeddings USING btree (embedding_model, embedding_version, index_status);


--
-- Name: model_meshes_model_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_meshes_model_idx ON public.model_meshes USING btree (model_id, "position");


--
-- Name: model_meshes_status_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_meshes_status_pending_idx ON public.model_meshes USING btree (status) WHERE (status = ANY (ARRAY['uploaded'::text, 'pending'::text, 'processing'::text]));


--
-- Name: model_revision_files_blob_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_revision_files_blob_idx ON public.model_revision_files USING btree (blob_id) WHERE (blob_id IS NOT NULL);


--
-- Name: model_revision_files_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_revision_files_revision_idx ON public.model_revision_files USING btree (model_revision_id);


--
-- Name: model_revision_files_singular_role_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX model_revision_files_singular_role_key ON public.model_revision_files USING btree (model_revision_id, role) WHERE (role = ANY (ARRAY['canonical_3mf'::text, 'preview'::text, 'thumbnail'::text, 'mobile_preview'::text, 'stl_derivative'::text]));


--
-- Name: model_revision_files_source_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX model_revision_files_source_key ON public.model_revision_files USING btree (model_revision_id) WHERE is_source;


--
-- Name: model_revisions_model_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_revisions_model_created_idx ON public.model_revisions USING btree (model_id, created_at DESC, id DESC);


--
-- Name: model_tags_tag_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_tags_tag_idx ON public.model_tags USING btree (tag_id);


--
-- Name: models_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX models_created_at_idx ON public.projects USING btree (created_at DESC);


--
-- Name: models_description_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX models_description_trgm_idx ON public.projects USING gin (description public.gin_trgm_ops);


--
-- Name: models_featured_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX models_featured_idx ON public.projects USING btree (featured_at DESC) WHERE (featured_at IS NOT NULL);


--
-- Name: models_forked_from_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX models_forked_from_idx ON public.projects USING btree (forked_from) WHERE (forked_from IS NOT NULL);


--
-- Name: models_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX models_owner_idx ON public.projects USING btree (owner_id, created_at DESC);


--
-- Name: models_popularity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX models_popularity_idx ON public.projects USING btree (((votes_up - votes_down)) DESC, created_at DESC);


--
-- Name: models_project_position_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX models_project_position_idx ON public.models USING btree (project_id, "position", id) WHERE (deleted_at IS NULL);


--
-- Name: models_recommended_material_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX models_recommended_material_idx ON public.projects USING btree (recommended_material_id) WHERE (recommended_material_id IS NOT NULL);


--
-- Name: models_repo_path_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX models_repo_path_pending_idx ON public.projects USING btree (created_at) WHERE (repo_path IS NULL);


--
-- Name: models_title_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX models_title_trgm_idx ON public.projects USING gin (title public.gin_trgm_ops);


--
-- Name: moderation_actions_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX moderation_actions_actor_idx ON public.moderation_actions USING btree (actor_user_id, created_at DESC);


--
-- Name: moderation_actions_one_reversal_per_source_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX moderation_actions_one_reversal_per_source_key ON public.moderation_actions USING btree (reverses_action_id) WHERE (reverses_action_id IS NOT NULL);


--
-- Name: moderation_actions_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX moderation_actions_queue_idx ON public.moderation_actions USING btree (scope, action, created_at DESC);


--
-- Name: moderation_actions_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX moderation_actions_target_idx ON public.moderation_actions USING btree (target_type, target_id, created_at DESC);


--
-- Name: order_events_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_events_order_idx ON public.order_events USING btree (order_id, created_at);


--
-- Name: orders_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_client_idx ON public.orders USING btree (client_id, created_at DESC);


--
-- Name: orders_master_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_master_idx ON public.orders USING btree (master_id, status, created_at DESC);


--
-- Name: outbox_events_available_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_events_available_idx ON public.outbox_events USING btree (available_at, created_at) WHERE ((completed_at IS NULL) AND (locked_at IS NULL));


--
-- Name: payment_webhook_events_purchase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_webhook_events_purchase_idx ON public.payment_webhook_events USING btree (purchase_id) WHERE (purchase_id IS NOT NULL);


--
-- Name: payouts_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payouts_user_idx ON public.payouts USING btree (user_id, created_at DESC);


--
-- Name: post_attachments_post_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX post_attachments_post_idx ON public.post_attachments USING btree (post_id, created_at);


--
-- Name: post_score_best_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX post_score_best_idx ON public.post_score USING btree (best DESC);


--
-- Name: post_score_controversial_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX post_score_controversial_idx ON public.post_score USING btree (controversial DESC);


--
-- Name: post_score_hot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX post_score_hot_idx ON public.post_score USING btree (hot DESC);


--
-- Name: posts_author_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX posts_author_idx ON public.posts USING btree (author_id, created_at DESC);


--
-- Name: posts_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX posts_thread_idx ON public.posts USING btree (thread_id, created_at);


--
-- Name: print_requests_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX print_requests_client_idx ON public.print_requests USING btree (client_id, created_at DESC);


--
-- Name: print_requests_master_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX print_requests_master_active_idx ON public.print_requests USING btree (master_id, created_at DESC) WHERE (status <> ALL (ARRAY['done'::text, 'rejected'::text]));


--
-- Name: print_requests_master_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX print_requests_master_history_idx ON public.print_requests USING btree (master_id, created_at DESC) WHERE (status = ANY (ARRAY['done'::text, 'rejected'::text]));


--
-- Name: printer_reports_pending_field_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX printer_reports_pending_field_idx ON public.printer_reports USING btree (printer_id, field) WHERE (status = 'pending'::text);


--
-- Name: printer_reports_printer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX printer_reports_printer_idx ON public.printer_reports USING btree (printer_id);


--
-- Name: printer_reports_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX printer_reports_status_idx ON public.printer_reports USING btree (status);


--
-- Name: printers_aliases_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX printers_aliases_gin ON public.printers USING gin (aliases);


--
-- Name: printers_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX printers_brand_idx ON public.printers USING btree (brand);


--
-- Name: printers_build_volume_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX printers_build_volume_idx ON public.printers USING btree (build_volume_x, build_volume_y, build_volume_z);


--
-- Name: printers_connector_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX printers_connector_type_idx ON public.printers USING btree (connector_type) WHERE (connector_type IS NOT NULL);


--
-- Name: printers_kinematics_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX printers_kinematics_idx ON public.printers USING btree (kinematics);


--
-- Name: printers_price_ru_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX printers_price_ru_idx ON public.printers USING btree (price_ru_rub);


--
-- Name: printers_price_usd_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX printers_price_usd_idx ON public.printers USING btree (price_msrp_usd);


--
-- Name: printers_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX printers_slug_idx ON public.printers USING btree (slug);


--
-- Name: printers_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX printers_status_idx ON public.printers USING btree (status);


--
-- Name: printers_support_level_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX printers_support_level_idx ON public.printers USING btree (support_level);


--
-- Name: printers_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX printers_type_idx ON public.printers USING btree (type);


--
-- Name: project_manifest_resolutions_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_manifest_resolutions_project_idx ON public.project_manifest_resolutions USING btree (project_id, resolved_at DESC);


--
-- Name: project_revisions_published_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_revisions_published_at_idx ON public.project_revisions USING btree (created_at DESC, project_id DESC);


--
-- Name: projects_owner_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX projects_owner_updated_idx ON public.projects USING btree (owner_id, updated_at DESC, id DESC) WHERE (deleted_at IS NULL);


--
-- Name: projects_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX projects_published_idx ON public.projects USING btree (published_revision_id, id) WHERE ((published_revision_id IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: purchases_buyer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchases_buyer_idx ON public.purchases USING btree (buyer_id, created_at DESC);


--
-- Name: purchases_buyer_model_paid_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX purchases_buyer_model_paid_uidx ON public.purchases USING btree (buyer_id, model_id) WHERE (status = 'paid'::text);


--
-- Name: purchases_model_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchases_model_idx ON public.purchases USING btree (model_id, created_at DESC);


--
-- Name: purchases_provider_payment_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX purchases_provider_payment_uidx ON public.purchases USING btree (provider, provider_payment_id) WHERE (provider_payment_id IS NOT NULL);


--
-- Name: purchases_seller_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchases_seller_idx ON public.purchases USING btree (seller_id, created_at DESC);


--
-- Name: push_subscriptions_endpoint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX push_subscriptions_endpoint_idx ON public.push_subscriptions USING btree (endpoint);


--
-- Name: push_subscriptions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions USING btree (user_id, created_at DESC);


--
-- Name: release_events_ship_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX release_events_ship_at_idx ON public.release_events USING btree (ship_at DESC);


--
-- Name: release_events_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX release_events_status_idx ON public.release_events USING btree (status);


--
-- Name: reports_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_subject_idx ON public.reports USING btree (subject_type, subject_id, status);


--
-- Name: reputation_events_answer_accept_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reputation_events_answer_accept_once_idx ON public.reputation_events USING btree (user_id, subject_id) WHERE (reason = 'answer_accepted'::text);


--
-- Name: reputation_events_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reputation_events_user_idx ON public.reputation_events USING btree (user_id, created_at DESC);


--
-- Name: search_index_jobs_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_index_jobs_claim_idx ON public.search_index_jobs USING btree (leased_until) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));


--
-- Name: search_index_jobs_correlation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_index_jobs_correlation_idx ON public.search_index_jobs USING btree (correlation_id);


--
-- Name: search_index_jobs_model_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_index_jobs_model_idx ON public.search_index_jobs USING btree (model_id);


--
-- Name: slice_cache_entries_last_used_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slice_cache_entries_last_used_idx ON public.slice_cache_entries USING btree (last_used_at);


--
-- Name: slice_cache_hits_account_model_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX slice_cache_hits_account_model_key ON public.slice_cache_hits USING btree (account_id, slice_key, user_id, model_id);


--
-- Name: slice_cache_hits_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slice_cache_hits_key_idx ON public.slice_cache_hits USING btree (account_id, slice_key);


--
-- Name: slice_cache_hits_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slice_cache_hits_user_idx ON public.slice_cache_hits USING btree (user_id, created_at DESC);


--
-- Name: slice_job_attempts_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slice_job_attempts_job_idx ON public.slice_job_attempts USING btree (slice_job_id);


--
-- Name: slice_job_plate_instances_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slice_job_plate_instances_job_idx ON public.slice_job_plate_instances USING btree (slice_job_id);


--
-- Name: slice_job_plate_instances_source_model_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slice_job_plate_instances_source_model_idx ON public.slice_job_plate_instances USING btree (source_model_id);


--
-- Name: slice_jobs_account_device_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slice_jobs_account_device_idx ON public.slice_jobs USING btree (account_id, device_id) WHERE ((account_id IS NOT NULL) AND (device_id IS NOT NULL));


--
-- Name: slice_jobs_account_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX slice_jobs_account_key_idx ON public.slice_jobs USING btree (account_id, slice_key, requested_by, model_id);


--
-- Name: slice_jobs_model_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slice_jobs_model_idx ON public.slice_jobs USING btree (model_id);


--
-- Name: slice_jobs_profile_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slice_jobs_profile_idx ON public.slice_jobs USING btree (profile_id);


--
-- Name: slice_jobs_requested_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slice_jobs_requested_by_idx ON public.slice_jobs USING btree (requested_by);


--
-- Name: slice_jobs_slice_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slice_jobs_slice_key_idx ON public.slice_jobs USING btree (slice_key) WHERE (slice_key IS NOT NULL);


--
-- Name: slice_jobs_status_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slice_jobs_status_pending_idx ON public.slice_jobs USING btree (created_at) WHERE (status = 'pending'::text);


--
-- Name: slicer_profile_calibrations_combo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slicer_profile_calibrations_combo_idx ON public.slicer_profile_calibrations USING btree (machine_id, material_id);


--
-- Name: slicer_profile_calibrations_make_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slicer_profile_calibrations_make_idx ON public.slicer_profile_calibrations USING btree (make_id) WHERE (make_id IS NOT NULL);


--
-- Name: slicer_profile_calibrations_profile_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slicer_profile_calibrations_profile_idx ON public.slicer_profile_calibrations USING btree (slicer_profile_id, created_at DESC);


--
-- Name: slicer_profile_calibrations_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slicer_profile_calibrations_user_idx ON public.slicer_profile_calibrations USING btree (user_id, created_at DESC);


--
-- Name: slicer_profile_candidates_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slicer_profile_candidates_status_idx ON public.slicer_profile_candidates USING btree (status, created_at);


--
-- Name: slicer_profiles_class_slicer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slicer_profiles_class_slicer_idx ON public.slicer_profiles USING btree (profile_class, slicer);


--
-- Name: slicer_profiles_content_hash_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX slicer_profiles_content_hash_uidx ON public.slicer_profiles USING btree (content_hash) WHERE (content_hash IS NOT NULL);


--
-- Name: slicer_profiles_inherits_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slicer_profiles_inherits_idx ON public.slicer_profiles USING btree (inherits_id) WHERE (inherits_id IS NOT NULL);


--
-- Name: slicer_profiles_machine_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slicer_profiles_machine_idx ON public.slicer_profiles USING btree (machine_id) WHERE (machine_id IS NOT NULL);


--
-- Name: slicer_profiles_material_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slicer_profiles_material_idx ON public.slicer_profiles USING btree (material_id) WHERE (material_id IS NOT NULL);


--
-- Name: slicer_profiles_params_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slicer_profiles_params_gin_idx ON public.slicer_profiles USING gin (params jsonb_path_ops);


--
-- Name: slicer_profiles_slicer_setting_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX slicer_profiles_slicer_setting_uidx ON public.slicer_profiles USING btree (slicer, setting_id) WHERE (setting_id IS NOT NULL);


--
-- Name: slicer_profiles_status_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slicer_profiles_status_review_idx ON public.slicer_profiles USING btree (status) WHERE (status = 'quarantined'::text);


--
-- Name: storage_blobs_owner_checksum_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX storage_blobs_owner_checksum_key ON public.storage_blobs USING btree (owner_id, checksum);


--
-- Name: storage_blobs_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX storage_blobs_owner_idx ON public.storage_blobs USING btree (owner_id, created_at DESC);


--
-- Name: taggings_tag_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX taggings_tag_idx ON public.taggings USING btree (tag_id);


--
-- Name: threads_author_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX threads_author_idx ON public.threads USING btree (author_id, created_at DESC);


--
-- Name: threads_community_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX threads_community_idx ON public.threads USING btree (community_id, created_at DESC);


--
-- Name: uploader_reputation_ledger_report_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uploader_reputation_ledger_report_idx ON public.uploader_reputation_ledger USING btree (report_id);


--
-- Name: uploader_reputation_ledger_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uploader_reputation_ledger_user_idx ON public.uploader_reputation_ledger USING btree (user_id, created_at DESC);


--
-- Name: user_achievements_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_achievements_user_idx ON public.user_achievements USING btree (user_id, granted_at DESC);


--
-- Name: user_api_keys_active_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_api_keys_active_expiry_idx ON public.user_api_keys USING btree (expires_at) WHERE ((status = 'active'::text) AND (expires_at IS NOT NULL));


--
-- Name: user_api_keys_key_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_api_keys_key_hash_idx ON public.user_api_keys USING btree (key_hash) WHERE (key_hash IS NOT NULL);


--
-- Name: user_api_keys_key_prefix_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_api_keys_key_prefix_idx ON public.user_api_keys USING btree (key_prefix);


--
-- Name: user_api_keys_research_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_api_keys_research_user_idx ON public.user_api_keys USING btree (user_id) WHERE (scope = 'research'::text);


--
-- Name: user_api_keys_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_api_keys_user_idx ON public.user_api_keys USING btree (user_id, created_at DESC);


--
-- Name: user_filaments_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_filaments_user_idx ON public.user_filaments USING btree (user_id, created_at DESC);


--
-- Name: user_follows_followee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_follows_followee_idx ON public.user_follows USING btree (followee_id);


--
-- Name: user_follows_follower_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_follows_follower_created_idx ON public.user_follows USING btree (follower_id, created_at DESC);


--
-- Name: user_materials_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_materials_user_idx ON public.user_materials USING btree (user_id, created_at DESC);


--
-- Name: user_printers_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_printers_agent_idx ON public.user_printers USING btree (agent_id) WHERE (agent_id IS NOT NULL);


--
-- Name: user_printers_catalog_printer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_printers_catalog_printer_idx ON public.user_printers USING btree (catalog_printer_id) WHERE (catalog_printer_id IS NOT NULL);


--
-- Name: user_printers_connection_ref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_printers_connection_ref_idx ON public.user_printers USING btree (connection_id, external_ref) WHERE (connection_id IS NOT NULL);


--
-- Name: user_printers_lan_endpoint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_printers_lan_endpoint_idx ON public.user_printers USING btree (user_id, id) WHERE (lan_endpoint IS NOT NULL);


--
-- Name: user_printers_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_printers_user_idx ON public.user_printers USING btree (user_id, created_at DESC);


--
-- Name: users_is_master_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_is_master_idx ON public.users USING btree (id) WHERE is_master;


--
-- Name: users_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_role_idx ON public.users USING btree (role) WHERE (role <> 'user'::text);


--
-- Name: vendor_claim_events_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendor_claim_events_claim_idx ON public.vendor_claim_events USING btree (claim_id);


--
-- Name: vendor_claims_claimant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendor_claims_claimant_idx ON public.vendor_claims USING btree (claimant_user_id);


--
-- Name: vendor_claims_pending_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX vendor_claims_pending_unique_idx ON public.vendor_claims USING btree (vendor_id, claimant_user_id) WHERE (status = 'pending'::text);


--
-- Name: vendor_claims_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendor_claims_status_idx ON public.vendor_claims USING btree (status);


--
-- Name: vendor_claims_vendor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendor_claims_vendor_idx ON public.vendor_claims USING btree (vendor_id);


--
-- Name: votes_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX votes_subject_idx ON public.votes USING btree (subject_type, subject_id);


--
-- Name: device_audit_log device_audit_log_correlation_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER device_audit_log_correlation_immutable BEFORE UPDATE ON public.device_audit_log FOR EACH ROW EXECUTE FUNCTION public.forbid_correlation_id_update();


--
-- Name: device_commands device_commands_correlation_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER device_commands_correlation_immutable BEFORE UPDATE ON public.device_commands FOR EACH ROW EXECUTE FUNCTION public.forbid_correlation_id_update();


--
-- Name: machine_candidates machine_candidates_set_ownership_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER machine_candidates_set_ownership_trigger BEFORE INSERT OR UPDATE OF source, owner, source_family ON public.machine_candidates FOR EACH ROW EXECUTE FUNCTION public.machine_candidates_set_ownership();


--
-- Name: model_revision_files model_files_blob_ready_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER model_files_blob_ready_trigger BEFORE INSERT OR UPDATE OF blob_id ON public.model_revision_files FOR EACH ROW EXECUTE FUNCTION public.ensure_ready_storage_blob();


--
-- Name: moderation_actions moderation_actions_guard_lifecycle_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER moderation_actions_guard_lifecycle_trigger BEFORE DELETE OR UPDATE ON public.moderation_actions FOR EACH ROW EXECUTE FUNCTION public.moderation_actions_guard_lifecycle();


--
-- Name: moderation_actions moderation_actions_require_reversed_source_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER moderation_actions_require_reversed_source_trigger BEFORE INSERT ON public.moderation_actions FOR EACH ROW EXECUTE FUNCTION public.moderation_actions_require_reversed_source();


--
-- Name: project_revision_models project_revision_models_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER project_revision_models_immutable BEFORE UPDATE ON public.project_revision_models FOR EACH ROW EXECUTE FUNCTION public.reject_project_publication_update();


--
-- Name: project_revisions project_revisions_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER project_revisions_immutable BEFORE UPDATE ON public.project_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_project_publication_update();


--
-- Name: agents agents_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: api_keys api_keys_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: artifact_cache artifact_cache_blob_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artifact_cache
    ADD CONSTRAINT artifact_cache_blob_id_fkey FOREIGN KEY (blob_id) REFERENCES public.storage_blobs(id);


--
-- Name: artifact_cache artifact_cache_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artifact_cache
    ADD CONSTRAINT artifact_cache_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: artifact_cache artifact_cache_source_blob_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artifact_cache
    ADD CONSTRAINT artifact_cache_source_blob_id_fkey FOREIGN KEY (source_blob_id) REFERENCES public.storage_blobs(id);


--
-- Name: assistant_messages assistant_messages_run_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_messages
    ADD CONSTRAINT assistant_messages_run_fkey FOREIGN KEY (run_id) REFERENCES public.assistant_runs(id) ON DELETE SET NULL;


--
-- Name: assistant_messages assistant_messages_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_messages
    ADD CONSTRAINT assistant_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.assistant_threads(id) ON DELETE CASCADE;


--
-- Name: assistant_run_events assistant_run_events_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_run_events
    ADD CONSTRAINT assistant_run_events_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.assistant_runs(id) ON DELETE CASCADE;


--
-- Name: assistant_runs assistant_runs_confirmed_generation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_runs
    ADD CONSTRAINT assistant_runs_confirmed_generation_id_fkey FOREIGN KEY (confirmed_generation_id) REFERENCES public.generations(id) ON DELETE SET NULL;


--
-- Name: assistant_runs assistant_runs_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_runs
    ADD CONSTRAINT assistant_runs_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.assistant_threads(id) ON DELETE CASCADE;


--
-- Name: assistant_runs assistant_runs_triggering_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_runs
    ADD CONSTRAINT assistant_runs_triggering_message_id_fkey FOREIGN KEY (triggering_message_id) REFERENCES public.assistant_messages(id) ON DELETE CASCADE;


--
-- Name: assistant_runs assistant_runs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_runs
    ADD CONSTRAINT assistant_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: assistant_thread_events assistant_thread_events_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_thread_events
    ADD CONSTRAINT assistant_thread_events_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.assistant_threads(id) ON DELETE CASCADE;


--
-- Name: assistant_threads assistant_threads_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_threads
    ADD CONSTRAINT assistant_threads_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.user_printers(id) ON DELETE SET NULL;


--
-- Name: assistant_threads assistant_threads_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_threads
    ADD CONSTRAINT assistant_threads_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: build_guides build_guides_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_guides
    ADD CONSTRAINT build_guides_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: build_session_revision_migrations build_session_revision_migrations_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_session_revision_migrations
    ADD CONSTRAINT build_session_revision_migrations_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: build_session_revision_migrations build_session_revision_migrations_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_session_revision_migrations
    ADD CONSTRAINT build_session_revision_migrations_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.build_sessions(id) ON DELETE CASCADE;


--
-- Name: build_session_revision_migrations build_session_revision_migrations_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_session_revision_migrations
    ADD CONSTRAINT build_session_revision_migrations_to_fkey FOREIGN KEY (model_id, to_commit_sha, to_configuration_id, to_configuration_digest) REFERENCES public.project_manifest_resolutions(project_id, commit_sha, configuration_id, configuration_digest);


--
-- Name: build_session_steps build_session_steps_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_session_steps
    ADD CONSTRAINT build_session_steps_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.build_sessions(id) ON DELETE CASCADE;


--
-- Name: build_sessions build_sessions_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_sessions
    ADD CONSTRAINT build_sessions_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: build_sessions build_sessions_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_sessions
    ADD CONSTRAINT build_sessions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: build_sessions build_sessions_revision_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_sessions
    ADD CONSTRAINT build_sessions_revision_fkey FOREIGN KEY (model_id, manifest_commit_sha, configuration_id, configuration_digest) REFERENCES public.project_manifest_resolutions(project_id, commit_sha, configuration_id, configuration_digest);


--
-- Name: build_step_photos build_step_photos_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_step_photos
    ADD CONSTRAINT build_step_photos_step_id_fkey FOREIGN KEY (step_id) REFERENCES public.build_steps(id) ON DELETE CASCADE;


--
-- Name: build_steps build_steps_guide_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_steps
    ADD CONSTRAINT build_steps_guide_id_fkey FOREIGN KEY (guide_id) REFERENCES public.build_guides(id) ON DELETE CASCADE;


--
-- Name: build_steps build_steps_mesh_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_steps
    ADD CONSTRAINT build_steps_mesh_id_fkey FOREIGN KEY (mesh_id) REFERENCES public.model_meshes(id) ON DELETE SET NULL;


--
-- Name: comments comments_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.comments(id) ON DELETE SET NULL;


--
-- Name: comments comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: communities communities_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communities
    ADD CONSTRAINT communities_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: community_firmware community_firmware_printer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_firmware
    ADD CONSTRAINT community_firmware_printer_id_fkey FOREIGN KEY (printer_id) REFERENCES public.printers(id) ON DELETE SET NULL;


--
-- Name: community_members community_members_community_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_members
    ADD CONSTRAINT community_members_community_id_fkey FOREIGN KEY (community_id) REFERENCES public.communities(id) ON DELETE CASCADE;


--
-- Name: community_members community_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_members
    ADD CONSTRAINT community_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: consent_records consent_records_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: content_agents content_agents_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_agents
    ADD CONSTRAINT content_agents_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: device_audit_log device_audit_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_audit_log
    ADD CONSTRAINT device_audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: device_audit_log device_audit_log_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_audit_log
    ADD CONSTRAINT device_audit_log_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.user_printers(id) ON DELETE CASCADE;


--
-- Name: device_command_counters device_command_counters_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_command_counters
    ADD CONSTRAINT device_command_counters_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.user_printers(id) ON DELETE CASCADE;


--
-- Name: device_commands device_commands_api_key_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_commands
    ADD CONSTRAINT device_commands_api_key_id_fkey FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE SET NULL;


--
-- Name: device_commands device_commands_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_commands
    ADD CONSTRAINT device_commands_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.user_printers(id) ON DELETE CASCADE;


--
-- Name: device_enroll_codes device_enroll_codes_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_enroll_codes
    ADD CONSTRAINT device_enroll_codes_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;


--
-- Name: device_enroll_codes device_enroll_codes_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_enroll_codes
    ADD CONSTRAINT device_enroll_codes_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.user_printers(id) ON DELETE SET NULL;


--
-- Name: device_enroll_codes device_enroll_codes_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_enroll_codes
    ADD CONSTRAINT device_enroll_codes_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: device_incidents device_incidents_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_incidents
    ADD CONSTRAINT device_incidents_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.user_printers(id) ON DELETE CASCADE;


--
-- Name: device_incidents device_incidents_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_incidents
    ADD CONSTRAINT device_incidents_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: device_incidents device_incidents_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_incidents
    ADD CONSTRAINT device_incidents_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.assistant_threads(id) ON DELETE CASCADE;


--
-- Name: device_jobs device_jobs_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_jobs
    ADD CONSTRAINT device_jobs_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.user_printers(id) ON DELETE CASCADE;


--
-- Name: device_jobs device_jobs_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_jobs
    ADD CONSTRAINT device_jobs_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.models(id) ON DELETE SET NULL;


--
-- Name: device_print_requests device_print_requests_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_print_requests
    ADD CONSTRAINT device_print_requests_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.user_printers(id) ON DELETE CASCADE;


--
-- Name: device_print_requests device_print_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_print_requests
    ADD CONSTRAINT device_print_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: device_print_requests device_print_requests_slice_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_print_requests
    ADD CONSTRAINT device_print_requests_slice_job_id_fkey FOREIGN KEY (slice_job_id) REFERENCES public.slice_jobs(id) ON DELETE CASCADE;


--
-- Name: device_print_requests device_print_requests_start_command_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_print_requests
    ADD CONSTRAINT device_print_requests_start_command_id_fkey FOREIGN KEY (start_command_id) REFERENCES public.device_commands(id) ON DELETE SET NULL;


--
-- Name: device_print_requests device_print_requests_transfer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_print_requests
    ADD CONSTRAINT device_print_requests_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.device_transfers(id) ON DELETE SET NULL;


--
-- Name: device_print_results device_print_results_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_print_results
    ADD CONSTRAINT device_print_results_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;


--
-- Name: device_print_results device_print_results_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_print_results
    ADD CONSTRAINT device_print_results_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.user_printers(id) ON DELETE CASCADE;


--
-- Name: device_print_results device_print_results_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_print_results
    ADD CONSTRAINT device_print_results_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.device_jobs(id) ON DELETE SET NULL;


--
-- Name: device_print_results device_print_results_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_print_results
    ADD CONSTRAINT device_print_results_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.models(id) ON DELETE SET NULL;


--
-- Name: device_reputation device_reputation_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_reputation
    ADD CONSTRAINT device_reputation_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.user_printers(id) ON DELETE CASCADE;


--
-- Name: device_shares device_shares_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_shares
    ADD CONSTRAINT device_shares_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.user_printers(id) ON DELETE CASCADE;


--
-- Name: device_shares device_shares_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_shares
    ADD CONSTRAINT device_shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: device_state device_state_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_state
    ADD CONSTRAINT device_state_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.user_printers(id) ON DELETE CASCADE;


--
-- Name: device_state device_state_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_state
    ADD CONSTRAINT device_state_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.device_jobs(id) ON DELETE SET NULL;


--
-- Name: device_telemetry device_telemetry_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_telemetry
    ADD CONSTRAINT device_telemetry_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.user_printers(id) ON DELETE CASCADE;


--
-- Name: device_transfers device_transfers_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_transfers
    ADD CONSTRAINT device_transfers_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: device_transfers device_transfers_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_transfers
    ADD CONSTRAINT device_transfers_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.user_printers(id) ON DELETE CASCADE;


--
-- Name: events events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: feed_events feed_events_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_events
    ADD CONSTRAINT feed_events_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.feed_posts(id) ON DELETE CASCADE;


--
-- Name: feed_events feed_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_events
    ADD CONSTRAINT feed_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: feed_post_images feed_post_images_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_post_images
    ADD CONSTRAINT feed_post_images_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.feed_posts(id) ON DELETE CASCADE;


--
-- Name: feed_post_revisions feed_post_revisions_edited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_post_revisions
    ADD CONSTRAINT feed_post_revisions_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES public.users(id);


--
-- Name: feed_post_revisions feed_post_revisions_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_post_revisions
    ADD CONSTRAINT feed_post_revisions_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.feed_posts(id) ON DELETE CASCADE;


--
-- Name: feed_post_saves feed_post_saves_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_post_saves
    ADD CONSTRAINT feed_post_saves_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.feed_posts(id) ON DELETE CASCADE;


--
-- Name: feed_post_saves feed_post_saves_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_post_saves
    ADD CONSTRAINT feed_post_saves_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: feed_posts feed_posts_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_posts
    ADD CONSTRAINT feed_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: feed_posts feed_posts_co_author_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_posts
    ADD CONSTRAINT feed_posts_co_author_agent_id_fkey FOREIGN KEY (co_author_agent_id) REFERENCES public.content_agents(id);


--
-- Name: feed_posts feed_posts_community_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_posts
    ADD CONSTRAINT feed_posts_community_id_fkey FOREIGN KEY (community_id) REFERENCES public.communities(id) ON DELETE SET NULL;


--
-- Name: feed_posts feed_posts_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_posts
    ADD CONSTRAINT feed_posts_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id) ON DELETE SET NULL;


--
-- Name: feed_posts feed_posts_make_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_posts
    ADD CONSTRAINT feed_posts_make_id_fkey FOREIGN KEY (make_id) REFERENCES public.makes(id) ON DELETE CASCADE;


--
-- Name: feed_posts feed_posts_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_posts
    ADD CONSTRAINT feed_posts_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: fleets fleets_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleets
    ADD CONSTRAINT fleets_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: generated_concepts generated_concepts_generation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_concepts
    ADD CONSTRAINT generated_concepts_generation_id_fkey FOREIGN KEY (generation_id) REFERENCES public.generations(id) ON DELETE CASCADE;


--
-- Name: generations_idempotency generations_idempotency_generation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generations_idempotency
    ADD CONSTRAINT generations_idempotency_generation_id_fkey FOREIGN KEY (generation_id) REFERENCES public.generations(id) ON DELETE SET NULL;


--
-- Name: generations_idempotency generations_idempotency_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generations_idempotency
    ADD CONSTRAINT generations_idempotency_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: generations generations_source_generation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generations
    ADD CONSTRAINT generations_source_generation_id_fkey FOREIGN KEY (source_generation_id) REFERENCES public.generations(id) ON DELETE SET NULL;


--
-- Name: generations generations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generations
    ADD CONSTRAINT generations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: idea_comments idea_comments_idea_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idea_comments
    ADD CONSTRAINT idea_comments_idea_id_fkey FOREIGN KEY (idea_id) REFERENCES public.ideas(id) ON DELETE CASCADE;


--
-- Name: idea_comments idea_comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idea_comments
    ADD CONSTRAINT idea_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: idea_enrichments idea_enrichments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idea_enrichments
    ADD CONSTRAINT idea_enrichments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: idea_notifications idea_notifications_idea_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idea_notifications
    ADD CONSTRAINT idea_notifications_idea_id_fkey FOREIGN KEY (idea_id) REFERENCES public.ideas(id) ON DELETE CASCADE;


--
-- Name: idea_notifications idea_notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idea_notifications
    ADD CONSTRAINT idea_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: idea_vote_log idea_vote_log_idea_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idea_vote_log
    ADD CONSTRAINT idea_vote_log_idea_id_fkey FOREIGN KEY (idea_id) REFERENCES public.ideas(id) ON DELETE CASCADE;


--
-- Name: idea_vote_log idea_vote_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idea_vote_log
    ADD CONSTRAINT idea_vote_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: idea_votes idea_votes_idea_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idea_votes
    ADD CONSTRAINT idea_votes_idea_id_fkey FOREIGN KEY (idea_id) REFERENCES public.ideas(id) ON DELETE CASCADE;


--
-- Name: idea_votes idea_votes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idea_votes
    ADD CONSTRAINT idea_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ideas ideas_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ideas
    ADD CONSTRAINT ideas_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: ideas ideas_canonical_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ideas
    ADD CONSTRAINT ideas_canonical_id_fkey FOREIGN KEY (canonical_id) REFERENCES public.ideas(id);


--
-- Name: idempotency_records idempotency_records_actor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_records
    ADD CONSTRAINT idempotency_records_actor_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: import_bindings import_bindings_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_bindings
    ADD CONSTRAINT import_bindings_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.import_connections(id) ON DELETE SET NULL;


--
-- Name: import_bindings import_bindings_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_bindings
    ADD CONSTRAINT import_bindings_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.models(id) ON DELETE CASCADE;


--
-- Name: import_bindings import_bindings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_bindings
    ADD CONSTRAINT import_bindings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: import_connections import_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_connections
    ADD CONSTRAINT import_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: import_job_items import_job_items_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_job_items
    ADD CONSTRAINT import_job_items_binding_id_fkey FOREIGN KEY (binding_id) REFERENCES public.import_bindings(id) ON DELETE SET NULL;


--
-- Name: import_job_items import_job_items_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_job_items
    ADD CONSTRAINT import_job_items_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.import_jobs(id) ON DELETE CASCADE;


--
-- Name: import_jobs import_jobs_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT import_jobs_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.import_connections(id) ON DELETE SET NULL;


--
-- Name: import_jobs import_jobs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT import_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ledger_entries ledger_entries_payout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES public.payouts(id) ON DELETE RESTRICT;


--
-- Name: ledger_entries ledger_entries_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.purchases(id) ON DELETE RESTRICT;


--
-- Name: ledger_entries ledger_entries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: machine_candidates machine_candidates_matched_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_candidates
    ADD CONSTRAINT machine_candidates_matched_machine_id_fkey FOREIGN KEY (matched_machine_id) REFERENCES public.machines(id);


--
-- Name: machine_material_profiles machine_material_profiles_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_material_profiles
    ADD CONSTRAINT machine_material_profiles_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id) ON DELETE CASCADE;


--
-- Name: machine_material_profiles machine_material_profiles_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_material_profiles
    ADD CONSTRAINT machine_material_profiles_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;


--
-- Name: machines machines_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machines
    ADD CONSTRAINT machines_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: make_materials make_materials_make_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.make_materials
    ADD CONSTRAINT make_materials_make_id_fkey FOREIGN KEY (make_id) REFERENCES public.makes(id) ON DELETE CASCADE;


--
-- Name: make_materials make_materials_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.make_materials
    ADD CONSTRAINT make_materials_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE RESTRICT;


--
-- Name: make_photo_hashes make_photo_hashes_make_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.make_photo_hashes
    ADD CONSTRAINT make_photo_hashes_make_id_fkey FOREIGN KEY (make_id) REFERENCES public.makes(id) ON DELETE CASCADE;


--
-- Name: make_photo_hashes make_photo_hashes_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.make_photo_hashes
    ADD CONSTRAINT make_photo_hashes_photo_id_fkey FOREIGN KEY (photo_id) REFERENCES public.make_photos(id) ON DELETE CASCADE;


--
-- Name: make_photos make_photos_make_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.make_photos
    ADD CONSTRAINT make_photos_make_id_fkey FOREIGN KEY (make_id) REFERENCES public.makes(id) ON DELETE CASCADE;


--
-- Name: maker_profiles maker_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maker_profiles
    ADD CONSTRAINT maker_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: makes makes_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.makes
    ADD CONSTRAINT makes_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id) ON DELETE SET NULL NOT VALID;


--
-- Name: makes makes_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.makes
    ADD CONSTRAINT makes_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: makes makes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.makes
    ADD CONSTRAINT makes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: master_equipment master_equipment_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_equipment
    ADD CONSTRAINT master_equipment_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id);


--
-- Name: master_equipment master_equipment_master_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_equipment
    ADD CONSTRAINT master_equipment_master_id_fkey FOREIGN KEY (master_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: master_equipment_materials master_equipment_materials_master_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_equipment_materials
    ADD CONSTRAINT master_equipment_materials_master_equipment_id_fkey FOREIGN KEY (master_equipment_id) REFERENCES public.master_equipment(id) ON DELETE CASCADE;


--
-- Name: master_equipment_materials master_equipment_materials_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_equipment_materials
    ADD CONSTRAINT master_equipment_materials_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;


--
-- Name: master_service_materials master_service_materials_master_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_service_materials
    ADD CONSTRAINT master_service_materials_master_service_id_fkey FOREIGN KEY (master_service_id) REFERENCES public.master_services(id) ON DELETE CASCADE;


--
-- Name: master_service_materials master_service_materials_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_service_materials
    ADD CONSTRAINT master_service_materials_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;


--
-- Name: master_services master_services_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_services
    ADD CONSTRAINT master_services_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id) ON DELETE SET NULL;


--
-- Name: master_services master_services_master_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_services
    ADD CONSTRAINT master_services_master_id_fkey FOREIGN KEY (master_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: material_candidates material_candidates_matched_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_candidates
    ADD CONSTRAINT material_candidates_matched_material_id_fkey FOREIGN KEY (matched_material_id) REFERENCES public.materials(id);


--
-- Name: material_variant_offers material_variant_offers_material_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_variant_offers
    ADD CONSTRAINT material_variant_offers_material_variant_id_fkey FOREIGN KEY (material_variant_id) REFERENCES public.material_variants(id) ON DELETE CASCADE;


--
-- Name: material_variants material_variants_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_variants
    ADD CONSTRAINT material_variants_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;


--
-- Name: materials materials_material_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_material_type_id_fkey FOREIGN KEY (material_type_id) REFERENCES public.material_types(id) ON DELETE RESTRICT;


--
-- Name: materials materials_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE RESTRICT;


--
-- Name: model_download_log model_download_log_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_download_log
    ADD CONSTRAINT model_download_log_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: model_download_log model_download_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_download_log
    ADD CONSTRAINT model_download_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: model_embeddings model_embeddings_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_embeddings
    ADD CONSTRAINT model_embeddings_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: model_meshes model_meshes_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_meshes
    ADD CONSTRAINT model_meshes_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.models(id) ON DELETE CASCADE;


--
-- Name: model_revision_files model_revision_files_blob_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_revision_files
    ADD CONSTRAINT model_revision_files_blob_fkey FOREIGN KEY (blob_id) REFERENCES public.storage_blobs(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: model_revision_files model_revision_files_revision_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_revision_files
    ADD CONSTRAINT model_revision_files_revision_fkey FOREIGN KEY (model_revision_id) REFERENCES public.model_revisions(id) ON DELETE CASCADE;


--
-- Name: model_revisions model_revisions_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_revisions
    ADD CONSTRAINT model_revisions_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.models(id) ON DELETE CASCADE;


--
-- Name: model_tags model_tags_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_tags
    ADD CONSTRAINT model_tags_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: model_tags model_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_tags
    ADD CONSTRAINT model_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: model_view_log model_view_log_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_view_log
    ADD CONSTRAINT model_view_log_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: model_view_log model_view_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_view_log
    ADD CONSTRAINT model_view_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: model_votes model_votes_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_votes
    ADD CONSTRAINT model_votes_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: model_votes model_votes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_votes
    ADD CONSTRAINT model_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: models models_active_revision_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.models
    ADD CONSTRAINT models_active_revision_fkey FOREIGN KEY (id, active_revision_id) REFERENCES public.model_revisions(model_id, id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: projects models_forked_from_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT models_forked_from_fkey FOREIGN KEY (forked_from) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: models models_latest_revision_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.models
    ADD CONSTRAINT models_latest_revision_fkey FOREIGN KEY (id, latest_revision_id) REFERENCES public.model_revisions(model_id, id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: projects models_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT models_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: models models_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.models
    ADD CONSTRAINT models_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: projects models_recommended_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT models_recommended_material_id_fkey FOREIGN KEY (recommended_material_id) REFERENCES public.materials(id) ON DELETE SET NULL;


--
-- Name: moderation_actions moderation_actions_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: moderation_actions moderation_actions_reversed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: moderation_actions moderation_actions_reverses_action_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_reverses_action_id_fkey FOREIGN KEY (reverses_action_id) REFERENCES public.moderation_actions(id) ON DELETE RESTRICT;


--
-- Name: order_events order_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: order_events order_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: orders orders_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.users(id);


--
-- Name: orders orders_master_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_master_id_fkey FOREIGN KEY (master_id) REFERENCES public.users(id);


--
-- Name: orders orders_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: organization_members organization_members_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id);


--
-- Name: organization_members organization_members_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_members organization_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: organizations organizations_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: payment_webhook_events payment_webhook_events_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_webhook_events
    ADD CONSTRAINT payment_webhook_events_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.purchases(id) ON DELETE SET NULL;


--
-- Name: payouts payouts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: post_attachments post_attachments_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_attachments
    ADD CONSTRAINT post_attachments_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: post_attachments post_attachments_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_attachments
    ADD CONSTRAINT post_attachments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_score post_score_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_score
    ADD CONSTRAINT post_score_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.feed_posts(id) ON DELETE CASCADE;


--
-- Name: posts posts_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: posts posts_parent_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_parent_post_id_fkey FOREIGN KEY (parent_post_id) REFERENCES public.posts(id) ON DELETE SET NULL;


--
-- Name: posts posts_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE CASCADE;


--
-- Name: print_requests print_requests_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_requests
    ADD CONSTRAINT print_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: print_requests print_requests_master_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_requests
    ADD CONSTRAINT print_requests_master_id_fkey FOREIGN KEY (master_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: print_requests print_requests_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_requests
    ADD CONSTRAINT print_requests_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE SET NULL;


--
-- Name: print_requests print_requests_material_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_requests
    ADD CONSTRAINT print_requests_material_variant_id_fkey FOREIGN KEY (material_variant_id) REFERENCES public.material_variants(id) ON DELETE SET NULL;


--
-- Name: print_requests print_requests_model_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_requests
    ADD CONSTRAINT print_requests_model_file_id_fkey FOREIGN KEY (model_file_id) REFERENCES public.model_revision_files(id) ON DELETE SET NULL;


--
-- Name: print_requests print_requests_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_requests
    ADD CONSTRAINT print_requests_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: printer_connections printer_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.printer_connections
    ADD CONSTRAINT printer_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: printer_reports printer_reports_printer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.printer_reports
    ADD CONSTRAINT printer_reports_printer_id_fkey FOREIGN KEY (printer_id) REFERENCES public.printers(id) ON DELETE CASCADE;


--
-- Name: printer_reports printer_reports_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.printer_reports
    ADD CONSTRAINT printer_reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id);


--
-- Name: project_manifest_resolutions project_manifest_resolutions_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_manifest_resolutions
    ADD CONSTRAINT project_manifest_resolutions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_revision_models project_revision_models_model_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_revision_models
    ADD CONSTRAINT project_revision_models_model_fkey FOREIGN KEY (project_id, model_id) REFERENCES public.models(project_id, id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: project_revision_models project_revision_models_model_revision_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_revision_models
    ADD CONSTRAINT project_revision_models_model_revision_fkey FOREIGN KEY (model_id, model_revision_id) REFERENCES public.model_revisions(model_id, id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: project_revision_models project_revision_models_project_revision_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_revision_models
    ADD CONSTRAINT project_revision_models_project_revision_fkey FOREIGN KEY (project_id, project_revision_id) REFERENCES public.project_revisions(project_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: project_revisions project_revisions_primary_model_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_revisions
    ADD CONSTRAINT project_revisions_primary_model_fkey FOREIGN KEY (project_id, primary_model_id) REFERENCES public.models(project_id, id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: project_revisions project_revisions_project_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_revisions
    ADD CONSTRAINT project_revisions_project_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;


--
-- Name: projects projects_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: projects projects_primary_model_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_primary_model_fkey FOREIGN KEY (id, primary_model_id) REFERENCES public.models(project_id, id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: projects projects_published_revision_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_published_revision_fkey FOREIGN KEY (id, published_revision_id) REFERENCES public.project_revisions(project_id, id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: purchases purchases_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: purchases purchases_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.projects(id) ON DELETE RESTRICT;


--
-- Name: purchases purchases_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: push_preferences push_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_preferences
    ADD CONSTRAINT push_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: release_events release_events_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_events
    ADD CONSTRAINT release_events_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id);


--
-- Name: release_events release_events_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_events
    ADD CONSTRAINT release_events_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: reports reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reports reports_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: reputation_events reputation_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reputation_events
    ADD CONSTRAINT reputation_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: search_index_jobs search_index_jobs_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_index_jobs
    ADD CONSTRAINT search_index_jobs_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: slice_cache_entries slice_cache_entries_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_cache_entries
    ADD CONSTRAINT slice_cache_entries_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.users(id);


--
-- Name: slice_cache_entries slice_cache_entries_first_slice_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_cache_entries
    ADD CONSTRAINT slice_cache_entries_first_slice_job_id_fkey FOREIGN KEY (first_slice_job_id) REFERENCES public.slice_jobs(id);


--
-- Name: slice_cache_hits slice_cache_hits_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_cache_hits
    ADD CONSTRAINT slice_cache_hits_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.users(id);


--
-- Name: slice_cache_hits slice_cache_hits_account_id_slice_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_cache_hits
    ADD CONSTRAINT slice_cache_hits_account_id_slice_key_fkey FOREIGN KEY (account_id, slice_key) REFERENCES public.slice_cache_entries(account_id, slice_key);


--
-- Name: slice_cache_hits slice_cache_hits_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_cache_hits
    ADD CONSTRAINT slice_cache_hits_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.models(id);


--
-- Name: slice_cache_hits slice_cache_hits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_cache_hits
    ADD CONSTRAINT slice_cache_hits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: slice_job_attempts slice_job_attempts_slice_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_job_attempts
    ADD CONSTRAINT slice_job_attempts_slice_job_id_fkey FOREIGN KEY (slice_job_id) REFERENCES public.slice_jobs(id) ON DELETE CASCADE;


--
-- Name: slice_job_plate_instances slice_job_plate_instances_slice_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_job_plate_instances
    ADD CONSTRAINT slice_job_plate_instances_slice_job_id_fkey FOREIGN KEY (slice_job_id) REFERENCES public.slice_jobs(id) ON DELETE CASCADE;


--
-- Name: slice_job_plate_instances slice_job_plate_instances_source_build_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_job_plate_instances
    ADD CONSTRAINT slice_job_plate_instances_source_build_session_id_fkey FOREIGN KEY (source_build_session_id) REFERENCES public.build_sessions(id);


--
-- Name: slice_job_plate_instances slice_job_plate_instances_source_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_job_plate_instances
    ADD CONSTRAINT slice_job_plate_instances_source_model_id_fkey FOREIGN KEY (source_model_id) REFERENCES public.models(id);


--
-- Name: slice_jobs slice_jobs_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_jobs
    ADD CONSTRAINT slice_jobs_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.users(id);


--
-- Name: slice_jobs slice_jobs_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_jobs
    ADD CONSTRAINT slice_jobs_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.user_printers(id);


--
-- Name: slice_jobs slice_jobs_filament_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_jobs
    ADD CONSTRAINT slice_jobs_filament_profile_id_fkey FOREIGN KEY (filament_profile_id) REFERENCES public.slicer_profiles(id);


--
-- Name: slice_jobs slice_jobs_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_jobs
    ADD CONSTRAINT slice_jobs_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.models(id);


--
-- Name: slice_jobs slice_jobs_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_jobs
    ADD CONSTRAINT slice_jobs_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.slicer_profiles(id);


--
-- Name: slice_jobs slice_jobs_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_jobs
    ADD CONSTRAINT slice_jobs_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: slice_reputation slice_reputation_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slice_reputation
    ADD CONSTRAINT slice_reputation_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: slicer_profile_calibrations slicer_profile_calibrations_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slicer_profile_calibrations
    ADD CONSTRAINT slicer_profile_calibrations_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id);


--
-- Name: slicer_profile_calibrations slicer_profile_calibrations_make_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slicer_profile_calibrations
    ADD CONSTRAINT slicer_profile_calibrations_make_id_fkey FOREIGN KEY (make_id) REFERENCES public.makes(id) ON DELETE SET NULL;


--
-- Name: slicer_profile_calibrations slicer_profile_calibrations_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slicer_profile_calibrations
    ADD CONSTRAINT slicer_profile_calibrations_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id);


--
-- Name: slicer_profile_calibrations slicer_profile_calibrations_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slicer_profile_calibrations
    ADD CONSTRAINT slicer_profile_calibrations_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.models(id) ON DELETE SET NULL;


--
-- Name: slicer_profile_calibrations slicer_profile_calibrations_slicer_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slicer_profile_calibrations
    ADD CONSTRAINT slicer_profile_calibrations_slicer_profile_id_fkey FOREIGN KEY (slicer_profile_id) REFERENCES public.slicer_profiles(id) ON DELETE CASCADE;


--
-- Name: slicer_profile_calibrations slicer_profile_calibrations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slicer_profile_calibrations
    ADD CONSTRAINT slicer_profile_calibrations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: slicer_profile_candidates slicer_profile_candidates_matched_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slicer_profile_candidates
    ADD CONSTRAINT slicer_profile_candidates_matched_profile_id_fkey FOREIGN KEY (matched_profile_id) REFERENCES public.slicer_profiles(id);


--
-- Name: slicer_profiles slicer_profiles_extrapolated_from_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slicer_profiles
    ADD CONSTRAINT slicer_profiles_extrapolated_from_id_fkey FOREIGN KEY (extrapolated_from_id) REFERENCES public.slicer_profiles(id);


--
-- Name: slicer_profiles slicer_profiles_inherits_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slicer_profiles
    ADD CONSTRAINT slicer_profiles_inherits_id_fkey FOREIGN KEY (inherits_id) REFERENCES public.slicer_profiles(id);


--
-- Name: slicer_profiles slicer_profiles_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slicer_profiles
    ADD CONSTRAINT slicer_profiles_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id);


--
-- Name: slicer_profiles slicer_profiles_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slicer_profiles
    ADD CONSTRAINT slicer_profiles_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id);


--
-- Name: slicer_profiles slicer_profiles_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slicer_profiles
    ADD CONSTRAINT slicer_profiles_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: storage_blobs storage_blobs_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_blobs
    ADD CONSTRAINT storage_blobs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: taggings taggings_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taggings
    ADD CONSTRAINT taggings_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: threads threads_accepted_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_accepted_post_id_fkey FOREIGN KEY (accepted_post_id) REFERENCES public.posts(id) ON DELETE SET NULL;


--
-- Name: threads threads_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: threads threads_community_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_community_id_fkey FOREIGN KEY (community_id) REFERENCES public.communities(id) ON DELETE CASCADE;


--
-- Name: uploader_reputation_ledger uploader_reputation_ledger_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploader_reputation_ledger
    ADD CONSTRAINT uploader_reputation_ledger_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE RESTRICT;


--
-- Name: uploader_reputation_ledger uploader_reputation_ledger_staff_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploader_reputation_ledger
    ADD CONSTRAINT uploader_reputation_ledger_staff_actor_id_fkey FOREIGN KEY (staff_actor_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: uploader_reputation_ledger uploader_reputation_ledger_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploader_reputation_ledger
    ADD CONSTRAINT uploader_reputation_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_achievements user_achievements_achievement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_achievements
    ADD CONSTRAINT user_achievements_achievement_id_fkey FOREIGN KEY (achievement_id) REFERENCES public.achievements(id) ON DELETE CASCADE;


--
-- Name: user_achievements user_achievements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_achievements
    ADD CONSTRAINT user_achievements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_activation user_activation_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activation
    ADD CONSTRAINT user_activation_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_api_keys user_api_keys_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_api_keys
    ADD CONSTRAINT user_api_keys_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.content_agents(id) ON DELETE CASCADE;


--
-- Name: user_api_keys user_api_keys_rotated_from_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_api_keys
    ADD CONSTRAINT user_api_keys_rotated_from_id_fkey FOREIGN KEY (rotated_from_id) REFERENCES public.user_api_keys(id) ON DELETE SET NULL;


--
-- Name: user_api_keys user_api_keys_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_api_keys
    ADD CONSTRAINT user_api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_avatar user_avatar_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_avatar
    ADD CONSTRAINT user_avatar_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_filaments user_filaments_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_filaments
    ADD CONSTRAINT user_filaments_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;


--
-- Name: user_filaments user_filaments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_filaments
    ADD CONSTRAINT user_filaments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_filaments user_filaments_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_filaments
    ADD CONSTRAINT user_filaments_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.material_variants(id) ON DELETE SET NULL;


--
-- Name: user_follows user_follows_followee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_follows
    ADD CONSTRAINT user_follows_followee_id_fkey FOREIGN KEY (followee_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_follows user_follows_follower_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_follows
    ADD CONSTRAINT user_follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_identities user_identities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_materials user_materials_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_materials
    ADD CONSTRAINT user_materials_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;


--
-- Name: user_materials user_materials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_materials
    ADD CONSTRAINT user_materials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_materials user_materials_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_materials
    ADD CONSTRAINT user_materials_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.material_variants(id) ON DELETE SET NULL;


--
-- Name: user_password_credentials user_password_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_password_credentials
    ADD CONSTRAINT user_password_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_printers user_printers_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_printers
    ADD CONSTRAINT user_printers_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;


--
-- Name: user_printers user_printers_catalog_printer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_printers
    ADD CONSTRAINT user_printers_catalog_printer_id_fkey FOREIGN KEY (catalog_printer_id) REFERENCES public.printers(id);


--
-- Name: user_printers user_printers_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_printers
    ADD CONSTRAINT user_printers_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.printer_connections(id) ON DELETE CASCADE;


--
-- Name: user_printers user_printers_fleet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_printers
    ADD CONSTRAINT user_printers_fleet_id_fkey FOREIGN KEY (fleet_id) REFERENCES public.fleets(id) ON DELETE SET NULL;


--
-- Name: user_printers user_printers_printer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_printers
    ADD CONSTRAINT user_printers_printer_id_fkey FOREIGN KEY (printer_id) REFERENCES public.machines(id) NOT VALID;


--
-- Name: user_printers user_printers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_printers
    ADD CONSTRAINT user_printers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_printers user_printers_zone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_printers
    ADD CONSTRAINT user_printers_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.zones(id) ON DELETE SET NULL;


--
-- Name: user_uploader_reputation user_uploader_reputation_last_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_uploader_reputation
    ADD CONSTRAINT user_uploader_reputation_last_model_id_fkey FOREIGN KEY (last_model_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: user_uploader_reputation user_uploader_reputation_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_uploader_reputation
    ADD CONSTRAINT user_uploader_reputation_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: vendor_claim_events vendor_claim_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_claim_events
    ADD CONSTRAINT vendor_claim_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: vendor_claim_events vendor_claim_events_claim_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_claim_events
    ADD CONSTRAINT vendor_claim_events_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.vendor_claims(id) ON DELETE CASCADE;


--
-- Name: vendor_claims vendor_claims_claimant_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_claims
    ADD CONSTRAINT vendor_claims_claimant_user_id_fkey FOREIGN KEY (claimant_user_id) REFERENCES public.users(id);


--
-- Name: vendor_claims vendor_claims_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_claims
    ADD CONSTRAINT vendor_claims_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: vendor_claims vendor_claims_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_claims
    ADD CONSTRAINT vendor_claims_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: vendor_claims vendor_claims_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_claims
    ADD CONSTRAINT vendor_claims_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: votes votes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: wardrobe_rewards wardrobe_rewards_achievement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wardrobe_rewards
    ADD CONSTRAINT wardrobe_rewards_achievement_id_fkey FOREIGN KEY (achievement_id) REFERENCES public.achievements(id) ON DELETE CASCADE;


--
-- Name: zones zones_fleet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT zones_fleet_id_fkey FOREIGN KEY (fleet_id) REFERENCES public.fleets(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--



-- migrate:down
do $$
begin
  if exists (select 1 from public.users limit 1) or exists (select 1 from public.projects limit 1) or exists (select 1 from public.models limit 1) then
    raise exception using errcode = '55000', message = 'project_api_v1_baseline_rollback_requires_empty_target';
  end if;
end $$;

drop schema public cascade;
create schema public;
create table public.schema_migrations (version character varying not null primary key);
