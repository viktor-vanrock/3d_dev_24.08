# Auth module

Owns corporate-email OTP records, external identity links, and local password credentials. User creation and
session-profile reads cross the `PROFILE_AUTH_PORT`; signup analytics crosses `ANALYTICS_PORT`. Repositories and
provider adapters remain private.

At application bootstrap, `ADMIN_USERNAME` and `ADMIN_PASSWORD` create or reactivate one local administrator and
set the existing `users.is_staff` authorization flag. `ADMIN_PASSWORD_UPDATE_ON_STARTUP=true` rotates the stored
scrypt hash; the default `false` preserves an existing credential. A username already owned by a non-bootstrap
account blocks startup instead of elevating that account. `POST /auth/password` exchanges a matching local credential
for the normal `portal_session` cookie.
