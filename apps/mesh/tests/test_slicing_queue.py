"""Юнит-тесты очереди слайсинга (MF-1078) на фейковой БД — без реального Postgres.

Фокус — per-account gate кэша (Data-вето MF-1078): второй аккаунт на тот же
slice_key НЕ должен получить чужой g-code без собственной записи в
slice_cache_hits. DB-claim → мульти-инстанс Orca-плита на реальном Postgres
(MF-1987/MF-1986) — `test_slicing_queue_plate_integration.py` (skipif без
`DATABASE_URL`, см. скилл autofab-sandbox).
"""

import hashlib
from pathlib import Path

import pytest

from mesh.slice_trust import SignedSliceTrust, SliceTrustError, build_slice_trust_material
from mesh.slicer_engine import SlicerEngineConfig, SlicingError
from mesh.slicer_preflight import (
    PreflightError,
)
from mesh.slicing_queue import (
    _assert_cache_entry_material_compatible,
    _find_account_cache_hit,
    _orca_startup_health_check,
    _record_cache_entry_and_hit,
    _resolve_slicer_engine,
    _run_orca_plate_job,
    _slice_trust_startup_health_check,
)
from mesh.snapmaker_u1_profile import SnapmakerProfileError
from mesh.storage import slice_gcode_key


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
        if "select checksum from model_files" in normalized:
            self._last = (self._conn.model_checksum,) if self._conn.model_checksum else None
        elif "from slice_cache_hits h" in normalized:
            account_id, slice_key, user_id = params
            hit = self._conn.hits.get((slice_key, user_id)) if account_id == user_id else None
            self._last = hit
        elif "insert into slice_cache_hits" in normalized:
            account_id, slice_key, user_id, model_id = params
            self._conn.hits.setdefault(
                (slice_key, user_id), (f"protected/slices/{user_id}/x.gcode", 100, {})
            )
            self._last = None
        else:
            self._last = None

    def fetchone(self):
        return self._last


class FakeConn:
    def __init__(self, model_checksum=b"\x01" * 32, hits=None):
        self.model_checksum = model_checksum
        # {(slice_key, user_id): (gcode_s3_key, size_bytes, metrics)}
        self.hits = hits or {}
        self.executed = []

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        pass


def test_account_without_prior_hit_gets_no_cache_shortcut():
    slice_key = hashlib.sha256(b"whatever").digest()
    conn = FakeConn(hits={(slice_key, "user-a"): ("protected/slices/user-a/x.gcode", 100, {})})

    # user-b никогда не видел этот slice_key — первый раз всегда пересчитывается,
    # даже если физически такой же g-code уже посчитан для user-a (Data-вето MF-1078).
    assert _find_account_cache_hit(conn, slice_key, "user-b") is None


def test_account_with_prior_hit_gets_cache_shortcut():
    slice_key = hashlib.sha256(b"whatever").digest()
    hit_row = ("protected/slices/user-a/x.gcode", 100, {"print_time_s": 42})
    conn = FakeConn(hits={(slice_key, "user-a"): hit_row})

    result = _find_account_cache_hit(conn, slice_key, "user-a")
    assert result is not None
    assert result["gcode_s3_key"] == "protected/slices/user-a/x.gcode"
    assert result["metrics"] == {"print_time_s": 42}


def test_same_fingerprint_isolated_between_accounts_and_hit_record_is_idempotent():
    slice_key = hashlib.sha256(b"same-fingerprint").digest()
    conn = FakeConn()

    _record_cache_entry_and_hit(
        conn, slice_key, "protected/slices/user-a/x.gcode", 100, {}, "job-a", "user-a", "model-a"
    )
    _record_cache_entry_and_hit(
        conn, slice_key, "protected/slices/user-b/x.gcode", 100, {}, "job-b", "user-b", "model-b"
    )

    assert _find_account_cache_hit(conn, slice_key, "user-a") is not None
    assert _find_account_cache_hit(conn, slice_key, "user-b") is not None
    assert _find_account_cache_hit(conn, slice_key, "user-c") is None
    assert (
        sum(
            "on conflict (account_id, slice_key, user_id, model_id)" in sql.lower()
            for sql, _ in conn.executed
        )
        == 2
    )


def test_cache_lookup_binds_account_and_user_to_the_same_session_identity():
    slice_key = hashlib.sha256(b"same-fingerprint").digest()
    conn = FakeConn(hits={(slice_key, "user-a"): ("protected/slices/user-a/x.gcode", 100, {})})

    assert _find_account_cache_hit(conn, slice_key, "user-b") is None
    sql, params = next(
        (sql, params) for sql, params in conn.executed if "from slice_cache_hits h" in sql
    )
    assert "h.account_id = %s" in sql
    assert "h.user_id = %s" in sql
    assert params == ("user-b", slice_key, "user-b")


def test_no_session_never_hits_cache():
    slice_key = hashlib.sha256(b"whatever").digest()
    conn = FakeConn(hits={(slice_key, "user-a"): ("protected/slices/user-a/x.gcode", 100, {})})
    assert _find_account_cache_hit(conn, slice_key, None) is None


def test_slice_gcode_key_is_content_addressed_and_account_scoped():
    key = slice_gcode_key("user-a", "deadbeef")
    assert key == "protected/slices/user-a/deadbeef.gcode"
    assert slice_gcode_key("user-a", "deadbeef") != slice_gcode_key("user-b", "deadbeef")


class TrustCursor:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        self.conn.params = params

    def fetchone(self):
        evidence = self.conn.evidence
        if self.conn.legacy:
            return (
                "protected/slices/account-a/slice.gcode",
                100,
                {},
                None,
                None,
                None,
                None,
                self.conn.has_hit,
            )
        return (
            "protected/slices/account-a/slice.gcode",
            100,
            {},
            evidence.material["contract_version"],
            evidence.material,
            evidence.key_id,
            evidence.signature,
            self.conn.has_hit,
        )


class TrustConn:
    def __init__(self, evidence, has_hit=True, legacy=False):
        self.evidence = evidence
        self.has_hit = has_hit
        self.legacy = legacy
        self.params = None

    def cursor(self):
        return TrustCursor(self)


def _trust_material():
    fingerprint = "b4f62fa5e32a92358fcac6f0f922f15140892ffa156742b63a97471d0efcc63b"
    return build_slice_trust_material(
        {
            "contract_version": "slice-trust.v1",
            "account_id": "account-a",
            "device_id": "device-a",
            "profile_id": "profile-a",
            "slice_key": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "fingerprint_source": "agent",
            "fingerprint_state": "stock",
            "fingerprint_algorithm_version": "config-fingerprint.v1",
            "config_fingerprint": fingerprint,
            "canonical_config_fingerprint": fingerprint,
            "cross_account_reuse": False,
            "global_dedup_eligible": False,
        }
    )


def test_trust_cache_hit_verifies_exact_material_before_returning_gcode():
    material = _trust_material()
    evidence = SignedSliceTrust(material, "key-a", "sig-a")
    calls = []
    result = _find_account_cache_hit(
        TrustConn(evidence),
        bytes.fromhex(material["slice_key"]),
        "account-a",
        trust_material=material,
        verifier=lambda signing_input, key_id, signature: (
            calls.append((signing_input, key_id, signature)) or True
        ),
    )

    assert result["gcode_s3_key"].endswith("slice.gcode")
    assert calls[0][1:] == ("key-a", "sig-a")


def test_trust_cache_material_mismatch_rejects_without_fallback():
    stored = _trust_material()
    requested = dict(stored)
    requested["fingerprint_state"] = "custom"
    requested["fingerprint_algorithm_version"] = "agent-config.v1"
    requested["config_fingerprint"] = "a" * 64
    requested["canonical_config_fingerprint"] = None

    with pytest.raises(SliceTrustError) as exc_info:
        _find_account_cache_hit(
            TrustConn(SignedSliceTrust(stored, "key-a", "sig-a")),
            bytes.fromhex(stored["slice_key"]),
            "account-a",
            trust_material=requested,
            verifier=lambda _input, _key, _signature: True,
        )

    assert exc_info.value.code == "SLICE_TRUST_CONFLICT"


def test_trust_cache_rejects_legacy_entry_before_verifier_or_gcode():
    material = _trust_material()
    verifier_calls = []

    with pytest.raises(SliceTrustError) as exc_info:
        _find_account_cache_hit(
            TrustConn(SignedSliceTrust(material, "key-a", "sig-a"), legacy=True),
            bytes.fromhex(material["slice_key"]),
            "account-a",
            trust_material=material,
            verifier=lambda *_args: verifier_calls.append(True) or True,
        )

    assert exc_info.value.code == "SLICE_TRUST_VERSION_UNSUPPORTED"
    assert verifier_calls == []


def test_trust_cache_rejects_slice_key_not_bound_to_signed_material():
    material = _trust_material()
    evidence = SignedSliceTrust(material, "key-a", "sig-a")

    with pytest.raises(SliceTrustError) as exc_info:
        _find_account_cache_hit(
            TrustConn(evidence),
            b"different-slice-key",
            "account-a",
            trust_material=material,
            verifier=lambda _input, _key, _signature: True,
        )

    assert exc_info.value.code == "SLICE_TRUST_CONFLICT"


class PreflightCursor:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        self.conn.executed.append((" ".join(sql.split()), params))

    def fetchone(self):
        return self.conn.existing


class PreflightConn:
    def __init__(self, existing):
        self.existing = existing
        self.executed = []

    def cursor(self):
        return PreflightCursor(self)

    def commit(self):
        pass


def test_cache_material_preflight_locks_absent_account_slice_key():
    material = _trust_material()
    conn = PreflightConn(None)

    _assert_cache_entry_material_compatible(
        conn,
        bytes.fromhex(material["slice_key"]),
        material["account_id"],
        SignedSliceTrust(material, "key-a", "sig-a"),
    )

    assert "pg_advisory_xact_lock" in conn.executed[0][0]
    assert conn.executed[0][1] == (
        f"{material['account_id']}:{material['slice_key']}",
    )


class TrackingStore:
    def __init__(self):
        self.downloads = []
        self.uploads = []

    def download(self, object_key, destination):
        self.downloads.append((object_key, destination))

    def upload(self, source, object_key, *, content_type):
        self.uploads.append((source, object_key, content_type))



class EngineCursor:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        self.conn.executed.append((" ".join(sql.split()), params))

    def fetchone(self):
        return (self.conn.slicer,) if self.conn.slicer is not None else None


class EngineConn:
    def __init__(self, slicer):
        self.slicer = slicer
        self.executed = []

    def cursor(self):
        return EngineCursor(self)


def test_resolve_slicer_engine_reads_slicer_column():
    conn = EngineConn("orcaslicer")
    assert _resolve_slicer_engine(conn, "profile-a") == "orcaslicer"
    assert "select slicer from slicer_profiles" in conn.executed[0][0]


def test_resolve_slicer_engine_rejects_unknown_profile():
    from mesh.slicer_engine import UnsupportedSlicerError

    conn = EngineConn(None)
    with pytest.raises(UnsupportedSlicerError):
        _resolve_slicer_engine(conn, "missing-profile")



def test_run_orca_plate_job_rejects_null_artifact_key_without_downloading(monkeypatch):
    """API стейджит best-effort (slicing.route.ts) — job может быть создана до
    того, как байты реально доехали до S3 (`artifact_key: null`). Честный
    отказ вместо попытки скачать объект по ключу "None"."""
    import mesh.slicing_queue as queue

    class FakeProfile:
        build_volume_mm = {"x": 270.0, "y": 270.0, "z": 270.05}

    monkeypatch.setattr(queue, "resolve_snapmaker_u1_profile", lambda _dir: FakeProfile())

    class RejectingStore:
        def download(self, *_args, **_kwargs):
            raise AssertionError("не должен качать байты без artifact_key")

    layout = {
        "bed_geometry": {"x": 270.0, "y": 270.0, "z": 270.05},
        "instances": [
            {"instance_id": "a", "artifact_key": None, "x_mm": 50.0, "y_mm": 50.0},
        ],
    }

    with pytest.raises(SlicingError) as exc:
        _run_orca_plate_job(
            RejectingStore(),
            SlicerEngineConfig("orca", 100, 1024, 4, 30),
            Path("/nonexistent/profiles"),
            layout,
            {"supports": "off"},
            "account-a",
            bytes.fromhex("00" * 32),
        )
    assert "artifact_key" in str(exc.value)


def _fake_plate_result(instances):
    from mesh.slicer_engine import OrcaSliceMetrics
    from mesh.snapmaker_u1_slice import InstancePlateSummary, SnapmakerU1PlateSliceResult

    return SnapmakerU1PlateSliceResult(
        gcode_path=instances[0].stl_path.parent / "plate.gcode",
        metrics=OrcaSliceMetrics(1.0, 1.0, 1.0, ()),
        profile_content_hash="hash",
        instances=tuple(
            InstancePlateSummary(
                instance_id=i.instance_id,
                footprint_mm={"x": 10.0, "y": 10.0, "z": 10.0},
                supports_used=False,
                layer_count=1,
                skipped=False,
            )
            for i in instances
        ),
    )


class _FakeStore:
    def download(self, _key, path):
        path.write_bytes(b"stub")

    def upload(self, path, _key, content_type=None):
        path.write_bytes(b"gcode")

    def upload_bytes(self, _data, _key, content_type=None):
        pass


def test_run_orca_plate_job_shifts_center_origin_layout_to_corner_origin(monkeypatch):
    """MF-1992: `platescreen.tsx` всегда шлёт `bed_geometry.origin == "center"`
    (координаты от центра стола), но `PlateInstanceInput.x_mm/y_mm` документирован
    как corner-origin (snapmaker_u1_slice.py docstring) — без сдвига валидная
    центрированная раскладка ложно проваливала `check_plate_layout` с `outside_bed`."""
    import mesh.slicing_queue as queue

    class FakeProfile:
        build_volume_mm = {"x": 270.0, "y": 270.0, "z": 270.05}

    monkeypatch.setattr(queue, "resolve_snapmaker_u1_profile", lambda _dir: FakeProfile())

    captured = {}

    def _fake_slice(_engine_config, _profile, instances, gcode_path, supports="off"):
        captured["instances"] = instances
        gcode_path.write_bytes(b"gcode")
        return _fake_plate_result(instances)

    monkeypatch.setattr(queue, "slice_snapmaker_u1_plate", _fake_slice)

    layout = {
        "bed_geometry": {"shape": "rect", "width_mm": 270.0, "depth_mm": 270.0, "origin": "center"},
        "instances": [
            {
                "instance_id": "a",
                "artifact_key": "key-a",
                "x_mm": -107.0,
                "y_mm": -115.0,
                "rotation_z_deg": 0.0,
            },
        ],
    }

    queue._run_orca_plate_job(
        _FakeStore(),
        SlicerEngineConfig("orca", 100, 1024, 4, 30),
        Path("/nonexistent/profiles"),
        layout,
        {"supports": "off"},
        "account-a",
        bytes.fromhex("00" * 32),
    )

    instance = captured["instances"][0]
    assert instance.x_mm == pytest.approx(-107.0 + 135.0)
    assert instance.y_mm == pytest.approx(-115.0 + 135.0)


def test_run_orca_plate_job_leaves_corner_origin_layout_unchanged(monkeypatch):
    """`origin` отсутствующий (легаси фикстуры) или `front_left`/`explicit` —
    координаты уже corner-origin, сдвиг обязан остаться нулевым."""
    import mesh.slicing_queue as queue

    class FakeProfile:
        build_volume_mm = {"x": 270.0, "y": 270.0, "z": 270.05}

    monkeypatch.setattr(queue, "resolve_snapmaker_u1_profile", lambda _dir: FakeProfile())

    captured = {}

    def _fake_slice(_engine_config, _profile, instances, gcode_path, supports="off"):
        captured["instances"] = instances
        gcode_path.write_bytes(b"gcode")
        return _fake_plate_result(instances)

    monkeypatch.setattr(queue, "slice_snapmaker_u1_plate", _fake_slice)

    layout = {
        "bed_geometry": {
            "shape": "rect", "width_mm": 270.0, "depth_mm": 270.0, "origin": "front_left",
        },
        "instances": [
            {
                "instance_id": "a",
                "artifact_key": "key-a",
                "x_mm": 50.0,
                "y_mm": 60.0,
                "rotation_z_deg": 0.0,
            },
        ],
    }

    queue._run_orca_plate_job(
        _FakeStore(),
        SlicerEngineConfig("orca", 100, 1024, 4, 30),
        Path("/nonexistent/profiles"),
        layout,
        {"supports": "off"},
        "account-a",
        bytes.fromhex("00" * 32),
    )

    instance = captured["instances"][0]
    assert instance.x_mm == pytest.approx(50.0)
    assert instance.y_mm == pytest.approx(60.0)


def test_run_orca_plate_job_rejects_unsupported_bed_origin_without_downloading(monkeypatch):
    """MF-1994: `bed_geometry` присутствует, но несёт нераспознанный `origin` —
    честный `UNSUPPORTED_BED_ORIGIN` ДО скачивания инстансов, не молчаливый
    0-сдвиг (в отличие от легаси-фикстур без `origin` вовсе, см.
    `test_run_orca_plate_job_leaves_corner_origin_layout_unchanged`)."""
    import mesh.slicing_queue as queue

    class FakeProfile:
        build_volume_mm = {"x": 270.0, "y": 270.0, "z": 270.05}

    monkeypatch.setattr(queue, "resolve_snapmaker_u1_profile", lambda _dir: FakeProfile())

    class RejectingStore:
        def download(self, *_args, **_kwargs):
            raise AssertionError("не должен качать байты без валидного origin")

    layout = {
        "bed_geometry": {
            "shape": "rect", "width_mm": 270.0, "depth_mm": 270.0, "origin": "top_left",
        },
        "instances": [
            {"instance_id": "a", "artifact_key": "protected/a", "x_mm": 50.0, "y_mm": 50.0},
        ],
    }

    with pytest.raises(PreflightError) as exc:
        queue._run_orca_plate_job(
            RejectingStore(),
            SlicerEngineConfig("orca", 100, 1024, 4, 30),
            Path("/nonexistent/profiles"),
            layout,
            {"supports": "off"},
            "account-a",
            bytes.fromhex("00" * 32),
        )
    assert exc.value.code == "UNSUPPORTED_BED_ORIGIN"


def test_orca_startup_health_check_passes_through_when_not_configured():
    assert _orca_startup_health_check(None, None) == (None, None)


def test_orca_startup_health_check_fails_closed_on_missing_binary(tmp_path):
    config = SlicerEngineConfig(str(tmp_path / "no-such-binary"), 100, 1024, 4, 30)
    assert _orca_startup_health_check(config, tmp_path) == (None, None)


def test_orca_startup_health_check_fails_closed_on_non_executable_binary(tmp_path):
    binary = tmp_path / "orca-appimage" / "AppRun"
    binary.parent.mkdir()
    binary.write_text("#!/bin/sh\n")
    binary.chmod(0o644)
    config = SlicerEngineConfig(str(binary), 100, 1024, 4, 30)
    assert _orca_startup_health_check(config, tmp_path) == (None, None)


def test_orca_startup_health_check_fails_closed_on_unresolvable_profiles(tmp_path, monkeypatch):
    import mesh.slicing_queue as queue

    binary = tmp_path / "AppRun"
    binary.write_text("#!/bin/sh\n")
    binary.chmod(0o755)
    config = SlicerEngineConfig(str(binary), 100, 1024, 4, 30)

    def _raise(_profiles_dir):
        raise SnapmakerProfileError("нет папки 'machine' у вендора 'Snapmaker'")

    monkeypatch.setattr(queue, "resolve_snapmaker_u1_profile", _raise)
    assert _orca_startup_health_check(config, tmp_path) == (None, None)


def test_orca_startup_health_check_ok(tmp_path, monkeypatch):
    import mesh.slicing_queue as queue

    binary = tmp_path / "AppRun"
    binary.write_text("#!/bin/sh\n")
    binary.chmod(0o755)
    config = SlicerEngineConfig(str(binary), 100, 1024, 4, 30)

    monkeypatch.setattr(queue, "resolve_snapmaker_u1_profile", lambda _profiles_dir: object())
    assert _orca_startup_health_check(config, tmp_path) == (config, tmp_path)


def test_slice_trust_startup_health_check_idles_when_not_configured(monkeypatch):
    monkeypatch.delenv("MESH_SLICE_TRUST_PRIVATE_KEY_PATH", raising=False)
    monkeypatch.delenv("MESH_SLICE_TRUST_KEY_ID", raising=False)

    assert _slice_trust_startup_health_check() == (None, None)


def test_slice_trust_startup_health_check_idles_on_misconfigured_key(tmp_path, monkeypatch):
    key_path = tmp_path / "key.pem"
    key_path.write_bytes(b"not a real pem")
    monkeypatch.setenv("MESH_SLICE_TRUST_PRIVATE_KEY_PATH", str(key_path))
    monkeypatch.setenv("MESH_SLICE_TRUST_KEY_ID", "mesh-2026-07")
    monkeypatch.delenv("MESH_SLICE_TRUST_PUBLIC_KEYS_PATH", raising=False)

    assert _slice_trust_startup_health_check() == (None, None)


def test_slice_trust_startup_health_check_builds_working_signer_and_verifier(
    tmp_path, monkeypatch
):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import (
        Encoding,
        NoEncryption,
        PrivateFormat,
    )

    key_path = tmp_path / "key.pem"
    key_path.write_bytes(
        Ed25519PrivateKey.generate().private_bytes(
            Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()
        )
    )
    monkeypatch.setenv("MESH_SLICE_TRUST_PRIVATE_KEY_PATH", str(key_path))
    monkeypatch.setenv("MESH_SLICE_TRUST_KEY_ID", "mesh-2026-07")
    monkeypatch.delenv("MESH_SLICE_TRUST_PUBLIC_KEYS_PATH", raising=False)

    signer, verifier = _slice_trust_startup_health_check()

    assert signer is not None and verifier is not None
    key_id, signature = signer("payload")
    assert key_id == "mesh-2026-07"
    assert verifier("payload", key_id, signature) is True
    assert verifier("payload", "unknown-key", signature) is False
