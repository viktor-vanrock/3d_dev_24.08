from __future__ import annotations

from portal_search.content import PostgresModelContentProvider


class FakeCursor:
    def __init__(self, connection: FakeConnection) -> None:
        self._connection = connection
        self._row: tuple[object, ...] | None = None

    def __enter__(self) -> FakeCursor:
        return self

    def __exit__(self, *_exc: object) -> None:
        return None

    def execute(self, sql: str, params: tuple[object, ...]) -> None:
        if "metadata_snapshot" in sql:
            self._row = self._connection.publications.get(str(params[0]))
            return
        if "project_revision_models" in sql:
            role, project_id = params
            key = self._connection.files.get((str(project_id), str(role)))
            self._row = None if key is None else (key,)
            return
        raise AssertionError(f"unexpected SQL: {sql}")

    def fetchone(self) -> tuple[object, ...] | None:
        return self._row


class FakeConnection:
    def __init__(self) -> None:
        self.publications: dict[str, tuple[object, ...]] = {}
        self.files: dict[tuple[str, str], str] = {}

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)


class FakeS3:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.downloads: list[tuple[str, str]] = []

    def download_fileobj(self, bucket: str, key: str, fileobj) -> None:
        self.downloads.append((bucket, key))
        fileobj.write(self.objects[(bucket, key)])


def test_text_uses_sorted_immutable_publication_metadata() -> None:
    connection = FakeConnection()
    connection.publications["project-1"] = (
        "Dragon",
        "Printable",
        ["fantasy", "dragon"],
    )
    provider = PostgresModelContentProvider(connection, FakeS3(), "3mf")

    assert provider.get_text_document("project-1") == (
        "Dragon\n\nPrintable\n\ndragon, fantasy"
    )


def test_text_returns_none_for_unpublished_project() -> None:
    provider = PostgresModelContentProvider(FakeConnection(), FakeS3(), "3mf")
    assert provider.get_text_document("project-1") is None


def test_geometry_uses_revision_scoped_ready_blob() -> None:
    connection = FakeConnection()
    key = "protected/models/model-1/revisions/revision-1/canonical_3mf.3mf"
    connection.files[("project-1", "canonical_3mf")] = key
    s3 = FakeS3()
    s3.objects[("3mf", key)] = b"3mf-bytes"
    provider = PostgresModelContentProvider(connection, s3, "3mf")

    geometry = provider.get_geometry("project-1")

    assert geometry is not None
    assert geometry.data == b"3mf-bytes"
    assert geometry.file_hint == "3mf"
    assert s3.downloads == [("3mf", key)]


def test_geometry_returns_none_without_published_canonical_file() -> None:
    provider = PostgresModelContentProvider(FakeConnection(), FakeS3(), "3mf")
    assert provider.get_geometry("project-1") is None
