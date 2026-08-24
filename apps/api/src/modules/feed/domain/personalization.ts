// Персонализация scope=recommended (MF-1860, Фаза 3 эпика MF-38, родитель MF-422): три буста
// поверх Hot — подписка/пересечение тегов-интересов/свежесть в холодном сабе. Аддитивные, не
// мультипликативные (ranking.ts#hotScore может быть отрицательным для заминусованного контента —
// умножение на коэффициент способно перевернуть порядок непредсказуемо, см. описание карточки).
//
// Веса и пороги — env, читаются на каждый вызов (тот же паттерн, что
// security/rateLimit.ts::positiveIntEnv/generations/contract.ts::generationQuotaHourly — тесты
// переопределяют через process.env без пересборки модуля). positiveIntEnv не подходит буквально
// (веса дробные) — numberEnv ниже тот же принцип, просто без ограничения "целое и > 0".

function numberEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

// Порядок величины — доли часа временного члена Hot (HOT_TIME_DIVISOR=45000с ⇒ ~12.5ч даёт
// сдвиг на 1.0), не единицы order — буст не должен сам по себе выталкивать пост через несколько
// порядков голосов.
export function subscriptionBoostWeight(): number {
  return numberEnv("FEED_RECOMMEND_SUBSCRIPTION_BOOST", 0.5);
}

export function tagBoostWeight(): number {
  return numberEnv("FEED_RECOMMEND_TAG_BOOST", 0.3);
}

export function freshnessBoostWeight(): number {
  return numberEnv("FEED_RECOMMEND_COLD_FRESHNESS_BOOST", 0.4);
}

// Окно «интересов» юзера (модели, которые смотрел/скачивал; сабы, с которыми взаимодействовал) —
// карточка называет 30 дней явно для просмотров/скачиваний, тот же порядок применяем и к
// взаимодействию с сабами (нет отдельного числа в карточке, держим одну ручку конфигурации).
export function interestWindowDays(): number {
  return positiveIntEnv("FEED_RECOMMEND_INTEREST_WINDOW_DAYS", 30);
}

// «Холодный саб» — окно/порог для агрегата "сколько постов вышло за последние N дней"
// (community/reputation.ts#windowActivity — тот же принцип "агрегат запросом", не
// денормализованная колонка).
export function coldCommunityWindowDays(): number {
  return positiveIntEnv("FEED_RECOMMEND_COLD_COMMUNITY_WINDOW_DAYS", 30);
}

export function coldCommunityPostThreshold(): number {
  return positiveIntEnv("FEED_RECOMMEND_COLD_COMMUNITY_POST_THRESHOLD", 20);
}

// «Свежий пост» в холодном сабе — моложе скольких часов получает буст.
export function coldCommunityFreshHours(): number {
  return positiveIntEnv("FEED_RECOMMEND_COLD_COMMUNITY_FRESH_HOURS", 48);
}

export interface RecommendationBoostInput {
  subscribed: boolean; // (а) пост из саба, на который юзер подписан
  interestMatch: boolean; // (б) пересечение тегов/сабов поста и юзера (модели-интересы/вовлечённые сабы)
  coldCommunityFresh: boolean; // (в) свежий пост в холодном сабе
}

// Чистая функция буста — та же аддитивная комбинация весов, что SQL-выражение в list.ts#queryFeed
// собирает per-row через CTE personalize_context/cold_communities (feed/list.ts). Единственный
// источник весов — функции выше, так что SQL и эта функция не могут разъехаться числами по
// отдельности, только логикой комбинирования (что и покрывает personalize.test.ts).
export function recommendationBoost(input: RecommendationBoostInput): number {
  let boost = 0;
  if (input.subscribed) boost += subscriptionBoostWeight();
  if (input.interestMatch) boost += tagBoostWeight();
  if (input.coldCommunityFresh) boost += freshnessBoostWeight();
  return boost;
}
