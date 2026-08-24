export { resolveVendorName } from "../infrastructure/vendor-normalize.ts";
export { runIngest } from "../infrastructure/ingest/run.ts";
export type { IngestRunResult, RawCandidate, SourceAdapter } from "../infrastructure/ingest/types.ts";
export { CuraDefinitionsAdapter } from "../infrastructure/ingest/adapters/cura-definitions.ts";
export { Sovol3dStoreAdapter } from "../infrastructure/ingest/adapters/sovol3d-store.ts";
export { runEntityResolution } from "../infrastructure/resolve/run.ts";
