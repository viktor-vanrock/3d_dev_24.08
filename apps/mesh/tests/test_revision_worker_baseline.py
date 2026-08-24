from pathlib import Path


def test_mesh_worker_entrypoint_cannot_reach_legacy_model_queue_sql() -> None:
    mesh_root = Path(__file__).resolve().parents[1]
    repository_root = mesh_root.parents[1]
    pyproject = (mesh_root / "pyproject.toml").read_text(encoding="utf-8")
    runtime_sources = "\n".join(
        (mesh_root / relative).read_text(encoding="utf-8")
        for relative in (
            "src/mesh/revision_worker.py",
            "src/mesh/conversion_queue.py",
            "src/mesh/backfill.py",
        )
    )

    assert 'mesh-worker = "mesh.revision_worker:run_loop"' in pyproject
    assert "update models set status" not in runtime_sources.lower()
    assert "from model_files" not in runtime_sources.lower()
    assert "join model_files" not in runtime_sources.lower()
    assert "QueueWorkerRunner(" in runtime_sources
    assert "ShutdownController(" in runtime_sources
    assert "collect_metrics()" in runtime_sources
    assert not (mesh_root / "src/mesh/worker.py").exists()

    schema = (repository_root / "apps" / "api" / "db" / "schema.sql").read_text(
        encoding="utf-8"
    )
    models_table = schema.split("CREATE TABLE public.models (", 1)[1].split("\n);", 1)[0]
    assert "source_format" not in models_table
    assert "status text" not in models_table
    assert "bbox jsonb" not in models_table
    assert "CREATE TABLE public.model_files" not in schema
