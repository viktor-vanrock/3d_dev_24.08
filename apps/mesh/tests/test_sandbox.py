import os
import subprocess
import time
from dataclasses import replace

import pytest

from mesh.errors import RejectCode, RejectionError
from mesh.limits import load_limits
from mesh.sandbox import run_isolated


def _add_one(x: int) -> int:
    return x + 1


def _sleep(seconds: float) -> str:
    time.sleep(seconds)
    return "done"


def _boom() -> None:
    raise ValueError("kaboom")


def _reject() -> None:
    raise RejectionError(RejectCode.NOT_MESH, "нет геометрии")


def _allocate_too_much(n_bytes: int) -> int:
    # Только аллокация, без reduce/BLAS-операций (`.sum()` и т.п. дёргают
    # OpenBLAS, который под тесным RLIMIT_AS уходит в свой retry-луп и падает
    # мимо Python-исключений — сам malloc numpy честно даёт MemoryError).
    import numpy as np

    array = np.zeros(n_bytes, dtype=np.uint8)
    return array.shape[0]


def test_run_isolated_returns_result():
    limits = load_limits()

    result = run_isolated(_add_one, (41,), limits)

    assert result == 42


def test_run_isolated_times_out():
    limits = replace(load_limits(), parse_timeout_seconds=0.2)

    with pytest.raises(RejectionError) as exc_info:
        run_isolated(_sleep, (5,), limits)

    assert exc_info.value.code == RejectCode.TIMEOUT


def test_run_isolated_wraps_plain_exception():
    limits = load_limits()

    with pytest.raises(RejectionError) as exc_info:
        run_isolated(_boom, (), limits)

    assert exc_info.value.code == RejectCode.PARSE_ERROR
    assert "kaboom" in str(exc_info.value)


def test_run_isolated_preserves_rejection_code():
    limits = load_limits()

    with pytest.raises(RejectionError) as exc_info:
        run_isolated(_reject, (), limits)

    assert exc_info.value.code == RejectCode.NOT_MESH


def _current_vsz_bytes() -> int:
    proc_status = "/proc/self/status"
    if os.path.exists(proc_status):
        with open(proc_status) as handle:
            for line in handle:
                if line.startswith("VmSize:"):
                    return int(line.split()[1]) * 1024
        raise RuntimeError("VmSize не найден в /proc/self/status")
    # macOS has no procfs; POSIX ps reports VSZ in KiB.
    output = subprocess.run(
        ["ps", "-o", "vsz=", "-p", str(os.getpid())],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return int(output.strip()) * 1024


def test_run_isolated_enforces_memory_limit():
    # Лимит считаем от фактического baseline процесса (а не абсолютным числом) —
    # к этому моменту в сюите уже импортированы trimesh/lib3mf/numpy другими
    # тестами, и `fork` наследует это адресное пространство. Небольшой запас
    # сверх baseline пропускает обычную работу, но не аллокацию 2 GiB.
    memory_cap = _current_vsz_bytes() + 200 * 1024 * 1024
    limits = replace(load_limits(), parse_memory_bytes=memory_cap, parse_timeout_seconds=15)

    with pytest.raises(RejectionError) as exc_info:
        run_isolated(_allocate_too_much, (2 * 1024 * 1024 * 1024,), limits)

    assert exc_info.value.code == RejectCode.MEMORY_LIMIT
