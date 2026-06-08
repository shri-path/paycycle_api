---
name: Idempotent Seeds
description: Seed operations must be safe to re-run — use upsert or existence checks, never bare create()
metadata:
  type: project
---
Every seed operation must be safe to run multiple times. Use `prisma.<model>.upsert()` where a unique key exists. Where no unique key exists (e.g. `vendors`), guard with a `findFirst` existence check before creating. Never use bare `prisma.<model>.create()` in seed files.

**Why:** Re-seeding is routine in development and CI; a non-idempotent seed breaks both. Caught as a LOW QA bug in US-003 (`prisma.vendor.create()` failed on re-seed).

**How to apply:** Default to `upsert` keyed on a stable unique field. For records without a natural unique key, do an existence check first. Seeds should converge to the same state on every run.
