import os
import subprocess
import sys
import tempfile
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit

_SHARED_DATABASES = frozenset({"portal", "portal_dev", "postgres", "template0", "template1"})


@dataclass(frozen=True, slots=True)
class DisposablePostgresTarget:
    database_name: str


def require_disposable_postgres_url(database_url: str) -> DisposablePostgresTarget:
    """Fail closed unless a PostgreSQL URL names an explicitly disposable database."""

    parsed = urlsplit(database_url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise ValueError("test database URL must use postgres or postgresql")
    database_name = unquote(parsed.path.removeprefix("/"))
    require_disposable_database_name(database_name)
    return DisposablePostgresTarget(database_name=database_name)


def require_disposable_database_name(database_name: str) -> None:
    normalized = database_name.strip().lower()
    if not normalized:
        raise ValueError("test database name must not be empty")
    if normalized in _SHARED_DATABASES:
        raise ValueError(f"shared database {normalized!r} is forbidden for destructive tests")
    if not (
        normalized.startswith("test_")
        or normalized.startswith("sandbox_")
        or normalized.endswith("_test")
        or normalized.endswith("_sandbox")
    ):
        raise ValueError("disposable database name must be explicitly marked test or sandbox")


def require_expected_database(*, expected: str, actual: str) -> None:
    """Verify server identity after connection before any schema mutation."""

    require_disposable_database_name(expected)
    require_disposable_database_name(actual)
    if actual != expected:
        raise ValueError(f"connected database {actual!r} does not match URL target {expected!r}")


def exercise_sigterm_entrypoint(
    module: str,
    entrypoint: str,
    enable_variable: str,
    *,
    ready_timeout_seconds: float = 10,
    exit_timeout_seconds: float = 3,
) -> None:
    """Run a real worker entrypoint and prove its installed SIGTERM path exits cleanly."""

    environment = dict(os.environ)
    environment.pop("DATABASE_URL", None)
    environment[enable_variable] = "0"
    with tempfile.TemporaryDirectory(prefix="queue-sigterm-") as temporary:
        ready_path = Path(temporary) / "ready"
        child_code = f"""
import pathlib
import signal

ready_path = pathlib.Path({str(ready_path)!r})
real_signal = signal.signal
def observe_install(signum, handler):
    previous = real_signal(signum, handler)
    if signum == signal.SIGINT:
        ready_path.write_text("ready", encoding="utf-8")
    return previous
signal.signal = observe_install

from {module} import {entrypoint}
{entrypoint}()
"""
        child = subprocess.Popen(
            [sys.executable, "-c", child_code],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            env=environment,
        )
        try:
            ready_deadline = time.monotonic() + ready_timeout_seconds
            while not ready_path.exists() and child.poll() is None:
                if time.monotonic() >= ready_deadline:
                    raise AssertionError("worker did not install signal handlers before timeout")
                time.sleep(0.02)
            if not ready_path.exists():
                stderr = child.stderr.read() if child.stderr is not None else ""
                raise AssertionError(f"worker exited before signal handlers were ready: {stderr}")
            child.terminate()
            return_code = child.wait(timeout=exit_timeout_seconds)
            if return_code != 0:
                stderr = child.stderr.read() if child.stderr is not None else ""
                raise AssertionError(
                    f"worker exited with {return_code} after SIGTERM: {stderr}"
                )
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=exit_timeout_seconds)


def run_until_ready_then_sigkill(
    child_code: str,
    environment: Mapping[str, str],
    *,
    ready_timeout_seconds: float = 10,
    exit_timeout_seconds: float = 3,
) -> str:
    """SIGKILL a subprocess only after it has persisted its claimed-token evidence."""

    with tempfile.TemporaryDirectory(prefix="queue-sigkill-") as temporary:
        ready_path = Path(temporary) / "ready"
        child_environment = dict(environment)
        child_environment["PORTAL_QUEUE_CRASH_READY_FILE"] = str(ready_path)
        child = subprocess.Popen(
            [sys.executable, "-c", child_code],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            env=child_environment,
        )
        try:
            ready_deadline = time.monotonic() + ready_timeout_seconds
            while not ready_path.exists() and child.poll() is None:
                if time.monotonic() >= ready_deadline:
                    raise AssertionError("worker did not persist claim evidence before timeout")
                time.sleep(0.02)
            if not ready_path.exists():
                stderr = child.stderr.read() if child.stderr is not None else ""
                raise AssertionError(f"worker exited before claim evidence: {stderr}")
            evidence = ready_path.read_text(encoding="utf-8")
            child.kill()
            return_code = child.wait(timeout=exit_timeout_seconds)
            if return_code == 0:
                raise AssertionError("SIGKILLed worker unexpectedly exited successfully")
            return evidence
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=exit_timeout_seconds)
