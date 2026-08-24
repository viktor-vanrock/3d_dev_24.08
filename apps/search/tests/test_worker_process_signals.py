from __future__ import annotations

from portal_queue_lifecycle import exercise_sigterm_entrypoint


def test_worker_process_exits_cleanly_on_sigterm() -> None:
    exercise_sigterm_entrypoint(
        "portal_search.lifecycle_worker",
        "run_loop",
        "SEARCH_LIFECYCLE_ENABLED",
    )
