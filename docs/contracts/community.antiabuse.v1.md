# Контракт `community-antiabuse.v1`: TL0 и защита голосов

**Статус:** решение Contract Architect для реализации MF-1421.
**Версия политики:** `community-antiabuse.v1`.
**Основания:** MF-416, MF-414, MF-415, `docs/epics/community.foundation.md`, `docs/architecture/service.map.md`.

## Граница и владельцы

| Что | Владелец данных / реализации | Контракт |
| --- | --- | --- |
| `users.trust_level`, `reputation_events`, `votes`, идемпотентная запись и индексы | Data (миграция), Back (транзакция) | `packages/contracts/http/community.ts` и этот документ |
| HTTP-ручки community, проверка TL0 и форма ответа | Fullstack | HTTP `community-antiabuse.v1` |
| общий limiter, сессия, `request_id`, метрики | Back | `security/rateLimit.ts`, `auth`, `observability` |
| отображение причины, лимита и обратного отсчёта | Front | только публичная ошибка; не причины антифрод-детектора |

Новый самостоятельный сервис, device-identity или P2P не вводятся. Политика привязана к `account_id` (то есть `users.id`), а не к принтеру; это не меняет связь account↔printer identity и не использует `config_fingerprint` из printer-контура.

## Состояния и лимиты

`TL0` — `users.trust_level=0` без ручного override. Переход на `TL1` определяется уже утверждённым ядром MF-414 (`reputation_score >= 5`); после него ограничения TL0 перестают действовать. Общие anti-abuse ограничения остаются для всех уровней.

| Операция | TL0 | TL1–TL4 | Окно / результат отказа |
| --- | ---: | ---: | --- |
| Личное сообщение | запрещено | по контракту будущего ЛС | `403 TRUST_LEVEL_REQUIRED`, `required_trust_level: 1` |
| Ссылки в одном треде или посте | не более 1 | общий лимит контента | `422 TL0_LINK_LIMIT`, `limit: 1` |
| Вложения `photo` и `model_3mf` | 0 | по обычному лимиту MF-415 | `422 TL0_ATTACHMENT_LIMIT`, `limit: 0` |
| Создание тредов | 3 | без TL0-квоты | скользящие 24 часа, `429 TL0_DAILY_QUOTA_EXCEEDED` + `Retry-After` |
| Создание постов | 10 | без TL0-квоты | скользящие 24 часа, `429 TL0_DAILY_QUOTA_EXCEEDED` + `Retry-After` |
| Правка своего треда/поста | первые 15 минут | обычная политика редактора | `409 EDIT_WINDOW_EXPIRED` |
| Аутентификация mutation | обязательна | обязательна | `401 UNAUTHORIZED`; анонимный write не обрабатывается |

Лимиты подсчитываются по серверному `created_at`, не по времени клиента. Удалённый или скрытый контент не возвращает квоту: иначе её можно было бы обойти create→delete. Значение `Retry-After` — число секунд до первой точки, где конкретная скользящая квота освободится.

## Голоса и репутация

1. Голос принадлежит авторизованному аккаунту: единственный факт — `votes(subject_type, subject_id, user_id, value)` с уникальностью тройки. Публичный ответ **не** раскрывает `user_id`; он доступен только владельцу данных для аудита/антифрода.
2. Голос за собственный тред или пост запрещён: `403 SELF_VOTE_FORBIDDEN`. Забаненный, отозванный или неавторизованный аккаунт не может голосовать.
3. `POST /threads/:id/vote` и `POST /posts/:id/vote` сохраняют существующую семантику `value ∈ {-1,0,1}`. Повтор того же значения идемпотентен; начисление репутации происходит лишь при первом создании голоса, но не при retry, flip или снятии.
4. Положительное начисление получателю ограничено `200` баллами за UTC-сутки. Для cap суммируются только положительные `reputation_events.points`; остаток клампится, а при нуле пишется `daily_cap_reached` с `points=0`. Голос при этом остаётся принятым и не получает отдельного публичного сигнала о cap.
5. Общий rate-limit голоса: 10 mutation/мин на account, 60/мин на IP и 45/мин на header-fingerprint; дополнительно 30 mutation за скользящие 24 часа на account. Для create thread/post: 3/мин account, 10/мин IP, 8/мин fingerprint. Превышение возвращает `429 RATE_LIMITED` и `Retry-After`.
6. Детерминированный антифрод-гейт блокирует голос до записи при 20 разных account для одного `(subject_type, subject_id)` из одного IP **или** fingerprint за 60 минут. Ответ — неразличимый `429 VOTE_ANOMALY_BLOCKED` с `Retry-After`; counts и reputation не меняются. Наблюдательный порог 10 пишется как сигнал, но не блокирует. Автобан не допускается.

## Идемпотентность и HTTP-ответы

Создание `POST /communities/:id/threads`, `POST /threads/:id/posts` и будущие mutation ЛС требуют `Idempotency-Key`: непустой ASCII-ключ длиной 1–128. Область ключа — `(account_id, route_template, parent_id, key)`; тот же канонический request body возвращает сохранённый исходный ответ, другой body — `409 IDEMPOTENCY_CONFLICT`. Хранение результата — минимум 24 часа. Ключ и тела контента не попадают в логи в открытом виде.

Голос имеет естественный ключ состояния `(account_id, subject_type, subject_id, value)`; заголовок `Idempotency-Key` для него допустим, но не нужен для корректности. Все успешные и ошибочные ответы этой политики отдают `X-Community-Policy-Version: community-antiabuse.v1` и `x-request-id`.

Стандартная ошибка:

```json
{
  "error": "TL0_DAILY_QUOTA_EXCEEDED",
  "scope": "community_thread_create",
  "limit": 3,
  "window_seconds": 86400,
  "retry_after_seconds": 2780,
  "policy_version": "community-antiabuse.v1"
}
```

## Наблюдаемость и приватность

Каждое решение policy пишет структурное событие `community.antiabuse.decision.v1` с `request_id`, `policy_version`, `action`, `outcome`, `error_code?`, `trust_level`, `subject_type?`, `subject_id?`, `ip_hash`, `fingerprint_hash` и `idempotency_key_hash?`. Сырые IP, cookie, текст поста, значение ключа и идентификатор сессии запрещены.

Метрики: `community_antiabuse_decisions_total{action,outcome,error_code}`, `community_vote_anomaly_signals_total{threshold}` и `community_reputation_cap_total{outcome=clamped|reached}`. `request_id` связывает HTTP-ответ, событие и audit-event MF-1417.

## Миграция без разрыва клиентов

1. Data добавляет аддитивно durable idempotency storage и нужные индексы квот; существующие `votes` и `reputation_events` не переименовываются. Индекс/запрос cap использует только положительные события.
2. Back сначала включает наблюдение и header `X-Community-Policy-Version`, затем Fullstack включает enforcement. До переключения веб-клиента сервер принимает отсутствующий `Idempotency-Key` только на уже существующих ручках; новые mutation требуют его с первого дня.
3. Front начинает передавать ключ на create и обрабатывает публичные ошибки/`Retry-After`. После подтверждения использования ключа старым клиентам возвращается `400 INVALID_IDEMPOTENCY_KEY`.
4. Откат выключает enforcement, но не удаляет audit/idempotency факты и не отменяет уже записанные голоса. Версия следующего контракта добавляется как `v2`, а не меняет значения `v1`.

## Обязательные handoff

- [MF-1417](https://tasks.3mf.tech) — Data согласует миграционные инварианты с audit-event и retention, не создавая параллельный журнал фактов.
- [MF-1421](https://tasks.3mf.tech) — Back реализует транзакции, limiter, detection, observability и контрактные проверки из fixtures.
- Front и Fullstack используют типы из `packages/contracts/http/community.ts`; API не импортирует внутренности `apps/web` и наоборот.
