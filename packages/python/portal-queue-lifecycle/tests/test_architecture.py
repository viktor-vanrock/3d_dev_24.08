from pathlib import Path


def test_shared_queue_package_has_one_owner_and_only_allowed_consumers() -> None:
    repository_root = Path(__file__).resolve().parents[4]
    package_roots = sorted(
        path.relative_to(repository_root).as_posix()
        for path in (repository_root / "packages" / "python").glob("*queue*")
        if path.is_dir() and path.name != "__pycache__"
    )
    assert package_roots == ["packages/python/portal-queue-lifecycle"]

    allowed_apps = {"giga", "mesh", "search"}
    consumers: set[str] = set()
    for source in (repository_root / "apps").glob("*/**/*.py"):
        if "portal_queue_lifecycle" in source.read_text(encoding="utf-8", errors="ignore"):
            consumers.add(source.relative_to(repository_root / "apps").parts[0])
    assert consumers <= allowed_apps

    scout_pyproject = (repository_root / "apps" / "scout" / "pyproject.toml").read_text()
    assert "portal-queue-lifecycle" not in scout_pyproject


def test_shared_package_does_not_define_universal_payload_or_envelope() -> None:
    package_root = Path(__file__).resolve().parents[1]
    module_names = {
        source.stem
        for source in (package_root / "src" / "portal_queue_lifecycle").glob("*.py")
    }
    assert "payload" not in module_names
    assert "envelope" not in module_names
