from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import patch

from scout.news.canonical import canonicalize_url, source_fingerprint
from scout.news.fetch import RetrievedSource
from scout.news.model import GrokModelConfig, LocalModelConfig
from scout.news.pipeline import NewsPipeline, load_brands
from scout.news.run import build_parser


def _brand(brand_id: str) -> dict:
    return {
        "brand_id": brand_id,
        "name": brand_id.title(),
        "official_hosts": ["official.example"],
        "discovery_urls": [
            {"url": f"https://official.example/news/{brand_id}", "publisher": "Official"}
        ],
        "community_subject_hint": {
            "subject_type": "vendor",
            "subject_id": None,
            "subject_slug": brand_id,
            "display_name": brand_id.title(),
            "confidence": 1,
            "evidence_claim_ids": [],
        },
    }


@dataclass
class _FakeModel:
    config: LocalModelConfig
    calls: list[dict]

    def complete(self, *, system: str, payload: dict, schema: dict) -> dict:
        self.calls.append(payload)
        if self.config.role == "researcher":
            brand_id = payload["brand"]["brand_id"]
            if brand_id == "empty":
                return {
                    "outcome": "no_news",
                    "title": "",
                    "summary": "",
                    "claims": [],
                    "semantic_label_suggestions": [],
                    "reason": "No eligible official news",
                }
            quote = "Official evidence sentence with a concrete supported fact."
            if brand_id == "unsupported":
                quote = "This quote was invented by the model."
            source_id = payload["official_sources"][0]["source_id"]
            return {
                "outcome": "candidate",
                "title": f"News for {brand_id}",
                "summary": "A source-backed summary.",
                "claims": [
                    {
                        "claim_id": "c1",
                        "text": "Подтверждённый факт.",
                        "source_ids": [source_id],
                        "evidence": [{"source_id": source_id, "quote": quote}],
                    }
                ],
                "semantic_label_suggestions": [
                    {"label": "product_update", "confidence": 0.9, "evidence_claim_ids": ["c1"]}
                ],
                "reason": "",
            }
        candidate = payload["research"]["candidate"]
        source_id = candidate["source_records"][0]["source_id"]
        diagram = (
            "```mermaid\n"
            "flowchart LR\n"
            "  A[Официальный источник] --> B[Подтверждённый факт]\n"
            "```"
        )
        body = (
            "Производитель сообщил подтверждённый факт [claim:c1]. Материал объясняет новость "
            "по официальному первичному источнику без неподтверждённых выводов.\n\n"
            "## Что известно\n\n"
            "Официальный источник подтверждает опубликованный факт [claim:c1].\n\n"
            "- Факт прямо подтверждён первичным источником [claim:c1].\n"
            "- Дополнительные предположения в материал не включены.\n\n"
            "## Как устроена проверка\n\n"
            "Схема показывает путь подтверждения без новых фактических утверждений.\n\n"
            f"{diagram}"
        )
        if candidate["title"] == "News for uncited":
            body = body.replace(" [claim:c1]", "")
        blocks = [
            {
                "block_id": "source.1",
                "kind": "source",
                "source_id": source_id,
                "claim_ids": ["c1"],
                "label": "Официальный источник",
            }
        ]
        if payload["source_assets"]:
            asset = payload["source_assets"][0]
            image_url = asset["image_url"]
            body = body.replace(
                "## Как устроена проверка",
                f"![{asset['alt']}]({image_url})\n\n## Как устроена проверка",
            ).replace(diagram, "Визуальный блок подтверждён метаданными источника.")
            blocks.insert(
                0,
                {
                    "block_id": "image.1",
                    "kind": "image",
                    "source_id": source_id,
                    "image_url": image_url,
                    "alt": asset["alt"],
                    "caption": None,
                    "content_hash": None,
                },
            )
            if candidate["title"] == "News for typed-only":
                body = body.replace(f"![{asset['alt']}]({image_url})\n\n", "")
        if candidate["title"] == "News for unverified-image":
            body = body.replace(
                diagram,
                "![Непроверенное изображение](https://untrusted.example/image.jpg)",
            )
        if candidate["title"] == "News for flat":
            body = body.replace("## ", "### ")
        if candidate["title"] == "News for trailing":
            body += "\n\n"
        if candidate["title"] == "News for no-source-block":
            blocks = [block for block in blocks if block["kind"] != "source"]
        return {
            "title": candidate["title"],
            "dek": "Краткий редакционный лид объясняет подтверждённую новость без домыслов.",
            "body_markdown": body,
            "body_ast": [
                {"type": "markdown", "markdown": body},
                {"type": "block_ref", "block_id": "source.1"},
            ],
            "blocks": blocks,
        }

    def close(self) -> None:
        pass


class _FakeFetcher:
    def close(self) -> None:
        pass

    def fetch(self, url: str, allowed_hosts: list[str], publisher: str) -> RetrievedSource:
        brand_id = url.rsplit("/", 1)[-1]
        if brand_id == "broken":
            raise TimeoutError("official source timed out")
        fingerprint = source_fingerprint(url)
        return RetrievedSource(
            source_id=f"src_{brand_id}",
            canonical_url=url,
            title=f"Official {brand_id}",
            publisher=publisher,
            published_at="2026-07-22T00:00:00Z",
            retrieved_at="2026-07-22T12:00:00Z",
            content_hash="sha256:content",
            source_fingerprint=fingerprint,
            text=(
                "Official evidence sentence with a concrete supported fact. "
                "Additional official context for the news article."
            ),
            image_url=(
                "https://cdn.official.example/news/hero.jpg"
                if brand_id in {"pictured", "typed-only"}
                else None
            ),
        )


@dataclass
class _FakeModerator:
    config: GrokModelConfig
    decisions: list[str]
    calls: list[dict]

    def complete(self, *, system: str, payload: dict, schema: dict) -> dict:
        self.calls.append(payload)
        decision = self.decisions[min(len(self.calls) - 1, len(self.decisions) - 1)]
        issue = {
            "issue_id": "model-generated-id",
            "code": "editorial_quality",
            "message": "Make the supported wording more precise.",
            "evidence": {"claim_ids": ["c1"], "source_ids": ["src_ready"]},
            "locations": [{"kind": "claim", "claim_id": "c1"}],
        }
        source_id = payload["candidate"]["source_records"][0]["source_id"]
        issue["evidence"]["source_ids"] = [source_id]
        return {
            "decision": decision,
            "rationale": f"Moderator chose {decision}.",
            "issues": [] if decision == "accept" else [issue],
            "api_feedback": (
                [
                    {
                        "feedback_id": "model-feedback-id",
                        "surface": "moderation_audit",
                        "summary": "Show claim coverage.",
                        "rationale": "A reviewer could confirm evidence faster.",
                        "evidence": {"claim_ids": ["c1"], "source_ids": [source_id]},
                        "disposition": "advisory_only",
                        "automatic_change_allowed": False,
                    }
                ]
                if decision == "accept"
                else []
            ),
        }

    def close(self) -> None:
        pass


def _pipeline() -> tuple[NewsPipeline, _FakeModel, _FakeModel]:
    researcher = _FakeModel(
        LocalModelConfig("researcher", "http://slot2", "gemma", "researcher.v2", 100), []
    )
    composer = _FakeModel(
        LocalModelConfig("composer", "http://slot1", "qwen", "composer.v2", 100), []
    )
    pipeline = NewsPipeline(
        researcher=researcher,
        composer=composer,
        fetcher_factory=_FakeFetcher,
        max_parallel_brands=1,
    )
    return pipeline, researcher, composer


def _moderator(*decisions: str) -> _FakeModerator:
    return _FakeModerator(
        GrokModelConfig("moderator", "grok", "grok-4.5", "grok-4.5", "moderator.v2"),
        list(decisions),
        [],
    )


def test_canonicalize_url_strips_tracking_fragment_and_sorts_query():
    assert canonicalize_url("HTTPS://Example.COM:443/news/?utm_source=x&b=2&a=1#top") == (
        "https://example.com/news?a=1&b=2"
    )


def test_versioned_brand_hints_use_portable_catalog_slugs_not_community_ids():
    brands = load_brands()

    for brand in brands:
        hint = brand["community_subject_hint"]
        assert hint["subject_id"] is None
        assert hint["subject_slug"]


def test_systemd_environment_can_limit_the_first_run_to_one_canary_brand():
    with patch.dict("os.environ", {"SCOUT_NEWS_BRAND_FILTER": "bambu.lab"}, clear=False):
        parser = build_parser()

    args = parser.parse_args(["--output", "artifact.json"])
    assert args.brand == ["bambu.lab"]


def test_batch_isolates_normal_outcomes_and_failures():
    pipeline, researcher, composer = _pipeline()

    artifact = pipeline.run_batch([_brand("ready"), _brand("empty"), _brand("broken")])

    assert artifact["zero_write"] is True
    assert artifact["summary"] == {
        "total": 3,
        "outcomes": {"ready_for_moderation": 1, "no_news": 1, "retryable_failure": 1},
    }
    assert len(researcher.calls) == 2
    assert len(composer.calls) == 1
    ready = artifact["items"][0]
    assert ready["research"]["schema_version"] == "news-research-findings.v2"
    assert ready["composition"]["schema_version"] == "news-composition.v2"
    assert ready["research"]["run"]["role"] == "local_researcher"
    assert ready["composition"]["run"]["role"] == "local_composer"
    assert ready["composition"]["research_artifact_id"] == ready["research"]["artifact_id"]
    assert "text" not in ready["research"]["candidate"]["source_records"][0]


def test_composer_receives_confirmed_source_image_and_host_builds_typed_ast():
    pipeline, _, composer = _pipeline()

    artifact = pipeline.run_batch([_brand("pictured")])

    item = artifact["items"][0]
    assert item["outcome"] == "ready_for_moderation"
    assert composer.calls[0]["source_assets"] == [
        {
            "source_id": "src_pictured",
            "image_url": "https://cdn.official.example/news/hero.jpg",
            "alt": "Official pictured",
        }
    ]
    draft = item["composition"]["draft"]
    assert [block["block_id"] for block in draft["blocks"]] == ["image.1", "source.1"]
    assert [node["type"] for node in draft["body_ast"]] == [
        "markdown",
        "block_ref",
        "markdown",
        "block_ref",
    ]
    assert draft["body_ast"][1] == {"type": "block_ref", "block_id": "image.1"}


def test_host_adds_verified_markdown_fallback_for_typed_only_image():
    pipeline, _, _ = _pipeline()

    artifact = pipeline.run_batch([_brand("typed-only")])

    item = artifact["items"][0]
    assert item["outcome"] == "ready_for_moderation"
    body = item["composition"]["draft"]["body_markdown"]
    assert "![Official typed-only](https://cdn.official.example/news/hero.jpg)" in body


def test_host_removes_trailing_whitespace_after_terminal_mermaid_fence():
    pipeline, _, _ = _pipeline()

    artifact = pipeline.run_batch([_brand("trailing")])

    body = artifact["items"][0]["composition"]["draft"]["body_markdown"]
    assert body.endswith("\n```")


def test_host_projects_source_blocks_from_candidate_evidence_graph():
    pipeline, _, _ = _pipeline()

    artifact = pipeline.run_batch([_brand("no-source-block")])

    item = artifact["items"][0]
    assert item["outcome"] == "ready_for_moderation"
    assert item["composition"]["draft"]["blocks"] == [
        {
            "block_id": "source.1",
            "kind": "source",
            "source_id": "src_no-source-block",
            "claim_ids": ["c1"],
            "label": "Official",
        }
    ]


def test_unverified_markdown_image_is_rejected_before_moderation():
    pipeline, _, _ = _pipeline()

    artifact = pipeline.run_batch([_brand("unverified-image")])

    item = artifact["items"][0]
    assert item["outcome"] == "quality_rejected"
    assert "uses unverified image" in item["detail"]["message"]


def test_editorial_body_requires_two_h2_sections():
    pipeline, _, _ = _pipeline()

    artifact = pipeline.run_batch([_brand("flat")])

    item = artifact["items"][0]
    assert item["outcome"] == "quality_rejected"
    assert "at least two H2 sections" in item["detail"]["message"]


def test_host_completes_only_candidate_backed_moderation_evidence_links():
    candidate = {
        "source_records": [{"source_id": "src.1"}],
        "claims": [{"claim_id": "claim.1", "source_ids": ["src.1"]}],
    }
    result = {
        "issues": [
            {
                "issue_id": "model-id",
                "evidence": {"claim_ids": [], "source_ids": ["src.1"]},
            }
        ],
        "api_feedback": [
            {
                "feedback_id": "model-feedback-id",
                "evidence": {"claim_ids": ["claim.1"], "source_ids": []},
            }
        ],
    }

    stabilized = NewsPipeline._stabilize_moderation(result, candidate)

    assert stabilized["issues"][0]["evidence"] == {
        "claim_ids": ["claim.1"],
        "source_ids": ["src.1"],
    }
    assert stabilized["api_feedback"][0]["evidence"] == {
        "claim_ids": ["claim.1"],
        "source_ids": ["src.1"],
    }

    empty = NewsPipeline._stabilize_moderation(
        {
            "issues": [{"issue_id": "empty", "evidence": {"claim_ids": [], "source_ids": []}}],
            "api_feedback": [],
        },
        candidate,
    )
    assert empty["issues"][0]["evidence"] is None


def test_unsupported_researcher_claim_is_rejected_before_composer():
    pipeline, _, composer = _pipeline()

    artifact = pipeline.run_batch([_brand("unsupported")])

    assert artifact["items"][0]["outcome"] == "quality_rejected"
    assert artifact["items"][0]["detail"]["code"] == "unsupported_content"
    assert len(composer.calls) == 0


def test_known_fingerprint_bypasses_both_models():
    pipeline, researcher, composer = _pipeline()
    brand = _brand("duplicate")
    known = {source_fingerprint(brand["discovery_urls"][0]["url"])}

    artifact = pipeline.run_batch([brand], known)

    assert artifact["items"][0]["outcome"] == "exact_duplicate"
    assert researcher.calls == []
    assert composer.calls == []


def test_grok_accept_requires_host_validated_claim_coverage_and_returns_ready():
    pipeline, researcher, composer = _pipeline()
    moderator = _moderator("accept")
    pipeline.moderator = moderator

    artifact = pipeline.run_batch([_brand("ready")])

    item = artifact["items"][0]
    assert item["outcome"] == "ready"
    assert item["revision_count"] == 0
    assert item["moderation"]["decision"] == "accept"
    assert item["moderation"]["run"]["role"] == "grok_moderator"
    assert item["moderation"]["run"]["executor"] == {
        "kind": "model",
        "locality": "remote_api",
        "model_family": "grok",
        "identity": {"provider": "xai", "model": "grok-4.5", "model_version": "grok-4.5"},
    }
    assert item["moderation"]["api_feedback"][0]["automatic_change_allowed"] is False
    assert len(researcher.calls) == len(composer.calls) == len(moderator.calls) == 1


def test_host_projects_missing_candidate_claim_citations_before_moderation():
    pipeline, _, _ = _pipeline()
    moderator = _moderator("accept")
    pipeline.moderator = moderator

    artifact = pipeline.run_batch([_brand("uncited")])

    item = artifact["items"][0]
    assert item["outcome"] == "ready"
    body = item["composition"]["draft"]["body_markdown"]
    assert "### Подтверждено источниками" in body
    assert "- Подтверждённый факт. [claim:c1]" in body
    assert len(moderator.calls) == 1


def test_revise_returns_to_composer_at_most_twice_then_accepts():
    pipeline, _, composer = _pipeline()
    moderator = _moderator("revise", "revise", "accept")
    pipeline.moderator = moderator

    artifact = pipeline.run_batch([_brand("ready")])

    item = artifact["items"][0]
    assert item["outcome"] == "ready"
    assert item["revision_count"] == 2
    assert [entry["decision"] for entry in item["moderation_history"]] == [
        "revise",
        "revise",
        "accept",
    ]
    assert len(composer.calls) == 3
    assert composer.calls[1]["moderation_revision"]["revision_number"] == 1
    assert composer.calls[2]["moderation_revision"]["revision_number"] == 2


def test_third_revise_is_honest_quality_reject_without_fourth_composition():
    pipeline, _, composer = _pipeline()
    moderator = _moderator("revise", "revise", "revise")
    pipeline.moderator = moderator

    artifact = pipeline.run_batch([_brand("ready")])

    item = artifact["items"][0]
    assert item["outcome"] == "quality_rejected"
    assert item["detail"]["code"] == "revision_limit_exceeded"
    assert item["detail"]["revision_count"] == 2
    assert len(composer.calls) == 3
    assert len(moderator.calls) == 3


def test_grok_reject_is_terminal_quality_outcome():
    pipeline, _, composer = _pipeline()
    moderator = _moderator("reject")
    pipeline.moderator = moderator

    artifact = pipeline.run_batch([_brand("ready")])

    item = artifact["items"][0]
    assert item["outcome"] == "quality_rejected"
    assert item["detail"]["code"] == "moderation_reject"
    assert len(composer.calls) == 1
    assert len(moderator.calls) == 1
