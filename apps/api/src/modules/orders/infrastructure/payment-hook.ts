import type { Logger } from "../../../logger.ts";

// Хук оплаты (MF-17, эскроу) — интерфейс/сигнатура зафиксированы этой карточкой (MF-1001),
// сам платёж НЕ реализуется здесь (карта/СБП/ЮMoney — отдельные карточки MF-364/365 биллинга,
// `docs/epics/domain.model.md` § «Биллинг»). Переход заказа в `paid` дёргает этот хук — сегодня
// единственная реализация не сконфигурирована и no-op с warn, тот же паттерн, что
// `push/vapid.ts::isPushConfigured` (нет конфига — no-op с warn, не падение).
export interface OrderForPayment {
  id: string;
  masterId: string;
  clientId: string;
  quoteAmountMinor: number | null;
  currency: string;
}

export interface PaymentHook {
  // Дёргается ровно один раз на переход `accepted -> paid`, до записи в order_events.
  // Реализация эскроу (MF-17) должна быть идемпотентна по order.id — транзакция может
  // ретраиться на уровне вызывающего кода.
  onOrderPaid(order: OrderForPayment, log?: Logger): Promise<void>;
}

class NoopPaymentHook implements PaymentHook {
  onOrderPaid(order: OrderForPayment, log?: Logger): Promise<void> {
    log?.warn({ orderId: order.id }, "MF-17 payment hook не сконфигурирован — заказ помечен paid без реального эскроу-платежа");
    return Promise.resolve();
  }
}

let activeHook: PaymentHook = new NoopPaymentHook();

export function getPaymentHook(): PaymentHook {
  return activeHook;
}

// Точка расширения для реальной интеграции (MF-17) и для тестов transition.ts — тот же приём,
// что нигде явно не задокументирован в проекте, но следует общему принципу "swappable env-gated
// module" (push/email).
export function setPaymentHook(hook: PaymentHook): void {
  activeHook = hook;
}

export function resetPaymentHook(): void {
  activeHook = new NoopPaymentHook();
}
