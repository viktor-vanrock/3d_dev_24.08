"""Потребительский контракт доверия для результата серверного слайсинга.

Материал приходит из Gateway как JSON. В Mesh он проверяется до cache-hit и до
записи результата; Mesh не вычисляет fingerprint заново и не принимает legacy
материал с неявным fallback. Криптографический backend намеренно внедряется
через callable: формат ключа и конкретная Ed25519-библиотека не являются частью
контракта ``slice-trust.v1``.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

SLICE_TRUST_CONTRACT_VERSION = "slice-trust.v1"
CONFIG_FINGERPRINT_ALGORITHM_VERSION = "config-fingerprint.v1"
AGENT_CONFIG_FINGERPRINT_ALGORITHM_VERSION = "agent-config.v1"

_MATERIAL_KEYS = frozenset(
    {
        "contract_version",
        "account_id",
        "device_id",
        "profile_id",
        "slice_key",
        "fingerprint_source",
        "fingerprint_state",
        "fingerprint_algorithm_version",
        "config_fingerprint",
        "canonical_config_fingerprint",
        "cross_account_reuse",
        "global_dedup_eligible",
    }
)
_HEX_256 = re.compile(r"^[a-f0-9]{64}$")


class SliceTrustError(ValueError):
    """Безопасная ошибка контракта без включения raw material или подписи."""

    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code


@dataclass(frozen=True)
class SignedSliceTrust:
    """Detached evidence, сохраняемое рядом с g-code."""

    material: dict[str, Any]
    key_id: str
    signature: str

    def as_metadata(self) -> dict[str, Any]:
        # Подпись и key_id нужны для последующей проверки, но не должны попадать
        # в observability-поля. Вызывающий код сам выбирает storage metadata.
        return {
            "material": dict(self.material),
            "key_id": self.key_id,
            "signature": self.signature,
        }


def _invalid(message: str) -> SliceTrustError:
    return SliceTrustError("SLICE_TRUST_INVALID", message)


def _check_text(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        raise _invalid(f"{name} must be a non-empty trimmed string")
    return value


def _check_fingerprint(value: Any, name: str, *, nullable: bool = False) -> str | None:
    if nullable and value is None:
        return None
    if not isinstance(value, str) or not _HEX_256.fullmatch(value):
        raise _invalid(f"{name} must be lower-case sha256 hex")
    return value


def build_slice_trust_material(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Проверяет и возвращает только допустимый ``slice-trust.v1`` material."""

    if not isinstance(raw, Mapping):
        raise _invalid("material must be an object")
    version = raw.get("contract_version")
    if version != SLICE_TRUST_CONTRACT_VERSION:
        raise SliceTrustError("SLICE_TRUST_VERSION_UNSUPPORTED", "only slice-trust.v1 is accepted")
    if frozenset(raw) != _MATERIAL_KEYS:
        raise _invalid("material has missing or unknown fields")

    source = raw["fingerprint_source"]
    state = raw["fingerprint_state"]
    algorithm = raw["fingerprint_algorithm_version"]
    if source not in {"agent", "declared"}:
        raise _invalid("unknown fingerprint_source")
    if state not in {"stock", "custom", "mismatch"}:
        raise _invalid("unknown fingerprint_state")
    if source == "declared" and state != "stock":
        raise _invalid("declared custom or mismatch configuration has no agent fact")
    if raw["cross_account_reuse"] is not False or raw["global_dedup_eligible"] is not False:
        raise _invalid("slice-trust.v1 forbids cross-account reuse and global dedup")

    config_fingerprint = _check_fingerprint(raw["config_fingerprint"], "config_fingerprint")
    canonical = _check_fingerprint(
        raw["canonical_config_fingerprint"],
        "canonical_config_fingerprint",
        nullable=True,
    )
    if state == "stock":
        if algorithm != CONFIG_FINGERPRINT_ALGORITHM_VERSION or canonical != config_fingerprint:
            raise _invalid("stock material must use the canonical config fingerprint")
    else:
        if algorithm != AGENT_CONFIG_FINGERPRINT_ALGORITHM_VERSION or canonical is not None:
            raise _invalid(
                "custom or mismatch material must use agent-config.v1 without canonical fingerprint"
            )

    checked = {
        "contract_version": SLICE_TRUST_CONTRACT_VERSION,
        "account_id": _check_text(raw["account_id"], "account_id"),
        "device_id": _check_text(raw["device_id"], "device_id"),
        "profile_id": _check_text(raw["profile_id"], "profile_id"),
        "slice_key": _check_fingerprint(raw["slice_key"], "slice_key"),
        "fingerprint_source": source,
        "fingerprint_state": state,
        "fingerprint_algorithm_version": algorithm,
        "config_fingerprint": config_fingerprint,
        "canonical_config_fingerprint": canonical,
        "cross_account_reuse": False,
        "global_dedup_eligible": False,
    }
    # _check_fingerprint is non-null for slice_key/config_fingerprint in this branch;
    # the assertion keeps the public type honest without weakening runtime checks.
    assert checked["slice_key"] is not None
    assert checked["config_fingerprint"] is not None
    return checked


def serialize_slice_trust_material(material: Mapping[str, Any]) -> str:
    """Возвращает exact JSON-строку, которую определяет TS ``serialize...``."""

    checked = build_slice_trust_material(material)
    ordered = {
        "account_id": checked["account_id"],
        "canonical_config_fingerprint": checked["canonical_config_fingerprint"],
        "config_fingerprint": checked["config_fingerprint"],
        "contract_version": SLICE_TRUST_CONTRACT_VERSION,
        "cross_account_reuse": False,
        "device_id": checked["device_id"],
        "fingerprint_algorithm_version": checked["fingerprint_algorithm_version"],
        "fingerprint_source": checked["fingerprint_source"],
        "fingerprint_state": checked["fingerprint_state"],
        "global_dedup_eligible": False,
        "profile_id": checked["profile_id"],
        "slice_key": checked["slice_key"],
    }
    return json.dumps(ordered, ensure_ascii=False, separators=(",", ":"))


Signer = Callable[[str], tuple[str, str]]
Verifier = Callable[[str, str, str], bool]


def _validate_detached_evidence(key_id: Any, signature: Any) -> None:
    if (
        not isinstance(key_id, str)
        or not key_id.strip()
        or not isinstance(signature, str)
        or not signature.strip()
    ):
        raise SliceTrustError(
            "SLICE_TRUST_SIGNATURE_INVALID", "invalid detached evidence"
        )


def sign_slice_trust_material(material: Mapping[str, Any], signer: Signer) -> SignedSliceTrust:
    """Подписывает exact material и возвращает detached key id/signature."""

    checked = build_slice_trust_material(material)
    signing_input = serialize_slice_trust_material(checked)
    try:
        key_id, signature = signer(signing_input)
    except Exception as exc:  # noqa: BLE001 - backend не должен раскрывать детали наружу
        raise SliceTrustError("SLICE_TRUST_SIGNATURE_INVALID", "signing failed") from exc
    _validate_detached_evidence(key_id, signature)
    return SignedSliceTrust(checked, key_id, signature)


def verify_slice_trust_material(
    material: Mapping[str, Any], evidence: SignedSliceTrust, verifier: Verifier
) -> bool:
    """Проверяет подпись exact material до доступа к результату."""

    checked = build_slice_trust_material(material)
    if checked != evidence.material:
        raise SliceTrustError(
            "SLICE_TRUST_CONFLICT", "signed material does not match result material"
        )
    _validate_detached_evidence(evidence.key_id, evidence.signature)
    signing_input = serialize_slice_trust_material(checked)
    try:
        verified = verifier(signing_input, evidence.key_id, evidence.signature)
    except Exception as exc:  # noqa: BLE001 - fail closed, без raw signature в сообщении
        raise SliceTrustError(
            "SLICE_TRUST_SIGNATURE_INVALID", "signature verification failed"
        ) from exc
    if not verified:
        raise SliceTrustError("SLICE_TRUST_SIGNATURE_INVALID", "signature verification failed")
    return True


def trust_observation(
    material: Mapping[str, Any], outcome: str, correlation_id: str
) -> dict[str, str]:
    """Белый список полей для structured log/metrics; raw evidence не возвращается."""

    checked = build_slice_trust_material(material)
    if outcome not in {"accepted", "rejected", "signature_verified"}:
        raise ValueError("unknown slice trust outcome")
    _check_text(correlation_id, "correlation_id")
    return {
        "contract_version": checked["contract_version"],
        "fingerprint_source": checked["fingerprint_source"],
        "fingerprint_state": checked["fingerprint_state"],
        "fingerprint_algorithm_version": checked["fingerprint_algorithm_version"],
        "outcome": outcome,
        "correlation_id": correlation_id,
    }


def same_slice_trust_material(left: Mapping[str, Any], right: Mapping[str, Any]) -> bool:
    """Сравнивает нормализованный material для идемпотентного account-scoped job."""

    return build_slice_trust_material(left) == build_slice_trust_material(right)
