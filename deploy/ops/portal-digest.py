#!/usr/bin/env python3
"""Утренний дайджест сквада в Telegram: доска+дельты, фичи за сутки, версия, здоровье VDS.
systemd-таймер portal-digest (08:00 МСК). Детерминированный скрипт — без слота агента."""
import json, subprocess, os, time
from collections import Counter
STATE = "/home/plag/.portal-digest.state"
def out(a): return subprocess.run(a, capture_output=True, text=True).stdout

items = json.loads(out(["multica", "issue", "list", "--limit", "300", "--output", "json"]))
items = items.get("issues") or items.get("items") or items
c = Counter(i.get("status") for i in items)

os.chdir("/home/plag/portal.ru"); out(["git", "fetch", "origin", "main"])
log = out(["git", "log", "origin/main", "--oneline", "--since=24 hours ago"]).splitlines()
feats = [l for l in log if "feat(" in l]
try:
    v = json.loads(out(["git", "show", "origin/main:version.json"])); vs = f"{v['year']}.{v['release']}.{v['minor']}"
except Exception: vs = "?"

fr = out(["free", "-m"]).splitlines()
ram = next((l.split()[6] for l in fr if l.startswith("Mem")), "?")
sw = next((l.split()[2] for l in fr if l.startswith("Swap")), "?")
load = out(["uptime"]).strip().split("load average:")[-1].strip()
disk = out(["df", "/"]).splitlines()[1].split()[4]
dan = out(["systemctl", "is-active", "multica-daemon"]).strip()

prev = {}
if os.path.exists(STATE):
    try: prev = json.load(open(STATE))
    except Exception: pass
pb = prev.get("board", {})
def d(k):
    n = c.get(k, 0); p = pb.get(k)
    return f"{n}" + (f" ({n-p:+d})" if isinstance(p, int) else "")

lines = [f"☀️ Дайджест Autofab · прод v{vs} · демон {dan}",
         f"📋 done {d('done')} · in_review {d('in_review')} · in_progress {d('in_progress')} · blocked {d('blocked')} · todo {d('todo')}",
         f"🚀 за сутки на main: {len(feats)} фич-коммитов" + (":" if feats else "")]
for l in feats[:6]:
    lines.append("  • " + (l.split(" ", 1)[1] if " " in l else l)[:74])
lines.append(f"🖥 VDS: RAM {ram}M своб · swap {sw}M/8G · load {load} · диск {disk}")
msg = "\n".join(lines)

subprocess.run(["/usr/local/bin/release-announce", msg])
json.dump({"board": dict(c), "ts": int(time.time())}, open(STATE, "w"))
print("digest sent:\n" + msg)
