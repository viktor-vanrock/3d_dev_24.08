# Feed Nest module

`FeedModule` owns SQL for `feed_posts`, `feed_events`, `feed_post_images`,
`feed_post_revisions`, `feed_post_saves`, `comments`, and `post_score`. Its
repositories are private. `FEED_PROFILE_READ_PORT` remains exported for profile
statistics; `FEED_SOCIAL_OWNER_PORT` is the write-owner seam used by makes and
models for linked feed posts and polymorphic comments.

The root composition module must provide the following narrow adapter tokens
from a global adapter module (or a module imported by `FeedModule`):

- `FEED_AGENT_AUTH_PORT`, `FEED_INGEST_AUTH_PORT`
- `FEED_COMMUNITY_PORT`, `FEED_VOTES_PORT`, `FEED_TAGS_READ_PORT`
- `FEED_MODEL_READ_PORT`, `FEED_REFERENCES_PORT`
- `FEED_ANALYTICS_PORT`, `FEED_STORAGE_PORT`, `FEED_GITVERSE_PORT`
- `FEED_RATE_LIMIT_PORT`

These adapters own cross-domain reads/writes; feed infrastructure does not query
physical tables owned by another domain.
