import { pool } from "../../../db/client.ts";

// MF-1066: минимальная модель репутации пользователя-вкладчика (trust.md §3 «Доверие
// к пользователю»). Зеркалит deviceReputation.ts (MF-1065, ось 4) — та же форма счётчика
// и того же вида badge, только subject — user_id вместо device_id. НЕ путать с
// community/reputation.ts (users.reputation_score/trust_level) — это форумная
// репутация за апвоуты тредов/постов, другая ось доверия.
//
// MF-1788: жалобы на модель дебетуют ту же ось доверия, но НЕ через мутацию счётчика
// (successful/failed_contributions остаются "как есть" — сигнал печати, MF-1065/1066,
// его модель не трогаем). Дебет по принятой жалобе — append-only запись в
// uploader_reputation_ledger (20260718210000_model_report_reputation_ledger.sql):
// user_id, report_id, staff_actor_id, ts, delta, снапшот reason. trustScore/badge —
// детерминированная функция ОТ ОБОИХ сигналов: печатных счётчиков и суммы ledger.delta,
// не поле, которое кто-то вручную декрементирует (CTO-требование карточки). Ошибочное
// решение стаффа поправимо компенсирующей ledger-записью позже — report_id в ledger не
// unique специально, вторую строку по тому же report_id ничто не запрещает.
export const UPLOADER_REPUTATION_MIN_SAMPLES = 5;
export const UPLOADER_REPUTATION_MIN_SUCCESS_RATIO = 0.8;

// Вес одной принятой жалобы на модель в терминах "провальных" контрибуций для trustScore —
// один accepted-репорт эквивалентен одному failed_contribution по влиянию на ratio.
// Конфигурируемо, дефолт 1 (см. описание карточки MF-1788: продукт не просит калибровку веса).
export const MODEL_REPORT_ACCEPTED_LEDGER_DELTA = -1;

export type UploaderContributionOutcome = "succeeded" | "failed";

export interface UploaderReputationSnapshot {
  userId: string;
  successfulContributions: number;
  failedContributions: number;
  totalContributions: number;
  trustScore: number | null;
  trustedUploader: boolean;
  lastOutcome: UploaderContributionOutcome | null;
  lastResultAt: string | null;
  /** Сумма uploader_reputation_ledger.delta для юзера (0, если строк ещё нет). */
  reportLedgerBalance: number;
}

export interface RecordUploaderContributionInput {
  ownerId: string;
  outcome: UploaderContributionOutcome;
  modelId: string;
}

/** Ввод дебета репутации по принятой жалобе на модель (MF-1788). */
export interface RecordModelReportReputationLedgerEventInput {
  /** Владелец модели, чья репутация дебетуется. */
  ownerId: string;
  reportId: string;
  staffActorId: string;
  /** Снапшот причины жалобы на момент резолюции — ledger не читает reports задним числом. */
  reason: string | null;
  delta?: number;
}

function toSnapshot(row: {
  user_id: string;
  successful_contributions: string | number;
  failed_contributions: string | number;
  last_outcome: UploaderContributionOutcome | null;
  last_result_at: Date | null;
  ledger_balance?: string | number | null;
}): UploaderReputationSnapshot {
  const successfulContributions = Number(row.successful_contributions);
  const failedContributions = Number(row.failed_contributions);
  const reportLedgerBalance = Number(row.ledger_balance ?? 0);
  return {
    userId: row.user_id,
    successfulContributions,
    failedContributions,
    ...computeTrustedUploaderBadge(successfulContributions, failedContributions, reportLedgerBalance),
    lastOutcome: row.last_outcome,
    lastResultAt: row.last_result_at ? row.last_result_at.toISOString() : null,
    reportLedgerBalance,
  };
}

/**
 * Чистая функция бейджа — без БД, детерминирована по счётчикам печати И по ledgerBalance
 * (сумма uploader_reputation_ledger.delta, MF-1788), юнит-тестируема отдельно.
 *
 * Отрицательный баланс леджера (принятые жалобы) добавляет эквивалентный вес в знаменатель
 * ratio как "провальные" контрибуции — тянет trustScore вниз и может снять trusted_uploader
 * даже без единого неудачного результата печати. Положительный баланс (будущая компенсирующая
 * запись-реверс) гасит этот эффект симметрично, не превращаясь в бонус сверх исходных счётчиков.
 */
export function computeTrustedUploaderBadge(
  successfulContributions: number,
  failedContributions: number,
  ledgerBalance = 0,
): Pick<UploaderReputationSnapshot, "totalContributions" | "trustScore" | "trustedUploader"> {
  const ledgerPenalty = Math.max(0, -ledgerBalance);
  const effectiveFailed = failedContributions + ledgerPenalty;
  const totalContributions = successfulContributions + effectiveFailed;
  if (totalContributions === 0) return { totalContributions, trustScore: null, trustedUploader: false };
  const trustScore = successfulContributions / totalContributions;
  const trustedUploader = totalContributions >= UPLOADER_REPUTATION_MIN_SAMPLES && trustScore >= UPLOADER_REPUTATION_MIN_SUCCESS_RATIO;
  return { totalContributions, trustScore, trustedUploader };
}

// Подзапрос суммы ledger.delta для юзера — переиспользуется и в апдейте счётчика печати,
// и в чистом чтении: badge всегда должен учитывать оба сигнала (см. computeTrustedUploaderBadge).
const LEDGER_BALANCE_SUBQUERY = `(
  select coalesce(sum(delta), 0) from uploader_reputation_ledger where user_id = $1
)`;

/**
 * Кредитует/дебетует репутацию владельца модели по уже принятому сигналу результата
 * печати (device_print_results, MF-1065). Идемпотентность — забота вызывающей стороны:
 * эта функция вызывается только когда device-сигнал принят впервые (recordDevicePrintResult
 * вернул accepted=true), повторный client_result_id сюда не доходит вовсе, поэтому здесь
 * отдельного идемпотентного ключа не заводим. Не трогает uploader_reputation_ledger —
 * это отдельный сигнал (жалобы на модель, MF-1788), учитывается только на чтении.
 */
export async function recordUploaderContributionResult(input: RecordUploaderContributionInput): Promise<UploaderReputationSnapshot> {
  const result = await pool.query<{
    user_id: string;
    successful_contributions: string;
    failed_contributions: string;
    last_outcome: UploaderContributionOutcome | null;
    last_result_at: Date | null;
    ledger_balance: string;
  }>(
    `insert into user_uploader_reputation (user_id, successful_contributions, failed_contributions, last_outcome, last_model_id, last_result_at, updated_at)
     values ($1, case when $2 = 'succeeded' then 1 else 0 end, case when $2 = 'failed' then 1 else 0 end, $2, $3, now(), now())
     on conflict (user_id) do update set
       successful_contributions = user_uploader_reputation.successful_contributions + case when $2 = 'succeeded' then 1 else 0 end,
       failed_contributions = user_uploader_reputation.failed_contributions + case when $2 = 'failed' then 1 else 0 end,
       last_outcome = $2,
       last_model_id = $3,
       last_result_at = now(),
       updated_at = now()
     returning user_id, successful_contributions, failed_contributions, last_outcome, last_result_at,
       ${LEDGER_BALANCE_SUBQUERY} as ledger_balance`,
    [input.ownerId, input.outcome, input.modelId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("user_uploader_reputation row missing after upsert");
  return toSnapshot(row);
}

export async function getUploaderReputation(userId: string): Promise<UploaderReputationSnapshot> {
  const result = await pool.query<{
    user_id: string;
    successful_contributions: string;
    failed_contributions: string;
    last_outcome: UploaderContributionOutcome | null;
    last_result_at: Date | null;
    ledger_balance: string;
  }>(
    `select user_id, successful_contributions, failed_contributions, last_outcome, last_result_at,
       ${LEDGER_BALANCE_SUBQUERY} as ledger_balance
     from user_uploader_reputation where user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    const ledgerResult = await pool.query<{ balance: string }>(`select coalesce(sum(delta), 0) as balance from uploader_reputation_ledger where user_id = $1`, [userId]);
    const reportLedgerBalance = Number(ledgerResult.rows[0]?.balance ?? 0);
    return {
      userId,
      ...computeTrustedUploaderBadge(0, 0, reportLedgerBalance),
      successfulContributions: 0,
      failedContributions: 0,
      lastOutcome: null,
      lastResultAt: null,
      reportLedgerBalance,
    };
  }
  return toSnapshot(row);
}

/**
 * Дебетует репутацию владельца модели по принятой (staff-resolved, decision='accepted')
 * жалобе на модель (MF-1788, models/report.ts + models/reportResolve.ts). Append-only:
 * вставляет строку в uploader_reputation_ledger, НЕ мутирует user_uploader_reputation —
 * trustScore/trusted_uploader пересчитываются на чтении (getUploaderReputation) из суммы
 * ledger.delta. Идемпотентность "не задебетовать дважды за одно и то же решение" —
 * ответственность вызывающей стороны (models/reportResolve.ts проверяет reports.resolved_at
 * в транзакции до вызова); эта функция сама по себе НЕ идемпотентна и может быть вызвана
 * повторно намеренно — для компенсирующей записи-реверса (delta положительный) позже.
 */
export async function recordModelReportReputationLedgerEvent(input: RecordModelReportReputationLedgerEventInput): Promise<UploaderReputationSnapshot> {
  const delta = input.delta ?? MODEL_REPORT_ACCEPTED_LEDGER_DELTA;
  await pool.query(
    `insert into uploader_reputation_ledger (user_id, report_id, staff_actor_id, delta, reason)
     values ($1, $2, $3, $4, $5)`,
    [input.ownerId, input.reportId, input.staffActorId, delta, input.reason],
  );
  return getUploaderReputation(input.ownerId);
}
