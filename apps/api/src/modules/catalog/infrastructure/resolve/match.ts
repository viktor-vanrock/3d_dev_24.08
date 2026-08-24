// Matching-шаг entity resolution (MF-406 п.2, декомпозиция MF-648): кандидат против станков
// внутри блока (блок = один vendor_id, собирается SQL-запросом в ./run.ts — "Blocking" из
// задачи реализован там, group by vendor_id уже дешёвый индексный запрос, отдельная
// in-memory группировка не нужна). Здесь — сравнение имени кандидата с model/aliases станков
// блока: точный хит (после нормализации, включая alias — RU/EN дедуп из "Готово когда" эпика
// живёт через уже заведённый алиас, не через транслитерацию, см. ./normalize.ts) или высокая
// триграммная близость → high confidence, авто-merge; средняя — "спорная пара", в очередь
// ревью, не мержим молча.
//
// TODO(AI): спорные пары (score в [LOW_MATCH_THRESHOLD, HIGH_MATCH_THRESHOLD)) — крючок под
// семантическое/LLM-сравнение (giga-стек), см. описание MF-406 п.2. Сейчас строковая близость —
// сознательный первый проход, не заглушка "на потом забыли": порог настроен консервативно
// (лучше лишний раз в ревью, чем ложный merge), при появлении LLM-матчера скор из этого модуля
// станет один из сигналов, не единственным.
import { compactModelName } from "./normalize.ts";
import { trigramSimilarity } from "./similarity.ts";

export const HIGH_MATCH_THRESHOLD = 0.9;
export const LOW_MATCH_THRESHOLD = 0.55;

export interface MachineNameIndex {
  id: string;
  model: string;
  aliases: string[];
}

export interface MatchResult {
  machineId: string;
  score: number;
  confidence: "high" | "ambiguous";
}

/** Лучшее совпадение кандидата (сырое имя, ДО нормализации) среди станков одного блока
 *  (один vendor_id). null — ни одно совпадение не дотянуло даже до LOW_MATCH_THRESHOLD, кандидат
 *  считается потенциально новой моделью. */
export function matchCandidate(rawCandidateName: string, block: MachineNameIndex[]): MatchResult | null {
  const candidateName = compactModelName(rawCandidateName);
  let best: MatchResult | null = null;

  for (const machine of block) {
    const names = [machine.model, ...machine.aliases].map(compactModelName);
    let score = 0;
    for (const name of names) {
      if (name === candidateName) {
        score = 1;
        break; // точный хит (в т.ч. по алиасу) — дальше в этом станке искать нечего
      }
      score = Math.max(score, trigramSimilarity(candidateName, name));
    }
    if (!best || score > best.score) {
      best = { machineId: machine.id, score, confidence: score >= HIGH_MATCH_THRESHOLD ? "high" : "ambiguous" };
    }
  }

  if (!best || best.score < LOW_MATCH_THRESHOLD) return null;
  return best;
}
