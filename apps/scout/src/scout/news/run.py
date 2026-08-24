"""CLI runner for a zero-write local GPU news batch."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from .model import GrokJsonModel, GrokModelConfig, LocalJsonModel, LocalModelConfig
from .pipeline import NewsPipeline, load_brands

DEFAULT_RESEARCHER_MODEL = (
    r"C:\Users\HYPERPC\.lmstudio\models\lmstudio-community\gemma-4-E4B-it-GGUF"
    r"\gemma-4-E4B-it-Q4_K_M.gguf"
)
DEFAULT_COMPOSER_MODEL = (
    r"C:\Users\HYPERPC\.lmstudio\models\unsloth\Qwen3.6-35B-A3B-GGUF"
    r"\Qwen3.6-35B-A3B-UD-Q6_K.gguf"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    environment_brands = [
        value.strip()
        for value in os.environ.get("SCOUT_NEWS_BRAND_FILTER", "").split(",")
        if value.strip()
    ]
    parser.add_argument("--brands", type=Path, help="feed-news-brands.v2 JSON")
    parser.add_argument("--output", type=Path, required=True, help="zero-write artifact path")
    parser.add_argument("--known-fingerprints", type=Path)
    parser.add_argument(
        "--brand", action="append", default=environment_brands, help="brand_id filter"
    )
    parser.add_argument("--parallel", type=int, default=3)
    parser.add_argument(
        "--without-moderation",
        action="store_true",
        help="stop at a local artifact for a separately orchestrated Grok run",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    brands = load_brands(args.brands)
    if args.brand:
        selected = set(args.brand)
        brands = [brand for brand in brands if brand["brand_id"] in selected]
        missing = selected - {brand["brand_id"] for brand in brands}
        if missing:
            raise SystemExit(f"unknown brand ids: {', '.join(sorted(missing))}")
    known: set[str] = set()
    if args.known_fingerprints:
        loaded = json.loads(args.known_fingerprints.read_text(encoding="utf-8"))
        known = set(loaded)

    researcher = LocalJsonModel(
        LocalModelConfig(
            role="researcher",
            base_url=os.environ.get("SCOUT_NEWS_RESEARCHER_URL", "http://100.74.48.83:1235"),
            model=os.environ.get("SCOUT_NEWS_RESEARCHER_MODEL", DEFAULT_RESEARCHER_MODEL),
            prompt_version="feed-news.researcher.v2.2026-07-22",
            max_tokens=4096,
        )
    )
    composer = LocalJsonModel(
        LocalModelConfig(
            role="composer",
            base_url=os.environ.get("SCOUT_NEWS_COMPOSER_URL", "http://100.74.48.83:1236"),
            model=os.environ.get("SCOUT_NEWS_COMPOSER_MODEL", DEFAULT_COMPOSER_MODEL),
            prompt_version="feed-news.composer.v2.2026-07-22.editorial.1",
            max_tokens=8192,
            thinking=os.environ.get("SCOUT_NEWS_COMPOSER_THINKING", "true").lower() == "true",
        )
    )
    moderator = None
    if not args.without_moderation:
        moderator = GrokJsonModel(
            GrokModelConfig(
                role="moderator",
                executable=os.environ.get("SCOUT_NEWS_GROK_EXECUTABLE", "grok"),
                model=os.environ.get("SCOUT_NEWS_GROK_MODEL", "grok-4.5"),
                model_version=os.environ.get("SCOUT_NEWS_GROK_MODEL_VERSION", "grok-4.5"),
                prompt_version="feed-news.moderator.v2.2026-07-22",
                max_turns=8,
            )
        )
    pipeline = NewsPipeline(
        researcher=researcher,
        composer=composer,
        moderator=moderator,
        max_parallel_brands=max(1, min(args.parallel, 4)),
        max_revisions=2,
    )
    try:
        artifact = pipeline.run_batch(brands, known)
    finally:
        pipeline.close()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(artifact["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
