from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest

from scout.news.provision import PUBLISHER_USERNAME, provision_key, revoke_keys

USER_ID = "4d1d4d59-ce79-4a11-a088-c9d3781a3de3"
COMMUNITY_IDS = {
    "bambu-lab": "1d1d4d59-ce79-4a11-a088-c9d3781a3de3",
    "ultimaker": "2d1d4d59-ce79-4a11-a088-c9d3781a3de3",
}


def _community_config(path: Path, *, subject_type: str = "vendor") -> Path:
    path.write_text(
        json.dumps(
            {
                "schema_version": "feed-news-brands.v2",
                "brands": [
                    {
                        "community_subject_hint": {
                            "subject_type": subject_type,
                            "subject_id": None,
                            "subject_slug": slug,
                        }
                    }
                    for slug in COMMUNITY_IDS
                ],
            }
        )
    )
    return path


class _Cursor:
    def __init__(self, *, communities: dict[str, str] | None = None) -> None:
        self.executions: list[tuple[str, tuple]] = []
        self.communities = COMMUNITY_IDS if communities is None else communities
        self._one = None
        self._all: list[tuple] = []
        self.rowcount = 2

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, query: str, params: tuple) -> None:
        self.executions.append((query, params))
        self._one = None
        self._all = []
        if "select id from communities" in query:
            community_id = self.communities.get(str(params[2]))
            self._all = [(community_id,)] if community_id else []
        elif "insert into users" in query:
            self._one = (USER_ID, "active")
        elif "select id from user_api_keys" in query:
            self._one = None
        elif "insert into user_api_keys" in query:
            self._one = ("new-key-id",)

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._all


class _Connection:
    def __init__(self, cursor: _Cursor, fail_commit: bool = False) -> None:
        self._cursor = cursor
        self._fail_commit = fail_commit

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        if exc_type is None and self._fail_commit:
            raise RuntimeError("commit failed")
        return False

    def cursor(self) -> _Cursor:
        return self._cursor


def test_provision_ensures_dedicated_owner_acl_and_writes_only_hash(tmp_path: Path):
    cursor = _Cursor()
    env_file = tmp_path / "publisher.env"

    user_id, key_id, community_count = provision_key(
        database_url="postgresql://approved",
        username=PUBLISHER_USERNAME,
        community_config=_community_config(tmp_path / "brands.json"),
        environment_file=env_file,
        api_base_url="https://api.dev.3mf.tech",
        public_base_url="https://dev.3mf.tech",
        uid=os.getuid(),
        gid=os.getgid(),
        connect=lambda _: _Connection(cursor),
    )

    assert (user_id, key_id, community_count) == (USER_ID, "new-key-id", 2)
    assert env_file.stat().st_mode & 0o777 == 0o600
    values = dict(line.split("=", 1) for line in env_file.read_text().splitlines())
    secret = values["SCOUT_NEWS_FEED_INGEST_KEY"]
    assert secret.startswith("mf_feedingest_")
    insert_params = next(
        params for query, params in cursor.executions if "insert into user_api_keys" in query
    )
    assert insert_params[2] == hashlib.sha256(secret.encode()).digest()
    assert secret not in repr(cursor.executions)
    assert values["SCOUT_NEWS_FEED_API_BASE_URL"] == "https://api.dev.3mf.tech"

    queries = [query for query, _ in cursor.executions]
    assert any(
        "insert into users" in query and "on conflict (username)" in query for query in queries
    )
    assert any("delete from community_members" in query for query in queries)
    owner_upserts = [
        (query, params)
        for query, params in cursor.executions
        if "insert into community_members" in query
    ]
    assert len(owner_upserts) == 2
    assert all("'owner'" in query and params[1] == USER_ID for query, params in owner_upserts)
    assert {params[0] for _, params in owner_upserts} == set(COMMUNITY_IDS.values())
    resolution_queries = [query for query in queries if "select id from communities" in query]
    assert all(
        "status = 'active'" in query and "kind = subject_type" in query
        for query in resolution_queries
    )


def test_unresolved_official_community_aborts_before_key_or_env(tmp_path: Path):
    cursor = _Cursor(communities={"bambu-lab": COMMUNITY_IDS["bambu-lab"]})
    env_file = tmp_path / "publisher.env"

    with pytest.raises(ValueError, match="did not resolve exactly once"):
        provision_key(
            database_url="postgresql://approved",
            username=PUBLISHER_USERNAME,
            community_config=_community_config(tmp_path / "brands.json"),
            environment_file=env_file,
            api_base_url="https://api.dev.3mf.tech",
            public_base_url="https://dev.3mf.tech",
            uid=os.getuid(),
            gid=os.getgid(),
            connect=lambda _: _Connection(cursor),
        )

    assert not env_file.exists()
    assert not any("user_api_keys" in query for query, _ in cursor.executions)
    assert not any("community_members" in query for query, _ in cursor.executions)


def test_non_catalog_target_is_rejected_before_database_mutation(tmp_path: Path):
    cursor = _Cursor()

    with pytest.raises(ValueError, match="vendor or machine"):
        provision_key(
            database_url="postgresql://approved",
            username=PUBLISHER_USERNAME,
            community_config=_community_config(tmp_path / "brands.json", subject_type="custom"),
            environment_file=tmp_path / "publisher.env",
            api_base_url="https://api.dev.3mf.tech",
            public_base_url="https://dev.3mf.tech",
            uid=os.getuid(),
            gid=os.getgid(),
            connect=lambda _: _Connection(cursor),
        )

    assert cursor.executions == []


def test_failed_commit_restores_previous_environment_file(tmp_path: Path):
    cursor = _Cursor()
    env_file = tmp_path / "publisher.env"
    env_file.write_text("SCOUT_NEWS_FEED_INGEST_KEY=old-protected-value\n")
    os.chmod(env_file, 0o600)

    with pytest.raises(RuntimeError, match="commit failed"):
        provision_key(
            database_url="postgresql://approved",
            username=PUBLISHER_USERNAME,
            community_config=_community_config(tmp_path / "brands.json"),
            environment_file=env_file,
            api_base_url="https://api.dev.3mf.tech",
            public_base_url="https://dev.3mf.tech",
            uid=os.getuid(),
            gid=os.getgid(),
            connect=lambda _: _Connection(cursor, fail_commit=True),
        )

    assert env_file.read_text() == "SCOUT_NEWS_FEED_INGEST_KEY=old-protected-value\n"
    assert env_file.stat().st_mode & 0o777 == 0o600


def test_revoke_removes_environment_file_after_db_update(tmp_path: Path):
    cursor = _Cursor()
    env_file = tmp_path / "publisher.env"
    env_file.write_text("dead secret")

    count = revoke_keys(
        database_url="postgresql://approved",
        user_id=USER_ID,
        environment_file=env_file,
        connect=lambda _: _Connection(cursor),
    )

    assert count == 2
    assert not env_file.exists()
    assert "scope = 'feed_ingest'" in cursor.executions[0][0]
