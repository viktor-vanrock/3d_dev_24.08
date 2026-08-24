"""Тесты HTTP-контракта apps/giga. Слой БД мокается (giga.main.db.*) — HTTP-тесты
проверяют форму запроса/ответа и статус-коды, не SQL (тот — в test_db.py).
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from giga import db
from giga.main import app

client = TestClient(app)


class _DummyConn:
    """Заглушка под `with psycopg.connect(...) as conn:` — db.* замоканы, conn не используется."""

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _fake_generation(**overrides) -> db.Generation:
    defaults = dict(
        id="gen-1",
        user_id="user-1",
        branch="openscad",
        prompt="подставка под телефон 70x140",
        params={"w": 70},
        status="queued",
        artifact_url=None,
        preview_url=None,
        error=None,
        created_at="2026-01-01T00:00:00",
        updated_at="2026-01-01T00:00:00",
    )
    defaults.update(overrides)
    return db.Generation(**defaults)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "giga"}


def test_create_generation_without_database_url_returns_503(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)

    response = client.post(
        "/generations",
        json={"user_id": "user-1", "branch": "openscad", "prompt": "подставка"},
    )

    assert response.status_code == 503


def test_create_generation_returns_queued(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://portal:portal@localhost:5432/portal")
    monkeypatch.setattr("giga.main.psycopg.connect", lambda url: _DummyConn())
    monkeypatch.setattr(
        db,
        "create_generation",
        lambda conn, user_id, branch, prompt, params: _fake_generation(
            user_id=user_id, branch=branch, prompt=prompt, params=params
        ),
    )

    response = client.post(
        "/generations",
        json={
            "user_id": "user-1",
            "branch": "openscad",
            "prompt": "подставка под телефон 70x140",
            "params": {"w": 70},
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "queued"
    assert body["branch"] == "openscad"
    assert body["artifact_url"] is None


def test_create_generation_rejects_unknown_branch(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://portal:portal@localhost:5432/portal")

    response = client.post(
        "/generations",
        json={"user_id": "user-1", "branch": "not-a-branch", "prompt": "x"},
    )

    assert response.status_code == 422


def test_create_generation_rejects_empty_prompt(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://portal:portal@localhost:5432/portal")

    response = client.post(
        "/generations",
        json={"user_id": "user-1", "branch": "openscad", "prompt": ""},
    )

    assert response.status_code == 422


def test_get_generation_done_returns_artifact_url(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://portal:portal@localhost:5432/portal")
    monkeypatch.setattr("giga.main.psycopg.connect", lambda url: _DummyConn())
    monkeypatch.setattr(
        db,
        "get_generation",
        lambda conn, generation_id: _fake_generation(
            id=generation_id, status="done", artifact_url="generations/gen-1/artifact.json"
        ),
    )

    response = client.get("/generations/gen-1")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "done"
    assert body["artifact_url"] == "generations/gen-1/artifact.json"


def test_get_generation_error_returns_error_text(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://portal:portal@localhost:5432/portal")
    monkeypatch.setattr("giga.main.psycopg.connect", lambda url: _DummyConn())
    monkeypatch.setattr(
        db,
        "get_generation",
        lambda conn, generation_id: _fake_generation(
            id=generation_id, status="error", error="провайдер недоступен"
        ),
    )

    response = client.get("/generations/gen-1")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "error"
    assert body["error"] == "провайдер недоступен"


def test_get_generation_missing_returns_404(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://portal:portal@localhost:5432/portal")
    monkeypatch.setattr("giga.main.psycopg.connect", lambda url: _DummyConn())
    monkeypatch.setattr(db, "get_generation", lambda conn, generation_id: None)

    response = client.get("/generations/missing")

    assert response.status_code == 404


def test_list_generations_by_user(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://portal:portal@localhost:5432/portal")
    monkeypatch.setattr("giga.main.psycopg.connect", lambda url: _DummyConn())
    monkeypatch.setattr(
        db,
        "list_generations_by_user",
        lambda conn, user_id: [
            _fake_generation(id="gen-2", user_id=user_id, prompt="второй"),
            _fake_generation(id="gen-1", user_id=user_id, prompt="первый"),
        ],
    )

    response = client.get("/generations", params={"user_id": "user-1"})

    assert response.status_code == 200
    body = response.json()
    assert [g["prompt"] for g in body] == ["второй", "первый"]


def test_list_generations_requires_user_id():
    response = client.get("/generations")
    assert response.status_code == 422


def test_embed_without_credentials_returns_503(monkeypatch):
    monkeypatch.delenv("GIGACHAT_CREDENTIALS", raising=False)

    response = client.post("/embed", json={"text": "дракон для стола"})

    assert response.status_code == 503


def test_embed_rejects_empty_text(monkeypatch):
    monkeypatch.setenv("GIGACHAT_CREDENTIALS", "fake")

    response = client.post("/embed", json={"text": ""})

    assert response.status_code == 422


def test_embed_returns_vector(monkeypatch):
    from giga.search import embed as search_embed

    monkeypatch.setattr("giga.main.gigachat_client.load_client", lambda: object())
    monkeypatch.setattr(
        search_embed,
        "embed_texts",
        lambda client, texts: [[1.0] + [0.0] * (search_embed.EMBEDDING_DIM - 1)],
    )

    response = client.post("/embed", json={"text": "дракон для стола"})

    assert response.status_code == 200
    body = response.json()
    assert len(body["embedding"]) == search_embed.EMBEDDING_DIM
    assert body["model"] == search_embed.EMBEDDING_MODEL
    assert body["dim"] == search_embed.EMBEDDING_DIM


def test_embed_provider_error_returns_502(monkeypatch):
    from giga.search import embed as search_embed

    def _raise(client, texts):
        raise search_embed.EmbeddingError("GigaChat: недоступен")

    monkeypatch.setattr("giga.main.gigachat_client.load_client", lambda: object())
    monkeypatch.setattr(search_embed, "embed_texts", _raise)

    response = client.post("/embed", json={"text": "дракон для стола"})

    assert response.status_code == 502


# --- /guides/draft (MF-1007) ---


def test_guide_draft_without_credentials_returns_503(monkeypatch):
    monkeypatch.delenv("GIGACHAT_CREDENTIALS", raising=False)

    response = client.post("/guides/draft", json={"instructions_text": "1. Prep the frame."})

    assert response.status_code == 503


def test_guide_draft_rejects_empty_instructions(monkeypatch):
    monkeypatch.setenv("GIGACHAT_CREDENTIALS", "fake")

    response = client.post("/guides/draft", json={"instructions_text": ""})

    assert response.status_code == 422


def test_guide_draft_returns_steps(monkeypatch):
    from giga.guides import draft as guide_draft

    monkeypatch.setattr("giga.main.gigachat_client.load_client", lambda: object())
    monkeypatch.setattr(
        guide_draft,
        "draft_build_steps",
        lambda client, text: [
            guide_draft.DraftStep(
                title="Собрать раму", body="Скрутите раму винтами M3.", parts=["M3 винт"]
            )
        ],
    )

    response = client.post("/guides/draft", json={"instructions_text": "1. Prep the frame."})

    assert response.status_code == 200
    body = response.json()
    assert body["steps"] == [
        {"title": "Собрать раму", "body": "Скрутите раму винтами M3.", "parts": ["M3 винт"]}
    ]


def test_guide_draft_provider_error_returns_502(monkeypatch):
    from giga.guides import draft as guide_draft

    def _raise(client, text):
        raise guide_draft.DraftError("GigaChat: недоступен")

    monkeypatch.setattr("giga.main.gigachat_client.load_client", lambda: object())
    monkeypatch.setattr(guide_draft, "draft_build_steps", _raise)

    response = client.post("/guides/draft", json={"instructions_text": "1. Prep the frame."})

    assert response.status_code == 502


# --- /ideas/enrich (MF-565) ---


def test_idea_enrich_without_credentials_returns_503(monkeypatch):
    monkeypatch.delenv("GIGACHAT_CREDENTIALS", raising=False)

    response = client.post("/ideas/enrich", json={"free_text": "не хватает тёмной темы"})

    assert response.status_code == 503


def test_idea_enrich_rejects_empty_free_text(monkeypatch):
    monkeypatch.setenv("GIGACHAT_CREDENTIALS", "fake")

    response = client.post("/ideas/enrich", json={"free_text": ""})

    assert response.status_code == 422


def test_idea_enrich_returns_draft(monkeypatch):
    from giga.ideas import enrich as idea_enrich

    monkeypatch.setattr("giga.main.gigachat_client.load_client", lambda: object())
    monkeypatch.setattr(
        idea_enrich,
        "enrich_idea_draft",
        lambda client, text: idea_enrich.IdeaDraft(
            title="Тёмная тема каталога", body="Добавить тёмную тему.", category="catalog"
        ),
    )

    response = client.post("/ideas/enrich", json={"free_text": "не хватает тёмной темы в каталоге"})

    assert response.status_code == 200
    assert response.json() == {
        "title": "Тёмная тема каталога",
        "body": "Добавить тёмную тему.",
        "category": "catalog",
    }


def test_idea_enrich_provider_error_returns_502(monkeypatch):
    from giga.ideas import enrich as idea_enrich

    def _raise(client, text):
        raise idea_enrich.EnrichError("GigaChat: недоступен")

    monkeypatch.setattr("giga.main.gigachat_client.load_client", lambda: object())
    monkeypatch.setattr(idea_enrich, "enrich_idea_draft", _raise)

    response = client.post("/ideas/enrich", json={"free_text": "не хватает тёмной темы"})

    assert response.status_code == 502


# --- /diagnostics* (MF-360) ---


def _jpeg_bytes(size=(800, 600)) -> bytes:
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", size, (30, 120, 30)).save(buffer, format="JPEG")
    return buffer.getvalue()


def test_upload_diagnostic_photo_without_s3_returns_503(monkeypatch):
    monkeypatch.delenv("S3_ENDPOINT", raising=False)
    monkeypatch.delenv("S3_ACCESS_KEY", raising=False)
    monkeypatch.delenv("S3_SECRET_KEY", raising=False)

    response = client.post(
        "/diagnostics/photos", files={"file": ("photo.jpg", _jpeg_bytes(), "image/jpeg")}
    )

    assert response.status_code == 503


def test_upload_diagnostic_photo_rejects_invalid_file(monkeypatch):
    monkeypatch.setenv("S3_ENDPOINT", "https://s3.cloud.ru")
    monkeypatch.setenv("S3_ACCESS_KEY", "ak")
    monkeypatch.setenv("S3_SECRET_KEY", "sk")

    response = client.post(
        "/diagnostics/photos", files={"file": ("photo.jpg", b"not an image", "image/jpeg")}
    )

    assert response.status_code == 422


def test_upload_diagnostic_photo_succeeds(monkeypatch):
    monkeypatch.setenv("S3_ENDPOINT", "https://s3.cloud.ru")
    monkeypatch.setenv("S3_ACCESS_KEY", "ak")
    monkeypatch.setenv("S3_SECRET_KEY", "sk")

    uploaded = {}

    class _FakeStore:
        def __init__(self, config, bucket=None):
            uploaded["bucket"] = bucket

        def upload_bytes(self, key, body, content_type):
            uploaded["key"] = key
            uploaded["content_type"] = content_type

    monkeypatch.setattr("giga.main.ObjectStore", _FakeStore)

    response = client.post(
        "/diagnostics/photos", files={"file": ("photo.jpg", _jpeg_bytes(), "image/jpeg")}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["photo_key"].startswith("diagnostics/")
    assert body["width"] > 0 and body["height"] > 0
    assert uploaded["bucket"] == "diagnostics"
    assert uploaded["key"] == body["photo_key"]
    assert uploaded["content_type"] == "image/webp"


def test_create_diagnosis_requires_photo_or_description():
    response = client.post("/diagnostics", json={"user_id": "user-1"})
    assert response.status_code == 422


def test_create_diagnosis_rejects_unknown_material():
    response = client.post(
        "/diagnostics",
        json={"user_id": "user-1", "description": "стрингинг", "filament_material": "WOOD"},
    )
    assert response.status_code == 422


def test_create_diagnosis_matches_by_description():
    response = client.post(
        "/diagnostics",
        json={
            "user_id": "user-1",
            "description": "между деталями тонкие нити паутина стрингинг",
            "filament_material": "PETG",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["matches"]
    assert body["matches"][0]["defect_id"] == "stringing"
    assert body["matches"][0]["recommendations"]


def test_create_diagnosis_with_photo_key_only_is_valid():
    response = client.post(
        "/diagnostics", json={"user_id": "user-1", "photo_key": "diagnostics/abc/photo.webp"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["matches"] == []
    assert body["note"]
