// Шов `jobs` — news research/normalization worker → API feed ingest. MF-2054.
//
// Контракт намеренно хранит agent-native CommonMark в `body_markdown`, а порядок rich-вставок —
// в закрытом typed AST (`body_ast` + `blocks`). MDX/JSX-компоненты, исполняемый код и JSON в
// HTML-комментариях не являются частью шва. Новая форма блока требует новой версии контракта.

export const NEWS_CANDIDATE_V1_SCHEMA_VERSION = "news-candidate.v1" as const;
export const NORMALIZED_NEWS_V1_SCHEMA_VERSION = "normalized-news.v1" as const;
export const FEED_NEWS_JOB_OUTCOME_SCHEMA_VERSION = "feed-news-job-outcome.v1" as const;

export interface NewsSourceRecordV1 {
  source_id: string;
  canonical_url: string;
  title: string;
  publisher: string;
  published_at: string | null;
  retrieved_at: string;
  /** Stable digest of the normalized source content, including the algorithm prefix. */
  content_hash: string;
}

export interface NewsClaimV1 {
  claim_id: string;
  text: string;
  /** One or more ids from the enclosing `source_records`; claims without a source are invalid. */
  source_ids: string[];
}

export interface NewsEvidenceLinkV1 {
  claim_ids: string[];
  source_ids: string[];
}

export interface NewsModelIdentityV1 {
  provider: string;
  model: string;
  model_version: string;
}

export interface NewsSemanticLabelV1 {
  label: string;
  confidence: number;
  evidence: NewsEvidenceLinkV1;
  model: NewsModelIdentityV1;
  run_id: string;
}

export const NEWS_COMMUNITY_SUBJECT_TYPES = ["vendor", "machine", "craft"] as const;
export type NewsCommunitySubjectType = (typeof NEWS_COMMUNITY_SUBJECT_TYPES)[number];

/** A resolution hint only: the API remains responsible for resolving and authorizing a community. */
export interface NewsCommunitySubjectHintV1 {
  subject_type: NewsCommunitySubjectType;
  subject_id: string | null;
  subject_slug: string | null;
  display_name: string;
  confidence: number;
  evidence_claim_ids: string[];
}

export interface NewsProvenanceV1 extends NewsModelIdentityV1 {
  prompt_version: string;
  research_run_id: string;
  normalization_run_id: string | null;
  generated_at: string;
}

export const NEWS_DEDUP_MATCH_KINDS = ["canonical_url", "content_hash", "source_fingerprint"] as const;
export type NewsDedupMatchKind = (typeof NEWS_DEDUP_MATCH_KINDS)[number];

export interface NewsExactDedupMatchV1 {
  feed_post_id: string;
  matched_on: NewsDedupMatchKind;
  matched_value: string;
}

export interface NewsNearDedupMatchV1 {
  feed_post_id: string;
  similarity: number;
}

export interface NewsDedupSignalsV1 {
  canonical_url_hashes: string[];
  content_hashes: string[];
  title_fingerprint: string;
  semantic_fingerprint: string | null;
  exact_match: NewsExactDedupMatchV1 | null;
  near_matches: NewsNearDedupMatchV1[];
}

/** Research-stage material. It is source/claim centric and contains no publishable rich body. */
export interface NewsCandidateV1 {
  schema_version: typeof NEWS_CANDIDATE_V1_SCHEMA_VERSION;
  candidate_id: string;
  title: string;
  summary: string;
  source_records: NewsSourceRecordV1[];
  claims: NewsClaimV1[];
  semantic_labels: NewsSemanticLabelV1[];
  community_subject_hint: NewsCommunitySubjectHintV1 | null;
  provenance: NewsProvenanceV1;
  dedup_signals: NewsDedupSignalsV1;
}

export interface NewsMarkdownNodeV1 {
  type: "markdown";
  markdown: string;
}

export interface NewsBlockReferenceNodeV1 {
  type: "block_ref";
  block_id: string;
}

export type NewsBodyNodeV1 = NewsMarkdownNodeV1 | NewsBlockReferenceNodeV1;

interface NewsBlockBaseV1 {
  block_id: string;
}

export interface NewsImageBlockV1 extends NewsBlockBaseV1 {
  kind: "image";
  source_id: string;
  image_url: string;
  alt: string;
  caption: string | null;
  content_hash: string | null;
}

export const NEWS_CHART_TYPES = ["bar", "line", "pie"] as const;
export type NewsChartType = (typeof NEWS_CHART_TYPES)[number];

export interface NewsChartPointV1 {
  x: string;
  y: number;
}

export interface NewsChartSeriesV1 {
  label: string;
  points: NewsChartPointV1[];
}

export interface NewsChartBlockV1 extends NewsBlockBaseV1 {
  kind: "chart";
  source_ids: string[];
  title: string;
  chart_type: NewsChartType;
  x_axis_label: string | null;
  y_axis_label: string | null;
  series: NewsChartSeriesV1[];
}

export const NEWS_MODEL_3D_MIME_TYPES = ["model/gltf-binary", "model/gltf+json", "model/3mf"] as const;
export type NewsModel3dMimeType = (typeof NEWS_MODEL_3D_MIME_TYPES)[number];

export interface NewsModel3dBlockV1 extends NewsBlockBaseV1 {
  kind: "model_3d";
  source_ids: string[];
  /** Resolved portal model when available; otherwise `asset_url` provides the source artifact. */
  model_id: string | null;
  asset_url: string | null;
  mime_type: NewsModel3dMimeType;
  poster_url: string | null;
  alt: string;
  caption: string | null;
}

export interface NewsSourceInsertBlockV1 extends NewsBlockBaseV1 {
  kind: "source";
  source_id: string;
  claim_ids: string[];
  label: string;
}

/** Closed allowlist. There is deliberately no generic component/html/jsx block. */
export type NewsTypedBlockV1 =
  | NewsImageBlockV1
  | NewsChartBlockV1
  | NewsModel3dBlockV1
  | NewsSourceInsertBlockV1;

/** Publishable, self-contained projection; consumers need no cross-domain source imports. */
export interface NormalizedNewsV1 {
  schema_version: typeof NORMALIZED_NEWS_V1_SCHEMA_VERSION;
  normalized_news_id: string;
  candidate_id: string;
  title: string;
  dek: string | null;
  /** Plain CommonMark fallback/projection. It must not carry MDX/JSX or hidden JSON payloads. */
  body_markdown: string;
  /** Authoritative ordering of Markdown segments and references into the closed `blocks` union. */
  body_ast: NewsBodyNodeV1[];
  blocks: NewsTypedBlockV1[];
  source_records: NewsSourceRecordV1[];
  claims: NewsClaimV1[];
  semantic_labels: NewsSemanticLabelV1[];
  community_subject_hint: NewsCommunitySubjectHintV1 | null;
  provenance: NewsProvenanceV1;
  dedup_signals: NewsDedupSignalsV1;
}

export const FEED_NEWS_JOB_OUTCOMES = [
  "ready",
  "no_news",
  "exact_duplicate",
  "quality_rejected",
  "retryable_failure",
] as const;
export type FeedNewsJobOutcomeKind = (typeof FEED_NEWS_JOB_OUTCOMES)[number];

interface FeedNewsJobOutcomeBase {
  schema_version: typeof FEED_NEWS_JOB_OUTCOME_SCHEMA_VERSION;
  job_id: string;
  candidate_id: string | null;
  completed_at: string;
  provenance: NewsProvenanceV1;
}

export interface FeedNewsReadyOutcome extends FeedNewsJobOutcomeBase {
  outcome: "ready";
  candidate_id: string;
  candidate: NewsCandidateV1;
  normalized_news: NormalizedNewsV1;
}

export interface FeedNewsNoNewsOutcome extends FeedNewsJobOutcomeBase {
  outcome: "no_news";
  candidate_id: null;
  candidate: null;
  normalized_news: null;
  source_records: NewsSourceRecordV1[];
  reason: {
    code: "no_eligible_news";
    message: string;
  };
}

export interface FeedNewsExactDuplicateOutcome extends FeedNewsJobOutcomeBase {
  outcome: "exact_duplicate";
  candidate_id: string;
  candidate: NewsCandidateV1;
  normalized_news: null;
  duplicate_of: NewsExactDedupMatchV1;
}

export const NEWS_QUALITY_REJECTION_CODES = [
  "insufficient_sources",
  "low_confidence",
  "stale",
  "off_topic",
  "unsafe_content",
  "unsupported_content",
] as const;
export type NewsQualityRejectionCode = (typeof NEWS_QUALITY_REJECTION_CODES)[number];

export interface FeedNewsQualityRejectedOutcome extends FeedNewsJobOutcomeBase {
  outcome: "quality_rejected";
  candidate_id: string;
  candidate: NewsCandidateV1;
  normalized_news: null;
  rejection: {
    code: NewsQualityRejectionCode;
    message: string;
    evidence: NewsEvidenceLinkV1;
  };
}

export interface FeedNewsRetryableFailureOutcome extends FeedNewsJobOutcomeBase {
  outcome: "retryable_failure";
  candidate: NewsCandidateV1 | null;
  normalized_news: null;
  error: {
    code: string;
    message: string;
    retryable: true;
    retry_after_seconds: number | null;
  };
}

export type FeedNewsJobOutcome =
  | FeedNewsReadyOutcome
  | FeedNewsNoNewsOutcome
  | FeedNewsExactDuplicateOutcome
  | FeedNewsQualityRejectedOutcome
  | FeedNewsRetryableFailureOutcome;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isStringArray(value: unknown, allowEmpty = true): value is string[] {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every(isString);
}

function hasUniqueIds(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function isSourceRecord(value: unknown): value is NewsSourceRecordV1 {
  if (!isRecord(value)) return false;
  return (
    isString(value.source_id) &&
    isString(value.canonical_url) &&
    isString(value.title) &&
    isString(value.publisher) &&
    isNullableString(value.published_at) &&
    isString(value.retrieved_at) &&
    isString(value.content_hash)
  );
}

function isClaim(value: unknown, sourceIds: Set<string>): value is NewsClaimV1 {
  if (!isRecord(value) || !isString(value.claim_id) || !isString(value.text)) return false;
  return isStringArray(value.source_ids, false) && value.source_ids.every((id) => sourceIds.has(id));
}

function isEvidence(value: unknown, sourceIds: Set<string>, claimIds: Set<string>): value is NewsEvidenceLinkV1 {
  if (!isRecord(value)) return false;
  return (
    isStringArray(value.claim_ids) &&
    value.claim_ids.every((id) => claimIds.has(id)) &&
    isStringArray(value.source_ids) &&
    value.source_ids.every((id) => sourceIds.has(id))
  );
}

function isModelIdentity(value: unknown): value is NewsModelIdentityV1 {
  return (
    isRecord(value) && isString(value.provider) && isString(value.model) && isString(value.model_version)
  );
}

function isSemanticLabel(
  value: unknown,
  sourceIds: Set<string>,
  claimIds: Set<string>,
): value is NewsSemanticLabelV1 {
  if (!isRecord(value)) return false;
  return (
    isString(value.label) &&
    isConfidence(value.confidence) &&
    isEvidence(value.evidence, sourceIds, claimIds) &&
    isModelIdentity(value.model) &&
    isString(value.run_id)
  );
}

function isCommunityHint(value: unknown, claimIds: Set<string>): value is NewsCommunitySubjectHintV1 | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return (
    (NEWS_COMMUNITY_SUBJECT_TYPES as readonly unknown[]).includes(value.subject_type) &&
    isNullableString(value.subject_id) &&
    isNullableString(value.subject_slug) &&
    (value.subject_id !== null || value.subject_slug !== null) &&
    isString(value.display_name) &&
    isConfidence(value.confidence) &&
    isStringArray(value.evidence_claim_ids) &&
    value.evidence_claim_ids.every((id) => claimIds.has(id))
  );
}

function isProvenance(value: unknown): value is NewsProvenanceV1 {
  if (!isRecord(value)) return false;
  return (
    isString(value.prompt_version) &&
    isString(value.research_run_id) &&
    isNullableString(value.normalization_run_id) &&
    isString(value.generated_at) &&
    isModelIdentity(value)
  );
}

function isExactDedupMatch(value: unknown): value is NewsExactDedupMatchV1 {
  if (!isRecord(value)) return false;
  return (
    isString(value.feed_post_id) &&
    (NEWS_DEDUP_MATCH_KINDS as readonly unknown[]).includes(value.matched_on) &&
    isString(value.matched_value)
  );
}

function isDedupSignals(value: unknown): value is NewsDedupSignalsV1 {
  if (!isRecord(value)) return false;
  if (!isStringArray(value.canonical_url_hashes) || !isStringArray(value.content_hashes)) return false;
  if (!isString(value.title_fingerprint) || !isNullableString(value.semantic_fingerprint)) return false;
  if (value.exact_match !== null && !isExactDedupMatch(value.exact_match)) return false;
  if (!Array.isArray(value.near_matches)) return false;
  return value.near_matches.every(
    (match) =>
      isRecord(match) && isString(match.feed_post_id) && isConfidence(match.similarity),
  );
}

interface ValidatedNewsMaterial {
  sourceIds: Set<string>;
  claimIds: Set<string>;
}

function validateNewsMaterial(value: Record<string, unknown>): ValidatedNewsMaterial | null {
  if (!Array.isArray(value.source_records) || !value.source_records.every(isSourceRecord)) return null;
  const sourceIdsList = value.source_records.map((source) => source.source_id);
  if (!hasUniqueIds(sourceIdsList)) return null;
  const sourceIds = new Set(sourceIdsList);

  if (!Array.isArray(value.claims) || !value.claims.every((claim) => isClaim(claim, sourceIds))) return null;
  const claimIdsList = value.claims.map((claim) => claim.claim_id);
  if (!hasUniqueIds(claimIdsList)) return null;
  const claimIds = new Set(claimIdsList);

  if (
    !Array.isArray(value.semantic_labels) ||
    !value.semantic_labels.every((label) => isSemanticLabel(label, sourceIds, claimIds))
  ) return null;
  if (!isCommunityHint(value.community_subject_hint, claimIds)) return null;
  if (!isProvenance(value.provenance) || !isDedupSignals(value.dedup_signals)) return null;
  return { sourceIds, claimIds };
}

export function isNewsCandidateV1(value: unknown): value is NewsCandidateV1 {
  if (!isRecord(value) || value.schema_version !== NEWS_CANDIDATE_V1_SCHEMA_VERSION) return false;
  if (!isString(value.candidate_id) || !isString(value.title) || !isString(value.summary)) return false;
  const material = validateNewsMaterial(value);
  return material !== null && material.sourceIds.size > 0 && material.claimIds.size > 0;
}

function isTypedBlock(
  value: unknown,
  sourceIds: Set<string>,
  claimIds: Set<string>,
): value is NewsTypedBlockV1 {
  if (!isRecord(value) || !isString(value.block_id)) return false;
  if (value.kind === "image") {
    return (
      isString(value.source_id) &&
      sourceIds.has(value.source_id) &&
      isString(value.image_url) &&
      isString(value.alt) &&
      isNullableString(value.caption) &&
      isNullableString(value.content_hash)
    );
  }
  if (value.kind === "chart") {
    return (
      isStringArray(value.source_ids, false) &&
      value.source_ids.every((id) => sourceIds.has(id)) &&
      isString(value.title) &&
      (NEWS_CHART_TYPES as readonly unknown[]).includes(value.chart_type) &&
      isNullableString(value.x_axis_label) &&
      isNullableString(value.y_axis_label) &&
      Array.isArray(value.series) &&
      value.series.length > 0 &&
      value.series.every(
        (series) =>
          isRecord(series) &&
          isString(series.label) &&
          Array.isArray(series.points) &&
          series.points.length > 0 &&
          series.points.every(
            (point) => isRecord(point) && isString(point.x) && typeof point.y === "number" && Number.isFinite(point.y),
          ),
      )
    );
  }
  if (value.kind === "model_3d") {
    return (
      isStringArray(value.source_ids, false) &&
      value.source_ids.every((id) => sourceIds.has(id)) &&
      isNullableString(value.model_id) &&
      isNullableString(value.asset_url) &&
      (value.model_id !== null || value.asset_url !== null) &&
      (NEWS_MODEL_3D_MIME_TYPES as readonly unknown[]).includes(value.mime_type) &&
      isNullableString(value.poster_url) &&
      isString(value.alt) &&
      isNullableString(value.caption)
    );
  }
  if (value.kind === "source") {
    return (
      isString(value.source_id) &&
      sourceIds.has(value.source_id) &&
      isStringArray(value.claim_ids, false) &&
      value.claim_ids.every((id) => claimIds.has(id)) &&
      isString(value.label)
    );
  }
  return false;
}

export function isNormalizedNewsV1(value: unknown): value is NormalizedNewsV1 {
  if (!isRecord(value) || value.schema_version !== NORMALIZED_NEWS_V1_SCHEMA_VERSION) return false;
  if (!isString(value.normalized_news_id) || !isString(value.candidate_id) || !isString(value.title)) return false;
  if (!isNullableString(value.dek) || !isString(value.body_markdown)) return false;
  const material = validateNewsMaterial(value);
  if (!material || material.sourceIds.size === 0 || material.claimIds.size === 0) return false;

  if (
    !Array.isArray(value.blocks) ||
    !value.blocks.every((block) => isTypedBlock(block, material.sourceIds, material.claimIds))
  ) return false;
  const blockIdsList = value.blocks.map((block) => block.block_id);
  if (!hasUniqueIds(blockIdsList)) return false;
  const blockIds = new Set(blockIdsList);

  if (!Array.isArray(value.body_ast) || value.body_ast.length === 0) return false;
  return value.body_ast.every((node) => {
    if (!isRecord(node)) return false;
    if (node.type === "markdown") return isString(node.markdown);
    if (node.type === "block_ref") return isString(node.block_id) && blockIds.has(node.block_id);
    return false;
  });
}

function hasOutcomeBase(value: Record<string, unknown>): boolean {
  return (
    value.schema_version === FEED_NEWS_JOB_OUTCOME_SCHEMA_VERSION &&
    isString(value.job_id) &&
    isNullableString(value.candidate_id) &&
    isString(value.completed_at) &&
    isProvenance(value.provenance)
  );
}

export function isFeedNewsJobOutcome(value: unknown): value is FeedNewsJobOutcome {
  if (!isRecord(value) || !hasOutcomeBase(value)) return false;
  if (!(FEED_NEWS_JOB_OUTCOMES as readonly unknown[]).includes(value.outcome)) return false;

  if (value.outcome === "ready") {
    return (
      isString(value.candidate_id) &&
      isNewsCandidateV1(value.candidate) &&
      value.candidate.candidate_id === value.candidate_id &&
      isNormalizedNewsV1(value.normalized_news) &&
      value.normalized_news.candidate_id === value.candidate_id
    );
  }
  if (value.outcome === "no_news") {
    return (
      value.candidate_id === null &&
      value.candidate === null &&
      value.normalized_news === null &&
      Array.isArray(value.source_records) &&
      value.source_records.every(isSourceRecord) &&
      isRecord(value.reason) &&
      value.reason.code === "no_eligible_news" &&
      isString(value.reason.message)
    );
  }
  if (value.outcome === "exact_duplicate") {
    return (
      isString(value.candidate_id) &&
      isNewsCandidateV1(value.candidate) &&
      value.candidate.candidate_id === value.candidate_id &&
      value.normalized_news === null &&
      isExactDedupMatch(value.duplicate_of) &&
      value.candidate.dedup_signals.exact_match !== null &&
      value.candidate.dedup_signals.exact_match.feed_post_id === value.duplicate_of.feed_post_id
    );
  }
  if (value.outcome === "quality_rejected") {
    if (
      !isString(value.candidate_id) ||
      !isNewsCandidateV1(value.candidate) ||
      value.candidate.candidate_id !== value.candidate_id ||
      value.normalized_news !== null ||
      !isRecord(value.rejection) ||
      !(NEWS_QUALITY_REJECTION_CODES as readonly unknown[]).includes(value.rejection.code) ||
      !isString(value.rejection.message)
    ) return false;
    const sourceIds = new Set(value.candidate.source_records.map((source) => source.source_id));
    const claimIds = new Set(value.candidate.claims.map((claim) => claim.claim_id));
    return isEvidence(value.rejection.evidence, sourceIds, claimIds);
  }
  if (value.outcome === "retryable_failure") {
    if (value.candidate !== null && !isNewsCandidateV1(value.candidate)) return false;
    if (value.candidate === null && value.candidate_id !== null) return false;
    if (value.candidate !== null && value.candidate.candidate_id !== value.candidate_id) return false;
    return (
      value.normalized_news === null &&
      isRecord(value.error) &&
      isString(value.error.code) &&
      isString(value.error.message) &&
      value.error.retryable === true &&
      (value.error.retry_after_seconds === null ||
        (typeof value.error.retry_after_seconds === "number" && value.error.retry_after_seconds >= 0))
    );
  }
  return false;
}

// v2 keeps every actor as a separate, versioned artifact. The v1 guards above stay unchanged so
// queued and persisted `feed-news-job-outcome.v1` values remain readable during migration.
export const NEWS_ROLE_RUN_V2_SCHEMA_VERSION = "news-role-run.v2" as const;
export const NEWS_RESEARCH_FINDINGS_V2_SCHEMA_VERSION = "news-research-findings.v2" as const;
export const NEWS_COMPOSITION_V2_SCHEMA_VERSION = "news-composition.v2" as const;
export const NEWS_MODERATION_V2_SCHEMA_VERSION = "news-moderation.v2" as const;
export const NEWS_PUBLICATION_V2_SCHEMA_VERSION = "news-publication.v2" as const;
export const FEED_NEWS_PIPELINE_V2_SCHEMA_VERSION = "feed-news-pipeline.v2" as const;

export const NEWS_PIPELINE_ROLES_V2 = [
  "local_researcher",
  "local_composer",
  "grok_moderator",
  "deterministic_publisher",
] as const;
export type NewsPipelineRoleV2 = (typeof NEWS_PIPELINE_ROLES_V2)[number];

export interface NewsLocalModelExecutorV2 {
  kind: "model";
  locality: "local_gpu";
  identity: NewsModelIdentityV1;
}

export interface NewsGrokModelExecutorV2 {
  kind: "model";
  locality: "remote_api";
  model_family: "grok";
  identity: NewsModelIdentityV1;
}

export interface NewsDeterministicExecutorV2 {
  kind: "deterministic_host";
  component: string;
  component_version: string;
}

interface NewsRoleRunProvenanceBaseV2 {
  schema_version: typeof NEWS_ROLE_RUN_V2_SCHEMA_VERSION;
  role: NewsPipelineRoleV2;
  run_id: string;
  prompt_version: string | null;
  started_at: string;
  completed_at: string;
  input_artifact_ids: string[];
  output_artifact_id: string;
}

export interface NewsLocalResearcherRunV2 extends NewsRoleRunProvenanceBaseV2 {
  role: "local_researcher";
  executor: NewsLocalModelExecutorV2;
  prompt_version: string;
}

export interface NewsLocalComposerRunV2 extends NewsRoleRunProvenanceBaseV2 {
  role: "local_composer";
  executor: NewsLocalModelExecutorV2;
  prompt_version: string;
}

export interface NewsGrokModeratorRunV2 extends NewsRoleRunProvenanceBaseV2 {
  role: "grok_moderator";
  executor: NewsGrokModelExecutorV2;
  prompt_version: string;
}

export interface NewsDeterministicPublisherRunV2 extends NewsRoleRunProvenanceBaseV2 {
  role: "deterministic_publisher";
  executor: NewsDeterministicExecutorV2;
  prompt_version: null;
}

export type NewsRoleRunProvenanceV2 =
  | NewsLocalResearcherRunV2
  | NewsLocalComposerRunV2
  | NewsGrokModeratorRunV2
  | NewsDeterministicPublisherRunV2;

export const NEWS_RESEARCH_FINDING_KINDS_V2 = ["fact", "context", "risk"] as const;
export type NewsResearchFindingKindV2 = (typeof NEWS_RESEARCH_FINDING_KINDS_V2)[number];

export interface NewsResearchFindingV2 {
  finding_id: string;
  kind: NewsResearchFindingKindV2;
  text: string;
  confidence: number;
  /** Every finding must resolve to at least one candidate claim and source. */
  evidence: NewsEvidenceLinkV1;
}

export interface NewsResearchFindingsV2 {
  schema_version: typeof NEWS_RESEARCH_FINDINGS_V2_SCHEMA_VERSION;
  artifact_id: string;
  candidate: NewsCandidateV1;
  findings: NewsResearchFindingV2[];
  run: NewsLocalResearcherRunV2;
}

export interface NewsCompositionV2 {
  schema_version: typeof NEWS_COMPOSITION_V2_SCHEMA_VERSION;
  artifact_id: string;
  research_artifact_id: string;
  /** A draft is publishable only after moderation and the deterministic host gate. */
  draft: NormalizedNewsV1;
  used_finding_ids: string[];
  run: NewsLocalComposerRunV2;
}

export const NEWS_MODERATION_DECISIONS_V2 = ["accept", "revise", "reject"] as const;
export type NewsModerationDecisionV2 = (typeof NEWS_MODERATION_DECISIONS_V2)[number];

export const NEWS_MODERATION_ISSUE_CODES_V2 = [
  "unsupported_claim",
  "insufficient_evidence",
  "editorial_quality",
  "safety",
  "deduplication",
  "contract_mismatch",
] as const;
export type NewsModerationIssueCodeV2 = (typeof NEWS_MODERATION_ISSUE_CODES_V2)[number];

export type NewsModerationLocationV2 =
  | { kind: "claim"; claim_id: string }
  | { kind: "block"; block_id: string }
  | { kind: "markdown_section"; heading: string };

export interface NewsModerationIssueV2 {
  issue_id: string;
  code: NewsModerationIssueCodeV2;
  message: string;
  evidence: NewsEvidenceLinkV1 | null;
  locations: NewsModerationLocationV2[];
}

export const NEWS_API_FEEDBACK_SURFACES_V2 = [
  "feed_news_contract",
  "feed_ingest_api",
  "moderation_audit",
] as const;
export type NewsApiFeedbackSurfaceV2 = (typeof NEWS_API_FEEDBACK_SURFACES_V2)[number];

/** Advisory product feedback only. It is never a body, patch, command or executable directive. */
export interface NewsApiFeedbackV2 {
  feedback_id: string;
  surface: NewsApiFeedbackSurfaceV2;
  summary: string;
  rationale: string;
  evidence: NewsEvidenceLinkV1 | null;
  disposition: "advisory_only";
  automatic_change_allowed: false;
}

export interface NewsModerationV2 {
  schema_version: typeof NEWS_MODERATION_V2_SCHEMA_VERSION;
  artifact_id: string;
  composition_artifact_id: string;
  decision: NewsModerationDecisionV2;
  rationale: string;
  issues: NewsModerationIssueV2[];
  /** Kept separate from editorial findings and explicitly denied API mutation rights. */
  api_feedback: NewsApiFeedbackV2[];
  run: NewsGrokModeratorRunV2;
}

export const NEWS_PUBLICATION_ACTIONS_V2 = ["publish", "withhold"] as const;
export type NewsPublicationActionV2 = (typeof NEWS_PUBLICATION_ACTIONS_V2)[number];

export const NEWS_PUBLICATION_REASON_CODES_V2 = [
  "moderation_accepted",
  "moderation_revise",
  "moderation_reject",
  "host_policy_gate",
] as const;
export type NewsPublicationReasonCodeV2 = (typeof NEWS_PUBLICATION_REASON_CODES_V2)[number];

export interface NewsPublicationV2 {
  schema_version: typeof NEWS_PUBLICATION_V2_SCHEMA_VERSION;
  artifact_id: string;
  composition_artifact_id: string;
  moderation_artifact_id: string;
  action: NewsPublicationActionV2;
  reason_code: NewsPublicationReasonCodeV2;
  draft_id: string;
  feed_post_id: string | null;
  idempotency_key: string;
  run: NewsDeterministicPublisherRunV2;
}

export interface FeedNewsPipelineV2 {
  schema_version: typeof FEED_NEWS_PIPELINE_V2_SCHEMA_VERSION;
  pipeline_run_id: string;
  research: NewsResearchFindingsV2;
  composition: NewsCompositionV2;
  moderation: NewsModerationV2;
  publication: NewsPublicationV2;
}

export type FeedNewsContract = FeedNewsJobOutcome | FeedNewsPipelineV2;

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isUniqueStringArray(value: unknown, allowEmpty = true): value is string[] {
  return isStringArray(value, allowEmpty) && hasUniqueIds(value);
}

function isEvidenceShape(value: unknown, allowNull: true): value is NewsEvidenceLinkV1 | null;
function isEvidenceShape(value: unknown, allowNull?: false): value is NewsEvidenceLinkV1;
function isEvidenceShape(value: unknown, allowNull = false): value is NewsEvidenceLinkV1 | null {
  if (allowNull && value === null) return true;
  return (
    isRecord(value) &&
    hasExactKeys(value, ["claim_ids", "source_ids"]) &&
    isUniqueStringArray(value.claim_ids, false) &&
    isUniqueStringArray(value.source_ids, false)
  );
}

function isExactModelIdentity(value: unknown): value is NewsModelIdentityV1 {
  return isRecord(value) && hasExactKeys(value, ["provider", "model", "model_version"]) && isModelIdentity(value);
}

function hasSameModelIdentity(left: NewsModelIdentityV1, right: NewsModelIdentityV1): boolean {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    left.model_version === right.model_version
  );
}

export function isNewsRoleRunProvenanceV2(value: unknown): value is NewsRoleRunProvenanceV2 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schema_version",
      "role",
      "run_id",
      "executor",
      "prompt_version",
      "started_at",
      "completed_at",
      "input_artifact_ids",
      "output_artifact_id",
    ]) ||
    value.schema_version !== NEWS_ROLE_RUN_V2_SCHEMA_VERSION ||
    !(NEWS_PIPELINE_ROLES_V2 as readonly unknown[]).includes(value.role) ||
    !isString(value.run_id) ||
    !isString(value.started_at) ||
    !isString(value.completed_at) ||
    !isUniqueStringArray(value.input_artifact_ids) ||
    !isString(value.output_artifact_id) ||
    !isRecord(value.executor)
  ) return false;

  if (value.role === "local_researcher" || value.role === "local_composer") {
    return (
      isString(value.prompt_version) &&
      hasExactKeys(value.executor, ["kind", "locality", "identity"]) &&
      value.executor.kind === "model" &&
      value.executor.locality === "local_gpu" &&
      isExactModelIdentity(value.executor.identity)
    );
  }
  if (value.role === "grok_moderator") {
    return (
      isString(value.prompt_version) &&
      hasExactKeys(value.executor, ["kind", "locality", "model_family", "identity"]) &&
      value.executor.kind === "model" &&
      value.executor.locality === "remote_api" &&
      value.executor.model_family === "grok" &&
      isExactModelIdentity(value.executor.identity)
    );
  }
  return (
    value.prompt_version === null &&
    hasExactKeys(value.executor, ["kind", "component", "component_version"]) &&
    value.executor.kind === "deterministic_host" &&
    isString(value.executor.component) &&
    isString(value.executor.component_version)
  );
}

function isResearchFindingV2(value: unknown): value is NewsResearchFindingV2 {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["finding_id", "kind", "text", "confidence", "evidence"]) &&
    isString(value.finding_id) &&
    (NEWS_RESEARCH_FINDING_KINDS_V2 as readonly unknown[]).includes(value.kind) &&
    isString(value.text) &&
    isConfidence(value.confidence) &&
    isEvidenceShape(value.evidence)
  );
}

export function isNewsResearchFindingsV2(value: unknown): value is NewsResearchFindingsV2 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schema_version", "artifact_id", "candidate", "findings", "run"]) ||
    value.schema_version !== NEWS_RESEARCH_FINDINGS_V2_SCHEMA_VERSION ||
    !isString(value.artifact_id) ||
    !isNewsCandidateV1(value.candidate) ||
    !Array.isArray(value.findings) ||
    value.findings.length === 0 ||
    !value.findings.every(isResearchFindingV2) ||
    !isNewsRoleRunProvenanceV2(value.run) ||
    value.run.role !== "local_researcher" ||
    value.run.output_artifact_id !== value.artifact_id
  ) return false;
  const findingIds = value.findings.map((finding) => finding.finding_id);
  if (!hasUniqueIds(findingIds)) return false;
  const sourceIds = new Set(value.candidate.source_records.map((source) => source.source_id));
  const claimIds = new Set(value.candidate.claims.map((claim) => claim.claim_id));
  return (
    value.candidate.provenance.research_run_id === value.run.run_id &&
    value.candidate.provenance.prompt_version === value.run.prompt_version &&
    hasSameModelIdentity(value.candidate.provenance, value.run.executor.identity) &&
    value.findings.every((finding) => isEvidence(finding.evidence, sourceIds, claimIds))
  );
}

export function isNewsCompositionV2(value: unknown): value is NewsCompositionV2 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schema_version",
      "artifact_id",
      "research_artifact_id",
      "draft",
      "used_finding_ids",
      "run",
    ]) ||
    value.schema_version !== NEWS_COMPOSITION_V2_SCHEMA_VERSION ||
    !isString(value.artifact_id) ||
    !isString(value.research_artifact_id) ||
    !isNormalizedNewsV1(value.draft) ||
    !isUniqueStringArray(value.used_finding_ids, false) ||
    !isNewsRoleRunProvenanceV2(value.run) ||
    value.run.role !== "local_composer" ||
    value.run.output_artifact_id !== value.artifact_id
  ) return false;
  return (
    value.draft.provenance.normalization_run_id === value.run.run_id &&
    value.draft.provenance.prompt_version === value.run.prompt_version &&
    hasSameModelIdentity(value.draft.provenance, value.run.executor.identity)
  );
}

function isModerationLocationV2(value: unknown): value is NewsModerationLocationV2 {
  if (!isRecord(value) || !isString(value.kind)) return false;
  if (value.kind === "claim") return hasExactKeys(value, ["kind", "claim_id"]) && isString(value.claim_id);
  if (value.kind === "block") return hasExactKeys(value, ["kind", "block_id"]) && isString(value.block_id);
  return value.kind === "markdown_section" && hasExactKeys(value, ["kind", "heading"]) && isString(value.heading);
}

function isModerationIssueV2(value: unknown): value is NewsModerationIssueV2 {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["issue_id", "code", "message", "evidence", "locations"]) &&
    isString(value.issue_id) &&
    (NEWS_MODERATION_ISSUE_CODES_V2 as readonly unknown[]).includes(value.code) &&
    isString(value.message) &&
    isEvidenceShape(value.evidence, true) &&
    Array.isArray(value.locations) &&
    value.locations.every(isModerationLocationV2)
  );
}

function isApiFeedbackV2(value: unknown): value is NewsApiFeedbackV2 {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "feedback_id",
      "surface",
      "summary",
      "rationale",
      "evidence",
      "disposition",
      "automatic_change_allowed",
    ]) &&
    isString(value.feedback_id) &&
    (NEWS_API_FEEDBACK_SURFACES_V2 as readonly unknown[]).includes(value.surface) &&
    isString(value.summary) &&
    isString(value.rationale) &&
    isEvidenceShape(value.evidence, true) &&
    value.disposition === "advisory_only" &&
    value.automatic_change_allowed === false
  );
}

export function isNewsModerationV2(value: unknown): value is NewsModerationV2 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schema_version",
      "artifact_id",
      "composition_artifact_id",
      "decision",
      "rationale",
      "issues",
      "api_feedback",
      "run",
    ]) ||
    value.schema_version !== NEWS_MODERATION_V2_SCHEMA_VERSION ||
    !isString(value.artifact_id) ||
    !isString(value.composition_artifact_id) ||
    !(NEWS_MODERATION_DECISIONS_V2 as readonly unknown[]).includes(value.decision) ||
    !isString(value.rationale) ||
    !Array.isArray(value.issues) ||
    !value.issues.every(isModerationIssueV2) ||
    !Array.isArray(value.api_feedback) ||
    !value.api_feedback.every(isApiFeedbackV2) ||
    !isNewsRoleRunProvenanceV2(value.run) ||
    value.run.role !== "grok_moderator" ||
    value.run.output_artifact_id !== value.artifact_id
  ) return false;
  if (value.decision !== "accept" && value.issues.length === 0) return false;
  return (
    hasUniqueIds(value.issues.map((issue) => issue.issue_id)) &&
    hasUniqueIds(value.api_feedback.map((feedback) => feedback.feedback_id))
  );
}

export function isNewsPublicationV2(value: unknown): value is NewsPublicationV2 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schema_version",
      "artifact_id",
      "composition_artifact_id",
      "moderation_artifact_id",
      "action",
      "reason_code",
      "draft_id",
      "feed_post_id",
      "idempotency_key",
      "run",
    ]) ||
    value.schema_version !== NEWS_PUBLICATION_V2_SCHEMA_VERSION ||
    !isString(value.artifact_id) ||
    !isString(value.composition_artifact_id) ||
    !isString(value.moderation_artifact_id) ||
    !(NEWS_PUBLICATION_ACTIONS_V2 as readonly unknown[]).includes(value.action) ||
    !(NEWS_PUBLICATION_REASON_CODES_V2 as readonly unknown[]).includes(value.reason_code) ||
    !isString(value.draft_id) ||
    !isNullableString(value.feed_post_id) ||
    !isString(value.idempotency_key) ||
    !isNewsRoleRunProvenanceV2(value.run) ||
    value.run.role !== "deterministic_publisher" ||
    value.run.output_artifact_id !== value.artifact_id
  ) return false;
  if (value.action === "publish") {
    return value.reason_code === "moderation_accepted" && isString(value.feed_post_id);
  }
  return value.reason_code !== "moderation_accepted" && value.feed_post_id === null;
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function hasSameSourceAndClaimMaterial(candidate: NewsCandidateV1, draft: NormalizedNewsV1): boolean {
  if (
    candidate.source_records.length !== draft.source_records.length ||
    candidate.claims.length !== draft.claims.length
  ) {
    return false;
  }
  const draftSources = new Map(draft.source_records.map((source) => [source.source_id, source]));
  for (const source of candidate.source_records) {
    const compared = draftSources.get(source.source_id);
    if (
      !compared ||
      Object.keys(source).some(
        (key) => source[key as keyof NewsSourceRecordV1] !== compared[key as keyof NewsSourceRecordV1],
      )
    ) {
      return false;
    }
  }
  const draftClaims = new Map(draft.claims.map((claim) => [claim.claim_id, claim]));
  for (const claim of candidate.claims) {
    const compared = draftClaims.get(claim.claim_id);
    if (
      !compared ||
      claim.text !== compared.text ||
      !sameStringSet(claim.source_ids, compared.source_ids)
    ) return false;
  }
  return true;
}

function hasExactInputs(run: NewsRoleRunProvenanceV2, expected: string[]): boolean {
  return sameStringSet(run.input_artifact_ids, expected);
}

export function isFeedNewsPipelineV2(value: unknown): value is FeedNewsPipelineV2 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schema_version",
      "pipeline_run_id",
      "research",
      "composition",
      "moderation",
      "publication",
    ]) ||
    value.schema_version !== FEED_NEWS_PIPELINE_V2_SCHEMA_VERSION ||
    !isString(value.pipeline_run_id) ||
    !isNewsResearchFindingsV2(value.research) ||
    !isNewsCompositionV2(value.composition) ||
    !isNewsModerationV2(value.moderation) ||
    !isNewsPublicationV2(value.publication)
  ) return false;

  const { research, composition, moderation, publication } = value;
  const artifactIds = [research.artifact_id, composition.artifact_id, moderation.artifact_id, publication.artifact_id];
  const roleRunIds = [research.run.run_id, composition.run.run_id, moderation.run.run_id, publication.run.run_id];
  if (
    !hasUniqueIds(artifactIds) ||
    !hasUniqueIds(roleRunIds) ||
    composition.research_artifact_id !== research.artifact_id ||
    composition.draft.candidate_id !== research.candidate.candidate_id ||
    composition.draft.provenance.research_run_id !== research.run.run_id ||
    !hasSameSourceAndClaimMaterial(research.candidate, composition.draft) ||
    !composition.used_finding_ids.every((id) => research.findings.some((finding) => finding.finding_id === id)) ||
    moderation.composition_artifact_id !== composition.artifact_id ||
    publication.composition_artifact_id !== composition.artifact_id ||
    publication.moderation_artifact_id !== moderation.artifact_id ||
    !hasExactInputs(research.run, []) ||
    !hasExactInputs(composition.run, [research.artifact_id]) ||
    !hasExactInputs(moderation.run, [composition.artifact_id]) ||
    !hasExactInputs(publication.run, [composition.artifact_id, moderation.artifact_id])
  ) return false;

  const sourceIds = new Set(research.candidate.source_records.map((source) => source.source_id));
  const claimIds = new Set(research.candidate.claims.map((claim) => claim.claim_id));
  const blockIds = new Set(composition.draft.blocks.map((block) => block.block_id));
  for (const issue of moderation.issues) {
    if (issue.evidence !== null && !isEvidence(issue.evidence, sourceIds, claimIds)) return false;
    for (const location of issue.locations) {
      if (location.kind === "claim" && !claimIds.has(location.claim_id)) return false;
      if (location.kind === "block" && !blockIds.has(location.block_id)) return false;
    }
  }
  if (
    moderation.api_feedback.some(
      (feedback) => feedback.evidence !== null && !isEvidence(feedback.evidence, sourceIds, claimIds),
    )
  ) return false;

  if (moderation.decision === "accept") {
    return publication.action === "publish" || publication.reason_code === "host_policy_gate";
  }
  return (
    publication.action === "withhold" &&
    publication.reason_code === `moderation_${moderation.decision}`
  );
}

/** Version dispatcher for consumers migrating persisted v1 outcomes to the explicit v2 pipeline. */
export function isFeedNewsContract(value: unknown): value is FeedNewsContract {
  return isFeedNewsJobOutcome(value) || isFeedNewsPipelineV2(value);
}
