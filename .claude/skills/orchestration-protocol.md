# Orchestration Protocol

Cross-project coordination reference for the orchestrator agent and any agent that needs to
understand how the backend and frontend pipelines connect.

---

## Feature Slug Convention

Derived from the user story ID and title:

```
us-<id>-<kebab-case-title>
```

Examples:
- US-007 Customer Management → `us-007-customer-management`
- US-008 Payment Collection → `us-008-payment-collection`

The slug is used as the folder name for all feature documents in both repos.

---

## File Locations

| Artifact | Path |
|---|---|
| Backend feature docs | `paycycle_api/docs/features/<slug>/` |
| Frontend feature docs | `paycycle_vendor/docs/features/<slug>/` |
| **API Spec** (backend produces) | `paycycle_api/docs/features/<slug>/API_SPEC.md` |
| **API Spec** (frontend reads) | `D:\Shrihari\Sourcecode\personal\paycycle\paycycle_api\docs\features\<slug>\API_SPEC.md` |
| Progress tracker | `D:\Shrihari\Sourcecode\personal\paycycle\project_documents\vendor_app\PROGRESS_TRACKER.md` |
| User stories | `D:\Shrihari\Sourcecode\personal\paycycle\project_documents\vendor_app\user_stories\` |
| Wireframes | `D:\Shrihari\Sourcecode\personal\paycycle\project_documents\vendor_app\wireframes\` |

---

## API_SPEC.md Format

The API spec is the **only document the frontend architect is guaranteed to read**.
It must be self-contained and frontend-friendly — no Prisma types, no domain internals.

### Required Sections

```markdown
# API Specification — <Feature Name>
> Slug: <feature-slug> | Generated: <YYYY-MM-DD>

## Base URL
All endpoints are relative to: `/api/v1`

## Authentication
Bearer JWT required on all endpoints unless noted.
Permissions required: `<resource>:read`, `<resource>:write` (RBAC enforced server-side)

## Endpoints

### <METHOD> /api/v1/<path>
**Purpose**: One-line description of what this endpoint does.
**Auth**: required | none
**Permissions**: `resource:action`

**Request body** (if applicable):
```json
{
  "field": "string",
  "count": "number",
  "active": "boolean",
  "id": "uuid"
}
```

**Response <status>**:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "field": "string"
  }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Invalid input |
| 403 | FORBIDDEN | Missing permission |
| 404 | NOT_FOUND | Resource not found |
| 409 | CONFLICT | Duplicate or state conflict |

---
<!-- repeat the block above for every endpoint -->

## List / Pagination
All list endpoints accept: `?page=1&limit=20`

Response envelope:
```json
{
  "success": true,
  "data": [],
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

## Error Envelope
All errors return:
```json
{
  "success": false,
  "error": {
    "code": "SNAKE_CASE_CODE",
    "message": "Human-readable message",
    "correlationId": "uuid"
  }
}
```
> `correlationId` must be logged by the frontend on every error for debugging.
```

### Style Rules for API_SPEC.md

- Use plain JSON types only: `string`, `number`, `boolean`, `uuid`, `ISO8601`, `array`
- No Prisma model names, no TypeScript interfaces, no domain entity names
- Every endpoint must list its permission string (e.g. `delivery:read`)
- Error table must cover all non-2xx codes the frontend must handle
- One endpoint = one `###` heading block — no combining

---

## Open Questions Format

When architects have open questions, they write them in `FEATURE_PLAN.md` under
the `## Open Questions` section using this format:

```markdown
## Open Questions

**Q1**: <The specific unresolved decision>
**Recommended**: <The architect's recommended answer>
**Trade-off**: <What is gained vs lost with the recommendation vs the alternative>

**Q2**: ...
```

The orchestrator reads this section, collects all questions from both plans, and presents
them together to the user before proceeding. Questions that the architect resolves
themselves (with a clear default from requirements or prior decisions) are NOT open
questions — only genuine decision points that require user judgement.

---

## Progress Tracker Update Rules

The orchestrator updates `PROGRESS_TRACKER.md` at these points:

| Phase | Backend column | Frontend column |
|---|---|---|
| Phase 0 start | 🟡 In Progress | 🟡 In Progress |
| Phase 2 backend PR created | PR link + branch | (unchanged) |
| Phase 2 frontend PR created | (unchanged) | PR link + branch |
| Both PRs created | 🟢 Completed | 🟢 Completed |

Format for the Completed entry:
```
🟢 Completed — PR #<number> (branch: feat/us-<id>-<slug>), merged <date>
```

---

## Branch Naming

Both repos use the same convention:

```
feat/us-<id>-<slug>
```

Examples:
- `feat/us-007-customer-management`
- `feat/us-008-payment-collection`

The orchestrator creates both branches at Phase 0 before spawning any sub-agents.

---

## Sub-Agent Invocation Targets

### Backend agents (paycycle_api)
```
Working directory: D:\Shrihari\Sourcecode\personal\paycycle\paycycle_api
Agent definitions: .claude/agents/architect.md | dev.md | review.md | qa.md
```

### Frontend agents (paycycle_vendor)
```
Working directory: D:\Shrihari\Sourcecode\personal\paycycle\paycycle_vendor
Agent definitions: .claude/agents/architect.md | dev.md | review.md | qa.md
```

When spawning a frontend sub-agent, the prompt must include:
- The absolute path to the frontend project: `D:\Shrihari\Sourcecode\personal\paycycle\paycycle_vendor`
- The feature slug and user story ID
- The absolute path to the API spec (for frontend architect and frontend dev)

---

## Pipeline Loop Logic

### Review loop
```
Review → APPROVE → proceed to QA
Review → REJECT → spawn Dev fix sub-agents (per affected workstream) → re-run Review
         (max 3 iterations before escalating to user with a summary of blockers)
```

### QA loop
```
QA → PASS → proceed to commit/push/PR
QA → FAIL → spawn Dev fix sub-agents (per failing test area) → re-run QA
     (max 3 iterations before escalating to user)
```

Max iteration guard prevents infinite loops. On reaching the limit, the orchestrator
surfaces a summary of unresolved issues to the user instead of looping again.
