# API Specification — US-15.3 Referral Domain Events & Referrer Notifications
> Slug: us-15.3-referral-domain-events-notifications | Generated: 2026-06-19

## No API contract change

This is a **backend-only, server-internal** story. It wires domain-event publication and a
referrer-notification adapter inside the referral module. It adds:

- No new endpoints
- No request/response schema changes to any existing referral endpoint
- No new permissions, headers, or error codes

All US-014 referral endpoints (`/api/v1/vendors/:vendorId/referrals/*`, `/credits/*`, etc.)
behave exactly as documented in `docs/features/us-014-referral-engine/API_SPEC.md`.

There is **no frontend track** for this story.
