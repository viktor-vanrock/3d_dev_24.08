# connector/common — общий контракт коннекторов

- `connector.ts` — `PrinterConnector` (discover?/connect/disconnect), `OperatorConfirmGate`
  (подтверждение оператора через Telegram-бота), типы endpoint/результатов.
- Каждый вендор (`../snapmaker`, `../creality`, `../flsun`) реализует `PrinterConnector`
  и на выходе `connect()` отдаёт готовый `PrinterDriver` из `../../driver/`.
- Сюда же складывать общий код, который пригодится 2+ вендорам: LAN-скан/пинг,
  ретраи/бэкофф реконнекта, персист токенов. НЕ складывать вендорную специфику.

## Auth-флоу с оператором (обязателен)

1. Есть сохранённый токен → пробуем им; жив — оператора не дёргаем.
2. Токена нет/протух → `confirmGate.requestApproval(...)`: воркер шлёт в Telegram
   «пытаюсь подключиться к <vendor> <host>: подтверди на принтере / пришли токен»
   и ждёт ответа оператора.
3. `approved:false` или таймаут → `ConnectResult{ok:false, error}`; никаких повторных
   тихих попыток.
4. Успех → вернуть `token` наверх для персиста.
