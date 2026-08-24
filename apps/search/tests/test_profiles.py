"""Юнит-тесты идентичности HYPERPC-профилей (identity search_index_jobs/model_embeddings)."""

from __future__ import annotations

import pytest

from portal_search import profiles


def test_view_embedding_model_prefixed_by_text_profile():
    assert profiles.view_embedding_model(0).startswith(profiles.EMBEDDING_MODEL)


def test_view_embedding_model_distinct_per_view():
    models = {profiles.view_embedding_model(i) for i in range(4)}
    assert len(models) == 4


def test_is_view_profile_true_for_view_false_for_text():
    assert profiles.is_view_profile(profiles.view_embedding_model(2)) is True
    assert profiles.is_view_profile(profiles.EMBEDDING_MODEL) is False


def test_view_index_from_profile_roundtrip():
    for i in range(5):
        assert profiles.view_index_from_profile(profiles.view_embedding_model(i)) == i


def test_view_index_from_profile_rejects_text_profile():
    with pytest.raises(ValueError):
        profiles.view_index_from_profile(profiles.EMBEDDING_MODEL)
