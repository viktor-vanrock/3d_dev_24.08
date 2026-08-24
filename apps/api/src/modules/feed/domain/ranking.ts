// Формулы ранжирования ленты (MF-420, Фаза 1 эпика MF-38) — чистые функции, без побочных
// эффектов и без обращения к БД: вход — денормализованные votes_up/votes_down/created_at,
// выход — число. Материализация (запись в post_score) —
// apps/api/src/modules/feed/infrastructure/scores.ts, эти
// функции сюда не тянут pg.
//
// Hot: карточка/эпик дают формулу текстом как `log10(max(1,|U−D|)) + sign(U−D)·(t−epoch)/45000`
// (порядок БЕЗ знака + знак у временнóго члена). Это отличается от канонической формулы Reddit
// (`sign(U−D)·log10(max(1,|U−D|)) + (t−epoch)/45000` — знак у ПОРЯДКА, временной член БЕЗ
// знака, см. reddit/r2/r2/lib/db/_sorts.py `_hot`/`_score`), на которую сама карточка ссылается
// («формула Reddit», docs/epics/domain.model.md §«Алгоритмы ранжирования»). Буквальная формула
// карточки даёт сильно заминусованным постам (down≫up) БОЛЬШОЙ ПОЛОЖИТЕЛЬНЫЙ вклад от order (лог
// модуля разницы голосов без знака) — заминусованный контент лез бы в топ Hot вместе с
// популярным, прямо противоречя и здравому смыслу сортировки, и её же критерию «Готово когда»
// (старый вирусный НЕ должен доминировать над свежим — про свежий контент ничего не говорит про
// down≫up топ). Data-вердикт (2026-07-10): реализована каноническая формула Reddit (знак у
// order), не буквальный текст карточки — расхождение с текстом карточки зафиксировано здесь и в
// комментарии к MF-420, эталонные кейсы карточки (см. ranking.test.ts) проходят в обеих версиях
// формулы (там нет теста на заминусованный контент), так что смена не ломает «Готово когда».
// Если Валерий/CTO хочет буквальную формулу карточки — правка одной строки в hotScore ниже.

// 2026-07-01T00:00:00Z — эпоха Hot зафиксирована на дату старта портала (карточка требует
// «зафиксировать эпоху на дату старта портала», явной даты «запуска» в доках нет — ближайший
// зафиксированный якорь: первый коммит репозитория 2026-07-02 и переход DNS 3mf.tech на cloud.ru
// 2026-07-03, docs/issues/009.dns.cloudru.md). Округлено до полуночи UTC предыдущего дня —
// ровное число, не привязанное к секунде конкретного коммита. Как и epoch у Reddit (1134028003),
// само число не участвует в смысле формулы — только сдвигает шкалу времени так, чтобы t−epoch
// было небольшим положительным числом с первого дня портала, а не гигантским unix-timestamp.
export const HOT_EPOCH_SECONDS = 1782864000;

// «Декада голосов» — временной делитель Hot (карточка/эпик, как у Reddit): ~12.5ч между шагами
// временного члена, эквивалентными единице order (log10 скачок разницы голосов на порядок).
const HOT_TIME_DIVISOR = 45000;

// z для 85% доверительного интервала Вильсона (Best) — карточка/эпик задают число буквально,
// не пересчитывается.
const BEST_Z = 1.281551565545;

function sign(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

function toEpochSeconds(createdAt: Date): number {
  return Math.floor(createdAt.getTime() / 1000);
}

// Hot — см. комментарий сверху файла про расхождение с буквальным текстом карточки.
// Монотонна по времени создания при равных голосах (свежее — выше), и по |U−D| при равном
// времени (популярнее в свою сторону — выше по модулю).
export function hotScore(votesUp: number, votesDown: number, createdAt: Date, epochSeconds: number = HOT_EPOCH_SECONDS): number {
  const diff = votesUp - votesDown;
  const order = Math.log10(Math.max(1, Math.abs(diff)));
  const seconds = toEpochSeconds(createdAt) - epochSeconds;
  return sign(diff) * order + seconds / HOT_TIME_DIVISOR;
}

// Best — нижняя граница доверительного интервала Вильсона для доли положительных голосов
// (up/(up+down)), z=1.281551565545 (85% CI). Малая уверенная выборка (5:0) обгоняет большую
// спорную (100:40) — см. ranking.test.ts. n=0 → 0 (нет голосов — нет уверенности, не NaN).
export function bestScore(votesUp: number, votesDown: number, z: number = BEST_Z): number {
  const n = votesUp + votesDown;
  if (n <= 0) return 0;
  const phat = votesUp / n;
  const z2 = z * z;
  const numerator = phat + z2 / (2 * n) - z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n);
  const denominator = 1 + z2 / n;
  return numerator / denominator;
}

// Top — сырой U−D. Окно времени (час/день/…/всё) — не параметр этой функции: Top(окно) считается
// запросом по votes.created_at за окно (Фаза 2/Back, votes уже хранит created_at на каждый
// голос), эта функция — то же самое действие (up−down) на уже отфильтрованном по окну наборе
// голосов, не отдельная формула.
export function topScore(votesUp: number, votesDown: number): number {
  return votesUp - votesDown;
}

// Controversial — magnitude^balance (каноническая формула Reddit, reddit/r2/r2/lib/db/_sorts.py
// `_controversy`): magnitude = up+down (объём), balance = min(up,down)/max(up,down) ∈ (0,1]
// (близость к 50/50 — чем ближе к 1, тем спорнее). 0 если голосов в одну сторону нет вовсе —
// не бывает «спора» без голосов с обеих сторон.
export function controversialScore(votesUp: number, votesDown: number): number {
  if (votesUp <= 0 || votesDown <= 0) return 0;
  const magnitude = votesUp + votesDown;
  const balance = votesUp > votesDown ? votesDown / votesUp : votesUp / votesDown;
  return Math.pow(magnitude, balance);
}

// New — чистая хронология: сортировка по feed_posts.created_at напрямую
// (feed_posts_visible_created_idx), никакой формулы не требуется. Функция — для симметрии
// API/тестов (детерминированный числовой ключ сортировки в тех же единицах, что Hot).
export function newScore(createdAt: Date): number {
  return toEpochSeconds(createdAt);
}
