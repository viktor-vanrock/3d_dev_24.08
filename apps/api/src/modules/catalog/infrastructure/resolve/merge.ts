// Field-by-field merge кандидата в канон (MF-406 п.3, декомпозиция MF-648) — ПОЛЯМИ, не
// whole-record overwrite (задача явно это требует). Чистая функция: читает текущие
// specs/field_provenance станка + specs кандидата, возвращает новые specs/field_provenance
// плюс список полей-конфликтов, которые НЕ применены (остались как были). Запись в БД и решение
// "что делать с самим кандидатом при наличии конфликтов" — оркестратор (./run.ts), не этот
// модуль (тестируемость: чистая функция без pool).
import { sourcePriorityScore, UNTRACKED_FIELD_SCORE } from "./priority.ts";

export interface ProvenanceEntry {
  source: string;
  source_url: string | null;
  ts: string;
  confidence: number;
}
export type FieldProvenance = Record<string, ProvenanceEntry>;
export type Specs = Record<string, unknown>;

export interface MergeInput {
  existingSpecs: Specs;
  existingProvenance: FieldProvenance;
  candidateSpecs: Specs;
  candidateSource: string;
  candidateSourceUrl: string | null;
  /** machine_candidates.confidence — может быть не выставлен адаптером (null). */
  candidateConfidence: number | null;
  now: string;
}

export interface MergeResult {
  specs: Specs;
  provenance: FieldProvenance;
  /** Поля, где кандидат расходился со старым значением и НЕ победил по приоритету источника —
   *  старое значение сохранено как было, эти поля решают очередь ревью (см. run.ts). */
  conflicts: string[];
  /** Поля, реально изменённые этим merge (новые или выигранные перезаписи) — для confidence
   *  результата и логов. */
  updatedFields: string[];
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function mergeCandidateIntoMachine(input: MergeInput): MergeResult {
  const specs: Specs = { ...input.existingSpecs };
  const provenance: FieldProvenance = { ...input.existingProvenance };
  const conflicts: string[] = [];
  const updatedFields: string[] = [];

  const candidateScore = sourcePriorityScore(input.candidateSource, input.candidateConfidence);

  for (const [field, newValue] of Object.entries(input.candidateSpecs)) {
    if (newValue === undefined) continue;

    const hasExisting = Object.prototype.hasOwnProperty.call(input.existingSpecs, field);
    if (!hasExisting) {
      specs[field] = newValue;
      provenance[field] = {
        source: input.candidateSource,
        source_url: input.candidateSourceUrl,
        ts: input.now,
        confidence: input.candidateConfidence ?? 0.5,
      };
      updatedFields.push(field);
      continue;
    }

    if (deepEqual(input.existingSpecs[field], newValue)) continue; // одно и то же значение — не конфликт, писать нечего

    const existingEntry = input.existingProvenance[field];
    const existingScore = existingEntry ? sourcePriorityScore(existingEntry.source, existingEntry.confidence) : UNTRACKED_FIELD_SCORE;

    if (candidateScore > existingScore) {
      specs[field] = newValue;
      provenance[field] = {
        source: input.candidateSource,
        source_url: input.candidateSourceUrl,
        ts: input.now,
        confidence: input.candidateConfidence ?? 0.5,
      };
      updatedFields.push(field);
    } else {
      conflicts.push(field); // приоритет источника не победил — старое значение НЕ трогаем
    }
  }

  return { specs, provenance, conflicts, updatedFields };
}
