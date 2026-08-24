#!/usr/bin/env python3
"""Translate board/Git/deploy/quota state transitions into Multica webhooks."""
import argparse, datetime, hashlib, json, os, pathlib, re, select, subprocess, sys, time, urllib.error, urllib.request

try:
    import psycopg2
    from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
except ImportError:
    raise SystemExit("python3-psycopg2 is required")

CONFIG=pathlib.Path(os.getenv("MULTICA_EVENT_CONFIG","/home/plag/.config/multica-event-router.json"))
DEPLOY_STATE=pathlib.Path("/home/plag/.local/state/multica-event-deploy.json")
QUOTA_STATE=pathlib.Path("/home/plag/.local/state/multica-event-quota.json")
REPO=pathlib.Path("/home/plag/portal.ru-dev")
MARKERS=pathlib.Path("/home/plag/.local/state/portal-deploy-dev")
DSN=os.getenv("MULTICA_DB_DSN")
FIRE_RESERVATION_TTL=300
MAX_ACTIVE_TASKS=int(os.getenv("MULTICA_MAX_ACTIVE_TASKS","2"))
MAX_RECOVERY_ATTEMPTS=int(os.getenv("MULTICA_MAX_RECOVERY_ATTEMPTS","3"))
MAX_QUEUED_TASKS=int(os.getenv("MULTICA_MAX_QUEUED_TASKS","8"))
ADMISSION_BATCH=int(os.getenv("MULTICA_ADMISSION_BATCH","50"))
_fire_failed=False

def sh(*args): return subprocess.run(args,text=True,capture_output=True,check=False)
def load(path,default=None):
    try: return json.loads(path.read_text())
    except Exception: return {} if default is None else default
def atomic(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+".tmp"); tmp.write_text(json.dumps(value,ensure_ascii=False)); tmp.replace(path)
def db(): return psycopg2.connect(DSN)
def query(sql,args=(),one=False):
    with db() as c:
        with c.cursor() as q:
            q.execute(sql,args)
            rows=q.fetchall() if q.description else []
    return (rows[0] if rows else None) if one else rows
def state_get(key,default):
    row=query("select value from multica_event_router_state where key=%s",(key,),True)
    return row[0] if row else default
def state_set(key,value):
    query("insert into multica_event_router_state(key,value) values(%s,%s::jsonb) on conflict(key) do update set value=excluded.value,updated_at=now()",(key,json.dumps(value,ensure_ascii=False)))
def card(p): return {k:p.get(k) for k in ("issue_id","number","title","status","old_status","priority","due_date")}
def active_task_count():
    row=query("select count(*) from agent_task_queue where status in ('queued','dispatched','preparing','running')",one=True)
    return int(row[0] if row else 0)

def recovery_waiting_count():
    row=query("""select count(*) from multica_recovery_queue r
                 join issue i on i.id=r.issue_id
                 where r.status in ('waiting','dispatching','dispatched')
                   and i.assignee_id is not null
                   and ((r.reason='admission_deferred' and i.status in ('todo','in_progress','in_review'))
                     or (r.reason<>'admission_deferred' and i.status in ('todo','in_progress')))""",one=True)
    return int(row[0] if row else 0)

def enqueue_recovery(p):
    if not p.get("issue_id") or not p.get("task_id"): return
    reason=p.get("failure_reason") or p.get("error") or "failed_unspecified"
    query("""insert into multica_recovery_queue(issue_id,source_task_id,reason,priority,status,updated_at,last_error)
             select i.id,%s,%s,i.priority,'waiting',now(),null from issue i
             where i.id=%s and i.status in ('todo','in_progress') and i.assignee_id is not null
             on conflict(issue_id) do update set source_task_id=excluded.source_task_id,
               reason=excluded.reason,priority=excluded.priority,status='waiting',
               updated_at=now(),last_error=null,completed_at=null""",
          (p["task_id"],reason,p["issue_id"]))

def cancel_terminal_issue_tasks():
    """Cancel queued work whose card was already closed."""
    rows=query("""select q.id,q.issue_id from agent_task_queue q
                  join issue i on i.id=q.issue_id
                  where q.status='queued' and i.status in ('done','cancelled')
                  order by q.created_at limit %s""",(ADMISSION_BATCH,))
    cancelled=0
    for task_id,issue_id in rows:
        result=sh("/usr/local/bin/multica","issue","cancel-task",str(task_id),
                  "--issue",str(issue_id),"--output","json")
        if result.returncode==0:
            cancelled+=1
        else:
            error=(result.stderr or result.stdout or "cancel failed")[:1200]
            print(f"terminal task {task_id} was not cancelled: {error}",file=sys.stderr)
    return cancelled

def defer_excess_queue():
    """Keep the vendor queue below its two-hour expiry horizon.

    Cancellation uses the public CLI, while the durable recovery row is
    written first. A crash can therefore delay work, but cannot lose the card
    intent. Higher task priority and older tasks retain their queue position.
    """
    rows=query("""select ranked.id,ranked.issue_id from (
                    select q.id,q.issue_id,
                      row_number() over(order by q.priority desc,q.created_at,q.id) as queue_position
                    from agent_task_queue q where q.status='queued'
                  ) ranked
                  where ranked.queue_position>%s and ranked.issue_id is not null
                  order by ranked.queue_position limit %s""",
               (MAX_QUEUED_TASKS,ADMISSION_BATCH))
    deferred=0
    for task_id,issue_id in rows:
        query("""insert into multica_recovery_queue(
                   issue_id,source_task_id,reason,priority,status,updated_at,last_error,completed_at)
                 select i.id,%s,'admission_deferred',i.priority,'waiting',now(),null,null
                 from issue i where i.id=%s
                 on conflict(issue_id) do update set
                   source_task_id=excluded.source_task_id,reason=excluded.reason,
                   priority=excluded.priority,status='waiting',updated_at=now(),
                   last_error=null,completed_at=null""",(task_id,issue_id))
        result=sh("/usr/local/bin/multica","issue","cancel-task",str(task_id),
                  "--issue",str(issue_id),"--output","json")
        current=query("select status from agent_task_queue where id=%s",(task_id,),True)
        status=current[0] if current else None
        if result.returncode==0 or status in ("cancelled","failed"):
            deferred+=1
        elif status=="completed":
            query("update multica_recovery_queue set status='completed',completed_at=now(),updated_at=now() where issue_id=%s",(issue_id,))
        elif status in ("dispatched","preparing","running"):
            query("update multica_recovery_queue set status='dispatched',updated_at=now(),last_error='admission race: task already active' where issue_id=%s",(issue_id,))
        else:
            error=(result.stderr or result.stdout or "cancel failed")[:1200]
            query("update multica_recovery_queue set last_error=%s,updated_at=now() where issue_id=%s",(error,issue_id))
    return deferred

def seed_recovery(hours=48):
    query("""with candidates as (
               select distinct on(q.issue_id) q.issue_id,q.id task_id,q.failure_reason,i.priority
               from agent_task_queue q join issue i on i.id=q.issue_id
               where q.created_at>now()-(%s || ' hours')::interval
                 and q.failure_reason in ('queued_expired','runtime_recovery')
                 and i.status in ('todo','in_progress')
                 and i.assignee_id is not null
                 and not exists (
                   select 1 from agent_task_queue later
                   where later.issue_id=q.issue_id and later.created_at>q.created_at
                     and later.status in ('queued','dispatched','preparing','running','completed'))
               order by q.issue_id,q.created_at desc
             )
             insert into multica_recovery_queue(issue_id,source_task_id,reason,priority,status,updated_at)
             select issue_id,task_id,failure_reason,priority,'waiting',now() from candidates
             on conflict(issue_id) do nothing""",(hours,))

def dispatch_recovery():
    available=max(0,MAX_ACTIVE_TASKS-active_task_count())
    dispatched=0
    for _ in range(available):
        row=query("""with candidate as (
                       select r.issue_id from multica_recovery_queue r
                       join issue i on i.id=r.issue_id
                       where r.status='waiting' and r.attempts<%s
                         and i.assignee_id is not null
                         and ((r.reason='admission_deferred' and i.status in ('todo','in_progress','in_review'))
                           or (r.reason<>'admission_deferred' and i.status in ('todo','in_progress')))
                         and not exists (
                           select 1 from agent_task_queue q where q.issue_id=r.issue_id
                             and q.status in ('queued','dispatched','preparing','running'))
                       order by case r.priority when 'urgent' then 0 when 'high' then 1
                                  when 'medium' then 2 else 3 end,r.updated_at
                       limit 1 for update of r skip locked
                     )
                     update multica_recovery_queue r
                     set status='dispatching',attempts=attempts+1,updated_at=now()
                     from candidate c where r.issue_id=c.issue_id
                     returning r.issue_id,r.attempts""",(MAX_RECOVERY_ATTEMPTS,),True)
        if not row: break
        issue_id,attempts=row
        result=sh("/usr/local/bin/multica","issue","rerun",str(issue_id),"--output","json")
        if result.returncode==0:
            query("update multica_recovery_queue set status='dispatched',dispatched_at=now(),updated_at=now(),last_error=null where issue_id=%s",(issue_id,))
            dispatched+=1
        else:
            status='abandoned' if int(attempts)>=MAX_RECOVERY_ATTEMPTS else 'waiting'
            error=(result.stderr or result.stdout or "rerun failed")[:1200]
            query("update multica_recovery_queue set status=%s,updated_at=now(),last_error=%s where issue_id=%s",(status,error,issue_id))
    return dispatched

def queue_delivery_evidence(p):
    cards=p.get("in_review_cards") or []
    if not cards: return
    old=state_get("delivery_pending",{"cards":[]})
    merged={str(x.get("issue_id")):x for x in old.get("cards",[]) if x.get("issue_id")}
    for item in cards:
        if item.get("issue_id"): merged[str(item["issue_id"])]=item
    state_set("delivery_pending",{"cards":list(merged.values())[-50:],
                                  "origin_sha":p.get("origin_sha"),
                                  "web_sha":p.get("web_sha"),
                                  "api_sha":p.get("api_sha"),
                                  "health":p.get("health"),
                                  "api_health":p.get("api_health")})

def dispatch_delivery_gate():
    pending=state_get("delivery_pending",{"cards":[]})
    cards=pending.get("cards") or []
    if not cards or active_task_count()>=MAX_ACTIVE_TASKS:
        return False
    fingerprint=str(pending.get("origin_sha") or ",".join(str(x.get("issue_id")) for x in cards))
    if fire("delivery_gate","deployment_ready_for_acceptance",pending,fingerprint):
        state_set("delivery_pending",{"cards":[]})
        return True
    return False

def endpoint_cooldown(endpoint):
    value=state_get("endpoint_cooldown:"+endpoint,{})
    try: until=float(value.get("until",0))
    except (TypeError,ValueError): until=0
    return max(0,int(until-time.time()))

def fire(endpoint,event,payload,fingerprint):
    global _fire_failed
    cfg=load(CONFIG); ep=cfg.get("endpoints",{}).get(endpoint)
    if not ep: return True
    # Keep event payload durable in the outbox until the shared daemon has
    # capacity. The webhook response creates a vendor task immediately, so
    # admission must happen before the HTTP request.
    if active_task_count()>=MAX_ACTIVE_TASKS:
        _fire_failed=True
        return False
    cooldown=endpoint_cooldown(endpoint)
    if cooldown>0:
        _fire_failed=True
        return False
    fp=hashlib.sha256((event+":"+fingerprint).encode()).hexdigest()[:32]
    row=query("select status,fired_at,next_attempt_at,attempts from multica_event_fire_log where endpoint=%s and fingerprint=%s",(endpoint,fp),True)
    if row:
        status,fired_at,next_attempt_at,attempts=row
        if status=='sent': return True
        if next_attempt_at and next_attempt_at > datetime.datetime.now(datetime.timezone.utc):
            _fire_failed=True
            return False
        if status=='reserved' and fired_at and fired_at > datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=FIRE_RESERVATION_TTL):
            _fire_failed=True
            return False
    try:
        query("insert into multica_event_fire_log(endpoint,fingerprint,attempts,next_attempt_at) values(%s,%s,1,now()) on conflict(endpoint,fingerprint) do update set status='reserved',attempts=multica_event_fire_log.attempts+1,fired_at=now(),next_attempt_at=now()",(endpoint,fp))
    except Exception:
        _fire_failed=True
        return False
    body=json.dumps({"event":event,"eventPayload":{"kind":event,**payload}},ensure_ascii=False).encode()
    req=urllib.request.Request(ep["url"],data=body,headers={"Content-Type":"application/json"},method="POST")
    try:
        with urllib.request.urlopen(req,timeout=10) as r: result=f"http {r.status}"
        query("update multica_event_fire_log set status='sent',error=%s where endpoint=%s and fingerprint=%s",(result,endpoint,fp))
        state_set("endpoint_cooldown:"+endpoint,{})
        return True
    except urllib.error.HTTPError as e:
        attempt=int(attempts or 0)+1 if row else 1
        if e.code==429:
            try: delay=int(e.headers.get("Retry-After","60"))
            except (TypeError,ValueError): delay=60
            delay=max(60,min(3600,delay))
            state_set("endpoint_cooldown:"+endpoint,{"until":time.time()+delay,"reason":"http_429"})
        else:
            delay=min(3600,max(5,2 ** min(attempt,10)))
        query("update multica_event_fire_log set status='reserved',error=%s,next_attempt_at=now()+(%s || ' seconds')::interval where endpoint=%s and fingerprint=%s",(str(e)[:1200],delay,endpoint,fp))
        _fire_failed=True
        print(f"fire {endpoint} failed: {e}; cooldown={delay}s",file=sys.stderr)
        return False
    except Exception as e:
        attempt=int(attempts or 0)+1 if row else 1
        delay=min(3600,max(5,2 ** min(attempt,10)))
        query("update multica_event_fire_log set status='reserved',error=%s,next_attempt_at=now()+(%s || ' seconds')::interval where endpoint=%s and fingerprint=%s",(str(e)[:1200],delay,endpoint,fp))
        _fire_failed=True
        print(f"fire {endpoint} failed: {e}",file=sys.stderr)
        return False

def batch(key,item,threshold,targets,event):
    items=state_get(key,[])
    identity=str(item.get("issue_id") or item.get("task_id") or item.get("number"))
    items=[x for x in items if str(x.get("issue_id") or x.get("task_id") or x.get("number"))!=identity]
    items.append(item); items=items[-threshold*3:]
    if len(items)<threshold: state_set(key,items); return
    payload={"threshold":threshold,"cards":items[-threshold:]}
    fp=','.join(str(x.get("issue_id") or x.get("task_id") or x.get("number")) for x in items[-threshold:])
    # Keep the batch until every endpoint accepts it.  `fire` is idempotent
    # for already-sent fingerprints, so a retry safely reuses the same
    # payload and only re-attempts failed endpoints.
    delivered=True
    for target in targets:
        if not fire(target,event,payload,fp): delivered=False
    if delivered: state_set(key,[])

def v1(p,cfg): return str(p.get("project_id"))==cfg.get("project_id")
def route(kind,p):
    cfg=load(CONFIG)
    if kind in ("issue_created","issue_changed"):
        if not v1(p,cfg): return
        if p.get("status")=="todo" and not p.get("assignee_id"):
            fire("unassigned","unassigned_todo",{"cards":[card(p)]},str(p.get("issue_id"))+":todo")
        malformed=not p.get("project_id") or not p.get("parent_issue_id") or not p.get("assignee_id") or not p.get("due_date") or int(p.get("acceptance_count") or 0)==0
        if malformed: batch("malformed",card(p),5,["project_integrity"],"board_structure_batch")
        if kind=="issue_created" and int(p.get("number") or 0)%10==0:
            lo=max(1,int(p["number"])-9)
            rows=query("select id,number,title,status,priority from issue where workspace_id=%s and project_id=%s and number between %s and %s order by number",(cfg["workspace_id"],cfg["project_id"],lo,p["number"]))
            cards=[{"issue_id":str(r[0]),"number":r[1],"title":r[2],"status":r[3],"priority":r[4]} for r in rows]
            payload={"threshold":10,"range":[lo,p["number"]],"cards":cards}
            for t in ("project_integrity","board_capacity"): fire(t,"tenth_v1_card",payload,f"{lo}-{p['number']}")
        if kind=="issue_changed" and p.get("old_status")!=p.get("status"):
            if p.get("status") in ("in_progress","in_review"):
                batch("docs_gate",card(p),5,["docs_lineage"],"docs_lineage_batch")
            if p.get("status")=="in_review":
                batch("review_batch",card(p),5,["delivery_gate"],"in_review_batch")
            if p.get("status")=="done":
                batch("done_batch",card(p),10,["docs_sweep","forecast","board_capacity"],"ten_done")
            if p.get("status")=="blocked":
                batch("blocked_batch",card(p),5,["forecast","cto_horizon"],"blocked_threshold")
        # A deadline agent is event-driven too: only a card that was actually
        # changed after its due date enters the batch. No clock-only wakeups.
        if p.get("due_date") and p.get("status") not in ("done","cancelled"):
            try: overdue=datetime.date.fromisoformat(str(p["due_date"])) < datetime.date.today()
            except ValueError: overdue=False
            if overdue: batch("overdue_batch",card(p),5,["deadline"],"overdue_changed_batch")
    elif kind=="task_terminal":
        reason=p.get("failure_reason") or p.get("error") or ""
        if p.get("issue_id") and p.get("status")=="completed":
            query("update multica_recovery_queue set status='completed',completed_at=now(),updated_at=now(),last_error=null where issue_id=%s",(p["issue_id"],))
        elif p.get("status")=="failed" and reason in ("queued_expired","runtime_recovery"):
            enqueue_recovery(p)
        elif p.get("status")=="failed":
            if p.get("issue_id"):
                query("update multica_recovery_queue set status='abandoned',updated_at=now(),last_error=%s where issue_id=%s and status='dispatched'",(reason[:1200],p["issue_id"]))
            batch("failed_tasks",p,3,["agentops"],"task_failure_batch")
        elif p.get("status")=="cancelled" and p.get("issue_id"):
            query("update multica_recovery_queue set status='abandoned',updated_at=now(),last_error=%s where issue_id=%s and status='dispatched'",(reason[:1200],p["issue_id"]))
        if p.get("issue_id") and p.get("status") in ("completed","failed") and reason not in ("queued_expired","runtime_recovery"):
            row=query("select i.status,count(*) from issue i join agent_task_queue q on q.issue_id=i.id where i.id=%s and q.status in ('completed','failed') and q.created_at>now()-interval '24 hours' group by i.status",(p["issue_id"],),True)
            if row and row[0] in ("in_progress","todo") and row[1]>=3 and row[1]%3==0:
                fire("stalled","repeated_run_without_progress",{"card":card(p),"runs_24h":row[1]},f"{p['issue_id']}:{row[1]}")
        dispatch_delivery_gate()
        dispatch_recovery()
        pending=active_task_count()
        previous=int(state_get("pending_tasks",pending))
        if pending<MAX_ACTIVE_TASKS<=previous and recovery_waiting_count()==0 and not pathlib.Path("/home/plag/.quota-paused").exists():
            counts=query("select status,count(*) from issue where project_id=%s group by status",(cfg["project_id"],))
            fire("cto_horizon","queue_starved",{"pending_tasks":pending,"previous":previous,"board":dict(counts)},str(int(time.time()/300)))
        state_set("pending_tasks",pending)
    elif kind=="dev_deployed":
        # A successful SHA is evidence collected by the sensor, not a reason
        # to wake three agents after every push. Consumers run on milestones.
        surface_changed=bool(p.get("web_changed") or p.get("api_changed"))
        if surface_changed and p.get("health")=="200" and p.get("api_health")=="200":
            queue_delivery_evidence(p)
            dispatch_delivery_gate()
        n=int(state_get("deploy_count",0))
        if surface_changed:
            n+=1; state_set("deploy_count",n)
            if n%5==0: fire("qa_deploy","five_dev_deployments",{"deployments":5,**p},str(n))
        if p.get("web_changed"):
            wn=int(state_get("web_deploy_count",0))+1; state_set("web_deploy_count",wn)
            if wn%3==0: fire("visual_qa","three_web_deployments",{"web_deployments":3,**p},str(wn))
            if any("printer" in x.lower() for x in p.get("changed_paths",[])):
                pn=int(state_get("printer_web_count",0))+1; state_set("printer_web_count",pn)
                if pn%3==0: fire("design_council","printer_design_milestone",{"printer_web_deployments":3,**p},str(pn))
        if surface_changed and n%10==0: fire("release_readiness","ten_dev_deployments",{"deployments":10,**p},str(n))
        if p.get("unexpected_heads") or p.get("non_fast_forward"):
            fire("git_hygiene","git_anomaly",p,str(p.get("origin_sha"))+json.dumps(p.get("unexpected_heads")))
    elif kind in ("deploy_failed","site_down","site_recovered"):
        fire("site_keeper",kind,p,str(p.get("signature") or p.get("origin_sha") or int(time.time()/300)))
        if kind=="deploy_failed": fire("deploy_failed",kind,p,str(p.get("signature") or int(time.time()/300)))
    elif kind=="quota_recovered":
        fire("cto_horizon",kind,p,str(p.get("recovered_at")))
        fire("agentops",kind,p,str(p.get("recovered_at")))

def process_outbox():
    global _fire_failed
    rows=query("select id,kind,payload from multica_event_outbox where processed_at is null order by id limit 100")
    for eid,kind,payload in rows:
        try:
            route(kind,payload)
            if not _fire_failed:
                query("update multica_event_outbox set processed_at=now() where id=%s",(eid,))
            else:
                _fire_failed=False
                continue
        except Exception as e: print(f"event {eid} {kind}: {e}",file=sys.stderr)

def emit(kind,payload):
    cfg=load(CONFIG)
    query("insert into multica_event_outbox(workspace_id,kind,payload) values(%s,%s,%s::jsonb)",(cfg.get("workspace_id"),kind,json.dumps(payload,ensure_ascii=False)))
    query("select pg_notify('multica_event',%s)",(cfg.get("workspace_id") or "",))

def observe_deploy():
    old=load(DEPLOY_STATE); get=lambda f:(MARKERS/f).read_text().strip() if (MARKERS/f).exists() else None
    origin=sh("git","-C",str(REPO),"rev-parse","origin/dev").stdout.strip(); web=get("web.sha"); api=get("api.sha")
    health=sh("curl","-fsS","-o","/dev/null","-w","%{http_code}","https://dev.3mf.tech/").stdout.strip() or "000"
    api_health=sh("curl","-fsS","-o","/dev/null","-w","%{http_code}","https://api.dev.3mf.tech/health").stdout.strip() or "000"
    heads=[line.split("refs/heads/",1)[1] for line in sh("git","-C",str(REPO),"ls-remote","--heads","origin").stdout.splitlines() if "refs/heads/" in line]
    changed=[]; issue_numbers=[]
    previous_origin=old.get("origin_sha")
    if previous_origin and origin and previous_origin!=origin and sh("git","-C",str(REPO),"cat-file","-e",previous_origin+"^{commit}").returncode==0:
        changed=sh("git","-C",str(REPO),"diff","--name-only",previous_origin+".."+origin).stdout.splitlines()
        subjects=sh("git","-C",str(REPO),"log","--format=%s",previous_origin+".."+origin).stdout
        issue_numbers=sorted({int(x) for x in re.findall(r"MF-(\d+)",subjects)})
    current={"origin_sha":origin,"web_sha":web,"api_sha":api,"health":health,"api_health":api_health,"heads":heads}
    if origin and (origin!=previous_origin or web!=old.get("web_sha") or api!=old.get("api_sha")):
        cfg=load(CONFIG)
        review=query("select id,number,title,status,priority from issue where project_id=%s and number=any(%s) and status='in_review' order by number",(cfg["project_id"],issue_numbers)) if issue_numbers else []
        payload={**current,"previous":old,"web_changed":web!=old.get("web_sha"),"api_changed":api!=old.get("api_sha"),"changed_paths":changed[:200],"issue_numbers":issue_numbers,"docs_changed":any(x.startswith("docs/") for x in changed),"unexpected_heads":[h for h in heads if h not in ("dev","main")],"in_review_cards":[{"issue_id":str(x[0]),"number":x[1],"title":x[2],"status":x[3],"priority":x[4]} for x in review]}
        emit("dev_deployed",payload)
    old_health=old.get("health")
    if health!="200" and old_health in (None,"200"): emit("site_down",{**current,"signature":health+":"+origin})
    elif health=="200" and old_health not in (None,"200"): emit("site_recovered",{**current,"previous_health":old_health,"signature":"recovered:"+origin})
    atomic(DEPLOY_STATE,current)

def observe_quota():
    paused=pathlib.Path("/home/plag/.quota-paused").exists(); old=load(QUOTA_STATE,{"paused":paused})
    if old.get("paused") and not paused: emit("quota_recovered",{"recovered_at":int(time.time()),"daemon_active":sh("systemctl","is-active","multica-daemon").stdout.strip()})
    atomic(QUOTA_STATE,{"paused":paused,"observed_at":int(time.time())})

def serve():
    listener=db(); listener.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT); cur=listener.cursor(); cur.execute("listen multica_event")
    process_outbox()
    seed_recovery()
    cancel_terminal_issue_tasks()
    defer_excess_queue()
    dispatch_delivery_gate()
    dispatch_recovery()
    while True:
        if select.select([listener],[],[],60)[0]:
            listener.poll(); listener.notifies.clear()
        process_outbox()
        cancel_terminal_issue_tasks()
        defer_excess_queue()
        dispatch_delivery_gate()
        dispatch_recovery()

if __name__=="__main__":
    ap=argparse.ArgumentParser(); ap.add_argument("--serve",action="store_true"); ap.add_argument("--observe-deploy",action="store_true"); ap.add_argument("--observe-quota",action="store_true"); ap.add_argument("--seed-recovery",action="store_true"); ap.add_argument("--emit"); ap.add_argument("--emit-service-failure"); ap.add_argument("--payload-json",default="{}")
    a=ap.parse_args()
    if a.serve: serve()
    elif a.observe_deploy: observe_deploy()
    elif a.observe_quota: observe_quota()
    elif a.emit: emit(a.emit,json.loads(a.payload_json))
    elif a.seed_recovery: seed_recovery(); dispatch_recovery()
    elif a.emit_service_failure: emit("deploy_failed",{"signature":a.emit_service_failure,"service":a.emit_service_failure,"failed_at":int(time.time())})
