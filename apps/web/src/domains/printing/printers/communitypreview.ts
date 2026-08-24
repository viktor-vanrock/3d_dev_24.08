export const PRINTER_COMMUNITY_PREVIEWS = [
  {
    id: "printer-creality.k1-max-profile",
    title: "Настройки профиля и первый слой",
    author: "@maker",
    age: "вчера",
    body: "Короткое превью обсуждения для карточки принтера. Полный тред появится здесь после подключения модели к сообществу.",
  },
  {
    id: "printer-creality.k1-max-hotend",
    title: "Какие материалы держит штатный хотэнд?",
    author: "@printlab",
    age: "3 дня назад",
    body: "Короткое превью обсуждения для карточки принтера. Полный тред появится здесь после подключения модели к сообществу.",
  },
  {
    id: "printer-creality.k1-max-share",
    title: "Делимся удачными профилями печати",
    author: "@layerone",
    age: "неделю назад",
    body: "Короткое превью обсуждения для карточки принтера. Полный тред появится здесь после подключения модели к сообществу.",
  },
] as const;

export function printerCommunityPreviewById(id: string) {
  return PRINTER_COMMUNITY_PREVIEWS.find((preview) => preview.id === id) ?? null;
}
