import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FEED_NEWS_JOB_OUTCOME_SCHEMA_VERSION,
  FEED_NEWS_PIPELINE_V2_SCHEMA_VERSION,
  NEWS_CANDIDATE_V1_SCHEMA_VERSION,
  NORMALIZED_NEWS_V1_SCHEMA_VERSION,
  isFeedNewsContract,
  isFeedNewsJobOutcome,
  isFeedNewsPipelineV2,
  isNewsCompositionV2,
  isNewsCandidateV1,
  isNewsModerationV2,
  isNormalizedNewsV1,
  isNewsPublicationV2,
  isNewsResearchFindingsV2,
  isNewsRoleRunProvenanceV2,
} from "./feed-news.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "fixtures/feed-news.v1.json"), "utf8"));
const fixtureV2 = JSON.parse(readFileSync(join(here, "fixtures/feed-news.v2.json"), "utf8"));

describe("feed-news.v1 golden outcomes", () => {
  it.each(["no_news", "exact_duplicate", "quality_rejected", "retryable_failure", "rich_article"])(
    "accepts the %s fixture",
    (scenario) => {
      expect(isFeedNewsJobOutcome(fixture[scenario])).toBe(true);
      expect(fixture[scenario].schema_version).toBe(FEED_NEWS_JOB_OUTCOME_SCHEMA_VERSION);
    },
  );

  it("exports independently importable candidate and normalized article guards", () => {
    expect(isNewsCandidateV1(fixture.rich_article.candidate)).toBe(true);
    expect(fixture.rich_article.candidate.schema_version).toBe(NEWS_CANDIDATE_V1_SCHEMA_VERSION);
    expect(isNormalizedNewsV1(fixture.rich_article.normalized_news)).toBe(true);
    expect(fixture.rich_article.normalized_news.schema_version).toBe(NORMALIZED_NEWS_V1_SCHEMA_VERSION);
  });

  it("covers image, chart, 3D and source inserts through the closed block union", () => {
    expect(fixture.rich_article.normalized_news.blocks.map((block: { kind: string }) => block.kind)).toEqual([
      "image",
      "chart",
      "model_3d",
      "source",
    ]);
  });

  it("keeps prompt/model/run provenance and evidence on semantic labels", () => {
    const article = fixture.rich_article.normalized_news;
    expect(article.provenance).toMatchObject({
      model_version: "2026-07-18",
      prompt_version: "feed-news-normalize.v2",
      research_run_id: "research-run-rich-001",
      normalization_run_id: "normalize-run-rich-001",
    });
    expect(article.semantic_labels[0]).toMatchObject({
      confidence: 0.97,
      run_id: "label-run-rich-001",
      evidence: { claim_ids: ["claim-speed"] },
    });
  });

  it("rejects an unknown schema version", () => {
    expect(
      isFeedNewsJobOutcome({ ...fixture.no_news, schema_version: "feed-news-job-outcome.v0" }),
    ).toBe(false);
  });

  it("rejects claim/source links that point outside source_records", () => {
    const candidate = structuredClone(fixture.rich_article.candidate);
    candidate.claims[0].source_ids = ["missing-source"];
    expect(isNewsCandidateV1(candidate)).toBe(false);
  });

  it("rejects a rich block with an unallowlisted MDX/JSX component kind", () => {
    const article = structuredClone(fixture.rich_article.normalized_news);
    article.blocks.push({
      block_id: "arbitrary-component",
      kind: "jsx",
      component: "DangerousWidget",
      props: { execute: "anything" },
    });
    article.body_ast.push({ type: "block_ref", block_id: "arbitrary-component" });
    expect(isNormalizedNewsV1(article)).toBe(false);
  });

  it("rejects arbitrary AST nodes and dangling typed block references", () => {
    const arbitraryNode = structuredClone(fixture.rich_article.normalized_news);
    arbitraryNode.body_ast.push({ type: "html_comment_json", payload: { component: "x" } });
    expect(isNormalizedNewsV1(arbitraryNode)).toBe(false);

    const danglingReference = structuredClone(fixture.rich_article.normalized_news);
    danglingReference.body_ast.push({ type: "block_ref", block_id: "missing-block" });
    expect(isNormalizedNewsV1(danglingReference)).toBe(false);
  });

  it("rejects an outcome that links a normalized article to another candidate", () => {
    const outcome = structuredClone(fixture.rich_article);
    outcome.normalized_news.candidate_id = "candidate-other";
    expect(isFeedNewsJobOutcome(outcome)).toBe(false);
  });
});

describe("feed-news.v2 role-separated pipeline", () => {
  it("accepts the four-stage golden pipeline and every independently importable artifact", () => {
    const pipeline = fixtureV2.accepted_pipeline;
    expect(pipeline.schema_version).toBe(FEED_NEWS_PIPELINE_V2_SCHEMA_VERSION);
    expect(isNewsResearchFindingsV2(pipeline.research)).toBe(true);
    expect(isNewsCompositionV2(pipeline.composition)).toBe(true);
    expect(isNewsModerationV2(pipeline.moderation)).toBe(true);
    expect(isNewsPublicationV2(pipeline.publication)).toBe(true);
    expect(isFeedNewsPipelineV2(pipeline)).toBe(true);
  });

  it("records separate local researcher, local composer, Grok and deterministic host runs", () => {
    const pipeline = fixtureV2.accepted_pipeline;
    expect([
      pipeline.research.run.role,
      pipeline.composition.run.role,
      pipeline.moderation.run.role,
      pipeline.publication.run.role,
    ]).toEqual(["local_researcher", "local_composer", "grok_moderator", "deterministic_publisher"]);
    expect(pipeline.research.run.executor.locality).toBe("local_gpu");
    expect(pipeline.composition.run.executor.locality).toBe("local_gpu");
    expect(pipeline.moderation.run.executor).toMatchObject({ locality: "remote_api", model_family: "grok" });
    expect(pipeline.publication.run.executor.kind).toBe("deterministic_host");
    expect([
      pipeline.research.run,
      pipeline.composition.run,
      pipeline.moderation.run,
      pipeline.publication.run,
    ].every(isNewsRoleRunProvenanceV2)).toBe(true);
  });

  it.each([
    ["revise", "revision_moderation", "revision_publication"],
    ["reject", "reject_moderation", "reject_publication"],
  ])("accepts a %s decision only with deterministic withholding", (_decision, moderationKey, publicationKey) => {
    const pipeline = structuredClone(fixtureV2.accepted_pipeline);
    pipeline.moderation = fixtureV2[moderationKey];
    pipeline.publication = fixtureV2[publicationKey];
    expect(isFeedNewsPipelineV2(pipeline)).toBe(true);
    expect(pipeline.publication).toMatchObject({ action: "withhold", feed_post_id: null });
  });

  it("keeps evidence-linked findings inside the candidate source/claim graph", () => {
    const pipeline = structuredClone(fixtureV2.accepted_pipeline);
    pipeline.research.findings[0].evidence.source_ids = ["missing-source"];
    expect(isNewsResearchFindingsV2(pipeline.research)).toBe(false);
    expect(isFeedNewsPipelineV2(pipeline)).toBe(false);
  });

  it("rejects a composer that changes source or claim material", () => {
    const changedSource = structuredClone(fixtureV2.accepted_pipeline);
    changedSource.composition.draft.source_records[0].content_hash = "sha256:changed";
    expect(isNewsCompositionV2(changedSource.composition)).toBe(true);
    expect(isFeedNewsPipelineV2(changedSource)).toBe(false);

    const changedClaim = structuredClone(fixtureV2.accepted_pipeline);
    changedClaim.composition.draft.claims[0].text = "A stronger claim not present in research.";
    expect(isFeedNewsPipelineV2(changedClaim)).toBe(false);
  });

  it("keeps Grok api_feedback advisory and outside the publishable body", () => {
    const moderation = fixtureV2.accepted_pipeline.moderation;
    expect(moderation).not.toHaveProperty("body_markdown");
    expect(moderation).not.toHaveProperty("body_ast");
    expect(moderation.api_feedback[0]).toMatchObject({
      disposition: "advisory_only",
      automatic_change_allowed: false,
    });

    const bodyInjection = { ...structuredClone(moderation), body_markdown: "Publish me" };
    expect(isNewsModerationV2(bodyInjection)).toBe(false);

    const automaticChange = structuredClone(moderation);
    automaticChange.api_feedback[0].automatic_change_allowed = true;
    expect(isNewsModerationV2(automaticChange)).toBe(false);
  });

  it("rejects generic JSON and tool directives on strict v2 artifacts", () => {
    const moderation = {
      ...structuredClone(fixtureV2.accepted_pipeline.moderation),
      tool_directive: { name: "patch_api", arguments: { allow: true } },
    };
    expect(isNewsModerationV2(moderation)).toBe(false);

    const publication = {
      ...structuredClone(fixtureV2.accepted_pipeline.publication),
      payload: { arbitrary: "json" },
    };
    expect(isNewsPublicationV2(publication)).toBe(false);
  });

  it("does not let Grok publish or let the host publish revise/reject decisions", () => {
    const modelPublisher = structuredClone(fixtureV2.accepted_pipeline.publication);
    modelPublisher.run.executor = fixtureV2.accepted_pipeline.moderation.run.executor;
    expect(isNewsPublicationV2(modelPublisher)).toBe(false);

    const revised = structuredClone(fixtureV2.accepted_pipeline);
    revised.moderation = fixtureV2.revision_moderation;
    revised.publication.moderation_artifact_id = revised.moderation.artifact_id;
    revised.publication.run.input_artifact_ids[1] = revised.moderation.artifact_id;
    expect(isFeedNewsPipelineV2(revised)).toBe(false);
  });

  it("dispatches persisted v1 outcomes and new v2 pipelines without downgrading either", () => {
    expect(isFeedNewsContract(fixture.rich_article)).toBe(true);
    expect(isFeedNewsJobOutcome(fixture.rich_article)).toBe(true);
    expect(isFeedNewsContract(fixtureV2.accepted_pipeline)).toBe(true);
    expect(isFeedNewsJobOutcome(fixtureV2.accepted_pipeline)).toBe(false);
  });
});
