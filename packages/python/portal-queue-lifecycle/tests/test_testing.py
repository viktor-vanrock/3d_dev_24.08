from __future__ import annotations

import pytest

from portal_queue_lifecycle import (
    DisposablePostgresTarget,
    require_disposable_database_name,
    require_disposable_postgres_url,
    require_expected_database,
)


@pytest.mark.parametrize("database_name", ["portal", "portal_dev", "postgres"])
def test_disposable_database_guard_rejects_shared_database(database_name: str) -> None:
    with pytest.raises(ValueError, match="shared database"):
        require_disposable_database_name(database_name)


def test_disposable_database_guard_rejects_unmarked_database() -> None:
    with pytest.raises(ValueError, match="explicitly marked"):
        require_disposable_database_name("queue_contract")


@pytest.mark.parametrize("database_name", ["queue_contract_test", "sandbox_queue_contract"])
def test_disposable_database_guard_accepts_explicit_test_or_sandbox_name(
    database_name: str,
) -> None:
    require_disposable_database_name(database_name)


def test_disposable_postgres_url_returns_validated_target() -> None:
    target = require_disposable_postgres_url(
        "postgresql://portal:secret@127.0.0.1:5432/queue_contract_test"
    )

    assert target == DisposablePostgresTarget(database_name="queue_contract_test")


def test_disposable_postgres_url_rejects_non_postgres_scheme() -> None:
    with pytest.raises(ValueError, match="postgres or postgresql"):
        require_disposable_postgres_url("sqlite:///queue_contract_test")


def test_expected_database_guard_rejects_actual_database_mismatch() -> None:
    with pytest.raises(ValueError, match="does not match"):
        require_expected_database(expected="queue_contract_test", actual="other_queue_test")


def test_expected_database_guard_accepts_exact_disposable_database() -> None:
    require_expected_database(expected="queue_contract_test", actual="queue_contract_test")
