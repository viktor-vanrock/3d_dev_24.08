# Git bare-репозитории проектов — инфраструктура (MF-518)

Каждый проект портала — bare git-репозиторий на VDS. Архитектурное решение и контекст: `docs/epics/project.git.md` (эпик MF-514).

## Расположение и права

| Путь | Владелец | Права | Назначение |
|------|----------|-------|-----------|
| `/srv/git/` | `plag:plag` | `750` | Корень git-контура (рядом с `/srv/minio/`) |
| `/srv/git/repos/` | `plag:plag` | `750` | Каталог bare-репозиториев проектов |

Единственный писатель в v1 — процесс `apps/api` (systemd `portal.api.service`, `User=plag`). Наружу git-протокол (clone/push) не открыт — UFW разрешает только 22/80/443.

Создание каталога на VDS (идемпотентно):
```bash
sudo mkdir -p /srv/git/repos
sudo chown plag:plag /srv/git /srv/git/repos
sudo chmod 750 /srv/git /srv/git/repos
```

## Репозитории

Структура внутри `/srv/git/repos/`:
```
/srv/git/repos/
  <model_id>/        # bare git-репозиторий каждого проекта (git init --bare)
    HEAD
    config
    objects/
    refs/
    ...
```

`model_id` соответствует UUID проекта из таблицы `models.id` (столбец `repo_path` = `<model_id>`). Подробнее — `models.repo_path` и маппинг файлов — в MF-515 (Data) и `docs/epics/project.git.md` §3.

## Бэкап-контур

**Что бэкапится:** PostgreSQL база `portal` (pg_dump), `/srv/git/repos/` (tar.gz), env-файлы (`portal.api.env`, `portal.mesh.env`).

**Хранение:** `/srv/backups/` (`plag:plag 750`), ротация 14 дней. Каждый суточный бэкап — `portal_YYYYMMDD_HHMMSS.tar.gz` (~600–1000 байт/файл × N репозиториев + дамп Postgres).

**Расписание:** ежесуточно в 03:00 (MSK) via `portal.backup.timer`.

### Установка бэкап-агента

```bash
# На VDS, из ~/portal.ru:
sudo cp deploy/portal.backup.service /etc/systemd/system/
sudo cp deploy/portal.backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now portal.backup.timer
# Проверить:
systemctl list-timers portal.backup.timer
```

### Ручной бэкап

```bash
systemctl start portal.backup.service
journalctl -u portal.backup -n 30
ls -lh /srv/backups/
```

### Восстановление (процедура)

Восстановление нужно прогонять не реже 1 раза в месяц; дату последнего успешного восстановления фиксировать в этом файле.

**Восстановление на пустой VDS (disaster recovery):**

```bash
# 1. Распаковать архив бэкапа
cd /srv/backups
tar -xzf portal_YYYYMMDD_HHMMSS.tar.gz

# 2. Восстановить Postgres (база portal должна существовать)
pg_restore -U portal -d portal portal_YYYYMMDD_HHMMSS/postgres_portal.dump

# 3. Восстановить git репозитории
sudo mkdir -p /srv/git
sudo chown plag:plag /srv/git
tar -xzf portal_YYYYMMDD_HHMMSS/git_repos.tar.gz -C /srv/git/

# 4. Восстановить env-файлы (зашифрованы GPG/AES256, ключ ~/.portal-backup.key — см. portal.restore-env.sh)
deploy/portal.restore-env.sh portal_YYYYMMDD_HHMMSS/portal.api.env.gpg ~/portal.api.env
deploy/portal.restore-env.sh portal_YYYYMMDD_HHMMSS/portal.mesh.env.gpg ~/portal.mesh.env
chmod 600 ~/portal.api.env ~/portal.mesh.env
```

**Последнее успешное восстановление:** 2026-07-17 (MF-1784, реальная установка `portal.backup.timer`/`portal.disk-monitor.timer` на VDS). Первый прогон бэкапа: `/srv/backups/portal_20260717_011440.tar.gz` (1.2 ГБ). Проверена восстановимость: `pg_restore --list` на `postgres_portal.dump` (569 TOC entries, валидный custom-формат), `tar -tzf` на `git_repos.tar.gz` (репозитории читаются), `portal.restore-env.sh` расшифровал `portal.api.env.gpg` в файл, побайтово идентичный оригиналу `~/portal.api.env`. Заодно найден и исправлен дефект в `portal.backup.sh`: `pg_dump` был захардкожен на порт `5432` (Docker dev-compose, чужая БД `portal_dev`) вместо реального прод-порта `5434` — без фикса каждый прогон падал на `fe_sendauth`.

## Мониторинг диска

Скрипт `deploy/portal.disk-monitor.sh` запускается каждые 30 минут:
- **OK**: диск < 75%
- **WARNING**: диск ≥ 75% — запись в journal с priority=warning
- **CRITICAL**: диск ≥ 90% — запись в journal с priority=crit

### Установка

```bash
sudo cp deploy/portal.disk-monitor.service /etc/systemd/system/
sudo cp deploy/portal.disk-monitor.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now portal.disk-monitor.timer
# Ручной запуск для проверки:
systemctl start portal.disk-monitor.service
journalctl -u portal.disk-monitor -n 5
```

### Проверка алертов

```bash
# Последние записи мониторинга
journalctl -u portal.disk-monitor -n 20

# Только WARNING/CRITICAL
journalctl -p warning -t portal.disk-monitor
```

Текущее состояние диска: `df -h /` — при 42% занято на момент создания (MF-518, 2026-07-08); 68% на момент реальной установки таймеров (MF-1784, 2026-07-17), `/srv/git/repos` 1.5 ГБ, `/srv/backups` 1.2 ГБ.

## Квоты репозиториев

Квота на репо ≤ 1 ГБ реализована на уровне `apps/api` (проверка при записи, §3.6 спеки). На уровне ОС квоты не выставлены — мониторинг диска покрывает aggregate-уровень.

## Что НЕ открываем

Git-протокол (git daemon / Smart HTTP) наружу не открываем в v1 — юзер работает только через portal API. UFW: 22/80/443 — единственные открытые порты, изменений не вносим.

## Импорт стороннего git-репозитория (GitVerse) — отдельный quarantine-контур

Snapshot-импорт внешнего репозитория (не bare-репозитории проектов выше) живёт в отдельном
каталоге `/srv/git/quarantine/`, под отдельным UID (`portal-gitimport`, не `plag`), с
`noexec,nosuid,nodev`-mount, дисковой/inode-квотой, таймаутами и явным исключением из
бэкап-контура — полная модель, allowlist хоста и лимиты см.
[docs/architecture/git.import.security.md](../architecture/git.import.security.md) (MF-1966).
Каталог создаётся отдельным шагом инфры при реализации импорта, не входит в текущую установку
`/srv/git/repos` выше.
