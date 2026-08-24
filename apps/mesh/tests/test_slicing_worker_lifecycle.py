from contextlib import nullcontext
from datetime import UTC, datetime
from pathlib import Path

from portal_queue_lifecycle import ClaimedJob, ClaimToken

from mesh.slice_trust import SignedSliceTrust, SliceTrustError
from mesh.slicer_engine import SlicerEngineConfig, SlicingError
from mesh.slicer_preflight import PreflightError
from mesh.slicing_lifecycle import SliceJobPayload
from mesh.slicing_worker import classify_slice_failure, execute_slice_job


def test_slice_worker_entrypoint_has_no_legacy_queue_fallback() -> None:
    mesh_root = Path(__file__).resolve().parents[1]
    pyproject = (mesh_root / "pyproject.toml").read_text(encoding="utf-8")
    source = (mesh_root / "src/mesh/slicing_worker.py").read_text(encoding="utf-8")

    assert 'mesh-slice-worker = "mesh.slicing_worker:run_slice_loop"' in pyproject
    assert "MESH_SLICE_LIFECYCLE_ENABLED" in (
        mesh_root / "src/mesh/config.py"
    ).read_text(encoding="utf-8")
    assert "QueueWorkerRunner(" in source
    assert "SliceJobRepository(" in source
    assert "run_legacy_slice_loop" not in source
    assert "_wait_disabled(" in source
    assert not (mesh_root / "src/mesh/worker.py").exists()


def test_slice_failure_classification_preserves_domain_retryability() -> None:
    permanent = classify_slice_failure(
        SliceTrustError("SLICE_TRUST_INVALID", "invalid"),
        None,  # type: ignore[arg-type]
    )
    preflight = classify_slice_failure(
        PreflightError("OUTSIDE_BED", "outside"),
        None,  # type: ignore[arg-type]
    )
    transient = classify_slice_failure(
        SlicingError("engine timeout"),
        None,  # type: ignore[arg-type]
    )

    assert (permanent.error_code, permanent.retryable) == ("SLICE_TRUST_INVALID", False)
    assert (preflight.error_code, preflight.retryable) == ("OUTSIDE_BED", False)
    assert transient.retryable is True


def test_execute_slice_job_returns_verified_account_cache_hit(monkeypatch) -> None:
    material = {
        "contract_version": "slice-trust.v1",
        "account_id": "account-1",
        "device_id": "device-1",
        "profile_id": "profile-1",
        "slice_key": "ab" * 32,
        "fingerprint_source": "agent",
        "fingerprint_state": "stock",
        "fingerprint_algorithm_version": "config-fingerprint.v1",
        "config_fingerprint": "cd" * 32,
        "canonical_config_fingerprint": "cd" * 32,
        "cross_account_reuse": False,
        "global_dedup_eligible": False,
    }
    signed = SignedSliceTrust(material, "key-1", "signature-1")
    connection = object()
    monkeypatch.setattr(
        "mesh.slicing_worker.psycopg.connect",
        lambda _url: nullcontext(connection),
    )
    monkeypatch.setattr(
        "mesh.slicing_worker._find_account_cache_hit",
        lambda *_args, **_kwargs: {
            "gcode_s3_key": "protected/slices/account-1/cached.gcode",
            "size_bytes": 42,
            "metrics": {"print_time_seconds": 10},
            "signed_trust": signed,
        },
    )
    job = ClaimedJob(
        token=ClaimToken("job-1", "owner-1", 1),
        payload=SliceJobPayload(
            job_id="job-1",
            model_id="model-1",
            profile_id="profile-1",
            filament_profile_id=None,
            scale=1.0,
            requested_by="account-1",
            slice_trust_contract_version="slice-trust.v1",
            slice_trust_material=material,
            slice_trust_key_id="key-1",
            slice_trust_signature="signature-1",
            layout=None,
            intent=None,
        ),
        attempts=1,
        lease_expires_at=datetime.now(UTC),
    )

    result = execute_slice_job(
        "postgres://unused",
        object(),
        SlicerEngineConfig("prusaslicer", 100, 1024, 4, 30),
        job,
        orca_engine_config=None,
        orca_profiles_dir=None,
        signer=None,
        verifier=lambda *_args: True,
    )

    assert result.cache_hit is True
    assert result.gcode_s3_key.endswith("cached.gcode")
    assert result.signed_trust == signed
