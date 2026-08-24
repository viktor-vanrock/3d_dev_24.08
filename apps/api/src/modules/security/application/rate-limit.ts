import { createHash } from "node:crypto";

export interface RateLimitRequestIdentity {
  readonly ip: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

// Многофакторный rate-limit по скачиваниям/листингам (MF-424 Фаза 2 эпика MF-39, шаг 1).
//
// Сайт закрыт авторизацией (server.ts OPEN_PATH_PREFIXES) — на /models и /models/:id/download.3mf
// анонимов физически нет (401 без сессии режется раньше этого модуля), поэтому реальная угроза
// массового обхода — не анонимный скрипт, а один залогиненный аккаунт (или несколько аккаунтов
// с одного клиента), гоняющий листинг/скачивание быстрее человека. Ключуем по ТРЁМ независимым
// факторам — IP, user_id, лёгкий fingerprint заголовков (без клиентского JS/canvas) — и лимитируем
// каждый отдельно: обход одного фактора (VPN меняет IP, инкогнито чистит cookie) не даёт обойти
// остальные два. IP на проде — за nginx (X-Forwarded-For), см. trustProxy в server.ts.
//
// Деградация, не бан (продуктовое требование, "Готово когда" карточки): превышение лимита даёт
// 429 + Retry-After на текущее окно — как только окно откатится, ключ снова свободен. Продолжение
// накопления нарушений подряд (см. violationStreak) увеличивает искусственную задержку ответа
// (slowdown) на следующее окно вместо жёсткого отказа — цена растёт, доступ не обнуляется навсегда.
// Turnstile-челлендж — точка расширения: если и когда TURNSTILE_SECRET_KEY появится в env, сюда
// добавится проверка токена клиента; без конфига — no-op (паттерн репо, см. storage/s3.ts).

export type RateLimitScope =
  | "auth_password"
  | "download"
  | "listing"
  | "make_create"
  | "make_report"
  | "make_image"
  | "model_report"
  | "public_api"
  | "idea_create"
  | "idea_enrich"
  | "prompt_variants"
  | "slice_create"
  | "profile_recommendation"
  | "calibration_create"
  | "candidate_suggest"
  | "print_request_create"
  | "device_print_request_create"
  | "feed_vote"
  | "feed_post_create"
  | "feed_comment_create"
  | "feed_media_upload"
  | "feed_gitverse_parse";

interface WindowConfig {
  limit: number;
  windowMs: number;
}

interface ScopeConfig {
  user: WindowConfig;
  ip: WindowConfig;
  fingerprint: WindowConfig;
}

const MINUTE_MS = 60_000;

function positiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

// Читаем env на каждый вызов (паттерн generations/contract.ts::generationQuotaHourly) — тесты
// переопределяют лимиты через process.env без пересборки модуля.
//
// make_create/make_report/make_image (MF-780, анти-абьюз Make-галереи): публикация и жалоба
// лимитируются жёстко (единицы в минуту — редкое ручное действие, не листинг), раздача фото —
// мягче, но заметно строже "listing" (последовательная выкачка ботом/скрейпером бьёт по
// IP/fingerprint раньше, чем по одному user_id).
function scopeConfig(scope: RateLimitScope): ScopeConfig {
  switch (scope) {
    case "auth_password":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_AUTH_PASSWORD_USERNAME_PER_MIN", 5), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_AUTH_PASSWORD_IP_PER_MIN", 10), windowMs: MINUTE_MS },
        fingerprint: { limit: positiveIntEnv("RATE_LIMIT_AUTH_PASSWORD_FINGERPRINT_PER_MIN", 10), windowMs: MINUTE_MS },
      };
    case "download":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_DOWNLOAD_USER_PER_MIN", 20), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_DOWNLOAD_IP_PER_MIN", 40), windowMs: MINUTE_MS },
        fingerprint: { limit: positiveIntEnv("RATE_LIMIT_DOWNLOAD_FINGERPRINT_PER_MIN", 30), windowMs: MINUTE_MS },
      };
    case "make_create":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_MAKE_CREATE_USER_PER_MIN", 5), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_MAKE_CREATE_IP_PER_MIN", 10), windowMs: MINUTE_MS },
        fingerprint: { limit: positiveIntEnv("RATE_LIMIT_MAKE_CREATE_FINGERPRINT_PER_MIN", 8), windowMs: MINUTE_MS },
      };
    // Идеи (MF-1005): дневная квота 3/сутки на автора уже держит объём (ideas/create.ts,
    // advisory-lock), это отдельный многофакторный гейт под honeypot-флаг (см. flagBotSignal) —
    // сам по себе почти не режет живых людей (единицы подач в минуту — редкое ручное действие),
    // но именно через checkRateLimit проходит проверка botFlags, которую create.ts раньше не
    // вызывал вовсе (форма не была подключена к ловушке).
    case "idea_create":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_IDEA_CREATE_USER_PER_MIN", 5), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_IDEA_CREATE_IP_PER_MIN", 10), windowMs: MINUTE_MS },
        fingerprint: { limit: positiveIntEnv("RATE_LIMIT_IDEA_CREATE_FINGERPRINT_PER_MIN", 8), windowMs: MINUTE_MS },
      };
    // AI-обогащение подачи идеи (MF-565): дневная квота 10/сутки уже держит объём
    // (ideas/enrich.ts, advisory-lock, тот же паттерн что idea_create) — этот per-minute гейт
    // защищает giga (платный внешний вызов) от всплеска в пределах дневной квоты (10 вызовов
    // за секунду вместо суток) и подключает honeypot-флаг тем же путём, что idea_create.
    case "idea_enrich":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_IDEA_ENRICH_USER_PER_MIN", 5), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_IDEA_ENRICH_IP_PER_MIN", 10), windowMs: MINUTE_MS },
        fingerprint: { limit: positiveIntEnv("RATE_LIMIT_IDEA_ENRICH_FINGERPRINT_PER_MIN", 8), windowMs: MINUTE_MS },
      };
    // Варианты промпта главной (MF-2068): под сессией (см. promptVariants.ts), тот же порядок
    // величины, что idea_enrich. Провайдер теперь локальная Gemma, но вычислительный слот всё
    // равно ограничен; ввод запроса вызывается чаще разовой подачи идеи, поэтому лимит мягче.
    case "prompt_variants":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_PROMPT_VARIANTS_USER_PER_MIN", 15), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_PROMPT_VARIANTS_IP_PER_MIN", 30), windowMs: MINUTE_MS },
        fingerprint: { limit: positiveIntEnv("RATE_LIMIT_PROMPT_VARIANTS_FINGERPRINT_PER_MIN", 20), windowMs: MINUTE_MS },
      };
    // Слайсинг (MF-1078): CPU-тяжёлая очередь (apps/mesh, headless prusa-slicer) — жёстче
    // download/make_create, единицы джобов в минуту на юзера достаточно для реального
    // рабочего процесса (перебор пары профилей на модель), не для скрейпинга очереди.
    case "slice_create":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_SLICE_CREATE_USER_PER_MIN", 6), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_SLICE_CREATE_IP_PER_MIN", 12), windowMs: MINUTE_MS },
        fingerprint: { limit: positiveIntEnv("RATE_LIMIT_SLICE_CREATE_FINGERPRINT_PER_MIN", 10), windowMs: MINUTE_MS },
      };
    case "profile_recommendation":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_PROFILE_RECOMMENDATION_USER_PER_MIN", 12), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_PROFILE_RECOMMENDATION_IP_PER_MIN", 24), windowMs: MINUTE_MS },
        fingerprint: { limit: positiveIntEnv("RATE_LIMIT_PROFILE_RECOMMENDATION_FINGERPRINT_PER_MIN", 18), windowMs: MINUTE_MS },
      };
    // Приём калибровки/исхода печати (MF-1940, стадия 4 эпика MF-34, v2 «Обучающий сигнал»):
    // ручной ввод с страницы результата печати — та же величина, что candidate_suggest/
    // print_request_create (редкое ручное действие, не листинг).
    case "calibration_create":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_CALIBRATION_CREATE_USER_PER_MIN", 5), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_CALIBRATION_CREATE_IP_PER_MIN", 10), windowMs: MINUTE_MS },
        fingerprint: { limit: positiveIntEnv("RATE_LIMIT_CALIBRATION_CREATE_FINGERPRINT_PER_MIN", 8), windowMs: MINUTE_MS },
      };
    // «Предложить принтер/филамент» из формы Make (MF-1793, п.6): свободный текст в staging-
    // очередь (material_candidates/machine_candidates, source='user_suggestion') — тот же порядок
    // величины, что make_report (редкое ручное действие, не листинг), не make_create (там ещё и
    // фото гоняются через mesh).
    case "candidate_suggest":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_CANDIDATE_SUGGEST_USER_PER_MIN", 5), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_CANDIDATE_SUGGEST_IP_PER_MIN", 10), windowMs: MINUTE_MS },
        fingerprint: { limit: positiveIntEnv("RATE_LIMIT_CANDIDATE_SUGGEST_FINGERPRINT_PER_MIN", 8), windowMs: MINUTE_MS },
      };
    // Заявка клиента мастеру (MF-996, поток заявок Фазы 2 эпика MF-30): тот же порядок
    // величины, что make_create (редкое ручное действие, не листинг) — заводим отдельный
    // scope-ключ, не делим бакет с публикацией Make, но копируем её лимиты как стартовые.
    case "print_request_create":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_PRINT_REQUEST_CREATE_USER_PER_MIN", 5), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_PRINT_REQUEST_CREATE_IP_PER_MIN", 10), windowMs: MINUTE_MS },
        fingerprint: {
          limit: positiveIntEnv("RATE_LIMIT_PRINT_REQUEST_CREATE_FINGERPRINT_PER_MIN", 8),
          windowMs: MINUTE_MS,
        },
      };
    // Постановка device-print-request (MF-1975, очередь печати U1 через relay): доставка
    // реального G-code на живое устройство — та же величина, что calibration_create (редкое
    // намеренное действие, не листинг), отдельный scope-ключ от print_request_create
    // (та карточка — заявка клиенту мастеру, не устройство).
    case "device_print_request_create":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_DEVICE_PRINT_REQUEST_CREATE_USER_PER_MIN", 5), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_DEVICE_PRINT_REQUEST_CREATE_IP_PER_MIN", 10), windowMs: MINUTE_MS },
        fingerprint: {
          limit: positiveIntEnv("RATE_LIMIT_DEVICE_PRINT_REQUEST_CREATE_FINGERPRINT_PER_MIN", 8),
          windowMs: MINUTE_MS,
        },
      };
    // Лента (MF-1859, Фаза 3 эпика MF-38): голос — частое, лёгкое действие (клик по стрелке),
    // публикация поста/комментария — редкое ручное действие. feed_vote заметно выше
    // feed_post_create/feed_comment_create по той же логике, что make_image мягче make_create —
    // объём легитимного трафика у голосов на порядок больше, жёсткий лимит там душил бы обычных
    // читателей ленты, а не накрутку.
    case "feed_vote":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_FEED_VOTE_USER_PER_MIN", 60), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_FEED_VOTE_IP_PER_MIN", 120), windowMs: MINUTE_MS },
        fingerprint: { limit: positiveIntEnv("RATE_LIMIT_FEED_VOTE_FINGERPRINT_PER_MIN", 90), windowMs: MINUTE_MS },
      };
    case "feed_post_create":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_FEED_POST_CREATE_USER_PER_MIN", 5), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_FEED_POST_CREATE_IP_PER_MIN", 10), windowMs: MINUTE_MS },
        fingerprint: {
          limit: positiveIntEnv("RATE_LIMIT_FEED_POST_CREATE_FINGERPRINT_PER_MIN", 8),
          windowMs: MINUTE_MS,
        },
      };
    case "feed_comment_create":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_FEED_COMMENT_CREATE_USER_PER_MIN", 20), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_FEED_COMMENT_CREATE_IP_PER_MIN", 40), windowMs: MINUTE_MS },
        fingerprint: {
          limit: positiveIntEnv("RATE_LIMIT_FEED_COMMENT_CREATE_FINGERPRINT_PER_MIN", 30),
          windowMs: MINUTE_MS,
        },
      };
    // Аплоад медиа-вложения ленты (MF-1927): та же величина, что make_image (раздача фото) —
    // не листинг, но и не единичное редкое действие вроде feed_post_create (автор может
    // перезалить фото/видео пару раз, подбирая кадр, прежде чем нажать "Опубликовать").
    case "feed_media_upload":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_FEED_MEDIA_UPLOAD_USER_PER_MIN", 15), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_FEED_MEDIA_UPLOAD_IP_PER_MIN", 30), windowMs: MINUTE_MS },
        fingerprint: {
          limit: positiveIntEnv("RATE_LIMIT_FEED_MEDIA_UPLOAD_FINGERPRINT_PER_MIN", 20),
          windowMs: MINUTE_MS,
        },
      };
    // Парсинг GitVerse-превью (MF-1927): срабатывает на blur/Enter поля редактора — легитимный
    // трафик выше, чем feed_post_create, но это исходящий сетевой вызов на чужой хост, не голое
    // чтение своей БД — держим заметно ниже listing.
    case "feed_gitverse_parse":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_FEED_GITVERSE_PARSE_USER_PER_MIN", 20), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_FEED_GITVERSE_PARSE_IP_PER_MIN", 40), windowMs: MINUTE_MS },
        fingerprint: {
          limit: positiveIntEnv("RATE_LIMIT_FEED_GITVERSE_PARSE_FINGERPRINT_PER_MIN", 30),
          windowMs: MINUTE_MS,
        },
      };
    case "make_report":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_MAKE_REPORT_USER_PER_MIN", 5), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_MAKE_REPORT_IP_PER_MIN", 10), windowMs: MINUTE_MS },
        fingerprint: { limit: positiveIntEnv("RATE_LIMIT_MAKE_REPORT_FINGERPRINT_PER_MIN", 8), windowMs: MINUTE_MS },
      };
    // Жалоба на модель (MF-1788, эпик MF-910): та же величина, что make_report — редкое
    // ручное действие, не листинг. Отдельный scope-ключ, не делит бакет с makes/report.ts —
    // тот же принцип, что print_request_create/candidate_suggest выше (копируем лимиты
    // make_report как стартовые, не смешиваем бакеты разных subject_type).
    case "model_report":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_MODEL_REPORT_USER_PER_MIN", 5), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_MODEL_REPORT_IP_PER_MIN", 10), windowMs: MINUTE_MS },
        fingerprint: { limit: positiveIntEnv("RATE_LIMIT_MODEL_REPORT_FINGERPRINT_PER_MIN", 8), windowMs: MINUTE_MS },
      };
    case "make_image":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_MAKE_IMAGE_USER_PER_MIN", 90), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_MAKE_IMAGE_IP_PER_MIN", 120), windowMs: MINUTE_MS },
        fingerprint: { limit: positiveIntEnv("RATE_LIMIT_MAKE_IMAGE_FINGERPRINT_PER_MIN", 90), windowMs: MINUTE_MS },
      };
    // Публичный API v0 (MF-888): userId здесь — api_key.id, не users.id (ключ, не сессия,
    // см. publicapi/v0.route.ts::requireApiKey) — тот же "user"-фактор мультифакторной схемы
    // выше, просто другое пространство идентичности стороннего клиента. ip/fingerprint для
    // серверных интеграций малополезны (общий IP хостинга, нет браузерных заголовков), но
    // дёшевы как есть и не вредят — настоящий контроль несёт лимит по самому ключу.
    case "public_api":
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_PUBLIC_API_KEY_PER_MIN", 60), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_PUBLIC_API_IP_PER_MIN", 240), windowMs: MINUTE_MS },
        fingerprint: { limit: positiveIntEnv("RATE_LIMIT_PUBLIC_API_FINGERPRINT_PER_MIN", 240), windowMs: MINUTE_MS },
      };
    case "listing":
    default:
      return {
        user: { limit: positiveIntEnv("RATE_LIMIT_LISTING_USER_PER_MIN", 120), windowMs: MINUTE_MS },
        ip: { limit: positiveIntEnv("RATE_LIMIT_LISTING_IP_PER_MIN", 240), windowMs: MINUTE_MS },
        fingerprint: { limit: positiveIntEnv("RATE_LIMIT_LISTING_FINGERPRINT_PER_MIN", 180), windowMs: MINUTE_MS },
      };
  }
}

// Список через запятую — IP или user_id, которым лимит не применяется вовсе (легит-парсеры
// авторов на время миграции каталога, см. описание карточки). Пусто по умолчанию — не open door.
function allowlist(name: string): Set<string> {
  const raw = process.env[name];
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
}

interface KeyState {
  hits: number[]; // timestamps (ms) внутри текущего окна, отсортированы по возрастанию
  violationStreak: number; // подряд идущих превышений — управляет длиной slowdown, не банит
}

const buckets = new Map<string, KeyState>();

// Отметки «это бот» от honeypot-ловушки (MF-737, Фаза 3 эпика MF-39): клик по невидимой
// человеку ссылке в галерее/карточке (apps/web security/honeypotlink.tsx) бьёт по тому же
// ip/user, что и обычный rate-limit — единый слой идентичности, не второй параллельный (см.
// описание карточки: "состыкуйся с MF-424, не изобретай второй"). Флаг живёт TTL, а не
// навсегда — деградация, не бан, тот же принцип, что и violationStreak выше.
//
// НЕ включает fingerprint (QA MF-737, найдена реальная дыра): requestFingerprint — грубый хэш
// только заголовков (UA/lang/encoding), одинаковый у любых двух клиентов с типовым браузером/
// локалью. В обычном checkFactor это безопасно — там нужен ОБЪЁМ запросов, чтобы задеть чужой
// fp-бакет (порог RATE_LIMIT_*_FINGERPRINT_PER_MIN). Здесь же флаг ставится по ОДНОМУ клику, без
// порога — включи fp в ключи, и один клик по ловушке от кого угодно с дефолтным Chrome/en-US/gzip
// на 30 минут сажает на 429 ВСЕХ ДРУГИХ пользователей с тем же типовым fingerprint, не только
// кликнувшего (DoS/griefing через честный, но чужой клик). ip/user специфичны для самого
// кликнувшего клиента — этого достаточно для сигнала бота без побочного ущерба посторонним.
interface BotFlagState {
  flaggedAt: number;
  reason: string;
}

const botFlags = new Map<string, BotFlagState>();
const BOT_FLAG_TTL_MS = 30 * MINUTE_MS;
const BOT_FLAG_RETRY_AFTER_SECONDS = 60;

function botFlagKeys(request: RateLimitRequestIdentity, userId: string | null): string[] {
  const keys = [`ip:${request.ip}`];
  if (userId) keys.push(`user:${userId}`);
  return keys;
}

// Вызывается из honeypot-роута (security/honeypot.ts) на клик по ловушке — помечает identity
// бота сразу по ip/user (см. комментарий у botFlagKeys про fingerprint), без ожидания
// превышения счётчика.
export function flagBotSignal(request: RateLimitRequestIdentity, userId: string | null, reason: string): void {
  const now = Date.now();
  for (const key of botFlagKeys(request, userId)) {
    botFlags.set(key, { flaggedAt: now, reason });
  }
}

function checkBotFlag(request: RateLimitRequestIdentity, userId: string | null, now: number): string | null {
  for (const key of botFlagKeys(request, userId)) {
    const state = botFlags.get(key);
    if (state && now - state.flaggedAt < BOT_FLAG_TTL_MS) return state.reason;
  }
  return null;
}

// Сколько ключей может накопиться без активности, прежде чем зачистка их удалит — держит
// карту ограниченной при большом потоке уникальных IP/юзеров (единственный процесс portal.api,
// см. docs/infra/readme.md — состояние per-process, реплик несколько нет).
const IDLE_SWEEP_MS = 10 * MINUTE_MS;
let lastSweep = Date.now();

function sweepIfDue(now: number): void {
  if (now - lastSweep < IDLE_SWEEP_MS) return;
  lastSweep = now;
  for (const [key, state] of buckets) {
    const newestHit = state.hits[state.hits.length - 1];
    if (newestHit === undefined || now - newestHit > IDLE_SWEEP_MS) buckets.delete(key);
  }
  for (const [key, state] of botFlags) {
    if (now - state.flaggedAt > BOT_FLAG_TTL_MS) botFlags.delete(key);
  }
}

interface FactorResult {
  limited: boolean;
  retryAfterSeconds: number;
  streak: number;
  limit: number;
  remaining: number;
  reset: number;
}

function checkFactor(key: string, config: WindowConfig, now: number): FactorResult {
  let state = buckets.get(key);
  if (!state) {
    state = { hits: [], violationStreak: 0 };
    buckets.set(key, state);
  }

  const windowStart = now - config.windowMs;
  state.hits = state.hits.filter((ts) => ts > windowStart);

  if (state.hits.length >= config.limit) {
    state.violationStreak += 1;
    const oldestInWindow = state.hits[0]!;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestInWindow + config.windowMs - now) / 1000));
    const reset = Math.ceil((oldestInWindow + config.windowMs) / 1000);
    return { limited: true, retryAfterSeconds, streak: state.violationStreak, limit: config.limit, remaining: 0, reset };
  }

  state.hits.push(now);
  state.violationStreak = 0;
  return {
    limited: false,
    retryAfterSeconds: 0,
    streak: 0,
    limit: config.limit,
    remaining: Math.max(0, config.limit - state.hits.length),
    reset: Math.ceil(((state.hits[0] ?? now) + config.windowMs) / 1000),
  };
}

// Лёгкий fingerprint без клиентского JS: хэш заголовков, стабильных для одного браузера/клиента,
// но не привязанных к IP/сессии — ловит смену IP/аккаунта с того же физического клиента.
// Осознанный компромисс v1 (см. описание карточки, п.1): не TLS/canvas-fingerprint, только то,
// что уже приходит в каждом запросе.
export function requestFingerprint(request: RateLimitRequestIdentity): string {
  const headerValue = (name: string): string => {
    const raw = request.headers[name];
    if (typeof raw === "string") return raw;
    return Array.isArray(raw) ? raw.join(",") : "";
  };
  const ua = headerValue("user-agent");
  const lang = headerValue("accept-language");
  const enc = headerValue("accept-encoding");
  return createHash("sha256").update(`${ua}\n${lang}\n${enc}`).digest("hex").slice(0, 16);
}

// Псевдонимный IP для форензик-журнала (MF-736, model_download_log.ip_hash) — тот же паттерн,
// что idea_vote_log.ip_hash (db/schema.ts): хэш, не сырой inet, но здесь (в отличие от
// idea_vote_log, где ip_hash пока не пишется ни одним вызовом) реально используется. Полный
// sha256-дайджест как bytea напрямую, без hex/slice — не нужно сравнивать глазами, только
// group-by "тот же источник".
export function hashIp(request: RateLimitRequestIdentity): Buffer {
  return createHash("sha256").update(request.ip).digest();
}

export interface RateLimitOutcome {
  limited: boolean;
  retryAfterSeconds?: number;
  slowdownMs?: number;
  limit: number;
  remaining: number;
  reset: number;
}

/** Публичная часть rate-limit metadata; внутренние outcome-поля наружу не сериализуются. */
export interface RateLimitMetadata {
  limit: number;
  remaining: number;
  reset: number;
}

export const RATE_LIMIT_METADATA_HEADERS = {
  limit: "X-RateLimit-Limit",
  remaining: "X-RateLimit-Remaining",
  reset: "X-RateLimit-Reset",
  requestId: "X-Request-Id",
} as const;

/** Whitelist публичных заголовков: неизвестные поля outcome, включая секреты, игнорируются. */
export function serializeRateLimitMetadata(metadata: RateLimitMetadata, correlationId: string): Record<string, string> {
  return {
    [RATE_LIMIT_METADATA_HEADERS.limit]: String(metadata.limit),
    [RATE_LIMIT_METADATA_HEADERS.remaining]: String(metadata.remaining),
    [RATE_LIMIT_METADATA_HEADERS.reset]: String(metadata.reset),
    [RATE_LIMIT_METADATA_HEADERS.requestId]: correlationId,
  };
}

// Максимальный искусственный slowdown при повторяющихся нарушениях — деградация, не отказ:
// клиент, продолжающий давить на лимит уже открытым окном, платит растущую цену за каждый
// следующий разрешённый запрос, вместо жёсткого бана (см. заголовок модуля).
const MAX_SLOWDOWN_MS = 5000;
const SLOWDOWN_STEP_MS = 500;

export function checkRateLimit(request: RateLimitRequestIdentity, scope: RateLimitScope, userId: string | null): RateLimitOutcome {
  const now = Date.now();
  sweepIfDue(now);
  const config = scopeConfig(scope);

  const ip = request.ip;
  const allowlisted = userId && allowlist("RATE_LIMIT_ALLOWLIST_USER_IDS").has(userId) ? true : allowlist("RATE_LIMIT_ALLOWLIST_IPS").has(ip);
  if (allowlisted) {
    const reset = Math.ceil((now + MINUTE_MS) / 1000);
    return { limited: false, slowdownMs: 0, limit: config.user.limit, remaining: config.user.limit, reset };
  }

  // Флаг от honeypot идёт раньше обычных счётчиков факторов: клик по ловушке — уже сам по
  // себе достаточный сигнал бота, ждать превышения нормального порога незачем.
  if (checkBotFlag(request, userId, now)) {
    const reset = Math.ceil((now + BOT_FLAG_RETRY_AFTER_SECONDS * 1000) / 1000);
    return { limited: true, retryAfterSeconds: BOT_FLAG_RETRY_AFTER_SECONDS, limit: config.user.limit, remaining: 0, reset };
  }

  const fingerprint = requestFingerprint(request);
  const fingerprintBucket = scope === "auth_password" && userId ? `${fingerprint}:${userId}` : fingerprint;

  const results: FactorResult[] = [checkFactor(`${scope}:ip:${ip}`, config.ip, now), checkFactor(`${scope}:fp:${fingerprintBucket}`, config.fingerprint, now)];
  if (userId) results.push(checkFactor(`${scope}:user:${userId}`, config.user, now));

  const limitedResult = results.find((r) => r.limited);
  if (limitedResult) {
    return {
      limited: true,
      retryAfterSeconds: limitedResult.retryAfterSeconds,
      limit: limitedResult.limit,
      remaining: limitedResult.remaining,
      reset: limitedResult.reset,
    };
  }

  const maxStreak = Math.max(0, ...results.map((r) => r.streak));
  const slowdownMs = maxStreak > 0 ? Math.min(MAX_SLOWDOWN_MS, maxStreak * SLOWDOWN_STEP_MS) : 0;
  const metadata = results.reduce((current, candidate) => (candidate.remaining < current.remaining ? candidate : current));
  return { limited: false, slowdownMs, limit: metadata.limit, remaining: metadata.remaining, reset: metadata.reset };
}

// Только для тестов — состояние per-process переживает между тестами в одном vitest-воркере.
export function _resetRateLimitStateForTests(): void {
  buckets.clear();
  botFlags.clear();
  lastSweep = Date.now();
}
