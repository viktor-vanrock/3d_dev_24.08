import { navigate } from "../../../router.ts";
import type { Severity } from "../severity.ts";
import type { NotificationGroup, NotificationItem } from "../store.ts";

/*
  Панель центра уведомлений (docs/epics/overlay.system.md §6, MF-443): заменяет
  хардкод NotificationRow в home/homeheader.tsx — группы печать/сообщения(MF-38)/
  система из реального стора (useOverlay().notifications.items). «Сообщения» —
  группа зарезервирована под MF-38 (не поднят), пуста, пока лента не появится;
  не мокаем несуществующий контент.
*/

const GROUP_ORDER: NotificationGroup[] = ["print", "messages", "system"];
const GROUP_LABEL: Record<NotificationGroup, string> = {
  print: "Печать",
  messages: "Сообщения",
  system: "Система",
};

function toneForSeverity(severity: Severity): "ok" | "warn" | "danger" {
  if (severity === "critical") return "danger";
  if (severity === "warn") return "warn";
  return "ok";
}

export function NotificationCenterList({ items }: { items: NotificationItem[] }) {
  if (items.length === 0) {
    return <div className="homePopFootnote">Здесь появятся статусы печати и ответы сообщества</div>;
  }

  const groups = GROUP_ORDER.map((group) => ({ group, items: items.filter((item) => item.group === group) })).filter(
    (entry) => entry.items.length > 0,
  );

  return (
    <>
      {groups.map(({ group, items: groupItems }) => (
        <div key={group}>
          <div className="homePopTitle">{GROUP_LABEL[group]}</div>
          {groupItems.map((item) => (
            <NotificationRow key={item.id} item={item} />
          ))}
        </div>
      ))}
    </>
  );
}

function NotificationRow({ item }: { item: NotificationItem }) {
  const body = (
    <>
      <span className="homeCapsuleDot" data-tone={toneForSeverity(item.severity)} style={{ marginTop: 6 }} />
      <span>
        <span style={{ display: "block", fontSize: 13.5 }}>{item.title}</span>
        {item.message ? <span style={{ display: "block", fontSize: 12, color: "var(--text-dim)" }}>{item.message}</span> : null}
      </span>
    </>
  );

  const deepLink = item.deepLink;
  if (!deepLink) {
    return <div className="homePopRow">{body}</div>;
  }
  return (
    <button
      type="button"
      className="homePopRow pressable"
      style={{ width: "100%", border: "none", background: "transparent", textAlign: "left", cursor: "pointer" }}
      onClick={() => navigate(deepLink)}
    >
      {body}
    </button>
  );
}
