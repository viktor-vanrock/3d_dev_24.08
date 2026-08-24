import { useEffect, useState, type ReactNode } from "react";
import { useOverlay } from "@platform/overlay";
import {
  fetchPushPreferences,
  fetchVapidPublicKey,
  isPushSupported,
  isSubscribed,
  PUSH_TYPES,
  setPushPreference,
  subscribeToPush,
  unsubscribeFromPush,
  type PushPreference,
  type PushType,
} from "@platform/push";
import { usePwaInstall } from "@platform/pwa";
import { useInteractionSound } from "@platform/sound";
import { Eyebrow, PrinterIcon, Switch } from "@shared/ui";

// Секция «Уведомления» профиля (docs/design/push.notifications.md, MF-434 Фаза 3 шаг 2;
// вынесена из profile.tsx MF-911) — самодостаточный блок, тестируется отдельно
// (push.settings.test.tsx), той же логикой, что уже используют другие независимо
// тестируемые секции экрана (ConsentBanner-паттерн).

// Иконка+заголовок для каждого PushType — printer_status переиспользует общий PrinterIcon
// (ui/ui.tsx), не рисует новую копию.
const PUSH_TYPE_META: Record<PushType, { label: string; icon: ReactNode }> = {
  remix: { label: "Ремиксы моих проектов", icon: <RemixIcon /> },
  like: { label: "Лайки", icon: <HeartIcon /> },
  sale: { label: "Продажи моделей", icon: <CoinIcon /> },
  comment: { label: "Комментарии", icon: <ChatIcon /> },
  printer_status: { label: "Статус принтера", icon: <PrinterIcon size={20} /> },
  new_order: { label: "Новые заказы", icon: <BoxIcon /> },
};

// Четыре ветки состояний строго по порядку спеки §1: VAPID не загружен/`null` → секции нет
// вообще; push не поддержан браузером → инструкция «На домашний экран» на iOS Safari, иначе
// тоже ничего; push поддержан → master-тумблер + список из 6 типов. Логика подписки/preferences
// уже готова в push/push.ts (MF-434 шаг 1) — секция только подключает видимый UI поверх неё.
export function PushSettingsSection() {
  const overlay = useOverlay();
  const sound = useInteractionSound();
  const pwa = usePwaInstall();
  const [vapidKey, setVapidKey] = useState<string | null | undefined>(undefined);
  const [subscribed, setSubscribed] = useState(false);
  const [pending, setPending] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [prefs, setPrefs] = useState<PushPreference[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchVapidPublicKey().then((key) => {
      if (!cancelled) setVapidKey(key);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!vapidKey || !isPushSupported()) return;
    let cancelled = false;
    setPermissionDenied(typeof Notification !== "undefined" && Notification.permission === "denied");
    void isSubscribed().then((value) => {
      if (cancelled) return;
      setSubscribed(value);
      if (value) void fetchPushPreferences().then((items) => !cancelled && setPrefs(items));
    });
    return () => {
      cancelled = true;
    };
  }, [vapidKey]);

  // Тап по master, когда выключен: БЕЗ оптимистичного включения — subscribeToPush() может
  // открыть системный permission-prompt (модальное прерывание), поэтому строка уходит в
  // pending и ждёт реальный ответ браузера (§2.2).
  // Тап, когда включён: оптимистично сразу off (нет системного диалога на отписку) —
  // список типов схлопывается вместе с master, откат на неудачу.
  async function handleMasterToggle() {
    if (pending) return;
    if (subscribed) {
      sound.toggle();
      const restorePrefs = prefs;
      setSubscribed(false);
      setPrefs(null);
      const ok = await unsubscribeFromPush();
      if (!ok) {
        setSubscribed(true);
        setPrefs(restorePrefs);
        sound.error();
        overlay.toast({ severity: "warn", title: "Не удалось отключить уведомления" });
      } else {
        sound.success();
      }
      return;
    }
    setPending(true);
    const result = await subscribeToPush();
    setPending(false);
    if (result === "subscribed") {
      setSubscribed(true);
      setPermissionDenied(false);
      sound.success();
      void fetchPushPreferences().then(setPrefs);
    } else if (result === "permission_denied") {
      setPermissionDenied(true);
      sound.error();
    } else {
      sound.error();
      overlay.toast({ severity: "warn", title: "Не удалось включить уведомления", message: "Попробуйте ещё раз" });
    }
  }

  // Строки типов — голосовалка-паттерн (components.md §Голосовалка): мгновенный флип,
  // откат при несовпадении ответа с ожиданием, без pending-приглушения (§2.3).
  async function handleTypeToggle(type: PushType, current: boolean) {
    const next = !current;
    setPrefs((prev) => prev?.map((pref) => (pref.type === type ? { ...pref, enabled: next } : pref)) ?? prev);
    const ok = await setPushPreference(type, next);
    if (!ok) {
      setPrefs((prev) => prev?.map((pref) => (pref.type === type ? { ...pref, enabled: current } : pref)) ?? prev);
      sound.error();
      overlay.toast({ severity: "warn", title: "Не сохранилось, попробуйте снова" });
    } else {
      sound.success();
    }
  }

  if (vapidKey === undefined || vapidKey === null) return null;

  if (!isPushSupported()) {
    if (!pwa.showIosInstructions) return null;
    return (
      <div className="ideasSection">
        <Eyebrow>Уведомления</Eyebrow>
        <div className="ideaRow pushRow">
          <span className="pushRowIcon" aria-hidden="true">
            <BellIcon />
          </span>
          <div className="pushRowMain">
            <div className="pushRowTitle">Уведомления в браузере</div>
            <div className="pushRowSub">
              На iPhone/iPad пуши доступны только в приложении, установленном на экран «Домой». Добавьте 3mf.tech:
              Поделиться → «На экран Домой».
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ideasSection">
      <Eyebrow>Уведомления</Eyebrow>
      <div className="ideaRow pushRow pressable" onPointerDown={sound.confirm} onClick={() => void handleMasterToggle()}>
        <span className="pushRowIcon" aria-hidden="true">
          <BellIcon />
        </span>
        <div className="pushRowMain">
          <div className="pushRowTitle">Пуш-уведомления</div>
          <div className="pushRowSub">Ремиксы, лайки, продажи и заказы — прямо в браузере</div>
        </div>
        <Switch checked={subscribed} pending={pending} label="Пуш-уведомления" onChange={() => void handleMasterToggle()} />
      </div>

      {permissionDenied ? (
        <div className="pushHint">
          <WarnIcon />
          <span>
            Уведомления заблокированы в браузере. Разрешите их для сайта (иконка замка рядом с адресной строкой) и
            включите тумблер снова.
          </span>
        </div>
      ) : null}

      {subscribed && prefs ? (
        <fieldset className="pushList ideaList" aria-label="Типы уведомлений">
          {PUSH_TYPES.map((type) => {
            const enabled = prefs.find((item) => item.type === type)?.enabled ?? true;
            const meta = PUSH_TYPE_META[type];
            return (
              <div
                key={type}
                className="ideaRow pushRow pressable"
                onPointerDown={sound.toggle}
                onClick={() => void handleTypeToggle(type, enabled)}
              >
                <span className="pushRowIcon" aria-hidden="true">
                  {meta.icon}
                </span>
                <div className="pushRowMain">
                  <div className="pushRowTitle">{meta.label}</div>
                </div>
                <Switch checked={enabled} label={meta.label} onChange={() => void handleTypeToggle(type, enabled)} />
              </div>
            );
          })}
        </fieldset>
      ) : null}
    </div>
  );
}

// Иконки блока «Уведомления» (docs/design/push.notifications.md §2.2-§3) — line 2px stroke,
// без заливки (readme.md §Иконки: эмодзи в интерфейсных иконках — нет).
function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 9a6 6 0 1 1 12 0c0 3.5 1 5 2 6H4c1-1 2-2.5 2-6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10 18a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 4 2 20h20L12 4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 10v4.5M12 17.5v.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function RemixIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 4v6c0 2 1 3 3 3h9M13 8l5 5-5 5M6 10v10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 20s-7-4.4-9.5-8.8C.8 8 2 4.5 5.4 4c2-.3 3.7.7 4.6 2.3.9-1.6 2.6-2.6 4.6-2.3C18 4.5 19.2 8 21.5 11.2 19 15.6 12 20 12 20Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CoinIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 7.5v9M15 9.8c0-1.1-1.3-2-3-2s-3 .8-3 1.9 1.3 1.6 3 1.8 3 .8 3 1.9-1.3 1.9-3 1.9-3-.9-3-2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5h16v11H9l-5 4V5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 8 12 4l8 4v9l-8 4-8-4V8Zm0 0 8 4m0 0 8-4m-8 4v9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
