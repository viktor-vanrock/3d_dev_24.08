import { apiAssetUrl } from "@shared/api";
import "./honeypotlink.css";

// Путь-приманка backend'а (apps/api/src/security/honeypot.ts::HONEYPOT_PATH) — строкой здесь,
// не из общего пакета: остальные API-пути этого клиента (market/models.ts) тоже хардкодятся
// посайтово, отдельного слоя разделяемых путевых констант в репо нет.
const HONEYPOT_PATH = "/models/_index/scan";

// Невидимая человеку ссылка-ловушка (MF-737, Фаза 3 эпика MF-39): рендерится в галерее
// каталога (market.tsx) и на карточке проекта (model.tsx). Живой посетитель её не видит и не
// может достичь мышью/тачем/Tab (см. honeypotlink.css + aria-hidden/tabIndex ниже) — кликает
// только скрипт, обходящий все href на странице без учёта CSS/AT-разметки.
export function HoneypotLink() {
  return (
    <a className="honeypotLink" href={apiAssetUrl(HONEYPOT_PATH)} aria-hidden="true" tabIndex={-1} rel="nofollow">
      Смотреть все проекты
    </a>
  );
}
