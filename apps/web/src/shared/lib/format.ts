// Общие форматтеры/утилиты, на которые ссылаются несколько доменов (микроэтап 7.6):
// относительная дата (лента, карточки, комментарии) и детерминированный оттенок
// из id (плейсхолдеры аватаров/обложек). Чистые функции без доменных зависимостей.

export function relativeDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин.`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч.`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} дн.`;
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function hueFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

// Реальный AssistantThread не несёт статус (нет вычисляемого "готово"/"нужен ответ" на сервере) —
// показываем время последнего обновления вместо выдуманного статуса.
export function formatThreadUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 1) return "только что";
  if (diffMinutes < 60) return `${diffMinutes} ${pluralMinutes(diffMinutes)} назад`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} ${pluralHours(diffHours)} назад`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} ${pluralDays(diffDays)} назад`;
}

function pluralMinutes(value: number): string {
  return pluralRu(value, "минуту", "минуты", "минут");
}
function pluralHours(value: number): string {
  return pluralRu(value, "час", "часа", "часов");
}
function pluralDays(value: number): string {
  return pluralRu(value, "день", "дня", "дней");
}
function pluralRu(value: number, one: string, few: string, many: string): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
