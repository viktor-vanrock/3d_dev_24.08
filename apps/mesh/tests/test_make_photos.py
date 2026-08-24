"""Юнит-тесты вставки фото Make на фейковых connection/store (MF-783/MF-780).

Реальный Postgres/S3 не поднимаем — интеграционный прогон делается вручную на dev
(webcheck/curl против apps/mesh, см. autofab-webtest).
"""

import pytest

from mesh import make_photos
from mesh.storage import make_photo_key


class FakeCursor:
    def __init__(self, conn):
        self._conn = conn
        self._last = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        normalized = " ".join(sql.split())
        self._conn.executed.append((normalized, params))
        if "select id, model_id from makes where id" in normalized:
            (make_id,) = params
            model_id = self._conn.model_id_by_make.get(make_id)
            self._last = [(make_id, model_id)] if make_id in self._conn.existing_make_ids else []
        elif "select count(*), coalesce(max(position), -1) from make_photos" in normalized:
            (make_id,) = params
            rows = self._conn.photos_by_make.get(make_id, [])
            self._last = [(len(rows), max((p for p, _ in rows), default=-1))]
        elif "select h.make_id" in normalized and "make_photo_hashes" in normalized:
            model_id, phash, threshold, _phash_again = params
            best: tuple[int, str] | None = None
            for existing_phash, existing_make_id, existing_model_id in self._conn.hashes:
                if existing_model_id == model_id:
                    continue
                distance = bin((existing_phash ^ phash) & ((1 << 64) - 1)).count("1")
                if distance <= threshold and (best is None or distance < best[0]):
                    best = (distance, existing_make_id)
            self._last = [(best[1],)] if best else []
        elif "insert into make_photos" in normalized:
            self._conn.inserted.append(params)
            self._last = None
        elif "insert into make_photo_hashes" in normalized:
            self._conn.inserted_hashes.append(params)
            self._last = None
        else:
            self._last = None

    def fetchone(self):
        return self._last[0] if self._last else None


class FakeConn:
    def __init__(self, existing_make_ids=(), photos_by_make=None, model_id_by_make=None, hashes=()):
        self.existing_make_ids = set(existing_make_ids)
        self.photos_by_make = photos_by_make or {}
        self.model_id_by_make = model_id_by_make or {}
        # (phash, make_id, model_id) — уже сохранённые хэши других фото, под дедуп-проверку.
        self.hashes = list(hashes)
        self.executed = []
        self.inserted = []
        self.inserted_hashes = []
        self.committed = False

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.committed = True


class FakeStore:
    def __init__(self):
        self.uploaded = []

    def upload_bytes(self, data, key, content_type):
        self.uploaded.append((key, content_type, data))


_VARIANTS = {"thumb": b"thumb-bytes", "medium": b"medium-bytes", "full": b"full-bytes"}


def test_insert_make_photo_unknown_make_raises():
    conn = FakeConn(existing_make_ids=set())
    store = FakeStore()

    with pytest.raises(make_photos.MakeNotFoundError):
        make_photos.insert_make_photo(conn, store, "missing-make", _VARIANTS, "approved", 12345)

    assert store.uploaded == []  # ничего не заливаем, если make не существует
    assert conn.inserted == []


def test_insert_make_photo_first_photo_becomes_cover():
    conn = FakeConn(existing_make_ids={"make-1"}, model_id_by_make={"make-1": "model-1"})
    store = FakeStore()

    record = make_photos.insert_make_photo(conn, store, "make-1", _VARIANTS, "approved", 12345)

    assert record.position == 0
    assert record.is_cover is True
    assert record.moderation_status == "approved"
    assert record.s3_key == make_photo_key("make-1", record.id, "full")
    assert conn.committed is True
    assert conn.inserted_hashes == [("make-1", record.id, 12345)]

    uploaded_keys = {key for key, _content_type, _data in store.uploaded}
    assert uploaded_keys == {
        make_photo_key("make-1", record.id, "thumb"),
        make_photo_key("make-1", record.id, "medium"),
        make_photo_key("make-1", record.id, "full"),
    }


def test_insert_make_photo_second_photo_is_not_cover_and_increments_position():
    conn = FakeConn(
        existing_make_ids={"make-1"},
        model_id_by_make={"make-1": "model-1"},
        photos_by_make={"make-1": [(0, True)]},
    )
    store = FakeStore()

    record = make_photos.insert_make_photo(conn, store, "make-1", _VARIANTS, "pending", 12345)

    assert record.position == 1
    assert record.is_cover is False
    assert record.moderation_status == "pending"


def test_insert_make_photo_rejects_cross_model_perceptual_duplicate():
    """Тот же кадр (расстояние Хэмминга 0) уже опубликован под ДРУГОЙ моделью — фрод-сигнал
    (MF-780): аплойд отклоняется ДО заливки в S3."""
    conn = FakeConn(
        existing_make_ids={"make-2"},
        model_id_by_make={"make-2": "model-2"},
        hashes=[(12345, "make-1", "model-1")],
    )
    store = FakeStore()

    with pytest.raises(make_photos.DuplicatePhotoError) as excinfo:
        make_photos.insert_make_photo(conn, store, "make-2", _VARIANTS, "approved", 12345)

    assert excinfo.value.existing_make_id == "make-1"
    assert store.uploaded == []
    assert conn.inserted == []
    assert conn.inserted_hashes == []


def test_insert_make_photo_allows_same_model_near_duplicate():
    """Похожий кадр под ТОЙ ЖЕ моделью — не фрод (повтор той же вещи), не блокируется"""
    conn = FakeConn(
        existing_make_ids={"make-2"},
        model_id_by_make={"make-2": "model-1"},
        hashes=[(12345, "make-1", "model-1")],
    )
    store = FakeStore()

    record = make_photos.insert_make_photo(conn, store, "make-2", _VARIANTS, "approved", 12345)

    assert record.make_id == "make-2"
    assert conn.inserted_hashes == [("make-2", record.id, 12345)]


def test_insert_make_photo_allows_distant_hash_across_models():
    """Расстояние Хэмминга далеко за порогом — визуально другое фото, не блокируется, даже
    под другой моделью."""
    conn = FakeConn(
        existing_make_ids={"make-2"},
        model_id_by_make={"make-2": "model-2"},
        hashes=[(0, "make-1", "model-1")],
    )
    store = FakeStore()

    # 0xFFFFFFFFFFFFFFFF в знаковом представлении — все 64 бита отличаются от 0.
    far_hash = -1
    record = make_photos.insert_make_photo(conn, store, "make-2", _VARIANTS, "approved", far_hash)

    assert record.make_id == "make-2"
