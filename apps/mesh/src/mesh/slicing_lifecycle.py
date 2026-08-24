from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import psycopg
from portal_queue_lifecycle import (
    Acquisition,
    ClaimedJob,
    ClaimToken,
    MutationOutcome,
    Outcome,
    QueueSnapshot,
)
from psycopg.types.json import Jsonb

from .conversion_queue import PsycopgTransactionManager
from .slice_trust import SignedSliceTrust
from .slicing_queue import (
    _assert_cache_entry_material_compatible,
    _record_cache_entry_and_hit,
    _touch_cache_entry,
)


@dataclass(frozen=True, slots=True)
class SliceJobPayload:
    job_id: str
    model_id: str
    profile_id: str
    filament_profile_id: str | None
    scale: float
    requested_by: str | None
    slice_trust_contract_version: str | None
    slice_trust_material: dict[str, object] | None
    slice_trust_key_id: str | None
    slice_trust_signature: str | None
    layout: dict[str, object] | None
    intent: dict[str, object] | None


@dataclass(frozen=True, slots=True)
class SliceJobSuccess:
    gcode_s3_key: str
    size_bytes: int
    slice_key: bytes
    metrics: dict[str, object]
    signed_trust: SignedSliceTrust
    preview_manifest_s3_key: str | None
    requested_by: str
    model_id: str
    cache_hit: bool


@dataclass(frozen=True, slots=True)
class SliceJobFailure:
    error: str
    error_code: str | None
    retryable: bool


class SliceJobRepository:
    def __init__(self, *, max_attempts: int) -> None:
        if max_attempts < 1:
            raise ValueError("max_attempts must be positive")
        self._max_attempts = max_attempts

    def claim(
        self,
        transaction: psycopg.Connection[Any],
        owner_id: str,
        lease_seconds: int,
    ) -> ClaimedJob[SliceJobPayload] | None:
        with transaction.cursor() as cursor:
            cursor.execute(_ACQUIRE_SQL, (owner_id, lease_seconds))
            row = cursor.fetchone()
        return None if row is None else _claimed_job(row, owner_id)

    def reclaim_expired(
        self,
        transaction: psycopg.Connection[Any],
        owner_id: str,
        lease_seconds: int,
    ) -> Acquisition[SliceJobPayload]:
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                with candidate as (
                  select id from slice_jobs
                   where status = 'processing' and lease_expires_at < clock_timestamp()
                   order by lease_expires_at, id
                     for update skip locked
                   limit 1
                ), updated as (
                  update slice_jobs jobs
                     set status = case when lifecycle_attempts >= %s then 'failed'
                                       else 'processing' end,
                         error = case when lifecycle_attempts >= %s
                                      then 'slice lifecycle attempts exhausted' else error end,
                         error_code = case when lifecycle_attempts >= %s
                                           then 'attempts_exhausted' else error_code end,
                         retryable = case when lifecycle_attempts >= %s
                                          then false else retryable end,
                         leased_by = case when lifecycle_attempts >= %s then null else %s end,
                         lease_expires_at = case when lifecycle_attempts >= %s then null else
                           clock_timestamp() + interval '1 second' * %s end,
                         lease_generation = case when lifecycle_attempts >= %s
                           then lease_generation else lease_generation + 1 end,
                         lifecycle_attempts = case when lifecycle_attempts >= %s
                           then lifecycle_attempts else lifecycle_attempts + 1 end,
                         updated_at = clock_timestamp()
                    from candidate
                   where jobs.id = candidate.id
                   returning jobs.*
                )
                select status, id::text, model_id::text, profile_id::text,
                       filament_profile_id::text, scale, requested_by::text,
                       slice_trust_contract_version, slice_trust_material,
                       slice_trust_key_id, slice_trust_signature, layout, intent,
                       lifecycle_attempts, lease_expires_at, lease_generation
                  from updated
                """,
                (
                    self._max_attempts,
                    self._max_attempts,
                    self._max_attempts,
                    self._max_attempts,
                    self._max_attempts,
                    owner_id,
                    self._max_attempts,
                    lease_seconds,
                    self._max_attempts,
                    self._max_attempts,
                ),
            )
            row = cursor.fetchone()
        if row is None:
            return Acquisition(Outcome.EMPTY)
        if row[0] == "failed":
            return Acquisition(Outcome.EXHAUSTED)
        return Acquisition(Outcome.APPLIED, _claimed_job(row[1:], owner_id))

    def heartbeat(
        self,
        transaction: psycopg.Connection[Any],
        token: ClaimToken,
        lease_seconds: int,
    ) -> MutationOutcome:
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                update slice_jobs
                   set lease_expires_at = clock_timestamp() + interval '1 second' * %s,
                       updated_at = clock_timestamp()
                 where id = %s::uuid and status = 'processing' and leased_by = %s
                   and lease_generation = %s and lease_expires_at > clock_timestamp()
                """,
                (lease_seconds, token.job_id, token.owner_id, token.lease_generation),
            )
            return Outcome.APPLIED if cursor.rowcount == 1 else Outcome.STALE

    def succeed(
        self,
        transaction: psycopg.Connection[Any],
        token: ClaimToken,
        result: SliceJobSuccess,
    ) -> MutationOutcome:
        if not self._lock_fence(transaction, token):
            return Outcome.STALE
        if result.cache_hit:
            _touch_cache_entry(transaction, result.slice_key, result.requested_by, commit=False)
        else:
            _assert_cache_entry_material_compatible(
                transaction,
                result.slice_key,
                result.requested_by,
                result.signed_trust,
            )
            _record_cache_entry_and_hit(
                transaction,
                result.slice_key,
                result.gcode_s3_key,
                result.size_bytes,
                result.metrics,
                token.job_id,
                result.requested_by,
                result.model_id,
                result.signed_trust,
                commit=False,
            )
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                update slice_jobs
                   set status = 'ready', gcode_s3_key = %s, slice_key = %s, metrics = %s,
                       slice_trust_contract_version = %s, slice_trust_material = %s,
                       slice_trust_key_id = %s, slice_trust_signature = %s,
                       preview_manifest_s3_key = %s, error = null, error_code = null,
                       retryable = false, leased_by = null, lease_expires_at = null,
                       updated_at = clock_timestamp()
                 where id = %s::uuid and status = 'processing' and leased_by = %s
                   and lease_generation = %s and lease_expires_at > clock_timestamp()
                """,
                (
                    result.gcode_s3_key,
                    result.slice_key,
                    Jsonb(result.metrics),
                    result.signed_trust.material["contract_version"],
                    Jsonb(result.signed_trust.material),
                    result.signed_trust.key_id,
                    result.signed_trust.signature,
                    result.preview_manifest_s3_key,
                    token.job_id,
                    token.owner_id,
                    token.lease_generation,
                ),
            )
            return Outcome.APPLIED if cursor.rowcount == 1 else Outcome.STALE

    def fail(
        self,
        transaction: psycopg.Connection[Any],
        token: ClaimToken,
        failure: SliceJobFailure,
    ) -> MutationOutcome:
        if not self._lock_fence(transaction, token):
            return Outcome.STALE
        retry = failure.retryable and self._attempts(transaction, token.job_id) < self._max_attempts
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                update slice_jobs
                   set status = %s, error = %s, error_code = %s, retryable = %s,
                       leased_by = null, lease_expires_at = null, updated_at = clock_timestamp()
                 where id = %s::uuid and status = 'processing' and leased_by = %s
                   and lease_generation = %s
                """,
                (
                    "pending" if retry else "failed",
                    failure.error,
                    failure.error_code,
                    retry,
                    token.job_id,
                    token.owner_id,
                    token.lease_generation,
                ),
            )
            return Outcome.APPLIED if cursor.rowcount == 1 else Outcome.STALE

    def snapshot(self, transaction: psycopg.Connection[Any]) -> QueueSnapshot:
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                select count(*) filter (where status = 'pending'),
                       coalesce(extract(epoch from clock_timestamp() -
                         (min(created_at) filter (where status = 'pending'))), 0),
                       count(*) filter (
                         where status = 'processing' and lease_expires_at < clock_timestamp()
                       )
                  from slice_jobs
                """
            )
            row = cursor.fetchone()
        return QueueSnapshot(int(row[0]), float(row[1]), int(row[2]))

    @staticmethod
    def _lock_fence(transaction: psycopg.Connection[Any], token: ClaimToken) -> bool:
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                select 1 from slice_jobs
                 where id = %s::uuid and status = 'processing' and leased_by = %s
                   and lease_generation = %s and lease_expires_at > clock_timestamp()
                 for update
                """,
                (token.job_id, token.owner_id, token.lease_generation),
            )
            return cursor.fetchone() is not None

    @staticmethod
    def _attempts(transaction: psycopg.Connection[Any], job_id: str) -> int:
        with transaction.cursor() as cursor:
            cursor.execute(
                "select lifecycle_attempts from slice_jobs where id = %s::uuid",
                (job_id,),
            )
            return int(cursor.fetchone()[0])


_ACQUIRE_SQL = """
with candidate as (
  select id from slice_jobs
   where status = 'pending'
   order by created_at, id
     for update skip locked
   limit 1
), updated as (
  update slice_jobs jobs
     set status = 'processing', leased_by = %s,
         lease_expires_at = clock_timestamp() + interval '1 second' * %s,
         lease_generation = lease_generation + 1,
         lifecycle_attempts = lifecycle_attempts + 1,
         updated_at = clock_timestamp()
    from candidate
   where jobs.id = candidate.id
   returning jobs.*
)
select id::text, model_id::text, profile_id::text, filament_profile_id::text,
       scale, requested_by::text, slice_trust_contract_version, slice_trust_material,
       slice_trust_key_id, slice_trust_signature, layout, intent,
       lifecycle_attempts, lease_expires_at, lease_generation
  from updated
"""


def _claimed_job(row: tuple[object, ...], owner_id: str) -> ClaimedJob[SliceJobPayload]:
    (
        job_id,
        model_id,
        profile_id,
        filament_profile_id,
        scale,
        requested_by,
        contract_version,
        trust_material,
        trust_key_id,
        trust_signature,
        layout,
        intent,
        attempts,
        lease_expires_at,
        lease_generation,
    ) = row
    job_id = str(job_id)
    return ClaimedJob(
        token=ClaimToken(job_id, owner_id, int(lease_generation)),
        payload=SliceJobPayload(
            job_id=job_id,
            model_id=str(model_id),
            profile_id=str(profile_id),
            filament_profile_id=None if filament_profile_id is None else str(filament_profile_id),
            scale=float(scale),
            requested_by=None if requested_by is None else str(requested_by),
            slice_trust_contract_version=(
                None if contract_version is None else str(contract_version)
            ),
            slice_trust_material=trust_material if isinstance(trust_material, dict) else None,
            slice_trust_key_id=None if trust_key_id is None else str(trust_key_id),
            slice_trust_signature=None if trust_signature is None else str(trust_signature),
            layout=layout if isinstance(layout, dict) else None,
            intent=intent if isinstance(intent, dict) else None,
        ),
        attempts=int(attempts),
        lease_expires_at=lease_expires_at
        if isinstance(lease_expires_at, datetime)
        else datetime.fromisoformat(str(lease_expires_at)),
    )


__all__ = [
    "PsycopgTransactionManager",
    "SliceJobFailure",
    "SliceJobPayload",
    "SliceJobRepository",
    "SliceJobSuccess",
]
