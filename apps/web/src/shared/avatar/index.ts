// Public API shared/avatar (avatar + headermascotpose + liveheadermascot). Реэкспорт файлов,
// которые импортируются извне модуля; внутренние модули остаются приватными.
//
// mascot3d.ts НЕ реэкспортируется здесь намеренно: это three.js-модуль, который потребители
// (liveheadermascot.tsx внутри, avatareditor.tsx снаружи) грузят через динамический import()
// ради code-splitting. Статичный `export *` в барреле затянул бы three.js в каждый бандл,
// который импортирует что-либо из @shared/avatar — используйте import("@shared/avatar/mascot3d.ts")
// напрямую, минуя баррель, как раньше.
export * from "./avatar.tsx";
export * from "./headermascotpose.ts";
export * from "./liveheadermascot.tsx";
