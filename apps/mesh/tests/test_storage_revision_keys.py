from mesh.storage import (
    canonical_3mf_key,
    mobile_preview_glb_key,
    part_preview_glb_key,
    part_thumbnail_webp_key,
    preview_glb_key,
    stl_derivative_key,
    thumbnail_webp_key,
)


def test_all_derived_keys_are_immutable_per_revision() -> None:
    first = "revision-1"
    second = "revision-2"
    key_pairs = (
        (canonical_3mf_key("model-1", first), canonical_3mf_key("model-1", second)),
        (preview_glb_key("model-1", first), preview_glb_key("model-1", second)),
        (thumbnail_webp_key("model-1", first), thumbnail_webp_key("model-1", second)),
        (
            mobile_preview_glb_key("model-1", first),
            mobile_preview_glb_key("model-1", second),
        ),
        (
            stl_derivative_key("model-1", first),
            stl_derivative_key("model-1", second),
        ),
        (
            part_preview_glb_key("model-1", first, "part-1"),
            part_preview_glb_key("model-1", second, "part-1"),
        ),
        (
            part_thumbnail_webp_key("model-1", first, "part-1"),
            part_thumbnail_webp_key("model-1", second, "part-1"),
        ),
    )

    assert all(first_key != second_key for first_key, second_key in key_pairs)
    assert all(f"/revisions/{first}/" in first_key for first_key, _ in key_pairs)
    assert all(f"/revisions/{second}/" in second_key for _, second_key in key_pairs)
