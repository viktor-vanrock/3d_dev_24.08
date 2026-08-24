import base64
import json

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)

from mesh.slice_trust import sign_slice_trust_material, verify_slice_trust_material
from mesh.slice_trust_signing import (
    SliceTrustSigningConfigError,
    build_signer,
    build_verifier,
    load_slice_trust_signing_config,
)

FINGERPRINT = "b4f62fa5e32a92358fcac6f0f922f15140892ffa156742b63a97471d0efcc63b"


def material(**overrides):
    value = {
        "contract_version": "slice-trust.v1",
        "account_id": "account-7",
        "device_id": "device-9",
        "profile_id": "profile-0.20-pla",
        "slice_key": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "fingerprint_source": "agent",
        "fingerprint_state": "stock",
        "fingerprint_algorithm_version": "config-fingerprint.v1",
        "config_fingerprint": FINGERPRINT,
        "canonical_config_fingerprint": FINGERPRINT,
        "cross_account_reuse": False,
        "global_dedup_eligible": False,
    }
    value.update(overrides)
    return value


def _write_pem(path, key):
    path.write_bytes(
        key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption())
    )


def _b64_public(key) -> str:
    raw = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return base64.b64encode(raw).decode("ascii")


def test_missing_env_returns_none(monkeypatch):
    monkeypatch.delenv("MESH_SLICE_TRUST_PRIVATE_KEY_PATH", raising=False)
    monkeypatch.delenv("MESH_SLICE_TRUST_KEY_ID", raising=False)

    assert load_slice_trust_signing_config() is None


def test_key_id_without_path_returns_none(monkeypatch):
    monkeypatch.delenv("MESH_SLICE_TRUST_PRIVATE_KEY_PATH", raising=False)
    monkeypatch.setenv("MESH_SLICE_TRUST_KEY_ID", "mesh-2026-07")

    assert load_slice_trust_signing_config() is None


def test_missing_key_file_raises_config_error(tmp_path, monkeypatch):
    monkeypatch.setenv("MESH_SLICE_TRUST_PRIVATE_KEY_PATH", str(tmp_path / "missing.pem"))
    monkeypatch.setenv("MESH_SLICE_TRUST_KEY_ID", "mesh-2026-07")
    monkeypatch.delenv("MESH_SLICE_TRUST_PUBLIC_KEYS_PATH", raising=False)

    with pytest.raises(SliceTrustSigningConfigError):
        load_slice_trust_signing_config()


def test_non_pem_key_file_raises_config_error(tmp_path, monkeypatch):
    key_path = tmp_path / "key.pem"
    key_path.write_bytes(b"not a pem key")
    monkeypatch.setenv("MESH_SLICE_TRUST_PRIVATE_KEY_PATH", str(key_path))
    monkeypatch.setenv("MESH_SLICE_TRUST_KEY_ID", "mesh-2026-07")
    monkeypatch.delenv("MESH_SLICE_TRUST_PUBLIC_KEYS_PATH", raising=False)

    with pytest.raises(SliceTrustSigningConfigError):
        load_slice_trust_signing_config()


def test_non_ed25519_key_raises_config_error(tmp_path, monkeypatch):
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    key_path = tmp_path / "rsa.pem"
    key_path.write_bytes(key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()))
    monkeypatch.setenv("MESH_SLICE_TRUST_PRIVATE_KEY_PATH", str(key_path))
    monkeypatch.setenv("MESH_SLICE_TRUST_KEY_ID", "mesh-2026-07")
    monkeypatch.delenv("MESH_SLICE_TRUST_PUBLIC_KEYS_PATH", raising=False)

    with pytest.raises(SliceTrustSigningConfigError):
        load_slice_trust_signing_config()


def test_blank_key_id_raises_config_error(tmp_path, monkeypatch):
    key_path = tmp_path / "key.pem"
    _write_pem(key_path, Ed25519PrivateKey.generate())
    monkeypatch.setenv("MESH_SLICE_TRUST_PRIVATE_KEY_PATH", str(key_path))
    monkeypatch.setenv("MESH_SLICE_TRUST_KEY_ID", "   ")
    monkeypatch.delenv("MESH_SLICE_TRUST_PUBLIC_KEYS_PATH", raising=False)

    with pytest.raises(SliceTrustSigningConfigError):
        load_slice_trust_signing_config()


def test_active_key_is_self_verifiable_without_public_keys_registry(tmp_path, monkeypatch):
    key_path = tmp_path / "key.pem"
    _write_pem(key_path, Ed25519PrivateKey.generate())
    monkeypatch.setenv("MESH_SLICE_TRUST_PRIVATE_KEY_PATH", str(key_path))
    monkeypatch.setenv("MESH_SLICE_TRUST_KEY_ID", "mesh-2026-07")
    monkeypatch.delenv("MESH_SLICE_TRUST_PUBLIC_KEYS_PATH", raising=False)

    config = load_slice_trust_signing_config()

    assert config.key_id == "mesh-2026-07"
    assert set(config.public_keys) == {"mesh-2026-07"}


def test_sign_and_verify_round_trip_through_slice_trust_contract(tmp_path, monkeypatch):
    key_path = tmp_path / "key.pem"
    _write_pem(key_path, Ed25519PrivateKey.generate())
    monkeypatch.setenv("MESH_SLICE_TRUST_PRIVATE_KEY_PATH", str(key_path))
    monkeypatch.setenv("MESH_SLICE_TRUST_KEY_ID", "mesh-2026-07")
    monkeypatch.delenv("MESH_SLICE_TRUST_PUBLIC_KEYS_PATH", raising=False)
    config = load_slice_trust_signing_config()
    signer = build_signer(config)
    verifier = build_verifier(config)

    signed = sign_slice_trust_material(material(), signer)

    assert signed.key_id == "mesh-2026-07"
    assert verify_slice_trust_material(material(), signed, verifier)


def test_verifier_rejects_tampered_signature(tmp_path, monkeypatch):
    key_path = tmp_path / "key.pem"
    _write_pem(key_path, Ed25519PrivateKey.generate())
    monkeypatch.setenv("MESH_SLICE_TRUST_PRIVATE_KEY_PATH", str(key_path))
    monkeypatch.setenv("MESH_SLICE_TRUST_KEY_ID", "mesh-2026-07")
    monkeypatch.delenv("MESH_SLICE_TRUST_PUBLIC_KEYS_PATH", raising=False)
    config = load_slice_trust_signing_config()
    verifier = build_verifier(config)
    signer = build_signer(config)

    signing_input = "tampered-input"
    key_id, signature = signer(signing_input)

    assert verifier(signing_input, key_id, signature) is True
    assert verifier(signing_input + "!", key_id, signature) is False


def test_verifier_rejects_unknown_key_id(tmp_path, monkeypatch):
    key_path = tmp_path / "key.pem"
    _write_pem(key_path, Ed25519PrivateKey.generate())
    monkeypatch.setenv("MESH_SLICE_TRUST_PRIVATE_KEY_PATH", str(key_path))
    monkeypatch.setenv("MESH_SLICE_TRUST_KEY_ID", "mesh-2026-07")
    monkeypatch.delenv("MESH_SLICE_TRUST_PUBLIC_KEYS_PATH", raising=False)
    config = load_slice_trust_signing_config()
    verifier = build_verifier(config)
    signer = build_signer(config)

    _key_id, signature = signer("payload")

    assert verifier("payload", "some-other-key", signature) is False


def test_verifier_rejects_malformed_base64_signature(tmp_path, monkeypatch):
    key_path = tmp_path / "key.pem"
    _write_pem(key_path, Ed25519PrivateKey.generate())
    monkeypatch.setenv("MESH_SLICE_TRUST_PRIVATE_KEY_PATH", str(key_path))
    monkeypatch.setenv("MESH_SLICE_TRUST_KEY_ID", "mesh-2026-07")
    monkeypatch.delenv("MESH_SLICE_TRUST_PUBLIC_KEYS_PATH", raising=False)
    config = load_slice_trust_signing_config()
    verifier = build_verifier(config)

    assert verifier("payload", "mesh-2026-07", "not-valid-base64!!") is False


def test_public_keys_registry_verifies_retired_key_after_rotation(tmp_path, monkeypatch):
    """Ротация: активный ключ подписывает, но verifier всё ещё должен читать
    уже закэшированные записи, подписанные предыдущим (retired) key_id."""
    retired_key = Ed25519PrivateKey.generate()
    active_key_path = tmp_path / "active.pem"
    _write_pem(active_key_path, Ed25519PrivateKey.generate())

    registry_path = tmp_path / "public_keys.json"
    registry_path.write_text(
        json.dumps({"mesh-2026-06": _b64_public(retired_key)}), encoding="utf-8"
    )

    monkeypatch.setenv("MESH_SLICE_TRUST_PRIVATE_KEY_PATH", str(active_key_path))
    monkeypatch.setenv("MESH_SLICE_TRUST_KEY_ID", "mesh-2026-07")
    monkeypatch.setenv("MESH_SLICE_TRUST_PUBLIC_KEYS_PATH", str(registry_path))

    config = load_slice_trust_signing_config()
    verifier = build_verifier(config)

    signing_input = "retired-signing-input"
    retired_signature = base64.b64encode(retired_key.sign(signing_input.encode("utf-8"))).decode(
        "ascii"
    )

    assert verifier(signing_input, "mesh-2026-06", retired_signature) is True
    assert set(config.public_keys) == {"mesh-2026-06", "mesh-2026-07"}


def test_active_key_registry_entry_cannot_be_overridden_by_registry_file(tmp_path, monkeypatch):
    """Реестр не может подменить публичный ключ активного key_id — иначе
    файл-реестр мог бы тихо разрешить постороннюю подпись под активным id."""
    active_key = Ed25519PrivateKey.generate()
    other_key = Ed25519PrivateKey.generate()
    active_key_path = tmp_path / "active.pem"
    _write_pem(active_key_path, active_key)

    registry_path = tmp_path / "public_keys.json"
    registry_path.write_text(
        json.dumps({"mesh-2026-07": _b64_public(other_key)}), encoding="utf-8"
    )

    monkeypatch.setenv("MESH_SLICE_TRUST_PRIVATE_KEY_PATH", str(active_key_path))
    monkeypatch.setenv("MESH_SLICE_TRUST_KEY_ID", "mesh-2026-07")
    monkeypatch.setenv("MESH_SLICE_TRUST_PUBLIC_KEYS_PATH", str(registry_path))

    config = load_slice_trust_signing_config()
    signer = build_signer(config)
    verifier = build_verifier(config)

    signing_input = "self-consistency"
    key_id, signature = signer(signing_input)

    assert verifier(signing_input, key_id, signature) is True


def test_public_keys_registry_rejects_malformed_json(tmp_path, monkeypatch):
    key_path = tmp_path / "key.pem"
    _write_pem(key_path, Ed25519PrivateKey.generate())
    registry_path = tmp_path / "public_keys.json"
    registry_path.write_text("not json", encoding="utf-8")

    monkeypatch.setenv("MESH_SLICE_TRUST_PRIVATE_KEY_PATH", str(key_path))
    monkeypatch.setenv("MESH_SLICE_TRUST_KEY_ID", "mesh-2026-07")
    monkeypatch.setenv("MESH_SLICE_TRUST_PUBLIC_KEYS_PATH", str(registry_path))

    with pytest.raises(SliceTrustSigningConfigError):
        load_slice_trust_signing_config()


def test_public_keys_registry_rejects_invalid_base64_entry(tmp_path, monkeypatch):
    key_path = tmp_path / "key.pem"
    _write_pem(key_path, Ed25519PrivateKey.generate())
    registry_path = tmp_path / "public_keys.json"
    registry_path.write_text(json.dumps({"mesh-2026-06": "not-base64!!"}), encoding="utf-8")

    monkeypatch.setenv("MESH_SLICE_TRUST_PRIVATE_KEY_PATH", str(key_path))
    monkeypatch.setenv("MESH_SLICE_TRUST_KEY_ID", "mesh-2026-07")
    monkeypatch.setenv("MESH_SLICE_TRUST_PUBLIC_KEYS_PATH", str(registry_path))

    with pytest.raises(SliceTrustSigningConfigError):
        load_slice_trust_signing_config()
