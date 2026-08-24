// Public API домена ai (assistant + generate + research). Реэкспорт файлов, которые
// импортируются извне домена; внутренние модули остаются приватными.
//
// Порядок важен: printing→ai (labels.ts) читает KINEMATICS_OPTIONS на верхнем уровне модуля
// (не в функции), а generatescreen.tsx/workshop.tsx тянут @domains/commerce → @domains/social →
// (threadscreen.tsx) → @domains/printing — реальный цикл через барели. Чистые модули без
// кросс-доменных зависимостей должны идти в экспортах ПЕРЕД экранами, которые тянут commerce,
// иначе при возврате цикла в printing нужный экспорт ещё не успевает исполниться (undefined).
export * from "./generate/generations.ts";
export * from "./research/api.ts";
export * from "./research/schema.ts";
export * from "./assistant/events.ts";
export * from "./assistant/assistantapi.ts";
export * from "./generate/generatescreen.tsx";
export * from "./research/researchform.tsx";
export * from "./research/researchscreen.tsx";
export * from "./assistant/chatcenter.tsx";
export * from "./assistant/chatscreen.tsx";
export * from "./assistant/headersearch.tsx";
export * from "./assistant/workshop.tsx";
