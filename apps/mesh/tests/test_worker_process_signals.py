from __future__ import annotations

import pytest
from portal_queue_lifecycle import exercise_sigterm_entrypoint


@pytest.mark.parametrize(
    ("module", "entrypoint", "enable_variable"),
    (
        ("mesh.revision_worker", "run_loop", "MESH_REVISION_WORKER_ENABLED"),
        ("mesh.slicing_worker", "run_slice_loop", "MESH_SLICE_LIFECYCLE_ENABLED"),
    ),
)
def test_worker_process_exits_cleanly_on_sigterm(
    module: str,
    entrypoint: str,
    enable_variable: str,
) -> None:
    exercise_sigterm_entrypoint(module, entrypoint, enable_variable)
