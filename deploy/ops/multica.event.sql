-- Event outbox for local Multica automations. Vendor tables remain authoritative;
-- these triggers only append compact facts and can be removed independently.
create table if not exists multica_event_outbox (
  id bigserial primary key,
  workspace_id uuid,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists multica_event_outbox_pending_idx
  on multica_event_outbox(id) where processed_at is null;

create table if not exists multica_event_router_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists multica_event_fire_log (
  endpoint text not null,
  fingerprint text not null,
  fired_at timestamptz not null default now(),
  status text not null default 'reserved',
  error text,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  primary key(endpoint, fingerprint)
);
alter table multica_event_fire_log add column if not exists attempts integer not null default 0;
alter table multica_event_fire_log add column if not exists next_attempt_at timestamptz;

-- Durable intent queue. Vendor task rows are short-lived execution attempts:
-- Multica's sweeper expires stale queued rows. This table preserves the card
-- intent and lets the event router materialize a new attempt only when the
-- daemon has free capacity.
create table if not exists multica_recovery_queue (
  issue_id uuid primary key references issue(id) on delete cascade,
  source_task_id uuid references agent_task_queue(id) on delete set null,
  reason text not null,
  priority text,
  status text not null default 'waiting',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  dispatched_at timestamptz,
  completed_at timestamptz
);
create index if not exists multica_recovery_queue_waiting_idx
  on multica_recovery_queue(status, updated_at) where status='waiting';

create or replace function multica_fill_task_terminal_reason() returns trigger language plpgsql as $$
begin
  if new.status in ('failed','cancelled') and nullif(new.failure_reason,'') is null then
    new.failure_reason=case when new.status='cancelled' then 'cancelled_unspecified' else 'failed_unspecified' end;
  end if;
  return new;
end $$;
drop trigger if exists trg_multica_task_terminal_reason on agent_task_queue;
create trigger trg_multica_task_terminal_reason before update of status on agent_task_queue
for each row execute function multica_fill_task_terminal_reason();

create or replace function multica_emit_issue_event() returns trigger language plpgsql as $$
declare p jsonb;
begin
  if tg_op = 'INSERT' then
    p=jsonb_build_object('issue_id',new.id,'number',new.number,'title',new.title,
      'status',new.status,'priority',new.priority,'assignee_id',new.assignee_id,
      'project_id',new.project_id,'parent_issue_id',new.parent_issue_id,'due_date',new.due_date,
      'acceptance_count',jsonb_array_length(new.acceptance_criteria));
    insert into multica_event_outbox(workspace_id,kind,payload) values(new.workspace_id,'issue_created',p);
  elsif row(old.status,old.assignee_id,old.project_id,old.parent_issue_id,old.due_date,old.priority)
     is distinct from row(new.status,new.assignee_id,new.project_id,new.parent_issue_id,new.due_date,new.priority) then
    p=jsonb_build_object('issue_id',new.id,'number',new.number,'title',new.title,
      'old_status',old.status,'status',new.status,'priority',new.priority,
      'old_assignee_id',old.assignee_id,'assignee_id',new.assignee_id,
      'project_id',new.project_id,'parent_issue_id',new.parent_issue_id,'due_date',new.due_date,
      'acceptance_count',jsonb_array_length(new.acceptance_criteria));
    insert into multica_event_outbox(workspace_id,kind,payload) values(new.workspace_id,'issue_changed',p);
  end if;
  perform pg_notify('multica_event',coalesce(new.workspace_id::text,''));
  return new;
end $$;

drop trigger if exists trg_multica_issue_event on issue;
create trigger trg_multica_issue_event after insert or update on issue
for each row execute function multica_emit_issue_event();

create or replace function multica_emit_task_event() returns trigger language plpgsql as $$
declare w uuid; n integer; title text;
begin
  if old.status is distinct from new.status and new.status in ('completed','failed','cancelled') then
    select i.workspace_id,i.number,i.title into w,n,title from issue i where i.id=new.issue_id;
    insert into multica_event_outbox(workspace_id,kind,payload) values(w,'task_terminal',
      jsonb_build_object('task_id',new.id,'agent_id',new.agent_id,'issue_id',new.issue_id,
        'number',n,'title',title,'status',new.status,'attempt',new.attempt,'runtime_id',new.runtime_id,
        'failure_reason',coalesce(nullif(new.failure_reason,''),
          case when new.status='cancelled' then 'cancelled_unspecified'
               when new.status='failed' then 'failed_unspecified' else null end),
        'error',left(coalesce(new.error,''),1200),'trigger_summary',left(coalesce(new.trigger_summary,''),1200),
        'created_at',new.created_at,'started_at',new.started_at,'completed_at',new.completed_at));
    perform pg_notify('multica_event',coalesce(w::text,''));
  end if;
  return new;
end $$;

drop trigger if exists trg_multica_task_event on agent_task_queue;
create trigger trg_multica_task_event after update of status on agent_task_queue
for each row execute function multica_emit_task_event();
