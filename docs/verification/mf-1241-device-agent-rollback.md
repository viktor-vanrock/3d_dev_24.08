# MF-1241: проверка отката локальной конфигурации агента

QA-сценарий выполняется на эмуляторе или тестовом Linux-хосте с systemd. Он не
требует принтера, не меняет `printer.cfg`, прошивку или образ ОС и не должен
содержать credential в выводе.

## Безопасные предусловия

1. Зафиксировать `current` и `previous` symlink, checksum релиза и состояние
   печати через локальный Moonraker. Физический reset/питание не выполнять.
2. Для теста использовать две локальные копии агента: `release-good` и
   `release-bad`. В `release-bad` положить только маркер версии, без секретов.
3. Убедиться, что `agent.key` и `credentials.enc` находятся вне каталогов
   релизов, имеют mode `600`, а journal не содержит их содержимое.

## Эмуляторный прогон

```sh
set -eu
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/releases/good" "$tmp/releases/bad" "$tmp/bin"
cat >"$tmp/bin/systemctl" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>"${ROLLBACK_SYSTEMCTL_LOG:?}"
EOF
chmod +x "$tmp/bin/systemctl"
printf 'good\n' >"$tmp/releases/good/version"
printf 'bad\n' >"$tmp/releases/bad/version"
ln -s "$tmp/releases/good" "$tmp/releases/previous"
ln -s "$tmp/releases/bad" "$tmp/releases/current"

export ROLLBACK_SYSTEMCTL_LOG="$tmp/systemctl.log"
PATH="$tmp/bin:$PATH" DEVICE_AGENT_CURRENT="$tmp/current" \
  DEVICE_AGENT_PREVIOUS="$tmp/previous" apps/device-agent/deploy/rollback.sh
test "$(readlink "$tmp/current")" = "$tmp/releases/good"
test "$(cat "$tmp/current/version")" = good
PATH="$tmp/bin:$PATH" DEVICE_AGENT_CURRENT="$tmp/current" \
  DEVICE_AGENT_PREVIOUS="$tmp/previous" apps/device-agent/deploy/rollback.sh
test "$(readlink "$tmp/current")" = "$tmp/releases/good"
```

В production переменные не задаются: используются `/opt/3mf-device-agent/current`
и `/opt/3mf-device-agent/previous`, а `systemctl` — настоящий systemd.

Ожидаемый результат: первый запуск возвращает предыдущий валидный релиз и
перезапускает только `portal.device-agent`; повторный запуск оставляет тот же
релиз (идемпотентность). При отсутствии `previous` скрипт завершается до
остановки сервиса. Запуск без root также завершается до изменения symlink.

## Проверки после rollback

```sh
curl -fsS http://127.0.0.1:9797/health
sudo systemctl is-active portal.device-agent
sudo journalctl -u portal.device-agent -n 100 --no-pager | \
  rg -n -i 'credential|token|secret|agent\.key|credentials\.enc' && exit 1 || true
```

Health должен быть `healthy` или безопасно деградированным `degraded`; при
повреждённой конфигурации допустим `blocked_config` (HTTP 503), но relay и
команды закрыты, а локальная печать не блокируется. В evidence записать SHA256
архивов, целевой release, HTTP-код health, `systemctl is-active` и факт, что
печать/прошивка не затрагивались. Секреты, enroll-код и содержимое credential
в evidence не включать.
