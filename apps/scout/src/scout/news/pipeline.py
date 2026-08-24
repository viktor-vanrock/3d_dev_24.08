"""Host-orchestrated researcher -> composer -> Grok moderator pipeline."""

from __future__ import annotations

import html
import json
import re
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path

from .canonical import sha256_prefixed
from .fetch import OfficialSourceFetcher, RetrievedSource
from .model import GrokModelConfig, StructuredJsonModel
from .schema import (
    COMPOSER_SCHEMA,
    MODERATOR_SCHEMA,
    RESEARCHER_SCHEMA,
    validate_composer_result,
    validate_moderator_result,
    validate_researcher_result,
)

_PACKAGE = Path(__file__).resolve().parent
_MARKDOWN_IMAGE = re.compile(
    r'!\[([^\]\n]*)\]\((https://[^)\s]+)(?:\s+"[^"]*")?\)'
)


class ModelContractError(ValueError):
    pass


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def load_prompt(name: str) -> str:
    return (_PACKAGE / "prompts" / name).read_text(encoding="utf-8")


class NewsPipeline:
    def __init__(
        self,
        *,
        researcher: StructuredJsonModel,
        composer: StructuredJsonModel,
        moderator: StructuredJsonModel | None = None,
        fetcher_factory=OfficialSourceFetcher,
        max_parallel_brands: int = 3,
        max_revisions: int = 2,
    ) -> None:
        self.researcher = researcher
        self.composer = composer
        self.moderator = moderator
        self.fetcher_factory = fetcher_factory
        self.max_parallel_brands = max_parallel_brands
        self.max_revisions = max_revisions
        self.researcher_prompt = load_prompt("researcher.v2.md")
        self.composer_prompt = load_prompt("composer.v2.md")
        self.moderator_prompt = load_prompt("moderator.v2.md")

    def close(self) -> None:
        self.researcher.close()
        self.composer.close()
        if self.moderator is not None:
            self.moderator.close()

    def run_batch(self, brands: list[dict], known_fingerprints: set[str] | None = None) -> dict:
        started_at = _now()
        run_id = f"news_{uuid.uuid4().hex}"
        fingerprints = known_fingerprints or set()
        results: list[dict | None] = [None] * len(brands)
        with ThreadPoolExecutor(max_workers=self.max_parallel_brands) as executor:
            futures = {
                executor.submit(self._run_brand, brand, run_id, fingerprints): index
                for index, brand in enumerate(brands)
            }
            for future in as_completed(futures):
                results[futures[future]] = future.result()
        completed_at = _now()
        items = [item for item in results if item is not None]
        return {
            "schema_version": "feed-news-worker-batch.v1",
            "run_id": run_id,
            "started_at": started_at,
            "completed_at": completed_at,
            "zero_write": True,
            "summary": self._summarize(items),
            "items": items,
        }

    def _run_brand(self, brand: dict, run_id: str, known_fingerprints: set[str]) -> dict:
        job_id = f"{run_id}:{brand['brand_id']}"
        research_run_id = f"{job_id}:local_researcher"
        try:
            sources = self._fetch_sources(brand)
            duplicates = [
                source for source in sources if source.source_fingerprint in known_fingerprints
            ]
            if duplicates:
                return self._simple_outcome(
                    job_id,
                    brand,
                    "exact_duplicate",
                    {"matched_fingerprints": [item.source_fingerprint for item in duplicates]},
                )
            research_started_at = _now()
            researcher_result = self.researcher.complete(
                system=self.researcher_prompt,
                payload={
                    "brand": brand,
                    "official_sources": [source.model_record(24_000) for source in sources],
                },
                schema=RESEARCHER_SCHEMA,
            )
            research_completed_at = _now()
            if researcher_result["outcome"] == "no_news":
                return self._simple_outcome(
                    job_id, brand, "no_news", {"reason": researcher_result["reason"]}
                )
            if researcher_result["outcome"] == "quality_rejected":
                return self._simple_outcome(
                    job_id,
                    brand,
                    "quality_rejected",
                    {"reason": researcher_result["reason"]},
                )
            evidence_errors = validate_researcher_result(
                researcher_result, {source.source_id: source.text for source in sources}
            )
            candidate = self._build_candidate(brand, researcher_result, sources, research_run_id)
            if evidence_errors:
                return self._simple_outcome(
                    job_id,
                    brand,
                    "quality_rejected",
                    {
                        "code": "unsupported_content",
                        "errors": evidence_errors,
                        "candidate": candidate,
                    },
                )
            research_artifact_id = f"research_{uuid.uuid4().hex}"
            research = self._build_research_artifact(
                candidate,
                research_artifact_id,
                research_run_id,
                research_started_at,
                research_completed_at,
            )
            source_assets = [
                image
                for source in sources
                if (image := source.image_record()) is not None
            ]
            composition = self._compose(
                research,
                candidate,
                source_assets,
                research_run_id,
                job_id,
                0,
                None,
            )
            if self.moderator is None:
                return {
                    "schema_version": "feed-news-worker-item.v1",
                    "job_id": job_id,
                    "brand_id": brand["brand_id"],
                    "outcome": "ready_for_moderation",
                    "completed_at": _now(),
                    "research": research,
                    "composition": composition,
                }

            moderation_history: list[dict] = []
            for revision_count in range(self.max_revisions + 1):
                moderation = self._moderate(candidate, composition, job_id, revision_count)
                moderation_history.append(moderation)
                decision = moderation["decision"]
                if decision == "accept":
                    return {
                        "schema_version": "feed-news-worker-item.v1",
                        "job_id": job_id,
                        "brand_id": brand["brand_id"],
                        "outcome": "ready",
                        "completed_at": _now(),
                        "revision_count": revision_count,
                        "research": research,
                        "composition": composition,
                        "moderation": moderation,
                        "moderation_history": moderation_history,
                    }
                if decision == "reject":
                    return self._moderation_rejected_outcome(
                        job_id,
                        brand,
                        "moderation_reject",
                        revision_count,
                        research,
                        composition,
                        moderation,
                        moderation_history,
                    )
                if revision_count >= self.max_revisions:
                    return self._moderation_rejected_outcome(
                        job_id,
                        brand,
                        "revision_limit_exceeded",
                        revision_count,
                        research,
                        composition,
                        moderation,
                        moderation_history,
                    )
                revision_request = {
                    "issues": moderation["issues"],
                    "prior_draft": composition["draft"],
                }
                composition = self._compose(
                    research,
                    candidate,
                    source_assets,
                    research_run_id,
                    job_id,
                    revision_count + 1,
                    revision_request,
                )
            raise AssertionError("unreachable moderation loop")
        except ModelContractError as exc:
            return self._simple_outcome(
                job_id,
                brand,
                "quality_rejected",
                {"code": "contract_mismatch", "message": str(exc), "retryable": False},
            )
        except Exception as exc:  # noqa: BLE001 - one brand never fails the batch
            return self._simple_outcome(
                job_id,
                brand,
                "retryable_failure",
                {"code": type(exc).__name__, "message": str(exc), "retryable": True},
            )

    def _compose(
        self,
        research: dict,
        candidate: dict,
        source_assets: list[dict],
        research_run_id: str,
        job_id: str,
        revision_count: int,
        revision_request: dict | None,
    ) -> dict:
        composition_run_id = f"{job_id}:local_composer:{revision_count}"
        payload: dict = {"research": research, "source_assets": source_assets}
        if revision_request is not None:
            payload["moderation_revision"] = {
                "revision_number": revision_count,
                "issues": revision_request["issues"],
                "prior_draft": revision_request["prior_draft"],
            }
        started_at = _now()
        composed = self.composer.complete(
            system=self.composer_prompt,
            payload=payload,
            schema=COMPOSER_SCHEMA,
        )
        completed_at = _now()
        composed = self._stabilize_composition(composed, source_assets, candidate)
        errors = validate_composer_result(composed, candidate, source_assets)
        if errors:
            raise ModelContractError(f"composer contract rejected: {'; '.join(errors)}")
        artifact_id = f"composition_{uuid.uuid4().hex}"
        normalized = self._build_normalized(
            candidate, composed, research_run_id, composition_run_id
        )
        return {
            "schema_version": "news-composition.v2",
            "artifact_id": artifact_id,
            "research_artifact_id": research["artifact_id"],
            "draft": normalized,
            "used_finding_ids": [finding["finding_id"] for finding in research["findings"]],
            "run": self._role_run(
                self.composer,
                role="local_composer",
                run_id=composition_run_id,
                started_at=started_at,
                completed_at=completed_at,
                input_artifact_ids=[research["artifact_id"]],
                output_artifact_id=artifact_id,
            ),
        }

    def _moderate(
        self, candidate: dict, composition: dict, job_id: str, revision_count: int
    ) -> dict:
        if self.moderator is None:
            raise RuntimeError("moderator is not configured")
        started_at = _now()
        result = self.moderator.complete(
            system=self.moderator_prompt,
            payload={
                "contract_version": "feed-news-pipeline.v2",
                "revision_count": revision_count,
                "candidate": candidate,
                "normalized_article": composition["draft"],
            },
            schema=MODERATOR_SCHEMA,
        )
        completed_at = _now()
        result = self._stabilize_moderation(result, candidate)
        errors = validate_moderator_result(result, candidate, composition["draft"])
        if errors:
            raise ModelContractError(f"moderator contract rejected: {'; '.join(errors)}")
        artifact_id = f"moderation_{uuid.uuid4().hex}"
        run_id = f"{job_id}:grok_moderator:{revision_count}"
        return {
            "schema_version": "news-moderation.v2",
            "artifact_id": artifact_id,
            "composition_artifact_id": composition["artifact_id"],
            "decision": result["decision"],
            "rationale": result["rationale"],
            "issues": result["issues"],
            "api_feedback": result["api_feedback"],
            "run": self._moderator_run(
                self.moderator,
                run_id=run_id,
                started_at=started_at,
                completed_at=completed_at,
                input_artifact_ids=[composition["artifact_id"]],
                output_artifact_id=artifact_id,
            ),
        }

    def _moderation_rejected_outcome(
        self,
        job_id: str,
        brand: dict,
        code: str,
        revision_count: int,
        research: dict,
        composition: dict,
        moderation: dict,
        moderation_history: list[dict],
    ) -> dict:
        return self._simple_outcome(
            job_id,
            brand,
            "quality_rejected",
            {
                "code": code,
                "revision_count": revision_count,
                "research": research,
                "composition": composition,
                "moderation": moderation,
                "moderation_history": moderation_history,
            },
        )

    def _fetch_sources(self, brand: dict) -> list[RetrievedSource]:
        fetcher = self.fetcher_factory()
        try:
            sources = [
                fetcher.fetch(item["url"], brand["official_hosts"], item["publisher"])
                for item in brand["discovery_urls"]
            ]
        finally:
            fetcher.close()
        if not sources:
            raise ValueError("brand has no official source documents")
        return sources

    def _build_candidate(
        self, brand: dict, result: dict, sources: list[RetrievedSource], research_run_id: str
    ) -> dict:
        source_records = [source.contract_record() for source in sources]
        claim_ids = {claim["claim_id"] for claim in result["claims"]}
        labels = []
        for suggestion in result["semantic_label_suggestions"]:
            if not set(suggestion["evidence_claim_ids"]).issubset(claim_ids):
                continue
            labels.append(
                {
                    "label": suggestion["label"],
                    "confidence": max(0, min(1, suggestion["confidence"])),
                    "evidence": {
                        "claim_ids": suggestion["evidence_claim_ids"],
                        "source_ids": sorted(
                            {
                                source_id
                                for claim in result["claims"]
                                if claim["claim_id"] in suggestion["evidence_claim_ids"]
                                for source_id in claim["source_ids"]
                            }
                        ),
                    },
                    "model": self._model_identity(self.researcher),
                    "run_id": research_run_id,
                }
            )
        title_fingerprint = sha256_prefixed(" ".join(result["title"].lower().split()))
        community_hint = brand.get("community_subject_hint")
        if community_hint is not None:
            community_hint = {**community_hint, "evidence_claim_ids": sorted(claim_ids)}
        return {
            "schema_version": "news-candidate.v1",
            "candidate_id": f"candidate_{uuid.uuid4().hex}",
            "title": result["title"],
            "summary": result["summary"],
            "source_records": source_records,
            "claims": [
                {
                    "claim_id": claim["claim_id"],
                    "text": claim["text"],
                    "source_ids": claim["source_ids"],
                    "evidence": claim["evidence"],
                }
                for claim in result["claims"]
            ],
            "semantic_labels": labels,
            "community_subject_hint": community_hint,
            "provenance": self._v1_provenance(
                self.researcher, research_run_id, normalization_run_id=None
            ),
            "dedup_signals": {
                "canonical_url_hashes": [source["source_fingerprint"] for source in source_records],
                "content_hashes": [source["content_hash"] for source in source_records],
                "title_fingerprint": title_fingerprint,
                "semantic_fingerprint": None,
                "exact_match": None,
                "near_matches": [],
            },
        }

    def _build_research_artifact(
        self,
        candidate: dict,
        artifact_id: str,
        run_id: str,
        started_at: str,
        completed_at: str,
    ) -> dict:
        findings = [
            {
                "finding_id": f"finding.{index}",
                "kind": "fact",
                "text": claim["text"],
                "confidence": 1,
                "evidence": {
                    "claim_ids": [claim["claim_id"]],
                    "source_ids": claim["source_ids"],
                },
            }
            for index, claim in enumerate(candidate["claims"], start=1)
        ]
        return {
            "schema_version": "news-research-findings.v2",
            "artifact_id": artifact_id,
            "candidate": candidate,
            "findings": findings,
            "run": self._role_run(
                self.researcher,
                role="local_researcher",
                run_id=run_id,
                started_at=started_at,
                completed_at=completed_at,
                input_artifact_ids=[],
                output_artifact_id=artifact_id,
            ),
        }

    def _build_normalized(
        self,
        candidate: dict,
        composed: dict,
        research_run_id: str,
        composition_run_id: str,
    ) -> dict:
        return {
            "schema_version": "normalized-news.v1",
            "normalized_news_id": f"normalized_{uuid.uuid4().hex}",
            "candidate_id": candidate["candidate_id"],
            "title": composed["title"],
            "dek": composed["dek"] or None,
            "body_markdown": composed["body_markdown"],
            "body_ast": composed["body_ast"],
            "blocks": composed["blocks"],
            "source_records": candidate["source_records"],
            "claims": candidate["claims"],
            "semantic_labels": candidate["semantic_labels"],
            "community_subject_hint": candidate["community_subject_hint"],
            "provenance": self._v1_provenance(
                self.composer, research_run_id, normalization_run_id=composition_run_id
            ),
            "dedup_signals": candidate["dedup_signals"],
        }

    @staticmethod
    def _stabilize_composition(
        composed: dict, source_assets: list[dict], candidate: dict
    ) -> dict:
        """Make block ids and the closed AST deterministic after the model chose block content."""
        proposed_blocks = [
            block for block in composed.get("blocks", []) if block.get("kind") != "source"
        ]
        for source in candidate["source_records"]:
            claim_ids = [
                claim["claim_id"]
                for claim in candidate["claims"]
                if source["source_id"] in claim["source_ids"]
            ]
            if not claim_ids:
                continue
            proposed_blocks.append(
                {
                    "block_id": "host-source",
                    "kind": "source",
                    "source_id": source["source_id"],
                    "claim_ids": claim_ids,
                    "label": source["publisher"] or source["title"],
                }
            )
        assets_by_url = {
            asset["image_url"]: asset
            for asset in source_assets
            if isinstance(asset.get("image_url"), str)
        }
        # Keep terminal fenced blocks recognizable to the feed CommonMark projection. Model
        # responses commonly include a final newline after the closing fence; the host does not
        # need to preserve that non-semantic whitespace.
        markdown = composed.get("body_markdown", "").rstrip()
        missing_claims = [
            claim
            for claim in candidate["claims"]
            if f"[claim:{claim['claim_id']}]" not in markdown
        ]
        if missing_claims:
            claim_items = "\n".join(
                f"- {html.escape(' '.join(claim['text'].split()))} "
                f"[claim:{claim['claim_id']}]"
                for claim in missing_claims
            )
            markdown = f"{markdown.rstrip()}\n\n### Подтверждено источниками\n\n{claim_items}"
        markdown_images = {
            match.group(2): match.group(1) for match in _MARKDOWN_IMAGE.finditer(markdown)
        }
        typed_image_urls = {
            block.get("image_url")
            for block in proposed_blocks
            if block.get("kind") == "image"
        }

        # The host, not the model, maintains equivalence between the CommonMark fallback and
        # typed AST. It may complete only an already verified pair; untrusted URLs still reach
        # validation unchanged and fail closed.
        for image_url, alt in markdown_images.items():
            asset = assets_by_url.get(image_url)
            if asset is None or image_url in typed_image_urls:
                continue
            proposed_blocks.append(
                {
                    "block_id": "host-image",
                    "kind": "image",
                    "source_id": asset["source_id"],
                    "image_url": image_url,
                    "alt": alt.strip() or asset["alt"],
                    "caption": None,
                    "content_hash": None,
                }
            )
            typed_image_urls.add(image_url)

        missing_markdown_images = [
            block
            for block in proposed_blocks
            if block.get("kind") == "image"
            and block.get("image_url") in assets_by_url
            and block.get("image_url") not in markdown_images
        ]
        if missing_markdown_images:
            def image_alt(block: dict) -> str:
                value = str(block.get("alt") or assets_by_url[block["image_url"]]["alt"])
                return " ".join(value.replace("[", "").replace("]", "").split())

            image_projection = "\n\n".join(
                f"![{image_alt(block)}]({block['image_url']})"
                for block in missing_markdown_images
            )
            lead, separator, remainder = markdown.partition("\n\n")
            markdown = (
                f"{lead}\n\n{image_projection}\n\n{remainder}"
                if separator
                else f"{markdown}\n\n{image_projection}"
            )

        blocks = []
        kind_counts: dict[str, int] = {}
        for proposed in proposed_blocks:
            kind = proposed.get("kind", "block")
            kind_counts[kind] = kind_counts.get(kind, 0) + 1
            blocks.append({**proposed, "block_id": f"{kind}.{kind_counts[kind]}"})

        image_blocks = {
            block["image_url"]: block
            for block in blocks
            if block.get("kind") == "image" and isinstance(block.get("image_url"), str)
        }
        body_ast = []
        markdown_lines: list[str] = []
        referenced: set[str] = set()

        def flush_markdown() -> None:
            segment = "".join(markdown_lines).strip()
            if segment:
                body_ast.append({"type": "markdown", "markdown": segment})
            markdown_lines.clear()

        image_line = re.compile(
            r'!\[[^\]\n]*\]\((https://[^)\s]+)(?:\s+"[^"]*")?\)\s*(?:\n|$)'
        )
        for line in markdown.splitlines(keepends=True):
            match = image_line.fullmatch(line)
            image = image_blocks.get(match.group(1)) if match else None
            if image is None:
                markdown_lines.append(line)
                continue
            flush_markdown()
            body_ast.append({"type": "block_ref", "block_id": image["block_id"]})
            referenced.add(image["block_id"])
        flush_markdown()

        for block in blocks:
            if block["block_id"] not in referenced:
                body_ast.append({"type": "block_ref", "block_id": block["block_id"]})
        return {
            **composed,
            "body_markdown": markdown,
            "blocks": blocks,
            "body_ast": body_ast,
        }

    @staticmethod
    def _stabilize_moderation(result: dict, candidate: dict) -> dict:
        def evidence_graph(evidence: object) -> object:
            if not isinstance(evidence, dict):
                return evidence
            claim_ids = evidence.get("claim_ids")
            source_ids = evidence.get("source_ids")
            if claim_ids == [] and source_ids == []:
                return None
            known_claims = {claim["claim_id"]: claim for claim in candidate["claims"]}
            known_sources = {
                source["source_id"] for source in candidate["source_records"]
            }
            if (
                claim_ids == []
                and isinstance(source_ids, list)
                and set(source_ids) <= known_sources
            ):
                claim_ids = sorted(
                    claim_id
                    for claim_id, claim in known_claims.items()
                    if set(claim["source_ids"]) & set(source_ids)
                )
            if (
                source_ids == []
                and isinstance(claim_ids, list)
                and set(claim_ids) <= set(known_claims)
            ):
                source_ids = sorted(
                    {
                        source_id
                        for claim_id in claim_ids
                        for source_id in known_claims[claim_id]["source_ids"]
                    }
                )
            return {**evidence, "claim_ids": claim_ids, "source_ids": source_ids}

        issues = [
            {
                **issue,
                "issue_id": f"moderation.issue.{index}",
                "evidence": evidence_graph(issue.get("evidence")),
            }
            for index, issue in enumerate(result.get("issues", []), start=1)
        ]
        feedback = [
            {
                **item,
                "feedback_id": f"api.feedback.{index}",
                "evidence": evidence_graph(item.get("evidence")),
            }
            for index, item in enumerate(result.get("api_feedback", []), start=1)
        ]
        return {**result, "issues": issues, "api_feedback": feedback}

    def _simple_outcome(self, job_id: str, brand: dict, outcome: str, detail: dict) -> dict:
        return {
            "schema_version": "feed-news-worker-item.v1",
            "job_id": job_id,
            "brand_id": brand["brand_id"],
            "outcome": outcome,
            "completed_at": _now(),
            "detail": detail,
        }

    @staticmethod
    def _model_identity(model: StructuredJsonModel) -> dict:
        if isinstance(model.config, GrokModelConfig):
            return {
                "provider": "xai",
                "model": model.config.model,
                "model_version": model.config.model_version,
            }
        model_name = model.config.model.replace("\\", "/").rsplit("/", maxsplit=1)[-1]
        return {
            "provider": "local_openai_compatible",
            "model": model_name,
            "model_version": model_name,
        }

    @classmethod
    def _v1_provenance(
        cls,
        model: StructuredJsonModel,
        research_run_id: str,
        normalization_run_id: str | None,
    ) -> dict:
        return {
            **cls._model_identity(model),
            "prompt_version": model.config.prompt_version,
            "research_run_id": research_run_id,
            "normalization_run_id": normalization_run_id,
            "generated_at": _now(),
        }

    @classmethod
    def _role_run(
        cls,
        model: StructuredJsonModel,
        *,
        role: str,
        run_id: str,
        started_at: str,
        completed_at: str,
        input_artifact_ids: list[str],
        output_artifact_id: str,
    ) -> dict:
        return {
            "schema_version": "news-role-run.v2",
            "role": role,
            "run_id": run_id,
            "executor": {
                "kind": "model",
                "locality": "local_gpu",
                "identity": cls._model_identity(model),
            },
            "prompt_version": model.config.prompt_version,
            "started_at": started_at,
            "completed_at": completed_at,
            "input_artifact_ids": input_artifact_ids,
            "output_artifact_id": output_artifact_id,
        }

    @classmethod
    def _moderator_run(
        cls,
        model: StructuredJsonModel,
        *,
        run_id: str,
        started_at: str,
        completed_at: str,
        input_artifact_ids: list[str],
        output_artifact_id: str,
    ) -> dict:
        return {
            "schema_version": "news-role-run.v2",
            "role": "grok_moderator",
            "run_id": run_id,
            "executor": {
                "kind": "model",
                "locality": "remote_api",
                "model_family": "grok",
                "identity": cls._model_identity(model),
            },
            "prompt_version": model.config.prompt_version,
            "started_at": started_at,
            "completed_at": completed_at,
            "input_artifact_ids": input_artifact_ids,
            "output_artifact_id": output_artifact_id,
        }

    @staticmethod
    def _summarize(items: list[dict]) -> dict:
        counts: dict[str, int] = {}
        for item in items:
            counts[item["outcome"]] = counts.get(item["outcome"], 0) + 1
        return {"total": len(items), "outcomes": counts}


def load_brands(path: Path | None = None) -> list[dict]:
    config_path = path or (_PACKAGE / "brands.v2.json")
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != "feed-news-brands.v2":
        raise ValueError("unsupported brand config schema")
    return payload["brands"]
