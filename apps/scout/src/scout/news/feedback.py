"""Human-review seam for advisory Grok API feedback.

The news worker never calls this module. A reviewer must invoke this command with
``--submit`` and identify themselves before any Multica card is created or updated.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
from collections.abc import Callable
from contextlib import contextmanager
from pathlib import Path


def feedback_review_items(batch: dict) -> list[dict]:
    unique: dict[str, dict] = {}
    for worker_item in batch.get("items", []):
        detail = worker_item.get("detail", {})
        history = worker_item.get("moderation_history", detail.get("moderation_history", []))
        moderations = list(history) if isinstance(history, list) else []
        final = worker_item.get("moderation", detail.get("moderation"))
        if isinstance(final, dict):
            moderations.append(final)
        for moderation in moderations:
            for feedback in moderation.get("api_feedback", []):
                canonical = json.dumps(
                    {
                        "surface": feedback.get("surface"),
                        "summary": feedback.get("summary"),
                        "rationale": feedback.get("rationale"),
                        "evidence": feedback.get("evidence"),
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                )
                fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
                unique.setdefault(
                    fingerprint,
                    {
                        "fingerprint": fingerprint,
                        "review_priority": (
                            "high" if feedback.get("surface") == "feed_ingest_api" else "medium"
                        ),
                        "brand_id": worker_item.get("brand_id"),
                        "moderation_artifact_id": moderation.get("artifact_id"),
                        **feedback,
                    },
                )
    return list(unique.values())


class MulticaFeedbackReview:
    def __init__(self, runner: Callable[..., subprocess.CompletedProcess] = subprocess.run) -> None:
        self._runner = runner

    def submit(
        self,
        item: dict,
        *,
        approved_by: str,
        project_id: str,
        parent_id: str | None = None,
    ) -> dict:
        if not approved_by.strip():
            raise ValueError("human reviewer identity is required")
        if not project_id.strip():
            raise ValueError("Multica project id is required")
        fingerprint = item["fingerprint"]
        existing = self._search(fingerprint)
        if existing is not None:
            self._append_review(existing["id"], item, approved_by)
            self._run(
                [
                    "multica",
                    "issue",
                    "update",
                    existing["id"],
                    "--priority",
                    item["review_priority"],
                    "--output",
                    "json",
                ]
            )
            return {"action": "updated", "issue_id": existing["id"], "fingerprint": fingerprint}
        issue = self._create(item, approved_by, project_id, parent_id)
        issue_id = issue["id"]
        self._run(
            [
                "multica",
                "issue",
                "metadata",
                "set",
                issue_id,
                "--key",
                "news_api_feedback_fingerprint",
                "--value",
                fingerprint,
                "--type",
                "string",
            ]
        )
        return {"action": "created", "issue_id": issue_id, "fingerprint": fingerprint}

    def _search(self, fingerprint: str) -> dict | None:
        result = self._run(
            [
                "multica",
                "issue",
                "search",
                fingerprint,
                "--include-closed",
                "--limit",
                "20",
                "--output",
                "json",
            ]
        )
        payload = json.loads(result.stdout)
        issues = payload.get("issues", []) if isinstance(payload, dict) else payload
        for issue in issues:
            if issue.get("metadata", {}).get("news_api_feedback_fingerprint") == fingerprint:
                return issue
        return None

    def _create(self, item: dict, approved_by: str, project_id: str, parent_id: str | None) -> dict:
        title = f"News API feedback: {item['summary']}"[:180]
        body = self._review_body(item, approved_by)
        with self._content_file("feedback.description.", body) as path:
            command = [
                "multica",
                "issue",
                "create",
                "--title",
                title,
                "--description-file",
                path.name,
                "--priority",
                item["review_priority"],
                "--status",
                "backlog",
                "--project",
                project_id,
                "--output",
                "json",
            ]
            if parent_id:
                command.extend(["--parent", parent_id])
            result = self._run(command)
        return json.loads(result.stdout)

    def _append_review(self, issue_id: str, item: dict, approved_by: str) -> None:
        with self._content_file("feedback.comment.", self._review_body(item, approved_by)) as path:
            self._run(
                [
                    "multica",
                    "issue",
                    "comment",
                    "add",
                    issue_id,
                    "--content-file",
                    path.name,
                ]
            )

    def _run(self, command: list[str]) -> subprocess.CompletedProcess:
        return self._runner(command, check=True, capture_output=True, text=True)

    @staticmethod
    def _review_body(item: dict, approved_by: str) -> str:
        return (
            f"Human-reviewed Grok advisory; reviewer: {approved_by}.\n\n"
            f"Surface: {item['surface']}\n\n"
            f"Suggested review priority: {item['review_priority']}\n\n"
            f"Summary: {item['summary']}\n\n"
            f"Rationale: {item['rationale']}\n\n"
            f"Evidence: {json.dumps(item.get('evidence'), ensure_ascii=False, sort_keys=True)}\n\n"
            f"Source moderation artifact: {item.get('moderation_artifact_id')}\n\n"
            f"Dedup fingerprint: {item['fingerprint']}\n\n"
            "This card is a proposal for human review, not an automatic API change.\n"
        )

    @staticmethod
    @contextmanager
    def _content_file(prefix: str, body: str):
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            prefix=prefix,
            suffix=".md",
            dir=Path.cwd(),
            delete=True,
        ) as file:
            file.write(body)
            file.flush()
            yield file


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path)
    parser.add_argument("--submit", action="store_true")
    parser.add_argument("--human-approved-by")
    parser.add_argument("--project")
    parser.add_argument("--parent")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    batch = json.loads(args.artifact.read_text(encoding="utf-8"))
    items = feedback_review_items(batch)
    if not args.submit:
        print(json.dumps({"submitted": False, "review_items": items}, ensure_ascii=False, indent=2))
        return
    if not args.human_approved_by or not args.project:
        raise SystemExit("--submit requires --human-approved-by and --project")
    sink = MulticaFeedbackReview()
    results = [
        sink.submit(
            item,
            approved_by=args.human_approved_by,
            project_id=args.project,
            parent_id=args.parent,
        )
        for item in items
    ]
    print(json.dumps({"submitted": True, "results": results}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
