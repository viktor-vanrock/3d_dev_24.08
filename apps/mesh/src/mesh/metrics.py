"""Агрегированные метрики конвейера конвертации (MF-1089, сервисный контракт).

`convert.ConversionResult`/`ConversionError` уже несут per-call данные
(duration_ms, toolchain_versions, reject code) — этот модуль агрегирует их
по потоку вызовов одного процесса (воркер живёт долго и обрабатывает много
моделей подряд), чтобы ответить на вопросы вроде «какая доля конвертаций
чинится/отклоняется» и «сколько времени в среднем/по хвосту уходит на
конвертацию», не парся логи.

Хранение — in-process, потокобезопасно (`threading.Lock`), сбрасывается при
рестарте процесса — это метрики текущего запуска воркера, не исторический
журнал (тот уже есть в `models`/`model_files` в Postgres). Долгосрочная
агрегация вне v0 (Prometheus/дашборд) — здесь только структурный снапшот,
достаточный для /metrics и логов.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field

from .errors import RejectCode


@dataclass
class _Snapshot:
    processed: int = 0
    repaired: int = 0
    rejected: int = 0
    duration_ms_total: float = 0.0
    duration_ms_samples: list[float] = field(default_factory=list)
    memory_peak_bytes: int = 0
    reject_counts: dict[str, int] = field(default_factory=dict)


_lock = threading.Lock()
_state = _Snapshot()

# Сколько последних длительностей держим для перцентилей — неограниченный рост
# списка в долгоживущем воркере съедал бы память без пользы (нужен только
# порядок величины хвоста, не точная история). 1000 конвертаций — с запасом
# на всплеск активности между рестартами процесса.
_MAX_DURATION_SAMPLES = 1000


def record_success(duration_ms: float, repaired: bool, memory_peak_bytes: int = 0) -> None:
    """Успешная конвертация: время + был ли применён repair (для доли reject/repair)."""
    with _lock:
        _state.processed += 1
        if repaired:
            _state.repaired += 1
        _state.duration_ms_total += duration_ms
        _state.memory_peak_bytes = max(_state.memory_peak_bytes, memory_peak_bytes)
        _state.duration_ms_samples.append(duration_ms)
        if len(_state.duration_ms_samples) > _MAX_DURATION_SAMPLES:
            _state.duration_ms_samples.pop(0)


def record_rejection(code: RejectCode) -> None:
    """Отклонённая конвертация (`ConversionError`/`RejectionError`) — по коду причины."""
    with _lock:
        _state.processed += 1
        _state.rejected += 1
        key = code.value
        _state.reject_counts[key] = _state.reject_counts.get(key, 0) + 1


def _percentile(sorted_samples: list[float], fraction: float) -> float:
    if not sorted_samples:
        return 0.0
    index = min(len(sorted_samples) - 1, int(len(sorted_samples) * fraction))
    return sorted_samples[index]


def snapshot() -> dict:
    """Текущий агрегат: счётчики + доли + перцентили длительности (мс).

    Доли (`repair_rate`/`reject_rate`) считаются от `processed`, а не от
    выборки длительностей — так они верны, даже если `_MAX_DURATION_SAMPLES`
    уже вытеснил старые сэмплы длительности.
    """
    with _lock:
        processed = _state.processed
        repaired = _state.repaired
        rejected = _state.rejected
        duration_total = _state.duration_ms_total
        memory_peak_bytes = _state.memory_peak_bytes
        samples = sorted(_state.duration_ms_samples)
        reject_counts = dict(_state.reject_counts)

    succeeded = processed - rejected
    return {
        "processed": processed,
        "succeeded": succeeded,
        "repaired": repaired,
        "rejected": rejected,
        "repair_rate": (repaired / succeeded) if succeeded else 0.0,
        "reject_rate": (rejected / processed) if processed else 0.0,
        "reject_counts": reject_counts,
        "memory_peak_bytes": memory_peak_bytes,
        "duration_ms": {
            "avg": (duration_total / succeeded) if succeeded else 0.0,
            "p50": _percentile(samples, 0.50),
            "p95": _percentile(samples, 0.95),
            "p99": _percentile(samples, 0.99),
        },
    }


def reset() -> None:
    """Сбрасывает агрегат — только для тестов (изоляция между test case'ами)."""
    global _state
    with _lock:
        _state = _Snapshot()
