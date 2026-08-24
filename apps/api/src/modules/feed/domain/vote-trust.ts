// Trust-вес голоса ленты (MF-1859, Фаза 3 эпика MF-38). Чистая функция без обращения к БД —
// вход уже загруженные `trust_level`/`created_at` голосующего, выход — вес голоса в [0, 1],
// который feed repository пишет в `votes.trust_snapshot` при каждом апсерте голоса.
//
// Базовый вес по `trust_level` (0..4, community/reputation.ts#recomputeTrustLevel — карма+
// активность за окно, единый источник доверия, вторая система кармы не изобретается). Отдельно
// клэмп до 0.5 для свежих аккаунтов (< FEED_GATE_MIN_AGE_FOR_FULL_TRUST_DAYS дней) — `trust_level`
// один возраст не покрывает (карму можно быстро набрать), а эпик прямо требует «карма/возраст/
// история» вместе.
const TRUST_WEIGHT_BY_LEVEL = [0.3, 0.55, 0.8, 1, 1] as const;
const FRESH_ACCOUNT_WEIGHT_CLAMP = 0.5;
const DAY_MS = 24 * 60 * 60 * 1000;

// Читаем env на каждый вызов (паттерн security/rateLimit.ts#positiveIntEnv) — тесты
// переопределяют лимиты через process.env без пересборки модуля.
function positiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export interface VoteTrustInput {
  trustLevel: number;
  createdAt: Date;
}

export function voteTrustWeight(user: VoteTrustInput): number {
  const level = Math.min(TRUST_WEIGHT_BY_LEVEL.length - 1, Math.max(0, Math.trunc(user.trustLevel)));
  let weight: number = TRUST_WEIGHT_BY_LEVEL[level]!;

  const minAgeDays = positiveIntEnv("FEED_GATE_MIN_AGE_FOR_FULL_TRUST_DAYS", 7);
  const ageDays = (Date.now() - user.createdAt.getTime()) / DAY_MS;
  if (ageDays < minAgeDays) weight = Math.min(weight, FRESH_ACCOUNT_WEIGHT_CLAMP);

  return weight;
}
