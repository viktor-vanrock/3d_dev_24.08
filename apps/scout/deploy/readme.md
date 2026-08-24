# News pipeline deploy

Этот seam устанавливает новостной контур из `apps/scout` двумя изолированными oneshot-юнитами.
`portal.scout-news-pipeline.service` запускает local researcher, local composer и Grok moderation,
но явно удаляет publish/DB/API keys из environment. Только
`portal.scout-news-publisher.service` читает `/etc/portal/scout-news-publisher.env`, валидирует
точный accepted `news-moderation.v2`, создаёт draft, отдельным идемпотентным запросом публикует его
и проверяет публичный detail. Publisher запускается со скрытым HOME; credentials моделей ему
недоступны. Pipeline видит Grok HOME read-only; writable исключение ограничено
`~/.grok/sessions`, потому что single-turn CLI сохраняет session record, но не меняет auth/config.
На закрытом dev обычная read-сессия для GET detail монтируется systemd через `LoadCredential` из
`~/.autofab-session-dev`; она не копируется в environment и не отправляется в ingest POST.

Timer поставляется как deploy artifact, но до отдельного review **не включается**. Fresh deploy
выполняет ровно один ручной canary и останавливается.

## Fresh deploy на dev-vm

Предусловия: checkout `dev` в `/home/plag/portal.ru-dev`; `DATABASE_URL` загружен оператором из
одобренного deploy environment без вывода значения.

```bash
cd /home/plag/portal.ru-dev/apps/scout
uv sync --no-dev --frozen

sudo install -d -m 0750 -o root -g plag /etc/portal
sudo install -m 0644 deploy/portal.scout-news-pipeline.service /etc/systemd/system/
sudo install -m 0644 deploy/portal.scout-news-publisher.service /etc/systemd/system/
sudo install -m 0644 deploy/portal.scout-news-pipeline.timer /etc/systemd/system/

sudo --preserve-env=DATABASE_URL .venv/bin/scout-news-provision-publisher-key \
  --username scout-news-publisher --owner plag --group plag

sudo systemctl daemon-reload
sudo systemctl disable --now portal.scout-news-pipeline.timer
sudo systemctl start portal.scout-news-pipeline.service
```

Provision helper идемпотентно создаёт dedicated `scout-news-publisher`, резолвит allowlist из
versioned `brands.v2.json` только в активные catalog-backed `vendor`/`machine` communities и выдаёт
этому пользователю `owner` только в них. Не найденный, неоднозначный или не catalog-backed target
прерывает транзакцию до выдачи ключа. Затем helper генерирует новый `mf_feedingest_` credential
внутри процесса, пишет plaintext только в mode-600 EnvironmentFile и вставляет в БД только SHA-256.
Значение не передаётся CLI аргументом и не печатается. Старые active `feed_ingest` keys этого service
user отзываются в той же транзакции. Не копировать publisher EnvironmentFile в общий
`portal.scout.env`.

Необязательные model endpoints/weights задаются только в mode-640
`/etc/portal/scout-news-pipeline.env`; publisher credential в этот файл не добавляется:

```ini
SCOUT_NEWS_RESEARCHER_URL=http://100.74.48.83:1235
SCOUT_NEWS_COMPOSER_URL=http://100.74.48.83:1236
SCOUT_NEWS_GROK_EXECUTABLE=grok
SCOUT_NEWS_GROK_MODEL=grok-4.5
SCOUT_NEWS_GROK_MODEL_VERSION=grok-4.5
# Обязательный предохранитель первого canary; убрать только отдельным review перед timer enable.
SCOUT_NEWS_BRAND_FILTER=bambu.lab
```

## Health и безопасный evidence

```bash
systemctl show portal.scout-news-pipeline.service portal.scout-news-publisher.service \
  -p Result -p ExecMainStatus -p ActiveState
systemctl is-enabled portal.scout-news-pipeline.timer
journalctl -u portal.scout-news-pipeline.service -u portal.scout-news-publisher.service \
  --since today --output cat
jq '{pipeline_run_id, results: [.results[] | {brand_id, outcome, evidence}]}' \
  /var/lib/portal-scout-news/publication.json
```

Journal содержит только `run_id`, `role`, `brand`, `outcome`, `attempt`, `duration_ms`. Prompt,
article body и credential не логируются. Нормальные `no_news`, `exact_duplicate` и
`quality_rejected` имеют `action=skip`; `retryable_failure` сохраняет бренд в versioned brand
rotation для следующего запуска.

## Rollback

До review timer остаётся disabled, поэтому rollback не гоняется с новым запуском:

```bash
sudo systemctl disable --now portal.scout-news-pipeline.timer
sudo systemctl stop portal.scout-news-pipeline.service portal.scout-news-publisher.service
cd /home/plag/portal.ru-dev
git switch --detach <previous-reviewed-sha>
cd apps/scout && uv sync --no-dev --frozen
sudo install -m 0644 deploy/portal.scout-news-pipeline.service /etc/systemd/system/
sudo install -m 0644 deploy/portal.scout-news-publisher.service /etc/systemd/system/
sudo systemctl daemon-reload
```

Затем отозвать host key helper-ом; он обновляет только hash-row и удаляет EnvironmentFile, не читая
и не печатая plaintext:

```bash
sudo --preserve-env=DATABASE_URL .venv/bin/scout-news-revoke-publisher-key \
  --user-id <publisher-service-user-uuid>
```
