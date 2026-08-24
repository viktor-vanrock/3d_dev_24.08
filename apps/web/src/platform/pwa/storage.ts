// Квота Cache Storage (MF-432): Safari/iOS особенно строг и может выселить кэш без
// предупреждения. persist() снижает шанс эвикции под давлением памяти (не гарантия —
// это подсказка браузеру, реального «зарезервировано навсегда» нет ни у одного вендора).
export async function ensurePersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted?.()) return true;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export interface StorageBudget {
  usageBytes: number;
  quotaBytes: number;
  usageRatio: number;
}

// Для будущего UI/диагностики (docs epic п.3: "navigator.storage.estimate()-бюджет") —
// пока не рендерится нигде, эстимейт не всегда доступен (Firefox приватный режим и т.п.).
export async function getStorageBudget(): Promise<StorageBudget | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  if (usage == null || quota == null || quota === 0) return null;
  return { usageBytes: usage, quotaBytes: quota, usageRatio: usage / quota };
}
