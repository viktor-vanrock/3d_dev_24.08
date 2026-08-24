"""Юнит-тесты `giga.assistant.skills` — versioned server-owned реестр (MF-2046)."""

from __future__ import annotations

from giga.assistant import skills


def test_registry_entries_have_schema_scope_and_mutating_flag():
    for skill in skills.SKILL_REGISTRY.values():
        assert skill.name
        assert skill.description
        assert isinstance(skill.input_schema, dict)
        assert skill.input_schema.get("type") == "object"
        assert skill.required_scope
        assert isinstance(skill.mutating, bool)
        assert skill.modes


def test_catalog_search_is_read_only_and_universally_available():
    catalog_search = skills.SKILL_REGISTRY["catalog_search"]
    assert catalog_search.mutating is False
    assert catalog_search.modes == frozenset({"page", "global", "assistant"})


def test_generation_offer_is_mutating_and_not_available_on_page():
    generation_offer = skills.SKILL_REGISTRY["generation_offer"]
    assert generation_offer.mutating is True
    assert "page" not in generation_offer.modes


def test_skills_for_page_mode_excludes_mutating_generation_offer():
    result = skills.skills_for("page", skills.DEFAULT_SCOPES)
    names = {s.name for s in result}
    assert names == {"catalog_search"}


def test_skills_for_global_mode_includes_both_with_default_scopes():
    result = skills.skills_for("global", skills.DEFAULT_SCOPES)
    names = {s.name for s in result}
    assert names == {"catalog_search", "generation_offer"}


def test_skills_for_respects_scope_filtering_even_in_assistant_mode():
    result = skills.skills_for("assistant", frozenset({skills.SCOPE_CATALOG_READ}))
    names = {s.name for s in result}
    assert names == {"catalog_search"}


def test_skills_for_empty_scopes_returns_nothing():
    assert skills.skills_for("global", frozenset()) == []


def test_catalog_search_input_bounds_query_and_limit():
    parsed = skills.CatalogSearchInput.model_validate({"query": "дракон", "limit": 3})
    assert parsed.query == "дракон"
    assert parsed.limit == 3

    defaulted = skills.CatalogSearchInput.model_validate({"query": "дракон"})
    assert defaulted.limit == 6
