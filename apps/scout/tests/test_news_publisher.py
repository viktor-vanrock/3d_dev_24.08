from __future__ import annotations

from copy import deepcopy

import pytest

from scout.news.publisher import (
    PublicationContractError,
    _readback_session_credential,
    accepted_outcome,
    publish_batch,
)


def _run(role: str, run_id: str, output_id: str, inputs: list[str]) -> dict:
    identity = {
        "provider": "xai" if role == "grok_moderator" else "local",
        "model": "grok-4.5" if role == "grok_moderator" else role,
        "model_version": "2026-07-22",
    }
    executor = {"kind": "model", "locality": "local_gpu", "identity": identity}
    if role == "grok_moderator":
        executor = {
            "kind": "model",
            "locality": "remote_api",
            "model_family": "grok",
            "identity": identity,
        }
    return {
        "schema_version": "news-role-run.v2",
        "role": role,
        "run_id": run_id,
        "executor": executor,
        "prompt_version": f"{role}.v2",
        "started_at": "2026-07-22T10:00:00Z",
        "completed_at": "2026-07-22T10:01:00Z",
        "input_artifact_ids": inputs,
        "output_artifact_id": output_id,
    }


def _ready_item(source_url: str = "https://vendor.test/news/official") -> dict:
    source = {
        "source_id": "source.1",
        "canonical_url": source_url,
        "title": "Official release",
        "publisher": "Vendor",
        "published_at": "2026-07-22T09:00:00Z",
        "retrieved_at": "2026-07-22T10:00:00Z",
        "content_hash": "sha256:content",
        "source_fingerprint": "sha256:source",
    }
    claim = {
        "claim_id": "claim.1",
        "text": "The vendor announced a supported feature.",
        "source_ids": ["source.1"],
        "evidence": [{"source_id": "source.1", "quote": "supported evidence"}],
    }
    hint = {
        "subject_type": "vendor",
        "subject_id": "4d1d4d59-ce79-4a11-a088-c9d3781a3de3",
        "subject_slug": None,
        "display_name": "Vendor",
        "confidence": 1,
        "evidence_claim_ids": ["claim.1"],
    }
    candidate_provenance = {
        "provider": "local",
        "model": "local_researcher",
        "model_version": "2026-07-22",
        "prompt_version": "local_researcher.v2",
        "research_run_id": "research.run",
        "normalization_run_id": None,
        "generated_at": "2026-07-22T10:01:00Z",
    }
    candidate = {
        "schema_version": "news-candidate.v1",
        "candidate_id": "candidate.1",
        "title": "Official release",
        "summary": "Source-backed summary",
        "source_records": [source],
        "claims": [claim],
        "semantic_labels": [],
        "community_subject_hint": hint,
        "provenance": candidate_provenance,
        "dedup_signals": {
            "canonical_url_hashes": ["sha256:source"],
            "content_hashes": ["sha256:content"],
            "title_fingerprint": "sha256:title",
            "semantic_fingerprint": None,
            "exact_match": None,
            "near_matches": [],
        },
    }
    draft = {
        "schema_version": "normalized-news.v1",
        "normalized_news_id": "normalized.1",
        "candidate_id": "candidate.1",
        "title": "Подтверждённый релиз",
        "dek": "Краткое описание",
        "body_markdown": "Подтверждённый источником материал [claim:claim.1].",
        "body_ast": [{"type": "markdown", "markdown": "Материал"}],
        "blocks": [],
        "source_records": [deepcopy(source)],
        "claims": [deepcopy(claim)],
        "semantic_labels": [],
        "community_subject_hint": deepcopy(hint),
        "provenance": {
            **candidate_provenance,
            "model": "local_composer",
            "prompt_version": "local_composer.v2",
            "normalization_run_id": "composition.run",
        },
        "dedup_signals": deepcopy(candidate["dedup_signals"]),
    }
    research = {
        "schema_version": "news-research-findings.v2",
        "artifact_id": "research.1",
        "candidate": candidate,
        "findings": [
            {
                "finding_id": "finding.1",
                "kind": "fact",
                "text": claim["text"],
                "confidence": 1,
                "evidence": {"claim_ids": ["claim.1"], "source_ids": ["source.1"]},
            }
        ],
        "run": _run("local_researcher", "research.run", "research.1", []),
    }
    composition = {
        "schema_version": "news-composition.v2",
        "artifact_id": "composition.1",
        "research_artifact_id": "research.1",
        "draft": draft,
        "used_finding_ids": ["finding.1"],
        "run": _run("local_composer", "composition.run", "composition.1", ["research.1"]),
    }
    moderation = {
        "schema_version": "news-moderation.v2",
        "artifact_id": "moderation.1",
        "composition_artifact_id": "composition.1",
        "decision": "accept",
        "rationale": "Every claim is source-backed.",
        "issues": [],
        "api_feedback": [],
        "run": _run("grok_moderator", "moderation.run", "moderation.1", ["composition.1"]),
    }
    return {
        "schema_version": "feed-news-worker-item.v1",
        "job_id": "news.run:vendor",
        "brand_id": "vendor",
        "outcome": "ready",
        "completed_at": "2026-07-22T10:03:00Z",
        "revision_count": 0,
        "research": research,
        "composition": composition,
        "moderation": moderation,
        "moderation_history": [deepcopy(moderation)],
    }


def _post(status: str) -> dict:
    return {
        "post": {
            "id": "05cb13c8-5c36-4c37-804c-e1cdb2219e9f",
            "status": status,
            "provenance": {
                "source_url": "https://vendor.test/news/official",
                "provider": "local",
                "model": "local_composer",
                "prompt_version": "local_composer.v2",
                "review_state": "published" if status == "visible" else "draft",
            },
        }
    }


class _Client:
    def __init__(self, replay_visible: bool = False) -> None:
        self.created: list[dict] = []
        self.published: list[str] = []
        self.replay_visible = replay_visible

    def create_draft(self, outcome: dict) -> dict:
        self.created.append(outcome)
        return _post("visible" if self.replay_visible else "draft")

    def publish(self, post_id: str) -> dict:
        self.published.append(post_id)
        return _post("visible")

    def readback(self, post_id: str) -> dict:
        response = _post("visible")
        del response["post"]["status"]
        return response


def test_publisher_projects_exact_accept_then_drafts_publishes_and_reads_back():
    client = _Client()
    artifact = {
        "schema_version": "feed-news-worker-batch.v1",
        "run_id": "news.run",
        "items": [_ready_item()],
    }

    result = publish_batch(artifact, client, public_base_url="https://dev.3mf.tech", attempt=2)

    assert client.created[0]["schema_version"] == "feed-news-job-outcome.v1"
    assert client.created[0]["outcome"] == "ready"
    assert client.published == ["05cb13c8-5c36-4c37-804c-e1cdb2219e9f"]
    published = result["results"][0]
    pipeline = published["pipeline"]
    assert pipeline["publication"]["action"] == "publish"
    assert pipeline["publication"]["idempotency_key"] == "feed-news:candidate.1:moderation.1"
    assert set(pipeline) == {
        "schema_version",
        "pipeline_run_id",
        "research",
        "composition",
        "moderation",
        "publication",
    }
    assert published["evidence"] == {
        "post_id": "05cb13c8-5c36-4c37-804c-e1cdb2219e9f",
        "source_url": "https://vendor.test/news/official",
        "provider": "local",
        "model": "local_composer",
        "prompt_version": "local_composer.v2",
        "observed_url": "https://dev.3mf.tech/feed/p/05cb13c8-5c36-4c37-804c-e1cdb2219e9f",
    }


def test_publisher_rejects_tampered_moderation_link_and_synthetic_source():
    item = _ready_item()
    item["moderation"]["composition_artifact_id"] = "other"
    item["moderation_history"][-1] = deepcopy(item["moderation"])
    with pytest.raises(PublicationContractError, match="does not link"):
        accepted_outcome(item)

    with pytest.raises(PublicationContractError, match="synthetic"):
        accepted_outcome(_ready_item("https://vendor.example/news/fake"))


def test_retry_replays_visible_post_but_still_uses_separate_publish_action():
    client = _Client(replay_visible=True)
    artifact = {
        "schema_version": "feed-news-worker-batch.v1",
        "run_id": "news.run",
        "items": [_ready_item()],
    }

    result = publish_batch(artifact, client, public_base_url="https://dev.3mf.tech", attempt=2)

    assert client.published == ["05cb13c8-5c36-4c37-804c-e1cdb2219e9f"]
    assert result["results"][0]["outcome"] == "published"


def test_normal_outcomes_skip_without_calling_api():
    client = _Client()
    items = [
        {"brand_id": "a", "outcome": "no_news"},
        {"brand_id": "b", "outcome": "exact_duplicate"},
        {"brand_id": "c", "outcome": "quality_rejected"},
        {"brand_id": "d", "outcome": "retryable_failure"},
    ]
    result = publish_batch(
        {"schema_version": "feed-news-worker-batch.v1", "run_id": "news.run", "items": items},
        client,
        public_base_url="https://dev.3mf.tech",
        attempt=1,
    )

    assert [entry["action"] for entry in result["results"]] == [
        "skip",
        "skip",
        "skip",
        "retry_next_run",
    ]
    assert client.created == []


def test_readback_session_is_loaded_only_from_systemd_credentials(monkeypatch, tmp_path):
    credential = tmp_path / "dev-readback-session"
    credential.write_text("opaque-session-value\n")
    monkeypatch.setenv("CREDENTIALS_DIRECTORY", str(tmp_path))

    assert _readback_session_credential() == "opaque-session-value"
