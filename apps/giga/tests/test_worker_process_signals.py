from __future__ import annotations

import pytest
from portal_queue_lifecycle import exercise_sigterm_entrypoint


@pytest.mark.parametrize(
    ("module", "entrypoint", "enable_variable"),
    (
        ("giga.lifecycle_worker", "run_loop", "GIGA_LIFECYCLE_ENABLED"),
        (
            "giga.assistant.lifecycle_worker",
            "run_loop",
            "ASSISTANT_LIFECYCLE_ENABLED",
        ),
    ),
)
def test_worker_process_exits_cleanly_on_sigterm(
    module: str,
    entrypoint: str,
    enable_variable: str,
) -> None:
    exercise_sigterm_entrypoint(module, entrypoint, enable_variable)
