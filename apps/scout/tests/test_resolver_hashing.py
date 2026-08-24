from __future__ import annotations

import hashlib

from scout.resolver.hashing import content_hash, stable_stringify


def test_stable_stringify_sorts_keys_no_spaces():
    assert stable_stringify({"b": 1, "a": 2}) == '{"a":2,"b":1}'


def test_stable_stringify_integral_float_has_no_trailing_zero():
    """JS `JSON.stringify` не различает int/float — `250.0` должно печататься
    как `250`, иначе тот же specs даёт разный хэш в Python/TS рантаймах
    (см. докстринг `hashing.py`)."""
    assert stable_stringify(250.0) == "250"
    assert stable_stringify(250) == "250"
    assert stable_stringify(0.5) == "0.5"


def test_stable_stringify_nested_structure():
    value = {
        "vendor": "creality",
        "model": "Ender-3 V2",
        "specs": {"build_volume": {"x": 220.0, "y": 220.0}},
    }
    text = stable_stringify(value)
    assert text == (
        '{"model":"Ender-3 V2","specs":{"build_volume":{"x":220,"y":220}},"vendor":"creality"}'
    )


def test_content_hash_matches_manual_sha256():
    expected = hashlib.sha256(b'{"model":"Ender-3 V2","specs":{},"vendor":"creality"}').digest()
    assert content_hash("creality", "Ender-3 V2", {}) == expected


def test_content_hash_differs_when_specs_differ():
    a = content_hash("creality", "Ender-3 V2", {"build_volume": {"x": 220, "y": 220, "z": 250}})
    b = content_hash("creality", "Ender-3 V2", {"build_volume": {"x": 220, "y": 220, "z": 300}})
    assert a != b


def test_content_hash_is_deterministic():
    specs = {"nozzle_diameters": [0.4, 0.6]}
    assert content_hash("prusa-research", "Prusa MK4S", specs) == content_hash(
        "prusa-research", "Prusa MK4S", specs
    )
