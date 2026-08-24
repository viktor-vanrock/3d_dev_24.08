import { useEffect } from "react";
import type { Activation, ActivationState, Persona, UserPrinter } from "@shared/lib";

// Inferred-персона (Фаза 3, MF-438 § «События активации + inferred-персона»): когда юзер
// пропустил/смазал развилку персоны (MF-437), достраиваем её по первым действиям —
// «мягкая переприоритизация» (меняет только порядок CTA/модулей, не состав, критерий
// приёмки эпика). Сигналы из описания карточки, по убыванию уверенности:
//   1. 3+ принтера в парке → мастер/ферма (сильный, однозначный сигнал масштаба).
//   2. Загрузил свою первую модель → автор (явное действие автора).
//   3. Есть принтер И уже листал каталог под задачу → мейкер (слабее: единственный
//      клиентский прокси «искал под задачу» сегодня — фактический визит каталога
//      из чек-листа, catalog_visited; когда появится телеметрия реальных поисковых
//      запросов, этот пункт заменяется на неё без переверстки вызывающей стороны).
// Персону НИКОГДА не подменяем, если она уже declared — только когда primary_persona
// пуст (юзер выбрал «просто посмотреть»/пропустил) или уже была сама inferred (даём
// ей уточняться по мере накопления сигналов).
export function inferPersona(activation: Activation, printers: UserPrinter[]): Persona | null {
  if (printers.length >= 3) return "pro";
  if (activation.activation_checklist.model_uploaded) return "author";
  if (activation.has_printer && activation.activation_checklist.catalog_visited) return "maker";
  return null;
}

export function shouldApplyInferredPersona(activation: Activation): boolean {
  return activation.primary_persona === null || activation.persona_source === "inferred";
}

// Хук дома (returning-состояние): пересчитывает inferred-персону при каждом изменении
// парка/чек-листа и молча патчит профиль, если сигнал появился/сменился. Не шлём отдельное
// аналитическое событие — persona_declared зарезервирован за явным тапом (MF-437), inferred
// проявляется в самих CTA/модулях дома, не в отдельной метрике воронки.
export function useInferredPersona(activation: ActivationState): void {
  const current = activation.activation;
  useEffect(() => {
    if (!current || !shouldApplyInferredPersona(current)) return;
    const inferred = inferPersona(current, activation.printers);
    if (inferred && inferred !== current.primary_persona) {
      activation.patch({ primary_persona: inferred, persona_source: "inferred" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, activation.printers]);
}
