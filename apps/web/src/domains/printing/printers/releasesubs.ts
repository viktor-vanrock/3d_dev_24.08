import { useEffect, useState } from "react";

// Подписка «Уведомить о выходе» на релизы вендора (docs/design/printers.md §1/§3: подписка на саб
// вендора, тот же паттерн, что «Вступить»/«Выйти» саба сообщества, docs/design/community.md §2.2
// — оптимистичная смена состояния кнопки без диалога, видима при повторном визите). API подписки
// на релизы ещё нет (тот же блокер MF-833 §7: раздел не выкатывается, пока `GET /releases`
// отвечает гостю 401) — состояние живёт в localStorage, тем же приёмом, что `comparestate.ts`
// держит рабочий набор сравнения без общего провайдера в дереве.

const STORAGE_KEY = "portal.printers.releasesubs.v1";

function readStored(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function useReleaseSubs(): {
  isSubscribed: (vendor: string) => boolean;
  subscribe: (vendor: string) => void;
} {
  const [vendors, setVendors] = useState<string[]>(readStored);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(vendors));
    } catch {
      // приватный режим/квота — подписка просто не переживёт перезагрузку
    }
  }, [vendors]);

  return {
    isSubscribed: (vendor: string) => vendors.includes(vendor),
    // Подписка — одноразовое включение (§1: «→ подписка на саб вендора»), отписки с этой карточки
    // нет (симметрично «Уведомления включены» — залитая форма без обратного действия здесь, полная
    // отписка живёт на странице саба вендора, вне охвата этой карточки).
    subscribe: (vendor: string) => setVendors((current) => (current.includes(vendor) ? current : [...current, vendor])),
  };
}
