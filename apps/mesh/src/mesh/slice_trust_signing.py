"""Ed25519 backend для `slice_trust.Signer`/`Verifier` (MF-1992).

`docs/contracts/slice-trust.v1.md` намеренно не фиксирует формат ключа/алгоритм —
это решает Mesh. Реализация здесь: Ed25519 (`cryptography`), приватный ключ —
PEM-файл (`openssl genpkey -algorithm ed25519`) вне git, путь и активный
`key_id` только из env (SECURITY.md). Публичные ключи для проверки читаются из
отдельного JSON-реестра `{key_id: base64(raw 32 bytes)}` — так подпись,
сделанная retired-ключом (ротация), остаётся проверяемой для уже закэшированных
`slice_cache_entries`, не только для активного ключа. Модуль не логирует ни
приватный ключ, ни подпись — только `key_id` (см. `run_slice_loop` startup log).
"""

from __future__ import annotations

import base64
import json
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.serialization import load_pem_private_key

from .slice_trust import Verifier

_PRIVATE_KEY_PATH_ENV = "MESH_SLICE_TRUST_PRIVATE_KEY_PATH"
_KEY_ID_ENV = "MESH_SLICE_TRUST_KEY_ID"
_PUBLIC_KEYS_PATH_ENV = "MESH_SLICE_TRUST_PUBLIC_KEYS_PATH"


class SliceTrustSigningConfigError(ValueError):
    """Ошибка конфигурации ключа. Сообщение безопасно логировать — никогда не
    включает путь-содержимое, ключевой материал или подпись, только env-имена."""


@dataclass(frozen=True)
class SliceTrustSigningConfig:
    key_id: str
    private_key: Ed25519PrivateKey
    public_keys: dict[str, Ed25519PublicKey]


def _load_private_key(path: Path) -> Ed25519PrivateKey:
    try:
        pem_bytes = path.read_bytes()
    except OSError as exc:
        raise SliceTrustSigningConfigError(
            f"не удалось прочитать файл по {_PRIVATE_KEY_PATH_ENV}"
        ) from exc
    try:
        key = load_pem_private_key(pem_bytes, password=None)
    except (ValueError, TypeError) as exc:
        raise SliceTrustSigningConfigError(
            f"{_PRIVATE_KEY_PATH_ENV} не является валидным нешифрованным PEM-ключом"
        ) from exc
    if not isinstance(key, Ed25519PrivateKey):
        raise SliceTrustSigningConfigError(f"{_PRIVATE_KEY_PATH_ENV} должен быть Ed25519 ключом")
    return key


def _decode_public_key(key_id: str, encoded: str) -> Ed25519PublicKey:
    try:
        raw = base64.b64decode(encoded, validate=True)
        return Ed25519PublicKey.from_public_bytes(raw)
    except (ValueError, TypeError) as exc:
        raise SliceTrustSigningConfigError(
            f"{_PUBLIC_KEYS_PATH_ENV}: невалидный публичный ключ для key_id={key_id}"
        ) from exc


def _load_public_keys(path: Path | None) -> dict[str, Ed25519PublicKey]:
    if path is None:
        return {}
    try:
        text = path.read_text("utf-8")
    except OSError as exc:
        raise SliceTrustSigningConfigError(
            f"не удалось прочитать файл по {_PUBLIC_KEYS_PATH_ENV}"
        ) from exc
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SliceTrustSigningConfigError(
            f"{_PUBLIC_KEYS_PATH_ENV} должен быть валидным JSON-объектом {{key_id: base64}}"
        ) from exc
    if not isinstance(raw, dict):
        raise SliceTrustSigningConfigError(
            f"{_PUBLIC_KEYS_PATH_ENV} должен быть объектом {{key_id: base64}}"
        )
    keys: dict[str, Ed25519PublicKey] = {}
    for key_id, encoded in raw.items():
        if not isinstance(key_id, str) or not key_id.strip() or not isinstance(encoded, str):
            raise SliceTrustSigningConfigError(
                f"{_PUBLIC_KEYS_PATH_ENV}: key_id и значение обязаны быть непустыми строками"
            )
        keys[key_id] = _decode_public_key(key_id, encoded)
    return keys


def load_slice_trust_signing_config() -> SliceTrustSigningConfig | None:
    """Собирает конфиг Ed25519-подписи `slice-trust.v1` из env.

    None, если `_PRIVATE_KEY_PATH_ENV`/`_KEY_ID_ENV` не заданы — воркер
    простаивает по всей очереди слайсинга (contract mandatory since MF-1992,
    fail-closed `slicing_worker.execute_slice_job`), тот же паттерн, что отсутствие
    S3/DATABASE_URL/бинаря в `config.py` (не падает, просто не берёт job).
    Некорректно заданный (файл есть, но битый) — `SliceTrustSigningConfigError`,
    вызывающий код решает, крашить ли процесс или деградировать (см.
    `run_slice_loop`).
    """
    key_path_value = os.getenv(_PRIVATE_KEY_PATH_ENV)
    key_id = os.getenv(_KEY_ID_ENV)
    if not key_path_value or not key_id:
        return None
    key_id = key_id.strip()
    if not key_id:
        raise SliceTrustSigningConfigError(f"{_KEY_ID_ENV} не может быть пустым")

    private_key = _load_private_key(Path(key_path_value))
    public_keys_value = os.getenv(_PUBLIC_KEYS_PATH_ENV)
    public_keys = _load_public_keys(Path(public_keys_value) if public_keys_value else None)
    # Публичный ключ активного key_id ВСЕГДА выводится из приватного ключа, а
    # не из реестра — иначе опечатка/устаревшая запись в
    # MESH_SLICE_TRUST_PUBLIC_KEYS_PATH под тем же key_id могла бы сорвать
    # self-verify сразу после подписи (execute_slice_job верифицирует
    # material в том же тике, до записи в slice_cache_entries/slice_jobs) или,
    # хуже, тихо подменить, чей публичный ключ проверяет активную подпись.
    public_keys[key_id] = private_key.public_key()
    return SliceTrustSigningConfig(key_id=key_id, private_key=private_key, public_keys=public_keys)


def build_signer(config: SliceTrustSigningConfig) -> Callable[[str], tuple[str, str]]:
    def _sign(signing_input: str) -> tuple[str, str]:
        signature = config.private_key.sign(signing_input.encode("utf-8"))
        return config.key_id, base64.b64encode(signature).decode("ascii")

    return _sign


def build_verifier(config: SliceTrustSigningConfig) -> Verifier:
    def _verify(signing_input: str, key_id: str, signature: str) -> bool:
        public_key = config.public_keys.get(key_id)
        if public_key is None:
            return False
        try:
            raw_signature = base64.b64decode(signature, validate=True)
        except (ValueError, TypeError):
            return False
        try:
            public_key.verify(raw_signature, signing_input.encode("utf-8"))
        except InvalidSignature:
            return False
        return True

    return _verify
