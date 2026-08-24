// Оркестратор entity resolution (MF-406, декомпозиция MF-648): blocking→matching→merge→
// plausibility поверх machine_candidates.status='pending'. Разовый прогон (батч limit
// кандидатов, по умолчанию 500) — под расписание оборачивает scripts/resolve-run.ts,
// то же место, что уже принято для scripts/ingest-run.ts (runIngest). Не транзакционно
// между шагами одного кандидата (тот же паттерн, что runIngest) — при обрыве кандидат
// остаётся 'pending' и переигрывается следующим прогоном, merge идемпотентен
// (mergeCandidateIntoMachine — no-op на уже совпадающих значениях).
//
// Кандидаты обрабатываются последовательно и блок (машины того же вендора) читается заново на
// каждого кандидата — не кэшируется в рамках прогона. Это не худший вариант по производительности
// (батч кандидатов — не горячий путь), а корректность важнее: два кандидата одной новой модели
// в одном прогоне не породят два дублирующих machines-ряда, второй увидит уже закоммиченную
// вставку первого.
import { pool } from "../../../../db/client.ts";
import { ensureCatalogCommunity } from "../../../community/public/index.ts";
import { resolveVendorName } from "../vendor-normalize.ts";
import type { FieldProvenance, Specs } from "./merge.ts";
import { mergeCandidateIntoMachine } from "./merge.ts";
import type { MachineNameIndex } from "./match.ts";
import { matchCandidate } from "./match.ts";
import { compactModelName } from "./normalize.ts";
import { checkPlausibility } from "./plausibility.ts";

export interface ResolutionRunResult {
  processed: number;
  createdMachines: number;
  mergedClean: number;
  mergedWithConflicts: number;
  ambiguousMatches: number;
  quarantinedCandidates: number;
  invalidCandidates: number;
}

interface PendingCandidateRow {
  id: string;
  source: string;
  source_url: string | null;
  raw: unknown;
  confidence: string | null; // numeric(3,2) — pg отдаёт строкой, не парсит в number сама
}

interface MachineBlockRow {
  id: string;
  model: string;
  aliases: string[];
  specs: Specs;
  field_provenance: FieldProvenance;
  status: string;
}

export interface ParsedCandidate {
  vendor: string;
  model: string;
  specs: Specs;
}

// exported для machine-candidates.ts (MF-651 review-очередь approve/reject — тот же разбор raw,
// что и штатный прогон, чтобы карантинный/спорный кандидат approve'ился тем же способом, каким
// его смёржил бы автоматический пайплайн).
export function parseRaw(raw: unknown): ParsedCandidate | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const vendor = obj.vendor;
  const model = obj.model;
  if (typeof vendor !== "string" || vendor.trim().length === 0) return null;
  if (typeof model !== "string" || model.trim().length === 0) return null;
  const specs = typeof obj.specs === "object" && obj.specs !== null ? (obj.specs as Specs) : {};
  return { vendor, model, specs };
}

// confidence кандидата после мержа/матча — 1 у чистого результата (нового или без конфликтов),
// низкое значение у всего, что осталось в очереди ревью (спорный матч использует свой score,
// конфликт полей — фиксированный маркер "решает человек", implausible — 0, отдельно от диапазона
// матчинга, чтобы не путать с низким, но реальным score совпадения).
export const CLEAN_MERGE_CONFIDENCE = 1;
export const FIELD_CONFLICT_CONFIDENCE = 0.3;
const IMPLAUSIBLE_CONFIDENCE = 0;

// machine_candidates — общая таблица с независимым пайплайном apps/scout (MF-623/627/720,
// свой резолвер apps/scout/src/scout/resolver с generic-дистпатчем под свой raw-словарь
// vendor_slug/model_name), см. известный побочный факт в docs/epics/domain.model.md §
// «Агент-парсер свободного HTML». Этот резолвер понимает только raw={vendor, model, specs}
// (см. parseRaw выше) — без фильтра по source в штатном (полноочередном) режиме он бы забирал
// scout-кандидаты из общей 'pending' очереди и рубил их 'rejected' как invalid ДО того, как их
// увидит scout-резолвер (тихая потеря данных чужого пайплайна). KNOWN_SOURCES — источники,
// чей raw этот резолвер реально умеет разобрать: TS-адаптеры (MF-648) + giga free-html
// экстрактор (MF-649, пишет тот же raw-словарь напрямую через psycopg).
const KNOWN_SOURCES = ["cura-definitions", "sovol3d-store", "giga-free-html"];

export async function runEntityResolution(options: { limit?: number; ids?: string[] } = {}): Promise<ResolutionRunResult> {
  const limit = options.limit ?? 500;
  const result: ResolutionRunResult = {
    processed: 0,
    createdMachines: 0,
    mergedClean: 0,
    mergedWithConflicts: 0,
    ambiguousMatches: 0,
    quarantinedCandidates: 0,
    invalidCandidates: 0,
  };

  // ids — точечный прогон конкретных кандидатов (тесты; в будущем — ручной ре-прогон одного
  // отклонённого/зависшего) — доверяем вызывающему коду выбор id, source не фильтруем. Без
  // ids — вся очередь 'pending' по расписанию (scripts/resolve-run.ts), штатный режим, только
  // источники из KNOWN_SOURCES (см. комментарий выше).
  const pending = options.ids
    ? await pool.query<PendingCandidateRow>(
        `select id, source, source_url, raw, confidence from machine_candidates
         where status = 'pending' and id = any($1) order by created_at`,
        [options.ids],
      )
    : await pool.query<PendingCandidateRow>(
        `select id, source, source_url, raw, confidence from machine_candidates
         where status = 'pending' and source = any($1) order by created_at limit $2`,
        [KNOWN_SOURCES, limit],
      );

  const vendorIdCache = new Map<string, string>();
  async function vendorId(rawVendor: string): Promise<string> {
    const { slug, name } = resolveVendorName(rawVendor);
    const cached = vendorIdCache.get(slug);
    if (cached) return cached;
    const res = await pool.query<{ id: string }>(
      `insert into vendors (slug, name) values ($1, $2)
       on conflict (slug) do update set name = excluded.name
       returning id`,
      [slug, name],
    );
    const id = res.rows[0]!.id;
    // MF-2039: "лениво создаются системой" (community_foundation-миграция) — этот вызов и есть та
    // ленивость, реализованная впервые. Любой вендор, попавший в каталог через ЛЮБОЙ путь, получает
    // саб автоматически, не только курируемый список из ручного сегодняшнего сида.
    await ensureCatalogCommunity("vendor", id, name);
    vendorIdCache.set(slug, id);
    return id;
  }

  for (const candidate of pending.rows) {
    result.processed += 1;
    const now = new Date().toISOString();
    const candidateConfidence = candidate.confidence === null ? null : Number(candidate.confidence);

    const parsed = parseRaw(candidate.raw);
    if (!parsed) {
      result.invalidCandidates += 1;
      await pool.query(`update machine_candidates set status = 'rejected', updated_at = now() where id = $1`, [candidate.id]);
      continue;
    }

    const vid = await vendorId(parsed.vendor);
    // Blocking (MF-406 п.1): один блок = один vendor_id, индексный select, group-by в памяти не
    // нужен. quarantined тоже участвует в матчинге — новый кандидат может подтвердить/поправить
    // карантинную запись, но статус 'active'/'quarantined' машины трогается только по
    // plausibility результата (ниже), не самим фактом матча.
    const block = await pool.query<MachineBlockRow>(
      `select id, model, aliases, specs, field_provenance, status from machines
       where vendor_id = $1 and status in ('active', 'quarantined')`,
      [vid],
    );

    const nameIndex: MachineNameIndex[] = block.rows.map((m) => ({ id: m.id, model: m.model, aliases: m.aliases }));
    const match = matchCandidate(parsed.model, nameIndex);

    if (!match) {
      // Ни одного даже отдалённо похожего станка у этого вендора — потенциально новая модель.
      const plausibility = checkPlausibility(parsed.specs);
      if (!plausibility.plausible) {
        // Не дошла до канона (MF-406 п.4) — карантин на самом кандидате, machines-ряд не создаём.
        result.quarantinedCandidates += 1;
        await pool.query(`update machine_candidates set status = 'quarantined', confidence = $2, updated_at = now() where id = $1`, [candidate.id, IMPLAUSIBLE_CONFIDENCE]);
        continue;
      }

      const provenance: FieldProvenance = {};
      for (const field of Object.keys(parsed.specs)) {
        provenance[field] = {
          source: candidate.source,
          source_url: candidate.source_url,
          ts: now,
          confidence: candidateConfidence ?? 0.5,
        };
      }

      const created = await pool.query<{ id: string }>(
        `insert into machines (craft, kind, vendor_id, model, specs, field_provenance, status, source)
         values ('3d_printing', 'fdm_printer', $1, $2, $3::jsonb, $4::jsonb, 'active', 'community')
         returning id`,
        [vid, parsed.model, JSON.stringify(parsed.specs), JSON.stringify(provenance)],
      );
      const machineId = created.rows[0]!.id;
      result.createdMachines += 1;
      // MF-2039: тот же саб-по-умолчанию, что и у вендора выше — machine-саб называем
      // "<Вендор> <модель>" (тот же вид, что уже используют существующие Creality K1/QIDI Q2).
      await ensureCatalogCommunity("machine", machineId, `${resolveVendorName(parsed.vendor).name} ${parsed.model}`);
      await pool.query(`update machine_candidates set status = 'merged', matched_machine_id = $2, confidence = $3, updated_at = now() where id = $1`, [
        candidate.id,
        machineId,
        CLEAN_MERGE_CONFIDENCE,
      ]);
      continue;
    }

    if (match.confidence === "ambiguous") {
      // Спорная пара (MF-406 п.2) — не мержим молча, кандидат остаётся 'pending' в очереди
      // ревью с score матчинга как confidence и лучшим кандидатом-станком для контекста.
      result.ambiguousMatches += 1;
      await pool.query(`update machine_candidates set matched_machine_id = $2, confidence = $3, updated_at = now() where id = $1`, [candidate.id, match.machineId, match.score]);
      continue;
    }

    // High confidence match — merge поле-за-полем в существующую каноническую запись (MF-406 п.3).
    const machine = block.rows.find((m) => m.id === match.machineId)!;
    const merge = mergeCandidateIntoMachine({
      existingSpecs: machine.specs,
      existingProvenance: machine.field_provenance,
      candidateSpecs: parsed.specs,
      candidateSource: candidate.source,
      candidateSourceUrl: candidate.source_url,
      candidateConfidence,
      now,
    });

    // Кандидат назвал станок иначе, чем канон/уже известные алиасы, но совпал с высокой
    // уверенностью — учим новый алиас на будущее (следующий кандидат под этим именем найдёт
    // точный хит на blocking-шаге, не будет заново гадать по близости).
    const aliases = [...machine.aliases];
    const knownCompact = new Set([machine.model, ...machine.aliases].map(compactModelName));
    if (!knownCompact.has(compactModelName(parsed.model))) {
      aliases.push(parsed.model);
    }

    // Plausibility результата merge (MF-406 п.4): если приоритетный источник дал абсурдное
    // значение, которое победило конфликт, канон уходит в карантин целиком — де-карантин
    // (возврат в 'active') здесь намеренно не делается, это ручное ревью, не автоматика.
    const mergedPlausibility = checkPlausibility(merge.specs);
    const machineStatus = mergedPlausibility.plausible ? machine.status : "quarantined";

    await pool.query(`update machines set specs = $2::jsonb, field_provenance = $3::jsonb, aliases = $4, status = $5, updated_at = now() where id = $1`, [
      machine.id,
      JSON.stringify(merge.specs),
      JSON.stringify(merge.provenance),
      aliases,
      machineStatus,
    ]);

    if (merge.conflicts.length === 0) {
      result.mergedClean += 1;
      await pool.query(`update machine_candidates set status = 'merged', matched_machine_id = $2, confidence = $3, updated_at = now() where id = $1`, [
        candidate.id,
        machine.id,
        CLEAN_MERGE_CONFIDENCE,
      ]);
    } else {
      // Поле(я) не перезатёрты молча (MF-406 п.3, «Готово когда») — кандидат остаётся в очереди
      // ревью, а не 'merged': то, что смогли слить по приоритету источника, уже в machines.
      result.mergedWithConflicts += 1;
      await pool.query(`update machine_candidates set status = 'pending', matched_machine_id = $2, confidence = $3, updated_at = now() where id = $1`, [
        candidate.id,
        machine.id,
        FIELD_CONFLICT_CONFIDENCE,
      ]);
    }
  }

  return result;
}
