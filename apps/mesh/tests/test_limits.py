from mesh.limits import load_limits


def test_defaults_are_positive():
    limits = load_limits()
    assert limits.max_file_bytes > 0
    assert limits.max_triangles > 0
    assert limits.max_zip_uncompressed_bytes > 0
    assert limits.max_zip_compression_ratio > 0
    assert limits.max_zip_entries > 0
    assert limits.parse_timeout_seconds > 0
    assert limits.parse_memory_bytes > 0


def test_env_overrides_defaults(monkeypatch):
    monkeypatch.setenv("MESH_MAX_FILE_BYTES", "123")
    monkeypatch.setenv("MESH_MAX_TRIANGLES", "7")
    monkeypatch.setenv("MESH_PARSE_TIMEOUT_SECONDS", "1.5")

    limits = load_limits()

    assert limits.max_file_bytes == 123
    assert limits.max_triangles == 7
    assert limits.parse_timeout_seconds == 1.5
