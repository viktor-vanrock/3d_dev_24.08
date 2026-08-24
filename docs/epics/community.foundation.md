# EPIC: Комьюнити — фундамент (MF-35, Фаза 1)

**Статус:** утверждено Data (2026-07-09) — см. § «Data-вердикт по открытым вопросам» ниже; смержено как dbmate-миграция `apps/api/db/migrations/20260709010859_community_foundation.sql`, применена и проверена на изолированном Postgres (см. ниже), ER зафиксирован в `docs/issues/007.database.design.md`.
**Контекст:** [MF-35](https://tasks.3mf.tech) «Комьюнити и форум» → Фаза 1 [MF-414](https://tasks.3mf.tech) — три подзадачи: (1) схема Community→Thread→Post + опаковые ID, (2) неперечислимые ID для публичных сущностей, (3) репутационное ядро + trust-levels TL0→TL4.

## Разрешённый конфликт: два предыдущих решения по комьюнити

`docs/epics/domain.model.md` § «Комьюнити (v2, но форму фиксируем сейчас)» (решения Валерия, 2026-07-05) уже фиксировал: сообщества привязаны к каталогу (`kind`=`machine`|`vendor`|`craft`|`custom`, лениво создаются при первой подписке, opt-in через вопрос при добавлении станка), голосование — Reddit-стрелки на постах и комментариях, теги — полиморфная связка `(tag_id, subject_type, subject_id)`.

MF-35 (обновлён 2026-07-06, на день позже) детализирует ДРУГОЙ слой — Discourse/SO-гибрид: Community(категория) → Thread(discussion|question) → Post(answer|reply|comment) с `accepted_post_id`, репутацией и trust-levels.

Это не противоречие, а два слоя одной модели — синтез ниже:
- **`communities`** = решение domain.model.md как есть (`kind`/`subject_type`/`subject_id`, ленивое создание, opt-in). MF-35 говорит про них же как про «категории» (Bambu/Creality/PLA/ниши) — это ровно каталожные сабы domain.model.md.
- **`comments`** из domain.model.md — отдельной таблицы НЕ заводим: в новой модели комментарий — это `posts.kind='comment'`, союз с thread-контентом (принцип 3 domain.model.md — не плодить супер-таблицу контента, но и не плодить лишнюю сущность там, где новая модель её поглощает).
- **Голосование**: раз комментарий — тоже `post`, а голос за сам вопрос/тред — отдельный субъект, оба покрывает **одна полиморфная `votes(subject_type, subject_id, user_id, value)`** (`subject_type in ('post', 'thread')`) — это и есть решение domain.model.md принцип 4 («голоса… должны уметь цепляться и к посту, и к модели, не плодя по таблице на комбинацию») в исходном виде, **не** узкая пара `post_votes`/`thread_votes` из черновика Fullstack. Data-вердикт по открытому вопросу — см. § «Data-вердикт» ниже.
- **Теги**: полиморфная `taggings(tag_id, subject_type, subject_id)` — ровно по domain.model.md принципу 4 и по формулировке «tags — глобальные, связка через (tag_id, subject_type, subject_id)». `threads` — второй реальный потребитель тегов после `models` (`model_tags`), точка, где принцип 4 требует переключиться на полиморфизм. **`model_tags` НЕ мигрируется в этой миграции** (живые прод-данные, риск отдельной миграции, вне скоупа Фазы 1) — `taggings.subject_type` пока принимает только `'thread'`; объединение с `model_tags` — открытый вопрос/follow-up, не блокирует Фазу 1.

## Схема (проверена локально, docker `pgvector/pgvector:pg17`, применена как реальная dbmate-миграция)

Полный DDL — как в смерженной миграции `apps/api/db/migrations/20260709010859_community_foundation.sql` (`schema.ts`/`SCHEMA_SQL` заморожены после перехода на dbmate, MF-586 — новые изменения схемы только новыми миграциями):

```sql
create table if not exists communities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug = lower(slug) and length(slug) > 0),
  name text not null,
  kind text not null default 'custom' check (kind in ('machine', 'vendor', 'craft', 'custom')),
  subject_type text check (subject_type in ('machine', 'vendor')), -- 'craft' пока не включён: таблицы crafts ещё нет
  subject_id uuid,
  description text,
  cover_image_s3_key text,
  visibility text not null default 'public' check (visibility in ('public', 'unlisted')),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references users(id), -- null у каталожных сабов (лениво создаются, нет автора)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'custom' and subject_type is null and subject_id is null)
    or (kind <> 'custom' and subject_type is not null and subject_id is not null)
  )
);
create unique index if not exists communities_subject_key on communities (kind, subject_type, subject_id) where subject_id is not null;

create table if not exists community_members (
  community_id uuid not null references communities(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'moderator', 'owner')),
  source text not null default 'manual' check (source in ('machine_prompt', 'manual')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index if not exists community_members_user_idx on community_members (user_id);

create table if not exists threads (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities(id) on delete cascade,
  author_id uuid not null references users(id),
  type text not null check (type in ('discussion', 'question')),
  title text not null,
  content text not null, -- тело вопроса/дискуссии; Post-kind не включает 'question'/'discussion'
  status text not null default 'open' check (status in ('open', 'closed', 'locked')),
  pinned boolean not null default false,
  accepted_post_id uuid, -- FK добавлен NOT VALID отдельным alter (posts объявлена позже)
  votes_up int not null default 0,
  votes_down int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists threads_community_idx on threads (community_id, created_at desc);
create index if not exists threads_author_idx on threads (author_id, created_at desc);

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads(id) on delete cascade,
  author_id uuid not null references users(id),
  parent_post_id uuid references posts(id) on delete set null,
  kind text not null check (kind in ('answer', 'reply', 'comment')),
  content text not null,
  status text not null default 'visible' check (status in ('visible', 'hidden', 'deleted')),
  votes_up int not null default 0,
  votes_down int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists posts_thread_idx on posts (thread_id, created_at);
create index if not exists posts_author_idx on posts (author_id, created_at desc);

alter table threads add constraint threads_accepted_post_id_fkey
  foreign key (accepted_post_id) references posts(id) on delete set null;

-- Data-вердикт (открытый вопрос §1): полиморфная пара, НЕ post_votes/thread_votes.
-- Без FK на subject_id (не может ссылаться на два разных родителя разом) — тот же
-- принятый trade-off, что уже ниже в taggings/reputation_events этой же миграции.
create table if not exists votes (
  subject_type text not null check (subject_type in ('post', 'thread')),
  subject_id uuid not null,
  user_id uuid not null references users(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (subject_type, subject_id, user_id)
);
create index if not exists votes_subject_idx on votes (subject_type, subject_id);

create table if not exists taggings (
  tag_id uuid not null references tags(id) on delete cascade,
  subject_type text not null check (subject_type in ('thread')),
  subject_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (subject_type, subject_id, tag_id)
);
create index if not exists taggings_tag_idx on taggings (tag_id);

create table if not exists reputation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  points int not null,
  reason text not null check (reason in (
    'post_upvoted', 'question_upvoted', 'post_downvoted', 'answer_accepted', 'daily_cap_reached'
  )),
  subject_type text not null check (subject_type in ('post', 'thread')), -- не FK: subject может быть удалён, история остаётся
  subject_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists reputation_events_user_idx on reputation_events (user_id, created_at desc);

alter table users add column if not exists reputation_score int not null default 0;
alter table users add column if not exists trust_level smallint not null default 0 check (trust_level between 0 and 4);
alter table users add column if not exists trust_level_manual boolean not null default false; -- TL4 — только вручную, движок не трогает
```

Проверено локально Data (docker `pgvector/pgvector:pg17` изолированный контейнер + `dbmate up`/`rollback`/`up`): миграция применяется поверх baseline (`20260709000001_baseline.sql`) без ошибок, `dbmate rollback` откатывает чисто (порядок дропа: снять `threads_accepted_post_id_fkey` до `drop table posts`/`threads` — циклическая зависимость), повторный `up` после отката идемпотентен. FK/check-констрейнты реально блокируют некорректные вставки (custom-сообщество с `subject_id`, дубликат каталожного саба на тот же `subject_id`, невалидный `threads.type`, `votes.subject_type='model'`, `taggings.subject_type='post'`). Сквозной сценарий community→question→answer→vote(post)→vote(thread)→accepted→reputation_event(+15)→`users.reputation_score` резолвится корректно. `db/schema.sql` передамплен и включает обе миграции в `schema_migrations`; дамп сделан pg_dump 17 (песочница без сети до pg_dump 16) — только версия в шапке-комментарии отличается от прод-дампа (16.x), к семантике схемы не относится, Ops может передампить на 16 при следующем релизе без функциональной разницы.

## Опаковые ID (Готово-когда п.2 MF-414)

Проект уже принял решение по `users.id`: `gen_random_uuid()` (UUID v4, не v7/ULID — не сортируем по времени). Все новые таблицы выше следуют тому же паттерну — **PK везде `uuid default gen_random_uuid()`, наружу отдаётся как есть, без serial/int нигде**. Это уже закрывает большую часть требования «инкремент/декремент не даёт соседнюю сущность» — случайный UUIDv4 (122 бита энтропии) не даёт этого по построению, никакой AEAD-схемы для DB PK не нужно (hashids/sqids не вводим — они и не нужны, раз PK изначально случаен, не инкремент).

Остаётся API-контракт (не DB-схема, задача Back): не выставлять публичный `/all`-эндпоинт с курсором-инкрементом, keyset-пагинация по `(created_at, id)` вместо `OFFSET`, никаких `COUNT(*)` по всей таблице в публичном ответе (существующие денормализованные счётчики — контента, не объёма БД, это ок). Тест на enumeration — Back пишет интеграционный тест: инкремент/декремент валидного UUID не резолвится в соседнюю запись (тривиально верно для случайного UUIDv4, но тест фиксирует инвариант на будущее, если кто-то сгенерирует ID иначе).

## Репутационное ядро и trust-levels (Готово-когда п.3 MF-414)

**Очки** (`reputation_events`, событийный леджер — не только счётчик, нужен для дневного капа и антифрод-разбора задним числом):
- `post_upvoted` (kind='answer') → +10; апвоут поста/реплая/комментария и `question_upvoted` (голос за `votes` с `subject_type='thread'`) → +5; `post_downvoted` → −2 автору; `answer_accepted` → **+15** (Data-вердикт, открытый вопрос §2 — SO-дефолт, окончательно).
- Дневной кап ~200: считается запросом `SUM(points) WHERE user_id=X AND created_at >= today_start` по индексу `(user_id, created_at desc)` — НЕ денормализованная колонка «очков за сегодня» (объём событий на пользователя в сутки мал, агрегат запросом дешевле лишней колонки с рассинхроном). При достижении капа новое начисление логируется как `reason='daily_cap_reached'` с `points=0` (audit-след «пытались начислить, кап сработал»), реальные очки не прибавляются — логика на слое API (Back), не в схеме.
- Голоса не анонимны (антифрод) — `votes.user_id` не скрыт, это уже в схеме.

**Trust levels TL0→TL4** — `users.trust_level` (0..4) + `trust_level_manual` (guard: TL4 и любой ручной оверрайд не трогает автоматический движок).
- TL0 (песочница) — дефолт новых аккаунтов. Ограничения (нет ЛС, лимит ссылок/картинок, лимит тредов/постов в сутки) — не схема, API-слой Back.
- TL1 — по Discourse-модели должен зависеть от «прочитанных постов/времени на сайте» — **этого сигнала в продукте пока нет** (нет трекинга чтения тредов). Открытый вопрос ниже: v1-прокси или ждать инструментирования.
- TL2/TL3 — скользящее окно активности (посты+апвоуты за последние N дней) — считается запросом по `reputation_events`/`posts` (created_at за окно), не отдельной денормализованной таблицей статы (тот же принцип «агрегат запросом», что «Статистика владения» в domain.model.md). Auto-downgrade — тот же запрос, периодический джоб (Back решает cron vs on-read).
- TL4 — только ручное назначение (`trust_level_manual=true`), стафф-UI вне зоны схемы.
- Бейджи — переиспользовать существующий движок ачивок. **Важно: `server/ACHIEVEMENTS.md`, на который ссылается описание MF-35, в репозитории НЕ найден** (ни `server/`, ни файла с таким именем) — движок ачивок либо не задокументирован, либо не существует в этом виде. Флаг для CTO/Lead: либо поправить ссылку в эпике, либо завести карточку на сам движок ачивок раньше, чем строить бейджи поверх него.

## Data-вердикт по открытым вопросам (2026-07-09)

1. **Голосование — полиморфная `votes(subject_type, subject_id, user_id, value)`, НЕ `post_votes`/`thread_votes`.** Черновик Fullstack сознательно разошёлся с наброском domain.model.md 2026-07-05 (принцип 4: «голоса… должны уметь цепляться и к посту, и к модели, не плодя по таблице на комбинацию») по прецеденту `model_votes`. Но в этой же миграции для тегов Fullstack уже применил обратную логику: `threads` — второй реальный потребитель после `models` → точка переключения на полиморфизм (`taggings`). Голоса проходят ту же точку с тем же счётом: `model_votes` (первый потребитель, legacy) + `post_votes`+`thread_votes` (второй и третий) — плодить третью узкую таблицу-пару вместо одной полиморфной прямо в момент, когда сам документ фиксирует переключение для тегов, непоследовательно. Решение: одна `votes` на посты/треды сейчас, `reputation_events.subject_type` в этой же миграции уже полиморфна (`'post'`/`'thread'`) — так схема согласована сама с собой. `model_votes` не трогаем (живые прод-данные, вне скоупа) — унификация с `votes` таким же follow-up, как `model_tags`→`taggings` (см. п.5 ниже).
2. **Бонус за принятый ответ — `+15`.** SO-дефолт, нет причины отклоняться. Зафиксировано, Back реализует как есть.
3. **TL1 без сигнала «прочитано»** — дефолт v1 Fullstack принят: TL1 по `reputation_score >= порог` как прокси до появления трекинга чтения тредов. Настоящий Discourse-сигнал — отдельная карточка (нужна аналитика показов треда), не блокирует Фазу 1.
4. **Карма пер-ремесло vs глобальная** — уже открытый вопрос domain.model.md, не решён здесь, `reputation_events`/`users.reputation_score` глобальны (не блокирует схему, ремесло сейчас одно).
5. **`model_tags`/`model_votes` → `taggings`/`votes` унификация** — не в этой миграции, follow-up (расширен вопросом голосов из п.1).
6. **`server/ACHIEVEMENTS.md` не найден** — подтверждаю флаг Fullstack, вне зоны Data (схема БД), эскалирую CTO отдельно.

## Что НЕ в Фазе 1 (сознательно, следующие фазы MF-35)

Модерация/аудит-лог (направление 3), лента/feed-интеграция (направление 4), Make-галерея↔посты (направление 5), импорт авторов (направление 7) — этой миграцией не заводятся, схема к ним расширяема (тот же принцип text+check / jsonb / полиморфные taggings).

## Разбивка (после утверждения Data)

- **Data** — done: схема утверждена (с правками — унифицированные `votes`, см. Data-вердикт выше), смержена как dbmate-миграция `apps/api/db/migrations/20260709010859_community_foundation.sql`, применена и проверена (up/rollback/up), ER зафиксирован в `docs/issues/007.database.design.md` (готово-когда п.1 MF-414). Применение на реальном dev-Postgres — заявка Ops (граница прод-БД, `CLAUDE.md`).
- **Back** (после мерджа схемы) — параллельно:
  - опаковые ID: keyset-пагинация + enumeration-тест (готово-когда п.2).
  - репутационное ядро: начисление очков на голос/принятый ответ, дневной кап, вычисление/даунгрейд trust-level (готово-когда п.3), значение видно в профиле MF-15.
