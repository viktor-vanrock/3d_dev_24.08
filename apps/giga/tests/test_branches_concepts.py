from __future__ import annotations

from giga.branches import BRANCHES, GenerationJob
from giga.branches import concepts as concepts_branch


def test_concepts_branch_is_registered():
    assert BRANCHES["concepts"] is concepts_branch.run_concepts


def test_concepts_branch_returns_the_same_png_as_artifact_and_preview(monkeypatch):
    config = object()
    captured: dict[str, object] = {}
    monkeypatch.setattr(concepts_branch.zimage_client, "load_config", lambda: config)
    monkeypatch.setattr(concepts_branch.zimage_client, "weights_available", lambda value: True)

    def generate(value, prompt, *, seed, filename_prefix):
        captured.update(
            config=value,
            prompt=prompt,
            seed=seed,
            filename_prefix=filename_prefix,
        )
        return b"\x89PNG\r\nconcept"

    monkeypatch.setattr(concepts_branch.zimage_client, "generate_image", generate)
    progress: list[tuple[str, int | None, int | None]] = []
    result = concepts_branch.run_concepts(
        GenerationJob(
            id="11111111-1111-1111-1111-111111111111",
            branch="concepts",
            prompt="держатель наушников с плавными волнами",
            params={
                "normalized_query": "держатель наушников",
                "label": "Держатель наушников северных волн",
            },
        ),
        lambda phase, value, *, eta_seconds=None: progress.append((phase, value, eta_seconds)),
    )

    assert result.artifact_bytes == b"\x89PNG\r\nconcept"
    assert result.preview_bytes == result.artifact_bytes
    assert result.artifact_ext == "png"
    assert result.preview_ext == "png"
    assert result.artifact_content_type == "image/png"
    assert "product shot" in str(captured["prompt"])
    assert "empty freestanding T-shaped desktop display stand" in str(
        captured["prompt"]
    )
    assert "wide gently curved top support bar" in str(captured["prompt"])
    assert "наушник" not in str(captured["prompt"]).lower()
    assert "headphone" not in str(captured["prompt"]).lower()
    assert "unpainted matte white 3D-printed plastic" in str(captured["prompt"])
    assert "future physical 3D print" in str(captured["prompt"])
    assert "seamless pure white background" in str(captured["prompt"])
    assert "Every visible surface is the same neutral white" in str(
        captured["prompt"]
    )
    assert str(captured["prompt"]).endswith(
        "No paint, colored accents, decals, graphics, multi-material parts, metallic finish, "
        "wood, glass, ceramic, or photoreal consumer-product materials."
    )
    assert captured["filename_prefix"] == "portal-concept-11111111-1111-1111-1111-111111111111"
    assert progress == [("loading", 5, 30), ("draft", 15, 24), ("export", 95, 1)]
