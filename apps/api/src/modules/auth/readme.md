# Auth module

Owns corporate-email OTP records, external identity links, and local password credentials. User creation and
session-profile reads cross the `PROFILE_AUTH_PORT`; signup analytics crosses `ANALYTICS_PORT`. Repositories and
provider adapters remain private.

At application bootstrap, `ADMIN_USERNAME` and `ADMIN_PASSWORD` create or reactivate one local administrator and
automatically ensure the global `catalog.edit_any`, `research.manage_printers`, and `feed.manage_news` grants required
by the Data workspace. Each newly created grant is audited; active grants are preserved and skipped, so startup is
idempotent. This policy applies only to the configured bootstrap account, never to all `users.is_staff` users.
`ADMIN_PASSWORD_UPDATE_ON_STARTUP=true` rotates the stored
scrypt hash; the default `false` preserves an existing credential. A username already owned by a non-bootstrap
account blocks startup instead of elevating that account. `POST /auth/password` exchanges a matching local credential
for the normal `portal_session` cookie.
