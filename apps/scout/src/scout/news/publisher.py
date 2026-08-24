"""Deterministic host publisher for accepted news-moderation.v2 artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

import httpx

COMPONENT_VERSION = "2.0.0"
_NORMAL_SKIP_OUTCOMES = {"no_news", "exact_duplicate", "quality_rejected"}
_EXAMPLE_HOSTS = {"example.com", "example.net", "example.org"}


class PublicationContractError(ValueError):
    """The artifact or API response did not satisfy the closed publish contract."""


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _require_object(value: object, label: str) -> dict:
    if not isinstance(value, dict):
        raise PublicationContractError(f"{label} must be an object")
    return value


def _require_exact_keys(value: dict, expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        raise PublicationContractError(
            f"{label} fields do not match contract: missing={sorted(expected - actual)}, "
            f"extra={sorted(actual - expected)}"
        )


def _require_string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise PublicationContractError(f"{label} must be a non-empty string")
    return value


def _canonical_public_source(raw: object) -> str:
    url = _require_string(raw, "source canonical_url")
    parsed = urlsplit(url)
    hostname = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme not in {"http", "https"} or not hostname or parsed.username or parsed.password:
        raise PublicationContractError("source canonical_url is not a public HTTP URL")
    if hostname in _EXAMPLE_HOSTS or hostname.endswith(".example"):
        raise PublicationContractError("synthetic/example sources are forbidden")
    return url


def _material_signature(material: dict) -> tuple[list[dict], list[dict], object]:
    sources = material.get("source_records")
    claims = material.get("claims")
    if not isinstance(sources, list) or not sources:
        raise PublicationContractError("source_records must be a non-empty array")
    if not isinstance(claims, list) or not claims:
        raise PublicationContractError("claims must be a non-empty array")
    for source in sources:
        source_object = _require_object(source, "source record")
        _canonical_public_source(source_object.get("canonical_url"))
    return sources, claims, material.get("community_subject_hint")


def _validate_role_run(
    value: object,
    *,
    role: str,
    output_artifact_id: object,
    input_artifact_ids: list[object],
) -> dict:
    run = _require_object(value, f"{role} run")
    _require_exact_keys(
        run,
        {
            "schema_version",
            "role",
            "run_id",
            "executor",
            "prompt_version",
            "started_at",
            "completed_at",
            "input_artifact_ids",
            "output_artifact_id",
        },
        f"{role} run",
    )
    if run.get("schema_version") != "news-role-run.v2" or run.get("role") != role:
        raise PublicationContractError(f"invalid {role} role run")
    if run.get("output_artifact_id") != output_artifact_id:
        raise PublicationContractError(f"{role} output artifact mismatch")
    if run.get("input_artifact_ids") != input_artifact_ids:
        raise PublicationContractError(f"{role} input artifacts mismatch")
    for field in ("run_id", "prompt_version", "started_at", "completed_at"):
        _require_string(run.get(field), f"{role} {field}")
    executor = _require_object(run.get("executor"), f"{role} executor")
    identity = _require_object(executor.get("identity"), f"{role} identity")
    _require_exact_keys(identity, {"provider", "model", "model_version"}, f"{role} identity")
    for field in ("provider", "model", "model_version"):
        _require_string(identity.get(field), f"{role} identity {field}")
    if role in {"local_researcher", "local_composer"}:
        _require_exact_keys(executor, {"kind", "locality", "identity"}, f"{role} executor")
        if executor.get("kind") != "model" or executor.get("locality") != "local_gpu":
            raise PublicationContractError(f"{role} is not a local GPU model")
    else:
        _require_exact_keys(
            executor,
            {"kind", "locality", "model_family", "identity"},
            f"{role} executor",
        )
        if (
            executor.get("kind") != "model"
            or executor.get("locality") != "remote_api"
            or executor.get("model_family") != "grok"
            or identity.get("provider") != "xai"
        ):
            raise PublicationContractError("moderation executor is not Grok")
    return run


def accepted_outcome(item: object) -> tuple[dict, dict, dict]:
    """Validate and project one accepted worker item into the typed v1 ingest request."""
    worker_item = _require_object(item, "worker item")
    _require_exact_keys(
        worker_item,
        {
            "schema_version",
            "job_id",
            "brand_id",
            "outcome",
            "completed_at",
            "revision_count",
            "research",
            "composition",
            "moderation",
            "moderation_history",
        },
        "ready worker item",
    )
    if worker_item.get("schema_version") != "feed-news-worker-item.v1":
        raise PublicationContractError("unsupported worker item schema")
    if worker_item.get("outcome") != "ready":
        raise PublicationContractError("publisher accepts only ready worker items")

    research = _require_object(worker_item.get("research"), "research artifact")
    composition = _require_object(worker_item.get("composition"), "composition artifact")
    moderation = _require_object(worker_item.get("moderation"), "moderation artifact")
    _require_exact_keys(
        research,
        {"schema_version", "artifact_id", "candidate", "findings", "run"},
        "research artifact",
    )
    _require_exact_keys(
        composition,
        {
            "schema_version",
            "artifact_id",
            "research_artifact_id",
            "draft",
            "used_finding_ids",
            "run",
        },
        "composition artifact",
    )
    _require_exact_keys(
        moderation,
        {
            "schema_version",
            "artifact_id",
            "composition_artifact_id",
            "decision",
            "rationale",
            "issues",
            "api_feedback",
            "run",
        },
        "moderation artifact",
    )
    if research.get("schema_version") != "news-research-findings.v2":
        raise PublicationContractError("research artifact is not v2")
    if composition.get("schema_version") != "news-composition.v2":
        raise PublicationContractError("composition artifact is not v2")
    if moderation.get("schema_version") != "news-moderation.v2":
        raise PublicationContractError("moderation artifact is not v2")
    if moderation.get("decision") != "accept":
        raise PublicationContractError("moderation decision is not accept")
    if composition.get("research_artifact_id") != research.get("artifact_id"):
        raise PublicationContractError("composition does not link to research artifact")
    if moderation.get("composition_artifact_id") != composition.get("artifact_id"):
        raise PublicationContractError("moderation does not link to composition artifact")

    research_run = _validate_role_run(
        research.get("run"),
        role="local_researcher",
        output_artifact_id=research.get("artifact_id"),
        input_artifact_ids=[],
    )
    composition_run = _validate_role_run(
        composition.get("run"),
        role="local_composer",
        output_artifact_id=composition.get("artifact_id"),
        input_artifact_ids=[research.get("artifact_id")],
    )
    moderation_run = _validate_role_run(
        moderation.get("run"),
        role="grok_moderator",
        output_artifact_id=moderation.get("artifact_id"),
        input_artifact_ids=[composition.get("artifact_id")],
    )

    candidate = _require_object(research.get("candidate"), "candidate")
    draft = _require_object(composition.get("draft"), "normalized draft")
    if candidate.get("schema_version") != "news-candidate.v1":
        raise PublicationContractError("candidate is not news-candidate.v1")
    if draft.get("schema_version") != "normalized-news.v1":
        raise PublicationContractError("draft is not normalized-news.v1")
    candidate_id = _require_string(candidate.get("candidate_id"), "candidate id")
    if draft.get("candidate_id") != candidate_id:
        raise PublicationContractError("draft candidate id mismatch")
    if _material_signature(candidate) != _material_signature(draft):
        raise PublicationContractError("composer changed source, claim, or community material")

    moderation_history = worker_item.get("moderation_history")
    if not isinstance(moderation_history, list) or not moderation_history:
        raise PublicationContractError("moderation history is required")
    if moderation_history[-1] != moderation:
        raise PublicationContractError("accepted moderation must be the final history entry")

    provenance = _require_object(draft.get("provenance"), "draft provenance")
    for field in ("provider", "model", "model_version", "prompt_version", "research_run_id"):
        _require_string(provenance.get(field), f"draft provenance {field}")
    candidate_provenance = _require_object(candidate.get("provenance"), "candidate provenance")
    if candidate_provenance.get("research_run_id") != research_run.get("run_id"):
        raise PublicationContractError("candidate provenance does not match researcher run")
    if provenance.get("research_run_id") != research_run.get("run_id"):
        raise PublicationContractError("draft provenance does not match researcher run")
    if provenance.get("normalization_run_id") != composition_run.get("run_id"):
        raise PublicationContractError("draft provenance does not match composer run")
    if moderation_run.get("run_id") == composition_run.get("run_id"):
        raise PublicationContractError("role run ids must be distinct")
    outcome = {
        "schema_version": "feed-news-job-outcome.v1",
        "job_id": _require_string(worker_item.get("job_id"), "job id"),
        "candidate_id": candidate_id,
        "completed_at": _require_string(worker_item.get("completed_at"), "completed at"),
        "provenance": provenance,
        "outcome": "ready",
        "candidate": candidate,
        "normalized_news": draft,
    }
    return outcome, composition, moderation


class FeedIngestClient:
    def __init__(
        self,
        base_url: str,
        secret: str,
        timeout_seconds: float = 30,
        readback_session: str | None = None,
    ) -> None:
        if not base_url.startswith(("http://", "https://")):
            raise ValueError("feed API base URL must use HTTP or HTTPS")
        if not secret.startswith("mf_feedingest_"):
            raise ValueError("feed ingest credential has the wrong scope prefix")
        self.base_url = base_url.rstrip("/")
        self._client = httpx.Client(
            headers={"Authorization": f"Bearer {secret}"},
            timeout=timeout_seconds,
        )
        self._readback_client = httpx.Client(
            cookies={"portal_session": readback_session} if readback_session else None,
            timeout=timeout_seconds,
        )

    def close(self) -> None:
        self._client.close()
        self._readback_client.close()

    def _request(self, method: str, path: str, *, readback: bool = False, **kwargs) -> dict:
        client = self._readback_client if readback else self._client
        try:
            response = client.request(method, f"{self.base_url}{path}", **kwargs)
        except httpx.HTTPError as exc:
            raise RuntimeError(f"feed API request failed: {type(exc).__name__}") from None
        try:
            body = response.json()
        except ValueError as exc:
            raise RuntimeError(f"feed API returned non-JSON status {response.status_code}") from exc
        if response.status_code >= 400:
            error = body.get("error") if isinstance(body, dict) else None
            message = error or "request_failed"
            raise RuntimeError(f"feed API status {response.status_code}: {message}")
        return _require_object(body, "feed API response")

    def create_draft(self, outcome: dict) -> dict:
        return self._request("POST", "/feed/ingest", json=outcome)

    def publish(self, post_id: str) -> dict:
        return self._request("POST", "/feed/ingest", json={"action": "publish", "post_id": post_id})

    def readback(self, post_id: str) -> dict:
        return self._request("GET", f"/feed/posts/{post_id}", readback=True)


def _validated_post(
    response: dict,
    expected_source: str,
    *,
    published: bool | None,
    require_status: bool = True,
) -> dict:
    post = _require_object(response.get("post"), "feed post")
    post_id = _require_string(post.get("id"), "feed post id")
    provenance = _require_object(post.get("provenance"), "feed post provenance")
    if provenance.get("source_url") != expected_source:
        raise PublicationContractError("feed API changed the canonical source URL")
    if published is None:
        if (provenance.get("review_state"), post.get("status")) not in {
            ("draft", "draft"),
            ("published", "visible"),
        }:
            raise PublicationContractError("feed post has an invalid draft/replay state")
    else:
        expected_state = "published" if published else "draft"
        if provenance.get("review_state") != expected_state:
            raise PublicationContractError(f"feed post is not {expected_state}")
        expected_status = "visible" if published else "draft"
        if (require_status or "status" in post) and post.get("status") != expected_status:
            raise PublicationContractError(f"feed post status is not {expected_status}")
    return {"id": post_id, "provenance": provenance}


def publish_item(
    item: object,
    client: FeedIngestClient,
    *,
    pipeline_run_id: str,
    public_base_url: str,
) -> dict:
    started_at = _now()
    outcome, composition, moderation = accepted_outcome(item)
    source_url = _canonical_public_source(
        outcome["normalized_news"]["source_records"][0]["canonical_url"]
    )
    draft_response = client.create_draft(outcome)
    draft_post = _validated_post(draft_response, source_url, published=None)
    publish_response = client.publish(draft_post["id"])
    published_post = _validated_post(publish_response, source_url, published=True)
    if published_post["id"] != draft_post["id"]:
        raise PublicationContractError("publish response changed the draft id")
    readback = client.readback(published_post["id"])
    observed_post = _validated_post(
        readback,
        source_url,
        published=True,
        require_status=False,
    )
    if observed_post["id"] != published_post["id"]:
        raise PublicationContractError("public readback returned a different post")

    idempotency_key = (
        f"feed-news:{outcome['candidate_id']}:{moderation['artifact_id']}"
    )
    digest = hashlib.sha256(idempotency_key.encode()).hexdigest()[:24]
    artifact_id = f"publication_{digest}"
    completed_at = _now()
    return {
        "pipeline": {
            "schema_version": "feed-news-pipeline.v2",
            "pipeline_run_id": pipeline_run_id,
            "research": item["research"],
            "composition": composition,
            "moderation": moderation,
            "publication": {
                "schema_version": "news-publication.v2",
                "artifact_id": artifact_id,
                "composition_artifact_id": composition["artifact_id"],
                "moderation_artifact_id": moderation["artifact_id"],
                "action": "publish",
                "reason_code": "moderation_accepted",
                "draft_id": draft_post["id"],
                "feed_post_id": observed_post["id"],
                "idempotency_key": idempotency_key,
                "run": {
                    "schema_version": "news-role-run.v2",
                    "role": "deterministic_publisher",
                    "run_id": f"publisher_{digest}",
                    "executor": {
                        "kind": "deterministic_host",
                        "component": "feed-news-publisher",
                        "component_version": COMPONENT_VERSION,
                    },
                    "prompt_version": None,
                    "started_at": started_at,
                    "completed_at": completed_at,
                    "input_artifact_ids": [
                        composition["artifact_id"],
                        moderation["artifact_id"],
                    ],
                    "output_artifact_id": artifact_id,
                },
            },
        },
        "evidence": {
            "post_id": observed_post["id"],
            "source_url": source_url,
            "provider": observed_post["provenance"].get("provider"),
            "model": observed_post["provenance"].get("model"),
            "prompt_version": observed_post["provenance"].get("prompt_version"),
            "observed_url": f"{public_base_url.rstrip('/')}/feed/p/{observed_post['id']}",
        },
    }


def publish_batch(
    artifact: object,
    client: FeedIngestClient,
    *,
    public_base_url: str,
    attempt: int,
) -> dict:
    batch = _require_object(artifact, "worker batch")
    if batch.get("schema_version") != "feed-news-worker-batch.v1":
        raise PublicationContractError("unsupported worker batch schema")
    pipeline_run_id = _require_string(batch.get("run_id"), "pipeline run id")
    items = batch.get("items")
    if not isinstance(items, list):
        raise PublicationContractError("worker batch items must be an array")
    results = []
    for item_value in items:
        item_started = time.monotonic()
        item = _require_object(item_value, "worker item")
        outcome = item.get("outcome")
        brand_id = item.get("brand_id")
        if outcome == "ready":
            published = publish_item(
                item,
                client,
                pipeline_run_id=pipeline_run_id,
                public_base_url=public_base_url,
            )
            result = {"brand_id": brand_id, "outcome": "published", **published}
        elif outcome in _NORMAL_SKIP_OUTCOMES:
            result = {"brand_id": brand_id, "outcome": outcome, "action": "skip"}
        elif outcome == "retryable_failure":
            result = {"brand_id": brand_id, "outcome": outcome, "action": "retry_next_run"}
        elif outcome == "ready_for_moderation":
            result = {"brand_id": brand_id, "outcome": outcome, "action": "withhold"}
        else:
            raise PublicationContractError(f"unknown worker outcome: {outcome}")
        duration_ms = round((time.monotonic() - item_started) * 1000)
        print(
            json.dumps(
                {
                    "run_id": pipeline_run_id,
                    "role": "deterministic_publisher",
                    "brand": brand_id,
                    "outcome": result["outcome"],
                    "attempt": attempt,
                    "duration_ms": duration_ms,
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )
        results.append(result)
    return {
        "schema_version": "feed-news-publication-batch.v1",
        "pipeline_run_id": pipeline_run_id,
        "completed_at": _now(),
        "results": results,
    }


def _write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.next")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path, help="feed-news-worker-batch.v1 artifact")
    parser.add_argument("--output", type=Path, required=True, help="publication evidence path")
    parser.add_argument(
        "--api-base-url",
        default=os.environ.get("SCOUT_NEWS_FEED_API_BASE_URL", "https://api.dev.3mf.tech"),
    )
    parser.add_argument(
        "--public-base-url",
        default=os.environ.get("SCOUT_NEWS_PUBLIC_BASE_URL", "https://dev.3mf.tech"),
    )
    parser.add_argument(
        "--attempt", type=int, default=int(os.environ.get("SCOUT_NEWS_ATTEMPT", "1"))
    )
    return parser


def _readback_session_credential() -> str | None:
    credentials_directory = os.environ.get("CREDENTIALS_DIRECTORY")
    if not credentials_directory:
        return None
    credential = Path(credentials_directory) / "dev-readback-session"
    if not credential.is_file():
        return None
    value = credential.read_text(encoding="utf-8").strip()
    return value or None


def main() -> None:
    args = build_parser().parse_args()
    secret = os.environ.get("SCOUT_NEWS_FEED_INGEST_KEY", "")
    artifact = json.loads(args.artifact.read_text(encoding="utf-8"))
    client = FeedIngestClient(
        args.api_base_url,
        secret,
        readback_session=_readback_session_credential(),
    )
    try:
        result = publish_batch(
            artifact,
            client,
            public_base_url=args.public_base_url,
            attempt=max(1, args.attempt),
        )
    finally:
        client.close()
    _write_json(args.output, result)


if __name__ == "__main__":
    main()
