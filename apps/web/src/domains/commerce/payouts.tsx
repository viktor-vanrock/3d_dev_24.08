import { useEffect, useState } from "react";
import { Button, Card, CubeIcon, EmptyState, Eyebrow, FieldGroup, Heading, Input, StatTile } from "@shared/ui";
import { formatMoney } from "./purchases.tsx";

import type { components } from "src/api/generated/openapi";
import { apiFetch } from "@shared/api";

export type PayoutStatus = "pending" | "processing" | "paid" | "failed" | "cancelled";
export type PayoutMethod = "card" | "sbp" | "account";

export type Balance = components["schemas"]["BalanceResponseDto"];
export type Sale = components["schemas"]["SaleDto"];
export type Payout = components["schemas"]["PayoutDto"];

const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  pending: "Ожидает обработки",
  processing: "В обработке",
  paid: "Выплачено",
  failed: "Не удалось",
  cancelled: "Отменено",
};

const PAYOUT_METHOD_LABELS: Record<PayoutMethod, string> = {
  card: "Карта",
  sbp: "СБП (телефон)",
  account: "Расчётный счёт",
};

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const response = await apiFetch(`${path}`, { credentials: "include" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function requestPayout(amountMinor: number, method: PayoutMethod, value: string): Promise<Payout | { error: string }> {
  const response = await apiFetch(`/payouts`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amountMinor, requisites: { method, value } }),
  });
  const body = (await response.json()) as Payout & { error?: string };
  if (!response.ok) return { error: body.error ?? "request_failed" };
  return body;
}

export function PayoutsPanel() {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  function reload() {
    void fetchJson<Balance>("/me/balance").then((result) => {
      if (!result) return setUnavailable(true);
      setBalance(result);
    });
    void fetchJson<components["schemas"]["SalesResponseDto"]>("/sales").then((result) =>
      setSales(result?.sales ? [...result.sales] : [])
    );
    void fetchJson<components["schemas"]["PayoutsResponseDto"]>("/payouts").then((result) =>
      setPayouts(result?.payouts ? [...result.payouts] : [])
    );
  }

  useEffect(reload, []);

  if (unavailable) return null;
  // Пусто и баланс, и продажи, и заявки — автору ещё нечего показывать в этом блоке.
  if (balance && balance.availableMinor === 0 && balance.holdMinor === 0 && sales?.length === 0 && payouts?.length === 0) {
    return null;
  }

  return (
    <section className="payoutsPanel" aria-labelledby="payouts-title">
      <Heading size="md"><span id="payouts-title">Баланс и выплаты</span></Heading>

      {balance ? (
        <div className="payoutsBalanceRow">
          <StatTile label="Доступно к выводу" value={formatMoney(balance.availableMinor, balance.currency)} />
          <StatTile label="В холде" value={formatMoney(balance.holdMinor, balance.currency)} hint="Станет доступно по истечении срока холда" />
        </div>
      ) : null}

      {balance && balance.availableMinor > 0 ? (
        <PayoutRequestForm balance={balance} onCreated={reload} />
      ) : null}

      {sales?.length ? (
        <div className="payoutsSalesSection">
          <Eyebrow>Продажи</Eyebrow>
          {sales.map((sale) => (
            <Card key={sale.id} className="payoutsSaleRow">
              <span>{sale.model_title}</span>
              <span>{formatMoney(sale.seller_amount_minor, sale.currency)}</span>
            </Card>
          ))}
        </div>
      ) : null}

      {payouts?.length === 0 && (!sales || sales.length === 0) ? (
        <EmptyState icon={<CubeIcon />} title="Пока нечего выводить" sub="Баланс появится после первой оплаченной продажи." />
      ) : null}

      {payouts?.length ? (
        <div className="payoutsHistorySection">
          <Eyebrow>Заявки на вывод</Eyebrow>
          {payouts.map((payout) => (
            <Card key={payout.id} className="payoutRow">
              <span>{formatMoney(payout.amountMinor, payout.currency)}</span>
              <span className="payoutStatus" data-status={payout.status}>{PAYOUT_STATUS_LABELS[payout.status as PayoutStatus] ?? payout.status}</span>
            </Card>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PayoutRequestForm({ balance, onCreated }: { balance: Balance; onCreated: () => void }) {
  const [amountRub, setAmountRub] = useState("");
  const [method, setMethod] = useState<PayoutMethod>("card");
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const amountMinor = Math.round(Number(amountRub.replace(",", ".")) * 100);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      setError("Введите сумму больше нуля.");
      return;
    }
    if (amountMinor > balance.availableMinor) {
      setError("Сумма превышает доступный баланс.");
      return;
    }
    if (value.trim().length === 0) {
      setError("Укажите реквизиты для вывода.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await requestPayout(amountMinor, method, value.trim());
    setPending(false);
    if ("error" in result) {
      setError(result.error === "insufficient_balance" ? "Сумма превышает доступный баланс." : "Не удалось создать заявку. Попробуйте ещё раз.");
      return;
    }
    setAmountRub("");
    setValue("");
    onCreated();
  }

  return (
    <Card className="payoutRequestForm">
      <FieldGroup>
        <Input
          type="text"
          inputMode="decimal"
          placeholder={`Сумма, ₽ (доступно ${formatMoney(balance.availableMinor, balance.currency)})`}
          value={amountRub}
          onChange={(event) => setAmountRub(event.target.value)}
        />
      </FieldGroup>
      <div className="payoutMethodRow">
        {(Object.keys(PAYOUT_METHOD_LABELS) as PayoutMethod[]).map((option) => (
          <button
            key={option}
            type="button"
            className="payoutMethodOption pressable"
            data-selected={method === option}
            onClick={() => setMethod(option)}
          >
            {PAYOUT_METHOD_LABELS[option]}
          </button>
        ))}
      </div>
      <FieldGroup>
        <Input
          type="text"
          placeholder={method === "card" ? "Номер карты" : method === "sbp" ? "Номер телефона" : "Номер счёта"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </FieldGroup>
      {error ? <span className="purchaseError" role="alert">{error}</span> : null}
      <Button onClick={() => void submit()} disabled={pending}>
        {pending ? "Отправляем заявку…" : "Запросить выплату"}
      </Button>
    </Card>
  );
}