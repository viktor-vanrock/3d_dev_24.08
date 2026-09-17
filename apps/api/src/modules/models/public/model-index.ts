import type { ModelId } from "../../_kernel/brandedIds.ts";

export const MODEL_INDEX_PORT = Symbol("MODEL_INDEX_PORT");

export interface ModelIndexDocument {
  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];
}

export interface MissingPublishedModelIndex {
  readonly modelId: ModelId;
  readonly document: ModelIndexDocument;
}

export interface ModelIndexPort {
  enqueue(modelId: ModelId, document: ModelIndexDocument): Promise<void>;
  markQueuedForProjectUnpublished(projectId: string): Promise<void>;
  missingPublished(limit: number): Promise<readonly MissingPublishedModelIndex[]>;
}
