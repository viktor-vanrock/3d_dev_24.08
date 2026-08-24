#!/usr/bin/env python3
"""Синтетик-мониторинг: дёргает ключевые URL прода, ждёт правильных кодов.
5xx/таймаут/не-тот-код → карточка зоне. Лёгкий (curl, без браузера) — безопасно на 4ГБ.
systemd-таймер synthetic-watch каждые 10 мин. APPLY=1 — реально заводить карточки."""
import json, subprocess, os, time
APPLY = os.environ.get("APPLY") == "1"
STATE = "/home/plag/.synthetic-watch.state"
PROJ = "3787122e-09f3-4bce-bf6e-0f4e63d08416"; L_BUG = "e2df0a05"
BACK = "1427df29-cd93-47c9-a408-a4e0edfb4c04"
OPS  = "e56a7e84-8aef-4596-9b2f-f85f134c1bc3"
# (url, ожидаемые коды, владелец, зона)
CHECKS = [
  ("https://api.3mf.tech/health",      {"200"},        BACK, "api"),
  ("https://api.3mf.tech/models",      {"200"},        BACK, "api"),
  ("https://api.3mf.tech/generations", {"401"},        BACK, "api"),
  ("https://3mf.tech/",                {"200","302"},  OPS,  "фронт"),
  ("https://dev.3mf.tech/",            {"200","302"},  OPS,  "dev"),
  ("https://tasks.3mf.tech/",          {"200","302"},  OPS,  "доска"),
]
def run(a): return subprocess.run(a, capture_output=True, text=True)
def code(url):
    r = run(["curl","-sS","-o","/dev/null","-w","%{http_code}","--max-time","12",url])
    return (r.stdout.strip() or "000")

seen = {}
if os.path.exists(STATE):
    try: seen = json.load(open(STATE))
    except Exception: pass
now = int(time.time())
seen = {k: v for k, v in seen.items() if now - v < 7200}  # TTL 2ч

broken = []
for url, exp, aid, zone in CHECKS:
    c = code(url)
    if c not in exp:
        broken.append((url, c, exp, aid, zone))
    print(f"{'OK ' if c in exp else 'BAD'} {url} -> {c} (ждали {sorted(exp)})")

created = 0
for url, c, exp, aid, zone in broken:
    if url in seen:
        seen[url] = now; continue
    who = "Back" if aid == BACK else "Ops"
    title = f"прод недоступен [{zone}]: {url.split('//')[-1][:38]} → {c}"
    desc = (f"Синтетик-мониторинг: `{url}` вернул **{c}**, ждали {sorted(exp)}. "
            f"Живой сбой (юзер видит), приоритет. Проверь nginx/сервис/роут, почини forward. Зона: {zone}.")
    if APPLY:
        r = run(["multica","issue","create","--title",title,"--description",desc,
                 "--assignee-id",aid,"--project",PROJ,"--priority","urgent","--output","json"])
        try:
            mf = json.loads(r.stdout).get("identifier")
            run(["multica","issue","label","add",mf,L_BUG]); run(["multica","issue","assign",mf,"--to-id",aid])
            print(f"card {mf}: {title} → {who}"); seen[url] = now; created += 1
        except Exception: print(f"card ERR: {r.stdout[:120]}")
    else:
        print(f"[dry] card «{title}» → {who}")

print(f"итог: {len(broken)} сломано, {created} карточек")
if APPLY: json.dump(seen, open(STATE, "w"))
