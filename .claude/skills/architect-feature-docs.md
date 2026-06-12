# Skill: Architect Feature Docs

> **Used by**: Architect Agent  
> **When**: At the end of every planning session, before handing off to the Dev agent  
> **Purpose**: Produce the three handoff artifacts in the correct location so Dev, Review, and QA all read from one canonical source of truth

---

## Rule: All feature docs live under `docs/features/<feature-slug>/`

Never write `FEATURE_PLAN.md`, `FEATURE_TASKS.md`, or `FEATURE_BUGS.md` to the project root. The correct path is always:

```
docs/features/<feature-slug>/FEATURE_PLAN.md
docs/features/<feature-slug>/FEATURE_TASKS.md
docs/features/<feature-slug>/FEATURE_BUGS.md
```

The `<feature-slug>` must match the existing folder under `docs/features/` (e.g. `delivery-tracking`, `supply-lists`, `authentication`). If no folder exists yet, create it.

---

## Step 1 — Derive the feature slug

Map the User Story ID to its folder:

```
docs/features/
├── authentication/          # US-001, US-004
├── us-002-roles-access/     # US-002
├── staff-management/        # US-003
├── supply-lists/            # US-005
├── delivery-tracking/       # US-006
└── <new-feature>/           # create if absent
```

If the folder does not exist, create it:
```bash
mkdir docs/features/<feature-slug>
```

---

## Step 2 — Write `FEATURE_PLAN.md`

**Path:** `docs/features/<feature-slug>/FEATURE_PLAN.md`

Required sections (in order):

```markdown
# Feature Plan: <US-ID> <Title>

## 1. User Story ID & Title
## 2. Summary
## 3. Complexity Assessment  (Simple / Moderate / Complex + rationale)
## 4. Domain Model           (entities, value objects, aggregates, invariants)
## 5. Prisma Schema Changes  (exact DSL — new models, enums, relations, indexes)
## 6. API Endpoints          (method, path, auth, request body, response shape, CQS label)
## 7. Module Structure       (every file to create/modify with its single responsibility)
## 8. Service Layer Design   (commands vs queries, key business rules, cross-module wiring)
## 9. Validation Rules       (Zod schema outline per endpoint)
## 10. Swagger/OpenAPI       (tags and summary lines for each endpoint)
## 11. Open Questions        (each with: recommendation + trade-off)
```

Rules:
- Section 7 **must** use the `commands/` and `queries/` nested subdirectory layout — flat layouts are not acceptable for Moderate or Complex modules
- Section 5 must show real Prisma DSL, not prose descriptions
- Section 11 must be present even if empty (`_None._`)

---

## Step 3 — Write `FEATURE_TASKS.md`

**Path:** `docs/features/<feature-slug>/FEATURE_TASKS.md`

Ordered implementation checklist consumed by the Dev agent. Each task must be atomic (one PR-safe unit of work), sequenced by dependency, and tagged with the responsible layer.

```markdown
# Feature Tasks: <US-ID> <Title>

## Implementation Order

### Phase 1 — Schema & Domain
- [ ] T-01  Add Prisma enums and models (Section 5 of FEATURE_PLAN)
- [ ] T-02  Run and verify migration
- [ ] T-03  Implement domain entities, value objects, and state machine (`delivery.domain.ts`)
- [ ] T-04  Write domain unit tests

### Phase 2 — Repository
- [ ] T-05  Define repository port interface (`*.repository.port.ts`)
- [ ] T-06  Implement Prisma adapter (`*.repository.ts`)

### Phase 3 — Commands
- [ ] T-07  <CommandName> command + unit tests
- [ ] T-08  ...

### Phase 4 — Queries
- [ ] T-09  <QueryName> query + unit tests
- [ ] T-10  ...

### Phase 5 — HTTP Layer
- [ ] T-11  Validators (Zod schemas for all endpoints)
- [ ] T-12  Controller (thin handlers, Swagger annotations)
- [ ] T-13  Routes (composition root, middleware chain)
- [ ] T-14  Register router in `src/app.ts`

### Phase 6 — Cross-module & Infrastructure
- [ ] T-15  Cross-module adapter / port wiring (if applicable)
- [ ] T-16  Cron jobs (if applicable, gated behind env var)

### Phase 7 — Quality Gate
- [ ] T-17  `npm run lint:fix` — 0 errors
- [ ] T-18  `npm run build` — clean tsc
- [ ] T-19  `npm test` — all tests pass
```

Adjust phases to match the feature. Remove phases that don't apply. Add tasks for any cross-module effects called out in Section 8 of the plan.

---

## Step 4 — Write `FEATURE_BUGS.md` (placeholder)

**Path:** `docs/features/<feature-slug>/FEATURE_BUGS.md`

QA owns this file's content, but the Architect must create it so the path exists before Dev starts.

```markdown
# Feature Bugs: <US-ID> <Title>

> Maintained by the QA agent. Architect creates this file as a placeholder.

| ID | Severity | Status | Summary | Reported by |
|----|----------|--------|---------|-------------|
| —  | —        | —      | No bugs reported yet | — |
```

---

## Step 5 — Verify paths before handoff

Before declaring the plan ready, confirm all three files exist at the correct paths:

```
docs/features/<feature-slug>/FEATURE_PLAN.md   ✓
docs/features/<feature-slug>/FEATURE_TASKS.md  ✓
docs/features/<feature-slug>/FEATURE_BUGS.md   ✓
```

If any file is missing or was accidentally written to the project root, move it:
```bash
mv FEATURE_PLAN.md docs/features/<feature-slug>/FEATURE_PLAN.md
```

---

## Handoff checklist

Before passing to Dev, confirm:

- [ ] `docs/features/<feature-slug>/` folder exists
- [ ] `FEATURE_PLAN.md` has all 11 sections; Section 7 uses `commands/` + `queries/` layout
- [ ] `FEATURE_TASKS.md` lists every task in dependency order
- [ ] `FEATURE_BUGS.md` placeholder exists
- [ ] Open questions in Section 11 each have a recommendation and a trade-off
- [ ] No artifact written to the project root

State at handoff: _"FEATURE_PLAN, FEATURE_TASKS, and FEATURE_BUGS written to `docs/features/<feature-slug>/`. Ready for Dev."_
