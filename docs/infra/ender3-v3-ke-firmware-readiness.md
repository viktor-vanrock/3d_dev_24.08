# Ender-3 V3 KE — firmware-readiness manifest (dev)

**Gate owner:** Devices/Fleet · **Date:** 2026-07-12 · **Scope:** first *live*
agent connection to an existing Klipper/Moonraker host. This is not an OS image,
firmware binary, or flashing instruction.

**Граница источников:** Creality публикует отдельную процедуру восстановления KE
и официальный пакет Klipper, однако это не подтверждает версию или включённый
Moonraker API конкретного принтера. Источники: [инструкция Creality по
восстановлению](https://wiki.creality.com/zh/ender-series/ender-3-v3-ke/quick-start-guide/firmware-open-source/brick-rescue-wire-brushing-process)
и [официальный репозиторий прошивки](https://github.com/CrealityOfficial/Ender-3_V3_KE_Klipper).
Поэтому все значения конкретного устройства ниже остаются `unknown` до записи
оператором результата preflight только на чтение.

## Verdict

**BLOCKED externally.** No powered Ender-3 V3 KE Moonraker endpoint is available:
the LAN scan recorded in MF-1100 found no open Moonraker service. A live pass must
not be substituted with a fixture or fake relay.

**Model boundary (2026-07-12):** the live proof planned for today is on an
**FLSun T1 Max**. Its successful enroll, relay, telemetry, or command checks are
evidence for the shared platform path only; they do **not** change this Ender
verdict. Ender may pass only after its own IP/Moonraker read-only probe and the
Ender-3 V3 KE compatibility dossier (MF-1176).

**One operator action to unblock:** provide a powered Ender-3 V3 KE's LAN URL/IP
to the operator running the pilot, and a Moonraker API key only when that host
requires authorization. The operator then performs the read-only preflight
`GET /server/info`; no credential, IP, or enroll code belongs in Git or an issue.

## Матрица готовности прошивки KE (MF-1214)

| Поле | Текущий факт | Доказательство / безопасное следующее внешнее действие |
| --- | --- | --- |
| Модель | Ender-3 V3 KE | Назначенная пилотная модель; не подменять Ender-3 V3 или V3 SE. |
| Установленная версия прошивки | `unknown` | Оператор фотографирует экран **About** или сохраняет строку версии с локального хоста; серийный номер и LAN-адрес замаскировать. |
| Root / shell-доступ | `unknown` | Оператор подтверждает доступность обратимой локальной shell-сессии. Эскалацию привилегий не предпринимать. |
| Moonraker endpoint | `unknown` | С хоста рядом с устройством выполнить указанный ниже `GET /server/info` только на чтение. Отказ соединения, 401/403 или не-Moonraker ответ — блокер, а не повод для обхода. |
| Авторизация Moonraker | `unknown` | При 401/403 оператор передаёт account-bound API-ключ вне Git; авторизацию не отключать и ключ не коммитить. |
| Агент / relay | Контракт платформы готов; live-доказательство KE заблокировано | Завершить preflight на чтение, затем временный foreground-запуск только после закрытия существующих WSS/auth gates. |
| `firmware_ready` | `false` / не повышать | Нужны успешное KE-специфичное live-доказательство и закрытые install/auth/lease gates; образ ОС в этой задаче не собирается. |
| Откат | Определён и обратим только для временного агента | Остановить foreground-процесс, отозвать устройство, удалить только локальное состояние агента как указано ниже. `printer.cfg`, прошивка и boot-раздел не меняются. |

**Обязательное доказательство приемки:** один обезличенный артефакт оператора:
либо фото экрана версии вместе с замаскированным статусом `GET /server/info`,
либо замаскированный terminal log с обоими фактами. До вложения артефакта матрица
остаётся честным отчётом о блокировке, а не прохождением проверки железа.

## What is ready in `dev`

| Capability | Evidence | Gate result |
| --- | --- | --- |
| Moonraker model/capability expectations | `fixtures/pilots/ender3v3ke.json`, validated by `node fixtures/pilots/validate.mjs` | PASS (contract) |
| Identity/fingerprint and `telemetry.v1` | `apps/device-agent`, commits `7c70553`, `c2eed7f` | PASS (unit/contract) |
| Safe command policy/driver contract | `packages/contracts/printer-driver/moonraker.v1.md`, commit `a3e4999` | PASS (contract) |
| Relay health and reconnect observability | `docs/infra/relay-qa-readiness.md`, commit `910d872` | PASS (service smoke) |
| Live enroll, heartbeat/reconnect, device state | requires the physical pilot | BLOCKED |
| Replay-safe WSS auth | MF-1146 lacks hello challenge/nonce | BLOCKED |
| Lease/offline transition | MF-1148 has no delivered result | BLOCKED |
| Installer, systemd unit, signed artifact/uninstall | MF-1175 has no delivered result | BLOCKED |
| Ender-specific live compatibility evidence | MF-1176 has no dossier or read-only probe | BLOCKED |

## Safe operator preflight and temporary launch

Run these only on the device-adjacent host after the operator has obtained the
LAN endpoint and an account-bound, one-time enroll credential through the normal
UI/API. Keep secrets in the shell environment or local secret store, never in a
checked-in file.

```bash
curl --fail --silent --show-error "$MOONRAKER_URL/server/info"

MOONRAKER_URL=http://<ender-lan-ip>:7125 \
RELAY_URL=wss://relay.dev.3mf.tech/relay/ws \
MULTICA_AGENT_HOME="$HOME/.3mf-agent" \
MOONRAKER_API_KEY="${MOONRAKER_API_KEY:-}" \
pnpm --filter @portal/device-agent dev
```

Expected: the agent reports Moonraker connection/capabilities, relay health shows
one session, and the API receives an online `device_state`. Execute the reconnect
and stop checks in [relay-qa-readiness.md](relay-qa-readiness.md).

## Rollback

The temporary command is foreground-only: press `Ctrl-C` (SIGINT) or send
`SIGTERM`; the agent closes relay and Moonraker connections. Remove its local
credential directory only after revoking the device in the portal/API:

```bash
rm -rf "$HOME/.3mf-agent"
```

Do **not** install a systemd unit or alter `printer.cfg` until MF-1175 supplies
the reviewed installer/runbook. OS-image assembly and flashing remain an operator
task outside this gate.

## Only missing work (already tracked; do not duplicate)

- MF-1146 — hello nonce/challenge replay protection and live mTLS check.
- MF-1148 — heartbeat lease and observable offline detection.
- MF-1175 — signed artifact, systemd installation/uninstall runbook.
- MF-1176 — Ender-3 V3 KE read-only Moonraker probe and evidence-backed dossier.
- MF-1100 / MF-1102 — perform the final live enroll/reconnect QA once the operator
  supplies the powered device and access described above.
