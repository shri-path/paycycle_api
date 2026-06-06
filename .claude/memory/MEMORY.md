# Project Memory

**Every agent (Architect, Dev, Review, QA) MUST read this file first**, before
reading the feature plan, skills, or any source code. It records standing
decisions, conventions, gotchas, and corrections that are **not derivable** from
the code, the skills, or `claude.md` — and that **override defaults** when they
apply.

This is the project's shared, durable memory. Skills define *how* to build;
memory records *what we've decided* for this codebase specifically and *why*.

---

## How agents use memory

- **Read first.** Load this file at the start of every task. Treat applicable
  entries as binding instructions that take precedence over generic skill defaults.
- **Write when something durable is learned.** Append an entry when you make or
  discover a decision that future agents must respect — e.g. an architectural
  ruling, a naming convention, a recurring bug class, a deliberate deviation from
  a skill, or an explicit user instruction about how work should be done.
- **Don't record the ephemeral.** No task-specific chatter, no facts already
  captured by the code, git history, skills, `AGENTS.md`, or `claude.md`. If it
  only matters for the current feature, it belongs in that feature's
  `docs/features/<name>/` artifacts, not here.
- **Correct, don't duplicate.** If an entry becomes wrong, update or remove it
  rather than adding a contradicting one.

## How to add an entry

Append to the matching section below using this format:

```
### <short title>
- **Date:** YYYY-MM-DD
- **Type:** decision | convention | gotcha | deviation | user-instruction
- **Context:** what prompted this
- **Rule:** the binding takeaway (what future agents must do)
- **Why:** the reasoning, so it can be revisited later
```

Keep entries short and specific. Cite the relevant skill or file when applicable.

---

## Architectural decisions

_None yet._

## Conventions

_None yet._

## Gotchas & recurring issues

### Use crypto.randomInt for OTP — never Math.random
- **Date:** 2026-06-07
- **Type:** gotcha
- **Context:** Dev used `Math.random()` for OTP generation in forgot-password; caught as BLOCKER in Review.
- **Rule:** Any OTP, token, or secret must use `crypto.randomInt()` or `crypto.randomBytes()` from Node's built-in `crypto` module. `Math.random()` is not cryptographically secure and is never acceptable for security-sensitive values.
- **Why:** Predictable OTPs are a security vulnerability; the plan explicitly required CSPRNG.

### No placeholder unit tests — stubs are a BLOCKER
- **Date:** 2026-06-07
- **Type:** gotcha
- **Context:** Dev scaffolded `auth.service.test.ts` and `auth.controller.test.ts` as stubs (`expect(true).toBe(true)`); caught as CRITICAL in Review.
- **Rule:** Dev agent must never commit placeholder test files. Every test file must contain real test cases before the task is considered complete. If a service has no unit tests, that task is not done.
- **Why:** Placeholder tests give false confidence; they pass CI while hiding zero coverage.

### getProps() must return Object.freeze — always
- **Date:** 2026-06-07
- **Type:** gotcha
- **Context:** `UserEntity.getProps()` returned a mutable spread; caught as CRITICAL in Review.
- **Rule:** Every entity's `getProps()` must return `Object.freeze({ ...this._props, id: this._id, createdAt: this._createdAt, updatedAt: this._updatedAt })`. This is a mandatory DDD pattern in this codebase — not optional.
- **Why:** Mutable prop objects allow callers to corrupt entity state, breaking the aggregate boundary.

### reconstitute() must call validate()
- **Date:** 2026-06-07
- **Type:** gotcha
- **Context:** `UserEntity.reconstitute()` skipped `validate()`; caught as LOW bug in QA.
- **Rule:** Both `create()` and `reconstitute()` must call `this.validate()` before returning the entity. Invariants must be enforced regardless of whether the entity comes from user input or the database.
- **Why:** A corrupt DB record can produce an invalid in-memory entity if reconstitution skips validation.

### Refresh token service must reload user context for new access token
- **Date:** 2026-06-07
- **Type:** gotcha
- **Context:** `RefreshTokenService` issued a new access token with `phone: ''` and `vendorIds: []`; caught as MAJOR in Review.
- **Rule:** When rotating a refresh token, the service must load the user record and active vendor contexts from the DB before generating the new access token. The new JWT payload must contain real `phone` and `vendorIds[]` — never empty defaults.
- **Why:** An access token with empty `vendorIds` breaks all authenticated requests after the first token refresh.

### All error responses must include correlationId — including notFoundHandler
- **Date:** 2026-06-07
- **Type:** convention
- **Context:** `errorHandler` had `correlationId` in 4 branches but `notFoundHandler` was missed; caught in QA.
- **Rule:** Every HTTP error response in this codebase must include `correlationId`. Pattern: `const correlationId = (req.headers['x-correlation-id'] as string) ?? crypto.randomUUID()`. Apply to `errorHandler` AND `notFoundHandler`.
- **Why:** Consistent correlationId across all error paths enables end-to-end request tracing.

### Strict Zod schemas must include all fields the controller passes
- **Date:** 2026-06-07
- **Type:** gotcha
- **Context:** `loginSchema` used `.strict()` but the controller also passed `deviceId` from the request body; caught as MEDIUM bug in QA.
- **Rule:** Before using `.strict()` on a Zod schema, verify that the schema declares every field the controller or service will attempt to read from `req.body`. Unknown fields silently fail in strict mode. Optional fields (`z.string().optional()`) are the correct way to accept non-required body fields.
- **Why:** `.strict()` rejects unknown fields with a 400 — if the controller reads a field not in the schema, the request will fail at runtime.

### Seed data must be idempotent — use upsert or existence checks
- **Date:** 2026-06-07
- **Type:** convention
- **Context:** Dev used `prisma.vendor.create()` in seed; failed on re-seed; caught as LOW bug in QA.
- **Rule:** Every seed operation must be safe to run multiple times. Use `prisma.<model>.upsert()` where a unique key exists. Where no unique key exists (e.g. `vendors`), guard with a `findFirst` existence check before creating. Never use bare `create()` in seed files.
- **Why:** Re-seeding is routine in development and CI; a non-idempotent seed breaks both.

### Domain events must extend DomainEventBase with id, aggregateId, occurredAt, metadata
- **Date:** 2026-06-07
- **Type:** convention
- **Context:** Domain event classes were plain classes with no base structure; caught as CRITICAL in Review.
- **Rule:** Every domain event class must extend `DomainEventBase` (at `src/modules/auth/domain/events/domain-event.base.ts` or a shared equivalent) which provides: `id: string` (UUID), `aggregateId: string`, `occurredAt: Date`, `metadata: { correlationId: string; causationId?: string }`.
- **Why:** Without a consistent base structure, events cannot be reliably dispatched, logged, or consumed by downstream modules (Audit, Notifications).

## Deliberate deviations from skills

_None yet._

## Standing user instructions

### Agent handoffs require explicit user approval
- **Date:** 2026-06-07
- **Type:** user-instruction
- **Context:** User corrected autonomous agent chaining — the orchestrator invoked Architect then immediately queued Dev without pausing.
- **Rule:** After each agent completes its stage (Architect → Dev → Review → QA), stop and present the output to the user. Do NOT invoke the next agent in the pipeline until the user explicitly approves the handoff (e.g. "looks good, invoke Dev" or "proceed").
- **Why:** The user wants visibility and control at every pipeline gate, not a fully autonomous end-to-end run.
