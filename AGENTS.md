# AGENTS.md

Entry point for AI coding agents working on the **PayCycle API**. It documents the
agent team, the development pipeline, the handoff artifacts, and the skills catalog.

> This file follows the cross-tool [agents.md](https://agents.md) convention so any
> agent (Claude Code, Codex, Cursor, …) can orient itself here. Claude Code's
> detailed project guide is [claude.md](claude.md); commit rules are in
> [CONTRIBUTING.md](CONTRIBUTING.md).
> Keep this file and `claude.md` in sync — `claude.md` is the source of truth for
> project setup; this file is the source of truth for the agent workflow.
>
> **🧠 Before doing anything, read [.claude/memory/MEMORY.md](.claude/memory/MEMORY.md)** —
> the project's durable memory of standing decisions and conventions that override defaults.
>
> ⚠️ [ARCHITECTURE.md](ARCHITECTURE.md) is **legacy infrastructural reference only** (DB,
> security, logging, config, deployment). It does **not** govern design or implementation
> style — those come from this file, the skills, and memory.

---

## Project at a glance

Enterprise multi-tenant REST API — **Node.js · Express · TypeScript · PostgreSQL · Prisma**,
designed with **Domain-Driven Design** + **Hexagonal / Clean Architecture**. Dependencies
always point inward (Infrastructure → Application → Domain); the domain layer has zero
framework imports.

### Essential commands

| Task            | Command              |
| --------------- | -------------------- |
| Dev server      | `npm run dev`        |
| Build (tsc)     | `npm run build`      |
| Lint            | `npm run lint`       |
| Lint + autofix  | `npm run lint:fix`   |
| Tests           | `npm test`           |
| DB migrate      | `npm run migrate:deploy` |
| Seed DB         | `npm run db:seed`    |

A husky `pre-commit` hook runs **lint + build** and only commits if both pass — never
bypass with `--no-verify` outside emergencies. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## The agent team

Four specialized agents (defined in [`.claude/agents/`](.claude/agents/)) collaborate
through file-based handoffs. Each has a strict boundary — agents do not do each other's job.

| Agent         | File                                          | Role (boundary)                                                                 |
| ------------- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| **Architect** | [architect.md](.claude/agents/architect.md)   | Plans & designs. Produces docs, schemas, domain models. **Writes no code.**     |
| **Dev**       | [dev.md](.claude/agents/dev.md)               | Implements the plan exactly. **Does not design or deviate** from the architecture. |
| **Review**    | [review.md](.claude/agents/review.md)         | Code-review gate after Dev, before QA; verifies code against skills & DDD. **Approves or sends back.** |
| **QA**        | [qa.md](.claude/agents/qa.md)                 | Tests reviewed code against the plan + skills, covers edge cases, logs bugs. **Writes no feature code.** Final gate before merge. |

---

## The pipeline

```
                 ┌─────────────┐   FEATURE_PLAN.md       ┌──────────┐
   User Story ──►│  ARCHITECT  │   FEATURE_TASKS.md  ──► │   DEV    │ ◄──┐
                 │  (design)   │   DOMAIN_MODEL.md       │ (build)  │    │
                 └─────────────┘                         └────┬─────┘    │
                        ▲                                     │ impl     │ fixes
                        │ escalate if skill                   ▼          │
                        │ contradicts plan               ┌──────────┐    │
                        │                  reject → Dev  │  REVIEW  │ ───┤
                        │                                │  (code)  │    │
                        │                                └────┬─────┘    │
                        │                                     │ approved │
                        │                                     ▼          │
                        │                FEATURE_BUGS.md ┌──────────┐    │
                        └──────────────────────────────►│    QA    │ ───┘
                                                         │  (test)  │
                                                         └────┬─────┘
                                                              │ passing
                                                              ▼
                                                         ✅ merge / PR
```

> **Every stage begins by reading [.claude/memory/MEMORY.md](.claude/memory/MEMORY.md).**

1. **Backend Architect** reads the User Story, applies design skills, and produces `FEATURE_PLAN.md`, `DOMAIN_MODEL.md`, `FEATURE_TASKS.md`, and `API_SPEC.md`.
2. **Orchestrator trigger** — as soon as `FEATURE_PLAN.md` + `API_SPEC.md` exist, immediately invoke the **Frontend Architect** on `paycycle_vendor`. Do **not** wait for backend Dev/Review/QA.
3. **Backend Dev** implements each layer strictly from the plan, applying implementation skills.
4. **Backend Review** verifies the code against skill checklists and architecture; approves or sends back to Dev.
5. **Backend QA** tests reviewed code against `FEATURE_PLAN.md` and the skills; logs bugs to `FEATURE_BUGS.md`.
6. **Frontend track** (runs in parallel with steps 3–5) — Frontend Architect → Dev → Review → QA, using `API_SPEC.md` as the contract.
7. **Dev** fixes review findings and QA bugs on either track; re-review/re-test as needed.
8. Story moves 🟡→🟢 in `../project_documents/vendor_app/PROGRESS_TRACKER.md` **only when PRs are open on both repos**.

### Handoff artifacts

Per-feature artifacts live under **`docs/features/[feature-name]/`**:

| Artifact            | Produced by       | Consumed by                        | Purpose                                            |
| ------------------- | ----------------- | ---------------------------------- | -------------------------------------------------- |
| `FEATURE_PLAN.md`   | Backend Architect | BE Dev, BE Review, BE QA           | The design: endpoints, rules, complexity tier      |
| `FEATURE_TASKS.md`  | Backend Architect | BE Dev                             | Ordered backend implementation tasks               |
| `DOMAIN_MODEL.md`   | Backend Architect | BE Dev                             | Entities, value objects, aggregates, invariants    |
| `API_SPEC.md`       | Backend Architect | **FE Architect** (trigger), BE Dev | REST contract: request/response shapes, status codes — this artifact triggers the frontend track |
| `FEATURE_BUGS.md`   | QA (BE or FE)     | Dev (BE or FE)                     | Bugs with repro steps + skill references           |

The plan references **which skills** apply so Dev/Review/QA know the patterns to follow.
**If a skill contradicts the `FEATURE_PLAN`, the plan wins** — escalate to the Architect.

---

## Skills catalog

Skills (in [`.claude/skills/`](.claude/skills/)) are step-by-step workflows, templates, and
checklists, informed by [domain-driven-hexagon](https://github.com/Sairyss/domain-driven-hexagon),
[clean-architecture](https://github.com/panagiop/node.js-clean-architecture), and
[open-saas](https://github.com/wasp-lang/open-saas). An agent **must read the relevant skill
before** the corresponding activity.

| Skill                                                                  | Used by          | When                                               |
| ---------------------------------------------------------------------- | ---------------- | -------------------------------------------------- |
| [architect-feature-docs](.claude/skills/architect-feature-docs.md)     | Architect        | **Last step before Dev handoff** — write FEATURE_PLAN, FEATURE_TASKS, FEATURE_BUGS to `docs/features/<slug>/` |
| [ddd-module-design](.claude/skills/ddd-module-design.md)               | Architect        | Designing a new bounded context / module           |
| [api-contract-design](.claude/skills/api-contract-design.md)           | Architect        | Designing REST endpoints for a feature             |
| [prisma-schema-design](.claude/skills/prisma-schema-design.md)         | Architect, Dev   | Creating/modifying DB models                       |
| [domain-modeling](.claude/skills/domain-modeling.md)                   | Architect, Dev   | Defining entities, value objects, aggregates       |
| [module-scaffold](.claude/skills/module-scaffold.md)                   | Dev              | Scaffolding a new module from the plan             |
| [validation-schemas](.claude/skills/validation-schemas.md)             | Dev              | Writing Zod request-validation schemas             |
| [repository-implementation](.claude/skills/repository-implementation.md)| Dev             | Implementing the data-access layer (port+adapter)  |
| [service-implementation](.claude/skills/service-implementation.md)     | Dev              | Implementing the application/business-logic layer  |
| [error-handling](.claude/skills/error-handling.md)                     | Dev (+ all)      | Error handling across layers; status mapping       |
| [testing-strategy](.claude/skills/testing-strategy.md)                 | Dev / QA         | Unit/integration tests and test utilities          |

---

## Project document locations

| Resource            | Path                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| User stories        | `../project_documents/vendor_app/user_stories/`                     |
| Feature specs       | `../project_documents/vendor_app/features/`                         |
| Wireframes          | `../project_documents/vendor_app/wireframes/`                       |
| Progress tracker    | `../project_documents/vendor_app/PROGRESS_TRACKER.md`               |

All agents must consult these resources at the start of every user story task:
- **User story** — acceptance criteria, scope, and constraints for the feature
- **Feature spec** — detailed requirements and business rules (if present)
- **Wireframes** — UI contract; use to verify API response shapes match what the frontend expects
- **Progress tracker** — status updates; move stories In Progress → Completed as work advances

---

## Ground rules for any agent

- **Read memory first** — start every task with `.claude/memory/MEMORY.md`; its entries override defaults. Record durable new decisions there.
- **Read project documents** — consult the user story, feature spec, and wireframes from the table above before designing, implementing, reviewing, or testing.
- **Stay in your lane** — respect each agent's boundary above.
- **Read the skill first** — never implement/design/review an activity without its skill.
- **ARCHITECTURE.md is reference, not law** — use it for infrastructure facts only, never for design or coding style.
- **The plan is law** — when a skill and `FEATURE_PLAN.md` disagree, follow the plan and escalate.
- **Commit clean** — every commit must pass lint + build (the hook enforces it); follow
  [Conventional Commits](CONTRIBUTING.md).
- **Keep the tracker honest** — update `PROGRESS_TRACKER.md` as work moves through the pipeline.
