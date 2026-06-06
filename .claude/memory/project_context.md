---
name: PayCycle API Context
description: Core product context - backend for PayCycle vendor app serving tier 2-3 Indian cities
metadata:
  type: project
---
PayCycle API is the Node.js + PostgreSQL backend for the PayCycle Vendor mobile app — a daily operating system for recurring local vendors (milk, newspaper, bread) in tier 2-3 Indian cities.

**Why:** Users are non-tech-literate, use low-end devices, and have spotty internet — the API must be lightweight, resilient, and offline-sync-friendly.

**Architecture:** Domain-Driven Design + Clean Architecture. Dependencies always point inward: Infrastructure → Application → Domain. The domain layer has zero framework imports.

**How to apply:**
- Every module follows the layered structure: controller → service → repository → Prisma
- Validation at the boundary only — use Zod schemas on all external input
- Auth: Mobile Number + Password (JWT access + refresh tokens). Not email-based.
- Multi-tenancy: all data is scoped to a vendor. Never leak cross-vendor data.
- Offline sync: endpoints must support delta-sync patterns for WatermelonDB on the client
- All endpoints documented in Swagger/OpenAPI
- AGENTS.md and `.claude/skills/` are the design authority — ARCHITECTURE.md is infra reference only
- Product docs are in `D:\Shrihari\Sourcecode\personal\paycycle\project_documents\`
- Progress tracked in `D:\Shrihari\Sourcecode\personal\paycycle\project_documents\vendor_app\PROGRESS_TRACKER.md`
