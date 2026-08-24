// Реальные типы треда/сообщения/run'а — packages/contracts/http/assistant.ts (assistant.v1,
// MF-1997/MF-1999). Этот файл держит только UI-хелперы поверх контракта, не переопределяет форму
// данных (см. историю: до 2026-07-20 здесь была отдельная fixture-модель с полями status/mode/
// query/messages[]/generation_id, которых на сервере нет — заменено на assistantapi.ts).

export { formatThreadUpdatedAt } from "@shared/lib";
