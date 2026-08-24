"""Closed model-output schemas and deterministic host validation."""

from __future__ import annotations

import re

RESEARCHER_SCHEMA = {
    "type": "object",
    "properties": {
        "outcome": {"type": "string", "enum": ["candidate", "no_news", "quality_rejected"]},
        "title": {"type": "string"},
        "summary": {"type": "string"},
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "claim_id": {"type": "string"},
                    "text": {"type": "string"},
                    "source_ids": {"type": "array", "items": {"type": "string"}},
                    "evidence": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "source_id": {"type": "string"},
                                "quote": {"type": "string"},
                            },
                            "required": ["source_id", "quote"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["claim_id", "text", "source_ids", "evidence"],
                "additionalProperties": False,
            },
        },
        "semantic_label_suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "confidence": {"type": "number"},
                    "evidence_claim_ids": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["label", "confidence", "evidence_claim_ids"],
                "additionalProperties": False,
            },
        },
        "reason": {"type": "string"},
    },
    "required": [
        "outcome",
        "title",
        "summary",
        "claims",
        "semantic_label_suggestions",
        "reason",
    ],
    "additionalProperties": False,
}

COMPOSER_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "dek": {"type": "string"},
        "body_markdown": {"type": "string"},
        "body_ast": {
            "type": "array",
            "items": {
                "oneOf": [
                    {
                        "type": "object",
                        "properties": {
                            "type": {"const": "markdown"},
                            "markdown": {"type": "string"},
                        },
                        "required": ["type", "markdown"],
                        "additionalProperties": False,
                    },
                    {
                        "type": "object",
                        "properties": {
                            "type": {"const": "block_ref"},
                            "block_id": {"type": "string"},
                        },
                        "required": ["type", "block_id"],
                        "additionalProperties": False,
                    },
                ]
            },
        },
        "blocks": {
            "type": "array",
            "items": {
                "oneOf": [
                    {
                        "type": "object",
                        "properties": {
                            "block_id": {"type": "string"},
                            "kind": {"const": "source"},
                            "source_id": {"type": "string"},
                            "claim_ids": {"type": "array", "items": {"type": "string"}},
                            "label": {"type": "string"},
                        },
                        "required": ["block_id", "kind", "source_id", "claim_ids", "label"],
                        "additionalProperties": False,
                    },
                    {
                        "type": "object",
                        "properties": {
                            "block_id": {"type": "string"},
                            "kind": {"const": "image"},
                            "source_id": {"type": "string"},
                            "image_url": {"type": "string"},
                            "alt": {"type": "string"},
                            "caption": {"type": ["string", "null"]},
                            "content_hash": {"type": ["string", "null"]},
                        },
                        "required": [
                            "block_id",
                            "kind",
                            "source_id",
                            "image_url",
                            "alt",
                            "caption",
                            "content_hash",
                        ],
                        "additionalProperties": False,
                    },
                ]
            },
        },
    },
    "required": ["title", "dek", "body_markdown", "body_ast", "blocks"],
    "additionalProperties": False,
}

_EVIDENCE_SCHEMA = {
    "type": ["object", "null"],
    "properties": {
        "claim_ids": {"type": "array", "items": {"type": "string"}},
        "source_ids": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["claim_ids", "source_ids"],
    "additionalProperties": False,
}

MODERATOR_SCHEMA = {
    "type": "object",
    "properties": {
        "decision": {"type": "string", "enum": ["accept", "revise", "reject"]},
        "rationale": {"type": "string"},
        "issues": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "issue_id": {"type": "string"},
                    "code": {
                        "type": "string",
                        "enum": [
                            "unsupported_claim",
                            "insufficient_evidence",
                            "editorial_quality",
                            "safety",
                            "deduplication",
                            "contract_mismatch",
                        ],
                    },
                    "message": {"type": "string"},
                    "evidence": _EVIDENCE_SCHEMA,
                    "locations": {
                        "type": "array",
                        "items": {
                            "oneOf": [
                                {
                                    "type": "object",
                                    "properties": {
                                        "kind": {"const": "claim"},
                                        "claim_id": {"type": "string"},
                                    },
                                    "required": ["kind", "claim_id"],
                                    "additionalProperties": False,
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "kind": {"const": "block"},
                                        "block_id": {"type": "string"},
                                    },
                                    "required": ["kind", "block_id"],
                                    "additionalProperties": False,
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "kind": {"const": "markdown_section"},
                                        "heading": {"type": "string"},
                                    },
                                    "required": ["kind", "heading"],
                                    "additionalProperties": False,
                                },
                            ]
                        },
                    },
                },
                "required": ["issue_id", "code", "message", "evidence", "locations"],
                "additionalProperties": False,
            },
        },
        "api_feedback": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "feedback_id": {"type": "string"},
                    "surface": {
                        "type": "string",
                        "enum": ["feed_news_contract", "feed_ingest_api", "moderation_audit"],
                    },
                    "summary": {"type": "string"},
                    "rationale": {"type": "string"},
                    "evidence": _EVIDENCE_SCHEMA,
                    "disposition": {"const": "advisory_only"},
                    "automatic_change_allowed": {"const": False},
                },
                "required": [
                    "feedback_id",
                    "surface",
                    "summary",
                    "rationale",
                    "evidence",
                    "disposition",
                    "automatic_change_allowed",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["decision", "rationale", "issues", "api_feedback"],
    "additionalProperties": False,
}

_FORBIDDEN_MARKDOWN = re.compile(
    r"<\s*(script|iframe|object|embed|[A-Z][A-Za-z0-9.]*)\b|<!--", re.I
)
_H2 = re.compile(r"^##\s+\S.*$", re.M)
_LIST_ITEM = re.compile(r"^(?:[-*+] |\d+\. )\S", re.M)
_MARKDOWN_IMAGE = re.compile(r"!\[[^\]\n]*\]\((https://[^)\s]+)(?:\s+\"[^\"]*\")?\)")
_MERMAID = re.compile(r"^```mermaid\n(.+?)\n```$", re.M | re.S)
_SAFE_MERMAID_START = re.compile(r"^(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)\s*$")
_UNSAFE_MERMAID = re.compile(r"%%\{|\b(?:click|href|classDef|style)\b|javascript:|<", re.I)


def validate_researcher_result(result: dict, source_texts: dict[str, str]) -> list[str]:
    errors: list[str] = []
    if result.get("outcome") != "candidate":
        return errors
    claims = result.get("claims")
    if not isinstance(claims, list) or not claims:
        return ["candidate has no claims"]
    seen: set[str] = set()
    for claim in claims:
        claim_id = claim.get("claim_id")
        if not isinstance(claim_id, str) or not claim_id or claim_id in seen:
            errors.append("claim ids must be unique non-empty strings")
            continue
        seen.add(claim_id)
        source_ids = claim.get("source_ids")
        evidence = claim.get("evidence")
        if not isinstance(source_ids, list) or not source_ids:
            errors.append(f"{claim_id}: no source ids")
            continue
        if not isinstance(evidence, list) or not evidence:
            errors.append(f"{claim_id}: no evidence")
            continue
        supported_sources: set[str] = set()
        for item in evidence:
            source_id = item.get("source_id")
            quote = " ".join(str(item.get("quote", "")).split())
            source_text = " ".join(source_texts.get(source_id, "").split())
            if source_id not in source_texts or len(quote) < 12 or quote not in source_text:
                errors.append(f"{claim_id}: unsupported quote for {source_id}")
            else:
                supported_sources.add(source_id)
        if not set(source_ids).issubset(supported_sources):
            errors.append(f"{claim_id}: not every source id has exact evidence")
    return errors


def validate_composer_result(
    result: dict, candidate: dict, source_assets: list[dict] | None = None
) -> list[str]:
    errors: list[str] = []
    markdown = result.get("body_markdown")
    if not isinstance(markdown, str) or len(markdown.strip()) < 120:
        errors.append("body_markdown is too short")
    elif _FORBIDDEN_MARKDOWN.search(markdown):
        errors.append("body_markdown contains forbidden HTML/MDX")
    else:
        parts = [part.strip() for part in re.split(r"\n{2,}", markdown) if part.strip()]
        if not parts or parts[0].startswith(("#", "- ", "* ", "+ ", "```", "![")):
            errors.append("body_markdown must start with an editorial lead")
        elif len(parts[0]) < 40:
            errors.append("editorial lead is too short")
        h2_sections = list(_H2.finditer(markdown))
        if len(h2_sections) < 2:
            errors.append("body_markdown must contain at least two H2 sections")
        else:
            for index, heading in enumerate(h2_sections):
                section_end = (
                    h2_sections[index + 1].start()
                    if index + 1 < len(h2_sections)
                    else len(markdown)
                )
                if len(markdown[heading.end() : section_end].strip()) < 40:
                    errors.append("every H2 section must contain meaningful content")
                    break
        if not _LIST_ITEM.search(markdown):
            errors.append("body_markdown must contain a list")

        image_urls = _MARKDOWN_IMAGE.findall(markdown)
        mermaid_blocks = _MERMAID.findall(markdown)
        if not image_urls and not mermaid_blocks:
            errors.append("body_markdown must contain a verified image or Mermaid diagram")
        allowed_image_urls = {
            asset["image_url"]
            for asset in source_assets or []
            if isinstance(asset.get("image_url"), str)
        }
        for image_url in image_urls:
            if image_url not in allowed_image_urls:
                errors.append(f"body_markdown uses unverified image {image_url}")
        for diagram in mermaid_blocks:
            lines = [line.strip() for line in diagram.splitlines() if line.strip()]
            if (
                not lines
                or not _SAFE_MERMAID_START.fullmatch(lines[0])
                or len(diagram) > 2_000
                or _UNSAFE_MERMAID.search(diagram)
            ):
                errors.append("body_markdown contains unsafe Mermaid")

    dek = result.get("dek")
    if not isinstance(dek, str) or len(dek.strip()) < 40:
        errors.append("editorial dek is required")

    claim_ids = {claim["claim_id"] for claim in candidate["claims"]}
    source_ids = {source["source_id"] for source in candidate["source_records"]}
    cited_source_ids = {
        source_id for claim in candidate["claims"] for source_id in claim["source_ids"]
    }
    for claim_id in claim_ids:
        if f"[claim:{claim_id}]" not in markdown:
            errors.append(f"body_markdown does not cite {claim_id}")

    blocks = result.get("blocks")
    ast = result.get("body_ast")
    if not isinstance(blocks, list) or not blocks:
        errors.append("at least one typed source block is required")
        blocks = []
    if not isinstance(ast, list) or not ast:
        errors.append("body_ast is required")
        ast = []
    block_ids: set[str] = set()
    source_block_count = 0
    source_block_sources: set[str] = set()
    image_block_count = 0
    image_block_urls: set[str] = set()
    allowed_assets = {
        (asset.get("source_id"), asset.get("image_url")) for asset in source_assets or []
    }
    for block in blocks:
        block_id = block.get("block_id")
        if not isinstance(block_id, str) or not block_id or block_id in block_ids:
            errors.append("block ids must be unique non-empty strings")
        else:
            block_ids.add(block_id)
        if block.get("kind") == "source":
            source_block_count += 1
            source_block_sources.add(block.get("source_id"))
            if block.get("source_id") not in source_ids:
                errors.append(f"{block_id}: invalid source block")
            block_claim_ids = block.get("claim_ids", [])
            if not block_claim_ids or not set(block_claim_ids).issubset(claim_ids):
                errors.append(f"{block_id}: unknown claim reference")
        elif block.get("kind") == "image":
            image_block_count += 1
            image_block_urls.add(block.get("image_url"))
            if (block.get("source_id"), block.get("image_url")) not in allowed_assets:
                errors.append(f"{block_id}: unverified source image")
            if not isinstance(block.get("alt"), str) or not block["alt"].strip():
                errors.append(f"{block_id}: image alt is required")
        else:
            errors.append(f"{block_id}: unknown block kind")
    if source_block_count == 0:
        errors.append("at least one typed source block is required")
    elif source_block_sources != cited_source_ids or source_block_count != len(cited_source_ids):
        errors.append("typed source blocks must cover every cited source")
    if image_block_count != len(image_block_urls):
        errors.append("typed image blocks must not duplicate image URLs")
    if isinstance(markdown, str) and set(_MARKDOWN_IMAGE.findall(markdown)) != image_block_urls:
        errors.append("Markdown images and typed image blocks must match")
    referenced = [node.get("block_id") for node in ast if node.get("type") == "block_ref"]
    if set(referenced) != block_ids or len(referenced) != len(block_ids):
        errors.append("body_ast must reference every block exactly by id")
    return errors


def validate_moderator_result(result: dict, candidate: dict, draft: dict) -> list[str]:
    """Enforce evidence linkage independently from the model's decision."""
    errors: list[str] = []
    decision = result.get("decision")
    issues = result.get("issues")
    feedback = result.get("api_feedback")
    if decision not in {"accept", "revise", "reject"}:
        errors.append("unknown moderation decision")
    if not isinstance(result.get("rationale"), str) or not result["rationale"]:
        errors.append("moderation rationale is required")
    if not isinstance(issues, list):
        return [*errors, "moderation issues must be an array"]
    if decision in {"revise", "reject"} and not issues:
        errors.append(f"{decision} requires at least one issue")
    if not isinstance(feedback, list):
        return [*errors, "api_feedback must be an array"]

    claim_ids = {claim["claim_id"] for claim in candidate["claims"]}
    source_ids = {source["source_id"] for source in candidate["source_records"]}
    block_ids = {block["block_id"] for block in draft["blocks"]}

    # Accept never trusts a prose assertion of coverage: the host rechecks the
    # candidate's evidence graph and the normalized article's claim citations.
    if decision == "accept":
        for claim in candidate["claims"]:
            claim_id = claim["claim_id"]
            if not claim.get("source_ids"):
                errors.append(f"accept denied: {claim_id} has no sources")
            if not claim.get("evidence"):
                errors.append(f"accept denied: {claim_id} has no evidence")
            if f"[claim:{claim_id}]" not in draft.get("body_markdown", ""):
                errors.append(f"accept denied: article does not cite {claim_id}")

    seen_issue_ids: set[str] = set()
    for issue in issues:
        issue_id = issue.get("issue_id")
        if not isinstance(issue_id, str) or not issue_id or issue_id in seen_issue_ids:
            errors.append("moderation issue ids must be unique non-empty strings")
        else:
            seen_issue_ids.add(issue_id)
        if issue.get("code") not in {
            "unsupported_claim",
            "insufficient_evidence",
            "editorial_quality",
            "safety",
            "deduplication",
            "contract_mismatch",
        }:
            errors.append(f"{issue_id}: unknown moderation issue code")
        if not isinstance(issue.get("message"), str) or not issue["message"]:
            errors.append(f"{issue_id}: issue message is required")
        _validate_evidence(issue.get("evidence"), claim_ids, source_ids, issue_id, errors)
        for location in issue.get("locations", []):
            kind = location.get("kind")
            if kind == "claim" and location.get("claim_id") not in claim_ids:
                errors.append(f"{issue_id}: unknown claim location")
            elif kind == "block" and location.get("block_id") not in block_ids:
                errors.append(f"{issue_id}: unknown block location")
            elif kind == "markdown_section" and not location.get("heading"):
                errors.append(f"{issue_id}: markdown heading is required")
            elif kind not in {"claim", "block", "markdown_section"}:
                errors.append(f"{issue_id}: unknown location kind")

    seen_feedback_ids: set[str] = set()
    for item in feedback:
        feedback_id = item.get("feedback_id")
        if not isinstance(feedback_id, str) or not feedback_id or feedback_id in seen_feedback_ids:
            errors.append("api feedback ids must be unique non-empty strings")
        else:
            seen_feedback_ids.add(feedback_id)
        if item.get("surface") not in {
            "feed_news_contract",
            "feed_ingest_api",
            "moderation_audit",
        }:
            errors.append(f"{feedback_id}: unknown feedback surface")
        if not isinstance(item.get("summary"), str) or not item["summary"]:
            errors.append(f"{feedback_id}: feedback summary is required")
        if not isinstance(item.get("rationale"), str) or not item["rationale"]:
            errors.append(f"{feedback_id}: feedback rationale is required")
        if item.get("disposition") != "advisory_only":
            errors.append(f"{feedback_id}: feedback must stay advisory")
        if item.get("automatic_change_allowed") is not False:
            errors.append(f"{feedback_id}: automatic changes are forbidden")
        _validate_evidence(item.get("evidence"), claim_ids, source_ids, feedback_id, errors)
    return errors


def _validate_evidence(
    evidence: object,
    claim_ids: set[str],
    source_ids: set[str],
    item_id: object,
    errors: list[str],
) -> None:
    if evidence is None:
        return
    if not isinstance(evidence, dict):
        errors.append(f"{item_id}: invalid evidence object")
        return
    evidence_claims = evidence.get("claim_ids")
    evidence_sources = evidence.get("source_ids")
    if not isinstance(evidence_claims, list) or not evidence_claims:
        errors.append(f"{item_id}: evidence requires claim ids")
    elif len(evidence_claims) != len(set(evidence_claims)):
        errors.append(f"{item_id}: evidence claim ids must be unique")
    elif not set(evidence_claims).issubset(claim_ids):
        errors.append(f"{item_id}: unknown evidence claim")
    if not isinstance(evidence_sources, list) or not evidence_sources:
        errors.append(f"{item_id}: evidence requires source ids")
    elif len(evidence_sources) != len(set(evidence_sources)):
        errors.append(f"{item_id}: evidence source ids must be unique")
    elif not set(evidence_sources).issubset(source_ids):
        errors.append(f"{item_id}: unknown evidence source")
