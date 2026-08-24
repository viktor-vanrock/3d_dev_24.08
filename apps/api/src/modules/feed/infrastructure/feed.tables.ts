import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const feedTables: DomainTableManifest = {
  owns: ["comments", "feed_events", "feed_post_images", "feed_post_revisions", "feed_post_saves", "feed_posts", "post_score"],
  readsForeignViews: [],
};
