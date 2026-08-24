import json

import pytest

from mesh.slice_trust import (
    SLICE_TRUST_CONTRACT_VERSION,
    SignedSliceTrust,
    SliceTrustError,
    build_slice_trust_material,
    serialize_slice_trust_material,
    sign_slice_trust_material,
    trust_observation,
    verify_slice_trust_material,
)

FINGERPRINT = "b4f62fa5e32a92358fcac6f0f922f15140892ffa156742b63a97471d0efcc63b"


def material(**overrides):
    value = {
        "contract_version": SLICE_TRUST_CONTRACT_VERSION,
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


def test_serialization_matches_typescript_contract_field_order():
    parsed = build_slice_trust_material(material())

    assert serialize_slice_trust_material(parsed) == json.dumps(
        {
            "account_id": "account-7",
            "canonical_config_fingerprint": FINGERPRINT,
            "config_fingerprint": FINGERPRINT,
            "contract_version": "slice-trust.v1",
            "cross_account_reuse": False,
            "device_id": "device-9",
            "fingerprint_algorithm_version": "config-fingerprint.v1",
            "fingerprint_source": "agent",
            "fingerprint_state": "stock",
            "global_dedup_eligible": False,
            "profile_id": "profile-0.20-pla",
            "slice_key": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
        separators=(",", ":"),
    )


def test_rejects_legacy_version_before_signature_verification():
    with pytest.raises(SliceTrustError, match="SLICE_TRUST_VERSION_UNSUPPORTED") as exc_info:
        build_slice_trust_material(material(contract_version="slice-trust.v0"))

    assert exc_info.value.code == "SLICE_TRUST_VERSION_UNSUPPORTED"


def test_custom_material_never_gets_canonical_fingerprint():
    parsed = build_slice_trust_material(
        material(
            fingerprint_state="custom",
            fingerprint_algorithm_version="agent-config.v1",
            config_fingerprint="a" * 64,
            canonical_config_fingerprint=None,
        )
    )

    assert parsed["canonical_config_fingerprint"] is None
    assert parsed["global_dedup_eligible"] is False


def test_sign_and_verify_use_exact_material_and_retain_key_id():
    parsed = build_slice_trust_material(material())
    signed = sign_slice_trust_material(parsed, lambda signing_input: ("mesh-key-1", signing_input))

    assert signed.key_id == "mesh-key-1"
    assert signed.signature == serialize_slice_trust_material(parsed)
    assert verify_slice_trust_material(
        parsed,
        signed,
        lambda signing_input, key_id, signature: (
            key_id == "mesh-key-1" and signature == signing_input
        ),
    )


def test_verification_failure_is_explicit_and_does_not_expose_signature():
    parsed = build_slice_trust_material(material())
    signed = sign_slice_trust_material(
        parsed, lambda _signing_input: ("mesh-key-1", "secret-signature")
    )

    with pytest.raises(SliceTrustError) as exc_info:
        verify_slice_trust_material(
            parsed,
            signed,
            lambda _signing_input, _key_id, _signature: False,
        )

    assert exc_info.value.code == "SLICE_TRUST_SIGNATURE_INVALID"
    assert "secret-signature" not in str(exc_info.value)


def test_verification_rejects_missing_detached_evidence():
    parsed = build_slice_trust_material(material())

    with pytest.raises(SliceTrustError) as exc_info:
        verify_slice_trust_material(
            parsed,
            SignedSliceTrust(parsed, "", ""),
            lambda _signing_input, _key_id, _signature: True,
        )

    assert exc_info.value.code == "SLICE_TRUST_SIGNATURE_INVALID"


def test_verification_rejects_whitespace_only_detached_signature():
    parsed = build_slice_trust_material(material())

    with pytest.raises(SliceTrustError) as exc_info:
        verify_slice_trust_material(
            parsed,
            SignedSliceTrust(parsed, "mesh-key-1", "   "),
            lambda _signing_input, _key_id, _signature: True,
        )

    assert exc_info.value.code == "SLICE_TRUST_SIGNATURE_INVALID"


def test_observation_is_allowlisted_and_contains_no_evidence_or_raw_config():
    observation = trust_observation(material(), "signature_verified", "job-42")

    assert observation == {
        "contract_version": "slice-trust.v1",
        "fingerprint_source": "agent",
        "fingerprint_state": "stock",
        "fingerprint_algorithm_version": "config-fingerprint.v1",
        "outcome": "signature_verified",
        "correlation_id": "job-42",
    }
    assert "config_fingerprint" not in observation
    assert "signature" not in observation
