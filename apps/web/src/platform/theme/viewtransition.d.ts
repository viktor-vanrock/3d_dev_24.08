// TS DOM lib (5.7) ещё не знает про View Transitions API (Baseline 2024) — амбиентный тип
// под нативный document.startViewTransition, который используем для перехода Дом⇄Проекты
// (motion.md §2, router.ts). Без сборки в @types/web-features — конкретно то, что вызываем.
interface ViewTransition {
  readonly finished: Promise<void>;
  readonly ready: Promise<void>;
  readonly updateCallbackDone: Promise<void>;
  skipTransition(): void;
}

interface Document {
  startViewTransition?(callback: () => void | Promise<void>): ViewTransition;
}
