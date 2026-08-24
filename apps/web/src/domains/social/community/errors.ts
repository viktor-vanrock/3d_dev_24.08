// Маппинг кодов API → RU-текст (docs/design/community.md §6). NOT_AN_ANSWER/AUTHOR_ONLY
// намеренно не текстуются отдельно — кнопка «Отметить принятым» физически не рендерится при
// несоблюдении условий (§3.5), эти коды ловит только гонка, тихий тост общей формулировкой.

const MESSAGES: Record<string, string> = {
  NAME_REQUIRED: "Введите название сообщества",
  NAME_TOO_LONG: "Название — до 120 символов",
  DESCRIPTION_TOO_LONG: "Описание — до 4000 символов",
  SLUG_TAKEN: "Похожее название уже занято, уточните",
  TITLE_REQUIRED: "Введите заголовок",
  TITLE_TOO_LONG: "Заголовок — до 200 символов",
  CONTENT_REQUIRED: "Введите текст",
  CONTENT_TOO_LONG: "Текст — до 20 000 символов",
  INVALID_TAGS: "До 5 тегов",
  THREAD_NOT_OPEN: "Тред закрыт для новых ответов",
  LAST_OWNER_CANNOT_LEAVE: "Вы последний владелец — назначьте другого перед выходом",
};

const FALLBACK = "Не удалось сохранить. Попробуйте ещё раз";

export function communityErrorMessage(code: string): string {
  return MESSAGES[code] ?? FALLBACK;
}
