"""Юнит-тесты `giga.assistant.evidence.fetch_evidence` на фейковом cursor —
проверяем bounded/limit-контракт и что `model_id`/`title` в `Evidence` реальные
(из "БД"), не выдуманные."""

from __future__ import annotations

from giga.assistant.evidence import fetch_evidence


class FakeCursor:
    def __init__(self, rows):
        self._rows = rows
        self.last_params = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params):
        assert "status = 'ready'" in " ".join(sql.split())
        self.last_params = params

    def fetchall(self):
        return self._rows


class FakeConn:
    def __init__(self, rows):
        self._rows = rows
        self.cursor_obj = None

    def cursor(self):
        self.cursor_obj = FakeCursor(self._rows)
        return self.cursor_obj


def test_empty_query_returns_no_evidence_without_touching_db():
    conn = FakeConn(rows=[("model-1", "Дракон", "описание", 0.9)])
    assert fetch_evidence(conn, "   ", limit=6) == []


def test_zero_limit_returns_no_evidence():
    conn = FakeConn(rows=[("model-1", "Дракон", "описание", 0.9)])
    assert fetch_evidence(conn, "дракон", limit=0) == []


def test_maps_real_rows_to_evidence():
    conn = FakeConn(
        rows=[
            ("model-1", "Дракон для стола", "маленькая статуэтка дракона", 0.72),
            ("model-2", "Дракончик брелок", None, 0.51),
        ]
    )
    result = fetch_evidence(conn, "дракон для стола", limit=6)

    assert [e.model_id for e in result] == ["model-1", "model-2"]
    assert result[0].title == "Дракон для стола"
    assert result[0].snippet == "маленькая статуэтка дракона"
    assert result[0].score == 0.72
    # description=None → snippet деградирует к title, не к пустой строке/None
    assert result[1].snippet == "Дракончик брелок"

    assert conn.cursor_obj.last_params["q"] == "дракон для стола"
    assert conn.cursor_obj.last_params["limit"] == 6


def test_long_description_is_bounded_to_snippet_max_chars():
    conn = FakeConn(rows=[("model-1", "Модель", "x" * 1000, 0.5)])
    result = fetch_evidence(conn, "модель", limit=1)
    assert len(result[0].snippet) <= 280
