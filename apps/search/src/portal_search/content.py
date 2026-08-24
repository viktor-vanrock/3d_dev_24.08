"""Read immutable published Project content for Search indexing.

``search_index_jobs.model_id`` is the historical column name for a Project id.
Public text and geometry therefore resolve through the current publication snapshot:
``projects.published_revision_id`` -> ``project_revisions`` ->
``project_revision_models`` -> revision-scoped files and ready storage blobs.
Draft rows and removed legacy ``models.status``/``model_files`` are never consulted.
"""

from __future__ import annotations

import io
from typing import Protocol

import psycopg

from .config import S3Config
from .index_text import build_model_index_text
from .worker import ModelGeometry

_GEOMETRY_ROLE = "canonical_3mf"


class S3Downloader(Protocol):
    def download_fileobj(self, bucket: str, key: str, fileobj) -> None: ...


def build_s3_client(config: S3Config) -> S3Downloader:
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=config.endpoint,
        region_name=config.region,
        aws_access_key_id=config.access_key,
        aws_secret_access_key=config.secret_key,
    )


class PostgresModelContentProvider:
    """Model content reader against the Project API v1 baseline."""

    def __init__(self, conn: psycopg.Connection, s3_client: S3Downloader, bucket: str):
        self._conn = conn
        self._s3 = s3_client
        self._bucket = bucket

    def get_text_document(self, model_id: str) -> str | None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                select pr.metadata_snapshot->>'title',
                       pr.metadata_snapshot->>'description',
                       coalesce(pr.metadata_snapshot->'tags', '[]'::jsonb)
                  from projects p
                  join project_revisions pr
                    on pr.id=p.published_revision_id and pr.project_id=p.id
                 where p.id=%s and p.deleted_at is null
                """,
                (model_id,),
            )
            row = cur.fetchone()
        if row is None:
            return None

        title, description, raw_tags = row
        tags = sorted(str(tag) for tag in raw_tags if isinstance(tag, str))
        text = build_model_index_text(title, description, tags)
        return text or None

    def get_geometry(self, model_id: str) -> ModelGeometry | None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                select b.s3_key
                  from projects p
                  join project_revisions pr
                    on pr.id=p.published_revision_id and pr.project_id=p.id
                  join project_revision_models prm
                    on prm.project_revision_id=pr.id and prm.project_id=p.id
                   and prm.model_id=pr.primary_model_id
                  join model_revision_files f
                    on f.model_revision_id=prm.model_revision_id and f.role=%s
                  join storage_blobs b on b.id=f.blob_id and b.state='ready'
                 where p.id=%s and p.deleted_at is null
                 order by f.id
                 limit 1
                """,
                (_GEOMETRY_ROLE, model_id),
            )
            row = cur.fetchone()
        if row is None or not row[0]:
            return None

        key = row[0]
        buffer = io.BytesIO()
        self._s3.download_fileobj(self._bucket, key, buffer)
        file_hint = key.rsplit(".", 1)[-1] if "." in key else "3mf"
        return ModelGeometry(data=buffer.getvalue(), file_hint=file_hint)
