from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

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

_EVENT_TYPE = "model.revision.uploaded.v1"
_AGGREGATE_TYPE = "ModelRevision"


class PromotionOutcome(StrEnum):
    EMPTY = "empty"
    PROMOTED = "promoted"
    REPLAYED = "replayed"
    INVALID = "invalid"


@dataclass(frozen=True, slots=True)
class PromotionResult:
    outcome: PromotionOutcome
    event_id: str | None = None
    revision_id: str | None = None


@dataclass(frozen=True, slots=True)
class MeshConversionPayload:
    revision_id: str
    model_id: str
    owner_id: str
    source_format: str
    source_s3_key: str | None
    source_filename: str | None
    source_mime_type: str | None


@dataclass(frozen=True, slots=True)
class MeshAssetPublication:
    role: str
    s3_key: str
    size_bytes: int
    checksum: bytes
    mime_type: str
    original_filename: str | None = None


@dataclass(frozen=True, slots=True)
class MeshConversionSuccess:
    bbox: dict[str, object]
    assets: tuple[MeshAssetPublication, ...]


@dataclass(frozen=True, slots=True)
class MeshConversionFailure:
    code: str
    detail_safe: str
    retryable: bool


class PsycopgTransactionManager:
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    @contextmanager
    def transaction(self) -> Generator[psycopg.Connection[Any]]:
        with psycopg.connect(self._database_url) as connection:
            with connection.transaction():
                yield connection


class MeshConversionRepository:
    def __init__(self, *, max_attempts: int) -> None:
        if max_attempts < 1:
            raise ValueError("max_attempts must be positive")
        self._max_attempts = max_attempts

    def claim(
        self,
        transaction: psycopg.Connection[Any],
        owner_id: str,
        lease_seconds: int,
    ) -> ClaimedJob[MeshConversionPayload] | None:
        with transaction.cursor() as cursor:
            cursor.execute(
                _ACQUIRE_SQL.format(candidate="status = 'pending'", exhausted="false"),
                (owner_id, lease_seconds),
            )
            row = cursor.fetchone()
        return None if row is None else _claimed_job(row, owner_id)

    def reclaim_expired(
        self,
        transaction: psycopg.Connection[Any],
        owner_id: str,
        lease_seconds: int,
    ) -> Acquisition[MeshConversionPayload]:
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                with candidate as (
                  select id
                    from model_revisions
                   where status = 'processing'
                     and lease_expires_at < clock_timestamp()
                   order by lease_expires_at, id
                     for update skip locked
                   limit 1
                ), updated as (
                  update model_revisions revisions
                     set status = case when attempts >= %s then 'failed' else 'processing' end,
                         leased_by = case when attempts >= %s then null else %s end,
                         lease_expires_at = case when attempts >= %s then null else
                           clock_timestamp() + interval '1 second' * %s end,
                         lease_generation = case when attempts >= %s then lease_generation
                           else lease_generation + 1 end,
                         attempts = case when attempts >= %s then attempts else attempts + 1 end,
                         failed_at = case when attempts >= %s then clock_timestamp() else null end,
                         failure_code = case when attempts >= %s then 'attempts_exhausted'
                           else failure_code end,
                         failure_detail_safe = case when attempts >= %s
                           then 'conversion attempts exhausted' else failure_detail_safe end,
                         processing_started_at = case when attempts >= %s
                           then processing_started_at else clock_timestamp() end
                    from candidate
                   where revisions.id = candidate.id
                   returning revisions.*
                )
                select updated.status, updated.id::text, updated.model_id::text,
                       projects.owner_id::text, updated.source_format, blobs.s3_key,
                       files.original_filename, files.mime_type, updated.attempts,
                       updated.lease_expires_at, updated.lease_generation
                  from updated
                  join models on models.id = updated.model_id
                  join projects on projects.id = models.project_id
             left join model_revision_files files
                    on files.model_revision_id = updated.id and files.is_source
             left join storage_blobs blobs on blobs.id = files.blob_id
                """,
                (
                    self._max_attempts,
                    self._max_attempts,
                    owner_id,
                    self._max_attempts,
                    lease_seconds,
                    self._max_attempts,
                    self._max_attempts,
                    self._max_attempts,
                    self._max_attempts,
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
                update model_revisions
                   set lease_expires_at = clock_timestamp() + interval '1 second' * %s
                 where id = %s::uuid and status = 'processing' and leased_by = %s
                   and lease_generation = %s and lease_expires_at > clock_timestamp()
                """,
                (
                    lease_seconds,
                    token.job_id,
                    token.owner_id,
                    token.lease_generation,
                ),
            )
            return Outcome.APPLIED if cursor.rowcount == 1 else Outcome.STALE

    def succeed(
        self,
        transaction: psycopg.Connection[Any],
        token: ClaimToken,
        result: MeshConversionSuccess,
    ) -> MutationOutcome:
        revision = self._lock_fence(transaction, token)
        if revision is None:
            return Outcome.STALE
        revision_id, model_id, owner_id = revision
        publish_revision_assets(
            transaction,
            revision_id=revision_id,
            owner_id=owner_id,
            assets=result.assets,
        )
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                update model_revisions
                   set status = 'ready', bbox = %s, ready_at = clock_timestamp(),
                       failed_at = null, failure_code = null, failure_detail_safe = null,
                       leased_by = null, lease_expires_at = null
                 where id = %s::uuid
                """,
                (Jsonb(result.bbox), revision_id),
            )
            cursor.execute(
                """
                update models
                   set active_revision_id = %s::uuid, version = version + 1, updated_at = now()
                 where id = %s::uuid and latest_revision_id = %s::uuid
                """,
                (revision_id, model_id, revision_id),
            )
            cursor.execute(
                """
                update model_meshes meshes
                   set status = 'ready', bbox = %s, updated_at = now()
                 where meshes.model_id = %s::uuid
                   and exists (
                     select 1 from models
                      where id = %s::uuid and latest_revision_id = %s::uuid
                   )
                """,
                (Jsonb(result.bbox), model_id, model_id, revision_id),
            )
        return Outcome.APPLIED

    def fail(
        self,
        transaction: psycopg.Connection[Any],
        token: ClaimToken,
        failure: MeshConversionFailure,
    ) -> MutationOutcome:
        revision = self._lock_fence(transaction, token)
        if revision is None:
            return Outcome.STALE
        retry = failure.retryable and self._attempts(transaction, token.job_id) < self._max_attempts
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                update model_revisions
                   set status = %s,
                       failure_code = %s,
                       failure_detail_safe = %s,
                       failed_at = case when %s then null else clock_timestamp() end,
                       ready_at = null,
                       leased_by = null,
                       lease_expires_at = null
                 where id = %s::uuid
                """,
                (
                    "pending" if retry else "failed",
                    failure.code,
                    failure.detail_safe,
                    retry,
                    token.job_id,
                ),
            )
        return Outcome.APPLIED

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
                  from model_revisions
                """
            )
            row = cursor.fetchone()
        return QueueSnapshot(int(row[0]), float(row[1]), int(row[2]))

    @staticmethod
    def _lock_fence(
        transaction: psycopg.Connection[Any], token: ClaimToken
    ) -> tuple[str, str, str] | None:
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                select revisions.id::text, revisions.model_id::text, projects.owner_id::text
                  from model_revisions revisions
                  join models on models.id = revisions.model_id
                  join projects on projects.id = models.project_id
                 where revisions.id = %s::uuid and revisions.status = 'processing'
                   and revisions.leased_by = %s and revisions.lease_generation = %s
                   and revisions.lease_expires_at > clock_timestamp()
                   for update of revisions
                """,
                (token.job_id, token.owner_id, token.lease_generation),
            )
            row = cursor.fetchone()
        if row is None:
            return None
        return str(row[0]), str(row[1]), str(row[2])

    @staticmethod
    def _attempts(transaction: psycopg.Connection[Any], revision_id: str) -> int:
        with transaction.cursor() as cursor:
            cursor.execute(
                "select attempts from model_revisions where id = %s::uuid",
                (revision_id,),
            )
            return int(cursor.fetchone()[0])


def publish_revision_assets(
    transaction: psycopg.Connection[Any],
    *,
    revision_id: str,
    owner_id: str,
    assets: tuple[MeshAssetPublication, ...],
) -> None:
    """Publish derived assets without mutating an existing deduplicated blob key."""

    with transaction.cursor() as cursor:
        for asset in assets:
            cursor.execute(
                """
                insert into storage_blobs(owner_id, checksum, size_bytes, s3_key, state)
                values (%s::uuid, %s, %s, %s, 'ready')
                on conflict (owner_id, checksum, size_bytes) do update
                  set state = 'ready', updated_at = now()
                returning id
                """,
                (owner_id, asset.checksum, asset.size_bytes, asset.s3_key),
            )
            blob_id = cursor.fetchone()[0]
            cursor.execute(
                """
                select id from model_revision_files
                 where model_revision_id = %s::uuid and role = %s
                 for update
                """,
                (revision_id, asset.role),
            )
            existing = cursor.fetchone()
            if existing is None:
                cursor.execute(
                    """
                    insert into model_revision_files
                      (model_revision_id, role, size_bytes, checksum, original_filename,
                       mime_type, blob_id, is_source)
                    values (%s::uuid, %s, %s, %s, %s, %s, %s, false)
                    """,
                    (
                        revision_id,
                        asset.role,
                        asset.size_bytes,
                        asset.checksum,
                        asset.original_filename,
                        asset.mime_type,
                        blob_id,
                    ),
                )
            else:
                cursor.execute(
                    """
                    update model_revision_files
                       set size_bytes = %s, checksum = %s, original_filename = %s,
                           mime_type = %s, blob_id = %s, is_source = false
                     where id = %s
                    """,
                    (
                        asset.size_bytes,
                        asset.checksum,
                        asset.original_filename,
                        asset.mime_type,
                        blob_id,
                        existing[0],
                    ),
                )


_ACQUIRE_SQL = """
with candidate as (
  select id
    from model_revisions
   where {candidate}
     and {exhausted} is false
   order by created_at, id
     for update skip locked
   limit 1
), updated as (
  update model_revisions revisions
     set status = 'processing', leased_by = %s,
         lease_expires_at = clock_timestamp() + interval '1 second' * %s,
         lease_generation = lease_generation + 1, attempts = attempts + 1,
         processing_started_at = clock_timestamp(), failed_at = null
    from candidate
   where revisions.id = candidate.id
   returning revisions.*
)
select updated.id::text, updated.model_id::text, projects.owner_id::text,
       updated.source_format, blobs.s3_key, files.original_filename, files.mime_type,
       updated.attempts, updated.lease_expires_at, updated.lease_generation
  from updated
  join models on models.id = updated.model_id
  join projects on projects.id = models.project_id
  left join model_revision_files files
    on files.model_revision_id = updated.id and files.is_source
  left join storage_blobs blobs on blobs.id = files.blob_id
"""


def _claimed_job(row: tuple[object, ...], owner_id: str) -> ClaimedJob[MeshConversionPayload]:
    (
        revision_id,
        model_id,
        account_id,
        source_format,
        source_s3_key,
        source_filename,
        source_mime_type,
        attempts,
        lease_expires_at,
        lease_generation,
    ) = row
    revision_id = str(revision_id)
    return ClaimedJob(
        token=ClaimToken(revision_id, owner_id, int(lease_generation)),
        payload=MeshConversionPayload(
            revision_id=revision_id,
            model_id=str(model_id),
            owner_id=str(account_id),
            source_format=str(source_format),
            source_s3_key=None if source_s3_key is None else str(source_s3_key),
            source_filename=None if source_filename is None else str(source_filename),
            source_mime_type=None if source_mime_type is None else str(source_mime_type),
        ),
        attempts=int(attempts),
        lease_expires_at=lease_expires_at
        if isinstance(lease_expires_at, datetime)
        else datetime.fromisoformat(str(lease_expires_at)),
    )


def promote_next_uploaded_revision(conn: psycopg.Connection[Any]) -> PromotionResult:
    """Atomically consume one revision-uploaded outbox event and expose it to the queue."""

    with conn.transaction():
        with conn.cursor() as cursor:
            cursor.execute(
                """
                select id::text, aggregate_id::text, event_version, payload
                  from outbox_events
                 where aggregate_type = %s
                   and event_type = %s
                   and completed_at is null
                   and locked_at is null
                   and available_at <= clock_timestamp()
                 order by available_at, created_at, id
                   for update skip locked
                 limit 1
                """,
                (_AGGREGATE_TYPE, _EVENT_TYPE),
            )
            row = cursor.fetchone()
            if row is None:
                return PromotionResult(PromotionOutcome.EMPTY)

            event_id, aggregate_id, event_version, payload = row
            validated = _validate_payload(event_version, aggregate_id, payload)
            if validated is None:
                _complete_event(cursor, event_id, "invalid_model_revision_uploaded_event")
                return PromotionResult(
                    PromotionOutcome.INVALID,
                    event_id=str(event_id),
                    revision_id=str(aggregate_id),
                )
            revision_id, model_id = validated
            cursor.execute(
                """
                update model_revisions
                   set status = 'pending'
                 where id = %s::uuid
                   and model_id = %s::uuid
                   and status = 'uploaded'
                """,
                (revision_id, model_id),
            )
            if cursor.rowcount == 1:
                outcome = PromotionOutcome.PROMOTED
                error = None
            else:
                cursor.execute(
                    """
                    select status
                      from model_revisions
                     where id = %s::uuid and model_id = %s::uuid
                    """,
                    (revision_id, model_id),
                )
                revision = cursor.fetchone()
                if revision is None:
                    outcome = PromotionOutcome.INVALID
                    error = "model_revision_uploaded_target_missing"
                else:
                    outcome = PromotionOutcome.REPLAYED
                    error = None
            _complete_event(cursor, event_id, error)
            return PromotionResult(outcome, str(event_id), revision_id)


def _validate_payload(
    event_version: object, aggregate_id: object, payload: object
) -> tuple[str, str] | None:
    if event_version != 1 or not isinstance(payload, dict):
        return None
    revision_id = payload.get("revision_id")
    model_id = payload.get("model_id")
    project_id = payload.get("project_id")
    if not all(isinstance(value, str) for value in (revision_id, model_id, project_id)):
        return None
    assert isinstance(revision_id, str)
    assert isinstance(model_id, str)
    assert isinstance(project_id, str)
    if not all(_is_uuid(value) for value in (revision_id, model_id, project_id)):
        return None
    if revision_id != str(aggregate_id):
        return None
    return revision_id, model_id


def _is_uuid(value: str) -> bool:
    try:
        return str(UUID(value)) == value.lower()
    except ValueError:
        return False


def _complete_event(
    cursor: psycopg.Cursor[Any], event_id: object, error: str | None
) -> None:
    cursor.execute(
        """
        update outbox_events
           set completed_at = clock_timestamp(),
               locked_at = null,
               locked_by = null,
               last_error_safe = %s
         where id = %s::uuid
        """,
        (error, event_id),
    )
