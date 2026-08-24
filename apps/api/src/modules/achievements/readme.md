# Achievements module

Nest migration of `GET /me/achievements`, `GET /me/wardrobe/unlocks`, and the idempotent
`grantAchievement` use-case. The module is the sole writer of `user_achievements`; the catalog tables
`achievements` and `wardrobe_rewards` are read-only lookup inputs. Its repository remains private and
other domains grant achievements only through `ACHIEVEMENTS_PORT`.

The wardrobe layer catalog is frozen here to the characterized legacy response while dual-runtime
comparison is active. Legacy Fastify files remain untouched until the migration cutover.
