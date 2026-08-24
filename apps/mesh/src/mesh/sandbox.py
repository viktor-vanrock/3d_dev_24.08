"""Разбор пользовательских файлов в изолированном процессе с ulimit (MF-378).

`fork`-потомок получает cap на адресное пространство (RLIMIT_AS) до вызова
целевой функции — переполнение памяти даёт предсказуемый `MemoryError` внутри
потомка вместо убийства OOM-killer'ом ядра. Wall-clock таймаут держит
родитель (`Queue.get(timeout=...)`), т.к. RLIMIT_CPU не ловит время в
IO/свопе. Один плохой файл убивает только потомка — воркер продолжает поллинг.
"""

from __future__ import annotations

import multiprocessing as mp
import queue as queue_module
import resource
from collections.abc import Callable
from typing import Any

from .errors import RejectCode, RejectionError
from .limits import Limits

_STATUS_OK = "ok"
_STATUS_REJECTED = "rejected"
_STATUS_MEMORY = "memory"
_STATUS_ERROR = "error"


def _child_entrypoint(
    func: Callable[..., Any], args: tuple, memory_bytes: int, result_queue: mp.Queue
) -> None:
    try:
        resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
    except (ValueError, OSError):
        pass  # среда может не дать поднять cap — wall-таймаут в родителе всё равно страхует

    try:
        result = func(*args)
    except RejectionError as exc:
        result_queue.put((_STATUS_REJECTED, (exc.code.value, str(exc))))
        return
    except MemoryError as exc:
        result_queue.put((_STATUS_MEMORY, repr(exc)))
        return
    except Exception as exc:  # noqa: BLE001 — репортим родителю, не роняем потомка молча
        result_queue.put((_STATUS_ERROR, repr(exc)))
        return

    result_queue.put((_STATUS_OK, result))


def run_isolated(func: Callable[..., Any], args: tuple, limits: Limits) -> Any:
    """Выполняет `func(*args)` в отдельном процессе с cap на память и время.

    Кидает RejectionError: TIMEOUT при превышении `limits.parse_timeout_seconds`,
    MEMORY_LIMIT если потомок упёрся в RLIMIT_AS, PARSE_ERROR при любом другом
    исключении внутри потомка; структурные RejectionError, кинутые самой
    `func` (напр. из `stl_reader`), пробрасываются с исходным кодом.
    """
    ctx = mp.get_context("fork")
    result_queue: mp.Queue = ctx.Queue()
    process = ctx.Process(
        target=_child_entrypoint,
        args=(func, args, limits.parse_memory_bytes, result_queue),
        daemon=True,
    )
    process.start()

    try:
        status, payload = result_queue.get(timeout=limits.parse_timeout_seconds)
    except queue_module.Empty as exc:
        _kill(process)
        raise RejectionError(
            RejectCode.TIMEOUT, f"разбор превысил таймаут {limits.parse_timeout_seconds}s"
        ) from exc
    finally:
        result_queue.close()

    _kill(process)

    if status == _STATUS_REJECTED:
        code_value, message = payload
        raise RejectionError(RejectCode(code_value), message)
    if status == _STATUS_MEMORY:
        raise RejectionError(RejectCode.MEMORY_LIMIT, f"превышен лимит памяти разбора: {payload}")
    if status == _STATUS_ERROR:
        raise RejectionError(RejectCode.PARSE_ERROR, payload)
    return payload


def _kill(process: mp.Process) -> None:
    """Гарантированно останавливает потомка (idempotent — безопасно звать всегда)."""
    if not process.is_alive():
        process.join()
        return
    process.terminate()
    process.join(5)
    if process.is_alive():
        process.kill()
        process.join()
