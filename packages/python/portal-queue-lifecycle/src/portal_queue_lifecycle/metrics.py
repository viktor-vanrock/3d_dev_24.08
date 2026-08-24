import os
import re
from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import final

_ALLOWED_LABELS = frozenset({"queue", "operation", "outcome"})
_SAFE_QUEUE_NAME = re.compile(r"[^a-zA-Z0-9_-]+")


def _validate_labels(labels: Mapping[str, str]) -> None:
    unexpected = set(labels).difference(_ALLOWED_LABELS)
    if unexpected:
        names = ", ".join(sorted(unexpected))
        raise ValueError(f"high-cardinality queue metric labels are forbidden: {names}")


def _key(name: str, labels: Mapping[str, str]) -> tuple[str, tuple[tuple[str, str], ...]]:
    _validate_labels(labels)
    return name, tuple(sorted(labels.items()))


def _prometheus_labels(labels: tuple[tuple[str, str], ...]) -> str:
    if not labels:
        return ""
    rendered: list[str] = []
    for name, value in labels:
        escaped = value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')
        rendered.append(f'{name}="{escaped}"')
    return "{" + ",".join(rendered) + "}"


@final
class NoopMetricsSink:
    def increment(
        self, name: str, *, labels: dict[str, str], value: float = 1.0
    ) -> None:
        del name, labels, value

    def gauge(self, name: str, value: float, *, labels: dict[str, str]) -> None:
        del name, value, labels


@dataclass(frozen=True, slots=True)
class MetricSample:
    name: str
    labels: tuple[tuple[str, str], ...]
    value: float


@final
class InMemoryMetricsSink:
    """Thread-safe test sink with no high-cardinality lifecycle labels."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._counters: defaultdict[tuple[str, tuple[tuple[str, str], ...]], float] = (
            defaultdict(float)
        )
        self._gauges: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}

    def increment(
        self, name: str, *, labels: dict[str, str], value: float = 1.0
    ) -> None:
        with self._lock:
            self._counters[_key(name, labels)] += value

    def gauge(self, name: str, value: float, *, labels: dict[str, str]) -> None:
        with self._lock:
            self._gauges[_key(name, labels)] = value

    def counters(self) -> tuple[MetricSample, ...]:
        with self._lock:
            return tuple(
                MetricSample(name, labels, value)
                for (name, labels), value in sorted(self._counters.items())
            )

    def gauges(self) -> tuple[MetricSample, ...]:
        with self._lock:
            return tuple(
                MetricSample(name, labels, value)
                for (name, labels), value in sorted(self._gauges.items())
            )


@final
class PrometheusTextfileMetricsSink:
    """Low-cardinality Prometheus exposition written atomically for node_exporter."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = Lock()
        self._counters: defaultdict[tuple[str, tuple[tuple[str, str], ...]], float] = (
            defaultdict(float)
        )
        self._gauges: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}

    def increment(
        self, name: str, *, labels: dict[str, str], value: float = 1.0
    ) -> None:
        with self._lock:
            self._counters[_key(name, labels)] += value
            self._write_locked()

    def gauge(self, name: str, value: float, *, labels: dict[str, str]) -> None:
        with self._lock:
            self._gauges[_key(name, labels)] = value
            self._write_locked()

    def counters(self) -> tuple[MetricSample, ...]:
        with self._lock:
            return tuple(
                MetricSample(name, labels, value)
                for (name, labels), value in sorted(self._counters.items())
            )

    def gauges(self) -> tuple[MetricSample, ...]:
        with self._lock:
            return tuple(
                MetricSample(name, labels, value)
                for (name, labels), value in sorted(self._gauges.items())
            )

    def _write_locked(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(f".{self.path.name}.{os.getpid()}.tmp")
        lines = [
            f"{name}{_prometheus_labels(labels)} {value:.17g}"
            for (name, labels), value in sorted(
                (*self._counters.items(), *self._gauges.items()),
                key=lambda item: item[0],
            )
        ]
        temporary.write_text("\n".join(lines) + "\n", encoding="utf-8")
        temporary.replace(self.path)


def metrics_sink_from_env(queue: str) -> InMemoryMetricsSink | PrometheusTextfileMetricsSink:
    """Build the process sink; an unset directory keeps the existing log/test sink."""

    directory = os.getenv("PORTAL_QUEUE_METRICS_DIR")
    if not directory:
        return InMemoryMetricsSink()
    filename = _SAFE_QUEUE_NAME.sub("-", queue).strip("-") or "queue"
    return PrometheusTextfileMetricsSink(Path(directory) / f"{filename}.prom")
