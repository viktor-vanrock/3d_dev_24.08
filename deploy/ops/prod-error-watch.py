#!/usr/bin/env python3
"""Прод-ошибка → авто-баг-карточка. Сканит journald прод-юнитов, дедуп по сигнатуре,
заводит карточку владельцу зоны. Ставится systemd-таймером prod-error-watch каждые 5 мин.
APPLY=1 — реально заводить карточки (иначе dry: печатает, что завёл бы)."""
import json, subprocess, os, time
APPLY = os.environ.get("APPLY") == "1"
STATE = "/home/plag/.prod-error-watch.state"
MAX_CARDS = 3
PROJ = "3787122e-09f3-4bce-bf6e-0f4e63d08416"; L_BUG = "e2df0a05"
FULLSTACK = "dd2603c0-a36f-4e6a-8f4c-96daa2726f26"
ZONE = {  # unit -> (имя, agent-id, зона)
  "portal.api":         ("Back", "1427df29-cd93-47c9-a408-a4e0edfb4c04", "api"),
  "portal.giga-worker": ("AI",   "612ed28a-04ca-4624-b535-bf0e7af5377e", "giga"),
  "portal.mesh-worker": ("Mesh", "ad3cbd95-0223-482d-b8cc-3c7f98df3a92", "mesh"),
}
def run(a): return subprocess.run(a, capture_output=True, text=True)

st = {"last": int(time.time()) - 600, "seen": {}}
if os.path.exists(STATE):
    try: st = json.load(open(STATE))
    except Exception: pass
now = int(time.time())
since = st.get("last", now - 600)
seen = {k: v for k, v in st.get("seen", {}).items() if now - v < 86400}  # TTL 24ч

def detect(unit):
    r = run(["journalctl", "-u", unit, "-o", "cat", "--no-pager", "--since", f"@{since}"])
    found = {}  # sig -> (excerpt, count)
    for line in r.stdout.splitlines():
        line = line.strip()
        if not line: continue
        sig = None; exc = line[:600]
        if line.startswith("{"):
            try:
                o = json.loads(line)
                sc = (o.get("res") or {}).get("statusCode")
                if o.get("level") == 50 or (isinstance(sc, int) and sc >= 500):
                    msg = o.get("msg") or (o.get("err") or {}).get("message") or f"5xx {sc}"
                    url = (o.get("req") or {}).get("url", "")
                    sig = f"{unit}|{str(msg)[:70]}|{url[:35]}"
                    exc = json.dumps(o, ensure_ascii=False)[:600]
            except Exception: continue
        elif ("Traceback" in line) or (" ERROR " in line) or ("Exception" in line and "level" not in line):
            sig = f"{unit}|{line[:90]}"
        if sig:
            e = found.get(sig); found[sig] = (exc, (e[1] + 1 if e else 1))
    return found

def make_card(unit, sig, excerpt, count):
    name, aid, zone = ZONE.get(unit, ("Fullstack", FULLSTACK, unit))
    short = sig.split("|", 1)[-1][:48]
    title = f"прод-ошибка [{zone}]: {short}"
    desc = (f"Авто-заведено из прод-логов `{unit}` (сигнатура повторилась {count}× за окно). "
            f"Не блокирует — но это ЖИВАЯ ошибка на проде, приоритет.\n\n"
            f"Лог:\n```\n{excerpt}\n```\n\n"
            f"Воспроизведи на api.3mf.tech/3mf.tech, почини forward. Зона: {zone} ({name}).")
    if not APPLY:
        print(f"[dry] card «{title[:55]}» → {name}"); return "DRY"
    r = run(["multica", "issue", "create", "--title", title, "--description", desc,
             "--assignee-id", aid, "--project", PROJ, "--priority", "high", "--output", "json"])
    try:
        mf = json.loads(r.stdout).get("identifier")
        run(["multica", "issue", "label", "add", mf, L_BUG])
        run(["multica", "issue", "assign", mf, "--to-id", aid])
        print(f"card {mf}: {title[:55]} → {name}"); return mf
    except Exception:
        print(f"card ERR: {r.stdout[:120]} {r.stderr[:120]}"); return None

created = 0
for unit in ZONE:
    for sig, (exc, cnt) in detect(unit).items():
        if sig in seen:  # уже заводили за последние 24ч
            seen[sig] = now; continue
        if created >= MAX_CARDS:
            print(f"[cap] достигнут лимит {MAX_CARDS} карточек/прогон, остальное в след. раз"); break
        if make_card(unit, sig, exc, cnt):
            seen[sig] = now; created += 1

print(f"итог: заведено {created} карточек (окно с @{since})")
if APPLY:
    json.dump({"last": now, "seen": seen}, open(STATE, "w"))
