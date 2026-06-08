---
name: Refresh Token Context
description: When rotating refresh tokens, reload real phone + vendor context from DB — never issue tokens with empty defaults
metadata:
  type: project
---
When rotating a refresh token, the service must load the user record and active vendor contexts from the DB before generating the new access token. The new JWT payload must contain the real `phone` and vendor context — never empty defaults like `phone: ''` or `vendorIds: []`.

**Why:** An access token with empty vendor context breaks all authenticated requests after the first token refresh. Caught as MAJOR in Review during US-003.

**How to apply:** `RefreshTokenService` (and any token-issuing path) re-reads user + membership state at issue time. Note: US-002 extends the JWT payload to `vendors: [{ vendorId, role, permissions[] }]`, so the reload must populate role/permissions too.
