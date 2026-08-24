# Установка device-agent на существующий Klipper/Moonraker-хост (MF-1175)

Это runbook для уже работающего хоста. Оператор сам выбирает OS/image и отвечает за
физическую установку/прошивку. Агент не меняет firmware, `printer.cfg` или настройки
железа. Сетевые вызовы bootstrap ограничены `POST /devices/agent/enroll` (enroll.v1);
локальная проверка выполняется через `GET http://127.0.0.1:9797/health` (health.v1).

## Артефакт и prerequisites

Релиз — `3mf-device-agent-VERSION.tar.gz`, рядом обязательны signed manifest, `.sha256` и
обе `.minisig`. Публичный ключ оператора должен быть получен из доверенного
канала, а не из той же папки загрузки. Проверка до распаковки:

```sh
sha256sum -c 3mf-device-agent-VERSION.tar.gz.sha256
minisign -Vm 3mf-device-agent-VERSION.tar.gz -P "$MINISIGN_PUBLIC_KEY"
minisign -Vm 3mf-device-agent-VERSION.manifest.json -P "$MINISIGN_PUBLIC_KEY"
```

Нужны Linux с systemd, Node.js 22, `curl`, `openssl`, доступ агента к Moonraker
(`http://<printer-ip>:7125`) и outbound HTTPS/WSS к relay. Нужны права root для unit;
если root недоступен, unit можно запустить как user-service с теми же ограничениями,
но каталог credentials должен принадлежать этому пользователю.

## Preflight по моделям

Для Ender-3 V3 KE проверьте LAN-адрес и доступность Moonraker на порту 7125; учитывайте,
что vendor image может ограничивать SSH/локальный API. Не включайте SSH, не меняйте
пароли и не устанавливайте firmware по этому документу — это отдельная процедура
владельца. Для FLSun V400 дополнительно проверьте стабильность Wi-Fi/LAN и что
Moonraker/ KlipperScreen не заняли ресурсы, необходимые агенту; дельта-кинематика не
означает специальных команд агента. Модель, firmware и hardware settings агент не
угадывает и не меняет.

## Установка и enroll

Используйте `deploy/install.sh`: он проверяет signatures/checksum/manifest, Node.js 22 и spool
compatibility, устанавливает versioned release, атомарно переключает `current`, ждёт health и
автоматически возвращает `previous` при ошибке. Config, credentials, spool и ledgers остаются
вне release directory. Создайте непривилегированного пользователя и каталог credentials:

```sh
sudo useradd --system --home /var/lib/3mf-device-agent --shell /usr/sbin/nologin 3mf-agent || true
sudo install -d -o 3mf-agent -g 3mf-agent -m 700 /var/lib/3mf-device-agent /etc/3mf-device-agent
sudo install -d -o root -g root -m 755 /opt/3mf-device-agent/releases/VERSION
sudo tar -xzf 3mf-device-agent-VERSION.tar.gz -C /opt/3mf-device-agent/releases/VERSION
sudo ln -sfn /opt/3mf-device-agent/releases/VERSION /opt/3mf-device-agent/current
```

Создайте `/etc/3mf-device-agent/agent.env` с mode 600 (значения не коммитить):

```ini
DEVICE_CONNECTOR_CONFIG='{"type":"moonraker","httpUrl":"http://PRINTER_LAN_IP:7125"}'
RELAY_URL=wss://relay.dev.3mf.tech/relay/ws
MULTICA_AGENT_HOME=/var/lib/3mf-device-agent
AGENT_HEALTH_PORT=9797
# MOONRAKER_API_KEY=...  # только если authorization включена в Moonraker
```

Один раз выполните CSR enrollment из установленного подписанного bundle (код не писать в shell
history и не сохранять в unit/env-файле):

```sh
sudo -u 3mf-agent env MULTICA_API_URL=https://api.dev.3mf.tech MULTICA_ENROLL_CODE='ONE_TIME_CODE' \
  MULTICA_AGENT_HOME=/var/lib/3mf-device-agent \
  /usr/bin/node /opt/3mf-device-agent/current/.release-dist/main.js --enroll
sudo stat -c '%a %n' /var/lib/3mf-device-agent/{gateway-key.pem,gateway-certificate.pem,gateway-ca.pem,command-verification-keys.json,agent-identity.json}
```

Все файлы должны иметь mode 600. Private key не отправляется API. Затем установите unit:

```sh
sudo install -m 644 apps/device-agent/deploy/portal.device-agent.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now portal.device-agent
curl -fsS http://127.0.0.1:9797/health
```

Ожидаемый результат — HTTP 200 и `{"version":"health.v1","status":"healthy",...}`.
`degraded` (HTTP 200) означает, что агент сохраняет локальный контур, но relay или Moonraker
недоступен; настройки Klipper не меняются. `blocked_config` и `revoked` возвращают HTTP 503,
закрывают relay и удалённые команды, но не блокируют локальную печать. Значения `ready`, `starting`
и `stopped` не являются частью публичного контракта `health.v1`.

## Health, rollback, recovery, uninstall

`sudo systemctl restart portal.device-agent`; затем повторите health и `journalctl -u
portal.device-agent -n 100 --no-pager`. `healthy` и `degraded` разрешают локальную печать;
`blocked_config` означает невалидные credential/config и закрывает relay/команды; `revoked`
означает отзыв credential и также закрывает relay/команды. Ни один из этих статусов не меняет
Moonraker, `printer.cfg`, firmware или OS image. Отозванный credential не переиспользуйте — получите
новый enroll-код.

Для плохого релиза от root запустите `apps/device-agent/deploy/rollback.sh`: скрипт остановит
unit, переключит `current` на сохранённый `previous` symlink и запустит сервис снова. Скрипт
изменяет только релиз и unit агента: Moonraker и состояние печати не трогает. Если safe-релиза нет
или бинарь повреждён, требуется операторская повторная установка; агент никогда не откатывает OS
или firmware автоматически. При ошибке enroll сохраните действующий `gateway-key.pem`; удалять
можно только `gateway-key.pending.pem`. Выпустите новый код и повторите; старый код не
переиспользуйте. Recovery запускается той же командой с `--recover` и новым recovery code.
При подозрении на компрометацию отзовите устройство в портале, остановите unit и удалите
локальные credentials.

Для удаления сначала отзовите credential в портале, затем от root запустите
`apps/device-agent/deploy/uninstall.sh`. Скрипт остановит сервис, удалит unit, release,
конфигурацию и локальные credentials, после чего удалит `3mf-agent`.
Отзыв credential в портале обязателен до удаления диска. Никакие секреты, OS image,
firmware binary или flashing instructions этим runbook не поставляются.

Операционная проверка rollback с эмулятором systemd, проверкой идемпотентности и контролем
отсутствия секретов в journal описана в [`docs/verification/mf-1241-device-agent-rollback.md`](../verification/mf-1241-device-agent-rollback.md).
Lineage реализации MF-1180: `5e72dcbeb0926e08c834b1277ff77f4ec49bceff` (Front, 12.07.2026),
`4452c4c1ac754a86c4fe9a1e8265a3117e1a1932` (Data, 12.07.2026), публикационный gate
`18d8de5b9da3a1111aada518dc11d47f57b5ab4b` (Front, 12.07.2026).

Поддержка и протоколы: [printer.support.md](../epics/printer.support.md),
[printer.protocols.md](../research/printer.protocols.md),
[printer.server.md](../architecture/printer.server.md).
