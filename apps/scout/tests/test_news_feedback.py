from __future__ import annotations

import json
import subprocess

import pytest

from scout.news.feedback import MulticaFeedbackReview, feedback_review_items


def _batch() -> dict:
    return {
        "items": [
            {
                "brand_id": "ready",
                "moderation": {
                    "artifact_id": "moderation-1",
                    "api_feedback": [
                        {
                            "feedback_id": "feedback-1",
                            "surface": "moderation_audit",
                            "summary": "Show claim coverage.",
                            "rationale": "Reviewers need evidence.",
                            "evidence": {"claim_ids": ["c1"], "source_ids": ["s1"]},
                            "disposition": "advisory_only",
                            "automatic_change_allowed": False,
                        }
                    ],
                },
            }
        ]
    }


def test_feedback_is_only_a_deduplicated_review_item_by_default():
    batch = _batch()
    batch["items"].append(batch["items"][0])

    items = feedback_review_items(batch)

    assert len(items) == 1
    assert len(items[0]["fingerprint"]) == 64
    assert items[0]["review_priority"] == "medium"
    assert items[0]["automatic_change_allowed"] is False


def test_multica_submission_requires_named_human_reviewer():
    sink = MulticaFeedbackReview()
    with pytest.raises(ValueError, match="human reviewer"):
        sink.submit(feedback_review_items(_batch())[0], approved_by="", project_id="project")


def test_human_review_seam_creates_backlog_card_and_pins_fingerprint():
    calls: list[list[str]] = []

    def fake_run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
        calls.append(command)
        if command[2] == "search":
            stdout = "[]"
        elif command[2] == "create":
            stdout = json.dumps({"id": "issue-1"})
        else:
            stdout = "{}"
        return subprocess.CompletedProcess(command, 0, stdout=stdout, stderr="")

    item = feedback_review_items(_batch())[0]
    result = MulticaFeedbackReview(fake_run).submit(
        item,
        approved_by="Human Editor",
        project_id="project-1",
        parent_id="parent-1",
    )

    assert result["action"] == "created"
    create = next(command for command in calls if command[2] == "create")
    assert create[create.index("--status") + 1] == "backlog"
    assert "--description-file" in create
    assert any(command[2:5] == ["metadata", "set", "issue-1"] for command in calls)
