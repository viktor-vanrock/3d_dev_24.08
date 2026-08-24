import { pool } from "../../../db/client.ts";

// Гейт скачивания платной модели — недостающий шаг 3 карточки MF-363 (схема/цена были готовы,
// сам гейт остался нереализован при закрытии карточки, см. тред MF-17/MF-1025/MF-1026). Владелец
// и покупатели с завершённой оплатой (purchases.status='paid') скачивают как раньше;
// price_minor=0 (бесплатная модель, MVP-дефолт) никогда не гейтится — существующее поведение не
// меняется.
export async function hasDownloadEntitlement(modelId: string, ownerId: string, priceMinor: number, userId: string): Promise<boolean> {
  if (priceMinor <= 0) return true;
  if (ownerId === userId) return true;
  const result = await pool.query(`select 1 from purchases where model_id = $1 and buyer_id = $2 and status = 'paid' limit 1`, [modelId, userId]);
  return (result.rowCount ?? 0) > 0;
}
