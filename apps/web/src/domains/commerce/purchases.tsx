import { useEffect, useState } from "react";
import { modelPath, navigate } from "../../router.ts";
import { Card, CubeIcon, EmptyState, Heading } from "@shared/ui";
import { DownloadIcon } from "./model.icons.tsx";

import type { components } from "src/api/generated/openapi";
import { apiFetch } from "@shared/api";

export type PurchaseStatus = "pending" | "paid" | "failed" | "refunded" | "cancelled";

export type Purchase = components["schemas"]["PurchaseDto"];

const STATUS_LABELS: Record<PurchaseStatus, string> = {
  pending: "Ожидает оплаты",
  paid: "Оплачено",
  failed: "Ошибка оплаты",
  refunded: "Возвращено",
  cancelled: "Отменено",
};

export function formatMoney(minor: number, currency: string): string {
  const fractionDigits = minor % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency, minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })
    .format(minor / 100)
    .replace("\u00a0", " ");
}

async function createPurchase(modelId: string): Promise<components["schemas"]["PurchaseCreatedResponseDto"] | null> {
  const response = await apiFetch(`/purchases`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelId }),
  });
  if (!response.ok) return null;
  return (await response.json()) as components["schemas"]["PurchaseCreatedResponseDto"];
}

export function PurchaseAction({
  modelId,
  priceMinor,
  currency,
  purchased,
  downloadLabel = "Скачать 3MF",
  onDownload,
}: {
  modelId: string;
  priceMinor: number;
  currency: string;
  purchased: boolean;
  downloadLabel?: string;
  onDownload: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  if (priceMinor <= 0 || purchased) {
    return (
      <button type="button" className="modelGlassBtn modelDownloadBtn pressable" data-tone="active" onClick={onDownload}>
        <DownloadIcon /> {downloadLabel}
      </button>
    );
  }

  async function buy() {
    setPending(true);
    setError(false);
    const purchase = await createPurchase(modelId);
    if (!purchase?.confirmationUrl) {
      setPending(false);
      setError(true);
      return;
    }
    window.location.assign(purchase.confirmationUrl);
  }

  return (
    <div className="purchaseAction">
      <button type="button" className="modelGlassBtn modelDownloadBtn pressable" data-tone="active" disabled={pending} onClick={() => void buy()}>
        {pending ? "Переходим к оплате…" : `Купить за ${formatMoney(priceMinor, currency)}`}
      </button>
      {error ? <span className="purchaseError" role="alert">Не удалось начать оплату. Попробуйте ещё раз.</span> : null}
    </div>
  );
}

export function PurchasesPanel() {
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    void apiFetch(`/purchases`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("purchases unavailable");
        return (await response.json()) as components["schemas"]["PurchasesResponseDto"];
      })
      .then((result) => {
        if (active) setPurchases([...result.purchases]);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      });
    return () => { active = false; };
  }, []);

  return (
    <section className="purchasesPanel" aria-labelledby="purchases-title">
      <Heading size="md"><span id="purchases-title">Покупки</span></Heading>
      {unavailable ? <p className="purchaseHint">История покупок временно недоступна.</p> : null}
      {purchases?.length === 0 ? <EmptyState icon={<CubeIcon />} title="Покупок пока нет" sub="Купленные модели появятся здесь." /> : null}
      {purchases?.map((purchase) => (
        <Card key={purchase.id} className="purchaseRow">
          <button type="button" className="purchaseModelLink pressable" onClick={() => navigate(modelPath(purchase.model_id))}>
            {purchase.model_title}
          </button>
          <span>{formatMoney(purchase.price_minor, purchase.currency)}</span>
          <span className="purchaseStatus" data-status={purchase.status}>{STATUS_LABELS[purchase.status as PurchaseStatus] ?? purchase.status}</span>
        </Card>
      ))}
    </section>
  );
}

export function PurchaseReturnScreen({ id }: { id: string }) {
  const [purchase, setPurchase] = useState<Purchase | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void apiFetch(`/purchases/${encodeURIComponent(id)}`, { credentials: "include" })
      .then(async (response) =>
        response.ok ? (await response.json()) as components["schemas"]["PurchaseResponseDto"] : null
      )
      .then((result) => { if (active) setPurchase(result?.purchase ?? null); });
    return () => { active = false; };
  }, [id]);

  const title =
    purchase === undefined ? "Проверяем оплату…" :
    purchase?.status === "paid" ? "Покупка оплачена" :
    purchase?.status === "pending" ? "Оплата обрабатывается" :
    purchase ? (STATUS_LABELS[purchase.status as PurchaseStatus] ?? purchase.status) :
    "Не удалось проверить оплату";

  return (
    <main className="purchaseReturn">
      <Card className="purchaseReturnCard">
        <Heading size="md">{title}</Heading>
        {purchase?.status === "paid" ? <button type="button" className="modelGlassBtn pressable" onClick={() => navigate(modelPath(purchase.model_id))}>Перейти к скачиванию</button> : null}
        {purchase && purchase.status !== "paid" ? <button type="button" className="modelGlassBtn pressable" onClick={() => navigate(modelPath(purchase.model_id))}>Вернуться к модели</button> : null}
        {purchase === null ? <button type="button" className="modelGlassBtn pressable" onClick={() => navigate("/profile")}>Открыть покупки</button> : null}
      </Card>
    </main>
  );
}