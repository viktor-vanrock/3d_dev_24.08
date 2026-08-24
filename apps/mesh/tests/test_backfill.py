from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

import trimesh

from mesh import backfill


class FakeCursor:
    def __init__(self, connection):
        self._connection = connection
        self._rows = []

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def execute(self, sql, params=()):
        normalized = " ".join(sql.split())
        self._connection.executed.append((normalized, params))
        if "count(*) from model_revisions where status = 'ready'" in normalized:
            self._rows = [(self._connection.ready_total,)]
            return
        if "from model_revisions revisions" not in normalized:
            self._rows = []
            return
        stale_before = params.get("stale_before") if isinstance(params, dict) else None
        targets = list(self._connection.incomplete_targets)
        for target, created_at in self._connection.stale_mobile_previews:
            if stale_before is not None and created_at < stale_before and target not in targets:
                targets.append(target)
        self._rows = [
            (
                target.revision_id,
                target.model_id,
                target.owner_id,
                target.canonical_s3_key,
            )
            for target in targets
        ]

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return self._rows


class FakeConnection:
    def __init__(self, *, ready_total=0, incomplete_targets=(), stale_mobile_previews=()):
        self.ready_total = ready_total
        self.incomplete_targets = list(incomplete_targets)
        self.stale_mobile_previews = list(stale_mobile_previews)
        self.executed = []

    def cursor(self):
        return FakeCursor(self)

    @contextmanager
    def transaction(self):
        yield


class FakeStore:
    def __init__(self, canonical_3mf: Path):
        self._canonical = canonical_3mf
        self.uploaded = []
        self.downloaded = []

    def download(self, key, destination):
        self.downloaded.append(key)
        Path(destination).write_bytes(self._canonical.read_bytes())

    def upload(self, source, key, content_type):
        self.uploaded.append((key, content_type))


def _target(name: str) -> backfill.BackfillTarget:
    return backfill.BackfillTarget(
        revision_id=f"revision-{name}",
        model_id=f"model-{name}",
        owner_id=f"owner-{name}",
        canonical_s3_key=f"protected/models/model-{name}/revisions/revision-{name}/canonical_3mf.3mf",
    )


def _fixture_3mf(tmp_path: Path) -> Path:
    box = trimesh.creation.box(extents=[10.0, 20.0, 30.0])
    output = tmp_path / "canonical_3mf.3mf"
    box.export(output)
    return output


def test_select_incomplete_revisions_returns_revision_identity():
    targets = [_target("a"), _target("b")]
    connection = FakeConnection(ready_total=3, incomplete_targets=targets)

    assert backfill.select_incomplete_revisions(connection) == targets
    sql = connection.executed[-1][0]
    assert "model_revision_files" in sql
    assert "canonical_blob.s3_key" in sql
    assert "model_files" not in sql


def test_run_backfill_dry_run_writes_nothing(tmp_path: Path, monkeypatch):
    connection = FakeConnection(ready_total=2, incomplete_targets=[_target("one")])
    store = FakeStore(_fixture_3mf(tmp_path))
    published = []
    monkeypatch.setattr(backfill, "publish_revision_assets", published.append)

    counters = backfill.run_backfill(connection, store, dry_run=True)

    assert counters == backfill.BackfillCounters(2, 1, 0, 0)
    assert store.downloaded == []
    assert published == []


def test_run_backfill_generates_revision_scoped_assets_and_publishes(
    tmp_path: Path,
    monkeypatch,
):
    target = _target("one")
    connection = FakeConnection(ready_total=2, incomplete_targets=[target])
    store = FakeStore(_fixture_3mf(tmp_path))
    publications = []

    def record_publication(_connection, **kwargs):
        publications.append(kwargs)

    monkeypatch.setattr(backfill, "publish_revision_assets", record_publication)

    counters = backfill.run_backfill(connection, store, dry_run=False)

    assert counters == backfill.BackfillCounters(2, 1, 1, 0)
    assert store.downloaded == [target.canonical_s3_key]
    uploaded_keys = {key for key, _ in store.uploaded}
    expected_prefix = f"public/models/{target.model_id}/revisions/{target.revision_id}/"
    assert uploaded_keys == {
        f"{expected_prefix}preview.glb",
        f"{expected_prefix}thumb.webp",
        f"{expected_prefix}preview.mobile.glb",
    }
    assert publications[0]["revision_id"] == target.revision_id
    assert publications[0]["owner_id"] == target.owner_id
    assert {asset.role for asset in publications[0]["assets"]} == {
        "preview",
        "thumbnail",
        "mobile_preview",
    }


def test_run_backfill_counts_failures_and_continues(tmp_path: Path, monkeypatch):
    connection = FakeConnection(
        ready_total=3,
        incomplete_targets=[_target("ok"), _target("boom")],
    )
    store = FakeStore(_fixture_3mf(tmp_path))
    real_generate = backfill.generate_revision_previews

    def maybe_fail(store_arg, payload, canonical, directory):
        if payload.revision_id == "revision-boom":
            raise RuntimeError("render backend down")
        return real_generate(store_arg, payload, canonical, directory)

    monkeypatch.setattr(backfill, "generate_revision_previews", maybe_fail)
    monkeypatch.setattr(backfill, "publish_revision_assets", lambda *_args, **_kwargs: None)

    counters = backfill.run_backfill(connection, store, dry_run=False)

    assert counters == backfill.BackfillCounters(3, 2, 1, 1)


def test_stale_mobile_preview_requires_explicit_cutoff():
    cutoff = datetime(2026, 7, 11, 15, 13, tzinfo=UTC)
    stale = (_target("stale"), cutoff - timedelta(days=1))
    fresh = (_target("fresh"), cutoff + timedelta(days=1))
    connection = FakeConnection(ready_total=2, stale_mobile_previews=[stale, fresh])

    assert backfill.select_incomplete_revisions(connection) == []
    assert backfill.select_incomplete_revisions(
        connection,
        mobile_preview_stale_before=cutoff,
    ) == [stale[0]]
