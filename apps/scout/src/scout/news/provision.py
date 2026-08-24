"""Provision the host-only feed_ingest credential without printing plaintext."""

from __future__ import annotations

import argparse
import grp
import hashlib
import json
import os
import pwd
import secrets
import uuid
from pathlib import Path
from typing import Any

import psycopg

KEY_PREFIX = "mf_feedingest_"
PUBLISHER_USERNAME = "scout-news-publisher"
_PACKAGE = Path(__file__).resolve().parent


def _official_community_hints(path: Path | None = None) -> list[tuple[str, str, str]]:
    payload: dict[str, Any] = json.loads((path or (_PACKAGE / "brands.v2.json")).read_text())
    if payload.get("schema_version") != "feed-news-brands.v2":
        raise ValueError("publisher community config must use feed-news-brands.v2")
    hints: list[tuple[str, str, str]] = []
    for brand in payload.get("brands", []):
        hint = brand.get("community_subject_hint") or {}
        subject_type = hint.get("subject_type")
        subject_id = hint.get("subject_id")
        subject_slug = hint.get("subject_slug")
        if subject_type not in {"vendor", "machine"}:
            raise ValueError("publisher targets must be vendor or machine communities")
        if bool(subject_id) == bool(subject_slug):
            raise ValueError("publisher target must have exactly one subject id or slug")
        hints.append(
            (subject_type, "subject_id" if subject_id else "slug", subject_id or subject_slug)
        )
    if not hints or len(set(hints)) != len(hints):
        raise ValueError("publisher community targets must be non-empty and unique")
    return hints


def _ensure_publisher_acl(
    cursor: Any,
    *,
    username: str,
    community_config: Path | None,
) -> tuple[str, list[str]]:
    hints = _official_community_hints(community_config)
    community_ids: list[str] = []
    for subject_type, lookup, value in hints:
        column = "subject_id" if lookup == "subject_id" else "slug"
        cursor.execute(
            f"""select id from communities
                where status = 'active' and kind = %s and subject_type = %s
                  and kind = subject_type and {column} = %s""",
            (subject_type, subject_type, value),
        )
        matches = cursor.fetchall()
        if len(matches) != 1:
            raise ValueError("official publisher community did not resolve exactly once")
        community_ids.append(str(matches[0][0]))
    if len(set(community_ids)) != len(community_ids):
        raise ValueError("publisher community hints resolve to duplicate communities")

    cursor.execute(
        """insert into users (username, display_name, handle_confirmed)
           values (%s, 'Scout News Publisher', true)
           on conflict (username) do update set username = excluded.username
           returning id, status""",
        (username,),
    )
    user_id, status = cursor.fetchone()
    if status != "active":
        raise ValueError("publisher service user is not active")
    user_id = str(user_id)
    cursor.execute(
        """delete from community_members
           where user_id = %s and not (community_id = any(%s::uuid[]))""",
        (user_id, community_ids),
    )
    for community_id in community_ids:
        cursor.execute(
            """insert into community_members (community_id, user_id, role, source)
               values (%s, %s, 'owner', 'manual')
               on conflict (community_id, user_id) do update
               set role = 'owner', source = 'manual'""",
            (community_id, user_id),
        )
    return user_id, community_ids


def _safe_environment_value(value: str, label: str) -> str:
    if not value or any(character.isspace() for character in value):
        raise ValueError(f"{label} must be a non-empty value without whitespace")
    return value


def _environment_bytes(secret: str, api_base_url: str, public_base_url: str) -> bytes:
    return (
        f"SCOUT_NEWS_FEED_INGEST_KEY={secret}\n"
        f"SCOUT_NEWS_FEED_API_BASE_URL={_safe_environment_value(api_base_url, 'API URL')}\n"
        f"SCOUT_NEWS_PUBLIC_BASE_URL={_safe_environment_value(public_base_url, 'public URL')}\n"
    ).encode()


def _write_protected(path: Path, content: bytes, uid: int, gid: int) -> None:
    path.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.next")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chown(temporary, uid, gid)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def provision_key(
    *,
    database_url: str,
    username: str,
    environment_file: Path,
    api_base_url: str,
    public_base_url: str,
    uid: int,
    gid: int,
    community_config: Path | None = None,
    connect=psycopg.connect,
) -> tuple[str, str, int]:
    """Rotate the DB hash and protected env file as one best-effort transaction."""
    if username != PUBLISHER_USERNAME:
        raise ValueError("publisher username must identify the dedicated host principal")
    previous = environment_file.read_bytes() if environment_file.exists() else None
    secret = f"{KEY_PREFIX}{secrets.token_urlsafe(32)}"
    key_hash = hashlib.sha256(secret.encode()).digest()
    key_prefix = secret[:20]
    key_id = ""
    try:
        with connect(database_url) as connection:
            with connection.cursor() as cursor:
                user_id, community_ids = _ensure_publisher_acl(
                    cursor,
                    username=username,
                    community_config=community_config,
                )
                cursor.execute(
                    """select id from user_api_keys
                       where user_id = %s and scope = 'feed_ingest' and status = 'active'
                       order by created_at desc limit 1""",
                    (user_id,),
                )
                previous_key = cursor.fetchone()
                cursor.execute(
                    """insert into user_api_keys (
                           user_id, scope, scopes, label, key_prefix, key_hash, rotated_from_id
                       ) values (%s, 'feed_ingest', array['write']::text[],
                                 'scout-news-publisher', %s, %s, %s)
                       returning id""",
                    (user_id, key_prefix, key_hash, previous_key[0] if previous_key else None),
                )
                key_id = str(cursor.fetchone()[0])
                cursor.execute(
                    """update user_api_keys
                       set status = 'revoked', revoked_at = now(), updated_at = now(),
                           revoked_reason = 'rotated by scout news deploy'
                       where user_id = %s and scope = 'feed_ingest' and status = 'active'
                         and id <> %s""",
                    (user_id, key_id),
                )
                _write_protected(
                    environment_file,
                    _environment_bytes(secret, api_base_url, public_base_url),
                    uid,
                    gid,
                )
    except Exception:
        if previous is None:
            environment_file.unlink(missing_ok=True)
        else:
            _write_protected(environment_file, previous, uid, gid)
        raise
    return user_id, key_id, len(community_ids)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--username", default=PUBLISHER_USERNAME)
    parser.add_argument("--community-config", type=Path)
    parser.add_argument(
        "--environment-file",
        type=Path,
        default=Path("/etc/portal/scout-news-publisher.env"),
    )
    parser.add_argument("--owner", default="plag")
    parser.add_argument("--group", default="plag")
    parser.add_argument("--api-base-url", default="https://api.dev.3mf.tech")
    parser.add_argument("--public-base-url", default="https://dev.3mf.tech")
    return parser


def revoke_keys(
    *,
    database_url: str,
    user_id: str,
    environment_file: Path,
    connect=psycopg.connect,
) -> int:
    """Revoke publisher keys and remove the now-dead plaintext EnvironmentFile."""
    uuid.UUID(user_id)
    with connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """update user_api_keys
                   set status = 'revoked', revoked_at = now(), updated_at = now(),
                       revoked_reason = 'scout news deploy rollback'
                   where user_id = %s and scope = 'feed_ingest' and status = 'active'""",
                (user_id,),
            )
            count = cursor.rowcount
    environment_file.unlink(missing_ok=True)
    return count


def main() -> None:
    args = build_parser().parse_args()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL must be supplied by the approved deploy environment")
    try:
        user_id, key_id, community_count = provision_key(
            database_url=database_url,
            username=args.username,
            environment_file=args.environment_file,
            api_base_url=args.api_base_url,
            public_base_url=args.public_base_url,
            uid=pwd.getpwnam(args.owner).pw_uid,
            gid=grp.getgrnam(args.group).gr_gid,
            community_config=args.community_config,
        )
    except Exception as exc:
        raise SystemExit(f"provision failed: {type(exc).__name__}") from None
    print(
        json.dumps(
            {
                "status": "provisioned",
                "user_id": user_id,
                "key_id": key_id,
                "owner_communities": community_count,
                "plaintext_logged": False,
            }
        )
    )


def revoke_main() -> None:
    parser = argparse.ArgumentParser(description="Revoke the scout news publisher credential")
    parser.add_argument("--user-id", required=True, help="existing service user UUID")
    parser.add_argument(
        "--environment-file",
        type=Path,
        default=Path("/etc/portal/scout-news-publisher.env"),
    )
    args = parser.parse_args()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL must be supplied by the approved deploy environment")
    try:
        count = revoke_keys(
            database_url=database_url,
            user_id=args.user_id,
            environment_file=args.environment_file,
        )
    except Exception as exc:
        raise SystemExit(f"revoke failed: {type(exc).__name__}") from None
    print(json.dumps({"status": "revoked", "revoked_keys": count, "plaintext_logged": False}))


if __name__ == "__main__":
    main()
