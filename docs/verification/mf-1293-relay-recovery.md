# MF-1293: восстановление туннеля после потери relay

QA-сценарий для dev-контура. Проверка не требует физического принтера, не
выполняет команды печати и не использует production. Эмулятор relay в
`apps/device-agent/src/relay/client.test.ts` поднимает только loopback WS.

## Что проверяем

1. Агент подключается к relay и проходит challenge/hello.
2. При разрыве соединения агент не объявляет восстановление по одному факту
   открытия TCP: новый сеанс считается восстановленным только после
   `hello_ack`.
3. Повторные попытки идут с экспоненциальным backoff, а не плотным циклом.
4. После возврата relay агент создаёт новый сеанс и немедленно повторяет
   последний известный snapshot с тем же `seq`.
5. Вне активного сеанса snapshot не отправляется, поэтому relay/API не должны
   показывать `ready` как признак доступности туннеля. Без heartbeat relay
   переводит устройство в `offline` после настроенного timeout.

## Воспроизводимый прогон

Из корня репозитория:

```bash
pnpm --filter @portal/device-agent test -- src/relay/client.test.ts
```

Критичный тест — `reconnects with backoff after the connection drops and
resends the last known snapshot`. Он принимает прогон, если после закрытия
первого сокета появляется второй, а его первый heartbeat содержит прежний
`status`, `progress` и `seq=1`. Тест с короткими интервалами backoff (`20..100
ms`) не требует сертификатов, enroll-кода или API.

Для проверки полного dev-контура оператором:

```bash
cd apps/relay
go test ./... -race
curl -fsS https://relay.dev.3mf.tech/health
```

Затем агент запускается только с dev WSS и dev credentials по
`docs/infra/relay-qa-readiness.md`. На коротком отключении relay ожидаются
`reconnect` и новый `hello`; при остановленном relay/API должен оставаться
`offline`, а не `ready`. После возврата relay ожидаются `sessions >= 1`, новый
`hello` и heartbeat со snapshot. Повторный enroll для этого восстановления не
нужен.

## Evidence и критерии

| Событие | Принято | Отклонено |
|---|---|---|
| relay доступен | `hello_ack`, heartbeat, состояние `online`/актуальный статус | `ready` без успешного `hello_ack` |
| relay разорван | backoff, нет heartbeat в закрытый сокет, по timeout `offline` | tight-loop reconnect, stale `ready`, бесконечное накопление кадров |
| relay вернулся | новый сеанс, `hello`, немедленный snapshot с прежним `seq` | новый enroll, пропуск snapshot до полного heartbeat-интервала, `seq` сброшен |
| логи | только коды событий/статусы; credentials не раскрываются | JWT, enroll-код, API key или payload-secret в логах/артефактах |

Итог recovery: `recovery success` подтверждён новым сеансом, `hello_ack` и
повтором snapshot с прежним `seq`; до этого состояние остаётся `offline` или
`recovery required`.

Проверка не запускает `start`, `pause`, `resume`, `cancel`, G-code или
перепрошивку: при потере relay безопасное состояние — `offline`/`recovery
required`, риск печати и firmware reset отсутствует. Реальный принтер и
production VDS в этот сценарий не входят.
