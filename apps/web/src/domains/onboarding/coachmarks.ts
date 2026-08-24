import type { ActivationState } from "@shared/lib";

// Слой 3 обучающего дерева (MF-435/MF-438 § «Послойный обучающий слой»), сужен чисткой главной
// (home.visual.md §6, MF-803/MF-918): раньше здесь жил каталог из 4 условных подсказок
// (принтер/бейдж/поиск/филамент) — все, кроме объяснения двойной судьбы строки ввода, сняты с
// Дома (адреса переезда — home.visual.md §8: «Принтеры»/каталог получат свои коачмарки отдельными
// карточками). Единственная запись, видна ВСЕМ (первый визит и returning), по одному триггеру
// «Понятно/Позже» + три событийных (символ в поле/8с бездействия/скролл — проводка в home.tsx).
export const COACHMARK_LIFETIME_CAP = 7;

export interface CoachmarkSpec {
  id: string;
  title: string;
}

export const COACHMARK_SPECS: CoachmarkSpec[] = [
  {
    id: "search_or_generate",
    title: "Опишите словами. Найдём — покажем. Не найдём — сгенерируем.",
  },
];

if (COACHMARK_SPECS.length > COACHMARK_LIFETIME_CAP) {
  throw new Error("coachmarks: превышен бюджет анти-перегруза ≤7 на жизнь аккаунта");
}

function dismissedKey(id: string): string {
  return `coachmark:${id}`;
}

// Единственный неотклонённый коачмарк (сейчас в реестре только один) — по одному (критерий
// приёмки: «на любом входе на дом одновременно виден ≤1 обучающий элемент»). `dismissed` —
// источник агностичен (серверный home_dismissed_prompts для авторизованного, localStorage
// для гостя, см. useActiveCoachmark ниже).
export function selectCoachmark(dismissed: (id: string) => boolean): CoachmarkSpec | null {
  return COACHMARK_SPECS.find((spec) => !dismissed(spec.id)) ?? null;
}

export interface ActiveCoachmark {
  spec: CoachmarkSpec;
  dismiss: () => void;
}

const GUEST_STORAGE_KEY = "home_dismissed_prompts";

function guestDismissed(id: string): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    const raw = localStorage.getItem(GUEST_STORAGE_KEY);
    return raw ? Boolean((JSON.parse(raw) as Record<string, boolean>)[dismissedKey(id)]) : false;
  } catch {
    return false;
  }
}

function dismissForGuest(id: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(GUEST_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    parsed[dismissedKey(id)] = true;
    localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // приватный режим/квота — коачмарк просто покажется снова на следующий визит, не критично
  }
}

// Хук дома (home.scenario.md §6): показывается всем — первому визиту и returning, гостю и
// авторизованному (GAP-GUEST ещё не решён CTO, но хранение уже разведено на оба пути, как
// требует сценарий). Дисмисс по «Понятно» — здесь; три остальных триггера (символ/таймер/скролл)
// проводятся вызывающей стороной (home.tsx) через тот же dismiss().
export function useActiveCoachmark(activation: ActivationState): ActiveCoachmark | null {
  if (activation.loading) return null;
  const account = activation.activation;
  const dismissed = (id: string) => (account ? !!account.home_dismissed_prompts[dismissedKey(id)] : guestDismissed(id));
  const spec = selectCoachmark(dismissed);
  if (!spec) return null;
  return {
    spec,
    dismiss: () => {
      if (account) {
        activation.patch({
          home_dismissed_prompts: { ...account.home_dismissed_prompts, [dismissedKey(spec.id)]: true },
        });
      } else {
        dismissForGuest(spec.id);
      }
    },
  };
}
