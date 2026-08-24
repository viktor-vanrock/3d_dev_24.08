"""One-shot revision-aware preview backfill for ready model revisions.

The backfill reads canonical assets through ``model_revision_files`` and writes
only immutable ``model_id/revision_id`` preview keys. It intentionally does not
fall back to the removed ``models.status``/``model_files`` contract.
"""

from __future__ import annotations

import argparse
import logging
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import psycopg

from .config import load_s3_config, load_worker_config
from .conversion_queue import (
    MeshConversionPayload,
    publish_revision_assets,
)
from .revision_worker import generate_revision_previews
from .storage import ObjectStore

logger = logging.getLogger("mesh.backfill")


@dataclass(frozen=True, slots=True)
class BackfillTarget:
    revision_id: str
    model_id: str
    owner_id: str
    canonical_s3_key: str


@dataclass(frozen=True, slots=True)
class BackfillCounters:
    ready_total: int
    needed: int
    processed: int
    failed: int


def select_incomplete_revisions(
    conn: psycopg.Connection[Any],
    *,
    mobile_preview_stale_before: datetime | None = None,
) -> list[BackfillTarget]:
    """Return ready revisions missing a preview asset or carrying a stale mobile preview."""

    with conn.cursor() as cursor:
        cursor.execute(
            """
            select revisions.id::text, revisions.model_id::text, projects.owner_id::text,
                   canonical_blob.s3_key
              from model_revisions revisions
              join models on models.id = revisions.model_id
              join projects on projects.id = models.project_id
              join model_revision_files canonical_file
                on canonical_file.model_revision_id = revisions.id
               and canonical_file.role = 'canonical_3mf'
              join storage_blobs canonical_blob on canonical_blob.id = canonical_file.blob_id
         left join model_revision_files preview
                on preview.model_revision_id = revisions.id and preview.role = 'preview'
         left join model_revision_files thumbnail
                on thumbnail.model_revision_id = revisions.id and thumbnail.role = 'thumbnail'
         left join model_revision_files mobile
                on mobile.model_revision_id = revisions.id and mobile.role = 'mobile_preview'
             where revisions.status = 'ready'
               and canonical_blob.state = 'ready'
               and (
                 preview.id is null
                 or thumbnail.id is null
                 or mobile.id is null
                 or (
                   %(stale_before)s::timestamptz is not null
                   and mobile.created_at < %(stale_before)s::timestamptz
                 )
               )
             order by revisions.created_at, revisions.id
            """,
            {"stale_before": mobile_preview_stale_before},
        )
        rows = cursor.fetchall()
    return [BackfillTarget(*(str(value) for value in row)) for row in rows]


def _count_ready(conn: psycopg.Connection[Any]) -> int:
    with conn.cursor() as cursor:
        cursor.execute("select count(*) from model_revisions where status = 'ready'")
        row = cursor.fetchone()
    return int(row[0]) if row else 0


def _backfill_one(
    conn: psycopg.Connection[Any],
    store: ObjectStore,
    target: BackfillTarget,
) -> None:
    with tempfile.TemporaryDirectory(prefix=f"mesh-backfill-{target.revision_id}-") as tmp:
        directory = Path(tmp)
        canonical = directory / "canonical_3mf.3mf"
        store.download(target.canonical_s3_key, canonical)
        payload = MeshConversionPayload(
            revision_id=target.revision_id,
            model_id=target.model_id,
            owner_id=target.owner_id,
            source_format="3mf",
            source_s3_key=target.canonical_s3_key,
            source_filename="canonical_3mf.3mf",
            source_mime_type="model/3mf",
        )
        assets = generate_revision_previews(store, payload, canonical, directory)
        with conn.transaction():
            publish_revision_assets(
                conn,
                revision_id=target.revision_id,
                owner_id=target.owner_id,
                assets=assets,
            )


def run_backfill(
    conn: psycopg.Connection[Any],
    store: ObjectStore,
    *,
    dry_run: bool,
    mobile_preview_stale_before: datetime | None = None,
) -> BackfillCounters:
    ready_total = _count_ready(conn)
    targets = select_incomplete_revisions(
        conn,
        mobile_preview_stale_before=mobile_preview_stale_before,
    )
    logger.info(
        "preview backfill: ready revisions=%d incomplete=%d%s",
        ready_total,
        len(targets),
        " (dry-run)" if dry_run else "",
    )

    processed = 0
    failed = 0
    for target in targets:
        if dry_run:
            logger.info("revision %s will be processed (dry-run)", target.revision_id)
            continue
        try:
            _backfill_one(conn, store, target)
            processed += 1
        except Exception as error:  # noqa: BLE001 - one corrupt revision must not stop the run
            failed += 1
            logger.exception("revision %s preview backfill failed: %s", target.revision_id, error)

    return BackfillCounters(
        ready_total=ready_total,
        needed=len(targets),
        processed=processed,
        failed=failed,
    )


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    parser = argparse.ArgumentParser(
        description="Backfill revision-scoped previews for ready model revisions."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List revisions without downloading, uploading, or writing database rows.",
    )
    parser.add_argument(
        "--mobile-preview-stale-before",
        metavar="ISO8601",
        help="Regenerate mobile previews older than this ISO-8601 timestamp.",
    )
    args = parser.parse_args()

    stale_before = (
        datetime.fromisoformat(args.mobile_preview_stale_before)
        if args.mobile_preview_stale_before
        else None
    )
    worker_config = load_worker_config()
    s3_config = load_s3_config()
    if worker_config is None or s3_config is None:
        logger.error(
            "missing configuration: DATABASE_URL and S3 endpoint/access credentials are required"
        )
        return 2

    store = ObjectStore(s3_config)
    with psycopg.connect(worker_config.database_url, autocommit=True) as connection:
        counters = run_backfill(
            connection,
            store,
            dry_run=args.dry_run,
            mobile_preview_stale_before=stale_before,
        )

    logger.info(
        "backfill result: ready=%d needed=%d processed=%d failed=%d",
        counters.ready_total,
        counters.needed,
        counters.processed,
        counters.failed,
    )
    return 1 if counters.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
