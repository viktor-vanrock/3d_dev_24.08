import { useEffect, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useOverlay, type ToastHandle } from "@platform/overlay";
import { resubscribeIfStale } from "@platform/push";
import { navigate } from "../../router.ts";
import { ensurePersistentStorage } from "./storage.ts";

// Не рисует ничего своего — только подключает уже принятый оверлей-слой (overlay/index.ts,
// docs/epics/overlay.system.md) к событиям SW/сети. Никакого нового визуального компонента
// (баннер обновления/офлайн — заметный UI, для него нужна спека Design, см. карточку
// «PWA: спека install-баннера и офлайн-статуса»); toast — существующий системный примитив.
export function PwaRuntime() {
  const overlay = useOverlay();
  const offlineReadyToastRef = useRef<ToastHandle | null>(null);

  // registerType:"prompt" (vite.config.ts) — SW ставится в очередь (waiting), но не
  // активируется сам: юзер решает, когда обновиться (не выбить его с середины формы).
  const { needRefresh: [needRefresh, setNeedRefresh], offlineReady: [offlineReady, setOfflineReady], updateServiceWorker } =
    useRegisterSW({
      onRegisteredSW(_url, registration) {
        if (registration) void ensurePersistentStorage();
      },
    });

  useEffect(() => {
    if (!needRefresh) return;
    setNeedRefresh(false);
    overlay.toast({
      severity: "info",
      title: "Доступна новая версия",
      message: "Обновите, чтобы не остаться на старой версии приложения.",
      duration: "sticky",
      action: { label: "Обновить", onAction: () => void updateServiceWorker(true) },
    });
    // needRefresh/setNeedRefresh/updateServiceWorker пересоздаются на каждый рендер хука
    // (useRegisterSW не мемоизирует) — зависимость только на само значение-триггер.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needRefresh]);

  useEffect(() => {
    if (!offlineReady) return;
    setOfflineReady(false);
    // SW может сообщить о готовом offline-кэше уже после события потери сети.
    // В этот момент приоритет у единственного статус-тоста «Нет сети».
    if (!navigator.onLine) return;
    offlineReadyToastRef.current = overlay.toast({ severity: "success", title: "Приложение готово к работе офлайн" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offlineReady]);

  useOnlineStatusToasts(offlineReadyToastRef);
  usePushDeepLinks();

  return null;
}

// Тап по пуш-нотификации (MF-434 §3): sw.ts фокусирует вкладку и шлёт
// PUSH_NAVIGATE с deepLink из payload сервера — здесь просто переходим,
// router.ts живёт в странице, не в SW. Заодно молчаливая реподписка на
// протухший endpoint (push/push.ts::resubscribeIfStale) — не UI, ничего не
// рисует, безопасно грузить сразу для всех.
function usePushDeepLinks() {
  useEffect(() => {
    void resubscribeIfStale();

    function onMessage(event: MessageEvent) {
      if (event.data?.type === "PUSH_NAVIGATE" && typeof event.data.deepLink === "string") {
        navigate(event.data.deepLink);
      }
    }
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);
}

// Явный офлайн-статус (MF-432 «Готово когда»): toast при потере/восстановлении сети —
// не постоянный баннер (та же причина, что выше — нужна Design-спека размещения).
function useOnlineStatusToasts(offlineReadyToastRef: { current: ToastHandle | null }) {
  const overlay = useOverlay();
  // Тост «нет сети» держим за id, чтобы восстановление сети явно его закрывало
  // (не ждём отдельного авто-исчезновения — sticky, т.к. offline может длиться часами).
  const offlineToastRef = useRef<ReturnType<typeof overlay.toast> | null>(null);
  const recoveryToastRef = useRef<ReturnType<typeof overlay.toast> | null>(null);

  useEffect(() => {
    function handleOffline() {
      // Браузер может прислать несколько offline-событий подряд (например, при
      // реконнекте Wi‑Fi). Один эпизод сети = один sticky-индикатор.
      offlineReadyToastRef.current?.dismiss();
      offlineReadyToastRef.current = null;
      if (offlineToastRef.current) return;
      offlineToastRef.current = overlay.toast({
        severity: "warn",
        title: "Нет сети",
        message: "Сохранённые данные могут быть устаревшими. Загрузка и генерация недоступны офлайн.",
        duration: "sticky",
      });
    }
    function handleOnline() {
      // Online без предыдущего offline — не новый переход и не повод показывать
      // повторный success-toast. Это также делает восстановление идемпотентным.
      if (!offlineToastRef.current) return;
      offlineToastRef.current?.dismiss();
      offlineToastRef.current = null;
      recoveryToastRef.current?.dismiss();
      recoveryToastRef.current = overlay.toast({ severity: "success", title: "Соединение восстановлено" });
    }
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    if (!navigator.onLine) handleOffline();
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
