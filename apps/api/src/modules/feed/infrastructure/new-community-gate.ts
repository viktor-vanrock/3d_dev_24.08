// Гейтинг «нового саба» (MF-1859, Фаза 3 эпика MF-38, п.2 карточки): защита конкретно от
// накрутки/бригадинга сразу после создания community, не барьер входа на платформу в целом —
// старые сабы (вне окна FEED_GATE_NEW_COMMUNITY_WINDOW_DAYS) не гейтятся вовсе. Применяется к
// созданию поста/комментария/голосу, когда пост живёт в «новом» community; посты без community
// (профильная лента) гейтингу не подлежат.
//
// Пороги — калибруемые env, читаем на каждый вызов (паттерн security/rateLimit.ts#positiveIntEnv),
// не кэшируем модуль — тесты переопределяют без пересборки.
function positiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function newCommunityWindowDays(): number {
  return positiveIntEnv("FEED_GATE_NEW_COMMUNITY_WINDOW_DAYS", 14);
}

function minAccountAgeDays(): number {
  return positiveIntEnv("FEED_GATE_MIN_ACCOUNT_AGE_DAYS", 3);
}

function minReputation(): number {
  return positiveIntEnv("FEED_GATE_MIN_REPUTATION", 1);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type GateDenialCode = "ACCOUNT_TOO_NEW" | "REPUTATION_TOO_LOW";

function isNewCommunity(row: { readonly created_at: Date; readonly kind: string } | null): boolean {
  if (row === null) return false;
  // Официальные каталожные сабы (vendor/machine) не подлежат анти-бригадинг гейту вообще,
  // независимо от возраста: гейт защищает от захвата СВОЕЙ новой тусовки сразу после создания
  // (см. комментарий выше), а vendor/machine — не «своя», лениво создаётся системой один раз на
  // subject (unique index communities_subject_key) — никто не может создать конкурирующий
  // дубль-саб, чтобы забригадить именно его. MF-2036/MF-2037 2026-07-21: этот гейт молча слал
  // ВСЕ агентские посты в официальные сабы в фоллбэк «без community» (9 из 9 постов за день) —
  // не понятная деградация, а систематическая поломка основного пути.
  if (row.kind === "vendor" || row.kind === "machine") return false;
  const ageDays = (Date.now() - row.created_at.getTime()) / DAY_MS;
  return ageDays < newCommunityWindowDays();
}

// null — разрешено (пост без community, community вне окна новизны, либо аккаунт проходит оба
// порога). Отдельные коды на возраст/карму — UI должен уметь показать разную причину (карточка).
export function checkNewCommunityGate(
  community: { readonly created_at: Date; readonly kind: string } | null,
  user: { readonly created_at: Date; readonly reputation_score: number } | null,
): GateDenialCode | null {
  if (!isNewCommunity(community) || user === null) return null;

  const accountAgeDays = (Date.now() - user.created_at.getTime()) / DAY_MS;
  if (accountAgeDays < minAccountAgeDays()) return "ACCOUNT_TOO_NEW";
  if (user.reputation_score < minReputation()) return "REPUTATION_TOO_LOW";
  return null;
}
