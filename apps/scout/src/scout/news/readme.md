# Local GPU news worker

`scout-news-worker` — zero-write runner массового новостного конвейера. Host открывает только
allowlisted официальные страницы из `brands.v2.json`, канонизирует URL, считает content/source
fingerprints и проверяет дословную evidence для каждого claim. Локальный researcher (Gemma,
HYPERPC slot 2) получает только текст источников; composer (Qwen, slot 1) получает только
валидированный candidate, работает с reasoning и формирует CommonMark + закрытые typed source
blocks. Стабильные block IDs и authoritative AST присваивает host после model output.

Локальные модели работают без shell/filesystem/publish tools и не видят ключ публикации. После
composer host вызывает авторизованный Grok CLI с пустым набором tools и очищенным environment:
publish/API/DB secrets не наследуются. Grok получает только candidate, normalized article и
`feed-news-pipeline.v2`, возвращает `accept|revise|reject`, evidence-linked issues и advisory-only
`api_feedback`. `revise` возвращается composer не более двух раз; `reject` и третий `revise`
завершаются `quality_rejected`. `XAI_API_KEY` намеренно не входит в subprocess allowlist: Grok
использует только subscription runtime из своего read-only HOME. Один moderation call ограничен
двумя внутренними model turns, чтобы structured-output repair мог завершиться без tool turn.

```bash
cd apps/scout
uv run scout-news-worker --output ./artifacts/news.zero.write.json --parallel 3
```

После `accept` отдельный deterministic host publisher повторно проверяет точные v2 artifacts и их
linkage, запрещает synthetic/example source, проецирует accepted материал в typed `/feed/ingest`,
создаёт draft, делает отдельный идемпотентный publish и читает публичный detail. Ключ берётся только
из `SCOUT_NEWS_FEED_INGEST_KEY`; CLI-аргумента для plaintext нет:

```bash
SCOUT_NEWS_FEED_INGEST_KEY=... uv run scout-news-publisher \
  ./artifacts/news.zero.write.json --output ./artifacts/news.publication.json
```

Production/dev systemd split, fresh deploy, protected key provisioning, health evidence и rollback
описаны в [`deploy/readme.md`](../../../deploy/readme.md). Pipeline unit не получает publisher key,
publisher unit не видит HOME/credentials моделей, а timer до отдельного review остаётся disabled.

Если moderation оркестрируется отдельно через Multica Grok runtime, локальный worker можно
остановить на composition artifact:

```bash
uv run scout-news-worker --without-moderation --output ./artifacts/news.zero.write.json
```

`--known-fingerprints fingerprints.json` принимает JSON-массив `sha256:<hex>` и переводит exact
matches в нормальный `exact_duplicate`, не вызывая модели. `no_news`, `quality_rejected` и
`retryable_failure` изолированы на уровне бренда и не роняют batch.

Endpoint/model можно переопределить через `SCOUT_NEWS_RESEARCHER_URL`,
`SCOUT_NEWS_RESEARCHER_MODEL`, `SCOUT_NEWS_COMPOSER_URL`, `SCOUT_NEWS_COMPOSER_MODEL`.
Grok runtime задаётся `SCOUT_NEWS_GROK_EXECUTABLE`, `SCOUT_NEWS_GROK_MODEL` и
`SCOUT_NEWS_GROK_MODEL_VERSION`; по умолчанию это `grok`/`grok-4.5`.

`api_feedback` сам по себе ничего не меняет и не создаёт карточек. Отдельная команда сначала
показывает deduplicated review bundle без side effects, а submit требует явного имени человека и
кладёт новую карточку в `backlog` (или дополняет найденную по fingerprint):

```bash
uv run scout-news-api-feedback ./artifacts/news.zero.write.json
uv run scout-news-api-feedback ./artifacts/news.zero.write.json --submit \
  --human-approved-by "Reviewer Name" --project <project-uuid> --parent <epic-uuid>
```
